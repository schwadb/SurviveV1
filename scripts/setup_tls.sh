#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Self-signed TLS certificate setup for local HTTPS
# Run once after install. Creates a cert valid for 10 years.
# Access via: https://survive.local  (browser will warn about self-signed cert)
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF -- using defaults" >&2; else source "$_CONF"; fi

HOSTNAME="${SURVIVE_HOSTNAME:-survive}"
CERT_DIR="/etc/nginx/certs"
CERT="$CERT_DIR/survive.crt"
KEY="$CERT_DIR/survive.key"
CA_CERT="$CERT_DIR/survive-ca.pem"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${BLUE}[TLS]${NC} $*"; }
success() { echo -e "${GREEN}[TLS]${NC} $*"; }
warn()    { echo -e "${YELLOW}[TLS]${NC} $*"; }

[[ $EUID -eq 0 ]] || { echo "Run with sudo: sudo bash $0"; exit 1; }

mkdir -p "$CERT_DIR"
chmod 700 "$CERT_DIR"

# Detect the Pi's LAN IP for the certificate SAN
LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [[ -z "$LAN_IP" ]]; then
    LAN_IP="192.168.1.1"
    warn "Could not detect LAN IP, defaulting to $LAN_IP"
fi

# Prefer mkcert if available (produces locally-trusted certs that enable PWA
# service workers on LAN without browser warnings). Fall back to openssl.
if command -v mkcert &>/dev/null; then
    info "Using mkcert for locally-trusted certificates..."
    mkcert -install 2>/dev/null || true
    mkcert -cert-file "$CERT" -key-file "$KEY" \
        "$HOSTNAME.local" "$HOSTNAME" "localhost" "127.0.0.1" "$LAN_IP"
    CAROOT=$(mkcert -CAROOT 2>/dev/null)
    if [[ -n "$CAROOT" && -f "$CAROOT/rootCA.pem" ]]; then
        cp "$CAROOT/rootCA.pem" "$CA_CERT"
        chmod 644 "$CA_CERT"
        success "CA certificate copied to $CA_CERT"
        info "Install this CA on client devices to trust HTTPS without warnings."
        info "This also enables PWA service workers on LAN (required for https://$LAN_IP)."
    fi
else
    info "mkcert not found -- using self-signed certificate (install mkcert for PWA support)"
    info "  Install mkcert: curl -JLO https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v*-linux-arm64"
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout "$KEY" \
        -out "$CERT" \
        -subj "/C=US/ST=Local/L=Local/O=SurviveV1/CN=$HOSTNAME.local" \
        -addext "subjectAltName=DNS:$HOSTNAME.local,DNS:$HOSTNAME,IP:127.0.0.1,IP:$LAN_IP"
    warn "Self-signed certs trigger browser warnings and do NOT enable PWA service workers."
    warn "For full PWA support on LAN, install mkcert and re-run this script."
fi

chmod 600 "$KEY"
chmod 644 "$CERT"

info "Updating nginx config for HTTPS..."
NGINX_CONF="/etc/nginx/sites-available/survive"
if [[ -f "$NGINX_CONF" ]]; then
    # Append HTTPS server block if not already present
    if ! grep -q "listen 443" "$NGINX_CONF"; then
        cat >> "$NGINX_CONF" << NGINX

server {
    listen 443 ssl;
    server_name $HOSTNAME.local $HOSTNAME _;

    ssl_certificate     $CERT;
    ssl_certificate_key $KEY;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    access_log /var/log/nginx/survive_access.log;
    error_log  /var/log/nginx/survive_error.log;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=31536000" always;

    location / {
        proxy_pass         http://127.0.0.1:8080;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_read_timeout 300s;
        client_max_body_size 500M;
    }

    location /wiki/ {
        proxy_pass http://127.0.0.1:8081/;
        proxy_set_header Host \$host;
    }

    location /learn/ {
        proxy_pass http://127.0.0.1:8082/;
        proxy_set_header Host \$host;
    }

    location /videos/ {
        proxy_pass http://127.0.0.1:8096/;
        proxy_set_header Host \$host;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location /maps/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host \$host;
    }

    location /files/ {
        alias /mnt/survive/;
        autoindex off;
        sendfile on;
        tcp_nopush on;
    }
}
NGINX
        success "HTTPS server block added to nginx config"
    else
        info "HTTPS block already present in nginx config"
    fi

    nginx -t && systemctl reload nginx
    success "Nginx reloaded with TLS"
fi

# Open HTTPS port in firewall
if command -v ufw &>/dev/null; then
    ufw allow 443/tcp
    success "Port 443 opened in firewall"
fi

echo ""
success "TLS setup complete!"
echo "  HTTPS URL: https://$HOSTNAME.local"
echo "  HTTPS IP:  https://$LAN_IP"
echo "  HTTP URL:  http://$HOSTNAME.local (still works)"
echo ""
if command -v mkcert &>/dev/null && [[ -f "$CA_CERT" ]]; then
    echo "  PWA + Service Worker support: ENABLED (mkcert CA trusted locally)"
    echo ""
    echo "  To enable on other devices, copy and install the CA certificate:"
    echo "    $CA_CERT"
    echo ""
    echo "  Android: Settings → Security → Install from storage"
    echo "  iOS:     AirDrop/email the .pem → Settings → Profile → Install → Trust"
    echo "  Desktop: Import into browser certificate store"
else
    echo "  Browser will show a security warning for self-signed certs."
    echo "  Click 'Advanced' → 'Proceed' to accept."
    echo ""
    echo "  PWA service workers require trusted HTTPS on LAN IPs."
    echo "  Install mkcert for full PWA support: https://github.com/FiloSottile/mkcert"
fi
