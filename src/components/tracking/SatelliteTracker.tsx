import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Satellite, RefreshCw, ExternalLink, Filter, Search, ChevronUp, ChevronDown, Star, MapPin, Download } from 'lucide-react';
import type { Satellite as SatelliteType, MapFilter } from '../../types';
import { mockSatellites } from '../../data/mockData';
import { fetchLiveSatellites, toCSV } from '../../services/api';
import MapView from '../common/MapView';
import { useSettings } from '../../hooks/useLocalStorage';
import { useWatchlist } from '../../hooks/useWatchlist';
import { useGeolocation, calcSatelliteVisibility } from '../../hooks/useGeolocation';
import { computePositionFromTLE, preloadSatLib } from '../../services/orbitEngine';
import SatelliteCorrelation from './SatelliteCorrelation';
import { RenderModeToggle, RenderModeProvider } from '../common/RenderModeToggle';
import toast from 'react-hot-toast';

const defaultFilter: MapFilter = {
  satellites: true, aircraft: false, ships: false, cameras: false, flockCameras: false,
};

const SatelliteTracker: React.FC = () => {
  const [settings] = useSettings();
  const [satellites, setSatellites] = useState<SatelliteType[]>(mockSatellites);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<keyof SatelliteType>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [isLoading, setIsLoading] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [selectedSat, setSelectedSat] = useState<SatelliteType | null>(null);
  const [showPassCalc, setShowPassCalc] = useState(false);
  const [correlationLat, setCorrelationLat] = useState<number | null>(null);
  const [correlationLng, setCorrelationLng] = useState<number | null>(null);
  const { addEntry, isWatched, removeEntry, watchlist } = useWatchlist();
  const { lat: userLat, lng: userLng, locate } = useGeolocation();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      if (settings.enableLiveSatellites) {
        const data = await fetchLiveSatellites('active');
        // Apply real TLE position calculations where TLE data available
        const updated = data.map(sat => {
          const s = sat as SatelliteType & { tleLine1?: string; tleLine2?: string };
          if (s.tleLine1 && s.tleLine2) {
            const pos = computePositionFromTLE(s.tleLine1, s.tleLine2);
            if (pos) return { ...sat, lat: pos.lat, lng: pos.lng, altitude: pos.altitudeKm, velocity: pos.velocity };
          }
          return sat;
        });
        setSatellites(updated);
        setIsLive(true);
        toast.success(`Loaded ${updated.length} satellites from CelesTrak`, { id: 'sat-update', duration: 2000 });
      } else {
        // Simulate orbital motion using TLE math when live is off
        setSatellites(prev => prev.map(s => {
          const sat = s as SatelliteType & { tleLine1?: string; tleLine2?: string };
          if (sat.tleLine1 && sat.tleLine2) {
            const pos = computePositionFromTLE(sat.tleLine1, sat.tleLine2);
            if (pos) return { ...s, lat: pos.lat, lng: pos.lng, altitude: pos.altitudeKm };
          }
          // Fallback random drift for demo
          return { ...s, lat: s.lat + (Math.random() - 0.5) * 2, lng: ((s.lng + s.velocity / 100000) % 180), lastUpdated: new Date().toISOString() };
        }));
      }
    } catch (err: unknown) {
      toast.error(`Satellite data error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setIsLoading(false);
    }
  }, [settings.enableLiveSatellites]);

  useEffect(() => {
    // Preload satellite.js library so sync computePositionFromTLE calls work
    preloadSatLib().then(fetchData);
    intervalRef.current = setInterval(fetchData, settings.refreshInterval * 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [settings.refreshInterval, settings.enableLiveSatellites]);

  const handleSort = (field: keyof SatelliteType) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const filtered = satellites
    .filter(s => {
      const matchSearch = s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.noradId.toString().includes(search) ||
        s.owner.toLowerCase().includes(search.toLowerCase());
      return matchSearch && (typeFilter === 'all' || s.type === typeFilter);
    })
    .sort((a, b) => {
      const av = a[sortField], bv = b[sortField];
      if (typeof av === 'string' && typeof bv === 'string')
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      if (typeof av === 'number' && typeof bv === 'number')
        return sortDir === 'asc' ? av - bv : bv - av;
      return 0;
    });

  // Visibility calculations for currently selected satellite
  const visibility = selectedSat && userLat && userLng
    ? calcSatelliteVisibility(userLat, userLng, selectedSat.lat, selectedSat.lng, selectedSat.altitude)
    : null;

  const handleWatchToggle = (sat: SatelliteType) => {
    if (isWatched(sat.noradId.toString(), 'satellite')) {
      const entry = watchlist.find(w => w.identifier === sat.noradId.toString() && w.type === 'satellite');
      if (entry) removeEntry(entry.id);
      toast(`Removed ${sat.name} from watchlist`);
    } else {
      addEntry({ id: `wl-${Date.now()}`, type: 'satellite', identifier: sat.noradId.toString(), label: sat.name, alertOnSeen: true });
      toast.success(`Added ${sat.name} to watchlist`);
    }
  };

  const SortIcon = ({ field }: { field: keyof SatelliteType }) => (
    sortField !== field ? <ChevronUp size={12} className="text-gray-600" />
    : sortDir === 'asc' ? <ChevronUp size={12} className="text-indigo-400" />
    : <ChevronDown size={12} className="text-indigo-400" />
  );

  return (
    <RenderModeProvider>
    <div className="space-y-4">
      {/* Controls */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Search by name, NORAD ID, owner..."
              value={search} onChange={e => setSearch(e.target.value)} className="input-field pl-9" />
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="input-field sm:w-36">
            <option value="all">All Orbits</option>
            <option value="LEO">LEO</option>
            <option value="MEO">MEO</option>
            <option value="GEO">GEO</option>
            <option value="HEO">HEO</option>
          </select>
          <button onClick={locate} className="btn-secondary" title="Get your location for pass calculations">
            <MapPin size={15} className={userLat ? 'text-green-400' : ''} />
            <span className="hidden sm:inline">{userLat ? 'Located' : 'My Location'}</span>
          </button>
          <button onClick={() => setShowPassCalc(!showPassCalc)} className="btn-secondary">
            <Satellite size={15} className="text-indigo-400" />
            <span className="hidden sm:inline">Pass Calculator</span>
          </button>
          <button onClick={fetchData} disabled={isLoading} className="btn-primary">
            <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">{settings.enableLiveSatellites ? 'Live' : 'Refresh'}</span>
          </button>
          <button onClick={() => toCSV(filtered as unknown as Record<string, unknown>[], 'satellites.csv')} className="btn-secondary" title="Export CSV">
            <Download size={15} />
          </button>
          <RenderModeToggle />
        </div>

        <div className="mt-3 flex items-center gap-3 text-xs">
          <div className={`flex items-center gap-1.5 ${isLive ? 'text-green-400' : 'text-yellow-400'}`}>
            <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-500 live-indicator' : 'bg-yellow-500'}`} />
            {isLive ? 'CelesTrak Live Data' : 'Demo Data — Enable live in Settings'}
          </div>
        </div>
      </div>

      {/* Pass Calculator */}
      {showPassCalc && (
        <div className="card glow-border">
          <div className="card-header">
            <Satellite size={16} className="text-indigo-400" />
            <h3 className="section-title">Overhead Pass Calculator</h3>
          </div>
          {!userLat ? (
            <div className="text-center py-6">
              <MapPin size={32} className="mx-auto text-gray-600 mb-2" />
              <p className="text-gray-500 text-sm">Click "My Location" to enable pass calculations</p>
              <button onClick={locate} className="btn-primary mt-3 mx-auto">
                <MapPin size={14} /> Get My Location
              </button>
            </div>
          ) : (
            <div>
              <p className="text-xs text-gray-500 mb-3">
                Your location: {userLat.toFixed(4)}°, {userLng!.toFixed(4)}°
              </p>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Satellite</th>
                      <th>NORAD</th>
                      <th>Elevation</th>
                      <th>Distance (km)</th>
                      <th>Visible</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered
                      .map(sat => ({ sat, vis: calcSatelliteVisibility(userLat, userLng!, sat.lat, sat.lng, sat.altitude) }))
                      .sort((a, b) => b.vis.elevationDeg - a.vis.elevationDeg)
                      .slice(0, 15)
                      .map(({ sat, vis }) => (
                        <tr key={sat.id}>
                          <td className="font-medium text-gray-200">{sat.name}</td>
                          <td className="font-mono text-xs text-gray-500">{sat.noradId}</td>
                          <td className={vis.elevationDeg > 10 ? 'text-green-400' : 'text-gray-500'}>
                            {vis.elevationDeg.toFixed(1)}°
                          </td>
                          <td className="font-mono text-xs text-gray-400">{vis.distanceKm.toFixed(0)}</td>
                          <td>
                            {vis.visible
                              ? <span className="badge badge-green">Visible</span>
                              : <span className="badge badge-red">Below horizon</span>}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Map */}
      <div className="card">
        <div className="card-header">
          <Satellite size={18} className="text-indigo-400" />
          <h3 className="section-title">Live Satellite Positions</h3>
          <span className="badge badge-blue ml-auto">{filtered.length} tracked</span>
        </div>
        <MapView
          satellites={filtered}
          filter={defaultFilter}
          height="380px"
          userLocation={userLat && userLng ? { lat: userLat, lng: userLng } : null}
          cluster={settings.clusterMarkers}
          onMarkerClick={(_, id) => {
            const sat = satellites.find(s => s.id === id);
            if (sat) setSelectedSat(sat);
          }}
          onMapClick={(lat, lng) => { setCorrelationLat(lat); setCorrelationLng(lng); }}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            { label: 'CelesTrak', url: 'https://celestrak.org' },
            { label: 'N2YO', url: 'https://www.n2yo.com' },
            { label: 'Heavens Above', url: 'https://www.heavens-above.com' },
            { label: 'Space-Track', url: 'https://www.space-track.org' },
            { label: 'Orbit Visualizer', url: 'https://platform.leolabs.space/visualization' },
          ].map(r => (
            <a key={r.label} href={r.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 bg-indigo-900/20 px-2.5 py-1.5 rounded-full border border-indigo-800/40">
              <ExternalLink size={11} />{r.label}
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
                  { key: 'status', label: 'Status' },
                ].map(({ key, label }) => (
                  <th key={key} onClick={() => handleSort(key as keyof SatelliteType)}
                    className="cursor-pointer select-none hover:text-gray-300">
                    <div className="flex items-center gap-1">
                      {label}<SortIcon field={key as keyof SatelliteType} />
                    </div>
                  </th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 100).map(sat => (
                <tr key={sat.id} onClick={() => setSelectedSat(sat === selectedSat ? null : sat)} className="cursor-pointer">
                  <td>
                    <div className="flex items-center gap-2">
                      <Satellite size={13} className="text-indigo-400 flex-shrink-0" />
                      <span className="font-medium text-gray-200">{sat.name}</span>
                    </div>
                  </td>
                  <td className="font-mono text-xs text-gray-400">{sat.noradId}</td>
                  <td>
                    <span className={`badge ${sat.type === 'LEO' ? 'badge-blue' : sat.type === 'GEO' ? 'badge-green' : sat.type === 'MEO' ? 'badge-yellow' : 'badge-purple'}`}>
                      {sat.type}
                    </span>
                  </td>
                  <td className="text-gray-400">{sat.owner}</td>
                  <td className="font-mono text-xs text-gray-400">{sat.altitude.toLocaleString()}</td>
                  <td>
                    <span className={`badge ${sat.status === 'active' ? 'badge-green' : 'badge-red'}`}>
                      <span className={`status-dot mr-1 ${sat.status === 'active' ? 'bg-green-500 live-indicator' : 'bg-gray-500'}`} />
                      {sat.status}
                    </span>
                  </td>
                  <td onClick={e => { e.stopPropagation(); handleWatchToggle(sat); }}>
                    <Star size={14} className={isWatched(sat.noradId.toString(), 'satellite') ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600 hover:text-yellow-400'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Satellite Correlation */}
      <SatelliteCorrelation
        satellites={satellites}
        eventLat={correlationLat}
        eventLng={correlationLng}
        onClear={() => { setCorrelationLat(null); setCorrelationLng(null); }}
      />

      {/* Detail panel */}
      {selectedSat && (
        <div className="card glow-border">
          <div className="card-header">
            <Satellite size={16} className="text-indigo-400" />
            <h3 className="text-indigo-400 font-semibold">{selectedSat.name}</h3>
            <button onClick={() => handleWatchToggle(selectedSat)} className="ml-auto btn-secondary text-xs">
              <Star size={13} className={isWatched(selectedSat.noradId.toString(), 'satellite') ? 'text-yellow-400 fill-yellow-400' : ''} />
              {isWatched(selectedSat.noradId.toString(), 'satellite') ? 'Unwatch' : 'Watch'}
            </button>
            <button onClick={() => setSelectedSat(null)} className="text-gray-600 hover:text-gray-400 text-sm ml-2">✕</button>
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
              ...(visibility ? [
                { label: 'Elevation from You', value: `${visibility.elevationDeg.toFixed(1)}°` },
                { label: 'Distance from You', value: `${visibility.distanceKm.toFixed(0)} km` },
                { label: 'Currently Visible', value: visibility.visible ? '✅ Yes' : '❌ No' },
              ] : []),
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-900/50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">{label}</p>
                <p className="text-sm text-gray-200 font-medium">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2 flex-wrap">
            <a href={`https://www.n2yo.com/satellite/?s=${selectedSat.noradId}`} target="_blank" rel="noopener noreferrer" className="btn-primary text-sm">
              <ExternalLink size={14} />Track on N2YO
            </a>
            <a href={`https://www.heavens-above.com/orbit.aspx?satid=${selectedSat.noradId}`} target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm">
              <ExternalLink size={14} />Heavens Above
            </a>
          </div>
        </div>
      )}
    </div>
    </RenderModeProvider>
  );
};

export default SatelliteTracker;
