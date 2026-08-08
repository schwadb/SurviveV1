#!/usr/bin/env python3
"""
SurviveV1 — Document text indexer.

Extracts text from every PDF (via poppler's `pdftotext`) and EPUB (stdlib
zipfile) under the storage's pdfs/ and books/ directories into an SQLite FTS5
database at $STORAGE/.content_index.db, so the dashboard can search INSIDE
documents and the AI assistant can cite them.

Standalone by design: importing web/server.py would start its background
threads and Flask app, so the two helpers this script needs are duplicated
here. Runs at lowest CPU priority — a full rebuild takes an hour+ on a Pi and
must not starve Ollama or the dashboard.

Usage:
    python3 scripts/index_documents.py [--storage /mnt/survive] [--rebuild]
"""

import argparse
import os
import re
import sqlite3
import subprocess
import sys
import zipfile
from pathlib import Path

CHUNK_CHARS = 1500
PDF_TIMEOUT_S = 120
_TAG_RE = re.compile(r"<[^>]+>")
_SCRIPT_STYLE_RE = re.compile(r"<script.*?</script>|<style.*?</style>", re.S | re.I)


def strip_html(text: str) -> str:
    """Remove tags and collapse whitespace (mirror of server._strip_html)."""
    text = _SCRIPT_STYLE_RE.sub(" ", text)
    text = _TAG_RE.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def safe_walk(root: Path):
    """Yield files without following symlinks; skip hidden dirs/files
    (mirror of server._safe_walk)."""
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for name in filenames:
            if not name.startswith("."):
                yield Path(dirpath) / name


def default_storage() -> str:
    """SURVIVE_STORAGE_PATH env wins; then survive.conf; then /mnt/survive."""
    env = os.environ.get("SURVIVE_STORAGE_PATH")
    if env:
        return env
    conf = Path(__file__).resolve().parent.parent / "config" / "survive.conf"
    try:
        for line in conf.read_text().splitlines():
            m = re.match(r'\s*SURVIVE_STORAGE_PATH="?([^"#]+)"?\s*$', line)
            if m:
                return m.group(1).strip()
    except OSError:
        pass
    return "/mnt/survive"


def extract_pdf_pages(path: Path) -> list:
    """Return [(page_number, text)] for a PDF; [] if unreadable/encrypted/
    scanned. pdftotext separates pages with form-feed characters."""
    try:
        proc = subprocess.run(
            ["pdftotext", "-layout", str(path), "-"],
            capture_output=True, timeout=PDF_TIMEOUT_S, check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if proc.returncode != 0:
        return []
    text = proc.stdout.decode("utf-8", errors="replace")
    pages = []
    for i, page in enumerate(text.split("\f"), 1):
        page = re.sub(r"\s+", " ", page).strip()
        if page:
            pages.append((i, page))
    return pages


def extract_epub_pages(path: Path) -> list:
    """Return [(spine_index, text)] for an EPUB; [] if unreadable."""
    pages = []
    try:
        with zipfile.ZipFile(path) as zf:
            members = [n for n in zf.namelist()
                       if n.lower().endswith((".xhtml", ".html", ".htm"))]
            for i, name in enumerate(sorted(members), 1):
                try:
                    html = zf.read(name).decode("utf-8", errors="replace")
                except (KeyError, OSError):
                    continue
                text = strip_html(html)
                if text:
                    pages.append((i, text))
    except (zipfile.BadZipFile, OSError):
        return []
    return pages


def chunk_page(page_text: str) -> list:
    """Split page text into ~CHUNK_CHARS pieces on sentence/space boundaries."""
    if len(page_text) <= CHUNK_CHARS:
        return [page_text]
    chunks = []
    start = 0
    while start < len(page_text):
        end = start + CHUNK_CHARS
        if end < len(page_text):
            # Break at the last sentence end or space inside the window.
            window = page_text[start:end]
            cut = max(window.rfind(". "), window.rfind(" "))
            if cut > CHUNK_CHARS // 2:
                end = start + cut + 1
        chunks.append(page_text[start:end].strip())
        start = end
    return [c for c in chunks if c]


def connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path), timeout=60)
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5("
        "text, path UNINDEXED, page UNINDEXED, title UNINDEXED)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS indexed_files("
        "path TEXT PRIMARY KEY, mtime REAL, chunks INTEGER)"
    )
    return conn


def index_file(conn: sqlite3.Connection, storage: Path, f: Path) -> int:
    """Extract, chunk and store one document. Returns the chunk count.
    Files that yield no text (scanned/encrypted) are still recorded so they
    are not re-parsed on every run."""
    rel = str(f.relative_to(storage))
    title = re.sub(r"[_.]", " ", f.stem)  # same normalisation as filename index
    if f.suffix.lower() == ".pdf":
        pages = extract_pdf_pages(f)
    else:
        pages = extract_epub_pages(f)

    conn.execute("DELETE FROM chunks WHERE path = ?", (rel,))
    count = 0
    for page_no, page_text in pages:
        for chunk in chunk_page(page_text):
            # pdftotext output can contain NULs, which sqlite TEXT rejects.
            chunk = chunk.replace("\x00", "")
            conn.execute(
                "INSERT INTO chunks VALUES (?,?,?,?)",
                (chunk, rel, page_no, title),
            )
            count += 1
    conn.execute(
        "INSERT OR REPLACE INTO indexed_files VALUES (?,?,?)",
        (rel, f.stat().st_mtime, count),
    )
    return count


def index_tree(conn, storage: Path, known: dict, has_pdftotext: bool) -> tuple:
    """Index every new/changed document under pdfs/ and books/.
    Returns (indexed, skipped, failed, total_chunks)."""
    indexed = skipped = failed = total_chunks = 0
    for subdir in ("pdfs", "books"):
        root = storage / subdir
        if not root.exists():
            continue
        for f in safe_walk(root):
            suffix = f.suffix.lower()
            if suffix not in (".pdf", ".epub"):
                continue
            if suffix == ".pdf" and not has_pdftotext:
                continue
            rel = str(f.relative_to(storage))
            try:
                mtime = f.stat().st_mtime
            except OSError:
                continue
            if known.get(rel) == mtime:
                skipped += 1
                continue
            try:
                n = index_file(conn, storage, f)
                conn.commit()
                indexed += 1
                total_chunks += n
                print(f"[INDEX] {rel}: {n} chunks")
            except (sqlite3.Error, OSError) as exc:
                # One bad file must never kill the run.
                failed += 1
                print(f"[INDEX] FAILED {rel}: {exc}", file=sys.stderr)
    return indexed, skipped, failed, total_chunks


def prune_deleted(conn, storage: Path, known: dict) -> None:
    """Drop index rows for files that no longer exist on disk."""
    on_disk = set()
    for subdir in ("pdfs", "books"):
        root = storage / subdir
        if root.exists():
            on_disk.update(
                str(f.relative_to(storage)) for f in safe_walk(root)
                if f.suffix.lower() in (".pdf", ".epub")
            )
    for rel in set(known) - on_disk:
        conn.execute("DELETE FROM chunks WHERE path = ?", (rel,))
        conn.execute("DELETE FROM indexed_files WHERE path = ?", (rel,))
    conn.commit()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--storage", default=default_storage())
    parser.add_argument("--rebuild", action="store_true",
                        help="drop the existing index and re-extract everything")
    args = parser.parse_args()

    try:
        os.nice(19)  # lowest priority — never starve Ollama or the dashboard
    except OSError:
        pass

    storage = Path(args.storage)
    if not storage.exists():
        print(f"[INDEX] storage path not found: {storage}", file=sys.stderr)
        return 1

    has_pdftotext = subprocess.run(
        ["which", "pdftotext"], capture_output=True, check=False
    ).returncode == 0
    if not has_pdftotext:
        print("[INDEX] pdftotext not found (apt install poppler-utils) — "
              "PDFs will be skipped, EPUBs still indexed")

    db_path = storage / ".content_index.db"
    if args.rebuild and db_path.exists():
        db_path.unlink()
    conn = connect(db_path)

    known = dict(conn.execute("SELECT path, mtime FROM indexed_files").fetchall())
    indexed, skipped, failed, total_chunks = index_tree(
        conn, storage, known, has_pdftotext)
    prune_deleted(conn, storage, known)

    # The dashboard runs as user 'pi' under systemd; this script often runs as
    # root from download scripts. World-readable avoids a prod-only failure.
    try:
        os.chmod(db_path, 0o644)
    except OSError:
        pass

    conn.close()
    print(f"[INDEX] indexed {indexed} files, {total_chunks} chunks, "
          f"skipped {skipped} unchanged, {failed} failed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
