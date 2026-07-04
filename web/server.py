#!/usr/bin/env python3
"""
SurviveV1 — Dashboard Web Server
Flask app serving the offline survival knowledge portal
"""

import os
import json
import logging
import re
import secrets
import shutil
import socket
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from datetime import datetime
from flask import (
    Flask, render_template, jsonify, request,
    send_from_directory, redirect, url_for, abort
)
from flask_wtf.csrf import CSRFProtect
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from constants import (  # noqa: E402
    CATEGORIES,
    SERVICES,
    PORT_OLLAMA,
    PORT_DASHBOARD,
    PORT_KIWIX,
    PORT_KOLIBRI,
    PORT_CALIBRE,
    PORT_JELLYFIN,
    PORT_MAPS,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = Flask(__name__)
app.config.update(
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_HTTPONLY=True,
    # Cap POST body size: the chat API only needs a JSON envelope; large bodies
    # would pin the Pi's memory before rate limiting or JSON parsing can reject them.
    MAX_CONTENT_LENGTH=64 * 1024,  # 64 KB
)

# CSRF is enabled for HTML form POSTs. JSON APIs are exempted individually
# and defended by a strict application/json Content-Type check instead --
# browsers cannot send that cross-origin without a CORS preflight.
csrf = CSRFProtect(app)

# Per-IP rate limiting; protects /api/ai/chat (which proxies to Ollama and
# can pin the Pi's CPU) and /search (which walks the 800 GB storage tree).
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["120 per minute"],
    storage_uri="memory://",
)


# Single source of truth for service ports in all templates.
@app.context_processor
def _inject_globals():
    return {
        "PORT_DASHBOARD": PORT_DASHBOARD,
        "PORT_KIWIX": PORT_KIWIX,
        "PORT_KOLIBRI": PORT_KOLIBRI,
        "PORT_CALIBRE": PORT_CALIBRE,
        "PORT_JELLYFIN": PORT_JELLYFIN,
        "PORT_MAPS": PORT_MAPS,
        "PORT_OLLAMA": PORT_OLLAMA,
        "storage_mounted": STORAGE_MOUNTED,
        "now": datetime.now(),
        "TIMEOUT_AI_CHAT": TIMEOUT_AI_CHAT,
    }


@app.after_request
def _security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    # Inline styles and scripts are used throughout the templates; unsafe-inline is
    # required until they are extracted to static files. This still blocks injected
    # external resources and data: URIs.
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "font-src 'self'; "
        "object-src 'none'; "
        "frame-ancestors 'none';",
    )
    return response

def _configure_secret_key(flask_app) -> None:
    """Set flask_app.secret_key from env, persisted file, or freshly generated value."""
    key_file = Path(__file__).parent.parent / "config" / ".secret_key"
    if os.environ.get("SECRET_KEY"):
        flask_app.secret_key = os.environ["SECRET_KEY"]
    elif key_file.exists():
        flask_app.secret_key = key_file.read_text().strip()
        key_file.chmod(0o600)  # enforce permissions on every startup
    else:
        new_key = secrets.token_hex(32)
        key_file.parent.mkdir(parents=True, exist_ok=True)
        key_file.write_text(new_key)
        key_file.chmod(0o600)
        flask_app.secret_key = new_key


_configure_secret_key(app)

# ── Configuration ──────────────────────────────────────────────────────────────
REPO_DIR = Path(__file__).parent.parent
DATA_DIR = Path(os.environ.get("SURVIVE_DATA_DIR", REPO_DIR / "data"))
_configured_storage = Path(os.environ.get("SURVIVE_STORAGE_PATH", "/mnt/survive"))
# Snapshot at startup — does not track live mount/unmount after the server starts.
STORAGE_MOUNTED = _configured_storage.exists()
STORAGE_PATH = _configured_storage if STORAGE_MOUNTED else DATA_DIR

# Tunable timeouts (seconds) — override via environment or survive.conf
TIMEOUT_SERVICE_CHECK = float(os.environ.get("SURVIVE_SERVICE_CHECK_TIMEOUT", "1"))
TIMEOUT_OLLAMA_LIST   = float(os.environ.get("SURVIVE_OLLAMA_LIST_TIMEOUT", "2"))
TIMEOUT_AI_CHAT       = float(os.environ.get("SURVIVE_AI_CHAT_TIMEOUT", "60"))

_CACHE_TTL = 60.0  # seconds — how long content-stat / recent-file caches are valid

# Search is capped to avoid walking 800 GB to exhaustion with zero matches.
_MAX_FILES_CHECKED = 500_000


class _TTLCache:
    """Thread-safe write-once TTL cache for a single value."""

    def __init__(self, ttl: float) -> None:
        self._ttl = ttl
        self._ts = 0.0
        self._data = None
        self._lock = threading.Lock()

    def get(self, compute):
        """Return cached value, calling compute() to refresh if TTL has expired."""
        with self._lock:
            if time.monotonic() - self._ts > self._ttl:
                self._ts = time.monotonic()
                self._data = compute()
            return self._data


_content_stats_cache = _TTLCache(_CACHE_TTL)
_recent_cache = _TTLCache(_CACHE_TTL)


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


def check_service(svc_port: int) -> bool:
    """Check if a service is running on given port."""
    try:
        with socket.create_connection(("localhost", svc_port), timeout=TIMEOUT_SERVICE_CHECK):
            return True
    except (ConnectionRefusedError, OSError):
        return False


def check_all_services() -> dict:
    """Check all services concurrently; wall-clock cost = one timeout period."""
    with ThreadPoolExecutor(max_workers=len(SERVICES)) as ex:
        futures = {name: ex.submit(check_service, svc["port"]) for name, svc in SERVICES.items()}
    return {
        name: {"running": future.result(), **SERVICES[name]}
        for name, future in futures.items()
    }


def _compute_content_stats() -> dict:
    """Walk each content subdirectory and return file counts + sizes."""
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


def get_content_stats() -> dict:
    """Cached wrapper — recomputes at most once per _CACHE_TTL seconds."""
    return _content_stats_cache.get(_compute_content_stats)


def _compute_recent_downloads() -> list:
    """Walk storage and return the 20 most recently modified content files."""
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


def get_recent_downloads() -> list:
    """Cached wrapper — recomputes at most once per _CACHE_TTL seconds."""
    return _recent_cache.get(_compute_recent_downloads)


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    storage = get_storage_info()
    return render_template(
        "index.html",
        categories=CATEGORIES,
        services=check_all_services(),
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
            STORAGE_PATH / cat_id,  # top-level dir (e.g. maps/, zim/ via "maps" / "reference" id)
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
    # Path traversal guard: resolve the requested path and refuse anything
    # that escapes the storage root.
    storage_root = STORAGE_PATH.resolve()
    try:
        browse_dir = (STORAGE_PATH / rel_path).resolve() if rel_path else storage_root
        browse_dir.relative_to(storage_root)
    except (ValueError, OSError):
        abort(403)
    if not browse_dir.exists() or not browse_dir.is_dir():
        abort(404)

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
    except PermissionError as e:
        logging.warning("browse_files permission denied at %s: %s", browse_dir, e)

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
        return render_template("error.html", code=403, message="Access forbidden"), 403
    if not full_path.exists():
        return render_template("error.html", code=404, message="File not found"), 404
    return send_from_directory(str(full_path.parent), full_path.name)


@app.route("/search")
@limiter.limit("30 per minute")
def search():
    query = request.args.get("q", "").strip()[:200]  # cap at 200 chars to prevent ReDoS
    results = []

    if query and len(query) >= 2:
        ql = query.lower()
        files_checked = 0
        try:
            for f in _safe_walk(STORAGE_PATH):
                files_checked += 1
                if files_checked > _MAX_FILES_CHECKED:
                    logging.info("search: hit %d-file cap, stopping walk", _MAX_FILES_CHECKED)
                    break
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
@csrf.exempt
@limiter.limit("5 per minute")
def ai_chat():
    """Proxy to local Ollama API."""
    # Strict Content-Type check: browsers cannot send application/json
    # cross-origin without a CORS preflight, so this blocks CSRF-style
    # form POSTs from a malicious page while the user is on the dashboard.
    if (request.content_type or "").split(";")[0].strip() != "application/json":
        return jsonify({"error": "Content-Type must be application/json"}), 415

    data = request.get_json(silent=True)
    if not data or "message" not in data:
        return jsonify({"error": "No message"}), 400

    model = data.get("model", os.environ.get("SURVIVE_AI_MODEL", "survive"))
    # Validate model name: allow alphanumeric, colon, dot, dash, underscore only.
    # Prevents path traversal or injection into the Ollama API URL.
    if not re.fullmatch(r"[a-zA-Z0-9:.\-_]{1,100}", model):
        return jsonify({"error": "Invalid model name"}), 400

    message = str(data["message"])[:4096]  # bound message length to one context window

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
            f"http://localhost:{PORT_OLLAMA}/api/chat",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT_AI_CHAT) as r:
            result = json.loads(r.read())
            return jsonify({
                "response": result.get("message", {}).get("content", "No response"),
                "model": model,
            })
    except (OSError, json.JSONDecodeError):
        # Log the real error server-side; never leak internals to the client.
        logging.exception("AI chat proxy error")
        return jsonify({"error": "AI service unavailable"}), 502


@app.route("/health")
@limiter.exempt
def health():
    """Lightweight liveness probe for systemd ExecStartPost and external checks."""
    return jsonify({"status": "ok"}), 200


@app.route("/api/status")
def api_status():
    """System status API endpoint."""
    svc = check_all_services()
    return jsonify({
        "storage": get_storage_info(),
        "services": {name: {"running": v["running"], "port": v["port"]} for name, v in svc.items()},
        "content": get_content_stats(),
        "timestamp": datetime.now().isoformat(),
    })


@app.route("/api/recent")
def api_recent():
    return jsonify(get_recent_downloads())


def _compute_connectivity() -> dict:
    """Probe outbound internet from the Pi itself (DNS-free TCP dial to public IPs)."""
    online = False
    for probe_host in ("1.1.1.1", "8.8.8.8"):
        try:
            with socket.create_connection((probe_host, 53), timeout=2):
                online = True
                break
        except OSError:
            continue
    return {"online": online}


_connectivity_cache = _TTLCache(30.0)  # re-probe at most every 30 s


@app.route("/api/connectivity")
def api_connectivity():
    """Server-side internet check. The browser cannot probe external hosts
    itself (blocked by our connect-src 'self' CSP), and the Pi's connectivity
    is what matters for downloads anyway."""
    return jsonify(_connectivity_cache.get(_compute_connectivity))


@app.route("/status")
def status_page():
    return render_template(
        "status.html",
        storage=get_storage_info(),
        content=get_content_stats(),
        services=check_all_services(),
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
