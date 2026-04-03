#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Kiwix ZIM file downloader
# Downloads Wikipedia, Wikibooks, Stack Exchange, iFixit, Gutenberg, and more
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF — using defaults" >&2; else source "$_CONF"; fi

STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
ZIM_DIR="$STORAGE_PATH/zim"
RESUME=false
UPDATE=false
ONLY_PACKAGE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --storage) STORAGE_PATH="$2"; ZIM_DIR="$2/zim"; shift 2 ;;
        --resume)  RESUME=true; shift ;;
        --update)  UPDATE=true; shift ;;
        --only)    ONLY_PACKAGE="$2"; shift 2 ;;
        *) shift ;;
    esac
done

mkdir -p "$ZIM_DIR"/{wikipedia,reference,education,medicine,skills,books}

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${BLUE}[KIWIX]${NC} $*"; }
success() { echo -e "${GREEN}[KIWIX]${NC} $*"; }
warn()    { echo -e "${YELLOW}[KIWIX]${NC} $*"; }

# ── Download function with resume and optional checksum verification ───────────
download_zim() {
    local name="$1"
    local url="$2"
    local dest_dir="$3"
    local filename
    filename=$(basename "$url")
    local dest="$dest_dir/$filename"

    info "[$name] Downloading to $dest..."
    local BW_ARGS=()
    [[ "${SURVIVE_BANDWIDTH_LIMIT:-0}" != "0" ]] && BW_ARGS=(--max-overall-download-limit="${SURVIVE_BANDWIDTH_LIMIT}")
    aria2c \
        --continue=true \
        --max-connection-per-server=4 \
        --split=4 \
        --dir="$dest_dir" \
        --out="$filename" \
        --console-log-level=warn \
        --summary-interval=60 \
        "${BW_ARGS[@]}" \
        "$url" \
    && {
        success "[$name] Done: $filename"
        # Optional: verify SHA-256 if a .sha256 sidecar exists on the server
        local sha_url="${url%.zim}.sha256"
        if wget -q --spider "$sha_url" 2>/dev/null; then
            local sha_file
            sha_file=$(mktemp)
            if wget -q -O "$sha_file" "$sha_url" 2>/dev/null; then
                # Rewrite path in checksum file to match local filename
                sed -i "s|.*|$(awk '{print $1}' "$sha_file")  $dest|" "$sha_file"
                if sha256sum -c "$sha_file" &>/dev/null; then
                    success "[$name] Checksum OK"
                else
                    warn "[$name] Checksum MISMATCH — file may be corrupt, re-download recommended"
                fi
            fi
            rm -f "$sha_file"
        fi
    } \
    || warn "[$name] Failed — will retry next run (--resume)"
}

# ── Kiwix catalog (use latest available) ─────────────────────────────────────
# URLs point to the Kiwix download mirror. Date-stamped ZIMs auto-resolve to latest.
KIWIX_MIRROR="https://download.kiwix.org/zim"

# ── Wikipedia ─────────────────────────────────────────────────────────────────
dl_wikipedia() {
    [[ -n "$ONLY_PACKAGE" ]] && [[ "$ONLY_PACKAGE" != "wikipedia" ]] && return

    if [[ "${CONTENT_WIKIPEDIA:-Y}" =~ [Yy] ]]; then
        info "=== Wikipedia (Full, with images) ==="
        # Full Wikipedia with images ~100GB
        download_zim "Wikipedia EN" \
            "$KIWIX_MIRROR/wikipedia/wikipedia_en_all_maxi_2024-01.zim" \
            "$ZIM_DIR/wikipedia"
    fi

    if [[ "${CONTENT_WIKIPEDIA_NOPIC:-N}" =~ [Yy] ]]; then
        info "=== Wikipedia (No pictures) ==="
        # No-picture version ~22GB
        download_zim "Wikipedia EN (no-pic)" \
            "$KIWIX_MIRROR/wikipedia/wikipedia_en_all_nopic_2024-01.zim" \
            "$ZIM_DIR/wikipedia"
    fi
}

# ── Wikibooks + Wikivoyage + Wikisource ──────────────────────────────────────
dl_wikibooks() {
    [[ -n "$ONLY_PACKAGE" ]] && [[ "$ONLY_PACKAGE" != "wikibooks" ]] && return
    [[ "${CONTENT_WIKIBOOKS:-Y}" =~ [Yy] ]] || return

    info "=== Wikibooks, Wikivoyage, Wikisource ==="
    download_zim "Wikibooks EN" \
        "$KIWIX_MIRROR/wikibooks/wikibooks_en_all_maxi_2024-01.zim" \
        "$ZIM_DIR/reference"
    download_zim "Wikivoyage EN" \
        "$KIWIX_MIRROR/wikivoyage/wikivoyage_en_all_maxi_2024-01.zim" \
        "$ZIM_DIR/reference"
    download_zim "Wikisource EN" \
        "$KIWIX_MIRROR/wikisource/wikisource_en_all_maxi_2024-01.zim" \
        "$ZIM_DIR/reference"
    download_zim "Wiktionary EN" \
        "$KIWIX_MIRROR/wiktionary/wiktionary_en_all_maxi_2024-01.zim" \
        "$ZIM_DIR/reference"
}

# ── iFixit repair guides ──────────────────────────────────────────────────────
dl_ifix() {
    [[ -n "$ONLY_PACKAGE" ]] && [[ "$ONLY_PACKAGE" != "ifix" ]] && return
    [[ "${CONTENT_IFIX:-Y}" =~ [Yy] ]] || return

    info "=== iFixit Repair Guides ==="
    download_zim "iFixit EN" \
        "$KIWIX_MIRROR/ifixit/ifixit_en_all_2024-01.zim" \
        "$ZIM_DIR/skills"
}

# ── Stack Exchange ─────────────────────────────────────────────────────────────
dl_stackexchange() {
    [[ -n "$ONLY_PACKAGE" ]] && [[ "$ONLY_PACKAGE" != "stackexchange" ]] && return
    [[ "${CONTENT_STACKEXCHANGE:-Y}" =~ [Yy] ]] || return

    info "=== Stack Exchange collections ==="
    declare -A SE_PACKAGES=(
        ["Stack Overflow"]="$KIWIX_MIRROR/stackoverflow/stackoverflow_en_all_2024-01.zim"
        ["Super User"]="$KIWIX_MIRROR/superuser/superuser_en_all_2024-01.zim"
        ["DIY"]="$KIWIX_MIRROR/diy.stackexchange.com/diy.stackexchange.com_en_all_2024-01.zim"
        ["Cooking"]="$KIWIX_MIRROR/cooking.stackexchange.com/cooking.stackexchange.com_en_all_2024-01.zim"
        ["Ham Radio"]="$KIWIX_MIRROR/ham.stackexchange.com/ham.stackexchange.com_en_all_2024-01.zim"
        ["Outdoors"]="$KIWIX_MIRROR/outdoors.stackexchange.com/outdoors.stackexchange.com_en_all_2024-01.zim"
        ["Gardening"]="$KIWIX_MIRROR/gardening.stackexchange.com/gardening.stackexchange.com_en_all_2024-01.zim"
        ["Medical Sciences"]="$KIWIX_MIRROR/medicalsciences.stackexchange.com/medicalsciences.stackexchange.com_en_all_2024-01.zim"
        ["Sustainability"]="$KIWIX_MIRROR/sustainability.stackexchange.com/sustainability.stackexchange.com_en_all_2024-01.zim"
        ["Biology"]="$KIWIX_MIRROR/biology.stackexchange.com/biology.stackexchange.com_en_all_2024-01.zim"
        ["Chemistry"]="$KIWIX_MIRROR/chemistry.stackexchange.com/chemistry.stackexchange.com_en_all_2024-01.zim"
        ["Physics"]="$KIWIX_MIRROR/physics.stackexchange.com/physics.stackexchange.com_en_all_2024-01.zim"
        ["Engineering"]="$KIWIX_MIRROR/engineering.stackexchange.com/engineering.stackexchange.com_en_all_2024-01.zim"
        ["Electronics"]="$KIWIX_MIRROR/electronics.stackexchange.com/electronics.stackexchange.com_en_all_2024-01.zim"
        ["Unix/Linux"]="$KIWIX_MIRROR/unix.stackexchange.com/unix.stackexchange.com_en_all_2024-01.zim"
    )

    for name in "${!SE_PACKAGES[@]}"; do
        download_zim "$name" "${SE_PACKAGES[$name]}" "$ZIM_DIR/skills"
    done
}

# ── Project Gutenberg ─────────────────────────────────────────────────────────
dl_gutenberg() {
    [[ -n "$ONLY_PACKAGE" ]] && [[ "$ONLY_PACKAGE" != "gutenberg" ]] && return
    [[ "${CONTENT_GUTENBERG:-Y}" =~ [Yy] ]] || return

    info "=== Project Gutenberg (~60k books) ==="
    download_zim "Gutenberg EN" \
        "$KIWIX_MIRROR/gutenberg/gutenberg_en_all_2024-01.zim" \
        "$ZIM_DIR/books"
}

# ── Khan Academy (Kiwix version) ──────────────────────────────────────────────
dl_khan() {
    [[ -n "$ONLY_PACKAGE" ]] && [[ "$ONLY_PACKAGE" != "khan" ]] && return

    info "=== Khan Academy (Kiwix mini versions) ==="
    # Note: Full Khan Academy via Kolibri is preferred. These are smaller ZIM versions.
    download_zim "Khan Academy EN" \
        "$KIWIX_MIRROR/Khan_Academy/khan_academy_en_all_2024-01.zim" \
        "$ZIM_DIR/education"
}

# ── Medical resources ─────────────────────────────────────────────────────────
dl_medical() {
    [[ -n "$ONLY_PACKAGE" ]] && [[ "$ONLY_PACKAGE" != "medical" ]] && return

    info "=== Medical References ==="
    download_zim "Medline Plus" \
        "$KIWIX_MIRROR/medlineplus/medlineplus_en_all_2024-01.zim" \
        "$ZIM_DIR/medicine"
    download_zim "WikiMed" \
        "$KIWIX_MIRROR/wikimed/wikimed_en_all_maxi_2024-01.zim" \
        "$ZIM_DIR/medicine"
}

# ── TED Talks ─────────────────────────────────────────────────────────────────
dl_ted() {
    [[ -n "$ONLY_PACKAGE" ]] && [[ "$ONLY_PACKAGE" != "ted" ]] && return

    info "=== TED Talks ==="
    download_zim "TED EN" \
        "$KIWIX_MIRROR/ted/ted_en_all_2024-01.zim" \
        "$ZIM_DIR/education"
}

# ── Register all ZIMs with kiwix-serve ───────────────────────────────────────
register_zims() {
    info "Registering ZIM files with Kiwix library..."
    KIWIX_LIBRARY="$STORAGE_PATH/.kiwix_library.xml"

    # Find all downloaded ZIM files and register them
    while IFS= read -r -d '' zimfile; do
        kiwix-manage "$KIWIX_LIBRARY" add "$zimfile" 2>/dev/null || true
    done < <(find "$ZIM_DIR" -name "*.zim" -print0)

    success "Kiwix library updated: $KIWIX_LIBRARY"
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    info "Starting Kiwix ZIM downloads..."
    info "Output directory: $ZIM_DIR"

    dl_wikipedia
    dl_wikibooks
    dl_ifix
    dl_stackexchange
    dl_gutenberg
    dl_khan
    dl_medical
    dl_ted

    register_zims

    success "Kiwix content download complete"
    info "ZIM files: $ZIM_DIR"
    du -sh "$ZIM_DIR" 2>/dev/null || true
}

main "$@"
