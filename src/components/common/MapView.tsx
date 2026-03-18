import React, { useEffect, useRef } from 'react';
import type { Satellite, Aircraft, Ship, Camera, FlockCamera, MapFilter } from '../../types';

interface MapViewProps {
  satellites?: Satellite[];
  aircraft?: Aircraft[];
  ships?: Ship[];
  cameras?: Camera[];
  flockCameras?: FlockCamera[];
  filter: MapFilter;
  height?: string;
  center?: [number, number];
  zoom?: number;
}

// We'll load Leaflet dynamically to avoid SSR issues
const MapView: React.FC<MapViewProps> = ({
  satellites = [],
  aircraft = [],
  ships = [],
  cameras = [],
  flockCameras = [],
  filter,
  height = '500px',
  center = [20, 0],
  zoom = 2,
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<unknown>(null);
  const markersRef = useRef<unknown[]>([]);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    // Dynamic import of Leaflet
    import('leaflet').then((L) => {
      if (!mapRef.current || mapInstance.current) return;

      const map = L.map(mapRef.current, {
        center,
        zoom,
        zoomControl: true,
        attributionControl: true,
      });

      // Dark tile layer
      L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
          subdomains: 'abcd',
          maxZoom: 20,
        }
      ).addTo(map);

      mapInstance.current = map;
      addMarkers(L, map);
    });

    return () => {
      if (mapInstance.current) {
        (mapInstance.current as { remove: () => void }).remove();
        mapInstance.current = null;
      }
    };
  }, []);

  const addMarkers = (L: typeof import('leaflet'), map: import('leaflet').Map) => {
    // Clear existing markers
    markersRef.current.forEach((m) => (m as import('leaflet').Marker).remove());
    markersRef.current = [];

    const createIcon = (emoji: string, color: string) =>
      L.divIcon({
        html: `<div style="
          background: ${color};
          border: 2px solid white;
          border-radius: 50%;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          box-shadow: 0 0 8px ${color};
        ">${emoji}</div>`,
        className: '',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

    // Satellites
    if (filter.satellites) {
      satellites.forEach((sat) => {
        if (sat.lat === undefined || sat.lng === undefined) return;
        const marker = L.marker([sat.lat, sat.lng], {
          icon: createIcon('🛰️', 'rgba(99,102,241,0.8)'),
        })
          .addTo(map)
          .bindPopup(`
            <div style="font-family: system-ui; color: #e2e8f0; min-width: 180px">
              <strong style="color: #818cf8">${sat.name}</strong><br/>
              <small>NORAD: ${sat.noradId}</small><br/>
              Alt: ${sat.altitude.toLocaleString()} km<br/>
              Vel: ${sat.velocity.toLocaleString()} km/h<br/>
              Owner: ${sat.owner}
            </div>
          `);
        markersRef.current.push(marker);
      });
    }

    // Aircraft
    if (filter.aircraft) {
      aircraft.forEach((ac) => {
        if (!ac.lat || !ac.lng) return;
        const marker = L.marker([ac.lat, ac.lng], {
          icon: createIcon('✈️', 'rgba(59,130,246,0.8)'),
        })
          .addTo(map)
          .bindPopup(`
            <div style="font-family: system-ui; color: #e2e8f0; min-width: 180px">
              <strong style="color: #60a5fa">${ac.callsign}</strong>
              ${ac.emergency ? ' 🚨' : ''}<br/>
              <small>${ac.type || 'Unknown'} | ${ac.registration || 'N/A'}</small><br/>
              Alt: ${ac.altitude.toLocaleString()} ft<br/>
              Speed: ${ac.speed} kts<br/>
              ${ac.origin ? `${ac.origin} → ${ac.destination}` : ''}
            </div>
          `);
        markersRef.current.push(marker);
      });
    }

    // Ships
    if (filter.ships) {
      ships.forEach((ship) => {
        if (!ship.lat || !ship.lng) return;
        const marker = L.marker([ship.lat, ship.lng], {
          icon: createIcon('🚢', 'rgba(6,182,212,0.8)'),
        })
          .addTo(map)
          .bindPopup(`
            <div style="font-family: system-ui; color: #e2e8f0; min-width: 180px">
              <strong style="color: #22d3ee">${ship.name}</strong><br/>
              <small>MMSI: ${ship.mmsi} | ${ship.flag || 'Unknown'}</small><br/>
              Type: ${ship.type}<br/>
              Speed: ${ship.speed} kts<br/>
              ${ship.destination ? `To: ${ship.destination}` : ''}
            </div>
          `);
        markersRef.current.push(marker);
      });
    }

    // Cameras
    if (filter.cameras) {
      cameras.forEach((cam) => {
        if (!cam.lat || !cam.lng) return;
        const marker = L.marker([cam.lat, cam.lng], {
          icon: createIcon('📷', 'rgba(168,85,247,0.8)'),
        })
          .addTo(map)
          .bindPopup(`
            <div style="font-family: system-ui; color: #e2e8f0; min-width: 180px">
              <strong style="color: #c084fc">${cam.name}</strong><br/>
              <small>${cam.type.toUpperCase()} | ${cam.source}</small><br/>
              ${cam.location}<br/>
              Status: <span style="color: ${cam.status === 'live' ? '#4ade80' : '#f87171'}">${cam.status}</span><br/>
              ${cam.streamUrl ? `<a href="${cam.streamUrl}" target="_blank" style="color: #818cf8">View Stream</a>` : ''}
            </div>
          `);
        markersRef.current.push(marker);
      });
    }

    // Flock cameras
    if (filter.flockCameras) {
      flockCameras.forEach((fc) => {
        if (!fc.lat || !fc.lng) return;
        const marker = L.marker([fc.lat, fc.lng], {
          icon: createIcon('👁️', 'rgba(249,115,22,0.8)'),
        })
          .addTo(map)
          .bindPopup(`
            <div style="font-family: system-ui; color: #e2e8f0; min-width: 180px">
              <strong style="color: #fb923c">Flock Camera</strong><br/>
              <small>S/N: ${fc.serialNumber}</small><br/>
              ${fc.location}<br/>
              ${fc.city}, ${fc.state}<br/>
              Agency: ${fc.agency || 'Unknown'}<br/>
              Coverage: ${fc.coverage}°
            </div>
          `);
        markersRef.current.push(marker);
      });
    }
  };

  // Re-render markers when data or filters change
  useEffect(() => {
    if (!mapInstance.current) return;
    import('leaflet').then((L) => {
      addMarkers(L, mapInstance.current as import('leaflet').Map);
    });
  }, [satellites, aircraft, ships, cameras, flockCameras, filter]);

  return (
    <div
      ref={mapRef}
      style={{ height, width: '100%' }}
      className="rounded-lg overflow-hidden border border-gray-800"
    />
  );
};

export default MapView;
