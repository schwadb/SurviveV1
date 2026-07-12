import { describe, expect, it } from 'vitest';
import { buildIndex, getIndex } from '../derived';
import {
  accountBalance, budgetCash, categoryActivity, envelopeAvailable, incomeForMonth,
  netWorth, readyToAssign, spendingByCategory, spendingForMonth,
} from '../budget';
import { AppData, Category, INCOME_CATEGORY_ID, Transaction } from '../../types';

// Deterministic PRNG so randomized fixtures are reproducible.
function makeRng(seed: number) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

const MONTHS = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];

function randomFixture(seed: number): AppData {
  const rng = makeRng(seed);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)];
  const accounts: AppData['accounts'] = [
    { id: 'check', name: 'Checking', type: 'checking', openingBalance: Math.floor(rng() * 200000), onBudget: true },
    { id: 'save', name: 'Savings', type: 'savings', openingBalance: Math.floor(rng() * 500000), onBudget: true },
    { id: 'credit', name: 'Card', type: 'credit', openingBalance: -Math.floor(rng() * 50000), onBudget: rng() > 0.5 },
    { id: 'invest', name: 'Funds', type: 'investment', openingBalance: 300000, onBudget: false },
  ];
  const categories: Category[] = [
    { id: 'cat-a', groupId: 'g', name: 'A', emoji: '🅰', colorSlot: 0, rollover: false, sortOrder: 0 },
    { id: 'cat-b', groupId: 'g', name: 'B', emoji: '🅱', colorSlot: 1, rollover: true, sortOrder: 1 },
    { id: 'cat-c', groupId: 'g', name: 'C', emoji: '🇨', colorSlot: 2, rollover: true, sortOrder: 2 },
    { id: INCOME_CATEGORY_ID, groupId: 'g', name: 'Income', emoji: '💰', colorSlot: 3, rollover: false, sortOrder: 99, archived: true },
  ];
  const transactions: Transaction[] = [];
  const n = 20 + Math.floor(rng() * 60);
  for (let i = 0; i < n; i++) {
    const m = pick(MONTHS);
    const day = String(1 + Math.floor(rng() * 27)).padStart(2, '0');
    const income = rng() > 0.7;
    const amount = income ? Math.floor(rng() * 40000) : -Math.floor(rng() * 15000);
    transactions.push({
      id: `t${i}`,
      accountId: pick(accounts).id,
      categoryId: income ? INCOME_CATEGORY_ID : pick(['cat-a', 'cat-b', 'cat-c', null]),
      payee: `P${i % 7}`,
      amount,
      date: `${m}-${day}`,
      cleared: rng() > 0.3,
    });
  }
  const budgets: AppData['budgets'] = {};
  for (const m of MONTHS) {
    budgets[m] = { 'cat-a': 10000, 'cat-b': 5000, 'cat-c': 8000 };
  }
  return {
    accounts, groups: [{ id: 'g', name: 'G', sortOrder: 0 }], categories, transactions, budgets,
    goals: [{ id: 'goal', name: 'EF', emoji: '🛟', target: 100000, saved: 12000, colorSlot: 0 }],
    bills: [], rules: [],
    settings: { themeMode: 'system', currency: 'USD', showSafeToSpend: true },
    schemaVersion: 3,
  };
}

describe('index equivalence — indexed results equal full-scan results', () => {
  it('matches across 50 randomized fixtures for every hot function', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const data = randomFixture(seed);
      const idx = buildIndex(data);
      for (const a of data.accounts) {
        expect(accountBalance(data, a.id, idx)).toBe(accountBalance(data, a.id));
      }
      expect(netWorth(data, idx)).toEqual(netWorth(data));
      expect(budgetCash(data, idx)).toBe(budgetCash(data));
      for (const m of MONTHS) {
        expect(incomeForMonth(data, m, idx)).toBe(incomeForMonth(data, m));
        expect(spendingForMonth(data, m, idx)).toBe(spendingForMonth(data, m));
        expect(readyToAssign(data, m, idx)).toBe(readyToAssign(data, m));
        for (const c of data.categories) {
          expect(categoryActivity(data, c.id, m, idx)).toBe(categoryActivity(data, c.id, m));
          expect(envelopeAvailable(data, c, m, idx)).toBe(envelopeAvailable(data, c, m));
        }
        expect(spendingByCategory(data, m, idx)).toEqual(spendingByCategory(data, m));
      }
    }
  });
});

describe('cache correctness under store mutations', () => {
  it('reuses the index while transactions array identity is stable', () => {
    const data = randomFixture(7);
    expect(getIndex(data)).toBe(getIndex(data));
  });

  it('an opening-balance edit (accounts change, transactions do not) is not stale', () => {
    const data = randomFixture(7);
    const before = accountBalance(data, 'check', getIndex(data));
    // Simulate an account edit: new accounts array, SAME transactions array ref.
    const edited: AppData = {
      ...data,
      accounts: data.accounts.map((a) => (a.id === 'check' ? { ...a, openingBalance: a.openingBalance + 50000 } : a)),
    };
    // Same tx ref → same cached index, but balance must reflect the new opening.
    expect(getIndex(edited)).toBe(getIndex(data));
    expect(accountBalance(edited, 'check', getIndex(edited))).toBe(before + 50000);
  });

  it('an on-budget toggle changes spendingForMonth without a stale cache', () => {
    const data = randomFixture(3);
    const idx = getIndex(data);
    const withCreditOn: AppData = {
      ...data,
      accounts: data.accounts.map((a) => (a.id === 'credit' ? { ...a, onBudget: true } : a)),
    };
    const withCreditOff: AppData = {
      ...data,
      accounts: data.accounts.map((a) => (a.id === 'credit' ? { ...a, onBudget: false } : a)),
    };
    for (const m of MONTHS) {
      expect(spendingForMonth(withCreditOn, m, idx)).toBe(spendingForMonth(withCreditOn, m));
      expect(spendingForMonth(withCreditOff, m, idx)).toBe(spendingForMonth(withCreditOff, m));
    }
  });
});

describe('index build performance guard', () => {
  it('builds a 10k-transaction index and computes Budget numbers under budget', () => {
    const base = randomFixture(1);
    const transactions: Transaction[] = [];
    for (let i = 0; i < 10000; i++) {
      transactions.push({
        id: `bulk-${i}`,
        accountId: i % 3 === 0 ? 'check' : i % 3 === 1 ? 'save' : 'credit',
        categoryId: i % 4 === 0 ? INCOME_CATEGORY_ID : i % 4 === 1 ? 'cat-a' : i % 4 === 2 ? 'cat-b' : 'cat-c',
        payee: `P${i % 50}`,
        amount: i % 4 === 0 ? 30000 : -(100 + (i % 9000)),
        date: `${MONTHS[i % MONTHS.length]}-${String(1 + (i % 27)).padStart(2, '0')}`,
        cleared: true,
      });
    }
    const data: AppData = { ...base, transactions };
    const start = Date.now();
    const idx = buildIndex(data);
    // Budget screen: RTA once + envelopeAvailable per envelope. Pre-index this
    // was ~8 full scans of 10k rows PER RENDER; indexed it is one build reused.
    readyToAssign(data, '2026-07', idx);
    for (const c of data.categories) envelopeAvailable(data, c, '2026-07', idx);
    expect(Date.now() - start).toBeLessThan(250);
  });
});
