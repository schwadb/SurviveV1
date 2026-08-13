#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Mental Health & Psychological First Aid downloader
# Covers: disaster psychology, grief, resilience, PFA, community mental health
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
[[ -f "$_CONF" ]] || _CONF="${_CONF}.example"   # fall back to shipped defaults
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF -- using defaults" >&2; else source "$_CONF"; fi

STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
PDF_DIR="$STORAGE_PATH/pdfs/psychology"
VIDEO_DIR="$STORAGE_PATH/videos/psychology"
LOG_DIR="$STORAGE_PATH/.logs"

while [[ $# -gt 0 ]]; do
    case $1 in
        --storage) STORAGE_PATH="$2"; PDF_DIR="$2/pdfs/psychology"; VIDEO_DIR="$2/videos/psychology"; shift 2 ;;
        *) shift ;;
    esac
done

mkdir -p "$PDF_DIR" "$VIDEO_DIR" "$LOG_DIR"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${BLUE}[MENTAL]${NC} $*"; }
success() { echo -e "${GREEN}[MENTAL]${NC} $*"; }
warn()    { echo -e "${YELLOW}[MENTAL]${NC} $*"; }

FAILED_LOG="$LOG_DIR/failed_downloads.log"


# Many .gov/.org sites now reject non-browser clients (HTTP 403) or have moved
# files (404). Two mitigations, in order:
#   1. present a normal browser User-Agent
#   2. fall back to the Wayback Machine, which keeps byte-identical snapshots
#      ("id_" returns the original file, without the archive toolbar)
SURVIVE_UA="Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

_fetch() {  # _fetch <url> <dest-file>
    wget -q --show-progress --tries=3 --timeout=60 \
        --user-agent="$SURVIVE_UA" -O "$2" "$1"
}

# A blocked or moved request often returns an HTML page with HTTP 200. Saving
# that as a .pdf/.epub hides the failure until someone opens it — Standard
# Ebooks did exactly this, producing six "books" that were XHTML pages and
# made Calibre fail with "File is not a zip file".
_is_valid_download() {
    [[ -s "$1" ]] || return 1
    local magic
    case "${1,,}" in
        *.pdf)
            [[ "$(head -c 4 "$1" 2>/dev/null)" == "%PDF" ]] ;;
        *.epub|*.mobi|*.azw3|*.zip)
            # EPUB/AZW3 are ZIP containers -> "PK"; MOBI starts with its own
            # header, so accept either rather than rejecting valid files.
            magic=$(head -c 2 "$1" 2>/dev/null)
            [[ "$magic" == "PK" ]] || head -c 68 "$1" 2>/dev/null | grep -q "BOOKMOBI" ;;
        *)
            return 0 ;;   # unknown type: size check only
    esac
}

# Try the original URL, then its most recent Wayback snapshot.
_fetch_with_fallback() {  # _fetch_with_fallback <url> <dest-file> <name>
    if _fetch "$1" "$2" && _is_valid_download "$2"; then
        return 0
    fi
    rm -f "$2"
    echo "  [$3] direct download failed -- trying the Wayback Machine..." >&2
    if _fetch "https://web.archive.org/web/2id_/$1" "$2" && _is_valid_download "$2"; then
        return 0
    fi
    rm -f "$2"
    return 1
}

dl_file() {
    local name="$1" url="$2" dest="$3"
    local filename="${4:-$(basename "$url" | tr '?&=' '_')}"
    [[ -f "$dest/$filename" ]] && { info "[$name] Already exists"; return 0; }
    info "Downloading: $name"
    if _fetch_with_fallback "$url" "$dest/$filename" "$name"; then
        success "$name saved"
    else
        warn "$name failed"
        echo "$(date '+%Y-%m-%d %H:%M:%S') FAILED [$name] $url" >> "$FAILED_LOG"
    fi
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
    local name="$1" url="$2" max="${3:-100}"
    info "[VIDEO] $name (max $max)"
    local BW_ARGS=()
    [[ "${SURVIVE_BANDWIDTH_LIMIT:-0}" != "0" ]] && BW_ARGS=(--limit-rate "${SURVIVE_BANDWIDTH_LIMIT}")
    yt-dlp "${YTDLP_AUTH[@]}" \
        --format "bestvideo[height<=720][ext=mp4]+bestaudio/best[height<=720]/best" \
        --merge-output-format mp4 \
        --embed-metadata \
        --download-archive "$LOG_DIR/psychology_archive.txt" \
        --output "$VIDEO_DIR/%(channel)s/%(title)s.%(ext)s" \
        --playlist-end "$max" \
        --ignore-errors --no-warnings \
        "${BW_ARGS[@]}" "$url" \
        && success "$name done" || warn "$name had errors"
}

# ── WHO / UN Psychological First Aid ─────────────────────────────────────────
dl_pfa() {
    info "=== Psychological First Aid (PFA) ==="

    dl_file "WHO Psychological First Aid Field Guide" \
        "https://apps.who.int/iris/bitstream/handle/10665/44615/9789241548205_eng.pdf" \
        "$PDF_DIR" "WHO_PFA_Field_Guide.pdf"

    dl_file "WHO PFA Facilitator Manual" \
        "https://apps.who.int/iris/bitstream/handle/10665/44427/9789241548809_eng.pdf" \
        "$PDF_DIR" "WHO_PFA_Facilitator_Manual.pdf"

    dl_file "UNHCR Community Mental Health Guide" \
        "https://www.unhcr.org/media/community-mental-health-guide-humanitarian-settings" \
        "$PDF_DIR" "UNHCR_Community_Mental_Health.pdf" || true

    dl_file "IASC Guidelines on Mental Health in Emergencies" \
        "https://interagencystandingcommittee.org/system/files/2020-11/IASC%20Guidelines%20on%20Mental%20Health%20and%20Psychosocial%20Support%20in%20Emergency%20Settings.pdf" \
        "$PDF_DIR" "IASC_MHPSS_Guidelines.pdf"
}

# ── CDC / NIOSH Disaster Psychology ──────────────────────────────────────────
dl_disaster_psych() {
    info "=== Disaster Psychology ==="

    dl_file "CDC NIOSH Trauma and Recovery" \
        "https://www.cdc.gov/niosh/docs/2004-101/pdfs/2004-101.pdf" \
        "$PDF_DIR" "CDC_NIOSH_Trauma_Recovery.pdf"

    dl_file "SAMHSA Disaster Behavioral Health Guide" \
        "https://store.samhsa.gov/sites/default/files/pep21-01-01-001.pdf" \
        "$PDF_DIR" "SAMHSA_Disaster_Behavioral_Health.pdf"

    dl_file "FEMA Crisis Counseling Guide" \
        "https://www.fema.gov/sites/default/files/2020-07/fema_ccp_guidance-manual.pdf" \
        "$PDF_DIR" "FEMA_Crisis_Counseling.pdf"
}

# ── Community Resilience ──────────────────────────────────────────────────────
dl_resilience() {
    info "=== Resilience & Community Care ==="

    dl_file "Sphere Standards — Protection & MHPSS" \
        "https://spherestandards.org/wp-content/uploads/Sphere-Handbook-2018-EN.pdf" \
        "$PDF_DIR" "Sphere_Handbook_MHPSS.pdf"

    dl_file "Building Community Resilience Toolkit (CDC)" \
        "https://www.cdc.gov/cpr/resiliencetoolkit/pdf/Community_Resilience_Toolkit.pdf" \
        "$PDF_DIR" "CDC_Community_Resilience_Toolkit.pdf"

    # Hesperian: Where There Is No Psychiatrist (open access)
    dl_file "Where There Is No Psychiatrist (Patel)" \
        "https://www.rcpsych.ac.uk/docs/default-source/members/faculties/international/where-there-is-no-psychiatrist.pdf" \
        "$PDF_DIR" "Where_There_Is_No_Psychiatrist.pdf" || \
    warn "Download Hesperian psychiatry guide manually from rcpsych.ac.uk"
}

# ── Grief & Loss ──────────────────────────────────────────────────────────────
dl_grief() {
    info "=== Grief, Loss & Bereavement ==="

    dl_file "Red Cross Grief Support Guide" \
        "https://www.redcross.org/content/dam/redcross/atg/PDF_s/Preparedness___Disaster_Recovery/Disaster_Preparedness/Coping_with_Grief_and_Loss.pdf" \
        "$PDF_DIR" "RedCross_Grief_Guide.pdf"
}

# ── Video channels ────────────────────────────────────────────────────────────
dl_psych_videos() {
    info "=== Psychology & Mental Health Videos ==="

    dl_channel "Psych2Go Resilience" \
        "https://www.youtube.com/@Psych2Go/videos" 100

    dl_channel "The School of Life" \
        "https://www.youtube.com/@theschooloflifetv/videos" 100

    dl_channel "Medscape Psychology" \
        "https://www.youtube.com/@MedscapeCME/search?query=disaster+psychology" 30
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    info "Downloading mental health & psychological first aid content..."

    dl_pfa
    dl_disaster_psych
    dl_resilience
    dl_grief
    dl_psych_videos

    success "Mental health content download complete"
    info "PDFs: $PDF_DIR"
    du -sh "$PDF_DIR" 2>/dev/null || true

    # Index the new documents' text for dashboard search + AI retrieval.
    python3 "$REPO_DIR/scripts/index_documents.py" --storage "$STORAGE_PATH" || true
}

main "$@"
