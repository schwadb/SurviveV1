#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Shared shell library
# Source this from any script: source "$(dirname "$0")/../lib/common.sh"
# =============================================================================

# Prevent double-sourcing
[[ -n "${_SURVIVE_COMMON_LOADED:-}" ]] && return 0
_SURVIVE_COMMON_LOADED=1

# ── Repository root ──────────────────────────────────────────────────────────
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

# ── Config loading ───────────────────────────────────────────────────────────
_CONF="$REPO_DIR/config/survive.conf"
if [[ ! -f "$_CONF" ]]; then
    echo "[WARN] Config not found at $_CONF -- using defaults" >&2
else
    # shellcheck disable=SC1090
    source "$_CONF"
fi

STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ── Logging ──────────────────────────────────────────────────────────────────
_LOG_PREFIX="${LOG_PREFIX:-SURVIVE}"

info()    { echo -e "${BLUE}[${_LOG_PREFIX}]${NC} $*"; }
success() { echo -e "${GREEN}[${_LOG_PREFIX}]${NC} $*"; }
warn()    { echo -e "${YELLOW}[${_LOG_PREFIX}]${NC} $*"; }
error()   { echo -e "${RED}[${_LOG_PREFIX}]${NC} $*" >&2; }

# ── Utility functions ────────────────────────────────────────────────────────
require_cmd() {
    command -v "$1" &>/dev/null || { error "Required command not found: $1"; return 1; }
}

check_internet() {
    ping -c 1 -W 3 8.8.8.8 &>/dev/null
}

check_disk_free_mb() {
    local path="${1:-$STORAGE_PATH}"
    df -k "$path" 2>/dev/null | tail -1 | awk '{print int($4/1024)}'
}
