import React, { useState } from 'react';
import { Radio, Play, Search, ExternalLink, Filter, Plus, Headphones, Signal } from 'lucide-react';
import type { Scanner } from '../../types';
import { mockScanners } from '../../data/mockData';

const SCANNER_SOURCES = [
  { name: 'Broadcastify', url: 'https://www.broadcastify.com/listen/', description: 'Largest scanner feed network', featured: true },
  { name: 'RadioReference', url: 'https://www.radioreference.com/', description: 'Frequency database & scanners', featured: true },
  { name: 'OpenMHz', url: 'https://openmhz.com/', description: 'P25 trunked radio recordings', featured: true },
  { name: 'LiveATC', url: 'https://www.liveatc.net/', description: 'Aviation ATC worldwide', featured: true },
  { name: 'Scanner Radio', url: 'https://scannerradio.app/', description: 'Mobile scanner app', featured: false },
  { name: 'NOAA Weather Radio', url: 'https://www.weather.gov/nwr/', description: 'Weather alerts & forecasts', featured: false },
  { name: 'WebSDR', url: 'http://websdr.org/', description: 'Remote SDR receivers worldwide', featured: false },
  { name: 'GlobalTuners', url: 'https://www.globaltuners.com/', description: 'Remote receiver network', featured: false },
  { name: 'KiwiSDR', url: 'http://kiwisdr.com/public/', description: 'HF receiver network', featured: false },
  { name: 'SDR.hu', url: 'https://sdr.hu/', description: 'List of online SDR receivers', featured: false },
];

const scannerTypeColors: Record<string, string> = {
  police: 'text-blue-400 bg-blue-900/20',
  fire: 'text-red-400 bg-red-900/20',
  ems: 'text-green-400 bg-green-900/20',
  airport: 'text-indigo-400 bg-indigo-900/20',
  military: 'text-yellow-400 bg-yellow-900/20',
  weather: 'text-cyan-400 bg-cyan-900/20',
  ham: 'text-purple-400 bg-purple-900/20',
  other: 'text-gray-400 bg-gray-900/20',
};

const ScannerAccess: React.FC = () => {
  const [scanners, setScanners] = useState<Scanner[]>(mockScanners);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newScanner, setNewScanner] = useState({
    name: '', type: 'police', streamUrl: '', location: '', state: '', frequency: '', tags: '',
  });

  const scannerTypes = ['all', 'police', 'fire', 'ems', 'airport', 'military', 'weather', 'ham', 'other'];

  const filtered = scanners.filter((s) => {
    const matchSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.location.toLowerCase().includes(search.toLowerCase()) ||
      s.state.toLowerCase().includes(search.toLowerCase()) ||
      s.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()));
    const matchType = typeFilter === 'all' || s.type === typeFilter;
    return matchSearch && matchType;
  });

  const handleAdd = () => {
    if (!newScanner.name || !newScanner.streamUrl) return;
    const scanner: Scanner = {
      id: `scan-${Date.now()}`,
      name: newScanner.name,
      type: newScanner.type as Scanner['type'],
      frequency: newScanner.frequency,
      streamUrl: newScanner.streamUrl,
      location: newScanner.location,
      state: newScanner.state,
      country: 'USA',
      status: 'unknown',
      tags: newScanner.tags.split(',').map((t) => t.trim()).filter(Boolean),
    };
    setScanners((prev) => [...prev, scanner]);
    setNewScanner({ name: '', type: 'police', streamUrl: '', location: '', state: '', frequency: '', tags: '' });
    setShowAddForm(false);
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search scanners..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-9"
            />
          </div>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="input-field sm:w-36">
            {scannerTypes.map((t) => (
              <option key={t} value={t}>{t === 'all' ? 'All Types' : t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
          <button onClick={() => setShowAddForm(!showAddForm)} className="btn-primary">
            <Plus size={15} />
            Add Scanner
          </button>
        </div>

        {showAddForm && (
          <div className="mt-4 pt-4 border-t border-gray-800 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input className="input-field" placeholder="Scanner name *" value={newScanner.name}
              onChange={(e) => setNewScanner((p) => ({ ...p, name: e.target.value }))} />
            <select className="input-field" value={newScanner.type}
              onChange={(e) => setNewScanner((p) => ({ ...p, type: e.target.value }))}>
              {scannerTypes.filter((t) => t !== 'all').map((t) => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
            <input className="input-field" placeholder="Stream URL *" value={newScanner.streamUrl}
              onChange={(e) => setNewScanner((p) => ({ ...p, streamUrl: e.target.value }))} />
            <input className="input-field" placeholder="Location" value={newScanner.location}
              onChange={(e) => setNewScanner((p) => ({ ...p, location: e.target.value }))} />
            <input className="input-field" placeholder="State" value={newScanner.state}
              onChange={(e) => setNewScanner((p) => ({ ...p, state: e.target.value }))} />
            <input className="input-field" placeholder="Frequency (optional)" value={newScanner.frequency}
              onChange={(e) => setNewScanner((p) => ({ ...p, frequency: e.target.value }))} />
            <input className="input-field sm:col-span-2" placeholder="Tags (comma separated)" value={newScanner.tags}
              onChange={(e) => setNewScanner((p) => ({ ...p, tags: e.target.value }))} />
            <div className="flex gap-2">
              <button onClick={handleAdd} className="btn-primary flex-1">Add</button>
              <button onClick={() => setShowAddForm(false)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Scanners', value: scanners.length, color: 'text-green-400' },
          { label: 'Live', value: scanners.filter((s) => s.status === 'live').length, color: 'text-blue-400' },
          { label: 'Total Listeners', value: scanners.reduce((a, s) => a + (s.listeners || 0), 0).toLocaleString(), color: 'text-purple-400' },
          { label: 'States', value: new Set(scanners.map((s) => s.state)).size, color: 'text-yellow-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-500 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Scanner cards */}
      <div className="card">
        <div className="card-header">
          <Filter size={16} className="text-gray-400" />
          <h3 className="section-title">Scanner Feeds</h3>
          <span className="badge badge-green ml-auto">{filtered.length} feeds</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map((scanner) => (
            <div
              key={scanner.id}
              className="bg-gray-900 rounded-lg border border-gray-800 hover:border-green-700/40 transition-all p-4"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <Radio size={16} className="text-green-400" />
                  <h4 className="text-sm font-semibold text-gray-200 line-clamp-1">{scanner.name}</h4>
                </div>
                <span className={`badge text-xs ${scanner.status === 'live' ? 'badge-green' : 'badge-red'}`}>
                  <span className={`status-dot mr-1 ${scanner.status === 'live' ? 'bg-green-500 live-indicator' : 'bg-red-500'}`} />
                  {scanner.status}
                </span>
              </div>

              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${scannerTypeColors[scanner.type] || scannerTypeColors.other}`}>
                  {scanner.type.toUpperCase()}
                </span>
                {scanner.frequency && (
                  <div className="flex items-center gap-1 text-xs text-gray-500">
                    <Signal size={11} />
                    {scanner.frequency}
                  </div>
                )}
              </div>

              <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                📍 {scanner.location}
                {scanner.state && `, ${scanner.state}`}
              </p>

              {scanner.listeners !== undefined && (
                <p className="text-xs text-gray-600 mb-3 flex items-center gap-1">
                  <Headphones size={11} />
                  {scanner.listeners.toLocaleString()} listeners
                </p>
              )}

              <div className="flex flex-wrap gap-1 mb-3">
                {scanner.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="text-xs bg-gray-800 text-gray-500 px-2 py-0.5 rounded-full">
                    {tag}
                  </span>
                ))}
              </div>

              <a
                href={scanner.streamUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full btn-primary text-sm justify-center"
              >
                <Play size={13} />
                Listen Live
              </a>
            </div>
          ))}
        </div>
      </div>

      {/* External sources */}
      <div className="card">
        <div className="card-header">
          <ExternalLink size={16} className="text-gray-400" />
          <h3 className="section-title">Scanner Network Sources</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SCANNER_SOURCES.map((s) => (
            <a
              key={s.name}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-3 p-3 rounded-lg border transition-all group ${
                s.featured
                  ? 'bg-green-900/10 border-green-800/30 hover:border-green-600/50'
                  : 'bg-gray-900 border-gray-800 hover:border-gray-600'
              }`}
            >
              <Radio size={16} className={s.featured ? 'text-green-400' : 'text-gray-500'} />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-200 group-hover:text-green-300 transition-colors">{s.name}</p>
                  {s.featured && <span className="badge badge-green text-xs">Featured</span>}
                </div>
                <p className="text-xs text-gray-500">{s.description}</p>
              </div>
              <ExternalLink size={12} className="text-gray-600 group-hover:text-green-400" />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ScannerAccess;
