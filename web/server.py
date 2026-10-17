#!/usr/bin/env python3
# pylint: disable=too-many-lines  # single-file Flask app by design (CLAUDE.md)
"""
SurviveV1 — Dashboard Web Server
Flask app serving the offline survival knowledge portal
"""

import os
import json
import logging
import mimetypes
import re
import secrets
import shutil
import socket
import sqlite3
import subprocess
import threading
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from datetime import datetime
from functools import wraps
from urllib.parse import quote
from flask import (
    Flask, render_template, jsonify, request, session,
    send_from_directory, redirect, url_for, abort,
    Response, stream_with_context, make_response
)
from flask.wrappers import Request
from flask_wtf.csrf import CSRFProtect
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.security import check_password_hash
from werkzeug.utils import secure_filename

from constants import (  # noqa: E402
    CATEGORIES,
    DOWNLOAD_CATEGORIES,
    SERVICES,
    PORT_OLLAMA,
    PORT_DASHBOARD,
    PORT_KIWIX,
    PORT_KOLIBRI,
    PORT_CALIBRE,
    PORT_JELLYFIN,
    PORT_MAPS,
    PORT_MESHTASTIC,
)
import textutils  # noqa: E402  (pure helpers: markdown, pins, CSV)

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

# A few routes legitimately take big bodies (file uploads, note text, pin
# imports). Rather than lift the global 64 KB cap, the request class answers
# a per-path limit; everything else keeps the tight default.
_BODY_LIMITS = (
    ("/shared/upload", 2 * 1024 ** 3),          # 2 GB — personal files
    ("/comms/repeaters/upload", 20 * 1024 ** 2),  # 20 MB — CSV lists
    ("/api/map/pins/import", 4 * 1024 ** 2),     # 4 MB — GPX/GeoJSON
    ("/notes/save", 512 * 1024),                 # 512 KB — one note
)


class _SizedRequest(Request):
    @property
    def max_content_length(self):
        for prefix, limit in _BODY_LIMITS:
            if self.path.startswith(prefix):
                return limit
        return app.config["MAX_CONTENT_LENGTH"]

    @max_content_length.setter
    def max_content_length(self, _value):  # Werkzeug assigns this in __init__
        pass


app.request_class = _SizedRequest

# Without this, send_from_directory serves .apk as octet-stream and some
# Android browsers rename the download to .zip, which breaks installation.
mimetypes.add_type("application/vnd.android.package-archive", ".apk")

# CSRF is enabled for HTML form POSTs. JSON APIs are exempted individually
# and defended by a strict application/json Content-Type check instead --
# browsers cannot send that cross-origin without a CORS preflight.
csrf = CSRFProtect(app)

# Per-IP rate limiting; protects /api/ai/chat (which proxies to Ollama and
# can pin the Pi's CPU) and /search (which walks the 800 GB storage tree).
# storage_uri defaults to memory:// (per-gunicorn-worker counters, so
# effective limits are ~2x with 2 workers — acceptable for a LAN appliance).
# Set SURVIVE_LIMITER_STORAGE="redis://127.0.0.1:6379" (with a local redis and
# `pip install limits[redis]`) to make limits exact across workers.
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["120 per minute"],
    storage_uri=os.environ.get("SURVIVE_LIMITER_STORAGE", "memory://"),
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
        "PORT_MESHTASTIC": PORT_MESHTASTIC,
        "PORT_OLLAMA": PORT_OLLAMA,
        "storage_mounted": STORAGE_MOUNTED,
        "now": datetime.now(),
        "TIMEOUT_AI_CHAT": TIMEOUT_AI_CHAT,
        # True when viewed inside a captive-portal mini-browser (the OS probe
        # Host header), so base.html can nudge the user to a real browser.
        "in_captive_browser": request.host.split(":")[0] in CAPTIVE_HOSTS,
        "is_admin": is_admin(),
        "admin_configured": admin_configured(),
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
# The installed dashboard runs from a copy under /opt/survive, but the scripts
# it launches (update, rescan, ZIM downloads) live in the git clone.
# generate_services.sh exports SURVIVE_REPO_DIR; dev runs fall back to the tree.
REPO_DIR = Path(os.environ.get("SURVIVE_REPO_DIR") or Path(__file__).parent.parent)
DATA_DIR = Path(os.environ.get("SURVIVE_DATA_DIR", REPO_DIR / "data"))
_configured_storage = Path(os.environ.get("SURVIVE_STORAGE_PATH", "/mnt/survive"))
# Snapshot at startup — does not track live mount/unmount after the server starts.
STORAGE_MOUNTED = _configured_storage.exists()
STORAGE_PATH = _configured_storage if STORAGE_MOUNTED else DATA_DIR

# Tunable timeouts (seconds) — override via environment or survive.conf
TIMEOUT_SERVICE_CHECK = float(os.environ.get("SURVIVE_SERVICE_CHECK_TIMEOUT", "1"))
TIMEOUT_OLLAMA_LIST   = float(os.environ.get("SURVIVE_OLLAMA_LIST_TIMEOUT", "2"))
# 300, not 60: this is an IDLE timeout between stream chunks, and the one
# gap that must survive is the COLD LOAD — gemma4:12b is 7.6 GB read from a
# USB drive into RAM before the first token exists, which alone takes
# 30-80 s on a Pi 5. At 60 s the dashboard declared the AI dead exactly and
# only when the user picked the best model.
TIMEOUT_AI_CHAT       = float(os.environ.get("SURVIVE_AI_CHAT_TIMEOUT", "300"))


def _resolve_ollama_base() -> str:
    """Base URL for the Ollama API. Defaults to the local server, but
    SURVIVE_OLLAMA_HOST can point at a more powerful satellite box (an x86
    mini-PC) so the always-on Pi offloads inference. Garbage falls back to
    localhost with a log line rather than breaking startup."""
    raw = os.environ.get("SURVIVE_OLLAMA_HOST", "").strip()
    default = f"http://localhost:{PORT_OLLAMA}"
    if not raw:
        return default
    if not re.match(r"^https?://[^/\s]+$", raw.rstrip("/")):
        logging.getLogger(__name__).warning(
            "SURVIVE_OLLAMA_HOST=%r is not a valid http(s)://host[:port] URL "
            "-- falling back to %s", raw, default)
        return default
    return raw.rstrip("/")


# Whether AI runs on a remote host (affects service-check method + restart UI).
OLLAMA_BASE = _resolve_ollama_base()
OLLAMA_IS_REMOTE = OLLAMA_BASE != f"http://localhost:{PORT_OLLAMA}"

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


# ── Admin authentication (anonymous-guest model) ──────────────────────────────
# Guests never log in: anonymous access is read-only. Auth exists ONLY to
# elevate to admin (one password). Admin unlocks the Update button, service
# restarts, and future write features. Fail CLOSED: with no password set, admin
# endpoints are refused — never silently open.
ADMIN_PASSWORD_FILE = Path(os.environ.get(
    "SURVIVE_ADMIN_PASSWORD_FILE",
    str(Path(__file__).parent.parent / "config" / ".admin_password"),
))
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
            return redirect(url_for("login", next=request.path))
        return func(*args, **kwargs)
    return wrapper


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


# ── AI retrieval (RAG over the local Kiwix library) ─────────────────────────────
# Timeout for internal Kiwix calls; retrieval must never eat the chat budget.
TIMEOUT_KIWIX = TIMEOUT_OLLAMA_LIST
_TAG_RE = re.compile(r"<[^>]+>")
_SCRIPT_STYLE_RE = re.compile(r"<script.*?</script>|<style.*?</style>", re.S | re.I)


def _strip_html(text: str) -> str:
    """Remove tags (e.g. Kiwix <b> match highlights) and collapse whitespace."""
    text = _SCRIPT_STYLE_RE.sub(" ", text)
    text = _TAG_RE.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def _kiwix_path(link: str) -> str:
    """Return just the path(+query/fragment) portion of a Kiwix result link,
    so we can rebuild it against the caller's host regardless of what host
    kiwix-serve embedded."""
    match = re.match(r"^https?://[^/]+(/.*)$", link or "")
    return match.group(1) if match else (link or "")


def _kiwix_search(query: str, limit: int = 3) -> list:
    """Full-text search the local Kiwix library. Returns a list of
    {title, path, snippet}. Never raises — returns [] on any failure
    (Kiwix down, empty library, malformed XML, unexpected HTTP body)."""
    try:
        url = (
            f"http://localhost:{PORT_KIWIX}/search"
            f"?pattern={quote(query)}&pageLength={int(limit)}&format=xml"
        )
        with urllib.request.urlopen(url, timeout=TIMEOUT_KIWIX) as resp:
            raw = resp.read()
        root = ET.fromstring(raw)
        results = []
        # OpenSearch/RSS: channel/item{title,link,description}
        for item in root.iter("item"):
            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            desc = _strip_html(item.findtext("description") or "")
            if title and link:
                results.append({
                    "title": title,
                    "path": _kiwix_path(link),
                    "snippet": desc,
                })
            if len(results) >= limit:
                break
        return results
    except (OSError, ET.ParseError, ValueError) as exc:
        logging.debug("Kiwix search failed for %r: %s", query, exc)
        return []


def _fetch_article_text(path: str, fallback: str = "", max_chars: int = 2000) -> str:
    """Fetch a Kiwix article and return plain text (first max_chars chars).
    Returns the fallback snippet on any failure or if extraction is empty."""
    try:
        with urllib.request.urlopen(
            f"http://localhost:{PORT_KIWIX}{path}", timeout=TIMEOUT_KIWIX
        ) as resp:
            html = resp.read().decode("utf-8", errors="replace")
        text = _strip_html(html)
        return text[:max_chars] if text else fallback
    except (OSError, ValueError) as exc:
        logging.debug("Kiwix article fetch failed for %s: %s", path, exc)
        return fallback


def _retrieve_context(query: str) -> list:
    """Search Kiwix and the local document index, enriching Kiwix hits with
    article text fetched concurrently. Returns [{title, path|url, snippet,
    text}]; empty list if nothing found anywhere."""
    articles = _kiwix_search(query)
    doc_chunks = _query_doc_index(query, limit=2, relaxed=True) or []
    if doc_chunks:
        # Share the num_ctx budget: 2 Kiwix articles + 2 doc chunks instead of 3+0.
        articles = articles[:2]
    if articles:
        with ThreadPoolExecutor(max_workers=len(articles)) as ex:
            texts = list(ex.map(
                lambda a: _fetch_article_text(a["path"], fallback=a["snippet"]),
                articles,
            ))
        for article, text in zip(articles, texts):
            article["text"] = text
    for chunk in doc_chunks:
        page_note = f" (p.{chunk['page']})" if chunk.get("page") else ""
        articles.append({
            "title": f"{chunk['title']}{page_note}",
            # Dashboard-relative link into the actual document; browsers'
            # built-in PDF viewers honour the #page= anchor.
            "url": f"/serve/{chunk['path']}"
                   + (f"#page={chunk['page']}" if chunk.get("page") else ""),
            "snippet": chunk["snippet"],
            "text": chunk["snippet"],
        })
    # Medical questions are a top use case — add at most one drug-label hit so
    # the AI can cite dosage/warnings from the offline FDA data.
    drug_hits = _query_drug_index(query, mode="drug", limit=1) or []
    for d in drug_hits[:1]:
        name = d.get("brand_name") or d.get("generic_name") or "drug"
        detail = _drug_by_id(d["id"]) or {}
        excerpt = " ".join(str(detail.get(f, "")) for f in
                           ("purpose", "indications", "dosage", "warnings"))[:1200]
        if excerpt.strip():
            articles.append({
                "title": f"Drug label: {name}",
                "url": f"/drugs/{d['id']}",
                "snippet": excerpt[:300],
                "text": excerpt,
            })
    return articles


_BASE_SYSTEM_PROMPT = (
    "You are a survival expert assistant running offline on a Raspberry Pi. "
    "Help with practical survival, medicine, food, water, shelter, energy, "
    "and skills. Be concise and practical. No internet available."
)


def _build_rag_prompt(articles: list) -> str:
    """Compose the system prompt, injecting retrieved reference excerpts."""
    if not articles:
        return (
            _BASE_SYSTEM_PROMPT
            + " No reference articles were found for this question in the "
            "local library; say so if you are unsure rather than guessing."
        )
    lines = [_BASE_SYSTEM_PROMPT, "", "Reference excerpts from the offline library:"]
    for i, article in enumerate(articles, 1):
        lines.append(f"[{i}] {article['title']}: {article.get('text', article['snippet'])}")
    lines.append(
        "Answer using these excerpts where relevant and mention which source "
        "numbers you used."
    )
    return "\n".join(lines)


def _validate_history(raw) -> tuple:
    """Validate and budget client-supplied conversation history.

    Returns (clean_history, error). The role whitelist is security-critical:
    without it a crafted request injects {"role": "system", ...} and overrides
    the survival system prompt. The char budget keeps history + RAG excerpts
    + question inside the survive model's num_ctx 4096 (~16k chars)."""
    if not isinstance(raw, list):
        return [], "history must be a list"
    clean = []
    for turn in raw[-8:]:  # cap turn count first
        if not isinstance(turn, dict):
            return [], "invalid history entry"
        role = turn.get("role")
        content = turn.get("content")
        if role not in ("user", "assistant") or not isinstance(content, str):
            return [], "invalid history entry"
        clean.append({"role": role, "content": content[:2000]})
    # Char budget: walk from the newest turn backwards, keep what fits.
    total = 0
    budgeted = []
    for turn in reversed(clean):
        total += len(turn["content"])
        if total > 3000:
            break
        budgeted.append(turn)
    return list(reversed(budgeted)), None


def _sources_for(articles: list, req_host: str) -> list:
    """Build clickable source links for the response. Kiwix hits get absolute
    URLs rooted at the caller's host (so they work over LAN, localhost, or
    survive.local); document hits carry a ready-made dashboard-relative URL."""
    return [
        {"title": a["title"],
         "url": a.get("url") or f"http://{req_host}:{PORT_KIWIX}{a['path']}"}
        for a in articles
    ]


# ── Search index (SQLite FTS5) ──────────────────────────────────────────────────
# A background thread indexes every content filename so /search answers in
# milliseconds instead of re-walking the 800 GB tree on each request. The DB is
# a hidden file next to the Kiwix library (dotfiles are skipped by _safe_walk).
INDEX_DB = STORAGE_PATH / ".search_index.db"
# Full-text index of the text INSIDE PDFs/EPUBs, built offline by
# scripts/index_documents.py (never by the web workers — extraction is
# CPU-heavy). The server only reads it.
CONTENT_INDEX_DB = STORAGE_PATH / ".content_index.db"
_index_lock = threading.Lock()          # serialises rebuilds within one process
_index_building = threading.Event()      # dedupes on-demand builds


def _index_connect():
    return sqlite3.connect(str(INDEX_DB), timeout=30)


def _fts_sanitize(query: str) -> str:
    """Turn raw user input into a safe FTS5 prefix query — strips quotes and
    operators that would otherwise be a syntax error or injection vector.
    Returns '' when nothing searchable remains."""
    tokens = re.sub(r"[^a-zA-Z0-9 -]", " ", query).split()
    if not tokens:
        return ""
    return " ".join(tokens[:-1] + [tokens[-1] + "*"])


def _query_doc_index(query: str, limit: int = 5, relaxed: bool = False):
    """Full-text search inside PDFs/EPUBs via the content index. Returns
    [{title, path, page, snippet}], None if the index has not been built yet,
    or [] on empty/invalid queries. Never raises.

    FTS5's implicit AND requires EVERY word to appear in a chunk — right for
    keyword searches, wrong for natural-language questions ("how do I apply a
    tourniquet" never matches a 1500-char chunk on all six words). With
    relaxed=True (used by RAG retrieval), an empty strict result falls back to
    OR-ing the content words (length ≥ 4, drops stopwords like "how"/"the")."""
    if not CONTENT_INDEX_DB.exists():
        return None
    fts = _fts_sanitize(query)
    if not fts:
        return []
    rows = _run_doc_query(fts, limit)
    if rows is None:
        return None
    if not rows and relaxed:
        words = [w for w in re.sub(r"[^a-zA-Z0-9 -]", " ", query).split()
                 if len(w) >= 4]
        if words:
            rows = _run_doc_query(" OR ".join(f"{w}*" for w in words), limit)
            if rows is None:
                return None
    return [
        {"title": title, "path": path, "page": page, "snippet": snippet}
        for (title, path, page, snippet) in rows
    ]


def _run_doc_query(fts: str, limit: int):
    """Execute one FTS query against the content index; row tuples, None on
    missing table, [] on FTS errors."""
    conn = sqlite3.connect(str(CONTENT_INDEX_DB), timeout=30)
    try:
        rows = conn.execute(
            "SELECT title, path, page, snippet(chunks, 0, '', '', '…', 12) "
            "FROM chunks WHERE chunks MATCH ? LIMIT ?",
            (fts, limit),
        ).fetchall()
    except sqlite3.OperationalError as exc:
        if "no such table" in str(exc):
            return None  # half-built index → treat as absent
        logging.debug("doc index query failed: %s", exc)
        return []
    finally:
        conn.close()
    return rows


# ── Offline drug reference ────────────────────────────────────────────────────
# Built offline by scripts/build_drug_index.py from openFDA labels. The server
# only reads it; every query follows the _query_doc_index contract (None if
# absent, [] on bad input, never raises).
DRUG_INDEX_DB = STORAGE_PATH / ".drug_index.db"
_DRUG_COLUMNS = ("id", "brand_name", "generic_name", "active_ingredient",
                 "purpose", "indications", "warnings", "dosage",
                 "contraindications", "interactions", "otc_or_rx",
                 "effective_time")


def _drug_connect():
    conn = sqlite3.connect(str(DRUG_INDEX_DB), timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def _query_drug_index(query: str, mode: str = "drug", limit: int = 30):
    """Search the drug index. mode='drug' searches names/ingredients,
    mode='symptom' searches purpose/indications. Returns a list of summary
    dicts, None if the index is absent, [] on empty/invalid queries."""
    if not DRUG_INDEX_DB.exists():
        return None
    fts = _fts_sanitize(query)
    if not fts:
        return []
    table = "drug_uses" if mode == "symptom" else "drug_names"
    conn = _drug_connect()
    try:
        rows = conn.execute(
            f"SELECT d.id, d.brand_name, d.generic_name, d.purpose, d.otc_or_rx "
            f"FROM {table} t JOIN drugs d ON d.id = t.rowid "
            f"WHERE {table} MATCH ? LIMIT ?", (fts, limit),
        ).fetchall()
    except sqlite3.OperationalError as exc:
        if "no such table" in str(exc):
            return None
        logging.debug("drug index query failed: %s", exc)
        return []
    finally:
        conn.close()
    return [dict(r) for r in rows]


def _drug_by_id(drug_id: int):
    """Full label record for one drug id, or None."""
    if not DRUG_INDEX_DB.exists():
        return None
    conn = _drug_connect()
    try:
        row = conn.execute("SELECT * FROM drugs WHERE id = ?", (drug_id,)).fetchone()
    except sqlite3.OperationalError:
        return None
    finally:
        conn.close()
    return dict(row) if row else None


def _rebuild_search_index() -> int:
    """(Re)build the FTS5 filename index via an atomic temp-table swap so
    readers never observe a half-built index. Returns the file count."""
    with _index_lock:
        conn = _index_connect()
        conn.isolation_level = None  # explicit transaction control below
        try:
            conn.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
            conn.execute("DROP TABLE IF EXISTS files_new")
            conn.execute(
                "CREATE VIRTUAL TABLE files_new USING fts5("
                "name, path UNINDEXED, ext UNINDEXED, size_mb UNINDEXED, "
                "tokenize = \"unicode61 tokenchars '-'\")"
            )
            count, batch = 0, []
            conn.execute("BEGIN")
            for f in _safe_walk(STORAGE_PATH):
                try:
                    size_mb = round(f.stat().st_size / (1024**2), 1)
                except OSError:
                    size_mb = 0
                # Store a space-normalised name so "doctor" matches
                # "Where_There_Is_No_Doctor"; keep the real path for display.
                searchable = re.sub(r"[_.]", " ", f.stem)
                batch.append((searchable, str(f.relative_to(STORAGE_PATH)),
                              f.suffix.lower().lstrip("."), size_mb))
                if len(batch) >= 500:
                    conn.executemany("INSERT INTO files_new VALUES (?,?,?,?)", batch)
                    count += len(batch)
                    batch = []
            if batch:
                conn.executemany("INSERT INTO files_new VALUES (?,?,?,?)", batch)
                count += len(batch)
            conn.execute("COMMIT")
            # Brief exclusive swap — readers block only for this step.
            conn.execute("BEGIN IMMEDIATE")
            conn.execute("DROP TABLE IF EXISTS files")
            conn.execute("ALTER TABLE files_new RENAME TO files")
            conn.execute("INSERT OR REPLACE INTO meta VALUES ('built_at', ?)",
                         (datetime.now().isoformat(),))
            conn.execute("INSERT OR REPLACE INTO meta VALUES ('count', ?)", (str(count),))
            conn.execute("COMMIT")
            return count
        finally:
            conn.close()


def _query_search_index(query: str, limit: int = 50):
    """Return file results from the FTS index, or None if the index is not yet
    built (so the caller can fall back to the live walk). Never raises."""
    if not INDEX_DB.exists():
        return None
    fts = _fts_sanitize(query)
    if not fts:
        return []
    conn = _index_connect()
    try:
        rows = conn.execute(
            "SELECT name, path, ext, size_mb FROM files WHERE files MATCH ? LIMIT ?",
            (fts, limit),
        ).fetchall()
    except sqlite3.OperationalError as exc:
        if "no such table" in str(exc):
            return None  # index half-built / missing table → fall back
        logging.debug("search index query failed: %s", exc)
        return []
    finally:
        conn.close()
    return [
        {"name": Path(path).stem, "filename": Path(path).name,
         "ext": ext, "path": path, "size_mb": size_mb}
        for (_name, path, ext, size_mb) in rows
    ]


def _index_meta() -> dict:
    """Return {built_at, count} for the freshness footer; safe defaults if
    the index does not exist yet."""
    if not INDEX_DB.exists():
        return {"built_at": None, "count": 0}
    conn = _index_connect()
    try:
        rows = dict(conn.execute("SELECT key, value FROM meta").fetchall())
    except sqlite3.OperationalError:
        return {"built_at": None, "count": 0}
    finally:
        conn.close()
    return {"built_at": rows.get("built_at"), "count": int(rows.get("count") or 0)}


def _trigger_index_build() -> None:
    """Kick off a one-shot background rebuild (deduped) without blocking the
    request that triggered it."""
    if _index_building.is_set():
        return

    def _run():
        _index_building.set()
        try:
            _rebuild_search_index()
        except (sqlite3.Error, OSError):
            logging.exception("on-demand index build failed")
        finally:
            _index_building.clear()

    threading.Thread(target=_run, daemon=True).start()


def _index_refresher() -> None:
    """Daemon loop: build shortly after boot, then refresh every 6 hours.
    The per-PID stagger keeps the two gunicorn workers from colliding at boot."""
    time.sleep(60 + (os.getpid() % 30))
    while True:
        try:
            total = _rebuild_search_index()
            logging.info("search index rebuilt: %d files", total)
        except (sqlite3.Error, OSError):
            logging.exception("scheduled index rebuild failed")
        time.sleep(6 * 3600)


def _search_walk(query: str) -> list:
    """Correctness backstop: live filename walk, used until the index exists."""
    results = []
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
    except OSError as exc:
        logging.warning("search walk failed: %s", exc)
    return results


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


@app.route("/apps")
def apps_page():
    """List the sideloadable installers under $STORAGE/apps for hotspot guests."""
    apps_root = STORAGE_PATH / "apps"
    groups = {"android": [], "windows": []}
    for platform, items in groups.items():
        pdir = apps_root / platform
        if not pdir.exists():
            continue
        for f in sorted(_safe_walk(pdir), key=lambda p: p.name):
            try:
                size_mb = round(f.stat().st_size / (1024 * 1024), 1)
            except OSError:
                size_mb = 0
            items.append({
                "name": f.name,
                "path": str(f.relative_to(STORAGE_PATH)),
                "size_mb": size_mb,
            })
    have_any = any(groups.values())
    return render_template("apps.html", groups=groups, have_any=have_any)


# ── Offline drug reference ────────────────────────────────────────────────────
def _drug_disclaimer_ok() -> bool:
    return bool(session.get("drug_disclaimer"))


@app.route("/drugs/disclaimer", methods=["POST"])
def drugs_accept_disclaimer():
    """Record acceptance of the not-medical-advice notice in the session, so it
    also gates the API and works inside the iOS captive mini-browser."""
    session["drug_disclaimer"] = True
    dest = request.form.get("next", "/drugs")
    if not dest.startswith("/") or dest.startswith("//"):
        dest = "/drugs"
    return redirect(dest)


@app.route("/drugs")
def drugs_page():
    """Search the offline drug reference by drug name or by symptom."""
    if not _drug_disclaimer_ok():
        return render_template("drug_disclaimer.html", next="/drugs")
    query = request.args.get("q", "").strip()[:100]
    mode = "symptom" if request.args.get("mode") == "symptom" else "drug"
    results = _query_drug_index(query, mode=mode) if query else []
    return render_template(
        "drugs.html", query=query, mode=mode, results=results,
        index_missing=(results is None),
        results_list=(results or []),
    )


@app.route("/drugs/<int:drug_id>")
def drug_detail(drug_id):
    if not _drug_disclaimer_ok():
        return render_template("drug_disclaimer.html", next=f"/drugs/{drug_id}")
    drug = _drug_by_id(drug_id)
    if drug is None:
        return render_template("error.html", code=404, message="Drug not found"), 404
    return render_template("drug_detail.html", drug=drug)


@app.route("/api/drugs/interactions")
def api_drug_interactions():
    """Honest label-text interaction check: search drug A's interaction/warning
    text for drug B's name and vice versa. This is a TEXT MATCH against FDA
    labels, NOT a clinical interaction database — the UI says so plainly."""
    if not _drug_disclaimer_ok():
        return jsonify({"error": "Accept the disclaimer first"}), 403
    try:
        a_id = int(request.args.get("a", ""))
    except (TypeError, ValueError):
        return jsonify({"error": "Missing drug id 'a'"}), 400
    b_name = request.args.get("b", "").strip()[:100]
    if not b_name:
        return jsonify({"error": "Missing drug name 'b'"}), 400
    drug_a = _drug_by_id(a_id)
    if drug_a is None:
        return jsonify({"error": "Drug not found"}), 404

    b_lower = b_name.lower()
    haystack = " ".join(str(drug_a.get(f, "")) for f in
                        ("interactions", "warnings", "contraindications")).lower()
    a_mentions_b = b_lower in haystack
    # And the reverse: does any label for drug B mention drug A's generic?
    b_mentions_a = False
    a_generic = (drug_a.get("generic_name") or "").lower()
    if a_generic:
        b_hits = _query_drug_index(b_name, mode="drug", limit=5) or []
        for hit in b_hits:
            rec = _drug_by_id(hit["id"])
            if rec and a_generic in " ".join(
                    str(rec.get(f, "")) for f in
                    ("interactions", "warnings", "contraindications")).lower():
                b_mentions_a = True
                break
    return jsonify({
        "a": {"id": a_id, "name": drug_a.get("brand_name") or drug_a.get("generic_name")},
        "b": b_name,
        "a_label_mentions_b": a_mentions_b,
        "b_label_mentions_a": b_mentions_a,
        "note": "Label-text match only — not a clinical interaction checker. "
                "Consult a pharmacist or doctor.",
    })


@app.route("/search")
@limiter.limit("30 per minute")
def search():
    query = request.args.get("q", "").strip()[:200]  # cap at 200 chars to prevent ReDoS
    results = []
    article_results = []
    doc_results = []
    note_results = []

    if query and len(query) >= 2:
        indexed = _query_search_index(query)
        if indexed is None:
            # Index not ready yet — serve via the live walk this once and
            # kick off a background build for next time.
            results = _search_walk(query)
            _trigger_index_build()
        else:
            results = indexed
        # Second section: full-text hits inside Kiwix articles (best-effort).
        article_results = _kiwix_search(query, limit=5)
        # Third section: full-text hits inside local PDFs/EPUBs.
        doc_results = _query_doc_index(query) or []
        # Fourth: the shared notebook.
        note_results = _search_notes(query)

    meta = _index_meta()
    return render_template(
        "search.html",
        query=query,
        results=results,
        article_results=article_results,
        doc_results=doc_results,
        note_results=note_results,
        categories=CATEGORIES,
        index_count=meta["count"],
        index_built_at=meta["built_at"],
    )


@app.route("/ai")
def ai_page():
    ai_running = _ollama_alive()
    models = []
    if ai_running:
        try:
            with urllib.request.urlopen(
                f"{OLLAMA_BASE}/api/tags", timeout=TIMEOUT_OLLAMA_LIST
            ) as r:
                data = json.loads(r.read())
                models = [m["name"] for m in data.get("models", [])]
        except (OSError, json.JSONDecodeError) as e:
            logging.debug("Could not fetch Ollama model list: %s", e)
    return render_template("ai.html", ai_running=ai_running, models=models, categories=CATEGORIES)


@app.route("/api/ai/chat", methods=["POST"])
@csrf.exempt
@limiter.limit("5 per minute")
# Each early return is a distinct client-facing error contract (415/400/404/502);
# collapsing them would obscure which failure the caller actually hit.
# pylint: disable=too-many-return-statements
def ai_chat():
    """Retrieval-augmented, streaming proxy to the local Ollama API.

    Before calling Ollama, the user's question is used to full-text search the
    local Kiwix library; the top article excerpts are injected into the system
    prompt (RAG) and returned as a `sources` list. The Ollama completion is
    streamed back as newline-delimited JSON (application/x-ndjson):

        {"sources": [...]}      # always first
        {"delta": "..."}        # zero or more token chunks
        {"done": true, "model": "..."}

    Errors detected BEFORE streaming starts keep real HTTP status codes and a
    JSON body (415/400/502). A failure mid-stream is emitted as an
    {"error": ...} line, since the status line is already committed.
    """
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

    history, history_error = _validate_history(data.get("history", []))
    if history_error:
        return jsonify({"error": history_error}), 400

    message = str(data["message"])[:4096]  # bound message length to one context window

    # RAG retrieval (best-effort — never blocks the answer if Kiwix is down).
    # Retrieval uses ONLY the current message — mixing in history degrades
    # full-text search precision.
    articles = _retrieve_context(message)
    sources = _sources_for(articles, request.host.split(":")[0])
    system_prompt = _build_rag_prompt(articles)

    payload = json.dumps({
        "model": model,
        "messages": (
            [{"role": "system", "content": system_prompt}]
            + history
            + [{"role": "user", "content": message}]
        ),
        "stream": True,
    }).encode()
    req = urllib.request.Request(
        f"{OLLAMA_BASE}/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
    )

    # Open the upstream connection now so a dead/refusing Ollama yields a real
    # 502 with a JSON body, before any streaming headers are committed.
    try:
        # pylint: disable=consider-using-with
        upstream = urllib.request.urlopen(req, timeout=TIMEOUT_AI_CHAT)
    except urllib.error.HTTPError as exc:
        # Ollama is reachable but rejected the request. Reporting this as
        # "service unavailable" sends users hunting a dead service when the
        # real cause is usually a model that is not installed.
        detail = ""
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:200]
        except OSError:
            pass
        logging.warning("Ollama rejected the request (%s): %s", exc.code, detail)
        if exc.code == 404:
            return jsonify({"error": (
                f"Model '{model}' is not installed. Available models are listed "
                "in the dropdown; install more with: bash ai/setup_ollama.sh setup"
            )}), 404
        return jsonify({"error": f"AI service error (HTTP {exc.code})"}), 502
    except (OSError, json.JSONDecodeError):
        logging.exception("AI chat proxy error (connect)")
        return jsonify({"error": "AI service unavailable — is Ollama running? "
                                 "Check: systemctl status ollama"}), 502

    def generate():
        # With streaming, TIMEOUT_AI_CHAT is a per-read idle timeout, not a
        # total-duration cap, so long answers from slow models are not truncated.
        yield json.dumps({"sources": sources}) + "\n"
        try:
            for raw_line in upstream:
                if not raw_line.strip():
                    continue
                chunk = json.loads(raw_line)
                piece = chunk.get("message", {}).get("content", "")
                if piece:
                    yield json.dumps({"delta": piece}) + "\n"
                if chunk.get("done"):
                    yield json.dumps({"done": True, "model": model}) + "\n"
                    return
        except (OSError, json.JSONDecodeError):
            logging.exception("AI chat proxy error (stream)")
            yield json.dumps({"error": "stream interrupted"}) + "\n"
        finally:
            # Closing the upstream tells Ollama to stop generating when the
            # browser disconnects, so the Pi's CPU isn't wasted on a dead read.
            upstream.close()

    return Response(
        stream_with_context(generate()),
        mimetype="application/x-ndjson",
        headers={"X-Accel-Buffering": "no"},
    )


# ── Shared helpers for the write features ─────────────────────────────────────
def _require_json():
    """Return an error response unless the request carries a JSON body.
    Same CSRF defence as /api/ai/chat: browsers cannot send application/json
    cross-origin without a CORS preflight."""
    if (request.content_type or "").split(";")[0].strip() != "application/json":
        return jsonify({"error": "Content-Type must be application/json"}), 415
    return None


def _free_bytes() -> int:
    try:
        return shutil.disk_usage(str(STORAGE_PATH)).free
    except OSError:
        return 0


# Downloads and uploads must never fill the drive completely: Kiwix needs
# scratch space and a full disk corrupts in-flight ZIMs.
FREE_SPACE_MARGIN = 10 * 1024 ** 3


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


# ── Offline maps: viewer + saved pins ─────────────────────────────────────────
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
    values here; _security_headers uses setdefault so these win."""
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; "
        "worker-src 'self' blob:; child-src blob:; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; connect-src 'self' blob:; font-src 'self'; "
        "object-src 'none'; frame-ancestors 'none';")
    resp.headers["Permissions-Policy"] = "geolocation=(self), microphone=(), camera=()"
    return resp


@app.route("/maps")
def maps_page():
    """Offline street map with saved pins (MapLibre + PMTiles, no tile server)."""
    assets = _map_assets()
    resp = make_response(render_template(
        "maps.html", assets=assets, pins=_pins_all(),
        icons=textutils.PIN_ICONS, colors=textutils.PIN_COLORS,
        map_region=os.environ.get("MAP_REGION", ""),
    ))
    return _relax_map_headers(resp)


@app.route("/api/map/assets")
def api_map_assets():
    return jsonify(_map_assets())


@app.route("/api/map/pins", methods=["GET"])
def api_pins_list():
    return jsonify({"pins": _pins_all()})


@app.route("/api/map/pins", methods=["POST"])
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


@app.route("/api/map/pins/<int:pin_id>", methods=["PUT", "DELETE"])
@csrf.exempt
@limiter.limit("60 per minute")
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


@app.route("/api/map/pins/export")
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


@app.route("/api/map/pins/import", methods=["POST"])
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



# ── Library / content explorer: browse the Kiwix catalog, download, rescan ───
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


@app.route("/content")
def content_page():
    """Browse the Kiwix catalog, see what is on the drive, start downloads."""
    return render_template(
        "content.html", local=_local_zims(), jobs=_content_jobs(),
        categories_list=textutils.KIWIX_CATEGORIES,
        online=_compute_connectivity()["online"],
    )


@app.route("/api/content/catalog")
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


@app.route("/api/content/languages")
@limiter.limit("10 per minute")
def api_content_languages():
    try:
        langs = textutils.parse_kiwix_languages(_fetch_catalog("/languages"))
    except (OSError, ET.ParseError, ValueError):
        return jsonify({"error": "Could not reach library.kiwix.org"}), 503
    return jsonify({"languages": langs})


@app.route("/api/content/local")
def api_content_local():
    return jsonify({"zims": _local_zims(), "free_gb": round(_free_bytes() / 1024 ** 3, 1)})


@app.route("/api/content/jobs")
def api_content_jobs():
    return jsonify(_content_jobs())


@app.route("/api/content/download", methods=["POST"])
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


@app.route("/api/content/rescan", methods=["POST"])
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



# ── Notes: shared markdown notebook on the drive ─────────────────────────────
NOTES_DIR = STORAGE_PATH / "notes"
_NOTE_MAX_BYTES = 512 * 1024
_NOTES_MAX = 5000


def _note_path(slug: str):
    """Path for a slug, or None if the slug is not well-formed."""
    if not textutils.SLUG_PATTERN.match(slug or ""):
        return None
    return NOTES_DIR / f"{slug}.md"


def _note_read(slug: str):
    path = _note_path(slug)
    if not path or not path.is_file():
        return None
    try:
        body = path.read_text(encoding="utf-8", errors="replace")
        st = path.stat()
    except OSError:
        return None
    return {"slug": slug, "body": body, "title": textutils.first_heading(body) or slug,
            "modified": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M"),
            "size": st.st_size}


def _list_notes(query: str = "") -> list:
    """All notes, newest first; `query` filters on title/body (case-insensitive)."""
    notes = []
    if not NOTES_DIR.is_dir():
        return notes
    needle = query.strip().lower()
    for path in NOTES_DIR.glob("*.md"):
        slug = path.stem
        if not textutils.SLUG_PATTERN.match(slug):
            continue
        try:
            body = path.read_text(encoding="utf-8", errors="replace")
            mtime = path.stat().st_mtime
        except OSError:
            continue
        if needle and needle not in body.lower() and needle not in slug:
            continue
        lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
        snippet = ""
        if needle:
            for ln in lines:
                if needle in ln.lower():
                    snippet = ln[:160]
                    break
        if not snippet:
            snippet = " ".join(lines[1:3])[:160] if len(lines) > 1 else ""
        notes.append({"slug": slug, "title": textutils.first_heading(body) or slug,
                      "snippet": snippet, "mtime": mtime,
                      "modified": datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M")})
    notes.sort(key=lambda n: n["mtime"], reverse=True)
    return notes


def _unique_slug(base: str) -> str:
    slug = base
    n = 2
    while (NOTES_DIR / f"{slug}.md").exists():
        slug = f"{base[:74]}-{n}"
        n += 1
    return slug


@app.route("/notes")
def notes_page():
    query = request.args.get("q", "").strip()[:100]
    return render_template("notes.html", notes=_list_notes(query), query=query)


@app.route("/notes/new")
def note_new():
    return render_template("note_edit.html", note=None, body="")


@app.route("/notes/<slug>")
def note_view(slug):
    note = _note_read(slug)
    if not note:
        abort(404)
    if request.args.get("edit"):
        return render_template("note_edit.html", note=note, body=note["body"])
    return render_template("note_view.html", note=note,
                           rendered=textutils.render_markdown(note["body"]))


@app.route("/notes/save", methods=["POST"])
@limiter.limit("30 per minute")
def note_save():
    """Create or update a note. CSRF-protected HTML form; open to the LAN —
    the notebook is a shared pad for whoever is on the hotspot."""
    body = request.form.get("body", "").replace("\r\n", "\n")
    if len(body.encode("utf-8")) > _NOTE_MAX_BYTES:
        return render_template("error.html", code=413, message="Note too long (512 KB max)"), 413
    if not body.strip():
        return redirect(url_for("notes_page"))
    slug = request.form.get("slug", "").strip()
    try:
        NOTES_DIR.mkdir(parents=True, exist_ok=True)
        if slug:
            path = _note_path(slug)
            if not path:
                abort(400)
        else:
            if sum(1 for _ in NOTES_DIR.glob("*.md")) >= _NOTES_MAX:
                return render_template("error.html", code=507, message="Too many notes"), 507
            slug = _unique_slug(textutils.slugify(textutils.first_heading(body)))
            path = NOTES_DIR / f"{slug}.md"
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(body, encoding="utf-8")
        tmp.replace(path)
    except OSError as exc:
        logging.warning("note save failed: %s", exc)
        return render_template("error.html", code=500, message="Could not save the note"), 500
    return redirect(url_for("note_view", slug=slug))


@app.route("/notes/<slug>/delete", methods=["POST"])
@_admin_required
def note_delete(slug):
    path = _note_path(slug)
    if not path or not path.is_file():
        abort(404)
    try:
        path.unlink()
    except OSError:
        abort(500)
    return redirect(url_for("notes_page"))


def _search_notes(query: str, limit: int = 10) -> list:
    return _list_notes(query)[:limit]


# ── Shared files: drop zone for personal documents ───────────────────────────
SHARED_DIR = STORAGE_PATH / "shared"
_SHARED_MAX_FILES = 20000


def _shared_listing() -> list:
    items = []
    if not SHARED_DIR.is_dir():
        return items
    for entry in SHARED_DIR.iterdir():
        if entry.name.startswith("."):
            continue
        try:
            st = entry.stat()
        except OSError:
            continue
        items.append({
            "name": entry.name, "is_dir": entry.is_dir(),
            "size_mb": round(st.st_size / 1024 ** 2, 2) if entry.is_file() else None,
            "modified": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M"),
            "ext": entry.suffix.lower().lstrip(".") if entry.is_file() else "",
        })
    items.sort(key=lambda i: (not i["is_dir"], i["name"].lower()))
    return items


@app.route("/shared")
def shared_page():
    return render_template("shared.html", items=_shared_listing(),
                           free_gb=round(_free_bytes() / 1024 ** 3, 1),
                           message=request.args.get("m", "")[:200])


@app.route("/shared/upload", methods=["POST"])
@limiter.limit("20 per minute")
def shared_upload():
    """Multipart upload into $STORAGE/shared. Open to the LAN (CSRF form);
    deletion is admin-only. Streams to disk, keeps the free-space margin."""
    files = [f for f in request.files.getlist("files") if f and f.filename]
    if not files:
        return redirect(url_for("shared_page", m="Pick at least one file."))
    declared = request.content_length or 0
    if _free_bytes() - declared < FREE_SPACE_MARGIN:
        return redirect(url_for("shared_page",
                                m="Not enough free space (10 GB is always kept free)."))
    try:
        SHARED_DIR.mkdir(parents=True, exist_ok=True)
        if sum(1 for _ in SHARED_DIR.iterdir()) + len(files) > _SHARED_MAX_FILES:
            return redirect(url_for("shared_page", m="The shared folder is full."))
        saved = []
        for upload in files:
            name = secure_filename(upload.filename)[:150]
            if not name:
                continue
            dest = SHARED_DIR / name
            stem, suffix = dest.stem, dest.suffix
            n = 2
            while dest.exists():
                dest = SHARED_DIR / f"{stem}-{n}{suffix}"
                n += 1
            upload.save(str(dest))
            saved.append(dest.name)
    except OSError as exc:
        logging.warning("upload failed: %s", exc)
        return redirect(url_for("shared_page", m="Upload failed — is the drive full?"))
    note = f"Saved {len(saved)} file(s)." if saved else "Nothing saved — bad filename?"
    return redirect(url_for("shared_page", m=note))


@app.route("/shared/delete", methods=["POST"])
@_admin_required
def shared_delete():
    name = secure_filename(request.form.get("name", ""))
    target = SHARED_DIR / name
    if not name or not target.is_file():
        abort(404)
    try:
        target.unlink()
    except OSError:
        abort(500)
    return redirect(url_for("shared_page", m=f"Deleted {name}."))



# ── Comms: Morse tool, Meshtastic web client, user-imported repeater lists ───
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


@app.route("/comms")
def comms_page():
    mesh_installed = (COMMS_DIR / "meshtastic-web" / "index.html").exists()
    return render_template(
        "comms.html",
        mesh_installed=mesh_installed,
        mesh_running=check_service(PORT_MESHTASTIC) if mesh_installed else False,
        repeater_count=len(_repeaters_cache.get(_compute_repeaters)),
        repeater_files=[p.name for p in _repeater_files()],
    )


@app.route("/comms/morse")
def comms_morse():
    return render_template("morse.html")


@app.route("/comms/repeaters")
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


@app.route("/comms/repeaters/upload", methods=["POST"])
@_admin_required
def comms_repeaters_upload():
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return redirect(url_for("comms_repeaters", m="Pick a CSV file first."))
    name = secure_filename(upload.filename)[:120]
    if not name.lower().endswith(".csv"):
        return redirect(url_for("comms_repeaters", m="Only .csv files are accepted."))
    try:
        REPEATERS_DIR.mkdir(parents=True, exist_ok=True)
        upload.save(str(REPEATERS_DIR / name))
    except OSError:
        return redirect(url_for("comms_repeaters", m="Could not save the file."))
    _repeaters_cache._ts = 0.0  # pylint: disable=protected-access
    rows = textutils.parse_repeater_csv(
        (REPEATERS_DIR / name).read_text(encoding="utf-8-sig", errors="replace"), source=name)
    return redirect(url_for("comms_repeaters", m=f"Imported {name}: {len(rows)} repeaters."))


@app.route("/comms/repeaters/delete", methods=["POST"])
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
    _repeaters_cache._ts = 0.0  # pylint: disable=protected-access
    return redirect(url_for("comms_repeaters", m=f"Removed {name}."))



# ── Nightly auto-update schedule (systemd timer) ─────────────────────────────
UPDATE_TIMER = "survive-content-update.timer"


def _timer_state() -> dict:
    """Ask systemd about the nightly timer. No sudo needed to read."""
    state = {"available": False, "enabled": False, "active": False,
             "next_run": None, "last_run": None}
    systemctl = shutil.which("systemctl")
    if not systemctl:
        return state
    try:
        out = subprocess.run(
            [systemctl, "show", UPDATE_TIMER, "--no-pager",
             "-p", "UnitFileState", "-p", "ActiveState",
             "-p", "NextElapseUSecRealtime", "-p", "LastTriggerUSec"],
            capture_output=True, text=True, timeout=4, check=False,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return state
    props = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
    if not props or props.get("UnitFileState", "") in ("", "not-found"):
        return state
    state["available"] = True
    state["enabled"] = props.get("UnitFileState") == "enabled"
    state["active"] = props.get("ActiveState") == "active"
    state["next_run"] = props.get("NextElapseUSecRealtime") or None
    state["last_run"] = props.get("LastTriggerUSec") or None
    if state["next_run"] in ("n/a", "0"):
        state["next_run"] = None
    if state["last_run"] in ("n/a", "0"):
        state["last_run"] = None
    return state


def _schedule_info() -> dict:
    info = _timer_state()
    info["time"] = os.environ.get("SURVIVE_AUTO_UPDATE_TIME", "02:30")
    try:
        cap = int(os.environ.get("SURVIVE_AUTO_UPDATE_RATE_LIMIT", "2097152") or 0)
    except ValueError:
        cap = 0
    info["rate_limit_kbps"] = cap // 1024 if cap else 0
    return info


@app.route("/api/update/schedule")
def api_update_schedule():
    return jsonify(_schedule_info())


@app.route("/api/update/schedule", methods=["POST"])
@csrf.exempt
@limiter.limit("6 per minute")
@_admin_required
def api_update_schedule_set():
    """Turn the nightly timer on or off via the sudoers-allowlisted commands."""
    err = _require_json()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    enable = bool(data.get("enabled"))
    verb = "enable" if enable else "disable"
    cmd = ["sudo", "-n", "/usr/bin/systemctl", verb, "--now", UPDATE_TIMER]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15, check=False)
    except (OSError, subprocess.SubprocessError) as exc:
        return jsonify({"error": f"Could not run systemctl: {exc}"}), 500
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()[:200]
        return jsonify({"error": "systemctl refused — run scripts/install_sudoers.sh on the Pi. "
                                 + detail, "manual": " ".join(cmd[2:])}), 500
    return jsonify(_schedule_info())



@app.route("/health")
@limiter.exempt
def health():
    """Lightweight liveness probe for systemd ExecStartPost and external checks."""
    return jsonify({"status": "ok"}), 200


# ── Login / logout ────────────────────────────────────────────────────────────
@app.route("/login", methods=["GET", "POST"])
@limiter.limit("5 per minute", methods=["POST"])
def login():
    """Elevate an anonymous guest to admin. CSRF-protected form POST."""
    if request.method == "GET":
        if is_admin():
            return redirect(url_for("index"))
        return render_template("login.html", configured=admin_configured())

    stored = _admin_hash()
    password = request.form.get("password", "")
    if not stored:
        return render_template(
            "login.html", configured=False,
            error="No admin password is set on this device."), 403
    if not check_password_hash(stored, password):
        return render_template(
            "login.html", configured=True,
            error="Incorrect password."), 401
    # Success — regenerate the session to prevent fixation, then mark admin.
    session.clear()
    session["admin"] = True
    dest = request.args.get("next", "")
    # Only allow same-site relative redirects.
    if not dest.startswith("/") or dest.startswith("//"):
        dest = url_for("index")
    return redirect(dest)


@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return redirect(url_for("index"))


# ── Captive portal ────────────────────────────────────────────────────────────
# On the hotspot, dnsmasq resolves every hostname to 10.42.0.1, so an OS
# connectivity probe reaches these routes. Answering them with anything OTHER
# than the expected success response makes the phone open its captive-portal
# sign-in window pointed at our dashboard. All are @limiter.exempt: phones poll
# these aggressively and a 429 would break portal detection.
CAPTIVE_REDIRECT = "http://10.42.0.1:8080/"

# Hostnames the OS uses for its connectivity probe — used to show a hint banner
# when the dashboard is being viewed inside the captive mini-browser.
CAPTIVE_HOSTS = frozenset({
    "connectivitycheck.gstatic.com", "clients3.google.com",
    "www.google.com", "captive.apple.com", "www.apple.com",
    "www.msftconnecttest.com", "www.msftncsi.com", "detectportal.firefox.com",
})


@app.route("/generate_204")
@app.route("/gen_204")
@limiter.exempt
def captive_android():
    """Android probes expect HTTP 204. Returning a 302 to the dashboard is what
    makes Android raise the 'Sign in to network' notification."""
    return redirect(CAPTIVE_REDIRECT, code=302)


@app.route("/hotspot-detect.html")
@app.route("/library/test/success.html")
@limiter.exempt
def captive_apple():
    """Apple expects the literal body 'Success'. Anything else opens the
    Captive Network Assistant showing our page."""
    return (
        '<!DOCTYPE html><html><head><meta http-equiv="refresh" '
        f'content="0; url={CAPTIVE_REDIRECT}"></head><body>'
        f'<a href="{CAPTIVE_REDIRECT}">Open SurviveV1</a></body></html>',
        200, {"Content-Type": "text/html"},
    )


@app.route("/ncsi.txt")
@app.route("/connecttest.txt")
@app.route("/redirect")
@limiter.exempt
def captive_windows():
    """Windows NCSI expects 'Microsoft Connect Test'/HTTP 200; a redirect
    triggers its captive-portal flow."""
    return redirect(CAPTIVE_REDIRECT, code=302)


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


_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")


def _tail_active_log():
    """Return {file, line} for the last activity line of the newest download
    log, or None. Reads only the file's tail — logs can be hundreds of MB."""
    logs_dir = STORAGE_PATH / ".logs"
    try:
        log_files = [p for p in logs_dir.iterdir() if p.is_file()] if logs_dir.exists() else []
    except OSError:
        return None
    if not log_files:
        return None
    newest = max(log_files, key=lambda p: p.stat().st_mtime)
    try:
        size = newest.stat().st_size
        with open(newest, "rb") as fh:
            fh.seek(max(0, size - 500))
            tail = fh.read().decode("utf-8", errors="replace")
    except OSError:
        return None
    lines = [ln for ln in tail.splitlines() if ln.strip()]
    if not lines:
        return None
    return {"file": newest.name, "line": _ANSI_RE.sub("", lines[-1]).strip()}


def _compute_download_status() -> dict:
    """Assemble per-category download progress from artifacts the downloader
    already writes (.download_progress + content sizes + .logs tail)."""
    progress_file = STORAGE_PATH / ".download_progress"
    completed = set()
    try:
        if progress_file.exists():
            completed = {
                ln.strip() for ln in progress_file.read_text().splitlines() if ln.strip()
            }
    except OSError:
        pass

    stats = get_content_stats()  # cached; no extra walk
    cats = []
    for cat in DOWNLOAD_CATEGORIES:
        size_gb = stats.get(cat["dir"], {}).get("size_gb", 0)
        if cat["id"] in completed:
            status = "complete"
        elif size_gb and size_gb > 0:
            status = "in_progress"
        else:
            status = "pending"
        cats.append({
            "id": cat["id"],
            "name": cat["name"],
            "budget_gb": cat["budget_gb"],
            "size_gb": size_gb,
            "status": status,
        })

    return {
        "categories": cats,
        "active_log": _tail_active_log(),
        "complete": sum(1 for c in cats if c["status"] == "complete"),
        "total": len(cats),
    }


_downloads_cache = _TTLCache(15.0)


@app.route("/api/downloads")
def api_downloads():
    """Per-category download progress for the dashboard."""
    return jsonify(_downloads_cache.get(_compute_download_status))


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


# ── One-click content update ─────────────────────────────────────────────────
# POST /api/update/start launches scripts/update_content.sh detached from the
# request (updates run minutes to hours). State lives on disk — pid file plus
# a finish marker appended to the log by the wrapper — because gunicorn runs
# multiple workers and the one that spawned the process is not necessarily
# the one answering the next status poll.
UPDATE_SCRIPT = REPO_DIR / "scripts" / "update_content.sh"
_UPDATE_FINISH_MARK = "UPDATE_FINISHED exit="


def _update_paths() -> tuple:
    logs_dir = STORAGE_PATH / ".logs"
    return logs_dir / "update_content.log", logs_dir / "update_content.pid"


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except (OSError, OverflowError):
        return False
    return True


def _read_update_state() -> dict:
    """Current update-run state, reconstructed purely from disk artifacts."""
    log_file, pid_file = _update_paths()
    state = {"running": False, "started": None, "exit_code": None, "log_tail": []}

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
        lines = [_ANSI_RE.sub("", ln).strip() for ln in tail.splitlines() if ln.strip()]
    except OSError:
        lines = []

    for line in reversed(lines):
        if line.startswith(_UPDATE_FINISH_MARK):
            try:
                state["exit_code"] = int(line[len(_UPDATE_FINISH_MARK):])
            except ValueError:
                state["exit_code"] = -1
            break

    # The finish marker is the wrapper's final act, so it outranks the pid
    # check (which sees zombies as alive until they are reaped).
    if state["exit_code"] is None and pid and _pid_alive(pid):
        state["running"] = True

    state["log_tail"] = [ln for ln in lines[-25:] if not ln.startswith(_UPDATE_FINISH_MARK)]
    return state


@app.route("/api/update/status")
def api_update_status():
    """Poll target for the dashboard's update button."""
    return jsonify(_read_update_state())


@app.route("/api/update/start", methods=["POST"])
@csrf.exempt
@limiter.limit("3 per minute")
@_admin_required
def api_update_start():
    """Kick off a safe content refresh (scripts/update_content.sh) in the
    background: new videos/books/PDFs, missing ZIMs, AI model updates —
    never replacement builds of existing large ZIMs. Admin-only."""
    # Same CSRF defence as /api/ai/chat: cross-origin JSON needs a preflight.
    if (request.content_type or "").split(";")[0].strip() != "application/json":
        return jsonify({"error": "Content-Type must be application/json"}), 415

    state = _read_update_state()
    if state["running"]:
        return jsonify({"error": "An update is already running"}), 409
    if not _compute_connectivity()["online"]:
        return jsonify({"error": "No internet connection — connect the Pi first"}), 503
    if not UPDATE_SCRIPT.exists():
        return jsonify({"error": f"Update script missing: {UPDATE_SCRIPT}"}), 500

    log_file, pid_file = _update_paths()
    try:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        log_file.write_text("")  # each run gets a fresh log
        # The wrapper (not this process) writes the finish marker, so the
        # outcome is recorded even if gunicorn restarts mid-run.
        proc = subprocess.Popen(  # pylint: disable=consider-using-with
            ["bash", "-c",
             'bash "$1" >>"$2" 2>&1; echo "UPDATE_FINISHED exit=$?" >>"$2"',
             "update_wrapper", str(UPDATE_SCRIPT), str(log_file)],
            cwd=str(REPO_DIR),
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, start_new_session=True,
        )
        pid_file.write_text(str(proc.pid))
    except OSError as exc:
        return jsonify({"error": f"Could not start update: {exc}"}), 500

    # Reap the child on exit so the pid check never sees a stale zombie.
    threading.Thread(target=proc.wait, daemon=True).start()
    return jsonify({"started": True, "pid": proc.pid}), 202


@app.route("/api/service/<name>/restart", methods=["POST"])
@csrf.exempt
@limiter.limit("6 per minute")
@_admin_required
# Each early return is a distinct client-facing error contract (415/404/400/
# 500); collapsing them would obscure which failure the caller hit.
# pylint: disable=too-many-return-statements
def api_service_restart(name):
    """Restart one managed service via the sudoers-allowlisted systemctl.
    Admin-only. The unit name is looked up from SERVICES (never taken from the
    URL) so only known units can be targeted."""
    if (request.content_type or "").split(";")[0].strip() != "application/json":
        return jsonify({"error": "Content-Type must be application/json"}), 415
    svc = SERVICES.get(name)
    if not svc:
        return jsonify({"error": "Unknown service"}), 404
    unit = svc.get("unit")
    if not unit:
        return jsonify({"error": "This service has no restart control"}), 400
    # The AI service may live on a remote host (SURVIVE_OLLAMA_HOST) we can't
    # restart from here.
    if name == "ai" and OLLAMA_IS_REMOTE:
        return jsonify({"error": "AI runs on a remote host — restart it there"}), 400

    cmd = ["sudo", "-n", "/usr/bin/systemctl", "restart", unit]
    # Restarting the dashboard's own unit kills the worker handling this
    # request, so detach it (same pattern as the updater) and return 202.
    if unit == "survive-dashboard":
        try:
            subprocess.Popen(  # pylint: disable=consider-using-with
                cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, start_new_session=True,
            )
        except OSError as exc:
            return jsonify({"error": f"Could not restart: {exc}"}), 500
        return jsonify({"restarting": unit, "detached": True}), 202

    try:
        result = subprocess.run(cmd, capture_output=True, text=True,
                                timeout=30, check=False)
    except (OSError, subprocess.SubprocessError) as exc:
        return jsonify({"error": f"Restart failed: {exc}"}), 500
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()[:200]
        return jsonify({"error": f"systemctl restart {unit} failed: {detail}",
                        "hint": "run scripts/install_sudoers.sh"}), 500
    return jsonify({"restarted": unit}), 200


def _read_throttle_state() -> dict:
    """Parse `vcgencmd get_throttled` (Pi firmware). Bits: 0 under-voltage
    now, 1 freq-capped now, 2 throttled now, 3 soft temp limit now; bits
    16-19 = the same conditions since boot. All-False when vcgencmd is
    missing or its output is unparseable (CI, non-Pi hardware — and some
    setups print a permission error on stdout WITH exit code 0, so the
    output parse is the only trustworthy signal)."""
    state = {"undervoltage": False, "throttled": False, "capped": False,
             "soft_temp_limit": False, "occurred_since_boot": False, "raw": None}
    try:
        out = subprocess.run(
            ["vcgencmd", "get_throttled"],
            capture_output=True, text=True, timeout=2, check=False,
        ).stdout.strip()
        bits = int(out.split("=")[1], 16)  # e.g. "throttled=0x50005"
    except (OSError, subprocess.SubprocessError, IndexError, ValueError):
        return state
    state.update({
        "undervoltage": bool(bits & 0x1),
        "capped": bool(bits & 0x2),
        "throttled": bool(bits & 0x4),
        "soft_temp_limit": bool(bits & 0x8),
        "occurred_since_boot": bool(bits & 0xF0000),
        "raw": hex(bits),
    })
    return state


def _compute_system_health() -> dict:
    """CPU temp, throttle state, RAM/swap, load, uptime. Every source is
    individually guarded so non-Pi environments return zeros, never errors."""
    temp_c = 0.0
    try:
        raw = Path("/sys/class/thermal/thermal_zone0/temp").read_text(encoding="ascii")
        temp_c = round(int(raw.strip()) / 1000, 1)
    except (OSError, ValueError):
        pass

    meminfo = {}
    try:
        for line in Path("/proc/meminfo").read_text(encoding="ascii").splitlines():
            key, _, rest = line.partition(":")
            meminfo[key] = int(rest.split()[0])  # kB
    except (OSError, ValueError, IndexError):
        pass
    mem_total = meminfo.get("MemTotal", 0)
    # MemAvailable (not MemFree — that's always ~0 due to page cache) is the
    # number that actually predicts OOM.
    mem_avail = meminfo.get("MemAvailable", 0)
    swap_total = meminfo.get("SwapTotal", 0)
    swap_free = meminfo.get("SwapFree", 0)

    try:
        load = os.getloadavg()
    except OSError:
        load = (0.0, 0.0, 0.0)

    uptime_s = 0.0
    try:
        uptime_s = float(Path("/proc/uptime").read_text(encoding="ascii").split()[0])
    except (OSError, ValueError, IndexError):
        pass

    return {
        "temperature_c": temp_c,
        "throttle": _read_throttle_state(),
        "memory": {
            "total_mb": round(mem_total / 1024),
            "available_mb": round(mem_avail / 1024),
            "used_percent": round((1 - mem_avail / mem_total) * 100, 1) if mem_total else 0,
            "swap_total_mb": round(swap_total / 1024),
            "swap_used_percent": round((1 - swap_free / swap_total) * 100, 1) if swap_total else 0,
        },
        "load": {"avg_1m": round(load[0], 2), "avg_5m": round(load[1], 2),
                 "avg_15m": round(load[2], 2), "cores": os.cpu_count() or 0},
        "uptime_days": round(uptime_s / 86400, 1),
    }


# 5 s TTL: temperature moves fast during inference, and the reads are cheap —
# but with no cache at all, N open status tabs would stack vcgencmd calls.
_system_cache = _TTLCache(5.0)


@app.route("/api/system")
def api_system():
    """Machine health for the status page (thermals are what silently ruin
    CPU inference on under-cooled or under-powered Pis)."""
    return jsonify(_system_cache.get(_compute_system_health))


@app.route("/status")
def status_page():
    return render_template(
        "status.html",
        storage=get_storage_info(),
        content=get_content_stats(),
        services=check_all_services(),
        categories=CATEGORIES,
        recent=get_recent_downloads(),
        downloads=_downloads_cache.get(_compute_download_status),
        system=_system_cache.get(_compute_system_health),
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


# Start the background search-index refresher at import time so it runs under
# gunicorn (which imports this module) as well as the dev server.
threading.Thread(target=_index_refresher, daemon=True, name="index-refresher").start()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    host = os.environ.get("HOST", "0.0.0.0")
    # Debug mode disabled in production — never expose stack traces to users
    logging.info("SurviveV1 Dashboard starting on %s:%d", host, port)
    app.run(host=host, port=port, debug=False)
