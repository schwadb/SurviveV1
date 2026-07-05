import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Account, AppData, Bill, Category, CategoryGroup, Goal, Rule, Settings, Transaction,
} from './types';
import { makeSeedData, SCHEMA_VERSION } from './data/seed';
import { applyRules } from './logic/budget';
import { monthKey, todayIso } from './utils/dates';

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
  importTransactions: (rows: Omit<Transaction, 'id' | 'cleared'>[]) => number;
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
        const categoryId = t.categoryId ?? applyRules(get(), t.payee);
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
      importTransactions: (rows) => {
        const s = get();
        const withIds: Transaction[] = rows.map((r) => ({
          ...r,
          categoryId: r.categoryId ?? applyRules(s, r.payee),
          id: newId('tx'),
          cleared: true,
        }));
        set({ transactions: [...s.transactions, ...withIds] });
        return withIds.length;
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
