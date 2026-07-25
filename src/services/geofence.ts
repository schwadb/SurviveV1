// ─────────────────────────────────────────────────────────────────────────────
// Geofences: user-drawn polygons + point-in-polygon tests via Turf.
// Rings are stored in GeoJSON order ([lng, lat]) — NOT Leaflet order.
// ─────────────────────────────────────────────────────────────────────────────
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point, polygon } from '@turf/helpers';

export interface Geofence {
  id: string;
  name: string;
  ring: [number, number][]; // [lng, lat] pairs, GeoJSON order
}

/** Return the fences that contain the given lat/lng. */
export function fencesContaining(lat: number, lng: number, fences: Geofence[]): Geofence[] {
  const pt = point([lng, lat]); // GeoJSON is [lng, lat]
  return fences.filter((f) => {
    if (f.ring.length < 3) return false;
    try {
      const closed = [...f.ring, f.ring[0]]; // Turf polygons must be closed rings
      return booleanPointInPolygon(pt, polygon([closed]));
    } catch {
      return false;
    }
  });
}
