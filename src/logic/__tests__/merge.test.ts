import { describe, expect, it } from 'vitest';
import { applyMerge, planMerge } from '../merge';
import { makeSeedData } from '../../data/seed';
import { AppData, Transaction } from '../../types';

function clone(d: AppData): AppData {
  return JSON.parse(JSON.stringify(d));
}

describe('planMerge / applyMerge', () => {
  it('merging identical data is an all-skip no-op (idempotent)', () => {
    const local = makeSeedData();
    const incoming = clone(local);
    const plan = planMerge(local, incoming);
    expect(plan.transactions).toHaveLength(0);
    expect(plan.accounts).toHaveLength(0);
    expect(plan.budgetCells).toHaveLength(0);
    expect(plan.skipped.conflicts).toBe(0);
    expect(plan.skipped.duplicates).toBe(local.transactions.length);
    const merged = applyMerge(local, plan);
    expect(merged.transactions).toHaveLength(local.transactions.length);
    expect(merged.accounts).toHaveLength(local.accounts.length);
  });

  it('adds a partner transaction with a new id and new natural key', () => {
    const local = makeSeedData();
    const incoming = clone(local);
    incoming.transactions.push({
      id: 'partner-1', accountId: 'acct-check', categoryId: 'cat-groceries',
      payee: 'Partner Store', amount: -2500, date: '2026-07-03', cleared: true,
    } as Transaction);
    const plan = planMerge(local, incoming);
    expect(plan.transactions.map((t) => t.id)).toEqual(['partner-1']);
    const merged = applyMerge(local, plan);
    expect(merged.transactions.some((t) => t.id === 'partner-1')).toBe(true);
    // Second merge of the same file is a no-op.
    expect(planMerge(merged, incoming).transactions).toHaveLength(0);
  });

  it('dedupes a same-payment transaction that has a different id (natural key)', () => {
    const local = makeSeedData();
    const first = local.transactions[0];
    const incoming = clone(local);
    incoming.transactions.push({
      ...first, id: 'different-id-same-payment',
    });
    const plan = planMerge(local, incoming);
    expect(plan.transactions).toHaveLength(0);
    expect(plan.skipped.duplicates).toBeGreaterThan(local.transactions.length);
  });

  it('budget cells: take incoming where local is empty; conflict where both differ', () => {
    const local: AppData = { ...makeSeedData(), budgets: { '2026-07': { 'cat-rent': 100000 } } };
    const incoming: AppData = {
      ...clone(local),
      budgets: { '2026-07': { 'cat-rent': 165000, 'cat-fun': 15000 }, '2026-08': { 'cat-rent': 165000 } },
    };
    const plan = planMerge(local, incoming);
    // cat-rent 2026-07 differs (both nonzero) → conflict, not added.
    // cat-fun 2026-07 and cat-rent 2026-08 are new → added.
    const cellKeys = plan.budgetCells.map((c) => `${c.month}|${c.categoryId}`).sort();
    expect(cellKeys).toEqual(['2026-07|cat-fun', '2026-08|cat-rent']);
    expect(plan.skipped.conflicts).toBeGreaterThanOrEqual(1);
    const merged = applyMerge(local, plan);
    expect(merged.budgets['2026-07']['cat-rent']).toBe(100000); // local wins
    expect(merged.budgets['2026-07']['cat-fun']).toBe(15000);
    expect(merged.budgets['2026-08']['cat-rent']).toBe(165000);
  });

  it('drops orphan transactions referencing an unknown account', () => {
    const local = makeSeedData();
    const incoming = clone(local);
    incoming.transactions.push({
      id: 'orphan-1', accountId: 'ghost-account', categoryId: null,
      payee: 'Nowhere', amount: -100, date: '2026-07-01', cleared: true,
    } as Transaction);
    const plan = planMerge(local, incoming);
    expect(plan.transactions.some((t) => t.id === 'orphan-1')).toBe(false);
    expect(plan.skipped.orphans).toBe(1);
  });

  it('local wins on entity id collision, preserving a locally-archived flag', () => {
    const local = makeSeedData();
    // Archive an account locally; the incoming copy has it active.
    local.accounts = local.accounts.map((a) => (a.id === 'acct-save' ? { ...a, archived: true } : a));
    const incoming = makeSeedData(); // acct-save active
    const plan = planMerge(local, incoming);
    expect(plan.accounts).toHaveLength(0); // collision → not added
    expect(plan.skipped.conflicts).toBeGreaterThanOrEqual(1);
    const merged = applyMerge(local, plan);
    expect(merged.accounts.find((a) => a.id === 'acct-save')?.archived).toBe(true);
  });

  it('never mutates settings or schemaVersion', () => {
    const local: AppData = { ...makeSeedData(), settings: { themeMode: 'dark', currency: 'USD', showSafeToSpend: false } };
    const incoming: AppData = { ...clone(local), settings: { themeMode: 'light', currency: 'EUR', showSafeToSpend: true } };
    const merged = applyMerge(local, planMerge(local, incoming));
    expect(merged.settings).toEqual(local.settings);
    expect(merged.schemaVersion).toBe(local.schemaVersion);
  });

  it('carries split legs verbatim; natural key uses the parent total', () => {
    const local = makeSeedData();
    const incoming = clone(local);
    incoming.transactions.push({
      id: 'split-partner', accountId: 'acct-check', categoryId: null, payee: 'Costco',
      amount: -10000, date: '2026-07-02', cleared: true,
      splits: [{ categoryId: 'cat-groceries', amount: -6000 }, { categoryId: 'cat-fun', amount: -4000 }],
    } as Transaction);
    const plan = planMerge(local, incoming);
    const added = plan.transactions.find((t) => t.id === 'split-partner');
    expect(added?.splits).toHaveLength(2);
  });
});
