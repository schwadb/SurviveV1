# PLAN: Feature parity with Project NOMAD / Prepper Disk (completed)

Source: review of Project NOMAD 1.35 (Crosstalk Solutions, Oct 2026), Prepper Disk,
and Internet-in-a-Box against SurviveV1. Six gaps were picked; five shipped in full,
one shipped in an adapted form, and one item could not be added.

## Shipped

| # | Feature | Where |
|---|---------|-------|
| 1 | Offline map page with pins, search, hide, GPX/GeoJSON import/export, GPS locate, satellite overlay | `/maps`, `web/templates/maps.html`, `/api/map/*`, `web/static/vendor/`, `maps.sh dl_map_assets`/`dl_satellite` |
| 2 | Library manager: Kiwix catalog by language/category, dashboard downloads, downloads list, rescan for sideloaded ZIMs | `/content`, `/api/content/*`, `scripts/download_zim.sh`, `scripts/rescan_library.sh` |
| 3 | Shared Markdown notes (searchable) and a personal file drop box | `/notes`, `/shared`, `web/textutils.render_markdown` |
| 5 | Comms: Morse encoder/decoder/key, Meshtastic web client on :8084, repeater directory from imported CSVs, frequency reference | `/comms`, `download/comms.sh`, `systemd/survive-meshtastic.service` |
| 8 | Nightly auto-update with bandwidth cap and a Status-page switch | `systemd/survive-content-update.{service,timer}`, `update_content.sh --scheduled`, `/api/update/schedule` |
| 9 | National park map PDFs (63 parks) and a world satellite overlay | `maps.sh dl_nps_maps`/`dl_satellite` |

## Adapted

- **Repeater directory.** RepeaterBook's API terms (March 2026) forbid bulk export,
  offline bundling and use inside a "preparedness platform", and access now needs an
  approved token. Instead of scraping, the Comms page imports the CSV a user exports
  from their own RepeaterBook account or from CHIRP. Personal use stays within their terms.

## Not added

- **WikiHow.** The ZIM is no longer published by Kiwix (`zim/wikihow/` returns 404 and
  the catalog has no entry), so there is nothing legitimate to download.
- **High-zoom satellite imagery.** Only the Internet-in-a-Box world layer (zoom 0–6, 25 MB)
  is freely redistributable in bulk. Street-level imagery providers forbid bulk download.

## Design notes

- The map page reads PMTiles archives directly over HTTP range requests through `/serve/`,
  so Martin is no longer on the critical path. Fonts and sprites are fetched once by `maps.sh`.
- Every background job (ZIM download, rescan, nightly update) reuses the Update button's
  log + pid + finish-marker convention, because gunicorn workers share no memory.
- Write features follow the anonymous-guest model: anyone on the LAN can add pins, notes
  and files (a shared household tool); deletions and downloads stay behind the admin login.
- Per-route body limits replace a blanket raise of the 64 KB cap.
