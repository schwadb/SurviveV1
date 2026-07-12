# PLAN-content-bundles: Tiered download bundles + live progress in the dashboard

**Rank: #5.** (Supersedes and absorbs the former PLAN-download-visibility.md.)

## Goal

Two coupled problems:

1. **All-or-nothing acquisition.** `download_all.sh` is tuned for the full
   800 GB build. A user with a 128 GB card has to hand-edit `CONTENT_*` flags
   in `survive.conf` to get a sane subset. Project NOMAD's tier picker
   (Essential / Standard / Comprehensive with a storage bar) is its
   most-praised onboarding feature; SurviveV1 has nothing comparable.
2. **Invisible progress.** The download runs for days, headless, in tmux. The
   dashboard — the product's face — shows nothing about the single longest
   operation a new user experiences.

After this change: three named bundles selectable from CLI
(`--bundle essential`) and from a dashboard card that also shows per-category
progress (complete / in progress / pending, size vs budget, last log line)
and can safely start/resume a bundle download from the browser.

## Exact files to touch

| File | Change |
|------|--------|
| `download/bundles/essential.env`, `standard.env`, `complete.env` | NEW — bundle definitions |
| `download/download_all.sh` | `--bundle <name>` flag; `flock` single-instance guard; index/progress invalidation |
| `web/constants.py` | `DOWNLOAD_CATEGORIES` and `BUNDLES` static lists |
| `web/server.py` | `/api/downloads` (status) + `/api/downloads/start` (trigger) |
| `web/templates/status.html` | Downloads card: bundle picker + per-category progress |
| `web/templates/index.html` | one-line summary in the Storage sidebar card |
| `tests/test_smoke.sh` | JSON + trigger-validation assertions |
| `CLAUDE.md` | document bundles and endpoints |

## Implementation order

### Phase A — visibility (no pipeline changes)

1. **`DOWNLOAD_CATEGORIES` in `web/constants.py`** — must mirror the literal
   first argument of each `run_category` call in `download_all.sh` (those
   strings are what `mark_done` writes to `.download_progress`): `kiwix`,
   `videos`, `books`, `maps`, `kolibri`, `gaps`, `mental_health`. Each entry:
   `{"id": "kiwix", "name": "Wikipedia & ZIM", "budget_gb": 190, "dir": "zim"}`
   (budgets from `print_budget()`; `dir` keys must exist in
   `_compute_content_stats`). Add a cross-referencing comment in BOTH files.

2. **`_compute_download_status()` in `web/server.py`**:
   - `.download_progress` → set of completed ids; missing file = empty set.
   - Sizes from `get_content_stats()` (already cached) — no new walks.
   - Status: `complete` if id in progress set; `in_progress` if its dir has
     `size_gb > 0`; else `pending`.
   - Last activity: newest file in `.logs/` by mtime; read only its final
     500 bytes (`f.seek(max(0, size-500))`), last non-empty line, strip ANSI
     with `re.sub(r"\x1b\[[0-9;]*m", "", line)`.
   - Wrap in a `_TTLCache(15.0)`; route `GET /api/downloads` returns it.

3. **`status.html`**: Downloads card between the budget gauge and the
   two-column grid — per-category status badge + thin progress bar
   (`width: {{ (size/budget*100)|round }}%`, capped with the `|min` pattern
   the budget gauge already uses). Extend the existing `refreshStatus()`
   poller to also fetch `/api/downloads` and update badges in place via
   `data-dl-cat` attributes. **The active log line must be set with
   `textContent`** — it contains arbitrary downloaded-file names.

4. **`index.html`** Storage card: `Downloads: <span id="dlSummary">…</span>`
   filled once on load → `"3/7 categories complete"`.

### Phase B — bundles

5. **Bundle env files** (`download/bundles/*.env`), sourced AFTER
   `survive.conf` so they override it:
   - `essential.env` (~25 GB): `CONTENT_WIKIPEDIA=N`,
     `CONTENT_WIKIPEDIA_NOPIC=Y`, medical ZIMs + iFixit + gaps PDFs on;
     `CONTENT_VIDEOS=N CONTENT_KOLIBRI=N CONTENT_GUTENBERG=N CONTENT_STACKEXCHANGE=N`.
   - `standard.env` (~250 GB): full Wikipedia, all ZIM, books, maps, PDFs;
     videos and Kolibri off.
   - `complete.env`: everything on (equivalent to today's defaults).
   Each file starts with a comment stating its approximate total, and the
   numbers must agree with `print_budget()`.

6. **`download_all.sh`**: parse `--bundle <name>`; validate
   `[[ "$name" =~ ^[a-z]+$ ]] && [[ -f "$REPO_DIR/download/bundles/$name.env" ]]`
   (reject anything else — this value later arrives from the web). Source
   the env file after the conf. Add a single-instance guard at the top of
   `main()`:
   ```bash
   exec 9>"$STORAGE_PATH/.download.lock"
   flock -n 9 || { error "Another download is already running"; exit 1; }
   ```

7. **`POST /api/downloads/start`** in `server.py` — follow the `ai_chat`
   security pattern exactly (`@csrf.exempt` + strict `application/json`
   Content-Type check), plus `@limiter.limit("3 per minute")`:
   - Validate `bundle` against a `BUNDLES` whitelist in `constants.py` —
     never interpolate the raw string into a command.
   - Refuse with 409 if `_compute_connectivity()["online"]` is false
     ("downloads need internet") or if the lock file is held (probe with a
     non-blocking `flock` attempt on the same path, immediately released).
   - Launch detached — prefer a transient systemd unit so the download
     survives dashboard restarts:
     ```python
     cmd = ["systemd-run", "--unit=survive-download", "--collect",
            f"--property=User={getpass.getuser()}",
            "bash", str(REPO_DIR / "download/download_all.sh"),
            "--bundle", bundle, "--resume"]
     ```
     Fallback when `systemd-run` is unavailable (dev/test):
     `subprocess.Popen([...], start_new_session=True, stdout=logfile,
     stderr=subprocess.STDOUT)` writing to `.logs/web_download.log`.
   - Return 202 with `{"started": bundle}`.

8. **`status.html` bundle picker**: three radio cards (name, size estimate,
   what's included) + Start button → `fetch('/api/downloads/start', ...)`;
   render the 202/409 result inline; the Phase-A poller takes over from
   there.

## Edge cases a weaker model would miss

- **Category-id coupling**: a mismatch between `DOWNLOAD_CATEGORIES` ids and
  the `run_category` strings silently shows "pending" forever. The paired
  comments are cheap insurance; the acceptance test covers one id end-to-end.
- **Detached child vs. cgroup kill**: a plain `Popen` child — even with
  `start_new_session=True` — lives in the dashboard service's cgroup, so
  `systemctl restart survive-dashboard` (or the new `--max-requests` worker
  recycling combined with a service restart) **kills the multi-day
  download**. That is why `systemd-run` is the primary path, not an
  optimization. `--collect` prevents failed-unit litter.
- **`pgrep -f download_all.sh` is the wrong "already running" check** — it
  matches an editor with the file open (the same bug class just fixed in
  `stop_services.sh`). The `flock` probe on `.download.lock` is race-free
  and matches what the script itself holds.
- **Log tail reading**: yt-dlp logs reach hundreds of MB. Never `read()` the
  whole file; seek-to-end-minus-500 is mandatory.
- **ANSI escape codes** in log lines (all scripts colorize) must be stripped
  server-side or the UI shows `\x1b[0;34m` garbage.
- **Categories sharing a directory** (`gaps` and `mental_health` both write
  into `pdfs/`): accept the approximation — the progress file is
  authoritative for `complete`; do not invent per-file attribution.
- **Bundle switching after partial download**: `.download_progress` entries
  from an `essential` run legitimately carry over to `standard` (same
  category ids, `--resume` semantics). Document in the picker UI: "already
  downloaded categories are kept."
- **Fresh install / smoke-test env** (no storage dirs, no progress file, no
  logs): `/api/downloads` must return valid JSON with all categories
  `pending` and `active_log: null`; `/api/downloads/start` in the test env
  (offline) must return 409, which is exactly what the smoke test asserts —
  the test env must never actually start an 800 GB download.
- **`getpass.getuser()` under systemd** returns the service user (`pi`) —
  correct, since the storage tree is owned by `pi`. Do not hardcode `pi`;
  dev setups differ.

## Acceptance criteria

1. Smoke test: `GET /api/downloads` returns valid JSON with 7 categories all
   `pending` in the bare env; `POST /api/downloads/start` with
   `{"bundle":"essential"}` returns 409 offline, and with
   `{"bundle":"../evil"}` returns 400.
2. `echo kiwix >> /tmp/survive_test/.download_progress` → within 15 s
   (cache TTL) `/api/downloads` shows kiwix `complete`.
3. Fake log with ANSI codes → `active_log.line` comes back clean.
4. `bash download/download_all.sh --bundle essential --dry-run` prints a
   budget table consistent with `essential.env` (~25 GB of items enabled);
   `--bundle nonsense` exits non-zero.
5. Two concurrent `download_all.sh --dry-run` runs: the second exits with
   "Another download is already running".
6. On a Pi: start `essential` from the browser, `systemctl restart
   survive-dashboard`, confirm `systemctl status survive-download` shows the
   download still running.
7. shellcheck + all smoke tests pass; pylint ≥ 9.5.
