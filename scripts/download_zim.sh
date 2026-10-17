#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Download ONE ZIM file picked in the dashboard's Library page
#
#   bash scripts/download_zim.sh <zim-url> [dest-subdir]
#
# Called detached by web/server.py (POST /api/content/download) and usable by
# hand. Resumable (aria2c or wget -c), validates the ZIM magic bytes, honours
# SURVIVE_BANDWIDTH_LIMIT, keeps a 10 GB free-space margin, then registers
# the file with Kiwix via scripts/rescan_library.sh.
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
[[ -f "$_CONF" ]] || _CONF="${_CONF}.example"   # fall back to shipped defaults
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF -- using defaults" >&2; else source "$_CONF"; fi

STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
URL="${1:-}"
SUBDIR="${2:-catalog}"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${BLUE}[ZIM]${NC} $*"; }
success() { echo -e "${GREEN}[ZIM]${NC} $*"; }
warn()    { echo -e "${YELLOW}[ZIM]${NC} $*"; }
error()   { echo -e "${RED}[ZIM]${NC} $*" >&2; }

[[ -n "$URL" ]] || { error "Usage: $0 <zim-url> [dest-subdir]"; exit 2; }
case "$URL" in
    https://download.kiwix.org/*|https://lb.download.kiwix.org/*|https://mirror.download.kiwix.org/*) ;;
    *) error "Refusing to download from outside download.kiwix.org: $URL"; exit 2 ;;
esac
[[ "$URL" == *.zim ]] || { error "Not a .zim URL: $URL"; exit 2; }
[[ "$SUBDIR" =~ ^[a-z0-9_-]+$ ]] || { error "Bad destination subdir: $SUBDIR"; exit 2; }

ZIM_DIR="$STORAGE_PATH/zim"
DEST_DIR="$ZIM_DIR/$SUBDIR"
FILENAME=$(basename "$URL")
DEST="$DEST_DIR/$FILENAME"
mkdir -p "$DEST_DIR"

MARGIN_BYTES=$((10 * 1024 * 1024 * 1024))
_space_ok() {  # _space_ok <bytes-needed>
    local need="$1" free
    free=$(df -B1 --output=avail "$ZIM_DIR" 2>/dev/null | tail -1 | tr -dc '0-9')
    [[ -n "$free" ]] || return 0
    (( free - need > MARGIN_BYTES ))
}

_zim_magic_ok() {
    [[ "$(head -c 4 "$1" 2>/dev/null | tr -d '\0')" == *ZIM* ]]
}

# Already own this title (any build, any subdir)? Then there is nothing to do.
prefix="${FILENAME%_*.zim}"
existing=$(find "$ZIM_DIR" -type f -name "${prefix}_*.zim" ! -name "*.aria2" 2>/dev/null | head -1 || true)
if [[ -n "$existing" ]] && [[ ! -f "$existing.aria2" ]] && _zim_magic_ok "$existing"; then
    remote_sz=$(curl -sIL --max-time 30 "$URL" 2>/dev/null | grep -i '^content-length' | tail -1 | tr -dc '0-9' || true)
    local_sz=$(stat -c %s "$existing" 2>/dev/null || echo 0)
    if [[ "$existing" == "$DEST" ]] && { [[ -z "$remote_sz" ]] || (( local_sz >= remote_sz )); }; then
        success "Already downloaded: $existing"
        exit 0
    fi
    if [[ "$existing" != "$DEST" ]]; then
        success "A build of this title is already on the drive: $existing"
        info "Delete it first if you want to replace it with $FILENAME"
        exit 0
    fi
fi

# Under `set -e -o pipefail` a grep with no match would abort the script, so
# an unreachable mirror must fall through to the "size unknown" path instead.
remote_sz=$(curl -sIL --max-time 30 "$URL" 2>/dev/null | grep -i '^content-length' | tail -1 | tr -dc '0-9' || true)
if ! curl -sIL --max-time 30 -o /dev/null "$URL" 2>/dev/null; then
    error "Cannot reach $URL -- is the Pi online?"
    exit 5
fi
local_sz=0
[[ -f "$DEST" ]] && local_sz=$(stat -c %s "$DEST" 2>/dev/null || echo 0)
if [[ -n "$remote_sz" ]]; then
    need=$(( remote_sz > local_sz ? remote_sz - local_sz : 0 ))
    if ! _space_ok "$need"; then
        error "Not enough free space: need $(( need / 1024 / 1024 )) MB plus a 10 GB margin"
        exit 3
    fi
    info "Downloading $FILENAME ($(( remote_sz / 1024 / 1024 )) MB)"
else
    info "Downloading $FILENAME (size unknown)"
fi

BW_ARGS=()
if command -v aria2c &>/dev/null; then
    [[ "${SURVIVE_BANDWIDTH_LIMIT:-0}" != "0" ]] && BW_ARGS=(--max-overall-download-limit="${SURVIVE_BANDWIDTH_LIMIT}")
    aria2c -c -x 4 -s 4 --file-allocation=none --summary-interval=15 --console-log-level=warn \
        --max-tries=5 --retry-wait=10 "${BW_ARGS[@]}" -d "$DEST_DIR" -o "$FILENAME" "$URL" \
        || { error "Download failed -- re-run to resume"; exit 5; }
else
    [[ "${SURVIVE_BANDWIDTH_LIMIT:-0}" != "0" ]] && BW_ARGS=(--limit-rate="${SURVIVE_BANDWIDTH_LIMIT}")
    wget -c --progress=dot:giga --tries=5 --timeout=60 "${BW_ARGS[@]}" -O "$DEST" "$URL" \
        || { error "Download failed -- re-run to resume"; exit 5; }
fi

if ! _zim_magic_ok "$DEST"; then
    error "Downloaded file is not a valid ZIM -- removing it"
    rm -f "$DEST" "$DEST.aria2"
    exit 4
fi
success "Download complete: $DEST"

# Make it visible: register with Kiwix, drop the filename index, restart kiwix.
bash "$REPO_DIR/scripts/rescan_library.sh" --storage "$STORAGE_PATH" || warn "Rescan reported errors"
