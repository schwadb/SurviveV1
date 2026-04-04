#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Books and PDF downloader
# Downloads public domain and freely-licensed survival resources
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF -- using defaults" >&2; else source "$_CONF"; fi

STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
BOOKS_DIR="$STORAGE_PATH/books"
PDF_DIR="$STORAGE_PATH/pdfs"
LOG_DIR="$STORAGE_PATH/.logs"

while [[ $# -gt 0 ]]; do
    case $1 in
        --storage) STORAGE_PATH="$2"; BOOKS_DIR="$2/books"; PDF_DIR="$2/pdfs"; LOG_DIR="$2/.logs"; shift 2 ;;
        *) shift ;;
    esac
done

mkdir -p "$BOOKS_DIR"/{medicine,survival,agriculture,engineering,reference,fiction,skills}
mkdir -p "$PDF_DIR"/{military_manuals,homesteading,medicine,construction,farming,radio,legal}
mkdir -p "$LOG_DIR"

FAILED_LOG="$LOG_DIR/failed_downloads.log"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${BLUE}[BOOKS]${NC} $*"; }
success() { echo -e "${GREEN}[BOOKS]${NC} $*"; }
warn()    { echo -e "${YELLOW}[BOOKS]${NC} $*"; }

# ── Download with retry ───────────────────────────────────────────────────────
dl_file() {
    local name="$1"
    local url="$2"
    local dest="$3"
    local filename="${4:-$(basename "$url")}"

    if [[ -f "$dest/$filename" ]]; then
        info "[$name] Already exists, skipping"
        return 0
    fi

    info "Downloading: $name"
    wget -q --show-progress \
        --tries=3 \
        --timeout=60 \
        -O "$dest/$filename" \
        "$url" \
    && success "$name → $dest/$filename" \
    || {
        warn "$name download failed — may require manual download"
        echo "$(date '+%Y-%m-%d %H:%M:%S') FAILED [$name] $url" >> "$FAILED_LOG"
    }
}

# ── US Military Survival Manuals (Public Domain) ──────────────────────────────
dl_military_manuals() {
    info "=== US Military Survival Manuals ==="
    local DIR="$PDF_DIR/military_manuals"

    dl_file "FM 21-76 US Army Survival Manual" \
        "https://www.bits.de/NRANEU/others/amd-us-archive/fm21-76%281992%29.pdf" \
        "$DIR" "FM21-76_Army_Survival_Manual.pdf"

    dl_file "ATP 3-50.21 Survival" \
        "https://armypubs.army.mil/epubs/DR_pubs/DR_a/ARN32107-ATP_3-50.21-000-WEB-1.pdf" \
        "$DIR" "ATP_3-50-21_Survival.pdf"

    dl_file "FM 4-25.11 First Aid" \
        "https://www.bits.de/NRANEU/others/amd-us-archive/fm4-25x11%282002%29.pdf" \
        "$DIR" "FM4-25-11_First_Aid.pdf"

    dl_file "TC 3-97.61 Military Mountaineering" \
        "https://armypubs.army.mil/epubs/DR_pubs/DR_a/pdf/web/tc3_97x61.pdf" \
        "$DIR" "TC3-97-61_Mountaineering.pdf"

    dl_file "FM 3-05.70 Special Forces Survival" \
        "https://www.bits.de/NRANEU/others/amd-us-archive/fm3-05x70%282002%29.pdf" \
        "$DIR" "FM3-05-70_SF_Survival.pdf"

    dl_file "FM 3-05.213 Special Forces Use of Pack Animals" \
        "https://armypubs.army.mil/epubs/DR_pubs/DR_a/pdf/web/fm3_05x213.pdf" \
        "$DIR" "FM3-05-213_Pack_Animals.pdf"

    dl_file "TM 31-210 Improvised Munitions Handbook" \
        "https://www.bits.de/NRANEU/others/amd-us-archive/TM31-210.pdf" \
        "$DIR" "TM31-210_Improvised_Munitions.pdf"

    dl_file "FM 21-10 Field Sanitation" \
        "https://www.bits.de/NRANEU/others/amd-us-archive/fm21-10%281986%29.pdf" \
        "$DIR" "FM21-10_Field_Sanitation.pdf"

    dl_file "FM 90-5 Jungle Operations" \
        "https://www.bits.de/NRANEU/others/amd-us-archive/fm90-5%281982%29.pdf" \
        "$DIR" "FM90-5_Jungle_Operations.pdf"

    dl_file "SAS Survival Handbook (excerpt)" \
        "https://www.ibiblio.org/hyperwar/ATO/USAAF/SurvivalManual.pdf" \
        "$DIR" "Survival_Manual_USAAF.pdf"
}

# ── Medical References ────────────────────────────────────────────────────────
dl_medical_refs() {
    info "=== Medical References ==="
    local DIR="$BOOKS_DIR/medicine"

    dl_file "Where There Is No Doctor (Hesperian)" \
        "https://store.hesperian.org/prod/pdf/A010E.pdf" \
        "$DIR" "Where_There_Is_No_Doctor.pdf"

    dl_file "Where There Is No Dentist" \
        "https://store.hesperian.org/prod/pdf/B020E.pdf" \
        "$DIR" "Where_There_Is_No_Dentist.pdf"

    dl_file "A Book for Midwives" \
        "https://store.hesperian.org/prod/pdf/A230E.pdf" \
        "$DIR" "A_Book_for_Midwives.pdf"

    dl_file "Helping Children Who Are Blind" \
        "https://store.hesperian.org/prod/pdf/A250E.pdf" \
        "$DIR" "Helping_Children_Blind.pdf"

    dl_file "Merck Veterinary Manual (online guide)" \
        "https://www.msdvetmanual.com/Content/Whitepaper/MVM_Whitepaper.pdf" \
        "$DIR" "Merck_Veterinary_Guide.pdf"

    dl_file "Emergency Preparedness and Response (CDC)" \
        "https://www.cdc.gov/niosh/docs/2004-101/pdfs/2004-101.pdf" \
        "$DIR" "CDC_Emergency_Preparedness.pdf"

    dl_file "Combat Casualty Care Manual" \
        "https://www.usso.med.navy.mil/sites/usso/files/2018-12/tccc-guidelines.pdf" \
        "$DIR" "TCCC_Guidelines.pdf" || warn "TCCC Manual: try manual download"
}

# ── Agriculture & Food ────────────────────────────────────────────────────────
dl_agriculture() {
    info "=== Agriculture & Food Production ==="
    local DIR="$BOOKS_DIR/agriculture"

    # USDA resources (Public Domain)
    dl_file "USDA Home Canning Guide" \
        "https://nchfp.uga.edu/publications/publications_usda.html" \
        "$DIR" "USDA_Home_Canning_Guide.pdf" || true

    dl_file "Square Foot Gardening Manual" \
        "https://extension.sdstate.edu/sites/default/files/2020-06/P-00003.pdf" \
        "$DIR" "Square_Foot_Gardening.pdf"

    dl_file "Organic Farming Guide (ATTRA)" \
        "https://attra.ncat.org/product/beginning-farmer.pdf" \
        "$DIR" "Beginning_Farmer_Guide.pdf"

    dl_file "Permaculture Design Manual (excerpt)" \
        "https://holmgren.com.au/downloads/Essence_of_Pc_EN.pdf" \
        "$DIR" "Permaculture_Essence.pdf"

    dl_file "Small-Scale Chicken Keeping" \
        "https://extension.psu.edu/programs/betterkidcare/news/2018/small-scale-chicken-keeping" \
        "$DIR" "Chicken_Keeping.pdf" || true

    dl_file "Wild Edible Plants Guide (USDA)" \
        "https://www.fs.usda.gov/Internet/FSE_DOCUMENTS/stelprdb5444952.pdf" \
        "$DIR" "Wild_Edible_Plants_USDA.pdf"

    dl_file "Food Preservation Methods" \
        "https://nchfp.uga.edu/how/store/uga_freeze_dry.pdf" \
        "$DIR" "Food_Preservation.pdf"
}

# ── Engineering & Construction ────────────────────────────────────────────────
dl_engineering() {
    info "=== Engineering & Construction ==="
    local DIR="$PDF_DIR/construction"

    dl_file "Tiny House Building Guide" \
        "https://www.huduser.gov/portal/publications/pdf/HousingFirst_TinyHomes.pdf" \
        "$DIR" "Tiny_Houses_Guide.pdf"

    dl_file "Earthship Construction Manual" \
        "https://www.earthship.com/earthship-construction.pdf" \
        "$DIR" "Earthship_Construction.pdf" || warn "Earthship manual: see earthship.com"

    dl_file "Solar Power System Design Guide" \
        "https://www.nrel.gov/docs/fy03osti/31146.pdf" \
        "$DIR" "NREL_Solar_System_Design.pdf"

    dl_file "Wind Energy Basics" \
        "https://www.nrel.gov/docs/fy01osti/29492.pdf" \
        "$DIR" "NREL_Wind_Energy_Basics.pdf"

    dl_file "Water System Design Guide" \
        "https://www.nrcs.usda.gov/sites/default/files/2022-10/NEH_210-600.pdf" \
        "$DIR" "NRCS_Water_System_Design.pdf"

    dl_file "Composting Guide (EPA)" \
        "https://www.epa.gov/sites/default/files/2016-01/documents/master_composter_manual.pdf" \
        "$DIR" "EPA_Composting_Guide.pdf"
}

# ── Communications ────────────────────────────────────────────────────────────
dl_radio() {
    info "=== Ham Radio & Communications ==="
    local DIR="$PDF_DIR/radio"

    dl_file "ARRL Handbook excerpt (legal free chapters)" \
        "http://www.arrl.org/files/file/Technology/tis/info/pdf/0111qex017.pdf" \
        "$DIR" "ARRL_Basics.pdf"

    dl_file "Amateur Radio Emergency Communications" \
        "https://www.arrl.org/files/file/ARESHandbook2015.pdf" \
        "$DIR" "ARES_Handbook.pdf"

    dl_file "FCC Technician License Study Guide" \
        "https://ncvec.org/downloads/2022-2026%20Tech%20Pool%20w%20Errata.pdf" \
        "$DIR" "FCC_Technician_Study_Guide.pdf"
}

# ── Homesteading & DIY ────────────────────────────────────────────────────────
dl_homesteading() {
    info "=== Homesteading & DIY ==="
    local DIR="$PDF_DIR/homesteading"

    dl_file "The Encyclopedia of Country Living (excerpt)" \
        "https://www.nps.gov/articles/000/upload/Basic-Wilderness-Skills.pdf" \
        "$DIR" "Wilderness_Skills_NPS.pdf"

    dl_file "Foxfire Series excerpts (public domain)" \
        "https://docslib.org/doc/12279028/the-foxfire-book.pdf" \
        "$DIR" "Foxfire_Book.pdf" || warn "Foxfire: download manually from archive.org"

    dl_file "Herbal Medicine Guide (PubMed)" \
        "https://www.ncbi.nlm.nih.gov/books/NBK92766/pdf/Bookshelf_NBK92766.pdf" \
        "$DIR" "Herbal_Medicine_Guide.pdf"
}

# ── Download book catalog from Standard Ebooks (free, legal) ─────────────────
dl_standard_ebooks() {
    info "=== Standard Ebooks (free, public domain) ==="
    local DIR="$BOOKS_DIR/reference"

    # Standard Ebooks provides free, high-quality public domain books
    EBOOKS=(
        "https://standardebooks.org/ebooks/charles-darwin/on-the-origin-of-species/downloads/charles-darwin_on-the-origin-of-species.epub"
        "https://standardebooks.org/ebooks/henry-david-thoreau/walden/downloads/henry-david-thoreau_walden.epub"
        "https://standardebooks.org/ebooks/jules-verne/the-mysterious-island/downloads/jules-verne_the-mysterious-island.epub"
        "https://standardebooks.org/ebooks/jack-london/the-call-of-the-wild/downloads/jack-london_the-call-of-the-wild.epub"
        "https://standardebooks.org/ebooks/mark-twain/adventures-of-huckleberry-finn/downloads/mark-twain_adventures-of-huckleberry-finn.epub"
        "https://standardebooks.org/ebooks/daniel-defoe/robinson-crusoe/downloads/daniel-defoe_robinson-crusoe.epub"
    )

    for url in "${EBOOKS[@]}"; do
        filename=$(basename "$url")
        dl_file "$filename" "$url" "$DIR"
    done
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    info "Starting books and PDF downloads..."

    dl_military_manuals
    dl_medical_refs
    dl_agriculture
    dl_engineering
    dl_radio
    dl_homesteading
    dl_standard_ebooks

    success "Books and PDF download complete"
    info "PDFs: $PDF_DIR"
    info "Books: $BOOKS_DIR"
    du -sh "$PDF_DIR" "$BOOKS_DIR" 2>/dev/null || true
}

main "$@"
