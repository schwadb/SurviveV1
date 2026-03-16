#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Kolibri educational content downloader
# Downloads Khan Academy, CK-12, and other educational channels offline
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$REPO_DIR/config/survive.conf" 2>/dev/null || true

STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
KOLIBRI_HOME="$STORAGE_PATH/kolibri"

while [[ $# -gt 0 ]]; do
    case $1 in
        --storage) STORAGE_PATH="$2"; KOLIBRI_HOME="$2/kolibri"; shift 2 ;;
        *) shift ;;
    esac
done

export KOLIBRI_HOME
mkdir -p "$KOLIBRI_HOME"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; NC='\033[0m'
info()    { echo -e "${BLUE}[KOLIBRI]${NC} $*"; }
success() { echo -e "${GREEN}[KOLIBRI]${NC} $*"; }

# ── Kolibri channel IDs ──────────────────────────────────────────────────────
# Find channel IDs at: https://kolibri-demo.learningequality.org
declare -A CHANNELS=(
    # Khan Academy (main survival-relevant subjects)
    ["Khan Academy (English)"]="khan_academy"
    # Science & Medicine
    ["CK-12 Textbooks"]="c89efbfd13ae437bb62b7ae7fd826cc4"
    # Practical Skills
    ["MIT OpenCourseWare"]="org.mitopencourseware"
    # Basic literacy
    ["African Storybook"]="f9d3e0e46e3c4890816e4b4b8c45b7b2"
    # STEM
    ["PhET Simulations"]="ad25730a52814f10b98d09a8f5bde26e"
    # Health
    ["HealthNudge"]="health"
    # General reference
    ["Wikipedia for Schools"]="wikipedia_for_schools"
)

# Khan Academy specific channels
KHAN_CHANNELS=(
    "fe6fc4fa09514da89ccc4b42c3c27c19"  # Khan Academy Math
    "a93e45a96ce147b68da3f4cac4378e82"  # Khan Academy Science
    "f9d3e0e46e3c4890816e4b4b8c45b7b2"  # Khan Academy Computing
    "3a9e1bf58fc14c3d85a7e6fccabb8017"  # Khan Academy Biology
    "6c7a0e748cfc4572af1a4cf39e6c2c6b"  # Khan Academy Chemistry
    "a523ac6a569b499782b6982a40a2ddd3"  # Khan Academy Physics
    "b9e1f8af94bd47929c3ef0a4f6b5b474"  # Khan Academy Medicine/Health
    "d56a9de4d0a54e88a891df0a73e70be8"  # Khan Academy Agriculture
    "e34282d9d6894a2386d07a8e3b38e756"  # Khan Academy Engineering
)

# ── Import channel ──────────────────────────────────────────────────────────
import_channel() {
    local name="$1"
    local channel_id="$2"

    info "Importing: $name ($channel_id)"
    kolibri manage importchannel network "$channel_id" 2>/dev/null || {
        info "Trying with token..."
        kolibri manage importchannel network "$channel_id" --token="$channel_id" 2>/dev/null || \
        warn "Could not import $name"
        return
    }

    info "Importing content for: $name"
    kolibri manage importcontent network "$channel_id" 2>/dev/null || \
        warn "Content import failed for $name"

    success "Imported: $name"
}

# ── Start Kolibri server briefly for import ───────────────────────────────────
start_kolibri() {
    info "Starting Kolibri..."
    kolibri start --background 2>/dev/null
    sleep 5
}

stop_kolibri() {
    info "Stopping Kolibri..."
    kolibri stop 2>/dev/null || true
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    info "Starting Kolibri content download to: $KOLIBRI_HOME"

    # Initialize Kolibri if not done
    kolibri manage migrate 2>/dev/null || true
    kolibri manage createdefaultfacility 2>/dev/null || true

    start_kolibri

    # Import Khan Academy channels (most valuable for survival knowledge)
    for channel_id in "${KHAN_CHANNELS[@]}"; do
        import_channel "Khan Academy" "$channel_id"
    done

    # Import other channels
    declare -A OTHER_CHANNELS=(
        ["CK-12"]="c89efbfd13ae437bb62b7ae7fd826cc4"
        ["PhET Simulations"]="ad25730a52814f10b98d09a8f5bde26e"
    )

    for name in "${!OTHER_CHANNELS[@]}"; do
        import_channel "$name" "${OTHER_CHANNELS[$name]}"
    done

    stop_kolibri

    success "Kolibri content download complete"
    info "Content location: $KOLIBRI_HOME"
    info "Access at: http://localhost:8082 (after starting services)"
    du -sh "$KOLIBRI_HOME" 2>/dev/null || true
}

main "$@"
