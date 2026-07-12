import { describe, expect, it } from 'vitest';
import { planAutoAssign, readyToAssign, targetShortfall } from '../budget';
import { AppData, Category, INCOME_CATEGORY_ID } from '../../types';

const cat = (id: string, sortOrder: number, monthlyTarget?: number, over: Partial<Category> = {}): Category => ({
  id, groupId: 'g1', name: id, emoji: '📦', colorSlot: 0, rollover: false, sortOrder,
  monthlyTarget, ...over,
});

function fixture(cash: number, budgets: Record<string, number> = {}): AppData {
  return {
    accounts: [{ id: 'check', name: 'Checking', type: 'checking', openingBalance: cash, onBudget: true }],
    groups: [
      { id: 'g1', name: 'First', sortOrder: 0 },
      { id: 'g2', name: 'Second', sortOrder: 1 },
    ],
    categories: [
      cat('a', 0, 10000),
      cat('b', 1, 20000),
      cat('c', 0, 5000, { groupId: 'g2' }),
      cat('none', 2), // no target — never touched
      cat('zero', 3, 0), // explicit 0 — never touched
      cat(INCOME_CATEGORY_ID, 99, 99999, { archived: true }),
    ],
    transactions: [],
    budgets: { '2026-07': budgets },
    goals: [],
    bills: [],
    rules: [],
    settings: { themeMode: 'system', currency: 'USD', showSafeToSpend: true },
    schemaVersion: 3,
  };
}

const apply = (data: AppData, month: string) => {
  const plan = planAutoAssign(data, month);
  const cur = { ...(data.budgets[month] ?? {}) };
  for (const p of plan) cur[p.categoryId] = (cur[p.categoryId] ?? 0) + p.add;
  data.budgets[month] = cur;
  return plan;
};

describe('planAutoAssign', () => {
  it('fills every under-target envelope when the pool is large enough', () => {
    const data = fixture(100000);
    const before = readyToAssign(data, '2026-07');
    const plan = apply(data, '2026-07');
    expect(plan).toEqual([
      { categoryId: 'a', add: 10000 },
      { categoryId: 'b', add: 20000 },
      { categoryId: 'c', add: 5000 },
    ]);
    expect(readyToAssign(data, '2026-07')).toBe(before - 35000);
    expect(targetShortfall(fixture(100000), '2026-07', plan)).toBe(0);
  });

  it('allocates in group-then-category order and partially fills the last one', () => {
    const data = fixture(25000);
    const plan = apply(data, '2026-07');
    expect(plan).toEqual([
      { categoryId: 'a', add: 10000 },
      { categoryId: 'b', add: 15000 }, // partial — pool exhausted
    ]);
    expect(readyToAssign(data, '2026-07')).toBe(0); // exactly zero, never negative
    expect(targetShortfall(fixture(25000), '2026-07', plan)).toBe(5000 + 5000);
  });

  it('returns nothing when RTA is zero or negative', () => {
    expect(planAutoAssign(fixture(0), '2026-07')).toEqual([]);
    const overAssigned = fixture(10000, { a: 50000 });
    expect(readyToAssign(overAssigned, '2026-07')).toBeLessThan(0);
    expect(planAutoAssign(overAssigned, '2026-07')).toEqual([]);
  });

  it('skips envelopes already at or above target', () => {
    const data = fixture(100000, { a: 10000, b: 25000 });
    const plan = planAutoAssign(data, '2026-07');
    expect(plan).toEqual([{ categoryId: 'c', add: 5000 }]);
  });

  it('is idempotent: a second run assigns nothing', () => {
    const data = fixture(100000);
    apply(data, '2026-07');
    expect(planAutoAssign(data, '2026-07')).toEqual([]);
  });

  it('never touches untargeted, zero-target, archived, or income categories', () => {
    const data = fixture(1000000);
    const plan = apply(data, '2026-07');
    const touched = new Set(plan.map((p) => p.categoryId));
    expect(touched.has('none')).toBe(false);
    expect(touched.has('zero')).toBe(false);
    expect(touched.has(INCOME_CATEGORY_ID)).toBe(false);
  });
});
