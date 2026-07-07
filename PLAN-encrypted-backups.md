# PLAN: Passphrase-encrypted backups

> **Status: ✅ COMPLETED** — implemented, unit-tested, and verified end-to-end.

**Rank: 5 of 5.** The README's Security model section explicitly flags the gap:
"Backup JSON files are unencrypted by design (portability)… Encrypted backups
… are on the roadmap." A backup file contains the user's complete financial
life; once it leaves the device (email, Drive, iCloud via the share sheet) it
is the app's biggest data-exposure surface.

## Goal

An "Export encrypted backup" option alongside the plaintext one: user supplies a
passphrase, the app writes an AES-256-GCM-encrypted envelope. Restore
auto-detects encrypted files and prompts for the passphrase. Wrong passphrase or
a tampered file fails loudly and safely. Plaintext export/restore keeps working
unchanged (portability remains a feature).

## Exact files to touch

- `package.json` — add `@noble/ciphers` and `@noble/hashes` (pure-JS, audited,
  no native modules — they work identically on Hermes and web).
- `src/utils/b64.ts` — new: `toB64(Uint8Array) → string`,
  `fromB64(string) → Uint8Array` implemented with a lookup table (see edge
  cases for why not `btoa`/`Buffer`).
- `src/utils/cryptoBackup.ts` — new, the only crypto-aware module:
  `encryptBackup(plaintextJson: string, passphrase: string, rand: (n: number)
  => Uint8Array) → string` and `decryptBackup(fileText: string, passphrase:
  string) → {json: string | null, error: string | null}`, plus
  `isEncryptedBackup(text: string) → boolean`.
- `src/utils/backup.ts` — unchanged logic; `parseBackup` stays the
  plaintext-envelope validator (decrypt happens before it).
- `src/components/forms.tsx` — new `PassphraseSheet` (mirrors the existing
  `Sheet` + `Field` patterns): mode `export` (passphrase + confirm, min 8
  chars) and mode `restore` (single field).
- `src/screens/MoreScreen.tsx` — "Export encrypted backup (JSON)" button; the
  existing `pickBackupFile` gains a branch: `isEncryptedBackup(text)` → open
  PassphraseSheet(restore) → `decryptBackup` → feed result into the existing
  `parseBackup` → `pendingRestore` confirm flow.
- `src/utils/__tests__/cryptoBackup.test.ts` — unit tests.
- `README.md` — Security model section: replace the roadmap sentence.

## File format (exact)

```json
{
  "app": "survive-budget-encrypted",
  "v": 1,
  "kdf": { "name": "scrypt", "N": 32768, "r": 8, "p": 1 },
  "salt": "<base64, 16 bytes>",
  "nonce": "<base64, 12 bytes>",
  "ct": "<base64, ciphertext+GCM tag>"
}
```
The plaintext inside is exactly what `serializeBackup()` produces today.

## Step-by-step implementation order

1. `npm install @noble/ciphers @noble/hashes`.
2. Write `src/utils/b64.ts` + tests (round-trip random bytes, empty array,
   lengths 1/2/3 mod padding).
3. Write `src/utils/cryptoBackup.ts`:
   - Key: `scrypt(utf8(passphrase), salt, {N: 32768, r: 8, p: 1, dkLen: 32})`
     from `@noble/hashes/scrypt`.
   - Cipher: `gcm(key, nonce).encrypt(utf8Bytes)` from
     `@noble/ciphers/aes`.
   - `decryptBackup`: parse JSON envelope; validate `app`/`v`/kdf params
     (reject `N > 2**20` — see edge cases); derive key with the params FROM THE
     FILE (not constants), decrypt; GCM auth failure → `{json: null, error:
     'Wrong passphrase or corrupted file.'}` — catch the throw; never let it
     bubble to a crash.
   - Randomness comes in via the `rand` parameter — pass
     `Crypto.getRandomBytes` from `expo-crypto` at the call site (install with
     `npx expo install expo-crypto`); tests pass a deterministic stub. Do NOT
     reach for `crypto.getRandomValues` inside the module (absent on some
     Hermes versions) or `Math.random` (never).
4. Unit tests (cases below) — get these green before any UI.
5. Build `PassphraseSheet` and wire MoreScreen:
   - Export: validate length ≥ 8 and match; then
     `exportTextFile('survive-budget-backup-<date>.enc.json',
     'application/json', encryptBackup(serializeBackup(store, iso), pass, rand))`.
   - Restore: `pickBackupFile` reads text; if `isEncryptedBackup` stash the raw
     text in state, open PassphraseSheet(restore); on submit decrypt → on error
     show it in the sheet (keep it open for retry) → on success run
     `parseBackup(json)` and hand off to the existing `pendingRestore`
     confirmation UI (do not skip it — decryption success is not consent to
     wipe current data).
6. `npx tsc --noEmit`, web export, run all drives; extend the improvements
   drive: export encrypted (download), clear data, restore with the right
   passphrase (round-trip), then attempt a wrong passphrase and assert the
   error dialog text.

## Edge cases a weaker model would miss

- **There is no WebCrypto on React Native.** Hermes has no `crypto.subtle`, so
  "just use AES-GCM from WebCrypto" produces code that works in the web build
  and crashes on device. Pure-JS `@noble/*` is the portable choice; that is the
  entire reason for the dependency.
- **No `Buffer`, unreliable `btoa`, on RN.** `Buffer` is Node-only;
  `btoa`/`atob` handle only Latin-1 and are missing or broken on some Hermes
  releases. Hand-rolled base64 over `Uint8Array` (or `@noble`'s own
  `bytesToBase64` if available in the installed version) avoids the whole
  class of "works on web, corrupts on Android" bugs.
- **UTF-8, not UTF-16**: encode the JSON with `TextEncoder` (present in Hermes
  ≥ 0.72 and web). Payees with emoji (the seed has them) will corrupt under any
  charCode-based conversion — include an emoji payee in the round-trip test.
- **KDF params must be read from the file** on decrypt so future param bumps
  stay backward-compatible — but clamp `N ≤ 2**20`: a hostile file with
  `N: 2**30` is a denial-of-service that freezes the app deriving a key.
- **GCM tag verification throws** in `@noble/ciphers`; an uncaught throw in an
  async handler on RN is a red-box crash, not a rejected promise in the UI.
  Always try/catch inside `decryptBackup`.
- **scrypt N=32768 takes ~100–400 ms on a mid Android phone** — acceptable, but
  run it after `await`ing one frame (or show the existing disabled-button
  state) so the sheet's button press doesn't appear frozen; do NOT raise N
  higher without profiling on device.
- **Don't persist or log the passphrase** — it lives only in the sheet's local
  state; explicitly avoid putting it in the zustand store (which is persisted
  wholesale by `partialize`).
- **Restore must still pass through `parseBackup` + the confirm step** —
  decrypt validates authenticity, `parseBackup` validates structure, the
  confirm protects against fat-fingering; skipping any layer weakens the chain.
- **Filename matters for the picker**: keep the `.json` suffix
  (`.enc.json`) — the DocumentPicker filter in `pickBackupFile` requests
  `application/json`/`text/*`, and iOS hides non-matching files.
- **Existing plaintext backups must keep restoring** — regression-test the
  plain path in the same e2e run; `isEncryptedBackup` must key on
  `app === 'survive-budget-encrypted'`, not on "JSON parse failed".

## Acceptance criteria

1. Unit tests: encrypt→decrypt round-trip returns byte-identical JSON
   (including an emoji payee and a 1MB synthetic transactions array); wrong
   passphrase → `{json: null, error}` (no throw); flipping one ciphertext byte
   → same safe error; envelope with `N: 2**30` rejected without deriving;
   plaintext backup text → `isEncryptedBackup` false; deterministic `rand`
   stub yields a stable envelope (snapshot-safe).
2. `npx tsc --noEmit` clean; `npx expo export --platform web` builds; all
   existing drives print `"errors": []`.
3. e2e (web): export encrypted backup → clear all data → restore the `.enc.json`
   with the correct passphrase → "Everyday Checking" is back; restoring with a
   wrong passphrase surfaces "Wrong passphrase or corrupted file." and does NOT
   modify data; restoring the old plaintext backup file still works.
4. README Security model no longer lists encrypted backups as roadmap.
