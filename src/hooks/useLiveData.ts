import { useEffect, useState } from 'react';
import type { Aircraft, Satellite, Ship } from '../types';
import { mockAircraft, mockSatellites, mockShips } from '../data/mockData';
import { fetchLiveAircraft, fetchLiveSatellites, connectAISStream } from '../services/api';
import { preloadSatLib } from '../services/orbitEngine';
import { useSettings } from './useLocalStorage';
import { useKeyVault } from './useKeyVault';

export interface LiveData {
  aircraft: Aircraft[];
  satellites: Satellite[];
  ships: Ship[];
  isLive: { aircraft: boolean; satellites: boolean; ships: boolean };
}

/**
 * Shared live-data feed: returns real aircraft (OpenSky), satellites (CelesTrak
 * TLE → satellite.js), and ships (AISStream WebSocket) when the corresponding
 * Settings toggles are on, otherwise the mock datasets. Handles polling,
 * WebSocket accumulation/flush, and cleanup so callers just consume the arrays.
 *
 * `bounds` optionally scopes the aircraft query (min/max lat/lon).
 */
export function useLiveData(bounds?: { minLat: number; maxLat: number; minLon: number; maxLon: number }): LiveData {
  const [settings] = useSettings();
  const { getKey } = useKeyVault();
  const aisKey = getKey('aisStreamApiKey');

  const [aircraft, setAircraft] = useState<Aircraft[]>(mockAircraft);
  const [satellites, setSatellites] = useState<Satellite[]>(mockSatellites);
  const [ships, setShips] = useState<Ship[]>(mockShips);

  const liveAircraft = settings.enableLiveAircraft;
  const liveSats = settings.enableLiveSatellites;
  const liveShips = settings.enableLiveShips && !!aisKey;
  const boundsKey = bounds ? `${bounds.minLat},${bounds.maxLat},${bounds.minLon},${bounds.maxLon}` : '';

  // Aircraft — OpenSky, polled.
  useEffect(() => {
    if (!liveAircraft) { setAircraft(mockAircraft); return; }
    let active = true;
    const run = () => fetchLiveAircraft(bounds).then((d) => { if (active && d.length) setAircraft(d); }).catch(() => {});
    run();
    const id = setInterval(run, Math.max(10, settings.refreshInterval) * 1000);
    return () => { active = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveAircraft, settings.refreshInterval, boundsKey]);

  // Satellites — CelesTrak TLE, computed positions, polled.
  useEffect(() => {
    if (!liveSats) { setSatellites(mockSatellites); return; }
    let active = true;
    const run = async () => {
      await preloadSatLib();
      const d = await fetchLiveSatellites('active').catch(() => [] as Satellite[]);
      if (active && d.length) setSatellites(d);
    };
    run();
    const id = setInterval(run, Math.max(30, settings.refreshInterval) * 1000);
    return () => { active = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSats, settings.refreshInterval]);

  // Ships — AISStream WebSocket, accumulate into a keyed map, flush at 1 Hz.
  useEffect(() => {
    if (!liveShips) { setShips(mockShips); return; }
    const map = new Map<string, Ship>();
    const ws = connectAISStream(aisKey, (vessels) => { for (const v of vessels) map.set(v.mmsi, v); });
    const flush = setInterval(() => { if (map.size) setShips(Array.from(map.values())); }, 1000);
    return () => { clearInterval(flush); ws.close(); };
  }, [liveShips, aisKey]);

  return { aircraft, satellites, ships, isLive: { aircraft: liveAircraft, satellites: liveSats, ships: liveShips } };
}
