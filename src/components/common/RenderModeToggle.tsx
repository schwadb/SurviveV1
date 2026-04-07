import { createContext, useContext, useState, type ReactNode } from 'react'
import { Eye, Thermometer, Crosshair, Globe } from 'lucide-react'

export type RenderMode = 'standard' | 'nvg' | 'thermal' | 'tactical'

interface RenderModeContextValue {
  mode: RenderMode
  setMode: (m: RenderMode) => void
}

const RenderModeContext = createContext<RenderModeContextValue>({
  mode: 'standard',
  setMode: () => {},
})

export function RenderModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<RenderMode>('standard')

  return (
    <RenderModeContext.Provider value={{ mode, setMode }}>
      <div className={getRenderClass(mode)} style={getRenderStyle(mode)}>
        {children}
        {mode === 'tactical' && <TacticalHUDOverlay />}
      </div>
    </RenderModeContext.Provider>
  )
}

export function useRenderMode() {
  return useContext(RenderModeContext)
}

function getRenderClass(mode: RenderMode): string {
  return `render-mode-${mode} h-full`
}

function getRenderStyle(mode: RenderMode): React.CSSProperties {
  switch (mode) {
    case 'nvg':
      return { filter: 'sepia(1) saturate(3) hue-rotate(80deg) brightness(0.55)' }
    case 'thermal':
      return { filter: 'invert(1) hue-rotate(200deg) saturate(5) contrast(1.2)' }
    case 'tactical':
      return { filter: 'contrast(1.1) saturate(0.8)' }
    default:
      return {}
  }
}

/** Tactical mode scanline + range ring overlay */
function TacticalHUDOverlay() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-40"
      style={{
        backgroundImage:
          'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,255,0,0.03) 3px, rgba(0,255,0,0.03) 4px)',
      }}
    >
      {/* Corner brackets */}
      {['top-4 left-4 border-t border-l', 'top-4 right-4 border-t border-r',
        'bottom-4 left-4 border-b border-l', 'bottom-4 right-4 border-b border-r'].map((cls, i) => (
        <div
          key={i}
          className={`absolute w-8 h-8 border-green-400 ${cls}`}
          style={{ opacity: 0.6 }}
        />
      ))}
      {/* Status text */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 text-green-400 text-xs font-mono opacity-60 tracking-widest">
        TACTICAL HUD ACTIVE
      </div>
    </div>
  )
}

/** Map tile URLs per render mode */
export function getMapTileUrl(mode: RenderMode): string {
  switch (mode) {
    case 'nvg':
    case 'tactical':
      // Dark tiles — NVG filter applied on top
      return 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    case 'thermal':
      // Satellite imagery — thermal filter applied on top
      return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    default:
      return 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
  }
}

/** Compact toggle button group for use in map toolbars */
export function RenderModeToggle() {
  const { mode, setMode } = useRenderMode()

  const modes: { id: RenderMode; icon: ReactNode; label: string; title: string }[] = [
    { id: 'standard', icon: <Globe size={14} />, label: 'STD', title: 'Standard' },
    { id: 'nvg', icon: <Eye size={14} />, label: 'NVG', title: 'Night Vision' },
    { id: 'thermal', icon: <Thermometer size={14} />, label: 'IR', title: 'Thermal / FLIR' },
    { id: 'tactical', icon: <Crosshair size={14} />, label: 'TAC', title: 'Tactical HUD' },
  ]

  return (
    <div className="flex rounded overflow-hidden border border-gray-600">
      {modes.map(({ id, icon, label, title }) => (
        <button
          key={id}
          onClick={() => setMode(id)}
          title={title}
          className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${
            mode === id
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
          }`}
        >
          {icon}
          <span className="font-mono">{label}</span>
        </button>
      ))}
    </div>
  )
}
