import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addMonths, dateLabel, daysInMonth, lastMonths, monthKey, monthKeyOfIso,
  monthLabel, monthLabelShort, todayIso, yesterdayIso,
} from '../dates';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 6, 15, 12, 0, 0)); // 2026-07-15 local
});
afterEach(() => vi.useRealTimers());

describe('month keys', () => {
  it('monthKey / monthKeyOfIso / todayIso / yesterdayIso', () => {
    expect(monthKey()).toBe('2026-07');
    expect(monthKeyOfIso('2026-03-09')).toBe('2026-03');
    expect(todayIso()).toBe('2026-07-15');
    expect(yesterdayIso()).toBe('2026-07-14');
  });

  it('addMonths crosses year boundaries both ways', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-07', -5)).toBe('2026-02');
  });

  it('lastMonths returns oldest-first ending at end', () => {
    expect(lastMonths(3, '2026-07')).toEqual(['2026-05', '2026-06', '2026-07']);
  });
});

describe('labels', () => {
  it('monthLabel / monthLabelShort', () => {
    expect(monthLabel('2026-07')).toBe('July 2026');
    expect(monthLabelShort('2026-07')).toBe('Jul');
  });

  it('dateLabel: today, yesterday, same-year, cross-year', () => {
    expect(dateLabel('2026-07-15')).toBe('Today');
    expect(dateLabel('2026-07-14')).toBe('Yesterday');
    expect(dateLabel('2026-07-01')).toBe('Jul 1');
    expect(dateLabel('2025-12-31')).toBe('Dec 31, 2025');
  });
});

describe('daysInMonth', () => {
  it('handles February and 30/31-day months', () => {
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysInMonth('2026-04')).toBe(30);
    expect(daysInMonth('2026-07')).toBe(31);
  });
});
