#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Ollama setup and model management
# Optimized for Raspberry Pi 5 (4 GB default). Hailo-8L does NOT accelerate
# LLMs -- only Hailo-10H (AI HAT+ 2) does. Ollama always runs on CPU here.
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF -- using defaults" >&2; else source "$_CONF"; fi

STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
MODELS_DIR="$STORAGE_PATH/ai_models/ollama"
export OLLAMA_MODELS="$MODELS_DIR"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${BLUE}[OLLAMA]${NC} $*"; }
success() { echo -e "${GREEN}[OLLAMA]${NC} $*"; }
warn()    { echo -e "${YELLOW}[OLLAMA]${NC} $*"; }

mkdir -p "$MODELS_DIR"

# ── Detect total RAM in MB (used to gate model selection) ─────────────────────
total_ram_mb() {
    awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0
}

# ── Warn if Hailo hardware is present but cannot accelerate LLMs ──────────────
detect_hailo() {
    if command -v hailortcli &>/dev/null; then
        local hw
        hw=$(hailortcli fw-control identify 2>/dev/null | awk -F: '/Device Architecture/ {print $2}' | tr -d ' ')
        if [[ -n "$hw" ]]; then
            info "Detected Hailo device: $hw"
            if [[ "$hw" == *"HAILO8"* ]] && [[ "$hw" != *"HAILO10"* ]]; then
                warn "Hailo-8L cannot accelerate LLMs (vision-only, 13 TOPS)."
                warn "Ollama will run on CPU. See docs/ai_hat_setup.md."
            fi
        fi
    fi
}

# ── Ensure Ollama is running ──────────────────────────────────────────────────
start_ollama() {
    if ! pgrep -x ollama &>/dev/null; then
        info "Starting Ollama server..."
        OLLAMA_MODELS="$MODELS_DIR" ollama serve &>/var/log/survive_ollama.log &
        sleep 4
    fi
    if curl -s http://localhost:11434 &>/dev/null; then
        success "Ollama is running"
    else
        warn "Ollama may not be ready yet -- waiting..."
        sleep 5
    fi
}

# ── Pull models sized to the available RAM ────────────────────────────────────
pull_models() {
    local ram_mb
    ram_mb=$(total_ram_mb)
    info "Detected ${ram_mb} MB total RAM"

    # Always-safe baseline: ~1 GB models for any Pi.
    local PRIORITY_MODELS=("tinyllama" "llama3.2:1b")
    # Mid tier: adds ~2-3 GB models, requires 6 GB+ total RAM.
    local MID_MODELS=("phi3:mini" "llama3.2:3b")
    # Large tier: 7B quantized models, requires 8 GB+ total RAM.
    local LARGE_MODELS=("mistral:7b-q4_0")

    info "Pulling small models (safe on any Pi)..."
    for model in "${PRIORITY_MODELS[@]}"; do
        info "Pulling $model..."
        OLLAMA_MODELS="$MODELS_DIR" ollama pull "$model" \
            && success "$model downloaded" \
            || warn "$model failed -- check disk space"
    done

    if (( ram_mb >= 6144 )); then
        info "6 GB+ RAM -- pulling mid-tier models..."
        for model in "${MID_MODELS[@]}"; do
            info "Pulling $model..."
            OLLAMA_MODELS="$MODELS_DIR" ollama pull "$model" \
                && success "$model downloaded" \
                || warn "$model failed"
        done
    else
        warn "< 6 GB RAM -- skipping phi3:mini and llama3.2:3b (would OOM)."
    fi

    if (( ram_mb >= 8192 )); then
        local free_gb
        free_gb=$(df -BG "$MODELS_DIR" | tail -1 | awk '{print $4}' | tr -d 'G')
        if [[ "$free_gb" =~ ^[0-9]+$ ]] && (( free_gb >= 10 )); then
            info "8 GB+ RAM and ${free_gb} GB free -- pulling 7B model..."
            for model in "${LARGE_MODELS[@]}"; do
                OLLAMA_MODELS="$MODELS_DIR" ollama pull "$model" \
                    && success "$model downloaded" \
                    || warn "$model failed"
            done
        else
            warn "< 10 GB free -- skipping 7B models"
        fi
    else
        warn "< 8 GB RAM -- skipping 7B models (will OOM)."
    fi
}

# ── Create survival-optimized Modelfile ──────────────────────────────────────
# shellcheck disable=SC2120  # optional arg kept for future base-model overrides
create_survival_model() {
    local base_model="${1:-llama3.2:1b}"
    info "Creating survival-optimized model from $base_model..."
    # The Modelfile is stored alongside the repo so it is version-controlled.
    # num_ctx=2048 keeps RAM use sane on 4 GB devices.
    local MODELFILE="$REPO_DIR/ai/Modelfile.survival"
    if [[ ! -f "$MODELFILE" ]]; then
        warn "Modelfile not found at $MODELFILE -- skipping survive model creation"
        return
    fi
    OLLAMA_MODELS="$MODELS_DIR" ollama create survive -f "$MODELFILE" \
        && success "Custom 'survive' model created" \
        || warn "Custom model creation failed"
}

# ── Test models ───────────────────────────────────────────────────────────────
test_models() {
    info "Testing installed models..."
    MODELS_LIST=$(OLLAMA_MODELS="$MODELS_DIR" ollama list 2>/dev/null | tail -n +2 | awk '{print $1}')

    if [[ -z "$MODELS_LIST" ]]; then
        warn "No models installed yet"
        return
    fi

    echo "Installed models:"
    OLLAMA_MODELS="$MODELS_DIR" ollama list

    info "Quick test with tinyllama..."
    RESPONSE=$(OLLAMA_MODELS="$MODELS_DIR" ollama run tinyllama \
        "In one sentence: how do you purify water by boiling?" 2>/dev/null || echo "FAILED")
    echo "Response: $RESPONSE"
}

# ── Print usage ───────────────────────────────────────────────────────────────
print_usage() {
    success "Ollama setup complete!"
    echo ""
    echo "  List models:    ollama list"
    echo "  Chat with AI:   ollama run survive"
    echo "  Quick query:    ollama run tinyllama 'How do I start a fire?'"
    echo "  Web UI:         http://localhost:8080/ai"
    echo ""
    echo "  Models stored:  $MODELS_DIR"
    du -sh "$MODELS_DIR" 2>/dev/null || true
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    case "${1:-setup}" in
        setup)
            detect_hailo
            start_ollama
            pull_models
            create_survival_model
            test_models
            print_usage
            ;;
        pull) pull_models ;;
        test) start_ollama && test_models ;;
        list) OLLAMA_MODELS="$MODELS_DIR" ollama list ;;
        *) echo "Usage: $0 [setup|pull|test|list]" ;;
    esac
}

main "$@"
