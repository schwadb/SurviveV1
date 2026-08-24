# PLAN-pdf-text-search: Index the text INSIDE PDFs and EPUBs for search + RAG

**Rank: #1 — do this first.** (Round 2; round-1 plans live in docs/plans/completed/)

## Goal

The most curated content in the repo — ~20 GB of survival PDFs (Where There Is
No Doctor, military field manuals, Hesperian guides) plus the EPUB library —
is invisible to full-text search and to the AI. `/search`'s "Inside articles"
section and `ai_chat()`'s RAG retrieval both query **Kiwix only**, which covers
ZIM files. A user searching "tourniquet" finds nothing from the TCCC handbook
sitting on disk, and the AI can't cite it.

After this change: a standalone indexer extracts text from every PDF/EPUB into
a second FTS5 database; `/search` gains an "Inside your documents" section with
highlighted snippets and page-anchored links; `_retrieve_context()` merges the
best document chunks with Kiwix hits so the AI cites the actual field manuals.

## Exact files to touch

| File | Change |
|------|--------|
| `scripts/index_documents.py` | NEW — standalone chunk-extractor/indexer (stdlib + pdftotext) |
| `setup/install.sh` | add `poppler-utils` to the apt package list |
| `web/server.py` | `_query_doc_index()`, merge into `search()` and `_retrieve_context()` |
| `web/templates/search.html` | third results section with snippets |
| `download/books_pdfs.sh`, `download/gaps_content.sh`, `download/mental_health.sh` | run the indexer after downloads |
| `tests/test_smoke.sh` | doc-search assertion against a seeded text PDF |
| `CLAUDE.md`, `docs/API.md` | document the second index |

## Implementation order

1. **`scripts/index_documents.py`** (python3, stdlib only + `pdftotext` binary):
   - DB: `$STORAGE/.content_index.db` — separate from `.search_index.db` so the
     slow content build never blocks the fast filename index swap.
   - Schema:
     ```sql
     CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
         text, path UNINDEXED, page UNINDEXED, title UNINDEXED);
     CREATE TABLE IF NOT EXISTS indexed_files(
         path TEXT PRIMARY KEY, mtime REAL, chunks INTEGER);
     ```
   - Walk `pdfs/` and `books/` (reuse the `_safe_walk` logic — copy it in;
     the script must NOT import server.py, which starts threads on import).
   - **Incremental**: skip files whose `(path, mtime)` matches `indexed_files`;
     delete stale rows for files that changed or disappeared
     (`DELETE FROM chunks WHERE path = ?` before re-adding).
   - PDF extraction: `subprocess.run(["pdftotext", "-layout", path, "-"],
     capture_output=True, timeout=120)`. Pages arrive separated by form-feed
     `\f` — `stdout.split("\f")` gives you page numbers for free.
   - EPUB extraction: `zipfile.ZipFile` → every `*.xhtml`/`*.html` member →
     strip tags with the same regex approach as server.py's `_strip_html`.
     Page number: use the spine order index instead.
   - Chunking: per page, split into ~1500-char pieces on paragraph boundaries;
     store `title` = filename stem with `[_.]` → space (same normalisation as
     the filename index).
   - Run under `nice -n 19` semantics: call `os.nice(19)` at startup — a full
     rebuild takes an hour+ on Pi and must not starve Ollama or the dashboard.
   - CLI: `--storage PATH` (default from `SURVIVE_STORAGE_PATH` env then
     survive.conf pattern), `--rebuild` (drop everything first). Print a
     summary line: `indexed N files, S chunks, skipped M unchanged`.

2. **server.py `_query_doc_index(query, limit=5)`**: same shape as
   `_query_search_index` — per-call sqlite connection to
   `STORAGE_PATH / ".content_index.db"`, same token sanitisation (reuse the
   existing regex — factor it into `_fts_sanitize(query)` used by both), query:
   ```sql
   SELECT title, path, page, snippet(chunks, 0, '', '', '…', 12)
   FROM chunks WHERE chunks MATCH ? LIMIT ?
   ```
   NOTE: `snippet()`'s first argument is the FTS table name and the column
   index 0 refers to `text`. Empty-string open/close markers — highlighting
   is done client-side-safe by NOT injecting HTML. Returns
   `[{title, path, page, snippet}]`; `None` if DB missing; `[]` on
   OperationalError (mirror the filename-index contract exactly).

3. **`search()` route**: add `doc_results = _query_doc_index(query) or []`
   and pass to the template.

4. **`_retrieve_context()`**: after Kiwix search, call
   `_query_doc_index(query, limit=2)`; append hits as
   `{"title": f"{title} (p.{page})", "path": None, "snippet": snippet,
   "text": snippet}` entries. **Context budget**: keep total at 3 Kiwix
   articles × 2000 chars; when doc chunks are present use 2 Kiwix × 2000 + 2
   chunks × ~1500 — still under the ~7.5k-char budget for `num_ctx 4096`.
   Sources for doc hits must link to `/serve/<path>#page=N` (browser PDF
   viewers honour `#page=`); adjust `_sources_for` to use a pre-built `url`
   key when `path` is None.

5. **`search.html`**: third section "Inside your documents" — link
   `/serve/{{ d.path }}#page={{ d.page }}`, title + `p.{{ d.page }}` badge +
   snippet (Jinja auto-escape, no `|safe`).

6. **Download scripts**: append
   `command -v pdftotext >/dev/null && python3 "$REPO_DIR/scripts/index_documents.py" --storage "$STORAGE_PATH" || true`
   at the end of `main()` in the three scripts that fetch PDFs/EPUBs.

## Edge cases a weaker model would miss

- **Do NOT import server.py from the indexer** — importing it starts the
  index-refresher daemon thread and instantiates Flask; the indexer must be a
  standalone script (copy the two small helpers it needs).
- **Scanned/image PDFs** return empty text from pdftotext — record them in
  `indexed_files` with `chunks=0` anyway, or they'll be re-parsed on every
  run forever. (OCR is explicitly out of scope.)
- **Encrypted PDFs**: pdftotext exits non-zero — catch, record, skip. Never
  let one bad file kill the run (`try/except` per file, log and continue).
- **`subprocess` timeout**: a malformed 500 MB PDF can hang poppler; the
  120 s timeout + per-file try/except is load-bearing.
- **FTS5 `snippet()` arguments**: the column index (0) counts only real
  columns of the FTS table; UNINDEXED columns still count in ordering — text
  is column 0 here because it's declared first. Getting this wrong returns
  path fragments as "snippets".
- **NUL bytes**: pdftotext output can contain `\x00`, which sqlite TEXT
  rejects mid-string in some drivers — `text.replace("\x00", "")` before
  insert.
- **The indexer runs as root from download scripts** but the server runs as
  `pi` under systemd — `chmod 644` the DB (or chown pi) after the build, or
  the dashboard gets `sqlite3.OperationalError: unable to open database file`
  only in production.
- **`#page=N` anchors** work in Chromium/Firefox's built-in viewers but not
  all; the link must still open the PDF without the anchor — it degrades
  gracefully by construction, just don't 404 when page is None (EPUBs).
- **Context budget interplay with PLAN-chat-memory** (round-2 #2): if both
  land, history + RAG must share the num_ctx budget — RAG excerpts get
  priority; trim history first.

## Acceptance criteria

1. Generate a seed PDF in the test env (no poppler needed to *create*):
   `python3 -c "..."` writing a minimal 1-page PDF containing the literal
   string `zzyzxtourniquet` (a collision-proof token), place under
   `/tmp/survive_test/pdfs/`, run
   `python3 scripts/index_documents.py --storage /tmp/survive_test`.
   Then `curl "localhost:18080/search?q=zzyzxtourniquet"` returns HTTP 200
   and the body contains the PDF's filename and `p.1`.
2. Re-running the indexer prints `skipped 1 unchanged` and finishes in <1 s.
3. `_query_doc_index('water AND "')` returns `[]`, not an exception.
4. With mock Kiwix + a seeded doc index, POST `/api/ai/chat` sources include
   an entry whose url contains `/serve/` and `#page=`.
5. Smoke tests all pass; pylint ≥ 9.5 on server.py; the indexer itself passes
   `pylint scripts/index_documents.py --fail-under=7.0` with the repo's
   standard disables.
