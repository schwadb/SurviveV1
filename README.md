# WatcherV1 — OSINT Intelligence Tracking Platform

A comprehensive open-source intelligence (OSINT) platform for tracking satellites, aircraft, ships, public cameras, Flock LPR cameras, and more — all from a single dark-themed web interface with Perplexity AI integration.

---

## Features

| Module | Description |
|--------|-------------|
| 🛰️ **Satellite Tracker** | Real-time orbital positions via CelesTrak & N2YO. Filter by orbit type (LEO/MEO/GEO/HEO), owner, status |
| ✈️ **Aircraft Tracker** | ADS-B flight tracking via OpenSky Network. Emergency squawk detection, flight routes |
| 🚢 **Ship Tracker** | AIS maritime tracking. Vessel details, routes, cargo info |
| 📷 **Public Cameras** | EarthCam, Insecam, traffic & weather cams. Grid/list view with map overlay |
| 👁️ **Flock Cameras** | License plate reader (LPR) network map from public records & FOIA data |
| 📻 **Scanners** | Live Broadcastify feeds: police, fire, EMS, ATC, weather. Add custom streams |
| 👤 **Person Lookup** | 12+ people search databases, Google dorking templates, username tracking |
| 📞 **Phone Lookup** | Carrier, line type, spam score lookup (NumVerify API) |
| 📍 **Address Lookup** | Geocoding via Nominatim, property records, satellite/street view links |
| 🤖 **Perplexity AI** | AI-powered OSINT research with real-time web search and citations |
| 🗄️ **Resource Manager** | Add, edit, enable/disable OSINT sources with API key storage |
| ⚙️ **Settings** | API key management, map style, units, refresh interval |

---

## Quick Start — Local Preview

### Prerequisites

- **Node.js** v18 or higher ([download](https://nodejs.org/))
- **npm** v8 or higher (comes with Node.js)
- **Git** ([download](https://git-scm.com/))

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/schwadb/WatcherV1.git
cd WatcherV1

# 2. Install dependencies
npm install

# 3. Start the development server
npm run dev
```

Open your browser to **http://localhost:5173**

### Build for Production

```bash
npm run build
npm run preview
```

---

## API Keys (Optional)

Go to **Settings** in the sidebar to enter your keys. All keys stored locally in browser.

| API | Used For | Get Key |
|-----|----------|---------|
| **Perplexity AI** | AI OSINT research | [perplexity.ai/settings/api](https://www.perplexity.ai/settings/api) |
| **N2YO** | Live satellite data | [n2yo.com/api](https://www.n2yo.com/api/) |
| **NumVerify** | Phone validation | [numverify.com](https://numverify.com/) |

---

## Mobile Access

```bash
# Start server accessible on your network
npm run dev -- --host
```

Then visit `http://YOUR-LOCAL-IP:5173` from any device on the same WiFi.

- **Android**: Add to Home Screen via Chrome menu
- **iOS**: Add to Home Screen via Safari Share button
- **Windows**: Install as PWA via Edge (Apps → Install this site)
- **macOS**: File → Add to Dock (Safari)

---

## Architecture

```
src/
├── components/
│   ├── layout/          # Sidebar, Header
│   ├── tracking/        # SatelliteTracker, AircraftTracker, ShipTracker
│   ├── cameras/         # PublicCameras, FlockCameras
│   ├── lookup/          # PersonLookup, PhoneLookup, AddressLookup
│   ├── scanners/        # ScannerAccess
│   ├── ai/              # PerplexitySearch
│   ├── resources/       # ResourceManager, Settings
│   └── common/          # MapView (Leaflet), AlertsPanel
├── data/mockData.ts     # Demo data
├── hooks/               # useLocalStorage
├── services/api.ts      # API clients (Perplexity, OpenSky, Nominatim)
├── types/index.ts       # TypeScript interfaces
└── pages/Dashboard.tsx  # Overview with live world map
```

**Tech Stack:** React 19 · TypeScript · Vite 8 · Tailwind CSS v4 · Leaflet · Lucide · Axios

---

## Legal Notice

WatcherV1 is for legitimate research, journalism, security research, and educational purposes only.
All external links go to publicly accessible resources. The app does not scrape, store, or resell personal data.
Users must comply with all applicable local, state, and federal laws.

## License

MIT
