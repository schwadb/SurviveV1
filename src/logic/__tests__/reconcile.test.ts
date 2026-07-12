import { describe, expect, it } from 'vitest';
import { accountBalance, clearedBalance, reconciliationAdjustment } from '../budget';
import { buildIndex } from '../derived';
import { AppData, Transaction } from '../../types';

function fixture(transactions: Transaction[], openingBalance = 100000): AppData {
  return {
    accounts: [{ id: 'acc', name: 'Checking', type: 'checking', openingBalance, onBudget: true }],
    groups: [], categories: [], transactions, budgets: {}, goals: [], bills: [], rules: [],
    settings: { themeMode: 'system', currency: 'USD', showSafeToSpend: true },
    schemaVersion: 3,
  };
}

const tx = (amount: number, cleared: boolean, id = `t${amount}${cleared}`): Transaction =>
  ({ id, accountId: 'acc', categoryId: null, payee: 'P', amount, date: '2026-07-01', cleared });

describe('clearedBalance', () => {
  it('counts opening + cleared transactions only (fallback + indexed)', () => {
    const data = fixture([tx(-20000, true), tx(-10000, false)]);
    const idx = buildIndex(data);
    // cleared: 100000 - 20000 = 80000; working (all): 70000
    expect(clearedBalance(data, 'acc')).toBe(80000);
    expect(clearedBalance(data, 'acc', idx)).toBe(80000);
    expect(accountBalance(data, 'acc')).toBe(70000);
  });
});

describe('reconciliationAdjustment', () => {
  it('is zero when the actual balance already matches the working balance', () => {
    // opening 1000, cleared -200, pending -100 → working 700. Enter actual 700.
    const data = fixture([tx(-20000, true), tx(-10000, false)], 100000);
    // working balance = 100000 - 20000 - 10000 = 70000.
    expect(reconciliationAdjustment(data, 'acc', 70000)).toBe(0);
    // The buggy formula (actual − clearedBalance=80000) would give -10000; ensure not.
    expect(reconciliationAdjustment(data, 'acc', 70000)).not.toBe(-10000);
  });

  it('creates a positive adjustment when the bank shows more', () => {
    const data = fixture([tx(-20000, true)], 100000); // working 80000
    expect(reconciliationAdjustment(data, 'acc', 85000)).toBe(5000);
  });

  it('creates a negative adjustment when the bank shows less', () => {
    const data = fixture([tx(-20000, true)], 100000); // working 80000
    expect(reconciliationAdjustment(data, 'acc', 75000)).toBe(-5000);
  });

  it('handles credit accounts entered as a negative actual balance', () => {
    const credit = {
      ...fixture([tx(-5000, true)], -400000),
      accounts: [{ id: 'acc', name: 'Card', type: 'credit' as const, openingBalance: -400000, onBudget: true }],
    };
    // working = -405000; user reads -460247 off the card app.
    expect(reconciliationAdjustment(credit, 'acc', -460247)).toBe(-460247 - -405000);
  });
});
