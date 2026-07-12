# PLAN: Envelope targets + Auto-Assign

> **Status: ✅ COMPLETED** — implemented, unit-tested, and verified end-to-end.

**Rank: 3 of 5.** YNAB's "Targets" + "Auto-Assign" is its most-praised budgeting
mechanic (see `docs/RESEARCH.md`: PCMag highlights Auto-Assign; YNAB features
list "Targets" and "Category Templates"). The app already has "Copy last month";
targets make monthly budgeting one tap and give each envelope a goal amount that
the UI can mark as funded/underfunded.

## Goal

Each envelope can carry an optional **monthly target** (integer cents). The
Budget screen shows funded/underfunded state per envelope and gains an
**Auto-Assign** action that fills every under-target envelope up to its target,
in priority order, without ever assigning more than Ready to Assign allows.

## Exact files to touch

- `src/types.ts` — `Category` gains `monthlyTarget?: number` (cents; optional —
  no `SCHEMA_VERSION` bump, see edge cases).
- `src/logic/budget.ts` — new pure function:
  `planAutoAssign(data, month) → { categoryId, add: number }[]`.
- `src/store.ts` — new action `autoAssign(month) → {assigned: number, filled:
  number, shortfall: number}` that applies the plan atomically to
  `budgets[month]`.
- `src/components/forms.tsx` — `EnvelopeForm` gains a "Monthly target
  (optional)" amount field using the existing `parseAmount`.
- `src/screens/BudgetScreen.tsx` — "Auto-assign" pill next to "Copy last
  month"; per-envelope target chip: `🎯 $550` muted when met,
  `▲ $120 to go` in `t.warning` tone when under target.
- `src/data/seed.ts` — give the seed categories sensible `monthlyTarget`s equal
  to their existing budget amounts (so the demo shows the feature working).
- `src/logic/__tests__/autoassign.test.ts` — unit tests.
- `e2e/drive-improvements.mjs` — extend with an auto-assign step (if PLAN-test-
  suite-and-ci has landed; otherwise verify manually and note it).
- `README.md` + `docs/RESEARCH.md` feature map row.

## Step-by-step implementation order

1. Add `monthlyTarget?: number` to `Category`. Run `npx tsc --noEmit` — nothing
   else should break (optional field).
2. Write `planAutoAssign(data, month)` in `src/logic/budget.ts`:
   - Candidates: non-archived categories, `id !== INCOME_CATEGORY_ID`, with
     `monthlyTarget && monthlyTarget > 0`, ordered by group `sortOrder` then
     category `sortOrder` (same ordering the Budget screen renders).
   - For each: `deficit = monthlyTarget - assigned(data, cat.id, month)`;
     skip if `deficit <= 0`.
   - Budget pool: start from `readyToAssign(data, month)`; if pool <= 0 return
     `[]`. Allocate `add = min(deficit, remainingPool)`; stop when pool hits 0.
   - IMPORTANT: the pool must be decremented by each allocation as you go —
     recomputing `readyToAssign` inside the loop is wrong because the plan has
     not been applied to `data` yet.
3. Add the `autoAssign` store action: compute the plan from `get()`, then build
   the new `budgets[month]` map in ONE `set()` call (not one `assign()` per
   category — N separate sets cause N re-renders and interleave with
   subscriptions). Return `{assigned: totalAdded, filled: countFullyFilled,
   shortfall: totalRemainingDeficit}`.
4. `EnvelopeForm`: add the target field; empty string → `monthlyTarget:
   undefined` (do NOT store 0 — 0 would render an "on target" chip on every
   untargeted envelope; the seeding pattern for local state on `editingId`
   change must be extended, mirroring how `name`/`emoji`/`rollover` are
   re-seeded in the existing `seedKey` block).
5. Budget screen UI:
   - Under each envelope row's progress bar, if `monthlyTarget` present render
     the target chip (met: `✓ target $X` in `t.inkMuted`; under:
     `▲ fmt(deficit) to go` in `t.warning`). Text stays in ink tokens — the
     warning color only tints this status text, matching how overspent rows
     use `t.critical`.
   - "Auto-assign" pill: call the action, then surface the result through the
     same transient note used by "Copy last month" (`copied` state) — extend
     that state to a string message rather than adding a second mechanism, e.g.
     "auto-assigned $310.00 across 3 envelopes" or "· $85.00 short of targets"
     when `shortfall > 0`.
6. Seed: set `monthlyTarget` = the per-category amounts already used in
   `budgets` (165000 rent, 22000 utils, 6500 subs, 55000 groceries, 25000
   dining, 18000 transport, 15000 fun, 8000 health).
7. Typecheck, export web, run unit tests + drives; add the e2e step: in a fresh
   month (navigate `›`), tap Auto-assign, expect the note to appear and RTA to
   drop accordingly.

## Edge cases a weaker model would miss

- **Never bump `SCHEMA_VERSION`** — the persist `migrate()` resets to demo
  data. Optional fields on persisted objects rehydrate as `undefined`, which
  this design treats as "no target".
- **RTA can already be negative** (over-assigned). `planAutoAssign` must return
  `[]` when `readyToAssign <= 0`, never "fill targets and push RTA further
  negative".
- **Partial fill of the last envelope**: pool 100_00, deficit 250_00 → allocate
  100_00 exactly; RTA lands at 0, not negative. Off-by-one here is the most
  likely bug — pin with a test.
- **Goal reserves already reduce RTA** (`readyToAssign` subtracts
  `goals[].saved`), so auto-assign inherently cannot raid goal money. Don't
  "add it back".
- **Rollover envelopes**: target compares against `assigned(month)`, NOT
  `envelopeAvailable` — a rollover envelope with $400 carried over and a $100
  target still gets $100 assigned this month. This matches YNAB's "monthly
  refill" target type; document the semantic in the EnvelopeForm helper label
  ("Assign this much each month"). Comparing against available would make
  rollover envelopes silently skip funding — a subtle, plausible-looking bug.
- **Interaction with "Copy last month"**: copy fills only zero-assigned
  envelopes from the previous month; auto-assign tops up to targets. Both must
  remain idempotent: running auto-assign twice in a row assigns 0 the second
  time (test it).
- **Currency entry**: reuse `parseAmount` (`"550"` → 55000; rejects `1.234`).
  Storing dollars instead of cents in `monthlyTarget` would corrupt all math
  10⁻²× — the type comment says cents; keep the invariant.
- **Budget month navigation**: the Budget screen's `month` state can be a
  future month — auto-assign must operate on the displayed month, not
  `monthKey()` (pass `month` through; do not call `monthKey()` inside the
  action).
- **The transient result note must reset when the user navigates months**
  (`setMonth` should clear it) or it reports stale numbers on another month.

## Acceptance criteria

1. Unit tests (all against hand-built fixture `AppData`, not the live seed):
   - Pool ≥ total deficits → every under-target envelope reaches its target;
     sum of `add` equals total deficit; RTA after applying equals old RTA −
     total deficit.
   - Pool smaller than deficits → allocation follows group/category sortOrder,
     last envelope partially filled, remaining envelopes get 0, reported
     `shortfall` equals unfilled remainder.
   - RTA ≤ 0 → plan is `[]`.
   - Second consecutive run assigns 0 (idempotent).
   - Envelopes with `monthlyTarget` undefined or 0 are never touched.
2. `npx tsc --noEmit` clean; `npx expo export --platform web` builds.
3. In the running app (e2e or manual): August (empty month) → tap Auto-assign
   → RTA decreases by exactly the sum of seeded targets (or to 0 with a
   shortfall note), every envelope row shows `✓ target`, and tapping
   Auto-assign again changes nothing.
4. Editing an envelope, clearing the target field, and saving removes the chip.
