import { useEffect, useState } from 'react'
import { Polygon, Tooltip } from 'react-leaflet'
import type { AirspaceZone } from '../../services/airspaceApi'
import { AIRSPACE_COLORS, fetchActiveTFRs } from '../../services/airspaceApi'

interface Props {
  zones?: AirspaceZone[]
  visible?: boolean
  showLabels?: boolean
}

/**
 * Renders airspace restriction polygons on a Leaflet map.
 * Must be placed inside a <MapContainer>.
 */
export default function AirspaceLayer({ zones: propZones, visible = true, showLabels = true }: Props) {
  const [zones, setZones] = useState<AirspaceZone[]>(propZones ?? [])

  useEffect(() => {
    if (propZones) { setZones(propZones); return }
    fetchActiveTFRs().then(setZones).catch(() => {})
  }, [propZones])

  if (!visible || zones.length === 0) return null

  return (
    <>
      {zones.map(zone => {
        const color = AIRSPACE_COLORS[zone.type]
        return (
          <Polygon
            key={zone.id}
            positions={zone.coordinates}
            pathOptions={{
              color,
              fillColor: color,
              fillOpacity: 0.12,
              weight: 1.5,
              dashArray: zone.type === 'tfr' ? '6 3' : undefined,
            }}
          >
            {showLabels && (
              <Tooltip sticky>
                <div className="text-xs">
                  <div className="font-bold" style={{ color }}>{zone.name}</div>
                  <div className="capitalize text-gray-300">{zone.type.toUpperCase()}</div>
                  {zone.altitudeLowerFt !== undefined && (
                    <div>
                      Alt: {zone.altitudeLowerFt.toLocaleString()} –{' '}
                      {zone.altitudeUpperFt !== undefined
                        ? zone.altitudeUpperFt.toLocaleString()
                        : 'unlimited'} ft
                    </div>
                  )}
                  {zone.effectiveTo && (
                    <div>Expires: {zone.effectiveTo.toLocaleTimeString()}</div>
                  )}
                  {zone.reason && <div className="text-gray-400 italic">{zone.reason}</div>}
                </div>
              </Tooltip>
            )}
          </Polygon>
        )
      })}
    </>
  )
}

/** Convenience hook to load TFR data with auto-refresh (every 15 min). */
export function useAirspaceZones(enabled = true) {
  const [zones, setZones] = useState<AirspaceZone[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) { setZones([]); return }
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const data = await fetchActiveTFRs()
        if (!cancelled) setZones(data)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    const interval = setInterval(load, 15 * 60_000) // refresh every 15 min
    return () => { cancelled = true; clearInterval(interval) }
  }, [enabled])

  return { zones, loading }
}
