#!/usr/bin/env python3
"""
SurviveV1 — Dashboard Web Server
Flask app serving the offline survival knowledge portal
"""

import os
import json
import logging
import shutil
import socket
import urllib.request
from pathlib import Path
from datetime import datetime
from flask import (
    Flask, render_template, jsonify, request,
    send_from_directory, redirect, url_for
)

from constants import SERVICES, PORT_OLLAMA  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = Flask(__name__)

# Generate a persistent random secret key on first run
_KEY_FILE = Path(__file__).parent.parent / "config" / ".secret_key"
if os.environ.get("SECRET_KEY"):
    app.secret_key = os.environ["SECRET_KEY"]
elif _KEY_FILE.exists():
    app.secret_key = _KEY_FILE.read_text().strip()
    _KEY_FILE.chmod(0o600)  # enforce permissions on every startup
else:
    import secrets as _secrets
    _new_key = _secrets.token_hex(32)
    _KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    _KEY_FILE.write_text(_new_key)
    _KEY_FILE.chmod(0o600)
    app.secret_key = _new_key

# ── Configuration ──────────────────────────────────────────────────────────────
REPO_DIR = Path(__file__).parent.parent
DATA_DIR = Path(os.environ.get("SURVIVE_DATA_DIR", REPO_DIR / "data"))
STORAGE_PATH = Path(os.environ.get("SURVIVE_STORAGE_PATH", "/mnt/survive"))

# Tunable timeouts (seconds) — override via environment or survive.conf
TIMEOUT_SERVICE_CHECK = float(os.environ.get("SURVIVE_SERVICE_CHECK_TIMEOUT", "1"))
TIMEOUT_OLLAMA_LIST   = float(os.environ.get("SURVIVE_OLLAMA_LIST_TIMEOUT", "2"))
TIMEOUT_AI_CHAT       = float(os.environ.get("SURVIVE_AI_CHAT_TIMEOUT", "60"))

# Fall back to repo data dir if storage not mounted
if not STORAGE_PATH.exists():
    STORAGE_PATH = DATA_DIR

CATEGORIES = [
    # ── Core Survival ─────────────────────────────────────────
    {"id": "medical", "name": "Medical & First Aid", "icon": "🏥",
     "color": "#e74c3c", "desc": "Emergency medicine, first aid, TCCC, trauma"},
    {"id": "medicine_advanced", "name": "Advanced Medicine", "icon": "🩺",
     "color": "#c0392b", "desc": "Surgery, obstetrics, dental, psychiatric care in austere settings"},
    {"id": "obstetrics", "name": "Childbirth & Midwifery", "icon": "👶",
     "color": "#e91e8c", "desc": "Emergency delivery, midwifery, prenatal care without hospital"},
    {"id": "dental", "name": "Dental Emergency", "icon": "🦷",
     "color": "#9b59b6", "desc": "Tooth extraction, abscess, fillings without a dentist"},
    {"id": "psychology", "name": "Mental Health & Survival Psychology", "icon": "🧠",
     "color": "#8e44ad", "desc": "Psychological first aid, grief, resilience, disaster psychology"},
    # ── Food & Water ──────────────────────────────────────────
    {"id": "food", "name": "Food & Water", "icon": "🌾",
     "color": "#27ae60", "desc": "Farming, foraging, food preservation, water purification"},
    {"id": "animal_husbandry", "name": "Animal Husbandry", "icon": "🐓",
     "color": "#2ecc71", "desc": "Chickens, goats, pigs, cattle, rabbits — health, breeding, butchering"},
    {"id": "seeds", "name": "Seed Saving", "icon": "🌱",
     "color": "#1abc9c", "desc": "Saving, storing, and propagating open-pollinated seeds across generations"},
    {"id": "beeswax", "name": "Beekeeping", "icon": "🐝",
     "color": "#f39c12", "desc": "Hive management, honey harvest, wax, mead, disease prevention"},
    {"id": "fermentation", "name": "Fermentation & Brewing", "icon": "🍺",
     "color": "#d35400", "desc": "Lacto-fermentation, beer, mead, vinegar, cheese, tinctures"},
    # ── Infrastructure ────────────────────────────────────────
    {"id": "shelter", "name": "Shelter & Construction", "icon": "🏠",
     "color": "#8e44ad", "desc": "Building techniques, earthships, log cabins, off-grid structures"},
    {"id": "sanitation", "name": "Sanitation & Waste", "icon": "🚽",
     "color": "#795548", "desc": "Composting toilets, humanure, greywater, disease prevention"},
    {"id": "water_systems", "name": "Water Systems & Wells", "icon": "💧",
     "color": "#2980b9", "desc": "Hand-dug wells, rainwater, filtration, distribution systems"},
    {"id": "energy", "name": "Energy & Power", "icon": "⚡",
     "color": "#f39c12", "desc": "Solar, wind, batteries, biogas, generators"},
    # ── Skills & Crafts ───────────────────────────────────────
    {"id": "skills", "name": "Wilderness & Primitive Skills", "icon": "🪓",
     "color": "#16a085", "desc": "Fire, navigation, foraging, tracking, shelter building"},
    {"id": "blacksmithing", "name": "Blacksmithing & Metalwork", "icon": "⚒️",
     "color": "#607d8b", "desc": "Forge building, tool making, repair, knife making"},
    {"id": "primitive_skills", "name": "Primitive Crafts", "icon": "🧵",
     "color": "#8d6e63", "desc": "Brain tanning, soap making, candles, fiber, pottery (18th century methods)"},
    {"id": "tools", "name": "Tools & Repair", "icon": "🔧",
     "color": "#2980b9", "desc": "iFixit guides, woodworking, mechanical repair"},
    {"id": "permaculture", "name": "Permaculture & Food Forest", "icon": "🌳",
     "color": "#4caf50", "desc": "Zone design, guild planting, food forest, water harvesting earthworks"},
    # ── Communications & Community ────────────────────────────
    {"id": "communication", "name": "Communications & Radio", "icon": "📡",
     "color": "#c0392b", "desc": "Ham radio, Morse code, CHIRP programming, emergency frequencies"},
    {"id": "security", "name": "Security & Defense", "icon": "🛡️",
     "color": "#37474f", "desc": "Perimeter defense, hand signals, community security doctrine"},
    {"id": "community", "name": "Community & Social Survival", "icon": "👥",
     "color": "#5c6bc0", "desc": "Post-collapse governance, barter economy, conflict resolution"},
    # ── Reference ─────────────────────────────────────────────
    {"id": "education", "name": "Education & Science", "icon": "🔬",
     "color": "#2c3e50", "desc": "Khan Academy, science, math, engineering"},
    {"id": "reference", "name": "Reference & Books", "icon": "📚",
     "color": "#7f8c8d", "desc": "Wikipedia, Gutenberg library, manuals"},
    {"id": "maps", "name": "Maps & Navigation", "icon": "🗺️",
     "color": "#d35400", "desc": "Offline maps, topographic charts, navigation"},
    {"id": "military", "name": "Military Manuals", "icon": "⚔️",
     "color": "#2c3e50", "desc": "Army survival, field manuals, TCCC"},
    {"id": "videos", "name": "How-To Videos", "icon": "🎬",
     "color": "#8e44ad", "desc": "Step-by-step survival and skills videos"},
]


def _safe_walk(root: Path):
    """Yield files under root without following symlinks (prevents infinite loops)."""
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        # Skip hidden directories in-place
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for name in filenames:
            if not name.startswith("."):
                yield Path(dirpath) / name


def get_storage_info():
    """Return disk usage for the storage path."""
    try:
        total, used, free = shutil.disk_usage(str(STORAGE_PATH))
        return {
            "total_gb": round(total / (1024**3), 1),
            "used_gb": round(used / (1024**3), 1),
            "free_gb": round(free / (1024**3), 1),
            "percent": round((used / total) * 100, 1),
        }
    except OSError as e:
        logging.warning("Could not read disk usage: %s", e)
        return {"total_gb": 0, "used_gb": 0, "free_gb": 0, "percent": 0}


def check_service(port: int) -> bool:
    """Check if a service is running on given port."""
    try:
        with socket.create_connection(("localhost", port), timeout=TIMEOUT_SERVICE_CHECK):
            return True
    except (ConnectionRefusedError, OSError):
        return False


def get_content_stats():
    """Count files and total size for each content subdirectory."""
    stats = {}
    dirs = {
        "zim": STORAGE_PATH / "zim",
        "videos": STORAGE_PATH / "videos",
        "books": STORAGE_PATH / "books",
        "pdfs": STORAGE_PATH / "pdfs",
        "maps": STORAGE_PATH / "maps",
    }
    for name, path in dirs.items():
        if path.exists():
            count, size = 0, 0
            for f in _safe_walk(path):
                count += 1
                try:
                    size += f.stat().st_size
                except OSError:
                    pass
            stats[name] = {
                "count": count,
                "size_gb": round(size / (1024**3), 2),
                "exists": True,
            }
        else:
            stats[name] = {"count": 0, "size_gb": 0, "exists": False}
    return stats


def get_recent_downloads():
    """Return the 20 most recently modified content files."""
    recent = []
    allowed_exts = {".zim", ".pdf", ".epub", ".mp4"}
    try:
        for f in _safe_walk(STORAGE_PATH):
            if f.suffix.lower() in allowed_exts:
                try:
                    st = f.stat()
                    recent.append({
                        "name": f.name,
                        "path": str(f.relative_to(STORAGE_PATH)),
                        "size_mb": round(st.st_size / (1024**2), 1),
                        "modified": datetime.fromtimestamp(st.st_mtime).isoformat(),
                    })
                except OSError:
                    pass
        recent.sort(key=lambda x: x["modified"], reverse=True)
        return recent[:20]
    except OSError as e:
        logging.warning("get_recent_downloads failed: %s", e)
        return []


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    storage = get_storage_info()
    service_status = {
        name: {"running": check_service(svc["port"]), **svc}
        for name, svc in SERVICES.items()
    }
    return render_template(
        "index.html",
        categories=CATEGORIES,
        services=service_status,
        storage=storage,
        now=datetime.now(),
    )


@app.route("/category/<cat_id>")
def category(cat_id):
    cat = next((c for c in CATEGORIES if c["id"] == cat_id), None)
    if not cat:
        return redirect(url_for("index"))

    files = []
    try:
        search_dirs = [
            STORAGE_PATH / "pdfs" / cat_id,
            STORAGE_PATH / "books" / cat_id,
            STORAGE_PATH / "videos" / cat_id,
        ]
        for d in search_dirs:
            if d.exists():
                for f in _safe_walk(d):
                    files.append({
                        "name": f.stem,
                        "filename": f.name,
                        "ext": f.suffix.lower().lstrip("."),
                        "path": str(f.relative_to(STORAGE_PATH)),
                        "size_mb": round(f.stat().st_size / (1024**2), 1),
                    })
    except OSError as e:
        logging.warning("category listing failed for %s: %s", cat_id, e)

    return render_template("category.html", cat=cat, files=files, categories=CATEGORIES)


@app.route("/files")
def browse_files():
    """File browser for all content."""
    rel_path = request.args.get("path", "")
    browse_dir = STORAGE_PATH / rel_path if rel_path else STORAGE_PATH

    items = []
    try:
        for item in sorted(browse_dir.iterdir()):
            if item.name.startswith("."):
                continue
            stat = item.stat()
            items.append({
                "name": item.name,
                "is_dir": item.is_dir(),
                "size_mb": round(stat.st_size / (1024**2), 1) if item.is_file() else None,
                "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d"),
                "path": str(item.relative_to(STORAGE_PATH)),
                "ext": item.suffix.lower().lstrip(".") if item.is_file() else "",
            })
    except PermissionError:
        pass

    parent = str(Path(rel_path).parent) if rel_path else None
    return render_template(
        "files.html",
        items=items,
        current_path=rel_path,
        parent=parent,
        categories=CATEGORIES,
    )


@app.route("/serve/<path:filepath>")
def serve_file(filepath):
    """Serve a file from storage."""
    full_path = (STORAGE_PATH / filepath).resolve()
    storage_root = STORAGE_PATH.resolve()
    # Prevent path traversal — ensure the resolved path is inside storage root
    try:
        full_path.relative_to(storage_root)
    except ValueError:
        return "Forbidden", 403
    if not full_path.exists():
        return "File not found", 404
    return send_from_directory(str(full_path.parent), full_path.name)


@app.route("/search")
def search():
    query = request.args.get("q", "").strip()[:200]  # cap at 200 chars to prevent ReDoS
    results = []

    if query and len(query) >= 2:
        ql = query.lower()
        try:
            for f in _safe_walk(STORAGE_PATH):
                if ql in f.name.lower():
                    try:
                        results.append({
                            "name": f.stem,
                            "filename": f.name,
                            "ext": f.suffix.lower().lstrip("."),
                            "path": str(f.relative_to(STORAGE_PATH)),
                            "size_mb": round(f.stat().st_size / (1024**2), 1),
                        })
                    except OSError:
                        pass
                    if len(results) >= 50:
                        break
        except OSError as e:
            logging.warning("search walk failed: %s", e)

    return render_template(
        "search.html",
        query=query,
        results=results,
        categories=CATEGORIES,
    )


@app.route("/ai")
def ai_page():
    ai_running = check_service(PORT_OLLAMA)
    models = []
    if ai_running:
        try:
            with urllib.request.urlopen(
                f"http://localhost:{PORT_OLLAMA}/api/tags", timeout=TIMEOUT_OLLAMA_LIST
            ) as r:
                data = json.loads(r.read())
                models = [m["name"] for m in data.get("models", [])]
        except (OSError, json.JSONDecodeError) as e:
            logging.debug("Could not fetch Ollama model list: %s", e)
    return render_template("ai.html", ai_running=ai_running, models=models, categories=CATEGORIES)


@app.route("/api/ai/chat", methods=["POST"])
def ai_chat():
    """Proxy to local Ollama API."""
    data = request.get_json()
    if not data or "message" not in data:
        return jsonify({"error": "No message"}), 400

    model = data.get("model", "tinyllama")
    message = data["message"]

    try:
        payload = json.dumps({
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a survival expert assistant running offline on a Raspberry Pi. "
                        "Help with practical survival, medicine, food, water, shelter, energy, "
                        "and skills. Be concise and practical. No internet available."
                    ),
                },
                {"role": "user", "content": message},
            ],
            "stream": False,
        }).encode()

        req = urllib.request.Request(
            "http://localhost:11434/api/chat",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT_AI_CHAT) as r:
            result = json.loads(r.read())
            return jsonify({
                "response": result.get("message", {}).get("content", "No response"),
                "model": model,
            })
    except (OSError, json.JSONDecodeError) as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/status")
def api_status():
    """System status API endpoint."""
    return jsonify({
        "storage": get_storage_info(),
        "services": {
            name: {"running": check_service(svc["port"]), "port": svc["port"]}
            for name, svc in SERVICES.items()
        },
        "content": get_content_stats(),
        "timestamp": datetime.now().isoformat(),
    })


@app.route("/api/recent")
def api_recent():
    return jsonify(get_recent_downloads())


@app.route("/status")
def status_page():
    storage = get_storage_info()
    content = get_content_stats()
    service_status = {
        name: {"running": check_service(svc["port"]), **svc}
        for name, svc in SERVICES.items()
    }
    return render_template(
        "status.html",
        storage=storage,
        content=content,
        services=service_status,
        categories=CATEGORIES,
        recent=get_recent_downloads(),
    )


@app.errorhandler(404)
def not_found(_e):
    return render_template("error.html", code=404, message="Page not found"), 404


@app.errorhandler(403)
def forbidden(_e):
    return render_template("error.html", code=403, message="Access forbidden"), 403


@app.errorhandler(500)
def server_error(_e):
    logging.exception("Internal server error")
    return render_template("error.html", code=500, message="Internal server error"), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    host = os.environ.get("HOST", "0.0.0.0")
    # Debug mode disabled in production — never expose stack traces to users
    logging.info("SurviveV1 Dashboard starting on %s:%d", host, port)
    app.run(host=host, port=port, debug=False)
