import React from 'react';
import { Settings as SettingsIcon, Key, Save, RefreshCw, Moon, Bell, Globe, Gauge } from 'lucide-react';
import { useSettings, type AppSettings } from '../../hooks/useLocalStorage';

const Settings: React.FC = () => {
  const [settings, setSettings] = useSettings();

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-4">
      {/* API Keys */}
      <div className="card">
        <div className="card-header">
          <Key size={18} className="text-yellow-400" />
          <h3 className="section-title">API Keys</h3>
        </div>
        <div className="space-y-4">
          {[
            {
              key: 'perplexityApiKey',
              label: 'Perplexity AI API Key',
              placeholder: 'pplx-xxxxxxxxxxxxxxxxxxxx',
              helpUrl: 'https://www.perplexity.ai/settings/api',
              helpLabel: 'Get API key',
              description: 'Required for AI-powered OSINT searches',
            },
            {
              key: 'n2yoApiKey',
              label: 'N2YO Satellite API Key',
              placeholder: 'Your N2YO API key',
              helpUrl: 'https://www.n2yo.com/api/',
              helpLabel: 'Get API key',
              description: 'Required for live satellite tracking',
            },
            {
              key: 'numverifyApiKey',
              label: 'NumVerify Phone API Key',
              placeholder: 'Your NumVerify access key',
              helpUrl: 'https://numverify.com/',
              helpLabel: 'Get API key',
              description: 'Required for carrier and phone validation',
            },
          ].map(({ key, label, placeholder, helpUrl, helpLabel, description }) => (
            <div key={key}>
              <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
              <p className="text-xs text-gray-500 mb-2">{description}</p>
              <div className="flex gap-2">
                <input
                  type="password"
                  className="input-field flex-1"
                  placeholder={placeholder}
                  value={(settings[key as keyof AppSettings] as string) || ''}
                  onChange={(e) => updateSetting(key as keyof typeof settings, e.target.value as never)}
                />
                <a
                  href={helpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary text-sm flex-shrink-0"
                >
                  {helpLabel}
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Display Settings */}
      <div className="card">
        <div className="card-header">
          <SettingsIcon size={18} className="text-gray-400" />
          <h3 className="section-title">Display Settings</h3>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-gray-900 rounded-lg">
            <div className="flex items-center gap-3">
              <Moon size={16} className="text-indigo-400" />
              <div>
                <p className="text-sm font-medium text-gray-200">Dark Mode</p>
                <p className="text-xs text-gray-500">Always on for OSINT operations</p>
              </div>
            </div>
            <div className="w-10 h-5 bg-indigo-600 rounded-full cursor-not-allowed opacity-70" />
          </div>

          <div className="p-3 bg-gray-900 rounded-lg">
            <div className="flex items-center gap-3 mb-2">
              <Globe size={16} className="text-blue-400" />
              <p className="text-sm font-medium text-gray-200">Map Style</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['dark', 'satellite', 'terrain'] as AppSettings['mapStyle'][]).map((style) => (
                <button
                  key={style}
                  onClick={() => updateSetting('mapStyle', style)}
                  className={`py-2 px-3 rounded-lg text-sm font-medium capitalize transition-colors ${
                    settings.mapStyle === style
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {style}
                </button>
              ))}
            </div>
          </div>

          <div className="p-3 bg-gray-900 rounded-lg">
            <div className="flex items-center gap-3 mb-2">
              <Gauge size={16} className="text-green-400" />
              <p className="text-sm font-medium text-gray-200">Units</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(['imperial', 'metric'] as AppSettings['units'][]).map((unit) => (
                <button
                  key={unit}
                  onClick={() => updateSetting('units', unit)}
                  className={`py-2 px-3 rounded-lg text-sm font-medium capitalize transition-colors ${
                    settings.units === unit
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {unit} ({unit === 'imperial' ? 'ft, mph' : 'km, kph'})
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Refresh Settings */}
      <div className="card">
        <div className="card-header">
          <RefreshCw size={18} className="text-cyan-400" />
          <h3 className="section-title">Data Refresh</h3>
        </div>
        <div className="space-y-4">
          <div className="p-3 bg-gray-900 rounded-lg">
            <p className="text-sm font-medium text-gray-200 mb-3">
              Auto-refresh interval: {settings.refreshInterval}s
            </p>
            <input
              type="range"
              min={10}
              max={300}
              step={10}
              value={settings.refreshInterval}
              onChange={(e) => updateSetting('refreshInterval', parseInt(e.target.value))}
              className="w-full accent-indigo-500"
            />
            <div className="flex justify-between text-xs text-gray-600 mt-1">
              <span>10s (fast)</span>
              <span>60s</span>
              <span>300s (slow)</span>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 bg-gray-900 rounded-lg">
            <div className="flex items-center gap-3">
              <Bell size={16} className="text-yellow-400" />
              <div>
                <p className="text-sm font-medium text-gray-200">Alert Notifications</p>
                <p className="text-xs text-gray-500">Show alerts for important events</p>
              </div>
            </div>
            <button
              onClick={() => updateSetting('showAlerts', !settings.showAlerts)}
              className={`w-10 h-5 rounded-full transition-colors ${
                settings.showAlerts ? 'bg-indigo-600' : 'bg-gray-700'
              }`}
            >
              <div
                className={`w-4 h-4 bg-white rounded-full mx-0.5 transition-transform ${
                  settings.showAlerts ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Save indicator */}
      <div className="flex items-center gap-2 text-sm text-gray-500 px-1">
        <Save size={14} className="text-green-400" />
        Settings are saved automatically to your browser
      </div>

      {/* About */}
      <div className="card">
        <div className="card-header">
          <SettingsIcon size={16} className="text-gray-400" />
          <h3 className="section-title">About WatcherV1</h3>
        </div>
        <div className="space-y-2 text-sm text-gray-400">
          <p><span className="text-gray-300 font-medium">Version:</span> 1.0.0</p>
          <p><span className="text-gray-300 font-medium">License:</span> MIT</p>
          <p><span className="text-gray-300 font-medium">Framework:</span> React + TypeScript + Vite</p>
          <p><span className="text-gray-300 font-medium">Maps:</span> Leaflet with CartoDB Dark Tiles</p>
          <p className="pt-2 text-xs text-gray-600">
            WatcherV1 is an open-source OSINT platform for tracking satellites, aircraft, ships,
            and public cameras. All data shown uses publicly available APIs and sources.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Settings;
