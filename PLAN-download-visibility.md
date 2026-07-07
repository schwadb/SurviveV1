# PLAN-download-visibility: Show download progress in the dashboard

**Rank: #5.**

## Goal

`download_all.sh` runs for **days**, headless, inside tmux. The only way to
see how the 800 GB acquisition is going is to SSH in and tail logs. The
dashboard — the product's face — shows nothing about the single longest
operation a new user experiences.

After this change, a "Downloads" card on `/status` (and a compact line on the
home page) shows: which categories are complete / in progress / pending,
per-category size on disk vs the documented budget, and the last activity
line from the current download log. Data comes from artifacts the downloader
already writes (`.download_progress`, `.logs/*.log`) plus the existing
content-stats cache — no changes to the download pipeline's behavior.

## Exact files to touch

| File | Change |
|------|--------|
| `web/server.py` | new `/api/downloads` endpoint + `_compute_download_status()` |
| `web/constants.py` | `DOWNLOAD_CATEGORIES` static list (name, budget_gb, progress key, content dir) |
| `web/templates/status.html` | Downloads card with per-category progress bars |
| `web/templates/index.html` | one-line summary in the sidebar ("Downloads: 3/7 complete") |
| `tests/test_smoke.sh` | `/api/downloads` JSON assertion |
| `docs/API.md` | document the endpoint |

## Implementation order

1. **`DOWNLOAD_CATEGORIES` in `web/constants.py`** — mirror the categories and
   budgets already listed in `download_all.sh print_budget()` and the
   `run_category` names (they MUST match the strings written to
   `.download_progress`): `kiwix`, `videos`, `books`, `maps`, `kolibri`,
   `gaps`, `mental_health`. Each entry:
   `{"id": "kiwix", "name": "Wikipedia & ZIM", "budget_gb": 190, "dir": "zim"}`
   (budget numbers from `print_budget`; `dir` is the storage subdir whose
   size the UI reports, matching keys in `_compute_content_stats`).

2. **`_compute_download_status()` in `web/server.py`**:
   - Read `STORAGE_PATH / ".download_progress"` → set of completed ids.
     Missing file = empty set (fresh install), NOT an error.
   - Reuse `get_content_stats()` (already cached 60 s) for per-dir sizes —
     do **not** run `du` or a new walk.
   - A category is `"complete"` if its id is in the progress set;
     `"in_progress"` if not complete AND its dir grew: compare
     `stats[dir]["size_gb"] > 0`; else `"pending"`.
   - Last activity: newest file in `STORAGE_PATH / ".logs"` by mtime; read its
     **last 500 bytes** (`f.seek(max(0, size-500))`), take the final non-empty
     line, strip ANSI codes with `re.sub(r"\x1b\[[0-9;]*m", "", line)`.
   - Return `{"categories": [...], "active_log": {"file": name, "line": ...} | None}`.
   - Wrap in a module-level `_TTLCache(15.0)` (the class already exists).

3. **Route**: `@app.route("/api/downloads")` returning
   `jsonify(_downloads_cache.get(_compute_download_status))`.

4. **`status.html`**: new card between the budget gauge and the two-column
   grid. Per category: name, status badge (`badge-green` complete /
   `badge-yellow` in progress / `badge-red` pending — classes exist in
   base.html), thin progress bar `width: {{ (size/budget*100)|round }}%`
   (cap at 100 with the `|min` pattern used by the budget gauge at line ~83).
   Below the list, the active log line in `--mono` font, and the exact
   commands to start/resume: `bash download/download_all.sh` /
   `... --resume`. Extend this page's existing `refreshStatus()` poller to
   also fetch `/api/downloads` and update badges via `data-dl-cat`
   attributes (same in-place pattern as the service badges).

5. **`index.html` sidebar**: in the Storage card, add one line:
   `Downloads: <span id="dlSummary">…</span>` filled by a `fetch('/api/downloads')`
   on load → `"{complete}/{total} categories complete"`.

## Edge cases a weaker model would miss

- **Category-id coupling**: the ids in `DOWNLOAD_CATEGORIES` must equal the
  first argument of each `run_category` call in `download_all.sh` — that is
  the literal string written to `.download_progress`. Add a comment in BOTH
  files pointing at each other; a mismatch silently shows "pending" forever.
- **ANSI escape codes** in log lines (the scripts colorize output) — must be
  stripped server-side or the UI shows `\x1b[0;34m` garbage.
- **Log tail reading**: logs can be hundreds of MB (yt-dlp). Never
  `read()` the whole file; seek-to-end-minus-500 is mandatory.
- **Flask auto-escaping protects the log line** in the template — but the
  JS poller must set it with `textContent`, never `innerHTML` (log lines
  contain arbitrary downloaded-file names).
- **`size_gb > 0` as "in progress"** misfires for categories sharing a dir
  (`gaps` and `mental_health` both write into `pdfs/` and `books/`): map both
  to `dir: "pdfs"` and accept the approximation — the status flips to
  complete via the progress file, which is authoritative. Do not invent
  per-file attribution; it is not worth the I/O.
- **`.download_progress` read concurrency**: the downloader appends under
  `flock`; a partial last line is possible mid-write. Read with
  `read_text().splitlines()` and ignore any line not in the known id set.
- **Fresh install** (no storage, no progress file, no logs dir): endpoint
  must return valid JSON with all categories `pending` and
  `active_log: null` — this is the exact state of the smoke-test env, which
  is why the smoke test can cover it.

## Acceptance criteria

1. Smoke test: `check_json "GET /api/downloads" "/api/downloads"` passes in
   the bare test env, and a follow-up assertion greps the response for
   `"pending"` (all categories pending on empty storage).
2. `echo kiwix >> /tmp/survive_test/.download_progress`, restart nothing,
   wait 15 s (cache TTL) → `/api/downloads` shows kiwix `"complete"`.
3. Write a fake log: `mkdir -p /tmp/survive_test/.logs && printf '\x1b[0;34m[DL]\x1b[0m downloading wikipedia_en... 42%%\n' > /tmp/survive_test/.logs/kiwix.log`
   → `active_log.line` equals `[DL] downloading wikipedia_en... 42%` (no escape codes).
4. `/status` in a browser shows the Downloads card with 7 rows and correct
   badges; badges update without reload when the progress file changes.
5. pylint ≥ 9.5; all smoke tests pass.
