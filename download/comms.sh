#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Communications tools content
#
#   bash download/comms.sh [--storage /mnt/survive]
#
# Fetches the Meshtastic web client (a static single-page app served by the
# survive-meshtastic systemd unit on port 8084), the MeshCore web client
# (survive-meshcore on 8085, plus its Android/Windows installers for the app
# depot) and prepares the folder for user-imported repeater lists. Everything
# lands under $STORAGE/comms/ (installers under $STORAGE/apps/).
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
MESHCORE_DIR="$COMMS_DIR/meshcore-web"
MESHCORE_BASE="https://files.liamcottle.net/MeshCore"
APP_DIR="$STORAGE_PATH/apps"

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

# ── MeshCore web client + installers ─────────────────────────────────────────
# MeshCore (meshcore.io) is the other popular LoRa mesh firmware. Its app is a
# Flutter build published per version on the author's file server as a web
# zip plus native installers. The web build ships its own CanvasKit renderer
# but the bootstrap points at Google's CDN by default; flipping
# useLocalCanvasKit makes it load the bundled copy so the page works with no
# internet. (The engine may still try fonts.gstatic.com for fallback glyphs;
# that only affects characters outside the bundled fonts.)
dl_meshcore_web() {
    [[ "${CONTENT_MESHCORE:-Y}" =~ [Yy] ]] || { info "MeshCore disabled in config"; return 0; }
    info "=== MeshCore web client ==="
    local listing ver files zip apk winzip
    listing=$(curl -sf --max-time 30 "$MESHCORE_BASE/" 2>/dev/null || true)
    ver=$(grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+/' <<< "$listing" | sort -V | tail -1 | tr -d '/' || true)
    if [[ -z "$ver" ]]; then
        warn "Could not list MeshCore releases (offline?)"
        return 0
    fi
    files=$(curl -sf --max-time 30 "$MESHCORE_BASE/$ver/" 2>/dev/null || true)
    zip=$(grep -oE '[^"/]+-web\.zip' <<< "$files" | head -1 || true)
    apk=$(grep -oE '[^"/]+-android\.apk' <<< "$files" | head -1 || true)
    winzip=$(grep -oE '[^"/]+-windows-x64\.zip' <<< "$files" | head -1 || true)

    if [[ -f "$MESHCORE_DIR/VERSION" ]] && [[ "$(cat "$MESHCORE_DIR/VERSION")" == "$ver" ]] \
       && [[ -f "$MESHCORE_DIR/index.html" ]]; then
        info "MeshCore web $ver already installed"
    elif [[ -n "$zip" ]]; then
        local tmp idx
        tmp=$(mktemp -d)
        if curl -sfL --max-time 600 -o "$tmp/web.zip" "$MESHCORE_BASE/$ver/$zip" \
           && unzip -qo "$tmp/web.zip" -d "$tmp/x" 2>/dev/null; then
            idx=$(find "$tmp/x" -name index.html | head -1 || true)
            if [[ -n "$idx" ]]; then
                # Serve the bundled CanvasKit instead of Google's CDN.
                sed -i 's/"engineRevision":"/"useLocalCanvasKit":true,"engineRevision":"/' \
                    "$(dirname "$idx")/flutter_bootstrap.js" 2>/dev/null || true
                rm -rf "$MESHCORE_DIR"
                mv "$(dirname "$idx")" "$MESHCORE_DIR"
                echo "$ver" > "$MESHCORE_DIR/VERSION"
                success "MeshCore web $ver installed at $MESHCORE_DIR"
                info "Served on port 8085 by survive-meshcore.service"
                sudo -n systemctl restart survive-meshcore 2>/dev/null || true
            else
                warn "MeshCore web zip has no index.html -- layout changed?"
            fi
        else
            warn "MeshCore web download failed"
        fi
        rm -rf "$tmp"
    else
        warn "No -web.zip in the $ver release listing"
    fi

    # Native apps for the depot: phones pair with the radio over Bluetooth, so
    # the installed app is what people actually use in the field.
    mkdir -p "$APP_DIR/android" "$APP_DIR/windows"
    if [[ -n "$apk" ]] && [[ ! -s "$APP_DIR/android/meshcore.apk" ]]; then
        info "Downloading MeshCore Android app (~110 MB)..."
        curl -sfL --max-time 900 -o "$APP_DIR/android/meshcore.apk" "$MESHCORE_BASE/$ver/$apk" \
            && [[ "$(head -c 2 "$APP_DIR/android/meshcore.apk")" == "PK" ]] \
            && success "MeshCore Android -> apps/android/meshcore.apk" \
            || { rm -f "$APP_DIR/android/meshcore.apk"; warn "MeshCore APK download failed"; }
    fi
    if [[ -n "$winzip" ]] && [[ ! -s "$APP_DIR/windows/meshcore-windows-x64.zip" ]]; then
        info "Downloading MeshCore Windows app (~20 MB)..."
        curl -sfL --max-time 600 -o "$APP_DIR/windows/meshcore-windows-x64.zip" "$MESHCORE_BASE/$ver/$winzip" \
            && [[ "$(head -c 2 "$APP_DIR/windows/meshcore-windows-x64.zip")" == "PK" ]] \
            && success "MeshCore Windows -> apps/windows/meshcore-windows-x64.zip" \
            || { rm -f "$APP_DIR/windows/meshcore-windows-x64.zip"; warn "MeshCore Windows download failed"; }
    fi
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
    dl_meshcore_web
    write_repeater_readme
    success "Comms setup complete"
    du -sh "$COMMS_DIR" 2>/dev/null || true
}

main "$@"
