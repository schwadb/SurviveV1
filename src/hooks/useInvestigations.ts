import { useCallback, useState } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { createInvestigation, type Investigation } from '../services/investigation';

// Manages the list of investigation cases + the active case, persisted to
// localStorage. Mutations operate on a working copy and re-persist the whole
// list, so the graph/evidence/entities all stay in sync from one source.
export function useInvestigations() {
  const [cases, setCases] = useLocalStorage<Investigation[]>('watcher-investigations', []);
  const [activeId, setActiveId] = useLocalStorage<string | null>('watcher-active-case', null);

  const active = cases.find((c) => c.id === activeId) ?? null;

  const create = useCallback((name: string) => {
    const inv = createInvestigation(name.trim() || 'Untitled Case');
    setCases((prev) => [inv, ...prev]);
    setActiveId(inv.id);
    return inv;
  }, [setCases, setActiveId]);

  const remove = useCallback((id: string) => {
    setCases((prev) => prev.filter((c) => c.id !== id));
    setActiveId((prev) => (prev === id ? null : prev));
  }, [setCases, setActiveId]);

  const rename = useCallback((id: string, name: string) => {
    setCases((prev) => prev.map((c) => (c.id === id ? { ...c, name, updatedAt: new Date().toISOString() } : c)));
  }, [setCases]);

  // Persist a mutated case object back into the list.
  const save = useCallback((inv: Investigation) => {
    inv.updatedAt = new Date().toISOString();
    setCases((prev) => prev.map((c) => (c.id === inv.id ? { ...inv } : c)));
  }, [setCases]);

  const importCase = useCallback((inv: Investigation) => {
    setCases((prev) => [inv, ...prev.filter((c) => c.id !== inv.id)]);
    setActiveId(inv.id);
  }, [setCases, setActiveId]);

  return { cases, active, activeId, setActiveId, create, remove, rename, save, importCase };
}

// Force a re-render when we mutate the active case object in place.
export function useForceUpdate() {
  const [, set] = useState(0);
  return useCallback(() => set((n) => n + 1), []);
}
