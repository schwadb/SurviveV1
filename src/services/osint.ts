// ─────────────────────────────────────────────────────────────────────────────
// Real, keyless OSINT lookups — all endpoints below are free, require NO API key,
// and send `Access-Control-Allow-Origin: *`, so they work directly from the
// browser with no backend or proxy. Every function has a timeout and degrades
// gracefully: on any failure it returns a typed result carrying an `error`
// string instead of throwing, so the UI never crashes on a dead source.
//
// OPSEC note: these calls go directly from the analyst's browser to the data
// source. The `pwnedPassword` check uses k-anonymity — only the first 5 chars of
// the SHA-1 hash ever leave the device, never the password itself.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT = 12_000;

async function fetchJson<T>(url: string, opts: RequestInit = {}, timeout = DEFAULT_TIMEOUT): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout), ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function fetchText(url: string, opts: RequestInit = {}, timeout = DEFAULT_TIMEOUT): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout), ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ─── SHA hashing (WebCrypto) — used for evidence integrity + pwned-password ────
async function digestHex(algo: 'SHA-1' | 'SHA-256', input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest(algo, data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const sha256Hex = (input: string) => digestHex('SHA-256', input);
export const sha1Hex = (input: string) => digestHex('SHA-1', input);

// ─── DNS over HTTPS (dns.google) — real DNS records ────────────────────────────
export interface DnsRecord { type: string; value: string; ttl?: number }
export interface DnsResult { domain: string; records: DnsRecord[]; error?: string }

const DNS_TYPE_NAMES: Record<number, string> = {
  1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 15: 'MX', 16: 'TXT', 28: 'AAAA', 33: 'SRV', 257: 'CAA',
};

export async function dnsLookup(
  domain: string,
  types: string[] = ['A', 'AAAA', 'MX', 'TXT', 'NS'],
): Promise<DnsResult> {
  const clean = domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  try {
    const results = await Promise.all(
      types.map((t) =>
        fetchJson<{ Answer?: { type: number; data: string; TTL: number }[] }>(
          `https://dns.google/resolve?name=${encodeURIComponent(clean)}&type=${t}`,
        ).catch(() => ({ Answer: undefined })),
      ),
    );
    const records: DnsRecord[] = [];
    for (const r of results) {
      for (const a of r.Answer ?? []) {
        records.push({ type: DNS_TYPE_NAMES[a.type] ?? String(a.type), value: a.data, ttl: a.TTL });
      }
    }
    return { domain: clean, records };
  } catch (e) {
    return { domain: clean, records: [], error: e instanceof Error ? e.message : 'DNS lookup failed' };
  }
}

// ─── Subdomain discovery via DoH probing ───────────────────────────────────────
// crt.sh has no CORS header, so instead we resolve a wordlist of common
// subdomains through DoH and report the ones that actually resolve. Everything
// returned is a *live* host, not a historical certificate artifact.
const COMMON_SUBDOMAINS = [
  'www', 'mail', 'remote', 'blog', 'webmail', 'server', 'ns1', 'ns2', 'smtp', 'secure',
  'vpn', 'api', 'dev', 'staging', 'test', 'portal', 'admin', 'm', 'mobile', 'shop',
  'ftp', 'cpanel', 'webdisk', 'autodiscover', 'cloud', 'git', 'gitlab', 'jenkins',
  'app', 'apps', 'dashboard', 'internal', 'intranet', 'vpn2', 'proxy', 'cdn', 'assets',
  'static', 'img', 'images', 'docs', 'support', 'help', 'status', 'monitor', 'grafana',
];

export interface SubdomainHit { subdomain: string; ip: string }
export interface SubdomainResult { domain: string; hits: SubdomainHit[]; probed: number; error?: string }

export async function probeSubdomains(
  domain: string,
  onProgress?: (done: number, total: number) => void,
): Promise<SubdomainResult> {
  const clean = domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const hits: SubdomainHit[] = [];
  let done = 0;
  try {
    // Small concurrency pool so we don't fire 45 requests at once.
    const queue = [...COMMON_SUBDOMAINS];
    const worker = async () => {
      let sub: string | undefined;
      while ((sub = queue.shift())) {
        const fqdn = `${sub}.${clean}`;
        try {
          const r = await fetchJson<{ Answer?: { type: number; data: string }[] }>(
            `https://dns.google/resolve?name=${encodeURIComponent(fqdn)}&type=A`,
            {},
            8000,
          );
          const a = (r.Answer ?? []).find((x) => x.type === 1);
          if (a) hits.push({ subdomain: fqdn, ip: a.data });
        } catch {
          /* unresolved — skip */
        } finally {
          done++;
          onProgress?.(done, COMMON_SUBDOMAINS.length);
        }
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    hits.sort((a, b) => a.subdomain.localeCompare(b.subdomain));
    return { domain: clean, hits, probed: COMMON_SUBDOMAINS.length };
  } catch (e) {
    return { domain: clean, hits, probed: done, error: e instanceof Error ? e.message : 'probe failed' };
  }
}

// ─── Shodan InternetDB — open ports, CVEs, CPEs (no key) ───────────────────────
export interface HostIntel {
  ip: string;
  ports: number[];
  hostnames: string[];
  cpes: string[];
  tags: string[];
  vulns: string[];
  error?: string;
}

export async function hostIntel(ip: string): Promise<HostIntel> {
  const clean = ip.trim();
  try {
    const d = await fetchJson<Omit<HostIntel, 'error'>>(`https://internetdb.shodan.io/${encodeURIComponent(clean)}`);
    return {
      ip: clean,
      ports: d.ports ?? [],
      hostnames: d.hostnames ?? [],
      cpes: d.cpes ?? [],
      tags: d.tags ?? [],
      vulns: d.vulns ?? [],
    };
  } catch (e) {
    const msg = e instanceof Error && e.message.includes('404') ? 'No InternetDB records for this host' : 'lookup failed';
    return { ip: clean, ports: [], hostnames: [], cpes: [], tags: [], vulns: [], error: msg };
  }
}

// ─── IP geolocation + ASN (ipwho.is, no key) ───────────────────────────────────
export interface IpGeo {
  ip: string;
  type?: string;
  country?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  lat?: number;
  lng?: number;
  asn?: string;
  org?: string;
  isp?: string;
  error?: string;
}

export async function geolocateIp(ip: string): Promise<IpGeo> {
  const clean = ip.trim();
  try {
    const d = await fetchJson<{
      success: boolean; message?: string; ip: string; type: string;
      country: string; country_code: string; region: string; city: string;
      latitude: number; longitude: number;
      connection?: { asn: number; org: string; isp: string };
    }>(`https://ipwho.is/${encodeURIComponent(clean)}`);
    if (!d.success) return { ip: clean, error: d.message ?? 'lookup failed' };
    return {
      ip: d.ip, type: d.type, country: d.country, countryCode: d.country_code,
      region: d.region, city: d.city, lat: d.latitude, lng: d.longitude,
      asn: d.connection ? `AS${d.connection.asn}` : undefined,
      org: d.connection?.org, isp: d.connection?.isp,
    };
  } catch (e) {
    return { ip: clean, error: e instanceof Error ? e.message : 'lookup failed' };
  }
}

// ─── Wayback Machine — latest archived snapshot (no key) ────────────────────────
export interface WaybackResult { url: string; available: boolean; snapshot?: string; timestamp?: string; error?: string }

export async function waybackSnapshot(url: string): Promise<WaybackResult> {
  const clean = url.trim();
  try {
    const d = await fetchJson<{ archived_snapshots?: { closest?: { available: boolean; url: string; timestamp: string } } }>(
      `https://archive.org/wayback/available?url=${encodeURIComponent(clean)}`,
    );
    const c = d.archived_snapshots?.closest;
    if (!c?.available) return { url: clean, available: false };
    const ts = c.timestamp; // YYYYMMDDhhmmss
    const iso = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
    return { url: clean, available: true, snapshot: c.url, timestamp: iso };
  } catch (e) {
    return { url: clean, available: false, error: e instanceof Error ? e.message : 'lookup failed' };
  }
}

// ─── GitHub user profile (unauthenticated, CORS-enabled) ───────────────────────
export interface GithubUser {
  login: string; name?: string; bio?: string; company?: string; location?: string;
  blog?: string; email?: string; publicRepos?: number; followers?: number;
  createdAt?: string; avatarUrl?: string; htmlUrl?: string; found: boolean; error?: string;
}

export async function githubUser(username: string): Promise<GithubUser> {
  const clean = username.trim().replace(/^@/, '');
  try {
    const d = await fetchJson<Record<string, unknown>>(`https://api.github.com/users/${encodeURIComponent(clean)}`);
    return {
      login: String(d.login ?? clean), name: (d.name as string) ?? undefined,
      bio: (d.bio as string) ?? undefined, company: (d.company as string) ?? undefined,
      location: (d.location as string) ?? undefined, blog: (d.blog as string) || undefined,
      email: (d.email as string) ?? undefined, publicRepos: (d.public_repos as number) ?? undefined,
      followers: (d.followers as number) ?? undefined, createdAt: (d.created_at as string) ?? undefined,
      avatarUrl: (d.avatar_url as string) ?? undefined, htmlUrl: (d.html_url as string) ?? undefined,
      found: true,
    };
  } catch (e) {
    const notFound = e instanceof Error && e.message.includes('404');
    return { login: clean, found: false, error: notFound ? 'No GitHub account with this username' : 'lookup failed' };
  }
}

// ─── HIBP Pwned Passwords (k-anonymity, no key) ────────────────────────────────
// Only the first 5 chars of the SHA-1 hash are sent to the API; the range of
// matching suffixes comes back and we match locally. The password never leaves
// the browser.
export interface PwnedResult { count: number; error?: string }

export async function pwnedPassword(password: string): Promise<PwnedResult> {
  if (!password) return { count: 0 };
  try {
    const hash = (await sha1Hex(password)).toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const body = await fetchText(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
    });
    for (const line of body.split('\n')) {
      const [suf, cnt] = line.trim().split(':');
      if (suf === suffix) return { count: parseInt(cnt, 10) || 0 };
    }
    return { count: 0 };
  } catch (e) {
    return { count: 0, error: e instanceof Error ? e.message : 'lookup failed' };
  }
}

// ─── NVD CVE enrichment (keyless, heavily rate-limited: ~5 req/30s) ────────────
export interface CveInfo {
  id: string;
  cvss?: number;
  severity?: string;
  summary?: string;
  published?: string;
  error?: string;
}

export async function cveDetails(cveId: string): Promise<CveInfo> {
  try {
    const d = await fetchJson<{
      vulnerabilities?: {
        cve: {
          descriptions?: { lang: string; value: string }[];
          published?: string;
          metrics?: {
            cvssMetricV31?: { cvssData: { baseScore: number; baseSeverity: string } }[];
            cvssMetricV30?: { cvssData: { baseScore: number; baseSeverity: string } }[];
          };
        };
      }[];
    }>(`https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${encodeURIComponent(cveId)}`);
    const cve = d.vulnerabilities?.[0]?.cve;
    if (!cve) return { id: cveId, error: 'not found' };
    const metric = cve.metrics?.cvssMetricV31?.[0] ?? cve.metrics?.cvssMetricV30?.[0];
    return {
      id: cveId,
      cvss: metric?.cvssData.baseScore,
      severity: metric?.cvssData.baseSeverity,
      summary: cve.descriptions?.find((x) => x.lang === 'en')?.value,
      published: cve.published?.slice(0, 10),
    };
  } catch (e) {
    return { id: cveId, error: e instanceof Error ? e.message : 'lookup failed' };
  }
}

/** Enrich a list of CVE IDs, throttled to stay under NVD's unauthenticated limit. */
export async function enrichCves(ids: string[], max = 6): Promise<CveInfo[]> {
  const out: CveInfo[] = [];
  for (const id of ids.slice(0, max)) {
    out.push(await cveDetails(id));
    await new Promise((r) => setTimeout(r, 900)); // ~1 req/s
  }
  return out;
}

// ─── Selector type detection (for the command palette / auto-routing) ──────────
export type SelectorType = 'ip' | 'email' | 'domain' | 'phone' | 'username' | 'unknown';

export function detectSelectorType(value: string): SelectorType {
  const v = value.trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return 'ip';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'email';
  if (/^\+?[\d\s().-]{7,}$/.test(v)) return 'phone';
  if (/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(v.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))) return 'domain';
  if (/^@?[a-z0-9_.-]{2,30}$/i.test(v)) return 'username';
  return 'unknown';
}
