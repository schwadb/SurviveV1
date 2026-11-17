"""
Offline maps: MapLibre viewer + saved pins.

PMTiles basemaps under maps/pmtiles are read straight through /serve/ with
HTTP range requests, so no tile server is involved. Pins live in SQLite at
$STORAGE/.map_pins.db; anyone on the LAN may add or edit them (the map is a
shared family tool) — JSON-only requests are the CSRF defence.
"""

import logging
import os
import sqlite3
import threading
import xml.etree.ElementTree as ET
from datetime import datetime
from urllib.parse import quote

from flask import Blueprint, Response, jsonify, make_response, render_template, request

import textutils
from common import _require_json, _safe_walk
from settings import STORAGE_PATH
from extensions import csrf, limiter

bp = Blueprint("maps", __name__)

MAPS_DIR = STORAGE_PATH / "maps"
PINS_DB = STORAGE_PATH / ".map_pins.db"
_pins_lock = threading.Lock()


def _pins_connect():
    conn = sqlite3.connect(str(PINS_DB), timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute(
        "CREATE TABLE IF NOT EXISTS pins ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, "
        "lat REAL NOT NULL, lon REAL NOT NULL, icon TEXT NOT NULL DEFAULT 'pin', "
        "color TEXT NOT NULL DEFAULT '#3fb950', notes TEXT NOT NULL DEFAULT '', "
        "hidden INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, updated TEXT NOT NULL)"
    )
    return conn


def _pins_all() -> list:
    try:
        with _pins_connect() as conn:
            rows = conn.execute("SELECT * FROM pins ORDER BY name COLLATE NOCASE").fetchall()
        return [dict(r) for r in rows]
    except sqlite3.Error as exc:
        logging.warning("pins read failed: %s", exc)
        return []


def _pin_insert_many(pins: list) -> list:
    """Insert cleaned pins; returns the stored rows."""
    now = textutils.utc_now_iso()
    stored = []
    with _pins_lock, _pins_connect() as conn:
        for pin in pins:
            cur = conn.execute(
                "INSERT INTO pins (name, lat, lon, icon, color, notes, hidden, created, updated)"
                " VALUES (?,?,?,?,?,?,?,?,?)",
                (pin["name"], pin["lat"], pin["lon"], pin["icon"], pin["color"],
                 pin["notes"], pin["hidden"], now, now))
            stored.append({**pin, "id": cur.lastrowid, "created": now, "updated": now})
    return stored


def _map_assets() -> dict:
    """What the map page can draw: PMTiles basemaps/overlays under maps/pmtiles,
    plus whether label fonts and POI sprites have been fetched."""
    assets = {"basemaps": [], "overlays": [], "fonts_ok": False, "sprites_ok": False,
              "park_maps": 0}
    pm_dir = MAPS_DIR / "pmtiles"
    if pm_dir.is_dir():
        sized = []
        for f in pm_dir.glob("*.pmtiles"):
            try:
                sized.append((f.stat().st_size, f))
            except OSError:  # vanished mid-listing (download in progress)
                continue
        for size, f in sorted(sized, key=lambda t: t[0], reverse=True):
            entry = {"name": f.stem.replace("-", " ").replace("_", " "),
                     "file": f.name, "url": f"/serve/maps/pmtiles/{quote(f.name)}",
                     "size_mb": round(size / 1024 ** 2, 1)}
            if f.name.startswith("satellite"):
                assets["overlays"].append(entry)
            else:
                assets["basemaps"].append(entry)
    assets["fonts_ok"] = (MAPS_DIR / "fonts" / "Noto Sans Regular" / "0-255.pbf").exists()
    assets["sprites_ok"] = (MAPS_DIR / "sprites" / "v4" / "light.json").exists()
    parks = MAPS_DIR / "national_parks"
    if parks.is_dir():
        assets["park_maps"] = sum(1 for _ in _safe_walk(parks))
    return assets


def _relax_map_headers(resp):
    """MapLibre runs its tile workers from blob: URLs and the page asks for the
    phone's GPS, both of which the site-wide headers forbid. Set the relaxed
    values here; server._security_headers uses setdefault so these win."""
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; "
        "worker-src 'self' blob:; child-src blob:; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; connect-src 'self' blob:; font-src 'self'; "
        "object-src 'none'; frame-ancestors 'none';")
    resp.headers["Permissions-Policy"] = "geolocation=(self), microphone=(), camera=()"
    return resp


@bp.route("/maps")
def maps_page():
    """Offline street map with saved pins (MapLibre + PMTiles, no tile server)."""
    assets = _map_assets()
    resp = make_response(render_template(
        "maps.html", assets=assets, pins=_pins_all(),
        icons=textutils.PIN_ICONS, colors=textutils.PIN_COLORS,
        map_region=os.environ.get("MAP_REGION", ""),
    ))
    return _relax_map_headers(resp)


@bp.route("/api/map/assets")
def api_map_assets():
    return jsonify(_map_assets())


@bp.route("/api/map/pins", methods=["GET"])
def api_pins_list():
    return jsonify({"pins": _pins_all()})


@bp.route("/api/map/pins", methods=["POST"])
@csrf.exempt
@limiter.limit("60 per minute")
def api_pins_create():
    """Anyone on the LAN may save a pin — the map is a shared family tool."""
    err = _require_json()
    if err:
        return err
    try:
        pin = textutils.clean_pin(request.get_json(silent=True) or {})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    try:
        stored = _pin_insert_many([pin])[0]
    except sqlite3.Error as exc:
        return jsonify({"error": f"Could not save pin: {exc}"}), 500
    return jsonify(stored), 201


@bp.route("/api/map/pins/<int:pin_id>", methods=["PUT", "DELETE"])
@csrf.exempt
@limiter.limit("60 per minute")
# Each early return is a distinct client-facing error contract (415/404/400/500).
# pylint: disable=too-many-return-statements
def api_pin_modify(pin_id):
    err = _require_json()
    if err:
        return err
    try:
        with _pins_lock, _pins_connect() as conn:
            if request.method == "DELETE":
                cur = conn.execute("DELETE FROM pins WHERE id = ?", (pin_id,))
                if cur.rowcount == 0:
                    return jsonify({"error": "No such pin"}), 404
                return jsonify({"deleted": pin_id})
            row = conn.execute("SELECT * FROM pins WHERE id = ?", (pin_id,)).fetchone()
            if not row:
                return jsonify({"error": "No such pin"}), 404
            merged = {**dict(row), **(request.get_json(silent=True) or {})}
            pin = textutils.clean_pin(merged)
            now = textutils.utc_now_iso()
            conn.execute(
                "UPDATE pins SET name=?, lat=?, lon=?, icon=?, color=?, notes=?, hidden=?, "
                "updated=? WHERE id=?",
                (pin["name"], pin["lat"], pin["lon"], pin["icon"], pin["color"],
                 pin["notes"], pin["hidden"], now, pin_id))
            return jsonify({**pin, "id": pin_id, "created": row["created"], "updated": now})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except sqlite3.Error as exc:
        return jsonify({"error": f"Could not update pin: {exc}"}), 500


@bp.route("/api/map/pins/export")
def api_pins_export():
    fmt = request.args.get("format", "geojson").lower()
    pins = _pins_all()
    stamp = datetime.now().strftime("%Y%m%d")
    if fmt == "gpx":
        body, mime, ext = textutils.pins_to_gpx(pins), "application/gpx+xml", "gpx"
    else:
        body, mime, ext = textutils.pins_to_geojson(pins), "application/geo+json", "geojson"
    return Response(body, mimetype=mime, headers={
        "Content-Disposition": f'attachment; filename="survive-pins-{stamp}.{ext}"'})


@bp.route("/api/map/pins/import", methods=["POST"])
@csrf.exempt
@limiter.limit("6 per minute")
def api_pins_import():
    """Merge pins from a GPX or GeoJSON document (text in the JSON body)."""
    err = _require_json()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    try:
        pins = textutils.parse_pins(str(data.get("text", "")))
    except (ValueError, ET.ParseError) as exc:
        return jsonify({"error": f"Could not read file: {exc}"}), 400
    if not pins:
        return jsonify({"error": "No waypoints found in that file"}), 400
    try:
        stored = _pin_insert_many(pins)
    except sqlite3.Error as exc:
        return jsonify({"error": f"Could not save pins: {exc}"}), 500
    return jsonify({"imported": len(stored), "pins": stored}), 201
