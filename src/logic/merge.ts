import {
  Account, AppData, Bill, Category, CategoryGroup, Goal, Rule, Transaction,
} from '../types';

// Non-destructive household merge: fold a partner's backup into local data.
// Entities union by id (local wins on collision); transactions dedupe by id AND
// by the natural key (date|amount|payee) so the same rent payment recorded on
// two devices with different generated ids isn't duplicated; budget cells take
// incoming only where local is empty. settings/schemaVersion never merge.
//
// Idempotent by construction: merging the same file twice is a total no-op.

export interface MergePlan {
  accounts: Account[];
  groups: CategoryGroup[];
  categories: Category[];
  goals: Goal[];
  bills: Bill[];
  rules: Rule[];
  transactions: Transaction[];
  budgetCells: { month: string; categoryId: string; amount: number }[];
  skipped: { duplicates: number; conflicts: number; orphans: number };
}

const natKey = (t: { date: string; amount: number; payee: string }) =>
  `${t.date}|${t.amount}|${t.payee.toLowerCase()}`;

/** Incoming items whose id is new locally; collisions with differing content bump `conflicts`. */
function additionsById<T extends { id: string }>(
  local: T[], incoming: T[], conflicts: { n: number },
): T[] {
  const byId = new Map(local.map((x) => [x.id, x]));
  const adds: T[] = [];
  for (const item of incoming) {
    const existing = byId.get(item.id);
    if (!existing) adds.push(item);
    else if (JSON.stringify(existing) !== JSON.stringify(item)) conflicts.n++;
  }
  return adds;
}

export function planMerge(local: AppData, incoming: AppData): MergePlan {
  const conflicts = { n: 0 };
  // Referential order: entities transactions may reference come first.
  const groups = additionsById(local.groups, incoming.groups, conflicts);
  const categories = additionsById(local.categories, incoming.categories, conflicts);
  const accounts = additionsById(local.accounts, incoming.accounts, conflicts);
  const goals = additionsById(local.goals, incoming.goals, conflicts);
  const bills = additionsById(local.bills, incoming.bills, conflicts);
  const rules = additionsById(local.rules, incoming.rules, conflicts);

  const localTxIds = new Set(local.transactions.map((t) => t.id));
  const localKeys = new Set(local.transactions.map(natKey));
  let duplicates = 0;
  const candidateTx: Transaction[] = [];
  for (const t of incoming.transactions) {
    if (localTxIds.has(t.id) || localKeys.has(natKey(t))) { duplicates++; continue; }
    candidateTx.push(t);
  }

  // Drop transactions that reference an account/category present in neither the
  // local data nor the additions — they would render as "Unknown".
  const accountIds = new Set([...local.accounts, ...accounts].map((a) => a.id));
  const categoryIds = new Set([...local.categories, ...categories].map((c) => c.id));
  let orphans = 0;
  const transactions: Transaction[] = [];
  for (const t of candidateTx) {
    if (!accountIds.has(t.accountId)) { orphans++; continue; }
    if (t.categoryId !== null && !categoryIds.has(t.categoryId)) { orphans++; continue; }
    transactions.push(t);
  }

  // Budget cells: take incoming only where local is empty; both-nonzero-and-differ
  // is a conflict (local wins). Equal values are not a conflict.
  const budgetCells: MergePlan['budgetCells'] = [];
  for (const [month, cats] of Object.entries(incoming.budgets)) {
    for (const [categoryId, amount] of Object.entries(cats)) {
      if (amount === 0) continue;
      const localAmt = local.budgets[month]?.[categoryId] ?? 0;
      if (localAmt === 0) budgetCells.push({ month, categoryId, amount });
      else if (localAmt !== amount) conflicts.n++;
    }
  }

  return {
    accounts, groups, categories, goals, bills, rules, transactions, budgetCells,
    skipped: { duplicates, conflicts: conflicts.n, orphans },
  };
}

export function applyMerge(local: AppData, plan: MergePlan): AppData {
  const budgets: AppData['budgets'] = { ...local.budgets };
  for (const cell of plan.budgetCells) {
    budgets[cell.month] = { ...(budgets[cell.month] ?? {}), [cell.categoryId]: cell.amount };
  }
  return {
    ...local, // settings + schemaVersion stay local
    groups: [...local.groups, ...plan.groups],
    categories: [...local.categories, ...plan.categories],
    accounts: [...local.accounts, ...plan.accounts],
    goals: [...local.goals, ...plan.goals],
    bills: [...local.bills, ...plan.bills],
    rules: [...local.rules, ...plan.rules],
    transactions: [...local.transactions, ...plan.transactions],
    budgets,
  };
}

/** Human summary of what a merge will add, for the confirm card. */
export function mergeSummary(plan: MergePlan): string {
  const parts: string[] = [];
  const push = (n: number, one: string, many: string) => { if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`); };
  push(plan.transactions.length, 'transaction', 'transactions');
  push(plan.accounts.length, 'account', 'accounts');
  push(plan.categories.length, 'category', 'categories');
  push(plan.goals.length, 'goal', 'goals');
  push(plan.bills.length, 'bill', 'bills');
  push(plan.budgetCells.length, 'budget', 'budgets');
  const added = parts.length ? `Add ${parts.join(', ')}` : 'Nothing new to add';
  const skips: string[] = [];
  if (plan.skipped.duplicates) skips.push(`${plan.skipped.duplicates} duplicate${plan.skipped.duplicates === 1 ? '' : 's'}`);
  if (plan.skipped.conflicts) skips.push(`${plan.skipped.conflicts} conflict${plan.skipped.conflicts === 1 ? '' : 's'} (kept local)`);
  if (plan.skipped.orphans) skips.push(`${plan.skipped.orphans} orphan${plan.skipped.orphans === 1 ? '' : 's'}`);
  return skips.length ? `${added} · skip ${skips.join(', ')}` : added;
}
