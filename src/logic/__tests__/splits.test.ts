import { describe, expect, it } from 'vitest';
import { categoryActivity, spendingByCategory, validateSplits, applyRules } from '../budget';
import { buildIndex } from '../derived';
import { AppData, Category, INCOME_CATEGORY_ID, Transaction } from '../../types';

const cats: Category[] = [
  { id: 'cat-a', groupId: 'g', name: 'A', emoji: '🅰', colorSlot: 0, rollover: false, sortOrder: 0 },
  { id: 'cat-b', groupId: 'g', name: 'B', emoji: '🅱', colorSlot: 1, rollover: false, sortOrder: 1 },
  { id: 'cat-c', groupId: 'g', name: 'C', emoji: '🇨', colorSlot: 2, rollover: false, sortOrder: 2 },
  { id: INCOME_CATEGORY_ID, groupId: 'g', name: 'Income', emoji: '💰', colorSlot: 3, rollover: false, sortOrder: 99, archived: true },
];

function fixture(transactions: Transaction[]): AppData {
  return {
    accounts: [{ id: 'acc', name: 'Checking', type: 'checking', openingBalance: 0, onBudget: true }],
    groups: [{ id: 'g', name: 'G', sortOrder: 0 }],
    categories: cats,
    transactions,
    budgets: { '2026-07': { 'cat-a': 20000, 'cat-b': 20000, 'cat-c': 20000 } },
    goals: [], bills: [], rules: [{ id: 'r', match: 'costco', categoryId: 'cat-a' }],
    settings: { themeMode: 'system', currency: 'USD', showSafeToSpend: true },
    schemaVersion: 3,
  };
}

const splitTx: Transaction = {
  id: 't1', accountId: 'acc', categoryId: null, payee: 'Costco', amount: -10000,
  date: '2026-07-10', cleared: true,
  splits: [{ categoryId: 'cat-a', amount: -6000 }, { categoryId: 'cat-b', amount: -4000 }],
};

describe('split-aware category math', () => {
  it('categoryActivity attributes each leg to its category (fallback + indexed)', () => {
    const data = fixture([splitTx]);
    const idx = buildIndex(data);
    expect(categoryActivity(data, 'cat-a', '2026-07')).toBe(-6000);
    expect(categoryActivity(data, 'cat-b', '2026-07')).toBe(-4000);
    expect(categoryActivity(data, 'cat-c', '2026-07')).toBe(0);
    expect(categoryActivity(data, 'cat-a', '2026-07', idx)).toBe(-6000);
    expect(categoryActivity(data, 'cat-b', '2026-07', idx)).toBe(-4000);
  });

  it('spendingByCategory splits a charge across its legs', () => {
    const spend = spendingByCategory(fixture([splitTx]), '2026-07');
    const byId = Object.fromEntries(spend.map((s) => [s.category.id, s.spent]));
    expect(byId['cat-a']).toBe(6000);
    expect(byId['cat-b']).toBe(4000);
    expect(byId['cat-c']).toBeUndefined();
  });

  it('a null leg leaves that amount uncategorized', () => {
    const tx: Transaction = {
      ...splitTx, id: 't2',
      splits: [{ categoryId: 'cat-a', amount: -7000 }, { categoryId: null, amount: -3000 }],
    };
    const data = fixture([tx]);
    expect(categoryActivity(data, 'cat-a', '2026-07')).toBe(-7000);
    // The null leg contributes to no category total.
    const total = cats.reduce((a, c) => a + categoryActivity(data, c.id, '2026-07'), 0);
    expect(total).toBe(-7000);
  });
});

describe('validateSplits', () => {
  const legs = [{ categoryId: 'cat-a', amount: -6000 }, { categoryId: 'cat-b', amount: -4000 }];
  it('accepts legs that sum to the (negative) total', () => {
    expect(validateSplits(legs, -10000)).toBeNull();
  });
  it('rejects sum mismatch with a remainder message', () => {
    expect(validateSplits(legs, -12000)).toContain('left to split');
    expect(validateSplits(legs, -8000)).toContain('over by');
  });
  it('rejects income totals, <2 and >8 legs, and non-negative legs', () => {
    expect(validateSplits(legs, 10000)).toContain('expenses');
    expect(validateSplits([legs[0]], -6000)).toContain('at least 2');
    const nine = Array.from({ length: 9 }, () => ({ categoryId: 'cat-a', amount: -1000 }));
    expect(validateSplits(nine, -9000)).toContain('at most 8');
    expect(validateSplits([{ categoryId: 'cat-a', amount: -5000 }, { categoryId: 'cat-b', amount: 5000 }], 0))
      .toBeTruthy();
  });
});

describe('rules never touch split parents', () => {
  it('applyRules would match the payee, but a split parent must be left alone', () => {
    const data = fixture([splitTx]);
    // The rule matches "costco" → cat-a, proving the payee WOULD categorize…
    expect(applyRules(data, 'Costco')).toBe('cat-a');
    // …but the stored split parent keeps categoryId null and its legs intact.
    expect(data.transactions[0].categoryId).toBeNull();
    expect(data.transactions[0].splits).toHaveLength(2);
  });
});
