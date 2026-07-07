# PLAN: Debt payoff planner (avalanche / snowball)

**Rank: 4 of 5.** Explicit v1 roadmap item (`docs/RESEARCH.md` last paragraph)
and a signature paid feature of two competitors: PocketGuard Plus's "Debt
Payoff Plan" and YNAB's "Loan Calculator" (interest/time saved from extra
payments). The app already models credit/loan accounts with negative balances —
this plan makes them actionable.

## Goal

A "Debt payoff" section (More tab) that takes the user's debt accounts, their
APRs and minimum payments, plus a monthly extra-payment amount, and simulates
avalanche (highest APR first) vs snowball (smallest balance first): debt-free
date, total interest paid, and a payoff curve — with a strategy toggle showing
the interest/time difference between the two.

## Exact files to touch

- `src/types.ts` — `Account` gains `aprBps?: number` (annual rate in **basis
  points**, e.g. 2499 = 24.99% — integer, consistent with cents-everywhere) and
  `minPayment?: number` (cents/month).
- `src/components/forms.tsx` — `AccountForm`: when `accountType` is `credit` or
  `loan`, show "APR %" and "Minimum payment" fields (APR entered as `"24.99"`,
  stored ×100 as bps; reuse `parseAmount` for both — it already yields ×100).
- `src/logic/debt.ts` — new PURE module:
  `simulatePayoff(debts: {id, name, balance, aprBps, minPayment}[], extra:
  number, strategy: 'avalanche'|'snowball') → {months: number, totalInterest:
  number, debtFreeIso: string | null, curve: number[], neverPaysOff: boolean,
  perDebt: {id, payoffMonth: number}[]}`.
- `src/screens/MoreScreen.tsx` — "Debt payoff" card between "Savings goals" and
  "Recurring bills": total debt, strategy pills (Avalanche/Snowball), extra
  payment input, results (debt-free date, total interest, "avalanche saves $X
  vs snowball"), and the payoff curve rendered with the existing `TrendLine`
  from `src/components/charts.tsx`.
- `src/data/seed.ts` — Rewards Card gets `aprBps: 2499, minPayment: 3500`; add
  no new accounts (the card's ≈ −$4,600 balance is enough to demo).
- `src/logic/__tests__/debt.test.ts` — unit tests with hand-computed cases.
- `README.md` + `docs/RESEARCH.md` — move the item from roadmap to features.

## Step-by-step implementation order

1. Add the two optional `Account` fields (no `SCHEMA_VERSION` bump — optional
   fields rehydrate as `undefined`; bumping wipes user data to demo via
   `migrate()`).
2. Write `simulatePayoff` (the core; everything else is presentation):
   - Normalize inputs: work on positive balances internally
     (`balance = -accountBalance` for debt accounts); drop debts with
     balance ≤ 0.
   - Monthly loop, capped at 600 iterations:
     a. Interest per debt: `round(balance * aprBps / 12 / 10000)` — integer
        cents, rounded per debt per month.
     b. Payment pool this month: `sum(minPayment of open debts) + extra`.
     c. Pay each open debt its `minPayment` first (capped at its balance +
        this month's interest); remainder of the pool goes to the single
        priority debt — avalanche: highest `aprBps` (tie → larger balance);
        snowball: smallest balance (tie → name asc, for determinism).
     d. A debt reaching 0 rolls its freed `minPayment` into the pool from the
        NEXT month (classic snowball mechanics — same month rollover
        double-counts; this is the subtle correctness point).
     e. Append `sum(balances)` to `curve` after payments.
   - If after any month total balance did not decrease and pool ≤ total
     interest, set `neverPaysOff: true` and stop early.
   - `debtFreeIso`: `addMonths(monthKey(), months)` + `-01`; null when
     `neverPaysOff`.
3. Unit-test with hand-checkable numbers (below) before touching UI.
4. `AccountForm` fields: APR text `"24.99"` → `parseAmount` → 2499 bps; empty →
   undefined. Same local-state re-seed pattern (`seedKey`) as existing fields.
5. MoreScreen card: derive `debts` from accounts where
   `isCredit(a) && accountBalance < 0` (helper `isCredit` already exists in
   `src/logic/budget.ts`); extra-payment input via `parseAmount` with `$100`
   default; render both strategies' simulations to show the savings delta;
   curve via `TrendLine` with month labels every k-th point (TrendLine renders
   one label per point — pass at most 6 sampled points/labels, e.g. every
   `ceil(months/6)`th, or the x-axis becomes unreadable).
6. Typecheck, export, tests, drives; extend the improvements drive: the card
   renders, switching strategy changes the interest number, an account with no
   APR shows the "add APR" prompt.

## Edge cases a weaker model would miss

- **Integer-cents rounding order matters.** Round interest per debt per month
  (`Math.round`), then add — computing float interest across the horizon and
  rounding once drifts from real card statements and makes tests flaky.
- **Basis points, not floats.** Storing `apr: 0.2499` invites float drift and
  violates the codebase's integer-money invariant; `aprBps` keeps everything
  integer. UI converts at the edge only.
- **Minimum payments below monthly interest** → balance grows forever. Without
  the `neverPaysOff` guard the loop runs to the 600 cap and reports a bogus
  50-year plan; the UI must show "These payments never pay off <name> — raise
  the minimum or extra payment" (use `t.critical` text + icon, matching the
  status-color rules in `src/theme.ts`).
- **Final-payment overshoot**: cap each payment at `balance + interest` or the
  last month overpays and `totalInterest`/curve go negative.
- **Freed minimums roll forward next month, not the same month** (step 2d) —
  the classic off-by-one that overstates how fast snowball finishes.
- **Credit accounts keep receiving new spending** in this app. The simulation
  is a snapshot of current balances — say so in a caption ("assumes no new
  spending"), don't try to model future transactions.
- **`accountBalance` is computed** (opening + transactions), not stored — use
  it, not `openingBalance`, or the simulation ignores every recorded payment.
- **Zero-debt state**: all credit balances ≥ 0 → render the empty-state line
  ("No debt — nice. 🎉"), not an empty chart (TrendLine returns null for < 2
  points, which would silently render nothing).
- **Missing APR**: a credit account with a negative balance but no `aprBps`
  should be listed with an "APR needed" hint and excluded from simulation —
  silently assuming 0% understates interest and misleads.
- **Determinism for tests**: tie-break rules (2c) must be fixed; otherwise
  avalanche/snowball tests with equal APRs flap.

## Acceptance criteria

1. Unit tests (hand-computed, fixture data — never the live seed):
   - Single debt $1,000.00 at 0% APR, $100 min, $0 extra → exactly 10 months,
     `totalInterest === 0`, curve strictly decreasing to 0.
   - Single debt 100000¢ at 1200 bps (1%/mo), min 10000¢: month-1 interest is
     exactly 1000¢; verify months and interest against a hand-run of 2–3
     iterations.
   - Two debts (A: 24% APR small balance, B: 12% APR large balance):
     avalanche's priority is A only if A has the higher APR — construct so
     avalanche and snowball pick DIFFERENT debts, then assert avalanche total
     interest ≤ snowball's, and both finish.
   - Min payment 100¢ < month-1 interest → `neverPaysOff === true`, loop exits
     well before 600 iterations.
   - Payoff month payment doesn't overshoot: final curve value is exactly 0.
2. `npx tsc --noEmit` clean; web export builds; existing drives unaffected.
3. In the app: Rewards Card (seeded APR) shows in the Debt payoff card; extra
   payment $100 → avalanche and snowball both render a debt-free date and the
   "saves $X" comparison line; clearing the APR in AccountForm moves the card
   into the "APR needed" state.
