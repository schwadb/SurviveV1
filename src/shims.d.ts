/// <reference types="vite/client" />

// @joergdietrich/leaflet.terminator ships no types. It default-exports a factory
// that returns a Leaflet layer with a setTime() method to advance the terminator.
declare module '@joergdietrich/leaflet.terminator' {
  import type { Layer } from 'leaflet';
  const terminator: () => Layer & { setTime: (date?: Date) => void };
  export default terminator;
}

// Web Speech API (SpeechRecognition) — not in the default TS DOM lib.
interface SpeechRecognitionResultLike { 0: { transcript: string }; isFinal: boolean }
interface SpeechRecognitionEventLike { results: ArrayLike<SpeechRecognitionResultLike>; resultIndex: number }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
interface Window {
  SpeechRecognition?: { new (): SpeechRecognitionLike };
  webkitSpeechRecognition?: { new (): SpeechRecognitionLike };
}
