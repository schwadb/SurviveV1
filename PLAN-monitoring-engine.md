# PLAN: Monitoring & change-detection engine

**Leverage rank: 2 of 5.**
**Why #2:** This is the single biggest *new capability* — it turns WatcherV1 from a one-shot lookup tool into a monitoring platform (the core of SpiderFoot HX / Recorded Future). It reuses everything already built: the keyless lookups in `src/services/osint.ts`, the notification hook, and the IndexedDB pattern from the agent recorder. Do this after Plan 1.
**Effort:** M (2–3 days).

---

## Goal
Let the user register **monitors** on a target (domain / IP / username / URL). While the app is open, each monitor re-runs its lookup on an interval, **diffs** the new result against the previous one, and raises an alert (in-app toast + browser notification + a persistent event log) when something changes: a new open port, a new subdomain, a new CVE, an IP's ASN changes, a new Wayback snapshot, a GitHub follower/repo delta, etc.

---

## Exact files to create/touch
- **CREATE** `src/services/monitor.ts` — the model, the diff logic, the scheduler singleton, IndexedDB event store.
- **CREATE** `src/hooks/useMonitors.ts` — React state over the monitors (localStorage) + live event list.
- **CREATE** `src/pages/Monitors.tsx` — the UI (list of monitors, add form, event feed).
- **TOUCH** `src/App.tsx` — add route `/monitors` + `ROUTE_META['/monitors']`, and start the scheduler once at app mount.
- **TOUCH** `src/components/layout/Sidebar.tsx` — add a nav item `{ id: 'monitors', label: 'Monitors', icon: Radar, color: 'text-emerald-400' }` under the `TOOLS` group (import `Radar` from `lucide-react`).
- Read-only reference: `src/services/osint.ts` (functions + `sha256Hex`), `src/hooks/useNotifications.ts` (`notify`), `src/services/agentRecorder.ts` (copy the `idb` open pattern), `src/hooks/useLocalStorage.ts`.

---

## Data model (put in `monitor.ts`)
```ts
export type MonitorCheck = 'dns' | 'ports' | 'subdomains' | 'wayback' | 'github';
export interface Monitor {
  id: string;
  name: string;
  targetType: 'domain' | 'ip' | 'username' | 'url';
  target: string;
  check: MonitorCheck;
  intervalMinutes: number;   // min 5
  enabled: boolean;
  lastRunAt?: string;
  lastResult?: unknown;      // normalized result from the check (for diffing)
  lastHash?: string;         // sha256 of normalized result
}
export interface MonitorEvent {
  id: string; monitorId: string; monitorName: string;
  at: string; severity: 'info' | 'warning' | 'danger';
  summary: string;           // human sentence, e.g. "2 new open ports: 3389, 445"
}
```
Persist `Monitor[]` in `localStorage` key `watcher-monitors` (via `useLocalStorage`). Persist `MonitorEvent[]` in IndexedDB (new DB `watcher-monitor-db`, store `events`, keyPath `id`, index on `monitorId`) — copy the `openDB`/`getDB` pattern from `agentRecorder.ts` exactly.

---

## Check → normalized result mapping (in `monitor.ts`)
Write `async function runCheck(m: Monitor): Promise<{ normalized: unknown; }>` that calls the matching `osint.ts` function and returns a **stable, order-independent** shape so hashing is deterministic:
| check | osint call | normalized shape |
|---|---|---|
| `dns` | `dnsLookup(target)` | `records` mapped to `` `${type} ${value}` `` strings, **sorted** |
| `ports` | `hostIntel(target)` | `{ ports: [...].sort((a,b)=>a-b), vulns: [...].sort() }` |
| `subdomains` | `probeSubdomains(target)` | `hits.map(h=>h.subdomain).sort()` |
| `wayback` | `waybackSnapshot(target)` | `timestamp ?? ''` |
| `github` | `githubUser(target)` | `{ followers, publicRepos }` |
Hash with `sha256Hex(JSON.stringify(normalized))` (import `sha256Hex` from `osint.ts`).

## Diff logic (in `monitor.ts`)
Write `diffResult(check, prev, next): { changed: boolean; summary: string; severity }`:
- For array checks (dns, ports, subdomains): compute `added = next \ prev` and `removed = prev \ next`. `changed = added.length || removed.length`. Summary like `"3 new subdomains (api.x, dev.x, …); 1 removed"`. Severity `danger` if a new port/CVE appears, else `warning`.
- For `wayback`: changed if timestamp differs → `"New archive snapshot: <ts>"` (info).
- For `github`: changed if followers/repos differ → `"Followers 120→131, repos 40→41"` (info).
- First run (`prev === undefined`): `changed:false` (establish baseline silently; do NOT alert on the first observation).

## Scheduler singleton (in `monitor.ts`)
```ts
let timer: ReturnType<typeof setInterval> | null = null;
export function startScheduler(getMonitors, saveMonitor, addEvent, notify) {
  if (timer) return () => {};                 // idempotent — never start twice
  const tick = async () => {
    for (const m of getMonitors()) {
      if (!m.enabled) continue;
      const dueMs = (m.intervalMinutes) * 60_000;
      if (m.lastRunAt && Date.now() - Date.parse(m.lastRunAt) < dueMs) continue;
      try {
        const { normalized } = await runCheck(m);
        const hash = await sha256Hex(JSON.stringify(normalized));
        if (m.lastHash && hash !== m.lastHash) {
          const d = diffResult(m.check, m.lastResult, normalized);
          if (d.changed) {
            await addEvent({ id: `ev-${Date.now()}-${m.id}`, monitorId: m.id, monitorName: m.name,
              at: new Date().toISOString(), severity: d.severity, summary: d.summary });
            notify(`Monitor: ${m.name}`, d.summary, { type: d.severity === 'danger' ? 'error' : 'warning' });
          }
        }
        saveMonitor({ ...m, lastRunAt: new Date().toISOString(), lastResult: normalized, lastHash: hash });
      } catch { /* transient source failure — try again next tick */ }
    }
  };
  timer = setInterval(tick, 60_000);          // wake every minute; each monitor self-throttles by intervalMinutes
  tick();                                      // run once at startup
  return () => { if (timer) clearInterval(timer); timer = null; };
}
```

## `useMonitors.ts`
`useLocalStorage<Monitor[]>('watcher-monitors', [])` + CRUD (add/remove/toggle/update-in-place like `useInvestigations`). Also load recent `MonitorEvent[]` from IndexedDB into state and expose `events`, `clearEvents()`.

## `Monitors.tsx`
Reuse design classes. Sections: (1) "Add monitor" form (name, target input with `detectSelectorType` auto-fill of targetType, a `check` select whose options are filtered to what suits the target type, an interval select `[5,15,30,60,240]` minutes); (2) monitor cards showing target, check, interval, enabled toggle, `lastRunAt`, and a manual "Run now" button; (3) an "Event Feed" listing `MonitorEvent`s newest-first with severity badges.

## App wiring
In `App.tsx`, add the route + meta, and start the scheduler once inside a top-level `useEffect(() => { const stop = startScheduler(...); return stop; }, [])`. Pass in getters bound to the monitors hook. **The scheduler must be started exactly once** — guard with the `if (timer) return` inside `startScheduler` (already shown).

---

## Edge cases a weaker model WILL miss
1. **Do not alert on the first run.** The baseline observation has no `prev` — establish `lastHash`/`lastResult` silently. Alerting on first sight produces a false "change" for every monitor. (`diffResult` returns `changed:false` when `prev===undefined`.)
2. **Order-dependent hashing.** DNS records / ports / subdomains come back in arbitrary order. If you hash the raw array, order shuffles produce phantom "changes." You MUST sort inside the normalized shape before hashing.
3. **Two clocks.** The scheduler ticks every 60s, but each monitor fires only when `intervalMinutes` has elapsed since its own `lastRunAt`. Do not run every monitor every tick — you'll hammer the APIs and hit rate limits.
4. **Scheduler double-start.** React StrictMode double-invokes effects in dev; and re-renders must not spawn a second interval. The `if (timer) return` guard makes `startScheduler` idempotent — keep it.
5. **Persisting `lastResult` bloats localStorage.** Keep `lastResult` normalized and small (strings/numbers only, per the table). Never store the full raw API response there.
6. **Transient failures ≠ changes.** If a source errors (rate limit, network), skip that monitor this tick and try next time. Never treat a fetch failure as "the data changed" — that would spam danger alerts.
7. **Minimum interval.** Enforce `intervalMinutes >= 5` in the add form and in `runCheck` gating, or the free APIs (NVD-adjacent, GitHub 60/hr unauth) will rate-limit and monitors will flap.
8. **Notifications may be denied.** `notify()` already falls back to a toast when browser permission isn't granted — do not gate event logging on notification permission.
9. **Reuse `detectSelectorType`** from `osint.ts` to auto-pick `targetType`; don't write a new detector.

---

## Acceptance criteria (verifiable)
- [ ] `npx tsc -b` and `npm run build` exit 0.
- [ ] New files exist: `src/services/monitor.ts`, `src/hooks/useMonitors.ts`, `src/pages/Monitors.tsx`. `/monitors` route resolves and a "Monitors" item appears in the sidebar TOOLS group.
- [ ] Add a `subdomains` monitor on a domain → within one tick it runs, shows a `lastRunAt`, and creates NO event on first run (baseline).
- [ ] Simulate a change (temporarily hard-code the normalized result to differ, or point at a fast-changing target) → an event appears in the feed and a toast fires, with a human summary naming what changed.
- [ ] Toggling a monitor off stops it from running (verify `lastRunAt` stops advancing).
- [ ] Only one `setInterval` is ever active: add a `console.count('tick')` in `tick` temporarily — it increments once per minute, not per render.
- [ ] Reloading the app does not duplicate the scheduler or replay old events as new alerts.
- [ ] Events persist across reload (IndexedDB), and "Clear events" empties both the store and the UI.
