import React, { useState, useMemo } from 'react';
import {
  Plus, Trash2, Download, Upload, FileText, Network, Crosshair, Loader2,
  ChevronDown, Shield, Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useInvestigations } from '../hooks/useInvestigations';
import EntityGraph from '../components/investigation/EntityGraph';
import {
  ENTITY_META, availablePivots, runPivot, applyPivot, upsertEntity,
  generateReport, detectAndCreate, type Entity, type EntityType, type Investigation,
} from '../services/investigation';
import { evaluateSignals, type Signal } from '../services/correlate';
import { toJSON, importJSON } from '../services/api';

const ENTITY_TYPES: EntityType[] = ['domain', 'ip', 'email', 'username', 'person', 'org', 'phone', 'location', 'url', 'note'];

function download(name: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

const Investigations: React.FC = () => {
  const { cases, active, setActiveId, create, remove, save, importCase } = useInvestigations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newValue, setNewValue] = useState('');
  const [newType, setNewType] = useState<EntityType | 'auto'>('auto');
  const [pivoting, setPivoting] = useState<string | null>(null);
  const [caseMenuOpen, setCaseMenuOpen] = useState(false);

  const selected = active?.entities.find((e) => e.id === selectedId) ?? null;
  const signals = useMemo<Signal[]>(() => (active ? evaluateSignals(active) : []), [active]);

  const SEV_STYLE: Record<Signal['severity'], string> = {
    critical: 'bg-red-500 live-indicator',
    danger: 'bg-red-500',
    warning: 'bg-yellow-500',
    info: 'bg-blue-500',
  };

  const handleAddEntity = () => {
    if (!active) { toast.error('Create a case first'); return; }
    const val = newValue.trim();
    if (!val) return;
    const id = newType === 'auto'
      ? detectAndCreate(active, val)
      : upsertEntity(active, newType, val, {}, 'manual');
    const added = active.entities.find((e) => e.id === id);
    save(active);
    setSelectedId(id);
    setNewValue('');
    toast.success(`Added ${added ? ENTITY_META[added.type].label : 'entity'}`);
  };

  const handlePivot = async (entity: Entity, pivot: string) => {
    if (!active) return;
    setPivoting(`${entity.id}:${pivot}`);
    try {
      const out = await runPivot(entity, pivot);
      await applyPivot(active, entity.id, out);
      save(active);
      toast.success(out.note, { duration: 4000 });
    } catch {
      toast.error('Pivot failed');
    } finally {
      setPivoting(null);
    }
  };

  const handlePositions = (positions: Record<string, { x: number; y: number }>) => {
    if (!active) return;
    for (const e of active.entities) {
      const p = positions[e.id];
      if (p) { e.x = p.x; e.y = p.y; }
    }
    save(active);
  };

  const handleDeleteEntity = (id: string) => {
    if (!active) return;
    active.entities = active.entities.filter((e) => e.id !== id);
    active.edges = active.edges.filter((e) => e.from !== id && e.to !== id);
    save(active);
    if (selectedId === id) setSelectedId(null);
  };

  const handleNote = (id: string, notes: string) => {
    if (!active) return;
    const e = active.entities.find((x) => x.id === id);
    if (e) { e.notes = notes; save(active); }
  };

  const handleImport = async () => {
    try {
      const data = await importJSON() as Investigation;
      if (!data || !Array.isArray(data.entities)) throw new Error('Not a valid case file');
      importCase(data);
      toast.success(`Imported case: ${data.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
    }
  };

  const handleQuickStart = () => {
    const inv = create('New Investigation');
    // Seed a couple of example entities so the graph isn't empty.
    detectAndCreate(inv, 'example.com');
    save(inv);
  };

  return (
    <div className="space-y-4">
      {/* Case bar */}
      <div className="card flex flex-wrap items-center gap-3">
        <Network size={18} className="text-indigo-400" />
        <div className="relative">
          <button
            onClick={() => setCaseMenuOpen((v) => !v)}
            className="btn-secondary text-sm"
          >
            {active ? active.name : 'No case selected'}
            <ChevronDown size={14} />
          </button>
          {caseMenuOpen && (
            <div className="absolute z-20 mt-1 w-64 bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-1 max-h-72 overflow-y-auto">
              {cases.length === 0 && <p className="text-xs text-gray-500 p-2">No cases yet.</p>}
              {cases.map((c) => (
                <div key={c.id} className={`flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-800 ${c.id === active?.id ? 'bg-gray-800' : ''}`}>
                  <button onClick={() => { setActiveId(c.id); setSelectedId(null); setCaseMenuOpen(false); }} className="flex-1 text-left text-sm text-gray-200 truncate">
                    {c.name}
                    <span className="block text-xs text-gray-500">{c.entities.length} entities · {new Date(c.updatedAt).toLocaleDateString()}</span>
                  </button>
                  <button onClick={() => remove(c.id)} title="Delete case" className="text-gray-500 hover:text-red-400"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={() => { create('New Investigation'); setSelectedId(null); }} className="btn-primary text-sm">
          <Plus size={14} /> New Case
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={handleImport} className="btn-secondary text-xs"><Upload size={13} /> Import</button>
          <button
            onClick={() => active && toJSON(active, `${active.name.replace(/\s+/g, '-')}.watcher.json`)}
            disabled={!active} className="btn-secondary text-xs"
          ><Download size={13} /> Export Case</button>
          <button
            onClick={() => active && download(`${active.name.replace(/\s+/g, '-')}-report.md`, generateReport(active), 'text/markdown')}
            disabled={!active} className="btn-secondary text-xs"
          ><FileText size={13} /> Report</button>
        </div>
      </div>

      {!active ? (
        <div className="card p-10 text-center">
          <Network className="mx-auto mb-3 text-indigo-400 opacity-60" size={40} />
          <h3 className="text-lg font-semibold text-white mb-1">Link-Analysis Workspace</h3>
          <p className="text-sm text-gray-400 max-w-md mx-auto mb-4">
            Build a visual entity graph like Maltego or SpiderFoot. Drop in a domain, IP, email, or
            username, then <strong>pivot</strong> each node into its connected entities using live,
            keyless OSINT sources. Every finding is logged with a SHA-256 hash for evidence integrity.
          </p>
          <button onClick={handleQuickStart} className="btn-primary mx-auto"><Plus size={15} /> Start a Case</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Graph + add bar */}
          <div className="lg:col-span-2 space-y-3">
            <div className="card">
              <div className="flex gap-2 mb-3">
                <select value={newType} onChange={(e) => setNewType(e.target.value as EntityType | 'auto')} className="input-field w-auto text-sm">
                  <option value="auto">Auto-detect</option>
                  {ENTITY_TYPES.map((t) => <option key={t} value={t}>{ENTITY_META[t].icon} {ENTITY_META[t].label}</option>)}
                </select>
                <input
                  className="input-field flex-1" placeholder="Add entity — domain, IP, email, username…"
                  value={newValue} onChange={(e) => setNewValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddEntity()}
                />
                <button onClick={handleAddEntity} className="btn-primary"><Plus size={15} /> Add</button>
              </div>
              <EntityGraph
                entities={active.entities}
                edges={active.edges}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onPositionsChange={handlePositions}
              />
              <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                {[...new Set(active.entities.map((e) => e.type))].map((t) => (
                  <span key={t} className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: ENTITY_META[t].color }} />
                    {ENTITY_META[t].label}
                  </span>
                ))}
                <span className="ml-auto">Drag nodes · scroll to zoom · click to inspect</span>
              </div>
            </div>
          </div>

          {/* Detail / pivot panel */}
          <div className="space-y-3">
            {selected ? (
              <div className="card space-y-3">
                <div className="flex items-start gap-2">
                  <span className="text-2xl">{ENTITY_META[selected.type].icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs uppercase tracking-wide" style={{ color: ENTITY_META[selected.type].color }}>{ENTITY_META[selected.type].label}</p>
                    <p className="text-sm font-semibold text-gray-100 break-all">{selected.label}</p>
                  </div>
                  <button onClick={() => handleDeleteEntity(selected.id)} title="Remove entity" className="text-gray-500 hover:text-red-400"><Trash2 size={15} /></button>
                </div>

                {/* Pivots */}
                {availablePivots(selected.type).length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 mb-1.5 flex items-center gap-1"><Crosshair size={12} /> Pivots (live lookups)</p>
                    <div className="flex flex-wrap gap-2">
                      {availablePivots(selected.type).map((p) => {
                        const busy = pivoting === `${selected.id}:${p}`;
                        return (
                          <button key={p} onClick={() => handlePivot(selected, p)} disabled={!!pivoting}
                            className="btn-secondary text-xs">
                            {busy ? <Loader2 size={12} className="animate-spin" /> : <Crosshair size={12} />}
                            {p}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Attributes */}
                {Object.entries(selected.attrs).filter(([, v]) => v).length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 mb-1.5">Attributes</p>
                    <div className="space-y-1">
                      {Object.entries(selected.attrs).filter(([, v]) => v).map(([k, v]) => (
                        <div key={k} className="flex gap-2 text-xs">
                          <span className="text-gray-500 flex-shrink-0">{k}:</span>
                          <span className="text-gray-300 break-all">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Notes */}
                <div>
                  <p className="text-xs text-gray-500 mb-1.5">Analyst notes</p>
                  <textarea
                    className="input-field text-xs" rows={3} placeholder="Add notes for the report…"
                    value={selected.notes} onChange={(e) => handleNote(selected.id, e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div className="card text-center text-sm text-gray-500 py-8">
                <Crosshair className="mx-auto mb-2 opacity-40" size={24} />
                Select a node to inspect it and run pivots.
              </div>
            )}

            {/* Correlation signals */}
            <div className="card">
              <div className="card-header">
                <Zap size={16} className="text-yellow-400" />
                <h3 className="section-title">Signals</h3>
                <span className="badge badge-yellow ml-auto">{signals.length}</span>
              </div>
              {signals.length === 0 ? (
                <p className="text-xs text-gray-500">Run pivots to surface correlation signals (exposed ports, CVEs, shared infrastructure).</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {signals.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => s.entityIds[0] && setSelectedId(s.entityIds[0])}
                      className="w-full text-left flex items-start gap-2 p-2 rounded-lg hover:bg-gray-800/60 transition-colors"
                    >
                      <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${SEV_STYLE[s.severity]}`} />
                      <div className="min-w-0">
                        <p className="text-sm text-gray-200">{s.title}</p>
                        <p className="text-xs text-gray-500 truncate">{s.detail}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Evidence log */}
            <div className="card">
              <div className="card-header">
                <Shield size={16} className="text-green-400" />
                <h3 className="section-title">Evidence Log</h3>
                <span className="badge badge-green ml-auto">{active.evidence.length}</span>
              </div>
              {active.evidence.length === 0 ? (
                <p className="text-xs text-gray-500">Findings from pivots are recorded here with a SHA-256 hash.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {active.evidence.slice().reverse().map((ev) => (
                    <div key={ev.id} className="text-xs border-b border-gray-800 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="badge badge-blue">{ev.source}</span>
                        <span className="text-gray-500">{new Date(ev.capturedAt).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-gray-300 mt-1">{ev.summary}</p>
                      <p className="text-gray-600 font-mono truncate mt-0.5" title={ev.hash}>sha256: {ev.hash.slice(0, 32)}…</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {caseMenuOpen && <div className="fixed inset-0 z-10" onClick={() => setCaseMenuOpen(false)} />}
    </div>
  );
};

export default Investigations;
