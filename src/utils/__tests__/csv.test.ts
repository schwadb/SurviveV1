import { describe, expect, it } from 'vitest';
import { parseTransactionsCsv, transactionsToCsv } from '../csv';
import { AppData } from '../../types';

const data = {
  accounts: [{ id: 'a1', name: 'Checking', type: 'checking', openingBalance: 0, onBudget: true }],
  groups: [],
  categories: [
    { id: 'c1', groupId: 'g', name: 'Groceries', emoji: '🛒', colorSlot: 0, rollover: false, sortOrder: 0 },
  ],
  transactions: [
    { id: 't1', accountId: 'a1', categoryId: 'c1', payee: 'Smith, John\'s "Store"', amount: -450, date: '2026-07-01', cleared: true },
    { id: 't2', accountId: 'a1', categoryId: null, payee: 'Plain', amount: 1000, date: '2026-06-30', cleared: true },
  ],
  budgets: {},
  goals: [],
  bills: [],
  rules: [],
  settings: { themeMode: 'system', currency: 'USD', showSafeToSpend: true },
  schemaVersion: 3,
} as unknown as AppData;

describe('transactionsToCsv', () => {
  it('escapes commas and quotes, sorts by date, formats dollars', () => {
    const csv = transactionsToCsv(data);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('date,payee,category,account,amount,note');
    expect(lines[1]).toContain('2026-06-30'); // sorted ascending
    expect(lines[2]).toContain('"Smith, John\'s ""Store"""');
    expect(lines[2]).toContain('-4.50');
    expect(lines[1]).toContain('10.00');
  });
});

describe('parseTransactionsCsv', () => {
  it('parses a simple statement with a Description header', () => {
    const { rows, errors } = parseTransactionsCsv(
      'Date,Description,Amount\n2026-07-01,Coffee,-4.50\n2026-07-02,Refund,12.00',
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { date: '2026-07-01', payee: 'Coffee', amount: -450, categoryName: undefined },
      { date: '2026-07-02', payee: 'Refund', amount: 1200, categoryName: undefined },
    ]);
  });

  it('normalizes M/D/YYYY and 2-digit years', () => {
    const { rows } = parseTransactionsCsv('date,payee,amount\n7/2/2026,A,-1\n07/04/26,B,-2');
    expect(rows[0].date).toBe('2026-07-02');
    expect(rows[1].date).toBe('2026-07-04');
  });

  it('handles quoted fields with embedded commas and doubled quotes', () => {
    const { rows, errors } = parseTransactionsCsv(
      'date,payee,amount\n2026-07-01,"Smith, John\'s ""Store""",-3.00',
    );
    expect(errors).toEqual([]);
    expect(rows[0].payee).toBe('Smith, John\'s "Store"');
  });

  it('collects per-row errors and keeps good rows', () => {
    const { rows, errors } = parseTransactionsCsv(
      'date,payee,amount\nbad-date,X,-1\n2026-07-01,,-1\n2026-07-01,Y,abc\n2026-07-01,Z,-2',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].payee).toBe('Z');
    expect(errors).toHaveLength(3);
  });

  it('rejects missing header columns and empty input', () => {
    expect(parseTransactionsCsv('a,b,c\n1,2,3').errors.length).toBeGreaterThan(0);
    expect(parseTransactionsCsv('date,payee,amount').errors.length).toBeGreaterThan(0);
  });

  it('reads an optional category column', () => {
    const { rows } = parseTransactionsCsv(
      'date,payee,amount,category\n2026-07-01,A,-1.00,Groceries',
    );
    expect(rows[0].categoryName).toBe('Groceries');
  });
});
