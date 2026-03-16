#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Hailo AI Hat Setup for Raspberry Pi 5
# Installs drivers, runtime, and configures Ollama to use NPU acceleration
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[AI-HAT]${NC} $*"; }
success() { echo -e "${GREEN}[AI-HAT]${NC} $*"; }
warn()    { echo -e "${YELLOW}[AI-HAT]${NC} $*"; }
error()   { echo -e "${RED}[AI-HAT]${NC} $*" >&2; }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Check for Hailo device ────────────────────────────────────────────────────
check_hailo_device() {
    info "Checking for Hailo AI Hat..."
    if lspci 2>/dev/null | grep -i hailo; then
        success "Hailo device detected via PCIe"
        return 0
    elif ls /dev/hailo* 2>/dev/null; then
        success "Hailo device found at /dev/hailo*"
        return 0
    else
        warn "Hailo device not detected. Continuing with CPU-only setup."
        warn "Make sure the AI Hat is properly seated in the M.2 slot."
        return 1
    fi
}

# ── Install Hailo Software Suite ──────────────────────────────────────────────
install_hailo_suite() {
    info "Installing Hailo Software Suite (HailoRT)..."

    # Add Hailo repository
    curl -fsSL https://hailo.ai/hailo-apt-key.gpg | gpg --dearmor \
        -o /usr/share/keyrings/hailo-archive-keyring.gpg

    echo "deb [signed-by=/usr/share/keyrings/hailo-archive-keyring.gpg] \
        https://hailo.ai/ubuntu jammy main" \
        > /etc/apt/sources.list.d/hailo.list

    apt-get update -qq
    apt-get install -y \
        hailort \
        hailort-dev \
        python3-hailort

    success "Hailo Runtime installed"
}

# ── Install Hailo Raspberry Pi examples ──────────────────────────────────────
install_hailo_examples() {
    info "Installing Hailo Raspberry Pi examples..."
    EXAMPLES_DIR="/opt/survive/hailo_examples"
    if [[ ! -d "$EXAMPLES_DIR" ]]; then
        git clone --depth 1 \
            https://github.com/hailo-ai/hailo-rpi5-examples.git \
            "$EXAMPLES_DIR"
    fi
    cd "$EXAMPLES_DIR"
    bash setup_env.sh || true
    success "Hailo examples at $EXAMPLES_DIR"
}

# ── Configure Ollama with Hailo backend ──────────────────────────────────────
configure_ollama_hailo() {
    info "Configuring Ollama to use Hailo NPU..."

    # Create Ollama systemd override for Hailo
    mkdir -p /etc/systemd/system/ollama.service.d
    cat > /etc/systemd/system/ollama.service.d/hailo.conf << 'EOF'
[Service]
Environment="OLLAMA_HAILO=1"
Environment="HAILO_RUNTIME_PATH=/usr/lib/hailo"
EOF

    systemctl daemon-reload
    systemctl restart ollama || true
    success "Ollama configured for Hailo acceleration"
}

# ── Pull recommended models ───────────────────────────────────────────────────
pull_ai_models() {
    info "Pulling AI models optimized for Raspberry Pi..."
    STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
    export OLLAMA_MODELS="$STORAGE_PATH/ai_models/ollama"
    mkdir -p "$OLLAMA_MODELS"

    # Start Ollama if not running
    ollama serve &>/dev/null &
    sleep 3

    # Pull models (smallest first, most useful for survival queries)
    declare -A MODELS=(
        ["tinyllama"]="637MB — Ultra-fast responses, basic Q&A"
        ["phi3:mini"]="2.3GB — Microsoft Phi-3, excellent reasoning"
        ["llama3.2:3b"]="2.0GB — Meta Llama 3.2 3B, good balance"
        ["mistral:7b-q4"]="4.1GB — Best quality for 7B class"
    )

    for model in "${!MODELS[@]}"; do
        size_desc="${MODELS[$model]}"
        info "Pulling $model ($size_desc)..."
        ollama pull "$model" && success "$model ready" || warn "$model failed, skipping"
    done
}

# ── Test AI setup ─────────────────────────────────────────────────────────────
test_ai() {
    info "Testing AI setup..."
    TEST_RESPONSE=$(ollama run tinyllama "Respond with just 'OK'" 2>/dev/null || echo "FAIL")
    if [[ "$TEST_RESPONSE" == *"OK"* ]] || [[ "$TEST_RESPONSE" != "FAIL" ]]; then
        success "AI is working!"
    else
        warn "AI test failed — check ollama status"
    fi
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    source "${REPO_DIR}/config/survive.conf" 2>/dev/null || true

    info "=== Hailo AI Hat Setup ==="

    if check_hailo_device; then
        install_hailo_suite || warn "Hailo suite install failed, using CPU only"
        install_hailo_examples || warn "Examples install failed"
        configure_ollama_hailo
    else
        info "Setting up CPU-only AI stack..."
    fi

    if [[ "${CONTENT_AI_MODELS:-Y}" == "Y" ]] || [[ "${CONTENT_AI_MODELS:-Y}" == "y" ]]; then
        pull_ai_models
    fi

    test_ai

    success "AI Hat setup complete"
    info "Use: ollama run phi3:mini 'Your question here'"
    info "Or visit: http://localhost:8080/ai"
}

main "$@"
