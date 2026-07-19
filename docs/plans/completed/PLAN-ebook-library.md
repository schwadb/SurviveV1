# PLAN-ebook-library: Make the E-Books service actually work end-to-end

**Rank: #4.**

## Goal

Calibre-Web (`cps`) is installed, has a systemd unit, a port (8083), an nginx
block, dashboard links everywhere — and **cannot work as configured**, because
`cps` requires a *Calibre library* (a `metadata.db` created by Calibre's
tools), while our config points `CALIBRE_DBPATH` at a plain directory of
loose EPUBs (`/mnt/survive/books`). A user clicking "E-Books" today gets
Calibre-Web's setup wizard error, not their books. This was found by tracing
the data flow — the service *starts*, so `make status` shows green, which is
exactly why it has gone unnoticed.

After this change: a new `scripts/build_ebook_library.sh` creates a real
Calibre library from every EPUB under `books/`, the service points at it, the
downloader keeps it in sync, and first-login credentials are documented.

## Exact files to touch

| File | Change |
|------|--------|
| `scripts/build_ebook_library.sh` | NEW — create/refresh the Calibre library |
| `setup/install.sh` | apt-install `calibre` (provides `calibredb`); call the build script |
| `systemd/calibre-web.service` | `CALIBRE_DBPATH=/mnt/survive/books/calibre-library` |
| `scripts/start_services.sh` | same path in the `calibre)` case; skip start if no `metadata.db` (warn with the fix command) |
| `download/books_pdfs.sh` | call the build script at the end (append-only mode) |
| `docs/TROUBLESHOOTING.md` | first-login setup + admin defaults section |
| `tests/test_smoke.sh` | not applicable (needs calibre) — see acceptance criteria for a standalone check |

## Implementation order

1. **`scripts/build_ebook_library.sh`** (follow the house style: `set -euo
   pipefail`, source `survive.conf`, color helpers):
   ```
   LIBRARY="$STORAGE_PATH/books/calibre-library"
   ```
   - If `calibredb` is missing: error with `sudo apt-get install -y calibre` hint, exit 1.
   - If `$LIBRARY/metadata.db` missing: `mkdir -p "$LIBRARY"` and initialize —
     `calibredb --with-library="$LIBRARY" list >/dev/null 2>&1 || true` does
     NOT create a library; the reliable way is to add the first book with
     `calibredb add --with-library="$LIBRARY" <file>` which auto-creates it.
     So: initialize implicitly via the bulk add below.
   - Bulk add, deduplicated:
     `find "$STORAGE_PATH/books" -path "$LIBRARY" -prune -o -type f \( -iname '*.epub' -o -iname '*.mobi' -o -iname '*.azw3' \) -print0 | xargs -0 -r calibredb add --with-library="$LIBRARY" --automerge=ignore --`
     (`--automerge=ignore` skips books already in the library → idempotent,
     safe to re-run after every download.)
   - Print the final count: `calibredb --with-library="$LIBRARY" list | wc -l`.
2. **`setup/install.sh`**: add `calibre` to the apt package list (NOT
   `calibre-bin`, which lacks `calibredb` on some builds). It is ~400 MB with
   deps on aarch64 — gate it behind the existing content-flag pattern:
   only install when `CONTENT_GUTENBERG` or a books flag is `Y`.
   After install, run `bash scripts/build_ebook_library.sh || true` (books
   may not be downloaded yet — the script must warn-and-exit-0 when it finds
   zero ebook files; use `-r` on xargs so an empty find is a no-op).
3. **`systemd/calibre-web.service`**: change
   `Environment="CALIBRE_DBPATH=/mnt/survive/books"` to
   `.../books/calibre-library`. Note: `CALIBRE_DBPATH` tells cps where its
   *app* db lives; the *library* location is chosen in the web UI on first
   run — set it non-interactively by passing the app settings db a default:
   simplest reliable approach is documenting first-run: log in
   (`admin` / `admin123`), set library path to
   `/mnt/survive/books/calibre-library`. Put this in TROUBLESHOOTING.md AND
   print it from `build_ebook_library.sh`'s success message.
4. **`scripts/start_services.sh`** `calibre)` case: point `CALIBRE_DBPATH` at
   the new path; before starting, `[[ -f "$STORAGE_PATH/books/calibre-library/metadata.db" ]]`
   else `warn "E-book library not built — run: bash scripts/build_ebook_library.sh"`
   and still start cps (the wizard is better than nothing).
5. **`download/books_pdfs.sh`**: append at the end of main:
   `command -v calibredb >/dev/null && bash "$REPO_DIR/scripts/build_ebook_library.sh" || true`.

## Edge cases a weaker model would miss

- **`find ... -prune`**: without pruning `$LIBRARY` itself, every re-run
  re-adds the library's own converted copies — infinite growth. The
  `-path "$LIBRARY" -prune -o` clause is load-bearing.
- **`--automerge=ignore`** is what makes re-runs idempotent. The default
  behavior creates duplicate records on every sync.
- **`xargs -r`**: zero EPUBs (fresh install) must be a clean no-op, not a
  `calibredb add` usage error that fails `set -e`.
- **Filenames with spaces/quotes**: `-print0 | xargs -0` is mandatory; the
  content downloads include titles like `Root Cellaring (Natural Storage).epub`.
- **calibredb cannot run while calibre-web holds the library open** — the
  build script must `systemctl stop calibre-web 2>/dev/null || true` before
  bulk-adding and restart it after, otherwise adds fail with a database-lock
  error only on systems where the service is running (works in dev, breaks
  in prod).
- **Disk**: the library duplicates each added book into its own folder
  structure. 18 GB of books → 36 GB total. Mention in the script's output;
  optionally `calibredb add --add-duplicates=false` does NOT dedupe content
  — `--automerge=ignore` is the correct flag pair.
- **User=pi in the unit** — the library dir must be owned by `pi`
  (`chown -R pi:pi "$LIBRARY"` at the end of the build script when running
  as root), or cps gets read-only sqlite errors.
- **PDFs stay out**: Calibre handles PDFs poorly on Pi RAM; the dashboard
  already serves PDFs natively via `/serve/`. Only index epub/mobi/azw3.

## Acceptance criteria

1. On a Pi (or any Debian box with `calibre` installed):
   `SURVIVE_STORAGE_PATH=/tmp/cal_test bash scripts/build_ebook_library.sh`
   with 3 sample EPUBs under `/tmp/cal_test/books/` creates
   `/tmp/cal_test/books/calibre-library/metadata.db` and prints "3".
2. Re-running the same command prints "3" again (idempotent, no duplicates).
3. Running with zero EPUBs exits 0 with a warning, not an error.
4. `systemctl start calibre-web` then `curl -sf localhost:8083 | grep -qi calibre` succeeds.
5. In a browser: log in at `:8083`, see all 3 books with covers, open one in
   the built-in reader, read past page 1.
6. After `bash download/books_pdfs.sh` completes, newly downloaded EPUBs
   appear in Calibre-Web without manual steps.
7. shellcheck (CI settings) passes on all touched scripts.
