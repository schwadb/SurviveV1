#!/usr/bin/env bash
# =============================================================================
# SurviveV1 — Smoke tests for the dashboard web server
# Usage: bash tests/test_smoke.sh [--port 8080]
# Starts a test server, hits key endpoints, reports pass/fail, then stops.
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${TEST_PORT:-18080}"  # use non-standard port to avoid conflicts
SERVER_PID=""

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
pass()  { echo -e "  ${GREEN}[PASS]${NC}  $*"; PASSED=$((PASSED+1)); }
fail()  { echo -e "  ${RED}[FAIL]${NC}  $*"; FAILED=$((FAILED+1)); }
info()  { echo -e "  ${BLUE}[INFO]${NC}  $*"; }

PASSED=0
FAILED=0

cleanup() {
    if [[ -n "$SERVER_PID" ]]; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT

# ── Start test server ─────────────────────────────────────────────────────────
start_server() {
    info "Starting test server on port $PORT..."

    # Activate venv if available
    PYTHON="python3"
    [[ -f /opt/survive/venv/bin/python3 ]] && PYTHON=/opt/survive/venv/bin/python3
    [[ -f "$REPO_DIR/.venv/bin/python3" ]] && PYTHON="$REPO_DIR/.venv/bin/python3"

    PORT="$PORT" SURVIVE_STORAGE_PATH="${SURVIVE_STORAGE_PATH:-/tmp/survive_test}" \
        "$PYTHON" "$REPO_DIR/web/server.py" > /tmp/survive_test.log 2>&1 &
    SERVER_PID=$!

    # Wait for server to become ready
    local retries=20
    while [[ $retries -gt 0 ]]; do
        if curl -sf "http://localhost:$PORT/" >/dev/null 2>&1; then
            pass "Server started (PID $SERVER_PID)"
            return 0
        fi
        sleep 0.5
        retries=$((retries-1))
    done

    fail "Server did not start within 10 seconds"
    cat /tmp/survive_test.log
    return 1
}

# ── HTTP check helper ─────────────────────────────────────────────────────────
check_http() {
    local name="$1"
    local url="$2"
    local expected_status="${3:-200}"

    local actual
    actual=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT$url")

    if [[ "$actual" == "$expected_status" ]]; then
        pass "$name → HTTP $actual"
    else
        fail "$name → expected HTTP $expected_status, got HTTP $actual"
    fi
}

check_json() {
    local name="$1"
    local url="$2"

    local body
    body=$(curl -sf "http://localhost:$PORT$url" 2>/dev/null || echo "CURL_FAILED")

    if [[ "$body" == "CURL_FAILED" ]]; then
        fail "$name → curl failed"
        return
    fi

    if echo "$body" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
        pass "$name → valid JSON"
    else
        fail "$name → invalid JSON response"
    fi
}

# ── Tests ─────────────────────────────────────────────────────────────────────
run_tests() {
    echo ""
    echo -e "${BLUE}── Route tests ──────────────────────────────────────${NC}"
    check_http "GET /"            "/"
    check_http "GET /status"      "/status"
    check_http "GET /ai"          "/ai"
    check_http "GET /files"       "/files"
    check_http "GET /search"      "/search"
    check_http "GET /search?q=water" "/search?q=water"
    check_http "GET /category/medical"   "/category/medical"
    check_http "GET /category/maps"      "/category/maps"
    check_http "GET /category/bad-id redirects" "/category/nonexistent-category-xyz" "302"

    echo ""
    echo -e "${BLUE}── API tests ────────────────────────────────────────${NC}"
    check_json "GET /api/status"  "/api/status"
    check_json "GET /api/recent"  "/api/recent"
    check_json "GET /api/connectivity" "/api/connectivity"
    check_json "GET /api/downloads" "/api/downloads"
    # Fresh test storage: every download category should read as pending.
    if curl -sf "http://localhost:$PORT/api/downloads" | grep -q '"pending"'; then
        pass "GET /api/downloads → categories pending on empty storage"
    else
        fail "GET /api/downloads → expected a pending category"
    fi

    echo ""
    echo -e "${BLUE}── Security tests ───────────────────────────────────${NC}"
    check_http "Symlink escape blocked"   "/serve/escape_link/passwd" "403"
    check_http "404 handler works"       "/nonexistent-page-12345" "404"
    check_http "Path traversal blocked on /files"  "/files?path=../../etc" "403"
    # Flask normalizes `..` in URL paths before routing, so /serve/..x becomes
    # a non-existent resource (404). The real traversal defence is covered by
    # the symlink-escape test above.

    echo ""
    echo -e "${BLUE}── Health endpoint ──────────────────────────────────${NC}"
    check_http "GET /health"      "/health"
    check_json "GET /health body" "/health"

    echo ""
    echo -e "${BLUE}── AI chat API ──────────────────────────────────────${NC}"
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST "http://localhost:$PORT/api/ai/chat" \
        -H "Content-Type: application/json" \
        -d '{}')
    if [[ "$STATUS" == "400" ]]; then
        pass "POST /api/ai/chat (empty JSON body) → HTTP 400 (correct)"
    else
        fail "POST /api/ai/chat (empty JSON body) → expected 400, got $STATUS"
    fi
    # Content-Type guard: form-encoded POST must be rejected with 415.
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST "http://localhost:$PORT/api/ai/chat" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d 'message=hi')
    if [[ "$STATUS" == "415" ]]; then
        pass "POST /api/ai/chat (form-encoded) → HTTP 415 (blocked)"
    else
        fail "POST /api/ai/chat (form-encoded) → expected 415, got $STATUS"
    fi
    # Pre-stream error contract: a valid request with Ollama down (no service in
    # the test env) must still return a real 502 with a JSON body, not a stream.
    RESP=$(curl -s -w "\n%{http_code}\n%{content_type}" \
        -X POST "http://localhost:$PORT/api/ai/chat" \
        -H "Content-Type: application/json" \
        -d '{"message":"test"}')
    STATUS=$(echo "$RESP" | tail -2 | head -1)
    CTYPE=$(echo "$RESP" | tail -1)
    if [[ "$STATUS" == "502" ]] && [[ "$CTYPE" == application/json* ]]; then
        pass "POST /api/ai/chat (Ollama down) → HTTP 502 JSON (error contract intact)"
    else
        fail "POST /api/ai/chat (Ollama down) → expected 502 JSON, got $STATUS / $CTYPE"
    fi
}

# ── Main ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}  SurviveV1 Smoke Tests${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"

# Create minimal test storage dir and a symlink that escapes it (used in security test)
mkdir -p /tmp/survive_test
ln -sfn /etc /tmp/survive_test/escape_link

start_server
run_tests

echo ""
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "  Passed: ${GREEN}$PASSED${NC}  Failed: ${RED}$FAILED${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""

[[ "$FAILED" -eq 0 ]] && exit 0 || exit 1
