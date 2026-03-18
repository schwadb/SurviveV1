import React, { useState } from 'react';
import { MapPin, Search, ExternalLink, AlertTriangle, Loader2, Home, Users } from 'lucide-react';
import { geocodeAddress } from '../../services/api';

interface GeoResult {
  display_name: string;
  lat: string;
  lon: string;
  address?: Record<string, string>;
}

const ADDRESS_RESOURCES = [
  { name: 'Zillow', url: 'https://www.zillow.com/homes/', description: 'Property values & history', icon: '🏠' },
  { name: 'Redfin', url: 'https://www.redfin.com/', description: 'Real estate data', icon: '🔴' },
  { name: 'County Recorder', url: 'https://publicrecords.netronline.com/', description: 'Property ownership', icon: '📜' },
  { name: 'USPS Address Verify', url: 'https://tools.usps.com/zip-code-lookup.htm', description: 'Verify US address', icon: '📮' },
  { name: 'Google Street View', url: 'https://maps.google.com/', description: 'Visual inspection', icon: '🗺️' },
  { name: 'Bing Maps Bird Eye', url: 'https://www.bing.com/maps/', description: 'Aerial view', icon: '🦅' },
  { name: 'CourtListener', url: 'https://www.courtlistener.com/', description: 'Court records by address', icon: '⚖️' },
  { name: 'PACER', url: 'https://pacer.uscourts.gov/', description: 'Federal court records', icon: '🏛️' },
];

const AddressLookup: React.FC = () => {
  const [address, setAddress] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<GeoResult | null>(null);

  const handleSearch = async () => {
    if (!address.trim()) return;
    setIsLoading(true);
    setError('');
    setResults([]);

    try {
      const data = await geocodeAddress(address);
      setResults(data);
      if (data.length > 0) setSelected(data[0]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Geocoding failed');
    } finally {
      setIsLoading(false);
    }
  };

  const buildAddressUrl = (baseUrl: string) => {
    if (!selected) return baseUrl;
    return `${baseUrl}${encodeURIComponent(selected.display_name)}`;
  };

  return (
    <div className="space-y-4">
      {/* Disclaimer */}
      <div className="bg-amber-900/20 border border-amber-700/50 rounded-xl p-4 flex gap-3">
        <AlertTriangle size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-amber-300 font-medium text-sm">Public Records Only</p>
          <p className="text-amber-400/80 text-xs mt-1">
            Address lookups aggregate public property records and mapping data. Use only for
            legitimate purposes. Results link to third-party services with their own terms of service.
          </p>
        </div>
      </div>

      {/* Search form */}
      <div className="card">
        <div className="card-header">
          <MapPin size={18} className="text-teal-400" />
          <h3 className="section-title">Address Lookup & Geocoding</h3>
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1">
            <MapPin size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              className="input-field pl-9"
              placeholder="123 Main St, City, State, ZIP..."
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <button onClick={handleSearch} disabled={isLoading || !address.trim()} className="btn-primary">
            {isLoading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            Search
          </button>
        </div>

        {error && (
          <div className="mt-3 p-3 bg-red-900/20 border border-red-800 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-gray-500">{results.length} result(s) found</p>
            {results.map((r, i) => (
              <button
                key={i}
                onClick={() => setSelected(r)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  selected === r
                    ? 'border-teal-500 bg-teal-900/20'
                    : 'border-gray-800 bg-gray-900 hover:border-gray-600'
                }`}
              >
                <div className="flex items-start gap-2">
                  <MapPin size={14} className="text-teal-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-200">{r.display_name}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {parseFloat(r.lat).toFixed(6)}, {parseFloat(r.lon).toFixed(6)}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Selected address details */}
        {selected && (
          <div className="mt-4 p-4 bg-gray-900 rounded-lg border border-gray-700">
            <div className="flex items-center gap-2 mb-3">
              <Home size={16} className="text-teal-400" />
              <h4 className="text-sm font-semibold text-gray-200">Address Details</h4>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-gray-800 rounded p-2">
                <p className="text-xs text-gray-500">Latitude</p>
                <p className="text-sm text-gray-300 font-mono">{parseFloat(selected.lat).toFixed(6)}</p>
              </div>
              <div className="bg-gray-800 rounded p-2">
                <p className="text-xs text-gray-500">Longitude</p>
                <p className="text-sm text-gray-300 font-mono">{parseFloat(selected.lon).toFixed(6)}</p>
              </div>
              {selected.address && Object.entries(selected.address).slice(0, 6).map(([k, v]) => (
                <div key={k} className="bg-gray-800 rounded p-2">
                  <p className="text-xs text-gray-500 capitalize">{k.replace('_', ' ')}</p>
                  <p className="text-sm text-gray-300">{v}</p>
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={`https://maps.google.com/?q=${selected.lat},${selected.lon}`}
                target="_blank" rel="noopener noreferrer"
                className="btn-primary text-sm"
              >
                <ExternalLink size={13} />
                Google Maps
              </a>
              <a
                href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${selected.lat},${selected.lon}`}
                target="_blank" rel="noopener noreferrer"
                className="btn-secondary text-sm"
              >
                <ExternalLink size={13} />
                Street View
              </a>
              <a
                href={`https://www.bing.com/maps/?cp=${selected.lat}~${selected.lon}&lvl=17&style=b`}
                target="_blank" rel="noopener noreferrer"
                className="btn-secondary text-sm"
              >
                <ExternalLink size={13} />
                Bing Bird Eye
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Property Research Links */}
      <div className="card">
        <div className="card-header">
          <Home size={18} className="text-teal-400" />
          <h3 className="section-title">Property & Records Research</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {ADDRESS_RESOURCES.map((r) => (
            <a
              key={r.name}
              href={selected ? buildAddressUrl(r.url) : r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 p-3 bg-gray-900 rounded-lg border border-gray-800 hover:border-teal-700/50 transition-all group"
            >
              <span className="text-2xl">{r.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-200 group-hover:text-teal-300 transition-colors">
                  {r.name}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{r.description}</p>
              </div>
              <ExternalLink size={12} className="text-gray-600 group-hover:text-teal-400 flex-shrink-0 mt-1" />
            </a>
          ))}
        </div>
      </div>

      {/* Residents research */}
      <div className="card">
        <div className="card-header">
          <Users size={18} className="text-teal-400" />
          <h3 className="section-title">Residents & Ownership Research</h3>
        </div>
        <div className="space-y-2">
          {[
            { name: 'WhitePages Address Lookup', url: 'https://www.whitepages.com/address/', description: 'Find residents at address' },
            { name: 'Spokeo Address Search', url: 'https://www.spokeo.com/address-search/', description: 'History of residents' },
            { name: 'County Assessor', url: 'https://publicrecords.netronline.com/', description: 'Property tax & ownership' },
            { name: 'OpenCorporates', url: 'https://opencorporates.com/', description: 'Business registered at address' },
          ].map((r) => (
            <a
              key={r.name}
              href={selected ? `${r.url}${encodeURIComponent(selected.display_name)}` : r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-3 bg-gray-900 rounded-lg border border-gray-800 hover:border-teal-700/50 transition-all group"
            >
              <Users size={14} className="text-teal-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-200 group-hover:text-teal-300">{r.name}</p>
                <p className="text-xs text-gray-500">{r.description}</p>
              </div>
              <ExternalLink size={12} className="text-gray-600 group-hover:text-teal-400" />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AddressLookup;
