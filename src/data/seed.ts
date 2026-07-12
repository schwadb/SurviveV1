import { AppData, INCOME_CATEGORY_ID } from '../types';
import { addMonths, monthKey, todayIso } from '../utils/dates';

export const SCHEMA_VERSION = 3;

let idCounter = 0;
const nid = (p: string) => `${p}-${++idCounter}`;

/** Demo dataset generated relative to today so charts always have history. */
export function makeSeedData(): AppData {
  idCounter = 0;
  const m0 = monthKey(); // current month
  const months = [addMonths(m0, -5), addMonths(m0, -4), addMonths(m0, -3), addMonths(m0, -2), addMonths(m0, -1), m0];
  const today = todayIso();
  const dayOfMonth = Number(today.slice(8, 10));

  const accounts: AppData['accounts'] = [
    { id: 'acct-check', name: 'Everyday Checking', type: 'checking', openingBalance: 412500, onBudget: true },
    { id: 'acct-save', name: 'High-Yield Savings', type: 'savings', openingBalance: 1250000, onBudget: true },
    { id: 'acct-credit', name: 'Rewards Card', type: 'credit', openingBalance: -21500, onBudget: true, aprBps: 2499, minPayment: 3500 },
    { id: 'acct-invest', name: 'Index Funds', type: 'investment', openingBalance: 2860000, onBudget: false },
  ];

  const groups: AppData['groups'] = [
    { id: 'grp-bills', name: 'Bills & Utilities', sortOrder: 0 },
    { id: 'grp-everyday', name: 'Everyday Spending', sortOrder: 1 },
    { id: 'grp-lifestyle', name: 'Lifestyle', sortOrder: 2 },
  ];

  const categories: AppData['categories'] = [
    { id: INCOME_CATEGORY_ID, groupId: 'grp-everyday', name: 'Income', emoji: '💰', colorSlot: 3, rollover: false, sortOrder: 99, archived: true },
    { id: 'cat-rent', groupId: 'grp-bills', name: 'Rent', emoji: '🏠', colorSlot: 0, rollover: false, sortOrder: 0, monthlyTarget: 165000 },
    { id: 'cat-utils', groupId: 'grp-bills', name: 'Utilities', emoji: '💡', colorSlot: 1, rollover: false, sortOrder: 1, monthlyTarget: 22000 },
    { id: 'cat-subs', groupId: 'grp-bills', name: 'Subscriptions', emoji: '📺', colorSlot: 2, rollover: false, sortOrder: 2, monthlyTarget: 6500 },
    { id: 'cat-groceries', groupId: 'grp-everyday', name: 'Groceries', emoji: '🛒', colorSlot: 3, rollover: false, sortOrder: 0, monthlyTarget: 55000 },
    { id: 'cat-dining', groupId: 'grp-everyday', name: 'Dining Out', emoji: '🍜', colorSlot: 4, rollover: false, sortOrder: 1, monthlyTarget: 25000 },
    { id: 'cat-transport', groupId: 'grp-everyday', name: 'Transport', emoji: '⛽', colorSlot: 5, rollover: false, sortOrder: 2, monthlyTarget: 18000 },
    { id: 'cat-fun', groupId: 'grp-lifestyle', name: 'Fun Money', emoji: '🎉', colorSlot: 6, rollover: true, sortOrder: 0, monthlyTarget: 15000 },
    { id: 'cat-health', groupId: 'grp-lifestyle', name: 'Health & Fitness', emoji: '💪', colorSlot: 7, rollover: true, sortOrder: 1, monthlyTarget: 8000 },
  ];

  const budgets: AppData['budgets'] = {};
  for (const m of months) {
    budgets[m] = {
      'cat-rent': 165000,
      'cat-utils': 22000,
      'cat-subs': 6500,
      'cat-groceries': 55000,
      'cat-dining': 25000,
      'cat-transport': 18000,
      'cat-fun': 15000,
      'cat-health': 8000,
    };
  }

  const tx: AppData['transactions'] = [];
  const add = (accountId: string, categoryId: string | null, payee: string, amount: number, date: string, billId?: string) => {
    tx.push({ id: nid('tx'), accountId, categoryId, payee, amount, date, cleared: date < today, billId });
  };

  // History months: paycheck twice a month + typical spending with variation.
  months.forEach((m, i) => {
    const isCurrent = m === m0;
    const wiggle = (base: number, pct: number) => Math.round(base * (1 + pct * Math.sin(i * 2.1)));

    add('acct-check', INCOME_CATEGORY_ID, 'Acme Corp Payroll', 310000, `${m}-01`);
    if (!isCurrent || dayOfMonth >= 15) add('acct-check', INCOME_CATEGORY_ID, 'Acme Corp Payroll', 310000, `${m}-15`);

    add('acct-check', 'cat-rent', 'Sunrise Apartments', -165000, `${m}-02`);
    add('acct-check', 'cat-utils', 'City Power & Light', -wiggle(14500, 0.2), `${m}-08`);
    add('acct-check', 'cat-utils', 'Metro Internet', -6999, `${m}-05`);
    add('acct-credit', 'cat-subs', 'Streamflix', -1799, `${m}-03`);
    add('acct-credit', 'cat-subs', 'Spotify', -1199, `${m}-04`);

    const groceryDays = ['03', '10', '17', '24'];
    for (const d of groceryDays) {
      if (isCurrent && Number(d) > dayOfMonth) break;
      add('acct-credit', 'cat-groceries', 'Fresh Market', -wiggle(12400, 0.25), `${m}-${d}`);
    }
    const diningDays: [string, string, number][] = [
      ['06', 'Noodle House', 3450], ['13', 'Taco Truck', 2180], ['20', 'Corner Bistro', 6420], ['27', 'Pizza Palace', 2890],
    ];
    for (const [d, payee, amt] of diningDays) {
      if (isCurrent && Number(d) > dayOfMonth) break;
      add('acct-credit', 'cat-dining', payee, -wiggle(amt, 0.3), `${m}-${d}`);
    }
    if (!isCurrent || dayOfMonth >= 7) add('acct-credit', 'cat-transport', 'Shell Gas', -wiggle(5200, 0.2), `${m}-07`);
    if (!isCurrent || dayOfMonth >= 21) add('acct-credit', 'cat-transport', 'Shell Gas', -wiggle(4800, 0.2), `${m}-21`);
    if (!isCurrent || dayOfMonth >= 12) add('acct-credit', 'cat-fun', 'Cinema City', -wiggle(3200, 0.4), `${m}-12`);
    if (!isCurrent || dayOfMonth >= 9) add('acct-check', 'cat-health', 'Iron Gym', -4500, `${m}-09`);
    if (!isCurrent) add('acct-save', INCOME_CATEGORY_ID, 'Interest Payment', 4100 + i * 30, `${m}-28`);
    if (!isCurrent) add('acct-invest', null, 'Market Change', wiggle(38000, 0.9) - 12000, `${m}-26`);
  });

  // A couple of fresh, uncleared transactions right at "today".
  add('acct-credit', 'cat-dining', 'Morning Brew Coffee', -675, today);
  add('acct-credit', 'cat-groceries', 'Fresh Market', -4312, today);

  const goals: AppData['goals'] = [
    { id: nid('goal'), name: 'Emergency Fund', emoji: '🛟', target: 1000000, saved: 620000, colorSlot: 1 },
    { id: nid('goal'), name: 'Japan Trip', emoji: '🗾', target: 400000, saved: 145000, targetDate: `${addMonths(m0, 8)}-01`, colorSlot: 4 },
    { id: nid('goal'), name: 'New Laptop', emoji: '💻', target: 180000, saved: 90000, colorSlot: 0 },
  ];

  const bills: AppData['bills'] = [
    { id: nid('bill'), name: 'Rent', amount: 165000, dueDay: 1, categoryId: 'cat-rent', autopay: true, paidMonths: [m0] },
    { id: nid('bill'), name: 'Electric', amount: 14500, dueDay: 8, categoryId: 'cat-utils', autopay: false, paidMonths: dayOfMonth >= 8 ? [m0] : [] },
    { id: nid('bill'), name: 'Internet', amount: 6999, dueDay: 5, categoryId: 'cat-utils', autopay: true, paidMonths: dayOfMonth >= 5 ? [m0] : [] },
    { id: nid('bill'), name: 'Streamflix', amount: 1799, dueDay: 3, categoryId: 'cat-subs', autopay: true, paidMonths: dayOfMonth >= 3 ? [m0] : [] },
    { id: nid('bill'), name: 'Car Insurance', amount: 11250, dueDay: 18, categoryId: null, autopay: false, paidMonths: dayOfMonth >= 18 ? [m0] : [] },
  ];

  const rules: AppData['rules'] = [
    { id: nid('rule'), match: 'fresh market', categoryId: 'cat-groceries' },
    { id: nid('rule'), match: 'shell', categoryId: 'cat-transport' },
    { id: nid('rule'), match: 'coffee', categoryId: 'cat-dining' },
    { id: nid('rule'), match: 'payroll', categoryId: INCOME_CATEGORY_ID },
  ];

  return {
    accounts, groups, categories, transactions: tx, budgets, goals, bills, rules,
    settings: { themeMode: 'system', currency: 'USD', showSafeToSpend: true },
    schemaVersion: SCHEMA_VERSION,
  };
}

/**
 * Demo data plus `txCount` synthetic historical transactions spread over the
 * last ~6 years, for exercising the app at realistic volume (perf test + a
 * dev-only loader). Deterministic (no Math.random) so results are stable.
 */
export function makeLargeSeedData(txCount = 10000): AppData {
  const base = makeSeedData();
  const spendCats = ['cat-groceries', 'cat-dining', 'cat-transport', 'cat-fun', 'cat-utils'];
  const payees = ['Fresh Market', 'Noodle House', 'Shell Gas', 'Cinema City', 'City Power & Light', 'Corner Store', 'Bus Pass', 'Book Nook'];
  const m0 = monthKey();
  const bulk: AppData['transactions'] = [];
  for (let i = 0; i < txCount; i++) {
    const month = addMonths(m0, -(i % 72)); // spread across 6 years
    const day = String(1 + (i % 27)).padStart(2, '0');
    const isIncome = i % 20 === 0;
    bulk.push({
      id: `bulk-${i}`,
      accountId: i % 3 === 0 ? 'acct-check' : i % 3 === 1 ? 'acct-credit' : 'acct-save',
      categoryId: isIncome ? INCOME_CATEGORY_ID : spendCats[i % spendCats.length],
      payee: isIncome ? 'Side Gig' : payees[i % payees.length],
      amount: isIncome ? 5000 + (i % 100) * 10 : -(500 + (i % 12000)),
      date: `${month}-${day}`,
      cleared: true,
    });
  }
  return { ...base, transactions: [...base.transactions, ...bulk] };
}
