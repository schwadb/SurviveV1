#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — AI query CLI
# Usage: bash ai/query.sh "How do I purify water?"
#        bash ai/query.sh --model phi3:mini "How do I set a broken bone?"
# =============================================================================

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF -- using defaults" >&2; else source "$_CONF"; fi

STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/mnt/survive}"
export OLLAMA_MODELS="${OLLAMA_MODELS:-$STORAGE_PATH/ai_models/ollama}"

MODEL="${SURVIVE_AI_MODEL:-survive}"
INTERACTIVE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --model|-m) MODEL="$2"; shift 2 ;;
        --interactive|-i) INTERACTIVE=true; shift ;;
        *) QUERY="$*"; break ;;
    esac
done

# ── Check Ollama ──────────────────────────────────────────────────────────────
if ! curl -sf http://localhost:11434 &>/dev/null; then
    echo "Starting Ollama..."
    ollama serve &>/dev/null &
    sleep 3
fi

# ── Fallback model if 'survive' not installed ──────────────────────────────────
if ! ollama list 2>/dev/null | grep -q "^${MODEL}"; then
    # Try to find any installed model
    FALLBACK=$(ollama list 2>/dev/null | tail -n +2 | head -1 | awk '{print $1}')
    if [[ -n "$FALLBACK" ]]; then
        echo "Model '$MODEL' not found, using $FALLBACK"
        MODEL="$FALLBACK"
    else
        echo "No AI models installed. Run: bash ai/setup_ollama.sh"
        exit 1
    fi
fi

# ── Interactive mode ──────────────────────────────────────────────────────────
if [[ "$INTERACTIVE" == "true" ]] || [[ -z "${QUERY:-}" ]]; then
    echo "SurviveV1 AI Assistant (model: $MODEL)"
    echo "Type 'exit' or Ctrl+C to quit"
    echo ""
    exec ollama run "$MODEL"
fi

# ── Single query ──────────────────────────────────────────────────────────────
echo ""
echo "Query: $QUERY"
echo "Model: $MODEL"
echo "─────────────────────────────────────"
ollama run "$MODEL" "$QUERY"
