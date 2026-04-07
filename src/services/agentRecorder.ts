import { openDB, type IDBPDatabase } from 'idb'

const DB_NAME = 'watcher-agent-db'
const DB_VERSION = 1
const SESSIONS_STORE = 'sessions'
const SNAPSHOTS_STORE = 'snapshots'

export interface BoundingBox {
  swLat: number
  swLng: number
  neLat: number
  neLng: number
}

export interface RecordingTarget {
  type: 'aircraft' | 'ships' | 'satellites'
  region?: BoundingBox
  label?: string
}

export interface DataSnapshot {
  id: string
  sessionId: string
  capturedAt: string
  targets: RecordingTarget[]
  data: Record<string, unknown[]>
  note?: string
}

export interface RecordingSession {
  id: string
  name: string
  startTime: string
  endTime?: string
  captureIntervalSeconds: number
  targets: RecordingTarget[]
  snapshotCount: number
  status: 'recording' | 'paused' | 'completed'
}

let _db: IDBPDatabase | null = null

async function getDB() {
  if (_db) return _db
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
        const store = db.createObjectStore(SNAPSHOTS_STORE, { keyPath: 'id' })
        store.createIndex('sessionId', 'sessionId')
      }
    },
  })
  return _db
}

export async function createSession(
  name: string,
  targets: RecordingTarget[],
  captureIntervalSeconds = 60
): Promise<RecordingSession> {
  const db = await getDB()
  const session: RecordingSession = {
    id: `session-${Date.now()}`,
    name,
    startTime: new Date().toISOString(),
    captureIntervalSeconds,
    targets,
    snapshotCount: 0,
    status: 'recording',
  }
  await db.put(SESSIONS_STORE, session)
  return session
}

export async function getSessions(): Promise<RecordingSession[]> {
  const db = await getDB()
  return db.getAll(SESSIONS_STORE)
}

export async function getSession(id: string): Promise<RecordingSession | undefined> {
  const db = await getDB()
  return db.get(SESSIONS_STORE, id)
}

export async function updateSession(session: RecordingSession): Promise<void> {
  const db = await getDB()
  await db.put(SESSIONS_STORE, session)
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDB()
  const snapshots = await db.getAllFromIndex(SNAPSHOTS_STORE, 'sessionId', id)
  const tx = db.transaction([SESSIONS_STORE, SNAPSHOTS_STORE], 'readwrite')
  await Promise.all([
    tx.objectStore(SESSIONS_STORE).delete(id),
    ...snapshots.map((s: DataSnapshot) => tx.objectStore(SNAPSHOTS_STORE).delete(s.id)),
    tx.done,
  ])
}

export async function saveSnapshot(
  sessionId: string,
  targets: RecordingTarget[],
  data: Record<string, unknown[]>,
  note?: string
): Promise<DataSnapshot> {
  const db = await getDB()
  const snapshot: DataSnapshot = {
    id: `snap-${sessionId}-${Date.now()}`,
    sessionId,
    capturedAt: new Date().toISOString(),
    targets,
    data,
    note,
  }
  await db.put(SNAPSHOTS_STORE, snapshot)

  // Update session snapshot count
  const session = await db.get(SESSIONS_STORE, sessionId)
  if (session) {
    session.snapshotCount = (session.snapshotCount ?? 0) + 1
    await db.put(SESSIONS_STORE, session)
  }

  return snapshot
}

export async function getSnapshots(sessionId: string): Promise<DataSnapshot[]> {
  const db = await getDB()
  return db.getAllFromIndex(SNAPSHOTS_STORE, 'sessionId', sessionId)
}

/**
 * Auto-capture agent: runs a capture function on a configurable interval.
 * Returns a stop function.
 */
export function startAutoCapture(
  sessionId: string,
  targets: RecordingTarget[],
  captureFn: () => Promise<Record<string, unknown[]>>,
  intervalSeconds = 60
): () => void {
  let active = true

  async function tick() {
    if (!active) return
    try {
      const data = await captureFn()
      await saveSnapshot(sessionId, targets, data)
    } catch (err) {
      console.warn('[AgentRecorder] Capture failed:', err)
    }
    if (active) {
      setTimeout(tick, intervalSeconds * 1000)
    }
  }

  // First capture immediately
  setTimeout(tick, 0)

  return () => { active = false }
}
