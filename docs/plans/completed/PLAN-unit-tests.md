# PLAN-unit-tests: pytest suite for the server's pure logic

**Rank: #5.**

## Goal

Quality assurance is 23 black-box smoke assertions against a live server —
excellent for route contracts, blind to the logic that now carries the most
risk: FTS query sanitisation, RAG prompt budgeting, XML parsing of Kiwix
responses, download-status derivation, ANSI stripping, history validation
(once PLAN-chat-memory lands). Each recent feature was hand-verified with
ad-hoc scripts that were then thrown away; this plan turns those throwaway
harnesses into a permanent `pytest` suite wired into CI.

## Exact files to touch

| File | Change |
|------|--------|
| `tests/test_server_unit.py` | NEW — the suite |
| `tests/conftest.py` | NEW — env + import fixture |
| `requirements-dev.txt` | NEW — `pytest`, `pylint` |
| `.github/workflows/test.yml` | run pytest in the `python` job |
| `Makefile` | `unit` target; `test` becomes lint + unit + smoke |
| `CLAUDE.md` | test-commands section update |

## Implementation order

1. **`tests/conftest.py`** — the import problem is the whole trick here:
   `web/server.py` reads `SURVIVE_STORAGE_PATH` **at import time** and starts
   a daemon refresher thread on import. So:
   ```python
   import os, sys, pytest
   from pathlib import Path

   @pytest.fixture(scope="session")
   def server(tmp_path_factory):
       storage = tmp_path_factory.mktemp("storage")
       os.environ["SURVIVE_STORAGE_PATH"] = str(storage)
       sys.path.insert(0, str(Path(__file__).parent.parent / "web"))
       import server as srv          # first import happens HERE, after env is set
       return srv
   ```
   The refresher thread sleeps 60+ s before its first build, so it is inert
   for the life of the test run — do not try to kill it, just don't wait on it.
   Session scope: exactly one import; per-test module reloads re-run Flask
   route registration and explode with "View function mapping is overwriting".

2. **`tests/test_server_unit.py`** — grouped by feature, ~25 tests:
   - `_strip_html`: tags stripped, script/style contents dropped, whitespace
     collapsed, `<b>` highlight tags from Kiwix removed.
   - `_kiwix_path`: absolute URL → path+fragment; already-relative passthrough;
     empty/None-ish input.
   - `_build_rag_prompt`: empty articles → contains "No reference articles";
     with articles → numbered `[1]`, `[2]` lines and instruction sentence.
   - `_fts_sanitize`/`_query_search_index` inputs: syntax bomb `water AND "`,
     unicode, empty string, 200-char input — via a real
     `_rebuild_search_index()` against seeded files in the tmp storage
     (touch 5 files incl. `Where_There_Is_No_Doctor.pdf`), then assert
     "doctor" matches, prefix `doct` matches, bomb returns `[]`.
   - `_index_meta`: missing DB → `{built_at: None, count: 0}`; after rebuild
     → correct count.
   - `_compute_download_status`: no progress file → all pending; write
     `kiwix\n` + unknown line `garbage\n` → kiwix complete, garbage ignored;
     ANSI-laden log tail stripped (reuse the exact bytes from the round-1
     debug session); log > 500 bytes → only tail read (build a 10 KB log).
   - `_sources_for`: host substitution.
   - Flask test client (`server.app.test_client()`):
     `/serve/../../etc/passwd`-style traversal → 403/404, `/health` → 200,
     `/api/ai/chat` wrong content-type → 415, bad model name
     `../evil` → 400. (No Ollama/Kiwix needed — all pre-stream.)
   - Model-name regex: parametrize valid (`survive`, `gemma4:12b`,
     `a.b-c_d:1`) and invalid (`a/b`, 101 chars, empty, `a b`).
3. **`requirements-dev.txt`**: `pytest>=7`, `pylint>=3`. CI installs
   `-r requirements.txt -r requirements-dev.txt`.
4. **CI**: in the `python` job, after pylint, add
   `python -m pytest tests/ -q --tb=short`. pytest ignores
   `test_smoke.sh` automatically (not a .py file).
5. **Makefile**: `unit: ; python3 -m pytest tests/ -q` and chain
   `test: lint unit smoke`.

## Edge cases a weaker model would miss

- **Import-order trap**: importing `server` at module top of the test file
  runs before the env fixture — every test then indexes the developer's real
  `/mnt/survive` or repo `data/`. The lazy import inside the fixture is the
  entire reason conftest.py exists. Never `from server import X` at top level.
- **One import per session**: `importlib.reload(server)` re-registers routes
  on the same Flask app object → `AssertionError: View function mapping...`.
  Session-scoped fixture, not function-scoped.
- **The refresher thread + tmp_path**: pytest deletes tmp dirs at session
  end; if the run somehow exceeds ~60 s the thread's first build targets a
  still-existing dir (fine), but never assert on files the thread may create
  — tests must not race it. Keep the suite under a minute (it will be ~5 s).
- **`_TTLCache` pollution between tests**: `_downloads_cache` memoises for
  15 s — tests that mutate `.download_progress` must call the *compute*
  function directly (`_compute_download_status()`), never the cached wrapper.
  Same for content stats (60 s TTL): seed all files BEFORE the first call, or
  call `_compute_content_stats` directly.
- **Windows-style CRLF in progress files**: `read_text().splitlines()`
  handles `\r\n`; write one entry with `\r\n` in the test to lock that in.
- **CI has no `sqlite3` CLI** (discovered in round 1) — all DB assertions go
  through Python's `sqlite3` module, never `subprocess`.

## Acceptance criteria

1. `python3 -m pytest tests/ -q` → all pass, < 30 s, zero network access
   (run once with Wi-Fi off / in the CI sandbox to prove it).
2. `make test` runs lint → unit → smoke and exits 0.
3. CI workflow shows the pytest step green on the branch.
4. Deleting the body of `_ANSI_RE.sub` (mutation check) makes at least one
   test fail — i.e. the suite actually guards the ANSI stripping.
5. Existing smoke tests remain untouched and green (23/23).
