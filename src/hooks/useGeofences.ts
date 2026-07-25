import { useCallback } from 'react';
import { useLocalStorage } from './useLocalStorage';
import type { Geofence } from '../services/geofence';

export function useGeofences() {
  const [fences, setFences] = useLocalStorage<Geofence[]>('watcher-geofences', []);

  const addFence = useCallback((ring: [number, number][], name?: string) => {
    setFences((prev) => [
      ...prev,
      { id: `fence-${Date.now()}`, name: name || `Fence ${prev.length + 1}`, ring },
    ]);
  }, [setFences]);

  const removeFence = useCallback((id: string) => {
    setFences((prev) => prev.filter((f) => f.id !== id));
  }, [setFences]);

  return { fences, addFence, removeFence };
}
