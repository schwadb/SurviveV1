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
# Model selection rationale (CPU-only; Hailo-8L cannot accelerate LLMs):
#
#  gemma4:e2b  ~1.5 GB  8-12 tok/s on Pi 5  — primary; Gemma 4 quality in 2B
#  gemma4:e4b  ~3.5 GB  3-5  tok/s on Pi 5  — quality step-up for 8 GB Pi
#  gemma3:4b   ~2.5 GB  5-7  tok/s on Pi 5  — alternative mid-tier
#  gemma4:12b  ~7.6 GB  NOT RECOMMENDED      — requires 8-10 GB RAM, swaps heavily
pull_models() {
    local ram_mb
    ram_mb=$(total_ram_mb)
    info "Detected ${ram_mb} MB total RAM"

    # Baseline: gemma4:e2b works on any Pi 5 (4 GB or 8 GB); llama3.2:1b is the
    # fallback if the Gemma 4 download fails or the device is very constrained.
    local PRIORITY_MODELS=("gemma4:e2b" "llama3.2:1b")
    # Mid tier: ~3.5 GB, 3-5 tok/s — meaningful quality gain, requires 6 GB+ free.
    local MID_MODELS=("gemma4:e4b" "gemma3:4b")
    # Large tier: only safe on 8 GB Pi with ≥10 GB disk; rare survival queries
    # benefit from the extra reasoning capacity.
    local LARGE_MODELS=("gemma3:12b-it-q4_K_M")

    info "Pulling baseline models (safe on any Pi 5)..."
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
        warn "< 6 GB RAM -- skipping gemma4:e4b and gemma3:4b (would OOM)."
    fi

    if (( ram_mb >= 8192 )); then
        local free_gb
        free_gb=$(df -BG "$MODELS_DIR" | tail -1 | awk '{print $4}' | tr -d 'G')
        if [[ "$free_gb" =~ ^[0-9]+$ ]] && (( free_gb >= 12 )); then
            info "8 GB+ RAM and ${free_gb} GB free -- pulling 12B model..."
            for model in "${LARGE_MODELS[@]}"; do
                OLLAMA_MODELS="$MODELS_DIR" ollama pull "$model" \
                    && success "$model downloaded" \
                    || warn "$model failed"
            done
        else
            warn "< 12 GB free -- skipping 12B model"
        fi
    else
        warn "< 8 GB RAM -- skipping 12B model (will OOM)."
    fi

    # 16 GB tier: gemma4:12b fits without swap (7.6 GB weights + ~3 GB services).
    # Expect ~1-3 tok/s — slow but highest-quality answers for life-critical queries.
    if (( ram_mb >= 14336 )); then
        local free_gb
        free_gb=$(df -BG "$MODELS_DIR" | tail -1 | awk '{print $4}' | tr -d 'G')
        if [[ "$free_gb" =~ ^[0-9]+$ ]] && (( free_gb >= 12 )); then
            info "16 GB Pi detected -- pulling gemma4:12b..."
            OLLAMA_MODELS="$MODELS_DIR" ollama pull "gemma4:12b" \
                && success "gemma4:12b downloaded" \
                || warn "gemma4:12b failed"
        else
            warn "< 12 GB free -- skipping gemma4:12b"
        fi
    fi
}

# ── Select best base model for available RAM ─────────────────────────────────
select_base_model() {
    local ram_mb
    ram_mb=$(total_ram_mb)
    if (( ram_mb >= 14336 )); then
        # 16 GB Pi 5: gemma4:12b — best quality, ~1-3 tok/s (acceptable for
        # survival use where accuracy matters more than speed)
        echo "gemma4:12b"
    elif (( ram_mb >= 6144 )); then
        # 8 GB Pi 5: gemma4:e4b — good quality step-up, 3-5 tok/s
        echo "gemma4:e4b"
    else
        # 4 GB Pi 5: gemma4:e2b — 8-12 tok/s, still Gemma 4 architecture
        echo "gemma4:e2b"
    fi
}

# ── Create survival-optimized Modelfile ──────────────────────────────────────
create_survival_model() {
    local base_model="$1"
    info "Creating survival-optimized model from $base_model..."
    local MODELFILE="$REPO_DIR/ai/Modelfile.survival"
    if [[ ! -f "$MODELFILE" ]]; then
        warn "Modelfile not found at $MODELFILE -- skipping survive model creation"
        return
    fi
    # Patch the FROM line at build time so the correct base is baked in.
    local TMP_MF
    TMP_MF=$(mktemp)
    sed "s|^FROM .*|FROM ${base_model}|" "$MODELFILE" > "$TMP_MF"
    OLLAMA_MODELS="$MODELS_DIR" ollama create survive -f "$TMP_MF" \
        && success "Custom 'survive' model created (base: $base_model)" \
        || warn "Custom model creation failed"
    rm -f "$TMP_MF"
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

    # Test with the best available model in priority order.
    local TEST_MODEL=""
    for candidate in survive gemma4:e2b llama3.2:1b; do
        if OLLAMA_MODELS="$MODELS_DIR" ollama list 2>/dev/null | grep -q "^${candidate}"; then
            TEST_MODEL="$candidate"
            break
        fi
    done

    if [[ -n "$TEST_MODEL" ]]; then
        info "Quick test with $TEST_MODEL..."
        RESPONSE=$(OLLAMA_MODELS="$MODELS_DIR" ollama run "$TEST_MODEL" \
            "In one sentence: how do you purify water by boiling?" 2>/dev/null || echo "FAILED")
        echo "Response: $RESPONSE"
    else
        warn "No testable model found"
    fi
}

# ── Print usage ───────────────────────────────────────────────────────────────
print_usage() {
    success "Ollama setup complete!"
    echo ""
    echo "  List models:    ollama list"
    echo "  Chat with AI:   ollama run survive"
    echo "  Quick query:    ollama run gemma4:e2b 'How do I start a fire?'"
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
            create_survival_model "$(select_base_model)"
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
