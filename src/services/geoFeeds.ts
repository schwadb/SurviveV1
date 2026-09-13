// ─────────────────────────────────────────────────────────────────────────────
// Keyless, CORS-enabled GeoJSON / imagery feeds for the map. All free, no key.
// ─────────────────────────────────────────────────────────────────────────────
import type { FeatureCollection, Feature } from 'geojson';

async function fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

/** USGS earthquakes, past hour, all magnitudes. */
export async function fetchEarthquakes(): Promise<FeatureCollection> {
  return fetchJson<FeatureCollection>(
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson',
  );
}

/** NWS active weather alerts. Many alerts are zone-based with null geometry — drop those. */
export async function fetchWeatherAlerts(): Promise<FeatureCollection> {
  const fc = await fetchJson<FeatureCollection>('https://api.weather.gov/alerts/active', {
    Accept: 'application/geo+json',
  });
  fc.features = (fc.features ?? []).filter((f: Feature) => f.geometry);
  return fc;
}

/**
 * NASA GIBS true-color imagery WMTS tile template (EPSG:3857).
 * `date` = YYYY-MM-DD; default is yesterday (today is often not yet processed).
 * maxZoom is 9 for this layer/matrix set.
 */
export function gibsTileUrl(date?: string): string {
  const d = date ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${d}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
}

export const GIBS_MAX_ZOOM = 9;

// ─── Reverse geocoding (BigDataCloud client API — keyless, no signup) ───────────
export interface PlaceName { city: string; region: string; country: string; label: string }

export async function placeName(lat: number, lng: number): Promise<PlaceName> {
  try {
    const d = await fetchJson<{ city?: string; locality?: string; principalSubdivision?: string; countryName?: string }>(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`,
    );
    const city = d.city || d.locality || '';
    const region = d.principalSubdivision || '';
    const country = d.countryName || '';
    const label = [city, region, country].filter(Boolean).join(', ') || 'Open ocean / unknown';
    return { city, region, country, label };
  } catch {
    return { city: '', region: '', country: '', label: 'Location unavailable' };
  }
}

// ─── Current weather (Open-Meteo — keyless) ────────────────────────────────────
export interface CurrentWeather { tempC: number; windKph: number; code: number; description: string }

const WEATHER_CODES: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Violent rain showers',
  85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Severe thunderstorm',
};

export async function currentWeather(lat: number, lng: number): Promise<CurrentWeather | null> {
  try {
    const d = await fetchJson<{ current?: { temperature_2m: number; weather_code: number; wind_speed_10m: number } }>(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,wind_speed_10m&wind_speed_unit=kmh`,
    );
    if (!d.current) return null;
    return {
      tempC: Math.round(d.current.temperature_2m),
      windKph: Math.round(d.current.wind_speed_10m),
      code: d.current.weather_code,
      description: WEATHER_CODES[d.current.weather_code] ?? 'Unknown',
    };
  } catch {
    return null;
  }
}
