import { describe, expect, it } from 'vitest';
import { decryptBackup, encryptBackup, isEncryptedBackup } from '../cryptoBackup';
import { fromB64, toB64 } from '../b64';
import { serializeBackup } from '../backup';
import { makeSeedData } from '../../data/seed';

// Deterministic randomness for stable envelopes in tests.
let seed = 1;
const rand = (n: number) => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 256;
  return out;
};

describe('b64', () => {
  it('round-trips arbitrary bytes at every padding length', () => {
    for (const len of [0, 1, 2, 3, 4, 16, 31, 257]) {
      const bytes = rand(len);
      expect(fromB64(toB64(bytes))).toEqual(bytes);
    }
  });

  it('rejects invalid characters', () => {
    expect(() => fromB64('$$$$')).toThrow();
  });
});

describe('encrypted backups', () => {
  const plaintext = JSON.stringify({ hello: 'wörld 💸', nested: { n: [1, 2, 3] } });

  it('encrypt → decrypt round-trips UTF-8 (incl. emoji) exactly', () => {
    const enc = encryptBackup(plaintext, 'correct horse battery', rand);
    expect(isEncryptedBackup(enc)).toBe(true);
    const { json, error } = decryptBackup(enc, 'correct horse battery');
    expect(error).toBeNull();
    expect(json).toBe(plaintext);
  });

  it('round-trips a real full backup with emoji payees and ~1MB of transactions', () => {
    const data = makeSeedData();
    const big = data.transactions[0];
    for (let i = 0; i < 5000; i++) {
      data.transactions.push({ ...big, id: `bulk-${i}`, payee: `Café ☕ #${i}` });
    }
    const text = serializeBackup(data, '2026-07-15T00:00:00.000Z');
    const enc = encryptBackup(text, 'pass phrase 8+', rand);
    const { json, error } = decryptBackup(enc, 'pass phrase 8+');
    expect(error).toBeNull();
    expect(json).toBe(text);
  });

  it('wrong passphrase → safe error, no throw', () => {
    const enc = encryptBackup(plaintext, 'right password', rand);
    const { json, error } = decryptBackup(enc, 'wrong password');
    expect(json).toBeNull();
    expect(error).toContain('Wrong passphrase');
  });

  it('a single flipped ciphertext byte fails authentication', () => {
    const enc = JSON.parse(encryptBackup(plaintext, 'password!', rand));
    const ct = fromB64(enc.ct);
    ct[Math.floor(ct.length / 2)] ^= 0xff;
    enc.ct = toB64(ct);
    const { json, error } = decryptBackup(JSON.stringify(enc), 'password!');
    expect(json).toBeNull();
    expect(error).toContain('Wrong passphrase');
  });

  it('rejects hostile KDF params without deriving', () => {
    const enc = JSON.parse(encryptBackup(plaintext, 'password!', rand));
    enc.kdf.N = 2 ** 30;
    const start = Date.now();
    const { error } = decryptBackup(JSON.stringify(enc), 'password!');
    expect(error).toContain('Unsupported');
    expect(Date.now() - start).toBeLessThan(1000); // bailed before key derivation
  });

  it('plaintext backups are not detected as encrypted', () => {
    const plain = serializeBackup(makeSeedData(), '2026-07-15T00:00:00.000Z');
    expect(isEncryptedBackup(plain)).toBe(false);
    expect(decryptBackup(plain, 'x').error).toContain('not an encrypted');
  });
});
