import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ENTITY_META, type Entity, type Edge } from '../../services/investigation';

interface Node { id: string; x: number; y: number; vx: number; vy: number; fixed: boolean }

interface EntityGraphProps {
  entities: Entity[];
  edges: Edge[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPositionsChange: (positions: Record<string, { x: number; y: number }>) => void;
  height?: number;
}

// A dependency-free force-directed graph. Physics runs in a cooling rAF loop
// (repulsion between all nodes, spring attraction along edges, weak centering);
// nodes are draggable, and the canvas pans/zooms. Positions are reported back
// on drag-end so the case can persist its layout.
const EntityGraph: React.FC<EntityGraphProps> = ({
  entities, edges, selectedId, onSelect, onPositionsChange, height = 520,
}) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<Map<string, Node>>(new Map());
  const rafRef = useRef<number | null>(null);
  const energyRef = useRef(1);
  const [, setTick] = useState(0);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const dragRef = useRef<{ id: string | null; panning: boolean; lastX: number; lastY: number }>({
    id: null, panning: false, lastX: 0, lastY: 0,
  });

  const size = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    return { w: r?.width ?? 800, h: height };
  };

  // Sync node set with entity list; seed new nodes near center.
  useEffect(() => {
    const map = nodesRef.current;
    const ids = new Set(entities.map((e) => e.id));
    for (const id of map.keys()) if (!ids.has(id)) map.delete(id);
    let i = 0;
    for (const e of entities) {
      if (!map.has(e.id)) {
        const angle = (i / Math.max(1, entities.length)) * Math.PI * 2;
        const seedX = typeof e.x === 'number' ? e.x : Math.cos(angle) * 80 + (Math.random() - 0.5) * 30;
        const seedY = typeof e.y === 'number' ? e.y : Math.sin(angle) * 80 + (Math.random() - 0.5) * 30;
        map.set(e.id, { id: e.id, x: seedX, y: seedY, vx: 0, vy: 0, fixed: false });
      }
      i++;
    }
    energyRef.current = 1; // reheat
    startLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities.length, edges.length]);

  const step = useCallback(() => {
    const map = nodesRef.current;
    const nodes = [...map.values()];
    const REPULSION = 6500;
    const SPRING = 0.02;
    const REST = 110;
    const CENTER = 0.03;      // stronger pull to origin keeps disconnected nodes on-screen
    const MAX_REPEL2 = 360 * 360; // ignore repulsion beyond ~360px so nodes don't fly off
    const DAMP = 0.85;

    // Repulsion (O(n²) — fine for the hundreds of nodes a case realistically has)
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        const na = nodes[a], nb = nodes[b];
        let dx = na.x - nb.x, dy = na.y - nb.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = Math.random(); dy = Math.random(); d2 = dx * dx + dy * dy; }
        if (d2 > MAX_REPEL2) continue;
        const f = REPULSION / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f, fy = (dy / d) * f;
        na.vx += fx; na.vy += fy; nb.vx -= fx; nb.vy -= fy;
      }
    }
    // Spring attraction along edges
    for (const e of edges) {
      const na = map.get(e.from), nb = map.get(e.to);
      if (!na || !nb) continue;
      const dx = nb.x - na.x, dy = nb.y - na.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - REST) * SPRING;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      na.vx += fx; na.vy += fy; nb.vx -= fx; nb.vy -= fy;
    }
    // Centering + integrate
    let energy = 0;
    for (const n of nodes) {
      n.vx -= n.x * CENTER; n.vy -= n.y * CENTER;
      n.vx *= DAMP; n.vy *= DAMP;
      if (!n.fixed) { n.x += n.vx; n.y += n.vy; }
      energy += n.vx * n.vx + n.vy * n.vy;
    }
    energyRef.current = nodes.length ? energy / nodes.length : 0;
  }, [edges]);

  const startLoop = useCallback(() => {
    if (rafRef.current != null) return;
    const loop = () => {
      step();
      setTick((t) => (t + 1) % 100000);
      if (energyRef.current > 0.05 || dragRef.current.id) {
        rafRef.current = requestAnimationFrame(loop);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [step]);

  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); }, []);

  // ─── Pointer interaction ─────────────────────────────────────────────────────
  const toWorld = (clientX: number, clientY: number) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const { w, h } = size();
    const vw = viewRef.current;
    const sx = clientX - r.left - w / 2 - vw.x;
    const sy = clientY - r.top - h / 2 - vw.y;
    return { x: sx / vw.k, y: sy / vw.k };
  };

  const onPointerDownNode = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { id, panning: false, lastX: e.clientX, lastY: e.clientY };
    const n = nodesRef.current.get(id);
    if (n) n.fixed = true;
    onSelect(id);
    startLoop();
  };

  const onPointerDownBg = (e: React.PointerEvent) => {
    dragRef.current = { id: null, panning: true, lastX: e.clientX, lastY: e.clientY };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d.id) {
      const w = toWorld(e.clientX, e.clientY);
      const n = nodesRef.current.get(d.id);
      if (n) { n.x = w.x; n.y = w.y; n.vx = 0; n.vy = 0; }
      setTick((t) => t + 1);
    } else if (d.panning) {
      const dx = e.clientX - d.lastX, dy = e.clientY - d.lastY;
      d.lastX = e.clientX; d.lastY = e.clientY;
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    if (d.id) {
      const n = nodesRef.current.get(d.id);
      if (n) n.fixed = false;
      const positions: Record<string, { x: number; y: number }> = {};
      for (const [id, node] of nodesRef.current) positions[id] = { x: Math.round(node.x), y: Math.round(node.y) };
      onPositionsChange(positions);
      energyRef.current = 0.5;
      startLoop();
    }
    dragRef.current = { id: null, panning: false, lastX: 0, lastY: 0 };
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setView((v) => {
      const k = Math.min(2.5, Math.max(0.3, v.k * (e.deltaY < 0 ? 1.1 : 0.9)));
      return { ...v, k };
    });
  };

  const { w, h } = size();
  const map = nodesRef.current;
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }

  return (
    <div
      ref={wrapRef}
      className="relative rounded-lg overflow-hidden border border-gray-800 bg-[#0a0e1a] select-none"
      style={{ height, touchAction: 'none' }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onWheel={onWheel}
    >
      {entities.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-sm pointer-events-none">
          Add an entity to start mapping. Try a domain, IP, email, or username.
        </div>
      )}
      <svg width="100%" height={h} onPointerDown={onPointerDownBg}>
        <g transform={`translate(${w / 2 + view.x}, ${h / 2 + view.y}) scale(${view.k})`}>
          {edges.map((e) => {
            const a = map.get(e.from), b = map.get(e.to);
            if (!a || !b) return null;
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            return (
              <g key={e.id}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#334155" strokeWidth={1 / view.k + 0.5} />
                {view.k > 0.7 && (
                  <text x={mx} y={my} fill="#64748b" fontSize={9} textAnchor="middle" className="pointer-events-none">
                    {e.label}
                  </text>
                )}
              </g>
            );
          })}
          {entities.map((ent) => {
            const n = map.get(ent.id);
            if (!n) return null;
            const meta = ENTITY_META[ent.type];
            const r = 14 + Math.min(10, (degree.get(ent.id) ?? 0) * 1.5);
            const isSel = ent.id === selectedId;
            return (
              <g
                key={ent.id}
                transform={`translate(${n.x}, ${n.y})`}
                onPointerDown={(e) => onPointerDownNode(e, ent.id)}
                style={{ cursor: 'grab' }}
              >
                <circle
                  r={r}
                  fill={meta.color}
                  fillOpacity={0.9}
                  stroke={isSel ? '#fff' : 'rgba(255,255,255,0.4)'}
                  strokeWidth={isSel ? 3 : 1.5}
                />
                <text y={r * 0.35} fontSize={r} textAnchor="middle" className="pointer-events-none">{meta.icon}</text>
                <text
                  y={r + 12} fontSize={11} fill="#cbd5e1" textAnchor="middle"
                  className="pointer-events-none" style={{ paintOrder: 'stroke', stroke: '#0a0e1a', strokeWidth: 3 }}
                >
                  {ent.label.length > 26 ? ent.label.slice(0, 24) + '…' : ent.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Zoom controls */}
      <div className="absolute bottom-2 right-2 flex flex-col gap-1">
        <button onClick={() => setView((v) => ({ ...v, k: Math.min(2.5, v.k * 1.2) }))} className="w-7 h-7 rounded bg-gray-800/90 border border-gray-700 text-gray-300 hover:text-white text-sm">+</button>
        <button onClick={() => setView((v) => ({ ...v, k: Math.max(0.3, v.k * 0.85) }))} className="w-7 h-7 rounded bg-gray-800/90 border border-gray-700 text-gray-300 hover:text-white text-sm">−</button>
        <button onClick={() => setView({ x: 0, y: 0, k: 1 })} title="Reset view" className="w-7 h-7 rounded bg-gray-800/90 border border-gray-700 text-gray-300 hover:text-white text-xs">⌂</button>
      </div>
    </div>
  );
};

export default EntityGraph;
