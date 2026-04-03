#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Schedule automatic cloud sync (when internet available)
# Sets up cron + network detection for opportunistic syncing
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF — using defaults" >&2; else source "$_CONF"; fi

REMOTE="${1:-gdrive}"
SYNC_SCRIPT="$REPO_DIR/sync/sync_to_cloud.sh"
LOG_DIR="${SURVIVE_STORAGE_PATH:-/mnt/survive}/.logs"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; NC='\033[0m'
info()    { echo -e "${BLUE}[SCHEDULE]${NC} $*"; }
success() { echo -e "${GREEN}[SCHEDULE]${NC} $*"; }

mkdir -p "$LOG_DIR"

# ── Create network-aware sync wrapper ────────────────────────────────────────
SYNC_WRAPPER="/usr/local/bin/survive-cloud-sync"
cat > "$SYNC_WRAPPER" << WRAPPER
#!/usr/bin/env bash
# Auto-sync SurviveV1 when internet is available
REMOTE="${REMOTE}"
REPO_DIR="${REPO_DIR}"
LOG_DIR="${LOG_DIR}"

log() { echo "\$(date '+%Y-%m-%d %H:%M:%S') \$*" >> "\$LOG_DIR/auto_sync.log"; }

# Check internet connectivity
if ! ping -c 1 -W 3 8.8.8.8 &>/dev/null && \
   ! ping -c 1 -W 3 1.1.1.1 &>/dev/null; then
    log "No internet — skipping sync"
    exit 0
fi

# Check if already syncing
if pgrep -f "rclone sync" &>/dev/null; then
    log "Sync already in progress — skipping"
    exit 0
fi

log "Internet detected — starting sync to \$REMOTE"
bash "\$REPO_DIR/sync/sync_to_cloud.sh" "\$REMOTE" \
    --bw 5M \
    >> "\$LOG_DIR/auto_sync.log" 2>&1 \
    && log "Sync complete" \
    || log "Sync had errors"
WRAPPER
chmod +x "$SYNC_WRAPPER"

# ── Add to crontab ────────────────────────────────────────────────────────────
setup_cron() {
    info "Setting up cron schedule..."

    # Remove old entries
    CRONTAB_TMP=$(mktemp)
    crontab -l 2>/dev/null | grep -v "survive-cloud-sync" > "$CRONTAB_TMP" || true

    # Add new schedule: every 6 hours
    echo "0 */6 * * * $SYNC_WRAPPER >> $LOG_DIR/cron_sync.log 2>&1" >> "$CRONTAB_TMP"

    crontab "$CRONTAB_TMP"
    rm -f "$CRONTAB_TMP"

    success "Cron job added — syncs every 6 hours when internet available"
}

# ── NetworkManager hook (sync on Wi-Fi connect) ───────────────────────────────
setup_nm_hook() {
    if command -v nmcli &>/dev/null; then
        info "Adding NetworkManager hook for auto-sync on Wi-Fi connect..."
        HOOK_DIR="/etc/NetworkManager/dispatcher.d"
        mkdir -p "$HOOK_DIR"

        cat > "$HOOK_DIR/99-survive-sync" << 'NM_HOOK'
#!/usr/bin/env bash
INTERFACE="$1"
STATUS="$2"

if [[ "$STATUS" == "up" ]] && [[ "$INTERFACE" =~ ^wlan ]]; then
    # Wait for internet
    sleep 10
    /usr/local/bin/survive-cloud-sync &
fi
NM_HOOK
        chmod +x "$HOOK_DIR/99-survive-sync"
        success "NetworkManager hook installed — syncs when Wi-Fi connects"
    fi
}

# ── Systemd timer (alternative to cron) ──────────────────────────────────────
setup_systemd_timer() {
    cat > /etc/systemd/system/survive-sync.service << SERVICE
[Unit]
Description=SurviveV1 Cloud Sync
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$SYNC_WRAPPER
User=${SUDO_USER:-pi}
StandardOutput=append:$LOG_DIR/systemd_sync.log
StandardError=append:$LOG_DIR/systemd_sync.log
SERVICE

    cat > /etc/systemd/system/survive-sync.timer << TIMER
[Unit]
Description=SurviveV1 Cloud Sync Timer
Requires=survive-sync.service

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true
RandomizedDelaySec=1800

[Install]
WantedBy=timers.target
TIMER

    systemctl daemon-reload
    systemctl enable survive-sync.timer
    systemctl start survive-sync.timer
    success "Systemd timer enabled — syncs daily at 2AM (+/- 30min)"
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    info "Setting up scheduled cloud sync to: $REMOTE"

    setup_cron
    setup_nm_hook
    setup_systemd_timer 2>/dev/null || setup_cron

    success "Auto-sync configured!"
    echo ""
    echo "  Sync schedule:    Every 6 hours (when internet available)"
    echo "  On WiFi connect:  Automatic (via NetworkManager)"
    echo "  Manual sync:      bash sync/sync_to_cloud.sh $REMOTE"
    echo "  Sync logs:        $LOG_DIR/auto_sync.log"
    echo ""
    echo "  To sync now:      $SYNC_WRAPPER"
}

main
