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
| `CLAUDE.md` | document the index file and rebuild cadence |

## Implementation order

1. **Index location**: `INDEX_DB = STORAGE_PATH / ".search_index.db"` (hidden
   file, next to `.kiwix_library.xml`, excluded from walks because `_safe_walk`
   already skips dotfiles).

2. **Schema** (create with `sqlite3` stdlib):
   ```sql
   CREATE VIRTUAL TABLE IF NOT EXISTS files USING fts5(
       name, path UNINDEXED, ext UNINDEXED, size_mb UNINDEXED,
       tokenize = "unicode61 tokenchars '-'"
   );
   CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
   ```
   At insert time store `name` with underscores and dots replaced by spaces
   (`re.sub(r"[_.]", " ", f.stem)`) so `Where_There_Is_No_Doctor` matches the
   query "doctor". Keep the original filename in `path`.

3. **`_rebuild_search_index()`**: walk with the existing `_safe_walk(STORAGE_PATH)`,
   batch-insert 500 rows per transaction into a **temp table swap**: build into
   `files_new`, then `DROP TABLE files; ALTER TABLE files_new RENAME TO files;`
   inside one transaction so readers never see a half-built index. Record
   `meta['built_at'] = datetime.now().isoformat()` and `meta['count']`.
   Guard concurrent rebuilds with a module-level `threading.Lock` +
   `sqlite3.connect(..., timeout=30)`.

4. **Background refresh**: module-level
   `threading.Thread(target=_index_refresher, daemon=True).start()` at import
   time, sleeping 6 h between rebuilds (`time.sleep` loop), first build
   delayed 60 s after startup so boot stays fast. ALSO rebuild on demand when
   `search()` finds the DB missing.

5. **`_query_search_index(q, limit=50)`**: open a **per-call connection**
   (SQLite objects are not thread-safe across Flask threads). Sanitize the
   FTS query: strip all characters except `[a-zA-Z0-9 -]`, then append `*` to
   the last token for prefix matching. Query:
   `SELECT name, path, ext, size_mb FROM files WHERE files MATCH ? LIMIT ?`.
   On `sqlite3.OperationalError` (bad FTS syntax) return `[]`, never 500.

6. **Rewrite `search()` route**: try the index first; if `INDEX_DB` does not
   exist, fall back to the current `_safe_walk` loop (keep it — it is the
   correctness backstop) and kick off a background rebuild. Add
   `article_results = _kiwix_search(query, limit=5)` for the second section.
   Pass both lists plus `index_built_at` to the template.

7. **`search.html`**: section one "Files" (existing card grid), section two
   "Inside articles" — title links to
   `http://{{ request.host.split(':')[0] }}:{{ PORT_KIWIX }}{{ r.url }}`,
   show the snippet with `{{ r.snippet }}` (Jinja auto-escapes — do NOT add
   `|safe`; Kiwix snippets contain `<b>` tags that must render as text or be
   stripped server-side with the same regex as PLAN-ai-rag step 2).
   Footer line: "Index of {{ count }} files, built {{ built_at }}".

## Edge cases a weaker model would miss

- **gunicorn runs 2 workers** (systemd unit): both import server.py and both
  would start refresher threads and race the rebuild. The temp-table swap +
  lock makes this safe, but ALSO stagger: sleep `60 + (os.getpid() % 30)`
  before the first build so they don't collide at boot.
- **SQLite thread affinity**: never reuse one connection across requests;
  open/close per call (fast for SQLite) or use `threading.local()`.
- **FTS5 syntax injection**: user input like `water AND "` throws
  `OperationalError: fts5: syntax error` — sanitization in step 5 is
  mandatory, and the except clause is the second line of defense.
- **Index on the storage drive**: if the drive is unmounted, `STORAGE_PATH`
  falls back to `repo/data` (see server.py config block) — index path follows
  automatically; do not hardcode `/mnt/survive`.
- **Stale index** after a big download: 6 h staleness is acceptable, but
  `scripts/update_content.sh` and `download/download_all.sh` should `rm -f
  "$STORAGE_PATH/.search_index.db"` on completion so the next search
  triggers a rebuild (one-line addition at the end of each script's main).
- **`size_mb` at index time vs serve time**: files can be deleted after
  indexing; `/serve/<path>` already 404s cleanly — do not stat results at
  query time (that reintroduces the I/O you removed).
- **Do not** index `.logs/`, hidden dirs, or the DB itself — `_safe_walk`
  already excludes dotfiles; verify with the acceptance test.

## Acceptance criteria

1. Seed 1 000 dummy files (`mkdir -p /tmp/survive_test/pdfs && for i in $(seq 1000); do touch "/tmp/survive_test/pdfs/file_$i.pdf"; done`),
   start the server, wait for the index, then:
   `time curl -s "localhost:18080/search?q=file" >/dev/null` completes in
   **< 300 ms** (vs seconds for the walk).
2. Searching `doctor` finds a file named `Where_There_Is_No_Doctor_2021.pdf`.
3. `sqlite3 /tmp/survive_test/.search_index.db "SELECT count(*) FROM files"` matches the seeded file count.
4. A query of `water AND "` (FTS syntax bomb) returns HTTP 200 with zero file results.
5. Delete the DB file, hit `/search?q=x` → HTTP 200 via the walk fallback, and the DB reappears within 2 minutes.
6. All smoke tests pass; pylint ≥ 9.5.
