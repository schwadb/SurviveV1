# PLAN-ai-rag: Ground the AI assistant in the local knowledge base (RAG)

**Rank: #1 — do this first.**

## Goal

`/api/ai/chat` (web) and `ai/query.sh` (CLI) currently send the user's question
straight to Ollama. The model answers from its 1.5–8 GB of weights alone, while
~800 GB of curated survival content sits unused on the same disk. README.md line
143 and the `/ai` page both *claim* the AI "searches your content" — this plan
makes that claim true.

After this change: before calling Ollama, the server queries Kiwix full-text
search for the user's question, extracts the top article snippets, injects them
into the prompt as context, and returns the answer **plus a `sources` list**
that the UI renders as clickable links into Kiwix.

Leverage: transforms the weakest feature (generic small-model chat) into the
flagship feature (an assistant that cites Where There Is No Doctor instead of
hallucinating dosages). No new dependencies, no new services.

## Exact files to touch

| File | Change |
|------|--------|
| `web/server.py` | add `_kiwix_search()`, `_fetch_article_text()`, `_build_rag_prompt()`; modify `ai_chat()` |
| `web/templates/ai.html` | render `data.sources` under each AI message |
| `ai/query.sh` | same retrieval via `curl` + `python3` helper before calling Ollama |
| `tests/test_smoke.sh` | new assertions (see acceptance criteria) |
| `CLAUDE.md` | document the RAG flow in the web-server section |
| `docs/API.md` | document new `sources` field in the chat response |

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

2. **`_fetch_article_text(url, max_chars=2000)`**: GET
   `http://localhost:{PORT_KIWIX}{url}` (2 s timeout), decode, strip tags with
   `re.sub(r"<script.*?</script>|<style.*?</style>", "", html, flags=re.S)`
   then `re.sub(r"<[^>]+>", " ", ...)` then collapse whitespace. Return the
   first `max_chars` characters. On any exception return the search snippet
   instead (pass it in as a fallback argument).

3. **`_build_rag_prompt(message, articles)`**: returns the system prompt. If
   `articles` is empty, return the current system prompt PLUS one sentence:
   "No reference articles were found for this question; say so if you are
   unsure." Otherwise append:
   ```
   Reference excerpts from the offline library:
   [1] <title>: <text>
   [2] ...
   Answer using these excerpts where relevant and mention which source
   numbers you used.
   ```

4. **Modify `ai_chat()`**: after validating `message`, call
   `articles = _kiwix_search(message)`; fetch text for each; build the system
   prompt with `_build_rag_prompt`. Add to the JSON response:
   `"sources": [{"title": a["title"], "url": f"http://{request.host.split(':')[0]}:{PORT_KIWIX}{a['url']}"} for a in articles]`.

5. **`ai.html`**: in the `sendMessage()` success path, after
   `addMessage('ai', data.response)`, if `data.sources?.length`, append a
   small `<div>` to the last bubble with links (create elements with
   `textContent` for titles — never innerHTML — and `href` from
   `data.sources[i].url`, `target="_blank"`).

6. **`ai/query.sh`**: before the Ollama call, add a `get_context()` function:
   `curl -sf --max-time 3 "http://localhost:8081/search?pattern=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$QUERY")&pageLength=3&format=xml"`
   piped through a small `python3 -c` XML-to-text snippet. Prepend the result
   to the prompt. If curl fails (Kiwix down), proceed exactly as today.

7. Update `tests/test_smoke.sh`, `CLAUDE.md`, `docs/API.md`.

## Edge cases a weaker model would miss

- **Context window overflow**: the `survive` model runs `num_ctx 4096`
  (~16 000 chars). Cap: 3 articles × 2 000 chars + system prompt + question
  ≈ 7 500 chars — safe. Do NOT raise article count or `max_chars` without
  raising `num_ctx` in `ai/Modelfile.survival` (which costs RAM on 4 GB Pis).
- **Kiwix returns HTML error pages with HTTP 200** for some malformed
  patterns — guard the XML parse, don't trust the status code.
- **`format=xml` requires kiwix-tools ≥ 3.x** (Bookworm apt ships 3.3+; the
  installer uses that). If the XML parse fails, degrade to no-context chat —
  never 500.
- **The two-worker gunicorn setup**: retrieval adds up to ~8 s worst-case
  (1 search + 3 article fetches at 2 s each) before the Ollama call. Fetch
  the 3 articles with the existing `ThreadPoolExecutor` pattern
  (max_workers=3) so worst case is ~4 s total, not 8.
- **Rate limiting**: `/api/ai/chat` stays at 5/min; retrieval calls are
  server-internal and NOT rate-limited — do not route them through Flask.
- **Search pattern injection**: the message is user input inside a URL —
  `urllib.parse.quote()` is mandatory; do not f-string it raw.
- **Empty ZIM library** (fresh install, nothing downloaded): `/search`
  returns a valid empty result; `_kiwix_search` must return `[]`, and the
  prompt fallback sentence keeps the model honest.
- **Do not** cache retrieval results in the TTL caches — every question is
  different; caching would return wrong context.

## Acceptance criteria

1. `bash tests/test_smoke.sh` — all existing assertions still pass, plus:
   - POST `/api/ai/chat` with valid JSON while Kiwix is **down** still
     returns 502 (Ollama down in test env) — i.e. retrieval failure does not
     change the error contract.
2. With Kiwix running and a ZIM loaded, `curl -s -X POST localhost:8080/api/ai/chat -H 'Content-Type: application/json' -d '{"message":"how do I treat a burn"}' | python3 -m json.tool`
   returns a `sources` array with ≥1 entry whose `url` starts with `http://` and contains `:8081`.
3. `pylint web/server.py --disable=C0114,C0115,C0116,R0903,R0913,R0914 --fail-under=7.0` still ≥ 9.5.
4. In the browser, an AI answer shows a "Sources" line with clickable links that open Kiwix articles.
5. `bash ai/query.sh "how do I purify water"` prints an answer; with kiwix-serve stopped it still prints an answer (no crash).
