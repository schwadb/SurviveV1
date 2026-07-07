# PLAN: Test suite + CI for Survive Budget

**Rank: 1 of 5 (do this first).** Every other plan builds features on top of
`src/logic/` and `src/utils/`; today those have zero committed tests. The three
Playwright drives that verified the app live only in an ephemeral scratchpad and
are not in the repo. This plan is the multiplier that de-risks all other work.

## Goal

1. Unit tests (vitest) for every pure module: `src/logic/budget.ts`,
   `src/utils/money.ts`, `src/utils/dates.ts`, `src/utils/csv.ts`,
   `src/utils/ofx.ts`, `src/utils/backup.ts`, plus `src/data/seed.ts` invariants.
2. Committed end-to-end drives (Playwright) runnable via `npm run e2e`.
3. GitHub Actions workflow running typecheck + unit tests + web export on every
   push to `claude/budgeting-app-research-build-qbwbm1` and every PR targeting
   `budgeting-app-base`.

## Exact files to touch

- `package.json` — add devDeps `vitest`, `playwright`, `serve`; add scripts:
  `"test": "vitest run"`, `"test:watch": "vitest"`,
  `"typecheck": "tsc --noEmit"`,
  `"e2e": "node e2e/run.mjs"`.
- `vitest.config.ts` — new.
- `src/logic/__tests__/budget.test.ts` — new.
- `src/utils/__tests__/money.test.ts`, `dates.test.ts`, `csv.test.ts`,
  `ofx.test.ts`, `backup.test.ts` — new.
- `e2e/drive-app.mjs`, `e2e/drive-import.mjs`, `e2e/drive-improvements.mjs` —
  new (ported from the session scratchpad; the flows are described below in
  acceptance criteria so they can be rewritten from scratch).
- `e2e/fixtures/sample-statement.qfx`, `e2e/fixtures/sample-statement.csv` — new.
- `e2e/run.mjs` — new orchestrator: `expo export --platform web`, start
  `serve -l 4173 dist`, run the three drives, kill server, exit non-zero if any
  drive reported errors.
- `.github/workflows/budget-ci.yml` — new.
- `README.md` — replace the "Verification" section's manual description with the
  npm commands.

## Step-by-step implementation order

1. `npm install -D vitest` (do NOT install jest/jest-expo — the modules under
   test import no React Native code, so the RN preset is unnecessary weight).
2. Create `vitest.config.ts`:
   ```ts
   import { defineConfig } from 'vitest/config';
   export default defineConfig({
     test: { include: ['src/**/__tests__/**/*.test.ts'], environment: 'node' },
   });
   ```
3. Write unit tests module by module (cases listed under acceptance criteria).
   Run `npx vitest run` after each file.
4. Port the three Playwright drives into `e2e/`, changing the hardcoded
   scratchpad paths (`SC`, `SHOTS`) to `new URL('.', import.meta.url).pathname`
   -relative paths, and screenshot output to `e2e/screenshots/` (gitignore it).
5. Write `e2e/run.mjs`: spawn `npx serve -l 4173 dist` with `child_process`,
   poll `http://localhost:4173/` until HTTP 200 (max 15s), run each drive with
   `node`, aggregate exit codes, always kill the server in a `finally`.
6. Add the GitHub Actions workflow (unit + typecheck + export only — CI has no
   browser cached; e2e stays a local/manual command):
   ```yaml
   name: budget-ci
   on:
     push:
       branches: ['claude/budgeting-app-research-build-qbwbm1']
     pull_request:
       branches: ['budgeting-app-base']
   jobs:
     ci:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: 22, cache: npm }
         - run: npm ci
         - run: npx tsc --noEmit
         - run: npx vitest run
         - run: npx expo export --platform web
   ```
7. Update README, commit, push, confirm the workflow runs green on GitHub.

## Edge cases a weaker model would miss

- **Seed data is date-relative.** `makeSeedData()` generates transactions
  relative to "today" (`monthKey()`/`todayIso()` call `new Date()`), so any test
  asserting absolute numbers against the seed will break on month boundaries.
  Tests must either build their own small fixture `AppData` objects or assert
  invariants (e.g. "every transaction's category exists") rather than totals.
- **Money is integer cents; expenses negative, income positive.** Fixture
  amounts like `-4.50` are wrong; use `-450`.
- **`envelopeAvailable` has two regimes.** Non-rollover: assigned(month) +
  activity(month). Rollover: cumulative assigned over ALL months ≤ month plus
  cumulative activity where `t.date <= \`${month}-99\`` — the `-99` suffix is a
  deliberate string-comparison trick to include every day of that month. Write
  a test for a rollover envelope spanning two months (leftover carries) and a
  non-rollover one (it resets).
- **`readyToAssign` clamps negative envelopes to zero** (`Math.max(0, …)`) and
  subtracts goal reserves. An overspent envelope must NOT increase RTA — test it.
- **`INCOME_CATEGORY_ID` ('cat-income') is special**: archived in seed, excluded
  from envelope math and `spendingByCategory`. A fixture that categorizes an
  expense as income will silently skew income tests.
- **OFX is SGML, not XML** — tags like `<TRNAMT>-4.50` have no closing tag. The
  parser reads to next `<` or newline. Test both OFX 1.x (unclosed) and a
  `</STMTTRN>`-closed variant; also `DTPOSTED` with timezone suffix
  `20260701120000.000[-5:EST]` and an invalid month (`20261301` → row error).
- **CSV parser accepts `M/D/YYYY` and 2-digit years** (`normalizeDate`), quoted
  fields with embedded commas and doubled quotes (`splitCsvLine`). Test
  `"Smith, John's ""Store"""`.
- **`parseAmount` rejects lone `-` and `.`** but accepts `$1,200` — keep those
  cases; they guard the transaction form.
- **`fmt` compact branch** was fixed once already ($100k rendered as $1.0M);
  pin it: `fmt(100_000_00, {compact:true})` must NOT contain `M`, and
  `fmt(1_500_000_00, {compact:true})` === `$1.5M`.
- **Playwright selector traps** (encode into drive comments so future edits
  don't regress): RN `Switch` renders as `input[type=checkbox]`, so never use
  bare `page.locator('input')` for text fields — use
  `input:not([type="checkbox"])` or placeholders; text selectors match elements
  BEHIND open modals (budget rows, filter chips, date group headers like
  "Yesterday"), so scope with `page.getByRole('dialog')` and prefer `.last()`
  inside sheets; web alerts are `window.alert` → register a `page.on('dialog')`
  handler that accepts, or every notify blocks the run.
- **`dist/` and `e2e/screenshots/` must stay gitignored** — `dist/` is already
  in `.gitignore`; add the screenshots dir, or CI diffs get noisy.
- **Do not bump `SCHEMA_VERSION`** for any of this — bumping it triggers the
  persist `migrate()` which resets users to demo data.

## Acceptance criteria

1. `npx vitest run` exits 0 with ≥ 40 assertions across ≥ 6 test files,
   including at minimum: rollover vs non-rollover envelope math, RTA clamping,
   `inMyPocket` subtracting only bills with `categoryId === null`,
   `netWorthSeries` month-end cutoffs, dedupe key behavior of
   `importTransactions` (via a store-free reimplementation test or by testing
   the key format on fixtures), OFX SGML + timezone dates, CSV quoting,
   `parseBackup` rejecting `{hello:'world'}` and future `schemaVersion`,
   `fmt`/`fmtShort`/`parseAmount` round-trips.
2. `npx tsc --noEmit` still exits 0.
3. `npm run e2e` exits 0 locally: drive-app (all 5 tabs, add/search/persist
   transaction, assign, move money, mark bill paid, goal contribution, dark
   mode, reload persistence), drive-import (QFX import of 3 rows, re-import
   skips 3 duplicates, CSV import auto-categorizes SHELL to Transport),
   drive-improvements (uncategorized filter, Yesterday chip, over-move blocked,
   copy-last-month, backup export → clear-all → restore round-trip, invalid
   backup rejected) — each printing `"errors": []`.
4. The `budget-ci` workflow shows a green run on GitHub for the branch.
