# PLAN: Household sharing via merge-backup

> **Status: ✅ COMPLETED** — implemented, unit-tested, and verified end-to-end.

**Rank: 5 of 5.** Household/partner sharing is the ONE consensus must-have
(#6 in `docs/RESEARCH.md`) still completely absent — Monarch ships unlimited
collaborators, YNAB six seats, Goodbudget built its brand on it. Real-time
sync needs a backend this local-first app deliberately doesn't have; but the
backup pipeline (plain + encrypted, share sheet, file picker) already moves
complete datasets between devices. A **merge** import — instead of the
existing replace-only restore — gives couples a workable share-by-file loop
today and is the honest stepping stone toward real sync.

## Goal

A "Merge backup (household)" option next to Restore: pick a partner's backup
file (plain or encrypted), preview what would be added, and merge it
non-destructively — union by entity id, transaction dedupe by natural key,
local data always winning conflicts. Repeatable in both directions weekly
without ever duplicating or losing data.

## Exact files to touch

- `src/logic/merge.ts` — new PURE module:
  `planMerge(local: AppData, incoming: AppData) → MergePlan` and
  `applyMerge(local: AppData, plan: MergePlan) → AppData`, where `MergePlan`
  lists exactly what will be added:
  `{transactions: Transaction[], accounts: Account[], categories: Category[],
  groups: CategoryGroup[], goals: Goal[], bills: Bill[], rules: Rule[],
  budgetCells: {month, categoryId, amount}[], skipped: {duplicates: number,
  conflicts: number}}`.
- `src/store.ts` — action `mergeBackup(incoming: AppData) → MergePlan`
  (computes plan, applies in one `set()`, returns the plan for the summary).
- `src/screens/MoreScreen.tsx` — "Merge backup (household)" button; reuses
  `pickBackupFile`'s reading + decrypt path (extract that into a shared
  `readBackupFile()` helper returning `{name, data} | {error}`), then a
  preview/confirm card: "Add 214 transactions, 1 account, 2 categories ·
  skip 1,890 duplicates" with Merge/Cancel.
- `src/utils/backup.ts` — no format change; `parseBackup` is reused as-is.
- `src/logic/__tests__/merge.test.ts` — the heart of this plan.
- `e2e/drive-improvements.mjs` (or a new `drive-merge.mjs`) — two-dataset
  merge flow using exported files.
- `README.md` + `docs/RESEARCH.md` — household row moves to ✅ (with the
  honest "via shared backup files, not live sync" caveat).

## Merge semantics (exact, implement precisely)

For each collection, in this order (referential integrity):
1. **groups, categories, accounts, goals, bills, rules**: incoming entity with
   an id not present locally → added verbatim; id present locally → SKIP
   (local wins; count as conflict only if contents differ, else ignore).
2. **transactions**: skip if the id exists locally, OR if the natural key
   `date|amount|payee.toLowerCase()` exists locally (two devices record the
   same rent payment with different generated ids — the natural key is the
   only cross-device identity). Count natural-key skips as duplicates.
3. **budgets**: per (month, categoryId) cell — local cell absent or 0 →
   take incoming; both nonzero → keep local (count conflict).
4. **settings + schemaVersion**: always local; never merged.

## Step-by-step implementation order

1. Write `merge.test.ts` first (cases below), then `planMerge`/`applyMerge`
   to green. Everything else is plumbing.
2. Store action (single `set()`, returns plan).
3. Extract `readBackupFile()` from the current `pickBackupFile` so restore
   and merge share the picker + encrypted-detection + passphrase path — the
   PassphraseSheet flow must work identically for merge (stash a
   `pendingMergeDecrypt` alongside the existing `pendingDecrypt`, or add a
   `purpose: 'restore' | 'merge'` field to the existing state — prefer the
   field; two parallel state machines will drift).
4. Preview card + Merge button + result notify ("Merged 214 transactions…").
5. e2e: export a backup → mutate live data (add transaction X, delete
   nothing) → merge the exported file back → assert: X still present, no
   duplicates created (transaction count grew by exactly the earlier
   mutation), summary reported all-skipped; then a second merge of the same
   file is a no-op (idempotence on the UI path too).
6. Full verification battery.

## Edge cases a weaker model would miss

- **Both devices grow from the same seed**, so seed ids (`acct-check`,
  `cat-rent`, bill ids…) collide by construction — that's what makes
  local-wins-by-id safe and automatic for the common couple case. But
  post-seed entities use `newId()` = timestamp + counter + random — two
  devices can NOT collide there, which is why transactions need the natural
  key as a second identity. Do not "simplify" to id-only dedupe.
- **The natural key intentionally collides for genuinely distinct
  transactions** (two $4.50 coffees at the same shop on the same day from two
  partners). Accept the false-skip and say so in the preview copy ("identical
  same-day duplicates are skipped") — silently importing them reads as a bug
  report from every user who re-merges, which is the worse failure. This is
  the same tradeoff the statement importer already made; consistency wins.
- **Goals double-count cash.** `readyToAssign` subtracts `goals[].saved`; if
  both partners track the same "Emergency Fund" goal id from the seed, local
  wins and nothing changes — but a partner's NEW goal arrives with its saved
  amount and reduces RTA on this device even though the money may live in
  the partner's un-merged account. Surface merged-goal count prominently in
  the summary and document the caveat in the sheet copy; do not attempt to
  be clever about it.
- **Referential integrity ordering**: incoming transactions may reference
  incoming accounts/categories — add those collections FIRST (the plan's
  fixed order), and `applyMerge` must validate that every added transaction's
  accountId/categoryId resolves post-merge, dropping (and counting) orphans
  rather than adding rows that render as "Unknown account".
- **Splits (if PLAN-transaction-splits landed)**: merged transactions carry
  `splits` verbatim; the natural key still uses the parent totals — no
  special handling, but add one test so nobody "helpfully" dedupes per leg.
- **Archived flags**: an entity archived locally but active in the incoming
  file must STAY archived (local wins applies to the whole record, not
  per-field). Test it — per-field merging is the tempting wrong turn.
- **`paidMonths` on colliding bills**: local wins wholesale. A partner's
  payment mark for this month will NOT transfer — note it in the caveat copy
  ("bill paid-status doesn't merge") rather than unioning `paidMonths`,
  which would suppress local reminders based on remote claims.
- **Encrypted merge files**: the passphrase path must funnel through the SAME
  decrypt+parse code as restore — if step 3's `purpose` field is skipped and
  code is duplicated, the hostile-KDF clamp or the parseBackup validation
  will inevitably be missed on one path.
- **Do NOT bump `SCHEMA_VERSION`**; merge writes only existing shapes.
- **Idempotence is the product guarantee**: merging the same file twice must
  be a total no-op (plan with all-skips). It falls out of the semantics but
  pin it with both a unit test and the e2e step — this is what makes the
  weekly swap ritual safe.

## Acceptance criteria

1. Unit: disjoint datasets merge fully; identical datasets produce an
   all-skip plan (idempotence); natural-key transaction dedupe across
   different ids; budget cell rules (absent→take, conflict→local); orphan
   transactions dropped and counted; archived-stays-archived; goals/bills
   local-wins; a merge never mutates `settings`/`schemaVersion`; applying a
   plan twice equals applying once (associativity smoke).
2. e2e: the step-5 export→mutate→merge→no-duplicates→second-merge-noop flow,
   including one encrypted merge file, zero console errors.
3. Summary numbers shown to the user exactly equal the plan's counts.
4. `tsc --noEmit`, web export, full unit suite, all drives green.
