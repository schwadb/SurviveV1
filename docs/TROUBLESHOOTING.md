# SurviveV1 Troubleshooting Guide

## Log Locations

| Service | Log file |
|---------|----------|
| Dashboard | `/var/log/survive_dashboard.log` |
| Kiwix | `/var/log/survive_kiwix.log` |
| Ollama | `/var/log/survive_ollama.log` |
| Maps (Martin) | `/var/log/survive_maps.log` |
| Kolibri | `/var/log/survive_kolibri.log` |
| nginx | `/var/log/nginx/survive_access.log` |
| Download errors | `/mnt/survive/.logs/failed_downloads.log` |
| Manual start | `/tmp/survive_dashboard.log` |

Tail any log in real time: `tail -f /var/log/survive_dashboard.log`

---

## Dashboard Not Loading

**Symptom:** Browser shows "Connection refused" at http://survive.local:8080

```bash
# Check service status
bash scripts/status.sh

# Check if Flask is running
ps aux | grep server.py

# Start manually and watch for errors
source /opt/survive/venv/bin/activate
cd web && python3 server.py

# Check systemd status
sudo systemctl status survive-dashboard
sudo journalctl -u survive-dashboard -n 50
```

**Common causes:**
- Python venv not activated — install ran but venv missing: `python3 -m venv /opt/survive/venv && pip install -r requirements.txt`
- Port 8080 already in use: `ss -tlnp | grep 8080`
- Missing `config/.secret_key` — re-run: `python3 web/server.py` once to generate

---

## Wikipedia / Kiwix Not Showing Content

**Symptom:** "No results" or Kiwix page blank

```bash
# Check if ZIM files exist
ls /mnt/survive/zim/

# Check kiwix library file
cat /mnt/survive/.kiwix_library.xml | head -5

# Re-register ZIM files
while IFS= read -r -d '' f; do
    kiwix-manage /mnt/survive/.kiwix_library.xml add "$f" 2>/dev/null
done < <(find /mnt/survive/zim -name "*.zim" -print0)

# Restart kiwix
sudo systemctl restart kiwix
# or manually:
kiwix-serve --library /mnt/survive/.kiwix_library.xml --port 8081
```

**Common causes:**
- ZIM files not downloaded yet — run `bash download/kiwix_content.sh`
- Library XML is empty or malformed — delete and re-register
- Kiwix version mismatch — re-run `bash setup/install.sh` kiwix section

---

## AI Not Responding

**Symptom:** "AI Service Not Running" banner, or chat times out

```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Start Ollama
ollama serve &

# Check installed models
ollama list

# Pull a model if none exist (637 MB — fits on Pi)
ollama pull tinyllama

# Check logs
sudo journalctl -u ollama -n 30
tail -f /var/log/survive_ollama.log
```

**Common causes:**
- No models installed — run `bash ai/setup_ollama.sh`
- Ollama not running — `sudo systemctl start ollama`
- Model too large for RAM — use `tinyllama` (637 MB) or `phi3:mini` (2.3 GB) on Pi5 4GB

---

## Storage Drive Not Mounting

**Symptom:** "Storage not mounted" warning, content missing

```bash
# Verify drive is visible
lsblk
fdisk -l

# Mount manually
sudo mount /dev/sda1 /mnt/survive

# Check filesystem
sudo fsck /dev/sda1

# Verify fstab entry for auto-mount
cat /etc/fstab | grep survive

# Add fstab entry (replace UUID with your drive's UUID from blkid)
UUID=$(sudo blkid -s UUID -o value /dev/sda1)
echo "UUID=$UUID  /mnt/survive  ext4  defaults,noatime  0  2" | sudo tee -a /etc/fstab

# Test fstab
sudo mount -a
```

---

## No Disk Space

**Symptom:** Downloads fail, services won't start, errors about disk full

```bash
# Check overall usage
df -h /mnt/survive

# Find largest directories
du -sh /mnt/survive/* | sort -rh | head -20

# Clean incomplete download temp files
find /mnt/survive -name "*.aria2" -delete
find /mnt/survive -name "*.part" -delete

# Remove failed/incomplete video fragments
find /mnt/survive/videos -name "*.ytdl" -delete
```

---

## Videos Not Playing in Jellyfin

**Symptom:** Jellyfin shows files but won't play

```bash
# Check Jellyfin status
sudo systemctl status jellyfin

# Check video directory is visible
ls /mnt/survive/videos/

# Re-scan library in Jellyfin web UI:
# Dashboard → Libraries → [your library] → Scan All Libraries

# Check for hardware transcoding errors
sudo journalctl -u jellyfin -n 50 | grep -i "error\|transcode"
```

---

## Maps Not Loading

**Symptom:** Maps tile server returns 404 or blank tiles

```bash
# Check Martin config
cat /mnt/survive/maps/martin_config.yaml

# Verify .mbtiles files exist
ls /mnt/survive/maps/mbtiles/

# Re-generate config
bash download/maps.sh --region your-region

# Start Martin manually
martin --config /mnt/survive/maps/martin_config.yaml --listen-addresses 0.0.0.0:3000

# Check logs
tail -f /var/log/survive_maps.log
```

---

## Services Start Slowly After Boot

**Symptom:** Dashboard loads but services show "STOPPED" for first 2-3 minutes

This is normal — Kolibri (Khan Academy) takes up to 2 minutes to initialize. Kiwix and Ollama take 30–60 seconds.

```bash
# Check systemd boot order
systemctl list-dependencies survive-dashboard.service

# View startup timing
systemd-analyze blame | head -20
```

---

## Network / mDNS (survive.local) Not Resolving

**Symptom:** `http://survive.local` doesn't work from other devices

```bash
# Check avahi is running
sudo systemctl status avahi-daemon

# Restart avahi
sudo systemctl restart avahi-daemon

# Test mDNS resolution
avahi-resolve -n survive.local

# Alternative: use IP address directly
hostname -I  # shows Pi's IP
# Then use http://192.168.x.x:8080
```

---

## Download Failures — Retrying Failed Downloads

After a download run, check the failure log:

```bash
cat /mnt/survive/.logs/failed_downloads.log
```

Failed URLs are logged with timestamps. To retry specific content:

```bash
# Retry a specific category
bash download/books_pdfs.sh --storage /mnt/survive

# Retry all (skips already-downloaded files)
bash download/download_all.sh --resume
```

---

## Reinstalling / Starting Fresh

```bash
# Stop all services
bash scripts/stop_services.sh

# Re-run installer (safe to re-run)
sudo bash setup/install.sh

# Re-generate systemd service files with your storage path
sudo bash scripts/generate_services.sh

# Verify config
cat config/survive.conf
```

---

## Hotspot Mode (Grid-Down Wi-Fi)

`sudo bash scripts/hotspot.sh enable` makes the Pi broadcast its own Wi-Fi
network (settings in `survive.conf`: `SURVIVE_HOTSPOT_SSID` / `_PASS`).
The dashboard is then at **http://10.42.0.1:8080** (NetworkManager shared
mode always gives the Pi 10.42.0.1) — `survive.local` also works on the
hotspot subnet via mDNS.

**Locked yourself out?** (enabled the AP over Wi-Fi SSH and lost the link):
plug in Ethernet, or simply **power-cycle the Pi** — the hotspot connection
is created with `autoconnect no`, so a reboot returns to normal Wi-Fi. This
is deliberate (a dead-man switch for headless boxes). To make the hotspot
persistent across reboots instead:

```bash
sudo nmcli connection modify survive-hotspot connection.autoconnect yes
```

**Why 2.4 GHz?** The AP uses band `bg` on purpose: it works in every
regulatory domain (5 GHz AP channels fail silently when the Wi-Fi country is
unset), every phone supports it, and it penetrates walls better — the right
trade-off in a disaster.

**AP won't start?** Set your Wi-Fi country first:
`sudo raspi-config nonint do_wifi_country US` (or your country code).

---

## YouTube "Sign in to confirm you're not a bot"

yt-dlp downloads fail with this message when YouTube decides the request looks
automated. It is a YouTube policy change, not a fault in the download scripts —
and it comes and goes.

Fixes, cheapest first:

```bash
# 1. Update yt-dlp — the project ships fixes for these blocks constantly
sudo yt-dlp -U    # or: sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod +x /usr/local/bin/yt-dlp
```

```bash
# 2. Supply cookies from a logged-in YouTube session.
#    On the Pi's desktop browser, install a "Get cookies.txt" extension, export
#    while logged in to youtube.com, then set in config/survive.conf:
SURVIVE_YTDLP_COOKIES="/home/<user>/yt_cookies.txt"
```

```bash
# 3. Or read cookies straight from a local browser profile:
SURVIVE_YTDLP_BROWSER="chromium"
```

**The "n challenge" (formats missing even with cookies):** YouTube also
obfuscates stream URLs with JavaScript that yt-dlp must execute. Requirements
(all three, in the SAME environment):

```bash
sudo apt install -y nodejs
sudo pip install --break-system-packages -U yt-dlp yt-dlp-ejs
```

Important: the standalone yt-dlp binary CANNOT load the yt-dlp-ejs solver —
yt-dlp must be the pip-installed package. If `which yt-dlp` shows a binary
that predates the pip install, delete it so the pip copy takes over.

If "n challenge solving failed" persists with all of the above current,
YouTube is ahead of the tooling — a known, recurring state. Retry monthly:

```bash
sudo pip install --break-system-packages -U yt-dlp yt-dlp-ejs
```

Note that using a personal account for bulk downloads can get that account rate
limited; a throwaway account is the safer choice. Blocked videos are skipped
rather than aborting the run, so partial video libraries are expected.

---

## Getting Help

- Check service status: `bash scripts/status.sh`
- View all logs: `tail -f /var/log/survive_*.log`
- GitHub Issues: https://github.com/schwadb/SurviveV1/issues
