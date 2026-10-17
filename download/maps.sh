#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Offline map downloader
# Downloads OpenStreetMap tiles and data for offline use
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
[[ -f "$_CONF" ]] || _CONF="${_CONF}.example"   # fall back to shipped defaults
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF -- using defaults" >&2; else source "$_CONF"; fi

STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
MAP_DIR="$STORAGE_PATH/maps"
REGION="${MAP_REGION:-north-america}"  # continent or country code

while [[ $# -gt 0 ]]; do
    case $1 in
        --storage) STORAGE_PATH="$2"; MAP_DIR="$2/maps"; shift 2 ;;
        --region)  REGION="$2"; shift 2 ;;
        *) shift ;;
    esac
done

# Validate region against known-good values
case "$REGION" in
    north-america|south-america|europe|africa|asia|australia-oceania|us|us-northeast|world) ;;
    *) echo "Unknown region '$REGION'. Valid: north-america south-america europe africa asia australia-oceania us us-northeast world" >&2; exit 1 ;;
esac

mkdir -p "$MAP_DIR"/{tiles,mbtiles,pmtiles,pbf,apps,USGS,sprites,fonts}

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${BLUE}[MAPS]${NC} $*"; }
success() { echo -e "${GREEN}[MAPS]${NC} $*"; }
warn()    { echo -e "${YELLOW}[MAPS]${NC} $*"; }
error()   { echo -e "${RED}[MAPS]${NC} $*" >&2; }

check_disk_space() {
    local required_gb="${1:-20}"
    local available_gb
    available_gb=$(df -BG "$STORAGE_PATH" | tail -1 | awk '{print $4}' | tr -d 'G')
    info "Disk space: ${available_gb}GB available (need at least ${required_gb}GB)"
    if [[ "$available_gb" -lt "$required_gb" ]]; then
        error "Less than ${required_gb}GB free on $STORAGE_PATH. Aborting map downloads."
        exit 1
    fi
}

# ── Install map tools ─────────────────────────────────────────────────────────
install_map_tools() {
    info "Installing offline map tools..."
    apt-get install -y -qq \
        osmium-tool \
        osm2pgsql \
        mbutil 2>/dev/null || true
    pip3 install -q mbtiles-tile-render 2>/dev/null || true
    success "Map tools installed"
}

# ── Install Organic Maps / OrganicMaps server (offline map viewer) ────────────
install_map_server() {
    info "Installing map tile server..."

    # Option 1: tileserver-gl (renders vector tiles)
    if command -v npm &>/dev/null; then
        npm install -g tileserver-gl-light 2>/dev/null && \
            success "tileserver-gl-light installed" || \
            warn "tileserver-gl install failed"
    fi

    # Option 2: Martin tile server (Rust-based, faster on Pi).
    # Resolved from the current release rather than pinned: the previously
    # hardcoded v0.14.3 asset now 404s, which left the Maps tile permanently
    # DOWN with no explanation.
    if command -v martin &>/dev/null; then
        success "Martin already installed"
    else
        MARTIN_URL=$(curl -fsSL --max-time 60 \
                https://api.github.com/repos/maplibre/martin/releases/latest 2>/dev/null \
            | grep -oE '"browser_download_url": *"[^"]+"' | cut -d'"' -f4 \
            | grep -iE "linux" | grep -iE "$(uname -m)|arm64" \
            | grep -E '\.tar\.gz$' | head -1) || true
        if [[ -n "${MARTIN_URL:-}" ]]; then
            TMP=$(mktemp -d)
            if wget -q "$MARTIN_URL" -O "$TMP/martin.tar.gz"; then
                tar -xzf "$TMP/martin.tar.gz" -C "$TMP"
                MARTIN_BIN=$(find "$TMP" -type f -name martin | head -1)
                if [[ -n "$MARTIN_BIN" ]]; then
                    install -m 0755 "$MARTIN_BIN" /usr/local/bin/martin
                    success "Martin tile server installed ($(basename "$MARTIN_URL"))"
                else
                    warn "No martin binary in the archive — using tileserver-gl"
                fi
            else
                warn "Martin download failed — using tileserver-gl"
            fi
            rm -rf "$TMP"
        else
            warn "No Martin release found for $(uname -m) — using tileserver-gl"
        fi
    fi
}

# ── Download OSM data ─────────────────────────────────────────────────────────
dl_osm_pbf() {
    info "=== OpenStreetMap PBF Data ==="
    info "Region: $REGION"

    # Geofabrik regional extracts (free)
    declare -A REGIONS=(
        ["north-america"]="https://download.geofabrik.de/north-america-latest.osm.pbf"
        ["south-america"]="https://download.geofabrik.de/south-america-latest.osm.pbf"
        ["europe"]="https://download.geofabrik.de/europe-latest.osm.pbf"
        ["africa"]="https://download.geofabrik.de/africa-latest.osm.pbf"
        ["asia"]="https://download.geofabrik.de/asia-latest.osm.pbf"
        ["australia-oceania"]="https://download.geofabrik.de/australia-oceania-latest.osm.pbf"
        ["us"]="https://download.geofabrik.de/north-america/us-latest.osm.pbf"
        ["us-northeast"]="https://download.geofabrik.de/north-america/us/new-england-latest.osm.pbf"
        ["world"]="https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf"
    )

    URL="${REGIONS[$REGION]:-${REGIONS['north-america']}}"

    info "Downloading: $URL"
    aria2c \
        --continue=true \
        --max-connection-per-server=4 \
        --dir="$MAP_DIR/pbf" \
        --out="${REGION}-latest.osm.pbf" \
        "$URL" \
    && success "OSM PBF downloaded" \
    || warn "OSM download failed"
}

# ── Download pre-rendered MBTiles ──────────────────────────────────────────────
# ── pmtiles CLI (needed to extract from the Protomaps planet build) ───────────
install_pmtiles_cli() {
    command -v pmtiles &>/dev/null && return 0
    info "Installing pmtiles CLI..."
    local url
    url=$(curl -fsSL --max-time 60 \
            https://api.github.com/repos/protomaps/go-pmtiles/releases/latest 2>/dev/null \
        | grep -oE '"browser_download_url": *"[^"]+"' | cut -d'"' -f4 \
        | grep -i linux | grep -iE 'arm64|aarch64' \
        | grep -iE '\.(tar\.gz|zip)$' | head -1) || true
    if [[ -z "$url" ]]; then
        warn "Could not resolve a pmtiles release for $(uname -m)"
        return 1
    fi
    local tmp; tmp=$(mktemp -d)
    if wget -q -O "$tmp/pmtiles.pkg" "$url"; then
        case "$url" in
            *.zip) unzip -q -o "$tmp/pmtiles.pkg" -d "$tmp" ;;
            *)     tar -xzf "$tmp/pmtiles.pkg" -C "$tmp" ;;
        esac
        local bin; bin=$(find "$tmp" -type f -name pmtiles | head -1)
        [[ -n "$bin" ]] && sudo install -m 0755 "$bin" /usr/local/bin/pmtiles
    fi
    rm -rf "$tmp"
    command -v pmtiles &>/dev/null && success "pmtiles CLI installed" \
        || { warn "pmtiles CLI install failed"; return 1; }
}

# The Protomaps project publishes a full-planet vector basemap daily at
# build.protomaps.com/YYYYMMDD.pmtiles. pmtiles-extract can pull just a zoom
# range or bounding box from it over HTTP, so the Pi downloads only what it
# keeps. Builds are retained for a limited window — walk back a few days.
resolve_protomaps_build() {
    if [[ -n "${PROTOMAPS_BUILD_URL:-}" ]]; then
        echo "$PROTOMAPS_BUILD_URL"; return 0
    fi
    local d url
    for i in 0 1 2 3 4 5 6 7 8 9; do
        d=$(date -u -d "-$i day" +%Y%m%d)
        url="https://build.protomaps.com/${d}.pmtiles"
        if curl -sfI --max-time 30 "$url" >/dev/null 2>&1; then
            echo "$url"; return 0
        fi
    done
    return 1
}

dl_mbtiles() {
    info "=== World basemap (Protomaps) ==="
    mkdir -p "$MAP_DIR/pmtiles"

    # The old source for world-overview.mbtiles (a personal GitHub repo) is
    # gone; if what's on disk is an HTML page saved as .mbtiles, drop it.
    local old="$MAP_DIR/mbtiles/world-overview.mbtiles"
    if [[ -f "$old" ]] && [[ "$(head -c 15 "$old" 2>/dev/null)" != "SQLite format 3" ]]; then
        warn "Removing invalid world-overview.mbtiles (was an HTML page, not tiles)"
        rm -f "$old"
    fi

    install_pmtiles_cli || { warn "Skipping basemap extract (no pmtiles CLI)"; return 0; }

    local build
    if ! build=$(resolve_protomaps_build); then
        warn "No Protomaps build reachable — check https://maps.protomaps.com/builds/"
        warn "and re-run with PROTOMAPS_BUILD_URL=<url> if the naming changed."
        return 0
    fi
    info "Using planet build: $build"

    # World overview: every zoom up to 6 is only a few hundred MB and gives a
    # navigable world map immediately.
    if [[ ! -f "$MAP_DIR/pmtiles/world-overview.pmtiles" ]]; then
        info "Extracting world overview (zoom 0-6)..."
        pmtiles extract "$build" "$MAP_DIR/pmtiles/world-overview.pmtiles" \
            --maxzoom=6 \
            && success "World overview ready" \
            || warn "World overview extract failed"
    else
        info "World overview already present"
    fi

    # Street-level tiles for the configured region only.
    local bbox=""
    case "$REGION" in
        north-america)     bbox="-170,7,-50,84" ;;
        south-america)     bbox="-93,-56,-32,13" ;;
        europe)            bbox="-25,34,45,72" ;;
        africa)            bbox="-19,-35,52,38" ;;
        asia)              bbox="25,-11,180,82" ;;
        australia-oceania) bbox="110,-48,180,-8" ;;
        us)                bbox="-125,24,-66,50" ;;
        us-northeast)      bbox="-80.6,40.4,-66.8,47.5" ;;
        world)             bbox="" ;;  # full planet: use the build directly
        none)              return 0 ;;
    esac

    local dest="$MAP_DIR/pmtiles/${REGION}-streets.pmtiles"
    if [[ -f "$dest" ]]; then
        info "Region tiles already present: $dest"
    elif [[ -n "$bbox" ]]; then
        info "Extracting street-level tiles for ${REGION} (this is tens of GB"
        info "and can take hours; resume by re-running this script)..."
        pmtiles extract "$build" "$dest" --bbox="$bbox" \
            && success "Region tiles ready: $dest" \
            || warn "Region extract failed — the overview map still works"
    elif [[ "$REGION" == "world" ]]; then
        warn "REGION=world: the full planet basemap is ~120 GB."
        warn "Download it explicitly if intended:"
        warn "  pmtiles extract $build $MAP_DIR/pmtiles/planet.pmtiles"
    fi
}

# ── OpenMapTiles schema setup ──────────────────────────────────────────────────
setup_tile_server() {
    info "=== Setting up tile server ==="

    # Minimal, schema-correct Martin config. Notes from debugging on-device:
    #  - listen_addresses is a STRING in the config schema, not a list
    #  - fonts is a plain list; the old "font: { paths: }" shape (and
    #    "sprite:") fail YAML deserialization and kill the service
    #  - directory paths under mbtiles/pmtiles auto-discover new files
    # Sprites/fonts are omitted entirely: the directories are empty and a
    # wrong shape here cost hours ("mismatched type or unexpected shape").
    cat > "$MAP_DIR/martin_config.yaml" <<CONF
# Martin Tile Server Configuration for SurviveV1 (generated by maps.sh)
listen_addresses: 0.0.0.0:3000

# Browsable tile catalog + map preview at http://<host>:3000
# (If an old Martin build rejects this key, delete this line.)
web_ui: enable-for-all

mbtiles:
  paths:
    - $MAP_DIR/mbtiles

pmtiles:
  paths:
    - $MAP_DIR/pmtiles
CONF
    success "Martin config: $MAP_DIR/martin_config.yaml"
}

# ── USGS Topographic Maps ──────────────────────────────────────────────────────
dl_usgs_topo() {
    info "=== USGS Topographic Maps ==="
    USGS_DIR="$MAP_DIR/USGS"

    # USGS National Map — use TNM API to download specific quads
    info "USGS Topo maps can be downloaded at: https://apps.nationalmap.gov/downloader/"
    info "Or use the USGS Bulk Download utility"

    # Download USGS TopoView API for a sample area (customize as needed)
    # This example downloads an index file — user can customize regions
    wget -q \
        "https://prd-tnm.s3.amazonaws.com/StagedProducts/Maps/HistoricalTopo/PDF/index.xml" \
        -O "$USGS_DIR/historical_topo_index.xml" 2>/dev/null || \
        warn "USGS index download failed — use the USGS National Map website"

    # Create helper script for custom USGS topo downloads
    cat > "$USGS_DIR/download_topo.sh" << 'USGS_SCRIPT'
#!/usr/bin/env bash
# Download USGS topo maps for a specific state
# Usage: bash download_topo.sh "Colorado"
STATE="${1:-Colorado}"
API="https://tnmaccess.nationalmap.gov/api/v1/products"
PARAMS="?datasets=National%20Elevation%20Dataset%20(NED)&prodFormats=IMG&bbox="

echo "Fetching topo maps for $STATE..."
curl -s "$API?datasets=Historical+Topographic+Maps&TNMRegion=$STATE&prodFormats=PDF&max=500" \
    | jq -r '.items[].downloadURL' \
    | head -50 \
    | xargs -P4 -I{} wget -q --continue -P ./topo_pdfs/ {}
echo "Done. Maps in ./topo_pdfs/"
USGS_SCRIPT
    chmod +x "$USGS_DIR/download_topo.sh"
    success "USGS topo helper at $USGS_DIR/download_topo.sh"
}

# ── Label fonts + POI sprites for the dashboard's map page ───────────────────
# web/templates/maps.html renders the PMTiles basemaps in the browser with
# MapLibre. Text labels need glyph files and POI icons need a sprite sheet;
# both are published as static assets by the Protomaps project. ~40 MB total.
MAP_ASSETS_BASE="https://protomaps.github.io/basemaps-assets"

dl_map_assets() {
    info "=== Map label fonts and sprites ==="
    local font range lo hi dest failed=0
    for font in "Noto Sans Regular" "Noto Sans Medium" "Noto Sans Italic"; do
        dest="$MAP_DIR/fonts/$font"
        mkdir -p "$dest"
        if [[ -f "$dest/65280-65535.pbf" ]] && [[ -f "$dest/0-255.pbf" ]]; then
            info "Font present: $font"
            continue
        fi
        info "Fetching glyphs: $font (256 files)..."
        for lo in $(seq 0 256 65280); do
            hi=$((lo + 255))
            range="${lo}-${hi}"
            [[ -s "$dest/$range.pbf" ]] && continue
            wget -q --timeout=30 --tries=2 -O "$dest/$range.pbf" \
                "$MAP_ASSETS_BASE/fonts/${font// /%20}/$range.pbf" \
                || { rm -f "$dest/$range.pbf"; failed=$((failed + 1)); }
        done
    done
    local variant f
    mkdir -p "$MAP_DIR/sprites/v4"
    for variant in dark light dark@2x light@2x; do
        for f in "$variant.json" "$variant.png"; do
            [[ -s "$MAP_DIR/sprites/v4/$f" ]] && continue
            wget -q --timeout=30 --tries=2 -O "$MAP_DIR/sprites/v4/$f" \
                "$MAP_ASSETS_BASE/sprites/v4/$f" \
                || { rm -f "$MAP_DIR/sprites/v4/$f"; failed=$((failed + 1)); }
        done
    done
    if (( failed > 0 )); then
        warn "$failed font/sprite files failed -- re-run to fill the gaps (labels may be missing)"
    else
        success "Fonts and sprites ready"
    fi
}

# ── Satellite imagery (world, zoom 0-6) ──────────────────────────────────────
# Internet-in-a-Box publishes a small world satellite layer (~25 MB) that the
# map page offers as an overlay. Higher-zoom imagery is not freely
# redistributable in bulk, so this stays a low-zoom context layer.
dl_satellite() {
    [[ "${CONTENT_SATELLITE:-Y}" =~ [Yy] ]] || return 0
    info "=== Satellite overlay (world, z0-6) ==="
    local dest="$MAP_DIR/pmtiles/satellite-world-z6.pmtiles"
    [[ -s "$dest" ]] && { info "Satellite overlay present"; return 0; }
    mkdir -p "$MAP_DIR/mbtiles" "$MAP_DIR/pmtiles"
    local mb="$MAP_DIR/mbtiles/satellite_z0-z6_2020.mbtiles"
    if [[ ! -s "$mb" ]]; then
        wget -q --timeout=60 --tries=3 -c -O "$mb" \
            "https://download.iiab.io/content/OSM/vector-tiles/satellite_z0-z6_2020.mbtiles" \
            || { rm -f "$mb"; warn "Satellite download failed"; return 0; }
    fi
    if [[ "$(head -c 15 "$mb" 2>/dev/null)" != "SQLite format 3" ]]; then
        warn "Satellite file is not a valid MBTiles archive -- removing"
        rm -f "$mb"; return 0
    fi
    if command -v pmtiles &>/dev/null; then
        pmtiles convert "$mb" "$dest" \
            && success "Satellite overlay ready: $dest" \
            || warn "pmtiles convert failed -- the overlay will stay off"
    else
        warn "pmtiles CLI missing -- satellite overlay needs it (re-run maps.sh)"
    fi
}

# ── US national park maps (official NPS PDFs) ────────────────────────────────
# NPMaps.com mirrors the public-domain National Park Service brochure, trail
# and topo PDFs for every park. We fetch the 63 "National Park" units, one
# page per park with a polite pause. ~2-3 GB in total.
NPS_PARKS=(acadia american-samoa arches badlands big-bend biscayne black-canyon
    bryce-canyon canyonlands capitol-reef carlsbad-caverns channel-islands congaree
    crater-lake cuyahoga-valley death-valley denali dry-tortugas everglades
    gates-of-the-arctic gateway-arch glacier glacier-bay grand-canyon grand-teton
    great-basin great-sand-dunes great-smoky-mountains guadalupe-mountains haleakala
    hawaii-volcanoes hot-springs indiana-dunes isle-royale joshua-tree katmai
    kenai-fjords kings-canyon kobuk-valley lake-clark lassen-volcanic mammoth-cave
    mesa-verde mount-rainier new-river-gorge north-cascades olympic petrified-forest
    pinnacles redwood rocky-mountain saguaro sequoia shenandoah theodore-roosevelt
    virgin-islands voyageurs white-sands wind-cave wrangell-st-elias yellowstone
    yosemite zion)

dl_nps_maps() {
    [[ "${CONTENT_NPS_MAPS:-Y}" =~ [Yy] ]] || return 0
    case "$REGION" in
        north-america|us|us-northeast|world) ;;
        *) info "Skipping US national park maps (region: $REGION)"; return 0 ;;
    esac
    info "=== US national park maps (${#NPS_PARKS[@]} parks) ==="
    local park dir page urls url name got=0 missed=0
    for park in "${NPS_PARKS[@]}"; do
        dir="$MAP_DIR/national_parks/$park"
        mkdir -p "$dir"
        page=$(curl -sL --max-time 40 -A "SurviveV1 offline map fetcher" \
               "https://npmaps.com/$park/" 2>/dev/null) || page=""
        urls=$(grep -oE 'https://npmaps\.com/wp-content/uploads/[^"]+\.pdf' <<< "$page" | sort -u || true)
        if [[ -z "$urls" ]]; then
            warn "  $park: no maps found (page unreachable?)"
            missed=$((missed + 1)); sleep 1; continue
        fi
        while IFS= read -r url; do
            name=$(basename "$url")
            [[ -s "$dir/$name" ]] && continue
            wget -q --timeout=60 --tries=2 -O "$dir/$name" "$url" \
                && got=$((got + 1)) || rm -f "$dir/$name"
        done <<< "$urls"
        info "  $park: $(find "$dir" -name '*.pdf' | wc -l) PDFs"
        sleep 1   # be a polite guest on a volunteer-run site
    done
    success "National park maps: $got new PDFs ($missed parks skipped)"
}

# ── Install Organic Maps for offline navigation ───────────────────────────────
setup_organic_maps_data() {
    info "=== Organic Maps data setup ==="
    ORGANIC_DIR="$MAP_DIR/organic_maps"
    mkdir -p "$ORGANIC_DIR"

    # Organic Maps (fork of Maps.me) uses its own data format
    # Available at organicmaps.app — downloaded directly to mobile device
    cat > "$ORGANIC_DIR/README.md" << 'EOF'
# Organic Maps Offline Data

Organic Maps provides the best offline navigation experience.

## Setup on your device:
1. Install Organic Maps: https://organicmaps.app
2. Open the app → Download Maps
3. Select your regions

## For Raspberry Pi web access:
- The map data lives on your phone/tablet
- Use the web tile server at http://localhost:3000 for browser-based maps

## OSM Extracts loaded into this system:
- See ../pbf/ for raw OSM data
- See ../mbtiles/ for pre-rendered tiles
- Tile server: http://localhost:3000/
EOF
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    info "Starting map downloads for region: $REGION"
    check_disk_space 20

    install_map_tools
    install_map_server
    dl_osm_pbf
    dl_mbtiles
    dl_map_assets
    dl_satellite
    setup_tile_server
    dl_usgs_topo
    dl_nps_maps
    setup_organic_maps_data

    success "Map setup complete"
    info "Map data: $MAP_DIR"
    info "Map page: http://localhost:8080/maps (no tile server needed)"
    du -sh "$MAP_DIR" 2>/dev/null || true
}

main "$@"
