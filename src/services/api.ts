import axios from 'axios';
import type { Aircraft, Satellite } from '../types';
import { preloadSatLib, computePositionFromTLE } from './orbitEngine';

// ─── Rate Limiter ──────────────────────────────────────────────────────────────
class RateLimiter {
  private queue: Array<() => void> = [];
  private running = 0;
  private readonly maxConcurrent: number;
  private readonly minInterval: number;
  private lastCall = 0;

  constructor(maxConcurrent = 2, minIntervalMs = 1000) {
    this.maxConcurrent = maxConcurrent;
    this.minInterval = minIntervalMs;
  }

  async throttle<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        const now = Date.now();
        const wait = Math.max(0, this.lastCall + this.minInterval - now);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        this.lastCall = Date.now();
        try {
          resolve(await fn());
        } catch (e) {
          reject(e);
        } finally {
          this.running--;
          this.processQueue();
        }
      });
      this.processQueue();
    });
  }

  private processQueue() {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      this.running++;
      const task = this.queue.shift()!;
      task();
    }
  }
}

const openSkyLimiter = new RateLimiter(1, 5000);   // 1 req / 5s for OpenSky
const generalLimiter = new RateLimiter(3, 1000);

// ─── Retry with exponential backoff ───────────────────────────────────────────
async function withRetry<T>(fn: () => Promise<T>, retries = 3, baseDelay = 2000): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('Max retries exceeded');
}

// ─── OpenSky Network — Live Aircraft ──────────────────────────────────────────
export interface OpenSkyState {
  icao24: string;
  callsign: string | null;
  origin_country: string;
  time_position: number | null;
  last_contact: number;
  longitude: number | null;
  latitude: number | null;
  baro_altitude: number | null;
  on_ground: boolean;
  velocity: number | null;
  true_track: number | null;
  vertical_rate: number | null;
  sensors: number[] | null;
  geo_altitude: number | null;
  squawk: string | null;
  spi: boolean;
  position_source: number;
}

export const fetchLiveAircraft = async (
  bounds?: { minLat: number; maxLat: number; minLon: number; maxLon: number }
): Promise<Aircraft[]> => {
  return openSkyLimiter.throttle(() =>
    withRetry(async () => {
      let url = 'https://opensky-network.org/api/states/all';
      if (bounds) {
        url += `?lamin=${bounds.minLat}&lomin=${bounds.minLon}&lamax=${bounds.maxLat}&lomax=${bounds.maxLon}`;
      }
      const resp = await axios.get<{ states: OpenSkyState[] | null; time: number }>(url, {
        timeout: 15000,
      });

      const states = resp.data.states ?? [];
      return states
        .filter((s) => s.latitude !== null && s.longitude !== null)
        .map((s): Aircraft => ({
          icao: s.icao24.toUpperCase(),
          callsign: (s.callsign ?? s.icao24).trim() || s.icao24.toUpperCase(),
          lat: s.latitude!,
          lng: s.longitude!,
          altitude: s.baro_altitude ? Math.round(s.baro_altitude * 3.28084) : 0, // m→ft
          speed: s.velocity ? Math.round(s.velocity * 1.94384) : 0,              // m/s→kts
          heading: s.true_track ?? 0,
          verticalRate: s.vertical_rate ? Math.round(s.vertical_rate * 196.85) : 0, // m/s→fpm
          status: s.on_ground ? 'ground' : 'airborne',
          lastContact: new Date(s.last_contact * 1000).toISOString(),
          emergency: s.squawk === '7700' || s.squawk === '7600' || s.squawk === '7500',
          positionSource: s.position_source,
          registration: undefined,
          airline: s.origin_country,
          type: undefined,
          origin: undefined,
          destination: undefined,
        }));
    }, 3, 2000)
  );
};

// ─── CelesTrak — Live Satellites ──────────────────────────────────────────────
/** Classify orbit regime from mean motion (revolutions per day). */
function classifyOrbit(meanMotion: number): Satellite['type'] {
  if (meanMotion >= 11.25) return 'LEO';
  if (meanMotion >= 2.0) return 'MEO';
  if (meanMotion >= 0.9) return 'GEO';
  return 'HEO';
}

/**
 * Fetch real TLEs from CelesTrak and compute genuine sub-satellite positions
 * with satellite.js (via orbitEngine). Replaces the previous placeholder that
 * returned random coordinates. `group` is any CelesTrak GP group name
 * (active, stations, starlink, gps-ops, galileo, weather, science, military…).
 */
export const fetchLiveSatellites = async (group = 'active', limit = 150): Promise<Satellite[]> => {
  return generalLimiter.throttle(() =>
    withRetry(async () => {
      const resp = await axios.get<string>(
        `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`,
        { timeout: 20000, responseType: 'text' }
      );

      const lines = String(resp.data).split('\n').map((l) => l.replace(/\r$/, ''));
      await preloadSatLib();
      const now = new Date();
      const sats: Satellite[] = [];

      for (let i = 0; i + 2 < lines.length && sats.length < limit; i += 3) {
        const name = lines[i]?.trim();
        const l1 = lines[i + 1];
        const l2 = lines[i + 2];
        if (!name || !l1?.startsWith('1 ') || !l2?.startsWith('2 ')) continue;

        const pos = computePositionFromTLE(l1, l2, now);
        if (!pos) continue;

        const noradId = parseInt(l1.substring(2, 7).trim(), 10) || 0;
        const inclination = parseFloat(l2.substring(8, 16)) || 0;
        const meanMotion = parseFloat(l2.substring(52, 63)) || 0;

        sats.push({
          id: String(noradId),
          name,
          noradId,
          type: classifyOrbit(meanMotion),
          owner: 'Unknown',
          lat: pos.lat,
          lng: pos.lng,
          altitude: Math.round(pos.altitudeKm),
          velocity: Math.round(pos.velocity * 3600), // km/s → km/h
          inclination: Math.round(inclination * 100) / 100,
          status: 'active',
          lastUpdated: now.toISOString(),
        });
      }

      return sats;
    }, 2, 3000)
  );
};

// ─── AISHub WebSocket — Live Ships ────────────────────────────────────────────
// AISStream.io provides a free WebSocket AIS feed
export const connectAISStream = (
  apiKey: string,
  onData: (vessels: import('../types').Ship[]) => void,
  boundingBoxes?: number[][]
): WebSocket => {
  const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');

  ws.onopen = () => {
    ws.send(JSON.stringify({
      APIKey: apiKey,
      BoundingBoxes: boundingBoxes ?? [[[-90, -180], [90, 180]]],
      FilterMessageTypes: ['PositionReport'],
    }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.MessageType !== 'PositionReport') return;
      const meta = msg.MetaData;
      const pos = msg.Message?.PositionReport;
      if (!pos || !meta) return;

      const ship: import('../types').Ship = {
        mmsi: String(meta.MMSI),
        name: meta.ShipName?.trim() || `MMSI ${meta.MMSI}`,
        callsign: meta.CallSign,
        type: 'Unknown',
        flag: meta.flag,
        lat: pos.Latitude,
        lng: pos.Longitude,
        speed: pos.Sog ?? 0,
        heading: pos.TrueHeading ?? pos.Cog ?? 0,
        course: pos.Cog ?? 0,
        status: navStatusLabel(pos.NavigationalStatus),
        destination: meta.Destination?.trim(),
        lastUpdated: new Date().toISOString(),
      };
      onData([ship]);
    } catch {
      // Ignore parse errors
    }
  };

  return ws;
};

function navStatusLabel(status: number): string {
  const labels: Record<number, string> = {
    0: 'Under Way Using Engine', 1: 'At Anchor', 2: 'Not Under Command',
    3: 'Restricted Manoeuvrability', 5: 'Moored', 8: 'Under Way Sailing',
  };
  return labels[status] ?? 'Unknown';
}

// ─── Perplexity AI API ────────────────────────────────────────────────────────
export const perplexitySearch = async (
  query: string,
  apiKey: string,
  model = 'sonar'
): Promise<{ content: string; citations?: string[] }> => {
  const response = await generalLimiter.throttle(() =>
    withRetry(() =>
      axios.post(
        'https://api.perplexity.ai/chat/completions',
        {
          model,
          messages: [
            {
              role: 'system',
              content:
                'You are an expert OSINT (Open Source Intelligence) research assistant. Provide detailed, factual, well-sourced information. Include citations. Format responses with markdown headers and bullet points for clarity.',
            },
            { role: 'user', content: query },
          ],
          max_tokens: 2048,
          temperature: 0.2,
          return_citations: true,
          search_recency_filter: 'month',
        },
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: 30000,
        }
      ),
      2,
      2000
    )
  );

  const content = response.data.choices[0].message.content;
  const citations = response.data.citations ?? [];
  return { content, citations };
};

// ─── Geocoding (Nominatim) ────────────────────────────────────────────────────
export const geocodeAddress = async (address: string) => {
  return generalLimiter.throttle(() =>
    withRetry(async () => {
      const resp = await axios.get('https://nominatim.openstreetmap.org/search', {
        params: { q: address, format: 'json', limit: 5, addressdetails: 1 },
        timeout: 10000,
      });
      return resp.data;
    })
  );
};

export const reverseGeocode = async (lat: number, lng: number) => {
  return generalLimiter.throttle(() =>
    withRetry(async () => {
      const resp = await axios.get('https://nominatim.openstreetmap.org/reverse', {
        params: { lat, lon: lng, format: 'json', addressdetails: 1 },
        timeout: 10000,
      });
      return resp.data;
    })
  );
};

// ─── Phone lookup (NumVerify) ─────────────────────────────────────────────────
export const lookupPhoneNumber = async (phone: string, apiKey: string) => {
  return generalLimiter.throttle(() =>
    withRetry(async () => {
      const resp = await axios.get('https://apilayer.net/api/validate', {
        params: { access_key: apiKey, number: phone, format: 1 },
        timeout: 10000,
      });
      return resp.data;
    })
  );
};

// ─── HaveIBeenPwned (account breaches — requires a paid HIBP key) ──────────────
// The account-breach endpoint needs a real HIBP API key (there is no free tier).
// The key must be supplied by the caller; we never ship a placeholder that only
// ever returns 401. For a keyless breach signal, use pwnedPassword() in
// services/osint.ts, which checks the free k-anonymity Pwned Passwords range API.
export const checkEmailBreach = async (email: string, apiKey: string): Promise<unknown[]> => {
  if (!apiKey) throw new Error('A HaveIBeenPwned API key is required for account breach lookups');
  return generalLimiter.throttle(() =>
    withRetry(async () => {
      const resp = await axios.get(
        `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
        {
          headers: { 'hibp-api-key': apiKey },
          timeout: 10000,
        }
      );
      return resp.data;
    })
  );
};

// ─── Bulk export helper ───────────────────────────────────────────────────────
export const toCSV = <T extends Record<string, unknown>>(data: T[], filename: string) => {
  if (data.length === 0) return;
  const keys = Object.keys(data[0]);
  const rows = [keys.join(','), ...data.map((row) =>
    keys.map((k) => JSON.stringify(row[k] ?? '')).join(',')
  )];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export const toJSON = <T>(data: T, filename: string) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export const importJSON = (): Promise<unknown> => {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return reject(new Error('No file selected'));
      const reader = new FileReader();
      reader.onload = () => {
        try { resolve(JSON.parse(reader.result as string)); }
        catch { reject(new Error('Invalid JSON file')); }
      };
      reader.readAsText(file);
    };
    input.click();
  });
};
