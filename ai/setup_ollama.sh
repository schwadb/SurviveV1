#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Ollama setup and model management
# Optimized for Raspberry Pi 5 + Hailo AI Hat
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
        warn "Ollama may not be ready yet — waiting..."
        sleep 5
    fi
}

# ── Pull models ───────────────────────────────────────────────────────────────
pull_models() {
    info "Pulling recommended models for Raspberry Pi..."

    declare -A MODELS=(
        # Model            Size    Description
        ["tinyllama"]="637MB   - Fastest, ~1GB RAM, good for quick Q&A"
        ["phi3:mini"]="2.3GB  - Microsoft Phi-3, excellent at reasoning"
        ["llama3.2:3b"]="2.0GB  - Meta Llama 3.2 3B, best balance for RPi5"
        ["mistral:7b-q4_0"]="4.1GB  - Best quality 7B, needs 6GB+ RAM"
    )

    # Always pull the smallest model first
    PRIORITY_MODELS=("tinyllama" "phi3:mini" "llama3.2:3b")

    for model in "${PRIORITY_MODELS[@]}"; do
        info "Pulling $model (${MODELS[$model]:-})..."
        OLLAMA_MODELS="$MODELS_DIR" ollama pull "$model" \
            && success "$model downloaded" \
            || warn "$model failed — check disk space"
    done

    # Pull larger model only if sufficient disk space
    FREE_GB=$(df -BG "$MODELS_DIR" | tail -1 | awk '{print $4}' | tr -d 'G')
    if [[ "$FREE_GB" -gt 10 ]]; then
        info "Sufficient space — pulling mistral:7b..."
        OLLAMA_MODELS="$MODELS_DIR" ollama pull "mistral:7b-q4_0" \
            && success "mistral:7b downloaded" \
            || warn "mistral:7b failed"
    else
        warn "Less than 10GB free — skipping large models"
    fi
}

# ── Create survival-optimized Modelfiles ─────────────────────────────────────
create_survival_model() {
    info "Creating survival-optimized model..."
    MODELFILE="$REPO_DIR/ai/Modelfile.survival"

    cat > "$MODELFILE" << 'EOF'
FROM llama3.2:3b

SYSTEM """
You are SURVIVE, an offline AI assistant running on a Raspberry Pi 5 in a
post-apocalyptic, grid-down scenario. You have no internet access.

Your role is to help with practical survival knowledge:
- WATER: Purification, sourcing, storage
- FOOD: Foraging, farming, preservation, hunting
- MEDICAL: Emergency first aid, wound care, natural medicine
- SHELTER: Construction, insulation, fire
- ENERGY: Solar, wind, batteries, fuel conservation
- COMMUNICATION: Ham radio, signals, navigation
- TOOLS: Repair, improvised tools, metalwork
- SKILLS: Bushcraft, wilderness survival

Guidelines:
- Be CONCISE and PRACTICAL — no fluff
- Prioritize safety when giving medical advice
- When unsure, say so clearly
- Reference exact steps when explaining procedures
- Assume no power grid, no internet, limited resources
- Imperial AND metric measurements
"""

PARAMETER temperature 0.7
PARAMETER top_p 0.9
PARAMETER num_ctx 4096
EOF

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

    # Quick test
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
