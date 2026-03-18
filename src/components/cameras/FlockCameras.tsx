import React, { useState } from 'react';
import { Eye, MapPin, Search, ExternalLink, Shield, AlertTriangle } from 'lucide-react';
import type { FlockCamera, MapFilter } from '../../types';
import { mockFlockCameras } from '../../data/mockData';
import MapView from '../common/MapView';

const defaultFilter: MapFilter = {
  satellites: false,
  aircraft: false,
  ships: false,
  cameras: false,
  flockCameras: true,
};

const FLOCK_RESOURCES = [
  { name: 'Flock Safety', url: 'https://www.flocksafety.com', description: 'Official Flock Safety website' },
  { name: 'EFF Surveillance', url: 'https://www.eff.org/issues/surveillance-cameras', description: 'EFF on surveillance' },
  { name: 'Amnesia Scanner', url: 'https://amnesia.at', description: 'License plate reader database' },
  { name: 'DHS FOIA', url: 'https://www.dhs.gov/foia', description: 'Request surveillance records' },
];

const FlockCameras: React.FC = () => {
  const [cameras, setCameras] = useState<FlockCamera[]>(mockFlockCameras);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCam, setNewCam] = useState({
    serialNumber: '',
    location: '',
    city: '',
    state: '',
    lat: '',
    lng: '',
    agency: '',
  });

  const states = ['all', ...Array.from(new Set(cameras.map((c) => c.state))).sort()];

  const filtered = cameras.filter((c) => {
    const matchSearch =
      c.serialNumber.toLowerCase().includes(search.toLowerCase()) ||
      c.location.toLowerCase().includes(search.toLowerCase()) ||
      c.city.toLowerCase().includes(search.toLowerCase()) ||
      (c.agency?.toLowerCase().includes(search.toLowerCase()) ?? false);
    const matchState = stateFilter === 'all' || c.state === stateFilter;
    return matchSearch && matchState;
  });

  const handleAdd = () => {
    if (!newCam.serialNumber || !newCam.city) return;
    const cam: FlockCamera = {
      id: `flock-${Date.now()}`,
      serialNumber: newCam.serialNumber,
      lat: parseFloat(newCam.lat) || 0,
      lng: parseFloat(newCam.lng) || 0,
      location: newCam.location,
      city: newCam.city,
      state: newCam.state,
      status: 'active',
      coverage: 360,
      agency: newCam.agency,
    };
    setCameras((prev) => [...prev, cam]);
    setNewCam({ serialNumber: '', location: '', city: '', state: '', lat: '', lng: '', agency: '' });
    setShowAddForm(false);
  };

  return (
    <div className="space-y-4">
      {/* Disclaimer */}
      <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-xl p-4 flex gap-3">
        <AlertTriangle size={20} className="text-yellow-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-yellow-300 font-medium text-sm">Legal & Ethical Notice</p>
          <p className="text-yellow-400/80 text-xs mt-1">
            Flock Safety cameras are license plate readers (LPRs) deployed by law enforcement and
            private entities. This data is sourced from public records, FOIA requests, and community
            mapping projects. All information shown is from publicly available sources only.
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search by serial, location, city, agency..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-9"
            />
          </div>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="input-field sm:w-32"
          >
            {states.map((s) => (
              <option key={s} value={s}>{s === 'all' ? 'All States' : s}</option>
            ))}
          </select>
          <button onClick={() => setShowAddForm(!showAddForm)} className="btn-primary">
            + Add Camera
          </button>
        </div>

        {showAddForm && (
          <div className="mt-4 pt-4 border-t border-gray-800 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input className="input-field" placeholder="Serial Number *" value={newCam.serialNumber}
              onChange={(e) => setNewCam((p) => ({ ...p, serialNumber: e.target.value }))} />
            <input className="input-field" placeholder="Location description" value={newCam.location}
              onChange={(e) => setNewCam((p) => ({ ...p, location: e.target.value }))} />
            <input className="input-field" placeholder="City *" value={newCam.city}
              onChange={(e) => setNewCam((p) => ({ ...p, city: e.target.value }))} />
            <input className="input-field" placeholder="State (e.g. CA)" value={newCam.state}
              onChange={(e) => setNewCam((p) => ({ ...p, state: e.target.value }))} />
            <input className="input-field" placeholder="Latitude" type="number" value={newCam.lat}
              onChange={(e) => setNewCam((p) => ({ ...p, lat: e.target.value }))} />
            <input className="input-field" placeholder="Longitude" type="number" value={newCam.lng}
              onChange={(e) => setNewCam((p) => ({ ...p, lng: e.target.value }))} />
            <input className="input-field" placeholder="Agency (optional)" value={newCam.agency}
              onChange={(e) => setNewCam((p) => ({ ...p, agency: e.target.value }))} />
            <div className="flex gap-2 sm:col-span-2">
              <button onClick={handleAdd} className="btn-primary flex-1">Add Camera</button>
              <button onClick={() => setShowAddForm(false)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Mapped', value: cameras.length, color: 'text-orange-400' },
          { label: 'Active', value: cameras.filter((c) => c.status === 'active').length, color: 'text-green-400' },
          { label: 'States', value: new Set(cameras.map((c) => c.state)).size, color: 'text-blue-400' },
          { label: 'Agencies', value: new Set(cameras.map((c) => c.agency).filter(Boolean)).size, color: 'text-purple-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-500 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Map */}
      <div className="card">
        <div className="card-header">
          <Eye size={18} className="text-orange-400" />
          <h3 className="section-title">Flock Camera Locations</h3>
          <span className="badge badge-yellow ml-auto">{filtered.length} cameras</span>
        </div>
        <MapView flockCameras={filtered} filter={defaultFilter} height="350px" center={[37.09, -95.71]} zoom={4} />
      </div>

      {/* Table */}
      <div className="card">
        <div className="card-header">
          <Eye size={16} className="text-gray-400" />
          <h3 className="section-title">Camera Registry</h3>
        </div>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="data-table">
            <thead>
              <tr>
                <th>Serial Number</th>
                <th>Location</th>
                <th>City</th>
                <th>State</th>
                <th>Agency</th>
                <th>Coverage</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((cam) => (
                <tr key={cam.id}>
                  <td className="font-mono text-xs text-gray-300">{cam.serialNumber}</td>
                  <td className="text-gray-400 max-w-[150px] truncate">
                    <div className="flex items-center gap-1">
                      <MapPin size={11} className="text-orange-400 flex-shrink-0" />
                      {cam.location}
                    </div>
                  </td>
                  <td className="text-gray-400">{cam.city}</td>
                  <td className="text-gray-400">{cam.state}</td>
                  <td className="text-gray-400">
                    {cam.agency ? (
                      <div className="flex items-center gap-1">
                        <Shield size={11} className="text-blue-400" />
                        {cam.agency}
                      </div>
                    ) : '—'}
                  </td>
                  <td className="text-gray-400">{cam.coverage}°</td>
                  <td>
                    <span className={`badge ${cam.status === 'active' ? 'badge-green' : 'badge-red'}`}>
                      <span className={`status-dot mr-1 ${cam.status === 'active' ? 'bg-green-500 live-indicator' : 'bg-red-500'}`} />
                      {cam.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Resources */}
      <div className="card">
        <div className="card-header">
          <ExternalLink size={16} className="text-gray-400" />
          <h3 className="section-title">Flock Camera Resources</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FLOCK_RESOURCES.map((r) => (
            <a key={r.name} href={r.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-3 p-3 bg-gray-900 rounded-lg border border-gray-800 hover:border-orange-700/50 transition-all group">
              <Eye size={18} className="text-orange-400 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-200 group-hover:text-orange-300">{r.name}</p>
                <p className="text-xs text-gray-500">{r.description}</p>
              </div>
              <ExternalLink size={13} className="ml-auto text-gray-600 group-hover:text-orange-400" />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FlockCameras;
