import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Plane, AlertTriangle, RefreshCw, ExternalLink, Search, Filter, Star, MapPin, Download, Zap, Navigation, Hexagon } from 'lucide-react';
import type { Aircraft, MapFilter } from '../../types';
import { mockAircraft } from '../../data/mockData';
import { fetchLiveAircraft, toCSV } from '../../services/api';
import MapView from '../common/MapView';
import { useSettings } from '../../hooks/useLocalStorage';
import { useWatchlist } from '../../hooks/useWatchlist';
import { useGeolocation } from '../../hooks/useGeolocation';
import { useNotifications } from '../../hooks/useNotifications';
import { detectJammingZones } from '../../services/jammingDetector';
import { useAirspaceZones } from './AirspaceLayer';
import { useGeofences } from '../../hooks/useGeofences';
import { fencesContaining } from '../../services/geofence';
import { useKeyVault } from '../../hooks/useKeyVault';
import IntelSummary from '../ai/IntelSummary';
import { RenderModeToggle, RenderModeProvider } from '../common/RenderModeToggle';
import toast from 'react-hot-toast';

const defaultFilter: MapFilter = {
  satellites: false, aircraft: true, ships: false, cameras: false, flockCameras: false,
};

type TrailMap = Record<string, Array<{ lat: number; lng: number; t: number }>>;

const AircraftTracker: React.FC = () => {
  const [settings] = useSettings();
  const [aircraft, setAircraft] = useState<Aircraft[]>(mockAircraft);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [trails, setTrails] = useState<TrailMap>({});
  const [selectedAc, setSelectedAc] = useState<Aircraft | null>(null);
  const { addEntry, isWatched, removeEntry, watchlist } = useWatchlist();
  const [showJamming, setShowJamming] = useState(true);
  const [showAirspace, setShowAirspace] = useState(false);
  const { lat: userLat, lng: userLng, locate } = useGeolocation();
  const { notifyEmergency, notify } = useNotifications();
  useAirspaceZones(showAirspace);
  const { fences, addFence } = useGeofences();
  const { getKey } = useKeyVault();
  const [drawing, setDrawing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const knownEmergencies = useRef<Set<string>>(new Set());
  const watchedSeen = useRef<Set<string>>(new Set());
  const geoInsideRef = useRef<Set<string>>(new Set());

  const jammingZones = useMemo(
    () => (showJamming ? detectJammingZones(aircraft) : []),
    [showJamming, aircraft],
  );

  const updateTrails = useCallback((newAircraft: Aircraft[]) => {
    if (!settings.showTrails) return;
    setTrails((prev) => {
      const next = { ...prev };
      newAircraft.forEach((ac) => {
        if (!ac.lat || !ac.lng) return;
        const pts = next[ac.icao] ?? [];
        const newPt = { lat: ac.lat, lng: ac.lng, t: Date.now() };
        // Keep last 20 points, drop those older than 10 min
        const recent = [...pts, newPt].filter((p) => Date.now() - p.t < 600000).slice(-20);
        next[ac.icao] = recent;
      });
      return next;
    });
  }, [settings.showTrails]);

  const checkEmergencies = useCallback((data: Aircraft[]) => {
    data.filter((ac) => ac.emergency && !knownEmergencies.current.has(ac.icao)).forEach((ac) => {
      knownEmergencies.current.add(ac.icao);
      notifyEmergency(`${ac.callsign} is declaring emergency! ICAO: ${ac.icao}`);
    });
  }, [notifyEmergency]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      let data: Aircraft[];
      if (settings.enableLiveAircraft) {
        const bounds = userLat && userLng
          ? { minLat: userLat - 10, maxLat: userLat + 10, minLon: userLng - 15, maxLon: userLng + 15 }
          : undefined;
        data = await fetchLiveAircraft(bounds);
        setIsLive(true);
        toast.success(`Loaded ${data.length} live aircraft`, { id: 'aircraft-update', duration: 2000 });
      } else {
        data = mockAircraft.map((ac) => ({
          ...ac,
          lat: ac.lat + (Math.random() - 0.5) * 0.3,
          lng: ac.lng + (Math.random() - 0.5) * 0.3,
          lastContact: new Date().toISOString(),
        }));
      }
      setAircraft(data);
      setLastUpdate(new Date());
      updateTrails(data);
      checkEmergencies(data);
    } catch (err: unknown) {
      toast.error(`Aircraft data error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      if (!settings.enableLiveAircraft) setAircraft(mockAircraft);
    } finally {
      setIsLoading(false);
    }
  }, [settings.enableLiveAircraft, userLat, userLng, updateTrails, checkEmergencies]);

  // Always call the latest fetchData from the interval without resetting the
  // timer every time bounds/geolocation change (which would otherwise leave the
  // interval calling a stale fetchData with undefined bounds).
  const fetchDataRef = useRef(fetchData);
  useEffect(() => { fetchDataRef.current = fetchData; }, [fetchData]);

  // Auto-refresh
  useEffect(() => {
    fetchDataRef.current();
    intervalRef.current = setInterval(() => fetchDataRef.current(), settings.refreshInterval * 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [settings.refreshInterval, settings.enableLiveAircraft]);

  // Geofence enter/exit — alert only on transitions, never every refresh.
  useEffect(() => {
    if (!fences.length) { geoInsideRef.current = new Set(); return; }
    const fenceName = new Map(fences.map((f) => [f.id, f.name]));
    const nowInside = new Set<string>();
    for (const ac of aircraft) {
      if (!ac.lat || !ac.lng) continue;
      for (const f of fencesContaining(ac.lat, ac.lng, fences)) {
        const key = `${f.id}:${ac.icao}`;
        nowInside.add(key);
        if (!geoInsideRef.current.has(key)) notify('Geofence', `${ac.callsign} entered ${f.name}`, { type: 'warning' });
      }
    }
    for (const key of geoInsideRef.current) {
      if (!nowInside.has(key)) {
        const [fenceId, icao] = key.split(':');
        notify('Geofence', `${icao} left ${fenceName.get(fenceId) ?? 'fence'}`, { type: 'success' });
      }
    }
    geoInsideRef.current = nowInside;
  }, [aircraft, fences, notify]);

  // Watchlist matching — dedupe so each watched aircraft only alerts once.
  useEffect(() => {
    const watchedIcaos = watchlist.filter((w) => w.type === 'aircraft' && w.alertOnSeen).map((w) => w.identifier.toUpperCase());
    aircraft
      .filter((ac) => watchedIcaos.includes(ac.icao) || watchedIcaos.includes(ac.callsign))
      .forEach((ac) => {
        if (watchedSeen.current.has(ac.icao)) return;
        watchedSeen.current.add(ac.icao);
        toast(`👁️ Watched aircraft ${ac.callsign} spotted at ${ac.altitude.toLocaleString()} ft`, { duration: 5000 });
      });
  }, [aircraft, watchlist]);

  const filtered = aircraft.filter((ac) => {
    const matchSearch =
      ac.callsign.toLowerCase().includes(search.toLowerCase()) ||
      (ac.airline?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
      (ac.registration?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
      ac.icao.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || ac.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const emergencyCount = aircraft.filter((ac) => ac.emergency).length;

  const handleWatchToggle = (ac: Aircraft) => {
    if (isWatched(ac.icao, 'aircraft')) {
      const entry = watchlist.find((w) => w.identifier === ac.icao && w.type === 'aircraft');
      if (entry) removeEntry(entry.id);
      toast(`Removed ${ac.callsign} from watchlist`);
    } else {
      addEntry({ id: `wl-${Date.now()}`, type: 'aircraft', identifier: ac.icao, label: ac.callsign, alertOnSeen: true });
      toast.success(`Added ${ac.callsign} to watchlist`);
    }
  };

  return (
    <RenderModeProvider>
    <div className="space-y-4">
      {emergencyCount > 0 && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl p-3 flex items-center gap-3 animate-pulse">
          <AlertTriangle size={20} className="text-red-400 flex-shrink-0" />
          <div>
            <p className="text-red-300 font-semibold text-sm">{emergencyCount} aircraft declaring emergency!</p>
            <p className="text-red-400/70 text-xs">Emergency squawk detected</p>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Search callsign, ICAO, airline..."
              value={search} onChange={(e) => setSearch(e.target.value)} className="input-field pl-9" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-field sm:w-36">
            <option value="all">All Status</option>
            <option value="airborne">Airborne</option>
            <option value="ground">On Ground</option>
          </select>
          <button onClick={locate} className="btn-secondary" title="Center on your location">
            <MapPin size={15} className={userLat ? 'text-green-400' : ''} />
            <span className="hidden sm:inline">{userLat ? 'Located' : 'My Location'}</span>
          </button>
          <button onClick={fetchData} disabled={isLoading} className="btn-primary">
            <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">{settings.enableLiveAircraft ? 'Live' : 'Refresh'}</span>
          </button>
          <button onClick={() => toCSV(filtered as unknown as Record<string, unknown>[], 'aircraft.csv')} className="btn-secondary" title="Export to CSV">
            <Download size={15} />
          </button>
          <RenderModeToggle />
          <button
            onClick={() => setShowJamming(v => !v)}
            className={`btn-secondary text-xs ${showJamming ? 'border-orange-600 text-orange-400' : ''}`}
            title="Toggle GPS jamming overlay"
          >
            <Zap size={13} />
            <span className="hidden sm:inline">Jamming</span>
          </button>
          <button
            onClick={() => setShowAirspace(v => !v)}
            className={`btn-secondary text-xs ${showAirspace ? 'border-blue-600 text-blue-400' : ''}`}
            title="Toggle airspace restrictions"
          >
            <Navigation size={13} />
            <span className="hidden sm:inline">TFRs</span>
          </button>
          <button
            onClick={() => setDrawing(v => !v)}
            className={`btn-secondary text-xs ${drawing ? 'border-purple-600 text-purple-400' : ''}`}
            title="Draw a geofence — get alerted when aircraft enter/exit it"
          >
            <Hexagon size={13} />
            <span className="hidden sm:inline">{drawing ? 'Drawing…' : 'Geofence'}</span>
          </button>
        </div>

        {/* Live status bar */}
        <div className="mt-3 flex items-center gap-3 text-xs">
          <div className={`flex items-center gap-1.5 ${isLive ? 'text-green-400' : 'text-yellow-400'}`}>
            <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-500 live-indicator' : 'bg-yellow-500'}`} />
            {isLive ? 'OpenSky Live Data' : 'Demo Data — Enable live in Settings'}
          </div>
          {lastUpdate && (
            <span className="text-gray-600">Updated {lastUpdate.toLocaleTimeString()}</span>
          )}
          <span className="ml-auto text-gray-600">
            Auto-refresh: {settings.refreshInterval}s
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Tracked', value: aircraft.length, color: 'text-blue-400' },
          { label: 'Airborne', value: aircraft.filter((a) => a.status === 'airborne').length, color: 'text-green-400' },
          { label: 'On Ground', value: aircraft.filter((a) => a.status === 'ground').length, color: 'text-yellow-400' },
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
        <MapView
          aircraft={filtered}
          filter={defaultFilter}
          height="400px"
          center={userLat && userLng ? [userLat, userLng] : [30, 0]}
          zoom={userLat ? 6 : 3}
          userLocation={userLat && userLng ? { lat: userLat, lng: userLng } : null}
          cluster={settings.clusterMarkers}
          trails={settings.showTrails ? trails : {}}
          jammingZones={showJamming ? jammingZones : []}
          geofences={fences}
          drawing={drawing}
          onGeofenceDraw={(ring) => { addFence(ring); setDrawing(false); }}
          onMarkerClick={(_, id) => {
            const ac = aircraft.find((a) => a.icao === id);
            if (ac) setSelectedAc(ac);
          }}
        />

        <div className="mt-3 flex flex-wrap gap-2">
          {[
            { label: 'ADS-B Exchange', url: 'https://www.adsbexchange.com' },
            { label: 'FlightAware', url: 'https://flightaware.com' },
            { label: 'FlightRadar24', url: 'https://www.flightradar24.com' },
            { label: 'OpenSky', url: 'https://opensky-network.org' },
            { label: 'LiveATC', url: 'https://www.liveatc.net' },
          ].map((r) => (
            <a key={r.label} href={r.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 bg-blue-900/20 px-2.5 py-1.5 rounded-full border border-blue-800/40">
              <ExternalLink size={11} />{r.label}
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
                <th>ICAO</th>
                <th>Airline</th>
                <th>Route</th>
                <th>Alt (ft)</th>
                <th>Speed (kts)</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 100).map((ac) => (
                <tr key={ac.icao} onClick={() => setSelectedAc(ac === selectedAc ? null : ac)} className="cursor-pointer">
                  <td>
                    <div className="flex items-center gap-2">
                      <Plane size={13} className="text-blue-400" />
                      <span className="font-medium text-gray-200">{ac.callsign}</span>
                      {ac.emergency && <AlertTriangle size={13} className="text-red-400 live-indicator" />}
                    </div>
                  </td>
                  <td className="font-mono text-xs text-gray-500">{ac.icao}</td>
                  <td className="text-gray-400 max-w-[100px] truncate">{ac.airline || '—'}</td>
                  <td className="font-mono text-xs text-gray-400">
                    {ac.origin && ac.destination ? `${ac.origin}→${ac.destination}` : '—'}
                  </td>
                  <td className="font-mono text-xs text-gray-400">{ac.altitude.toLocaleString()}</td>
                  <td className="font-mono text-xs text-gray-400">{ac.speed}</td>
                  <td>
                    <span className={`badge ${ac.emergency ? 'badge-red' : ac.status === 'airborne' ? 'badge-green' : 'badge-yellow'}`}>
                      {ac.emergency ? '🚨 EMRG' : ac.status}
                    </span>
                  </td>
                  <td onClick={(e) => { e.stopPropagation(); handleWatchToggle(ac); }}>
                    <Star size={14} className={isWatched(ac.icao, 'aircraft') ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600 hover:text-yellow-400'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 100 && (
            <p className="text-center text-xs text-gray-600 py-2">Showing 100 of {filtered.length} — refine search to see more</p>
          )}
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
            {selectedAc.emergency && <span className="badge badge-red ml-2">EMERGENCY</span>}
            <button onClick={() => handleWatchToggle(selectedAc)} className="ml-auto flex items-center gap-1 text-xs btn-secondary">
              <Star size={13} className={isWatched(selectedAc.icao, 'aircraft') ? 'text-yellow-400 fill-yellow-400' : ''} />
              {isWatched(selectedAc.icao, 'aircraft') ? 'Unwatch' : 'Watch'}
            </button>
            <button onClick={() => setSelectedAc(null)} className="text-gray-600 hover:text-gray-400 text-sm ml-2">✕</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'ICAO', value: selectedAc.icao },
              { label: 'Registration', value: selectedAc.registration || '—' },
              { label: 'Aircraft Type', value: selectedAc.type || '—' },
              { label: 'Airline/Country', value: selectedAc.airline || '—' },
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
            <a href={`https://www.flightradar24.com/${selectedAc.callsign}`} target="_blank" rel="noopener noreferrer" className="btn-primary text-sm">
              <ExternalLink size={14} />FlightRadar24
            </a>
            <a href={`https://flightaware.com/live/flight/${selectedAc.callsign}`} target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm">
              <ExternalLink size={14} />FlightAware
            </a>
            <a href={`https://www.adsbexchange.com/?icao=${selectedAc.icao}`} target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm">
              <ExternalLink size={14} />ADS-B Exchange
            </a>
          </div>
        </div>
      )}

      {/* Event Correlation Intelligence */}
      <IntelSummary aircraft={aircraft} jammingZones={jammingZones} perplexityApiKey={getKey('perplexityApiKey')} />
    </div>
    </RenderModeProvider>
  );
};

export default AircraftTracker;
