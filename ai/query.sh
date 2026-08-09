#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — AI query CLI
# Usage: bash ai/query.sh "How do I purify water?"
#        bash ai/query.sh --model phi3:mini "How do I set a broken bone?"
# =============================================================================

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_CONF="$REPO_DIR/config/survive.conf"
[[ -f "$_CONF" ]] || _CONF="${_CONF}.example"   # fall back to shipped defaults
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

# ── Retrieve context from the local Kiwix library (RAG) ────────────────────────
# Best-effort: if kiwix-serve is down or returns nothing, we fall through to a
# plain query so the assistant still works.
KIWIX_PORT="${PORT_KIWIX:-8081}"

get_context() {
    local q="$1" encoded
    encoded=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$q" 2>/dev/null) \
        || return 1
    curl -sf --max-time 3 \
        "http://localhost:${KIWIX_PORT}/search?pattern=${encoded}&pageLength=3&format=xml" 2>/dev/null \
    | python3 -c '
import sys, re
import xml.etree.ElementTree as ET
try:
    root = ET.fromstring(sys.stdin.read())
except Exception:
    sys.exit(0)
tag = re.compile(r"<[^>]+>")
out = []
for item in root.iter("item"):
    title = (item.findtext("title") or "").strip()
    desc = re.sub(r"\s+", " ", tag.sub(" ", item.findtext("description") or "")).strip()
    if title:
        out.append(f"- {title}: {desc}")
print("\n".join(out[:3]))
' 2>/dev/null
}

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

CONTEXT=$(get_context "$QUERY" || true)
if [[ -n "$CONTEXT" ]]; then
    echo "(grounding answer in $(printf '%s\n' "$CONTEXT" | grep -c '^- ') reference article(s) from your library)"
    echo ""
    PROMPT="Reference excerpts from the offline library:
${CONTEXT}

Using the excerpts above where relevant, answer concisely: ${QUERY}"
else
    PROMPT="$QUERY"
fi
ollama run "$MODEL" "$PROMPT"
