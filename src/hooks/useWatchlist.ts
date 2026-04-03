import { useLocalStorage } from './useLocalStorage';

export interface WatchlistEntry {
  id: string;
  type: 'aircraft' | 'satellite' | 'ship' | 'camera' | 'person' | 'scanner';
  identifier: string; // ICAO, NORAD ID, MMSI, etc.
  label: string;
  notes?: string;
  addedAt: string;
  alertOnSeen: boolean;
}

export function useWatchlist() {
  const [watchlist, setWatchlist] = useLocalStorage<WatchlistEntry[]>('watcher-watchlist', []);

  const addEntry = (entry: Omit<WatchlistEntry, 'addedAt'>) => {
    setWatchlist((prev) => {
      if (prev.some((e) => e.identifier === entry.identifier && e.type === entry.type)) {
        return prev; // already exists
      }
      return [...prev, { ...entry, addedAt: new Date().toISOString() }];
    });
  };

  const removeEntry = (id: string) => {
    setWatchlist((prev) => prev.filter((e) => e.id !== id));
  };

  const updateEntry = (id: string, updates: Partial<WatchlistEntry>) => {
    setWatchlist((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...updates } : e))
    );
  };

  const isWatched = (identifier: string, type: WatchlistEntry['type']) =>
    watchlist.some((e) => e.identifier === identifier && e.type === type);

  return { watchlist, addEntry, removeEntry, updateEntry, isWatched };
}
