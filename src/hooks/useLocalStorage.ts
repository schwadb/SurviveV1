import { useState, useEffect } from 'react';

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
  aisStreamApiKey: string;
  darkMode: boolean;
  mapStyle: 'dark' | 'satellite' | 'terrain';
  refreshInterval: number;
  showAlerts: boolean;
  units: 'imperial' | 'metric';
  language: string;
  enableLiveAircraft: boolean;
  enableLiveSatellites: boolean;
  enableLiveShips: boolean;
  notificationsEnabled: boolean;
  clusterMarkers: boolean;
  showTrails: boolean;
};

const defaultSettings: AppSettings = {
  perplexityApiKey: '',
  n2yoApiKey: '',
  numverifyApiKey: '',
  aisStreamApiKey: '',
  darkMode: true,
  mapStyle: 'dark',
  refreshInterval: 30,
  showAlerts: true,
  units: 'imperial',
  language: 'en',
  enableLiveAircraft: false,
  enableLiveSatellites: false,
  enableLiveShips: false,
  notificationsEnabled: false,
  clusterMarkers: true,
  showTrails: true,
};

export function useSettings() {
  return useLocalStorage<AppSettings>('watcher-settings', defaultSettings);
}

export function useTheme() {
  const [settings, setSettings] = useSettings();

  useEffect(() => {
    if (settings.darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [settings.darkMode]);

  const toggleTheme = () => setSettings((s) => ({ ...s, darkMode: !s.darkMode }));
  return { darkMode: settings.darkMode, toggleTheme };
}
