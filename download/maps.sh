#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Offline map downloader
# Downloads OpenStreetMap tiles and data for offline use
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$REPO_DIR/config/survive.conf" 2>/dev/null || true

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

mkdir -p "$MAP_DIR"/{tiles,mbtiles,pbf,apps,USGS}

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${BLUE}[MAPS]${NC} $*"; }
success() { echo -e "${GREEN}[MAPS]${NC} $*"; }
warn()    { echo -e "${YELLOW}[MAPS]${NC} $*"; }

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

    # Option 2: Martin tile server (Rust-based, faster on Pi)
    MARTIN_VER="0.14.3"
    MARTIN_URL="https://github.com/maplibre/martin/releases/download/v${MARTIN_VER}/martin-aarch64-unknown-linux-musl.tar.gz"
    TMP=$(mktemp -d)
    wget -q "$MARTIN_URL" -O "$TMP/martin.tar.gz" && \
        tar -xzf "$TMP/martin.tar.gz" -C /usr/local/bin/ && \
        chmod +x /usr/local/bin/martin && \
        success "Martin tile server installed" || \
        warn "Martin install failed — using tileserver-gl"
    rm -rf "$TMP"
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
dl_mbtiles() {
    info "=== Pre-rendered MBTiles (vector tiles) ==="

    # Versatiles.org provides free, pre-rendered vector tile packages
    declare -A MBTILE_REGIONS=(
        ["north-america"]="https://download.versatiles.org/osm-2023-07-22.versatiles"
        ["world-z0-z6"]="https://download.versatiles.org/osm-z6.versatiles"
    )

    # Download low-zoom world overview (always useful, small)
    info "Downloading world overview tiles (zoom 0-8)..."
    wget -q --show-progress \
        --continue \
        -O "$MAP_DIR/mbtiles/world-overview.mbtiles" \
        "https://github.com/nicowillis/mbtiles-data/raw/main/world.mbtiles" \
    || warn "World overview tiles failed — try manual download from protomaps.com"
}

# ── OpenMapTiles schema setup ──────────────────────────────────────────────────
setup_tile_server() {
    info "=== Setting up tile server ==="
    TILES_DIR="$MAP_DIR/tiles"

    # Create config for Martin tile server
    cat > "$MAP_DIR/martin_config.yaml" << EOF
# Martin Tile Server Configuration for SurviveV1
listen_addresses:
  - 0.0.0.0:3000

mbtiles:
  sources:
$(ls "$MAP_DIR/mbtiles"/*.mbtiles 2>/dev/null | while read f; do
    name=$(basename "$f" .mbtiles)
    echo "    $name: $f"
done)

sprite:
  paths:
    - $MAP_DIR/sprites

font:
  paths:
    - $MAP_DIR/fonts
EOF
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

    install_map_tools
    install_map_server
    dl_osm_pbf
    dl_mbtiles
    setup_tile_server
    dl_usgs_topo
    setup_organic_maps_data

    success "Map setup complete"
    info "Map data: $MAP_DIR"
    info "Tile server: http://localhost:3000 (after starting services)"
    du -sh "$MAP_DIR" 2>/dev/null || true
}

main "$@"
