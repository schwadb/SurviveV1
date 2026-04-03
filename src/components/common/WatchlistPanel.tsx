import React, { useState } from 'react';
import { Star, Trash2, Bell, BellOff, Plus, Satellite, Plane, Ship, Camera, Radio, User } from 'lucide-react';
import { useWatchlist, type WatchlistEntry } from '../../hooks/useWatchlist';
import { ExportBar } from './ExportImport';

const TYPE_ICONS = {
  aircraft: Plane,
  satellite: Satellite,
  ship: Ship,
  camera: Camera,
  person: User,
  scanner: Radio,
};

const TYPE_COLORS = {
  aircraft: 'text-blue-400',
  satellite: 'text-indigo-400',
  ship: 'text-cyan-400',
  camera: 'text-purple-400',
  person: 'text-rose-400',
  scanner: 'text-green-400',
};

const WatchlistPanel: React.FC = () => {
  const { watchlist, addEntry, removeEntry, updateEntry, isWatched: _isWatched } = useWatchlist();
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [newEntry, setNewEntry] = useState({
    type: 'aircraft' as WatchlistEntry['type'],
    identifier: '',
    label: '',
    notes: '',
    alertOnSeen: true,
  });

  const handleAdd = () => {
    if (!newEntry.identifier || !newEntry.label) return;
    addEntry({ ...newEntry, id: `wl-${Date.now()}` });
    setNewEntry({ type: 'aircraft', identifier: '', label: '', notes: '', alertOnSeen: true });
    setShowForm(false);
  };

  const filtered = filter === 'all'
    ? watchlist
    : watchlist.filter((e) => e.type === filter);

  const types = ['all', 'aircraft', 'satellite', 'ship', 'camera', 'person', 'scanner'];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="card">
        <div className="card-header">
          <Star size={18} className="text-yellow-400" />
          <h3 className="section-title">Watchlist</h3>
          <span className="badge badge-yellow ml-auto">{watchlist.length} items</span>
        </div>

        {/* Type filter */}
        <div className="flex flex-wrap gap-2 mb-4">
          {types.map((t) => (
            <button key={t} onClick={() => setFilter(t)}
              className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors ${
                filter === t ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}>
              {t}
            </button>
          ))}
        </div>

        {/* Add form */}
        {showForm && (
          <div className="mb-4 p-4 bg-gray-900 rounded-lg border border-gray-700 space-y-3">
            <h4 className="text-sm font-medium text-gray-300">Add to Watchlist</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <select className="input-field" value={newEntry.type}
                onChange={(e) => setNewEntry((p) => ({ ...p, type: e.target.value as WatchlistEntry['type'] }))}>
                {['aircraft', 'satellite', 'ship', 'camera', 'person', 'scanner'].map((t) => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
              <input className="input-field" placeholder="Identifier (ICAO, MMSI, NORAD...)"
                value={newEntry.identifier} onChange={(e) => setNewEntry((p) => ({ ...p, identifier: e.target.value }))} />
              <input className="input-field" placeholder="Label / Name"
                value={newEntry.label} onChange={(e) => setNewEntry((p) => ({ ...p, label: e.target.value }))} />
              <input className="input-field" placeholder="Notes (optional)"
                value={newEntry.notes} onChange={(e) => setNewEntry((p) => ({ ...p, notes: e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={newEntry.alertOnSeen}
                onChange={(e) => setNewEntry((p) => ({ ...p, alertOnSeen: e.target.checked }))}
                className="w-4 h-4 rounded" />
              <span className="text-sm text-gray-400">Alert when this target appears in live data</span>
            </label>
            <div className="flex gap-2">
              <button onClick={handleAdd} className="btn-primary text-sm">
                <Plus size={14} />Add
              </button>
              <button onClick={() => setShowForm(false)} className="btn-secondary text-sm">Cancel</button>
            </div>
          </div>
        )}

        <button onClick={() => setShowForm(!showForm)} className="btn-primary text-sm mb-4">
          <Plus size={14} />
          Add to Watchlist
        </button>

        {/* List */}
        {filtered.length === 0 ? (
          <div className="text-center py-10 text-gray-600">
            <Star size={36} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No watchlist items</p>
            <p className="text-xs mt-1">Add aircraft, satellites, ships, or people to monitor</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((entry) => {
              const Icon = TYPE_ICONS[entry.type] ?? Star;
              const color = TYPE_COLORS[entry.type] ?? 'text-gray-400';
              return (
                <div key={entry.id}
                  className="flex items-center gap-3 p-3 bg-gray-900 rounded-lg border border-gray-800 hover:border-gray-600 transition-colors">
                  <Icon size={16} className={`${color} flex-shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-200">{entry.label}</p>
                      <span className={`badge text-xs ${color === 'text-blue-400' ? 'badge-blue' : 'badge-purple'}`}>
                        {entry.type}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 font-mono">{entry.identifier}</p>
                    {entry.notes && <p className="text-xs text-gray-600 mt-0.5 italic">{entry.notes}</p>}
                    <p className="text-xs text-gray-700 mt-0.5">
                      Added {new Date(entry.addedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => updateEntry(entry.id, { alertOnSeen: !entry.alertOnSeen })}
                      className={`p-1.5 rounded hover:bg-gray-800 ${entry.alertOnSeen ? 'text-yellow-400' : 'text-gray-600'}`}
                      title={entry.alertOnSeen ? 'Disable alert' : 'Enable alert'}
                    >
                      {entry.alertOnSeen ? <Bell size={14} /> : <BellOff size={14} />}
                    </button>
                    <button onClick={() => removeEntry(entry.id)}
                      className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-gray-800 rounded" title="Remove">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ExportBar
        data={watchlist as unknown as Record<string, unknown>[]}
        filename="watcherv1-watchlist"
        label="Watchlist"
        onImport={(d) => d.forEach((entry) => addEntry(entry as unknown as WatchlistEntry))}
      />
    </div>
  );
};

export default WatchlistPanel;
