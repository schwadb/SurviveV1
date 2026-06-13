import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Search, Copy, ExternalLink, ChevronDown, ChevronUp,
  FileSearch, Zap, BookOpen, Check, Star, Trash2,
  Plus, AlertTriangle, Sparkles, Link, Clock,
} from 'lucide-react';
import { useSearchHistory } from '../hooks/useSearchHistory';
import { useLocalStorage, useSettings } from '../hooks/useLocalStorage';
import SearchHistory from '../components/common/SearchHistory';
import { ExportBar } from '../components/common/ExportImport';
import { perplexitySearch } from '../services/api';
import toast from 'react-hot-toast';

// ── Types ────────────────────────────────────────────────────────────────────

interface OperatorFields {
  site: string;
  inurl: string;
  intitle: string;
  intext: string;
  filetype: string;
  ext: string;
  before: string;
  after: string;
  inanchor: string;
  phrase: string;
  freeform: string;
  notTerms: string;
  allintext: string;
  allinurl: string;
  allintitle: string;
  cache: string;
  related: string;
  numrangeLo: string;
  numrangeHi: string;
}

interface SavedDork {
  id: string;
  name: string;
  query: string;
  savedAt: string;
}

const DEFAULT_FIELDS: OperatorFields = {
  site: '', inurl: '', intitle: '', intext: '', filetype: '', ext: '',
  before: '', after: '', inanchor: '', phrase: '', freeform: '', notTerms: '',
  allintext: '', allinurl: '', allintitle: '', cache: '', related: '',
  numrangeLo: '', numrangeHi: '',
};

// ── Constants ─────────────────────────────────────────────────────────────────

const FILETYPES = ['', 'pdf', 'xls', 'xlsx', 'doc', 'docx', 'csv', 'sql', 'log', 'xml', 'json', 'php', 'env', 'config', 'bak', 'zip', 'txt'];

const ENGINES = [
  { name: 'Google', url: (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  { name: 'Bing', url: (q: string) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
  { name: 'DuckDuckGo', url: (q: string) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
  { name: 'Yandex', url: (q: string) => `https://yandex.com/search/?text=${encodeURIComponent(q)}` },
  { name: 'Shodan', url: (q: string) => `https://www.shodan.io/search?query=${encodeURIComponent(q)}` },
];

const GHDB_CATEGORIES = [
  {
    name: 'Footholds',
    badge: 'badge-red',
    templates: [
      'inurl:login intitle:"index of"',
      'intitle:"admin panel"',
      'inurl:admin intitle:"login"',
      'intitle:"setup.php" inurl:setup',
    ],
  },
  {
    name: 'Files Containing Usernames',
    badge: 'badge-yellow',
    templates: [
      'filetype:log "username"',
      'filetype:txt "username"',
      'intext:"Username:" filetype:conf',
      'filetype:csv "username" "password"',
    ],
  },
  {
    name: 'Sensitive Directories',
    badge: 'badge-orange',
    templates: [
      'intitle:"index of" "parent directory"',
      'intitle:"index of" /backup',
      'intitle:"index of" /admin',
      'intitle:"index of" /.git',
      'intitle:"index of" /conf',
    ],
  },
  {
    name: 'Web Server Detection',
    badge: 'badge-blue',
    templates: [
      'intitle:"Apache HTTP Server"',
      'intitle:"IIS Windows Server"',
      'intitle:"Welcome to nginx"',
      'intitle:"OpenSSH" intitle:"Welcome"',
    ],
  },
  {
    name: 'Vulnerable Files',
    badge: 'badge-red',
    templates: [
      'intitle:"admbook" filetype:php',
      'inurl:"phpinfo.php"',
      'filetype:php inurl:"?id="',
      'inurl:"config.php" filetype:php',
    ],
  },
  {
    name: 'Vulnerable Servers',
    badge: 'badge-red',
    templates: [
      'intitle:"VNC desktop" inurl:5800',
      'intitle:"Cisco Systems" "CISCO SYSTEMS"',
      'inurl:8080 intitle:"Welcome to JBoss"',
      'intitle:"RouterOS" inurl:winbox',
    ],
  },
  {
    name: 'Error Messages',
    badge: 'badge-yellow',
    templates: [
      'intext:"sql syntax near"',
      'intext:"supplied argument is not a valid"',
      'intitle:"error occurred"',
      'intext:"Warning: mysql_"',
    ],
  },
  {
    name: 'Files Containing Juicy Info',
    badge: 'badge-purple',
    templates: [
      'filetype:xls "username" "password"',
      'filetype:pdf "confidential"',
      'inurl:"wp-config.bak"',
      'filetype:txt "secret_key"',
    ],
  },
  {
    name: 'Files Containing Passwords',
    badge: 'badge-red',
    templates: [
      'filetype:log intext:"password"',
      'filetype:env intext:"DB_PASSWORD"',
      'inurl:"passwd" filetype:txt',
      'filetype:ini intext:"password"',
    ],
  },
  {
    name: 'Sensitive Online Shopping Info',
    badge: 'badge-yellow',
    templates: [
      'intext:"card number" filetype:xls',
      'intitle:"order details" inurl:checkout',
      'intext:"credit card" filetype:log',
      'filetype:csv "card_number"',
    ],
  },
  {
    name: 'Network/Vulnerability Data',
    badge: 'badge-blue',
    templates: [
      'intitle:"network camera" inurl:"/view.shtml"',
      'inurl:"/admin/config" filetype:xml',
      'intitle:"RouterOS" inurl:winbox',
      'inurl:"/cgi-bin/" filetype:sh',
    ],
  },
  {
    name: 'Login Portals',
    badge: 'badge-green',
    templates: [
      'intitle:"login" inurl:admin',
      'intitle:"sign in" inurl:"/user/login"',
      'intitle:"Administrator Login"',
      'inurl:"/wp-login.php"',
    ],
  },
  {
    name: 'Various Online Devices',
    badge: 'badge-purple',
    templates: [
      'intitle:"webcamXP 5"',
      'inurl:"CgiStart?page="',
      'intitle:"Live View / - AXIS"',
      'inurl:"/view/index.shtml"',
    ],
  },
  {
    name: 'Advisories & Vulnerabilities',
    badge: 'badge-blue',
    templates: [
      'intitle:"index of" "advisory"',
      'inurl:"CVE-" filetype:txt',
      'intext:"CVSS" filetype:pdf',
      'intitle:"security advisory" filetype:pdf',
    ],
  },
];

const RSA_CATEGORIES = [
  {
    name: 'File & Directory Discovery',
    badge: 'badge-red',
    templates: [
      'intitle:"index of" .env',
      'inurl:".git" intitle:"index of"',
      'filetype:bak',
      'filetype:sql "INSERT INTO"',
    ],
  },
  {
    name: 'Web Application Discovery',
    badge: 'badge-blue',
    templates: [
      'inurl:wp-admin',
      'inurl:phpmyadmin',
      'intext:"Powered by" inurl:login',
      'intitle:"phpMyAdmin"',
    ],
  },
  {
    name: 'Information Gathering',
    badge: 'badge-green',
    templates: [
      'site:pastebin.com "password"',
      'site:linkedin.com/in',
      'site:github.com intext:"api_key"',
      'site:trello.com intext:"password"',
    ],
  },
  {
    name: 'Cloud & Infrastructure',
    badge: 'badge-yellow',
    templates: [
      'site:s3.amazonaws.com',
      'intitle:"Kubernetes" inurl:dashboard',
      'site:.blob.core.windows.net',
      'inurl:/_cluster/health',
    ],
  },
  {
    name: 'API & Development',
    badge: 'badge-purple',
    templates: [
      'inurl:"/api/v1" intitle:"Swagger"',
      'filetype:env "SECRET_KEY"',
      'inurl:"graphql" intitle:"GraphQL Playground"',
      'inurl:"/api/swagger"',
    ],
  },
  {
    name: 'Archives & Historical',
    badge: 'badge-blue',
    templates: [
      'site:web.archive.org',
      'inurl:crossdomain.xml',
      'filetype:xml "sitemap" inurl:sitemap.xml',
      'inurl:".DS_Store" intitle:"index of"',
    ],
  },
];

const CHEATSHEET = [
  { op: 'site:', desc: 'Restrict to domain', ex: 'site:example.com' },
  { op: 'inurl:', desc: 'Keyword in URL', ex: 'inurl:admin' },
  { op: 'intitle:', desc: 'Keyword in page title', ex: 'intitle:"login"' },
  { op: 'intext:', desc: 'Keyword in body text', ex: 'intext:"password"' },
  { op: 'filetype:', desc: 'Specific file type', ex: 'filetype:pdf' },
  { op: 'inanchor:', desc: 'Keyword in anchor text', ex: 'inanchor:click' },
  { op: '"..."', desc: 'Exact phrase match', ex: '"john doe"' },
  { op: 'before:', desc: 'Pages indexed before date', ex: 'before:2023-01-01' },
  { op: 'after:', desc: 'Pages indexed after date', ex: 'after:2020-01-01' },
  { op: '-term', desc: 'Exclude term (NOT)', ex: '-inurl:login' },
  { op: 'OR / |', desc: 'Match either term', ex: 'cats | dogs' },
  { op: '*', desc: 'Wildcard placeholder', ex: '"admin * password"' },
  { op: 'cache:', desc: "Google's cached version", ex: 'cache:example.com' },
  { op: 'related:', desc: 'Similar sites', ex: 'related:nytimes.com' },
  { op: 'link:', desc: 'Pages linking to URL', ex: 'link:example.com' },
  { op: 'define:', desc: 'Define a word', ex: 'define:OSINT' },
];

const EXTERNAL_TOOLS = [
  { name: 'Exploit-DB GHDB', url: 'https://www.exploit-db.com/google-hacking-database', desc: 'Official Google Hacking Database with 14 categories' },
  { name: 'Recon-Search-Assistant', url: 'https://github.com/Boopath1/Recon-Search-Assistant', desc: 'Automated recon dork templates' },
  { name: 'OSINT Framework', url: 'https://osintframework.com', desc: 'Organized collection of OSINT resources' },
  { name: 'Shodan', url: 'https://www.shodan.io', desc: 'Search engine for internet-connected devices' },
  { name: 'Censys', url: 'https://censys.io', desc: 'Scan the internet for asset discovery' },
  { name: 'GreyNoise', url: 'https://www.greynoise.io', desc: 'Internet noise & threat intelligence' },
  { name: 'URLScan', url: 'https://urlscan.io', desc: 'Scan and analyze URLs/websites' },
  { name: 'PublicWWW', url: 'https://publicwww.com', desc: 'Source code search engine' },
  { name: 'SpyOnWeb', url: 'https://spyonweb.com', desc: 'Find sites sharing analytics/adsense IDs' },
  { name: 'DorkSearch.com', url: 'https://dorksearch.com', desc: 'Pre-built dork query search engine' },
  { name: 'Google Dorking Guide', url: 'https://youtu.be/Ep5_FmzC8Uc', desc: 'Video tutorial for Google dorking' },
];

// ── Template Parser — fixes applyTemplate bug ────────────────────────────────

function parseTemplateIntoFields(tpl: string): OperatorFields {
  const fields: OperatorFields = { ...DEFAULT_FIELDS };
  let remainder = tpl;

  // Regex: op:"quoted value" OR op:bare-value — group 1 = quoted, group 2 = bare
  const extract = (key: keyof OperatorFields, re: RegExp) => {
    if (fields[key]) return;
    const m = remainder.match(re);
    if (m) { (fields as unknown as Record<string, string>)[key] = m[1] ?? m[2]; remainder = remainder.replace(m[0], '').trim(); }
  };

  extract('site',       /\bsite:(\S+)/);
  extract('inurl',      /\binurl:(\S+)/);
  extract('intitle',    /\bintitle:(?:"([^"]+)"|(\S+))/);
  extract('intext',     /\bintext:(?:"([^"]+)"|(\S+))/);
  extract('filetype',   /\bfiletype:(\S+)/);
  extract('ext',        /\bext:(\S+)/);
  extract('inanchor',   /\binanchor:(\S+)/);
  extract('allintext',  /\ballintext:(?:"([^"]+)"|(\S+))/);
  extract('allinurl',   /\ballinurl:(\S+)/);
  extract('allintitle', /\ballintitle:(?:"([^"]+)"|(\S+))/);
  extract('cache',      /\bcache:(\S+)/);
  extract('related',    /\brelated:(\S+)/);

  const bm = remainder.match(/\bbefore:(\d{4}-\d{2}-\d{2}|\d{4})/);
  if (bm) { fields.before = bm[1].length === 4 ? `${bm[1]}-01-01` : bm[1]; remainder = remainder.replace(bm[0], '').trim(); }
  const am = remainder.match(/\bafter:(\d{4}-\d{2}-\d{2}|\d{4})/);
  if (am) { fields.after = am[1].length === 4 ? `${am[1]}-01-01` : am[1]; remainder = remainder.replace(am[0], '').trim(); }

  remainder = remainder.replace(/\s+/g, ' ').trim();
  if (remainder) fields.freeform = remainder;
  return fields;
}

// ── Query Builder ─────────────────────────────────────────────────────────────

function buildQuery(fields: OperatorFields): string {
  const parts: string[] = [];
  if (fields.site) parts.push(`site:${fields.site}`);
  if (fields.inurl) parts.push(`inurl:${fields.inurl}`);
  if (fields.intitle) parts.push(`intitle:"${fields.intitle}"`);
  if (fields.intext) parts.push(`intext:"${fields.intext}"`);
  if (fields.filetype) parts.push(`filetype:${fields.filetype}`);
  if (fields.ext) parts.push(`ext:${fields.ext}`);
  if (fields.inanchor) parts.push(`inanchor:${fields.inanchor}`);
  if (fields.allintext) parts.push(`allintext:"${fields.allintext}"`);
  if (fields.allinurl) parts.push(`allinurl:${fields.allinurl}`);
  if (fields.allintitle) parts.push(`allintitle:"${fields.allintitle}"`);
  if (fields.cache) parts.push(`cache:${fields.cache}`);
  if (fields.related) parts.push(`related:${fields.related}`);
  if (fields.numrangeLo && fields.numrangeHi) parts.push(`${fields.numrangeLo}..${fields.numrangeHi}`);
  if (fields.phrase) parts.push(`"${fields.phrase}"`);
  if (fields.before) parts.push(`before:${fields.before}`);
  if (fields.after) parts.push(`after:${fields.after}`);
  if (fields.notTerms) fields.notTerms.split(',').forEach(t => { if (t.trim()) parts.push(`-${t.trim()}`); });
  if (fields.freeform) parts.push(fields.freeform);
  return parts.join(' ');
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateQuery(fields: OperatorFields, queryString: string): string[] {
  const warnings: string[] = [];
  if (fields.before && fields.after && fields.before < fields.after)
    warnings.push('before: date is earlier than after: — dates may be inverted');
  if (queryString.length > 2048)
    warnings.push(`Query is ${queryString.length} chars — Google truncates at ~2048`);
  if (fields.numrangeLo && fields.numrangeHi) {
    const lo = parseFloat(fields.numrangeLo), hi = parseFloat(fields.numrangeHi);
    if (!isNaN(lo) && !isNaN(hi) && lo > hi) warnings.push('Number range: low > high');
  }
  return warnings;
}

// ── Component ─────────────────────────────────────────────────────────────────

const DorkBuilder: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [fields, setFields] = useState<OperatorFields>(DEFAULT_FIELDS);
  const [queryString, setQueryString] = useState('');
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [showCheatsheet, setShowCheatsheet] = useState(false);
  const [showExtended, setShowExtended] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [selectedGHDB, setSelectedGHDB] = useState<number | null>(null);
  const [selectedRSA, setSelectedRSA] = useState<number | null>(null);
  const [presetName, setPresetName] = useState('');
  const [aiTarget, setAiTarget] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [presets, setPresets] = useLocalStorage<SavedDork[]>('watcher-dork-presets', []);
  const [settings] = useSettings();
  const { addEntry } = useSearchHistory();

  // URL sync — on mount parse ?q=
  useEffect(() => {
    const q = searchParams.get('q');
    if (q) {
      const parsed = parseTemplateIntoFields(q);
      setFields(parsed);
      setQueryString(buildQuery(parsed));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const warnings = useMemo(() => validateQuery(fields, queryString), [fields, queryString]);

  const updateQuery = useCallback((updated: OperatorFields) => {
    const q = buildQuery(updated);
    setQueryString(q);
    if (q) setSearchParams({ q }, { replace: true });
    else setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  const handleField = (key: keyof OperatorFields, value: string) => {
    const updated = { ...fields, [key]: value };
    setFields(updated);
    updateQuery(updated);
  };

  const applyTemplate = useCallback((tpl: string) => {
    const parsed = parseTemplateIntoFields(tpl);
    setFields(parsed);
    const q = buildQuery(parsed);
    setQueryString(q);
    if (q) setSearchParams({ q }, { replace: true });
  }, [setSearchParams]);

  const clearAll = () => {
    setFields(DEFAULT_FIELDS);
    setQueryString('');
    setSelectedGHDB(null);
    setSelectedRSA(null);
    setSearchParams({}, { replace: true });
  };

  const copyQuery = async () => {
    if (!queryString) return;
    await navigator.clipboard.writeText(queryString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyLink = async () => {
    if (!queryString) return;
    const url = `${window.location.origin}/dorks?q=${encodeURIComponent(queryString)}`;
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    toast.success('Shareable link copied!');
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const launchEngine = (engine: typeof ENGINES[number]) => {
    if (!queryString) return;
    addEntry({ query: queryString, type: 'dork' });
    window.open(engine.url(queryString), '_blank', 'noopener,noreferrer');
  };

  const savePreset = () => {
    if (!presetName.trim() || !queryString) return;
    const p: SavedDork = { id: `dork-${Date.now()}`, name: presetName.trim(), query: queryString, savedAt: new Date().toISOString() };
    setPresets(prev => [p, ...prev]);
    setPresetName('');
    toast.success('Preset saved!');
  };

  const fetchAI = async () => {
    if (!aiTarget.trim()) { toast.error('Enter a target description first'); return; }
    if (!settings.perplexityApiKey) { toast.error('Add Perplexity API key in Settings'); return; }
    setAiLoading(true); setAiSuggestions([]);
    try {
      const prompt = `Generate exactly 5 Google dork queries for OSINT recon targeting: "${aiTarget}". Return ONLY raw dork strings, one per line, no explanations or numbering.`;
      const { content } = await perplexitySearch(prompt, settings.perplexityApiKey);
      const lines = content.split('\n').map(l => l.trim().replace(/^\d+\.\s*/, '').replace(/^[-*]\s*/, '')).filter(l => l.length > 3 && !l.startsWith('#'));
      setAiSuggestions(lines.slice(0, 8));
    } catch { toast.error('AI request failed — check your API key.'); }
    finally { setAiLoading(false); }
  };

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <FileSearch size={24} className="text-red-400" />
        <div>
          <h2 className="section-title">Google Dork Builder</h2>
          <p className="text-sm text-gray-400">GHDB-powered recon query builder — 14 exploit categories + Recon-SA templates</p>
        </div>
      </div>

      {/* Validation warnings */}
      {warnings.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {warnings.map((w, i) => (
            <span key={i} className="flex items-center gap-1 px-2 py-1 bg-yellow-900/30 border border-yellow-700/40 text-yellow-400 text-xs rounded-full">
              <AlertTriangle size={11} />{w}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* ── A. Operator Builder ─────────────────────────────────── */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Search size={16} className="text-red-400" />
              <span>Operator Builder</span>
            </div>
            <button onClick={clearAll} className="text-xs text-gray-500 hover:text-gray-300">Clear</button>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="text-xs text-gray-400 mb-1 block">site:</label><input className="input-field w-full" placeholder="example.com" value={fields.site} onChange={e => handleField('site', e.target.value)} /></div>
            <div><label className="text-xs text-gray-400 mb-1 block">inurl:</label><input className="input-field w-full" placeholder="admin" value={fields.inurl} onChange={e => handleField('inurl', e.target.value)} /></div>
            <div><label className="text-xs text-gray-400 mb-1 block">intitle:</label><input className="input-field w-full" placeholder="login" value={fields.intitle} onChange={e => handleField('intitle', e.target.value)} /></div>
            <div><label className="text-xs text-gray-400 mb-1 block">intext:</label><input className="input-field w-full" placeholder="password" value={fields.intext} onChange={e => handleField('intext', e.target.value)} /></div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">filetype:</label>
              <select className="input-field w-full" value={fields.filetype} onChange={e => handleField('filetype', e.target.value)}>
                {FILETYPES.map(ft => <option key={ft} value={ft}>{ft || '— any —'}</option>)}
              </select>
            </div>
            <div><label className="text-xs text-gray-400 mb-1 block">inanchor:</label><input className="input-field w-full" placeholder="click here" value={fields.inanchor} onChange={e => handleField('inanchor', e.target.value)} /></div>
            <div><label className="text-xs text-gray-400 mb-1 block">Exact phrase ("..."):</label><input className="input-field w-full" placeholder="john doe" value={fields.phrase} onChange={e => handleField('phrase', e.target.value)} /></div>
            <div><label className="text-xs text-gray-400 mb-1 block">NOT terms (comma-sep):</label><input className="input-field w-full" placeholder="login, signup" value={fields.notTerms} onChange={e => handleField('notTerms', e.target.value)} /></div>
            <div><label className="text-xs text-gray-400 mb-1 block">before:</label><input type="date" className="input-field w-full" value={fields.before} onChange={e => handleField('before', e.target.value)} /></div>
            <div><label className="text-xs text-gray-400 mb-1 block">after:</label><input type="date" className="input-field w-full" value={fields.after} onChange={e => handleField('after', e.target.value)} /></div>
            <div className="sm:col-span-2"><label className="text-xs text-gray-400 mb-1 block">Free-form / OR chains:</label><input className="input-field w-full" placeholder='filetype:pdf OR filetype:doc "confidential"' value={fields.freeform} onChange={e => handleField('freeform', e.target.value)} /></div>

            {/* Extended operators */}
            <div className="sm:col-span-2">
              <button onClick={() => setShowExtended(v => !v)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors">
                {showExtended ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                Extended: allintext / allinurl / allintitle / cache / related / ext / numrange
              </button>
            </div>
            {showExtended && <>
              <div><label className="text-xs text-gray-400 mb-1 block">allintext:</label><input className="input-field w-full" placeholder="all these words in body" value={fields.allintext} onChange={e => handleField('allintext', e.target.value)} /></div>
              <div><label className="text-xs text-gray-400 mb-1 block">allinurl:</label><input className="input-field w-full" placeholder="all in URL" value={fields.allinurl} onChange={e => handleField('allinurl', e.target.value)} /></div>
              <div><label className="text-xs text-gray-400 mb-1 block">allintitle:</label><input className="input-field w-full" placeholder="all in title" value={fields.allintitle} onChange={e => handleField('allintitle', e.target.value)} /></div>
              <div><label className="text-xs text-gray-400 mb-1 block">ext: (filetype alias)</label><input className="input-field w-full" placeholder="php" value={fields.ext} onChange={e => handleField('ext', e.target.value)} /></div>
              <div><label className="text-xs text-gray-400 mb-1 block">cache:</label><input className="input-field w-full" placeholder="example.com" value={fields.cache} onChange={e => handleField('cache', e.target.value)} /></div>
              <div><label className="text-xs text-gray-400 mb-1 block">related:</label><input className="input-field w-full" placeholder="nytimes.com" value={fields.related} onChange={e => handleField('related', e.target.value)} /></div>
              <div><label className="text-xs text-gray-400 mb-1 block">Numrange low</label><input type="number" className="input-field w-full" placeholder="100" value={fields.numrangeLo} onChange={e => handleField('numrangeLo', e.target.value)} /></div>
              <div><label className="text-xs text-gray-400 mb-1 block">Numrange high</label><input type="number" className="input-field w-full" placeholder="9999" value={fields.numrangeHi} onChange={e => handleField('numrangeHi', e.target.value)} /></div>
            </>}
          </div>
        </div>

        {/* ── Right column ────────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Cheatsheet */}
          <div className="card">
            <div className="card-header">
              <button className="flex items-center justify-between w-full" onClick={() => setShowCheatsheet(v => !v)}>
                <div className="flex items-center gap-2"><BookOpen size={16} className="text-blue-400" /><span>Quick Reference Cheatsheet</span></div>
                {showCheatsheet ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>
            {showCheatsheet ? (
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {CHEATSHEET.map(row => (
                  <div key={row.op} className="bg-gray-800/50 rounded p-2 text-xs">
                    <div className="flex items-center gap-2 mb-0.5">
                      <code className="text-red-400 font-mono font-semibold">{row.op}</code>
                      <span className="text-gray-400">{row.desc}</span>
                    </div>
                    <div className="text-gray-500 font-mono">{row.ex}</div>
                  </div>
                ))}
              </div>
            ) : <div className="p-4 text-xs text-gray-500">Click to expand operator reference.</div>}
          </div>

          {/* AI Suggestions */}
          <div className="card">
            <div className="card-header">
              <button className="flex items-center justify-between w-full" onClick={() => setShowAI(v => !v)}>
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-violet-400" />
                  <span>AI Dork Suggestions</span>
                  {!settings.perplexityApiKey && <span className="text-xs text-gray-600">(API key required)</span>}
                </div>
                {showAI ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>
            {showAI && (
              <div className="p-4 space-y-3">
                <div className="flex gap-2">
                  <input className="input-field flex-1" placeholder="e.g. exposed API keys on GitHub" value={aiTarget} onChange={e => setAiTarget(e.target.value)} onKeyDown={e => e.key === 'Enter' && fetchAI()} />
                  <button onClick={fetchAI} disabled={aiLoading} className="btn-primary text-xs px-3 flex items-center gap-1"><Sparkles size={12} />{aiLoading ? 'Thinking…' : 'Suggest'}</button>
                </div>
                {aiSuggestions.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-gray-500">Click to apply:</p>
                    {aiSuggestions.map((s, i) => (
                      <button key={i} onClick={() => applyTemplate(s)} className="w-full text-left px-3 py-1.5 rounded text-xs font-mono bg-violet-900/20 text-violet-300 hover:bg-violet-900/40 transition-colors">{s}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Saved Presets */}
          <div className="card">
            <div className="card-header">
              <button className="flex items-center justify-between w-full" onClick={() => setShowPresets(v => !v)}>
                <div className="flex items-center gap-2"><Star size={16} className="text-yellow-400" /><span>Saved Presets</span><span className="text-xs text-gray-600">({presets.length})</span></div>
                {showPresets ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>
            {showPresets && (
              <div className="p-4 space-y-3">
                <div className="flex gap-2">
                  <input className="input-field flex-1" placeholder="Preset name…" value={presetName} onChange={e => setPresetName(e.target.value)} onKeyDown={e => e.key === 'Enter' && savePreset()} />
                  <button onClick={savePreset} disabled={!presetName.trim() || !queryString} className="btn-secondary text-xs px-3 flex items-center gap-1"><Plus size={12} />Save</button>
                </div>
                <ExportBar data={presets as unknown as Record<string, unknown>[]} filename="dork-presets" label="Presets" onImport={d => setPresets(d as unknown as SavedDork[])} />
                {presets.length === 0
                  ? <p className="text-xs text-gray-600 text-center py-2">No presets saved yet.</p>
                  : <div className="space-y-1 max-h-48 overflow-y-auto">
                      {presets.map(p => (
                        <div key={p.id} className="flex items-center gap-2 group px-2 py-1.5 rounded hover:bg-gray-800">
                          <button onClick={() => applyTemplate(p.query)} className="flex-1 text-left min-w-0">
                            <div className="text-xs font-medium text-gray-300">{p.name}</div>
                            <div className="text-xs font-mono text-gray-500 truncate">{p.query}</div>
                          </button>
                          <button onClick={() => setPresets(prev => prev.filter(x => x.id !== p.id))} className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"><Trash2 size={12} /></button>
                        </div>
                      ))}
                    </div>
                }
              </div>
            )}
          </div>

          {/* External Tools */}
          <div className="card">
            <div className="card-header"><Zap size={16} className="text-yellow-400" /><span>External Tools</span></div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {EXTERNAL_TOOLS.map(tool => (
                <a key={tool.name} href={tool.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 p-2 bg-gray-800/40 rounded hover:bg-gray-700/40 transition-colors group">
                  <ExternalLink size={12} className="text-gray-500 group-hover:text-blue-400 mt-0.5 shrink-0" />
                  <div><div className="text-xs font-medium text-gray-300 group-hover:text-blue-400">{tool.name}</div><div className="text-xs text-gray-500">{tool.desc}</div></div>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── B. Category Templates ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="card">
          <div className="card-header flex items-center gap-2"><span className="badge badge-red text-xs">GHDB</span><span>Exploit-DB — 14 Categories</span></div>
          <div className="p-4 space-y-3 max-h-[520px] overflow-y-auto">
            {GHDB_CATEGORIES.map((cat, ci) => (
              <div key={ci}>
                <button className={`w-full flex items-center justify-between px-3 py-2 rounded text-xs font-semibold transition-colors ${selectedGHDB === ci ? 'bg-red-900/30 text-red-300' : 'bg-gray-800/50 text-gray-300 hover:bg-gray-700/50'}`} onClick={() => setSelectedGHDB(selectedGHDB === ci ? null : ci)}>
                  <span className="flex items-center gap-2"><span className={`badge ${cat.badge} text-xs`}>{ci + 1}</span>{cat.name}</span>
                  {selectedGHDB === ci ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                {selectedGHDB === ci && (
                  <div className="mt-1 space-y-1 pl-3">
                    {cat.templates.map((tpl, ti) => (
                      <button key={ti} onClick={() => { applyTemplate(tpl); setSelectedRSA(null); }} className="w-full text-left px-3 py-1.5 rounded text-xs font-mono bg-gray-900/60 text-gray-300 hover:bg-red-900/20 hover:text-red-300 transition-colors">{tpl}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header flex items-center gap-2"><span className="badge badge-blue text-xs">RSA</span><span>Recon-Search-Assistant — 6 Categories</span></div>
          <div className="p-4 space-y-3 max-h-[520px] overflow-y-auto">
            {RSA_CATEGORIES.map((cat, ci) => (
              <div key={ci}>
                <button className={`w-full flex items-center justify-between px-3 py-2 rounded text-xs font-semibold transition-colors ${selectedRSA === ci ? 'bg-blue-900/30 text-blue-300' : 'bg-gray-800/50 text-gray-300 hover:bg-gray-700/50'}`} onClick={() => setSelectedRSA(selectedRSA === ci ? null : ci)}>
                  <span className="flex items-center gap-2"><span className={`badge ${cat.badge} text-xs`}>{ci + 1}</span>{cat.name}</span>
                  {selectedRSA === ci ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                {selectedRSA === ci && (
                  <div className="mt-1 space-y-1 pl-3">
                    {cat.templates.map((tpl, ti) => (
                      <button key={ti} onClick={() => { applyTemplate(tpl); setSelectedGHDB(null); }} className="w-full text-left px-3 py-1.5 rounded text-xs font-mono bg-gray-900/60 text-gray-300 hover:bg-blue-900/20 hover:text-blue-300 transition-colors">{tpl}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Search History ────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-header">
          <button className="flex items-center justify-between w-full" onClick={() => setShowHistory(v => !v)}>
            <div className="flex items-center gap-2"><Clock size={16} className="text-gray-400" /><span>Dork Search History</span></div>
            {showHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
        {showHistory && <div className="p-3"><SearchHistory typeFilter="dork" onSelect={applyTemplate} compact /></div>}
      </div>

      {/* ── Sticky bottom bar ─────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 lg:left-64 right-0 z-30 bg-[#111827] border-t border-gray-700 shadow-2xl px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-500 mb-1 flex items-center gap-2">
              <Search size={11} />Query Preview
              <span className="text-gray-600">{queryString.length} chars</span>
              {warnings.length > 0 && <span className="text-yellow-500 flex items-center gap-1"><AlertTriangle size={10} />{warnings.length} warning{warnings.length > 1 ? 's' : ''}</span>}
            </div>
            <div className="font-mono text-xs text-green-300 bg-gray-900/80 px-3 py-2 rounded border border-gray-700 truncate min-h-[2rem]">
              {queryString || <span className="text-gray-600">Start building your dork above...</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <button onClick={copyQuery} disabled={!queryString} className={`btn-secondary flex items-center gap-1 text-xs px-3 py-1.5 ${!queryString ? 'opacity-40 cursor-not-allowed' : ''}`}>
              {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}{copied ? 'Copied!' : 'Copy'}
            </button>
            <button onClick={copyLink} disabled={!queryString} title="Copy shareable link" className={`btn-secondary flex items-center gap-1 text-xs px-3 py-1.5 ${!queryString ? 'opacity-40 cursor-not-allowed' : ''}`}>
              {linkCopied ? <Check size={12} className="text-green-400" /> : <Link size={12} />}{linkCopied ? 'Linked!' : 'Share'}
            </button>
            {ENGINES.map(engine => (
              <button key={engine.name} onClick={() => launchEngine(engine)} disabled={!queryString} className={`btn-primary text-xs px-3 py-1.5 flex items-center gap-1 ${!queryString ? 'opacity-40 cursor-not-allowed' : ''}`}>
                <ExternalLink size={11} />{engine.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DorkBuilder;
