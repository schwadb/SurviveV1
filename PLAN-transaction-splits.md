# PLAN: Split transactions

> **Status: ✅ COMPLETED** — implemented, unit-tested, and verified end-to-end.

**Rank: 3 of 5.** A YNAB/Monarch core feature the app lacks entirely (listed
under "features worth stealing" in `docs/RESEARCH.md`). Real statements demand
it: one Costco charge is groceries + household + fun. Without splits, users
must either miscategorize whole charges or fabricate fake transactions —
both corrupt envelope math, which is the product's spine.

## Goal

An expense transaction can be split across up to 8 categories with amounts
that must sum to the transaction total. Splits flow through every consumer:
envelope activity, reports donut, category filters, CSV export. Statement
import stays single-category (rules can't guess splits).

## Exact files to touch

- `src/types.ts` — `Transaction` gains
  `splits?: { categoryId: string | null; amount: number }[]` (optional — NO
  `SCHEMA_VERSION` bump). Invariant, documented on the field: when `splits`
  is present, `categoryId` is null and `sum(splits[].amount) === amount`.
- `src/logic/budget.ts` — `categoryActivity` and `spendingByCategory` learn to
  read splits (the ONLY two functions that map transactions→categories;
  `envelopeAvailable` composes `categoryActivity` and needs no change —
  verify, don't assume).
- `src/logic/derived.ts` (if PLAN-performance-at-scale landed) — the index's
  `activityByCatMonth` pass must expand splits too; otherwise skip.
- `src/store.ts` — `updateTransaction`/`addTransaction` unchanged (splits ride
  the patch); `applyRulesToExisting` must skip transactions with splits.
- `src/components/forms.tsx` — `TransactionForm` gains a "Split" toggle
  revealing 2–8 rows of {category chip picker, amount field} plus a live
  remainder line ("$4.18 left to split" / "over by $1.00"); Save is blocked
  until the remainder is exactly zero.
- `src/screens/TransactionsScreen.tsx` — split rows display
  `🔀 Split · N categories`; the category filter matches when ANY split leg
  matches; the uncategorized filter matches when any leg is null.
- `src/screens/HomeScreen.tsx` — recent-transactions `catName` shows the same
  split label.
- `src/utils/csv.ts` — export emits one row per split leg (same
  date/payee/account, leg amount, category, note `split 1/3`); a
  no-splits transaction exports exactly as today (golden-file stability).
- `src/logic/__tests__/budget.test.ts` — extend; new
  `src/logic/__tests__/splits.test.ts`.
- `e2e/drive-improvements.mjs` — add a split creation + filter assertion.

## Step-by-step implementation order

1. Add the type + write `splits.test.ts` FIRST against the intended behavior
   of `categoryActivity`/`spendingByCategory` (red), then implement (green):
   - a −10000 transaction split {A: −6000, B: −4000} contributes −6000 to A
     and −4000 to B for that month, and nothing to any other category;
   - `spendingByCategory` attributes 6000/4000 respectively;
   - a split with a null leg leaves that amount uncategorized.
2. Update the two budget.ts functions (and the derived index if present).
3. Store guards: `applyRulesToExisting` skips `t.splits`; add a
   `validateSplits` helper in `src/logic/budget.ts` (sum check, 2–8 legs,
   expense-only) used by the form.
4. TransactionForm split UI (the bulk of the work):
   - "Split across categories" toggle appears only in expense mode;
   - enabling seeds two legs: [current category or null with full amount, null
     with 0]; disabling collapses to a single category and DROPS the legs
     (confirm via the existing `notify` if legs were edited);
   - each leg: ChipPicker + amount Field; legs are stored as positive text and
     converted to negative cents on save (consistent with the main amount
     UX where users type positive numbers for expenses);
   - live remainder recomputes per keystroke from `parseAmount` of each leg.
5. List/filter/CSV updates; keep the split label OUT of the payee Text node
   (own Label line) so search on payee text is unaffected.
6. e2e: open the seeded 'Corner Bistro' transaction, split it 60/40 between
   Dining Out and Fun Money, save; assert the Budget screen's Dining Out
   spent drops by the moved 40% and Fun Money rises; filter by Fun Money in
   Activity and assert the split row appears.

## Edge cases a weaker model would miss

- **Signs.** The transaction amount is negative; legs are stored negative
  too (sum invariant in stored form: `sum(legs) === amount`). The form shows
  positives. Mixing conventions between storage and UI is the #1 bug here —
  the sum validator must operate on stored (negative) values.
- **Editing the total of an existing split** must invalidate the legs: if the
  user changes the amount while splits exist, the remainder line goes nonzero
  and Save stays blocked until legs are fixed — do NOT silently rescale legs
  proportionally (rounding makes the sum drift by ±1¢).
- **Income and splits don't mix** — the income toggle hides/clears splits
  (income routes to `INCOME_CATEGORY_ID` wholesale). A split income row would
  otherwise corrupt `incomeForMonth`, which filters on the income category.
- **Rules must never touch split transactions** — `applyRules` runs on add
  when `categoryId` is null; a split parent has null `categoryId` BY DESIGN,
  so both `addTransaction` (not applicable — splits are only created via
  edit/form save which passes explicit data) and `applyRulesToExisting`
  need the `t.splits` guard or a rule will stamp a category onto a split
  parent and it will be double-counted. Add a regression test for exactly
  this: rules pass over a split transaction leaves it untouched.
- **Import dedupe key is the parent's (date, amount, payee)** — unchanged and
  correct: re-importing a statement won't duplicate a transaction the user
  split, because splitting changes neither date, total, nor payee. State
  this in a test so a future "dedupe per leg" refactor gets caught.
- **`categoryActivity` is called in hot loops** (Budget screen per envelope) —
  the splits branch must not allocate (`for` over `t.splits` inline, no
  `.flatMap`), matching the existing code style and the perf plan's budget.
- **Filter semantics**: account filter is parent-level; category filter is
  leg-level; BOTH filters together must require the same transaction to match
  both (parent account AND any-leg category).
- **CSV re-import of a split export** creates N single-category transactions
  whose (date, amount, payee) keys differ from the parent (leg amounts) — so
  dedupe won't stop them. Document in the import sheet's helper text that
  re-importing your own split export duplicates data; don't try to be clever.
- **TransactionForm's `seedKey` reset block** must also reset split state when
  a different transaction opens, mirroring every other field — miss it and
  the previous transaction's legs leak into the next edit.

## Acceptance criteria

1. Unit: the red→green cases in step 1; `validateSplits` rejects sum
   mismatches, 1-leg and 9-leg splits, and positive-amount parents; rules
   skip split transactions; CSV golden test — a split emits N rows whose
   amounts sum to the parent and non-split output is byte-identical to
   before.
2. e2e: the step-6 flow passes with zero console errors; Budget numbers move
   exactly by the split proportions.
3. Persistence: a split transaction survives reload (covered by the existing
   reload step once the e2e edit happens before it, or add an explicit check).
4. `tsc --noEmit`, web export, all drives, full unit suite green.
