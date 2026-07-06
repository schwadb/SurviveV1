import React, { useState } from 'react';
import {
  Mail, Globe, Search, ExternalLink, AlertTriangle,
  Shield, Database, Server, Key, Lock
} from 'lucide-react';
import { useSearchHistory } from '../../hooks/useSearchHistory';
import SearchHistory from '../common/SearchHistory';
import LiveRecon from './LiveRecon';

type ActiveTab = 'email' | 'domain' | 'ip';

const EMAIL_TOOLS = [
  { name: 'HaveIBeenPwned', url: 'https://haveibeenpwned.com/account/', description: 'Check data breaches', icon: '🔓', free: true },
  { name: 'Hunter.io', url: 'https://hunter.io/search/', description: 'Find emails by domain', icon: '🎯', free: true },
  { name: 'Emailrep.io', url: 'https://emailrep.io/', description: 'Email reputation score', icon: '⭐', free: true },
  { name: 'Epieos', url: 'https://epieos.com/?q=', description: 'Google account lookup', icon: '🔍', free: true },
  { name: 'GHunt', url: 'https://github.com/mxrch/GHunt', description: 'Google account OSINT tool', icon: '🐧', free: true },
  { name: 'Holehe', url: 'https://github.com/megadose/holehe', description: 'Check email on 120+ sites', icon: '🐙', free: true },
  { name: 'EmailHippo', url: 'https://tools.emailhippo.com/', description: 'Email verification', icon: '✅', free: true },
  { name: 'MailboxValidator', url: 'https://www.mailboxvalidator.com/', description: 'Validate email addresses', icon: '📬', free: false },
];

const DOMAIN_TOOLS = [
  { name: 'WHOIS Lookup', url: 'https://www.whois.com/whois/', description: 'Domain registration info', icon: '📋', free: true },
  { name: 'Shodan', url: 'https://www.shodan.io/search?query=hostname:', description: 'Internet-connected devices', icon: '🔭', free: false },
  { name: 'SecurityTrails', url: 'https://securitytrails.com/domain/', description: 'DNS history & subdomains', icon: '🛤️', free: true },
  { name: 'DNSDumpster', url: 'https://dnsdumpster.com/', description: 'DNS recon & research', icon: '📡', free: true },
  { name: 'Censys', url: 'https://search.censys.io/search?resource=hosts&q=', description: 'Internet scan data', icon: '🔬', free: true },
  { name: 'VirusTotal', url: 'https://www.virustotal.com/gui/domain/', description: 'Malware & threat intel', icon: '🦠', free: true },
  { name: 'URLScan.io', url: 'https://urlscan.io/search/#domain:', description: 'Website scanner', icon: '🌐', free: true },
  { name: 'Wayback Machine', url: 'https://web.archive.org/web/*/', description: 'Historical snapshots', icon: '🕰️', free: true },
  { name: 'crt.sh', url: 'https://crt.sh/?q=', description: 'SSL certificate search', icon: '🔒', free: true },
  { name: 'Sublist3r', url: 'https://github.com/aboul3la/Sublist3r', description: 'Subdomain enumeration', icon: '🌿', free: true },
  { name: 'Google Dorks', url: 'https://www.google.com/search?q=site:', description: 'Site: search operator', icon: '🔎', free: true },
  { name: 'BGPView', url: 'https://bgpview.io/prefix/', description: 'ASN & BGP routing data', icon: '🗺️', free: true },
];

const IP_TOOLS = [
  { name: 'IPinfo', url: 'https://ipinfo.io/', description: 'IP geolocation & owner', icon: '📍', free: true },
  { name: 'AbuseIPDB', url: 'https://www.abuseipdb.com/check/', description: 'IP abuse reports', icon: '🚫', free: true },
  { name: 'Shodan IP', url: 'https://www.shodan.io/host/', description: 'Open ports & services', icon: '🔭', free: false },
  { name: 'Censys IP', url: 'https://search.censys.io/hosts/', description: 'Host certificates & ports', icon: '🔬', free: true },
  { name: 'GreyNoise', url: 'https://www.greynoise.io/viz/ip?ip=', description: 'Internet background noise', icon: '🌫️', free: true },
  { name: 'Talos Intelligence', url: 'https://talosintelligence.com/reputation_center/lookup?search=', description: 'Cisco threat intel', icon: '🛡️', free: true },
];

const EmailDomainOSINT: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('email');
  const [query, setQuery] = useState('');
  const [recon, setRecon] = useState<{ value: string; kind: ActiveTab } | null>(null);
  const { addEntry } = useSearchHistory();

  const handleSearch = () => {
    const q = query.trim();
    if (!q) return;
    addEntry({ query: q, type: (activeTab === 'ip' ? 'domain' : activeTab) });
    setRecon({ value: q, kind: activeTab });
  };

  const buildUrl = (baseUrl: string) => {
    if (!query.trim()) return baseUrl;
    return `${baseUrl}${encodeURIComponent(query.trim())}`;
  };

  const tools = activeTab === 'email' ? EMAIL_TOOLS : activeTab === 'domain' ? DOMAIN_TOOLS : IP_TOOLS;

  const tabConfig = {
    email: { placeholder: 'user@example.com', label: 'Email Address', icon: Mail, color: 'text-blue-400' },
    domain: { placeholder: 'example.com', label: 'Domain or URL', icon: Globe, color: 'text-teal-400' },
    ip: { placeholder: '8.8.8.8', label: 'IP Address', icon: Server, color: 'text-orange-400' },
  };

  const tc = tabConfig[activeTab];
  const TabIcon = tc.icon;

  return (
    <div className="space-y-4">
      {/* Disclaimer */}
      <div className="bg-amber-900/20 border border-amber-700/50 rounded-xl p-4 flex gap-3">
        <AlertTriangle size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-amber-300 font-medium text-sm">Authorized Use Only</p>
          <p className="text-amber-400/80 text-xs mt-1">
            Use these tools only on systems and accounts you own or have explicit authorization to investigate.
            Unauthorized access to computer systems violates the CFAA and similar laws worldwide.
          </p>
        </div>
      </div>

      {/* Tab selector */}
      <div className="card">
        <div className="flex gap-2 mb-4 border-b border-gray-800 pb-3">
          {(['email', 'domain', 'ip'] as ActiveTab[]).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                activeTab === tab ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }`}>
              {tab === 'email' ? '✉️ Email' : tab === 'domain' ? '🌐 Domain' : '🖥️ IP Address'}
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1">
            <TabIcon size={15} className={`absolute left-3 top-1/2 -translate-y-1/2 ${tc.color}`} />
            <input
              className="input-field pl-9"
              placeholder={tc.placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              type={activeTab === 'email' ? 'email' : 'text'}
            />
          </div>
          <button onClick={handleSearch} disabled={!query.trim()} className="btn-primary">
            <Search size={15} />
            Run Live Recon
          </button>
        </div>

        <SearchHistory typeFilter={activeTab} onSelect={setQuery} compact />
      </div>

      {/* Live in-app recon results */}
      {recon && <LiveRecon key={`${recon.kind}:${recon.value}`} value={recon.value} kind={recon.kind} />}

      {/* Quick stats for entered value */}
      {query && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {activeTab === 'email' && [
            { label: 'Domain', value: query.includes('@') ? query.split('@')[1] : '—', icon: Globe },
            { label: 'Local Part', value: query.includes('@') ? query.split('@')[0] : '—', icon: Mail },
            { label: 'Format Valid', value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query) ? '✅ Yes' : '❌ No', icon: Shield },
            { label: 'Type', value: 'Email', icon: Key },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="card text-center p-3">
              <Icon size={16} className="mx-auto text-blue-400 mb-1" />
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-sm text-gray-200 font-medium mt-0.5 truncate">{value}</p>
            </div>
          ))}

          {activeTab === 'domain' && [
            { label: 'TLD', value: query.includes('.') ? `.${query.split('.').pop()}` : '—', icon: Globe },
            { label: 'Protocol', value: query.startsWith('https') ? 'HTTPS' : query.startsWith('http') ? 'HTTP' : 'N/A', icon: Lock },
            { label: 'Subdomain', value: query.split('.').length > 2 ? query.split('.')[0] : 'None', icon: Server },
            { label: 'Type', value: 'Domain', icon: Key },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="card text-center p-3">
              <Icon size={16} className="mx-auto text-teal-400 mb-1" />
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-sm text-gray-200 font-medium mt-0.5 truncate">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tool cards */}
      <div className="card">
        <div className="card-header">
          <Database size={18} className={tc.color} />
          <h3 className="section-title">
            {activeTab === 'email' ? 'Email OSINT Tools' : activeTab === 'domain' ? 'Domain Intelligence Tools' : 'IP Reputation Tools'}
          </h3>
          <span className="badge badge-blue ml-auto">{tools.filter((t) => t.free).length} free</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {tools.map((tool) => (
            <a
              key={tool.name}
              href={buildUrl(tool.url)}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-start gap-3 p-3 bg-gray-900 rounded-lg border transition-all group ${
                tool.free ? 'border-gray-800 hover:border-teal-700/50' : 'border-gray-800/50 hover:border-gray-600 opacity-80'
              }`}
            >
              <span className="text-xl flex-shrink-0">{tool.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`text-sm font-medium text-gray-200 group-hover:${tc.color.replace('text-', 'text-')} transition-colors`}>
                    {tool.name}
                  </p>
                  {tool.free ? (
                    <span className="badge badge-green text-xs">Free</span>
                  ) : (
                    <span className="badge badge-yellow text-xs">Paid</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{tool.description}</p>
              </div>
              <ExternalLink size={12} className="text-gray-600 group-hover:text-teal-400 flex-shrink-0 mt-1" />
            </a>
          ))}
        </div>
      </div>

      {/* Google Dork templates */}
      <div className="card">
        <div className="card-header">
          <Search size={16} className="text-gray-400" />
          <h3 className="section-title">
            {activeTab === 'email' ? 'Email Dork Templates' : activeTab === 'domain' ? 'Domain Dork Templates' : 'IP Dork Templates'}
          </h3>
        </div>

        <div className="space-y-2">
          {(activeTab === 'email'
            ? [
                { label: 'Find email mentions', dork: (q: string) => `"${q}"` },
                { label: 'Social media presence', dork: (q: string) => `"${q}" site:twitter.com OR site:linkedin.com OR site:github.com` },
                { label: 'Paste sites', dork: (q: string) => `"${q}" site:pastebin.com OR site:ghostbin.com` },
                { label: 'Forum mentions', dork: (q: string) => `"${q}" site:reddit.com OR site:stackoverflow.com` },
              ]
            : activeTab === 'domain'
            ? [
                { label: 'Subdomains', dork: (q: string) => `site:*.${q}` },
                { label: 'Login pages', dork: (q: string) => `site:${q} inurl:login OR inurl:admin OR inurl:signin` },
                { label: 'Exposed files', dork: (q: string) => `site:${q} filetype:pdf OR filetype:xls OR filetype:doc` },
                { label: 'Config files', dork: (q: string) => `site:${q} filetype:env OR filetype:config OR inurl:.git` },
              ]
            : [
                { label: 'IP mentions', dork: (q: string) => `"${q}"` },
                { label: 'Abuse reports', dork: (q: string) => `"${q}" abuse OR malware OR spam` },
              ]
          ).map(({ label, dork }) => {
            const val = query || (activeTab === 'email' ? 'user@example.com' : activeTab === 'domain' ? 'example.com' : '1.2.3.4');
            const d = dork(val);
            return (
              <div key={label} className="flex items-center gap-3 p-3 bg-gray-900 rounded-lg">
                <div className="flex-1">
                  <p className="text-xs font-medium text-gray-400 mb-1">{label}</p>
                  <code className="text-xs text-green-400 font-mono break-all">{d}</code>
                </div>
                <a
                  href={`https://www.google.com/search?q=${encodeURIComponent(d)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="btn-secondary text-xs flex-shrink-0"
                >
                  <ExternalLink size={12} />Search
                </a>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default EmailDomainOSINT;
