# PLAN-ai-rag: Ground the AI assistant in the local knowledge base (RAG)

**Rank: #1 — do this first.**

## Goal

`/api/ai/chat` (web) and `ai/query.sh` (CLI) send the user's question straight
to Ollama. The model answers from its 1.5–8 GB of weights alone, while ~800 GB
of curated survival content sits unused on the same disk. README and the `/ai`
page both *claim* the AI "searches your content" — this plan makes that true.

After this change: before calling Ollama, the server queries Kiwix full-text
search for the user's question, extracts the top article excerpts, injects
them into the system prompt, and streams the answer **plus a `sources` list**
that the UI renders as clickable links into Kiwix.

Leverage: transforms the weakest feature (generic small-model chat) into the
flagship feature (an assistant that cites *Where There Is No Doctor* instead
of hallucinating dosages). No new dependencies, no new services.

**Architecture note (updated 2026-07): `ai_chat()` now streams via SSE.**
The route validates with `_validate_chat_request()`, builds the prompt with
`_build_messages(data)`, and returns `Response(generate(), mimetype=
"text/event-stream")` where `generate()` yields `data: {"token": ...}` /
`{"done": true}` / `{"error": ...}` events. RAG must slot into this flow —
do NOT resurrect the old blocking JSON response.

## Exact files to touch

| File | Change |
|------|--------|
| `web/server.py` | add `_kiwix_search()`, `_fetch_article_text()`; modify `_build_messages()` and `ai_chat()` |
| `web/templates/ai.html` | handle a new `sources` SSE event; render links under the answer |
| `ai/query.sh` | same retrieval via `curl` + `python3` helper before calling Ollama |
| `tests/test_smoke.sh` | new assertions (see acceptance criteria) |
| `CLAUDE.md` | document the RAG flow in the web-server section |

## Implementation order

1. **`_kiwix_search(query, limit=3)` in `web/server.py`** (place next to the
   other helpers, after `check_all_services`). Kiwix-serve exposes OpenSearch
   XML:
   `GET http://localhost:{PORT_KIWIX}/search?pattern=<urlencoded>&pageLength=<limit>&format=xml`
   Parse with `xml.etree.ElementTree` (stdlib). Each `<item>` has `<title>`,
   `<link>` (relative article URL), `<description>` (snippet). Return
   `[{"title", "url", "snippet"}]`. Wrap the whole body in
   `try/except (OSError, ET.ParseError): return []`. Use
   `urllib.parse.quote()` on the pattern. Timeout: reuse
   `TIMEOUT_OLLAMA_LIST` (2 s) — retrieval must never eat the chat budget.

2. **`_fetch_article_text(url, fallback_snippet, max_chars=1500)`**: GET
   `http://localhost:{PORT_KIWIX}{url}` (2 s timeout), decode, strip tags with
   `re.sub(r"<script.*?</script>|<style.*?</style>", "", html, flags=re.S)`
   then `re.sub(r"<[^>]+>", " ", ...)`, collapse whitespace, return first
   `max_chars` chars. On any exception return `fallback_snippet`. Fetch the
   3 articles concurrently with the existing `ThreadPoolExecutor` pattern
   (`max_workers=3`) so worst case is ~4 s, not ~8 s serial.

3. **Extend `_build_messages(data, articles=None)`**: keep the signature
   backward-compatible. When `articles` is non-empty, build the system
   message as `_SYSTEM_PROMPT` plus:
   ```
   Reference excerpts from the offline library:
   [1] <title>: <text>
   [2] ...
   Answer using these excerpts where relevant and mention which source
   numbers you used.
   ```
   When `articles` is empty, append instead: "No reference articles were
   found for this question; say so if you are unsure."
   **When articles are present, cap history at the last 6 messages** (add
   `_MAX_HISTORY_RAG = 6` beside `_MAX_HISTORY = 20`) — see context-budget
   edge case below.

4. **Modify `ai_chat()`** — order matters:
   ```python
   data, model, err = _validate_chat_request()
   if err: return err
   articles = _kiwix_search(str(data["message"])[:200])
   # fetch article texts concurrently here
   messages = _build_messages(data, articles)
   host = request.host.split(":")[0]          # BEFORE the generator
   sources = [{"title": a["title"],
               "url": f"http://{host}:{PORT_KIWIX}{a['url']}"} for a in articles]
   def generate():
       yield f"data: {json.dumps({'sources': sources})}\n\n"   # FIRST event
       ... existing streaming body unchanged ...
   ```

5. **`ai.html`**: in the SSE parse loop inside `sendMessage()`, add
   `if (data.sources) { pendingSources = data.sources; continue; }` (it is
   not a token — do not append it to the bubble). After the stream finishes
   and `fullResponse` is non-empty, if `pendingSources.length`, append a
   small `<div>` under the bubble with one link per source — create elements
   with `document.createElement('a')`, set `textContent` (never innerHTML)
   and `href`/`target="_blank"` from the source object.

6. **`ai/query.sh`**: before the Ollama call, add a `get_context()` function:
   `curl -sf --max-time 3 "http://localhost:8081/search?pattern=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$QUERY")&pageLength=3&format=xml"`
   piped through a small `python3 -c` XML-to-text snippet. Prepend the result
   to the prompt. If curl fails (Kiwix down), proceed exactly as today.

7. Update `tests/test_smoke.sh` and `CLAUDE.md`.

## Edge cases a weaker model would miss

- **Request context dies before the generator runs.** Flask executes
  `generate()` *after* the view returns; touching `request.host` inside it
  raises `RuntimeError: Working outside of request context` — and only under
  gunicorn, not always in dev. Compute `host` and `sources` before defining
  the generator (step 4), or you ship a bug that passes local testing.
- **The `sources` SSE event is not a token.** The client loop currently
  assumes every event is `token`/`done`/`error`. Without the explicit
  `data.sources` branch, sources would be silently dropped (best case) or
  break parsing (worst case). Also keep it the FIRST event so the UI can
  show sources even if the model then times out.
- **Context window budget**: the `survive` model runs `num_ctx 4096`
  (~16 000 chars). Worst case now = system (~300) + 3×1 500 context +
  history + user message (≤4 096 chars). With the full 20-message history
  this overflows and Ollama silently truncates *the top of the prompt* —
  i.e. exactly the reference excerpts you just added. The
  `_MAX_HISTORY_RAG = 6` cap in step 3 is what prevents RAG from being
  quietly disabled by long conversations.
- **Kiwix returns HTML error pages with HTTP 200** for some malformed
  patterns — guard the XML parse, don't trust the status code.
- **`format=xml` requires kiwix-tools ≥ 3.x** (Bookworm apt ships 3.3+). If
  the XML parse fails, degrade to no-context chat — never 500.
- **Search pattern injection**: the message is user input inside a URL —
  `urllib.parse.quote()` is mandatory; do not f-string it raw. Also truncate
  the pattern to 200 chars; Kiwix chokes on very long patterns.
- **Rate limiting**: `/api/ai/chat` stays at 5/min; retrieval calls are
  server-internal and NOT rate-limited — do not route them through Flask.
- **Empty ZIM library** (fresh install): `_kiwix_search` returns `[]`; the
  fallback prompt sentence keeps the model honest. The smoke-test env has no
  Kiwix at all — retrieval must fail silently there or every chat test breaks.
- **Do not cache retrieval results** in the TTL caches — every question is
  different; a cached answer context is a wrong answer context.

## Acceptance criteria

1. `bash tests/test_smoke.sh` — all 20 existing assertions still pass, plus:
   POST `/api/ai/chat` with valid JSON while Kiwix AND Ollama are down
   returns HTTP 200 with an SSE body whose first events are a `sources`
   event (empty list) and then an `error` event — i.e. retrieval failure
   does not change the streaming contract.
2. With Kiwix running and a ZIM loaded:
   `curl -sN -X POST localhost:8080/api/ai/chat -H 'Content-Type: application/json' -d '{"message":"how do I treat a burn"}' | head -1`
   prints a `data: {"sources": [...]}` line with ≥1 entry whose `url`
   contains `:8081`.
3. In the browser, an AI answer shows a sources line with clickable links
   that open Kiwix articles; a follow-up question in the same conversation
   still streams (history + RAG coexist).
4. `bash ai/query.sh "how do I purify water"` prints an answer; with
   kiwix-serve stopped it still prints an answer (no crash).
5. `pylint web/server.py` (CI flags) ≥ 9.5; shellcheck passes on `query.sh`.
