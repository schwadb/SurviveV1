#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — rclone cloud storage setup
# Configures Google Drive, Dropbox, S3, and other cloud providers
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF — using defaults" >&2; else source "$_CONF"; fi

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${BLUE}[SYNC]${NC} $*"; }
success() { echo -e "${GREEN}[SYNC]${NC} $*"; }
warn()    { echo -e "${YELLOW}[SYNC]${NC} $*"; }

# ── Ensure rclone is installed ────────────────────────────────────────────────
install_rclone() {
    if ! command -v rclone &>/dev/null; then
        info "Installing rclone..."
        curl -fsSL https://rclone.org/install.sh | bash
    fi
    success "rclone $(rclone version | head -1)"
}

# ── Interactive cloud provider setup ─────────────────────────────────────────
setup_provider() {
    local provider="$1"

    case "$provider" in
        gdrive|google)
            info "Setting up Google Drive..."
            echo ""
            echo "  Steps:"
            echo "  1. Run: rclone config"
            echo "  2. Choose: n (new remote)"
            echo "  3. Name: gdrive"
            echo "  4. Type: 18 (Google Drive)"
            echo "  5. Follow OAuth flow (requires temporary internet)"
            echo "  6. Choose 'Full access'"
            echo ""
            echo "  Then run: bash sync/sync_to_cloud.sh gdrive"
            ;;
        dropbox)
            info "Setting up Dropbox..."
            echo ""
            echo "  Steps:"
            echo "  1. Run: rclone config"
            echo "  2. Choose: n (new remote)"
            echo "  3. Name: dropbox"
            echo "  4. Type: 8 (Dropbox)"
            echo "  5. Follow OAuth flow"
            ;;
        s3|aws)
            info "Setting up Amazon S3..."
            echo ""
            read -rp "  AWS Access Key ID: " AWS_KEY
            read -rsp "  AWS Secret Key: " AWS_SECRET
            echo ""
            read -rp "  Region [us-east-1]: " AWS_REGION
            AWS_REGION="${AWS_REGION:-us-east-1}"

            rclone config create s3 s3 \
                provider=AWS \
                access_key_id="$AWS_KEY" \
                secret_access_key="$AWS_SECRET" \
                region="$AWS_REGION" \
                && success "S3 configured as 'S3'"
            ;;
        backblaze|b2)
            info "Setting up Backblaze B2..."
            echo ""
            read -rp "  Application Key ID: " B2_KEY
            read -rsp "  Application Key: " B2_SECRET
            echo ""
            rclone config create b2 b2 \
                account="$B2_KEY" \
                key="$B2_SECRET" \
                && success "Backblaze B2 configured"
            ;;
        onedrive)
            info "Setting up Microsoft OneDrive..."
            echo ""
            echo "  Steps:"
            echo "  1. Run: rclone config"
            echo "  2. Choose: n (new remote)"
            echo "  3. Name: onedrive"
            echo "  4. Type: 26 (Microsoft OneDrive)"
            echo "  5. Follow OAuth flow"
            ;;
        *)
            info "Launching interactive rclone config..."
            rclone config
            ;;
    esac
}

# ── List configured remotes ───────────────────────────────────────────────────
list_remotes() {
    info "Configured cloud remotes:"
    rclone listremotes 2>/dev/null || echo "  None configured yet"
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    install_rclone

    if [[ $# -eq 0 ]]; then
        echo ""
        echo "Cloud Storage Setup for SurviveV1"
        echo ""
        echo "  Supported providers:"
        echo "    gdrive    — Google Drive (15GB free)"
        echo "    dropbox   — Dropbox (2GB free)"
        echo "    s3        — Amazon S3"
        echo "    b2        — Backblaze B2 (10GB free)"
        echo "    onedrive  — Microsoft OneDrive (5GB free)"
        echo "    custom    — Interactive rclone config"
        echo ""
        echo "  Usage: bash sync/setup_rclone.sh <provider>"
        echo "  Then:  bash sync/sync_to_cloud.sh <remote_name>"
        echo ""
        list_remotes
        return 0
    fi

    setup_provider "${1:-custom}"
    list_remotes
}

main "$@"
