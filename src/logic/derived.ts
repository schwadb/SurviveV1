import { AppData, Transaction, INCOME_CATEGORY_ID } from '../types';
import { monthKeyOfIso } from '../utils/dates';

/**
 * A single-pass summary of the transaction list, so hot screens (Budget,
 * Home, More) don't rescan every transaction per render per envelope.
 *
 * IMPORTANT: this caches ONLY what transactions determine. Anything that also
 * depends on live account flags (e.g. spendingForMonth reads account.onBudget)
 * composes the cached per-account/per-month pieces with the live account list
 * at call time — never bake an account flag into the cache, or an on-budget
 * toggle serves stale numbers. Likewise account balances are opening (live from
 * accounts) + cached txSum, so an opening-balance edit is reflected immediately.
 */
export interface TxIndex {
  /** accountId -> sum of transaction amounts (add opening balance for a balance). */
  txSumByAccount: Map<string, number>;
  /** `${categoryId}|${month}` -> signed activity sum for that category in that month. */
  activityByCatMonth: Map<string, number>;
  /** categoryId -> ascending months with running cumulative activity (for rollover). */
  cumulativeByCat: Map<string, { months: string[]; cums: number[] }>;
  /** month -> income-category inflow total. */
  incomeByMonth: Map<string, number>;
  /** `${accountId}|${month}` -> positive spend (−amount for expenses). */
  spendByAccountMonth: Map<string, number>;
}

function add(map: Map<string, number>, key: string, delta: number) {
  map.set(key, (map.get(key) ?? 0) + delta);
}

/** Contribution of one transaction to category activity (splits expand to legs). */
export function forEachCategoryLeg(
  t: Transaction,
  fn: (categoryId: string | null, amount: number) => void,
) {
  if (t.splits && t.splits.length > 0) {
    for (const leg of t.splits) fn(leg.categoryId, leg.amount);
  } else {
    fn(t.categoryId, t.amount);
  }
}

export function buildIndex(data: AppData): TxIndex {
  const txSumByAccount = new Map<string, number>();
  const activityByCatMonth = new Map<string, number>();
  const incomeByMonth = new Map<string, number>();
  const spendByAccountMonth = new Map<string, number>();

  for (const t of data.transactions) {
    const m = monthKeyOfIso(t.date);
    add(txSumByAccount, t.accountId, t.amount);
    forEachCategoryLeg(t, (categoryId, amount) => {
      if (categoryId !== null) add(activityByCatMonth, `${categoryId}|${m}`, amount);
    });
    if (t.amount > 0 && t.categoryId === INCOME_CATEGORY_ID) add(incomeByMonth, m, t.amount);
    if (t.amount < 0) add(spendByAccountMonth, `${t.accountId}|${m}`, -t.amount);
  }

  // Running cumulative activity per category over its active months (ascending),
  // so a rollover envelope's carry-forward is an O(months) lookup, not O(tx).
  const perCat = new Map<string, Map<string, number>>();
  for (const [key, sum] of activityByCatMonth) {
    const sep = key.lastIndexOf('|');
    const catId = key.slice(0, sep);
    const month = key.slice(sep + 1);
    let byMonth = perCat.get(catId);
    if (!byMonth) {
      byMonth = new Map();
      perCat.set(catId, byMonth);
    }
    byMonth.set(month, sum);
  }
  const cumulativeByCat = new Map<string, { months: string[]; cums: number[] }>();
  for (const [catId, byMonth] of perCat) {
    const months = [...byMonth.keys()].sort();
    const cums: number[] = [];
    let running = 0;
    for (const month of months) {
      running += byMonth.get(month) ?? 0;
      cums.push(running);
    }
    cumulativeByCat.set(catId, { months, cums });
  }

  return { txSumByAccount, activityByCatMonth, cumulativeByCat, incomeByMonth, spendByAccountMonth };
}

/** Cumulative activity for a category through `month` (inclusive). */
export function cumulativeActivity(index: TxIndex, categoryId: string, month: string): number {
  const entry = index.cumulativeByCat.get(categoryId);
  if (!entry) return 0;
  // Largest cumulative whose month <= the query month.
  let result = 0;
  for (let i = 0; i < entry.months.length; i++) {
    if (entry.months[i] <= month) result = entry.cums[i];
    else break;
  }
  return result;
}

// Memoize the index on the transactions array reference. zustand replaces state
// immutably, so the array identity only changes when transactions change — a
// settings toggle or account edit keeps the same array and reuses the index.
const cache = new WeakMap<Transaction[], TxIndex>();

export function getIndex(data: AppData): TxIndex {
  let idx = cache.get(data.transactions);
  if (!idx) {
    idx = buildIndex(data);
    cache.set(data.transactions, idx);
  }
  return idx;
}
