#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Power management for off-grid operation
# Reduces Pi 5 power consumption from ~9W to ~3-4W
# Usage: bash scripts/power_save.sh [--enable | --disable | --status]
# =============================================================================
set -euo pipefail

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${BLUE}[POWER]${NC} $*"; }
success() { echo -e "${GREEN}[POWER]${NC} $*"; }
warn()    { echo -e "${YELLOW}[POWER]${NC} $*"; }

MODE="${1:---status}"

enable_power_save() {
    info "Enabling power-saving mode..."

    # Disable HDMI output (~0.5W savings)
    if command -v tvservice &>/dev/null; then
        tvservice -o 2>/dev/null && success "HDMI disabled" || warn "Could not disable HDMI"
    elif [[ -f /usr/bin/kmsprint ]]; then
        # Pi 5 uses KMS, not tvservice
        info "Pi 5 KMS detected — disable HDMI via /boot/firmware/config.txt if persistent"
    fi

    # Set CPU governor to powersave (~1-2W savings)
    if command -v cpufreq-set &>/dev/null; then
        for cpu in /sys/devices/system/cpu/cpu[0-3]; do
            cpufreq-set -c "$(basename "$cpu" | tr -dc '0-9')" -g powersave 2>/dev/null || true
        done
        success "CPU governor set to powersave"
    elif [[ -d /sys/devices/system/cpu/cpu0/cpufreq ]]; then
        for gov in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
            echo "powersave" > "$gov" 2>/dev/null || true
        done
        success "CPU governor set to powersave"
    fi

    # Disable onboard LEDs (~minimal but helps with stealth)
    for led in /sys/class/leds/led[01]; do
        if [[ -d "$led" ]]; then
            echo 0 > "$led/brightness" 2>/dev/null || true
            echo none > "$led/trigger" 2>/dev/null || true
        fi
    done
    success "LEDs disabled"

    # Disable WiFi if not serving network clients
    if [[ "${SURVIVE_DISABLE_WIFI:-false}" == "true" ]]; then
        rfkill block wifi 2>/dev/null && success "WiFi disabled" || true
    fi

    # Disable Bluetooth (rarely needed for survival server)
    rfkill block bluetooth 2>/dev/null && success "Bluetooth disabled" || true

    success "Power-saving mode enabled"
    show_status
}

disable_power_save() {
    info "Restoring full performance mode..."

    # Re-enable HDMI
    if command -v tvservice &>/dev/null; then
        tvservice -p 2>/dev/null || true
    fi

    # Set CPU governor to ondemand
    for gov in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
        echo "ondemand" > "$gov" 2>/dev/null || true
    done

    # Re-enable LEDs
    for led in /sys/class/leds/led[01]; do
        echo 255 > "$led/brightness" 2>/dev/null || true
    done

    # Re-enable radios
    rfkill unblock wifi 2>/dev/null || true
    rfkill unblock bluetooth 2>/dev/null || true

    success "Full performance mode restored"
    show_status
}

show_status() {
    echo ""
    info "=== Power Status ==="

    # Temperature
    local temp="N/A"
    if command -v vcgencmd &>/dev/null; then
        temp=$(vcgencmd measure_temp 2>/dev/null | cut -d= -f2)
    elif [[ -f /sys/thermal/thermal_zone0/temp ]]; then
        temp="$(awk '{printf "%.1f'\''C", $1/1000}' /sys/thermal/thermal_zone0/temp 2>/dev/null)"
    fi
    info "Temperature: $temp"

    # Throttle status
    if command -v vcgencmd &>/dev/null; then
        local throttled
        throttled=$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2)
        if [[ "$throttled" == "0x0" ]]; then
            success "Throttle: none (healthy)"
        else
            warn "Throttle: $throttled (check power supply)"
        fi
    fi

    # CPU governor
    local gov="N/A"
    [[ -f /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor ]] && \
        gov=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null)
    info "CPU governor: $gov"

    # Estimated runtime
    info ""
    info "Estimated battery life (20,000 mAh @ 5V = 100 Wh):"
    info "  Full load (~9W):       ~11 hours"
    info "  Power-save (~3-4W):    ~25-33 hours"
    info "  Idle, no display (~2W): ~50 hours"
}

case "$MODE" in
    --enable|-e)   enable_power_save ;;
    --disable|-d)  disable_power_save ;;
    --status|-s)   show_status ;;
    *)
        echo "Usage: bash scripts/power_save.sh [--enable | --disable | --status]"
        echo ""
        echo "  --enable   Reduce power consumption for battery operation"
        echo "  --disable  Restore full performance"
        echo "  --status   Show current power state"
        ;;
esac
