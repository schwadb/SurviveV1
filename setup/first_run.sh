#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — First-run configuration wizard
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="$REPO_DIR/config/survive.conf"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()   { echo -e "${BLUE}[?]${NC} $*"; }
prompt() { echo -e "${YELLOW}>>>${NC} $*"; }

echo ""
echo -e "${GREEN}=== SurviveV1 First-Run Setup ===${NC}"
echo ""

# ── Storage path ──────────────────────────────────────────────────────────────
info "Where should content be stored? (USB SSD recommended)"
echo "  Options: /mnt/survive, /media/pi/SURVIVE, /home/pi/survive"
read -rp "  Storage path [/mnt/survive]: " STORAGE_PATH
STORAGE_PATH="${STORAGE_PATH:-/mnt/survive}"

# ── Storage device ────────────────────────────────────────────────────────────
echo ""
info "Available block devices:"
lsblk -o NAME,SIZE,TYPE,MOUNTPOINT 2>/dev/null | grep -E "disk|part" | head -20
echo ""
read -rp "  Mount device (e.g. /dev/sda1) or SKIP to use existing path: " STORAGE_DEV
STORAGE_DEV="${STORAGE_DEV:-SKIP}"

# ── Content budget ────────────────────────────────────────────────────────────
echo ""
info "Storage budget (GB)? Default 800"
read -rp "  Budget [800]: " STORAGE_BUDGET_GB
STORAGE_BUDGET_GB="${STORAGE_BUDGET_GB:-800}"

# ── Content selection ─────────────────────────────────────────────────────────
echo ""
info "Select content to download (y/n for each):"
read -rp "  Wikipedia EN (full, ~100GB)?          [Y/n]: " DL_WIKIPEDIA
read -rp "  Wikipedia EN (no pictures, ~20GB)?    [y/N]: " DL_WIKIPEDIA_NOPIC
read -rp "  Wikibooks + Wikivoyage (~5GB)?        [Y/n]: " DL_WIKIBOOKS
read -rp "  Stack Exchange (DIY,Medical,etc ~80GB)? [Y/n]: " DL_STACKEXCHANGE
read -rp "  Project Gutenberg books (~60GB)?      [Y/n]: " DL_GUTENBERG
read -rp "  Khan Academy via Kolibri (~200GB)?    [Y/n]: " DL_KOLIBRI
read -rp "  Survival/homesteading videos (~150GB)? [Y/n]: " DL_VIDEOS
read -rp "  OpenStreetMap offline maps (~70GB)?   [Y/n]: " DL_MAPS
read -rp "  Curated PDFs/manuals (~20GB)?         [Y/n]: " DL_PDFS
read -rp "  AI models for Ollama (~50GB)?         [Y/n]: " DL_AI_MODELS
read -rp "  iFixit repair guides (~5GB)?          [Y/n]: " DL_IFIX

DL_WIKIPEDIA="${DL_WIKIPEDIA:-Y}"
DL_WIKIPEDIA_NOPIC="${DL_WIKIPEDIA_NOPIC:-N}"
DL_WIKIBOOKS="${DL_WIKIBOOKS:-Y}"
DL_STACKEXCHANGE="${DL_STACKEXCHANGE:-Y}"
DL_GUTENBERG="${DL_GUTENBERG:-Y}"
DL_KOLIBRI="${DL_KOLIBRI:-Y}"
DL_VIDEOS="${DL_VIDEOS:-Y}"
DL_MAPS="${DL_MAPS:-Y}"
DL_PDFS="${DL_PDFS:-Y}"
DL_AI_MODELS="${DL_AI_MODELS:-Y}"
DL_IFIX="${DL_IFIX:-Y}"

# ── Hostname ──────────────────────────────────────────────────────────────────
echo ""
read -rp "  Hostname for this device [survive]: " DEVICE_HOSTNAME
DEVICE_HOSTNAME="${DEVICE_HOSTNAME:-survive}"

# ── Write config ──────────────────────────────────────────────────────────────
mkdir -p "$(dirname "$CONFIG_FILE")"
cat > "$CONFIG_FILE" << EOF
# SurviveV1 Configuration
# Generated: $(date)

SURVIVE_STORAGE_PATH="$STORAGE_PATH"
SURVIVE_STORAGE_DEV="$STORAGE_DEV"
SURVIVE_BUDGET_GB="$STORAGE_BUDGET_GB"
SURVIVE_HOSTNAME="$DEVICE_HOSTNAME"

# Content flags (Y=download, N=skip)
CONTENT_WIKIPEDIA="$DL_WIKIPEDIA"
CONTENT_WIKIPEDIA_NOPIC="$DL_WIKIPEDIA_NOPIC"
CONTENT_WIKIBOOKS="$DL_WIKIBOOKS"
CONTENT_STACKEXCHANGE="$DL_STACKEXCHANGE"
CONTENT_GUTENBERG="$DL_GUTENBERG"
CONTENT_KOLIBRI="$DL_KOLIBRI"
CONTENT_VIDEOS="$DL_VIDEOS"
CONTENT_MAPS="$DL_MAPS"
CONTENT_PDFS="$DL_PDFS"
CONTENT_AI_MODELS="$DL_AI_MODELS"
CONTENT_IFIX="$DL_IFIX"
EOF

echo ""
echo -e "${GREEN}Configuration saved to $CONFIG_FILE${NC}"
echo ""

# ── Mount storage ─────────────────────────────────────────────────────────────
if [[ "$STORAGE_DEV" != "SKIP" ]] && [[ -b "$STORAGE_DEV" ]]; then
    echo "Mounting $STORAGE_DEV at $STORAGE_PATH..."
    mkdir -p "$STORAGE_PATH"
    FSTYPE=$(blkid -s TYPE -o value "$STORAGE_DEV" 2>/dev/null || echo "ext4")
    mount -t "$FSTYPE" "$STORAGE_DEV" "$STORAGE_PATH"

    # Add to fstab for auto-mount
    PARTUUID=$(blkid -s PARTUUID -o value "$STORAGE_DEV" 2>/dev/null || echo "")
    if [[ -n "$PARTUUID" ]]; then
        echo "PARTUUID=$PARTUUID  $STORAGE_PATH  $FSTYPE  defaults,noatime  0  2" >> /etc/fstab
        echo "Added to /etc/fstab for auto-mount"
    fi
fi
