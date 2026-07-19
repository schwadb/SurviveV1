# PLAN: OPSEC hardening (CSP, self-hosted assets, key vault-lock)

**Leverage rank: 5 of 5.**
**Why #5:** Important for credibility as a *security* tool, but less user-visible than 1–4, so it goes last. It makes the app's "local-only / no telemetry" claims actually true and closes the plaintext-API-key gap. Ships in two waves: three quick safe wins, then the key-vault refactor.
**Effort:** Wave A = S (half a day). Wave B = M (1–2 days).

---

## Goal
- **A1. Content-Security-Policy** with an explicit `connect-src` allowlist (browser-enforced egress control that backs the egress ledger already shown in `src/pages/Security.tsx`).
- **A2. Self-host Leaflet/MarkerCluster CSS** — remove the `unpkg` and Google-Fonts external loads from `index.html` so the app is truly offline/air-gap capable.
- **A3. Fix the dead PWA map-tile cache rule** in `vite.config.ts` (the `{s}` literal never matches).
- **B1. Vault-lock API keys** — optionally encrypt the API keys at rest (they are plaintext in `localStorage` today) using the existing `src/services/vault.ts`, gated by a session passphrase.

---

## Exact files to touch
- `index.html` (add CSP meta; remove unpkg + fonts links)
- `src/main.tsx` (import Leaflet + MarkerCluster CSS locally)
- `vite.config.ts` (fix the cartocdn `urlPattern`)
- `src/services/vault.ts` (already has `encryptText`/`decryptText` — reuse, no change needed)
- **CREATE** `src/hooks/useKeyVault.tsx` (context provider holding decrypted keys in memory)
- `src/hooks/useLocalStorage.ts` (AppSettings already has the key fields — reference only)
- `src/components/resources/Settings.tsx` (add "Encrypt keys" toggle + unlock UI)
- Call sites that read keys (Wave B migration): `src/pages/DorkBuilder.tsx:482`, `src/components/ai/PerplexitySearch.tsx:73`, `src/components/ai/IntelSummary.tsx:163`, `src/components/lookup/PhoneLookup.tsx` (from Plan 1), `src/components/tracking/ShipTracker.tsx` (from Plan 1).

---

## Wave A — quick safe wins

### A1. CSP
Add to `index.html` `<head>` (first element after `<meta charset>`). This is the exact allowlist for every host the app currently contacts; add `services.nvd.nist.gov earthquake.usgs.gov api.weather.gov gibs.earthdata.nasa.gov` too if Plans 3–4 are merged.
```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://gibs.earthdata.nasa.gov https://*.tile.openstreetmap.org;
  connect-src 'self'
    https://opensky-network.org https://celestrak.org wss://stream.aisstream.io
    https://api.perplexity.ai https://nominatim.openstreetmap.org https://apilayer.net
    https://dns.google https://internetdb.shodan.io https://ipwho.is
    https://api.pwnedpasswords.com https://archive.org https://web.archive.org
    https://api.github.com https://haveibeenpwned.com
    https://services.nvd.nist.gov https://earthquake.usgs.gov https://api.weather.gov https://gibs.earthdata.nasa.gov;
  worker-src 'self' blob:;
  object-src 'none';
  base-uri 'none';
" />
```

### A2. Self-host CSS
1. Remove from `index.html`: the `<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />` and the `<link rel="preconnect" href="https://fonts.googleapis.com" />` lines.
2. In `src/main.tsx`, add near the top (leaflet + leaflet.markercluster are already dependencies):
   ```ts
   import 'leaflet/dist/leaflet.css';
   import 'leaflet.markercluster/dist/MarkerCluster.css';
   import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
   ```

### A3. Fix PWA map-tile cache
In `vite.config.ts`, the rule `urlPattern: /^https:\/\/{s}\.basemaps\.cartocdn\.com\//` never matches (real subdomains are `a`–`d`). Replace with:
```ts
urlPattern: /^https:\/\/[a-d]\.basemaps\.cartocdn\.com\//,
```

---

## Wave B — vault-lock API keys

Today `settings.perplexityApiKey` / `numverifyApiKey` / `aisStreamApiKey` / `n2yoApiKey` sit in plaintext in `localStorage['watcher-settings']`. Add opt-in encryption.

### B1. `useKeyVault.tsx` (React context)
- State: `locked: boolean`, an in-memory `keys: Record<string,string>` (never persisted plaintext), and `vaultEnabled` (persisted flag in localStorage `watcher-vault-enabled`).
- Persist the *encrypted* blob in localStorage `watcher-key-vault` (output of `encryptText(JSON.stringify(keys), passphrase)`).
- API: `unlock(passphrase)` → `decryptText` the blob into memory, set `locked=false`; `lock()` → wipe in-memory keys; `enableVault(passphrase)` → read current plaintext keys from settings, encrypt them into the vault, then blank the plaintext fields in `watcher-settings`; `getKey(name)` → returns the in-memory key if vault enabled+unlocked, else the plaintext `settings[name]`.
- Wrap `<App/>` in `<KeyVaultProvider>` in `main.tsx`.

### B2. Migrate call sites
Replace direct `settings.perplexityApiKey` reads with `useKeyVault().getKey('perplexityApiKey')` at the 5 call sites listed above. If vault is enabled but locked, `getKey` returns `''` → the existing "add API key" empty-state paths already handle empty keys gracefully (verified in each component), so no crashes.

### B3. Settings UI
Add a "Secure Vault" card in `Settings.tsx`: a toggle "Encrypt API keys at rest" → on enable, prompt for a passphrase (reuse the strength meter from `passphraseStrength` in `vault.ts`), call `enableVault`. When enabled+locked, show an "Unlock" passphrase field. When enabled, the plaintext key inputs render as "🔒 stored in vault" and are hidden.

---

## Edge cases a weaker model WILL miss
1. **`<meta>` CSP cannot express every directive.** `frame-ancestors`, `report-uri`, and `sandbox` are ignored in a meta tag (they require an HTTP header, which a no-backend static host can't set here). Only include header-independent directives (as above). Do not add `frame-ancestors` to the meta and assume it works.
2. **`connect-src` must include the `wss://` scheme for AISStream.** WebSocket connections are governed by `connect-src`; omitting `wss://stream.aisstream.io` silently kills the live ship feed from Plan 1.
3. **`style-src 'unsafe-inline'` is unavoidable here.** Leaflet `divIcon`s, react-hot-toast, and many inline `style=` attributes require it. A strict style CSP would need removing all inline styles first (out of scope). Keep `'unsafe-inline'` for **style only** — the important XSS control is `script-src 'self'` (no `'unsafe-inline'` on scripts), which this app supports because `index.html` has no inline scripts (only `<script type="module" src>`).
4. **`img-src` needs `data:` and `blob:`.** Marker icons and exported blobs use data/blob URLs; omitting them breaks map markers and downloads.
5. **The dev server may violate CSP.** Vite's HMR client uses inline scripts/eval in dev. Either scope the CSP meta to production only (inject via a small Vite transform in `vite.config.ts` that adds it to `dist/index.html`), or accept dev-console CSP warnings. Document which you chose. Simplest: leave the meta in `index.html` and accept dev warnings — production build is what matters.
6. **Vault migration must not lose keys.** `enableVault` must read the current plaintext keys BEFORE blanking them, encrypt, verify a `decryptText` round-trip succeeds, and only THEN blank the plaintext settings. If encryption/round-trip fails, abort and keep plaintext. Never blank first.
7. **Locked vault ≠ broken app.** When enabled+locked, `getKey` returns `''`; every key consumer must treat `''` as "no key" (show the existing add-key prompt), not throw. Verify each of the 5 call sites already guards on empty string (they do today).
8. **Do not persist decrypted keys.** The in-memory `keys` map lives only in React state/context memory; never write it back to localStorage unencrypted. On `lock()` or tab close it's gone (that's the point).
9. **PWA precache + CSP:** the service worker fetches are same-origin (`'self'`) — fine. But if you self-host fonts later, add them to the precache `globPatterns` (already includes `woff2`).

---

## Acceptance criteria (verifiable)
- [ ] `npm run build` exits 0; `dist/index.html` contains the CSP meta.
- [ ] Load the production build (`npm run preview`), open DevTools → Console: no CSP violation errors during normal use (map loads, a pivot runs, AI search fires). Any blocked host is one you intended to block.
- [ ] `index.html` no longer references `unpkg.com` or `fonts.googleapis.com` (`grep -E "unpkg|googleapis" index.html` returns nothing); the Leaflet map still renders with correct control/popup styling (proves CSS is self-hosted).
- [ ] Map tiles are served from the `map-tiles` cache on a second load (DevTools → Application → Cache Storage shows entries; was empty before the regex fix). Verify offline: after one online load, go offline and the app shell + last tiles still render.
- [ ] With vault disabled: keys behave exactly as today (plaintext in settings) — no regression.
- [ ] Enabling the vault with passphrase `Test-Pass-9!` encrypts keys (localStorage `watcher-key-vault` holds a `WV1…` blob; `watcher-settings` key fields are now empty); reloading prompts for unlock; unlocking restores full functionality (AI search / phone lookup / ship feed work again).
- [ ] Wrong passphrase on unlock shows an error and does NOT wipe the vault.
- [ ] `grep -rn "settings.perplexityApiKey\|settings.numverifyApiKey\|settings.aisStreamApiKey" src` shows the reads now go through `getKey(...)` (or the call sites are migrated) — no direct plaintext reads remain in the 5 listed components.
