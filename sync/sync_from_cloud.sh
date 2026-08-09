#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Restore/sync from cloud storage
# Usage: bash sync/sync_from_cloud.sh [remote] [--category videos]
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
[[ -f "$_CONF" ]] || _CONF="${_CONF}.example"   # fall back to shipped defaults
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF -- using defaults" >&2; else source "$_CONF"; fi

STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
REMOTE="${1:-gdrive}"
REMOTE_PATH="${SURVIVE_CLOUD_PATH:-SurviveV1}"
CATEGORY=""
DRY_RUN=false

shift 2>/dev/null || true
while [[ $# -gt 0 ]]; do
    case "$1" in
        --category) CATEGORY="$2"; shift 2 ;;
        --dry-run)  DRY_RUN=true; shift ;;
        *) shift ;;
    esac
done

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${BLUE}[CLOUD→SYNC]${NC} $*"; }
success() { echo -e "${GREEN}[CLOUD→SYNC]${NC} $*"; }
warn()    { echo -e "${YELLOW}[CLOUD→SYNC]${NC} $*"; }

sync_from() {
    local remote_dir="$1"
    local local_dir="$2"
    local label="$3"

    info "Restoring $label from $REMOTE:$REMOTE_PATH/$remote_dir → $local_dir"
    mkdir -p "$local_dir"

    local FLAGS=(--progress --transfers 4 --checkers 8 --retries 3 --stats 60s)
    [[ "$DRY_RUN" == "true" ]] && FLAGS+=(--dry-run)

    rclone sync "$REMOTE:$REMOTE_PATH/$remote_dir" "$local_dir" \
        "${FLAGS[@]}" \
    && success "$label restored" \
    || warn "$label restore had errors"
}

main() {
    info "Cloud → SurviveV1 Restore"
    info "Remote: $REMOTE | Dry-run: $DRY_RUN"

    # List available content on remote
    info "Available content on $REMOTE:$REMOTE_PATH:"
    rclone lsf "$REMOTE:$REMOTE_PATH" 2>/dev/null || {
        echo "Could not list remote — check connection and remote config"
        exit 1
    }

    if [[ -n "$CATEGORY" ]]; then
        sync_from "$CATEGORY" "$STORAGE_PATH/$CATEGORY" "$CATEGORY"
    else
        sync_from "pdfs"   "$STORAGE_PATH/pdfs"   "PDFs & Manuals"
        sync_from "books"  "$STORAGE_PATH/books"  "Books"
        sync_from "zim"    "$STORAGE_PATH/zim"    "ZIM files"
        sync_from "videos" "$STORAGE_PATH/videos" "Videos"
        sync_from "maps"   "$STORAGE_PATH/maps"   "Maps"
    fi

    success "Restore complete"
}

main
