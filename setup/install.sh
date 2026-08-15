#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Main Installer
# Raspberry Pi 5 (64-bit Bookworm) + AI Hat (Hailo-8L)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
SURVIVE_CONFIG="$REPO_DIR/config/survive.conf"

# Load or create config. survive.conf is machine-specific and untracked; the
# wizard writes it, and a bare clone starts from the shipped example.
if [[ ! -f "$SURVIVE_CONFIG" ]] && [[ -f "${SURVIVE_CONFIG}.example" ]]; then
    cp "${SURVIVE_CONFIG}.example" "$SURVIVE_CONFIG"
fi
if [[ -f "$SURVIVE_CONFIG" ]]; then
    # shellcheck source=/dev/null
    source "$SURVIVE_CONFIG"
else
    bash "$SCRIPT_DIR/first_run.sh"
    # shellcheck source=/dev/null
    source "$SURVIVE_CONFIG"
fi

LOG_FILE="/var/log/survive_install.log"
exec > >(tee -a "$LOG_FILE") 2>&1

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# With `set -e`, any unchecked failure aborts the script. Without this trap that
# abort is SILENT — the installer just returns to the prompt mid-step, which is
# impossible to diagnose. Always say what died and where.
_on_error() {
    local rc=$1 line=$2 cmd=$3
    error "Installation failed (exit ${rc}) at line ${line}: ${cmd}"
    error "Full log: $LOG_FILE"
    error "Fix the issue above, then re-run: sudo bash setup/install.sh"
}
trap '_on_error "$?" "$LINENO" "$BASH_COMMAND"' ERR

require_root() {
    [[ $EUID -eq 0 ]] || { error "Run with sudo: sudo bash $0"; exit 1; }
}

# ── Banner ────────────────────────────────────────────────────────────────────
banner() {
cat << 'EOF'
  ____                  _           __     ____
 / ___| _   _ _ ____   _(_)_   _____\ \   / /_ \
 \___ \| | | | '__\ \ / / \ \ / / _ \ \ / /  / /
  ___) | |_| | |   \ V /| |\ V /  __/ \ V /  / /
 |____/ \__,_|_|    \_/ |_| \_/ \___|  \_/  /_/

   Offline Survival Repository — Raspberry Pi 5 Edition
EOF
}

# ── System update ─────────────────────────────────────────────────────────────
update_system() {
    # Guard: apt needs several GB of headroom on the root filesystem. The
    # classic way this fills up is content/models downloaded while the storage
    # drive was NOT mounted — those files land on the SD card under the
    # /mnt/survive directory and are then HIDDEN by the real mount.
    local free_mb
    free_mb=$(df -Pm / | awk 'NR==2 {print $4}')
    if (( free_mb < 2048 )); then
        error "Only ${free_mb} MB free on the root filesystem — apt needs ~2 GB."
        error "Common causes and fixes:"
        error "  sudo apt-get clean                        # drop cached .deb files"
        error "  # Files hidden UNDER the storage mountpoint from an early download:"
        error "  sudo mount --bind / /tmp/rootview && sudo du -sh /tmp/rootview/mnt/survive"
        error "  sudo rm -rf /tmp/rootview/mnt/survive/* && sudo umount /tmp/rootview"
        error "  du -sh ~/.ollama /usr/share/ollama        # stray AI models on the SD card"
        exit 1
    fi

    info "Updating system packages..."
    apt-get update -qq
    apt-get upgrade -y -qq
    success "System updated"
}

# ── Core dependencies ─────────────────────────────────────────────────────────
install_core_deps() {
    info "Installing core dependencies..."
    apt-get install -y -qq \
        git curl wget aria2 rsync \
        python3 python3-pip python3-venv python3-dev \
        ffmpeg vlc \
        nginx \
        sqlite3 \
        zstd xz-utils p7zip-full \
        poppler-utils \
        ufw \
        jq \
        htop iotop \
        tmux \
        avahi-daemon \
        samba samba-common-bin \
        ntfs-3g exfatprogs \
        rclone \
        fuse3
    success "Core dependencies installed"
}

# ── Python virtual environment ────────────────────────────────────────────────
setup_python_env() {
    info "Setting up Python virtual environment..."
    VENV_DIR="/opt/survive/venv"
    python3 -m venv "$VENV_DIR"
    source "$VENV_DIR/bin/activate"
    pip install -q --upgrade pip
    pip install -q -r "$REPO_DIR/requirements.txt"
    success "Python environment ready at $VENV_DIR"
}

# ── yt-dlp ────────────────────────────────────────────────────────────────────
# Minimum version covers:
#   CVE-2024-38519  — output-template extension bypass (fixed 2024.07.01)
#   CVE-2025-54072  — --exec injection
#   CVE-2026-26331  — --netrc-cmd command injection (fixed 2026.02.21)
MIN_YTDLP_VERSION="2026.02.21"

install_ytdlp() {
    info "Installing yt-dlp..."
    curl -sL -o /usr/local/bin/yt-dlp \
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
    chmod 0755 /usr/local/bin/yt-dlp
    command -v yt-dlp &>/dev/null || { error "yt-dlp install failed"; exit 1; }
    local ver
    ver="$(yt-dlp --version 2>/dev/null)"
    if [[ "$(printf '%s\n%s\n' "$MIN_YTDLP_VERSION" "$ver" | sort -V | head -1)" \
          != "$MIN_YTDLP_VERSION" ]]; then
        warn "yt-dlp $ver < required $MIN_YTDLP_VERSION (security fixes)"
    fi
    success "yt-dlp installed ($ver)"
}

# ── Kiwix tools ───────────────────────────────────────────────────────────────
install_kiwix() {
    info "Installing Kiwix tools..."
    if command -v kiwix-serve &>/dev/null && command -v kiwix-manage &>/dev/null; then
        success "Kiwix tools already present"
        return
    fi

    # Preferred: the distro package — signed, maintained, and matched to the OS.
    if apt-get install -y -qq kiwix-tools && command -v kiwix-serve &>/dev/null; then
        success "Kiwix tools installed from apt"
        return
    fi

    warn "kiwix-tools unavailable via apt — falling back to the upstream build"
    # kiwix-tools is NOT on download.openzim.org any more (that host now carries
    # only libzim/zim-tools). The unversioned filename below always resolves to
    # the current release, so this cannot rot the way a pinned version does.
    local url="https://download.kiwix.org/release/kiwix-tools/kiwix-tools_linux-aarch64.tar.gz"
    local tmp
    tmp=$(mktemp -d)
    # No -q: a download failure must be visible, not silent.
    if ! wget -O "$tmp/kiwix-tools.tar.gz" "$url"; then
        rm -rf "$tmp"
        error "Could not download Kiwix tools from:"
        error "  $url"
        error "Check internet access, then re-run: sudo bash setup/install.sh"
        exit 1
    fi
    tar -xzf "$tmp/kiwix-tools.tar.gz" -C "$tmp"
    cp "$tmp"/kiwix-tools_*/kiwix-serve /usr/local/bin/
    cp "$tmp"/kiwix-tools_*/kiwix-manage /usr/local/bin/
    cp "$tmp"/kiwix-tools_*/kiwix-search /usr/local/bin/ 2>/dev/null || true
    chmod +x /usr/local/bin/kiwix-*
    rm -rf "$tmp"
    command -v kiwix-serve &>/dev/null || { error "kiwix-serve install failed"; exit 1; }
    command -v kiwix-manage &>/dev/null || { error "kiwix-manage install failed"; exit 1; }
    success "Kiwix tools installed"
}

# ── Kolibri (Khan Academy offline) ───────────────────────────────────────────
install_kolibri() {
    info "Installing Kolibri..."
    if command -v kolibri &>/dev/null || [[ -x /opt/survive/venv/bin/kolibri ]]; then
        success "Kolibri already installed"
        return 0
    fi

    # Try the vendor installer, then pip. Neither is guaranteed: Kolibri
    # historically lags new Python releases, and this OS ships Python 3.13.
    if wget -q "https://learningequality.org/r/kolibri-install-pi" -O /tmp/kolibri_install.sh \
       && [[ -s /tmp/kolibri_install.sh ]]; then
        bash /tmp/kolibri_install.sh || true
    else
        warn "Could not fetch the Kolibri installer script"
    fi
    if ! command -v kolibri &>/dev/null; then
        /opt/survive/venv/bin/pip install -q kolibri || true
    fi

    # Report the truth. This previously printed "Kolibri installed"
    # unconditionally, so a failed install looked like a success and the
    # dashboard tile stayed DOWN with no explanation.
    if command -v kolibri &>/dev/null || [[ -x /opt/survive/venv/bin/kolibri ]]; then
        success "Kolibri installed"
        return 0
    fi
    warn "Kolibri did NOT install (often a Python version conflict —"
    warn "this system has Python $(python3 -V 2>&1 | awk '{print $2}'))."
    warn "The Education tile will stay DOWN. Khan Academy content is also"
    warn "available as a Kiwix ZIM, which needs no extra service."
    return 1
}

# ── Calibre + Calibre-Web ─────────────────────────────────────────────────────
install_calibre() {
    info "Installing Calibre..."
    apt-get install -y -qq calibre || {
        wget -nv -O- https://download.calibre-ebook.com/linux-installer.sh | bash /dev/stdin
    }

    info "Installing Calibre-Web..."
    /opt/survive/venv/bin/pip install -q calibreweb

    # Build the Calibre library from any ebooks already downloaded. Safe no-op
    # if none exist yet — books_pdfs.sh rebuilds it after each download.
    bash "$(dirname "${BASH_SOURCE[0]}")/../scripts/build_ebook_library.sh" || true
    success "Calibre + Calibre-Web installed"
}

# ── Martin tile server (offline maps) ─────────────────────────────────────────
install_martin() {
    if command -v martin &>/dev/null; then
        success "Martin already installed ($(command -v martin))"
        return 0
    fi
    info "Installing Martin tile server..."

    # Do NOT pin a version: the previously hardcoded v0.14.3 asset is gone from
    # GitHub (404), which is why the maps tile never came up. Ask the API for
    # the current release and pick whichever asset matches this architecture.
    local arch_pat="aarch64"
    [[ "$(uname -m)" == "aarch64" ]] || arch_pat="$(uname -m)"
    local url
    url=$(curl -fsSL --max-time 60 \
            https://api.github.com/repos/maplibre/martin/releases/latest 2>/dev/null \
          | grep -oE '"browser_download_url": *"[^"]+"' \
          | cut -d'"' -f4 \
          | grep -iE "linux" | grep -iE "${arch_pat}|arm64" \
          | grep -E '\.tar\.gz$' | head -1) || true

    if [[ -z "$url" ]]; then
        warn "Could not determine a Martin release for $(uname -m)."
        warn "Install manually from https://github.com/maplibre/martin/releases"
        warn "and re-run: sudo bash scripts/generate_services.sh"
        return 1
    fi

    info "Downloading $(basename "$url")"
    local tmp
    tmp=$(mktemp -d)
    if wget -q -O "$tmp/martin.tar.gz" "$url"; then
        tar -xzf "$tmp/martin.tar.gz" -C "$tmp"
        # The archive layout varies between releases; find the binary.
        local bin
        bin=$(find "$tmp" -type f -name martin -perm -u+x | head -1)
        [[ -n "$bin" ]] || bin=$(find "$tmp" -type f -name martin | head -1)
        if [[ -n "$bin" ]]; then
            install -m 0755 "$bin" /usr/local/bin/martin
            success "Martin installed ($(/usr/local/bin/martin --version 2>&1 | head -1))"
        else
            warn "No martin binary inside the archive"
        fi
    else
        warn "Martin download failed: $url"
    fi
    rm -rf "$tmp"
    command -v martin &>/dev/null
}

# ── Jellyfin (video streaming) ────────────────────────────────────────────────
install_jellyfin() {
    info "Installing Jellyfin media server..."
    curl -fsSL https://repo.jellyfin.org/install-debuntu.sh | bash || {
        warn "Jellyfin install script failed, trying manual method..."
        curl -fsSL https://repo.jellyfin.org/jellyfin_team.gpg.key \
            | gpg --dearmor -o /usr/share/keyrings/jellyfin.gpg
        echo "deb [signed-by=/usr/share/keyrings/jellyfin.gpg arch=arm64] \
            https://repo.jellyfin.org/ubuntu jammy main" \
            > /etc/apt/sources.list.d/jellyfin.list
        apt-get update -qq && apt-get install -y -qq jellyfin
    }
    success "Jellyfin installed"
}

# ── Ollama (local LLM) ────────────────────────────────────────────────────────
install_ollama() {
    info "Installing Ollama for local AI..."
    curl -fsSL https://ollama.ai/install.sh | sh
    command -v ollama &>/dev/null || { error "Ollama install failed"; exit 1; }

    # The vendor installer registers its own ollama.service running as the
    # 'ollama' system user, whose models live in /usr/share/ollama/.ollama —
    # on the SD CARD. OLLAMA_MODELS is read by the SERVER, so exporting it for
    # `ollama pull` does NOT redirect a server that is already running; models
    # silently fill the boot disk (8-14 GB) until apt runs out of space.
    # Retire the vendor unit here; install_services() then installs ours, which
    # points OLLAMA_MODELS at the storage drive.
    if systemctl list-unit-files ollama.service &>/dev/null; then
        info "Disabling the vendor ollama.service (its models would fill the SD card)"
        systemctl disable --now ollama.service 2>/dev/null || true
    fi
    success "Ollama installed"
}

# ── Storage setup ─────────────────────────────────────────────────────────────
setup_storage() {
    STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
    info "Setting up storage at $STORAGE_PATH..."

    mkdir -p "$STORAGE_PATH"/{zim,videos,books,pdfs,maps,kolibri,ai_models,misc}
    mkdir -p "$STORAGE_PATH"/.sync

    # Symlink data directory
    ln -sfn "$STORAGE_PATH" "$REPO_DIR/data"

    # Set permissions
    chown -R "$SUDO_USER:$SUDO_USER" "$STORAGE_PATH" 2>/dev/null || \
    chown -R "pi:pi" "$STORAGE_PATH" 2>/dev/null || true

    success "Storage configured at $STORAGE_PATH"
}

# ── Nginx configuration ───────────────────────────────────────────────────────
configure_nginx() {
    info "Configuring Nginx reverse proxy..."
    cp "$REPO_DIR/config/nginx.conf" /etc/nginx/sites-available/survive
    ln -sfn /etc/nginx/sites-available/survive /etc/nginx/sites-enabled/survive
    rm -f /etc/nginx/sites-enabled/default
    nginx -t && systemctl reload nginx
    success "Nginx configured"
}

# ── Firewall ──────────────────────────────────────────────────────────────────
configure_firewall() {
    info "Configuring firewall..."
    ufw --force reset
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow ssh
    ufw allow 80/tcp   # nginx (primary access point)
    ufw allow 443/tcp  # nginx TLS
    ufw allow 8080/tcp # dashboard (direct access)
    ufw allow 445/tcp  # samba file sharing
    # The dashboard's tiles and nav links send the browser DIRECTLY to each
    # service's port, so these must be reachable from the LAN. (An earlier
    # version blocked them "nginx-only", which made every service except the
    # dashboard appear dead from any other device.)
    ufw allow 8081/tcp # kiwix (wikipedia/books)
    ufw allow 8082/tcp # kolibri (khan academy)
    ufw allow 8083/tcp # calibre-web (e-books)
    ufw allow 8096/tcp # jellyfin (videos)
    ufw allow 3000/tcp # martin (offline maps)
    # 11434 (ollama) stays closed: the dashboard proxies all AI traffic, and
    # the raw Ollama API has no authentication.
    # Allow from loopback for inter-service communication
    ufw allow in on lo
    ufw --force enable
    success "Firewall configured (backend ports locked to localhost)"
}

# ── Samba share ───────────────────────────────────────────────────────────────
# SAMBA_HOSTS_ALLOW restricts the share to specified IPs/CIDRs. Default is
# local-only; override in config/survive.conf (e.g. "127.0.0.1 192.168.1.").
configure_samba() {
    info "Configuring Samba for local file sharing..."
    STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
    local hosts_allow="${SAMBA_HOSTS_ALLOW:-127.0.0.1 192.168. 10.}"
    cat > /etc/samba/smb.conf << SAMBA
[global]
   workgroup = SURVIVE
   server string = SurviveV1 Knowledge Server
   security = user
   map to guest = bad user
   dns proxy = no
   # Only accept connections from trusted local subnets.
   hosts allow = $hosts_allow
   hosts deny = 0.0.0.0/0

[survive]
   path = $STORAGE_PATH
   browseable = yes
   read only = yes
   # Require a real user rather than anonymous guest access.
   guest ok = no
   valid users = @survive
   comment = Survival Knowledge Repository
SAMBA
    # Create a 'survive' group and add the default user, if present.
    getent group survive >/dev/null || groupadd survive
    if id pi &>/dev/null; then usermod -aG survive pi; fi
    if [[ -n "${SUDO_USER:-}" ]] && id "$SUDO_USER" &>/dev/null; then
        usermod -aG survive "$SUDO_USER"
    fi
    systemctl restart smbd nmbd
    success "Samba share configured (hosts allow: $hosts_allow)"
    info "Set a Samba password with: sudo smbpasswd -a <username>"
}

# ── Install systemd services ──────────────────────────────────────────────────
install_services() {
    info "Installing systemd services..."
    # The unit files ship with User=pi, but the real login may be anything
    # (Raspberry Pi Imager lets users pick a name). Substitute the invoking
    # user so services actually start on non-'pi' systems.
    local svc_user="${SUDO_USER:-pi}"
    id "$svc_user" &>/dev/null || svc_user="pi"
    for unit in "$REPO_DIR"/systemd/*.service; do
        sed "s/^User=pi$/User=${svc_user}/" "$unit" \
            > "/etc/systemd/system/$(basename "$unit")"
    done
    info "Services will run as user: ${svc_user}"
    systemctl daemon-reload
    systemctl enable survive-dashboard.service
    systemctl enable kiwix.service
    systemctl enable jellyfin.service 2>/dev/null || true
    systemctl enable kolibri.service 2>/dev/null || true
    systemctl enable calibre-web.service 2>/dev/null || true
    systemctl enable ollama.service 2>/dev/null || true
    systemctl enable martin-tiles.service 2>/dev/null || true
    success "Systemd services installed"
}

# ── Hailo AI Hat setup ────────────────────────────────────────────────────────
setup_ai_hat() {
    if [[ "${SKIP_AI_HAT:-false}" == "true" ]]; then
        warn "Skipping AI Hat setup (SKIP_AI_HAT=true)"
        return
    fi
    info "Setting up Hailo AI Hat..."
    bash "$SCRIPT_DIR/install_ai_hat.sh" || warn "AI Hat setup failed — see docs/ai_hat_setup.md"
}

# ── Avahi mDNS ────────────────────────────────────────────────────────────────
configure_avahi() {
    info "Configuring mDNS (survive.local)..."
    cat > /etc/avahi/services/survive.service << 'XML'
<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">SurviveV1 on %h</name>
  <service>
    <type>_http._tcp</type>
    <port>8080</port>
    <txt-record>path=/</txt-record>
  </service>
</service-group>
XML
    systemctl restart avahi-daemon
    success "Accessible at http://survive.local:8080"
}

# ── Create /opt/survive structure ─────────────────────────────────────────────
setup_opt_survive() {
    info "Setting up /opt/survive..."
    mkdir -p /opt/survive/{venv,logs,db}
    cp -r "$REPO_DIR/web" /opt/survive/
    cp -r "$REPO_DIR/config" /opt/survive/
    ln -sfn "$REPO_DIR/data" /opt/survive/data
    REAL_USER="${SUDO_USER:-pi}"
    chown -R "$REAL_USER:$REAL_USER" /opt/survive
    success "/opt/survive ready"
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    banner
    require_root

    echo ""
    info "Starting SurviveV1 installation..."
    info "Log: $LOG_FILE"
    echo ""

    update_system
    install_core_deps
    setup_opt_survive
    setup_python_env
    install_ytdlp
    install_kiwix
    install_ollama
    setup_storage
    bash "$SCRIPT_DIR/pi5_storage.sh" || warn "Pi 5 storage hardening skipped"
    configure_nginx
    configure_firewall
    configure_samba
    configure_avahi
    install_services

    # Content services. These were previously commented out, which shipped a
    # dashboard advertising Kolibri, Calibre-Web and Jellyfin on a machine where
    # none of them existed — every one showed "STOPPED" with no explanation.
    # Now gated by the content flags, so disabling a category also skips paying
    # for its (large) dependencies.
    if [[ "${CONTENT_KOLIBRI:-Y}" =~ [Yy] ]]; then
        install_kolibri || warn "Kolibri install failed — dashboard tile will stay DOWN"
    else
        info "CONTENT_KOLIBRI=N — skipping Kolibri"
    fi

    if [[ "${CONTENT_GUTENBERG:-Y}" =~ [Yy] ]] || [[ "${CONTENT_PDFS:-Y}" =~ [Yy] ]]; then
        install_calibre || warn "Calibre-Web install failed — dashboard tile will stay DOWN"
    else
        info "No book/PDF content selected — skipping Calibre-Web"
    fi

    if [[ "${CONTENT_MAPS:-Y}" =~ [Yy] ]]; then
        install_martin || warn "Martin install failed — Maps tile will stay DOWN"
    else
        info "CONTENT_MAPS=N — skipping Martin tile server"
    fi

    if [[ "${CONTENT_VIDEOS:-Y}" =~ [Yy] ]]; then
        install_jellyfin || warn "Jellyfin install failed — dashboard tile will stay DOWN"
    else
        info "CONTENT_VIDEOS=N — skipping Jellyfin"
    fi

    # The Hailo stack is hardware-specific (8L vs 10H need different drivers)
    # and cannot accelerate Ollama regardless — see docs/ai_hat_setup.md.
    # setup_ai_hat

    # Regenerate units LAST: binary paths are resolved with `command -v`, so
    # this must happen after Kolibri/Calibre/Jellyfin/Martin are on disk.
    # Running it earlier resolved them as "not installed" and baked in the
    # wrong ExecStart.
    if [[ -x "$REPO_DIR/scripts/generate_services.sh" ]]; then
        bash "$REPO_DIR/scripts/generate_services.sh" || warn "generate_services.sh failed"
    fi

    echo ""
    success "============================================"
    success "SurviveV1 installation complete!"
    success "============================================"
    echo ""
    info "Next steps:"
    echo "  1. Download content:  bash download/download_all.sh"
    echo "  2. Start services:    bash scripts/start_services.sh"
    echo "  3. Open dashboard:    http://localhost:8080"
    echo "  4. Network access:    http://survive.local:8080"
    echo ""
}

main "$@"
