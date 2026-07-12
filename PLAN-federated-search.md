# PLAN-federated-search: Instant indexed search + full-text article results

**Rank: #2.**

## Goal

`/search` currently walks the storage tree on **every request** (up to 500 000
files, capped by `_MAX_FILES_CHECKED`) and matches filenames only. On a full
800 GB drive over USB this takes many seconds per query, burns the 30/min rate
limit slot on I/O, and finds nothing inside articles.

After this change:

1. A **SQLite FTS5 index** of all content filenames is built in the background
   and refreshed periodically → filename search answers in <50 ms.
2. The search results page gets a second section, **"Inside articles"**,
   powered by the same Kiwix full-text endpoint used by PLAN-ai-rag.

Leverage: search is the front door of a knowledge base; today it is the
slowest, weakest page. This also unblocks future category filtering.

**Dependency note:** implement PLAN-ai-rag first — reuse its
`_kiwix_search()` helper verbatim. If executing this plan standalone, copy
step 1 of PLAN-ai-rag into this work.

## Exact files to touch

| File | Change |
|------|--------|
| `web/server.py` | index builder + query functions; rewrite `search()` route |
| `web/templates/search.html` | two result sections; index-freshness footer |
| `tests/test_smoke.sh` | index-related assertions |
| `scripts/update_content.sh`, `download/download_all.sh` | invalidate index after downloads |
| `CLAUDE.md` | document the index file and rebuild cadence |

## Implementation order

1. **Index location**: `INDEX_DB = STORAGE_PATH / ".search_index.db"` (hidden
   file, next to `.kiwix_library.xml`, excluded from walks because `_safe_walk`
   already skips dotfiles).

2. **Schema** (create with `sqlite3` stdlib; `PRAGMA journal_mode=WAL` on
   every connection so readers never block on the rebuild writer):
   ```sql
   CREATE VIRTUAL TABLE IF NOT EXISTS files USING fts5(
       name, path UNINDEXED, ext UNINDEXED, size_mb UNINDEXED,
       tokenize = "unicode61 tokenchars '-'"
   );
   CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
   ```
   At insert time store `name` with underscores and dots replaced by spaces
   (`re.sub(r"[_.]", " ", f.stem)`) so `Where_There_Is_No_Doctor` matches the
   query "doctor". Keep the original relative path in `path`.

3. **`_rebuild_search_index()`**: walk with the existing
   `_safe_walk(STORAGE_PATH)`, batch-insert 500 rows per transaction into a
   **temp table swap**: build into `files_new`, then
   `DROP TABLE files; ALTER TABLE files_new RENAME TO files;` inside one
   transaction so readers never see a half-built index. Record
   `meta['built_at']` and `meta['count']`. Guard concurrent rebuilds with a
   module-level `threading.Lock` + `sqlite3.connect(..., timeout=30)`.

4. **Background refresh — lazy start, NOT at import time.** The systemd unit
   now runs gunicorn with `--preload`: `server.py` is imported once in the
   *master* process, then workers are forked. **Threads do not survive
   `fork()`** — a refresher thread started at import time would run in the
   master only and every worker would have none (or, worse, a dev-mode test
   would pass while prod silently never rebuilds). Instead:
   ```python
   _index_thread_started = False
   _index_thread_lock = threading.Lock()
   def _ensure_index_refresher():
       global _index_thread_started
       with _index_thread_lock:
           if _index_thread_started: return
           _index_thread_started = True
           threading.Thread(target=_index_refresher, daemon=True).start()
   @app.before_request
   def _kick_index_refresher():
       _ensure_index_refresher()
   ```
   `_index_refresher` sleeps `60 + (os.getpid() % 30)` seconds before the
   first build (staggers the two workers), then rebuilds every 6 h.

5. **`_query_search_index(q, limit=50)`**: open a **per-call connection**
   (SQLite objects are not thread-safe across Flask's gthread workers).
   Sanitize the FTS query: strip all characters except `[a-zA-Z0-9 -]`, then
   append `*` to the last token for prefix matching. Query:
   `SELECT name, path, ext, size_mb FROM files WHERE files MATCH ? LIMIT ?`.
   On `sqlite3.OperationalError` (bad FTS syntax) return `[]`, never 500.

6. **Rewrite `search()` route**: try the index first; if `INDEX_DB` does not
   exist, fall back to the current `_safe_walk` loop (keep it — it is the
   correctness backstop) and let the refresher build the index. Add
   `article_results = _kiwix_search(query, limit=5)` for the second section.
   Pass both lists plus `index_built_at` to the template.

7. **`search.html`**: section one "Files" (existing card grid), section two
   "Inside articles" — title links to
   `http://{{ request.host.split(':')[0] }}:{{ PORT_KIWIX }}{{ r.url }}`,
   show `{{ r.snippet }}` (Jinja auto-escapes — do NOT add `|safe`; Kiwix
   snippets contain `<b>` tags that must be stripped server-side with the
   PLAN-ai-rag tag-strip regex). Footer: "Index of {{ count }} files, built
   {{ built_at }}".

8. **Invalidate after downloads**: append
   `rm -f "$STORAGE_PATH/.search_index.db"` to the end of `main()` in
   `scripts/update_content.sh` and `download/download_all.sh` so the next
   rebuild picks up new content promptly.

## Edge cases a weaker model would miss

- **`--preload` + fork kills import-time threads** (step 4). This is the
  single most likely silent failure in this plan. Symptom: works with
  `python3 server.py`, index never refreshes under systemd. The
  `before_request` kick runs post-fork in each worker, which is correct.
- **Two workers × one DB**: both workers run refreshers; the temp-table swap
  plus the `timeout=30` connection and WAL mode make the race harmless (one
  rebuild wins, the other waits then swaps again). Do not "optimize" to a
  PID file lock — stale locks after OOM kills are worse than a double build.
- **SQLite thread affinity**: never reuse one connection across requests;
  open/close per call (fast for SQLite). The dashboard now runs
  `--worker-class gthread --threads 4` — a shared module-level connection
  would throw `ProgrammingError` under concurrent load only.
- **FTS5 syntax injection**: user input like `water AND "` throws
  `OperationalError: fts5: syntax error` — sanitization in step 5 is
  mandatory, and the except clause is the second line of defense.
- **Index on the storage drive**: if the drive is unmounted, `STORAGE_PATH`
  falls back to `repo/data` (see server.py config block) — the index path
  follows automatically; do not hardcode `/mnt/survive`. If the storage is
  read-only (failing SSD), `_rebuild_search_index()` must catch
  `sqlite3.OperationalError` and log a warning, leaving the walk fallback
  in service.
- **`size_mb` at index time vs serve time**: files can be deleted after
  indexing; `/serve/<path>` already 404s cleanly — do not stat results at
  query time (that reintroduces the I/O you just removed).
- **Do not index `.logs/`, hidden dirs, or the DB itself** — `_safe_walk`
  already excludes dotfiles; verify with the acceptance test.

## Acceptance criteria

1. Seed 1 000 dummy files
   (`mkdir -p /tmp/survive_test/pdfs && for i in $(seq 1000); do touch "/tmp/survive_test/pdfs/file_$i.pdf"; done`),
   start the server, hit any page once (kicks the refresher), wait ~2 min:
   `time curl -s "localhost:18080/search?q=file" >/dev/null` completes in
   **< 300 ms**.
2. Searching `doctor` finds a file named `Where_There_Is_No_Doctor_2021.pdf`.
3. `sqlite3 /tmp/survive_test/.search_index.db "SELECT count(*) FROM files"`
   matches the seeded file count.
4. A query of `water AND "` (FTS syntax bomb) returns HTTP 200 with zero
   file results.
5. Delete the DB file, hit `/search?q=x` → HTTP 200 via the walk fallback;
   the DB reappears within the refresher interval.
6. Under gunicorn with `--preload` (copy the ExecStart from
   `systemd/survive-dashboard.service`), the index still gets built —
   this specifically tests the fork edge case.
7. All smoke tests pass; pylint ≥ 9.5.
