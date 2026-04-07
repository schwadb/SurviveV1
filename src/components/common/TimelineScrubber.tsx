import { useCallback } from 'react'
import { Play, Pause, SkipBack, SkipForward, Radio } from 'lucide-react'
import type { TimelineState, TimelineControls, TimelineSpeed } from '../../hooks/useTimeline'

interface Props extends TimelineState, TimelineControls {
  windowHours?: number
}

const SPEEDS: TimelineSpeed[] = [1, 5, 30, 60, 300]
const SPEED_LABELS: Record<number, string> = { 1: '1×', 5: '5×', 30: '30×', 60: '60×', 300: '5m×' }

export default function TimelineScrubber({
  currentTime,
  isPlaying,
  speed,
  isLive,
  play,
  pause,
  setSpeed,
  scrubTo,
  goLive,
  stepForward,
  stepBackward,
  windowHours = 24,
}: Props) {
  const windowMs = windowHours * 3_600_000
  const now = Date.now()
  const windowStart = now - windowMs
  const position = Math.max(0, Math.min(1, (currentTime.getTime() - windowStart) / windowMs))

  const handleSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const ratio = Number(e.target.value) / 1000
    scrubTo(new Date(windowStart + ratio * windowMs))
  }, [scrubTo, windowStart, windowMs])

  const fmt = (d: Date) =>
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
    ' ' +
    d.toLocaleDateString([], { month: 'short', day: 'numeric' })

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t border-gray-700 px-4 py-2 flex items-center gap-3 select-none">
      {/* Step back */}
      <button
        onClick={() => stepBackward(5)}
        className="text-gray-400 hover:text-white transition-colors"
        title="Back 5 min"
      >
        <SkipBack size={16} />
      </button>

      {/* Play / Pause */}
      <button
        onClick={isPlaying ? pause : play}
        className="w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-500 flex items-center justify-center transition-colors"
        title={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
      </button>

      {/* Step forward */}
      <button
        onClick={() => stepForward(5)}
        className="text-gray-400 hover:text-white transition-colors"
        title="Forward 5 min"
      >
        <SkipForward size={16} />
      </button>

      {/* Speed selector */}
      <div className="flex gap-1">
        {SPEEDS.map(s => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
              speed === s
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            {SPEED_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Timeline slider */}
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span className="text-xs text-gray-500 shrink-0">
          -{windowHours}h
        </span>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(position * 1000)}
          onChange={handleSlider}
          className="flex-1 h-1.5 accent-blue-500 cursor-pointer"
        />
        <span className="text-xs text-gray-500 shrink-0">now</span>
      </div>

      {/* Current time */}
      <span className="text-xs text-gray-300 shrink-0 font-mono">
        {fmt(currentTime)}
      </span>

      {/* Live button */}
      <button
        onClick={goLive}
        className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
          isLive
            ? 'text-red-400 bg-red-400/10'
            : 'text-gray-400 hover:text-red-400 hover:bg-red-400/10'
        }`}
        title="Jump to live"
      >
        <Radio size={12} className={isLive ? 'animate-pulse' : ''} />
        LIVE
      </button>
    </div>
  )
}
