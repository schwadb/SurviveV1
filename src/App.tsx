import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Routes, Route } from 'react-router-dom';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
import AlertsPanel from './components/common/AlertsPanel';
import ErrorBoundary from './components/common/ErrorBoundary';
import Dashboard from './pages/Dashboard';
import SatelliteTracker from './components/tracking/SatelliteTracker';
import AircraftTracker from './components/tracking/AircraftTracker';
import ShipTracker from './components/tracking/ShipTracker';
import PublicCameras from './components/cameras/PublicCameras';
import FlockCameras from './components/cameras/FlockCameras';
import PersonLookup from './components/lookup/PersonLookup';
import PhoneLookup from './components/lookup/PhoneLookup';
import AddressLookup from './components/lookup/AddressLookup';
import EmailDomainOSINT from './components/lookup/EmailDomainOSINT';
import ScannerAccess from './components/scanners/ScannerAccess';
import PerplexitySearch from './components/ai/PerplexitySearch';
import ResourceManager from './components/resources/ResourceManager';
import Settings from './components/resources/Settings';
import WatchlistPanel from './components/common/WatchlistPanel';
import { useTheme } from './hooks/useLocalStorage';
import type { Alert } from './types';
import { mockAlerts } from './data/mockData';

const ROUTE_META: Record<string, { title: string; subtitle: string }> = {
  '/': { title: 'Dashboard', subtitle: 'Live intelligence overview' },
  '/satellites': { title: 'Satellite Tracker', subtitle: 'Real-time orbital tracking via CelesTrak & N2YO' },
  '/aircraft': { title: 'Aircraft Tracker', subtitle: 'Live ADS-B flight data via OpenSky Network' },
  '/ships': { title: 'Ship Tracker', subtitle: 'AIS maritime vessel tracking' },
  '/cameras': { title: 'Public Cameras', subtitle: 'Open webcam feeds worldwide' },
  '/flock': { title: 'Flock Cameras', subtitle: 'License plate reader network mapping' },
  '/person': { title: 'Person Lookup', subtitle: 'OSINT people search from public records' },
  '/phone': { title: 'Phone Lookup', subtitle: 'Carrier, location & spam lookup' },
  '/address': { title: 'Address Lookup', subtitle: 'Geocoding & property records' },
  '/email': { title: 'Email & Domain OSINT', subtitle: 'Breach checks, WHOIS, DNS, Shodan, IP intel' },
  '/scanners': { title: 'Scanner Access', subtitle: 'Live police, fire, EMS & ATC radio feeds' },
  '/ai-search': { title: 'Perplexity AI Search', subtitle: 'AI-powered OSINT research with real-time web search' },
  '/watchlist': { title: 'Watchlist', subtitle: 'Monitor specific targets across all data sources' },
  '/resources': { title: 'Resource Manager', subtitle: 'Manage OSINT tools, APIs & data sources' },
  '/settings': { title: 'Settings', subtitle: 'Configure API keys, live data & preferences' },
};

const App: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [alerts, setAlerts] = useState<Alert[]>(mockAlerts);
  const [showAlerts, setShowAlerts] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { darkMode } = useTheme();

  // Apply dark/light class on body
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const currentSection = location.pathname;
  const meta = ROUTE_META[currentSection] ?? ROUTE_META['/'];

  const markAlertRead = (id: string) =>
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, read: true } : a));

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 1500);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0e1a]">
      <Sidebar
        activeSection={currentSection.slice(1) || 'dashboard'}
        onNavigate={(section) => navigate(section === 'dashboard' ? '/' : `/${section}`)}
        alertCount={alerts.filter(a => !a.read).length}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
          title={meta.title}
          subtitle={meta.subtitle}
          alerts={alerts}
          onAlertsClick={() => setShowAlerts(!showAlerts)}
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
        />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Routes>
            <Route path="/" element={
              <ErrorBoundary fallbackTitle="Dashboard Error">
                <Dashboard onNavigate={(s) => navigate(s === 'dashboard' ? '/' : `/${s}`)} />
              </ErrorBoundary>
            } />
            <Route path="/satellites" element={<ErrorBoundary fallbackTitle="Satellite Tracker Error"><SatelliteTracker /></ErrorBoundary>} />
            <Route path="/aircraft" element={<ErrorBoundary fallbackTitle="Aircraft Tracker Error"><AircraftTracker /></ErrorBoundary>} />
            <Route path="/ships" element={<ErrorBoundary fallbackTitle="Ship Tracker Error"><ShipTracker /></ErrorBoundary>} />
            <Route path="/cameras" element={<ErrorBoundary fallbackTitle="Cameras Error"><PublicCameras /></ErrorBoundary>} />
            <Route path="/flock" element={<ErrorBoundary fallbackTitle="Flock Cameras Error"><FlockCameras /></ErrorBoundary>} />
            <Route path="/person" element={<ErrorBoundary fallbackTitle="Person Lookup Error"><PersonLookup /></ErrorBoundary>} />
            <Route path="/phone" element={<ErrorBoundary fallbackTitle="Phone Lookup Error"><PhoneLookup /></ErrorBoundary>} />
            <Route path="/address" element={<ErrorBoundary fallbackTitle="Address Lookup Error"><AddressLookup /></ErrorBoundary>} />
            <Route path="/email" element={<ErrorBoundary fallbackTitle="Email/Domain OSINT Error"><EmailDomainOSINT /></ErrorBoundary>} />
            <Route path="/scanners" element={<ErrorBoundary fallbackTitle="Scanner Error"><ScannerAccess /></ErrorBoundary>} />
            <Route path="/ai-search" element={<ErrorBoundary fallbackTitle="AI Search Error"><PerplexitySearch /></ErrorBoundary>} />
            <Route path="/watchlist" element={<ErrorBoundary fallbackTitle="Watchlist Error"><WatchlistPanel /></ErrorBoundary>} />
            <Route path="/resources" element={<ErrorBoundary fallbackTitle="Resources Error"><ResourceManager /></ErrorBoundary>} />
            <Route path="/settings" element={<ErrorBoundary fallbackTitle="Settings Error"><Settings /></ErrorBoundary>} />
            <Route path="*" element={<ErrorBoundary fallbackTitle="Page Error"><Dashboard onNavigate={(s) => navigate(`/${s}`)} /></ErrorBoundary>} />
          </Routes>
        </main>
      </div>

      {showAlerts && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm" onClick={() => setShowAlerts(false)} />
          <AlertsPanel alerts={alerts} onClose={() => setShowAlerts(false)}
            onMarkRead={markAlertRead} onClearAll={() => setAlerts([])} />
        </>
      )}
    </div>
  );
};

export default App;
