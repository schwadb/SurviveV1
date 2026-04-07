import { useState, useCallback } from 'react'
import { Brain, AlertTriangle, Satellite, Plane, Anchor, Zap, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'
import type { Aircraft, Ship } from '../../types'
import type { JammingZone } from '../../services/jammingDetector'

interface AnomalySignal {
  type: 'satellite_overhead' | 'aircraft_divert' | 'ship_dark' | 'gps_jam' | 'airspace_violation'
  count: number
  region?: string
  detail?: string
}

interface Props {
  aircraft?: Aircraft[]
  ships?: Ship[]
  jammingZones?: JammingZone[]
  perplexityApiKey?: string
  eventRegion?: string
  onSearch?: (query: string) => void
}

interface SummaryResult {
  text: string
  signals: AnomalySignal[]
  timestamp: Date
  confidenceLevel: 'low' | 'medium' | 'high'
}

function detectAnomalies(
  aircraft: Aircraft[],
  ships: Ship[],
  jammingZones: JammingZone[]
): AnomalySignal[] {
  const signals: AnomalySignal[] = []

  const emergencyAircraft = aircraft.filter(a => a.emergency)
  if (emergencyAircraft.length > 0) {
    signals.push({
      type: 'aircraft_divert',
      count: emergencyAircraft.length,
      detail: `Emergency squawk: ${emergencyAircraft.map(a => a.callsign).join(', ')}`,
    })
  }

  const darkShips = ships.filter(s => s.status?.toLowerCase().includes('not defined') || !s.lat)
  if (darkShips.length >= 2) {
    signals.push({
      type: 'ship_dark',
      count: darkShips.length,
      detail: `Vessels with unusual AIS status: ${darkShips.map(s => s.name).join(', ')}`,
    })
  }

  const highConfidenceJam = jammingZones.filter(z => z.confidence > 0.6)
  if (highConfidenceJam.length > 0) {
    signals.push({
      type: 'gps_jam',
      count: highConfidenceJam.length,
      detail: `High-confidence jamming zones detected`,
    })
  }

  return signals
}

function buildPerplexityPrompt(signals: AnomalySignal[], region?: string): string {
  const lines: string[] = []

  if (region) lines.push(`Region of interest: ${region}.`)
  lines.push('In the past 2 hours, the following anomalies were detected using open-source intelligence:')

  for (const s of signals) {
    switch (s.type) {
      case 'aircraft_divert':
        lines.push(`- ${s.count} aircraft declared emergency or deviated from filed routes. ${s.detail ?? ''}`)
        break
      case 'ship_dark':
        lines.push(`- ${s.count} vessels went dark or have unusual AIS status. ${s.detail ?? ''}`)
        break
      case 'gps_jam':
        lines.push(`- GPS jamming detected in ${s.count} zone(s). ${s.detail ?? ''}`)
        break
      case 'satellite_overhead':
        lines.push(`- ${s.count} reconnaissance satellites passed overhead. ${s.detail ?? ''}`)
        break
      case 'airspace_violation':
        lines.push(`- ${s.count} aircraft entered restricted airspace. ${s.detail ?? ''}`)
        break
    }
  }

  lines.push(
    'Using only publicly available open-source intelligence, summarize the likely geopolitical significance of this pattern. ' +
    'Be concise and factual. Do not speculate beyond what the data indicates.'
  )

  return lines.join('\n')
}

const SIGNAL_ICONS: Record<AnomalySignal['type'], React.ReactNode> = {
  satellite_overhead: <Satellite size={14} className="text-purple-400" />,
  aircraft_divert: <Plane size={14} className="text-yellow-400" />,
  ship_dark: <Anchor size={14} className="text-blue-400" />,
  gps_jam: <Zap size={14} className="text-orange-400" />,
  airspace_violation: <AlertTriangle size={14} className="text-red-400" />,
}

const SIGNAL_LABELS: Record<AnomalySignal['type'], string> = {
  satellite_overhead: 'Satellite Passes',
  aircraft_divert: 'Aircraft Anomaly',
  ship_dark: 'AIS Dark Ships',
  gps_jam: 'GPS Jamming',
  airspace_violation: 'Airspace Violation',
}

export default function IntelSummary({
  aircraft = [],
  ships = [],
  jammingZones = [],
  perplexityApiKey,
  eventRegion,
  onSearch,
}: Props) {
  const [result, setResult] = useState<SummaryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const signals = detectAnomalies(aircraft, ships, jammingZones)
  const hasAnomalies = signals.length > 0

  const generateSummary = useCallback(async () => {
    if (signals.length === 0) return
    setLoading(true)
    setError(null)

    const prompt = buildPerplexityPrompt(signals, eventRegion)

    if (onSearch) {
      onSearch(prompt)
    }

    if (!perplexityApiKey) {
      // Fallback: generate a structured local summary without AI
      const confidence: SummaryResult['confidenceLevel'] =
        signals.length >= 3 ? 'high' : signals.length >= 2 ? 'medium' : 'low'

      setResult({
        signals,
        confidenceLevel: confidence,
        timestamp: new Date(),
        text:
          `**Pattern detected:** ${signals.length} corroborating signal${signals.length > 1 ? 's' : ''} detected.\n\n` +
          signals.map(s => `• **${SIGNAL_LABELS[s.type]}** (${s.count}): ${s.detail ?? ''}`).join('\n') +
          '\n\n_Add a Perplexity API key in Settings for AI-generated geopolitical analysis._',
      })
      setLoading(false)
      return
    }

    try {
      const { perplexitySearch } = await import('../../services/api')
      const { content } = await perplexitySearch(prompt, perplexityApiKey)
      const confidence: SummaryResult['confidenceLevel'] =
        signals.length >= 3 ? 'high' : signals.length >= 2 ? 'medium' : 'low'
      setResult({ text: content, signals, confidenceLevel: confidence, timestamp: new Date() })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate summary')
    } finally {
      setLoading(false)
    }
  }, [signals, eventRegion, perplexityApiKey, onSearch])

  return (
    <div className="card">
      <div
        className="card-header flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-2">
          <Brain size={18} className="text-purple-400" />
          <span className="text-sm font-semibold">Event Correlation Intelligence</span>
          {hasAnomalies && (
            <span className="badge badge-red">{signals.length} signal{signals.length > 1 ? 's' : ''}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={e => { e.stopPropagation(); generateSummary() }}
            disabled={loading || !hasAnomalies}
            className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50"
          >
            {loading ? <RefreshCw size={12} className="animate-spin" /> : <Brain size={12} />}
            {loading ? 'Analyzing…' : 'Analyze'}
          </button>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {expanded && (
        <div className="p-3 space-y-3">
          {/* Anomaly signals */}
          <div className="space-y-1.5">
            <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
              Detected Signals
            </div>
            {signals.length === 0 ? (
              <div className="text-sm text-gray-500 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                No anomalies detected — all nominal
              </div>
            ) : (
              signals.map((s, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 bg-gray-800 rounded p-2"
                >
                  {SIGNAL_ICONS[s.type]}
                  <div className="text-xs">
                    <span className="font-semibold text-gray-300">{SIGNAL_LABELS[s.type]}</span>
                    <span className="text-gray-500 ml-2">×{s.count}</span>
                    {s.detail && <p className="text-gray-400 mt-0.5">{s.detail}</p>}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="text-xs text-red-400 flex items-center gap-2">
              <AlertTriangle size={12} />
              {error}
            </div>
          )}

          {/* AI Summary */}
          {result && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                  Intelligence Summary
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`badge text-xs ${
                      result.confidenceLevel === 'high'
                        ? 'badge-red'
                        : result.confidenceLevel === 'medium'
                        ? 'badge-yellow'
                        : 'badge-green'
                    }`}
                  >
                    {result.confidenceLevel.toUpperCase()} SIGNIFICANCE
                  </span>
                  <span className="text-xs text-gray-500">
                    {result.timestamp.toLocaleTimeString()}
                  </span>
                </div>
              </div>
              <div className="bg-gray-800 rounded p-3 text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                {result.text}
              </div>
            </div>
          )}

          {!hasAnomalies && (
            <p className="text-xs text-gray-500">
              Analysis triggers automatically when multiple corroborating signals are detected (emergency aircraft, dark ships, GPS jamming).
            </p>
          )}
        </div>
      )}
    </div>
  )
}
