import { useState, useCallback } from 'react';

export interface GeolocationState {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  loading: boolean;
  error: string | null;
}

export function useGeolocation() {
  const [state, setState] = useState<GeolocationState>({
    lat: null,
    lng: null,
    accuracy: null,
    loading: false,
    error: null,
  });

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setState((s) => ({ ...s, error: 'Geolocation not supported by browser' }));
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setState({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          loading: false,
          error: null,
        });
      },
      (err) => {
        setState((s) => ({ ...s, loading: false, error: err.message }));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  return { ...state, locate };
}

// Calculate satellite pass visibility (simplified)
export function calcSatelliteVisibility(
  userLat: number,
  userLng: number,
  satLat: number,
  satLng: number,
  altitudeKm: number
): { visible: boolean; elevationDeg: number; distanceKm: number } {
  const earthRadius = 6371;
  const dLat = ((satLat - userLat) * Math.PI) / 180;
  const dLng = ((satLng - userLng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((userLat * Math.PI) / 180) *
      Math.cos((satLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const groundDistKm = 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceKm = Math.sqrt(groundDistKm ** 2 + altitudeKm ** 2);
  const elevationDeg = Math.atan2(altitudeKm - groundDistKm * 0.15, groundDistKm) * (180 / Math.PI);
  return { visible: elevationDeg > 10, elevationDeg: Math.max(0, elevationDeg), distanceKm };
}
