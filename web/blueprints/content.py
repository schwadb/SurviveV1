"""
Library manager: browse the Kiwix catalog, download ZIMs, register sideloads.

/api/content/catalog proxies library.kiwix.org/catalog/v2 (15-min cache) and
marks entries installed by matching textutils.zim_name_prefix() against files
on disk. Admin POSTs run scripts/download_zim.sh (max 2 jobs, host allowlist,
free-space check) and scripts/rescan_library.sh detached; progress is read
back from their logs via common._read_job_state.
"""

import logging
import re
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

from flask import Blueprint, jsonify, render_template, request

import textutils
from common import (
    _admin_required,
    _compute_connectivity,
    _free_bytes,
    _launch_detached,
    _read_job_state,
    _require_json,
    _safe_walk,
)
from settings import FREE_SPACE_MARGIN, REPO_DIR, STORAGE_PATH
from extensions import csrf, limiter

bp = Blueprint("content", __name__)

KIWIX_CATALOG = "https://library.kiwix.org/catalog/v2"
ZIM_DIR = STORAGE_PATH / "zim"
KIWIX_LIBRARY_XML = STORAGE_PATH / ".kiwix_library.xml"
DOWNLOAD_ZIM_SCRIPT = REPO_DIR / "scripts" / "download_zim.sh"
RESCAN_SCRIPT = REPO_DIR / "scripts" / "rescan_library.sh"
_ZIMDL_MARK = "ZIMDL_FINISHED exit="
_RESCAN_MARK = "RESCAN_FINISHED exit="
_ALLOWED_ZIM_HOSTS = ("download.kiwix.org", "lb.download.kiwix.org",
                      "mirror.download.kiwix.org")
_MAX_ZIM_JOBS = 2
_catalog_cache: dict = {}
_catalog_lock = threading.Lock()
_CATALOG_TTL = 900.0  # the catalog changes daily at most; 15 min is plenty


def _fetch_catalog(path: str) -> bytes:
    """GET a catalog document; cached per path for _CATALOG_TTL seconds."""
    now = time.monotonic()
    with _catalog_lock:
        hit = _catalog_cache.get(path)
        if hit and now - hit[0] < _CATALOG_TTL:
            return hit[1]
    req = urllib.request.Request(KIWIX_CATALOG + path,
                                 headers={"User-Agent": "SurviveV1 dashboard"})
    with urllib.request.urlopen(req, timeout=25) as resp:
        data = resp.read()
    with _catalog_lock:
        if len(_catalog_cache) > 64:
            _catalog_cache.clear()
        _catalog_cache[path] = (now, data)
    return data


def _local_zims() -> list:
    """ZIM files on the drive, with whether the Kiwix library knows them."""
    registered = set()
    try:
        for book in ET.parse(str(KIWIX_LIBRARY_XML)).getroot().iter("book"):
            path = book.get("path", "")
            if path:
                registered.add(Path(path).name)
    except (OSError, ET.ParseError):
        pass
    items = []
    if ZIM_DIR.is_dir():
        for f in _safe_walk(ZIM_DIR):
            if f.suffix.lower() != ".zim":
                continue
            try:
                st = f.stat()
            except OSError:
                continue
            partial = f.with_name(f.name + ".aria2").exists()
            items.append({
                "file": f.name,
                "path": str(f.relative_to(STORAGE_PATH)),
                "name": textutils.zim_name_prefix(f.name),
                "size_gb": round(st.st_size / 1024 ** 3, 2),
                "modified": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d"),
                "registered": f.name in registered and not partial,
                "partial": partial,
            })
    items.sort(key=lambda i: i["file"].lower())
    return items


def _zim_job_id(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", name)[:80] or "zim"


def _zim_job_paths(job_id: str) -> tuple:
    logs = STORAGE_PATH / ".logs"
    return logs / f"zimdl_{job_id}.log", logs / f"zimdl_{job_id}.pid"


def _content_jobs() -> dict:
    """Every dashboard-started ZIM download plus the rescan job, from disk."""
    jobs = []
    logs = STORAGE_PATH / ".logs"
    for log_file in sorted(logs.glob("zimdl_*.log")) if logs.is_dir() else []:
        job_id = log_file.name[len("zimdl_"):-len(".log")]
        state = _read_job_state(log_file, log_file.with_suffix(".pid"), _ZIMDL_MARK, 6)
        progress = ""
        for line in reversed(state["log_tail"]):
            if "%" in line or "Downloading" in line:
                progress = line[:160]
                break
        jobs.append({"id": job_id, "progress": progress, **state})
    rescan = _read_job_state(logs / "rescan.log", logs / "rescan.pid", _RESCAN_MARK, 6)
    running = sum(1 for j in jobs if j["running"])
    return {"jobs": jobs, "rescan": rescan, "running": running}


@bp.route("/content")
def content_page():
    """Browse the Kiwix catalog, see what is on the drive, start downloads."""
    return render_template(
        "content.html", local=_local_zims(), jobs=_content_jobs(),
        categories_list=textutils.KIWIX_CATEGORIES,
        online=_compute_connectivity()["online"],
    )


@bp.route("/api/content/catalog")
@limiter.limit("30 per minute")
def api_content_catalog():
    lang = re.sub(r"[^a-z]", "", request.args.get("lang", "eng").lower())[:3]
    query = request.args.get("q", "").strip()[:80]
    cat_filter = request.args.get("category", "").strip()
    try:
        start = max(0, int(request.args.get("start", 0)))
        count = min(100, max(1, int(request.args.get("count", 50))))
    except ValueError:
        start, count = 0, 50
    params = {"start": start, "count": count}
    if lang:
        params["lang"] = lang
    if query:
        params["q"] = query
    if cat_filter in textutils.KIWIX_CATEGORIES:
        params["category"] = cat_filter
    path = "/entries?" + "&".join(f"{k}={quote(str(v))}" for k, v in params.items())
    try:
        data = textutils.parse_kiwix_catalog(_fetch_catalog(path))
    except (OSError, ET.ParseError, ValueError) as exc:
        logging.info("catalog fetch failed: %s", exc)
        return jsonify({"error": "Could not reach library.kiwix.org — is the Pi online?"}), 503
    installed = {z["name"]: z for z in _local_zims()}
    jobs = {j["id"]: j for j in _content_jobs()["jobs"]}
    for entry in data["entries"]:
        local = installed.get(entry["name"])
        job = jobs.get(_zim_job_id(entry["name"]))
        if local and not local["partial"]:
            entry["status"] = "installed"
        elif job and job["running"]:
            entry["status"] = "downloading"
        elif local and local["partial"]:
            entry["status"] = "partial"
        else:
            entry["status"] = "available"
    data["start"] = start
    data["count"] = count
    return jsonify(data)


@bp.route("/api/content/languages")
@limiter.limit("10 per minute")
def api_content_languages():
    try:
        langs = textutils.parse_kiwix_languages(_fetch_catalog("/languages"))
    except (OSError, ET.ParseError, ValueError):
        return jsonify({"error": "Could not reach library.kiwix.org"}), 503
    return jsonify({"languages": langs})


@bp.route("/api/content/local")
def api_content_local():
    return jsonify({"zims": _local_zims(), "free_gb": round(_free_bytes() / 1024 ** 3, 1)})


@bp.route("/api/content/jobs")
def api_content_jobs():
    return jsonify(_content_jobs())


@bp.route("/api/content/download", methods=["POST"])
@csrf.exempt
@limiter.limit("10 per minute")
@_admin_required
# Each early return is a distinct client-facing error contract.
# pylint: disable=too-many-return-statements,too-many-branches
def api_content_download():
    """Start scripts/download_zim.sh for one catalog item. Admin-only."""
    err = _require_json()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    url = str(data.get("url", "")).strip()
    name = str(data.get("name", "")).strip()
    zim_host = url.split("/")[2] if url.startswith("https://") and url.count("/") >= 3 else ""
    if zim_host not in _ALLOWED_ZIM_HOSTS or not url.endswith(".zim") or ".." in url:
        return jsonify({"error": "Only .zim downloads from download.kiwix.org are allowed"}), 400
    if not name:
        name = textutils.zim_name_prefix(url)
    try:
        size = int(data.get("size") or 0)
    except (TypeError, ValueError):
        size = 0
    if size and _free_bytes() - size < FREE_SPACE_MARGIN:
        need_gb = round((size + FREE_SPACE_MARGIN - _free_bytes()) / 1024 ** 3, 1)
        return jsonify({"error": f"Not enough free space — {need_gb} GB short "
                                 "(10 GB is always kept free)"}), 507
    if not _compute_connectivity()["online"]:
        return jsonify({"error": "No internet connection — connect the Pi first"}), 503
    if not DOWNLOAD_ZIM_SCRIPT.exists():
        return jsonify({"error": f"Script missing: {DOWNLOAD_ZIM_SCRIPT}"}), 500
    jobs = _content_jobs()
    if jobs["running"] >= _MAX_ZIM_JOBS:
        return jsonify({"error": f"{_MAX_ZIM_JOBS} downloads already running — "
                                 "wait for one to finish"}), 409
    job_id = _zim_job_id(name)
    log_file, pid_file = _zim_job_paths(job_id)
    if _read_job_state(log_file, pid_file, _ZIMDL_MARK)["running"]:
        return jsonify({"error": "That download is already running"}), 409
    try:
        pid = _launch_detached(DOWNLOAD_ZIM_SCRIPT, [url, "catalog"],
                               log_file, pid_file, _ZIMDL_MARK)
    except OSError as exc:
        return jsonify({"error": f"Could not start download: {exc}"}), 500
    return jsonify({"started": True, "job": job_id, "pid": pid}), 202


@bp.route("/api/content/rescan", methods=["POST"])
@csrf.exempt
@limiter.limit("3 per minute")
@_admin_required
def api_content_rescan():
    """Rebuild the Kiwix library from the files on disk (sideloaded ZIMs)."""
    err = _require_json()
    if err:
        return err
    logs = STORAGE_PATH / ".logs"
    log_file, pid_file = logs / "rescan.log", logs / "rescan.pid"
    if _read_job_state(log_file, pid_file, _RESCAN_MARK)["running"]:
        return jsonify({"error": "A rescan is already running"}), 409
    if not RESCAN_SCRIPT.exists():
        return jsonify({"error": f"Script missing: {RESCAN_SCRIPT}"}), 500
    try:
        pid = _launch_detached(RESCAN_SCRIPT, ["--storage", str(STORAGE_PATH)],
                               log_file, pid_file, _RESCAN_MARK)
    except OSError as exc:
        return jsonify({"error": f"Could not start rescan: {exc}"}), 500
    return jsonify({"started": True, "pid": pid}), 202
