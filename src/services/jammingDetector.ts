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

    // positionSource: 0=ADS-B (GPS), 1=ASTERIX (radar), 2=MLAT, 3=FLARM
    // Values 1 and 2 do not rely on GPS — elevated ratio suggests GPS jamming
    if (ac.positionSource === 1 || ac.positionSource === 2) {
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
 * Falls back to an empty array gracefully on CORS or network errors.
 * Note: GPSJAM.org does not set CORS headers for all origins. If this fails
 * in production, route through a lightweight backend proxy at /api/gpsjam.
 */
export async function fetchGpsJamData(
  lat: number,
  lng: number,
  zoom = 5,
  date?: string
): Promise<JammingZone[]> {
  const dateStr = date ?? new Date().toISOString().split('T')[0]
  // Try direct API first; fall back silently — local OpenSky detection still runs.
  const urls = [
    `https://gpsjam.org/api/jam?lat=${lat}&lon=${lng}&z=${zoom}&date=${dateStr}`,
    // Proxy path for deployments with a backend (no-op if not available)
    `/api/gpsjam?lat=${lat}&lon=${lng}&z=${zoom}&date=${dateStr}`,
  ]

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        mode: url.startsWith('/') ? 'same-origin' : 'cors',
      })
      if (!res.ok) continue
      const data = await res.json()
      if (!Array.isArray(data)) continue

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
      // CORS block or timeout — try next URL or give up
    }
  }
  return []
}

/**
 * Combined detector: merges OpenSky-derived zones with GPSJAM external data.
 * Deduplicates overlapping zones from the same grid cell.
 */
export async function detectAllJammingZones(
  aircraft: Aircraft[],
  mapLat: number,
  mapLng: number
): Promise<JammingZone[]> {
  const [openSkyZones, gpsjamZones] = await Promise.all([
    Promise.resolve(detectJammingZones(aircraft)),
    fetchGpsJamData(mapLat, mapLng),
  ])

  // Merge: GPSJAM zones take priority where they overlap with OpenSky zones
  const merged = [...gpsjamZones]
  for (const oz of openSkyZones) {
    const overlaps = gpsjamZones.some(
      gz => Math.abs(gz.lat - oz.lat) < 0.5 && Math.abs(gz.lng - oz.lng) < 0.5
    )
    if (!overlaps) merged.push(oz)
  }
  return merged.sort((a, b) => b.confidence - a.confidence)
}
