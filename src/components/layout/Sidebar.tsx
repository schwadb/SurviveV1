import React, { useState } from 'react';
import {
  Satellite, Plane, Ship, Camera, Radio, Search, Settings, Database,
  Shield, Menu, X, Eye, Phone, MapPin, User, AlertTriangle, ChevronRight,
  Zap, Star, Mail, Sun, Moon, Anchor, Bot, FileSearch, Network, Lock, Radar,
} from 'lucide-react';
import { useTheme } from '../../hooks/useLocalStorage';

const navGroups = [
  {
    title: 'TRACKING',
    items: [
      { id: 'satellites', label: 'Satellites', icon: Satellite, color: 'text-indigo-400' },
      { id: 'aircraft', label: 'Aircraft', icon: Plane, color: 'text-blue-400' },
      { id: 'ships', label: 'Ships', icon: Ship, color: 'text-cyan-400' },
      { id: 'chokepoints', label: 'Chokepoints', icon: Anchor, color: 'text-orange-400' },
    ],
  },
  {
    title: 'SURVEILLANCE',
    items: [
      { id: 'cameras', label: 'Public Cameras', icon: Camera, color: 'text-purple-400' },
      { id: 'flock', label: 'Flock Cameras', icon: Eye, color: 'text-orange-400' },
      { id: 'scanners', label: 'Scanners', icon: Radio, color: 'text-green-400' },
    ],
  },
  {
    title: 'INTELLIGENCE',
    items: [
      { id: 'investigations', label: 'Investigations', icon: Network, color: 'text-indigo-400' },
      { id: 'person', label: 'Person Lookup', icon: User, color: 'text-rose-400' },
      { id: 'phone', label: 'Phone Lookup', icon: Phone, color: 'text-yellow-400' },
      { id: 'address', label: 'Address Lookup', icon: MapPin, color: 'text-teal-400' },
      { id: 'email', label: 'Email & Domain', icon: Mail, color: 'text-blue-300' },
      { id: 'dorks', label: 'Dork Builder', icon: FileSearch, color: 'text-red-400' },
    ],
  },
  {
    title: 'TOOLS',
    items: [
      { id: 'ai-search', label: 'Perplexity AI', icon: Search, color: 'text-violet-400' },
      { id: 'agents', label: 'Agent Recorder', icon: Bot, color: 'text-emerald-400' },
      { id: 'monitors', label: 'Monitors', icon: Radar, color: 'text-emerald-400' },
      { id: 'watchlist', label: 'Watchlist', icon: Star, color: 'text-yellow-400' },
      { id: 'security', label: 'Security & OPSEC', icon: Lock, color: 'text-green-400' },
      { id: 'resources', label: 'Resources', icon: Database, color: 'text-gray-400' },
      { id: 'settings', label: 'Settings', icon: Settings, color: 'text-gray-400' },
    ],
  },
];

interface SidebarProps {
  activeSection: string;
  onNavigate: (section: string) => void;
  alertCount?: number;
}

const Sidebar: React.FC<SidebarProps> = ({ activeSection, onNavigate, alertCount = 0 }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { darkMode, toggleTheme } = useTheme();

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Shield size={30} className="text-indigo-500" />
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full live-indicator" />
          </div>
          <div className="flex-1">
            <h1 className="text-white font-bold text-base tracking-tight leading-none">WatcherV1</h1>
            <p className="text-gray-500 text-xs mt-0.5">OSINT Platform v2.0</p>
          </div>
          <button onClick={toggleTheme} className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors" title="Toggle theme">
            {darkMode ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {navGroups.map((group) => (
          <div key={group.title}>
            <p className="text-gray-600 text-xs font-semibold uppercase tracking-widest mb-2 px-1">
              {group.title}
            </p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      onNavigate(item.id);
                      setMobileOpen(false);
                    }}
                    className={`w-full ${isActive ? 'nav-item-active' : 'nav-item-inactive'} group`}
                  >
                    <Icon
                      size={18}
                      className={isActive ? 'text-indigo-400' : item.color || 'text-gray-500'}
                    />
                    <span className="flex-1 text-left">{item.label}</span>
                    {isActive && <ChevronRight size={14} className="text-indigo-400" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Alerts & Status */}
      <div className="px-3 pb-4 border-t border-gray-800 pt-4 space-y-2">
        {alertCount > 0 && (
          <button
            onClick={() => onNavigate('alerts')}
            className="w-full nav-item-inactive group"
          >
            <AlertTriangle size={18} className="text-yellow-400" />
            <span className="flex-1 text-left text-yellow-400">Alerts</span>
            <span className="bg-yellow-500/20 text-yellow-400 text-xs px-2 py-0.5 rounded-full font-medium">
              {alertCount}
            </span>
          </button>
        )}

        <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-600">
          <Zap size={12} className="text-green-500" />
          <span>Live feeds active</span>
          <span className="ml-auto text-gray-700">v1.0.0</span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-gray-900 rounded-lg border border-gray-700"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle menu"
      >
        {mobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={`lg:hidden fixed left-0 top-0 bottom-0 w-72 bg-[#111827] border-r border-gray-800 z-50 transition-transform duration-300 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-64 bg-[#111827] border-r border-gray-800 h-screen sticky top-0">
        {sidebarContent}
      </aside>
    </>
  );
};

export default Sidebar;
