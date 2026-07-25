// ─────────────────────────────────────────────────────────────────────────────
// Investigation data model + case store + pivot analyzers.
//
// This is the core of the link-analysis workspace: a normalized Entity model
// (the Maltego/SpiderFoot idea) that lets any selector — domain, IP, email,
// username, person — become a node, and lets one click "pivot" a node into its
// connected entities using the real keyless sources in services/osint.ts.
//
// Everything is stored locally (localStorage) and every discovered fact is
// written to a SHA-256-hashed evidence log so a case is defensible and
// reproducible. No data leaves the browser except the direct OSINT lookups the
// analyst explicitly triggers.
// ─────────────────────────────────────────────────────────────────────────────
import {
  dnsLookup, probeSubdomains, hostIntel, geolocateIp, waybackSnapshot,
  githubUser, sha256Hex, detectSelectorType, enrichCves,
} from './osint';

export type EntityType =
  | 'person' | 'email' | 'domain' | 'ip' | 'phone' | 'username'
  | 'org' | 'location' | 'url' | 'aircraft' | 'ship' | 'satellite' | 'note';

export interface Entity {
  id: string;
  type: EntityType;
  label: string;
  attrs: Record<string, string>;
  notes: string;
  x?: number;
  y?: number;
  sources: string[];
  createdAt: string;
}

export interface Edge {
  id: string;
  from: string;
  to: string;
  label: string;
}

export interface EvidenceItem {
  id: string;
  entityId?: string;
  source: string;
  summary: string;
  hash: string;      // SHA-256 of the raw captured data
  capturedAt: string;
}

export interface Investigation {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  entities: Entity[];
  edges: Edge[];
  evidence: EvidenceItem[];
}

export const ENTITY_META: Record<EntityType, { icon: string; color: string; label: string }> = {
  person:    { icon: '👤', color: '#f43f5e', label: 'Person' },
  email:     { icon: '✉️', color: '#3b82f6', label: 'Email' },
  domain:    { icon: '🌐', color: '#14b8a6', label: 'Domain' },
  ip:        { icon: '🖥️', color: '#f97316', label: 'IP Address' },
  phone:     { icon: '📞', color: '#eab308', label: 'Phone' },
  username:  { icon: '🔖', color: '#a855f7', label: 'Username' },
  org:       { icon: '🏢', color: '#64748b', label: 'Organization' },
  location:  { icon: '📍', color: '#22c55e', label: 'Location' },
  url:       { icon: '🔗', color: '#818cf8', label: 'URL' },
  aircraft:  { icon: '✈️', color: '#60a5fa', label: 'Aircraft' },
  ship:      { icon: '🚢', color: '#06b6d4', label: 'Ship' },
  satellite: { icon: '🛰️', color: '#6366f1', label: 'Satellite' },
  note:      { icon: '📝', color: '#9ca3af', label: 'Note' },
};

// Non-crypto id — fine for local case objects. Uses time + counter for uniqueness.
let idCounter = 0;
function makeId(prefix: string): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function createInvestigation(name: string): Investigation {
  const now = new Date().toISOString();
  return { id: makeId('case'), name, createdAt: now, updatedAt: now, entities: [], edges: [], evidence: [] };
}

const normalize = (type: EntityType, label: string) => `${type}:${label.trim().toLowerCase()}`;

export function createEntity(type: EntityType, label: string, attrs: Record<string, string> = {}, source = 'manual'): Entity {
  return {
    id: makeId('ent'), type, label: label.trim(), attrs, notes: '',
    sources: [source], createdAt: new Date().toISOString(),
  };
}

/** Detect the selector type of a raw value and add it as an entity. */
export function detectAndCreate(inv: Investigation, value: string, source = 'manual'): string {
  const v = value.trim();
  const detected = detectSelectorType(v);
  const type: EntityType = detected === 'unknown' ? 'note' : (detected as EntityType);
  return upsertEntity(inv, type, v, {}, source);
}

/** Add an entity, de-duplicating on type+label. Returns the entity id (existing or new). */
export function upsertEntity(
  inv: Investigation,
  type: EntityType,
  label: string,
  attrs: Record<string, string> = {},
  source = 'manual',
): string {
  const key = normalize(type, label);
  const existing = inv.entities.find((e) => normalize(e.type, e.label) === key);
  if (existing) {
    existing.attrs = { ...existing.attrs, ...attrs };
    if (!existing.sources.includes(source)) existing.sources.push(source);
    return existing.id;
  }
  const ent = createEntity(type, label, attrs, source);
  inv.entities.push(ent);
  return ent.id;
}

export function upsertEdge(inv: Investigation, from: string, to: string, label: string): void {
  if (from === to) return;
  const exists = inv.edges.some((e) => e.from === from && e.to === to && e.label === label);
  if (!exists) inv.edges.push({ id: makeId('edge'), from, to, label });
}

export async function addEvidence(inv: Investigation, entityId: string | undefined, source: string, summary: string, raw: string): Promise<void> {
  const hash = await sha256Hex(raw);
  inv.evidence.push({ id: makeId('ev'), entityId, source, summary, hash, capturedAt: new Date().toISOString() });
}

// ─── Pivot analyzers ───────────────────────────────────────────────────────────
export interface PivotNode { type: EntityType; label: string; edgeLabel: string; attrs?: Record<string, string> }
export interface PivotOutput {
  attrs: Record<string, string>;              // merged into the source entity
  nodes: PivotNode[];                          // connected entities to add
  evidence: { source: string; summary: string; raw: string }[];
  note: string;
}

const EMPTY = (note: string): PivotOutput => ({ attrs: {}, nodes: [], evidence: [], note });

/** Which pivots are available for an entity type (drives the UI). */
export function availablePivots(type: EntityType): string[] {
  switch (type) {
    case 'domain': return ['DNS records', 'Subdomains', 'Wayback'];
    case 'ip': return ['Host intel (ports/CVEs)', 'Geolocate'];
    case 'username': return ['GitHub profile'];
    case 'email': return ['Extract domain'];
    default: return [];
  }
}

export async function runPivot(entity: Entity, pivot: string): Promise<PivotOutput> {
  const v = entity.label.trim();
  try {
    if (entity.type === 'domain' && pivot.startsWith('DNS')) {
      const r = await dnsLookup(v);
      if (r.error) return EMPTY(`DNS lookup failed: ${r.error}`);
      const nodes: PivotNode[] = [];
      for (const rec of r.records) {
        if (rec.type === 'A' || rec.type === 'AAAA') nodes.push({ type: 'ip', label: rec.value, edgeLabel: `${rec.type} record` });
        else if (rec.type === 'NS') nodes.push({ type: 'domain', label: rec.value.replace(/\.$/, ''), edgeLabel: 'nameserver' });
        else if (rec.type === 'MX') nodes.push({ type: 'domain', label: rec.value.split(/\s+/).pop()!.replace(/\.$/, ''), edgeLabel: 'mail server' });
      }
      const txt = r.records.filter((x) => x.type === 'TXT').length;
      return {
        attrs: { dnsRecords: String(r.records.length), txtRecords: String(txt) },
        nodes,
        evidence: [{ source: 'dns.google', summary: `${r.records.length} DNS records for ${v}`, raw: JSON.stringify(r.records) }],
        note: `Resolved ${r.records.length} DNS records (${nodes.length} linked hosts).`,
      };
    }

    if (entity.type === 'domain' && pivot.startsWith('Subdomains')) {
      const r = await probeSubdomains(v);
      const nodes: PivotNode[] = r.hits.slice(0, 20).map((h) => ({
        type: 'domain' as EntityType, label: h.subdomain, edgeLabel: 'subdomain', attrs: { resolvesTo: h.ip },
      }));
      return {
        attrs: { subdomainsFound: String(r.hits.length) },
        nodes,
        evidence: [{ source: 'DoH subdomain probe', summary: `${r.hits.length}/${r.probed} common subdomains resolve for ${v}`, raw: JSON.stringify(r.hits) }],
        note: r.hits.length ? `Found ${r.hits.length} live subdomains.` : 'No common subdomains resolved.',
      };
    }

    if (entity.type === 'domain' && pivot.startsWith('Wayback')) {
      const r = await waybackSnapshot(v);
      if (!r.available) return EMPTY(r.error ? `Wayback error: ${r.error}` : 'No archived snapshot found.');
      return {
        attrs: { waybackSnapshot: r.timestamp ?? 'yes' },
        nodes: r.snapshot ? [{ type: 'url', label: r.snapshot, edgeLabel: `archived ${r.timestamp}` }] : [],
        evidence: [{ source: 'archive.org', summary: `Wayback snapshot ${r.timestamp} for ${v}`, raw: r.snapshot ?? '' }],
        note: `Latest archived snapshot: ${r.timestamp}.`,
      };
    }

    if (entity.type === 'ip' && pivot.startsWith('Host')) {
      const r = await hostIntel(v);
      if (r.error) return EMPTY(r.error);
      const nodes: PivotNode[] = r.hostnames.slice(0, 8).map((h) => ({ type: 'domain' as EntityType, label: h, edgeLabel: 'reverse DNS' }));
      // Enrich the top CVEs with CVSS from NVD (throttled; degrades gracefully).
      const cveInfo = r.vulns.length ? await enrichCves(r.vulns) : [];
      const cvssMax = cveInfo.reduce((m, c) => Math.max(m, c.cvss ?? 0), 0);
      const worst = cveInfo.filter((c) => c.cvss != null).sort((a, b) => (b.cvss ?? 0) - (a.cvss ?? 0))[0];
      return {
        attrs: {
          openPorts: r.ports.join(', ') || 'none',
          cveCount: String(r.vulns.length),
          cves: r.vulns.slice(0, 10).join(', '),
          cvssMax: cvssMax ? String(cvssMax) : '',
          tags: r.tags.join(', '),
        },
        nodes,
        evidence: [
          { source: 'Shodan InternetDB', summary: `${r.ports.length} ports, ${r.vulns.length} CVEs on ${v}`, raw: JSON.stringify(r) },
          ...(worst ? [{ source: 'NVD', summary: `Worst CVE ${worst.id}: CVSS ${worst.cvss} ${worst.severity ?? ''}`, raw: JSON.stringify(cveInfo) }] : []),
        ],
        note: `${r.ports.length} open ports, ${r.vulns.length} known CVEs${cvssMax ? ` (max CVSS ${cvssMax})` : ''}.`,
      };
    }

    if (entity.type === 'ip' && pivot.startsWith('Geolocate')) {
      const r = await geolocateIp(v);
      if (r.error) return EMPTY(r.error);
      const nodes: PivotNode[] = [];
      if (r.city || r.country) nodes.push({ type: 'location', label: [r.city, r.region, r.country].filter(Boolean).join(', '), edgeLabel: 'geolocated', attrs: r.lat != null ? { lat: String(r.lat), lng: String(r.lng) } : {} });
      if (r.org) nodes.push({ type: 'org', label: r.org, edgeLabel: r.asn ?? 'network' });
      return {
        attrs: { country: r.country ?? '', city: r.city ?? '', asn: r.asn ?? '', org: r.org ?? '', isp: r.isp ?? '' },
        nodes,
        evidence: [{ source: 'ipwho.is', summary: `Geolocation for ${v}: ${r.city}, ${r.country} (${r.asn})`, raw: JSON.stringify(r) }],
        note: `Located in ${[r.city, r.country].filter(Boolean).join(', ')} — ${r.org ?? r.asn ?? 'unknown network'}.`,
      };
    }

    if (entity.type === 'username' && pivot.startsWith('GitHub')) {
      const r = await githubUser(v);
      if (!r.found) return EMPTY(r.error ?? 'No GitHub account found.');
      const nodes: PivotNode[] = [];
      if (r.location) nodes.push({ type: 'location', label: r.location, edgeLabel: 'GitHub location' });
      if (r.company) nodes.push({ type: 'org', label: r.company.replace(/^@/, ''), edgeLabel: 'GitHub company' });
      if (r.blog) nodes.push({ type: 'url', label: r.blog, edgeLabel: 'GitHub blog' });
      if (r.email) nodes.push({ type: 'email', label: r.email, edgeLabel: 'GitHub email' });
      return {
        attrs: {
          githubName: r.name ?? '', githubBio: r.bio ?? '', publicRepos: String(r.publicRepos ?? ''),
          followers: String(r.followers ?? ''), githubSince: r.createdAt?.slice(0, 10) ?? '', profile: r.htmlUrl ?? '',
        },
        nodes,
        evidence: [{ source: 'api.github.com', summary: `GitHub profile for ${v} (${r.followers} followers, ${r.publicRepos} repos)`, raw: JSON.stringify(r) }],
        note: `GitHub account found${r.name ? `: ${r.name}` : ''} — ${r.followers} followers, ${r.publicRepos} repos.`,
      };
    }

    if (entity.type === 'email' && pivot.startsWith('Extract')) {
      const domain = v.split('@')[1];
      if (!domain) return EMPTY('Not a valid email address.');
      return {
        attrs: { localPart: v.split('@')[0], domain },
        nodes: [{ type: 'domain', label: domain, edgeLabel: 'email domain' }],
        evidence: [],
        note: `Extracted domain ${domain}.`,
      };
    }

    return EMPTY('No analyzer available for this pivot.');
  } catch (e) {
    return EMPTY(e instanceof Error ? e.message : 'Pivot failed');
  }
}

/** Apply a pivot output to the investigation, wiring new nodes + edges + evidence. */
export async function applyPivot(inv: Investigation, sourceId: string, out: PivotOutput): Promise<void> {
  const src = inv.entities.find((e) => e.id === sourceId);
  if (!src) return;
  src.attrs = { ...src.attrs, ...out.attrs };
  for (const n of out.nodes) {
    const targetId = upsertEntity(inv, n.type, n.label, n.attrs ?? {}, 'pivot');
    upsertEdge(inv, sourceId, targetId, n.edgeLabel);
  }
  for (const ev of out.evidence) {
    await addEvidence(inv, sourceId, ev.source, ev.summary, ev.raw);
  }
  inv.updatedAt = new Date().toISOString();
}

// ─── Markdown report generation ────────────────────────────────────────────────
export function generateReport(inv: Investigation): string {
  const lines: string[] = [];
  lines.push(`# Investigation Report: ${inv.name}`, '');
  lines.push(`- **Case ID:** ${inv.id}`);
  lines.push(`- **Created:** ${new Date(inv.createdAt).toLocaleString()}`);
  lines.push(`- **Last updated:** ${new Date(inv.updatedAt).toLocaleString()}`);
  lines.push(`- **Entities:** ${inv.entities.length} · **Links:** ${inv.edges.length} · **Evidence items:** ${inv.evidence.length}`, '');

  lines.push('## Entities', '');
  const byType = new Map<EntityType, Entity[]>();
  for (const e of inv.entities) { const a = byType.get(e.type) ?? []; a.push(e); byType.set(e.type, a); }
  for (const [type, ents] of byType) {
    lines.push(`### ${ENTITY_META[type].icon} ${ENTITY_META[type].label} (${ents.length})`, '');
    for (const e of ents) {
      lines.push(`- **${e.label}**`);
      const attrs = Object.entries(e.attrs).filter(([, val]) => val);
      for (const [k, val] of attrs) lines.push(`  - ${k}: ${val}`);
      if (e.notes) lines.push(`  - _note:_ ${e.notes}`);
    }
    lines.push('');
  }

  if (inv.edges.length) {
    lines.push('## Relationships', '');
    const byId = new Map(inv.entities.map((e) => [e.id, e]));
    for (const edge of inv.edges) {
      const a = byId.get(edge.from), b = byId.get(edge.to);
      if (a && b) lines.push(`- ${a.label} —[${edge.label}]→ ${b.label}`);
    }
    lines.push('');
  }

  lines.push('## Evidence Log (SHA-256 hashed)', '');
  if (!inv.evidence.length) lines.push('_No evidence captured yet._', '');
  for (const ev of inv.evidence) {
    lines.push(`- \`${new Date(ev.capturedAt).toISOString()}\` **${ev.source}** — ${ev.summary}`);
    lines.push(`  - sha256: \`${ev.hash}\``);
  }
  lines.push('', '---', `_Generated by WatcherV1 OSINT Platform · ${new Date().toISOString()}_`);
  return lines.join('\n');
}
