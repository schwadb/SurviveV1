#!/usr/bin/env bash
# SurviveV1 — Stop all services

BLUE='\033[0;34m'; GREEN='\033[0;32m'; NC='\033[0m'
info()    { echo -e "${BLUE}[STOP]${NC} $*"; }
success() { echo -e "${GREEN}[STOP]${NC} $*"; }

stop_pid() {
    local name="$1"
    local pidfile="/tmp/${name}.pid"
    if [[ -f "$pidfile" ]]; then
        PID=$(cat "$pidfile")
        if kill -0 "$PID" 2>/dev/null; then
            kill "$PID" && success "$name stopped" || info "$name already stopped"
        fi
        rm -f "$pidfile"
    else
        # Try by process name
        pkill -f "$name" 2>/dev/null && success "$name stopped" || true
    fi
}

info "Stopping SurviveV1 services..."
stop_pid "survive_dashboard"
stop_pid "kiwix"
stop_pid "ollama"
stop_pid "martin"
stop_pid "calibre"
pkill -f "kolibri start" 2>/dev/null && success "Kolibri stopped" || true
systemctl stop jellyfin 2>/dev/null && success "Jellyfin stopped" || true
success "All services stopped"
