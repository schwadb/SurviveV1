# WatcherV1 — Improvement Roadmap (hand-off spec)

**Purpose.** A prioritized, concrete plan for the next wave of improvements to WatcherV1, written so an engineering model can implement each item directly. Every item lists the feature, why it matters (benchmarked against best-in-class tools), the specific keyless APIs / libraries to use, honest CORS notes, the files to touch, and a rough effort size.

**Effort key:** S = a few hours · M = 1–3 days · L = ~1 week · XL = multi-week.

**Hard constraint (do not violate).** This is a client-side React 19 + TS + Vite SPA with **no backend**. Only call APIs that send `Access-Control-Allow-Origin` (browser-reachable). Anything without CORS needs the *optional user-supplied proxy* from item **O3** — never assume a server exists. CORS status below is marked ✅ (verified reachable from browser this session), ⚠️ (needs verification), or 🔴 (no CORS — proxy required).

**What already exists (don't rebuild):** entity-graph Investigations workspace with click-to-pivot (`src/services/investigation.ts`, `src/components/investigation/EntityGraph.tsx`), keyless OSINT service (`src/services/osint.ts`: DoH DNS, DoH subdomain probe, Shodan InternetDB, ipwho.is, Wayback, GitHub, HIBP k-anonymity), Security/OPSEC center with AES-256-GCM vault + panic wipe + egress ledger (`src/services/vault.ts`, `src/pages/Security.tsx`), real TLE satellite positions, agent recorder (IndexedDB), watchlist, dork builder.

---

## Benchmark: what best-in-class tools have that we don't

| Capability | Who does it | Our gap |
|---|---|---|
| Continuous monitoring + change-detection (re-scan, diff, alert) | SpiderFoot HX, Recorded Future | We only do one-shot lookups |
| Correlation rules → "signals" from combined data | SpiderFoot correlation engine | No cross-source correlation |
| Large pluggable transform/analyzer catalog (58+ / 200+ modules) | Maltego, SpiderFoot | ~7 pivots, hard-coded |
| Structured analytic techniques (ACH, hypothesis matrix) | IC tradecraft, Analyst's Notebook | None |
| GEOINT: geofences, heatmaps, spatial queries, imagery layers | Palantir, ArcGIS, Bellingcat | Basic Leaflet markers only |
| Court-ready evidence handling (hash, timestamp, archive, chain-of-custody) | Hunchly, Berkeley Protocol | We hash evidence but don't archive/timestamp it |
| Report generation (PDF, timeline, graph image) | Maltego, Hunchly | Markdown export only |

The five sections below close these gaps.

---

## P0 — Highest leverage (do first)

### C1. Monitoring & change-detection engine  ·  M
The single biggest gap vs. SpiderFoot/Recorded Future: turn passive lookups into active monitoring.
- **What:** For any watchlist entity or investigation node, re-run its pivots on an interval, **diff** the new result against the last snapshot, and raise an alert on change (new open port, new subdomain, new CVE, IP moved ASN, breach appears, aircraft/ship reappears or changes destination).
- **How (no backend):** while the app is open, a `setInterval` scheduler in a new `src/services/monitor.ts`; persist snapshots + diffs in IndexedDB (reuse the `idb` setup from `agentRecorder.ts`). Generic JSON diff (write a small `diffObjects()` — no dep needed, or `microdiff` ~1KB). Fire `useNotifications().notify(...)` on change. For while-closed monitoring, add a **Periodic Background Sync** handler in the existing PWA service worker (best-effort; Chromium only).
- **Files:** new `src/services/monitor.ts`, extend `src/hooks/useWatchlist.ts`, new "Monitors" tab on `src/pages/Investigations.tsx` or a dedicated `/monitors` page; wire into `AlertsPanel`.
- **Payoff:** converts the whole app from "look something up" to "watch something over time."

### N1. NVD CVE enrichment (pairs with Shodan InternetDB)  ·  S
Shodan InternetDB already returns CVE IDs per IP; right now they're just badges linking to NVD.
- **API:** NVD 2.0 — `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-XXXX-YYYY` ⚠️ (keyless, ~5 req/30s unauthenticated — throttle hard). Returns CVSS score, severity, description, references.
- **What:** In `hostIntel()` results and the `ip` entity pivot, fetch CVSS + summary for each returned CVE and render a severity-sorted vuln table; add a `cvssMax` attribute to the IP entity so the graph can size/color high-risk hosts.
- **Files:** add `cveDetails()` to `src/services/osint.ts`; render in `src/components/lookup/LiveRecon.tsx` and the IP pivot in `investigation.ts`.

### W1. Report export → PDF + graph snapshot  ·  M
Maltego/Hunchly deliverables are the "finished" signal. We only export Markdown.
- **Libs:** `jspdf` + `html2canvas` (both client-side, MIT). Or a print-CSS route (`@media print`) + browser "Save as PDF" for zero deps — recommend starting there (S), then jsPDF for a one-click button (M).
- **What:** Render a case (entities grouped by type, relationships, the graph as a PNG via `EntityGraph`→SVG→canvas, evidence log with hashes, analyst notes, timeline) to a self-contained PDF. Reuse `generateReport()` in `investigation.ts` for structure.
- **Files:** new `src/services/report.ts`, button already stubbed in `Investigations.tsx` (currently Markdown-only).

### O1. Content-Security-Policy + self-hosted assets  ·  S
Current gap (from audit): no CSP, and `index.html` pulls Leaflet CSS from `unpkg` + Google Fonts — breaks the "local-only/air-gapped" OPSEC claim.
- **What:** Add a strict CSP `<meta http-equiv>` (or Vite plugin) — `default-src 'self'; connect-src 'self' https://dns.google https://internetdb.shodan.io https://ipwho.is https://api.pwnedpasswords.com https://archive.org https://api.github.com ...`; `object-src 'none'; base-uri 'none'`. Vendor Leaflet CSS + fonts into the bundle so nothing loads from a CDN.
- **Payoff:** makes the egress ledger in `Security.tsx` actually enforceable and the offline story real. The `connect-src` allowlist doubles as a second, browser-enforced egress control.

---

## P1 — High value

### G1. GEOINT upgrade on the existing Leaflet map  ·  M
Biggest visible quality jump; all client-side, keep Leaflet (no migration).
- **Geofencing + alerts:** `@turf/turf` (`booleanPointInPolygon`) + `leaflet-draw` — draw a polygon/circle, get notified when a tracked aircraft/ship enters/exits. Ties directly into the chokepoints feature and the C1 monitor. ✅ all client-side.
- **Heatmaps:** `leaflet.heat` for density (aircraft/ship traffic, camera/Flock density, scanner-incident hotspots). Replaces the hand-rolled circle "heatmap" in `MapView.tsx`.
- **Spatial query ("what's here?"):** draw a polygon → list every entity currently inside, across all layers (Turf point-in-polygon). Analyst-grade.
- **Day/night terminator:** `@joergdietrich/leaflet.terminator` — pairs perfectly with satellite tracking.
- **Files:** extend `src/components/common/MapView.tsx` (it already accepts `jammingZones`/`airspaceZones` — add `geofences`, `heatmap`, `onPolygonDraw` props).

### N2. Free map-data layers (keyless GeoJSON)  ·  S each
Drop real-time context straight onto the existing Leaflet map. All ✅ keyless + CORS:
- **USGS earthquakes** — `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson`
- **NWS active alerts** — `https://api.weather.gov/alerts/active` (GeoJSON)
- **NASA GIBS satellite imagery** — WMTS `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/...` (true-color MODIS/VIIRS, fire, aerosol). **Use this instead of Sentinel Hub** — GIBS is fully keyless; Sentinel Hub OGC needs a free CDSE account/instance-id (not keyless, so it belongs behind a Settings key, not in the default build).
- **GDELT 2.0 news** — `https://api.gdeltproject.org/api/v2/doc/doc?query=...&format=json` (geo-taggable global news/event stream) ⚠️ verify CORS; pairs with chokepoints + AI search.
- **Files:** new `src/services/geoFeeds.ts`, new toggleable layers in `MapView.tsx` + Dashboard/Chokepoints layer toggles.

### N3. Threat-intel & infra enrichment sources  ·  M
Broaden the analyzer catalog toward SpiderFoot-scale, keyless where possible.
- **Certificate Transparency (real subdomains):** `certspotter` — `https://api.certspotter.com/v1/issuances?domain=X&include_subdomains=true&expand=dns_names` ⚠️ verify CORS. **crt.sh is 🔴 (no CORS)** — only via proxy O3. This complements the current DoH subdomain *probe* (which only finds common names) with CT-log-derived names.
- **RDAP (WHOIS replacement):** `https://rdap.org/domain/X` 🔴 (302→registry, CORS unreliable) — route via O3, or hit ARIN's CORS-enabled RDAP for IPs. Adds registrar, creation/expiry dates, registrant org.
- **abuse.ch (keyless/opt-key):** Feodo Tracker botnet C2 IP list (`https://feodotracker.abuse.ch/downloads/ipblocklist.json` ✅), URLhaus/ThreatFox IOC lookups ⚠️ (POST; verify CORS). Flag any IP entity that appears on a C2 list — a strong correlation signal for C2.
- **freeipapi.com** — `https://freeipapi.com/api/json/{ip}` ✅ keyless — second-opinion IP/ASN enrichment alongside ipwho.is.
- **Files:** add functions to `src/services/osint.ts`; register as new pivots in `investigation.ts` `availablePivots()` + `runPivot()`.

### A1. Correlation rules → "signals"  ·  M
SpiderFoot's differentiator; cheap once data is normalized in the entity model.
- **What:** After pivots populate entity `attrs`, evaluate a small rule set and raise "signals" on the case: e.g. *IP has open RDP (3389) AND a critical CVE*; *IP on Feodo C2 list AND linked to a watchlisted domain*; *email's domain has no MX AND appears in a breach*; *two entities share the same ASN/registrant/nameserver → auto-suggest a link*. Rules are pure functions over the `Investigation` object → render as a "Signals" panel with severity.
- **Files:** new `src/services/correlate.ts`, "Signals" panel in `Investigations.tsx`. Also implement **entity auto-merge** (exact match on normalized selector) and **"seen with" suggestions** (entities sharing an attribute) here.

---

## P2 — Creative / differentiating

### A2. ACH — Analysis of Competing Hypotheses matrix  ·  M
Real IC tradecraft (CIA/Heuer); almost no consumer OSINT tool ships it. High "wow," pure client-side.
- **What:** Per case, let the analyst list competing hypotheses (columns) and evidence items (rows, drawn from the evidence log), then rate each cell consistent / inconsistent / N/A. Score columns by weighted inconsistency (the hypothesis with the *fewest* inconsistencies survives — the method's core insight is disproving, not proving). Export into the report.
- **Files:** new `src/components/investigation/ACHMatrix.tsx`, persist in the `Investigation` object.

### W2. Guided 8-phase OSINT workflow + investigation timeline  ·  M
Operationalize the standard OSINT lifecycle (define → collect seeds → search → pivot → verify → corroborate → document → report) as a checklist/stepper on each case, and auto-build a **chronological timeline** from evidence-log timestamps, agent-recorder snapshots, and alerts. Turns collection into a narrative. Reuse the existing `TimelineScrubber` component.

### W3. Berkeley-Protocol evidence handling  ·  M
Extend the current SHA-256 evidence log toward court-ready standard (UC Berkeley / Bellingcat):
- Auto-capture **source URL + capture timestamp + SHA-256** for every finding (partly done).
- **One-click Wayback "Save Page Now"** to preserve a target page (`https://web.archive.org/save/{url}` — fire-and-forget) and store the returned archival URL as immutable evidence.
- Chain-of-custody view: append-only, tamper-evident (hash each entry over the previous entry's hash → a mini hash-chain).
- **Files:** extend `EvidenceItem` in `investigation.ts`; add archival call to `osint.ts`.

### G2. (Optional, big) deck.gl / MapLibre GEOINT engine  ·  XL
Only if the map becomes a bottleneck. `deck.gl` (GPU/WebGL2, React-friendly reactive API) over `MapLibre GL JS` renders 10k+ moving tracks smoothly and enables 3D (arcs for flight paths, hex-bin aggregation, trip animations). `DuckDB-WASM Spatial` runs SQL spatial joins entirely in-browser (private, no backend) for "all ships within 50km of any chokepoint" style queries. Note the cost: MapLibre migration touches every map surface and DuckDB-WASM adds a multi-MB WASM payload — treat as a separate epic, not a quick win. Libs: `deck.gl`, `maplibre-gl`, `@duckdb/duckdb-wasm`, `@turf/turf`.

### N4. Redundant/richer movement feeds  ·  S–M
- **airplanes.live / adsb.fi** — `https://api.airplanes.live/v2/...` ✅ keyless ADS-B, a good OpenSky backup/supplement (OpenSky rate-limits hard).
- **Open-Meteo** — `https://api.open-meteo.com/v1/forecast?...` ✅ keyless weather overlay for AO context.
- **Files:** `src/services/api.ts` (add as fallbacks behind the existing `RateLimiter`).

---

## OPSEC hardening (cross-cutting)

- **O1** CSP + self-hosted assets — see P0.
- **O2. Vault-lock the API keys.** Keys live in plaintext `localStorage` today. Add an option to store them only inside the AES-GCM vault (`vault.ts`), unlocked by a session passphrase; keep them out of URLs (NumVerify currently passes the key as a query param — move to header or proxy). **S–M.**
- **O3. Optional user-supplied proxy/egress control.** One Settings field for a proxy URL (self-hosted Cloudflare Worker / corsproxy). Route the 🔴 sources (crt.sh, RDAP, some abuse.ch) through it, and let privacy-conscious analysts funnel *all* egress through their own Tor/VPN relay. Resolves the CORS problem app-wide and doubles as OPSEC egress control. **M.**
- **O4. Encrypt IndexedDB at rest.** Agent-recorder snapshots + case data are currently plaintext in IndexedDB. Wrap writes through `vault.ts` when a vault passphrase is set. **M.**
- **O5. Zero-telemetry attestation + per-source consent.** Before a pivot hits a third party, show which host it contacts (the egress ledger already lists them); optional "ask before external calls" mode. **S.**

---

## Suggested sequencing

1. **Quick wins first (all S):** N1 (NVD CVE enrichment), O1 (CSP + self-host), N2 (USGS/NWS/GIBS layers), W1-lite (print-CSS PDF).
2. **The differentiators (M):** C1 (monitoring/diff engine) → A1 (correlation signals) → G1 (Turf geofencing + heatmaps). These three, together, are the leap from "lookup tool" to "monitoring platform."
3. **Depth & polish:** N3 (threat-intel sources) → W1 (jsPDF report) → W3 (Berkeley evidence) → A2 (ACH matrix).
4. **Only if needed:** G2 (deck.gl/MapLibre/DuckDB epic).

## Dependencies to add (all client-side, MIT/BSD)
`@turf/turf`, `leaflet-draw`, `leaflet.heat`, `@joergdietrich/leaflet.terminator`, `jspdf` + `html2canvas`, optional `microdiff`. Heavy/optional epic: `deck.gl`, `maplibre-gl`, `@duckdb/duckdb-wasm`.

## CORS reality check (verify before building on these)
✅ browser-reachable: dns.google, internetdb.shodan.io, ipwho.is, api.pwnedpasswords.com, archive.org, api.github.com, USGS, api.weather.gov, GIBS, freeipapi.com, feodotracker.abuse.ch, airplanes.live, open-meteo.
⚠️ verify: NVD, certspotter, GDELT, URLhaus/ThreatFox, Sentinel Hub (needs free account).
🔴 no CORS (need proxy O3): crt.sh, rdap.org, most legacy WHOIS.

---
*Sources: Maltego Transform Hub, SpiderFoot (200+ modules, continuous monitoring, REST/headless), public-apis + no-auth API catalogs, BigDataCloud, Turf.js, deck.gl, GeoLibre (MapLibre + DuckDB-WASM Spatial pattern), Copernicus/Sentinel Hub, NASA GIBS, OWASP CSP cheat sheet, WebCrypto guidance (PBKDF2 + AES-GCM), Structured Analytic Techniques / ACH, Berkeley Protocol on Digital Open Source Investigations. Generated from a 5-angle, 24-source research pass; the automated verification panel hit an Anthropic rate limit, so claims were vetted manually against this session's own CORS testing and codebase knowledge.*
