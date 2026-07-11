#!/usr/bin/env bash
# SurviveV1 — Stop all services

BLUE='\033[0;34m'; GREEN='\033[0;32m'; NC='\033[0m'
info()    { echo -e "${BLUE}[STOP]${NC} $*"; }
success() { echo -e "${GREEN}[STOP]${NC} $*"; }

stop_service() {
    local name="$1"
    local unit="${2:-}"
    local pidfile="/tmp/${name}.pid"

    if [[ -n "$unit" ]] && command -v systemctl &>/dev/null; then
        if systemctl is-active "$unit" &>/dev/null; then
            systemctl stop "$unit" && success "$name stopped (systemd)" && return 0
        fi
    fi

    if [[ -f "$pidfile" ]]; then
        local PID
        PID=$(cat "$pidfile")
        if kill -0 "$PID" 2>/dev/null; then
            kill "$PID" && success "$name stopped (PID $PID)"
        fi
        rm -f "$pidfile"
    fi
}

info "Stopping SurviveV1 services..."
stop_service "survive_dashboard" "survive-dashboard"
stop_service "kiwix"             "survive-kiwix"
stop_service "ollama"            "survive-ollama"
stop_service "martin"            "survive-maps"
stop_service "calibre"           "survive-calibre"
stop_service "kolibri"           "survive-kolibri"
systemctl stop jellyfin 2>/dev/null && success "Jellyfin stopped" || true
success "All services stopped"
