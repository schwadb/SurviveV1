#!/usr/bin/env bash
# SurviveV1 — Stop all services

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${BLUE}[STOP]${NC} $*"; }
success() { echo -e "${GREEN}[STOP]${NC} $*"; }
warn()    { echo -e "${YELLOW}[STOP]${NC} $*"; }

USE_SYSTEMD=false
command -v systemctl &>/dev/null && systemctl list-units &>/dev/null 2>&1 && USE_SYSTEMD=true

stop_service() {
    local name="$1"
    local unit="${2:-}"
    local pidfile="/tmp/${name}.pid"

    if [[ "$USE_SYSTEMD" == "true" ]] && [[ -n "$unit" ]]; then
        if systemctl is-active "$unit" &>/dev/null; then
            systemctl stop "$unit" && success "$name stopped (systemd)" && return 0
        fi
    fi

    if [[ -f "$pidfile" ]]; then
        local pid
        pid=$(cat "$pidfile")
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" && success "$name stopped (PID $pid)" || warn "$name: kill failed"
        fi
        rm -f "$pidfile"
    else
        warn "$name: no pidfile and no systemd unit active"
    fi
}

info "Stopping SurviveV1 services..."
stop_service "survive_dashboard" "survive-dashboard.service"
stop_service "kiwix"             "kiwix.service"
stop_service "ollama"            "ollama.service"
stop_service "martin"            "martin-tiles.service"
stop_service "kolibri"           "kolibri.service"
stop_service "jellyfin"          "jellyfin.service"
success "All services stopped"
