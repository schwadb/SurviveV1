# PLAN: GEOINT upgrade on the existing Leaflet map

**Leverage rank: 4 of 5.**
**Why #4:** Biggest *visible* quality jump. All client-side, keeps the current Leaflet map (no migration to MapLibre). Adds the GEOINT features analysts expect: geofences with enter/exit alerts, density heatmaps, a day/night terminator, and free real-time GeoJSON layers. Do after Plans 1–3.
**Effort:** M–L (3–4 days).

---

## Goal
Extend `MapView` (currently markers + jamming/airspace overlays) with:
1. **Geofencing + alerts** — draw polygons/circles; alert when a tracked aircraft/ship enters or exits (point-in-polygon).
2. **Heatmap** — real density layer (replace the hand-rolled circle "heatmap").
3. **Day/night terminator** — solar terminator overlay (pairs with satellites).
4. **Keyless GeoJSON layers** — USGS earthquakes, NWS active weather alerts, NASA GIBS satellite imagery basemap.

---

## Dependencies to add (all client-side, MIT/BSD)
```
npm i @turf/boolean-point-in-polygon @turf/helpers leaflet.heat leaflet-draw @joergdietrich/leaflet.terminator --legacy-peer-deps
npm i -D @types/leaflet.heat @types/leaflet-draw
```
Import the **specific** Turf modules, not the full `@turf/turf` meta-package (bundle size). `leaflet.heat`, `leaflet-draw`, and the terminator are Leaflet plugins that patch the `L` object.

---

## Exact files to create/touch
- **TOUCH** `src/components/common/MapView.tsx` — add props `geofences`, `showHeatmapReal`, `showTerminator`, `geoJsonLayers`, `onGeofenceDraw`; add the plugin layers.
- **CREATE** `src/services/geoFeeds.ts` — keyless GeoJSON fetchers (USGS, NWS) + the GIBS tile URL builder.
- **CREATE** `src/services/geofence.ts` — geofence model (localStorage) + `pointInAnyFence()` + enter/exit alert dedup.
- **TOUCH** `src/components/tracking/AircraftTracker.tsx` and `ShipTracker.tsx` — wire geofence checks against live positions + notifications; add a "Draw geofence" toggle.
- Read-only reference: current `MapView.tsx` (note it uses `import('leaflet')` dynamically, `preferCanvas:true`, keeps overlay layers in `overlayLayersRef`, and already accepts `jammingZones`/`airspaceZones`), `src/hooks/useNotifications.ts`.

---

## Step 1 — `geoFeeds.ts` (keyless, CORS-verified GeoJSON)
```ts
// USGS earthquakes (past hour, all magnitudes) — GeoJSON FeatureCollection
export async function fetchEarthquakes(): Promise<GeoJSON.FeatureCollection> {
  const r = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson',
    { signal: AbortSignal.timeout(12000) });
  return r.json();
}
// NWS active alerts — GeoJSON (some features have null geometry; filter them)
export async function fetchWeatherAlerts(): Promise<GeoJSON.FeatureCollection> {
  const r = await fetch('https://api.weather.gov/alerts/active',
    { headers: { Accept: 'application/geo+json' }, signal: AbortSignal.timeout(12000) });
  const fc = await r.json();
  fc.features = (fc.features ?? []).filter((f: GeoJSON.Feature) => f.geometry);
  return fc;
}
// NASA GIBS true-color imagery (WMTS, EPSG:3857). {date} = YYYY-MM-DD (yesterday is safest — today may be unprocessed).
export function gibsTileUrl(date: string): string {
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
}
```

## Step 2 — `geofence.ts`
```ts
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point, polygon } from '@turf/helpers';
export interface Geofence { id: string; name: string; ring: [number, number][]; /* [lng,lat] pairs, GeoJSON order */ }
// Returns the fences a given lat/lng is inside.
export function fencesContaining(lat: number, lng: number, fences: Geofence[]): Geofence[] {
  const pt = point([lng, lat]);                       // NOTE: GeoJSON is [lng, lat]
  return fences.filter(f => {
    try { return booleanPointInPolygon(pt, polygon([[...f.ring, f.ring[0]]])); } catch { return false; }
  });
}
```
Persist `Geofence[]` in localStorage `watcher-geofences` (via `useLocalStorage`). For enter/exit detection keep a `Set<string>` of `` `${fenceId}:${entityId}` `` currently-inside keys (a `useRef`), diff each refresh, and fire `notify()` on new-enter / new-exit only.

## Step 3 — MapView plugin layers
In `MapView.tsx`, inside the `import('leaflet').then(async (L) => {...})` blocks:
- **Heatmap:** `await import('leaflet.heat');` then `L.heatLayer(points, { radius: 25, blur: 15 })` where `points = [[lat, lng, intensity], ...]` (Leaflet order here, NOT GeoJSON). Gate on a new `showHeatmapReal` prop; remove the old manual-circle heatmap block when this is on.
- **Terminator:** `const Terminator = (await import('@joergdietrich/leaflet.terminator')).default; const t = Terminator(); t.addTo(map);` gate on `showTerminator`; refresh every 60s via `setInterval(() => t.setTime(), 60000)` (store + clear on cleanup).
- **Draw control:** `await import('leaflet-draw');` add `new L.Control.Draw({ draw: { polygon:true, circle:true, marker:false, polyline:false, rectangle:true } })` when a `drawing` prop is true; listen `map.on(L.Draw.Event.CREATED, e => onGeofenceDraw(layerToRing(e.layer)))` and convert the drawn layer's latlngs to a `[lng,lat][]` ring.
- **GeoJSON layers:** for each `{ id, data, style }` in `geoJsonLayers`, `L.geoJSON(data, { pointToLayer, style, onEachFeature: bind a popup })`. Push all created layers into `overlayLayersRef` so they're cleared/redrawn on prop change (mirror the existing jamming/airspace pattern).
- **GIBS basemap option:** if a `basemap === 'satellite'` prop is set, add `L.tileLayer(gibsTileUrl(yesterday), { maxZoom: 9, tileSize: 256 })` instead of / above the CARTO dark layer.

## Step 4 — wire geofence alerts in trackers
In `AircraftTracker.tsx` (and `ShipTracker.tsx`), after each data refresh compute `fencesContaining(ac.lat, ac.lng, fences)` for each entity, diff against the inside-set ref, and `notify('Geofence', \`\${ac.callsign} entered \${fence.name}\`, {type:'warning'})` on enter. Add a "Draw geofence" toggle button that flips MapView's `drawing` prop and persists the drawn ring via the geofence hook. Pass `geofences` to MapView so the rings render (as polygons in `overlayLayersRef`).

---

## Edge cases a weaker model WILL miss
1. **Coordinate order is the #1 trap.** Leaflet uses `[lat, lng]`. GeoJSON and Turf use `[lng, lat]`. `booleanPointInPolygon` needs `point([lng, lat])`. `leaflet.heat` needs `[lat, lng, intensity]`. Mixing these silently puts everything in the ocean off Africa (0,0) or mirrors coordinates. Follow the exact orders noted per API above.
2. **Turf polygons must be closed rings.** The first and last coordinate must be identical. `polygon([[...ring, ring[0]]])` closes it. An unclosed ring throws — hence the `try/catch` returning false.
3. **Leaflet plugins patch the singleton `L`.** They must be imported *after* `import('leaflet')` resolves and used via the same `L` (as the existing `leaflet.markercluster` block does). `leaflet.heat` adds `L.heatLayer`; `leaflet-draw` adds `L.Control.Draw` and `L.Draw.Event`. Importing them at top-level module scope before Leaflet loads will throw.
4. **`leaflet-draw` needs its CSS.** Import `leaflet-draw/dist/leaflet.draw.css` (add to `src/index.css` via `@import` or import in the component) or the toolbar renders as unstyled boxes.
5. **NWS features can have null geometry.** Many alerts are zone-based with `geometry: null`; `L.geoJSON` throws or silently drops them. Filter `f.geometry` out first (done in `fetchWeatherAlerts`). NWS also *requests* a User-Agent, but browsers forbid setting that header — the call still works; do not try to set `User-Agent` (it will be ignored/blocked).
6. **GIBS date.** "Today" is often not yet processed → blank tiles. Default to **yesterday** (`new Date(Date.now()-864e5)` — but note: this codebase's environment may restrict `Date.now()` in some tool contexts; in the running app it is fine). Use `GoogleMapsCompatible_Level9` (maxZoom 9) — requesting deeper zoom returns 404 tiles.
7. **Enter/exit alert spam.** Fire only on transitions (was-outside→now-inside). Keep a `Set` of current inside-keys in a `useRef` and diff; never alert every refresh for a stationary target inside a fence.
8. **Overlay redraw discipline.** MapView clears `overlayLayersRef` on each overlay effect run. Push every geofence/GeoJSON/heat layer you add into a ref and remove it before re-adding, or layers pile up on every refresh (memory leak + z-fighting). Mirror the existing jamming/airspace cleanup exactly.
9. **Bundle size.** Import `@turf/boolean-point-in-polygon` + `@turf/helpers` only. `@turf/turf` is ~500KB. `leaflet.heat` is tiny; `leaflet-draw` is moderate.

---

## Acceptance criteria (verifiable)
- [ ] `npx tsc -b` and `npm run build` exit 0 (with the new @types installed).
- [ ] USGS layer toggle draws real earthquake points (past hour) with magnitude in the popup; NWS toggle draws active-alert polygons (null-geometry alerts excluded, no console error).
- [ ] GIBS "satellite" basemap shows true-color imagery tiles (yesterday's date) up to zoom 9.
- [ ] Heatmap toggle renders a real `L.heatLayer` gradient (not the old translucent circles) over aircraft/ship/camera density.
- [ ] Terminator shows the day/night line and shifts over time (verify `setTime` updates it; no leaked interval after unmount).
- [ ] Drawing a polygon on the Aircraft map persists a geofence; when a tracked aircraft's position falls inside it, a single "entered <fence>" notification fires (not one per refresh); leaving fires one "exited".
- [ ] Point-in-polygon is correct: a fence drawn over Europe does NOT match an aircraft over North America (proves lat/lng order is right).
- [ ] Toggling layers on/off repeatedly does not accumulate duplicate layers (inspect `map` layer count stays bounded).
