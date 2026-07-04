---
name: install-pi
description: Complete guided installation of SurviveV1 on a Raspberry Pi 5 — OS flashing, one-click bootstrap, wizard walkthrough, content download, verification, and troubleshooting. Use when the user asks how to install, set up, deploy, or re-install SurviveV1 on a Raspberry Pi, or asks for install instructions.
---

# SurviveV1 Raspberry Pi Installation Guide

Walk the user through installing SurviveV1 end-to-end. Adapt to where they
are in the process — if they already have the OS flashed or the repo cloned,
skip ahead. Ask which step they're on if it isn't obvious.

## Phase 0 — Hardware checklist

Confirm the user has:

- **Raspberry Pi 5** (4 GB works; 8 GB good; 16 GB unlocks the largest AI model tier)
- **USB 3.0 SSD or NVMe drive** — 256 GB minimum, 800 GB+ recommended (holds all content)
- **microSD card** (32 GB+) for the OS
- Optional: Hailo-8L AI Hat (accelerates vision tasks only — the LLM runs on CPU regardless)
- Internet during setup only; the system runs 100% offline afterward

RAM determines the AI model tier selected automatically at install:

| RAM | Model | Speed |
|-----|-------|-------|
| < 6 GB | gemma4:e2b | fastest |
| ≥ 6 GB | gemma4:e4b | balanced |
| ≥ 14 GB | gemma4:12b | best quality, ~1–3 tok/s |

## Phase 1 — Flash the OS

1. Download Raspberry Pi Imager: https://www.raspberrypi.com/software
2. Choose **Raspberry Pi OS (64-bit), Bookworm**. 64-bit is REQUIRED (aarch64) —
   the bootstrap script refuses 32-bit systems.
3. In Imager's gear/settings: set username, Wi-Fi, and enable SSH for headless install.
4. Flash, insert SD, connect the SSD to a **blue USB 3.0 port**, power on.

## Phase 2 — One-click install

Check which branch the current code lives on before giving the command
(`git branch -a`). The bootstrap defaults to `main`; if the code is on a
feature branch, use the `SURVIVE_BRANCH` override form.

From main:

```bash
curl -fsSL https://raw.githubusercontent.com/schwadb/SurviveV1/main/install/bootstrap.sh | bash
```

From a branch (substitute the real branch name):

```bash
curl -fsSL https://raw.githubusercontent.com/schwadb/SurviveV1/<BRANCH>/install/bootstrap.sh | SURVIVE_BRANCH=<BRANCH> bash
```

Env overrides: `SURVIVE_REPO` (fork URL), `SURVIVE_DIR` (clone target,
default `~/SurviveV1`).

The bootstrap verifies aarch64 + Bookworm + internet, installs git if
missing, clones the repo, then `exec`s into the interactive wizard with sudo.

## Phase 3 — The wizard (what to tell the user at each prompt)

1. **Welcome** — shows detected RAM and the AI model tier it will install.
2. **Storage** — lists USB drives (SD card and loop devices are hidden so the
   boot disk can't be selected). Formatting is DESTRUCTIVE and double-guarded:
   a y/n prompt, then the user must literally type `format`. The drive is
   mounted at `/mnt/survive` and added to /etc/fstab by UUID for auto-mount.
   - If the drive already has a filesystem they want to keep, choose it
     WITHOUT formatting — the wizard detects existing mounts.
3. **Hostname** — default `survive` → dashboard at `http://survive.local`.
4. **Map region** — advise picking the user's region (e.g. north-america)
   over `world` unless they need global coverage; saves ~50 GB.
5. **Summary** — review, confirm; software install runs 15–30 min.
6. **AI model pull** — recommend yes (~8 GB for gemma4:12b on a 16 GB Pi).

## Phase 4 — Content download (separate, long-running)

Software and content are separate. Content is up to ~800 GB and can take days.

```bash
cd ~/SurviveV1
# Optional first: edit config/survive.conf — CONTENT_* flags, VIDEO_QUALITY,
# SURVIVE_BANDWIDTH_LIMIT (bytes/s), MAP_REGION.

bash download/download_all.sh --dry-run          # preview size budget
tmux new -s download                             # survive SSH disconnects
bash download/download_all.sh --storage /mnt/survive
# Detach: Ctrl+B then D. Reattach: tmux attach -t download
```

Interrupted? `--resume` skips categories already recorded as complete in
`/mnt/survive/.download_progress`. Single categories: `--only kiwix`,
`--only videos`, `--only books`, `--only maps`, `--only kolibri`.

Recommend wired Ethernet and running overnight.

## Phase 5 — Verify the install

Run these checks (or `make test` for lint + smoke tests):

```bash
cd ~/SurviveV1
make status                          # all services green?
curl -sf http://localhost:8080/health          # {"status":"ok"}
curl -sf http://localhost:8080/api/status | python3 -m json.tool
curl -sf http://localhost:8080/api/connectivity  # {"online": true/false}
```

Then the **offline drill** — the whole point of the system. Unplug
Ethernet / disable Wi-Fi and confirm:

1. Dashboard still loads at `http://survive.local:8080`
2. Home page banner flips to "Offline Mode: ACTIVE"
3. Wikipedia (:8081) still serves articles
4. AI chat still answers (slowly — CPU inference)

## Phase 6 — Access URLs

| Service | URL |
|---------|-----|
| Dashboard | http://survive.local:8080 |
| AI assistant | http://survive.local:8080/ai |
| Wikipedia (Kiwix) | http://survive.local:8081 |
| Khan Academy (Kolibri) | http://survive.local:8082 |
| E-books (Calibre-Web) | http://survive.local:8083 |
| Videos (Jellyfin) | http://survive.local:8096 |
| Maps (Martin) | http://survive.local:3000 |

If `survive.local` doesn't resolve (common on Android): use the Pi's IP —
`hostname -I` on the Pi, or the URL box printed by `make start`.

## Ongoing management

```bash
make start / make stop / make status   # service control
make test                              # lint + 20 smoke tests
bash scripts/update_content.sh         # refresh content when online
bash sync/setup_rclone.sh              # optional cloud backup
git -C ~/SurviveV1 pull && make start  # update the software
```

## Troubleshooting quick table

| Symptom | Fix |
|---------|-----|
| Pre-flight FAIL | `bash setup/pre_flight_check.sh` alone to see which check |
| "Storage drive not mounted" banner | `lsblk`, then `sudo mount /mnt/survive`; check /etc/fstab entry |
| Service down | logs in `/tmp/*.log` or `journalctl -u survive-dashboard` |
| survive.local unreachable | use IP; mDNS needs Avahi (installed by default on Pi OS) |
| AI slow | expected — CPU inference; switch model dropdown to gemma4:e4b or e2b |
| AI errors | `curl localhost:11434/api/tags` — is Ollama up? `ollama list` — model pulled? |
| Download stalls | Ctrl+C then rerun with `--resume`; set SURVIVE_BANDWIDTH_LIMIT |
| Disk full mid-download | disable categories in survive.conf, delete partials, `--resume` |

## Uninstall / start over

```bash
bash scripts/stop_services.sh
sudo systemctl disable --now survive-dashboard kiwix ollama kolibri calibre-web martin-tiles 2>/dev/null
rm -rf ~/SurviveV1            # code
# Content on /mnt/survive is untouched — reformat via the wizard to wipe it.
```
