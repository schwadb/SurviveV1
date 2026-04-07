import { useState } from 'react'
import { MapContainer, TileLayer, Circle, Tooltip, useMap } from 'react-leaflet'
import { Anchor, Plane, Satellite, AlertTriangle, ChevronRight, Activity } from 'lucide-react'
import 'leaflet/dist/leaflet.css'

interface Chokepoint {
  id: string
  name: string
  region: string
  lat: number
  lng: number
  zoom: number
  focus: ('ships' | 'aircraft' | 'satellites')[]
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  description: string
  liveShips?: number
  liveAircraft?: number
  recentSatPasses?: number
  alerts?: string[]
}

const CHOKEPOINTS: Chokepoint[] = [
  {
    id: 'hormuz',
    name: 'Strait of Hormuz',
    region: 'Middle East',
    lat: 26.5,
    lng: 56.4,
    zoom: 8,
    focus: ['ships', 'aircraft'],
    riskLevel: 'high',
    description: '20% of global oil passes through here daily. Iran-US tensions routinely spike.',
    liveShips: 47,
    liveAircraft: 12,
    recentSatPasses: 3,
    alerts: ['Iranian IRGC vessel shadowing tanker', 'US carrier group in vicinity'],
  },
  {
    id: 'suez',
    name: 'Suez Canal',
    region: 'North Africa / Levant',
    lat: 30.5,
    lng: 32.3,
    zoom: 9,
    focus: ['ships'],
    riskLevel: 'medium',
    description: '12% of global trade tonnage. Houthi disruptions have rerouted traffic.',
    liveShips: 23,
    liveAircraft: 8,
    recentSatPasses: 2,
    alerts: ['Extended queue: 18 vessels waiting'],
  },
  {
    id: 'taiwan',
    name: 'Taiwan Strait',
    region: 'Indo-Pacific',
    lat: 24.5,
    lng: 120.0,
    zoom: 7,
    focus: ['ships', 'aircraft', 'satellites'],
    riskLevel: 'critical',
    description: 'Critical semiconductor supply chain artery. PLA military exercises ongoing.',
    liveShips: 61,
    liveAircraft: 19,
    recentSatPasses: 5,
    alerts: ['PLA J-16 sorties across median line', 'PLAN frigate 85km from 12nm limit'],
  },
  {
    id: 'blacksea',
    name: 'Black Sea',
    region: 'Eastern Europe',
    lat: 43.0,
    lng: 33.0,
    zoom: 6,
    focus: ['ships', 'aircraft'],
    riskLevel: 'critical',
    description: 'Grain corridor + conflict zone. Ukrainian drone attacks on Russian fleet.',
    liveShips: 31,
    liveAircraft: 6,
    recentSatPasses: 4,
    alerts: ['AIS blackout: 4 vessels dark', 'GPS jamming detected region-wide'],
  },
  {
    id: 'scs',
    name: 'South China Sea',
    region: 'Indo-Pacific',
    lat: 12.0,
    lng: 114.0,
    zoom: 6,
    focus: ['ships', 'satellites'],
    riskLevel: 'high',
    description: '$3.4T in trade annually. Disputed islands with active PLA militarization.',
    liveShips: 89,
    liveAircraft: 22,
    recentSatPasses: 6,
    alerts: ['Chinese CCG vessels near Scarborough Shoal'],
  },
  {
    id: 'bosphorus',
    name: 'Bosphorus Strait',
    region: 'Eastern Europe',
    lat: 41.1,
    lng: 29.0,
    zoom: 10,
    focus: ['ships'],
    riskLevel: 'medium',
    description: 'Only Black Sea exit. Turkey controls access under Montreux Convention.',
    liveShips: 14,
    liveAircraft: 5,
    recentSatPasses: 1,
    alerts: [],
  },
  {
    id: 'gibraltar',
    name: 'Strait of Gibraltar',
    region: 'Southern Europe / North Africa',
    lat: 35.9,
    lng: -5.5,
    zoom: 9,
    focus: ['ships', 'aircraft'],
    riskLevel: 'low',
    description: 'Atlantic-Mediterranean gateway. High submarine and NATO activity.',
    liveShips: 28,
    liveAircraft: 9,
    recentSatPasses: 2,
    alerts: [],
  },
  {
    id: 'malacca',
    name: 'Strait of Malacca',
    region: 'Southeast Asia',
    lat: 3.0,
    lng: 101.5,
    zoom: 7,
    focus: ['ships'],
    riskLevel: 'medium',
    description: 'Busiest shipping lane. Piracy incidents and regional tensions.',
    liveShips: 112,
    liveAircraft: 15,
    recentSatPasses: 3,
    alerts: ['Piracy alert issued: eastern approach'],
  },
]

const RISK_COLORS = {
  low: '#22c55e',
  medium: '#facc15',
  high: '#f97316',
  critical: '#ef4444',
}

const RISK_BADGE: Record<string, string> = {
  low: 'badge-green',
  medium: 'badge-yellow',
  high: 'badge-red',
  critical: 'badge badge-red',
}

function MapFlyTo({ lat, lng, zoom }: { lat: number; lng: number; zoom: number }) {
  const map = useMap()
  map.flyTo([lat, lng], zoom, { duration: 1.5 })
  return null
}

export default function Chokepoints() {
  const [selected, setSelected] = useState<Chokepoint | null>(null)
  const [mapTarget, setMapTarget] = useState<Chokepoint | null>(null)
  const [filterRisk, setFilterRisk] = useState<string>('all')

  const filtered = CHOKEPOINTS.filter(
    c => filterRisk === 'all' || c.riskLevel === filterRisk
  )

  function handleSelect(cp: Chokepoint) {
    setSelected(cp)
    setMapTarget(cp)
  }

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="section-title">Strategic Chokepoints</h1>
          <p className="text-sm text-gray-400 mt-1">
            Pre-configured monitoring views for critical global maritime and air corridors
          </p>
        </div>
        <div className="flex gap-2">
          {['all', 'critical', 'high', 'medium', 'low'].map(r => (
            <button
              key={r}
              onClick={() => setFilterRisk(r)}
              className={`text-xs px-2 py-1 rounded capitalize transition-colors ${
                filterRisk === r
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              {r === 'all' ? 'All' : r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 flex-1 min-h-0">
        {/* Chokepoint cards */}
        <div className="xl:col-span-1 space-y-3 overflow-y-auto pr-1">
          {filtered.map(cp => (
            <div
              key={cp.id}
              onClick={() => handleSelect(cp)}
              className={`card cursor-pointer transition-all hover:border-blue-500 ${
                selected?.id === cp.id ? 'border-blue-500' : ''
              }`}
            >
              <div className="p-3">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-semibold text-sm">{cp.name}</div>
                    <div className="text-xs text-gray-400">{cp.region}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`badge ${RISK_BADGE[cp.riskLevel]} capitalize text-xs`}>
                      {cp.riskLevel}
                    </span>
                    <ChevronRight size={14} className="text-gray-500" />
                  </div>
                </div>

                <p className="text-xs text-gray-400 mb-3 leading-relaxed">{cp.description}</p>

                <div className="flex gap-4 text-xs">
                  {cp.focus.includes('ships') && (
                    <div className="flex items-center gap-1 text-blue-400">
                      <Anchor size={12} />
                      <span>{cp.liveShips ?? '—'} ships</span>
                    </div>
                  )}
                  {cp.focus.includes('aircraft') && (
                    <div className="flex items-center gap-1 text-green-400">
                      <Plane size={12} />
                      <span>{cp.liveAircraft ?? '—'} aircraft</span>
                    </div>
                  )}
                  {cp.focus.includes('satellites') && (
                    <div className="flex items-center gap-1 text-purple-400">
                      <Satellite size={12} />
                      <span>{cp.recentSatPasses ?? '—'} sat passes</span>
                    </div>
                  )}
                </div>

                {cp.alerts && cp.alerts.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {cp.alerts.map((alert, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-xs text-orange-400">
                        <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                        <span>{alert}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Map + detail panel */}
        <div className="xl:col-span-2 flex flex-col gap-3 min-h-0">
          {/* Leaflet map */}
          <div className="flex-1 min-h-64 rounded overflow-hidden border border-gray-700">
            <MapContainer
              center={[20, 50]}
              zoom={3}
              style={{ height: '100%', width: '100%' }}
              className="bg-gray-900"
            >
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://carto.com">CARTO</a>'
              />
              {mapTarget && (
                <MapFlyTo lat={mapTarget.lat} lng={mapTarget.lng} zoom={mapTarget.zoom} />
              )}
              {CHOKEPOINTS.map(cp => (
                <Circle
                  key={cp.id}
                  center={[cp.lat, cp.lng]}
                  radius={80_000}
                  pathOptions={{
                    color: RISK_COLORS[cp.riskLevel],
                    fillColor: RISK_COLORS[cp.riskLevel],
                    fillOpacity: selected?.id === cp.id ? 0.3 : 0.1,
                    weight: selected?.id === cp.id ? 2 : 1,
                  }}
                  eventHandlers={{ click: () => handleSelect(cp) }}
                >
                  <Tooltip permanent={selected?.id === cp.id} direction="top">
                    <span className="text-xs font-semibold">{cp.name}</span>
                  </Tooltip>
                </Circle>
              ))}
            </MapContainer>
          </div>

          {/* Selected chokepoint detail */}
          {selected && (
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{selected.name}</h3>
                <div className="flex items-center gap-2">
                  <Activity size={14} className="text-red-400 animate-pulse" />
                  <span className="text-xs text-red-400">MONITORING ACTIVE</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-gray-800 rounded p-2">
                  <div className="text-lg font-bold text-blue-400">{selected.liveShips ?? 0}</div>
                  <div className="text-xs text-gray-400">Live Ships</div>
                </div>
                <div className="bg-gray-800 rounded p-2">
                  <div className="text-lg font-bold text-green-400">{selected.liveAircraft ?? 0}</div>
                  <div className="text-xs text-gray-400">Aircraft</div>
                </div>
                <div className="bg-gray-800 rounded p-2">
                  <div className="text-lg font-bold text-purple-400">{selected.recentSatPasses ?? 0}</div>
                  <div className="text-xs text-gray-400">Sat Passes (24h)</div>
                </div>
              </div>

              {selected.alerts && selected.alerts.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                    Active Alerts
                  </div>
                  {selected.alerts.map((alert, i) => (
                    <div key={i} className="flex items-start gap-2 bg-orange-500/10 border border-orange-500/30 rounded p-2">
                      <AlertTriangle size={12} className="text-orange-400 shrink-0 mt-0.5" />
                      <span className="text-xs text-orange-300">{alert}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="text-xs text-gray-500">
                Coordinates: {selected.lat}°N, {selected.lng}°E — Data is illustrative. Connect live APIs for real-time feeds.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
