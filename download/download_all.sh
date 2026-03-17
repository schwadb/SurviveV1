#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Master content download orchestrator
# Usage: bash download_all.sh [--storage /mnt/survive] [--resume] [--dry-run]
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$REPO_DIR/config/survive.conf" 2>/dev/null || true

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

DOWNLOAD_DIR="$STORAGE_PATH"
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
mark_done() { echo "$1" >> "$PROGRESS_FILE"; }
is_done()   { grep -qxF "$1" "$PROGRESS_FILE" 2>/dev/null; }

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

    # Download each category if enabled and not done
    if [[ -z "$CATEGORY" ]] || [[ "$CATEGORY" == "kiwix" ]]; then
        run_or_dry bash "$REPO_DIR/download/kiwix_content.sh" \
            --storage "$STORAGE_PATH" \
            $([ "$RESUME" == "true" ] && echo "--resume")
    fi

    if [[ -z "$CATEGORY" ]] || [[ "$CATEGORY" == "videos" ]]; then
        [[ "${CONTENT_VIDEOS:-Y}" =~ [Yy] ]] && \
        run_or_dry bash "$REPO_DIR/download/videos.sh" --storage "$STORAGE_PATH"
    fi

    if [[ -z "$CATEGORY" ]] || [[ "$CATEGORY" == "books" ]]; then
        [[ "${CONTENT_GUTENBERG:-Y}" =~ [Yy] ]] && \
        run_or_dry bash "$REPO_DIR/download/books_pdfs.sh" --storage "$STORAGE_PATH"
    fi

    if [[ -z "$CATEGORY" ]] || [[ "$CATEGORY" == "maps" ]]; then
        [[ "${CONTENT_MAPS:-Y}" =~ [Yy] ]] && \
        run_or_dry bash "$REPO_DIR/download/maps.sh" --storage "$STORAGE_PATH"
    fi

    if [[ -z "$CATEGORY" ]] || [[ "$CATEGORY" == "kolibri" ]]; then
        [[ "${CONTENT_KOLIBRI:-Y}" =~ [Yy] ]] && \
        run_or_dry bash "$REPO_DIR/download/kolibri_content.sh" --storage "$STORAGE_PATH"
    fi

    # Gap-filling content from expert research
    if [[ -z "$CATEGORY" ]] || [[ "$CATEGORY" == "gaps" ]]; then
        run_or_dry bash "$REPO_DIR/download/gaps_content.sh" --storage "$STORAGE_PATH"
    fi

    section "Download Complete"
    df -h "$STORAGE_PATH"
    success "All selected content downloaded to $STORAGE_PATH"
    info "Start services: bash scripts/start_services.sh"
}

main "$@"
