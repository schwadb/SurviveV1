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
    Response, stream_with_context
)
from flask_wtf.csrf import CSRFProtect
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.security import check_password_hash

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
REPO_DIR = Path(__file__).parent.parent
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


@app.route("/search")
@limiter.limit("30 per minute")
def search():
    query = request.args.get("q", "").strip()[:200]  # cap at 200 chars to prevent ReDoS
    results = []
    article_results = []
    doc_results = []

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

    meta = _index_meta()
    return render_template(
        "search.html",
        query=query,
        results=results,
        article_results=article_results,
        doc_results=doc_results,
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
