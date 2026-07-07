import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accountBalance, applyRules, cashFlowSeries, categoryActivity, detectRecurringPayees,
  envelopeAvailable, incomeForMonth, inMyPocket, netWorth, netWorthSeries,
  readyToAssign, sortTransactions, spendingByCategory, spendingForMonth, upcomingBills,
} from '../budget';
import { AppData, Category, INCOME_CATEGORY_ID, Transaction } from '../../types';

// Frozen clock: 2026-07-15. All fixture data is hand-built (never the live
// seed, which is date-relative) so every number below is hand-checkable.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 6, 15, 12, 0, 0));
});
afterEach(() => vi.useRealTimers());

const catA: Category = { id: 'cat-a', groupId: 'g1', name: 'Groceries', emoji: '🛒', colorSlot: 0, rollover: false, sortOrder: 0 };
const catB: Category = { id: 'cat-b', groupId: 'g1', name: 'Fun', emoji: '🎉', colorSlot: 1, rollover: true, sortOrder: 1 };
const income: Category = { id: INCOME_CATEGORY_ID, groupId: 'g1', name: 'Income', emoji: '💰', colorSlot: 3, rollover: false, sortOrder: 99, archived: true };

let txId = 0;
const tx = (accountId: string, categoryId: string | null, amount: number, date: string, payee = 'P'): Transaction =>
  ({ id: `t${++txId}`, accountId, categoryId, payee, amount, date, cleared: true });

function fixture(): AppData {
  return {
    accounts: [
      { id: 'check', name: 'Checking', type: 'checking', openingBalance: 100000, onBudget: true },
      { id: 'save', name: 'Savings', type: 'savings', openingBalance: 50000, onBudget: true },
      { id: 'credit', name: 'Card', type: 'credit', openingBalance: -20000, onBudget: true },
      { id: 'invest', name: 'Funds', type: 'investment', openingBalance: 200000, onBudget: false },
    ],
    groups: [{ id: 'g1', name: 'Spending', sortOrder: 0 }],
    categories: [catA, catB, income],
    transactions: [
      // June
      tx('check', 'cat-a', -4000, '2026-06-10'),
      tx('check', 'cat-b', -1000, '2026-06-12'),
      // July (all on/before the frozen 15th)
      tx('check', 'cat-a', -12000, '2026-07-05'),
      tx('check', 'cat-b', -2000, '2026-07-08'),
      tx('check', INCOME_CATEGORY_ID, 30000, '2026-07-01', 'Payroll'),
    ],
    budgets: {
      '2026-06': { 'cat-a': 10000, 'cat-b': 5000 },
      '2026-07': { 'cat-a': 10000, 'cat-b': 5000 },
    },
    goals: [{ id: 'goal1', name: 'EF', emoji: '🛟', target: 100000, saved: 10000, colorSlot: 0 }],
    bills: [
      { id: 'b-null', name: 'Insurance', amount: 5000, dueDay: 20, categoryId: null, autopay: false, paidMonths: [] },
      { id: 'b-cat', name: 'Rent', amount: 9000, dueDay: 20, categoryId: 'cat-a', autopay: false, paidMonths: [] },
      { id: 'b-paid', name: 'Web', amount: 700, dueDay: 10, categoryId: null, autopay: true, paidMonths: ['2026-07'] },
      { id: 'b-over', name: 'Water', amount: 1200, dueDay: 10, categoryId: 'cat-a', autopay: false, paidMonths: [] },
    ],
    rules: [{ id: 'r1', match: 'shell', categoryId: 'cat-a' }],
    settings: { themeMode: 'system', currency: 'USD', showSafeToSpend: true },
    schemaVersion: 3,
  };
}

describe('account balances and net worth', () => {
  it('accountBalance = opening + transactions', () => {
    // check: 100000 - 4000 - 1000 - 12000 - 2000 + 30000 = 111000
    expect(accountBalance(fixture(), 'check')).toBe(111000);
    expect(accountBalance(fixture(), 'credit')).toBe(-20000);
  });

  it('netWorth splits assets and liabilities', () => {
    const nw = netWorth(fixture());
    expect(nw.assets).toBe(111000 + 50000 + 200000);
    expect(nw.liabilities).toBe(20000);
    expect(nw.total).toBe(341000);
  });

  it('netWorthSeries uses month-end cutoffs, today for current month', () => {
    const series = netWorthSeries(fixture(), 2);
    expect(series.map((p) => p.month)).toEqual(['2026-06', '2026-07']);
    // Through June: check = 100000-5000 = 95000; +50000 -20000 +200000 = 325000
    expect(series[0].value).toBe(325000);
    expect(series[1].value).toBe(341000);
  });
});

describe('envelope math — the two regimes', () => {
  it('non-rollover envelope resets each month', () => {
    // July: assigned 10000, activity -12000 → overspent by 2000
    expect(envelopeAvailable(fixture(), catA, '2026-07')).toBe(-2000);
    // June stands alone: 10000 - 4000 = 6000
    expect(envelopeAvailable(fixture(), catA, '2026-06')).toBe(6000);
  });

  it('rollover envelope carries prior months forward', () => {
    // (5000+5000 assigned) + (-1000-2000 spent) = 7000
    expect(envelopeAvailable(fixture(), catB, '2026-07')).toBe(7000);
  });

  it('categoryActivity sums only the given month', () => {
    expect(categoryActivity(fixture(), 'cat-a', '2026-07')).toBe(-12000);
    expect(categoryActivity(fixture(), 'cat-a', '2026-06')).toBe(-4000);
  });
});

describe('readyToAssign and inMyPocket', () => {
  it('clamps overspent envelopes to zero and reserves goal savings', () => {
    // budgetCash = 111000 + 50000 - 20000 = 141000
    // earmarked = max(0,-2000)=0 (catA) + 7000 (catB); goals = 10000
    expect(readyToAssign(fixture(), '2026-07')).toBe(141000 - 7000 - 10000);
  });

  it('inMyPocket subtracts only unpaid bills without an envelope', () => {
    // b-null (5000) counts; b-cat has an envelope; b-paid is paid this month.
    const rta = readyToAssign(fixture(), '2026-07');
    expect(inMyPocket(fixture(), '2026-07')).toBe(rta - 5000);
  });
});

describe('monthly flows and reports', () => {
  it('incomeForMonth counts only income-category inflows', () => {
    expect(incomeForMonth(fixture(), '2026-07')).toBe(30000);
    expect(incomeForMonth(fixture(), '2026-06')).toBe(0);
  });

  it('spendingForMonth counts on-budget expenses as positive cents', () => {
    expect(spendingForMonth(fixture(), '2026-07')).toBe(14000);
  });

  it('spendingByCategory sorts descending and excludes income/archived', () => {
    const spend = spendingByCategory(fixture(), '2026-07');
    expect(spend.map((s) => [s.category.id, s.spent])).toEqual([
      ['cat-a', 12000],
      ['cat-b', 2000],
    ]);
  });

  it('cashFlowSeries covers the requested months', () => {
    const flow = cashFlowSeries(fixture(), 2);
    expect(flow).toEqual([
      { month: '2026-06', income: 0, expense: 5000 },
      { month: '2026-07', income: 30000, expense: 14000 },
    ]);
  });
});

describe('upcomingBills (frozen at 2026-07-15)', () => {
  it('flags overdue, counts days, and rolls paid bills to next month', () => {
    const bills = upcomingBills(fixture());
    const byId = Object.fromEntries(bills.map((b) => [b.id, b]));
    expect(byId['b-over']).toMatchObject({ dueIso: '2026-07-10', overdue: true, daysUntil: -5 });
    expect(byId['b-null']).toMatchObject({ dueIso: '2026-07-20', overdue: false, daysUntil: 5 });
    // Paid this month → next unpaid occurrence is August 10, 26 days out.
    expect(byId['b-paid']).toMatchObject({ dueIso: '2026-08-10', daysUntil: 26 });
  });

  it('respects the horizon', () => {
    const near = upcomingBills(fixture(), 6);
    expect(near.find((b) => b.id === 'b-paid')).toBeUndefined();
    expect(near.find((b) => b.id === 'b-null')).toBeDefined();
  });
});

describe('rules and recurring detection', () => {
  it('applyRules matches payee substrings case-insensitively', () => {
    expect(applyRules(fixture(), 'SHELL OIL 5771')).toBe('cat-a');
    expect(applyRules(fixture(), 'Unknown Store')).toBeNull();
  });

  it('detectRecurringPayees needs 3+ charges of the same payee', () => {
    const data = fixture();
    data.transactions.push(
      tx('check', 'cat-a', -1000, '2026-05-01', 'Streamly'),
      tx('check', 'cat-a', -1000, '2026-06-01', 'Streamly'),
      tx('check', 'cat-a', -1400, '2026-07-01', 'Streamly'),
    );
    const rec = detectRecurringPayees(data);
    expect(rec.find((r) => r.payee === 'Streamly')).toMatchObject({ count: 3, avg: 1133 });
    expect(rec.find((r) => r.payee === 'P')).toBeDefined(); // 4 'P' expenses exist
  });

  it('sortTransactions is newest-first', () => {
    const sorted = sortTransactions(fixture().transactions);
    expect(sorted[0].date >= sorted[sorted.length - 1].date).toBe(true);
    expect(sorted[0].date).toBe('2026-07-08');
  });
});

describe('import dedupe key contract', () => {
  // store.importTransactions dedupes on `${date}|${amount}|${payee.toLowerCase()}`.
  // Pin the key format here so a store refactor can't silently change it.
  const key = (t: { date: string; amount: number; payee: string }) =>
    `${t.date}|${t.amount}|${t.payee.toLowerCase()}`;

  it('same payee differing only by case is a duplicate; amount/date changes are not', () => {
    const a = { date: '2026-07-01', amount: -450, payee: 'Coffee Shop' };
    expect(key(a)).toBe(key({ ...a, payee: 'COFFEE SHOP' }));
    expect(key(a)).not.toBe(key({ ...a, amount: -451 }));
    expect(key(a)).not.toBe(key({ ...a, date: '2026-07-02' }));
  });
});
