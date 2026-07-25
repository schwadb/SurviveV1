import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { useNotifications } from './useNotifications';
import {
  startScheduler, getEvents, clearEvents as clearEventsDb,
  type Monitor, type MonitorEvent,
} from '../services/monitor';

interface MonitorsCtx {
  monitors: Monitor[];
  events: MonitorEvent[];
  addMonitor: (m: Omit<Monitor, 'id' | 'enabled' | 'lastRunAt' | 'lastResult' | 'lastHash'>) => void;
  removeMonitor: (id: string) => void;
  toggleMonitor: (id: string) => void;
  saveMonitor: (m: Monitor) => void;
  clearEvents: () => void;
}

const Ctx = createContext<MonitorsCtx | null>(null);

export function MonitorsProvider({ children }: { children: React.ReactNode }) {
  const [monitors, setMonitors] = useLocalStorage<Monitor[]>('watcher-monitors', []);
  const [events, setEvents] = useState<MonitorEvent[]>([]);
  const { notify } = useNotifications();

  // Refs give the once-started scheduler stable access to the latest values
  // without restarting the interval on every render.
  const monitorsRef = useRef(monitors);
  monitorsRef.current = monitors;
  const setMonitorsRef = useRef(setMonitors);
  setMonitorsRef.current = setMonitors;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  useEffect(() => { getEvents().then(setEvents).catch(() => {}); }, []);

  const saveMonitor = useCallback((m: Monitor) => {
    setMonitorsRef.current((prev) => prev.map((x) => (x.id === m.id ? m : x)));
  }, []);

  const addMonitor = useCallback<MonitorsCtx['addMonitor']>((m) => {
    setMonitorsRef.current((prev) => [
      { ...m, id: `mon-${Date.now()}`, enabled: true },
      ...prev,
    ]);
  }, []);

  const removeMonitor = useCallback((id: string) => {
    setMonitorsRef.current((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const toggleMonitor = useCallback((id: string) => {
    setMonitorsRef.current((prev) => prev.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)));
  }, []);

  const clearEvents = useCallback(() => {
    clearEventsDb().catch(() => {});
    setEvents([]);
  }, []);

  // Start the scheduler exactly once (empty deps; everything via refs).
  useEffect(() => {
    const stop = startScheduler({
      getMonitors: () => monitorsRef.current,
      saveMonitor: (m) => setMonitorsRef.current((prev) => prev.map((x) => (x.id === m.id ? m : x))),
      onEvent: (ev) => setEvents((prev) => [ev, ...prev]),
      notify: (t, b, o) => notifyRef.current(t, b, o),
    });
    return stop;
  }, []);

  return (
    <Ctx.Provider value={{ monitors, events, addMonitor, removeMonitor, toggleMonitor, saveMonitor, clearEvents }}>
      {children}
    </Ctx.Provider>
  );
}

export function useMonitors(): MonitorsCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useMonitors must be used within a MonitorsProvider');
  return c;
}
