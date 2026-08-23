#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Grid-down Wi-Fi hotspot mode
#
# Turns the Pi into its own Wi-Fi access point so phones/laptops can reach the
# knowledge base with NO router or grid power — the exact scenario this device
# exists for. Uses NetworkManager (Raspberry Pi OS Bookworm default).
#
#   sudo bash scripts/hotspot.sh enable    # start AP  (SSID from survive.conf)
#   sudo bash scripts/hotspot.sh disable   # back to normal Wi-Fi client mode
#        bash scripts/hotspot.sh status    # AP state + connected client count
#
# While the AP is active the dashboard lives at http://10.42.0.1:8080
# (NetworkManager 'shared' mode always assigns the Pi 10.42.0.1).
# The connection is created with autoconnect=no ON PURPOSE: a reboot returns
# the Pi to normal Wi-Fi — a dead-man switch against locking yourself out of a
# headless box. To make AP mode persistent across reboots (an informed choice):
#   sudo nmcli connection modify survive-hotspot connection.autoconnect yes
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
[[ -f "$_CONF" ]] || _CONF="${_CONF}.example"   # fall back to shipped defaults
# Env overrides win over the conf's baked-in values (same pattern as
# build_ebook_library.sh).
_ENV_SSID="${SURVIVE_HOTSPOT_SSID:-}"
_ENV_PASS="${SURVIVE_HOTSPOT_PASS:-}"
if [[ -f "$_CONF" ]]; then source "$_CONF"; fi
SSID="${_ENV_SSID:-${SURVIVE_HOTSPOT_SSID:-SurviveV1}}"
PASS="${_ENV_PASS:-${SURVIVE_HOTSPOT_PASS:-survive2026}}"

CON_NAME="survive-hotspot"
ACTION="${1:-status}"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${BLUE}[HOTSPOT]${NC} $*"; }
success() { echo -e "${GREEN}[HOTSPOT]${NC} $*"; }
warn()    { echo -e "${YELLOW}[HOTSPOT]${NC} $*"; }
error()   { echo -e "${RED}[HOTSPOT]${NC} $*" >&2; }

# status must work (exit 0) even on NetworkManager-less boxes — it is called
# from other scripts under `set -e`.
if ! command -v nmcli &>/dev/null; then
    if [[ "$ACTION" == "status" ]]; then
        info "NetworkManager not available — hotspot mode unsupported on this system"
        exit 0
    fi
    error "NetworkManager (nmcli) is required — it is the default on Raspberry Pi OS"
    error "Bookworm. Older dhcpcd-based systems are not supported."
    exit 1
fi

hotspot_active() {
    nmcli -t -f NAME connection show --active 2>/dev/null | grep -qx "$CON_NAME"
}

# NetworkManager's shared mode runs a DHCP+DNS server (dnsmasq) on wlan0, but
# ufw denies incoming by default and silently drops the client's DHCP request
# — the phone then shows "IP configuration error" / "Failed to obtain IP
# address". Open DHCP (67/udp) and DNS (53) plus the dashboard on the AP
# interface only, so the normal network's rules are untouched.
AP_IFACE="wlan0"
firewall_open_ap() {
    command -v ufw &>/dev/null || return 0
    ufw status 2>/dev/null | grep -q "^Status: active" || return 0
    info "Opening DHCP/DNS/dashboard on $AP_IFACE for hotspot clients..."
    ufw allow in on "$AP_IFACE" to any port 67 proto udp >/dev/null 2>&1 || true
    ufw allow in on "$AP_IFACE" to any port 53           >/dev/null 2>&1 || true
    ufw allow in on "$AP_IFACE" to any port 8080 proto tcp >/dev/null 2>&1 || true
    ufw reload >/dev/null 2>&1 || true
}
firewall_close_ap() {
    command -v ufw &>/dev/null || return 0
    ufw status 2>/dev/null | grep -q "^Status: active" || return 0
    ufw delete allow in on "$AP_IFACE" to any port 67 proto udp   >/dev/null 2>&1 || true
    ufw delete allow in on "$AP_IFACE" to any port 53             >/dev/null 2>&1 || true
    ufw delete allow in on "$AP_IFACE" to any port 8080 proto tcp >/dev/null 2>&1 || true
    ufw reload >/dev/null 2>&1 || true
}

case "$ACTION" in
    enable)
        [[ $EUID -eq 0 ]] || { error "run with sudo: sudo bash scripts/hotspot.sh enable"; exit 1; }

        # WPA-PSK requires 8-63 characters; nmcli's own error is cryptic.
        if (( ${#PASS} < 8 || ${#PASS} > 63 )); then
            error "Hotspot password must be 8-63 characters (got ${#PASS})."
            error "Set SURVIVE_HOTSPOT_PASS in config/survive.conf"
            exit 1
        fi

        # Wi-Fi country unset → AP channel selection can fail silently.
        if command -v iw &>/dev/null && iw reg get 2>/dev/null | grep -q "country 00"; then
            warn "Wi-Fi country is unset — if the AP fails to start, run:"
            warn "  sudo raspi-config nonint do_wifi_country US   (or your country)"
        fi

        # Enabling the AP tears down any wlan0 client connection — if this
        # session came in over that Wi-Fi, it will drop. Require confirmation.
        WIFI_ACTIVE=$(nmcli -t -f NAME,TYPE,DEVICE connection show --active 2>/dev/null \
            | awk -F: '$2 == "802-11-wireless" && $3 == "wlan0" {print $1}' || true)
        if [[ -n "${SSH_CONNECTION:-}" ]] && [[ -n "$WIFI_ACTIVE" ]] && [[ "${2:-}" != "--force" ]]; then
            warn "You appear to be connected over SSH while wlan0 is a Wi-Fi client"
            warn "(network: $WIFI_ACTIVE). Enabling the hotspot WILL DROP that link."
            warn "If you lose access: plug in Ethernet, or power-cycle — the hotspot"
            warn "does not auto-start on boot."
            echo -en "  ${YELLOW}Type 'yes' to continue:${NC} "
            read -r CONFIRM
            [[ "$CONFIRM" == "yes" ]] || { info "aborted"; exit 1; }
        fi

        rfkill unblock wifi 2>/dev/null || true
        nmcli radio wifi on

        info "Creating access point '$SSID' on wlan0..."
        nmcli connection delete "$CON_NAME" 2>/dev/null || true
        # band bg = 2.4 GHz: works in every regulatory domain, every phone
        # supports it, and it penetrates walls — the right disaster trade-off.
        # ipv4.method shared = NM runs DHCP+NAT; the Pi is always 10.42.0.1.
        nmcli connection add type wifi ifname wlan0 con-name "$CON_NAME" \
            autoconnect no ssid "$SSID" \
            802-11-wireless.mode ap 802-11-wireless.band bg \
            ipv4.method shared ipv6.method disabled \
            wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$PASS" >/dev/null
        nmcli connection up "$CON_NAME" >/dev/null
        firewall_open_ap

        HOSTNAME_LABEL="${SURVIVE_HOTSPOT_SSID:-$SSID}"
        echo ""
        echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║        Grid-Down Hotspot ACTIVE              ║${NC}"
        echo -e "${GREEN}╠══════════════════════════════════════════════╣${NC}"
        echo -e "${GREEN}║${NC} Wi-Fi network:  ${HOSTNAME_LABEL}"
        echo -e "${GREEN}║${NC} Password:       ${PASS}"
        echo -e "${GREEN}║${NC} Dashboard:      http://10.42.0.1:8080"
        echo -e "${GREEN}║${NC}                 http://${SURVIVE_HOSTNAME:-survive}.local:8080"
        echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
        echo ""
        info "Disable with: sudo bash scripts/hotspot.sh disable"
        info "A reboot also returns the Pi to normal Wi-Fi (dead-man switch)."
        ;;

    disable)
        [[ $EUID -eq 0 ]] || { error "run with sudo: sudo bash scripts/hotspot.sh disable"; exit 1; }
        if hotspot_active; then
            nmcli connection down "$CON_NAME" >/dev/null 2>&1 || true
        fi
        nmcli connection delete "$CON_NAME" >/dev/null 2>&1 || true
        firewall_close_ap
        success "Hotspot disabled — rejoining known Wi-Fi networks (if any)"
        ;;

    status)
        if hotspot_active; then
            CLIENTS=$(iw dev wlan0 station dump 2>/dev/null | grep -c "^Station" || true)
            success "Hotspot ACTIVE — SSID '$SSID', dashboard at http://10.42.0.1:8080"
            info "Connected clients: ${CLIENTS:-0}"
        else
            info "Hotspot inactive (normal Wi-Fi client mode)"
            info "Enable with: sudo bash scripts/hotspot.sh enable"
        fi
        ;;

    *)
        error "Usage: bash scripts/hotspot.sh {enable|disable|status}"
        exit 1
        ;;
esac
