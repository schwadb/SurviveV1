#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Build/refresh the Calibre e-book library
#
# Calibre-Web (cps) cannot serve a plain folder of EPUBs — it needs a real
# Calibre library (a metadata.db created by calibredb). This script builds that
# library from every ebook under books/ and is safe to re-run after each
# download (idempotent via --automerge=ignore).
#
# Usage: bash scripts/build_ebook_library.sh
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
# Capture an explicitly-set env override before sourcing the conf, so a caller
# (or test) passing SURVIVE_STORAGE_PATH= wins over the conf's baked-in default.
_ENV_STORAGE="${SURVIVE_STORAGE_PATH:-}"
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF -- using defaults" >&2; else source "$_CONF"; fi

STORAGE_PATH="${_ENV_STORAGE:-${SURVIVE_STORAGE_PATH:-/mnt/survive}}"
BOOKS_DIR="$STORAGE_PATH/books"
LIBRARY="$BOOKS_DIR/calibre-library"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${BLUE}[EBOOK]${NC} $*"; }
success() { echo -e "${GREEN}[EBOOK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[EBOOK]${NC} $*"; }
error()   { echo -e "${RED}[EBOOK]${NC} $*" >&2; }

# ── Preconditions ─────────────────────────────────────────────────────────────
if ! command -v calibredb &>/dev/null; then
    error "calibredb not found. Install Calibre first:  sudo apt-get install -y calibre"
    exit 1
fi

mkdir -p "$BOOKS_DIR"

# calibredb cannot write the library while calibre-web holds it open — pause it.
CALIBRE_WAS_RUNNING=false
if command -v systemctl &>/dev/null && systemctl is-active --quiet calibre-web 2>/dev/null; then
    CALIBRE_WAS_RUNNING=true
    info "Pausing calibre-web while the library is updated..."
    systemctl stop calibre-web 2>/dev/null || true
fi
restore_calibre() {
    if [[ "$CALIBRE_WAS_RUNNING" == "true" ]]; then
        info "Restarting calibre-web..."
        systemctl start calibre-web 2>/dev/null || true
    fi
}
trap restore_calibre EXIT

# ── Add ebooks (idempotent) ───────────────────────────────────────────────────
# --automerge=ignore skips books already present, so re-runs add only new files.
# Prune the library dir itself so we never re-ingest Calibre's own copies.
info "Scanning $BOOKS_DIR for ebooks..."
mapfile -d '' EBOOKS < <(
    find "$BOOKS_DIR" -path "$LIBRARY" -prune -o \
        -type f \( -iname '*.epub' -o -iname '*.mobi' -o -iname '*.azw3' \) -print0
)

if [[ ${#EBOOKS[@]} -eq 0 ]]; then
    warn "No ebooks found under $BOOKS_DIR yet — nothing to import."
    warn "Download some first:  bash download/books_pdfs.sh"
    exit 0
fi

info "Importing ${#EBOOKS[@]} ebook file(s) into the library (existing ones are skipped)..."
calibredb add --with-library="$LIBRARY" --automerge=ignore -- "${EBOOKS[@]}" \
    || { error "calibredb add failed"; exit 1; }

# Ownership: the systemd unit runs cps as User=pi, which needs write access.
if [[ "$(id -u)" -eq 0 ]] && id pi &>/dev/null; then
    chown -R pi:pi "$LIBRARY"
fi

COUNT=$(calibredb --with-library="$LIBRARY" list 2>/dev/null | tail -n +2 | wc -l)
success "Library ready: ${COUNT} book(s) at $LIBRARY"
echo ""
info "In Calibre-Web (http://<host>:8083) on first run, set the database"
info "location to:  $LIBRARY"
info "Default login is  admin / admin123  — change it immediately."
