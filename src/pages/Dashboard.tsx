import React, { useState } from 'react';
import {
  Satellite, Plane, Ship, Camera, Radio, Shield,
  TrendingUp, Globe, Eye, Activity, ExternalLink, Network
} from 'lucide-react';
import type { MapFilter } from '../types';
import { mockSatellites, mockAircraft, mockShips, mockCameras, mockFlockCameras, defaultResources } from '../data/mockData';
import MapView from '../components/common/MapView';

const defaultFilter: MapFilter = {
  satellites: true,
  aircraft: true,
  ships: true,
  cameras: true,
  flockCameras: true,
};

interface DashboardProps {
  onNavigate: (section: string) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ onNavigate }) => {
  const [mapFilter, setMapFilter] = useState<MapFilter>(defaultFilter);

  const toggleFilter = (key: keyof MapFilter) => {
    setMapFilter((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const stats = [
    { label: 'Satellites', value: mockSatellites.filter((s) => s.status === 'active').length, icon: Satellite, color: 'text-indigo-400', bg: 'bg-indigo-900/20', id: 'satellites' },
    { label: 'Aircraft', value: mockAircraft.filter((a) => a.status === 'airborne').length, icon: Plane, color: 'text-blue-400', bg: 'bg-blue-900/20', id: 'aircraft' },
    { label: 'Ships', value: mockShips.length, icon: Ship, color: 'text-cyan-400', bg: 'bg-cyan-900/20', id: 'ships' },
    { label: 'Cameras', value: mockCameras.filter((c) => c.status === 'live').length, icon: Camera, color: 'text-purple-400', bg: 'bg-purple-900/20', id: 'cameras' },
    { label: 'Flock Cams', value: mockFlockCameras.filter((c) => c.status === 'active').length, icon: Eye, color: 'text-orange-400', bg: 'bg-orange-900/20', id: 'flock' },
    { label: 'Scanners', value: 5, icon: Radio, color: 'text-green-400', bg: 'bg-green-900/20', id: 'scanners' },
    { label: 'Resources', value: defaultResources.filter((r) => r.isEnabled).length, icon: Shield, color: 'text-gray-400', bg: 'bg-gray-900/40', id: 'resources' },
    { label: 'Data Sources', value: defaultResources.length, icon: Globe, color: 'text-teal-400', bg: 'bg-teal-900/20', id: 'settings' },
  ];

  const quickActions = [
    { label: 'Track Satellites', icon: Satellite, color: 'text-indigo-400', id: 'satellites', description: 'Live orbital tracking' },
    { label: 'Flight Tracker', icon: Plane, color: 'text-blue-400', id: 'aircraft', description: 'Real-time ADS-B data' },
    { label: 'Ship AIS', icon: Ship, color: 'text-cyan-400', id: 'ships', description: 'Maritime vessel tracking' },
    { label: 'Investigations', icon: Network, color: 'text-indigo-400', id: 'investigations', description: 'Link-analysis graph' },
    { label: 'AI Research', icon: Activity, color: 'text-violet-400', id: 'ai-search', description: 'Perplexity AI searches' },
    { label: 'Scanners', icon: Radio, color: 'text-green-400', id: 'scanners', description: 'Live radio feeds' },
  ];

  return (
    <div className="space-y-4">
      {/* Welcome banner */}
      <div className="card glow-border">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-indigo-900/30 rounded-xl">
            <Shield size={32} className="text-indigo-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">WatcherV1 OSINT Platform</h2>
            <p className="text-gray-400 text-sm mt-1">
              Comprehensive open-source intelligence tracking. Monitor satellites, aircraft, ships,
              cameras, and more from a single interface.
            </p>
          </div>
          <div className="ml-auto hidden lg:flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs text-green-400 bg-green-900/20 px-3 py-1.5 rounded-full border border-green-800/50">
              <span className="w-2 h-2 bg-green-500 rounded-full live-indicator" />
              Live feeds active
            </span>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {stats.map(({ label, value, icon: Icon, color, bg, id }) => (
          <button
            key={label}
            onClick={() => onNavigate(id)}
            className={`card ${bg} border-gray-700 hover:border-indigo-700/50 transition-all cursor-pointer text-center p-3`}
          >
            <Icon size={20} className={`mx-auto ${color} mb-2`} />
            <p className={`text-xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </button>
        ))}
      </div>

      {/* Map */}
      <div className="card">
        <div className="card-header">
          <Globe size={18} className="text-indigo-400" />
          <h3 className="section-title">Live World Overview</h3>
        </div>

        {/* Map layer toggles */}
        <div className="flex flex-wrap gap-2 mb-3">
          {[
            { key: 'satellites' as const, label: '🛰️ Satellites', color: 'border-indigo-500 bg-indigo-900/20 text-indigo-400' },
            { key: 'aircraft' as const, label: '✈️ Aircraft', color: 'border-blue-500 bg-blue-900/20 text-blue-400' },
            { key: 'ships' as const, label: '🚢 Ships', color: 'border-cyan-500 bg-cyan-900/20 text-cyan-400' },
            { key: 'cameras' as const, label: '📷 Cameras', color: 'border-purple-500 bg-purple-900/20 text-purple-400' },
            { key: 'flockCameras' as const, label: '👁️ Flock', color: 'border-orange-500 bg-orange-900/20 text-orange-400' },
          ].map(({ key, label, color }) => (
            <button
              key={key}
              onClick={() => toggleFilter(key)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-all font-medium ${
                mapFilter[key]
                  ? color
                  : 'border-gray-700 text-gray-600 bg-transparent hover:border-gray-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <MapView
          satellites={mapFilter.satellites ? mockSatellites : []}
          aircraft={mapFilter.aircraft ? mockAircraft : []}
          ships={mapFilter.ships ? mockShips : []}
          cameras={mapFilter.cameras ? mockCameras : []}
          flockCameras={mapFilter.flockCameras ? mockFlockCameras : []}
          filter={mapFilter}
          height="450px"
        />
      </div>

      {/* Quick actions */}
      <div className="card">
        <div className="card-header">
          <TrendingUp size={18} className="text-gray-400" />
          <h3 className="section-title">Quick Access</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {quickActions.map(({ label, icon: Icon, color, id, description }) => (
            <button
              key={label}
              onClick={() => onNavigate(id)}
              className="p-4 bg-gray-900 hover:bg-gray-800 rounded-xl border border-gray-800 hover:border-gray-600 transition-all group text-center"
            >
              <Icon size={24} className={`mx-auto ${color} mb-2`} />
              <p className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">
                {label}
              </p>
              <p className="text-xs text-gray-600 mt-0.5">{description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Recent data tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent aircraft */}
        <div className="card">
          <div className="card-header">
            <Plane size={16} className="text-blue-400" />
            <h3 className="section-title">Recent Aircraft</h3>
            <button onClick={() => onNavigate('aircraft')} className="ml-auto text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
              View all <ExternalLink size={11} />
            </button>
          </div>
          <div className="space-y-2">
            {mockAircraft.slice(0, 3).map((ac) => (
              <div key={ac.icao} className="flex items-center gap-3 p-2 bg-gray-900 rounded-lg">
                <Plane size={14} className="text-blue-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-200">{ac.callsign}</p>
                  <p className="text-xs text-gray-500">
                    {ac.origin && ac.destination ? `${ac.origin} → ${ac.destination}` : ac.airline || 'Unknown'}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-gray-400">{ac.altitude.toLocaleString()} ft</p>
                  <span className="badge badge-green text-xs">airborne</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent ships */}
        <div className="card">
          <div className="card-header">
            <Ship size={16} className="text-cyan-400" />
            <h3 className="section-title">Recent Ships</h3>
            <button onClick={() => onNavigate('ships')} className="ml-auto text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
              View all <ExternalLink size={11} />
            </button>
          </div>
          <div className="space-y-2">
            {mockShips.slice(0, 3).map((ship) => (
              <div key={ship.mmsi} className="flex items-center gap-3 p-2 bg-gray-900 rounded-lg">
                <Ship size={14} className="text-cyan-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-200">{ship.name}</p>
                  <p className="text-xs text-gray-500">
                    {ship.type} • {ship.flag || 'Unknown flag'}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-gray-400">{ship.speed} kts</p>
                  <span className="badge badge-blue text-xs">
                    {ship.status.length > 12 ? 'underway' : ship.status.toLowerCase()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
