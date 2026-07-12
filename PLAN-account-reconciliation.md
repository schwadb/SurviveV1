# PLAN: Account reconciliation & cleared-balance workflow

**Rank: 4 of 5.** The data model already tracks `cleared` on every transaction
and the UI shows "● pending" badges — but nothing ever *uses* cleared state:
there is no cleared balance anywhere, no way to toggle cleared in the UI, and
no way to reconcile against a bank statement. Reconciliation is the mechanism
that makes users trust the numbers (a YNAB signature, praised in
`docs/RESEARCH.md`), and for a manual-first app trust in the numbers is the
whole product.

## Goal

Each account shows working (all transactions) and cleared balances; the
transaction form can toggle pending/cleared; an account "Reconcile" flow asks
for the real bank balance, compares it to the cleared balance, and on mismatch
offers a one-tap balance-adjustment transaction to close the gap.

## Exact files to touch

- `src/logic/budget.ts` — new `clearedBalance(data, accountId)` (opening +
  cleared transactions only). (If PLAN-performance-at-scale landed, also add
  `clearedBalanceByAccount` to the index — it's listed there already.)
- `src/components/forms.tsx` —
  - `TransactionForm`: a "Cleared" switch (defaults: existing value when
    editing; unchecked=pending when adding, matching current behavior).
  - New `ReconcileForm` sheet: shows account name, cleared balance, working
    balance, an "Actual bank balance" amount field, then either "✓ Matches —
    finish" (marks all this account's pending transactions cleared) or
    "Create adjustment of ±$X and finish".
- `src/screens/MoreScreen.tsx` — account rows show `cleared $X · working $Y`
  when they differ; account row gains a "Reconcile" affordance (long-press,
  mirroring the goal rows' tap/hold split, with the hint label updated).
- `src/store.ts` — new action `reconcileAccount(accountId, actualBalance)`:
  in ONE `set()`, mark all that account's transactions cleared and, if
  `actualBalance !== clearedBalance`, append an adjustment transaction
  `{payee: 'Balance adjustment', categoryId: null, amount: actualBalance -
  workingBalanceAfterClearing, cleared: true, date: todayIso()}`.
- `src/logic/__tests__/reconcile.test.ts` — unit tests.
- `e2e/drive-improvements.mjs` — reconcile flow with a deliberate $10 gap.
- `README.md` feature list + `docs/RESEARCH.md` map row (YNAB reconciliation).

## Step-by-step implementation order

1. `clearedBalance` + unit tests (trivial but pins the definition: pending
   transactions excluded, opening balance included).
2. Store action + tests — the adjustment math is where the bugs live; see
   edge cases before writing it.
3. TransactionForm cleared switch (remember the `seedKey` reset block).
4. ReconcileForm sheet + MoreScreen wiring (long-press account row).
5. e2e: account starts with pending seed transactions (the seed creates
   uncleared rows dated today) → reconcile Everyday Checking entering
   (cleared balance + $10) → assert a "Balance adjustment" transaction of the
   right sign exists in Activity and the account row now shows a single
   balance (cleared == working).
6. Full verification battery.

## Edge cases a weaker model would miss

- **The adjustment must be computed AFTER clearing pending transactions, not
  before.** Reconciling means "the bank says X and everything I've recorded
  is real": first mark pending → cleared (working balance becomes the new
  cleared balance), then adjust by `actual − working`. Computing the delta
  against the pre-clearing cleared balance double-counts every pending
  transaction — the classic reconciliation bug. Pin with a test: opening
  1000, cleared tx −200, pending tx −100, actual entered 700 → adjustment is
  0 (not −100).
- **Adjustment sign and account type**: for a credit card the "actual
  balance" is negative (user enters what the card app shows, e.g. −4,602.47
  → they'll type `-4602.47`). `parseAmount` already accepts a leading minus —
  the form copy must say "negative for debt", mirroring `AccountForm`.
- **The adjustment transaction is uncategorized on purpose** (`categoryId:
  null`): it represents untracked drift, and it will surface in the
  ❓ Uncategorized filter for the user to investigate — that is a feature;
  routing it to income would corrupt `incomeForMonth`, and to any envelope
  would corrupt activity. Document this in the sheet copy ("we'll file it as
  Uncategorized so you can find it").
- **Zero-value adjustments must not be created** — matching balances just
  clear pending rows.
- **`payBill` creates cleared transactions and statement import forces
  `cleared: true`** — only manually added transactions are pending. The
  reconcile e2e must therefore rely on the seed's two same-day uncleared
  rows or add a manual transaction first; do not "fix" the import to create
  pending rows.
- **Do NOT bump `SCHEMA_VERSION`** — no persisted shape changes at all here.
- **In My Pocket / Ready to Assign intentionally use working balances** —
  budget math should count pending spending you already know about.
  Reconciliation changes trust, not budget semantics; resist "improving" IMP
  to cleared-only while in here (if desired later, that's its own decision).
- **The MoreScreen account row currently opens `AccountForm` on tap** —
  long-press must be additive; update the row's hint text to
  "tap to edit · hold to reconcile" following the existing goal-row pattern
  so the affordance is discoverable.
- **`updateTransaction` already accepts a `cleared` patch** — no store change
  needed for the form switch; don't add a redundant action.

## Acceptance criteria

1. Unit: `clearedBalance` excludes pending; reconcile with matching balance
   clears all pending and creates no adjustment; reconcile with a gap creates
   exactly one cleared, uncategorized adjustment with the correct sign
   (both directions), and the account's cleared balance afterwards equals
   the entered actual; the pre/post-clearing ordering test from the edge
   cases; action is idempotent when repeated with the same actual balance.
2. e2e: the $10-gap flow passes; the adjustment row is visible under the
   ❓ Uncategorized filter; zero console errors.
3. TransactionForm can flip a pending row to cleared and the "● pending"
   badge disappears.
4. `tsc --noEmit`, web export, full unit suite, all drives green.
