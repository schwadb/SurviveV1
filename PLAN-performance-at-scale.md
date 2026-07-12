# PLAN: Performance at real data volume

**Rank: 2 of 5.** Two latent defects bite as soon as a user accumulates real
history (a year of statements ≈ 2,000–10,000 transactions):

1. `src/screens/TransactionsScreen.tsx` renders **every transaction in a plain
   `ScrollView`** — no virtualization, so 10k rows means 10k mounted views.
2. Every derived number is recomputed by scanning the full transaction array on
   every render: `accountBalance` (per account), `categoryActivity`/
   `envelopeAvailable` (per envelope per month — the Budget screen is
   O(categories × transactions) *per render*), `readyToAssign`, `netWorth`,
   `netWorthSeries`. Typing in the search box re-runs all of it.

Defects outrank new features; this keeps the app usable for exactly the users
who adopt it hardest.

## Goal

Transactions list virtualized (SectionList); all screen-level derived numbers
served from a single-pass memoized index keyed on store references. Target:
smooth interaction with a 10,000-transaction dataset, verified by an e2e drive
against a large seed and a unit-level complexity guard.

## Exact files to touch

- `src/logic/derived.ts` — new: `buildIndex(data)` single pass over
  `data.transactions` producing:
  `balanceByAccount: Map<string, number>` (opening + sum),
  `clearedBalanceByAccount: Map<string, number>`,
  `activityByCatMonth: Map<string /* catId|month */, number>`,
  `activityByCatCumulative: Map<string /* catId|month */, number>` (for
  rollover envelopes), `incomeByMonth`, `spendingByMonth`,
  `countByPayee`. Plus `getIndex(data)`: module-level `WeakMap<Transaction[],
  Index>` cache keyed on the `transactions` array reference — valid because
  zustand state is immutably replaced, never mutated.
- `src/logic/budget.ts` — each public function gains an optional final
  `index?: Index` parameter and uses it when provided; the internal fallback
  stays the current full scan so the pure API and all existing tests remain
  valid unchanged.
- `src/screens/BudgetScreen.tsx`, `HomeScreen.tsx`, `ReportsScreen.tsx`,
  `MoreScreen.tsx` — compute `const index = getIndex(store)` once per render
  and thread it into the budget functions.
- `src/screens/TransactionsScreen.tsx` — replace the ScrollView+map with a
  `SectionList` (sections = existing date groups; header/search/filter row via
  `ListHeaderComponent`; `keyExtractor={(tx) => tx.id}`;
  `stickySectionHeadersEnabled={false}`); debounce the search input by ~150ms.
- `src/data/seed.ts` — export `makeLargeSeedData(txCount = 10000)` (wraps
  `makeSeedData`, then appends synthetic history across ~6 years) used by the
  perf test and an e2e hook: in `MoreScreen`'s danger zone, add a dev-only
  "Load 10k demo transactions" button gated on `__DEV__ === true` — e2e runs
  the dev export, so the drive can use it.
- `src/logic/__tests__/derived.test.ts` — equivalence + invalidation tests.
- `e2e/drive-scale.mjs` + registration in `e2e/run.mjs` — large-data smoke.

## Step-by-step implementation order

1. Write `buildIndex`/`getIndex` + tests proving **equivalence**: for a random
   fixture, every budget.ts function returns identical results with and
   without the index (property-style: loop 50 randomized fixtures).
2. Thread the optional index through `budget.ts` (mechanical; keep fallbacks).
3. Update the four screens to build the index once per render.
4. Convert TransactionsScreen to SectionList + debounced search.
5. Add `makeLargeSeedData`, the dev-only loader button, and the scale drive:
   load 10k, type in search (assert no dropped-frame crash and results
   appear), switch every tab, open the Budget month navigation twice.
6. Full verify: unit, tsc, export, all four drives.

## Edge cases a weaker model would miss

- **The WeakMap must key on `data.transactions` (the array), not `data`** —
  screens receive the whole store object whose identity changes on ANY action
  (including UI-only settings), but the transactions array reference only
  changes when transactions change. Keying on the wrong object either leaks
  or never caches. Account `openingBalance` edits change `accounts`, not
  `transactions` — so balances must be composed as
  `opening + txSumByAccount` with only the tx sums cached, or an opening-
  balance edit serves stale balances (test this exact case).
- **Rollover envelopes need the cumulative map**: `envelopeAvailable` for
  rollover categories sums ALL months ≤ month using the `\`${month}-99\``
  string-cutoff trick. Precompute cumulative activity per (cat, month) in the
  same single pass (running totals over sorted month keys) — recomputing
  cumulative from the per-month map inside each call reintroduces O(months)
  per envelope, which is fine, but iterating transactions again is not.
- **`readyToAssign` also reads `budgets` and `goals`** which are NOT covered
  by the transactions-keyed cache — pass them through live; only cache what
  transactions determine. Mixing cached and live inputs wrongly is the
  subtlest bug class here.
- **SectionList inside the old layout**: the current screen has a fixed header
  (title/search/filters) above the ScrollView. With SectionList, the fixed
  part must become `ListHeaderComponent` (or stay outside with
  `flex: 1` on the list) — nesting a SectionList inside a ScrollView disables
  virtualization entirely and RN warns; that "fix" silently recreates the bug.
- **Search must not filter inside `renderItem`** — filter into sections via
  `useMemo` on [transactions, query, filters]; the debounce goes on the query
  state, not on the TextInput value (the input must stay controlled and
  instant or typing visibly lags).
- **react-native-web supports SectionList** — no platform fork needed; but
  `getItemLayout` is an optimization trap here (variable row heights due to
  notes/two-line payees); omit it rather than lie about heights.
- **e2e text assertions change**: with virtualization, off-screen rows are NOT
  in the DOM. Existing drive steps that count `getByText('Market Change')`
  still pass only because matching rows render near the top after filtering —
  re-run all drives and fix any assertion that relied on off-screen rows
  being mounted (this WILL bite `drive-app`'s reload-persistence search step
  if the seed grows; keep the default seed size unchanged).
- **Do not bump `SCHEMA_VERSION`** — nothing here changes persisted shape.
- **`detectRecurringPayees` and reports** stay on the fallback path initially
  (Reports re-renders rarely); converting them is optional — say so in code
  comments rather than half-caching.

## Acceptance criteria

1. Equivalence tests: for randomized fixtures, indexed and non-indexed
   results are identical for `accountBalance`, `envelopeAvailable` (both
   regimes), `readyToAssign`, `incomeForMonth`, `spendingForMonth`,
   `netWorth`; plus the opening-balance-edit staleness case.
2. A timing guard (loose, CI-safe): building the index for 10k transactions
   plus computing the Budget screen's numbers for 8 envelopes completes in
   < 250ms in the vitest environment; the pre-change per-render cost pattern
   (8 envelopes × full scans) is documented in the test comment for contrast.
3. `e2e/drive-scale.mjs` passes: 10k loaded, search responsive, all tabs
   navigable, zero console errors.
4. All existing drives and the full unit suite stay green; `tsc --noEmit` and
   web export clean.
