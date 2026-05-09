#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Data integrity verification
# Generates/checks SHA256 checksums for all downloaded content to detect bit rot
# Usage: bash scripts/verify_integrity.sh [--generate | --check]
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF -- using defaults" >&2; else source "$_CONF"; fi

STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
MANIFEST="$STORAGE_PATH/.integrity_manifest.sha256"
LOG_DIR="$STORAGE_PATH/.logs"
REPORT="$LOG_DIR/integrity_report_$(date +%Y%m%d_%H%M%S).log"

mkdir -p "$LOG_DIR"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INTEGRITY]${NC} $*"; }
success() { echo -e "${GREEN}[INTEGRITY]${NC} $*"; }
warn()    { echo -e "${YELLOW}[INTEGRITY]${NC} $*"; }
error()   { echo -e "${RED}[INTEGRITY]${NC} $*" >&2; }

MODE="${1:---check}"

CONTENT_EXTS="-name *.zim -o -name *.pdf -o -name *.epub -o -name *.mp4 -o -name *.mbtiles -o -name *.pmtiles"

generate_manifest() {
    info "Generating integrity manifest for $STORAGE_PATH..."
    info "This may take a while for 800GB of content..."

    local tmp_manifest
    tmp_manifest=$(mktemp)
    local count=0

    while IFS= read -r -d '' f; do
        sha256sum "$f" >> "$tmp_manifest" 2>/dev/null && count=$((count + 1))
        if (( count % 100 == 0 )); then
            info "  $count files hashed..."
        fi
    done < <(find "$STORAGE_PATH" -type f \( $CONTENT_EXTS \) -print0 2>/dev/null)

    mv "$tmp_manifest" "$MANIFEST"
    chmod 644 "$MANIFEST"
    success "Manifest generated: $count files checksummed"
    success "Saved to: $MANIFEST"
    info "Run with --check periodically to detect bit rot"
}

check_manifest() {
    if [[ ! -f "$MANIFEST" ]]; then
        warn "No manifest found. Run with --generate first:"
        warn "  bash scripts/verify_integrity.sh --generate"
        exit 1
    fi

    info "Checking integrity against manifest..."
    info "Manifest: $MANIFEST"
    info "Report: $REPORT"

    local total=0 passed=0 failed=0 missing=0

    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        total=$((total + 1))

        local expected_hash filepath
        expected_hash=$(echo "$line" | awk '{print $1}')
        filepath=$(echo "$line" | sed 's/^[a-f0-9]*  //')

        if [[ ! -f "$filepath" ]]; then
            echo "MISSING: $filepath" >> "$REPORT"
            missing=$((missing + 1))
            continue
        fi

        local actual_hash
        actual_hash=$(sha256sum "$filepath" 2>/dev/null | awk '{print $1}')
        if [[ "$actual_hash" == "$expected_hash" ]]; then
            passed=$((passed + 1))
        else
            echo "CORRUPT: $filepath (expected=${expected_hash:0:16}... got=${actual_hash:0:16}...)" >> "$REPORT"
            failed=$((failed + 1))
        fi

        if (( total % 100 == 0 )); then
            info "  $total/$( wc -l < "$MANIFEST" ) files checked..."
        fi
    done < "$MANIFEST"

    echo "" >> "$REPORT"
    echo "Summary: $total checked, $passed OK, $failed CORRUPT, $missing MISSING" >> "$REPORT"

    info "Results: $total checked"
    success "  OK:      $passed"
    if (( failed > 0 )); then
        error "  CORRUPT: $failed"
    fi
    if (( missing > 0 )); then
        warn "  MISSING: $missing"
    fi

    if (( failed > 0 )); then
        error "Corruption detected! See: $REPORT"
        error "Re-download affected files to repair."
        exit 2
    elif (( missing > 0 )); then
        warn "Some files missing — see $REPORT"
        exit 1
    else
        success "All files verified — no corruption detected"
    fi
}

case "$MODE" in
    --generate|-g)
        generate_manifest
        ;;
    --check|-c)
        check_manifest
        ;;
    *)
        echo "Usage: bash scripts/verify_integrity.sh [--generate | --check]"
        echo ""
        echo "  --generate  Create SHA256 manifest of all content files"
        echo "  --check     Verify content against existing manifest"
        exit 0
        ;;
esac
