/* eslint-disable @typescript-eslint/no-explicit-any */
// satellite.js v4 — pure JS, browser-compatible orbital mechanics

let satLib: any = null

async function getSatLib(): Promise<any> {
  if (satLib) return satLib
  satLib = await import('satellite.js')
  return satLib
}

export interface OrbitalPosition {
  lat: number
  lng: number
  altitudeKm: number
  velocity: number // km/s
}

export interface GroundTrackPoint {
  lat: number
  lng: number
  time: Date
}

export interface SatellitePass {
  riseTime: Date
  setTime: Date
  maxElevationTime: Date
  maxElevationDeg: number
  durationMinutes: number
}

/** Preload library so sync calls work immediately after. */
export async function preloadSatLib(): Promise<void> {
  await getSatLib()
}

/**
 * Synchronous position computation — only works after preloadSatLib() resolves.
 */
export function computePositionFromTLE(
  tleLine1: string,
  tleLine2: string,
  date: Date = new Date()
): OrbitalPosition | null {
  if (!satLib) return null
  try {
    const satrec = satLib.twoline2satrec(tleLine1, tleLine2)
    const posVel = satLib.propagate(satrec, date)
    if (!posVel.position || posVel.position === true) return null
    const gmst = satLib.gstime(date)
    const geo = satLib.eciToGeodetic(posVel.position, gmst)
    let velMag = 0
    if (posVel.velocity && posVel.velocity !== true) {
      velMag = Math.sqrt(posVel.velocity.x ** 2 + posVel.velocity.y ** 2 + posVel.velocity.z ** 2)
    }
    return {
      lat: satLib.degreesLat(geo.latitude),
      lng: satLib.degreesLong(geo.longitude),
      altitudeKm: geo.height,
      velocity: velMag,
    }
  } catch {
    return null
  }
}

/**
 * Async version — works before preload completes.
 */
export async function computePositionFromTLEAsync(
  tleLine1: string,
  tleLine2: string,
  date: Date = new Date()
): Promise<OrbitalPosition | null> {
  try {
    const sat = await getSatLib()
    const satrec = sat.twoline2satrec(tleLine1, tleLine2)
    const posVel = sat.propagate(satrec, date)
    if (!posVel.position || posVel.position === true) return null
    const gmst = sat.gstime(date)
    const geo = sat.eciToGeodetic(posVel.position, gmst)
    let velMag = 0
    if (posVel.velocity && posVel.velocity !== true) {
      velMag = Math.sqrt(posVel.velocity.x ** 2 + posVel.velocity.y ** 2 + posVel.velocity.z ** 2)
    }
    return {
      lat: sat.degreesLat(geo.latitude),
      lng: sat.degreesLong(geo.longitude),
      altitudeKm: geo.height,
      velocity: velMag,
    }
  } catch {
    return null
  }
}

/**
 * Compute orbital ground track for the next `minutes` minutes.
 * Returns lat/lng points every 30 seconds.
 */
export async function computeGroundTrack(
  tleLine1: string,
  tleLine2: string,
  minutes = 90
): Promise<GroundTrackPoint[]> {
  try {
    const sat = await getSatLib()
    const satrec = sat.twoline2satrec(tleLine1, tleLine2)
    const now = Date.now()
    const points: GroundTrackPoint[] = []

    for (let t = 0; t <= minutes * 60_000; t += 30_000) {
      const date = new Date(now + t)
      const posVel = sat.propagate(satrec, date)
      if (!posVel.position || posVel.position === true) continue
      const gmst = sat.gstime(date)
      const geo = sat.eciToGeodetic(posVel.position, gmst)
      points.push({ lat: sat.degreesLat(geo.latitude), lng: sat.degreesLong(geo.longitude), time: date })
    }
    return points
  } catch {
    return []
  }
}

/** Convert degrees to radians. */
function toRad(deg: number) { return (deg * Math.PI) / 180 }
/** Convert radians to degrees. */
function toDeg(rad: number) { return (rad * 180) / Math.PI }

/**
 * Calculate satellite elevation angle from observer in degrees.
 * Returns null if below horizon or calculation fails.
 */
export async function getElevationAngle(
  observerLat: number,
  observerLng: number,
  observerAltKm: number,
  tleLine1: string,
  tleLine2: string,
  date: Date = new Date()
): Promise<number | null> {
  try {
    const sat = await getSatLib()
    const satrec = sat.twoline2satrec(tleLine1, tleLine2)
    const posVel = sat.propagate(satrec, date)
    if (!posVel.position || posVel.position === true) return null

    const gmst = sat.gstime(date)
    const observerGd = {
      longitude: toRad(observerLng),
      latitude: toRad(observerLat),
      height: observerAltKm,
    }
    const positionEcf = sat.eciToEcf(posVel.position, gmst)
    const lookAngles = sat.ecfToLookAngles(observerGd, positionEcf)
    const elevDeg = toDeg(lookAngles.elevation)
    return elevDeg >= 0 ? elevDeg : null
  } catch {
    return null
  }
}

/**
 * Find upcoming satellite passes over a location within `hoursAhead`.
 */
export async function findUpcomingPasses(
  tleLine1: string,
  tleLine2: string,
  observerLat: number,
  observerLng: number,
  observerAltKm = 0,
  hoursAhead = 24
): Promise<SatellitePass[]> {
  try {
    const sat = await getSatLib()
    const satrec = sat.twoline2satrec(tleLine1, tleLine2)
    const observerGd = {
      longitude: toRad(observerLng),
      latitude: toRad(observerLat),
      height: observerAltKm,
    }

    const passes: SatellitePass[] = []
    const now = Date.now()
    const endMs = now + hoursAhead * 3_600_000
    let inPass = false
    let riseTime: Date | null = null
    let maxElev = 0
    let maxElevTime: Date | null = null

    for (let t = now; t <= endMs; t += 10_000) {
      const date = new Date(t)
      const posVel = sat.propagate(satrec, date)
      if (!posVel.position || posVel.position === true) continue
      const gmst = sat.gstime(date)
      const positionEcf = sat.eciToEcf(posVel.position, gmst)
      const lookAngles = sat.ecfToLookAngles(observerGd, positionEcf)
      const elevDeg = toDeg(lookAngles.elevation)

      if (elevDeg > 0) {
        if (!inPass) { inPass = true; riseTime = date; maxElev = elevDeg; maxElevTime = date }
        else if (elevDeg > maxElev) { maxElev = elevDeg; maxElevTime = date }
      } else if (inPass) {
        inPass = false
        if (riseTime && maxElevTime) {
          const setTime = new Date(t)
          passes.push({
            riseTime, setTime, maxElevationTime: maxElevTime, maxElevationDeg: maxElev,
            durationMinutes: (setTime.getTime() - riseTime.getTime()) / 60_000,
          })
        }
        riseTime = null; maxElev = 0; maxElevTime = null
      }
    }

    return passes
  } catch {
    return []
  }
}
