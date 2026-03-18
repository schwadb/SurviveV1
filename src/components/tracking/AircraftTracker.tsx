import React, { useState } from 'react';
import { Plane, AlertTriangle, RefreshCw, ExternalLink, Search, Filter } from 'lucide-react';
import type { Aircraft, MapFilter } from '../../types';
import { mockAircraft } from '../../data/mockData';
import MapView from '../common/MapView';

const defaultFilter: MapFilter = {
  satellites: false,
  aircraft: true,
  ships: false,
  cameras: false,
  flockCameras: false,
};

const AircraftTracker: React.FC = () => {
  const [aircraft, setAircraft] = useState<Aircraft[]>(mockAircraft);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedAc, setSelectedAc] = useState<Aircraft | null>(null);

  const handleRefresh = () => {
    setIsLoading(true);
    setTimeout(() => {
      setAircraft((prev) =>
        prev.map((ac) => ({
          ...ac,
          lat: ac.lat + (Math.random() - 0.5) * 0.5,
          lng: ac.lng + (Math.random() - 0.5) * 0.5,
          lastContact: new Date().toISOString(),
        }))
      );
      setIsLoading(false);
    }, 1200);
  };

  const filtered = aircraft.filter((ac) => {
    const matchSearch =
      ac.callsign.toLowerCase().includes(search.toLowerCase()) ||
      (ac.airline?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
      (ac.registration?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
      (ac.type?.toLowerCase().includes(search.toLowerCase()) ?? false);
    const matchStatus = statusFilter === 'all' || ac.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const emergencyCount = aircraft.filter((ac) => ac.emergency).length;

  return (
    <div className="space-y-4">
      {/* Emergency Banner */}
      {emergencyCount > 0 && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl p-3 flex items-center gap-3">
          <AlertTriangle size={20} className="text-red-400 flex-shrink-0 live-indicator" />
          <div>
            <p className="text-red-300 font-semibold text-sm">
              {emergencyCount} aircraft declaring emergency!
            </p>
            <p className="text-red-400/70 text-xs">Squawk 7700 detected</p>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search callsign, airline, registration, type..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-9"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input-field sm:w-36"
          >
            <option value="all">All Status</option>
            <option value="airborne">Airborne</option>
            <option value="ground">Ground</option>
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
          { label: 'Total Tracked', value: aircraft.length, color: 'text-blue-400' },
          {
            label: 'Airborne',
            value: aircraft.filter((a) => a.status === 'airborne').length,
            color: 'text-green-400',
          },
          {
            label: 'On Ground',
            value: aircraft.filter((a) => a.status === 'ground').length,
            color: 'text-yellow-400',
          },
          { label: 'Emergency', value: emergencyCount, color: 'text-red-400' },
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
          <Plane size={18} className="text-blue-400" />
          <h3 className="section-title">Live Aircraft Positions</h3>
          <span className="badge badge-blue ml-auto">{filtered.length} aircraft</span>
        </div>
        <MapView aircraft={filtered} filter={defaultFilter} height="380px" />

        <div className="mt-3 flex flex-wrap gap-2">
          {[
            { label: 'ADS-B Exchange', url: 'https://www.adsbexchange.com' },
            { label: 'FlightAware', url: 'https://flightaware.com' },
            { label: 'FlightRadar24', url: 'https://www.flightradar24.com' },
            { label: 'OpenSky', url: 'https://opensky-network.org' },
            { label: 'LiveATC', url: 'https://www.liveatc.net' },
            { label: 'Planefinder', url: 'https://planefinder.net' },
          ].map((r) => (
            <a
              key={r.label}
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 bg-blue-900/20 px-2.5 py-1.5 rounded-full border border-blue-800/40 transition-colors"
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
          <h3 className="section-title">Aircraft List</h3>
        </div>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="data-table">
            <thead>
              <tr>
                <th>Callsign</th>
                <th>Type</th>
                <th>Airline</th>
                <th>Route</th>
                <th>Alt (ft)</th>
                <th>Speed (kts)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ac) => (
                <tr
                  key={ac.icao}
                  onClick={() => setSelectedAc(ac === selectedAc ? null : ac)}
                  className="cursor-pointer"
                >
                  <td>
                    <div className="flex items-center gap-2">
                      <Plane size={13} className="text-blue-400" />
                      <span className="font-medium text-gray-200">{ac.callsign}</span>
                      {ac.emergency && (
                        <AlertTriangle size={13} className="text-red-400 live-indicator" />
                      )}
                    </div>
                  </td>
                  <td className="text-gray-400">{ac.type || '—'}</td>
                  <td className="text-gray-400 max-w-[120px] truncate">{ac.airline || '—'}</td>
                  <td className="font-mono text-xs text-gray-400">
                    {ac.origin && ac.destination ? `${ac.origin}→${ac.destination}` : '—'}
                  </td>
                  <td className="font-mono text-xs text-gray-400">
                    {ac.altitude.toLocaleString()}
                  </td>
                  <td className="font-mono text-xs text-gray-400">{ac.speed}</td>
                  <td>
                    <span
                      className={`badge ${
                        ac.emergency
                          ? 'badge-red'
                          : ac.status === 'airborne'
                          ? 'badge-green'
                          : 'badge-yellow'
                      }`}
                    >
                      {ac.emergency ? '🚨 EMERGENCY' : ac.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-8 text-gray-600">
              <Plane size={32} className="mx-auto mb-2" />
              <p>No aircraft match your search</p>
            </div>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selectedAc && (
        <div className="card glow-border">
          <div className="card-header">
            <Plane size={16} className="text-blue-400" />
            <h3 className="text-blue-400 font-semibold">{selectedAc.callsign}</h3>
            {selectedAc.emergency && (
              <span className="badge badge-red ml-2">EMERGENCY</span>
            )}
            <button
              onClick={() => setSelectedAc(null)}
              className="ml-auto text-gray-600 hover:text-gray-400 text-sm"
            >
              Close
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'ICAO', value: selectedAc.icao },
              { label: 'Registration', value: selectedAc.registration || '—' },
              { label: 'Aircraft Type', value: selectedAc.type || '—' },
              { label: 'Airline', value: selectedAc.airline || '—' },
              { label: 'Latitude', value: `${selectedAc.lat.toFixed(4)}°` },
              { label: 'Longitude', value: `${selectedAc.lng.toFixed(4)}°` },
              { label: 'Altitude', value: `${selectedAc.altitude.toLocaleString()} ft` },
              { label: 'Speed', value: `${selectedAc.speed} kts` },
              { label: 'Heading', value: `${selectedAc.heading}°` },
              { label: 'Vertical Rate', value: `${selectedAc.verticalRate} fpm` },
              { label: 'Origin', value: selectedAc.origin || '—' },
              { label: 'Destination', value: selectedAc.destination || '—' },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-900/50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">{label}</p>
                <p className="text-sm text-gray-200 font-medium">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={`https://www.flightradar24.com/${selectedAc.callsign}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary text-sm"
            >
              <ExternalLink size={14} />
              FlightRadar24
            </a>
            <a
              href={`https://flightaware.com/live/flight/${selectedAc.callsign}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-sm"
            >
              <ExternalLink size={14} />
              FlightAware
            </a>
            <a
              href={`https://www.adsbexchange.com/?icao=${selectedAc.icao}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-sm"
            >
              <ExternalLink size={14} />
              ADS-B Exchange
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default AircraftTracker;
