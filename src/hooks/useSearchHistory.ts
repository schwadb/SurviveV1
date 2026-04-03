import { useLocalStorage } from './useLocalStorage';

export interface SearchHistoryEntry {
  id: string;
  query: string;
  type: 'person' | 'phone' | 'address' | 'email' | 'domain' | 'ai' | 'username';
  timestamp: string;
  resultCount?: number;
}

export function useSearchHistory() {
  const [history, setHistory] = useLocalStorage<SearchHistoryEntry[]>('watcher-search-history', []);

  const addEntry = (entry: Omit<SearchHistoryEntry, 'id' | 'timestamp'>) => {
    const newEntry: SearchHistoryEntry = {
      ...entry,
      id: `hist-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
    setHistory((prev) => {
      // Deduplicate by query+type, keep 100 entries max
      const filtered = prev.filter(
        (e) => !(e.query === entry.query && e.type === entry.type)
      );
      return [newEntry, ...filtered].slice(0, 100);
    });
  };

  const clearHistory = () => setHistory([]);

  const removeEntry = (id: string) => setHistory((prev) => prev.filter((e) => e.id !== id));

  return { history, addEntry, clearHistory, removeEntry };
}
