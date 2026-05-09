# SurviveV1 — Offline Survival Knowledge Repository

A self-hosted, offline-first knowledge base for post-apocalyptic or grid-down survival scenarios. Runs on a **Raspberry Pi 5 with AI Hat**, accessible via portable monitor and power bank. Up to **800 GB** of curated survival knowledge.

---

## What's Included

| Category | Sources |
|----------|---------|
| **Reference** | Full Wikipedia (EN), Wikibooks, Wikivoyage |
| **Medical** | Where There Is No Doctor, Merck Manual, first aid guides |
| **Skills** | iFixit repair guides, Stack Exchange (DIY, Cooking, Ham Radio) |
| **Education** | Khan Academy, Project Gutenberg (60k+ books), CK-12 |
| **Survival Videos** | YouTube playlists downloaded via yt-dlp |
| **Maps** | OpenStreetMap offline tiles (region-selectable) |
| **Books/PDFs** | Military manuals, homesteading, permaculture, engineering |
| **AI Assistant** | Local LLM (Ollama) powered by Raspberry Pi AI Hat |

---

## Quick Start

```bash
# 1. Clone on your Raspberry Pi
git clone https://github.com/schwadb/SurviveV1.git ~/SurviveV1
cd ~/SurviveV1

# 2. Run the installer
sudo bash setup/install.sh

# 3. Download content (runs in background, can take days)
bash download/download_all.sh --storage /mnt/survive

# 4. Start all services
bash scripts/start_services.sh

# 5. Open browser
http://localhost:8080
```

---

## System Requirements

- **Hardware:** Raspberry Pi 5 (4GB+ RAM recommended), AI Hat (Hailo-8L or HAT+ 2 with Hailo-10H)
- **Storage:** NVMe SSD via M.2 HAT+ (~850 MB/s, recommended) or USB 3.0 SSD (~360 MB/s). 256GB minimum, 1TB recommended.
- **Power:** Power bank (20,000+ mAh) or solar + battery. See `scripts/power_save.sh` for battery optimization.
- **OS:** Raspberry Pi OS (64-bit Bookworm)
- **Optional:** Wi-Fi dongle for local network sharing

---

## Directory Layout

```
SurviveV1/
├── setup/          # Install scripts for all dependencies
├── download/       # Content scrapers (Kiwix, yt-dlp, wget)
├── web/            # Flask dashboard served at :8080
├── ai/             # Ollama + local LLM setup for AI Hat
├── sync/           # rclone cloud sync (Google Drive, Dropbox, S3)
├── scripts/        # start/stop/status/update helpers
├── systemd/        # Systemd service unit files
├── config/         # nginx, kiwix, app config
├── docs/           # Extended documentation
└── data/           # Symlink → your storage mount
```

---

## Services

| Service | Port | Description |
|---------|------|-------------|
| Dashboard | 8080 | Main web UI |
| Kiwix | 8081 | Wikipedia, books, Stack Exchange |
| Kolibri | 8082 | Khan Academy, CK-12 education |
| Jellyfin | 8096 | Video player for downloaded videos |
| Calibre-Web | 8083 | Ebook reader (PDFs, EPUBs) |
| Ollama AI | 11434 | Local LLM API |
| Nginx | 80 | Reverse proxy (optional) |

---

## Cloud Sync

```bash
# Initial rclone setup
bash sync/setup_rclone.sh

# Sync to Google Drive
bash sync/sync_to_cloud.sh gdrive

# Sync to Dropbox
bash sync/sync_to_cloud.sh dropbox

# Schedule nightly sync (when internet available)
bash sync/schedule_sync.sh
```

---

## Updating Content

```bash
# Update specific category
bash download/kiwix_content.sh --update wikipedia

# Update all content (downloads new versions)
bash scripts/update_content.sh

# Check what's installed vs available
bash scripts/status.sh
```

---

## AI Assistant

With the Raspberry Pi AI Hat (Hailo-8L), you can run local LLMs to query your knowledge base:

```bash
# Chat with local AI (searches your content)
bash ai/query.sh "How do I purify water without chemicals?"

# Or via web UI at http://localhost:8080/ai
```

---

## Storage Budget (~800 GB)

| Content | Size |
|---------|------|
| Wikipedia EN (with images) | ~100 GB |
| Wikibooks + Wikivoyage | ~5 GB |
| Stack Exchange (all) | ~80 GB |
| Project Gutenberg | ~60 GB |
| Khan Academy (Kolibri) | ~200 GB |
| Survival/medical videos | ~150 GB |
| OpenStreetMap (world) | ~70 GB |
| PDFs + manuals | ~20 GB |
| LLM models (AI) | ~50 GB |
| Buffer | ~65 GB |
| **Total** | **~800 GB** |

---

## How It Compares

| Feature | SurviveV1 | Internet-in-a-Box | Project N.O.M.A.D |
|---------|-----------|-------------------|-------------------|
| **Target hardware** | Raspberry Pi 5 | Raspberry Pi 3/4 | x86 + GPU |
| **Portable/field-ready** | Yes (battery-powered) | Yes | No (desktop) |
| **Local AI assistant** | Yes (Ollama + Hailo) | No | Yes (GPU required) |
| **Survival-focused content** | Yes (26 categories) | No (education-focused) | Yes |
| **Video library** | Yes (yt-dlp) | No | Limited |
| **Offline maps** | Yes (OpenStreetMap) | Yes | No |
| **Setup complexity** | Single installer | Ansible playbook | Docker Compose |
| **Storage target** | 800 GB | 64-256 GB | 500+ GB |
| **Cost** | ~$80 (Pi 5) | ~$35 (Pi 4) | $500+ (PC + GPU) |
| **Power consumption** | 3-9W | 2-5W | 100-300W |

---

## License

Content is subject to individual source licenses (Creative Commons, Public Domain, etc.). See `docs/licenses.md`.
