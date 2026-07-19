# PLAN: Wire real live data into pages that currently fake it

**Leverage rank: 1 of 5 — DO THIS FIRST.**
**Why #1:** The app's biggest credibility problem is that several pages render hardcoded mock data behind "Live" labels. The real service functions already exist and are fully written — they just have **zero callers**. This is the highest impact for the least effort: you are connecting existing plumbing, not building new systems.
**Effort:** M (1–2 days).
**Prerequisite knowledge:** none beyond this file. Do not ask questions — every decision is specified below.

---

## Goal
Make three surfaces show real data instead of mock, and fix one recording bug:
1. **Ship Tracker** → live AIS via `connectAISStream` (already in `src/services/api.ts`).
2. **Phone Lookup** → real validation via `lookupPhoneNumber` (already in `src/services/api.ts`).
3. **Dashboard** → stop claiming "Live feeds active" when nothing live is enabled; label sample data honestly.
4. **Agent Recorder** → fix zombie "recording" sessions that can never be stopped after a reload.

Keep the existing dark design-system classes (`.card`, `.btn-primary`, `.badge`, `.input-field`, `.section-title`). Match the existing code style exactly.

---

## Exact files to touch
- `src/components/tracking/ShipTracker.tsx` (rewrite data source; keep all JSX/layout)
- `src/components/lookup/PhoneLookup.tsx` (replace `handleLookup` body + remove dead key read)
- `src/pages/Dashboard.tsx` (honesty fix on the "Live feeds active" pill + a `sample data` note)
- `src/components/ai/AgentRecorder.tsx` (resume/downgrade orphaned recording sessions on load)
- Read-only reference (do NOT change): `src/services/api.ts` (`connectAISStream`, `lookupPhoneNumber`), `src/hooks/useLocalStorage.ts` (`useSettings`, fields `aisStreamApiKey`, `numverifyApiKey`, `enableLiveShips`).

---

## Reference: the service signatures you will call (already implemented)
```ts
// src/services/api.ts
connectAISStream(apiKey: string, onData: (vessels: Ship[]) => void, boundingBoxes?: number[][]): WebSocket
//   → each onData call delivers ONE ship (one PositionReport). Accumulate them.
lookupPhoneNumber(phone: string, apiKey: string): Promise<{
  valid: boolean; number: string; local_format: string; international_format: string;
  country_code: string; country_name: string; location: string; carrier: string;
  line_type: string; success?: boolean; error?: { info: string };
}>
```
`useSettings()` returns `[settings, setSettings]` where `settings` has: `aisStreamApiKey`, `numverifyApiKey`, `enableLiveShips` (boolean), `enableLiveAircraft`, `enableLiveSatellites`.

---

## Step-by-step implementation

### Task 1 — Ship Tracker live AIS
1. In `ShipTracker.tsx`, add imports: `useEffect, useRef` from react; `connectAISStream` from `../../services/api`; `useSettings` from `../../hooks/useLocalStorage`.
2. Add state/refs after the existing `useState`s:
   ```ts
   const [settings] = useSettings();
   const [isLive, setIsLive] = useState(false);
   const wsRef = useRef<WebSocket | null>(null);
   const shipMapRef = useRef<Map<string, ShipType>>(new Map());
   ```
3. Add a live-connection effect (place after existing declarations, before `filtered`):
   ```ts
   useEffect(() => {
     if (!settings.enableLiveShips || !settings.aisStreamApiKey) { setIsLive(false); return; }
     shipMapRef.current = new Map();
     const ws = connectAISStream(settings.aisStreamApiKey, (vessels) => {
       for (const v of vessels) shipMapRef.current.set(v.mmsi, v);
     });
     wsRef.current = ws;
     setIsLive(true);
     // Flush the accumulating map into state at 1 Hz (AIS is high-volume; do NOT setState per message)
     const flush = setInterval(() => {
       setShips(Array.from(shipMapRef.current.values()));
     }, 1000);
     return () => { clearInterval(flush); ws.close(); wsRef.current = null; };
   }, [settings.enableLiveShips, settings.aisStreamApiKey]);
   ```
4. Change `handleRefresh`: when live, it should be a no-op toast ("Live feed streaming"); when not live, keep the existing mock jitter. Guard: `if (isLive) return;` at the top.
5. Fix line 22 `shipTypes` — derive from `ships` (live-aware), not `mockShips`:
   `const shipTypes = ['all', ...Array.from(new Set(ships.map((s) => s.type)))];`
6. In the "Live Ship Positions" `card-header`, show a real status badge:
   `{isLive ? <span className="badge badge-green">● AISStream live</span> : <span className="badge badge-yellow">sample data</span>}` (place before the existing vessel-count badge).
7. If `settings.enableLiveShips` is on but `aisStreamApiKey` is empty, render a one-line notice card above the map: "Add an AISStream.io API key in Settings to stream live vessels." Link target is the Settings page (`/settings`).

### Task 2 — Phone Lookup real validation
1. In `PhoneLookup.tsx`, delete line 30 entirely (`void localStorage.getItem('watcher-numverify-key')`) — it reads a key that is never written (the real key lives in `watcher-settings.numverifyApiKey`).
2. Add imports: `useSettings` from `../../hooks/useLocalStorage`; `lookupPhoneNumber` from `../../services/api`. Add `const [settings] = useSettings();` in the component.
3. Replace the body of `handleLookup` with:
   ```ts
   const handleLookup = async () => {
     if (!phone.trim()) return;
     setIsLoading(true); setResult(null);
     const key = settings.numverifyApiKey;
     if (!key) {
       // No key: honest format-only validation, no fabricated carrier data.
       const cleaned = phone.replace(/\D/g, '');
       setResult({
         number: formatPhone(phone),
         isValid: cleaned.length >= 10,
         country: undefined, carrier: undefined, lineType: undefined,
         spamLikelihood: 'Add a NumVerify key in Settings for carrier/line data',
       });
       setIsLoading(false); return;
     }
     try {
       const d = await lookupPhoneNumber(formatPhone(phone).replace('+', ''), key);
       if (d.success === false) throw new Error(d.error?.info ?? 'Lookup failed');
       setResult({
         number: d.international_format || formatPhone(phone),
         isValid: d.valid,
         country: d.country_name || undefined,
         carrier: d.carrier || 'Unknown',
         lineType: d.line_type || undefined,
         location: d.location || undefined,
         spamLikelihood: 'Cross-check with TrueCaller',
       });
     } catch (e) {
       setResult({ number: formatPhone(phone), isValid: false,
         spamLikelihood: e instanceof Error ? e.message : 'Lookup failed' });
     } finally { setIsLoading(false); }
   };
   ```
4. Remove the hardcoded "Carrier lookup requires API key" strings — they are now replaced by real data or the honest no-key branch.

### Task 3 — Dashboard honesty
1. In `Dashboard.tsx`, import `useSettings`. Compute `const anyLive = settings.enableLiveAircraft || settings.enableLiveSatellites || settings.enableLiveShips;`
2. Change the green "Live feeds active" pill (around line 65) to render only when `anyLive`; otherwise render a neutral pill: `<span className="badge badge-yellow">Sample data — enable live feeds in Settings</span>`.
3. (Do not attempt to make every stat live — that is Plan 2's monitoring scope. This task is only about not lying in the UI.)

### Task 4 — Agent Recorder zombie sessions
Problem: `AgentRecorder.tsx` `loadSessions()` reloads sessions with `status:'recording'`, but `stopFnsRef.current` is empty after a reload, so the Stop button calls `undefined?.()` and the session can never be stopped or actually captures nothing.
1. In `loadSessions()` (after `setSessions(...)`), downgrade orphaned sessions:
   ```ts
   for (const s of all) {
     if (s.status === 'recording' && !stopFnsRef.current[s.id]) {
       await updateSession({ ...s, status: 'paused' });
     }
   }
   ```
   Then re-read: set state from a fresh `getSessions()` so the UI shows `paused`, or map locally: `setSessions(prev => prev.map(s => s.status==='recording' && !stopFnsRef.current[s.id] ? {...s, status:'paused'} : s))`.
2. `updateSession` and `getSessions` are already imported. `status: 'paused'` is already a valid `RecordingSession['status']`.

---

## Edge cases a weaker model WILL miss (handle all of these)
1. **AISStream delivers one ship per message.** If you `setShips([vessel])` on each `onData`, the map shows exactly one ship forever. You MUST accumulate into a `Map<mmsi, Ship>` and flush periodically. (Task 1 step 3.)
2. **setState storm.** AIS can push hundreds of messages/second. Never `setState` inside `onData`. Flush at 1 Hz via `setInterval`. (Task 1 step 3.)
3. **WebSocket leak / double-connect.** The effect MUST return a cleanup that `clearInterval` + `ws.close()`. Without it, navigating away or a settings change leaves a live socket and stacks new ones.
4. **No API key path.** `connectAISStream` with an empty key opens a socket that errors silently. Guard on `settings.aisStreamApiKey` before connecting (Task 1 step 3) and show the notice card (step 7).
5. **Mixed content on Phone Lookup.** NumVerify's free tier historically only serves `http://apilayer.net`. On an HTTPS deployment the browser blocks HTTP requests (mixed content). `lookupPhoneNumber` uses `https://apilayer.net/...` — if the user's plan doesn't support HTTPS the call fails; the `catch` branch handles it gracefully (shows the error, never crashes). Do not "fix" this by downgrading to http — that will be blocked. Leave HTTPS and rely on the catch.
6. **NumVerify soft errors.** NumVerify returns HTTP 200 with `{ success:false, error:{ info } }` on a bad/exhausted key. Check `d.success === false` explicitly (Task 2 step 3) — a naive `if (!res.ok)` will not catch it.
7. **Wrong settings key.** The real NumVerify key is `settings.numverifyApiKey` (persisted inside the `watcher-settings` object), NOT `localStorage['watcher-numverify-key']`. Use `useSettings()`. (Task 2 steps 1–2.)
8. **Stale filter source.** `shipTypes` derived from `mockShips` will not include live vessel types. Derive from live `ships` (Task 1 step 5).
9. **Do not remove the external-link cards** (MarineTraffic etc.) or the vessel table — only the data source changes.

---

## Acceptance criteria (verifiable)
- [ ] `npx tsc -b` exits 0. `npm run build` exits 0.
- [ ] `grep -rl "connectAISStream" src | grep -v services/api.ts` returns `ShipTracker.tsx` (was empty before).
- [ ] `grep -rl "lookupPhoneNumber" src | grep -v services/api.ts` returns `PhoneLookup.tsx` (was empty before).
- [ ] With `enableLiveShips` OFF: Ship Tracker shows mock ships and a yellow "sample data" badge; Refresh jitters positions (unchanged behaviour).
- [ ] With `enableLiveShips` ON and a valid AISStream key in Settings: within ~30s the vessel list grows beyond the 5 mock ships and shows a green "AISStream live" badge; navigating away and back does not leave a duplicate socket (check DevTools → Network → WS shows exactly one connection).
- [ ] Phone Lookup with NO NumVerify key: shows format validity only, and the "Add a NumVerify key…" note — never a fabricated carrier.
- [ ] Phone Lookup WITH a valid key on `+14155552671`: shows real `carrier`, `line_type`, `location`, `country_name`.
- [ ] Dashboard with all live toggles OFF shows the yellow "Sample data" pill, not the green "Live feeds active" pill.
- [ ] Reload the app while an Agent Recorder session says "recording": after reload it shows "paused" and the Stop/Delete buttons work without a console error.
- [ ] No `setState`-after-unmount warnings in the console when navigating away from Ship Tracker mid-stream.
