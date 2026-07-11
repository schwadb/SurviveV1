#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Update all content to latest versions
# Run this when internet is available to fetch updates
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF -- using defaults" >&2; else source "$_CONF"; fi

STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${BLUE}[UPDATE]${NC} $*"; }
success() { echo -e "${GREEN}[UPDATE]${NC} $*"; }
warn()    { echo -e "${YELLOW}[UPDATE]${NC} $*"; }

# Check internet
check_internet() {
    ping -c 1 -W 3 8.8.8.8 &>/dev/null || {
        warn "No internet connection. Connect to internet to update content."
        exit 1
    }
    success "Internet connection available"
}

main() {
    info "SurviveV1 Content Updater"
    check_internet

    # Update git repo itself
    info "Updating SurviveV1 scripts..."
    local branch
    branch=$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
    git -C "$REPO_DIR" pull --rebase origin "$branch" \
        && success "Scripts updated (branch: $branch)" || warn "Git pull failed"

    # Update yt-dlp
    info "Updating yt-dlp..."
    yt-dlp --update && success "yt-dlp updated" || warn "yt-dlp update failed"

    # Update Ollama models
    if command -v ollama &>/dev/null; then
        info "Checking for Ollama model updates..."
        OLLAMA_MODELS="$STORAGE_PATH/ai_models/ollama" \
        ollama list 2>/dev/null | tail -n +2 | awk '{print $1}' | \
        while read -r model; do
            info "Updating $model..."
            OLLAMA_MODELS="$STORAGE_PATH/ai_models/ollama" ollama pull "$model" \
                && success "$model updated" || warn "$model update failed"
        done
    fi

    # Update new YouTube videos (yt-dlp archive prevents re-downloading)
    if [[ "${CONTENT_VIDEOS:-Y}" =~ [Yy] ]]; then
        info "Checking for new survival videos..."
        bash "$REPO_DIR/download/videos.sh" --storage "$STORAGE_PATH"
    fi

    # Re-register any new ZIM files
    if command -v kiwix-manage &>/dev/null; then
        info "Updating Kiwix library..."
        KIWIX_LIBRARY="$STORAGE_PATH/.kiwix_library.xml"
        while IFS= read -r -d '' zimfile; do
            kiwix-manage "$KIWIX_LIBRARY" add "$zimfile" 2>/dev/null || true
        done < <(find "$STORAGE_PATH/zim" -name "*.zim" -print0 2>/dev/null)
        success "Kiwix library updated"
    fi

    success "Content update complete"
}

main "$@"
