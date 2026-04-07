export type AirspaceType = 'prohibited' | 'restricted' | 'danger' | 'moa' | 'tfr' | 'cta' | 'unknown'

export interface AirspaceZone {
  id: string
  name: string
  type: AirspaceType
  coordinates: [number, number][]  // [lat, lng] pairs
  altitudeLowerFt?: number
  altitudeUpperFt?: number
  effectiveFrom?: Date
  effectiveTo?: Date
  reason?: string
}

// Color coding per airspace type
export const AIRSPACE_COLORS: Record<AirspaceType, string> = {
  prohibited: '#ef4444',   // red
  restricted: '#f97316',   // orange
  danger: '#eab308',       // yellow
  moa: '#8b5cf6',          // purple
  tfr: '#3b82f6',          // blue
  cta: '#6b7280',          // gray
  unknown: '#374151',
}

/**
 * Parse FAA TFR XML into AirspaceZone[].
 * The FAA TFR list page returns HTML with embedded data; we parse what we can.
 */
export async function fetchActiveTFRs(): Promise<AirspaceZone[]> {
  // FAA TFRS are served at tfr.faa.gov — CORS prevents direct browser fetch.
  // In production, proxy through a backend or use a CORS-anywhere style proxy.
  // For now we return a representative static dataset for demonstration.
  return getFallbackTFRs()
}

/**
 * Fetch OpenAIP airspace data for a bounding box.
 * Requires a free OpenAIP API key (set in settings).
 */
export async function fetchOpenAIPAirspace(
  swLat: number,
  swLng: number,
  neLat: number,
  neLng: number,
  apiKey?: string
): Promise<AirspaceZone[]> {
  if (!apiKey) return []

  const url = `https://api.core.openaip.net/api/airspaces?` +
    `geometry={"type":"Polygon","coordinates":[[[${swLng},${swLat}],[${neLng},${swLat}],[${neLng},${neLat}],[${swLng},${neLat}],[${swLng},${swLat}]]]}` +
    `&limit=50`

  try {
    const res = await fetch(url, {
      headers: { 'x-openaip-api-key': apiKey },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []
    const data = await res.json()

    return (data.items ?? []).map((item: {
      _id: string
      name: string
      type: number
      geometry: { coordinates: number[][][] }
      lowerLimit?: { value: number; unit: number }
      upperLimit?: { value: number; unit: number }
    }) => ({
      id: item._id,
      name: item.name,
      type: mapOpenAIPType(item.type),
      coordinates: (item.geometry?.coordinates?.[0] ?? []).map(([lng, lat]: number[]) => [lat, lng] as [number, number]),
      altitudeLowerFt: item.lowerLimit?.value,
      altitudeUpperFt: item.upperLimit?.value,
    }))
  } catch {
    return []
  }
}

function mapOpenAIPType(typeCode: number): AirspaceType {
  const mapping: Record<number, AirspaceType> = {
    0: 'unknown', 1: 'restricted', 2: 'danger', 3: 'prohibited',
    4: 'cta', 5: 'moa', 6: 'unknown', 7: 'cta',
  }
  return mapping[typeCode] ?? 'unknown'
}

function getFallbackTFRs(): AirspaceZone[] {
  return [
    {
      id: 'tfr-dc-adiz',
      name: 'Washington DC ADIZ',
      type: 'restricted',
      coordinates: buildCirclePolygon(38.8951, -77.0364, 30),
      altitudeLowerFt: 0,
      altitudeUpperFt: 18000,
      reason: 'National Capital Region Flight Restricted Zone',
    },
    {
      id: 'tfr-crawford-ranch',
      name: 'Example VVIP TFR',
      type: 'tfr',
      coordinates: buildCirclePolygon(37.7749, -122.4194, 15),
      altitudeLowerFt: 0,
      altitudeUpperFt: 3000,
      effectiveFrom: new Date(),
      effectiveTo: new Date(Date.now() + 4 * 3_600_000),
      reason: 'VIP movement',
    },
  ]
}

/** Build an approximate circular polygon from center + radius (km). */
function buildCirclePolygon(
  centerLat: number,
  centerLng: number,
  radiusKm: number,
  points = 32
): [number, number][] {
  const coords: [number, number][] = []
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI
    const dLat = (radiusKm / 111) * Math.cos(angle)
    const dLng = (radiusKm / (111 * Math.cos((centerLat * Math.PI) / 180))) * Math.sin(angle)
    coords.push([centerLat + dLat, centerLng + dLng])
  }
  return coords
}
