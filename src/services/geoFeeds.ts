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
