#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Kiwix ZIM file downloader
# Downloads Wikipedia, Wikibooks, Stack Exchange, iFixit, Gutenberg, and more
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
[[ -f "$_CONF" ]] || _CONF="${_CONF}.example"   # fall back to shipped defaults
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF -- using defaults" >&2; else source "$_CONF"; fi

STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
ZIM_DIR="$STORAGE_PATH/zim"
ONLY_PACKAGE=""
UPDATE_MODE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --storage) STORAGE_PATH="$2"; ZIM_DIR="$2/zim"; shift 2 ;;
        --resume)  shift ;;  # aria2c --continue=true handles resume automatically
        --update)  UPDATE_MODE=true; shift ;;
        --only)    ONLY_PACKAGE="$2"; shift 2 ;;
        *) shift ;;
    esac
done

mkdir -p "$ZIM_DIR"/{wikipedia,reference,education,medicine,skills,books}

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${BLUE}[KIWIX]${NC} $*"; }
success() { echo -e "${GREEN}[KIWIX]${NC} $*"; }
warn()    { echo -e "${YELLOW}[KIWIX]${NC} $*"; }

# Failed-downloads log: listed at the end and honoured by the exit code so
# the user/ci notices silent corruption rather than trusting a "done" marker.
FAILED_LOG="$ZIM_DIR/.failed_downloads.log"
: > "$FAILED_LOG" 2>/dev/null || true

mark_failed() { echo "$(date -Iseconds) $1 :: $2" >> "$FAILED_LOG"; }

# Download a ZIM, then validate size and checksum BEFORE treating the download
# as successful. A partial/corrupt file is removed so the next run re-fetches.
# ZIM snapshots carry a build date (…_2026-02.zim) and Kiwix deletes old ones
# from the mirror, so any pinned filename eventually 404s. Given a pinned URL,
# return the same file's newest available build. Falls back to the pinned URL
# (returns non-zero) when the listing can't be fetched — e.g. no internet.
resolve_zim_url() {
    local url="$1" dir base prefix listing latest
    dir="${url%/*}"            # …/zim/wikipedia
    base="${url##*/}"          # wikipedia_en_all_maxi_2024-01.zim
    prefix="${base%_*.zim}"    # wikipedia_en_all_maxi
    prefix="${prefix//./\\.}"  # escape dots (foo.stackexchange.com_en_all)
    listing=$(curl -sL --max-time 30 "$dir/" 2>/dev/null) || return 1
    latest=$(grep -oE "${prefix}_[0-9]{4}-[0-9]{2}\.zim" <<< "$listing" \
             | sort -u | tail -1)
    [[ -n "$latest" ]] || return 1
    echo "$dir/$latest"
}

download_zim() {
    local name="$1"
    local url="$2"
    local dest_dir="$3"

    # Swap the pinned build for whatever is currently published.
    local resolved
    if resolved=$(resolve_zim_url "$url"); then
        if [[ "$resolved" != "$url" ]]; then
            info "[$name] Current build: $(basename "$resolved")"
            url="$resolved"
        fi
    else
        warn "[$name] Could not list the mirror — trying the pinned URL"
    fi

    local filename
    filename=$(basename "$url")
    local dest="$dest_dir/$filename"

    # Never download a ZIM we already have. Files may live at a different
    # path than today's layout expects (the directory structure has changed
    # over time), and a re-run must not fetch a second 100+ GB copy of a
    # title it already owns. A file mid-download (an .aria2 sidecar exists)
    # doesn't count — aria2c resumes it below.
    local existing="" cand
    while IFS= read -r -d '' cand; do
        [[ -f "$cand.aria2" ]] && continue
        existing="$cand"; break
    done < <(find "$ZIM_DIR" -type f -name "$filename" -print0 2>/dev/null)
    if [[ -n "$existing" ]]; then
        success "[$name] Already downloaded: $existing"
        return 0
    fi

    # Same title, different build date. Keep the copy we have unless the
    # user explicitly asked for updates with --update — silently pulling a
    # fresh build would duplicate huge files.
    if [[ "$UPDATE_MODE" != "true" ]]; then
        local prefix_glob="${filename%_*.zim}_[0-9][0-9][0-9][0-9]-[0-9][0-9].zim"
        while IFS= read -r -d '' cand; do
            [[ -f "$cand.aria2" ]] && continue
            existing="$cand"; break
        done < <(find "$ZIM_DIR" -type f -name "$prefix_glob" -print0 2>/dev/null)
        if [[ -n "$existing" ]]; then
            info "[$name] Existing build kept: $existing"
            info "[$name] (re-run with --update to fetch newer builds;"
            info "[$name]  delete the old build afterwards to reclaim space)"
            return 0
        fi
    fi

    info "[$name] Downloading to $dest..."
    local BW_ARGS=()
    [[ "${SURVIVE_BANDWIDTH_LIMIT:-0}" != "0" ]] && BW_ARGS=(--max-overall-download-limit="${SURVIVE_BANDWIDTH_LIMIT}")

    if ! aria2c \
            --continue=true \
            --max-connection-per-server=4 \
            --split=4 \
            --dir="$dest_dir" \
            --out="$filename" \
            --console-log-level=warn \
            --summary-interval=60 \
            "${BW_ARGS[@]}" \
            "$url"; then
        warn "[$name] aria2c exited non-zero -- will retry next run"
        mark_failed "$name" "aria2c exit"
        return 1
    fi

    # Minimum plausible ZIM is ~1 MB -- anything smaller is a 404 page
    # or a truncated download masquerading as success.
    local sz
    sz=$(stat -c %s "$dest" 2>/dev/null || echo 0)
    if (( sz < 1048576 )); then
        warn "[$name] File too small (${sz} bytes) -- removing stub"
        rm -f "$dest"
        mark_failed "$name" "size=$sz"
        return 1
    fi

    # Checksum validation: ZIM mirrors publish .sha256 sidecars. A missing
    # sidecar is logged as a warning (network or mirror issue), but a
    # MISMATCH deletes the file so the next run re-downloads cleanly.
    local sha_url="${url%.zim}.sha256"
    local sha_file
    sha_file=$(mktemp)
    if ! wget -q -O "$sha_file" "$sha_url" 2>/dev/null || ! [[ -s "$sha_file" ]]; then
        warn "[$name] No checksum sidecar at $sha_url -- size check only"
        rm -f "$sha_file"
        success "[$name] Done: $filename (size OK, no checksum available)"
        return 0
    fi
    # Replace the path in the sidecar with our local filename so sha256sum
    # can find the target file regardless of what the mirror labelled it.
    local expected
    expected=$(awk '{print $1; exit}' "$sha_file")
    echo "$expected  $dest" > "$sha_file"
    if sha256sum -c "$sha_file" &>/dev/null; then
        success "[$name] Checksum OK"
        rm -f "$sha_file"
        return 0
    else
        warn "[$name] Checksum MISMATCH -- deleting corrupt file"
        rm -f "$dest" "$sha_file"
        mark_failed "$name" "checksum mismatch"
        return 1
    fi
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
            "$KIWIX_MIRROR/wikipedia/wikipedia_en_all_maxi_2026-02.zim" \
            "$ZIM_DIR/wikipedia"
    fi

    if [[ "${CONTENT_WIKIPEDIA_NOPIC:-N}" =~ [Yy] ]]; then
        info "=== Wikipedia (No pictures) ==="
        # No-picture version ~22GB
        download_zim "Wikipedia EN (no-pic)" \
            "$KIWIX_MIRROR/wikipedia/wikipedia_en_all_nopic_2026-06.zim" \
            "$ZIM_DIR/wikipedia"
    fi
}

# ── Wikibooks + Wikivoyage + Wikisource ──────────────────────────────────────
dl_wikibooks() {
    [[ -n "$ONLY_PACKAGE" ]] && [[ "$ONLY_PACKAGE" != "wikibooks" ]] && return
    [[ "${CONTENT_WIKIBOOKS:-Y}" =~ [Yy] ]] || return

    info "=== Wikibooks, Wikivoyage, Wikisource ==="
    download_zim "Wikibooks EN" \
        "$KIWIX_MIRROR/wikibooks/wikibooks_en_all_maxi_2026-04.zim" \
        "$ZIM_DIR/reference"
    download_zim "Wikivoyage EN" \
        "$KIWIX_MIRROR/wikivoyage/wikivoyage_en_all_maxi_2026-06.zim" \
        "$ZIM_DIR/reference"
    download_zim "Wikisource EN" \
        "$KIWIX_MIRROR/wikisource/wikisource_en_all_maxi_2026-05.zim" \
        "$ZIM_DIR/reference"
    download_zim "Wiktionary EN" \
        "$KIWIX_MIRROR/wiktionary/wiktionary_en_all_nopic_2026-05.zim" \
        "$ZIM_DIR/reference"
}

# ── iFixit repair guides ──────────────────────────────────────────────────────
dl_ifix() {
    [[ -n "$ONLY_PACKAGE" ]] && [[ "$ONLY_PACKAGE" != "ifix" ]] && return
    [[ "${CONTENT_IFIX:-Y}" =~ [Yy] ]] || return

    info "=== iFixit Repair Guides ==="
    download_zim "iFixit EN" \
        "$KIWIX_MIRROR/ifixit/ifixit_en_all_2025-12.zim" \
        "$ZIM_DIR/skills"
}

# ── Stack Exchange ─────────────────────────────────────────────────────────────
dl_stackexchange() {
    [[ -n "$ONLY_PACKAGE" ]] && [[ "$ONLY_PACKAGE" != "stackexchange" ]] && return
    [[ "${CONTENT_STACKEXCHANGE:-Y}" =~ [Yy] ]] || return

    info "=== Stack Exchange collections ==="
    declare -A SE_PACKAGES=(
        ["Stack Overflow"]="$KIWIX_MIRROR/stack_exchange/stackoverflow.com_en_all_2023-11.zim"
        ["Super User"]="$KIWIX_MIRROR/stack_exchange/superuser.com_en_all_2026-02.zim"
        ["DIY"]="$KIWIX_MIRROR/stack_exchange/diy.stackexchange.com_en_all_2026-02.zim"
        ["Cooking"]="$KIWIX_MIRROR/stack_exchange/cooking.stackexchange.com_en_all_2026-02.zim"
        ["Ham Radio"]="$KIWIX_MIRROR/stack_exchange/ham.stackexchange.com_en_all_2026-02.zim"
        ["Outdoors"]="$KIWIX_MIRROR/stack_exchange/outdoors.stackexchange.com_en_all_2026-02.zim"
        ["Gardening"]="$KIWIX_MIRROR/stack_exchange/gardening.stackexchange.com_en_all_2026-02.zim"
        ["Medical Sciences"]="$KIWIX_MIRROR/stack_exchange/medicalsciences.stackexchange.com_en_all_2026-02.zim"
        ["Sustainability"]="$KIWIX_MIRROR/stack_exchange/sustainability.stackexchange.com_en_all_2026-02.zim"
        ["Biology"]="$KIWIX_MIRROR/stack_exchange/biology.stackexchange.com_en_all_2026-02.zim"
        ["Chemistry"]="$KIWIX_MIRROR/stack_exchange/chemistry.stackexchange.com_en_all_2026-02.zim"
        ["Physics"]="$KIWIX_MIRROR/stack_exchange/physics.stackexchange.com_en_all_2026-02.zim"
        ["Engineering"]="$KIWIX_MIRROR/stack_exchange/engineering.stackexchange.com_en_all_2026-02.zim"
        ["Electronics"]="$KIWIX_MIRROR/stack_exchange/electronics.stackexchange.com_en_all_2026-02.zim"
        ["Unix/Linux"]="$KIWIX_MIRROR/stack_exchange/unix.stackexchange.com_en_all_2026-02.zim"
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
        "$KIWIX_MIRROR/gutenberg/gutenberg_en_all_2025-11.zim" \
        "$ZIM_DIR/books"
}

# ── Khan Academy (Kiwix version) ──────────────────────────────────────────────
dl_khan() {
    [[ -n "$ONLY_PACKAGE" ]] && [[ "$ONLY_PACKAGE" != "khan" ]] && return

    info "=== Khan Academy (Kiwix mini versions) ==="
    # Note: Full Khan Academy via Kolibri is preferred. These are smaller ZIM versions.
    download_zim "Khan Academy EN" \
        "$KIWIX_MIRROR/other/khanacademy_en_all_2023-03.zim" \
        "$ZIM_DIR/education"
}

# ── Medical resources ─────────────────────────────────────────────────────────
dl_medical() {
    [[ -n "$ONLY_PACKAGE" ]] && [[ "$ONLY_PACKAGE" != "medical" ]] && return

    info "=== Medical References ==="
    download_zim "Medline Plus" \
        "$KIWIX_MIRROR/zimit/medlineplus.gov_en_all_2025-01.zim" \
        "$ZIM_DIR/medicine"
    download_zim "WikiMed" \
        "$KIWIX_MIRROR/other/mdwiki_en_all_maxi_2025-11.zim" \
        "$ZIM_DIR/medicine"
}

# ── TED Talks ─────────────────────────────────────────────────────────────────
# These ZIMs carry the actual talk videos, playable offline in the browser —
# the reliable video source now that YouTube blocks automated downloads.
dl_ted() {
    [[ -n "$ONLY_PACKAGE" ]] && [[ "$ONLY_PACKAGE" != "ted" ]] && return

    info "=== TED Talks (offline video) ==="
    download_zim "TED Technology" \
        "$KIWIX_MIRROR/ted/ted_mul_technology_2026-01.zim" \
        "$ZIM_DIR/education"
    download_zim "TED Health Care" \
        "$KIWIX_MIRROR/ted/ted_mul_health-care_2026-04.zim" \
        "$ZIM_DIR/education"
    download_zim "TED Public Health" \
        "$KIWIX_MIRROR/ted/ted_mul_public-health_2026-04.zim" \
        "$ZIM_DIR/education"
    download_zim "TED Mental Health" \
        "$KIWIX_MIRROR/ted/ted_mul_mental-health_2026-05.zim" \
        "$ZIM_DIR/education"
    download_zim "TED Science" \
        "$KIWIX_MIRROR/ted/ted_mul_science_2026-05.zim" \
        "$ZIM_DIR/education"
}

# ── Expansion pack: purpose-built survival + off-grid + education ZIMs ───────
# Curated additions for machines with spare space (~7 GB total). The zimgit-*
# collections are Kiwix's own hand-picked disaster libraries.
dl_expansion() {
    [[ -n "$ONLY_PACKAGE" ]] && [[ "$ONLY_PACKAGE" != "expansion" ]] && return
    [[ "${CONTENT_EXPANSION:-Y}" =~ [Yy] ]] || return

    info "=== Expansion pack: survival collections ==="
    download_zim "Post-disaster Library" \
        "$KIWIX_MIRROR/other/zimgit-post-disaster_en_2024-05.zim" \
        "$ZIM_DIR/skills"
    download_zim "Emergency Medicine Collection" \
        "$KIWIX_MIRROR/other/zimgit-medicine_en_2024-08.zim" \
        "$ZIM_DIR/medicine"
    download_zim "Water Purification Collection" \
        "$KIWIX_MIRROR/other/zimgit-water_en_2024-08.zim" \
        "$ZIM_DIR/skills"
    download_zim "Food Preparation Collection" \
        "$KIWIX_MIRROR/other/zimgit-food-preparation_en_2025-04.zim" \
        "$ZIM_DIR/skills"
    download_zim "Knots Guide" \
        "$KIWIX_MIRROR/other/zimgit-knots_en_2024-08.zim" \
        "$ZIM_DIR/skills"

    info "=== Expansion pack: off-grid living ==="
    download_zim "Appropedia (appropriate technology)" \
        "$KIWIX_MIRROR/other/appropedia_en_all_maxi_2026-02.zim" \
        "$ZIM_DIR/skills"
    download_zim "Energypedia (off-grid energy)" \
        "$KIWIX_MIRROR/other/energypedia_en_all_maxi_2026-06.zim" \
        "$ZIM_DIR/skills"

    info "=== Expansion pack: education ==="
    download_zim "PhET Science Simulations" \
        "$KIWIX_MIRROR/phet/phet_en_all_2026-05.zim" \
        "$ZIM_DIR/education"
    download_zim "Wikiversity EN" \
        "$KIWIX_MIRROR/wikiversity/wikiversity_en_all_maxi_2026-05.zim" \
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
    dl_expansion

    register_zims

    if [[ -s "$FAILED_LOG" ]]; then
        warn "Some downloads failed -- see $FAILED_LOG"
        echo "---"
        cat "$FAILED_LOG"
        echo "---"
        info "Re-run this script to retry failed items."
        du -sh "$ZIM_DIR" 2>/dev/null || true
        exit 2
    fi

    success "Kiwix content download complete"
    info "ZIM files: $ZIM_DIR"
    du -sh "$ZIM_DIR" 2>/dev/null || true
}

main "$@"
