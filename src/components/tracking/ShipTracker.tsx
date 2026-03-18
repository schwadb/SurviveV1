import React, { useState } from 'react';
import { Ship, Anchor, RefreshCw, ExternalLink, Search } from 'lucide-react';
import type { Ship as ShipType, MapFilter } from '../../types';
import { mockShips } from '../../data/mockData';
import MapView from '../common/MapView';

const defaultFilter: MapFilter = {
  satellites: false,
  aircraft: false,
  ships: true,
  cameras: false,
  flockCameras: false,
};

const ShipTracker: React.FC = () => {
  const [ships, setShips] = useState<ShipType[]>(mockShips);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedShip, setSelectedShip] = useState<ShipType | null>(null);

  const shipTypes = ['all', ...Array.from(new Set(mockShips.map((s) => s.type)))];

  const handleRefresh = () => {
    setIsLoading(true);
    setTimeout(() => {
      setShips((prev) =>
        prev.map((s) => ({
          ...s,
          lat: s.lat + (Math.random() - 0.5) * 0.1,
          lng: s.lng + (Math.random() - 0.5) * 0.1,
          lastUpdated: new Date().toISOString(),
        }))
      );
      setIsLoading(false);
    }, 1200);
  };

  const filtered = ships.filter((s) => {
    const matchSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.mmsi.includes(search) ||
      (s.callsign?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
      (s.flag?.toLowerCase().includes(search.toLowerCase()) ?? false);
    const matchType = typeFilter === 'all' || s.type === typeFilter;
    return matchSearch && matchType;
  });

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search by name, MMSI, callsign, flag..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-9"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="input-field sm:w-48"
          >
            {shipTypes.map((t) => (
              <option key={t} value={t}>
                {t === 'all' ? 'All Types' : t}
              </option>
            ))}
          </select>
          <button onClick={handleRefresh} disabled={isLoading} className="btn-secondary">
            <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Tracked', value: ships.length, color: 'text-cyan-400' },
          {
            label: 'Underway',
            value: ships.filter((s) => s.status.includes('Under Way')).length,
            color: 'text-green-400',
          },
          {
            label: 'At Anchor',
            value: ships.filter((s) => s.status.includes('Anchor')).length,
            color: 'text-yellow-400',
          },
          { label: 'In Port', value: ships.filter((s) => s.status.includes('Moored')).length, color: 'text-blue-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-500 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Map */}
      <div className="card">
        <div className="card-header">
          <Ship size={18} className="text-cyan-400" />
          <h3 className="section-title">Live Ship Positions</h3>
          <span className="badge badge-blue ml-auto">{filtered.length} vessels</span>
        </div>
        <MapView ships={filtered} filter={defaultFilter} height="380px" center={[20, 0]} zoom={2} />

        <div className="mt-3 flex flex-wrap gap-2">
          {[
            { label: 'MarineTraffic', url: 'https://www.marinetraffic.com' },
            { label: 'VesselFinder', url: 'https://www.vesselfinder.com' },
            { label: 'FleetMon', url: 'https://www.fleetmon.com' },
            { label: 'ShipFinder', url: 'https://www.shipfinder.com' },
            { label: 'MyShipTracking', url: 'https://www.myshiptracking.com' },
          ].map((r) => (
            <a
              key={r.label}
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 bg-cyan-900/20 px-2.5 py-1.5 rounded-full border border-cyan-800/40 transition-colors"
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
          <Anchor size={16} className="text-gray-400" />
          <h3 className="section-title">Vessel List</h3>
        </div>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="data-table">
            <thead>
              <tr>
                <th>Vessel Name</th>
                <th>MMSI</th>
                <th>Type</th>
                <th>Flag</th>
                <th>Speed (kts)</th>
                <th>Destination</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ship) => (
                <tr
                  key={ship.mmsi}
                  onClick={() => setSelectedShip(ship === selectedShip ? null : ship)}
                  className="cursor-pointer"
                >
                  <td>
                    <div className="flex items-center gap-2">
                      <Ship size={13} className="text-cyan-400" />
                      <span className="font-medium text-gray-200">{ship.name}</span>
                    </div>
                  </td>
                  <td className="font-mono text-xs text-gray-400">{ship.mmsi}</td>
                  <td className="text-gray-400 max-w-[100px] truncate">{ship.type}</td>
                  <td className="text-gray-400">{ship.flag || '—'}</td>
                  <td className="font-mono text-xs text-gray-400">{ship.speed}</td>
                  <td className="text-gray-400 max-w-[100px] truncate">
                    {ship.destination || '—'}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        ship.status.includes('Under Way')
                          ? 'badge-green'
                          : ship.status.includes('Anchor')
                          ? 'badge-yellow'
                          : 'badge-blue'
                      }`}
                    >
                      {ship.status.length > 20
                        ? ship.status.substring(0, 20) + '...'
                        : ship.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail panel */}
      {selectedShip && (
        <div className="card glow-border">
          <div className="card-header">
            <Ship size={16} className="text-cyan-400" />
            <h3 className="text-cyan-400 font-semibold">{selectedShip.name}</h3>
            <button
              onClick={() => setSelectedShip(null)}
              className="ml-auto text-gray-600 hover:text-gray-400 text-sm"
            >
              Close
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'MMSI', value: selectedShip.mmsi },
              { label: 'Callsign', value: selectedShip.callsign || '—' },
              { label: 'Type', value: selectedShip.type },
              { label: 'Flag', value: selectedShip.flag || '—' },
              { label: 'Latitude', value: `${selectedShip.lat.toFixed(4)}°` },
              { label: 'Longitude', value: `${selectedShip.lng.toFixed(4)}°` },
              { label: 'Speed', value: `${selectedShip.speed} kts` },
              { label: 'Heading', value: `${selectedShip.heading}°` },
              { label: 'Destination', value: selectedShip.destination || '—' },
              { label: 'ETA', value: selectedShip.eta ? new Date(selectedShip.eta).toLocaleDateString() : '—' },
              { label: 'Length', value: selectedShip.length ? `${selectedShip.length}m` : '—' },
              { label: 'Beam', value: selectedShip.width ? `${selectedShip.width}m` : '—' },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-900/50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">{label}</p>
                <p className="text-sm text-gray-200 font-medium">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={`https://www.marinetraffic.com/en/ais/details/ships/mmsi:${selectedShip.mmsi}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary text-sm"
            >
              <ExternalLink size={14} />
              MarineTraffic
            </a>
            <a
              href={`https://www.vesselfinder.com/?mmsi=${selectedShip.mmsi}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-sm"
            >
              <ExternalLink size={14} />
              VesselFinder
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShipTracker;
