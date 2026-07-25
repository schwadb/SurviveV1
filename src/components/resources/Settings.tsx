import React, { useState } from 'react';
import {
  Settings as SettingsIcon, Key, Save, RefreshCw, Moon, Sun, Bell,
  Globe, Gauge, Wifi, Activity, Layers, Navigation, Lock, Unlock
} from 'lucide-react';
import { useSettings, type AppSettings } from '../../hooks/useLocalStorage';
import { useNotifications } from '../../hooks/useNotifications';
import { useKeyVault } from '../../hooks/useKeyVault';
import { passphraseStrength } from '../../services/vault';
import toast from 'react-hot-toast';

const Settings: React.FC = () => {
  const [settings, setSettings] = useSettings();
  const { permission, requestPermission } = useNotifications();
  const { vaultEnabled, locked, enableVault, disableVault, unlock, lock } = useKeyVault();
  const [vaultPass, setVaultPass] = useState('');

  const handleEnableVault = async () => {
    try { await enableVault(vaultPass); setVaultPass(''); toast.success('Keys encrypted in vault'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to enable vault'); }
  };
  const handleUnlock = async () => {
    try { await unlock(vaultPass); setVaultPass(''); toast.success('Vault unlocked'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Wrong passphrase'); }
  };
  const handleDisableVault = async () => {
    try { await disableVault(vaultPass); setVaultPass(''); toast.success('Vault disabled — keys restored to plaintext'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to disable vault'); }
  };

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setSettings(prev => ({ ...prev, [key]: value }));

  const handleNotificationToggle = async () => {
    if (settings.notificationsEnabled) {
      update('notificationsEnabled', false);
      return;
    }
    const perm = await requestPermission();
    if (perm === 'granted') {
      update('notificationsEnabled', true);
      toast.success('Browser notifications enabled');
    } else {
      toast.error('Notification permission denied by browser');
    }
  };

  const Toggle: React.FC<{ value: boolean; onChange: (v: boolean) => void; disabled?: boolean }> = ({ value, onChange, disabled }) => (
    <button
      onClick={() => !disabled && onChange(!value)}
      disabled={disabled}
      className={`relative w-10 h-5 rounded-full transition-colors ${value ? 'bg-indigo-600' : 'bg-gray-700'} ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );

  return (
    <div className="space-y-4 max-w-3xl">

      {/* Theme */}
      <div className="card">
        <div className="card-header">
          <Moon size={18} className="text-indigo-400" />
          <h3 className="section-title">Appearance</h3>
        </div>
        <div className="flex items-center justify-between p-3 bg-gray-900 rounded-lg">
          <div className="flex items-center gap-3">
            {settings.darkMode ? <Moon size={16} className="text-indigo-400" /> : <Sun size={16} className="text-yellow-400" />}
            <div>
              <p className="text-sm font-medium text-gray-200">{settings.darkMode ? 'Dark Mode' : 'Light Mode'}</p>
              <p className="text-xs text-gray-500">Toggle app theme</p>
            </div>
          </div>
          <Toggle value={settings.darkMode} onChange={v => update('darkMode', v)} />
        </div>

        <div className="mt-3 p-3 bg-gray-900 rounded-lg">
          <p className="text-sm font-medium text-gray-200 mb-2 flex items-center gap-2">
            <Globe size={15} className="text-blue-400" />Map Style
          </p>
          <div className="grid grid-cols-3 gap-2">
            {(['dark', 'satellite', 'terrain'] as AppSettings['mapStyle'][]).map(style => (
              <button key={style} onClick={() => update('mapStyle', style)}
                className={`py-2 px-3 rounded-lg text-sm font-medium capitalize transition-colors ${settings.mapStyle === style ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                {style}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* API Keys */}
      <div className="card">
        <div className="card-header">
          <Key size={18} className="text-yellow-400" />
          <h3 className="section-title">API Keys</h3>
          {vaultEnabled && <span className="badge badge-blue ml-auto">🔒 stored in vault</span>}
        </div>
        {vaultEnabled ? (
          <p className="text-sm text-gray-400">
            API keys are encrypted in the local vault. {locked
              ? 'Unlock the vault below to use them.'
              : 'The vault is unlocked for this session.'} Manage the vault in the card below or disable it to edit keys in plaintext.
          </p>
        ) : (
        <div className="space-y-4">
          {[
            {
              key: 'perplexityApiKey' as const,
              label: 'Perplexity AI API Key',
              placeholder: 'pplx-xxxxxxxxxxxxxxxxxxxx',
              helpUrl: 'https://www.perplexity.ai/settings/api',
              description: 'Required for AI-powered OSINT searches',
              free: false,
            },
            {
              key: 'n2yoApiKey' as const,
              label: 'N2YO Satellite API Key',
              placeholder: 'Your N2YO API key',
              helpUrl: 'https://www.n2yo.com/api/',
              description: 'Required for detailed satellite tracking (free tier available)',
              free: true,
            },
            {
              key: 'numverifyApiKey' as const,
              label: 'NumVerify Phone API Key',
              placeholder: 'Your NumVerify access key',
              helpUrl: 'https://numverify.com/',
              description: 'Phone number validation and carrier lookup (100 req/mo free)',
              free: true,
            },
            {
              key: 'aisStreamApiKey' as const,
              label: 'AISStream.io API Key',
              placeholder: 'Your AISStream API key',
              helpUrl: 'https://aisstream.io/',
              description: 'Required for live ship WebSocket feed (free tier available)',
              free: true,
            },
          ].map(({ key, label, placeholder, helpUrl, description, free }) => (
            <div key={key}>
              <div className="flex items-center gap-2 mb-1">
                <label className="text-sm font-medium text-gray-300">{label}</label>
                {free && <span className="badge badge-green text-xs">Free tier</span>}
              </div>
              <p className="text-xs text-gray-500 mb-2">{description}</p>
              <div className="flex gap-2">
                <input type="password" className="input-field flex-1" placeholder={placeholder}
                  value={settings[key] as string}
                  onChange={e => update(key, e.target.value as never)}
                />
                <a href={helpUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm flex-shrink-0">
                  Get Key
                </a>
              </div>
            </div>
          ))}
        </div>
        )}
      </div>

      {/* Secure Vault */}
      <div className="card">
        <div className="card-header">
          <Lock size={18} className="text-indigo-400" />
          <h3 className="section-title">Secure Key Vault</h3>
          <span className="badge badge-blue ml-auto">AES-256-GCM</span>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Encrypt your API keys at rest with a passphrase (PBKDF2). Keys never leave the browser and are
          held in memory only while unlocked. Without the vault, keys are stored in plaintext localStorage.
        </p>

        {!vaultEnabled ? (
          <div className="space-y-2">
            <input type="password" className="input-field" placeholder="Choose a passphrase"
              value={vaultPass} onChange={e => setVaultPass(e.target.value)} />
            {vaultPass && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-gray-800 rounded overflow-hidden">
                  <div className="h-full transition-all" style={{
                    width: `${(passphraseStrength(vaultPass).score / 4) * 100}%`,
                    background: passphraseStrength(vaultPass).score >= 3 ? '#22c55e' : passphraseStrength(vaultPass).score >= 2 ? '#eab308' : '#ef4444',
                  }} />
                </div>
                <span className="text-xs text-gray-500">{passphraseStrength(vaultPass).label}</span>
              </div>
            )}
            <button onClick={handleEnableVault} disabled={!vaultPass} className="btn-primary text-sm">
              <Lock size={14} /> Encrypt keys
            </button>
          </div>
        ) : locked ? (
          <div className="flex gap-2">
            <input type="password" className="input-field flex-1" placeholder="Passphrase to unlock"
              value={vaultPass} onChange={e => setVaultPass(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleUnlock()} />
            <button onClick={handleUnlock} disabled={!vaultPass} className="btn-primary text-sm"><Unlock size={14} /> Unlock</button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-green-400">🔓 Vault unlocked for this session.</span>
            <button onClick={lock} className="btn-secondary text-sm ml-auto"><Lock size={14} /> Lock</button>
            <button onClick={handleDisableVault} className="btn-secondary text-sm">Disable vault</button>
          </div>
        )}
      </div>

      {/* Live Data */}
      <div className="card">
        <div className="card-header">
          <Wifi size={18} className="text-green-400" />
          <h3 className="section-title">Live Data Sources</h3>
        </div>
        <div className="space-y-3">
          {[
            {
              key: 'enableLiveAircraft' as const,
              label: 'Live Aircraft (OpenSky Network)',
              description: 'Real-time ADS-B data — free, no API key required',
              icon: Activity, color: 'text-blue-400',
            },
            {
              key: 'enableLiveSatellites' as const,
              label: 'Live Satellites (CelesTrak)',
              description: 'Live TLE orbital data — free, no API key required',
              icon: Navigation, color: 'text-indigo-400',
            },
            {
              key: 'enableLiveShips' as const,
              label: 'Live Ships (AISStream.io WebSocket)',
              description: 'Real-time AIS vessel data — requires AISStream API key above',
              icon: Globe, color: 'text-cyan-400',
            },
          ].map(({ key, label, description, icon: Icon, color }) => (
            <div key={key} className="flex items-center justify-between p-3 bg-gray-900 rounded-lg">
              <div className="flex items-center gap-3">
                <Icon size={16} className={color} />
                <div>
                  <p className="text-sm font-medium text-gray-200">{label}</p>
                  <p className="text-xs text-gray-500">{description}</p>
                </div>
              </div>
              <Toggle value={settings[key] as boolean} onChange={v => update(key, v as never)} />
            </div>
          ))}
        </div>
      </div>

      {/* Map Options */}
      <div className="card">
        <div className="card-header">
          <Layers size={18} className="text-purple-400" />
          <h3 className="section-title">Map Options</h3>
        </div>
        <div className="space-y-3">
          {[
            {
              key: 'clusterMarkers' as const,
              label: 'Cluster Markers',
              description: 'Group nearby markers for better performance with many targets',
            },
            {
              key: 'showTrails' as const,
              label: 'Show Position Trails',
              description: 'Draw breadcrumb trails showing recent movement paths',
            },
          ].map(({ key, label, description }) => (
            <div key={key} className="flex items-center justify-between p-3 bg-gray-900 rounded-lg">
              <div>
                <p className="text-sm font-medium text-gray-200">{label}</p>
                <p className="text-xs text-gray-500">{description}</p>
              </div>
              <Toggle value={settings[key] as boolean} onChange={v => update(key, v as never)} />
            </div>
          ))}
        </div>
      </div>

      {/* Notifications */}
      <div className="card">
        <div className="card-header">
          <Bell size={18} className="text-yellow-400" />
          <h3 className="section-title">Notifications</h3>
        </div>
        <div className="flex items-center justify-between p-3 bg-gray-900 rounded-lg">
          <div className="flex items-center gap-3">
            <Bell size={16} className="text-yellow-400" />
            <div>
              <p className="text-sm font-medium text-gray-200">Browser Push Notifications</p>
              <p className="text-xs text-gray-500">
                {permission === 'granted' ? '✅ Permission granted'
                  : permission === 'denied' ? '❌ Blocked — check browser settings'
                  : '⚠️ Click to request permission'}
              </p>
            </div>
          </div>
          <Toggle value={settings.notificationsEnabled} onChange={handleNotificationToggle}
            disabled={permission === 'denied'} />
        </div>
      </div>

      {/* Refresh & Units */}
      <div className="card">
        <div className="card-header">
          <RefreshCw size={18} className="text-cyan-400" />
          <h3 className="section-title">Data & Units</h3>
        </div>

        <div className="space-y-4">
          <div className="p-3 bg-gray-900 rounded-lg">
            <p className="text-sm font-medium text-gray-200 mb-3">Auto-refresh interval: {settings.refreshInterval}s</p>
            <input type="range" min={10} max={300} step={10} value={settings.refreshInterval}
              onChange={e => update('refreshInterval', parseInt(e.target.value))}
              className="w-full accent-indigo-500" />
            <div className="flex justify-between text-xs text-gray-600 mt-1">
              <span>10s (fast)</span><span>60s</span><span>300s (slow)</span>
            </div>
          </div>

          <div className="p-3 bg-gray-900 rounded-lg">
            <p className="text-sm font-medium text-gray-200 mb-2 flex items-center gap-2">
              <Gauge size={15} className="text-green-400" />Units
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(['imperial', 'metric'] as AppSettings['units'][]).map(unit => (
                <button key={unit} onClick={() => update('units', unit)}
                  className={`py-2 px-3 rounded-lg text-sm font-medium capitalize transition-colors ${settings.units === unit ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                  {unit} ({unit === 'imperial' ? 'ft, mph, °F' : 'km, kph, °C'})
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm text-gray-500 px-1">
        <Save size={14} className="text-green-400" />
        All settings auto-save to your browser's local storage
      </div>

      {/* About */}
      <div className="card">
        <div className="card-header">
          <SettingsIcon size={16} className="text-gray-400" />
          <h3 className="section-title">About WatcherV1</h3>
        </div>
        <div className="space-y-2 text-sm text-gray-400">
          <p><span className="text-gray-300 font-medium">Version:</span> 2.0.0</p>
          <p><span className="text-gray-300 font-medium">License:</span> MIT</p>
          <p><span className="text-gray-300 font-medium">Stack:</span> React 19 + TypeScript + Vite + Tailwind CSS</p>
          <p><span className="text-gray-300 font-medium">Maps:</span> Leaflet + CartoDB Dark + MarkerCluster</p>
          <p><span className="text-gray-300 font-medium">Live Data:</span> OpenSky Network (aircraft), CelesTrak (satellites), AISStream (ships)</p>
          <p><span className="text-gray-300 font-medium">PWA:</span> Installable on Android, iOS, macOS, Windows</p>
          <p className="pt-2 text-xs text-gray-600">
            WatcherV1 is an open-source OSINT platform. All data is sourced from publicly available APIs.
            Use responsibly and in compliance with applicable laws.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Settings;
