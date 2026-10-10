#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Rebuild the Kiwix library from the ZIM files on disk
#
#   bash scripts/rescan_library.sh [--storage /mnt/survive]
#
# Use after copying .zim files onto the drive by hand (USB stick, SSH, Samba)
# or after a dashboard download. Rebuilds .kiwix_library.xml from scratch so
# deleted files drop out too, clears the dashboard's filename index, and
# restarts kiwix-serve (needs the passwordless sudo rule from
# scripts/install_sudoers.sh; otherwise it prints the command to run).
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
[[ -f "$_CONF" ]] || _CONF="${_CONF}.example"   # fall back to shipped defaults
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF -- using defaults" >&2; else source "$_CONF"; fi

STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
while [[ $# -gt 0 ]]; do
    case $1 in
        --storage) STORAGE_PATH="$2"; shift 2 ;;
        *) shift ;;
    esac
done

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${BLUE}[RESCAN]${NC} $*"; }
success() { echo -e "${GREEN}[RESCAN]${NC} $*"; }
warn()    { echo -e "${YELLOW}[RESCAN]${NC} $*"; }

ZIM_DIR="$STORAGE_PATH/zim"
LIBRARY="$STORAGE_PATH/.kiwix_library.xml"
mkdir -p "$ZIM_DIR"

if ! command -v kiwix-manage &>/dev/null; then
    warn "kiwix-manage not installed -- cannot rebuild $LIBRARY"
    exit 1
fi

TMP=$(mktemp "$STORAGE_PATH/.kiwix_library.XXXXXX.xml")
trap 'rm -f "$TMP"' EXIT
rm -f "$TMP"   # kiwix-manage creates the file itself

added=0; skipped=0
while IFS= read -r -d '' zimfile; do
    # Skip partial downloads and anything that isn't really a ZIM.
    [[ -f "$zimfile.aria2" ]] && { skipped=$((skipped + 1)); continue; }
    if [[ "$(head -c 4 "$zimfile" 2>/dev/null | tr -d '\0')" != *ZIM* ]]; then
        warn "Not a valid ZIM, skipping: $zimfile"
        skipped=$((skipped + 1)); continue
    fi
    if kiwix-manage "$TMP" add "$zimfile" >/dev/null 2>&1; then
        added=$((added + 1))
    else
        warn "kiwix-manage rejected: $zimfile"
        skipped=$((skipped + 1))
    fi
done < <(find "$ZIM_DIR" -type f -name "*.zim" -print0 2>/dev/null | sort -z)

if [[ -s "$TMP" ]]; then
    mv -f "$TMP" "$LIBRARY"
else
    # No books at all: leave an empty-but-valid library so kiwix-serve starts.
    printf '<?xml version="1.0" encoding="UTF-8"?>\n<library version="20110515">\n</library>\n' > "$LIBRARY"
fi
trap - EXIT
success "Library rebuilt: $added ZIM(s) registered, $skipped skipped"

# The dashboard's filename search index must pick up the new files.
rm -f "$STORAGE_PATH/.search_index.db"

if sudo -n systemctl restart kiwix 2>/dev/null; then
    success "Kiwix restarted -- new content is live"
else
    info "Restart Kiwix to publish the library: sudo systemctl restart kiwix"
fi
