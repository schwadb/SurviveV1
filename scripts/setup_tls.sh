#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Self-signed TLS certificate setup for local HTTPS
# Run once after install. Creates a cert valid for 10 years.
# Access via: https://survive.local  (browser will warn about self-signed cert)
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
[[ -f "$_CONF" ]] || _CONF="${_CONF}.example"   # fall back to shipped defaults
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF -- using defaults" >&2; else source "$_CONF"; fi

HOSTNAME="${SURVIVE_HOSTNAME:-survive}"
CERT_DIR="/etc/nginx/certs"
CERT="$CERT_DIR/survive.crt"
KEY="$CERT_DIR/survive.key"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[TLS]${NC} $*"; }
success() { echo -e "${GREEN}[TLS]${NC} $*"; }

[[ $EUID -eq 0 ]] || { echo "Run with sudo: sudo bash $0"; exit 1; }

mkdir -p "$CERT_DIR"
chmod 700 "$CERT_DIR"

info "Generating self-signed certificate for $HOSTNAME.local..."
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout "$KEY" \
    -out "$CERT" \
    -subj "/C=US/ST=Local/L=Local/O=SurviveV1/CN=$HOSTNAME.local" \
    -addext "subjectAltName=DNS:$HOSTNAME.local,DNS:$HOSTNAME,IP:127.0.0.1"

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
echo "  HTTP URL:  http://$HOSTNAME.local (still works)"
echo ""
echo "  Browser will show a security warning for self-signed certs."
echo "  Click 'Advanced' → 'Proceed' to accept."
echo ""
echo "  To trust the cert on your devices, copy $CERT to each device and install."
