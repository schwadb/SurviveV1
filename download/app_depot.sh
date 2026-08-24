#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Offline app depot
#
# A neighbour who joins the hotspot has a phone but none of the apps that make
# the content usable offline. This fetches the installers so they can be
# sideloaded straight from the dashboard (/apps) with no internet:
#   - Kiwix Android      — read the ZIM library (Wikipedia, books, ...)
#   - F-Droid            — the open app store; installs Organic Maps and more
#   - Kiwix Desktop      — Windows reader for the same ZIMs
#   - VLC (Windows)      — play the downloaded videos on a laptop
#
# Everything is validated by magic bytes (APK/ZIP = "PK", .exe = "MZ") and a
# SHA256SUMS file is written so integrity can be checked after an offline copy.
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

APP_DIR="$STORAGE_PATH/apps"
LOG_DIR="$STORAGE_PATH/.logs"
mkdir -p "$APP_DIR"/{android,windows,docs} "$LOG_DIR"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${BLUE}[APPS]${NC} $*"; }
success() { echo -e "${GREEN}[APPS]${NC} $*"; }
warn()    { echo -e "${YELLOW}[APPS]${NC} $*"; }

FAILED_LOG="$LOG_DIR/failed_downloads.log"
SURVIVE_UA="Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

# Refuse to save an HTML error page under a .apk/.exe name (magic-byte check).
_valid_app() {
    [[ -s "$1" ]] || return 1
    case "${1,,}" in
        *.apk) [[ "$(head -c 2 "$1" 2>/dev/null)" == "PK" ]] ;;    # ZIP container
        *.exe) [[ "$(head -c 2 "$1" 2>/dev/null)" == "MZ" ]] ;;    # PE executable
        *)     return 0 ;;
    esac
}

_fetch() {  # _fetch <url> <dest>
    wget -q --show-progress --tries=3 --timeout=90 \
        --user-agent="$SURVIVE_UA" -O "$2" "$1"
}

dl_app() {  # dl_app <name> <url> <dest-file>
    local name="$1" url="$2" dest="$3"
    if [[ -f "$dest" ]] && _valid_app "$dest"; then
        info "[$name] Already downloaded"
        return 0
    fi
    info "Downloading: $name"
    if _fetch "$url" "$dest" && _valid_app "$dest"; then
        success "$name -> $dest"
    else
        rm -f "$dest"
        warn "$name failed — will retry next run"
        echo "$(date '+%Y-%m-%d %H:%M:%S') FAILED [$name] $url" >> "$FAILED_LOG"
        return 1
    fi
}

# Return the newest versioned file matching a regex from a mirror directory
# listing (same idea as kiwix_content.sh:resolve_zim_url), so we track the
# current release instead of pinning a filename that the mirror will delete.
resolve_latest() {  # resolve_latest <listing-url> <regex>
    local listing_url="$1" regex="$2" listing latest
    listing=$(curl -sSL --max-time 30 -A "$SURVIVE_UA" "$listing_url" 2>/dev/null) || return 1
    latest=$(grep -oE "$regex" <<< "$listing" | sort -V | tail -1)
    [[ -n "$latest" ]] || return 1
    echo "${listing_url%/}/$latest"
}

# ── Android ───────────────────────────────────────────────────────────────────
info "=== Android apps ==="

if kiwix_url=$(resolve_latest "https://download.kiwix.org/release/kiwix-android/" \
        'kiwix-[0-9]+\.[0-9]+\.[0-9]+\.apk'); then
    dl_app "Kiwix Android" "$kiwix_url" "$APP_DIR/android/kiwix.apk" || true
else
    warn "Could not resolve the Kiwix Android APK from the mirror listing"
fi

# F-Droid publishes a stable, unversioned download URL.
dl_app "F-Droid" "https://f-droid.org/F-Droid.apk" "$APP_DIR/android/fdroid.apk" || true

# ── Windows ───────────────────────────────────────────────────────────────────
info "=== Windows installers ==="

if kdesk_url=$(resolve_latest "https://download.kiwix.org/release/kiwix-desktop/" \
        'kiwix-desktop_windows_x64_[0-9.]+\.zip'); then
    dl_app "Kiwix Desktop (Windows)" "$kdesk_url" "$APP_DIR/windows/kiwix-desktop.zip" || true
else
    warn "Could not resolve Kiwix Desktop from the mirror listing"
fi

if vlc_url=$(resolve_latest "https://get.videolan.org/vlc/last/win64/" \
        'vlc-[0-9.]+-win64\.exe'); then
    dl_app "VLC (Windows)" "$vlc_url" "$APP_DIR/windows/vlc-win64.exe" || true
else
    warn "Could not resolve the VLC Windows installer"
fi

# ── Checksums + sideload notes ────────────────────────────────────────────────
info "Writing SHA256SUMS..."
( cd "$APP_DIR" && find . -type f ! -name SHA256SUMS -print0 \
    | xargs -0 sha256sum 2>/dev/null > SHA256SUMS ) || true

cat > "$APP_DIR/docs/README.txt" <<'EOF'
SurviveV1 Offline App Depot
===========================
Install these directly from the dashboard at http://10.42.0.1:8080/apps
while connected to the SurviveV1 Wi-Fi — no internet required.

ANDROID (.apk)
  1. Tap the APK link on the /apps page.
  2. If prompted, allow "Install unknown apps" for your browser.
  3. Kiwix: open it, then Library -> add the ZIM served at
     http://10.42.0.1:8081 (or copy ZIM files over via the file browser).
  4. F-Droid: the open-source app store. Once installed it can fetch
     Organic Maps (offline maps), OsmAnd, and more — but only when online.
     Install it now so it is ready.

WINDOWS
  - Kiwix Desktop (.zip): unzip and run kiwix-desktop.exe to read the ZIMs.
  - VLC (.exe): plays the downloaded videos.

Verify a file with SHA256SUMS (optional): sha256sum -c SHA256SUMS
EOF

success "App depot ready under $APP_DIR"
[[ -s "$FAILED_LOG" ]] && warn "Some apps failed — see $FAILED_LOG" || true
