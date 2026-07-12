import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Account, AppData, Bill, Category, CategoryGroup, Goal, Rule, Settings, Transaction,
} from './types';
import { makeLargeSeedData, makeSeedData, SCHEMA_VERSION } from './data/seed';
import { applyRules, planAutoAssign, targetShortfall } from './logic/budget';
import { MergePlan, applyMerge, planMerge } from './logic/merge';
import { addMonths, monthKey, todayIso } from './utils/dates';

let idCounter = Date.now() % 1000000;
export const newId = (prefix: string) => `${prefix}-${++idCounter}-${Math.random().toString(36).slice(2, 7)}`;

interface Actions {
  hydrated: boolean;
  setHydrated: (v: boolean) => void;

  addTransaction: (t: Omit<Transaction, 'id'>) => void;
  updateTransaction: (id: string, patch: Partial<Transaction>) => void;
  deleteTransaction: (id: string) => void;

  assign: (month: string, categoryId: string, amount: number) => void;
  moveMoney: (month: string, fromId: string, toId: string, amount: number) => void;
  /** Copy the previous month's assignments into `month` where it has none. */
  copyBudgetFromPreviousMonth: (month: string) => number;
  /** Fill under-target envelopes up to their monthly targets from RTA. */
  autoAssign: (month: string) => { assigned: number; filled: number; shortfall: number };

  addCategory: (c: Omit<Category, 'id'>) => void;
  updateCategory: (id: string, patch: Partial<Category>) => void;

  addAccount: (a: Omit<Account, 'id'>) => void;
  updateAccount: (id: string, patch: Partial<Account>) => void;

  addGoal: (g: Omit<Goal, 'id'>) => void;
  updateGoal: (id: string, patch: Partial<Goal>) => void;
  deleteGoal: (id: string) => void;
  contributeToGoal: (id: string, amount: number) => void;

  addBill: (b: Omit<Bill, 'id'>) => void;
  updateBill: (id: string, patch: Partial<Bill>) => void;
  deleteBill: (id: string) => void;
  /** Mark a bill paid for a month; creates the matching transaction. */
  payBill: (id: string, accountId: string, month?: string) => void;

  addRule: (r: Omit<Rule, 'id'>) => void;
  deleteRule: (id: string) => void;
  /** Apply rules to existing uncategorized transactions; returns count. */
  applyRulesToExisting: () => number;

  updateSettings: (patch: Partial<Settings>) => void;
  resetToDemo: () => void;
  clearAllData: () => void;
  /** Dev/testing only: load demo data plus ~10k synthetic transactions. */
  loadLargeDemo: () => void;
  /** Replace all data from a validated backup file. */
  restoreBackup: (data: AppData) => void;
  /** Non-destructively merge a partner's backup; returns what was added/skipped. */
  mergeBackup: (incoming: AppData) => MergePlan;
  /** Import statement rows, skipping (date, amount, payee) duplicates. */
  importTransactions: (rows: Omit<Transaction, 'id' | 'cleared'>[]) => { imported: number; skipped: number };
  /**
   * Reconcile an account to `actualBalance`: mark all its pending transactions
   * cleared, then (if needed) add one cleared adjustment to close the gap.
   * Returns the adjustment amount (0 when balances already matched).
   */
  reconcileAccount: (accountId: string, actualBalance: number) => number;
}

export type Store = AppData & Actions;

const emptyData = (): AppData => ({
  accounts: [], groups: [{ id: 'grp-default', name: 'Spending', sortOrder: 0 }],
  categories: [], transactions: [], budgets: {}, goals: [], bills: [], rules: [],
  settings: { themeMode: 'system', currency: 'USD', showSafeToSpend: true },
  schemaVersion: SCHEMA_VERSION,
});

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...makeSeedData(),
      hydrated: false,
      setHydrated: (v) => set({ hydrated: v }),

      addTransaction: (t) => {
        // A split parent keeps categoryId null by design — never let a rule
        // stamp a category onto it (it would be double-counted).
        const hasSplits = !!t.splits && t.splits.length > 0;
        const categoryId = hasSplits ? null : t.categoryId ?? applyRules(get(), t.payee);
        set((s) => ({ transactions: [...s.transactions, { ...t, categoryId, id: newId('tx') }] }));
      },
      updateTransaction: (id, patch) =>
        set((s) => ({ transactions: s.transactions.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
      deleteTransaction: (id) =>
        set((s) => ({ transactions: s.transactions.filter((t) => t.id !== id) })),

      assign: (month, categoryId, amount) =>
        set((s) => ({
          budgets: {
            ...s.budgets,
            [month]: { ...(s.budgets[month] ?? {}), [categoryId]: amount },
          },
        })),
      moveMoney: (month, fromId, toId, amount) =>
        set((s) => {
          const m = { ...(s.budgets[month] ?? {}) };
          if (fromId) m[fromId] = (m[fromId] ?? 0) - amount;
          if (toId) m[toId] = (m[toId] ?? 0) + amount;
          return { budgets: { ...s.budgets, [month]: m } };
        }),

      copyBudgetFromPreviousMonth: (month) => {
        const s = get();
        const prev = s.budgets[addMonths(month, -1)] ?? {};
        const cur = { ...(s.budgets[month] ?? {}) };
        let copied = 0;
        for (const [catId, amount] of Object.entries(prev)) {
          if (!cur[catId] && amount > 0) {
            cur[catId] = amount;
            copied++;
          }
        }
        if (copied > 0) set({ budgets: { ...s.budgets, [month]: cur } });
        return copied;
      },

      autoAssign: (month) => {
        const s = get();
        const plan = planAutoAssign(s, month);
        if (plan.length > 0) {
          // One set() for the whole plan — per-category assigns would fire a
          // re-render per envelope.
          const cur = { ...(s.budgets[month] ?? {}) };
          for (const p of plan) cur[p.categoryId] = (cur[p.categoryId] ?? 0) + p.add;
          set({ budgets: { ...s.budgets, [month]: cur } });
        }
        return {
          assigned: plan.reduce((a, p) => a + p.add, 0),
          filled: plan.length,
          shortfall: targetShortfall(s, month, plan),
        };
      },

      addCategory: (c) => set((s) => ({ categories: [...s.categories, { ...c, id: newId('cat') }] })),
      updateCategory: (id, patch) =>
        set((s) => ({ categories: s.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),

      addAccount: (a) => set((s) => ({ accounts: [...s.accounts, { ...a, id: newId('acct') }] })),
      updateAccount: (id, patch) =>
        set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),

      addGoal: (g) => set((s) => ({ goals: [...s.goals, { ...g, id: newId('goal') }] })),
      updateGoal: (id, patch) =>
        set((s) => ({ goals: s.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)) })),
      deleteGoal: (id) => set((s) => ({ goals: s.goals.filter((g) => g.id !== id) })),
      contributeToGoal: (id, amount) =>
        set((s) => ({
          goals: s.goals.map((g) =>
            g.id === id ? { ...g, saved: Math.max(0, g.saved + amount) } : g,
          ),
        })),

      addBill: (b) => set((s) => ({ bills: [...s.bills, { ...b, id: newId('bill') }] })),
      updateBill: (id, patch) =>
        set((s) => ({ bills: s.bills.map((b) => (b.id === id ? { ...b, ...patch } : b)) })),
      deleteBill: (id) => set((s) => ({ bills: s.bills.filter((b) => b.id !== id) })),
      payBill: (id, accountId, month = monthKey()) => {
        const bill = get().bills.find((b) => b.id === id);
        if (!bill || bill.paidMonths.includes(month)) return;
        set((s) => ({
          bills: s.bills.map((b) =>
            b.id === id ? { ...b, paidMonths: [...b.paidMonths, month] } : b,
          ),
          transactions: [
            ...s.transactions,
            {
              id: newId('tx'), accountId, categoryId: bill.categoryId, payee: bill.name,
              amount: -bill.amount, date: todayIso(), cleared: true, billId: bill.id,
            },
          ],
        }));
      },

      addRule: (r) => set((s) => ({ rules: [...s.rules, { ...r, id: newId('rule') }] })),
      deleteRule: (id) => set((s) => ({ rules: s.rules.filter((r) => r.id !== id) })),
      applyRulesToExisting: () => {
        const s = get();
        let count = 0;
        const updated = s.transactions.map((t) => {
          if (t.categoryId) return t;
          if (t.splits && t.splits.length > 0) return t; // never re-categorize a split parent
          const cat = applyRules(s, t.payee);
          if (cat) {
            count++;
            return { ...t, categoryId: cat };
          }
          return t;
        });
        if (count > 0) set({ transactions: updated });
        return count;
      },

      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      resetToDemo: () => set({ ...makeSeedData() }),
      clearAllData: () => set({ ...emptyData() }),
      loadLargeDemo: () => set({ ...makeLargeSeedData() }),
      restoreBackup: (data) => set({ ...data }),
      mergeBackup: (incoming) => {
        const local = get();
        const plan = planMerge(local, incoming);
        set(applyMerge(local, plan));
        return plan;
      },
      importTransactions: (rows) => {
        const s = get();
        // Banks re-export overlapping date ranges; dedupe on the natural key.
        const seen = new Set(s.transactions.map((t) => `${t.date}|${t.amount}|${t.payee.toLowerCase()}`));
        const fresh: Transaction[] = [];
        let skipped = 0;
        for (const r of rows) {
          const key = `${r.date}|${r.amount}|${r.payee.toLowerCase()}`;
          if (seen.has(key)) { skipped++; continue; }
          seen.add(key);
          fresh.push({
            ...r,
            categoryId: r.categoryId ?? applyRules(s, r.payee),
            id: newId('tx'),
            cleared: true,
          });
        }
        if (fresh.length > 0) set({ transactions: [...s.transactions, ...fresh] });
        return { imported: fresh.length, skipped };
      },
      reconcileAccount: (accountId, actualBalance) => {
        const s = get();
        const acct = s.accounts.find((a) => a.id === accountId);
        if (!acct) return 0;
        // 1) Clear all pending transactions for this account.
        const cleared = s.transactions.map((t) =>
          t.accountId === accountId && !t.cleared ? { ...t, cleared: true } : t,
        );
        // 2) Working balance AFTER clearing (opening + every recorded tx). The
        //    adjustment must be computed against THIS, not the pre-clearing
        //    cleared balance, or every pending tx is double-counted.
        let working = acct.openingBalance;
        for (const t of cleared) if (t.accountId === accountId) working += t.amount;
        // 3) Close any remaining gap with one cleared, uncategorized adjustment.
        const adjustment = actualBalance - working;
        const next = adjustment !== 0
          ? [
              ...cleared,
              {
                id: newId('tx'), accountId, categoryId: null, payee: 'Balance adjustment',
                amount: adjustment, date: todayIso(), cleared: true,
              } as Transaction,
            ]
          : cleared;
        set({ transactions: next });
        return adjustment;
      },
    }),
    {
      name: 'survive-budget-v1',
      storage: createJSONStorage(() => AsyncStorage),
      version: SCHEMA_VERSION,
      migrate: () => makeSeedData() as unknown as Store,
      onRehydrateStorage: () => (state) => state?.setHydrated(true),
      partialize: (s) => {
        const { hydrated, setHydrated, ...rest } = s as Store & Record<string, unknown>;
        return rest;
      },
    },
  ),
);
