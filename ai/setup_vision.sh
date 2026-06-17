#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Hailo-8L Vision Pipeline Setup
# Uses the Hailo-8L NPU (13 TOPS) for real-time object detection, plant/animal
# identification, and pose estimation. All inference runs on the NPU, not CPU.
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF -- using defaults" >&2; else source "$_CONF"; fi

STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
VISION_DIR="$STORAGE_PATH/ai_models/vision"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${BLUE}[VISION]${NC} $*"; }
success() { echo -e "${GREEN}[VISION]${NC} $*"; }
warn()    { echo -e "${YELLOW}[VISION]${NC} $*"; }
error()   { echo -e "${RED}[VISION]${NC} $*"; }

mkdir -p "$VISION_DIR"

# ── Check Hailo-8L hardware ──────────────────────────────────────────────────
check_hailo() {
    info "Checking for Hailo NPU..."
    if ! command -v hailortcli &>/dev/null; then
        warn "hailortcli not found. Install the Hailo runtime first:"
        warn "  sudo apt install hailo-all"
        warn "  See: https://github.com/hailo-ai/hailo-rpi5-examples"
        return 1
    fi

    if hailortcli fw-control identify &>/dev/null; then
        local hw
        hw=$(hailortcli fw-control identify 2>/dev/null | awk -F: '/Device Architecture/ {print $2}' | tr -d ' ')
        success "Hailo NPU detected: $hw"
    else
        error "No Hailo device found. Connect the AI Hat and try again."
        return 1
    fi
}

# ── Install Python dependencies ──────────────────────────────────────────────
install_deps() {
    info "Installing Python dependencies for vision pipeline..."
    pip3 install --quiet \
        hailo-platform \
        Pillow \
        numpy \
        2>/dev/null || {
        warn "Some vision dependencies failed to install."
        warn "Try: sudo apt install python3-pil python3-numpy"
    }
}

# ── Download YOLO detection model (HEF format for Hailo) ─────────────────────
download_models() {
    info "Downloading vision models for Hailo-8L..."

    local YOLO_URL="https://hailo-model-zoo.s3.eu-west-2.amazonaws.com/ModelZoo/Compiled/v2.13.0/hailo8l/yolov8s.hef"
    local YOLO_FILE="$VISION_DIR/yolov8s.hef"
    if [[ ! -f "$YOLO_FILE" ]]; then
        info "Downloading YOLOv8s detection model (~12 MB)..."
        wget -q --show-progress -O "$YOLO_FILE" "$YOLO_URL" \
            && success "YOLOv8s model downloaded" \
            || warn "YOLOv8s download failed -- check network"
    else
        info "YOLOv8s model already exists"
    fi

    # COCO class labels for general object detection
    local LABELS_FILE="$VISION_DIR/coco_labels.txt"
    if [[ ! -f "$LABELS_FILE" ]]; then
        info "Creating COCO labels file..."
        cat > "$LABELS_FILE" << 'LABELS'
person
bicycle
car
motorcycle
airplane
bus
train
truck
boat
traffic light
fire hydrant
stop sign
parking meter
bench
bird
cat
dog
horse
sheep
cow
elephant
bear
zebra
giraffe
backpack
umbrella
handbag
tie
suitcase
frisbee
skis
snowboard
sports ball
kite
baseball bat
baseball glove
skateboard
surfboard
tennis racket
bottle
wine glass
cup
fork
knife
spoon
bowl
banana
apple
sandwich
orange
broccoli
carrot
hot dog
pizza
donut
cake
chair
couch
potted plant
bed
dining table
toilet
tv
laptop
mouse
remote
keyboard
cell phone
microwave
oven
toaster
sink
refrigerator
book
clock
vase
scissors
teddy bear
hair drier
toothbrush
LABELS
        success "COCO labels created"
    fi
}

# ── Verify installation ──────────────────────────────────────────────────────
verify() {
    info "Verifying vision pipeline..."
    local ok=true

    if command -v hailortcli &>/dev/null && hailortcli fw-control identify &>/dev/null; then
        success "Hailo NPU: OK"
    else
        warn "Hailo NPU: NOT DETECTED"
        ok=false
    fi

    if [[ -f "$VISION_DIR/yolov8s.hef" ]]; then
        success "YOLOv8s model: OK ($(du -sh "$VISION_DIR/yolov8s.hef" | cut -f1))"
    else
        warn "YOLOv8s model: NOT INSTALLED"
        ok=false
    fi

    if python3 -c "import hailo_platform" 2>/dev/null; then
        success "Hailo Python SDK: OK"
    else
        warn "Hailo Python SDK: NOT INSTALLED"
        ok=false
    fi

    if $ok; then
        success "Vision pipeline fully installed!"
        echo ""
        echo "  Vision features are now available at /vision"
        echo "  Models stored: $VISION_DIR"
        du -sh "$VISION_DIR" 2>/dev/null || true
    else
        warn "Some components missing. Vision features may be limited."
    fi
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    case "${1:-setup}" in
        setup)
            check_hailo || exit 1
            install_deps
            download_models
            verify
            ;;
        models)  download_models ;;
        verify)  verify ;;
        *) echo "Usage: $0 [setup|models|verify]" ;;
    esac
}

main "$@"
