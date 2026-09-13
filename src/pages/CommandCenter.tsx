import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Compass, Mic, MicOff, Play, Square, Plus, Share2, Save, Trash2,
  MapPin, Cloud, Radio, Loader2, Search, Wind, Sparkles,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { MapFilter } from '../types';
import { mockSatellites, mockAircraft, mockShips, mockCameras, mockFlockCameras } from '../data/mockData';
import MapView, { type GeoJsonLayerSpec } from '../components/common/MapView';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useKeyVault } from '../hooks/useKeyVault';
import { geocodeAddress, perplexitySearch } from '../services/api';
import { placeName, currentWeather, fetchEarthquakes, type CurrentWeather } from '../services/geoFeeds';

// ── Types ──────────────────────────────────────────────────────────────────────
interface Camera { lat: number; lng: number; zoom: number }
interface Waypoint { lat: number; lng: number; zoom: number; label: string }
interface Tour { id: string; name: string; waypoints: Waypoint[] }

const ALL_ON: MapFilter = { satellites: true, aircraft: true, ships: true, cameras: true, flockCameras: true };
const DEFAULT_CAM: Camera = { lat: 20, lng: 0, zoom: 3 };

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ── Local, keyless voice-command grammar ────────────────────────────────────────
type Command =
  | { type: 'place'; query: string }
  | { type: 'zoom'; delta: number }
  | { type: 'globe' }
  | { type: 'waypoint' }
  | { type: 'play' }
  | { type: 'stop' }
  | null;

function parseCommand(raw: string): Command {
  const t = raw.toLowerCase().trim();
  if (/\b(globe|whole earth|zoom out to globe|world view)\b/.test(t)) return { type: 'globe' };
  if (/\bzoom in|closer|zoom right in\b/.test(t)) return { type: 'zoom', delta: 2 };
  if (/\bzoom out|further out|pull back\b/.test(t)) return { type: 'zoom', delta: -2 };
  if (/\b(add|mark|drop|save)\b.*\b(waypoint|point|marker|spot|this)\b/.test(t)) return { type: 'waypoint' };
  if (/\b(play|start|run)\b.*\btour\b|\bplay it\b|\bfly the tour\b/.test(t)) return { type: 'play' };
  if (/\bstop|halt|cancel|pause\b/.test(t)) return { type: 'stop' };
  const m = t.match(/\b(?:take me to|go to|fly to|show me|navigate to|find|locate)\s+(.+)/);
  if (m && m[1]) return { type: 'place', query: m[1].replace(/[.?!]+$/, '').trim() };
  return null;
}

const LAYER_KEYS: (keyof MapFilter)[] = ['satellites', 'aircraft', 'ships', 'cameras', 'flockCameras'];

const CommandCenter: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { getKey } = useKeyVault();

  const [filter, setFilter] = useState<MapFilter>(ALL_ON);
  const [showQuakes, setShowQuakes] = useState(false);
  const [quakeLayer, setQuakeLayer] = useState<GeoJsonLayerSpec[]>([]);
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAM);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom?: number; nonce: number } | null>(null);
  const nonceRef = useRef(0);
  const fly = useCallback((lat: number, lng: number, zoom?: number) => {
    nonceRef.current += 1;
    setFlyTo({ lat, lng, zoom, nonce: nonceRef.current });
  }, []);

  const [placeQuery, setPlaceQuery] = useState('');
  const [flying, setFlying] = useState(false);

  // ── Feature 2: restore from share-link on mount ──────────────────────────────
  useEffect(() => {
    const v = searchParams.get('v');
    if (!v) return;
    try {
      const d = JSON.parse(atob(decodeURIComponent(v))) as { c: [number, number, number]; f?: MapFilter; q?: boolean };
      if (d.f) setFilter(d.f);
      if (d.q) setShowQuakes(true);
      if (d.c) { setCamera({ lat: d.c[0], lng: d.c[1], zoom: d.c[2] }); fly(d.c[0], d.c[1], d.c[2]); }
    } catch { /* malformed link — ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const share = () => {
    const payload = { c: [+camera.lat.toFixed(4), +camera.lng.toFixed(4), camera.zoom], f: filter, q: showQuakes };
    const v = encodeURIComponent(btoa(JSON.stringify(payload)));
    setSearchParams({ v }, { replace: true });
    const url = `${window.location.origin}${window.location.pathname}?v=${v}`;
    navigator.clipboard?.writeText(url).then(
      () => toast.success('Share link copied — camera, layers & view'),
      () => toast.success('Share link set in the address bar'),
    );
  };

  // ── Feature 3 (briefing HUD): debounced load on camera settle ────────────────
  const [place, setPlace] = useState('—');
  const [wx, setWx] = useState<CurrentWeather | null>(null);
  const [aiLine, setAiLine] = useState<string>('');
  const [briefLoading, setBriefLoading] = useState(false);

  const nearby = useMemo(() => {
    const within = (lat: number, lng: number) => haversineKm(camera.lat, camera.lng, lat, lng) < 1500;
    const count = (arr: { lat: number; lng: number }[]) => arr.filter((x) => x.lat != null && within(x.lat, x.lng)).length;
    return {
      aircraft: filter.aircraft ? count(mockAircraft) : 0,
      ships: filter.ships ? count(mockShips) : 0,
      cameras: filter.cameras ? count(mockCameras) : 0,
      flock: filter.flockCameras ? count(mockFlockCameras) : 0,
      satellites: filter.satellites ? mockSatellites.length : 0,
    };
  }, [camera, filter]);

  useEffect(() => {
    const handle = setTimeout(async () => {
      setBriefLoading(true);
      const [p, w] = await Promise.all([placeName(camera.lat, camera.lng), currentWeather(camera.lat, camera.lng)]);
      setPlace(p.label);
      setWx(w);
      setBriefLoading(false);
    }, 700);
    return () => clearTimeout(handle);
  }, [camera.lat, camera.lng]);

  const runAiBrief = async () => {
    const key = getKey('perplexityApiKey');
    if (!key) { toast.error('Add a Perplexity key (Settings) for the AI situation line'); return; }
    setAiLine('…');
    try {
      const { content } = await perplexitySearch(
        `In two sentences, give a current situational-awareness note for the area around ${place} (lat ${camera.lat.toFixed(2)}, lng ${camera.lng.toFixed(2)}): any notable recent events, security, or activity. Be concise.`,
        key,
      );
      setAiLine(content.trim());
    } catch (e) {
      setAiLine(e instanceof Error ? e.message : 'AI brief failed');
    }
  };

  // ── Quakes feed ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    if (!showQuakes) { setQuakeLayer([]); return; }
    fetchEarthquakes().then((data) => { if (!cancelled) setQuakeLayer([{ id: 'quakes', color: '#f97316', data }]); }).catch(() => {});
    return () => { cancelled = true; };
  }, [showQuakes]);

  // ── Feature 1: scene director (tours) ────────────────────────────────────────
  const [tours, setTours] = useLocalStorage<Tour[]>('watcher-tours', []);
  const [recording, setRecording] = useState<Waypoint[]>([]);
  const [tourName, setTourName] = useState('');
  const playRef = useRef(false);
  const [playing, setPlaying] = useState(false);

  const addWaypoint = () => {
    setRecording((prev) => [...prev, { lat: camera.lat, lng: camera.lng, zoom: camera.zoom, label: place }]);
    toast.success(`Waypoint ${recording.length + 1} captured`);
  };
  const saveTour = () => {
    if (recording.length < 2) { toast.error('Capture at least 2 waypoints first'); return; }
    setTours((prev) => [{ id: `tour-${Date.now()}`, name: tourName.trim() || `Tour ${prev.length + 1}`, waypoints: recording }, ...prev]);
    setRecording([]); setTourName('');
    toast.success('Tour saved');
  };
  const playTour = useCallback(async (wps: Waypoint[]) => {
    if (wps.length < 1 || playRef.current) return;
    playRef.current = true; setPlaying(true);
    for (const wp of wps) {
      if (!playRef.current) break;
      fly(wp.lat, wp.lng, wp.zoom);
      await new Promise((r) => setTimeout(r, 3200));
    }
    playRef.current = false; setPlaying(false);
  }, [fly]);
  const stopTour = () => { playRef.current = false; setPlaying(false); };

  // ── Feature 4: voice control (Web Speech API — keyless) ──────────────────────
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [lastCmd, setLastCmd] = useState('');
  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceSupported = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const runCommand = useCallback(async (cmd: Command, spoken: string) => {
    if (!cmd) { setLastCmd(`Not understood: "${spoken}"`); return; }
    if (cmd.type === 'zoom') { const z = Math.max(2, Math.min(18, camera.zoom + cmd.delta)); fly(camera.lat, camera.lng, z); setLastCmd(`Zoom → ${z}`); }
    else if (cmd.type === 'globe') { fly(20, 0, 2); setLastCmd('Globe view'); }
    else if (cmd.type === 'waypoint') { addWaypoint(); setLastCmd('Added waypoint'); }
    else if (cmd.type === 'play') { playTour(recording.length ? recording : tours[0]?.waypoints ?? []); setLastCmd('Playing tour'); }
    else if (cmd.type === 'stop') { stopTour(); setLastCmd('Stopped'); }
    else if (cmd.type === 'place') {
      setLastCmd(`Locating "${cmd.query}"…`);
      try {
        const r = await geocodeAddress(cmd.query) as { lat: string; lon: string }[];
        if (r?.[0]) { fly(parseFloat(r[0].lat), parseFloat(r[0].lon), 9); setLastCmd(`Flew to ${cmd.query}`); }
        else setLastCmd(`No location for "${cmd.query}"`);
      } catch { setLastCmd(`Lookup failed for "${cmd.query}"`); }
    }
  }, [camera, fly, recording, tours, playTour]);

  const toggleVoice = () => {
    if (!voiceSupported) { toast.error('Voice control needs Chrome/Edge (Web Speech API)'); return; }
    if (listening) { recogRef.current?.stop(); return; }
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition!;
    const rec = new Ctor();
    rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      let finalText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else setTranscript(res[0].transcript);
      }
      if (finalText) { setTranscript(finalText); runCommand(parseCommand(finalText), finalText); }
    };
    rec.onerror = (e) => { toast.error(`Voice error: ${e.error}`); setListening(false); };
    rec.onend = () => setListening(false);
    recogRef.current = rec;
    rec.start(); setListening(true);
  };
  useEffect(() => () => recogRef.current?.abort(), []);

  const toggleLayer = (k: keyof MapFilter) => setFilter((p) => ({ ...p, [k]: !p[k] }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Map + controls */}
        <div className="lg:col-span-2 space-y-3">
          <div className="card">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Compass size={18} className="text-indigo-400" />
              <h3 className="section-title mr-2">Command Center</h3>
              <div className="relative flex-1 min-w-[180px]">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  className="input-field pl-8" placeholder="Fly to a place — city, landmark, coords…"
                  value={placeQuery} onChange={(e) => setPlaceQuery(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key !== 'Enter' || !placeQuery.trim()) return;
                    setFlying(true);
                    try {
                      const r = await geocodeAddress(placeQuery.trim()) as { lat: string; lon: string }[];
                      if (r?.[0]) fly(parseFloat(r[0].lat), parseFloat(r[0].lon), 9);
                      else toast.error('No location found');
                    } catch { toast.error('Lookup failed'); } finally { setFlying(false); }
                  }}
                />
                {flying && <Loader2 size={13} className="animate-spin absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500" />}
              </div>
              <button onClick={share} className="btn-secondary text-sm"><Share2 size={14} /> Share</button>
            </div>

            {/* Layer toggles */}
            <div className="flex flex-wrap gap-2 mb-3">
              {LAYER_KEYS.map((k) => (
                <button key={k} onClick={() => toggleLayer(k)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-all font-medium capitalize ${
                    filter[k] ? 'border-indigo-500 bg-indigo-900/20 text-indigo-300' : 'border-gray-700 text-gray-600 hover:border-gray-500'
                  }`}>{k}</button>
              ))}
              <button onClick={() => setShowQuakes((v) => !v)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-all font-medium ${
                  showQuakes ? 'border-orange-500 bg-orange-900/20 text-orange-400' : 'border-gray-700 text-gray-600 hover:border-gray-500'
                }`}>🌎 Earthquakes</button>
            </div>

            <MapView
              satellites={filter.satellites ? mockSatellites : []}
              aircraft={filter.aircraft ? mockAircraft : []}
              ships={filter.ships ? mockShips : []}
              cameras={filter.cameras ? mockCameras : []}
              flockCameras={filter.flockCameras ? mockFlockCameras : []}
              filter={filter}
              geoJsonLayers={quakeLayer}
              flyTo={flyTo}
              onCameraChange={setCamera}
              height="560px"
              center={[camera.lat, camera.lng]}
              zoom={camera.zoom}
            />
            <p className="text-xs text-gray-600 mt-2">
              Center {camera.lat.toFixed(3)}, {camera.lng.toFixed(3)} · zoom {camera.zoom}
              {playing && <span className="text-indigo-400"> · ▶ playing tour</span>}
            </p>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-3">
          {/* Briefing HUD */}
          <div className="card">
            <div className="card-header">
              <MapPin size={16} className="text-teal-400" />
              <h3 className="section-title">Area Briefing</h3>
              {briefLoading && <Loader2 size={13} className="animate-spin ml-auto text-gray-500" />}
            </div>
            <p className="text-sm text-gray-200 font-medium">{place}</p>
            <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
              {wx ? (
                <>
                  <span className="flex items-center gap-1"><Cloud size={12} className="text-blue-400" /> {wx.tempC}°C · {wx.description}</span>
                  <span className="flex items-center gap-1"><Wind size={12} className="text-cyan-400" /> {wx.windKph} kph</span>
                </>
              ) : <span className="text-gray-600">Weather unavailable</span>}
            </div>
            <div className="grid grid-cols-5 gap-1 mt-3 text-center">
              {[['✈️', nearby.aircraft], ['🚢', nearby.ships], ['📷', nearby.cameras], ['👁️', nearby.flock], ['🛰️', nearby.satellites]].map(([icon, n], i) => (
                <div key={i} className="bg-gray-900 rounded p-1.5">
                  <div className="text-sm">{icon}</div>
                  <div className="text-xs text-gray-300 font-semibold">{n as number}</div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-600 mt-1">Signals within ~1500 km of view center</p>
            <div className="mt-3">
              <button onClick={runAiBrief} className="btn-secondary text-xs w-full"><Sparkles size={12} /> AI situation line</button>
              {aiLine && <p className="text-xs text-gray-400 mt-2 leading-relaxed">{aiLine}</p>}
            </div>
          </div>

          {/* Scene Director */}
          <div className="card">
            <div className="card-header">
              <Play size={16} className="text-indigo-400" />
              <h3 className="section-title">Scene Director</h3>
              <span className="badge badge-blue ml-auto">{recording.length} pts</span>
            </div>
            <div className="flex gap-2 mb-2">
              <button onClick={addWaypoint} className="btn-secondary text-xs flex-1"><Plus size={12} /> Add waypoint</button>
              {playing
                ? <button onClick={stopTour} className="btn-secondary text-xs"><Square size={12} /> Stop</button>
                : <button onClick={() => playTour(recording)} disabled={recording.length < 2} className="btn-primary text-xs"><Play size={12} /> Preview</button>}
            </div>
            {recording.length > 0 && (
              <div className="flex gap-2 mb-2">
                <input className="input-field text-xs" placeholder="Tour name" value={tourName} onChange={(e) => setTourName(e.target.value)} />
                <button onClick={saveTour} className="btn-primary text-xs"><Save size={12} /> Save</button>
              </div>
            )}
            {tours.length === 0 ? (
              <p className="text-xs text-gray-500">Capture waypoints, then Preview or Save a cinematic tour.</p>
            ) : (
              <div className="space-y-1.5">
                {tours.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 p-2 bg-gray-900 rounded-lg text-xs">
                    <span className="flex-1 text-gray-200 truncate">{t.name} <span className="text-gray-500">· {t.waypoints.length} pts</span></span>
                    <button onClick={() => playTour(t.waypoints)} disabled={playing} className="text-indigo-400 hover:text-indigo-300"><Play size={13} /></button>
                    <button onClick={() => setTours((p) => p.filter((x) => x.id !== t.id))} className="text-gray-500 hover:text-red-400"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Voice control */}
          <div className="card">
            <div className="card-header">
              <Radio size={16} className="text-emerald-400" />
              <h3 className="section-title">Voice Control</h3>
              <span className="badge badge-green ml-auto">keyless</span>
            </div>
            <button onClick={toggleVoice}
              className={`w-full btn-${listening ? 'secondary' : 'primary'} justify-center ${listening ? 'border-red-600 text-red-300' : ''}`}>
              {listening ? <><MicOff size={15} /> Stop listening</> : <><Mic size={15} /> Start voice</>}
            </button>
            {listening && <p className="text-xs text-emerald-400 mt-2 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 live-indicator" /> Listening…</p>}
            {transcript && <p className="text-xs text-gray-300 mt-2">“{transcript}”</p>}
            {lastCmd && <p className="text-xs text-gray-500 mt-1">→ {lastCmd}</p>}
            <p className="text-[11px] text-gray-600 mt-2 leading-relaxed">
              Try: “take me to Tokyo” · “zoom in” · “zoom out to globe” · “add waypoint” · “play tour” · “stop”.
              {!voiceSupported && <span className="text-amber-400 block mt-1">Voice needs Chrome or Edge.</span>}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CommandCenter;
