import React, { useEffect, useRef, useMemo } from 'react';
import 'leaflet-draw/dist/leaflet.draw.css';
import type { FeatureCollection } from 'geojson';
import type { Satellite, Aircraft, Ship, Camera, FlockCamera, MapFilter } from '../../types';
import type { JammingZone } from '../../services/jammingDetector';
import type { AirspaceZone } from '../../services/airspaceApi';
import type { Geofence } from '../../services/geofence';
import { AIRSPACE_COLORS } from '../../services/airspaceApi';
import { gibsTileUrl, GIBS_MAX_ZOOM } from '../../services/geoFeeds';

interface TrailPoint { lat: number; lng: number; t: number }
export interface GeoJsonLayerSpec { id: string; data: FeatureCollection; color: string }

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
  userLocation?: { lat: number; lng: number } | null;
  cluster?: boolean;
  showHeatmap?: boolean;
  trails?: Record<string, TrailPoint[]>;
  onMarkerClick?: (type: string, id: string) => void;
  onMapClick?: (lat: number, lng: number) => void;
  jammingZones?: JammingZone[];
  airspaceZones?: AirspaceZone[];
  // GEOINT additions
  basemap?: 'dark' | 'satellite';
  showHeatmapReal?: boolean;
  showTerminator?: boolean;
  geoJsonLayers?: GeoJsonLayerSpec[];
  geofences?: Geofence[];
  drawing?: boolean;
  onGeofenceDraw?: (ring: [number, number][]) => void;
}

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
  userLocation = null,
  cluster = true,
  showHeatmap = false,
  trails = {},
  onMarkerClick,
  onMapClick,
  jammingZones = [],
  airspaceZones = [],
  basemap = 'dark',
  showHeatmapReal = false,
  showTerminator = false,
  geoJsonLayers = [],
  geofences = [],
  drawing = false,
  onGeofenceDraw,
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<import('leaflet').Map | null>(null);
  const layersRef = useRef<import('leaflet').Layer[]>([]);
  const userMarkerRef = useRef<import('leaflet').Marker | null>(null);
  const heatLayerRef = useRef<unknown>(null);
  const realHeatRef = useRef<import('leaflet').Layer | null>(null);
  const terminatorRef = useRef<{ layer: import('leaflet').Layer; timer: ReturnType<typeof setInterval> } | null>(null);
  const drawRef = useRef<import('leaflet').Control | null>(null);
  const geoOverlayRef = useRef<import('leaflet').Layer[]>([]);
  const onGeofenceDrawRef = useRef(onGeofenceDraw);
  onGeofenceDrawRef.current = onGeofenceDraw;

  // Initialize map once
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    import('leaflet').then((L) => {
      if (!mapRef.current || mapInstance.current) return;

      const map = L.map(mapRef.current, {
        center,
        zoom,
        zoomControl: true,
        attributionControl: true,
        preferCanvas: true, // Better performance for many markers
      });

      if (basemap === 'satellite') {
        L.tileLayer(gibsTileUrl(), {
          attribution: '&copy; NASA GIBS / EOSDIS',
          maxZoom: GIBS_MAX_ZOOM,
          tileSize: 256,
        }).addTo(map);
      } else {
        L.tileLayer(
          'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
          {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20,
          }
        ).addTo(map);
      }

      mapInstance.current = map;

      // Map click handler for correlation
      if (onMapClick) {
        map.on('click', (e) => {
          onMapClick(e.latlng.lat, e.latlng.lng);
        });
      }
    });

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []);

  // User location marker
  useEffect(() => {
    if (!mapInstance.current || !userLocation) return;
    import('leaflet').then((L) => {
      if (!mapInstance.current) return;
      if (userMarkerRef.current) userMarkerRef.current.remove();
      const icon = L.divIcon({
        html: `<div style="width:14px;height:14px;background:#4ade80;border:3px solid white;border-radius:50%;box-shadow:0 0 12px #4ade80;"></div>`,
        className: '',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      userMarkerRef.current = L.marker([userLocation.lat, userLocation.lng], { icon })
        .addTo(mapInstance.current)
        .bindPopup('<div style="color:#e2e8f0">📍 Your Location</div>');
    });
  }, [userLocation]);

  // Memoize marker datasets to avoid re-renders when unrelated state changes
  const markerData = useMemo(() => ({
    satellites: filter.satellites ? satellites : [],
    aircraft: filter.aircraft ? aircraft : [],
    ships: filter.ships ? ships : [],
    cameras: filter.cameras ? cameras : [],
    flockCameras: filter.flockCameras ? flockCameras : [],
  }), [
    filter.satellites, filter.aircraft, filter.ships, filter.cameras, filter.flockCameras,
    satellites, aircraft, ships, cameras, flockCameras,
  ]);

  // Update markers whenever data changes
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    import('leaflet').then(async (L) => {
      // Clear old layers
      layersRef.current.forEach((l) => l.remove());
      layersRef.current = [];

      const createIcon = (emoji: string, color: string, size = 28) =>
        L.divIcon({
          html: `<div style="background:${color};border:2px solid rgba(255,255,255,0.8);border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-size:${Math.round(size * 0.5)}px;box-shadow:0 0 8px ${color};">${emoji}</div>`,
          className: '',
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });

      // Cluster groups (if enabled)
      let satCluster: import('leaflet').FeatureGroup;
      let acCluster: import('leaflet').FeatureGroup;
      let shipCluster: import('leaflet').FeatureGroup;
      let camCluster: import('leaflet').FeatureGroup;

      if (cluster) {
        try {
          const MC = (await import('leaflet.markercluster')).default ?? L;
          const ClusterGroup = (MC as unknown as { MarkerClusterGroup: new (opts: Record<string, unknown>) => import('leaflet').FeatureGroup }).MarkerClusterGroup;
          if (ClusterGroup) {
            const opts = { chunkedLoading: true, maxClusterRadius: 60, spiderfyOnMaxZoom: true };
            satCluster = new ClusterGroup(opts) as import('leaflet').FeatureGroup;
            acCluster = new ClusterGroup(opts) as import('leaflet').FeatureGroup;
            shipCluster = new ClusterGroup(opts) as import('leaflet').FeatureGroup;
            camCluster = new ClusterGroup(opts) as import('leaflet').FeatureGroup;
          } else {
            satCluster = L.featureGroup();
            acCluster = L.featureGroup();
            shipCluster = L.featureGroup();
            camCluster = L.featureGroup();
          }
        } catch {
          satCluster = L.featureGroup();
          acCluster = L.featureGroup();
          shipCluster = L.featureGroup();
          camCluster = L.featureGroup();
        }
      } else {
        satCluster = L.featureGroup();
        acCluster = L.featureGroup();
        shipCluster = L.featureGroup();
        camCluster = L.featureGroup();
      }

      // Draw trails
      Object.entries(trails).forEach(([_id, points]) => {
        if (points.length < 2) return;
        const latlngs = points.map((p) => [p.lat, p.lng] as [number, number]);
        const trail = L.polyline(latlngs, {
          color: '#6366f1',
          weight: 2,
          opacity: 0.5,
          dashArray: '4 6',
        });
        trail.addTo(map);
        layersRef.current.push(trail);
      });

      // ── Satellites ────────────────────────────────────────────────────────────
      markerData.satellites.forEach((sat) => {
        if (!sat.lat || !sat.lng) return;
        const m = L.marker([sat.lat, sat.lng], {
          icon: createIcon('🛰️', 'rgba(99,102,241,0.85)'),
          title: sat.name,
        }).bindPopup(`
          <div style="font-family:system-ui;color:#e2e8f0;min-width:180px">
            <strong style="color:#818cf8">${sat.name}</strong><br/>
            <small>NORAD: ${sat.noradId} | ${sat.type}</small><br/>
            Alt: ${sat.altitude.toLocaleString()} km<br/>
            Owner: ${sat.owner}<br/>
            Status: <span style="color:${sat.status === 'active' ? '#4ade80' : '#f87171'}">${sat.status}</span>
          </div>`);
        if (onMarkerClick) m.on('click', () => onMarkerClick('satellite', sat.id));
        satCluster.addLayer(m);
      });

      // ── Aircraft ──────────────────────────────────────────────────────────────
      markerData.aircraft.forEach((ac) => {
        if (!ac.lat || !ac.lng) return;
        const emergencyColor = ac.emergency ? 'rgba(239,68,68,0.9)' : 'rgba(59,130,246,0.85)';
        // Rotated plane icon
        const headingStyle = `transform:rotate(${ac.heading}deg);display:inline-block;font-size:16px;`;
        const icon = L.divIcon({
          html: `<div style="background:${emergencyColor};border:2px solid rgba(255,255,255,0.8);border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;box-shadow:0 0 8px ${emergencyColor};${ac.emergency ? 'animation:live-pulse 1s ease-in-out infinite;' : ''}"><span style="${headingStyle}">✈</span></div>`,
          className: '',
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });
        const m = L.marker([ac.lat, ac.lng], { icon, title: ac.callsign })
          .bindPopup(`
            <div style="font-family:system-ui;color:#e2e8f0;min-width:190px">
              <strong style="color:#60a5fa">${ac.callsign}</strong>${ac.emergency ? ' 🚨' : ''}<br/>
              <small>${ac.type ?? ''} | ${ac.registration ?? 'N/A'}</small><br/>
              Alt: ${ac.altitude.toLocaleString()} ft | ${ac.speed} kts<br/>
              Hdg: ${ac.heading}° | VR: ${ac.verticalRate} fpm<br/>
              ${ac.origin && ac.destination ? `Route: ${ac.origin} → ${ac.destination}<br/>` : ''}
              <small style="color:#6b7280">${ac.status} · ICAO: ${ac.icao}</small>
            </div>`);
        if (onMarkerClick) m.on('click', () => onMarkerClick('aircraft', ac.icao));
        acCluster.addLayer(m);
      });

      // ── Ships ─────────────────────────────────────────────────────────────────
      markerData.ships.forEach((ship) => {
        if (!ship.lat || !ship.lng) return;
        const m = L.marker([ship.lat, ship.lng], {
          icon: createIcon('🚢', 'rgba(6,182,212,0.85)'),
          title: ship.name,
        }).bindPopup(`
          <div style="font-family:system-ui;color:#e2e8f0;min-width:180px">
            <strong style="color:#22d3ee">${ship.name}</strong><br/>
            <small>MMSI: ${ship.mmsi} | ${ship.flag ?? ''}</small><br/>
            Type: ${ship.type}<br/>
            Speed: ${ship.speed} kts | Hdg: ${ship.heading}°<br/>
            ${ship.destination ? `To: ${ship.destination}` : ''}
          </div>`);
        if (onMarkerClick) m.on('click', () => onMarkerClick('ship', ship.mmsi));
        shipCluster.addLayer(m);
      });

      // ── Cameras ───────────────────────────────────────────────────────────────
      markerData.cameras.forEach((cam) => {
        if (!cam.lat || !cam.lng) return;
        const m = L.marker([cam.lat, cam.lng], {
          icon: createIcon('📷', 'rgba(168,85,247,0.85)', 24),
          title: cam.name,
        }).bindPopup(`
          <div style="font-family:system-ui;color:#e2e8f0;min-width:180px">
            <strong style="color:#c084fc">${cam.name}</strong><br/>
            <small>${cam.type.toUpperCase()} | ${cam.source}</small><br/>
            ${cam.location}<br/>
            Status: <span style="color:${cam.status === 'live' ? '#4ade80' : '#f87171'}">${cam.status}</span>
            ${cam.streamUrl ? `<br/><a href="${cam.streamUrl}" target="_blank" style="color:#818cf8">View Stream ↗</a>` : ''}
          </div>`);
        camCluster.addLayer(m);
      });

      markerData.flockCameras.forEach((fc) => {
        if (!fc.lat || !fc.lng) return;
        const m = L.marker([fc.lat, fc.lng], {
          icon: createIcon('👁️', 'rgba(249,115,22,0.85)', 24),
          title: `Flock: ${fc.serialNumber}`,
        }).bindPopup(`
          <div style="font-family:system-ui;color:#e2e8f0;min-width:180px">
            <strong style="color:#fb923c">Flock LPR Camera</strong><br/>
            <small>S/N: ${fc.serialNumber}</small><br/>
            ${fc.location}<br/>
            ${fc.city}, ${fc.state}<br/>
            Agency: ${fc.agency ?? 'Unknown'}
          </div>`);
        camCluster.addLayer(m);
      });

      // Add clusters to map
      [satCluster, acCluster, shipCluster, camCluster].forEach((g) => {
        g.addTo(map);
        layersRef.current.push(g);
      });

      // ── Heatmap (camera density) ──────────────────────────────────────────────
      if (showHeatmap && (markerData.cameras.length > 0 || markerData.flockCameras.length > 0)) {
        if (heatLayerRef.current) {
          map.removeLayer(heatLayerRef.current as import('leaflet').Layer);
        }
        try {
          // Use manual canvas heatmap since leaflet.heat not installed
          const points = [
            ...markerData.cameras.filter((c) => c.lat && c.lng).map((c) => ({ lat: c.lat, lng: c.lng, w: 0.8 })),
            ...markerData.flockCameras.filter((f) => f.lat && f.lng).map((f) => ({ lat: f.lat, lng: f.lng, w: 1.0 })),
          ];
          // Draw circles on map as a simple density overlay
          points.forEach((pt) => {
            const circle = L.circle([pt.lat, pt.lng], {
              radius: 3000,
              color: 'transparent',
              fillColor: '#7c3aed',
              fillOpacity: 0.08 * pt.w,
            }).addTo(map);
            layersRef.current.push(circle);
          });
        } catch {
          // Heatmap not available
        }
      }
    });
  }, [markerData, trails, showHeatmap, cluster, onMarkerClick]);

  // ── Jamming + Airspace overlay layers ──────────────────────────────────────
  const overlayLayersRef = useRef<import('leaflet').Layer[]>([]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    import('leaflet').then((L) => {
      // Clear previous overlay layers
      overlayLayersRef.current.forEach(l => l.remove());
      overlayLayersRef.current = [];

      // GPS Jamming zones
      for (const zone of jammingZones) {
        const color = zone.confidence > 0.7 ? '#ef4444' : zone.confidence > 0.4 ? '#f97316' : '#facc15';
        const circle = L.circle([zone.lat, zone.lng], {
          radius: zone.radiusKm * 1000,
          color,
          fillColor: color,
          fillOpacity: 0.12 + zone.confidence * 0.18,
          weight: 1,
          dashArray: '4 4',
        }).bindTooltip(
          `<b style="color:${color}">GPS Jamming</b><br>Confidence: ${Math.round(zone.confidence * 100)}%<br>Source: ${zone.source}`,
          { sticky: true }
        ).addTo(map);
        overlayLayersRef.current.push(circle);
      }

      // Airspace restriction zones
      for (const zone of airspaceZones) {
        const color = AIRSPACE_COLORS[zone.type] ?? '#6b7280';
        const poly = L.polygon(zone.coordinates, {
          color,
          fillColor: color,
          fillOpacity: 0.1,
          weight: 1.5,
          dashArray: zone.type === 'tfr' ? '6 3' : undefined,
        }).bindTooltip(
          `<b style="color:${color}">${zone.name}</b><br>${zone.type.toUpperCase()}${zone.altitudeLowerFt != null ? `<br>Alt: ${zone.altitudeLowerFt.toLocaleString()}–${zone.altitudeUpperFt?.toLocaleString() ?? '∞'} ft` : ''}`,
          { sticky: true }
        ).addTo(map);
        overlayLayersRef.current.push(poly);
      }
    });
  }, [jammingZones, airspaceZones]);

  // ── GeoJSON feed layers + geofence polygons ─────────────────────────────────
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    import('leaflet').then((L) => {
      geoOverlayRef.current.forEach((l) => l.remove());
      geoOverlayRef.current = [];

      for (const spec of geoJsonLayers) {
        const layer = L.geoJSON(spec.data, {
          style: { color: spec.color, weight: 1.5, fillColor: spec.color, fillOpacity: 0.15 },
          pointToLayer: (_f, latlng) =>
            L.circleMarker(latlng, { radius: 5, color: spec.color, fillColor: spec.color, fillOpacity: 0.7, weight: 1 }),
          onEachFeature: (f, lyr) => {
            const p = (f.properties ?? {}) as Record<string, unknown>;
            const title = String(p.title ?? p.place ?? p.event ?? p.headline ?? spec.id);
            lyr.bindPopup(`<div style="color:#e2e8f0;max-width:240px">${title}</div>`);
          },
        });
        layer.addTo(map);
        geoOverlayRef.current.push(layer);
      }

      // Geofence rings (stored as [lng,lat] GeoJSON order → convert to [lat,lng] for Leaflet)
      for (const f of geofences) {
        if (f.ring.length < 3) continue;
        const latlngs = f.ring.map(([lng, lat]) => [lat, lng] as [number, number]);
        const poly = L.polygon(latlngs, { color: '#a855f7', weight: 2, fillColor: '#a855f7', fillOpacity: 0.08, dashArray: '5 5' })
          .bindTooltip(`<b style="color:#c084fc">${f.name}</b>`, { sticky: true });
        poly.addTo(map);
        geoOverlayRef.current.push(poly);
      }
    });
  }, [geoJsonLayers, geofences]);

  // ── Real heatmap (leaflet.heat) ─────────────────────────────────────────────
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    import('leaflet').then(async (L) => {
      if (realHeatRef.current) { map.removeLayer(realHeatRef.current); realHeatRef.current = null; }
      if (!showHeatmapReal) return;
      await import('leaflet.heat');
      const pts: [number, number, number][] = [
        ...aircraft.filter((a) => a.lat && a.lng).map((a) => [a.lat, a.lng, 0.6] as [number, number, number]),
        ...ships.filter((s) => s.lat && s.lng).map((s) => [s.lat, s.lng, 0.6] as [number, number, number]),
        ...cameras.filter((c) => c.lat && c.lng).map((c) => [c.lat, c.lng, 0.8] as [number, number, number]),
        ...flockCameras.filter((f) => f.lat && f.lng).map((f) => [f.lat, f.lng, 1] as [number, number, number]),
      ];
      if (!pts.length) return;
      const heat = (L as unknown as { heatLayer: (p: unknown[], o: unknown) => import('leaflet').Layer })
        .heatLayer(pts, { radius: 25, blur: 15, maxZoom: 8 });
      heat.addTo(map);
      realHeatRef.current = heat;
    });
  }, [showHeatmapReal, aircraft, ships, cameras, flockCameras]);

  // ── Day/night terminator ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    let disposed = false;
    if (!showTerminator) {
      if (terminatorRef.current) { terminatorRef.current.layer.remove(); clearInterval(terminatorRef.current.timer); terminatorRef.current = null; }
      return;
    }
    import('@joergdietrich/leaflet.terminator').then((mod) => {
      if (disposed || terminatorRef.current) return;
      const Terminator = (mod as { default: () => import('leaflet').Layer & { setTime?: () => void } }).default;
      const t = Terminator();
      t.addTo(map);
      const timer = setInterval(() => t.setTime?.(), 60_000);
      terminatorRef.current = { layer: t, timer };
    });
    return () => {
      disposed = true;
      if (terminatorRef.current) { terminatorRef.current.layer.remove(); clearInterval(terminatorRef.current.timer); terminatorRef.current = null; }
    };
  }, [showTerminator]);

  // ── Draw control for geofences ──────────────────────────────────────────────
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    let cleanup = () => {};
    import('leaflet').then(async (L) => {
      await import('leaflet-draw');
      if (!drawing) { if (drawRef.current) { map.removeControl(drawRef.current); drawRef.current = null; } return; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const LD = L as any;
      const control = new LD.Control.Draw({
        draw: { polygon: true, rectangle: true, circle: false, circlemarker: false, marker: false, polyline: false },
        edit: undefined,
      });
      map.addControl(control);
      drawRef.current = control;
      const handler = (e: { layer: { getLatLngs: () => { lat: number; lng: number }[][] } }) => {
        const latlngs = e.layer.getLatLngs()[0];
        const ring = latlngs.map((p) => [p.lng, p.lat] as [number, number]); // → GeoJSON [lng,lat]
        onGeofenceDrawRef.current?.(ring);
      };
      map.on(LD.Draw.Event.CREATED, handler as (e: unknown) => void);
      cleanup = () => { map.off(LD.Draw.Event.CREATED, handler as (e: unknown) => void); if (drawRef.current) { map.removeControl(drawRef.current); drawRef.current = null; } };
    });
    return () => cleanup();
  }, [drawing]);

  return (
    <div
      ref={mapRef}
      style={{ height, width: '100%' }}
      className="rounded-lg overflow-hidden border border-gray-800"
    />
  );
};

export default MapView;
