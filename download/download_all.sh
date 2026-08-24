#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Master content download orchestrator
# Usage: bash download_all.sh [--storage /mnt/survive] [--resume] [--dry-run]
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
[[ -f "$_CONF" ]] || _CONF="${_CONF}.example"   # fall back to shipped defaults
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF -- using defaults" >&2; else source "$_CONF"; fi

# ── Argument parsing ──────────────────────────────────────────────────────────
STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
RESUME=false
DRY_RUN=false
CATEGORY=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --storage) STORAGE_PATH="$2"; shift 2 ;;
        --resume)  RESUME=true; shift ;;
        --dry-run) DRY_RUN=true; shift ;;
        --only)    CATEGORY="$2"; shift 2 ;;
        *) echo "Unknown: $1"; shift ;;
    esac
done

LOG_DIR="$STORAGE_PATH/.logs"
mkdir -p "$LOG_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[DL]${NC} $*"; }
success() { echo -e "${GREEN}[DL]${NC} $*"; }
warn()    { echo -e "${YELLOW}[DL]${NC} $*"; }
error()   { echo -e "${RED}[DL]${NC} $*" >&2; }

section() {
    echo ""
    echo -e "${BLUE}══════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $*${NC}"
    echo -e "${BLUE}══════════════════════════════════════════════${NC}"
}

run_or_dry() {
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "[DRY-RUN] $*"
    else
        "$@"
    fi
}

# ── Disk space check ──────────────────────────────────────────────────────────
check_disk_space() {
    # Refuse to write onto the SD card. If the configured storage path is not
    # a real mountpoint, hundreds of GB of downloads land on the root
    # filesystem — and are then HIDDEN under the mount when the drive finally
    # appears, silently filling the card.
    if [[ "$STORAGE_PATH" == /mnt/* ]] && ! mountpoint -q "$STORAGE_PATH"; then
        error "$STORAGE_PATH is not a mounted drive — downloads would fill the SD card."
        error "Mount your storage first (sudo mount $STORAGE_PATH), or re-run the wizard:"
        error "  sudo bash install/wizard.sh"
        exit 1
    fi

    AVAILABLE_GB=$(df -BG "$STORAGE_PATH" | tail -1 | awk '{print $4}' | tr -d 'G')
    BUDGET_GB="${SURVIVE_BUDGET_GB:-800}"
    info "Available: ${AVAILABLE_GB}GB | Budget: ${BUDGET_GB}GB"
    if [[ "$AVAILABLE_GB" -lt 50 ]]; then
        error "Less than 50GB free on $STORAGE_PATH. Aborting."
        exit 1
    fi
}

# ── Progress tracking ─────────────────────────────────────────────────────────
PROGRESS_FILE="$STORAGE_PATH/.download_progress"
PROGRESS_LOCK="${PROGRESS_FILE}.lock"
mark_done() {
    (
        flock -x 200
        echo "$1" >> "$PROGRESS_FILE"
    ) 200>"$PROGRESS_LOCK"
}
is_done() {
    (
        flock -s 200
        grep -qxF "$1" "$PROGRESS_FILE" 2>/dev/null
    ) 200>"$PROGRESS_LOCK"
}

# ── Content size estimates ────────────────────────────────────────────────────
print_budget() {
    section "Download Budget Summary"
    printf "%-40s %10s\n" "Content" "Est. Size"
    printf "%-40s %10s\n" "--------" "---------"
    [[ "${CONTENT_WIKIPEDIA:-Y}" =~ [Yy] ]]      && printf "%-40s %10s\n" "Wikipedia EN (full)" "~100 GB"
    [[ "${CONTENT_WIKIPEDIA_NOPIC:-N}" =~ [Yy] ]] && printf "%-40s %10s\n" "Wikipedia EN (no pics)" "~20 GB"
    [[ "${CONTENT_WIKIBOOKS:-Y}" =~ [Yy] ]]       && printf "%-40s %10s\n" "Wikibooks + Wikivoyage" "~5 GB"
    [[ "${CONTENT_IFIX:-Y}" =~ [Yy] ]]            && printf "%-40s %10s\n" "iFixit repair guides" "~5 GB"
    [[ "${CONTENT_STACKEXCHANGE:-Y}" =~ [Yy] ]]   && printf "%-40s %10s\n" "Stack Exchange" "~80 GB"
    [[ "${CONTENT_GUTENBERG:-Y}" =~ [Yy] ]]       && printf "%-40s %10s\n" "Project Gutenberg" "~60 GB"
    [[ "${CONTENT_KOLIBRI:-Y}" =~ [Yy] ]]         && printf "%-40s %10s\n" "Khan Academy (Kolibri)" "~200 GB"
    [[ "${CONTENT_VIDEOS:-Y}" =~ [Yy] ]]          && printf "%-40s %10s\n" "Survival Videos" "~150 GB"
    [[ "${CONTENT_MAPS:-Y}" =~ [Yy] ]]            && printf "%-40s %10s\n" "OpenStreetMap World" "~70 GB"
    [[ "${CONTENT_PDFS:-Y}" =~ [Yy] ]]            && printf "%-40s %10s\n" "PDFs + Manuals" "~20 GB"
    [[ "${CONTENT_AI_MODELS:-Y}" =~ [Yy] ]]       && printf "%-40s %10s\n" "AI Models (Ollama)" "~50 GB"
    printf "%-40s %10s\n" "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "━━━━━━━━━"
    printf "%-40s %10s\n" "Total (approx)" "~800 GB"
    echo ""
}

# ── Main download dispatcher ──────────────────────────────────────────────────
main() {
    info "SurviveV1 Content Downloader"
    info "Storage: $STORAGE_PATH"
    info "Resume: $RESUME | Dry-run: $DRY_RUN"

    check_disk_space
    print_budget

    if [[ "$DRY_RUN" == "true" ]]; then
        info "Dry-run mode — no files downloaded"
        return 0
    fi

    # run_category <name> <enabled Y/N> <script> [extra args...]
    # With --resume, categories recorded in $PROGRESS_FILE are skipped; each
    # category is marked done only after its script exits successfully.
    run_category() {
        local name="$1" enabled="$2" script="$3"
        shift 3
        if [[ -n "$CATEGORY" ]] && [[ "$CATEGORY" != "$name" ]]; then return 0; fi
        if [[ ! "$enabled" =~ [Yy] ]]; then
            info "Skipping $name (disabled in survive.conf)"
            return 0
        fi
        if [[ "$RESUME" == "true" ]] && is_done "$name"; then
            info "Skipping $name (already completed — remove from $PROGRESS_FILE to redo)"
            return 0
        fi
        if run_or_dry bash "$REPO_DIR/download/$script" --storage "$STORAGE_PATH" "$@"; then
            [[ "$DRY_RUN" == "true" ]] || mark_done "$name"
        else
            warn "$name download failed — rerun with --resume to retry just the rest"
        fi
    }

    RESUME_FLAG=()
    [[ "$RESUME" == "true" ]] && RESUME_FLAG=(--resume)

    run_category kiwix         "Y"                          kiwix_content.sh "${RESUME_FLAG[@]}"
    run_category videos        "${CONTENT_VIDEOS:-Y}"       videos.sh
    run_category books         "${CONTENT_GUTENBERG:-Y}"    books_pdfs.sh
    run_category maps          "${CONTENT_MAPS:-Y}"         maps.sh
    run_category kolibri       "${CONTENT_KOLIBRI:-Y}"      kolibri_content.sh
    run_category gaps          "Y"                          gaps_content.sh
    run_category mental_health "Y"                          mental_health.sh
    run_category apps          "${CONTENT_APPS:-Y}"         app_depot.sh
    run_category drugs         "${CONTENT_DRUGS:-Y}"        drug_reference.sh

    # Invalidate the dashboard's filename search index so it rebuilds with the
    # newly downloaded files on the next /search.
    rm -f "$STORAGE_PATH/.search_index.db"

    section "Download Complete"
    df -h "$STORAGE_PATH"
    success "All selected content downloaded to $STORAGE_PATH"
    info "Start services: bash scripts/start_services.sh"
}

main "$@"
