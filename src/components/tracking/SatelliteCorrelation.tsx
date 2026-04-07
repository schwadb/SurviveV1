import { useState, useEffect } from 'react'
import { Satellite, MapPin, Clock, ArrowUp, AlertTriangle } from 'lucide-react'
import type { Satellite as SatelliteType } from '../../types'
import { getElevationAngle } from '../../services/orbitEngine'

interface Props {
  satellites: SatelliteType[]
  eventLat: number | null
  eventLng: number | null
  eventTime?: Date
  windowMinutes?: number
  onClear?: () => void
}

interface CorrelatedSatellite {
  satellite: SatelliteType
  elevationDeg: number
  distanceKm: number
  wasOverhead: boolean
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export default function SatelliteCorrelation({
  satellites,
  eventLat,
  eventLng,
  eventTime,
  windowMinutes = 30,
  onClear,
}: Props) {
  const [expanded, setExpanded] = useState(true)
  const [correlated, setCorrelated] = useState<CorrelatedSatellite[]>([])
  const [computing, setComputing] = useState(false)

  useEffect(() => {
    if (eventLat == null || eventLng == null) { setCorrelated([]); return }

    let cancelled = false
    setComputing(true)

    async function compute() {
      const time = eventTime ?? new Date()
      const results: CorrelatedSatellite[] = []

      for (const sat of satellites) {
        if (cancelled) break
        const tleLine1 = (sat as SatelliteType & { tleLine1?: string }).tleLine1
        const tleLine2 = (sat as SatelliteType & { tleLine2?: string }).tleLine2
        const dist = haversineKm(eventLat!, eventLng!, sat.lat, sat.lng)

        if (tleLine1 && tleLine2) {
          const elev = await getElevationAngle(eventLat!, eventLng!, 0, tleLine1, tleLine2, time)
          if (elev !== null && elev > 5) {
            results.push({ satellite: sat, elevationDeg: elev, distanceKm: dist, wasOverhead: true })
            continue
          }

          // Check window
          let wasOverheadInWindow = false
          const windowStart = new Date(time.getTime() - windowMinutes * 60_000)
          for (let t = windowStart.getTime(); t <= time.getTime(); t += 2 * 60_000) {
            if (cancelled) break
            const e = await getElevationAngle(eventLat!, eventLng!, 0, tleLine1, tleLine2, new Date(t))
            if (e !== null && e > 5) { wasOverheadInWindow = true; break }
          }
          if (wasOverheadInWindow) {
            results.push({ satellite: sat, elevationDeg: 0, distanceKm: dist, wasOverhead: false })
          }
        } else {
          // Geometric fallback using current known position
          const altKm = sat.altitude
          const horizonKm = Math.sqrt(2 * 6371 * altKm + altKm ** 2)
          if (dist < horizonKm) {
            const elevDeg = (Math.atan2(altKm, dist) * 180) / Math.PI
            results.push({ satellite: sat, elevationDeg: elevDeg, distanceKm: dist, wasOverhead: true })
          }
        }
      }

      if (!cancelled) {
        setCorrelated(results.sort((a, b) => b.elevationDeg - a.elevationDeg))
        setComputing(false)
      }
    }

    compute()
    return () => { cancelled = true }
  }, [satellites, eventLat, eventLng, eventTime, windowMinutes])

  if (eventLat == null || eventLng == null) {
    return (
      <div className="card p-4 text-center text-gray-400 text-sm">
        <MapPin className="inline mr-2" size={16} />
        Click on the map to correlate satellites to a location
      </div>
    )
  }

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <div className="flex items-center gap-2">
          <Satellite size={18} className="text-blue-400" />
          <span className="text-sm font-semibold">Satellite Correlation</span>
          {correlated.length > 0 && (
            <span className="badge badge-blue">{correlated.length} overhead</span>
          )}
          {computing && <span className="text-xs text-gray-500">Computing…</span>}
        </div>
        <div className="flex items-center gap-2">
          {onClear && (
            <button
              onClick={e => { e.stopPropagation(); onClear() }}
              className="text-xs text-gray-400 hover:text-white transition-colors"
            >
              Clear
            </button>
          )}
          <span className="text-gray-400">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div className="p-3 space-y-3">
          <div className="text-xs text-gray-400 flex items-center gap-2">
            <MapPin size={12} />
            {eventLat.toFixed(4)}°, {eventLng.toFixed(4)}°
            {eventTime && (
              <>
                <Clock size={12} className="ml-2" />
                {eventTime.toLocaleTimeString()}
              </>
            )}
          </div>

          {correlated.length === 0 && !computing ? (
            <div className="text-sm text-gray-500 flex items-center gap-2">
              <AlertTriangle size={14} />
              No tracked satellites visible over this location
            </div>
          ) : (
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th>Satellite</th>
                  <th>Type</th>
                  <th>Elevation</th>
                  <th>Distance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {correlated.map(({ satellite, elevationDeg, distanceKm, wasOverhead }) => (
                  <tr key={satellite.id}>
                    <td className="font-mono text-xs">{satellite.name}</td>
                    <td>
                      <span className="badge badge-blue">{satellite.type}</span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <ArrowUp size={12} className="text-green-400" />
                        <span className="font-mono text-xs">
                          {wasOverhead ? `${elevationDeg.toFixed(1)}°` : '—'}
                        </span>
                      </div>
                    </td>
                    <td className="font-mono text-xs">
                      {distanceKm < 1000
                        ? `${distanceKm.toFixed(0)} km`
                        : `${(distanceKm / 1000).toFixed(1)}k km`}
                    </td>
                    <td>
                      <span className={`badge ${wasOverhead ? 'badge-green' : 'badge-yellow'}`}>
                        {wasOverhead ? 'Overhead' : 'In window'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="text-xs text-gray-500">
            Showing satellites visible (&gt;5° elevation) at event time or within ±{windowMinutes} min window.
          </p>
        </div>
      )}
    </div>
  )
}
