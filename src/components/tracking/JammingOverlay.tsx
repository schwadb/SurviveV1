import { useEffect, useState } from 'react'
import { Circle, Tooltip } from 'react-leaflet'
import type { JammingZone } from '../../services/jammingDetector'

interface Props {
  zones: JammingZone[]
  visible?: boolean
}

/**
 * Renders GPS jamming zones as semi-transparent circles on a Leaflet map.
 * Must be used inside a <MapContainer>.
 */
export default function JammingOverlay({ zones, visible = true }: Props) {
  if (!visible || zones.length === 0) return null

  return (
    <>
      {zones.map(zone => {
        const color = zone.confidence > 0.7 ? '#ef4444' : zone.confidence > 0.4 ? '#f97316' : '#facc15'
        return (
          <Circle
            key={zone.id}
            center={[zone.lat, zone.lng]}
            radius={zone.radiusKm * 1000}
            pathOptions={{
              color,
              fillColor: color,
              fillOpacity: 0.15 + zone.confidence * 0.2,
              weight: 1,
              dashArray: '4 4',
            }}
          >
            <Tooltip sticky>
              <div className="text-xs">
                <div className="font-bold text-orange-400">GPS Jamming Detected</div>
                <div>Confidence: {Math.round(zone.confidence * 100)}%</div>
                {zone.affectedCount > 0 && (
                  <div>Affected aircraft: {zone.affectedCount}</div>
                )}
                <div>Source: {zone.source}</div>
                <div>Radius: ~{zone.radiusKm.toFixed(0)} km</div>
              </div>
            </Tooltip>
          </Circle>
        )
      })}
    </>
  )
}

/**
 * Standalone jamming legend for the map UI.
 */
export function JammingLegend() {
  return (
    <div className="bg-gray-800 rounded p-2 text-xs space-y-1">
      <div className="font-semibold text-gray-300">GPS Jamming</div>
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-red-500 opacity-60" />
        <span className="text-gray-400">High (&gt;70%)</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-orange-500 opacity-60" />
        <span className="text-gray-400">Medium (40–70%)</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-yellow-400 opacity-60" />
        <span className="text-gray-400">Low (&lt;40%)</span>
      </div>
    </div>
  )
}

/**
 * Hook that loads GPSJAM.org data for a given center coordinate.
 */
export function useJammingZones(lat: number, lng: number, enabled = true) {
  const [zones, setZones] = useState<JammingZone[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) { setZones([]); return }
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const { fetchGpsJamData } = await import('../../services/jammingDetector')
        const data = await fetchGpsJamData(lat, lng)
        if (!cancelled) setZones(data)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [lat, lng, enabled])

  return { zones, loading }
}
