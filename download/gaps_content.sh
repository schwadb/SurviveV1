#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Download gap-filling content identified by expert research
# Covers: advanced medicine, obstetrics, dental, sanitation, animal husbandry,
#         seed saving, blacksmithing, fermentation, cheese, beeswax, security,
#         psychology, community survival, and more
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF -- using defaults" >&2; else source "$_CONF"; fi

STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
PDF_DIR="$STORAGE_PATH/pdfs"
VIDEO_DIR="$STORAGE_PATH/videos"
LOG_DIR="$STORAGE_PATH/.logs"

while [[ $# -gt 0 ]]; do
    case $1 in
        --storage) STORAGE_PATH="$2"; shift 2 ;;
        *) shift ;;
    esac
done

mkdir -p "$PDF_DIR"/{medicine_advanced,obstetrics,dental,sanitation,animal_husbandry,\
blacksmithing,fermentation,beeswax,seeds,security,psychology,community,water_systems,\
primitive_skills,permaculture,economics,radio}
mkdir -p "$VIDEO_DIR"/{primitive_skills,fermentation,blacksmithing,animal_husbandry,security}
mkdir -p "$LOG_DIR"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${BLUE}[GAPS]${NC} $*"; }
success() { echo -e "${GREEN}[GAPS]${NC} $*"; }
warn()    { echo -e "${YELLOW}[GAPS]${NC} $*"; }

FAILED_LOG="$LOG_DIR/failed_downloads.log"

dl_file() {
    local name="$1"
    local url="$2"
    local dest="$3"
    local filename="${4:-$(basename "$url" | tr '?&=' '_')}"

    [[ -f "$dest/$filename" ]] && { info "[$name] Already exists"; return 0; }
    info "Downloading: $name"
    wget -q --show-progress --tries=3 --timeout=60 \
        -O "$dest/$filename" "$url" \
        && success "$name saved" \
        || {
            warn "$name failed — see docs/gaps_analysis.md for manual download"
            echo "$(date '+%Y-%m-%d %H:%M:%S') FAILED [$name] $url" >> "$FAILED_LOG"
        }
}

dl_channel() {
    local category="$1"; local name="$2"; local url="$3"; local max="${4:-100}"
    info "[VIDEO] $name ($category, max $max videos)"
    yt-dlp \
        --format "bestvideo[height<=720][ext=mp4]+bestaudio/best[height<=720]/best" \
        --merge-output-format mp4 \
        --embed-metadata \
        --download-archive "$LOG_DIR/${category}_gaps_archive.txt" \
        --output "$VIDEO_DIR/$category/%(channel)s/%(title)s.%(ext)s" \
        --playlist-end "$max" \
        --ignore-errors --no-warnings \
        "$url" \
        && success "[VIDEO] $name done" \
        || warn "[VIDEO] $name had errors"
}

# ══════════════════════════════════════════════════════════════════════════════
# CRITICAL TIER 1 GAPS
# ══════════════════════════════════════════════════════════════════════════════

dl_advanced_medicine() {
    info "=== TIER 1: Advanced Survival Medicine ==="
    local DIR="$PDF_DIR/medicine_advanced"

    # Emergency War Surgery — NATO/Borden Institute (public domain)
    dl_file "Emergency War Surgery (NATO)" \
        "https://www.cs.amedd.army.mil/FileDownloadpublic.aspx?docid=3b00c934-a0fe-4b12-acae-17c21a2dfa3e" \
        "$DIR" "Emergency_War_Surgery_NATO.pdf" || \
    dl_file "Emergency War Surgery (mirror)" \
        "https://www.borden.army.mil/portalx/default/PHCC_Downloads/Trauma/Emergency%20War%20Surgery%204th%20ed.pdf" \
        "$DIR" "Emergency_War_Surgery_NATO.pdf"

    # Special Operations Forces Medical Handbook
    dl_file "SOF Medical Handbook" \
        "https://www.bits.de/NRANEU/others/amd-us-archive/SOFMedHandbook(2001).pdf" \
        "$DIR" "SOF_Medical_Handbook.pdf"

    # Wilderness Medicine pocket guide (free)
    dl_file "NOLS Wilderness Medicine Guide" \
        "https://www.nols.edu/media/filer_public/wilderness_medicine/wilderness-medicine-field-guide.pdf" \
        "$DIR" "NOLS_Wilderness_Medicine.pdf"

    # Combat Medic Field Reference
    dl_file "Combat Medic Field Reference" \
        "https://www.bits.de/NRANEU/others/amd-us-archive/fm8-10-1%281994%29.pdf" \
        "$DIR" "FM8-10-1_Combat_Medic.pdf"

    # Survival and Austere Medicine 3rd Ed (2017) — free from griddownmed.blog
    dl_file "Survival and Austere Medicine 3rd Ed (free)" \
        "https://griddownmed.blog/wp-content/uploads/2018/11/austmed.pdf" \
        "$DIR" "Survival_Austere_Medicine_3rd_Ed.pdf"

    # Wilderness Medicine Beyond First Aid — ACEP reference list (free excerpt)
    dl_file "ACEP Austere Medicine Book List" \
        "https://www.acep.org/siteassets/uploads/uploaded-files/acep/membership/sections-of-membership/disaster/austere-medicine-books.pdf" \
        "$DIR" "ACEP_Austere_Medicine_Reading_List.pdf"

    # Doom and Bloom videos
    dl_channel "medical" "Doom and Bloom (Dr. Bones & Nurse Amy)" \
        "https://www.youtube.com/@DoomAndBloom/videos" 200

    dl_channel "medical" "The Patriot Nurse" \
        "https://www.youtube.com/@ThePatriotNurse/videos" 150

    dl_channel "medical" "Skinny Medic (TCCC)" \
        "https://www.youtube.com/@SkinnyMedic/videos" 100
}

dl_obstetrics() {
    info "=== TIER 1: Emergency Childbirth & Obstetrics ==="
    local DIR="$PDF_DIR/obstetrics"

    # Hesperian "A Book for Midwives" (free legal download)
    dl_file "A Book for Midwives (Hesperian)" \
        "https://store.hesperian.org/prod/pdf/A230E.pdf" \
        "$DIR" "Hesperian_Book_for_Midwives.pdf"

    # Emergency Childbirth — Gregory White (public domain)
    dl_file "Emergency Childbirth (Gregory White)" \
        "https://archive.org/download/EmergencyChildbirth/EmergencyChildbirth.pdf" \
        "$DIR" "Emergency_Childbirth_Gregory_White.pdf"

    # WHO Pregnancy and Childbirth Guide
    dl_file "WHO Safe Motherhood Practical Guide" \
        "https://apps.who.int/iris/bitstream/handle/10665/43972/9789241545426_eng.pdf" \
        "$DIR" "WHO_Safe_Motherhood_Guide.pdf"

    # Basic Obstetric Care — Peace Corps
    dl_file "Peace Corps Maternal Child Health Guide" \
        "https://files.peacecorps.gov/multimedia/pdf/library/M0063_maternalchildhealtheng.pdf" \
        "$DIR" "Peace_Corps_Maternal_Child_Health.pdf"
}

dl_dental() {
    info "=== TIER 1: Dental Emergency ==="
    local DIR="$PDF_DIR/dental"

    # Where There Is No Dentist (Hesperian — free)
    dl_file "Where There Is No Dentist (Hesperian)" \
        "https://store.hesperian.org/prod/pdf/B020E.pdf" \
        "$DIR" "Where_There_Is_No_Dentist.pdf"

    # WHO Oral Health Guide for Primary Care
    dl_file "WHO Oral Health Primary Care" \
        "https://apps.who.int/iris/bitstream/handle/10665/42654/9241545690.pdf" \
        "$DIR" "WHO_Oral_Health_Primary_Care.pdf"
}

dl_mental_health() {
    info "=== TIER 1: Psychiatric & Mental Health ==="
    local DIR="$PDF_DIR/psychology"

    # Where There Is No Psychiatrist (Hesperian — free)
    dl_file "Where There Is No Psychiatrist (Hesperian)" \
        "https://store.hesperian.org/prod/pdf/A490E.pdf" \
        "$DIR" "Where_There_Is_No_Psychiatrist.pdf"

    # WHO Psychological First Aid (free)
    dl_file "WHO Psychological First Aid Guide" \
        "https://apps.who.int/iris/bitstream/handle/10665/44615/9789241548205_eng.pdf" \
        "$DIR" "WHO_Psychological_First_Aid.pdf"

    # NCTSN Psychological First Aid Field Guide
    dl_file "NCTSN Psychological First Aid Field Operations Guide" \
        "https://www.nctsn.org/sites/default/files/resources/pfa_field_operations_guide.pdf" \
        "$DIR" "NCTSN_Psychological_First_Aid.pdf"

    # Sphere Handbook (humanitarian standards — disaster psychology chapters)
    dl_file "The Sphere Handbook (Mental Health chapter)" \
        "https://spherestandards.org/wp-content/uploads/Sphere-Handbook-2018-EN.pdf" \
        "$DIR" "Sphere_Handbook_Humanitarian_Standards.pdf"

    # CDC/NIOSH — Psychological Issues in Escape, Rescue, and Survival (free)
    dl_file "CDC NIOSH Disaster Survival Psychology (Everly)" \
        "https://www.cdc.gov/niosh/docket/archive/pdfs/NIOSH-154/0154-010108-everly.pdf" \
        "$DIR" "CDC_NIOSH_Disaster_Survival_Psychology.pdf"
}

dl_sanitation() {
    info "=== TIER 1: Sanitation Without Infrastructure ==="
    local DIR="$PDF_DIR/sanitation"

    # Humanure Handbook (free legal download from author's site)
    dl_file "The Humanure Handbook (Jenkins)" \
        "https://humanurehandbook.com/downloads/H2.pdf" \
        "$DIR" "Humanure_Handbook.pdf"

    # WHO Sanitation & Hygiene Guide
    dl_file "WHO Sanitation and Health Guide" \
        "https://apps.who.int/iris/bitstream/handle/10665/337673/9789240012226-eng.pdf" \
        "$DIR" "WHO_Sanitation_Health.pdf"

    # Peace Corps Sanitation Manual
    dl_file "Peace Corps Latrine Construction" \
        "https://files.peacecorps.gov/multimedia/pdf/library/M0055_latrineconst.pdf" \
        "$DIR" "Peace_Corps_Latrine_Construction.pdf"

    # Greywater: Create an Oasis excerpt
    dl_file "Greywater Oasis Design Guide (excerpt)" \
        "https://oasisdesign.net/greywater/laundrytolandscape/intro.pdf" \
        "$DIR" "Greywater_Oasis_Design.pdf"
}

# ══════════════════════════════════════════════════════════════════════════════
# TIER 2 GAPS
# ══════════════════════════════════════════════════════════════════════════════

dl_animal_husbandry() {
    info "=== TIER 2: Animal Husbandry ==="
    local DIR="$PDF_DIR/animal_husbandry"

    # FAO Animal Production guides (free)
    dl_file "FAO Small-Scale Poultry Production" \
        "https://www.fao.org/3/y5114e/y5114e.pdf" \
        "$DIR" "FAO_Small_Scale_Poultry.pdf"

    dl_file "FAO Better Farming Series - Small Animals" \
        "https://www.fao.org/3/T0690E/T0690E.pdf" \
        "$DIR" "FAO_Small_Animals.pdf"

    dl_file "FAO Goat Production Guide" \
        "https://www.fao.org/3/t0750e/t0750e.pdf" \
        "$DIR" "FAO_Goat_Production.pdf"

    dl_file "FAO Pig Production Guide" \
        "https://www.fao.org/3/t0690e/t0690e.pdf" \
        "$DIR" "FAO_Pig_Production.pdf"

    dl_file "USDA Rabbit Production" \
        "https://www.ams.usda.gov/sites/default/files/media/Rabbit%20Handbook.pdf" \
        "$DIR" "USDA_Rabbit_Production.pdf"

    dl_file "Merck Veterinary Manual (online reference note)" \
        "https://www.msdvetmanual.com/Content/Whitepaper/MVM_Whitepaper.pdf" \
        "$DIR" "Merck_Vet_Manual_Reference.pdf"

    # Videos
    dl_channel "animal_husbandry" "Weed em and Reap" \
        "https://www.youtube.com/@weedemnreap/videos" 150
    dl_channel "animal_husbandry" "Jill Winger Prairie Homestead" \
        "https://www.youtube.com/@JillWinger/videos" 150
}

dl_seed_saving() {
    info "=== TIER 2: Seed Saving ==="
    local DIR="$PDF_DIR/seeds"

    # Seed Saving Guide (NRCS/USDA)
    dl_file "NRCS Seed Saving Basics" \
        "https://www.nrcs.usda.gov/Internet/FSE_DOCUMENTS/nrcs144p2_016285.pdf" \
        "$DIR" "NRCS_Seed_Saving_Basics.pdf"

    # Peace Corps Seed Production Guide
    dl_file "Peace Corps Seed Production and Improvement" \
        "https://files.peacecorps.gov/multimedia/pdf/library/M0046_seedproduction.pdf" \
        "$DIR" "Peace_Corps_Seed_Production.pdf"

    # Southern Exposure Seed Exchange saving guide (free PDF)
    dl_file "Southern Exposure Seed Saving Guide" \
        "https://www.southernexposure.com/growing-guides/saving-seeds-home-use.pdf" \
        "$DIR" "Southern_Exposure_Seed_Saving_Guide.pdf"

    # Oregon State Extension — Step-by-Step Seed Saving
    dl_file "OSU Extension Seed Saving Guide" \
        "https://extension.oregonstate.edu/sites/default/files/documents/ec871.pdf" \
        "$DIR" "OSU_Seed_Saving_Guide.pdf" || true

    # Videos
    dl_channel "food" "MIGardener (seed saving)" \
        "https://www.youtube.com/@MIGardener/videos" 150
    dl_channel "food" "Hoss Tools (seed saving)" \
        "https://www.youtube.com/@HossTools/videos" 100
}

dl_beekeeping() {
    info "=== TIER 2: Beekeeping ==="
    local DIR="$PDF_DIR/beeswax"

    # USDA Beekeeping for Beginners
    dl_file "USDA Beekeeping for Beginners" \
        "https://www.ams.usda.gov/sites/default/files/media/Beekeeping%20for%20Beginners.pdf" \
        "$DIR" "USDA_Beekeeping_Beginners.pdf"

    # Penn State Beekeeping Guide
    dl_file "Penn State Beekeeping Guide" \
        "https://extension.psu.edu/bees/pdf/pennsylvania-beekeeping-guide.pdf" \
        "$DIR" "Penn_State_Beekeeping_Guide.pdf"

    # FAO Beekeeping
    dl_file "FAO Beekeeping in Africa (general principles)" \
        "https://www.fao.org/3/T0104E/T0104E.pdf" \
        "$DIR" "FAO_Beekeeping_Guide.pdf"
}

dl_blacksmithing() {
    info "=== TIER 2: Blacksmithing ==="
    local DIR="$PDF_DIR/blacksmithing"

    # Practical Blacksmithing — M.T. Richardson (public domain, archive.org)
    for vol in 1 2 3 4; do
        dl_file "Practical Blacksmithing Vol $vol (Richardson)" \
            "https://archive.org/download/practicalblacksmithing0${vol}rich/practicalblacksmithing0${vol}rich.pdf" \
            "$DIR" "Practical_Blacksmithing_Vol${vol}.pdf"
    done

    # Videos
    dl_channel "blacksmithing" "Blackbear Forge" \
        "https://www.youtube.com/@BlackbearForge/videos" 150
    dl_channel "blacksmithing" "Alec Steele Blacksmithing" \
        "https://www.youtube.com/@AlecSteele/videos" 100
}

dl_primitive_skills() {
    info "=== TIER 2: Primitive Skills (Townsends, Primitive Technology) ==="

    # Townsends — 18th century skills: soap, candles, food, tanning
    dl_channel "primitive_skills" "Townsends (18th century skills)" \
        "https://www.youtube.com/@Townsends/videos" 300

    # Primitive Technology (John Plant) — no talking, pure demonstration
    # Already partially in skills but add more explicitly
    dl_channel "primitive_skills" "Primitive Technology" \
        "https://www.youtube.com/@primitivetechnology9550/videos" 50

    # Survival Russia
    dl_channel "primitive_skills" "Far North Bushcraft and Survival" \
        "https://www.youtube.com/@FarNorthBushcraft/videos" 100
}

dl_fermentation_brewing() {
    info "=== TIER 2: Fermentation & Brewing ==="
    local DIR="$PDF_DIR/fermentation"

    # FAO Fermentation Guide
    dl_file "FAO Fermented Fruits and Vegetables" \
        "https://www.fao.org/3/x0560e/x0560e.pdf" \
        "$DIR" "FAO_Fermented_Foods.pdf"

    # Peace Corps Food Preservation via Fermentation
    dl_file "FAO Traditional Food Plants (includes fermentation)" \
        "https://www.fao.org/3/x0453e/x0453e.pdf" \
        "$DIR" "FAO_Traditional_Food_Plants.pdf"

    # Videos
    dl_channel "fermentation" "Homesteady (fermentation)" \
        "https://www.youtube.com/@Homesteady/videos" 100
    dl_channel "fermentation" "City Steading Brews (mead/wine)" \
        "https://www.youtube.com/@CitySteadingBrews/videos" 150
    dl_channel "fermentation" "Townsends Brewing/Fermentation" \
        "https://www.youtube.com/playlist?list=PLQfT5iqzeqneoJ_RVB3CDvzORSDkKOaDs" 50
}

dl_permaculture() {
    info "=== TIER 2: Permaculture ==="
    local DIR="$PDF_DIR/permaculture"

    # USDA Agroforestry Guide
    dl_file "USDA Agroforestry Overview" \
        "https://www.fs.usda.gov/nac/assets/documents/agroforestry/brochures/agroforestryoverview.pdf" \
        "$DIR" "USDA_Agroforestry_Overview.pdf"

    # FAO Agroforestry
    dl_file "FAO Agroforestry Systems" \
        "https://www.fao.org/3/a-i6383e.pdf" \
        "$DIR" "FAO_Agroforestry_Systems.pdf"

    # Videos
    dl_channel "farming" "Geoff Lawton Permaculture" \
        "https://www.youtube.com/@GeoffLawtonOnline/videos" 100
    dl_channel "farming" "Andrew Millison Permaculture" \
        "https://www.youtube.com/@andrewmillison/videos" 100
}

dl_water_systems() {
    info "=== TIER 2: Water Systems & Wells ==="
    local DIR="$PDF_DIR/water_systems"

    # Peace Corps Well Construction (free, public domain)
    dl_file "Peace Corps Manual Well Drilling" \
        "https://files.peacecorps.gov/multimedia/pdf/library/M0017_manual_well_drilling.pdf" \
        "$DIR" "Peace_Corps_Manual_Well_Drilling.pdf"

    dl_file "Peace Corps Water Supply" \
        "https://files.peacecorps.gov/multimedia/pdf/library/M0017_water_supply.pdf" \
        "$DIR" "Peace_Corps_Water_Supply.pdf"

    # WHO Water Treatment
    dl_file "WHO Guidelines for Drinking Water Quality" \
        "https://apps.who.int/iris/bitstream/handle/10665/352532/9789240045064-eng.pdf" \
        "$DIR" "WHO_Drinking_Water_Quality.pdf"

    # USAID Water and Sanitation
    dl_file "USAID Water Sanitation and Hygiene" \
        "https://pdf.usaid.gov/pdf_docs/PNADW118.pdf" \
        "$DIR" "USAID_Water_Sanitation.pdf"
}

dl_security() {
    info "=== TIER 2: Security & Defense ==="
    local DIR="$PDF_DIR/security"

    # US Army FM 7-8 Infantry Rifle Platoon (public domain tactics)
    dl_file "FM 7-8 Infantry Rifle Platoon and Squad" \
        "https://www.bits.de/NRANEU/others/amd-us-archive/fm7-8%281992%29.pdf" \
        "$DIR" "FM7-8_Infantry_Rifle_Platoon.pdf"

    # FM 21-60 Visual Signals (hand signals, public domain)
    dl_file "FM 21-60 Visual Signals (Hand Signals)" \
        "https://www.bits.de/NRANEU/others/amd-us-archive/fm21-60%281987%29.pdf" \
        "$DIR" "FM21-60_Visual_Signals.pdf"

    # Ranger Handbook SH 21-76 (widely available PDF)
    dl_file "Ranger Handbook SH 21-76" \
        "https://www.bits.de/NRANEU/others/amd-us-archive/sh21-76%281992%29.pdf" \
        "$DIR" "SH21-76_Ranger_Handbook.pdf"

    # FMFM 1-3B (Small Unit Tactics, USMC, public domain)
    dl_file "MCRP 3-11B Marine Rifle Squad" \
        "https://www.bits.de/NRANEU/others/amd-us-archive/mcrp3-11b.pdf" \
        "$DIR" "MCRP3-11B_Marine_Rifle_Squad.pdf"
}

dl_community_economics() {
    info "=== TIER 2: Community & Economics ==="
    local DIR="$PDF_DIR/community"

    # FEMA Community Resilience Guide
    dl_file "FEMA Community Resilience Planning Guide" \
        "https://www.fema.gov/sites/default/files/2020-06/fema_community-resilience-planning-guide.pdf" \
        "$DIR" "FEMA_Community_Resilience_Guide.pdf"

    # WHO Community Health Worker Guide
    dl_file "WHO Community Health Worker Guidelines" \
        "https://apps.who.int/iris/bitstream/handle/10665/275765/9789241550369-eng.pdf" \
        "$DIR" "WHO_Community_Health_Workers.pdf"

    # SPHERE Handbook (humanitarian standards for shelter, food, water, health)
    dl_file "Sphere Handbook 2018 (Humanitarian Standards)" \
        "https://spherestandards.org/wp-content/uploads/Sphere-Handbook-2018-EN.pdf" \
        "$DIR" "Sphere_Handbook_Humanitarian_Standards.pdf"
}

dl_morse_radio() {
    info "=== TIER 2: Morse Code & Radio ==="
    local DIR="$PDF_DIR/radio"

    # The Art and Skill of Radio-Telegraphy (free from N0HFF)
    dl_file "Art and Skill of Radio Telegraphy (N0HFF)" \
        "https://www.qsl.net/n9bor/n0hff.pdf" \
        "$DIR" "Art_Skill_Radio_Telegraphy_N0HFF.pdf"

    # ARRL Operating Manual excerpt
    dl_file "Emergency Communication Reference Frequencies" \
        "https://www.arrl.org/files/file/Public%20Service/Emergency%20Communication/EC-001.pdf" \
        "$DIR" "ARRL_Emergency_Frequencies.pdf"

    # Videos
    dl_channel "communication" "K0PIR Ham Radio Crash Course" \
        "https://www.youtube.com/@K0PIR/videos" 200
    dl_channel "communication" "David Casler KE0OG Ham Radio" \
        "https://www.youtube.com/@DavidCasler/videos" 150
}

# ══════════════════════════════════════════════════════════════════════════════
# Free Hesperian Resource Bundle
# ══════════════════════════════════════════════════════════════════════════════
dl_hesperian_bundle() {
    info "=== FREE: Complete Hesperian Health Guides ==="
    local DIR="$PDF_DIR/medicine_advanced"

    declare -A HESPERIAN=(
        ["Where_There_Is_No_Doctor.pdf"]="https://store.hesperian.org/prod/pdf/A010E.pdf"
        ["Where_There_Is_No_Dentist.pdf"]="https://store.hesperian.org/prod/pdf/B020E.pdf"
        ["Book_for_Midwives.pdf"]="https://store.hesperian.org/prod/pdf/A230E.pdf"
        ["Where_There_Is_No_Psychiatrist.pdf"]="https://store.hesperian.org/prod/pdf/A490E.pdf"
        ["Helping_Children_Who_Are_Blind.pdf"]="https://store.hesperian.org/prod/pdf/A250E.pdf"
        ["Helping_Children_Who_Are_Deaf.pdf"]="https://store.hesperian.org/prod/pdf/A280E.pdf"
        ["A_Health_Handbook_for_Women_with_Disabilities.pdf"]="https://store.hesperian.org/prod/pdf/A315E.pdf"
        ["Workers_Guide_to_Health_and_Safety.pdf"]="https://store.hesperian.org/prod/pdf/A420E.pdf"
        ["Helping_Health_Workers_Learn.pdf"]="https://store.hesperian.org/prod/pdf/A050E.pdf"
    )

    for filename in "${!HESPERIAN[@]}"; do
        dl_file "Hesperian: ${filename%.pdf}" "${HESPERIAN[$filename]}" "$DIR" "$filename"
    done
}

# ══════════════════════════════════════════════════════════════════════════════
# Peace Corps Knowledge Library (free, public domain)
# ══════════════════════════════════════════════════════════════════════════════
dl_peace_corps_library() {
    info "=== FREE: Peace Corps Technical Library ==="
    local DIR="$PDF_DIR/reference"
    mkdir -p "$DIR/peace_corps"

    # Peace Corps technical manuals — comprehensive rural skills
    declare -A PC_MANUALS=(
        ["PC_Agroforestry.pdf"]="https://files.peacecorps.gov/multimedia/pdf/library/M0006_agroforestry.pdf"
        ["PC_Small_Farm_Grain_Storage.pdf"]="https://files.peacecorps.gov/multimedia/pdf/library/M0035_smallfarmgrain.pdf"
        ["PC_Soil_and_Water_Conservation.pdf"]="https://files.peacecorps.gov/multimedia/pdf/library/M0036_soilconservation.pdf"
        ["PC_Fishpond_Construction.pdf"]="https://files.peacecorps.gov/multimedia/pdf/library/M0008_fishpond.pdf"
        ["PC_Forestry.pdf"]="https://files.peacecorps.gov/multimedia/pdf/library/M0026_forestry.pdf"
        ["PC_Solar_Drying.pdf"]="https://files.peacecorps.gov/multimedia/pdf/library/M0038_solardrying.pdf"
        ["PC_Windmill_Construction.pdf"]="https://files.peacecorps.gov/multimedia/pdf/library/M0030_windmill.pdf"
        ["PC_Biogas.pdf"]="https://files.peacecorps.gov/multimedia/pdf/library/M0011_biogas.pdf"
        ["PC_Appropriate_Technology.pdf"]="https://files.peacecorps.gov/multimedia/pdf/library/M0036_apptechnology.pdf"
        ["PC_Water_Purification.pdf"]="https://files.peacecorps.gov/multimedia/pdf/library/M0012_waterpurification.pdf"
        ["PC_Vegetable_Production.pdf"]="https://files.peacecorps.gov/multimedia/pdf/library/M0029_vegproduction.pdf"
        ["PC_Food_Preservation.pdf"]="https://files.peacecorps.gov/multimedia/pdf/library/M0010_foodpreservation.pdf"
        ["PC_Beekeeping.pdf"]="https://files.peacecorps.gov/multimedia/pdf/library/M0007_beekeeping.pdf"
        ["PC_Small_Animal_Husbandry.pdf"]="https://files.peacecorps.gov/multimedia/pdf/library/M0013_smallanimal.pdf"
        ["PC_Grain_Legumes.pdf"]="https://files.peacecorps.gov/multimedia/pdf/library/M0023_grainlegumes.pdf"
    )

    for filename in "${!PC_MANUALS[@]}"; do
        dl_file "Peace Corps: ${filename%.pdf}" "${PC_MANUALS[$filename]}" \
            "$DIR/peace_corps" "$filename"
    done
}

# ══════════════════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════════════════
main() {
    info "SurviveV1 Gap-filling Content Downloader"
    info "Based on expert research from top survivalists"
    echo ""

    # TIER 1 — Critical
    dl_hesperian_bundle
    dl_obstetrics
    dl_dental
    dl_mental_health
    dl_sanitation
    dl_advanced_medicine

    # TIER 2 — Significant
    dl_animal_husbandry
    dl_seed_saving
    dl_beekeeping
    dl_blacksmithing
    dl_primitive_skills
    dl_fermentation_brewing
    dl_permaculture
    dl_water_systems
    dl_security
    dl_community_economics
    dl_morse_radio

    # Free libraries
    dl_peace_corps_library

    success "Gap-filling content download complete"
    du -sh "$PDF_DIR" "$VIDEO_DIR" 2>/dev/null || true
}

main "$@"
