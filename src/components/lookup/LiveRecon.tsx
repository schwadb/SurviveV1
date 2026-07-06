import React, { useEffect, useState } from 'react';
import { Loader2, Server, Globe, ShieldAlert, MapPin, Clock, Network } from 'lucide-react';
import {
  dnsLookup, probeSubdomains, hostIntel, geolocateIp, waybackSnapshot,
  type DnsResult, type SubdomainResult, type HostIntel, type IpGeo, type WaybackResult,
} from '../../services/osint';

interface LiveReconProps { value: string; kind: 'email' | 'domain' | 'ip' }

// Runs real, in-app OSINT lookups against the entered selector and renders the
// results — turning the Email & Domain page from a link directory into a live
// recon surface. All sources are keyless and CORS-enabled (see services/osint).
const LiveRecon: React.FC<LiveReconProps> = ({ value, kind }) => {
  const [loading, setLoading] = useState(true);
  const [dns, setDns] = useState<DnsResult | null>(null);
  const [subs, setSubs] = useState<SubdomainResult | null>(null);
  const [subProgress, setSubProgress] = useState(0);
  const [host, setHost] = useState<HostIntel | null>(null);
  const [geo, setGeo] = useState<IpGeo | null>(null);
  const [wayback, setWayback] = useState<WaybackResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDns(null); setSubs(null); setHost(null); setGeo(null); setWayback(null); setSubProgress(0);

    const domain = kind === 'email' ? value.split('@')[1] ?? '' : value;

    const run = async () => {
      if (kind === 'ip') {
        const [h, g] = await Promise.all([hostIntel(value), geolocateIp(value)]);
        if (cancelled) return;
        setHost(h); setGeo(g);
      } else if (domain) {
        const [d, w] = await Promise.all([dnsLookup(domain), waybackSnapshot(domain)]);
        if (cancelled) return;
        setDns(d); setWayback(w);
        const s = await probeSubdomains(domain, (done, total) => !cancelled && setSubProgress(Math.round((done / total) * 100)));
        if (cancelled) return;
        setSubs(s);
      }
      if (!cancelled) setLoading(false);
    };
    run();
    return () => { cancelled = true; };
  }, [value, kind]);

  const Section: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode; badge?: string }> = ({ icon, title, children, badge }) => (
    <div className="card">
      <div className="card-header">
        {icon}
        <h3 className="section-title">{title}</h3>
        {badge && <span className="badge badge-blue ml-auto">{badge}</span>}
      </div>
      {children}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Network size={13} className="text-teal-400" />
        Live recon on <span className="text-gray-300 font-mono">{value}</span> — real data, no API key, direct from your browser
        {loading && <Loader2 size={12} className="animate-spin ml-1" />}
      </div>

      {/* IP intelligence */}
      {kind === 'ip' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Section icon={<Server size={18} className="text-orange-400" />} title="Host Intelligence" badge="Shodan InternetDB">
            {!host ? <Loader2 size={16} className="animate-spin text-gray-500" /> : host.error ? (
              <p className="text-xs text-gray-500">{host.error}</p>
            ) : (
              <div className="space-y-2 text-sm">
                <div><span className="text-gray-500 text-xs">Open ports:</span> <span className="text-gray-200">{host.ports.join(', ') || 'none found'}</span></div>
                {host.hostnames.length > 0 && <div><span className="text-gray-500 text-xs">Hostnames:</span> <span className="text-gray-200">{host.hostnames.join(', ')}</span></div>}
                {host.cpes.length > 0 && <div><span className="text-gray-500 text-xs">Software:</span> <span className="text-gray-300 text-xs">{host.cpes.join(', ')}</span></div>}
                <div className="flex items-center gap-2">
                  <ShieldAlert size={14} className={host.vulns.length ? 'text-red-400' : 'text-green-400'} />
                  <span className={`text-sm ${host.vulns.length ? 'text-red-300' : 'text-green-300'}`}>
                    {host.vulns.length ? `${host.vulns.length} known CVEs` : 'No known CVEs'}
                  </span>
                </div>
                {host.vulns.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {host.vulns.map((v) => (
                      <a key={v} href={`https://nvd.nist.gov/vuln/detail/${v}`} target="_blank" rel="noopener noreferrer" className="badge badge-red text-xs hover:underline">{v}</a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Section>
          <Section icon={<MapPin size={18} className="text-green-400" />} title="Geolocation & Network" badge="ipwho.is">
            {!geo ? <Loader2 size={16} className="animate-spin text-gray-500" /> : geo.error ? (
              <p className="text-xs text-gray-500">{geo.error}</p>
            ) : (
              <div className="space-y-1.5 text-sm">
                <div><span className="text-gray-500 text-xs">Location:</span> <span className="text-gray-200">{[geo.city, geo.region, geo.country].filter(Boolean).join(', ') || 'Unknown'}</span></div>
                <div><span className="text-gray-500 text-xs">ASN:</span> <span className="text-gray-200">{geo.asn ?? '—'}</span></div>
                <div><span className="text-gray-500 text-xs">Org:</span> <span className="text-gray-200">{geo.org ?? '—'}</span></div>
                <div><span className="text-gray-500 text-xs">ISP:</span> <span className="text-gray-200">{geo.isp ?? '—'}</span></div>
              </div>
            )}
          </Section>
        </div>
      )}

      {/* Domain / email intelligence */}
      {kind !== 'ip' && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section icon={<Globe size={18} className="text-teal-400" />} title="DNS Records" badge="dns.google DoH">
              {!dns ? <Loader2 size={16} className="animate-spin text-gray-500" /> : dns.error ? (
                <p className="text-xs text-gray-500">{dns.error}</p>
              ) : dns.records.length === 0 ? (
                <p className="text-xs text-gray-500">No records resolved.</p>
              ) : (
                <div className="overflow-x-auto max-h-56 overflow-y-auto">
                  <table className="data-table">
                    <thead><tr><th>Type</th><th>Value</th></tr></thead>
                    <tbody>
                      {dns.records.map((r, i) => (
                        <tr key={i}><td><span className="badge badge-blue text-xs">{r.type}</span></td><td className="font-mono text-xs break-all">{r.value}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
            <Section icon={<Clock size={18} className="text-indigo-400" />} title="Archive History" badge="Wayback Machine">
              {!wayback ? <Loader2 size={16} className="animate-spin text-gray-500" /> : !wayback.available ? (
                <p className="text-xs text-gray-500">{wayback.error ? `Error: ${wayback.error}` : 'No archived snapshot found.'}</p>
              ) : (
                <div className="text-sm space-y-1">
                  <p className="text-gray-300">Latest snapshot: <span className="text-gray-100">{wayback.timestamp}</span></p>
                  <a href={wayback.snapshot} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline text-xs break-all">{wayback.snapshot}</a>
                </div>
              )}
            </Section>
          </div>

          <Section
            icon={<Server size={18} className="text-purple-400" />}
            title="Subdomain Discovery"
            badge={subs ? `${subs.hits.length} live` : subProgress ? `probing ${subProgress}%` : 'probing…'}
          >
            {!subs ? (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Loader2 size={14} className="animate-spin" /> Resolving common subdomains via DoH… {subProgress}%
              </div>
            ) : subs.hits.length === 0 ? (
              <p className="text-xs text-gray-500">No common subdomains resolved (probed {subs.probed}).</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {subs.hits.map((h) => (
                  <div key={h.subdomain} className="flex items-center justify-between p-2 bg-gray-900 rounded-lg text-xs">
                    <span className="text-gray-200 font-mono truncate">{h.subdomain}</span>
                    <span className="text-gray-500 ml-2 flex-shrink-0">{h.ip}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
};

export default LiveRecon;
