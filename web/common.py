"""
SurviveV1 — Helpers shared by several blueprints.

Caching, storage walking, admin authentication, service probes, and the
detached-job plumbing (launch a repo script, reconstruct its state from
disk) all live here. Nothing in this module registers routes.
"""

import logging
import os
import re
import shutil
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from functools import wraps
from pathlib import Path

from flask import jsonify, redirect, render_template, request, session, url_for

from settings import (
    ADMIN_PASSWORD_FILE,
    CACHE_TTL,
    OLLAMA_BASE,
    OLLAMA_IS_REMOTE,
    REPO_DIR,
    STORAGE_PATH,
    TIMEOUT_SERVICE_CHECK,
)
from constants import PORT_OLLAMA, SERVICES


# ── Caching ───────────────────────────────────────────────────────────────────
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

    def invalidate(self) -> None:
        """Force the next get() to recompute."""
        with self._lock:
            self._ts = 0.0


_content_stats_cache = _TTLCache(CACHE_TTL)
_recent_cache = _TTLCache(CACHE_TTL)


# ── Admin authentication (anonymous-guest model) ──────────────────────────────
# Guests never log in: anonymous access is read-only. Auth exists ONLY to
# elevate to admin (one password). Admin unlocks the Update button, service
# restarts, and future write features. Fail CLOSED: with no password set, admin
# endpoints are refused — never silently open.
_admin_hash_cache = _TTLCache(5.0)  # re-read the file at most every 5 s


def _admin_hash():
    """Stored admin password hash, or None if no password is set."""
    def _read():
        try:
            data = ADMIN_PASSWORD_FILE.read_text(encoding="utf-8").strip()
            return data or None
        except OSError:
            return None
    return _admin_hash_cache.get(_read)


def admin_configured() -> bool:
    return _admin_hash() is not None


def is_admin() -> bool:
    return bool(session.get("admin"))


def _admin_required(func):
    """Gate a route to admins. JSON 403 for /api/*, redirect to /login for pages.
    Fails closed when no admin password has been configured."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        if not is_admin():
            wants_json = request.path.startswith("/api/")
            if not admin_configured():
                msg = "No admin password set — run scripts/set_admin_password.py"
                return (jsonify({"error": msg}), 403) if wants_json else \
                    (render_template("error.html", code=403, message=msg), 403)
            if wants_json:
                return jsonify({"error": "Admin login required"}), 403
            return redirect(url_for("system.login", next=request.path))
        return func(*args, **kwargs)
    return wrapper


def _require_json():
    """Return an error response unless the request carries a JSON body.
    Same CSRF defence as /api/ai/chat: browsers cannot send application/json
    cross-origin without a CORS preflight."""
    if (request.content_type or "").split(";")[0].strip() != "application/json":
        return jsonify({"error": "Content-Type must be application/json"}), 415
    return None


# ── Storage ───────────────────────────────────────────────────────────────────
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


def _free_bytes() -> int:
    try:
        return shutil.disk_usage(str(STORAGE_PATH)).free
    except OSError:
        return 0


def _compute_content_stats() -> dict:
    """Walk each content subdirectory and return file counts + sizes."""
    stats = {}
    dirs = {
        "zim": STORAGE_PATH / "zim",
        "videos": STORAGE_PATH / "videos",
        "books": STORAGE_PATH / "books",
        "pdfs": STORAGE_PATH / "pdfs",
        "maps": STORAGE_PATH / "maps",
        "apps": STORAGE_PATH / "apps",
        "drugs": STORAGE_PATH / "drugs",
        "comms": STORAGE_PATH / "comms",
        "notes": STORAGE_PATH / "notes",
        "shared": STORAGE_PATH / "shared",
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
    """Cached wrapper — recomputes at most once per CACHE_TTL seconds."""
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
    """Cached wrapper — recomputes at most once per CACHE_TTL seconds."""
    return _recent_cache.get(_compute_recent_downloads)


# ── Service probes ────────────────────────────────────────────────────────────
def check_service(svc_port: int) -> bool:
    """Check if a service is running on given port."""
    try:
        with socket.create_connection(("localhost", svc_port), timeout=TIMEOUT_SERVICE_CHECK):
            return True
    except (ConnectionRefusedError, OSError):
        return False


def _ollama_alive() -> bool:
    """Liveness of the Ollama server, local OR remote. A remote host cannot be
    probed with a localhost TCP dial, so hit its HTTP API instead."""
    if not OLLAMA_IS_REMOTE:
        return check_service(PORT_OLLAMA)
    try:
        with urllib.request.urlopen(
            f"{OLLAMA_BASE}/api/version", timeout=TIMEOUT_SERVICE_CHECK
        ) as r:
            return r.status == 200
    except (OSError, urllib.error.URLError):
        return False


def check_all_services() -> dict:
    """Check all services concurrently; wall-clock cost = one timeout period.
    The 'ai' row uses _ollama_alive so a remote SURVIVE_OLLAMA_HOST is probed
    over HTTP rather than a (always-failing) localhost dial."""
    def _probe(name: str, svc: dict) -> bool:
        if name == "ai":
            return _ollama_alive()
        return check_service(svc["port"])
    with ThreadPoolExecutor(max_workers=len(SERVICES)) as ex:
        futures = {name: ex.submit(_probe, name, svc) for name, svc in SERVICES.items()}
    return {
        name: {"running": future.result(), **SERVICES[name]}
        for name, future in futures.items()
    }


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


# ── Detached jobs (update, ZIM download, rescan) ──────────────────────────────
# Long scripts are launched detached from gunicorn and their state is
# reconstructed from disk (log tail + pid file + a finish marker the bash
# wrapper appends) because workers share no memory.
_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except (OSError, OverflowError):
        return False
    return True


def _launch_detached(script: Path, args: list, log_file: Path, pid_file: Path,
                     marker: str) -> int:
    """Run a repo script detached from gunicorn, appending its output and a
    finish marker to log_file (state is reconstructed from disk because
    workers share no memory). Returns the pid."""
    log_file.parent.mkdir(parents=True, exist_ok=True)
    log_file.write_text("")
    cmd = ["bash", "-c",
           'bash "$0" "${@:2}" >>"$1" 2>&1; echo "' + marker + '$?" >>"$1"',
           str(script), str(log_file)] + [str(a) for a in args]
    proc = subprocess.Popen(  # pylint: disable=consider-using-with
        cmd, cwd=str(REPO_DIR),
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, start_new_session=True,
    )
    pid_file.write_text(str(proc.pid))
    threading.Thread(target=proc.wait, daemon=True).start()
    return proc.pid


def _read_job_state(log_file: Path, pid_file: Path, marker: str, tail_lines: int = 20) -> dict:
    """Generic running/exit_code/log_tail reconstruction from a job's log+pid."""
    state = {"running": False, "exit_code": None, "log_tail": [], "started": None}
    if not log_file.exists():
        return state
    pid = None
    try:
        pid = int(pid_file.read_text().strip())
        state["started"] = datetime.fromtimestamp(pid_file.stat().st_mtime).isoformat()
    except (OSError, ValueError):
        pass
    try:
        size = log_file.stat().st_size
        with open(log_file, "rb") as fh:
            fh.seek(max(0, size - 8192))
            tail = fh.read().decode("utf-8", errors="replace")
        lines = [_ANSI_RE.sub("", ln).strip() for ln in tail.replace("\r", "\n").splitlines()
                 if ln.strip()]
    except OSError:
        lines = []
    for line in reversed(lines):
        if line.startswith(marker):
            try:
                state["exit_code"] = int(line[len(marker):])
            except ValueError:
                state["exit_code"] = -1
            break
    if state["exit_code"] is None and pid and _pid_alive(pid):
        state["running"] = True
    state["log_tail"] = [ln for ln in lines[-tail_lines:] if not ln.startswith(marker)]
    return state
