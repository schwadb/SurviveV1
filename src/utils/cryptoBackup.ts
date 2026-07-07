// Passphrase-encrypted backups: scrypt key derivation + AES-256-GCM via
// pure-JS @noble libraries. React Native's Hermes has no WebCrypto (and no
// Buffer), so WebCrypto-based approaches work on web and crash on device —
// @noble runs identically everywhere. Randomness is injected (expo-crypto's
// getRandomBytes at call sites, a stub in tests).
import { gcm } from '@noble/ciphers/aes.js';
import { scrypt } from '@noble/hashes/scrypt.js';
import { fromB64, toB64 } from './b64';

const KDF = { name: 'scrypt' as const, N: 32768, r: 8, p: 1 };
const MAX_N = 2 ** 20; // reject hostile envelopes that would freeze key derivation

interface EncryptedEnvelope {
  app: 'survive-budget-encrypted';
  v: 1;
  kdf: { name: string; N: number; r: number; p: number };
  salt: string;
  nonce: string;
  ct: string;
}

export function isEncryptedBackup(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as Partial<EncryptedEnvelope>;
    return parsed?.app === 'survive-budget-encrypted';
  } catch {
    return false;
  }
}

function deriveKey(passphrase: string, salt: Uint8Array, kdf: typeof KDF): Uint8Array {
  return scrypt(new TextEncoder().encode(passphrase), salt, {
    N: kdf.N, r: kdf.r, p: kdf.p, dkLen: 32,
  });
}

export function encryptBackup(
  plaintextJson: string,
  passphrase: string,
  rand: (n: number) => Uint8Array,
): string {
  const salt = rand(16);
  const nonce = rand(12);
  const key = deriveKey(passphrase, salt, KDF);
  const ct = gcm(key, nonce).encrypt(new TextEncoder().encode(plaintextJson));
  const envelope: EncryptedEnvelope = {
    app: 'survive-budget-encrypted',
    v: 1,
    kdf: KDF,
    salt: toB64(salt),
    nonce: toB64(nonce),
    ct: toB64(ct),
  };
  return JSON.stringify(envelope, null, 2);
}

export interface DecryptResult {
  json: string | null;
  error: string | null;
}

export function decryptBackup(fileText: string, passphrase: string): DecryptResult {
  let env: Partial<EncryptedEnvelope>;
  try {
    env = JSON.parse(fileText);
  } catch {
    return { json: null, error: 'Not a valid backup file.' };
  }
  if (env?.app !== 'survive-budget-encrypted' || env.v !== 1) {
    return { json: null, error: 'This is not an encrypted Survive Budget backup.' };
  }
  const kdf = env.kdf;
  if (
    !kdf || kdf.name !== 'scrypt' ||
    !Number.isInteger(kdf.N) || kdf.N < 2 || kdf.N > MAX_N ||
    !Number.isInteger(kdf.r) || kdf.r < 1 || kdf.r > 32 ||
    !Number.isInteger(kdf.p) || kdf.p < 1 || kdf.p > 16 ||
    typeof env.salt !== 'string' || typeof env.nonce !== 'string' || typeof env.ct !== 'string'
  ) {
    return { json: null, error: 'Unsupported or unsafe backup parameters.' };
  }
  try {
    // Derive with the params FROM THE FILE so future param bumps stay readable.
    const key = deriveKey(passphrase, fromB64(env.salt), kdf as typeof KDF);
    const plain = gcm(key, fromB64(env.nonce)).decrypt(fromB64(env.ct));
    return { json: new TextDecoder().decode(plain), error: null };
  } catch {
    // GCM auth failure throws — wrong passphrase and tampering both land here.
    return { json: null, error: 'Wrong passphrase or corrupted file.' };
  }
}
