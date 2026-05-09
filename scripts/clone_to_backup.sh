#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Clone content to a backup drive (3-2-1 backup strategy)
# Usage: bash scripts/clone_to_backup.sh /path/to/backup/drive
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF -- using defaults" >&2; else source "$_CONF"; fi

STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
BACKUP_PATH="${1:-}"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${BLUE}[BACKUP]${NC} $*"; }
success() { echo -e "${GREEN}[BACKUP]${NC} $*"; }
warn()    { echo -e "${YELLOW}[BACKUP]${NC} $*"; }
error()   { echo -e "${RED}[BACKUP]${NC} $*" >&2; }

if [[ -z "$BACKUP_PATH" ]]; then
    echo "Usage: bash scripts/clone_to_backup.sh /path/to/backup/drive"
    echo ""
    echo "  Creates a mirror of all content to a second drive."
    echo "  Uses rsync with checksums for reliable incremental sync."
    echo ""
    echo "  Recommended backup drives (rugged, IP67+):"
    echo "    - LaCie Rugged SSD Pro"
    echo "    - SanDisk Extreme Portable (IP65)"
    echo "    - Samsung T7 Shield (IP65)"
    echo ""
    echo "  3-2-1 backup strategy:"
    echo "    3 copies of your data"
    echo "    2 different storage media"
    echo "    1 offsite (cloud sync or geographic separation)"
    exit 0
fi

if [[ ! -d "$BACKUP_PATH" ]]; then
    error "Backup path does not exist: $BACKUP_PATH"
    error "Mount your backup drive first, then retry."
    exit 1
fi

if [[ ! -d "$STORAGE_PATH" ]]; then
    error "Source storage not found at: $STORAGE_PATH"
    exit 1
fi

# Check available space
SOURCE_SIZE_KB=$(du -sk "$STORAGE_PATH" 2>/dev/null | cut -f1)
BACKUP_FREE_KB=$(df -k "$BACKUP_PATH" 2>/dev/null | tail -1 | awk '{print $4}')

if [[ "$BACKUP_FREE_KB" -lt "$SOURCE_SIZE_KB" ]]; then
    warn "Backup drive may not have enough space"
    warn "  Source: $((SOURCE_SIZE_KB / 1048576)) GB"
    warn "  Free:  $((BACKUP_FREE_KB / 1048576)) GB"
    read -rp "Continue anyway? [y/N]: " confirm
    [[ "$confirm" =~ [Yy] ]] || exit 0
fi

info "Cloning content from $STORAGE_PATH to $BACKUP_PATH"
info "This uses rsync with checksums -- first run may take hours."
info ""

rsync -avh \
    --checksum \
    --delete \
    --progress \
    --exclude='.logs/' \
    --exclude='.cache/' \
    --exclude='*.lock' \
    --exclude='*.pid' \
    "$STORAGE_PATH/" "$BACKUP_PATH/"

# Also backup the repo scripts
rsync -avh \
    --exclude='.git/' \
    --exclude='__pycache__/' \
    "$REPO_DIR/" "$BACKUP_PATH/.survivev1_scripts/"

success "Backup complete!"
info "Source: $STORAGE_PATH"
info "Backup: $BACKUP_PATH"
du -sh "$BACKUP_PATH" 2>/dev/null || true
