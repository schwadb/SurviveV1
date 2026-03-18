import React, { useState } from 'react';
import { Satellite, RefreshCw, ExternalLink, Filter, Search, ChevronUp, ChevronDown } from 'lucide-react';
import type { Satellite as SatelliteType, MapFilter } from '../../types';
import { mockSatellites } from '../../data/mockData';
import MapView from '../common/MapView';

const defaultFilter: MapFilter = {
  satellites: true,
  aircraft: false,
  ships: false,
  cameras: false,
  flockCameras: false,
};

const SatelliteTracker: React.FC = () => {
  const [satellites, setSatellites] = useState<SatelliteType[]>(mockSatellites);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<keyof SatelliteType>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedSat, setSelectedSat] = useState<SatelliteType | null>(null);

  const handleRefresh = () => {
    setIsLoading(true);
    // Simulate refresh with slight position changes
    setTimeout(() => {
      setSatellites((prev) =>
        prev.map((s) => ({
          ...s,
          lat: s.lat + (Math.random() - 0.5) * 2,
          lng: (s.lng + s.velocity / 100000) % 180,
          lastUpdated: new Date().toISOString(),
        }))
      );
      setIsLoading(false);
    }, 1200);
  };

  const handleSort = (field: keyof SatelliteType) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const filtered = satellites
    .filter((s) => {
      const matchSearch =
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.noradId.toString().includes(search) ||
        s.owner.toLowerCase().includes(search.toLowerCase());
      const matchType = typeFilter === 'all' || s.type === typeFilter;
      return matchSearch && matchType;
    })
    .sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      return 0;
    });

  const SortIcon = ({ field }: { field: keyof SatelliteType }) => {
    if (sortField !== field) return <ChevronUp size={12} className="text-gray-600" />;
    return sortDir === 'asc' ? (
      <ChevronUp size={12} className="text-indigo-400" />
    ) : (
      <ChevronDown size={12} className="text-indigo-400" />
    );
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
              placeholder="Search by name, NORAD ID, owner..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-9"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="input-field sm:w-40"
          >
            <option value="all">All Types</option>
            <option value="LEO">LEO</option>
            <option value="MEO">MEO</option>
            <option value="GEO">GEO</option>
            <option value="HEO">HEO</option>
          </select>
          <button onClick={handleRefresh} disabled={isLoading} className="btn-secondary">
            <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Map */}
      <div className="card">
        <div className="card-header">
          <Satellite size={18} className="text-indigo-400" />
          <h3 className="section-title">Live Satellite Positions</h3>
          <span className="badge badge-blue ml-auto">{filtered.length} tracked</span>
        </div>
        <MapView satellites={filtered} filter={defaultFilter} height="380px" />

        {/* External resources */}
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            { label: 'CelesTrak', url: 'https://celestrak.org' },
            { label: 'N2YO', url: 'https://www.n2yo.com' },
            { label: 'Heavens Above', url: 'https://www.heavens-above.com' },
            { label: 'Space-Track', url: 'https://www.space-track.org' },
            { label: 'Orbit Visualizer', url: 'https://platform.leolabs.space/visualization' },
          ].map((r) => (
            <a
              key={r.label}
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 bg-indigo-900/20 px-2.5 py-1.5 rounded-full border border-indigo-800/40 transition-colors"
            >
              <ExternalLink size={11} />
              {r.label}
            </a>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="card-header">
          <Filter size={16} className="text-gray-400" />
          <h3 className="section-title">Satellite Database</h3>
        </div>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="data-table">
            <thead>
              <tr>
                {[
                  { key: 'name', label: 'Name' },
                  { key: 'noradId', label: 'NORAD' },
                  { key: 'type', label: 'Orbit' },
                  { key: 'owner', label: 'Owner' },
                  { key: 'altitude', label: 'Alt (km)' },
                  { key: 'velocity', label: 'Vel (km/h)' },
                  { key: 'status', label: 'Status' },
                ].map(({ key, label }) => (
                  <th
                    key={key}
                    onClick={() => handleSort(key as keyof SatelliteType)}
                    className="cursor-pointer select-none hover:text-gray-300"
                  >
                    <div className="flex items-center gap-1">
                      {label}
                      <SortIcon field={key as keyof SatelliteType} />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((sat) => (
                <tr
                  key={sat.id}
                  onClick={() => setSelectedSat(sat === selectedSat ? null : sat)}
                  className="cursor-pointer"
                >
                  <td>
                    <div className="flex items-center gap-2">
                      <Satellite size={13} className="text-indigo-400 flex-shrink-0" />
                      <span className="font-medium text-gray-200">{sat.name}</span>
                    </div>
                  </td>
                  <td className="font-mono text-xs text-gray-400">{sat.noradId}</td>
                  <td>
                    <span
                      className={`badge ${
                        sat.type === 'LEO'
                          ? 'badge-blue'
                          : sat.type === 'GEO'
                          ? 'badge-green'
                          : sat.type === 'MEO'
                          ? 'badge-yellow'
                          : 'badge-purple'
                      }`}
                    >
                      {sat.type}
                    </span>
                  </td>
                  <td className="text-gray-400">{sat.owner}</td>
                  <td className="text-gray-400 font-mono text-xs">
                    {sat.altitude.toLocaleString()}
                  </td>
                  <td className="text-gray-400 font-mono text-xs">
                    {sat.velocity.toLocaleString()}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        sat.status === 'active'
                          ? 'badge-green'
                          : sat.status === 'inactive'
                          ? 'badge-red'
                          : 'badge-yellow'
                      }`}
                    >
                      <span
                        className={`status-dot mr-1 ${
                          sat.status === 'active' ? 'bg-green-500' : 'bg-gray-500'
                        } ${sat.status === 'active' ? 'live-indicator' : ''}`}
                      />
                      {sat.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-8 text-gray-600">
              <Satellite size={32} className="mx-auto mb-2" />
              <p>No satellites match your search</p>
            </div>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selectedSat && (
        <div className="card glow-border">
          <div className="card-header">
            <Satellite size={16} className="text-indigo-400" />
            <h3 className="text-indigo-400 font-semibold">{selectedSat.name}</h3>
            <button
              onClick={() => setSelectedSat(null)}
              className="ml-auto text-gray-600 hover:text-gray-400 text-sm"
            >
              Close
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'NORAD ID', value: selectedSat.noradId },
              { label: 'Orbit Type', value: selectedSat.type },
              { label: 'Owner', value: selectedSat.owner },
              { label: 'Status', value: selectedSat.status },
              { label: 'Latitude', value: `${selectedSat.lat.toFixed(4)}°` },
              { label: 'Longitude', value: `${selectedSat.lng.toFixed(4)}°` },
              { label: 'Altitude', value: `${selectedSat.altitude.toLocaleString()} km` },
              { label: 'Velocity', value: `${selectedSat.velocity.toLocaleString()} km/h` },
              { label: 'Inclination', value: `${selectedSat.inclination}°` },
              {
                label: 'Last Updated',
                value: new Date(selectedSat.lastUpdated).toLocaleTimeString(),
              },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-900/50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">{label}</p>
                <p className="text-sm text-gray-200 font-medium">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <a
              href={`https://www.n2yo.com/satellite/?s=${selectedSat.noradId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary text-sm"
            >
              <ExternalLink size={14} />
              Track on N2YO
            </a>
            <a
              href={`https://celestrak.org/satcat/record.php?CATNR=${selectedSat.noradId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-sm"
            >
              <ExternalLink size={14} />
              CelesTrak
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default SatelliteTracker;
