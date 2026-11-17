"""
Comms: Morse tool, Meshtastic/MeshCore web clients, user-imported repeater lists.

The Morse tool is pure client-side JS. The mesh clients are static builds
served on their own ports by systemd units (download/comms.sh fetches them).
Repeater lists are CSVs the user exports themselves into comms/repeaters/
(RepeaterBook's terms forbid bundling their data).
"""

from flask import Blueprint, abort, redirect, render_template, request, url_for
from werkzeug.utils import secure_filename

import textutils
from common import _TTLCache, _admin_required, check_service
from settings import STORAGE_PATH
from constants import PORT_MESHCORE, PORT_MESHTASTIC

bp = Blueprint("comms", __name__)

COMMS_DIR = STORAGE_PATH / "comms"
REPEATERS_DIR = COMMS_DIR / "repeaters"
_repeaters_cache = _TTLCache(60.0)
_BANDS = {
    "6m": (50.0, 54.0), "2m": (144.0, 148.0), "1.25m": (222.0, 225.0),
    "70cm": (420.0, 450.0), "gmrs": (462.0, 467.9), "other": None,
}


def _repeater_files() -> list:
    if not REPEATERS_DIR.is_dir():
        return []
    return sorted(p for p in REPEATERS_DIR.glob("*.csv") if p.is_file())


def _compute_repeaters() -> list:
    rows = []
    for path in _repeater_files():
        try:
            text = path.read_text(encoding="utf-8-sig", errors="replace")
        except OSError:
            continue
        rows.extend(textutils.parse_repeater_csv(text, source=path.name))
    return rows


def _band_of(freq_text: str) -> str:
    try:
        freq = float(str(freq_text).split()[0])
    except (ValueError, IndexError):
        return "other"
    for band, span in _BANDS.items():
        if span and span[0] <= freq <= span[1]:
            return band
    return "other"


@bp.route("/comms")
def comms_page():
    mesh_installed = (COMMS_DIR / "meshtastic-web" / "index.html").exists()
    core_installed = (COMMS_DIR / "meshcore-web" / "index.html").exists()
    return render_template(
        "comms.html",
        mesh_installed=mesh_installed,
        mesh_running=check_service(PORT_MESHTASTIC) if mesh_installed else False,
        core_installed=core_installed,
        core_running=check_service(PORT_MESHCORE) if core_installed else False,
        core_apk=(STORAGE_PATH / "apps" / "android" / "meshcore.apk").exists(),
        repeater_count=len(_repeaters_cache.get(_compute_repeaters)),
        repeater_files=[p.name for p in _repeater_files()],
    )


@bp.route("/comms/morse")
def comms_morse():
    return render_template("morse.html")


@bp.route("/comms/repeaters")
def comms_repeaters():
    query = request.args.get("q", "").strip().lower()[:80]
    band = request.args.get("band", "").strip().lower()
    rows = _repeaters_cache.get(_compute_repeaters)
    if query:
        rows = [r for r in rows if query in " ".join(str(v) for v in r.values()).lower()]
    if band in _BANDS:
        rows = [r for r in rows if _band_of(r.get("frequency", "")) == band]
    return render_template(
        "repeaters.html", rows=rows[:500], total=len(rows), query=query, band=band,
        bands=list(_BANDS), files=[p.name for p in _repeater_files()],
        message=request.args.get("m", "")[:200],
    )


@bp.route("/comms/repeaters/upload", methods=["POST"])
@_admin_required
def comms_repeaters_upload():
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return redirect(url_for("comms.comms_repeaters", m="Pick a CSV file first."))
    name = secure_filename(upload.filename)[:120]
    if not name.lower().endswith(".csv"):
        return redirect(url_for("comms.comms_repeaters", m="Only .csv files are accepted."))
    try:
        REPEATERS_DIR.mkdir(parents=True, exist_ok=True)
        upload.save(str(REPEATERS_DIR / name))
    except OSError:
        return redirect(url_for("comms.comms_repeaters", m="Could not save the file."))
    _repeaters_cache.invalidate()
    rows = textutils.parse_repeater_csv(
        (REPEATERS_DIR / name).read_text(encoding="utf-8-sig", errors="replace"), source=name)
    return redirect(url_for("comms.comms_repeaters",
                            m=f"Imported {name}: {len(rows)} repeaters."))


@bp.route("/comms/repeaters/delete", methods=["POST"])
@_admin_required
def comms_repeaters_delete():
    name = secure_filename(request.form.get("name", ""))
    target = REPEATERS_DIR / name
    if not name or not target.is_file() or target.suffix.lower() != ".csv":
        abort(404)
    try:
        target.unlink()
    except OSError:
        abort(500)
    _repeaters_cache.invalidate()
    return redirect(url_for("comms.comms_repeaters", m=f"Removed {name}."))
