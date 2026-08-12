#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Survival video downloader via yt-dlp
# Downloads curated playlists from YouTube and other sources
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
[[ -f "$_CONF" ]] || _CONF="${_CONF}.example"   # fall back to shipped defaults
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF -- using defaults" >&2; else source "$_CONF"; fi

STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
VIDEO_DIR="$STORAGE_PATH/videos"
QUALITY="${VIDEO_QUALITY:-720}"  # 480, 720, 1080
LOG_DIR="$STORAGE_PATH/.logs"

while [[ $# -gt 0 ]]; do
    case $1 in
        --storage) STORAGE_PATH="$2"; VIDEO_DIR="$2/videos"; shift 2 ;;
        --quality) QUALITY="$2"; shift 2 ;;
        *) shift ;;
    esac
done

mkdir -p "$VIDEO_DIR"/{survival,medical,food,water,shelter,energy,tools,farming,skills,preparedness,animal_husbandry,psychology}
mkdir -p "$LOG_DIR"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${BLUE}[VIDEO]${NC} $*"; }
success() { echo -e "${GREEN}[VIDEO]${NC} $*"; }
warn()    { echo -e "${YELLOW}[VIDEO]${NC} $*"; }
error()   { echo -e "${RED}[VIDEO]${NC} $*" >&2; }

check_disk_space() {
    local required_gb="${1:-50}"
    local available_gb
    if ! available_gb=$(df -BG "$STORAGE_PATH" 2>/dev/null | tail -1 | awk '{print $4}' | tr -d 'G'); then
        error "Failed to check disk space at $STORAGE_PATH"; exit 1
    fi
    if ! [[ "$available_gb" =~ ^[0-9]+$ ]]; then
        error "Unexpected df output: '$available_gb'"; exit 1
    fi
    info "Disk space: ${available_gb}GB available (need at least ${required_gb}GB)"
    if (( available_gb < required_gb )); then
        error "Less than ${required_gb}GB free on $STORAGE_PATH. Aborting video downloads."
        exit 1
    fi
}

# Verify downloaded videos have non-trivial size; record broken/empty files
# to the failed log so the user knows which channels/playlists need a re-run.
check_downloads() {
    local failed_log="$LOG_DIR/videos_failed.log"
    : > "$failed_log"
    local broken=0
    # Treat files < 100 KB as broken (trailing .part leftovers, 0-byte stubs).
    while IFS= read -r -d '' f; do
        local sz
        sz=$(stat -c %s "$f" 2>/dev/null || echo 0)
        if (( sz < 102400 )); then
            echo "$(date -Iseconds) SIZE=$sz $f" >> "$failed_log"
            broken=$((broken + 1))
        fi
    done < <(find "$VIDEO_DIR" -type f \( -name "*.mp4" -o -name "*.part" \) -print0)
    if (( broken > 0 )); then
        warn "$broken broken/partial video file(s) detected. See $failed_log"
    fi
    return 0
}

# ── yt-dlp download function ──────────────────────────────────────────────────
dl_playlist() {
    local category="$1"
    local name="$2"
    local url="$3"
    local dest="$VIDEO_DIR/$category"

    info "[$category] $name"
    local BW_ARGS=()
    [[ "${SURVIVE_BANDWIDTH_LIMIT:-0}" != "0" ]] && BW_ARGS=(--limit-rate "${SURVIVE_BANDWIDTH_LIMIT}")
    # Security flags:
    # --restrict-filenames : strip path separators / specials from remote-controlled
    #                        %(playlist_title)s / %(title)s before they hit disk.
    # --no-exec            : ignore any remote-injected post-processor commands.
    # --no-config          : ignore attacker-plantable config files in the cwd.
    # --no-overwrites      : never overwrite existing files (prevents clobber).
    # --socket-timeout     : unblock hung sockets so the script can continue.
    # Per-file success is verified downstream by check_downloads().
    yt-dlp "${YTDLP_AUTH[@]}" \
        --format "bestvideo[height<=${QUALITY}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${QUALITY}][ext=mp4]/best" \
        --merge-output-format mp4 \
        --embed-thumbnail \
        --embed-metadata \
        --add-metadata \
        --write-info-json \
        --write-thumbnail \
        --restrict-filenames \
        --no-exec \
        --no-config \
        --no-overwrites \
        --socket-timeout 30 \
        --download-archive "$LOG_DIR/${category}_archive.txt" \
        --output "$dest/%(playlist_title)s/%(playlist_index)s - %(title)s.%(ext)s" \
        --ignore-errors \
        --no-warnings \
        --concurrent-fragments 4 \
        --throttled-rate 1M \
        "${BW_ARGS[@]}" \
        "$url" \
    && success "[$category] $name done" \
    || warn "[$category] $name had errors (some videos may have been geo-blocked)"
}


# ── YouTube authentication ────────────────────────────────────────────────────
# YouTube now answers many automated requests with "Sign in to confirm you're
# not a bot". Supply credentials via config/survive.conf:
#   SURVIVE_YTDLP_COOKIES="/home/pi/yt_cookies.txt"   # exported cookies file
#   SURVIVE_YTDLP_BROWSER="chromium"                  # or read them live
# Without either, downloads are attempted anyway (some videos still work) and
# blocked items are skipped rather than aborting the run.
_ytdlp_auth_args() {
    if [[ -n "${SURVIVE_YTDLP_COOKIES:-}" ]] && [[ -f "${SURVIVE_YTDLP_COOKIES}" ]]; then
        printf '%s\n--cookies\n%s' "" "${SURVIVE_YTDLP_COOKIES}"
    elif [[ -n "${SURVIVE_YTDLP_BROWSER:-}" ]]; then
        printf '%s\n--cookies-from-browser\n%s' "" "${SURVIVE_YTDLP_BROWSER}"
    fi
}
mapfile -t YTDLP_AUTH < <(_ytdlp_auth_args)
# Drop the leading empty element produced when no auth is configured.
[[ ${#YTDLP_AUTH[@]} -gt 0 ]] && [[ -z "${YTDLP_AUTH[0]}" ]] && YTDLP_AUTH=("${YTDLP_AUTH[@]:1}")
if [[ ${#YTDLP_AUTH[@]} -eq 0 ]]; then
    echo "[WARN] No YouTube credentials configured (SURVIVE_YTDLP_COOKIES /" >&2
    echo "[WARN] SURVIVE_YTDLP_BROWSER in survive.conf). Blocked videos will be" >&2
    echo "[WARN] skipped -- see docs/TROUBLESHOOTING.md 'YouTube bot check'." >&2
fi

dl_channel() {
    local category="$1"
    local name="$2"
    local url="$3"
    local max="${4:-100}"  # max videos per channel

    info "[$category] Channel: $name (max $max videos)"
    local BW_ARGS=()
    [[ "${SURVIVE_BANDWIDTH_LIMIT:-0}" != "0" ]] && BW_ARGS=(--limit-rate "${SURVIVE_BANDWIDTH_LIMIT}")
    yt-dlp "${YTDLP_AUTH[@]}" \
        --format "bestvideo[height<=${QUALITY}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${QUALITY}]/best" \
        --merge-output-format mp4 \
        --embed-metadata \
        --write-info-json \
        --restrict-filenames \
        --no-exec \
        --no-config \
        --no-overwrites \
        --socket-timeout 30 \
        --download-archive "$LOG_DIR/${category}_archive.txt" \
        --output "$VIDEO_DIR/$category/%(channel)s/%(title)s.%(ext)s" \
        --playlist-end "$max" \
        --ignore-errors \
        --no-warnings \
        "${BW_ARGS[@]}" \
        "$url" \
    && success "[$category] $name done" \
    || warn "[$category] $name had some errors"
}

# ── Curated survival content ──────────────────────────────────────────────────

# General Survival Skills
dl_survival() {
    info "=== General Survival ==="
    dl_channel "survival" "Canadian Prepper" \
        "https://www.youtube.com/@CanadianPrepper/videos" 200
    dl_channel "survival" "SensiblePrepper" \
        "https://www.youtube.com/@SensiblePrepper/videos" 150
    dl_channel "survival" "City Prepping" \
        "https://www.youtube.com/@cityprepping/videos" 150
    dl_channel "survival" "Survival Lilly" \
        "https://www.youtube.com/@SurvivalLilly/videos" 100
    dl_channel "survival" "Corporals Corner" \
        "https://www.youtube.com/@CorporalsCorner/videos" 100
    dl_channel "survival" "Primitive Technology" \
        "https://www.youtube.com/@primitivetechnology9550/videos" 50
}

# Medical & First Aid
dl_medical() {
    info "=== Medical & First Aid ==="
    dl_channel "medical" "Medcram Medical" \
        "https://www.youtube.com/@MedCram/videos" 200
    dl_channel "medical" "Wilderness Medical Associates" \
        "https://www.youtube.com/@WildernessMA/videos" 100
    dl_channel "medical" "Rethink Survival Medical" \
        "https://www.youtube.com/@RethinkSurvival/videos" 50
    dl_channel "medical" "Doom and Bloom Survival Medicine" \
        "https://www.youtube.com/@DoomandBloom/videos" 100
    dl_channel "medical" "The Patriot Nurse" \
        "https://www.youtube.com/@ThePatriotNurse/videos" 100
    dl_channel "medical" "Skinny Medic TCCC" \
        "https://www.youtube.com/@SkinnyMedic/videos" 100
    dl_channel "medical" "Lone Star Medics" \
        "https://www.youtube.com/@LoneStarMedics/videos" 50
    dl_playlist "medical" "Stop the Bleed Official" \
        "https://www.youtube.com/playlist?list=PLUHBLmZ-rPXKlFmS7gZO77Lft5WT8DXH4"
    dl_playlist "medical" "FEMA First Aid" \
        "https://www.youtube.com/playlist?list=PL56C96E2FBDB2CCEA"
}

# Animal Husbandry (chickens, goats, pigs, cattle, rabbits)
dl_animal_husbandry() {
    info "=== Animal Husbandry ==="
    dl_channel "animal_husbandry" "Weed em and Reap (chickens/goats)" \
        "https://www.youtube.com/@WeedEmandReap/videos" 200
    dl_channel "animal_husbandry" "Prairie Homestead (goats/cattle)" \
        "https://www.youtube.com/@theprairiehomestead/videos" 150
    dl_channel "animal_husbandry" "Jill Winger Old Fashioned On Purpose" \
        "https://www.youtube.com/@jillwinger/videos" 100
    dl_channel "animal_husbandry" "Becky's Homestead (rabbits/chickens)" \
        "https://www.youtube.com/@BeckysHomestead/videos" 100
    dl_channel "animal_husbandry" "Homestead Corner (goats)" \
        "https://www.youtube.com/@HomesteadCorner/videos" 100
    dl_channel "animal_husbandry" "Kathy Voth Small-Scale Grazing" \
        "https://www.youtube.com/@KathyVoth/videos" 50
}

# Food Production & Preservation
dl_food() {
    info "=== Food & Agriculture ==="
    dl_channel "food" "The Elliott Homestead" \
        "https://www.youtube.com/@TheElliottHomestead/videos" 200
    dl_channel "food" "Justin Rhodes Homesteading" \
        "https://www.youtube.com/@JustinRhodes/videos" 150
    dl_channel "food" "Homesteading Family" \
        "https://www.youtube.com/@HomesteadingFamily/videos" 200
    dl_channel "food" "Townsends Historical Cooking" \
        "https://www.youtube.com/@Townsends/videos" 200
    dl_channel "farming" "Charles Dowding No-Dig" \
        "https://www.youtube.com/@CharlesDowding1/videos" 200
    dl_channel "farming" "Back to Reality (permaculture)" \
        "https://www.youtube.com/@BacktoReality/videos" 100
    dl_channel "farming" "OSU Extension" \
        "https://www.youtube.com/@OSUExtension/videos" 100
}

# Water Procurement & Purification
dl_water() {
    info "=== Water & Purification ==="
    dl_channel "water" "The Prepared" \
        "https://www.youtube.com/@ThePrepared/videos" 50
    dl_playlist "water" "Water Purification Methods" \
        "https://www.youtube.com/playlist?list=PLK2c-rTCIuqJAXKNNGOJr8xShz5HgONzj"
}

# Shelter & Construction
dl_shelter() {
    info "=== Shelter & Construction ==="
    dl_channel "shelter" "Essential Craftsman" \
        "https://www.youtube.com/@EssentialCraftsman/videos" 150
    dl_channel "shelter" "Matt Risinger Build" \
        "https://www.youtube.com/@MattRisinger/videos" 100
    dl_channel "shelter" "Log Cabin Builders" \
        "https://www.youtube.com/@LogCabinBuilders/videos" 50
    dl_channel "shelter" "Stoney Ridge Farmer" \
        "https://www.youtube.com/@stoneyridgefarmer/videos" 100
}

# Energy & Power
dl_energy() {
    info "=== Energy & Power ==="
    dl_channel "energy" "LDSPrepper Solar" \
        "https://www.youtube.com/@LDSPrepper/videos" 100
    dl_channel "energy" "Will Prowse Solar" \
        "https://www.youtube.com/@WillProwse/videos" 150
    dl_channel "energy" "Off Grid with Doug & Stacy" \
        "https://www.youtube.com/@OffGridwithDougStacy/videos" 150
    dl_channel "energy" "BPS Solar" \
        "https://www.youtube.com/@BPSsolar/videos" 50
}

# Tools & Repair
dl_tools() {
    info "=== Tools & Repair ==="
    dl_channel "tools" "This Old House" \
        "https://www.youtube.com/@thisoldhouse/videos" 200
    dl_channel "tools" "Paul Sellers Woodworking" \
        "https://www.youtube.com/@PaulSellersWoodworking/videos" 150
    dl_channel "tools" "AvE Engineering" \
        "https://www.youtube.com/@avoandace/videos" 100
    dl_channel "tools" "Clickspring Metalwork" \
        "https://www.youtube.com/@clickspring/videos" 50
}

# Preparedness & Comms
dl_preparedness() {
    info "=== Preparedness & Communications ==="
    dl_channel "preparedness" "Ham Radio Crash Course" \
        "https://www.youtube.com/@HamRadioCrashCourse/videos" 200
    dl_channel "preparedness" "Survival Dispatch" \
        "https://www.youtube.com/@SurvivalDispatch/videos" 100
    dl_channel "preparedness" "ITS Tactical" \
        "https://www.youtube.com/@ITSTactical/videos" 100
    dl_channel "preparedness" "FEMA Ready" \
        "https://www.youtube.com/@FEMAReady/videos" 50
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    info "Starting video downloads to $VIDEO_DIR"
    info "Quality: ${QUALITY}p"
    check_disk_space 50

    if [[ "${CONTENT_VIDEOS:-Y}" =~ [Yy] ]]; then
        dl_survival
        dl_medical
        dl_animal_husbandry
        dl_food
        dl_water
        dl_shelter
        dl_energy
        dl_tools
        dl_preparedness
    fi

    check_downloads
    success "Video download complete"
    du -sh "$VIDEO_DIR" 2>/dev/null || true
    info "Note: Rerun to download new videos (archive file prevents duplicates)"
}

main "$@"
