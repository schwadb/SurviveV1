import { useState } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = (value: T | ((val: T) => T)) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.error('Error saving to localStorage:', error);
    }
  };

  return [storedValue, setValue] as const;
}

export type AppSettings = {
  perplexityApiKey: string;
  n2yoApiKey: string;
  numverifyApiKey: string;
  darkMode: boolean;
  mapStyle: 'dark' | 'satellite' | 'terrain';
  refreshInterval: number;
  showAlerts: boolean;
  units: 'imperial' | 'metric';
  language: string;
};

const defaultSettings: AppSettings = {
  perplexityApiKey: '',
  n2yoApiKey: '',
  numverifyApiKey: '',
  darkMode: true,
  mapStyle: 'dark',
  refreshInterval: 30,
  showAlerts: true,
  units: 'imperial',
  language: 'en',
};

export function useSettings() {
  return useLocalStorage<AppSettings>('watcher-settings', defaultSettings);
}
