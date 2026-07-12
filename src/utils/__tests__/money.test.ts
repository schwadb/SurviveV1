import { describe, expect, it } from 'vitest';
import { fmt, fmtShort, parseAmount } from '../money';

describe('fmt', () => {
  it('formats cents with thousands separators', () => {
    expect(fmt(123456)).toBe('$1,234.56');
    expect(fmt(0)).toBe('$0.00');
    expect(fmt(5)).toBe('$0.05');
  });

  it('formats negatives and explicit plus signs', () => {
    expect(fmt(-123456)).toBe('-$1,234.56');
    expect(fmt(50, { sign: true })).toBe('+$0.50');
    expect(fmt(-50, { sign: true })).toBe('-$0.50');
  });

  it('compact: $100k must not render as millions (regression)', () => {
    expect(fmt(100000_00, { compact: true })).toBe('$100k');
    expect(fmt(100000_00, { compact: true })).not.toContain('M');
  });

  it('compact: millions threshold and math', () => {
    expect(fmt(1500000_00, { compact: true })).toBe('$1.5M');
    expect(fmt(1000000_00, { compact: true })).toBe('$1.0M');
    expect(fmt(9999_99, { compact: true })).toBe('$9,999.99');
  });
});

describe('fmtShort', () => {
  it('drops cents for whole-dollar values', () => {
    expect(fmtShort(6511100)).toBe('$65,111');
    expect(fmtShort(-6511100)).toBe('-$65,111');
  });

  it('keeps cents otherwise', () => {
    expect(fmtShort(123456)).toBe('$1,234.56');
  });
});

describe('parseAmount', () => {
  it('parses plain and formatted amounts to cents', () => {
    expect(parseAmount('12.34')).toBe(1234);
    expect(parseAmount('$1,200')).toBe(120000);
    expect(parseAmount('-5')).toBe(-500);
    expect(parseAmount('0.5')).toBe(50);
  });

  it('rejects garbage, lone symbols, and >2 decimals', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('-')).toBeNull();
    expect(parseAmount('.')).toBeNull();
    expect(parseAmount('1.234')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
});
