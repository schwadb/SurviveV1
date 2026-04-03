#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Main Installer
# Raspberry Pi 5 (64-bit Bookworm) + AI Hat (Hailo-8L)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
SURVIVE_CONFIG="$REPO_DIR/config/survive.conf"

# Load or create config
if [[ -f "$SURVIVE_CONFIG" ]]; then
    source "$SURVIVE_CONFIG"
else
    bash "$SCRIPT_DIR/first_run.sh"
    source "$SURVIVE_CONFIG"
fi

LOG_FILE="/var/log/survive_install.log"
exec > >(tee -a "$LOG_FILE") 2>&1

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

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
install_ytdlp() {
    info "Installing yt-dlp..."
    curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
    chmod +x /usr/local/bin/yt-dlp
    command -v yt-dlp &>/dev/null || { error "yt-dlp install failed"; exit 1; }
    success "yt-dlp installed ($(yt-dlp --version))"
}

# ── Kiwix tools ───────────────────────────────────────────────────────────────
install_kiwix() {
    info "Installing Kiwix tools..."
    KIWIX_VERSION="3.7.0"
    KIWIX_ARCH="aarch64"
    KIWIX_URL="https://download.openzim.org/release/kiwix-tools/kiwix-tools_linux-${KIWIX_ARCH}-${KIWIX_VERSION}.tar.gz"

    TMP_DIR=$(mktemp -d)
    wget -q "$KIWIX_URL" -O "$TMP_DIR/kiwix-tools.tar.gz"
    tar -xzf "$TMP_DIR/kiwix-tools.tar.gz" -C "$TMP_DIR"
    cp "$TMP_DIR"/kiwix-tools_*/kiwix-serve /usr/local/bin/
    cp "$TMP_DIR"/kiwix-tools_*/kiwix-manage /usr/local/bin/
    cp "$TMP_DIR"/kiwix-tools_*/kiwix-search /usr/local/bin/ 2>/dev/null || true
    chmod +x /usr/local/bin/kiwix-*
    rm -rf "$TMP_DIR"
    command -v kiwix-serve &>/dev/null || { error "kiwix-serve install failed"; exit 1; }
    command -v kiwix-manage &>/dev/null || { error "kiwix-manage install failed"; exit 1; }
    success "Kiwix tools installed"
}

# ── Kolibri (Khan Academy offline) ───────────────────────────────────────────
install_kolibri() {
    info "Installing Kolibri..."
    if ! command -v kolibri &>/dev/null; then
        wget -q "https://learningequality.org/r/kolibri-install-pi" -O /tmp/kolibri_install.sh
        bash /tmp/kolibri_install.sh || {
            # Fallback: pip install
            /opt/survive/venv/bin/pip install -q kolibri
        }
    fi
    success "Kolibri installed"
}

# ── Calibre + Calibre-Web ─────────────────────────────────────────────────────
install_calibre() {
    info "Installing Calibre..."
    apt-get install -y -qq calibre || {
        wget -nv -O- https://download.calibre-ebook.com/linux-installer.sh | bash /dev/stdin
    }

    info "Installing Calibre-Web..."
    /opt/survive/venv/bin/pip install -q calibreweb
    success "Calibre + Calibre-Web installed"
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
    # Backend services are intentionally NOT opened externally:
    # 8081 (kiwix), 8082 (kolibri), 8083 (calibre), 8096 (jellyfin),
    # 3000 (martin maps), 11434 (ollama) — access via nginx reverse proxy only.
    # Allow from loopback for inter-service communication
    ufw allow in on lo
    ufw --force enable
    success "Firewall configured (backend ports locked to localhost)"
}

# ── Samba share ───────────────────────────────────────────────────────────────
configure_samba() {
    info "Configuring Samba for local file sharing..."
    STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
    cat > /etc/samba/smb.conf << SAMBA
[global]
   workgroup = SURVIVE
   server string = SurviveV1 Knowledge Server
   security = user
   map to guest = bad user
   dns proxy = no

[survive]
   path = $STORAGE_PATH
   browseable = yes
   read only = yes
   guest ok = yes
   comment = Survival Knowledge Repository
SAMBA
    systemctl restart smbd nmbd
    success "Samba share configured (\\\\survive\\survive)"
}

# ── Install systemd services ──────────────────────────────────────────────────
install_services() {
    info "Installing systemd services..."
    for unit in "$REPO_DIR"/systemd/*.service; do
        cp "$unit" /etc/systemd/system/
    done
    systemctl daemon-reload
    systemctl enable survive-dashboard.service
    systemctl enable kiwix.service
    systemctl enable jellyfin.service
    systemctl enable kolibri.service 2>/dev/null || true
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
    configure_nginx
    configure_firewall
    configure_samba
    configure_avahi
    install_services

    # Optional (comment out if not needed)
    # install_kolibri
    # install_calibre
    # install_jellyfin
    # setup_ai_hat

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
