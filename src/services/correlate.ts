// ─────────────────────────────────────────────────────────────────────────────
// Correlation "signals" engine — turns collected entity attributes into leads,
// the way SpiderFoot's correlation rules surface "interesting" findings. Pure
// function over an Investigation; runs client-side, no network.
// ─────────────────────────────────────────────────────────────────────────────
import type { Investigation, Entity } from './investigation';

export interface Signal {
  id: string;
  severity: 'info' | 'warning' | 'danger' | 'critical';
  title: string;
  detail: string;
  entityIds: string[];
}

const RISKY_PORTS: Record<string, string> = {
  '21': 'FTP', '23': 'Telnet', '445': 'SMB', '3389': 'RDP',
  '3306': 'MySQL', '5432': 'Postgres', '27017': 'MongoDB', '6379': 'Redis', '9200': 'Elasticsearch',
};

export function evaluateSignals(inv: Investigation): Signal[] {
  const S: Signal[] = [];
  const push = (s: Omit<Signal, 'id'>) => S.push({ id: `sig-${S.length}`, ...s });

  // Per-IP exposure signals
  for (const e of inv.entities) {
    if (e.type !== 'ip') continue;
    const ports = (e.attrs.openPorts ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const risky = ports.filter((p) => RISKY_PORTS[p]);
    const cveCount = Number(e.attrs.cveCount ?? 0);
    const cvssMax = Number(e.attrs.cvssMax ?? 0);

    if (risky.length && cveCount > 0) {
      push({
        severity: cvssMax >= 9 ? 'critical' : 'danger',
        title: `Exposed ${risky.map((p) => RISKY_PORTS[p]).join('/')} + ${cveCount} known CVE(s)`,
        detail: `${e.label} exposes ${risky.join(', ')} and has known vulnerabilities${cvssMax ? ` (max CVSS ${cvssMax})` : ''}.`,
        entityIds: [e.id],
      });
    } else if (risky.length) {
      push({
        severity: 'warning',
        title: `Exposed ${risky.map((p) => RISKY_PORTS[p]).join('/')}`,
        detail: `${e.label} exposes sensitive service port(s): ${risky.join(', ')}.`,
        entityIds: [e.id],
      });
    } else if (cvssMax >= 9) {
      push({
        severity: 'critical',
        title: `Critical CVE on ${e.label}`,
        detail: `Max CVSS ${cvssMax} among ${cveCount} known CVE(s).`,
        entityIds: [e.id],
      });
    }
  }

  // Shared-infrastructure correlation: entities that share an ASN / org / resolved IP.
  const groupBy = (key: string) => {
    const m = new Map<string, Entity[]>();
    for (const e of inv.entities) {
      const v = (e.attrs[key] ?? '').trim().toLowerCase();
      if (!v) continue;
      const arr = m.get(v) ?? [];
      arr.push(e);
      m.set(v, arr);
    }
    return m;
  };
  const seen = new Set<string>();
  for (const [attr, label] of [['asn', 'ASN'], ['org', 'organization'], ['resolvesTo', 'IP']] as const) {
    for (const [val, ents] of groupBy(attr)) {
      if (ents.length < 2) continue;
      const key = `${attr}:${val}`;
      if (seen.has(key)) continue;
      seen.add(key);
      push({
        severity: 'info',
        title: `${ents.length} entities share ${label} ${val}`,
        detail: ents.map((e) => e.label).join(', '),
        entityIds: ents.map((e) => e.id),
      });
    }
  }

  // Order most-severe first for the UI.
  const rank: Record<Signal['severity'], number> = { critical: 0, danger: 1, warning: 2, info: 3 };
  return S.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
