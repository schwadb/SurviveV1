#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Communications tools content
#
#   bash download/comms.sh [--storage /mnt/survive]
#
# Fetches the Meshtastic web client (a static single-page app served by the
# survive-meshtastic systemd unit on port 8084) and prepares the folder for
# user-imported repeater lists. Everything lands under $STORAGE/comms/.
#
# RepeaterBook's terms forbid bulk export and offline bundling, so this
# script deliberately does NOT scrape repeater data. Export your own list
# from RepeaterBook or CHIRP as CSV and drop it in comms/repeaters/ (or use
# the upload button on the dashboard's Comms page).
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

COMMS_DIR="$STORAGE_PATH/comms"
MESH_DIR="$COMMS_DIR/meshtastic-web"
MESH_URL="https://github.com/meshtastic/web/releases/latest/download/build.tar"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${BLUE}[COMMS]${NC} $*"; }
success() { echo -e "${GREEN}[COMMS]${NC} $*"; }
warn()    { echo -e "${YELLOW}[COMMS]${NC} $*"; }

mkdir -p "$COMMS_DIR/repeaters"

# ── Meshtastic web client ────────────────────────────────────────────────────
dl_meshtastic_web() {
    [[ "${CONTENT_MESHTASTIC:-Y}" =~ [Yy] ]] || { info "Meshtastic web client disabled in config"; return 0; }
    info "=== Meshtastic web client ==="
    # Resolve the release tag so we can skip the download when up to date.
    local final tag
    final=$(curl -sIL --max-time 30 -o /dev/null -w '%{url_effective}' "$MESH_URL" 2>/dev/null || true)
    tag=$(grep -oE 'download/v?[0-9][^/]*' <<< "$final" | head -1 | sed 's|download/||' || true)
    if [[ -n "$tag" ]] && [[ -f "$MESH_DIR/VERSION" ]] && [[ "$(cat "$MESH_DIR/VERSION")" == "$tag" ]] \
       && [[ -f "$MESH_DIR/index.html" ]]; then
        info "Meshtastic web $tag already installed"
        return 0
    fi

    local tmp
    tmp=$(mktemp -d)
    if ! curl -sL --max-time 300 -o "$tmp/build.tar" "$MESH_URL"; then
        warn "Meshtastic web download failed (offline?)"
        rm -rf "$tmp"; return 0
    fi
    if ! tar -tf "$tmp/build.tar" >/dev/null 2>&1; then
        warn "Downloaded file is not a tar archive -- skipping"
        rm -rf "$tmp"; return 0
    fi
    mkdir -p "$tmp/web"
    tar -xf "$tmp/build.tar" -C "$tmp/web"
    # The release ships every file pre-gzipped (index.html.gz, *.js.gz). The
    # plain python http.server that serves it cannot negotiate encodings, so
    # inflate everything once here.
    find "$tmp/web" -type f -name '*.gz' -exec gunzip -f {} +
    if [[ ! -f "$tmp/web/index.html" ]]; then
        warn "Archive has no index.html -- layout changed? Skipping"
        rm -rf "$tmp"; return 0
    fi
    rm -rf "$MESH_DIR"
    mv "$tmp/web" "$MESH_DIR"
    echo "${tag:-unknown}" > "$MESH_DIR/VERSION"
    rm -rf "$tmp"
    success "Meshtastic web ${tag:-} installed at $MESH_DIR"
    info "Served on port 8084 by survive-meshtastic.service (start: sudo systemctl start survive-meshtastic)"
    sudo -n systemctl restart survive-meshtastic 2>/dev/null || true
}

# ── Repeater list folder ─────────────────────────────────────────────────────
write_repeater_readme() {
    cat > "$COMMS_DIR/repeaters/README.txt" <<'EOF'
Repeater lists for the SurviveV1 Comms page
===========================================

Drop CSV files in this folder (or upload them on the dashboard's Comms page)
and they appear in a searchable table at http://<pi>:8080/comms/repeaters.

Accepted formats (columns are matched by name, any order):
  * CHIRP exports:        Location,Name,Frequency,Duplex,Offset,Tone,rToneFreq,...
  * RepeaterBook exports: the CSV you download while logged in to your own
                          RepeaterBook account (personal use only)
  * Any spreadsheet with at least a "Frequency" column; "Name"/"Callsign",
    "Offset"/"Input", "Tone"/"PL", "Mode", "City"/"Location", "State", "Notes"
    are picked up when present.

RepeaterBook data is licensed for personal use and may not be redistributed,
so SurviveV1 never downloads it for you.
EOF
}

main() {
    info "Comms content -> $COMMS_DIR"
    dl_meshtastic_web
    write_repeater_readme
    success "Comms setup complete"
    du -sh "$COMMS_DIR" 2>/dev/null || true
}

main "$@"
