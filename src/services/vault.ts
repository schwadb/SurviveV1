// ─────────────────────────────────────────────────────────────────────────────
// Local encryption vault — WebCrypto AES-256-GCM with a PBKDF2-derived key.
//
// Used to encrypt sensitive case data / API-key backups at rest. Everything
// happens in the browser; the passphrase and plaintext never leave the device.
// The output is a self-describing base64 blob (salt ‖ iv ‖ ciphertext) so an
// encrypted export is portable and can be decrypted later with the passphrase.
// ─────────────────────────────────────────────────────────────────────────────

const SALT_BYTES = 16;
const IV_BYTES = 12;
const PBKDF2_ITERATIONS = 250_000;

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt a string with a passphrase. Returns a portable base64 blob. */
export async function encryptText(plaintext: string, passphrase: string): Promise<string> {
  if (!passphrase) throw new Error('Passphrase required');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(plaintext)),
  );
  const blob = new Uint8Array(salt.length + iv.length + cipher.length);
  blob.set(salt, 0);
  blob.set(iv, salt.length);
  blob.set(cipher, salt.length + iv.length);
  return `WV1${toB64(blob)}`;
}

/** Decrypt a blob produced by encryptText. Throws on wrong passphrase / tampering. */
export async function decryptText(payload: string, passphrase: string): Promise<string> {
  if (!passphrase) throw new Error('Passphrase required');
  const b64 = payload.startsWith('WV1') ? payload.slice(3) : payload;
  const blob = fromB64(b64);
  const salt = blob.slice(0, SALT_BYTES);
  const iv = blob.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const cipher = blob.slice(SALT_BYTES + IV_BYTES);
  const key = await deriveKey(passphrase, salt);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, cipher as BufferSource);
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error('Decryption failed — wrong passphrase or corrupted data');
  }
}

/** Estimate passphrase strength on a 0–4 scale for the UI meter. */
export function passphraseStrength(pw: string): { score: number; label: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 14) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^\w\s]/.test(pw)) score++;
  score = Math.min(4, score);
  const label = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'][score];
  return { score, label };
}

/** Wipe all WatcherV1 local data — localStorage keys + IndexedDB. */
export async function panicWipe(): Promise<void> {
  // localStorage: everything under the watcher- namespace.
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('watcher-')) keys.push(k);
  }
  keys.forEach((k) => localStorage.removeItem(k));

  // IndexedDB: the agent recorder database.
  try {
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      await Promise.all(
        dbs.filter((d) => d.name?.startsWith('watcher-')).map((d) =>
          new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(d.name!);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
          }),
        ),
      );
    } else {
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase('watcher-agent-db');
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });
    }
  } catch {
    /* best-effort */
  }
}
