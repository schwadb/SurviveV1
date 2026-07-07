// Debt payoff simulation (avalanche / snowball). Pure and integer-cents:
// interest is rounded per debt per month, matching how statements accrue.

export interface DebtInput {
  id: string;
  name: string;
  /** Positive cents owed. */
  balance: number;
  /** Annual rate in basis points (2499 = 24.99%). */
  aprBps: number;
  /** Monthly minimum payment, cents. */
  minPayment: number;
}

export type PayoffStrategy = 'avalanche' | 'snowball';

export interface PayoffResult {
  months: number;
  totalInterest: number;
  /** Total debt remaining after each simulated month (last entry is 0 unless neverPaysOff). */
  curve: number[];
  neverPaysOff: boolean;
  perDebt: { id: string; payoffMonth: number }[];
}

const MAX_MONTHS = 600;

/**
 * Simulate paying off `debts` with `extra` cents/month beyond the minimums.
 * Minimums are paid first each month; the remainder targets one priority debt
 * (avalanche: highest APR, tie → larger balance; snowball: smallest balance,
 * tie → name). A paid-off debt's freed minimum joins the pool the NEXT month.
 */
export function simulatePayoff(
  debts: DebtInput[],
  extra: number,
  strategy: PayoffStrategy,
): PayoffResult {
  const open = debts
    .filter((d) => d.balance > 0)
    .map((d) => ({ ...d, remaining: d.balance, payoffMonth: 0 }));
  if (open.length === 0) {
    return { months: 0, totalInterest: 0, curve: [], neverPaysOff: false, perDebt: [] };
  }

  let totalInterest = 0;
  const curve: number[] = [];
  const perDebt: { id: string; payoffMonth: number }[] = [];
  // Freed minimums join the pool with a one-month lag.
  let freedMinimums = 0;

  for (let month = 1; month <= MAX_MONTHS; month++) {
    const active = open.filter((d) => d.remaining > 0);
    if (active.length === 0) break;

    const before = active.reduce((a, d) => a + d.remaining, 0);

    // 1) Accrue interest, rounded per debt.
    for (const d of active) {
      const interest = Math.round((d.remaining * d.aprBps) / 12 / 10000);
      d.remaining += interest;
      totalInterest += interest;
    }

    // 2) Minimum payments (capped at what's owed).
    let pool = extra + freedMinimums;
    for (const d of active) {
      const pay = Math.min(d.minPayment, d.remaining);
      d.remaining -= pay;
      // A capped minimum frees the difference for the priority debt this month.
      pool += d.minPayment - pay;
    }

    // 3) Remainder to the priority debt (re-target as debts hit zero).
    while (pool > 0) {
      const targets = active.filter((d) => d.remaining > 0);
      if (targets.length === 0) break;
      const target = targets.sort((a, b) =>
        strategy === 'avalanche'
          ? b.aprBps - a.aprBps || b.remaining - a.remaining
          : a.remaining - b.remaining || a.name.localeCompare(b.name),
      )[0];
      const pay = Math.min(pool, target.remaining);
      target.remaining -= pay;
      pool -= pay;
    }

    // 4) Book payoffs; their minimums roll into next month's pool.
    for (const d of active) {
      if (d.remaining === 0 && d.payoffMonth === 0) {
        d.payoffMonth = month;
        perDebt.push({ id: d.id, payoffMonth: month });
        freedMinimums += d.minPayment;
      }
    }

    const after = open.reduce((a, d) => a + d.remaining, 0);
    curve.push(after);
    if (after === 0) {
      return { months: month, totalInterest, curve, neverPaysOff: false, perDebt };
    }
    // Payments can't keep up with interest → bail out early.
    if (after >= before) {
      return { months: month, totalInterest, curve, neverPaysOff: true, perDebt };
    }
  }
  return { months: MAX_MONTHS, totalInterest, curve, neverPaysOff: true, perDebt };
}
