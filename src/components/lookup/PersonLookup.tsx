import React, { useState } from 'react';
import { User, Search, ExternalLink, AlertTriangle, Globe, Mail } from 'lucide-react';

const OSINT_SOURCES = [
  {
    name: 'WhitePages',
    url: 'https://www.whitepages.com/name/',
    description: 'Phone, address, background',
    icon: '📋',
  },
  {
    name: 'Spokeo',
    url: 'https://www.spokeo.com/',
    description: 'Social & contact info',
    icon: '🔍',
  },
  {
    name: 'BeenVerified',
    url: 'https://www.beenverified.com/',
    description: 'Background check',
    icon: '✅',
  },
  {
    name: 'Intelius',
    url: 'https://www.intelius.com/',
    description: 'People search',
    icon: '🧩',
  },
  {
    name: 'PeopleFinder',
    url: 'https://www.peoplefinder.com/',
    description: 'Public records search',
    icon: '🗂️',
  },
  {
    name: 'FastPeopleSearch',
    url: 'https://www.fastpeoplesearch.com/',
    description: 'Free people search',
    icon: '⚡',
  },
  {
    name: 'TruthFinder',
    url: 'https://www.truthfinder.com/',
    description: 'Deep background check',
    icon: '🔎',
  },
  {
    name: 'Pipl',
    url: 'https://pipl.com/',
    description: 'Identity verification',
    icon: '🌐',
  },
  {
    name: 'Social Searcher',
    url: 'https://www.social-searcher.com/',
    description: 'Social media search',
    icon: '📱',
  },
  {
    name: 'LinkedIn Search',
    url: 'https://www.linkedin.com/search/results/people/?keywords=',
    description: 'Professional network',
    icon: '💼',
  },
  {
    name: 'Twitter/X Search',
    url: 'https://twitter.com/search?q=',
    description: 'Twitter profile search',
    icon: '🐦',
  },
  {
    name: 'Facebook Search',
    url: 'https://www.facebook.com/search/people/?q=',
    description: 'Facebook profile search',
    icon: '👥',
  },
];

const USERNAME_TOOLS = [
  { name: 'Sherlock', url: 'https://github.com/sherlock-project/sherlock', description: 'Hunt social accounts' },
  { name: 'WhatsMyName', url: 'https://whatsmyname.app/', description: 'Username search' },
  { name: 'Namechk', url: 'https://namechk.com/', description: 'Check username availability' },
  { name: 'UserSearch', url: 'https://usersearch.org/', description: 'Find by username' },
];

const PersonLookup: React.FC = () => {
  const [query, setQuery] = useState({ firstName: '', lastName: '', city: '', state: '', email: '' });
  const [usernameQuery, setUsernameQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'name' | 'username' | 'email'>('name');

  const buildSearchUrl = (baseUrl: string) => {
    if (activeTab === 'name') {
      const name = [query.firstName, query.lastName].filter(Boolean).join(' ');
      const location = [query.city, query.state].filter(Boolean).join(', ');
      return `${baseUrl}${encodeURIComponent(name)}${location ? `+${encodeURIComponent(location)}` : ''}`;
    }
    if (activeTab === 'username') {
      return `${baseUrl}${encodeURIComponent(usernameQuery)}`;
    }
    if (activeTab === 'email') {
      return `${baseUrl}${encodeURIComponent(query.email)}`;
    }
    return baseUrl;
  };

  const handleGoogleDork = () => {
    if (activeTab === 'name') {
      const name = [query.firstName, query.lastName].filter(Boolean).join(' ');
      const site = query.city ? `"${name}" "${query.city}"` : `"${name}"`;
      window.open(`https://www.google.com/search?q=${encodeURIComponent(site)}`, '_blank');
    } else if (activeTab === 'username') {
      window.open(
        `https://www.google.com/search?q=${encodeURIComponent(`"${usernameQuery}" site:twitter.com OR site:instagram.com OR site:reddit.com OR site:linkedin.com`)}`,
        '_blank'
      );
    }
  };

  return (
    <div className="space-y-4">
      {/* Legal disclaimer */}
      <div className="bg-amber-900/20 border border-amber-700/50 rounded-xl p-4 flex gap-3">
        <AlertTriangle size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-amber-300 font-medium text-sm">Legal & Ethical Use Only</p>
          <p className="text-amber-400/80 text-xs mt-1">
            This tool aggregates links to publicly available data sources. All searches must comply
            with applicable laws including GDPR, CCPA, and the FCRA. Do not use for stalking,
            harassment, or any illegal purpose. Data accessed through these sources is subject to
            their respective terms of service.
          </p>
        </div>
      </div>

      {/* Search tabs */}
      <div className="card">
        <div className="flex gap-2 mb-4 border-b border-gray-800 pb-3">
          {(['name', 'username', 'email'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${
                activeTab === tab
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }`}
            >
              {tab === 'name' ? 'Name Search' : tab === 'username' ? 'Username' : 'Email'}
            </button>
          ))}
        </div>

        {activeTab === 'name' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <input className="input-field" placeholder="First Name" value={query.firstName}
              onChange={(e) => setQuery((p) => ({ ...p, firstName: e.target.value }))} />
            <input className="input-field" placeholder="Last Name" value={query.lastName}
              onChange={(e) => setQuery((p) => ({ ...p, lastName: e.target.value }))} />
            <input className="input-field" placeholder="City" value={query.city}
              onChange={(e) => setQuery((p) => ({ ...p, city: e.target.value }))} />
            <input className="input-field" placeholder="State" value={query.state}
              onChange={(e) => setQuery((p) => ({ ...p, state: e.target.value }))} />
            <button onClick={handleGoogleDork} className="btn-primary">
              <Search size={15} />
              Google Dork
            </button>
          </div>
        )}

        {activeTab === 'username' && (
          <div className="flex gap-3">
            <div className="relative flex-1">
              <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                className="input-field pl-9"
                placeholder="Enter username..."
                value={usernameQuery}
                onChange={(e) => setUsernameQuery(e.target.value)}
              />
            </div>
            <button onClick={handleGoogleDork} className="btn-primary">
              <Search size={15} />
              Search
            </button>
          </div>
        )}

        {activeTab === 'email' && (
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                className="input-field pl-9"
                placeholder="Enter email address..."
                value={query.email}
                onChange={(e) => setQuery((p) => ({ ...p, email: e.target.value }))}
                type="email"
              />
            </div>
          </div>
        )}
      </div>

      {/* Main OSINT sources */}
      <div className="card">
        <div className="card-header">
          <Globe size={18} className="text-rose-400" />
          <h3 className="section-title">People Search Databases</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {OSINT_SOURCES.map((source) => (
            <a
              key={source.name}
              href={buildSearchUrl(source.url)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-3 bg-gray-900 rounded-lg border border-gray-800 hover:border-rose-700/50 transition-all group"
            >
              <span className="text-2xl">{source.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-200 group-hover:text-rose-300 transition-colors">
                  {source.name}
                </p>
                <p className="text-xs text-gray-500">{source.description}</p>
              </div>
              <ExternalLink size={13} className="text-gray-600 group-hover:text-rose-400 flex-shrink-0" />
            </a>
          ))}
        </div>
      </div>

      {/* Username tools */}
      {activeTab === 'username' && (
        <div className="card">
          <div className="card-header">
            <User size={18} className="text-violet-400" />
            <h3 className="section-title">Username Search Tools</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {USERNAME_TOOLS.map((tool) => (
              <a
                key={tool.name}
                href={`${tool.url}${usernameQuery ? encodeURIComponent(usernameQuery) : ''}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 bg-gray-900 rounded-lg border border-gray-800 hover:border-violet-700/50 transition-all group"
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-200 group-hover:text-violet-300">{tool.name}</p>
                  <p className="text-xs text-gray-500">{tool.description}</p>
                </div>
                <ExternalLink size={13} className="text-gray-600 group-hover:text-violet-400" />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Google Dork Templates */}
      <div className="card">
        <div className="card-header">
          <Search size={18} className="text-gray-400" />
          <h3 className="section-title">Google Dork Templates</h3>
        </div>
        <div className="space-y-2">
          {[
            {
              label: 'Find social profiles',
              template: (name: string) =>
                `"${name}" site:linkedin.com OR site:twitter.com OR site:facebook.com OR site:instagram.com`,
            },
            {
              label: 'Find mentions',
              template: (name: string) => `"${name}" -site:linkedin.com -site:facebook.com`,
            },
            {
              label: 'Find documents',
              template: (name: string) =>
                `"${name}" filetype:pdf OR filetype:doc OR filetype:xls`,
            },
            {
              label: 'Find news articles',
              template: (name: string) => `"${name}" site:news.google.com OR site:reuters.com OR site:apnews.com`,
            },
          ].map(({ label, template }) => {
            const name = [query.firstName, query.lastName].filter(Boolean).join(' ') || 'John Doe';
            const dork = template(name);
            return (
              <div key={label} className="flex items-center gap-3 p-3 bg-gray-900 rounded-lg">
                <div className="flex-1">
                  <p className="text-xs font-medium text-gray-400 mb-1">{label}</p>
                  <code className="text-xs text-green-400 font-mono break-all">{dork}</code>
                </div>
                <a
                  href={`https://www.google.com/search?q=${encodeURIComponent(dork)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary text-xs flex-shrink-0"
                >
                  <ExternalLink size={12} />
                  Search
                </a>
              </div>
            );
          })}
        </div>
      </div>

      {/* Data broker opt-out */}
      <div className="card">
        <div className="card-header">
          <AlertTriangle size={16} className="text-yellow-400" />
          <h3 className="section-title text-yellow-400">Privacy Protection Resources</h3>
        </div>
        <p className="text-sm text-gray-400 mb-3">
          Tools to remove your own information from data broker databases:
        </p>
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'DeleteMe', url: 'https://joindeleteme.com' },
            { label: 'Privacy Bee', url: 'https://privacybee.com' },
            { label: 'OneRep', url: 'https://onerep.com' },
            { label: 'WhitePages Opt-Out', url: 'https://www.whitepages.com/suppression-requests' },
            { label: 'Spokeo Opt-Out', url: 'https://www.spokeo.com/optout' },
          ].map((r) => (
            <a key={r.label} href={r.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-yellow-400 hover:text-yellow-300 bg-yellow-900/20 px-3 py-1.5 rounded-full border border-yellow-800/40">
              <ExternalLink size={10} />
              {r.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PersonLookup;
