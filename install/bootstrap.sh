#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — One-click bootstrap
#
# Usage (on a fresh Raspberry Pi 5):
#   curl -fsSL https://raw.githubusercontent.com/schwadb/SurviveV1/main/install/bootstrap.sh | bash
#
# The script:
#   1. Checks minimum requirements (aarch64, Bookworm, internet)
#   2. Installs git if missing
#   3. Clones the repo
#   4. Launches the interactive installation wizard
#
# Override defaults with environment variables:
#   SURVIVE_REPO   - Git repo URL  (default: https://github.com/schwadb/SurviveV1.git)
#   SURVIVE_BRANCH - Branch/tag    (default: main)
#   SURVIVE_DIR    - Clone target  (default: /home/$SUDO_USER/SurviveV1 or ~/SurviveV1)
# =============================================================================
set -euo pipefail

SURVIVE_REPO="${SURVIVE_REPO:-https://github.com/schwadb/SurviveV1.git}"
SURVIVE_BRANCH="${SURVIVE_BRANCH:-main}"

# Resolve clone target: prefer the invoking user's home directory so root-cloned
# files don't end up owned by root with the wrong permissions.
REAL_USER="${SUDO_USER:-${USER:-pi}}"
REAL_HOME=$(getent passwd "$REAL_USER" 2>/dev/null | cut -d: -f6 || echo "/home/$REAL_USER")
SURVIVE_DIR="${SURVIVE_DIR:-${REAL_HOME}/SurviveV1}"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "  ${BLUE}→${NC}  $*"; }
ok()    { echo -e "  ${GREEN}✓${NC}  $*"; }
warn()  { echo -e "  ${YELLOW}!${NC}  $*"; }
die()   { echo -e "\n${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}"
echo "  ╔════════════════════════════════════════════╗"
echo "  ║    SurviveV1 — Offline Survival System    ║"
echo "  ║         One-Click Bootstrap Installer     ║"
echo "  ╚════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""

# ── Step 1: Minimum system requirements ───────────────────────────────────────
info "Checking system requirements..."

# Architecture — must be 64-bit ARM
ARCH=$(uname -m)
if [[ "$ARCH" != "aarch64" ]]; then
    die "Unsupported architecture: ${ARCH}\n" \
        "  SurviveV1 is designed for Raspberry Pi 5 (aarch64).\n" \
        "  64-bit Raspberry Pi OS is required."
fi
ok "Architecture: ${ARCH}"

# RAM — warn if under 4 GB
RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
if (( RAM_MB < 3800 )); then
    warn "RAM: ${RAM_MB} MB — 4 GB minimum recommended (some services may be slow)"
else
    ok "RAM: ${RAM_MB} MB"
fi

# OS — Raspberry Pi OS Bookworm preferred
if grep -q "Bookworm\|bookworm" /etc/os-release 2>/dev/null; then
    ok "OS: Raspberry Pi OS Bookworm"
elif grep -q "Bullseye\|bullseye" /etc/os-release 2>/dev/null; then
    warn "OS: Bullseye detected — Bookworm is recommended for best compatibility"
elif grep -q "ID=debian\|ID=raspbian" /etc/os-release 2>/dev/null; then
    OS_NAME=$(. /etc/os-release && echo "$PRETTY_NAME")
    warn "OS: ${OS_NAME} — untested, may work"
else
    die "Unsupported OS. Raspberry Pi OS (Bookworm) is required."
fi

# Internet
if ! curl -sf --max-time 10 https://github.com >/dev/null 2>&1; then
    die "No internet access. SurviveV1 requires internet during setup\n" \
        "  (the system runs 100%% offline afterward)."
fi
ok "Internet: connected"

echo ""

# ── Step 2: Ensure git is installed ───────────────────────────────────────────
if ! command -v git &>/dev/null; then
    info "git not found — installing..."
    # Need apt, so need root
    if [[ $EUID -ne 0 ]]; then
        sudo apt-get update -qq && sudo apt-get install -y -qq git
    else
        apt-get update -qq && apt-get install -y -qq git
    fi
    ok "git installed"
else
    ok "git: $(git --version)"
fi

# ── Step 3: Clone or update the repository ────────────────────────────────────
echo ""
info "Repository: ${SURVIVE_REPO}  (branch: ${SURVIVE_BRANCH})"
info "Clone target: ${SURVIVE_DIR}"
echo ""

if [[ -d "${SURVIVE_DIR}/.git" ]]; then
    warn "Repository already exists at ${SURVIVE_DIR}"
    ask_update() {
        echo -en "  ${BOLD}Update to latest ${SURVIVE_BRANCH}? [Y/n]${NC} "
        read -r ans
        if [[ "${ans:-y}" =~ ^[Yy]$ ]]; then
            git -C "${SURVIVE_DIR}" fetch origin
            git -C "${SURVIVE_DIR}" checkout "${SURVIVE_BRANCH}"
            git -C "${SURVIVE_DIR}" pull --ff-only origin "${SURVIVE_BRANCH}"
            ok "Repository updated"
        else
            info "Using existing repository"
        fi
    }
    ask_update
else
    info "Cloning SurviveV1..."
    git clone --branch "${SURVIVE_BRANCH}" --depth 1 \
        "${SURVIVE_REPO}" "${SURVIVE_DIR}" \
        || die "Failed to clone repository. Check your network and try again."
    # Fix ownership — clone ran as root but files should belong to the real user
    if [[ $EUID -eq 0 ]] && [[ -n "$REAL_USER" ]] && id "$REAL_USER" &>/dev/null; then
        chown -R "${REAL_USER}:${REAL_USER}" "${SURVIVE_DIR}"
    fi
    ok "Repository cloned to ${SURVIVE_DIR}"
fi

# ── Step 4: Launch the wizard ─────────────────────────────────────────────────
echo ""
info "Launching installation wizard..."
echo ""

WIZARD="${SURVIVE_DIR}/install/wizard.sh"
[[ -f "$WIZARD" ]] || die "Wizard not found at ${WIZARD} — clone may be incomplete."
chmod +x "$WIZARD"

# Elevate to root for the wizard (installer requires root for apt, systemd, etc.)
if [[ $EUID -ne 0 ]]; then
    exec sudo bash "$WIZARD"
else
    exec bash "$WIZARD"
fi
