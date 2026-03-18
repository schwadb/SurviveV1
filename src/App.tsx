import React, { useState } from 'react';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
import AlertsPanel from './components/common/AlertsPanel';
import Dashboard from './pages/Dashboard';
import SatelliteTracker from './components/tracking/SatelliteTracker';
import AircraftTracker from './components/tracking/AircraftTracker';
import ShipTracker from './components/tracking/ShipTracker';
import PublicCameras from './components/cameras/PublicCameras';
import FlockCameras from './components/cameras/FlockCameras';
import PersonLookup from './components/lookup/PersonLookup';
import PhoneLookup from './components/lookup/PhoneLookup';
import AddressLookup from './components/lookup/AddressLookup';
import ScannerAccess from './components/scanners/ScannerAccess';
import PerplexitySearch from './components/ai/PerplexitySearch';
import ResourceManager from './components/resources/ResourceManager';
import Settings from './components/resources/Settings';
import type { Alert } from './types';
import { mockAlerts } from './data/mockData';

const sectionMeta: Record<string, { title: string; subtitle: string }> = {
  dashboard: { title: 'Dashboard', subtitle: 'Live intelligence overview' },
  satellites: { title: 'Satellite Tracker', subtitle: 'Real-time orbital tracking via CelesTrak & N2YO' },
  aircraft: { title: 'Aircraft Tracker', subtitle: 'Live ADS-B flight data via OpenSky Network' },
  ships: { title: 'Ship Tracker', subtitle: 'AIS maritime vessel tracking' },
  cameras: { title: 'Public Cameras', subtitle: 'Open webcam feeds worldwide' },
  flock: { title: 'Flock Cameras', subtitle: 'License plate reader network mapping' },
  person: { title: 'Person Lookup', subtitle: 'OSINT people search from public records' },
  phone: { title: 'Phone Lookup', subtitle: 'Carrier, location & spam lookup' },
  address: { title: 'Address Lookup', subtitle: 'Geocoding & property records' },
  scanners: { title: 'Scanner Access', subtitle: 'Live police, fire, EMS & ATC radio feeds' },
  'ai-search': { title: 'Perplexity AI Search', subtitle: 'AI-powered OSINT research with web search' },
  resources: { title: 'Resource Manager', subtitle: 'Manage OSINT tools, APIs & data sources' },
  settings: { title: 'Settings', subtitle: 'Configure API keys & preferences' },
  alerts: { title: 'Alerts', subtitle: 'Activity notifications' },
};

const App: React.FC = () => {
  const [activeSection, setActiveSection] = useState('dashboard');
  const [alerts, setAlerts] = useState<Alert[]>(mockAlerts);
  const [showAlerts, setShowAlerts] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 1500);
  };

  const markAlertRead = (id: string) => {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, read: true } : a)));
  };

  const clearAllAlerts = () => setAlerts([]);

  const renderSection = () => {
    switch (activeSection) {
      case 'dashboard': return <Dashboard onNavigate={setActiveSection} />;
      case 'satellites': return <SatelliteTracker />;
      case 'aircraft': return <AircraftTracker />;
      case 'ships': return <ShipTracker />;
      case 'cameras': return <PublicCameras />;
      case 'flock': return <FlockCameras />;
      case 'person': return <PersonLookup />;
      case 'phone': return <PhoneLookup />;
      case 'address': return <AddressLookup />;
      case 'scanners': return <ScannerAccess />;
      case 'ai-search': return <PerplexitySearch />;
      case 'resources': return <ResourceManager />;
      case 'settings': return <Settings />;
      default: return <Dashboard onNavigate={setActiveSection} />;
    }
  };

  const currentMeta = sectionMeta[activeSection] || sectionMeta.dashboard;

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0e1a]">
      <Sidebar
        activeSection={activeSection}
        onNavigate={setActiveSection}
        alertCount={alerts.filter((a) => !a.read).length}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
          title={currentMeta.title}
          subtitle={currentMeta.subtitle}
          alerts={alerts}
          onAlertsClick={() => setShowAlerts(!showAlerts)}
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
        />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          {renderSection()}
        </main>
      </div>

      {showAlerts && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
            onClick={() => setShowAlerts(false)}
          />
          <AlertsPanel
            alerts={alerts}
            onClose={() => setShowAlerts(false)}
            onMarkRead={markAlertRead}
            onClearAll={clearAllAlerts}
          />
        </>
      )}
    </div>
  );
};

export default App;
