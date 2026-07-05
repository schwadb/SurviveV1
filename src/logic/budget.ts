import { AppData, Account, Category, Transaction, INCOME_CATEGORY_ID } from '../types';
import { addMonths, lastMonths, monthKey, monthKeyOfIso, todayIso } from '../utils/dates';

export function accountBalance(data: AppData, accountId: string): number {
  const acct = data.accounts.find((a) => a.id === accountId);
  if (!acct) return 0;
  let bal = acct.openingBalance;
  for (const t of data.transactions) if (t.accountId === accountId) bal += t.amount;
  return bal;
}

export function netWorth(data: AppData): { assets: number; liabilities: number; total: number } {
  let assets = 0;
  let liabilities = 0;
  for (const a of data.accounts) {
    if (a.archived) continue;
    const bal = accountBalance(data, a.id);
    if (bal >= 0) assets += bal;
    else liabilities += -bal;
  }
  return { assets, liabilities, total: assets - liabilities };
}

/** Sum spent (negative activity) for a category within a month. */
export function categoryActivity(data: AppData, categoryId: string, month: string): number {
  let sum = 0;
  for (const t of data.transactions) {
    if (t.categoryId === categoryId && monthKeyOfIso(t.date) === month) sum += t.amount;
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
export function envelopeAvailable(data: AppData, cat: Category, month: string): number {
  if (!cat.rollover) return assigned(data, cat.id, month) + categoryActivity(data, cat.id, month);
  let total = 0;
  for (const [m, cats] of Object.entries(data.budgets)) {
    if (m <= month) total += cats[cat.id] ?? 0;
  }
  for (const t of data.transactions) {
    if (t.categoryId === cat.id && monthKeyOfIso(t.date) <= `${month}-99`) total += t.amount;
  }
  return total;
}

export function totalAssigned(data: AppData, month: string): number {
  const cats = data.budgets[month] ?? {};
  return Object.values(cats).reduce((a, b) => a + b, 0);
}

export function incomeForMonth(data: AppData, month: string): number {
  let sum = 0;
  for (const t of data.transactions) {
    if (t.amount > 0 && t.categoryId === INCOME_CATEGORY_ID && monthKeyOfIso(t.date) === month) {
      sum += t.amount;
    }
  }
  return sum;
}

export function spendingForMonth(data: AppData, month: string): number {
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
export function budgetCash(data: AppData): number {
  let sum = 0;
  for (const a of data.accounts) {
    if (a.onBudget && !a.archived) sum += accountBalance(data, a.id);
  }
  return sum;
}

/**
 * YNAB-style Ready to Assign: on-budget cash not yet earmarked by
 * envelope balances or goal savings.
 */
export function readyToAssign(data: AppData, month: string): number {
  let earmarked = 0;
  for (const c of data.categories) {
    if (c.archived || c.id === INCOME_CATEGORY_ID) continue;
    earmarked += Math.max(0, envelopeAvailable(data, c, month));
  }
  const goalReserve = data.goals.reduce((a, g) => a + g.saved, 0);
  return budgetCash(data) - earmarked - goalReserve;
}

/** Bills due this month and not yet marked paid. */
export function unpaidBills(data: AppData, month: string = monthKey()) {
  return data.bills.filter((b) => !b.paidMonths.includes(month));
}

/**
 * PocketGuard-style "In My Pocket": unassigned cash minus bills still due
 * this month that aren't already covered by an envelope.
 */
export function inMyPocket(data: AppData, month: string = monthKey()): number {
  const uncoveredBills = unpaidBills(data, month)
    .filter((b) => !b.categoryId)
    .reduce((a, b) => a + b.amount, 0);
  return readyToAssign(data, month) - uncoveredBills;
}

export interface CategorySpend {
  category: Category;
  spent: number; // positive cents
}

/** Spending by category for a month, sorted descending, for the donut. */
export function spendingByCategory(data: AppData, month: string): CategorySpend[] {
  const out: CategorySpend[] = [];
  for (const c of data.categories) {
    if (c.archived || c.id === INCOME_CATEGORY_ID) continue;
    const spent = -Math.min(0, categoryActivity(data, c.id, month));
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
