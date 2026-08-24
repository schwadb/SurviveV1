#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Update all content to latest versions
# Run this when internet is available to fetch updates
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
[[ -f "$_CONF" ]] || _CONF="${_CONF}.example"   # fall back to shipped defaults
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

    # Update git repo itself — pull whatever branch this clone tracks, never
    # a hardcoded one (the repo may live on main, a fork, or a test branch).
    info "Updating SurviveV1 scripts..."
    local local_branch
    local_branch=$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "HEAD")
    if [[ "$local_branch" == "HEAD" ]]; then
        warn "Repo is on a detached HEAD -- skipping self-update"
    elif ! git -C "$REPO_DIR" diff --quiet 2>/dev/null; then
        warn "Repo has local uncommitted changes -- skipping self-update"
        warn "(a rebase over a dirty tree aborts mid-update; commit or stash first)"
    else
        git -C "$REPO_DIR" pull --rebase origin "$local_branch" \
            && success "Scripts updated ($local_branch)" || warn "Git pull failed"
    fi

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
        bash "$REPO_DIR/download/videos.sh" --storage "$STORAGE_PATH" \
            || warn "Video refresh finished with errors (see above)"
    fi

    # Fill gaps in the Kiwix library: newly-added catalog items, resumed
    # partials, missing titles. Deliberately NOT --update — replacing an
    # existing 100+ GB build is a manual decision, never a button press.
    info "Refreshing Kiwix library (new/missing content only)..."
    bash "$REPO_DIR/download/kiwix_content.sh" --storage "$STORAGE_PATH" \
        || warn "Kiwix refresh finished with errors (see above)"

    # Books and PDFs (existing files are skipped)
    if [[ "${CONTENT_PDFS:-Y}" =~ [Yy] ]]; then
        info "Refreshing books and PDFs..."
        bash "$REPO_DIR/download/books_pdfs.sh" --storage "$STORAGE_PATH" \
            || warn "books_pdfs finished with errors"
        bash "$REPO_DIR/download/gaps_content.sh" --storage "$STORAGE_PATH" \
            || warn "gaps_content finished with errors"
        bash "$REPO_DIR/download/mental_health.sh" --storage "$STORAGE_PATH" \
            || warn "mental_health finished with errors"
    fi

    # Refresh offline app installers (tracks newest Kiwix/VLC releases)
    if [[ "${CONTENT_APPS:-Y}" =~ [Yy] ]]; then
        info "Refreshing offline app depot..."
        bash "$REPO_DIR/download/app_depot.sh" --storage "$STORAGE_PATH" \
            || warn "app_depot finished with errors"
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

    # Rebuild the dashboard search index against the refreshed content.
    rm -f "$STORAGE_PATH/.search_index.db"

    # Incrementally index new documents for full-text search / AI retrieval.
    if command -v python3 &>/dev/null; then
        info "Updating document index..."
        python3 "$REPO_DIR/scripts/index_documents.py" --storage "$STORAGE_PATH" \
            || warn "Document indexing failed"
    fi

    # Newly registered ZIMs appear only after kiwix-serve reloads its library.
    # Works unattended only with passwordless sudo; otherwise just say so.
    if sudo -n systemctl restart kiwix 2>/dev/null; then
        success "Kiwix restarted — new content is live"
    else
        info "Restart Kiwix to see new library entries: sudo systemctl restart kiwix"
    fi

    success "Content update complete"
}

main "$@"
