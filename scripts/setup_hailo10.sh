#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Hailo AI HAT setup (Hailo-8/8L and Hailo-10H)
#
# Raspberry Pi OS ships TWO separate Hailo stacks, and installing the wrong
# one fails silently: the kernel module loads but never binds the device
# (no /dev/hailo0, "Hailo devices not found"), because each driver only
# knows its own PCI IDs:
#
#   hailo-all      -> HailoRT 4.x  -> Hailo-8 / 8L   (PCI 1e60:2864)
#   hailo-h10-all  -> HailoRT 5.x  -> Hailo-10H      (PCI 1e60:45c4)
#
# This script detects which chip is present and installs the matching stack.
#
#   sudo bash scripts/setup_hailo10.sh
# =============================================================================
set -euo pipefail

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${BLUE}[HAILO]${NC} $*"; }
success() { echo -e "${GREEN}[HAILO]${NC} $*"; }
warn()    { echo -e "${YELLOW}[HAILO]${NC} $*"; }
error()   { echo -e "${RED}[HAILO]${NC} $*" >&2; }

[[ $EUID -eq 0 ]] || { error "Run with sudo: sudo bash $0"; exit 1; }

# ── Detect the chip ───────────────────────────────────────────────────────────
PCI_LINE=$(lspci -nn 2>/dev/null | grep -i hailo || true)
if [[ -z "$PCI_LINE" ]]; then
    error "No Hailo device on the PCIe bus."
    error "Check the HAT is seated and PCIe is enabled, then reboot."
    exit 1
fi
info "Detected: $PCI_LINE"

case "$PCI_LINE" in
    *45c4*) CHIP="hailo10"; META="hailo-h10-all"; WRONG_META="hailo-all"
            WRONG_PKGS=(hailo-all hailort hailort-pcie-driver python3-hailort) ;;
    *2864*) CHIP="hailo8";  META="hailo-all";     WRONG_META="hailo-h10-all"
            WRONG_PKGS=(hailo-h10-all h10-hailort h10-hailort-pcie-driver python3-h10-hailort) ;;
    *)      error "Unrecognised Hailo PCI ID in: $PCI_LINE"
            error "Check https://www.raspberrypi.com/documentation/ for your model."
            exit 1 ;;
esac
info "Chip family: $CHIP  ->  correct package: $META"

# ── Remove the mismatched stack if present ────────────────────────────────────
REMOVED=false
for pkg in "${WRONG_PKGS[@]}"; do
    if dpkg -s "$pkg" &>/dev/null; then
        [[ "$REMOVED" == "false" ]] && info "Removing mismatched $WRONG_META stack..."
        apt-get remove -y -qq "$pkg" || true
        REMOVED=true
    fi
done
[[ "$REMOVED" == "true" ]] && apt-get autoremove -y -qq || true

# ── Install the matching stack ────────────────────────────────────────────────
info "Installing $META ..."
apt-get update -qq
apt-get install -y "$META"

# Hailo's LLM tooling for the 10H (source package "hailo-ollama") is being
# rolled out through the same archive — install it when available.
if [[ "$CHIP" == "hailo10" ]]; then
    if apt-get install -y hailo-gen-ai-model-zoo 2>/dev/null; then
        success "hailo-gen-ai-model-zoo installed (Hailo LLM tooling)"
    else
        info "hailo-gen-ai-model-zoo not installable yet — check again after"
        info "  sudo apt update   in a few weeks; Hailo's on-NPU LLM support"
        info "  for the 10H is rolling out through this package."
    fi
fi

# ── Verify ────────────────────────────────────────────────────────────────────
echo ""
info "Verifying driver <-> device match..."
if modinfo hailo_pci 2>/dev/null | grep -qi "$( [[ $CHIP == hailo10 ]] && echo 45C4 || echo 2864 )"; then
    success "Driver claims this chip's PCI ID"
else
    warn "modinfo does not show the expected PCI ID yet (kernel module may"
    warn "rebuild via DKMS on the next boot)."
fi

echo ""
success "Install complete — REBOOT REQUIRED to load the new driver:"
echo "    sudo reboot"
echo ""
info "After the reboot, verify with:"
echo "    ls -l /dev/hailo0"
echo "    hailortcli fw-control identify"
echo ""
if [[ "$CHIP" == "hailo10" ]]; then
    info "Honest expectations for the Hailo-10H:"
    info " - Vision workloads (object detection etc.) work via rpicam/TAPPAS."
    info " - Your EXISTING Ollama setup stays on CPU — HailoRT is a separate"
    info "   runtime; LLM offload arrives via the hailo-gen-ai packages, not"
    info "   as a transparent Ollama speedup."
fi
