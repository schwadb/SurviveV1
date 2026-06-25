#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Interactive Installation Wizard
# Called by install/bootstrap.sh after the repo has been cloned.
# Can also be run directly: sudo bash install/wizard.sh
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF="$REPO_DIR/config/survive.conf"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

banner()  { echo -e "${BOLD}${BLUE}$*${NC}"; }
header()  { echo -e "\n${BOLD}${CYAN}── $* ──────────────────────────────────────${NC}"; }
ok()      { echo -e "  ${GREEN}✓${NC}  $*"; }
info()    { echo -e "  ${BLUE}→${NC}  $*"; }
warn()    { echo -e "  ${YELLOW}!${NC}  $*"; }
ask()     { echo -en "  ${BOLD}$*${NC} "; }
die()     { echo -e "\n${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── Screen: Welcome ───────────────────────────────────────────────────────────
show_welcome() {
    clear
    echo ""
    echo -e "${BOLD}${GREEN}"
    cat << 'BANNER'
  ____                  _           __     ____
 / ___| _   _ _ ____   _(_)_   _____\ \   / /_ \
 \___ \| | | | '__\ \ / / \ \ / / _ \ \ / /  / /
  ___) | |_| | |   \ V /| |\ V /  __/ \ V /  / /
 |____/ \__,_|_|    \_/ |_| \_/ \___|  \_/  /_/
BANNER
    echo -e "${NC}"
    banner "  Offline Survival Repository — Installation Wizard"
    echo ""
    echo -e "  ${DIM}Installs: dashboard · Wikipedia · AI assistant · maps · medical guides${NC}"
    echo ""

    # Show detected hardware
    local ram_mb
    ram_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
    local ram_tier
    if (( ram_mb >= 14336 )); then ram_tier="16 GB — gemma4:12b (best quality)"
    elif (( ram_mb >= 6144 )); then  ram_tier="8 GB  — gemma4:e4b (good quality)"
    else                             ram_tier="4 GB  — gemma4:e2b (fast baseline)"
    fi

    info "System RAM:   ${ram_mb} MB  →  AI model tier: ${ram_tier}"
    info "Architecture: $(uname -m)"
    info "OS:           $(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || echo "unknown")"
    echo ""
    ask "Press ENTER to start, or Ctrl+C to cancel."
    read -r _
}

# ── Screen: Storage device selection ─────────────────────────────────────────
CHOSEN_DEV=""
CHOSEN_MOUNT="/mnt/survive"

choose_storage() {
    header "Storage"
    echo ""

    # Build list: non-SD, non-loop block devices
    local -a devs=()
    local -a sizes=()
    local -a models=()
    while IFS= read -r line; do
        local name size model
        name=$(awk '{print $1}' <<< "$line")
        size=$(awk '{print $2}' <<< "$line")
        model=$(awk '{$1=$2=""; print $0}' <<< "$line" | xargs)
        devs+=("$name")
        sizes+=("$size")
        models+=("$model")
    done < <(lsblk -d -n -o NAME,SIZE,MODEL 2>/dev/null \
             | grep -Ev '^(loop|mmcblk|zram)' || true)

    # Check if /mnt/survive is already mounted
    local already_mounted=false
    if mountpoint -q /mnt/survive 2>/dev/null; then
        already_mounted=true
        local mounted_gb
        mounted_gb=$(df -BG /mnt/survive | tail -1 | awk '{print $2}' | tr -d 'G')
        ok "/mnt/survive is already mounted (${mounted_gb} GB)"
        echo ""
        ask "Use existing mount? [Y/n]: "
        read -r ans
        if [[ "${ans:-y}" =~ ^[Yy]$ ]]; then
            CHOSEN_DEV="SKIP"
            CHOSEN_MOUNT="/mnt/survive"
            return
        fi
    fi

    if [[ ${#devs[@]} -eq 0 ]]; then
        if [[ "$already_mounted" == "true" ]]; then
            CHOSEN_DEV="SKIP"
            CHOSEN_MOUNT="/mnt/survive"
            return
        fi
        warn "No external drives detected."
        warn "Connect your USB SSD and press ENTER to rescan, or Ctrl+C to abort."
        read -r _
        choose_storage   # recurse once
        return
    fi

    echo "  Detected drives:"
    echo ""
    local i=1
    for idx in "${!devs[@]}"; do
        local in_use=""
        if mountpoint -q "/dev/${devs[$idx]}" 2>/dev/null; then
            in_use="${DIM} (mounted)${NC}"
        fi
        printf "    ${BOLD}[%d]${NC}  /dev/%-8s  %6s  %s%b\n" \
               "$i" "${devs[$idx]}" "${sizes[$idx]}" "${models[$idx]}" "$in_use"
        i=$(( i + 1 ))
    done
    if [[ "$already_mounted" == "true" ]]; then
        echo ""
        printf "    ${BOLD}[%d]${NC}  Keep /mnt/survive (already mounted)\n" "$i"
    fi
    echo ""
    ask "Select drive [1]: "
    read -r choice
    choice="${choice:-1}"

    if [[ "$already_mounted" == "true" ]] && [[ "$choice" == "$i" ]]; then
        CHOSEN_DEV="SKIP"
        CHOSEN_MOUNT="/mnt/survive"
        return
    fi

    local sel=$(( choice - 1 ))
    if [[ "$sel" -lt 0 ]] || [[ "$sel" -ge "${#devs[@]}" ]]; then
        warn "Invalid choice — defaulting to ${devs[0]}"
        sel=0
    fi

    CHOSEN_DEV="${devs[$sel]}"

    # Mount-point: default /mnt/survive, let user override
    echo ""
    ask "Mount point [/mnt/survive]: "
    read -r mp
    CHOSEN_MOUNT="${mp:-/mnt/survive}"
}

# ── Screen: Format confirmation ───────────────────────────────────────────────
FORMAT_DRIVE=false

confirm_format() {
    [[ "$CHOSEN_DEV" == "SKIP" ]] && return

    header "Format Drive"
    echo ""
    local size
    size=$(lsblk -d -n -o SIZE "/dev/$CHOSEN_DEV" 2>/dev/null || echo "?")
    warn "/dev/${CHOSEN_DEV}  (${size})"
    echo ""
    echo -e "  ${DIM}If this drive is new or has no data you want to keep, formatting it"
    echo -e "  as ext4 will give the best performance on Linux.${NC}"
    echo ""
    ask "Format /dev/${CHOSEN_DEV} as ext4? This ERASES ALL DATA. [y/N]: "
    read -r ans
    if [[ "${ans:-n}" =~ ^[Yy]$ ]]; then
        echo ""
        warn "Last chance: type  format  to confirm, or press ENTER to skip."
        ask "> "
        read -r confirm
        if [[ "$confirm" == "format" ]]; then
            FORMAT_DRIVE=true
            ok "Drive will be formatted during install."
        else
            info "Skipping format — existing data will be preserved."
        fi
    else
        info "Skipping format — existing data will be preserved."
    fi
}

# ── Screen: Hostname ──────────────────────────────────────────────────────────
CHOSEN_HOSTNAME=""

choose_hostname() {
    header "Hostname"
    echo ""
    local current
    current=$(hostname 2>/dev/null || echo "raspberrypi")
    info "Current hostname: ${current}"
    info "Your Pi will be reachable as  http://\${hostname}.local:8080"
    echo ""
    ask "Hostname [survive]: "
    read -r hn
    CHOSEN_HOSTNAME="${hn:-survive}"
    ok "Hostname set to: ${CHOSEN_HOSTNAME}"
}

# ── Screen: Map region ────────────────────────────────────────────────────────
CHOSEN_MAP_REGION="north-america"

choose_map_region() {
    header "Offline Maps Region"
    echo ""
    echo "  Available regions:"
    echo "    [1] North America  (recommended for US/Canada users)"
    echo "    [2] Europe"
    echo "    [3] South America"
    echo "    [4] Africa"
    echo "    [5] Asia"
    echo "    [6] World (all regions, requires >50 GB)"
    echo "    [7] Skip maps"
    echo ""
    ask "Select region [1]: "
    read -r r
    case "${r:-1}" in
        1) CHOSEN_MAP_REGION="north-america" ;;
        2) CHOSEN_MAP_REGION="europe" ;;
        3) CHOSEN_MAP_REGION="south-america" ;;
        4) CHOSEN_MAP_REGION="africa" ;;
        5) CHOSEN_MAP_REGION="asia" ;;
        6) CHOSEN_MAP_REGION="world" ;;
        7) CHOSEN_MAP_REGION="none" ;;
        *) CHOSEN_MAP_REGION="north-america" ;;
    esac
    ok "Map region: ${CHOSEN_MAP_REGION}"
}

# ── Screen: Summary + confirm ─────────────────────────────────────────────────
confirm_install() {
    header "Installation Summary"
    echo ""

    local ram_mb
    ram_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
    local ai_model
    if (( ram_mb >= 14336 )); then ai_model="gemma4:12b  (1-3 tok/s, highest quality)"
    elif (( ram_mb >= 6144 )); then ai_model="gemma4:e4b  (3-5 tok/s)"
    else                            ai_model="gemma4:e2b  (8-12 tok/s)"
    fi

    if [[ "$CHOSEN_DEV" == "SKIP" ]]; then
        info "Storage:     ${CHOSEN_MOUNT}  (already mounted)"
    elif [[ "$FORMAT_DRIVE" == "true" ]]; then
        info "Storage:     /dev/${CHOSEN_DEV} → ${CHOSEN_MOUNT}  (will format as ext4)"
    else
        info "Storage:     /dev/${CHOSEN_DEV} → ${CHOSEN_MOUNT}  (existing data kept)"
    fi
    info "Hostname:    ${CHOSEN_HOSTNAME}  (http://${CHOSEN_HOSTNAME}.local:8080)"
    info "AI model:    ${ai_model}"
    info "Maps:        ${CHOSEN_MAP_REGION}"
    info "Repo:        ${REPO_DIR}"
    echo ""
    info "Content download (Wikipedia, videos, books) runs separately after install."
    info "Estimated install time: 15-30 minutes."
    echo ""
    ask "Proceed with installation? [y/N]: "
    read -r ans
    [[ "${ans:-n}" =~ ^[Yy]$ ]] || { echo ""; info "Aborted."; exit 0; }
}

# ── Storage setup: format + mount ─────────────────────────────────────────────
setup_drive() {
    [[ "$CHOSEN_DEV" == "SKIP" ]] && return

    info "Setting up /dev/${CHOSEN_DEV} → ${CHOSEN_MOUNT}..."

    if [[ "$FORMAT_DRIVE" == "true" ]]; then
        info "Formatting /dev/${CHOSEN_DEV} as ext4..."
        # Wipe partition table, create new GPT + single ext4 partition
        sgdisk --zap-all "/dev/${CHOSEN_DEV}" 2>/dev/null \
            || wipefs -a "/dev/${CHOSEN_DEV}"
        parted -s "/dev/${CHOSEN_DEV}" mklabel gpt
        parted -s "/dev/${CHOSEN_DEV}" mkpart primary ext4 0% 100%
        sleep 1
        # Partition name is usually /dev/sda1 or /dev/sda1 depending on type
        local part
        part=$(lsblk -n -o NAME "/dev/${CHOSEN_DEV}" | tail -1 | xargs)
        part="/dev/${part}"
        mkfs.ext4 -F -L survive "$part"
        CHOSEN_PART="$part"
    else
        # Use first partition, or the raw device if no partitions
        local part
        part=$(lsblk -n -o NAME "/dev/${CHOSEN_DEV}" | tail -1 | xargs)
        CHOSEN_PART="/dev/${part}"
    fi

    mkdir -p "${CHOSEN_MOUNT}"

    # Add to /etc/fstab if not already there
    local uuid
    uuid=$(blkid -s UUID -o value "${CHOSEN_PART}" 2>/dev/null || echo "")
    if [[ -n "$uuid" ]]; then
        if ! grep -q "$uuid" /etc/fstab 2>/dev/null; then
            echo "UUID=${uuid}  ${CHOSEN_MOUNT}  ext4  defaults,noatime  0  2" >> /etc/fstab
            ok "Added to /etc/fstab (auto-mount on boot)"
        fi
        mount -a 2>/dev/null || mount "${CHOSEN_PART}" "${CHOSEN_MOUNT}"
    else
        mount "${CHOSEN_PART}" "${CHOSEN_MOUNT}"
    fi

    ok "Drive mounted at ${CHOSEN_MOUNT}"
}

# ── Update hostname ────────────────────────────────────────────────────────────
setup_hostname() {
    local current
    current=$(hostname 2>/dev/null || echo "")
    [[ "$current" == "$CHOSEN_HOSTNAME" ]] && return

    info "Setting hostname to ${CHOSEN_HOSTNAME}..."
    echo "${CHOSEN_HOSTNAME}" > /etc/hostname
    # Update /etc/hosts
    sed -i "s/127\.0\.1\.1.*/127.0.1.1\t${CHOSEN_HOSTNAME}/" /etc/hosts
    hostname "${CHOSEN_HOSTNAME}"
    ok "Hostname set (takes effect on reboot)"
}

# ── Write config/survive.conf ─────────────────────────────────────────────────
write_config() {
    info "Writing ${CONF}..."
    local ram_mb
    ram_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
    local ai_model="survive"   # always the custom survive model

    # Keep existing config values if file exists; only overwrite what we set
    # Here we regenerate from scratch with wizard values + preserved extras.
    cat > "$CONF" << CONF
# SurviveV1 Configuration
# Generated by: bash install/wizard.sh

# ── Storage ────────────────────────────────────────────────────────────────────
SURVIVE_STORAGE_PATH="${CHOSEN_MOUNT}"
SURVIVE_STORAGE_DEV="${CHOSEN_DEV:-SKIP}"
SURVIVE_BUDGET_GB="800"
SURVIVE_HOSTNAME="${CHOSEN_HOSTNAME}"

# ── Content flags (Y=download, N=skip) ────────────────────────────────────────
CONTENT_WIKIPEDIA="Y"
CONTENT_WIKIPEDIA_NOPIC="N"
CONTENT_WIKIBOOKS="Y"
CONTENT_STACKEXCHANGE="Y"
CONTENT_GUTENBERG="Y"
CONTENT_KOLIBRI="Y"
CONTENT_VIDEOS="Y"
CONTENT_MAPS="${CHOSEN_MAP_REGION_FLAG:-Y}"
CONTENT_PDFS="Y"
CONTENT_AI_MODELS="Y"
CONTENT_IFIX="Y"

# ── Video quality (480, 720, 1080) ─────────────────────────────────────────────
VIDEO_QUALITY="720"

# ── AI ─────────────────────────────────────────────────────────────────────────
SURVIVE_AI_MODEL="${ai_model}"

# ── Map region ─────────────────────────────────────────────────────────────────
MAP_REGION="${CHOSEN_MAP_REGION}"

# ── Cloud sync ─────────────────────────────────────────────────────────────────
SURVIVE_CLOUD_REMOTE="gdrive"
SURVIVE_CLOUD_PATH="SurviveV1"

# ── Hailo AI Hat ───────────────────────────────────────────────────────────────
# Hailo-8L is vision-only; it cannot accelerate Ollama LLMs.
SKIP_AI_HAT="true"

# ── Bandwidth limiting (bytes/s; 0 = unlimited) ────────────────────────────────
SURVIVE_BANDWIDTH_LIMIT="0"

# ── Web server timeouts (seconds) ──────────────────────────────────────────────
SURVIVE_SERVICE_CHECK_TIMEOUT="1"
SURVIVE_OLLAMA_LIST_TIMEOUT="2"
SURVIVE_AI_CHAT_TIMEOUT="60"
CONF

    # Disable maps content flag if user skipped maps
    if [[ "${CHOSEN_MAP_REGION}" == "none" ]]; then
        sed -i 's/^CONTENT_MAPS="Y"/CONTENT_MAPS="N"/' "$CONF"
    fi

    ok "Config written to ${CONF}"
}

# ── Run pre-flight check ──────────────────────────────────────────────────────
run_preflight() {
    header "Pre-flight Check"
    echo ""
    SURVIVE_STORAGE_PATH="${CHOSEN_MOUNT}" bash "${REPO_DIR}/setup/pre_flight_check.sh" || {
        echo ""
        warn "Some pre-flight checks failed (see above)."
        ask "Continue anyway? [y/N]: "
        read -r ans
        [[ "${ans:-n}" =~ ^[Yy]$ ]] || { info "Aborted."; exit 1; }
    }
}

# ── Run main installer ─────────────────────────────────────────────────────────
run_installer() {
    header "Installing"
    echo ""
    info "Running setup/install.sh — this takes 15-30 minutes..."
    info "Full log: /var/log/survive_install.log"
    echo ""
    SURVIVE_STORAGE_PATH="${CHOSEN_MOUNT}" \
        bash "${REPO_DIR}/setup/install.sh"
}

# ── AI model setup ─────────────────────────────────────────────────────────────
run_ai_setup() {
    header "AI Model Setup"
    echo ""
    info "Pulling AI models for your ${ram_mb:-0} MB Pi..."
    info "This downloads 1.5-8 GB depending on your RAM tier."
    info "(You can skip this and run it later with: bash ai/setup_ollama.sh)"
    echo ""
    ask "Set up AI models now? [Y/n]: "
    read -r ans
    if [[ "${ans:-y}" =~ ^[Yy]$ ]]; then
        bash "${REPO_DIR}/ai/setup_ollama.sh" setup || warn "AI setup failed — run manually later"
    else
        info "Skipped. Run later with: bash ${REPO_DIR}/ai/setup_ollama.sh setup"
    fi
}

# ── Success screen ────────────────────────────────────────────────────────────
show_success() {
    echo ""
    echo -e "${BOLD}${GREEN}"
    echo "  ╔══════════════════════════════════════════╗"
    echo "  ║     SurviveV1 Installation Complete!    ║"
    echo "  ╚══════════════════════════════════════════╝"
    echo -e "${NC}"
    local ip
    ip=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "<your-pi-ip>")
    ok "Dashboard:    http://${CHOSEN_HOSTNAME}.local:8080"
    ok "By IP:        http://${ip}:8080"
    ok "AI Assistant: http://${CHOSEN_HOSTNAME}.local:8080/ai"
    echo ""
    info "Next steps:"
    echo ""
    echo "    1. Download content (Wikipedia, books, videos):"
    echo "       bash ${REPO_DIR}/download/download_all.sh"
    echo ""
    echo "    2. Start/stop services:"
    echo "       bash ${REPO_DIR}/scripts/start_services.sh"
    echo "       bash ${REPO_DIR}/scripts/stop_services.sh"
    echo ""
    echo "    3. Check service status:"
    echo "       bash ${REPO_DIR}/scripts/status.sh"
    echo ""
    echo -e "  ${DIM}If survive.local doesn't resolve on Windows, use the IP address above.${NC}"
    echo ""
}

# ── Require root ──────────────────────────────────────────────────────────────
require_root() {
    if [[ $EUID -ne 0 ]]; then
        die "This wizard must be run as root.\n\n  Re-run with: sudo bash $0"
    fi
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    require_root

    show_welcome
    choose_storage
    confirm_format
    choose_hostname
    choose_map_region
    confirm_install

    header "Setup"
    setup_drive
    setup_hostname
    write_config

    run_preflight
    run_installer

    local ram_mb
    ram_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
    run_ai_setup

    show_success
}

main "$@"
