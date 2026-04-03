import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
            urlPattern: /^https:\/\/{s}\.basemaps\.cartocdn\.com\//,
            handler: 'CacheFirst',
            options: { cacheName: 'map-tiles', expiration: { maxEntries: 500, maxAgeSeconds: 86400 } },
          },
        ],
      },
      devOptions: { enabled: true },
    }),
  ],
})
