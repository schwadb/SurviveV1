import { AppData, Account, Category, Transaction, INCOME_CATEGORY_ID } from '../types';
import { addMonths, lastMonths, monthKey, monthKeyOfIso, todayIso } from '../utils/dates';
import { TxIndex, cumulativeActivity, forEachCategoryLeg } from './derived';

// Every screen-level function takes an optional TxIndex. When provided it
// answers from the single-pass summary (O(1)/O(months) instead of O(tx)); when
// omitted it falls back to a full scan, so the pure API and all unit tests keep
// working unchanged. Indexed and non-indexed results are equivalence-tested.

export function accountBalance(data: AppData, accountId: string, index?: TxIndex): number {
  const acct = data.accounts.find((a) => a.id === accountId);
  if (!acct) return 0;
  if (index) return acct.openingBalance + (index.txSumByAccount.get(accountId) ?? 0);
  let bal = acct.openingBalance;
  for (const t of data.transactions) if (t.accountId === accountId) bal += t.amount;
  return bal;
}

export function netWorth(data: AppData, index?: TxIndex): { assets: number; liabilities: number; total: number } {
  let assets = 0;
  let liabilities = 0;
  for (const a of data.accounts) {
    if (a.archived) continue;
    const bal = accountBalance(data, a.id, index);
    if (bal >= 0) assets += bal;
    else liabilities += -bal;
  }
  return { assets, liabilities, total: assets - liabilities };
}

/** Sum spent (signed activity) for a category within a month; splits expand to legs. */
export function categoryActivity(data: AppData, categoryId: string, month: string, index?: TxIndex): number {
  if (index) return index.activityByCatMonth.get(`${categoryId}|${month}`) ?? 0;
  let sum = 0;
  for (const t of data.transactions) {
    if (monthKeyOfIso(t.date) !== month) continue;
    forEachCategoryLeg(t, (legCat, amount) => {
      if (legCat === categoryId) sum += amount;
    });
  }
  return sum;
}

export function assigned(data: AppData, categoryId: string, month: string): number {
  return data.budgets[month]?.[categoryId] ?? 0;
}

/**
 * Envelope available balance for a month.
 * Rollover envelopes (Goodbudget-style) carry every prior month's leftover;
 * non-rollover categories reset each month (classic monthly budget).
 */
export function envelopeAvailable(data: AppData, cat: Category, month: string, index?: TxIndex): number {
  if (!cat.rollover) return assigned(data, cat.id, month) + categoryActivity(data, cat.id, month, index);
  let total = 0;
  for (const [m, cats] of Object.entries(data.budgets)) {
    if (m <= month) total += cats[cat.id] ?? 0;
  }
  if (index) return total + cumulativeActivity(index, cat.id, month);
  for (const t of data.transactions) {
    if (monthKeyOfIso(t.date) <= `${month}-99`) {
      forEachCategoryLeg(t, (legCat, amount) => {
        if (legCat === cat.id) total += amount;
      });
    }
  }
  return total;
}

export function totalAssigned(data: AppData, month: string): number {
  const cats = data.budgets[month] ?? {};
  return Object.values(cats).reduce((a, b) => a + b, 0);
}

export function incomeForMonth(data: AppData, month: string, index?: TxIndex): number {
  if (index) return index.incomeByMonth.get(month) ?? 0;
  let sum = 0;
  for (const t of data.transactions) {
    if (t.amount > 0 && t.categoryId === INCOME_CATEGORY_ID && monthKeyOfIso(t.date) === month) {
      sum += t.amount;
    }
  }
  return sum;
}

export function spendingForMonth(data: AppData, month: string, index?: TxIndex): number {
  // onBudget is a live account flag, so compose the cached per-account spend
  // with the current account list rather than caching the on-budget decision.
  if (index) {
    let sum = 0;
    for (const a of data.accounts) {
      if (a.onBudget !== false) sum += index.spendByAccountMonth.get(`${a.id}|${month}`) ?? 0;
    }
    return sum;
  }
  let sum = 0;
  for (const t of data.transactions) {
    if (t.amount < 0 && monthKeyOfIso(t.date) === month) {
      const acct = data.accounts.find((a) => a.id === t.accountId);
      if (acct?.onBudget !== false) sum += -t.amount;
    }
  }
  return sum;
}

/** Cash across on-budget accounts. */
export function budgetCash(data: AppData, index?: TxIndex): number {
  let sum = 0;
  for (const a of data.accounts) {
    if (a.onBudget && !a.archived) sum += accountBalance(data, a.id, index);
  }
  return sum;
}

/**
 * YNAB-style Ready to Assign: on-budget cash not yet earmarked by
 * envelope balances or goal savings.
 */
export function readyToAssign(data: AppData, month: string, index?: TxIndex): number {
  let earmarked = 0;
  for (const c of data.categories) {
    if (c.archived || c.id === INCOME_CATEGORY_ID) continue;
    earmarked += Math.max(0, envelopeAvailable(data, c, month, index));
  }
  const goalReserve = data.goals.reduce((a, g) => a + g.saved, 0);
  return budgetCash(data, index) - earmarked - goalReserve;
}

/** Bills due this month and not yet marked paid. */
export function unpaidBills(data: AppData, month: string = monthKey()) {
  return data.bills.filter((b) => !b.paidMonths.includes(month));
}

/**
 * PocketGuard-style "In My Pocket": unassigned cash minus bills still due
 * this month that aren't already covered by an envelope.
 */
export function inMyPocket(data: AppData, month: string = monthKey(), index?: TxIndex): number {
  const uncoveredBills = unpaidBills(data, month)
    .filter((b) => !b.categoryId)
    .reduce((a, b) => a + b.amount, 0);
  return readyToAssign(data, month, index) - uncoveredBills;
}

export interface AutoAssignPlan {
  categoryId: string;
  add: number; // cents to add to this month's assignment
}

/**
 * Fill every under-target envelope up to its monthly target, in the order
 * the Budget screen renders (group sortOrder, then category sortOrder),
 * never allocating more than Ready to Assign. Targets compare against
 * assigned-this-month, NOT the rollover-inclusive available balance —
 * a rollover envelope with money carried over still gets its monthly refill.
 */
export function planAutoAssign(data: AppData, month: string, index?: TxIndex): AutoAssignPlan[] {
  let pool = readyToAssign(data, month, index);
  if (pool <= 0) return [];
  const groupOrder = new Map(data.groups.map((g) => [g.id, g.sortOrder]));
  const candidates = data.categories
    .filter((c) => !c.archived && c.id !== INCOME_CATEGORY_ID && (c.monthlyTarget ?? 0) > 0)
    .sort((a, b) =>
      (groupOrder.get(a.groupId) ?? 0) - (groupOrder.get(b.groupId) ?? 0) ||
      a.sortOrder - b.sortOrder,
    );
  const plan: AutoAssignPlan[] = [];
  for (const c of candidates) {
    if (pool <= 0) break;
    const deficit = (c.monthlyTarget ?? 0) - assigned(data, c.id, month);
    if (deficit <= 0) continue;
    const add = Math.min(deficit, pool);
    plan.push({ categoryId: c.id, add });
    pool -= add; // decrement locally; readyToAssign can't see the unapplied plan
  }
  return plan;
}

/** Total remaining target deficit after applying a plan (for "short of targets"). */
export function targetShortfall(data: AppData, month: string, plan: AutoAssignPlan[]): number {
  const added = new Map(plan.map((p) => [p.categoryId, p.add]));
  let short = 0;
  for (const c of data.categories) {
    if (c.archived || c.id === INCOME_CATEGORY_ID || !(c.monthlyTarget && c.monthlyTarget > 0)) continue;
    const deficit = c.monthlyTarget - assigned(data, c.id, month) - (added.get(c.id) ?? 0);
    if (deficit > 0) short += deficit;
  }
  return short;
}

export interface CategorySpend {
  category: Category;
  spent: number; // positive cents
}

/** Spending by category for a month, sorted descending, for the donut. */
export function spendingByCategory(data: AppData, month: string, index?: TxIndex): CategorySpend[] {
  const out: CategorySpend[] = [];
  for (const c of data.categories) {
    if (c.archived || c.id === INCOME_CATEGORY_ID) continue;
    const spent = -Math.min(0, categoryActivity(data, c.id, month, index));
    if (spent > 0) out.push({ category: c, spent });
  }
  return out.sort((a, b) => b.spent - a.spent);
}

export interface MonthFlow {
  month: string;
  income: number;
  expense: number; // positive cents
}

export function cashFlowSeries(data: AppData, months = 6): MonthFlow[] {
  return lastMonths(months).map((m) => ({
    month: m,
    income: incomeForMonth(data, m),
    expense: spendingForMonth(data, m),
  }));
}

/** Month-end net worth for the last n months (current month = today). */
export function netWorthSeries(data: AppData, months = 6): { month: string; value: number }[] {
  const keys = lastMonths(months);
  return keys.map((m) => {
    const cutoff = m === monthKey() ? todayIso() : `${m}-99`;
    let total = 0;
    for (const a of data.accounts) {
      if (a.archived) continue;
      let bal = a.openingBalance;
      for (const t of data.transactions) {
        if (t.accountId === a.id && t.date <= cutoff) bal += t.amount;
      }
      total += bal;
    }
    return { month: m, value: total };
  });
}

export interface UpcomingBill {
  id: string;
  name: string;
  amount: number;
  dueIso: string;
  daysUntil: number;
  overdue: boolean;
  autopay: boolean;
}

export function upcomingBills(data: AppData, horizonDays = 45): UpcomingBill[] {
  const today = todayIso();
  const thisMonth = monthKey();
  const out: UpcomingBill[] = [];
  for (const b of data.bills) {
    // Find the next month this bill is unpaid, starting this month.
    for (let i = 0; i < 3; i++) {
      const m = addMonths(thisMonth, i);
      if (b.paidMonths.includes(m)) continue;
      const dueIso = `${m}-${String(b.dueDay).padStart(2, '0')}`;
      const daysUntil = Math.round(
        (new Date(dueIso).getTime() - new Date(today).getTime()) / 86400000,
      );
      if (daysUntil <= horizonDays) {
        out.push({
          id: b.id, name: b.name, amount: b.amount, dueIso, daysUntil,
          overdue: daysUntil < 0, autopay: b.autopay,
        });
      }
      break;
    }
  }
  return out.sort((a, b) => a.dueIso.localeCompare(b.dueIso));
}

/** Payees seen >= 3 times, as recurring-spend detection for insights. */
export function detectRecurringPayees(data: AppData): { payee: string; count: number; avg: number }[] {
  const byPayee = new Map<string, number[]>();
  for (const t of data.transactions) {
    if (t.amount >= 0 || !t.payee) continue;
    const arr = byPayee.get(t.payee) ?? [];
    arr.push(-t.amount);
    byPayee.set(t.payee, arr);
  }
  const out: { payee: string; count: number; avg: number }[] = [];
  for (const [payee, amounts] of byPayee) {
    if (amounts.length >= 3) {
      out.push({
        payee,
        count: amounts.length,
        avg: Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length),
      });
    }
  }
  return out.sort((a, b) => b.count - a.count);
}

export function applyRules(data: AppData, payee: string): string | null {
  const p = payee.toLowerCase();
  for (const r of data.rules) {
    if (r.match && p.includes(r.match.toLowerCase())) return r.categoryId;
  }
  return null;
}

export function isCredit(a: Account): boolean {
  return a.type === 'credit' || a.type === 'loan';
}

export function sortTransactions(ts: Transaction[]): Transaction[] {
  return [...ts].sort((a, b) => (a.date === b.date ? b.id.localeCompare(a.id) : b.date.localeCompare(a.date)));
}
