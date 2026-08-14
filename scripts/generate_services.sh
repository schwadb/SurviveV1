#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Generate systemd service files from config
# Replaces hardcoded /mnt/survive paths with the configured SURVIVE_STORAGE_PATH
# Run after changing SURVIVE_STORAGE_PATH in config/survive.conf
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
[[ -f "$_CONF" ]] || _CONF="${_CONF}.example"   # fall back to shipped defaults
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF -- using defaults" >&2; else source "$_CONF"; fi

STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
SERVICE_TEMPLATE_DIR="$REPO_DIR/systemd"
SYSTEMD_DIR="/etc/systemd/system"

# The templates ship with User=pi, but Raspberry Pi Imager lets the user pick
# any login name. A unit naming a nonexistent user fails instantly with
# status=217/USER — before any of its own logging — so substitute the real
# account. SUDO_USER is the human who ran sudo; fall back to the repo owner.
SERVICE_USER="${SURVIVE_SERVICE_USER:-${SUDO_USER:-}}"
[[ -n "$SERVICE_USER" ]] || SERVICE_USER=$(stat -c '%U' "$REPO_DIR")
id "$SERVICE_USER" &>/dev/null || SERVICE_USER="pi"

# Binaries land in different prefixes depending on how they were installed
# (apt -> /usr/bin, upstream installers -> /usr/local/bin). systemd needs an
# absolute ExecStart and does no PATH lookup, so a template guessing wrong
# fails with 203/EXEC. Resolve each one here instead.
declare -A RESOLVED_BIN=()
for _b in kiwix-serve ollama kolibri martin; do
    RESOLVED_BIN[$_b]=$(command -v "$_b" 2>/dev/null || echo "/usr/local/bin/$_b")
done

GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[SERVICES]${NC} $*"; }
success() { echo -e "${GREEN}[SERVICES]${NC} $*"; }

[[ $EUID -eq 0 ]] || { echo "Run with sudo: sudo bash $0"; exit 1; }

info "Generating service files for storage path: $STORAGE_PATH"
info "Services will run as user: $SERVICE_USER"
for _b in "${!RESOLVED_BIN[@]}"; do
    if [[ -x "${RESOLVED_BIN[$_b]}" ]]; then
        info "$_b -> ${RESOLVED_BIN[$_b]}"
    else
        info "$_b -> not installed (unit will stay DOWN until it is)"
    fi
done

for template in "$SERVICE_TEMPLATE_DIR"/*.service; do
    name=$(basename "$template")
    dest="$SYSTEMD_DIR/$name"

    # Replace /mnt/survive with the configured storage path, and the template's
    # placeholder account with this machine's real user.
    sed -e "s|/mnt/survive|$STORAGE_PATH|g" \
        -e "s|^User=pi$|User=$SERVICE_USER|" \
        -e "s|/usr/local/bin/kiwix-serve|${RESOLVED_BIN[kiwix-serve]}|" \
        -e "s|/usr/local/bin/ollama|${RESOLVED_BIN[ollama]}|" \
        -e "s|/usr/local/bin/kolibri|${RESOLVED_BIN[kolibri]}|" \
        -e "s|/usr/local/bin/martin|${RESOLVED_BIN[martin]}|" \
        "$template" > "$dest"
    success "Installed $dest"
done

systemctl daemon-reload
success "systemd daemon reloaded"

echo ""
info "Services updated for storage path: $STORAGE_PATH"
info "Enable and start with:"
echo "  sudo systemctl enable survive-dashboard kiwix ollama martin-tiles kolibri"
echo "  sudo systemctl start survive-dashboard kiwix ollama martin-tiles"
