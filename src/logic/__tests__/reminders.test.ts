import { describe, expect, it } from 'vitest';
import { planBillReminders } from '../reminders';
import { Bill } from '../../types';

const bill = (over: Partial<Bill>): Bill => ({
  id: 'b1', name: 'Electric', amount: 1650, dueDay: 15, categoryId: null,
  autopay: false, paidMonths: [], ...over,
});

describe('planBillReminders', () => {
  it('emits heads-up (T-3) and due-date entries for a non-autopay bill', () => {
    const plan = planBillReminders([bill({ dueDay: 15 })], '2026-07-10', 8);
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({ dateIso: '2026-07-12', title: 'Bill coming up' });
    expect(plan[0].body).toBe('Electric · $16.50 due in 3 days');
    expect(plan[1]).toMatchObject({ dateIso: '2026-07-15', title: 'Bill due today' });
  });

  it('autopay bills get the due-date entry only', () => {
    const plan = planBillReminders([bill({ autopay: true })], '2026-07-10', 8);
    expect(plan).toHaveLength(1);
    expect(plan[0].body).toContain('(autopay)');
  });

  it('a month in paidMonths is skipped in favor of the next month', () => {
    const plan = planBillReminders([bill({ paidMonths: ['2026-07'] })], '2026-07-10', 8);
    expect(plan.map((e) => e.dateIso)).toEqual(['2026-08-12', '2026-08-15']);
  });

  it('never emits entries in the past, including earlier today past fire hour', () => {
    // Today is the 15th at 10:00 — the 9:00 due reminder already passed.
    const plan = planBillReminders([bill({ dueDay: 15 })], '2026-07-15', 10);
    expect(plan).toEqual([]);
    // At 08:00 the same day it still fires.
    const early = planBillReminders([bill({ dueDay: 15 })], '2026-07-15', 8);
    expect(early.map((e) => e.dateIso)).toEqual(['2026-07-15']);
  });

  it('overdue this month → no re-notification; next occurrence is planned', () => {
    const plan = planBillReminders([bill({ dueDay: 5 })], '2026-07-10', 8);
    expect(plan.map((e) => e.dateIso)).toEqual(['2026-08-02', '2026-08-05']);
  });

  it('respects the horizon', () => {
    const plan = planBillReminders([bill({ dueDay: 15 })], '2026-07-10', 8, 3);
    expect(plan).toEqual([]);
  });

  it('clamps out-of-range due days defensively', () => {
    const plan = planBillReminders([bill({ dueDay: 45 as number })], '2026-07-10', 8);
    expect(plan.map((e) => e.dateIso)).toEqual(['2026-07-25', '2026-07-28']);
  });

  it('sorts entries chronologically across bills', () => {
    const plan = planBillReminders(
      [bill({ id: 'late', dueDay: 25 }), bill({ id: 'soon', dueDay: 16 })],
      '2026-07-10', 8,
    );
    const dates = plan.map((e) => e.dateIso);
    expect(dates).toEqual([...dates].sort());
  });
});
