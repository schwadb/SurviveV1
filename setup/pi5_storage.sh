#!/usr/bin/env bash
# =============================================================================
# SurviveV1 - Raspberry Pi 5 USB SSD stability
# - Enables full USB current delivery (needed for bus-powered SSDs)
# - Offers UAS quirks fallback for buggy USB-SATA/NVMe enclosures
# - Sets up fstrim.timer with a udev allowlist so TRIM passthrough works
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[PI5-STORAGE]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

require_root() { [[ $EUID -eq 0 ]] || { error "Run with sudo"; exit 1; }; }

# Pi 5 caps USB at 600 mA by default unless the official 27 W USB-C PD PSU is
# used. Without this, bus-powered SSDs brown out under heavy I/O and remount
# read-only, which can corrupt the content library.
enable_usb_max_current() {
    local cfg=/boot/firmware/config.txt
    [[ -f "$cfg" ]] || cfg=/boot/config.txt
    if [[ ! -f "$cfg" ]]; then
        warn "No Pi config.txt found; skipping usb_max_current_enable"
        return
    fi
    if grep -q '^usb_max_current_enable=1' "$cfg"; then
        success "usb_max_current_enable=1 already set in $cfg"
        return
    fi
    info "Appending usb_max_current_enable=1 to $cfg (reboot required)"
    printf '\n# SurviveV1: allow >600 mA to USB peripherals (requires 27 W PSU)\nusb_max_current_enable=1\n' >> "$cfg"
    warn "Reboot required for USB current change to take effect."
}

# Some USB-SATA/NVMe enclosures have buggy UAS firmware. If UAS errors show
# up in dmesg, fall back to plain USB mass-storage (still USB 3.0 speed).
offer_uas_quirks() {
    if dmesg 2>/dev/null | grep -qi 'uas.*abort\|uas.*reset\|xhci.*link.*down'; then
        warn "UAS errors detected in dmesg. Consider forcing USB mass-storage mode."
        local id
        id=$(lsusb | awk -F'ID |[[:space:]]+' '/Mass Storage|ASMedia|JMicron|Realtek/ {for(i=1;i<=NF;i++) if($i~/^[0-9a-f]{4}:[0-9a-f]{4}$/) {print $i; exit}}')
        if [[ -n "$id" ]]; then
            warn "Suggested: add 'usb-storage.quirks=${id}:u' to /boot/firmware/cmdline.txt"
            warn "Only apply if you actually see UAS-related I/O errors."
        fi
    else
        success "No UAS errors detected in dmesg"
    fi
}

# TRIM keeps SSD write performance from degrading as the drive fills toward
# 800 GB. The udev rule whitelists the adapter; the timer runs TRIM weekly.
# WARNING: a small number of USB-SATA adapters claim TRIM support but CORRUPT
# data. Back up before enabling if you are unsure about your adapter.
setup_fstrim() {
    info "Configuring fstrim.timer..."
    if systemctl list-unit-files | grep -q '^fstrim.timer'; then
        systemctl enable --now fstrim.timer
        success "fstrim.timer enabled"
    else
        warn "fstrim.timer unit not present; install util-linux to get it"
        return
    fi

    # Detect the USB device holding /mnt/survive and emit a udev rule.
    local storage_path="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
    local src
    src=$(findmnt -no SOURCE "$storage_path" 2>/dev/null || true)
    if [[ -z "$src" ]]; then
        warn "Storage not mounted at $storage_path; skipping TRIM allowlist"
        return
    fi
    local disk
    disk=$(lsblk -no PKNAME "$src" 2>/dev/null | head -1)
    [[ -z "$disk" ]] && disk=$(basename "$src" | sed 's/[0-9]*$//')
    local vpd_path="/sys/block/${disk}/device/../../idVendor"
    local pid_path="/sys/block/${disk}/device/../../idProduct"
    if [[ -r "$vpd_path" && -r "$pid_path" ]]; then
        local vendor product
        vendor=$(<"$vpd_path"); product=$(<"$pid_path")
        local rule=/etc/udev/rules.d/10-trim.rules
        cat > "$rule" <<EOF
# SurviveV1: allow TRIM passthrough on the USB SSD hosting /mnt/survive.
# WARNING: some adapters corrupt data on TRIM. Verify before relying on this.
ACTION=="add|change", ATTRS{idVendor}=="$vendor", ATTRS{idProduct}=="$product", \\
  SUBSYSTEM=="scsi_disk", ATTR{provisioning_mode}="unmap"
EOF
        udevadm control --reload
        udevadm trigger
        success "TRIM udev rule installed for $vendor:$product"
    else
        warn "Could not detect USB vendor/product for $disk; skipping TRIM rule"
    fi
}

main() {
    require_root
    enable_usb_max_current
    offer_uas_quirks
    setup_fstrim
    info "Pi 5 storage hardening complete."
}

main "$@"
