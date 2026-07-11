#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Start all services
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF -- using defaults" >&2; else source "$_CONF"; fi

STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${BLUE}[START]${NC} $*"; }
success() { echo -e "${GREEN}[START]${NC} $*"; }
warn()    { echo -e "${YELLOW}[START]${NC} $*"; }
error()   { echo -e "${RED}[START]${NC} $*" >&2; }

preflight_check() {
    # Verify storage is mounted and has at least 100MB free
    if ! mountpoint -q "$STORAGE_PATH" 2>/dev/null; then
        if [[ "$STORAGE_PATH" != "/mnt/survive" ]]; then
            info "Storage at $STORAGE_PATH is not a separate mount — continuing"
        else
            warn "Storage drive not mounted at $STORAGE_PATH"
            warn "Some services may not start correctly. Mount your drive first:"
            warn "  sudo mount /dev/sda1 /mnt/survive"
        fi
    fi

    local free_kb
    free_kb=$(df -k "$STORAGE_PATH" 2>/dev/null | tail -1 | awk '{print $4}') || free_kb=0
    if [[ "$free_kb" -lt 102400 ]]; then
        warn "Less than 100MB free on $STORAGE_PATH — services may fail to write logs"
    fi
}

# Detect if running as root (systemctl) or user (direct)
USE_SYSTEMD=false
[[ $EUID -eq 0 ]] && USE_SYSTEMD=true
command -v systemctl &>/dev/null && systemctl list-units &>/dev/null && USE_SYSTEMD=true

start_service() {
    local name="$1"
    local unit="${2:-$1}"
    local desc="${3:-$name}"

    if [[ "$USE_SYSTEMD" == "true" ]]; then
        if systemctl is-enabled "$unit" &>/dev/null; then
            systemctl start "$unit" && success "$desc started" || warn "$desc failed to start"
        else
            warn "$unit not installed as systemd service — starting manually"
            start_manual "$name"
        fi
    else
        start_manual "$name"
    fi
}

start_manual() {
    local name="$1"
    case "$name" in
        dashboard)
            info "Starting dashboard on :8080..."
            source /opt/survive/venv/bin/activate 2>/dev/null || true
            cd "$REPO_DIR/web"
            PORT=8080 nohup python3 server.py > /tmp/survive_dashboard.log 2>&1 &
            echo $! > /tmp/survive_dashboard.pid
            success "Dashboard started (PID $(cat /tmp/survive_dashboard.pid))"
            ;;
        kiwix)
            KIWIX_LIB="$STORAGE_PATH/.kiwix_library.xml"
            if [[ ! -f "$KIWIX_LIB" ]]; then
                warn "Kiwix library not found — run download scripts first"
                return
            fi
            info "Starting Kiwix on :8081..."
            nohup kiwix-serve \
                --library "$KIWIX_LIB" \
                --port 8081 \
                --address 0.0.0.0 \
                > /tmp/kiwix.log 2>&1 &
            echo $! > /tmp/kiwix.pid
            success "Kiwix started (PID $(cat /tmp/kiwix.pid))"
            ;;
        ollama)
            info "Starting Ollama on :11434..."
            OLLAMA_MODELS="$STORAGE_PATH/ai_models/ollama" \
            nohup ollama serve > /tmp/ollama.log 2>&1 &
            echo $! > /tmp/ollama.pid
            success "Ollama started (PID $(cat /tmp/ollama.pid))"
            ;;
        maps)
            MARTIN_CONF="$STORAGE_PATH/maps/martin_config.yaml"
            if [[ ! -f "$MARTIN_CONF" ]]; then
                warn "Map config not found — run download/maps.sh first"
                return
            fi
            if command -v martin &>/dev/null; then
                info "Starting Martin tile server on :3000..."
                nohup martin --config "$MARTIN_CONF" --listen-addresses 0.0.0.0:3000 \
                    > /tmp/martin.log 2>&1 &
                echo $! > /tmp/martin.pid
                success "Maps started (PID $(cat /tmp/martin.pid))"
            else
                warn "Martin not installed — skipping maps"
            fi
            ;;
        kolibri)
            if command -v kolibri &>/dev/null; then
                info "Starting Kolibri on :8082..."
                KOLIBRI_HOME="$STORAGE_PATH/kolibri" \
                nohup kolibri start --port 8082 > /tmp/kolibri.log 2>&1 &
                success "Kolibri started"
            else
                warn "Kolibri not installed"
            fi
            ;;
        jellyfin)
            if command -v jellyfin &>/dev/null; then
                info "Starting Jellyfin on :8096..."
                systemctl start jellyfin 2>/dev/null || \
                nohup jellyfin > /tmp/jellyfin.log 2>&1 &
                success "Jellyfin started"
            fi
            ;;
        calibre)
            CPS_BIN=""
            [[ -f /opt/survive/venv/bin/cps ]] && CPS_BIN=/opt/survive/venv/bin/cps
            command -v cps &>/dev/null && CPS_BIN=cps
            if [[ -n "$CPS_BIN" ]]; then
                info "Starting Calibre-Web on :8083..."
                mkdir -p "$STORAGE_PATH/books"
                CALIBRE_DBPATH="$STORAGE_PATH/books" \
                nohup "$CPS_BIN" -p 8083 -i 127.0.0.1 \
                    > /tmp/calibre.log 2>&1 &
                echo $! > /tmp/calibre.pid
                success "Calibre-Web started (PID $(cat /tmp/calibre.pid))"
            else
                warn "Calibre-Web not installed"
            fi
            ;;
    esac
}

# ── Print access URLs ─────────────────────────────────────────────────────────
print_urls() {
    # Get local IP
    LOCAL_IP=$(hostname -I | awk '{print $1}' 2>/dev/null || echo "localhost")
    HOSTNAME="${SURVIVE_HOSTNAME:-survive}"

    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║       SurviveV1 Access URLs            ║${NC}"
    echo -e "${GREEN}╠════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║${NC} Dashboard:   http://$LOCAL_IP:8080    ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}             http://$HOSTNAME.local:8080${GREEN}║${NC}"
    echo -e "${GREEN}║${NC} Wikipedia:   http://$LOCAL_IP:8081    ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC} Education:   http://$LOCAL_IP:8082    ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC} E-Books:     http://$LOCAL_IP:8083    ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC} Videos:      http://$LOCAL_IP:8096    ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC} Maps:        http://$LOCAL_IP:3000    ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC} AI:          http://$LOCAL_IP:8080/ai ${GREEN}║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
    echo ""
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    echo ""
    info "Starting SurviveV1 services..."
    preflight_check

    start_service dashboard survive-dashboard "Dashboard"
    start_service kiwix survive-kiwix "Kiwix"
    start_service ollama survive-ollama "Ollama AI"
    start_service maps survive-maps "Maps"
    start_service kolibri survive-kolibri "Kolibri"
    start_service jellyfin jellyfin "Jellyfin"
    start_service calibre survive-calibre "Calibre-Web"

    # Wait up to 15 s for the dashboard to respond before printing URLs
    local retries=30
    while [[ $retries -gt 0 ]]; do
        if curl -sf "http://localhost:8080/health" >/dev/null 2>&1; then break; fi
        sleep 0.5
        retries=$((retries - 1))
    done
    [[ $retries -eq 0 ]] && warn "Dashboard did not respond within 15 s — URLs may not be ready"

    print_urls

    info "Stop with: bash scripts/stop_services.sh"
    info "Status:    bash scripts/status.sh"
}

main "$@"
