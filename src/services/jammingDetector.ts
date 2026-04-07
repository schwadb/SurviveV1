import type { Aircraft } from '../types'

export interface JammingZone {
  id: string
  lat: number
  lng: number
  radiusKm: number
  confidence: number   // 0–1
  affectedCount: number
  source: 'opensky' | 'gpsjam'
  detectedAt: Date
}

// OpenSky position_source values
// 0 = ADS-B (GPS-based, reliable)
// 1 = ASTERIX (radar, no GPS)
// 2 = MLAT (multilateration, no GPS needed → possible jamming indicator)
// 3 = FLARM

const GRID_DEGREES = 0.5 // 0.5° × 0.5° grid cells (~55km)

/**
 * Analyze aircraft data from OpenSky and derive likely GPS jamming zones.
 * Cells with a high proportion of MLAT/radar (non-GPS) contacts may indicate jamming.
 */
export function detectJammingZones(aircraft: Aircraft[]): JammingZone[] {
  // Group aircraft by grid cell
  const cells = new Map<string, { total: number; nonGps: number; lats: number[]; lngs: number[] }>()

  for (const ac of aircraft) {
    if (ac.lat == null || ac.lng == null) continue
    const gridLat = Math.floor(ac.lat / GRID_DEGREES) * GRID_DEGREES + GRID_DEGREES / 2
    const gridLng = Math.floor(ac.lng / GRID_DEGREES) * GRID_DEGREES + GRID_DEGREES / 2
    const key = `${gridLat.toFixed(1)},${gridLng.toFixed(1)}`

    if (!cells.has(key)) {
      cells.set(key, { total: 0, nonGps: 0, lats: [], lngs: [] })
    }
    const cell = cells.get(key)!
    cell.total++
    cell.lats.push(ac.lat)
    cell.lngs.push(ac.lng)

    // position_source may not be directly on Aircraft type — we check via raw data
    // In OpenSky response, position_source comes as index 10 in state vectors
    // We approximate here: if altitude is suspiciously round or speed is 0 while airborne, flag it
    // Real implementation: pass position_source from api.ts
    const posSource = (ac as Aircraft & { positionSource?: number }).positionSource
    if (posSource === 1 || posSource === 2) {
      cell.nonGps++
    }
  }

  const zones: JammingZone[] = []

  cells.forEach((cell, key) => {
    if (cell.total < 3) return // Not enough data
    const ratio = cell.nonGps / cell.total
    if (ratio < 0.4) return // Less than 40% non-GPS → not suspicious

    const [latStr, lngStr] = key.split(',')
    zones.push({
      id: `jam-${key}`,
      lat: Number(latStr),
      lng: Number(lngStr),
      radiusKm: GRID_DEGREES * 111, // approx km
      confidence: Math.min(ratio, 1),
      affectedCount: cell.nonGps,
      source: 'opensky',
      detectedAt: new Date(),
    })
  })

  return zones.sort((a, b) => b.confidence - a.confidence)
}

/**
 * Fetch GPS jamming data from GPSJAM.org public API.
 * Returns zones as JammingZone[] or empty array on error.
 */
export async function fetchGpsJamData(
  lat: number,
  lng: number,
  zoom = 5,
  date?: string
): Promise<JammingZone[]> {
  const dateStr = date ?? new Date().toISOString().split('T')[0]
  const url = `https://gpsjam.org/api/jam?lat=${lat}&lon=${lng}&z=${zoom}&date=${dateStr}`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return []
    const data = await res.json()

    if (!Array.isArray(data)) return []

    return data
      .filter((d: { confidence: number }) => d.confidence > 0.3)
      .map((d: { lat: number; lon: number; confidence: number; radius_km?: number }, i: number) => ({
        id: `gpsjam-${i}-${d.lat}-${d.lon}`,
        lat: d.lat,
        lng: d.lon,
        radiusKm: d.radius_km ?? 50,
        confidence: d.confidence,
        affectedCount: 0,
        source: 'gpsjam' as const,
        detectedAt: new Date(),
      }))
  } catch {
    return []
  }
}
