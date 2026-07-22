#!/usr/bin/env bash
# SurviveV1 — Stop all services
set -uo pipefail

BLUE='\033[0;34m'; GREEN='\033[0;32m'; NC='\033[0m'
info()    { echo -e "${BLUE}[STOP]${NC} $*"; }
success() { echo -e "${GREEN}[STOP]${NC} $*"; }

# Detect systemd availability (same logic as start_services.sh).
USE_SYSTEMD=false
[[ $EUID -eq 0 ]] && USE_SYSTEMD=true
command -v systemctl &>/dev/null && systemctl list-units &>/dev/null && USE_SYSTEMD=true

# stop_service NAME PIDFILE UNIT
# Prefer a managed systemd stop, then the recorded PID, then a narrowly scoped
# pkill fallback. The broad `pkill -f "$name"` used previously could match
# unrelated processes (e.g. an editor with a matching file open), so the
# fallback pattern is anchored to a full binary invocation instead.
stop_service() {
    local name="$1" pidfile="$2" unit="${3:-}"

    if [[ "$USE_SYSTEMD" == "true" && -n "$unit" ]] && systemctl is-active --quiet "$unit" 2>/dev/null; then
        systemctl stop "$unit" && { success "$name stopped (systemd)"; return; }
    fi

    if [[ -f "$pidfile" ]]; then
        local pid
        pid=$(cat "$pidfile")
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            kill "$pid" && success "$name stopped" || info "$name already stopped"
        fi
        rm -f "$pidfile"
        return
    fi

    # Fallback: match the recorded process pattern only (never a bare substring).
    if [[ -n "${4:-}" ]]; then
        pkill -f "$4" 2>/dev/null && success "$name stopped" || true
    fi
}

info "Stopping SurviveV1 services..."
stop_service "Dashboard"   "/tmp/survive_dashboard.pid" "survive-dashboard" "python3 server.py"
stop_service "Kiwix"       "/tmp/kiwix.pid"             "kiwix"             "kiwix-serve --library"
stop_service "Ollama"      "/tmp/ollama.pid"            "ollama"            "ollama serve"
stop_service "Maps"        "/tmp/martin.pid"            "martin-tiles"      "martin --config"
stop_service "Calibre-Web" "/tmp/calibre.pid"           "calibre-web"       "cps -p 8083"
stop_service "Kolibri"     "/tmp/kolibri.pid"           "kolibri"           "kolibri start"
if [[ "$USE_SYSTEMD" == "true" ]]; then
    systemctl stop jellyfin 2>/dev/null && success "Jellyfin stopped" || true
fi
success "All services stopped"
