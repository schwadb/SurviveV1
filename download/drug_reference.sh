#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Offline drug reference (openFDA drug labels)
#
# Downloads the openFDA drug-label dataset (~1.8 GB across ~14 zip partitions,
# US-government public domain) into $STORAGE/drugs/raw/, then builds a
# searchable SQLite index so the dashboard answers "what is this pill", "what
# treats this symptom", and "do these interact" with no internet.
#
#   bash download/drug_reference.sh --storage /mnt/survive
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
[[ -f "$_CONF" ]] || _CONF="${_CONF}.example"
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF -- using defaults" >&2; else source "$_CONF"; fi

STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
while [[ $# -gt 0 ]]; do
    case $1 in
        --storage) STORAGE_PATH="$2"; shift 2 ;;
        *) shift ;;
    esac
done

RAW_DIR="$STORAGE_PATH/drugs/raw"
LOG_DIR="$STORAGE_PATH/.logs"
mkdir -p "$RAW_DIR" "$LOG_DIR"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${BLUE}[DRUGS]${NC} $*"; }
success() { echo -e "${GREEN}[DRUGS]${NC} $*"; }
warn()    { echo -e "${YELLOW}[DRUGS]${NC} $*"; }

FAILED_LOG="$LOG_DIR/failed_downloads.log"
SPACE_MARGIN_MB="${SURVIVE_SPACE_MARGIN_MB:-10240}"

_space_ok() {  # _space_ok <need-bytes>
    local need="$1" avail_kb
    avail_kb=$(df --output=avail -k "$STORAGE_PATH" 2>/dev/null | tail -1 | tr -dc '0-9')
    [[ -z "$avail_kb" ]] && return 0
    (( avail_kb * 1024 - need > SPACE_MARGIN_MB * 1024 * 1024 ))
}

_is_zip() { [[ "$(head -c 2 "$1" 2>/dev/null)" == "PK" ]]; }

info "Fetching the openFDA drug-label file list..."
MANIFEST=$(curl -sSL --max-time 60 "https://api.fda.gov/download.json") \
    || { warn "Could not reach api.fda.gov"; exit 1; }

# Extract the partition URLs (drug/label section).
mapfile -t URLS < <(python3 -c "
import json,sys
d=json.loads(sys.argv[1])
for p in d['results']['drug']['label']['partitions']:
    print(p['file'])
" "$MANIFEST" 2>/dev/null)

if [[ ${#URLS[@]} -eq 0 ]]; then
    warn "No partitions found in the openFDA manifest — aborting"
    exit 1
fi
info "openFDA lists ${#URLS[@]} partitions (~1.8 GB total)."

for url in "${URLS[@]}"; do
    fname=$(basename "$url")
    dest="$RAW_DIR/$fname"
    if [[ -f "$dest" ]] && _is_zip "$dest"; then
        info "[$fname] already downloaded"
        continue
    fi
    # Each partition is ~130 MB; require headroom before fetching.
    if ! _space_ok $((200 * 1024 * 1024)); then
        warn "[$fname] low disk space — skipping remaining partitions"
        echo "$(date '+%Y-%m-%d %H:%M:%S') FAILED [drug $fname] insufficient space" >> "$FAILED_LOG"
        break
    fi
    info "Downloading $fname ..."
    if curl -fsSL --retry 3 --max-time 600 "$url" -o "$dest" && _is_zip "$dest"; then
        success "$fname"
    else
        rm -f "$dest"
        warn "[$fname] download failed"
        echo "$(date '+%Y-%m-%d %H:%M:%S') FAILED [drug $fname] $url" >> "$FAILED_LOG"
    fi
done

info "Building the searchable drug index (this takes a while on a Pi)..."
if command -v python3 &>/dev/null; then
    nice -n 19 python3 "$REPO_DIR/scripts/build_drug_index.py" --storage "$STORAGE_PATH" \
        || warn "Drug index build failed"
else
    warn "python3 not found — cannot build the index"
fi

success "Drug reference ready. Browse it at the dashboard's /drugs page."
