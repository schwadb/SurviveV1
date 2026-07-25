import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Explicit egress allowlist — every host the app is allowed to reach. Injected
// only into the production build so Vite's dev HMR (inline scripts/eval) is not
// broken. script-src 'self' is the key XSS control; style needs 'unsafe-inline'
// because Leaflet/react-hot-toast rely on inline styles.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://gibs.earthdata.nasa.gov https://*.tile.openstreetmap.org",
  "connect-src 'self' https://opensky-network.org https://celestrak.org wss://stream.aisstream.io " +
    "https://api.perplexity.ai https://nominatim.openstreetmap.org https://apilayer.net " +
    "https://dns.google https://internetdb.shodan.io https://ipwho.is https://api.pwnedpasswords.com " +
    "https://archive.org https://web.archive.org https://api.github.com https://haveibeenpwned.com " +
    "https://services.nvd.nist.gov https://earthquake.usgs.gov https://api.weather.gov https://gibs.earthdata.nasa.gov",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ')

function cspPlugin(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('</title>', `</title>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    cspPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script', // external registerSW.js (no inline script → CSP-safe)
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'WatcherV1 - OSINT Platform',
        short_name: 'WatcherV1',
        description: 'Open Source Intelligence tracking: satellites, aircraft, ships, cameras, and more',
        theme_color: '#0a0e1a',
        background_color: '#0a0e1a',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
        categories: ['productivity', 'navigation', 'utilities'],
        shortcuts: [
          { name: 'Aircraft Tracker', url: '/aircraft', description: 'Track live aircraft' },
          { name: 'Satellite Tracker', url: '/satellites', description: 'Track satellites' },
          { name: 'Ship Tracker', url: '/ships', description: 'Track maritime vessels' },
          { name: 'AI Search', url: '/ai-search', description: 'Perplexity AI OSINT search' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/opensky-network\.org\//,
            handler: 'NetworkFirst',
            options: { cacheName: 'opensky-cache', expiration: { maxAgeSeconds: 30 } },
          },
          {
            urlPattern: /^https:\/\/celestrak\.org\//,
            handler: 'NetworkFirst',
            options: { cacheName: 'celestrak-cache', expiration: { maxAgeSeconds: 300 } },
          },
          {
            urlPattern: /^https:\/\/[a-d]\.basemaps\.cartocdn\.com\//,
            handler: 'CacheFirst',
            options: { cacheName: 'map-tiles', expiration: { maxEntries: 500, maxAgeSeconds: 86400 } },
          },
        ],
      },
      devOptions: { enabled: true },
    }),
  ],
})
