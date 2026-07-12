// All money values are integer cents. Expense transactions are negative,
// income transactions are positive.

export type AccountType = 'checking' | 'savings' | 'cash' | 'credit' | 'investment' | 'loan';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  /** Balance the account started at before any recorded transactions. */
  openingBalance: number;
  /** On-budget accounts feed Ready to Assign / In My Pocket. */
  onBudget: boolean;
  archived?: boolean;
  /** Annual interest rate in basis points (2499 = 24.99%), credit/loan only. */
  aprBps?: number;
  /** Monthly minimum payment in cents, credit/loan only. */
  minPayment?: number;
}

export interface CategoryGroup {
  id: string;
  name: string;
  sortOrder: number;
}

/** A budget category doubles as a Goodbudget-style envelope. */
export interface Category {
  id: string;
  groupId: string;
  name: string;
  emoji: string;
  /** Categorical palette slot index (0-7), fixed per category. */
  colorSlot: number;
  /** Envelope rollover: unspent money carries into the next month. */
  rollover: boolean;
  /** Assign this much each month (YNAB-style monthly target), cents. */
  monthlyTarget?: number;
  sortOrder: number;
  archived?: boolean;
}

export interface Transaction {
  id: string;
  accountId: string;
  /** null = uncategorized (income uses the special income category). */
  categoryId: string | null;
  payee: string;
  /** Cents. Negative = spending, positive = inflow. */
  amount: number;
  /** ISO date, yyyy-mm-dd. */
  date: string;
  note?: string;
  /** Set when created by marking a bill paid. */
  billId?: string;
  cleared: boolean;
  /**
   * Split across categories (2–8 legs). When present, `categoryId` is null and
   * the leg amounts sum to `amount` (all negative, same sign as `amount`).
   */
  splits?: { categoryId: string | null; amount: number }[];
}

/** Per month (yyyy-mm) per category assignment, YNAB "assign every dollar". */
export type BudgetAssignments = Record<string, Record<string, number>>;

export interface Goal {
  id: string;
  name: string;
  emoji: string;
  target: number;
  saved: number;
  targetDate?: string;
  colorSlot: number;
}

export interface Bill {
  id: string;
  name: string;
  amount: number; // positive cents
  /** Day of month the bill is due, 1-28. */
  dueDay: number;
  categoryId: string | null;
  autopay: boolean;
  /** Months (yyyy-mm) in which the bill was paid. */
  paidMonths: string[];
}

/** Auto-categorization rule: payee substring match -> category. */
export interface Rule {
  id: string;
  match: string;
  categoryId: string;
}

export interface Settings {
  themeMode: 'system' | 'light' | 'dark';
  currency: string; // ISO code, display only
  /** Show In My Pocket hero on home. */
  showSafeToSpend: boolean;
  /** Require biometric/passcode unlock on launch and resume (native only). */
  appLock?: boolean;
  /** Local notifications for upcoming bill due dates (native only). */
  billReminders?: boolean;
}

export interface AppData {
  accounts: Account[];
  groups: CategoryGroup[];
  categories: Category[];
  transactions: Transaction[];
  budgets: BudgetAssignments;
  goals: Goal[];
  bills: Bill[];
  rules: Rule[];
  settings: Settings;
  /** Bumped when demo data is replaced, to invalidate stale persisted state. */
  schemaVersion: number;
}

export const INCOME_CATEGORY_ID = 'cat-income';
