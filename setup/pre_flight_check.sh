#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Pre-flight checks before install
# Run: bash setup/pre_flight_check.sh
# Exits non-zero if any CRITICAL check fails; warns for non-critical issues.
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
pass()  { echo -e "  ${GREEN}[PASS]${NC}  $*"; }
fail()  { echo -e "  ${RED}[FAIL]${NC}  $*"; FAILURES=$((FAILURES+1)); }
warn()  { echo -e "  ${YELLOW}[WARN]${NC}  $*"; }
info()  { echo -e "  ${BLUE}[INFO]${NC}  $*"; }

FAILURES=0

echo ""
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}  SurviveV1 Pre-flight Check${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""

# ── OS / Architecture ─────────────────────────────────────────────────────────
echo "OS & Architecture"
if [[ "$(uname -m)" == "aarch64" ]]; then
    pass "Architecture: aarch64 (64-bit ARM)"
else
    warn "Architecture: $(uname -m) — expected aarch64 (Raspberry Pi 5 64-bit)"
fi

if grep -q "Bookworm" /etc/os-release 2>/dev/null; then
    pass "OS: Raspberry Pi OS Bookworm"
elif grep -q "Bullseye" /etc/os-release 2>/dev/null; then
    warn "OS: Bullseye — Bookworm recommended for best compatibility"
else
    OS_ID=$(. /etc/os-release && echo "$PRETTY_NAME")
    warn "OS: $OS_ID — untested, may work"
fi

RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [[ "$RAM_MB" -ge 3800 ]]; then
    pass "RAM: ${RAM_MB} MB"
else
    warn "RAM: ${RAM_MB} MB — 4 GB recommended for running all services simultaneously"
fi

echo ""

# ── Root / Sudo ───────────────────────────────────────────────────────────────
echo "Permissions"
if [[ $EUID -eq 0 ]]; then
    pass "Running as root"
elif sudo -n true 2>/dev/null; then
    pass "sudo available without password"
else
    fail "Not root and no passwordless sudo — installer requires sudo"
fi

echo ""

# ── Internet connectivity ─────────────────────────────────────────────────────
echo "Network"
if ping -c 1 -W 5 8.8.8.8 &>/dev/null; then
    pass "Internet: reachable (ping 8.8.8.8)"
elif ping -c 1 -W 5 1.1.1.1 &>/dev/null; then
    pass "Internet: reachable (ping 1.1.1.1)"
else
    fail "Internet: not reachable — required for downloading software and content"
fi

if ping -c 1 -W 3 download.kiwix.org &>/dev/null 2>&1; then
    pass "Kiwix download server: reachable"
else
    warn "Kiwix download server: unreachable — may affect ZIM downloads"
fi

echo ""

# ── Storage ───────────────────────────────────────────────────────────────────
echo "Storage"
STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"

if mountpoint -q "$STORAGE_PATH" 2>/dev/null; then
    AVAIL_GB=$(df -BG "$STORAGE_PATH" | tail -1 | awk '{print $4}' | tr -d 'G')
    pass "Storage mounted at $STORAGE_PATH"
    if [[ "$AVAIL_GB" -ge 800 ]]; then
        pass "Available space: ${AVAIL_GB} GB (sufficient for full 800 GB install)"
    elif [[ "$AVAIL_GB" -ge 100 ]]; then
        warn "Available space: ${AVAIL_GB} GB — not enough for full install (need 800 GB); partial install possible"
    else
        fail "Available space: ${AVAIL_GB} GB — at least 100 GB required"
    fi
else
    warn "Storage not mounted at $STORAGE_PATH — mount your drive before running download scripts"
    # Check root filesystem space instead
    ROOT_AVAIL_GB=$(df -BG / | tail -1 | awk '{print $4}' | tr -d 'G')
    info "Root filesystem has ${ROOT_AVAIL_GB} GB free (content should go on external drive)"
fi

echo ""

# ── Required commands ─────────────────────────────────────────────────────────
echo "Required Tools"
REQUIRED_CMDS=(apt-get systemctl curl wget git python3)
for cmd in "${REQUIRED_CMDS[@]}"; do
    if command -v "$cmd" &>/dev/null; then
        pass "$cmd: found"
    else
        fail "$cmd: NOT FOUND — required for installation"
    fi
done

echo ""

# ── Optional tools (already installed check) ─────────────────────────────────
echo "Optional Tools (pre-installed)"
OPTIONAL_CMDS=(ffmpeg nginx ufw rclone aria2c yt-dlp kiwix-serve ollama)
for cmd in "${OPTIONAL_CMDS[@]}"; do
    if command -v "$cmd" &>/dev/null; then
        pass "$cmd: already installed"
    else
        info "$cmd: not installed (will be installed by setup/install.sh)"
    fi
done

echo ""

# ── Python version ────────────────────────────────────────────────────────────
echo "Python"
PY_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null || echo "0.0")
PY_MAJOR=${PY_VER%%.*}
PY_MINOR=${PY_VER##*.}
if [[ "$PY_MAJOR" -ge 3 ]] && [[ "$PY_MINOR" -ge 9 ]]; then
    pass "Python $PY_VER (3.9+ required)"
else
    fail "Python $PY_VER — Python 3.9+ required"
fi

echo ""

# ── Summary ───────────────────────────────────────────────────────────────────
echo -e "${BLUE}════════════════════════════════════════${NC}"
if [[ "$FAILURES" -eq 0 ]]; then
    echo -e "  ${GREEN}All critical checks passed. Ready to install!${NC}"
    echo ""
    echo "  Next: sudo bash setup/install.sh"
else
    echo -e "  ${RED}$FAILURES critical check(s) failed. Fix issues above before installing.${NC}"
fi
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""

exit "$FAILURES"
