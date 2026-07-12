import { describe, expect, it } from 'vitest';
import { DebtInput, simulatePayoff } from '../debt';

const debt = (over: Partial<DebtInput>): DebtInput => ({
  id: 'd1', name: 'Card', balance: 100000, aprBps: 0, minPayment: 10000, ...over,
});

describe('simulatePayoff', () => {
  it('0% APR, $100/mo on $1,000 → exactly 10 months, zero interest', () => {
    const r = simulatePayoff([debt({})], 0, 'avalanche');
    expect(r.months).toBe(10);
    expect(r.totalInterest).toBe(0);
    expect(r.neverPaysOff).toBe(false);
    expect(r.curve).toHaveLength(10);
    expect(r.curve[r.curve.length - 1]).toBe(0);
    for (let i = 1; i < r.curve.length; i++) expect(r.curve[i]).toBeLessThan(r.curve[i - 1]);
  });

  it('12% APR (1%/mo): month-1 interest is exactly 1% of the balance', () => {
    const r = simulatePayoff([debt({ aprBps: 1200 })], 0, 'avalanche');
    // Month 1: +1000 interest, -10000 payment → curve[0] = 91000.
    expect(r.curve[0]).toBe(91000);
    // Hand-run month 2: 91000 + 910 - 10000 = 81910.
    expect(r.curve[1]).toBe(81910);
    expect(r.totalInterest).toBeGreaterThan(0);
    expect(r.neverPaysOff).toBe(false);
  });

  it('final payment never overshoots below zero', () => {
    const r = simulatePayoff([debt({ balance: 25000, minPayment: 10000 })], 0, 'avalanche');
    expect(r.months).toBe(3);
    expect(r.curve).toEqual([15000, 5000, 0]);
  });

  it('avalanche targets the higher APR, snowball the smaller balance — avalanche pays less interest', () => {
    const debts = (): DebtInput[] => [
      debt({ id: 'small-lowapr', name: 'A', balance: 50000, aprBps: 1200, minPayment: 2500 }),
      debt({ id: 'big-highapr', name: 'B', balance: 200000, aprBps: 2400, minPayment: 5000 }),
    ];
    const av = simulatePayoff(debts(), 10000, 'avalanche');
    const sn = simulatePayoff(debts(), 10000, 'snowball');
    expect(av.neverPaysOff).toBe(false);
    expect(sn.neverPaysOff).toBe(false);
    // Avalanche pays off the high-APR debt first; snowball the small one.
    expect(av.perDebt.find((d) => d.id === 'big-highapr')!.payoffMonth)
      .toBeLessThan(sn.perDebt.find((d) => d.id === 'big-highapr')!.payoffMonth);
    expect(sn.perDebt.find((d) => d.id === 'small-lowapr')!.payoffMonth)
      .toBeLessThanOrEqual(av.perDebt.find((d) => d.id === 'small-lowapr')!.payoffMonth);
    expect(av.totalInterest).toBeLessThanOrEqual(sn.totalInterest);
  });

  it('detects payments that never pay off (min below interest) and bails early', () => {
    const r = simulatePayoff([debt({ aprBps: 2400, minPayment: 100 })], 0, 'avalanche');
    expect(r.neverPaysOff).toBe(true);
    expect(r.months).toBeLessThan(10); // bails as soon as balance stops shrinking
  });

  it('freed minimums roll into the pool the following month', () => {
    // Two debts; first dies in month 1. Its $50 minimum joins month 2's pool.
    const debts: DebtInput[] = [
      debt({ id: 'tiny', balance: 5000, aprBps: 0, minPayment: 5000 }),
      debt({ id: 'main', balance: 50000, aprBps: 0, minPayment: 5000 }),
    ];
    const r = simulatePayoff(debts, 0, 'snowball');
    // Month 1: tiny -5000 → 0; main -5000 → 45000. curve[0] = 45000.
    expect(r.curve[0]).toBe(45000);
    // Month 2: main pays its 5000 min + 5000 freed = 35000.
    expect(r.curve[1]).toBe(35000);
    // 45000 remaining after month 1 at 10000/mo → months 2..6.
    expect(r.months).toBe(6);
    expect(r.curve).toEqual([45000, 35000, 25000, 15000, 5000, 0]);
  });

  it('ignores paid-off inputs and handles the zero-debt case', () => {
    expect(simulatePayoff([], 10000, 'avalanche').months).toBe(0);
    expect(simulatePayoff([debt({ balance: 0 })], 10000, 'avalanche').months).toBe(0);
  });
});
