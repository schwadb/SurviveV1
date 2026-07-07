// Base64 over Uint8Array without Buffer (Node-only) or btoa/atob
// (Latin-1-only and unreliable on some Hermes releases).

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) t[ALPHABET.charCodeAt(i)] = i;
  return t;
})();

export function toB64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? ALPHABET[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? ALPHABET[b2 & 63] : '=';
  }
  return out;
}

export function fromB64(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(clean)) throw new Error('invalid base64');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n0 = LOOKUP[clean.charCodeAt(i)];
    const n1 = LOOKUP[clean.charCodeAt(i + 1)];
    const n2 = i + 2 < clean.length ? LOOKUP[clean.charCodeAt(i + 2)] : 0;
    const n3 = i + 3 < clean.length ? LOOKUP[clean.charCodeAt(i + 3)] : 0;
    if (n0 < 0 || n1 < 0 || n2 < 0 || n3 < 0) throw new Error('invalid base64');
    out[o++] = (n0 << 2) | (n1 >> 4);
    if (i + 2 < clean.length) out[o++] = ((n1 & 15) << 4) | (n2 >> 2);
    if (i + 3 < clean.length) out[o++] = ((n2 & 3) << 6) | n3;
  }
  return out;
}
