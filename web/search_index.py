"""
SurviveV1 — Read side of the local search indexes.

Four SQLite databases live as dotfiles in the storage root:

* ``.search_index.db``  — FTS5 index of every content FILENAME. Built by this
  module in a background thread (6 h cadence, on-demand rebuild when missing)
  so /search answers in milliseconds instead of re-walking 800 GB.
* ``.content_index.db`` — full text INSIDE PDFs/EPUBs, built offline by
  scripts/index_documents.py (never by the web workers — extraction is
  CPU-heavy). The server only reads it.
* ``.drug_index.db``    — openFDA drug labels, built by scripts/build_drug_index.py.
* Kiwix full-text search is not a file at all: it is kiwix-serve's /search
  endpoint, wrapped here because both /search and the AI retrieval use it.

Every query helper follows one contract: None if the index is absent, [] on
empty/invalid queries, never raises.
"""

import logging
import os
import re
import sqlite3
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

from common import _safe_walk
from settings import MAX_FILES_CHECKED, STORAGE_PATH, TIMEOUT_KIWIX
from constants import PORT_KIWIX

INDEX_DB = STORAGE_PATH / ".search_index.db"
CONTENT_INDEX_DB = STORAGE_PATH / ".content_index.db"
DRUG_INDEX_DB = STORAGE_PATH / ".drug_index.db"
_index_lock = threading.Lock()          # serialises rebuilds within one process
_index_building = threading.Event()      # dedupes on-demand builds


# ── Kiwix full-text search ────────────────────────────────────────────────────
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


# ── FTS query sanitising ──────────────────────────────────────────────────────
def _fts_sanitize(query: str) -> str:
    """Turn raw user input into a safe FTS5 prefix query — strips quotes and
    operators that would otherwise be a syntax error or injection vector.
    Returns '' when nothing searchable remains."""
    tokens = re.sub(r"[^a-zA-Z0-9 -]", " ", query).split()
    if not tokens:
        return ""
    return " ".join(tokens[:-1] + [tokens[-1] + "*"])


# ── Document (content) index ──────────────────────────────────────────────────
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


# ── Filename index (SQLite FTS5) ──────────────────────────────────────────────
def _index_connect():
    return sqlite3.connect(str(INDEX_DB), timeout=30)


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


def start_index_refresher() -> threading.Thread:
    """Start the background refresher. Called once by server.py at import so
    it runs under gunicorn (which imports the app) and the dev server alike."""
    thread = threading.Thread(target=_index_refresher, daemon=True, name="index-refresher")
    thread.start()
    return thread


def _search_walk(query: str) -> list:
    """Correctness backstop: live filename walk, used until the index exists."""
    results = []
    ql = query.lower()
    files_checked = 0
    try:
        for f in _safe_walk(STORAGE_PATH):
            files_checked += 1
            if files_checked > MAX_FILES_CHECKED:
                logging.info("search: hit %d-file cap, stopping walk", MAX_FILES_CHECKED)
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
