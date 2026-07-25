import { useState, useEffect, useRef } from 'react'
import { Square, Trash2, Download, Clock, Database, Plus } from 'lucide-react'
import type { RecordingSession, RecordingTarget } from '../../services/agentRecorder'
import {
  createSession,
  getSessions,
  deleteSession,
  getSnapshots,
  startAutoCapture,
  updateSession,
} from '../../services/agentRecorder'

const TARGET_TYPES: RecordingTarget['type'][] = ['aircraft', 'ships', 'satellites']

export default function AgentRecorder() {
  const [sessions, setSessions] = useState<RecordingSession[]>([])
  const [newName, setNewName] = useState('')
  const [newTargets, setNewTargets] = useState<RecordingTarget['type'][]>(['aircraft'])
  const [newInterval, setNewInterval] = useState(60)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [snapshotCounts, setSnapshotCounts] = useState<Record<string, number>>({})
  const stopFnsRef = useRef<Record<string, () => void>>({})

  async function loadSessions() {
    const all = await getSessions()
    // Any session still 'recording' after a reload is orphaned — its capture loop
    // no longer exists (stopFnsRef is empty), so it can never truly be stopped or
    // captures nothing. Downgrade to 'paused' so the UI is honest and controllable.
    for (const s of all) {
      if (s.status === 'recording' && !stopFnsRef.current[s.id]) {
        s.status = 'paused'
        await updateSession(s)
      }
    }
    setSessions(all.sort((a, b) => b.startTime.localeCompare(a.startTime)))
    setLoading(false)
  }

  useEffect(() => {
    loadSessions()
  }, [])

  async function handleCreate() {
    if (!newName.trim() || newTargets.length === 0) return
    setCreating(true)
    try {
      const targets: RecordingTarget[] = newTargets.map(t => ({ type: t }))
      const session = await createSession(newName.trim(), targets, newInterval)
      setSessions(prev => [session, ...prev])
      setShowForm(false)
      setNewName('')

      // Build a real capture function from the selected target types
      const stop = startAutoCapture(
        session.id,
        targets,
        async () => {
          const { fetchLiveAircraft, fetchLiveSatellites } = await import('../../services/api')
          const snapshot: Record<string, unknown[]> = {
            capturedAt: [new Date().toISOString()],
          }
          await Promise.allSettled([
            targets.some(t => t.type === 'aircraft')
              ? fetchLiveAircraft().then(data => { snapshot.aircraft = data }).catch(() => {})
              : Promise.resolve(),
            targets.some(t => t.type === 'satellites')
              ? fetchLiveSatellites('active').then(data => { snapshot.satellites = data }).catch(() => {})
              : Promise.resolve(),
            // ships: AISStream is WebSocket-based; snapshot the last received state if available
          ])
          return snapshot
        },
        newInterval
      )
      stopFnsRef.current[session.id] = stop
    } finally {
      setCreating(false)
    }
  }

  async function handleStop(session: RecordingSession) {
    stopFnsRef.current[session.id]?.()
    delete stopFnsRef.current[session.id]
    const updated = { ...session, status: 'completed' as const, endTime: new Date().toISOString() }
    await updateSession(updated)
    setSessions(prev => prev.map(s => s.id === session.id ? updated : s))
  }

  async function handleDelete(id: string) {
    stopFnsRef.current[id]?.()
    delete stopFnsRef.current[id]
    await deleteSession(id)
    setSessions(prev => prev.filter(s => s.id !== id))
  }

  async function handleExport(session: RecordingSession) {
    const snapshots = await getSnapshots(session.id)
    const blob = new Blob([JSON.stringify({ session, snapshots }, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `watcher-session-${session.id}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function refreshCounts() {
    const entries = await Promise.all(sessions.map(s => getSnapshots(s.id).then(snaps => [s.id, snaps.length] as const)))
    setSnapshotCounts(Object.fromEntries(entries))
  }

  useEffect(() => {
    if (sessions.length > 0) refreshCounts()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.values(stopFnsRef.current).forEach(fn => fn())
    }
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="section-title">OSINT Agent Recorder</h2>
          <p className="text-sm text-gray-400 mt-1">
            Auto-capture live data snapshots before sources go dark
          </p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={16} />
          New Session
        </button>
      </div>

      {showForm && (
        <div className="card p-4 space-y-3">
          <h3 className="font-semibold text-sm">New Recording Session</h3>
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Session name (e.g. 'Black Sea monitoring')"
            className="input-field w-full"
          />
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Data Sources</label>
            <div className="flex gap-2">
              {TARGET_TYPES.map(t => (
                <button
                  key={t}
                  onClick={() =>
                    setNewTargets(prev =>
                      prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
                    )
                  }
                  className={`text-xs px-2 py-1 rounded capitalize transition-colors ${
                    newTargets.includes(t)
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-400 hover:text-white'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-gray-400">Capture every</label>
            <select
              value={newInterval}
              onChange={e => setNewInterval(Number(e.target.value))}
              className="input-field text-sm"
            >
              <option value={30}>30 seconds</option>
              <option value={60}>1 minute</option>
              <option value={300}>5 minutes</option>
              <option value={600}>10 minutes</option>
              <option value={1800}>30 minutes</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={creating} className="btn-primary text-sm">
              {creating ? 'Starting…' : 'Start Recording'}
            </button>
            <button onClick={() => setShowForm(false)} className="btn-secondary text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-gray-400 text-sm text-center py-8">Loading sessions…</div>
      ) : sessions.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">
          <Database className="mx-auto mb-2 opacity-40" size={32} />
          <p className="text-sm">No recording sessions yet. Create one to start capturing live OSINT data.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map(session => (
            <div key={session.id} className="card p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {session.status === 'recording' ? (
                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-gray-500" />
                  )}
                  <div>
                    <div className="font-semibold text-sm">{session.name}</div>
                    <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
                      <span className="flex items-center gap-1">
                        <Clock size={10} />
                        {new Date(session.startTime).toLocaleString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <Database size={10} />
                        {snapshotCounts[session.id] ?? session.snapshotCount} snapshots
                      </span>
                      <span className="capitalize">{session.status}</span>
                    </div>
                    <div className="flex gap-1 mt-1">
                      {session.targets.map(t => (
                        <span key={t.type} className="badge badge-blue capitalize text-xs">
                          {t.type}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {session.status === 'recording' && (
                    <button
                      onClick={() => handleStop(session)}
                      title="Stop recording"
                      className="text-red-400 hover:text-red-300 transition-colors"
                    >
                      <Square size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => handleExport(session)}
                    title="Export session"
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    <Download size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(session.id)}
                    title="Delete session"
                    className="text-gray-400 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
