// ─────────────────────────────────────────────────────────────────────────────
// Monitoring & change-detection engine.
//
// Registers "monitors" on a target (domain/IP/username/URL) and, while the app
// is open, re-runs each monitor's keyless lookup on its own interval, diffs the
// normalized result against the previous observation, and raises an event +
// notification when something changes. Events persist in IndexedDB.
// ─────────────────────────────────────────────────────────────────────────────
import { openDB, type IDBPDatabase } from 'idb';
import { dnsLookup, probeSubdomains, hostIntel, waybackSnapshot, githubUser, sha256Hex } from './osint';

export type MonitorCheck = 'dns' | 'ports' | 'subdomains' | 'wayback' | 'github';

export interface Monitor {
  id: string;
  name: string;
  targetType: 'domain' | 'ip' | 'username' | 'url';
  target: string;
  check: MonitorCheck;
  intervalMinutes: number;
  enabled: boolean;
  lastRunAt?: string;
  lastResult?: unknown;
  lastHash?: string;
}

export interface MonitorEvent {
  id: string;
  monitorId: string;
  monitorName: string;
  at: string;
  severity: 'info' | 'warning' | 'danger';
  summary: string;
}

export const CHECK_LABELS: Record<MonitorCheck, string> = {
  dns: 'DNS records',
  ports: 'Open ports / CVEs',
  subdomains: 'Subdomains',
  wayback: 'Archive snapshot',
  github: 'GitHub profile',
};

/** Which checks make sense for a given target type (drives the UI). */
export function checksForTarget(t: Monitor['targetType']): MonitorCheck[] {
  switch (t) {
    case 'domain': return ['dns', 'subdomains', 'wayback'];
    case 'ip': return ['ports'];
    case 'username': return ['github'];
    case 'url': return ['wayback'];
    default: return [];
  }
}

// ─── IndexedDB event store ──────────────────────────────────────────────────────
const DB_NAME = 'watcher-monitor-db';
const STORE = 'events';
let _db: IDBPDatabase | null = null;

async function getDB() {
  if (_db) return _db;
  _db = await openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('monitorId', 'monitorId');
      }
    },
  });
  return _db;
}

export async function addEvent(ev: MonitorEvent): Promise<void> {
  const db = await getDB();
  await db.put(STORE, ev);
}

export async function getEvents(limit = 100): Promise<MonitorEvent[]> {
  const db = await getDB();
  const all = (await db.getAll(STORE)) as MonitorEvent[];
  return all.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export async function clearEvents(): Promise<void> {
  const db = await getDB();
  await db.clear(STORE);
}

// ─── Checks → normalized (order-independent) result ─────────────────────────────
export async function runCheck(m: Monitor): Promise<{ normalized: unknown }> {
  switch (m.check) {
    case 'dns': {
      const r = await dnsLookup(m.target);
      return { normalized: r.records.map((x) => `${x.type} ${x.value}`).sort() };
    }
    case 'ports': {
      const r = await hostIntel(m.target);
      return { normalized: { ports: [...r.ports].sort((a, b) => a - b), vulns: [...r.vulns].sort() } };
    }
    case 'subdomains': {
      const r = await probeSubdomains(m.target);
      return { normalized: r.hits.map((h) => h.subdomain).sort() };
    }
    case 'wayback': {
      const r = await waybackSnapshot(m.target);
      return { normalized: r.timestamp ?? '' };
    }
    case 'github': {
      const r = await githubUser(m.target);
      return { normalized: { followers: r.followers ?? 0, publicRepos: r.publicRepos ?? 0, found: r.found } };
    }
  }
}

// ─── Diff ────────────────────────────────────────────────────────────────────
type Sev = MonitorEvent['severity'];

function diffArrays(prev: string[], next: string[]) {
  const p = new Set(prev), n = new Set(next);
  const added = next.filter((x) => !p.has(x));
  const removed = prev.filter((x) => !n.has(x));
  return { added, removed };
}

export function diffResult(
  check: MonitorCheck,
  prev: unknown,
  next: unknown,
): { changed: boolean; summary: string; severity: Sev } {
  if (prev === undefined || prev === null) return { changed: false, summary: '', severity: 'info' }; // baseline

  if (check === 'dns' || check === 'subdomains') {
    const { added, removed } = diffArrays(prev as string[], next as string[]);
    const changed = added.length > 0 || removed.length > 0;
    const parts: string[] = [];
    if (added.length) parts.push(`${added.length} new (${added.slice(0, 3).join(', ')}${added.length > 3 ? '…' : ''})`);
    if (removed.length) parts.push(`${removed.length} removed`);
    return { changed, summary: parts.join('; '), severity: added.length ? 'warning' : 'info' };
  }

  if (check === 'ports') {
    const p = prev as { ports: number[]; vulns: string[] };
    const n = next as { ports: number[]; vulns: string[] };
    const ports = diffArrays(p.ports.map(String), n.ports.map(String));
    const vulns = diffArrays(p.vulns, n.vulns);
    const changed = ports.added.length || ports.removed.length || vulns.added.length || vulns.removed.length;
    const parts: string[] = [];
    if (ports.added.length) parts.push(`new ports: ${ports.added.join(', ')}`);
    if (ports.removed.length) parts.push(`closed ports: ${ports.removed.join(', ')}`);
    if (vulns.added.length) parts.push(`new CVEs: ${vulns.added.slice(0, 4).join(', ')}`);
    const severity: Sev = vulns.added.length || ports.added.length ? 'danger' : 'info';
    return { changed: !!changed, summary: parts.join('; '), severity };
  }

  if (check === 'wayback') {
    const changed = prev !== next;
    return { changed, summary: `New archive snapshot: ${next as string}`, severity: 'info' };
  }

  if (check === 'github') {
    const p = prev as { followers: number; publicRepos: number };
    const n = next as { followers: number; publicRepos: number };
    const changed = p.followers !== n.followers || p.publicRepos !== n.publicRepos;
    return {
      changed,
      summary: `Followers ${p.followers}→${n.followers}, repos ${p.publicRepos}→${n.publicRepos}`,
      severity: 'info',
    };
  }

  return { changed: false, summary: '', severity: 'info' };
}

// ─── Scheduler singleton ────────────────────────────────────────────────────────
let timer: ReturnType<typeof setInterval> | null = null;

export interface SchedulerHooks {
  getMonitors: () => Monitor[];
  saveMonitor: (m: Monitor) => void;
  onEvent: (ev: MonitorEvent) => void;
  notify: (title: string, body: string, opts?: { type?: 'success' | 'error' | 'warning' }) => void;
}

export function startScheduler(hooks: SchedulerHooks): () => void {
  if (timer) return () => {}; // idempotent — never run two schedulers

  const tick = async () => {
    for (const m of hooks.getMonitors()) {
      if (!m.enabled) continue;
      const dueMs = Math.max(5, m.intervalMinutes) * 60_000;
      if (m.lastRunAt && Date.now() - Date.parse(m.lastRunAt) < dueMs) continue;
      try {
        const { normalized } = await runCheck(m);
        const hash = await sha256Hex(JSON.stringify(normalized));
        if (m.lastHash && hash !== m.lastHash) {
          const d = diffResult(m.check, m.lastResult, normalized);
          if (d.changed) {
            const ev: MonitorEvent = {
              id: `ev-${Date.now()}-${m.id}`,
              monitorId: m.id,
              monitorName: m.name,
              at: new Date().toISOString(),
              severity: d.severity,
              summary: d.summary || 'Change detected',
            };
            await addEvent(ev);
            hooks.onEvent(ev);
            hooks.notify(`Monitor: ${m.name}`, ev.summary, { type: d.severity === 'danger' ? 'error' : 'warning' });
          }
        }
        hooks.saveMonitor({ ...m, lastRunAt: new Date().toISOString(), lastResult: normalized, lastHash: hash });
      } catch {
        // transient source failure — try again next tick, never treat as a change
      }
    }
  };

  timer = setInterval(tick, 60_000); // wake every minute; each monitor self-throttles
  tick();
  return () => { if (timer) clearInterval(timer); timer = null; };
}

/** Run a single monitor immediately (for the "Run now" button); returns the event if one fired. */
export async function runMonitorNow(m: Monitor, hooks: Omit<SchedulerHooks, 'getMonitors'>): Promise<Monitor> {
  const { normalized } = await runCheck(m);
  const hash = await sha256Hex(JSON.stringify(normalized));
  if (m.lastHash && hash !== m.lastHash) {
    const d = diffResult(m.check, m.lastResult, normalized);
    if (d.changed) {
      const ev: MonitorEvent = {
        id: `ev-${Date.now()}-${m.id}`, monitorId: m.id, monitorName: m.name,
        at: new Date().toISOString(), severity: d.severity, summary: d.summary || 'Change detected',
      };
      await addEvent(ev);
      hooks.onEvent(ev);
      hooks.notify(`Monitor: ${m.name}`, ev.summary, { type: d.severity === 'danger' ? 'error' : 'warning' });
    }
  }
  const updated = { ...m, lastRunAt: new Date().toISOString(), lastResult: normalized, lastHash: hash };
  hooks.saveMonitor(updated);
  return updated;
}
