import React, { useState } from 'react';
import { Camera, ExternalLink, Search, MapPin, Filter, Grid, List } from 'lucide-react';
import type { Camera as CameraType, MapFilter } from '../../types';
import { mockCameras } from '../../data/mockData';
import MapView from '../common/MapView';

const defaultFilter: MapFilter = {
  satellites: false,
  aircraft: false,
  ships: false,
  cameras: true,
  flockCameras: false,
};

const CAMERA_SOURCES = [
  { name: 'EarthCam', url: 'https://www.earthcam.com', description: 'Iconic locations worldwide' },
  { name: 'Insecam', url: 'http://www.insecam.org', description: 'Public IP cameras directory' },
  { name: 'OpenTopia', url: 'http://www.opentopia.com', description: 'Open webcam directory' },
  { name: 'WorldCam', url: 'https://worldcam.eu', description: 'European webcams' },
  { name: 'Camvista', url: 'https://www.camvista.com', description: 'UK & global cameras' },
  { name: '511 Traffic', url: 'https://511.org', description: 'US state traffic cameras' },
  { name: 'Airport Webcams', url: 'https://airportwebcams.net', description: 'Airport cameras' },
  { name: 'WeatherBug', url: 'https://www.weatherbug.com', description: 'Weather station cameras' },
];

const PublicCameras: React.FC = () => {
  const [cameras, setCameras] = useState<CameraType[]>(mockCameras);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [newCam, setNewCam] = useState({ name: '', url: '', location: '', lat: '', lng: '' });
  const [showAddForm, setShowAddForm] = useState(false);

  const cameraTypes = ['all', 'traffic', 'weather', 'wildlife', 'city', 'beach', 'airport', 'other'];

  const filtered = cameras.filter((c) => {
    const matchSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.location.toLowerCase().includes(search.toLowerCase()) ||
      c.source.toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === 'all' || c.type === typeFilter;
    return matchSearch && matchType;
  });

  const handleAddCamera = () => {
    if (!newCam.name || !newCam.url) return;
    const cam: CameraType = {
      id: `cam-custom-${Date.now()}`,
      name: newCam.name,
      type: 'other',
      lat: parseFloat(newCam.lat) || 0,
      lng: parseFloat(newCam.lng) || 0,
      streamUrl: newCam.url,
      location: newCam.location || 'Unknown',
      country: 'Unknown',
      status: 'unknown',
      source: 'Custom',
    };
    setCameras((prev) => [...prev, cam]);
    setNewCam({ name: '', url: '', location: '', lat: '', lng: '' });
    setShowAddForm(false);
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search cameras..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-9"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="input-field sm:w-36"
          >
            {cameraTypes.map((t) => (
              <option key={t} value={t}>
                {t === 'all' ? 'All Types' : t.charAt(0).toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
          <div className="flex gap-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-lg ${viewMode === 'grid' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400'}`}
            >
              <Grid size={16} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-lg ${viewMode === 'list' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400'}`}
            >
              <List size={16} />
            </button>
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="btn-primary"
          >
            + Add Camera
          </button>
        </div>

        {/* Add form */}
        {showAddForm && (
          <div className="mt-4 pt-4 border-t border-gray-800 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              className="input-field"
              placeholder="Camera name *"
              value={newCam.name}
              onChange={(e) => setNewCam((p) => ({ ...p, name: e.target.value }))}
            />
            <input
              className="input-field"
              placeholder="Stream URL *"
              value={newCam.url}
              onChange={(e) => setNewCam((p) => ({ ...p, url: e.target.value }))}
            />
            <input
              className="input-field"
              placeholder="Location description"
              value={newCam.location}
              onChange={(e) => setNewCam((p) => ({ ...p, location: e.target.value }))}
            />
            <input
              className="input-field"
              placeholder="Latitude"
              type="number"
              value={newCam.lat}
              onChange={(e) => setNewCam((p) => ({ ...p, lat: e.target.value }))}
            />
            <input
              className="input-field"
              placeholder="Longitude"
              type="number"
              value={newCam.lng}
              onChange={(e) => setNewCam((p) => ({ ...p, lng: e.target.value }))}
            />
            <div className="flex gap-2">
              <button onClick={handleAddCamera} className="btn-primary flex-1">
                Add
              </button>
              <button onClick={() => setShowAddForm(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Map */}
      <div className="card">
        <div className="card-header">
          <Camera size={18} className="text-purple-400" />
          <h3 className="section-title">Camera Locations</h3>
          <span className="badge badge-purple ml-auto">{filtered.length} cameras</span>
        </div>
        <MapView cameras={filtered} filter={defaultFilter} height="300px" />
      </div>

      {/* Camera grid/list */}
      <div className="card">
        <div className="card-header">
          <Filter size={16} className="text-gray-400" />
          <h3 className="section-title">Cameras</h3>
        </div>

        {viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((cam) => (
              <div key={cam.id} className="bg-gray-900 rounded-lg overflow-hidden border border-gray-800 hover:border-purple-700/50 transition-colors">
                {/* Placeholder thumbnail */}
                <div className="h-32 bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center relative">
                  <Camera size={28} className="text-gray-600" />
                  <div className="absolute top-2 right-2">
                    <span
                      className={`badge ${cam.status === 'live' ? 'badge-green' : 'badge-red'}`}
                    >
                      <span
                        className={`status-dot mr-1 ${
                          cam.status === 'live' ? 'bg-green-500 live-indicator' : 'bg-red-500'
                        }`}
                      />
                      {cam.status}
                    </span>
                  </div>
                  <div className="absolute bottom-2 left-2 right-2">
                    <span className="badge badge-purple text-xs">{cam.type}</span>
                  </div>
                </div>
                <div className="p-3">
                  <h4 className="text-sm font-medium text-gray-200 truncate">{cam.name}</h4>
                  <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                    <MapPin size={10} />
                    {cam.location}
                  </p>
                  <p className="text-xs text-gray-600 mt-0.5">Source: {cam.source}</p>
                  {cam.streamUrl && (
                    <a
                      href={cam.streamUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300"
                    >
                      <ExternalLink size={11} />
                      View Stream
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Location</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Stream</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((cam) => (
                  <tr key={cam.id}>
                    <td className="font-medium text-gray-200">{cam.name}</td>
                    <td><span className="badge badge-purple">{cam.type}</span></td>
                    <td className="text-gray-400 max-w-[150px] truncate">{cam.location}</td>
                    <td className="text-gray-400">{cam.source}</td>
                    <td>
                      <span className={`badge ${cam.status === 'live' ? 'badge-green' : 'badge-red'}`}>
                        {cam.status}
                      </span>
                    </td>
                    <td>
                      {cam.streamUrl ? (
                        <a
                          href={cam.streamUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-purple-400 hover:text-purple-300 flex items-center gap-1 text-xs"
                        >
                          <ExternalLink size={11} />
                          View
                        </a>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Public Sources */}
      <div className="card">
        <div className="card-header">
          <ExternalLink size={16} className="text-gray-400" />
          <h3 className="section-title">Public Camera Sources</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {CAMERA_SOURCES.map((source) => (
            <a
              key={source.name}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-gray-900 hover:bg-gray-800 rounded-lg p-3 border border-gray-800 hover:border-purple-700/50 transition-all group"
            >
              <div className="flex items-center gap-2 mb-1">
                <Camera size={14} className="text-purple-400" />
                <span className="text-sm font-medium text-gray-200 group-hover:text-purple-300 transition-colors">
                  {source.name}
                </span>
                <ExternalLink size={11} className="text-gray-600 ml-auto group-hover:text-purple-400" />
              </div>
              <p className="text-xs text-gray-500">{source.description}</p>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PublicCameras;
