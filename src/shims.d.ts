/// <reference types="vite/client" />

// @joergdietrich/leaflet.terminator ships no types. It default-exports a factory
// that returns a Leaflet layer with a setTime() method to advance the terminator.
declare module '@joergdietrich/leaflet.terminator' {
  import type { Layer } from 'leaflet';
  const terminator: () => Layer & { setTime: (date?: Date) => void };
  export default terminator;
}
