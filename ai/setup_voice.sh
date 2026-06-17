#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Voice AI setup (Whisper STT + Piper TTS)
# Enables hands-free AI queries: speak a question, hear the answer.
# All inference runs locally on the Pi 5 CPU — no internet required.
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF -- using defaults" >&2; else source "$_CONF"; fi

STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
VOICE_DIR="$STORAGE_PATH/ai_models/voice"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${BLUE}[VOICE]${NC} $*"; }
success() { echo -e "${GREEN}[VOICE]${NC} $*"; }
warn()    { echo -e "${YELLOW}[VOICE]${NC} $*"; }

mkdir -p "$VOICE_DIR"/{whisper,piper}

# ── Install Whisper.cpp (speech-to-text) ─────────────────────────────────────
install_whisper() {
    info "Setting up Whisper STT..."
    local WHISPER_DIR="$VOICE_DIR/whisper"

    if [[ -f "$WHISPER_DIR/main" ]]; then
        info "Whisper binary already exists, skipping build"
        return 0
    fi

    local BUILD_DIR
    BUILD_DIR=$(mktemp -d)
    info "Cloning whisper.cpp..."
    git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git "$BUILD_DIR" || {
        warn "Failed to clone whisper.cpp -- check network"
        rm -rf "$BUILD_DIR"
        return 1
    }

    info "Building whisper.cpp (this may take 5-10 minutes on Pi 5)..."
    cd "$BUILD_DIR"
    make -j4 main 2>/dev/null || make main || {
        warn "Whisper build failed -- ensure build-essential is installed"
        cd "$REPO_DIR"
        rm -rf "$BUILD_DIR"
        return 1
    }

    cp main "$WHISPER_DIR/main"
    cd "$REPO_DIR"
    rm -rf "$BUILD_DIR"
    success "Whisper binary built"

    info "Downloading Whisper tiny.en model (~75 MB, fastest for Pi 5)..."
    local MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin"
    if [[ ! -f "$WHISPER_DIR/ggml-tiny.en.bin" ]]; then
        wget -q --show-progress -O "$WHISPER_DIR/ggml-tiny.en.bin" "$MODEL_URL" \
            && success "Whisper model downloaded" \
            || warn "Whisper model download failed"
    else
        info "Whisper model already exists"
    fi
}

# ── Install Piper (text-to-speech) ───────────────────────────────────────────
install_piper() {
    info "Setting up Piper TTS..."
    local PIPER_DIR="$VOICE_DIR/piper"

    if [[ -f "$PIPER_DIR/piper" ]]; then
        info "Piper binary already exists, skipping"
    else
        local ARCH
        ARCH=$(uname -m)
        local PIPER_TAR="piper_linux_${ARCH}.tar.gz"
        local PIPER_URL="https://github.com/rhasspy/piper/releases/latest/download/${PIPER_TAR}"

        info "Downloading Piper TTS for $ARCH..."
        wget -q --show-progress -O "/tmp/$PIPER_TAR" "$PIPER_URL" || {
            warn "Piper download failed -- check network or architecture ($ARCH)"
            return 1
        }
        tar -xzf "/tmp/$PIPER_TAR" -C "$PIPER_DIR" --strip-components=1
        rm -f "/tmp/$PIPER_TAR"
        success "Piper TTS installed"
    fi

    if [[ ! -f "$PIPER_DIR/en_US-lessac-medium.onnx" ]]; then
        info "Downloading Piper voice model (en_US-lessac-medium, ~60 MB)..."
        wget -q --show-progress -O "$PIPER_DIR/en_US-lessac-medium.onnx" \
            "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx" \
            && success "Voice model downloaded" \
            || warn "Voice model download failed"
        wget -q -O "$PIPER_DIR/en_US-lessac-medium.onnx.json" \
            "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json" \
            2>/dev/null || true
    else
        info "Voice model already exists"
    fi
}

# ── Verify installation ──────────────────────────────────────────────────────
verify() {
    info "Verifying installation..."
    local ok=true

    if [[ -f "$VOICE_DIR/whisper/main" ]]; then
        success "Whisper STT: OK"
    else
        warn "Whisper STT: NOT INSTALLED"
        ok=false
    fi

    if [[ -f "$VOICE_DIR/whisper/ggml-tiny.en.bin" ]]; then
        success "Whisper model: OK"
    else
        warn "Whisper model: NOT INSTALLED"
        ok=false
    fi

    if [[ -f "$VOICE_DIR/piper/piper" ]]; then
        success "Piper TTS: OK"
    else
        warn "Piper TTS: NOT INSTALLED"
        ok=false
    fi

    if [[ -f "$VOICE_DIR/piper/en_US-lessac-medium.onnx" ]]; then
        success "Piper voice model: OK"
    else
        warn "Piper voice model: NOT INSTALLED"
        ok=false
    fi

    if $ok; then
        success "Voice AI fully installed!"
        echo ""
        echo "  Voice features are now available on the AI chat page."
        echo "  Whisper model: $VOICE_DIR/whisper/"
        echo "  Piper model:   $VOICE_DIR/piper/"
        du -sh "$VOICE_DIR" 2>/dev/null || true
    fi
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    case "${1:-setup}" in
        setup)
            install_whisper
            install_piper
            verify
            ;;
        whisper) install_whisper ;;
        piper)   install_piper ;;
        verify)  verify ;;
        *) echo "Usage: $0 [setup|whisper|piper|verify]" ;;
    esac
}

main "$@"
