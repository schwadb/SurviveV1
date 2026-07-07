import { describe, expect, it } from 'vitest';
import { parseBackup, serializeBackup } from '../backup';
import { makeSeedData, SCHEMA_VERSION } from '../../data/seed';

describe('backup round-trip', () => {
  it('serialize → parse restores an equivalent dataset', () => {
    const seed = makeSeedData();
    const text = serializeBackup(seed, '2026-07-15T00:00:00.000Z');
    const { data, error } = parseBackup(text);
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.transactions).toHaveLength(seed.transactions.length);
    expect(data!.accounts.map((a) => a.id)).toEqual(seed.accounts.map((a) => a.id));
    expect(data!.schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('parseBackup validation', () => {
  it('rejects non-JSON and foreign JSON', () => {
    expect(parseBackup('not json').error).toBeTruthy();
    expect(parseBackup(JSON.stringify({ hello: 'world' })).error).toContain('not a Survive Budget backup');
  });

  it('rejects a backup from a newer app version', () => {
    const seed = makeSeedData();
    const env = JSON.parse(serializeBackup(seed, '2026-07-15T00:00:00.000Z'));
    env.schemaVersion = SCHEMA_VERSION + 1;
    expect(parseBackup(JSON.stringify(env)).error).toContain('newer app version');
  });

  it('rejects backups with missing collections', () => {
    const seed = makeSeedData();
    const env = JSON.parse(serializeBackup(seed, '2026-07-15T00:00:00.000Z'));
    delete env.data.bills;
    expect(parseBackup(JSON.stringify(env)).error).toContain('bills');
  });
});

describe('seed invariants (date-relative data stays coherent)', () => {
  it('every transaction references an existing account and category', () => {
    const seed = makeSeedData();
    const accountIds = new Set(seed.accounts.map((a) => a.id));
    const categoryIds = new Set(seed.categories.map((c) => c.id));
    for (const t of seed.transactions) {
      expect(accountIds.has(t.accountId)).toBe(true);
      if (t.categoryId !== null) expect(categoryIds.has(t.categoryId)).toBe(true);
    }
  });

  it('budgets reference existing categories; bills reference valid due days', () => {
    const seed = makeSeedData();
    const categoryIds = new Set(seed.categories.map((c) => c.id));
    for (const cats of Object.values(seed.budgets)) {
      for (const id of Object.keys(cats)) expect(categoryIds.has(id)).toBe(true);
    }
    for (const b of seed.bills) {
      expect(b.dueDay).toBeGreaterThanOrEqual(1);
      expect(b.dueDay).toBeLessThanOrEqual(28);
    }
  });
});
