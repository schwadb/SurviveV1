# SurviveV1 Quick Start Guide

## What You Need

- Raspberry Pi 5 (4GB or 8GB RAM)
- AI Hat (Hailo-8L, seated in M.2 slot)
- 512GB–1TB USB 3.0 SSD or NVMe (via USB 3.1 or M.2 adapter)
- Portable monitor (HDMI)
- Power bank (20,000+ mAh, USB-C PD 45W+)
- MicroSD card (32GB+) with Raspberry Pi OS 64-bit Bookworm

---

## Step 1: Prepare the Pi

```bash
# Flash Raspberry Pi OS (64-bit) to SD card using Raspberry Pi Imager
# Enable SSH in Imager settings
# Boot and connect to Pi via SSH or keyboard/monitor
```

---

## Step 2: Clone and Install

```bash
# Clone repository (replace URL with your fork or local path)
git clone https://github.com/schwadb/SurviveV1.git ~/SurviveV1
cd ~/SurviveV1

# Run installer (takes 15-30 minutes)
sudo bash setup/install.sh
```

The installer will:
- Update the system
- Install all required software (Kiwix, Kolibri, Jellyfin, Calibre, Ollama, nginx)
- Set up network sharing (Samba, mDNS)
- Configure firewall
- Install systemd services

---

## Step 3: Mount Your Storage Drive

```bash
# Find your drive
lsblk

# Format if new (WARNING: erases all data)
sudo mkfs.ext4 /dev/sda1  # replace sda1 with your drive

# Mount
sudo mkdir -p /mnt/survive
sudo mount /dev/sda1 /mnt/survive

# Auto-mount on boot
echo "UUID=$(sudo blkid -s UUID -o value /dev/sda1)  /mnt/survive  ext4  defaults,noatime  0  2" | sudo tee -a /etc/fstab
```

---

## Step 4: Configure

```bash
# Edit configuration
nano ~/SurviveV1/config/survive.conf

# Key settings:
# SURVIVE_STORAGE_PATH="/mnt/survive"
# MAP_REGION="north-america"  (or your region)
# CONTENT_VIDEOS="Y"          (set N to skip)
```

---

## Step 5: Download Content

```bash
# Download everything (will take DAYS — let it run overnight)
bash download/download_all.sh

# Or download specific categories:
bash download/kiwix_content.sh          # Wikipedia (~100GB)
bash download/videos.sh                  # Survival videos (~150GB)
bash download/books_pdfs.sh              # PDFs/books (~20GB)
bash download/maps.sh --region us        # US maps (~20GB)
bash download/kolibri_content.sh         # Khan Academy (~200GB)
```

**Download times (with 100 Mbps connection):**
| Content | Size | Est. Time |
|---------|------|-----------|
| Wikipedia | 100 GB | ~3 hours |
| Videos | 150 GB | ~4 hours |
| Maps (US) | 20 GB | ~30 min |
| Khan Academy | 200 GB | ~5 hours |
| PDFs/Books | 20 GB | ~30 min |

---

## Step 6: Set Up AI

```bash
# Pull AI models
bash ai/setup_ollama.sh

# Or manually pull a specific model
ollama pull phi3:mini    # 2.3GB — recommended for RPi5
ollama pull tinyllama    # 637MB — very fast, basic quality
```

---

## Step 7: Start Everything

```bash
# First time: generate systemd service files for your storage path
sudo bash scripts/generate_services.sh

# Enable services to start on boot
sudo systemctl enable survive-dashboard kiwix ollama martin-tiles kolibri

# Start all services now
sudo systemctl start survive-dashboard kiwix ollama martin-tiles

# Or use the convenience script (works with or without systemd)
bash scripts/start_services.sh
```

**Managing individual services with systemctl:**
```bash
# Check status
sudo systemctl status survive-dashboard

# Restart a service
sudo systemctl restart kiwix

# View live logs
sudo journalctl -u ollama -f

# Stop all SurviveV1 services
sudo systemctl stop survive-dashboard kiwix ollama martin-tiles kolibri
```

Open in browser:
- From the Pi: `http://localhost:8080`
- From another device: `http://survive.local:8080`

---

## Step 8: Cloud Backup (Optional)

Do this while you have internet access, so you can restore later.

```bash
# Configure cloud storage
bash sync/setup_rclone.sh gdrive     # Google Drive
bash sync/setup_rclone.sh dropbox    # Dropbox

# Sync to cloud
bash sync/sync_to_cloud.sh gdrive

# Schedule automatic sync when internet available
sudo bash sync/schedule_sync.sh gdrive
```

---

## Accessing Your System

### From the Pi itself:
- Open browser: `http://localhost:8080`

### From other devices on the same network:
- Browser: `http://survive.local:8080`
- Or: `http://192.168.1.X:8080` (replace with Pi's IP)

### File sharing:
- Windows: `\\survive\survive`
- Mac: `smb://survive/survive`
- Linux: `smb://survive/survive`

---

## Service Ports

| Service | URL |
|---------|-----|
| Main Dashboard | http://survive.local:8080 |
| Wikipedia | http://survive.local:8081 |
| Khan Academy | http://survive.local:8082 |
| E-Books | http://survive.local:8083 |
| Videos | http://survive.local:8096 |
| Maps | http://survive.local:3000 |
| AI Chat | http://survive.local:8080/ai |

---

## Power Tips

| Setup | Battery Life |
|-------|-------------|
| Pi 5 + display | ~5-6 hours on 20,000mAh |
| Pi 5 only (headless) | ~10-12 hours |
| Pi 5 + solar panel | Indefinite |

- Use `sudo vcgencmd get_throttled` to check for power issues
- Use `sudo cpufreq-set -g powersave` to extend battery life

---

## Troubleshooting

**Dashboard not loading:**
```bash
bash scripts/status.sh
tail -f /tmp/survive_dashboard.log
```

**Wikipedia not showing content:**
```bash
ls /mnt/survive/zim/
# Should show .zim files
bash scripts/start_services.sh  # restart kiwix
```

**AI not responding:**
```bash
ollama serve &
ollama list    # check models are installed
```

**No disk space:**
```bash
df -h /mnt/survive
du -sh /mnt/survive/*   # find largest directories
```
