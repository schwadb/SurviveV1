# PLAN-ai-streaming: Stream AI responses token-by-token

**Rank: #3.**

## Goal

`/api/ai/chat` calls Ollama with `"stream": False` and buffers the entire
completion. On Pi 5 CPU inference (1–3 tok/s for gemma4:12b) a thorough answer
takes minutes — but `TIMEOUT_AI_CHAT` cuts the request at 60 s, so users of the
best model get an error instead of an answer, and even fast models feel dead
for 20+ seconds.

After this change the endpoint streams NDJSON chunks as Ollama produces them;
the browser renders tokens live. First visible output in ~2 s regardless of
model size; no more truncation of long answers.

**Dependency note:** apply after PLAN-ai-rag (both edit `ai_chat()`); the RAG
retrieval happens once, before streaming starts, and the `sources` are sent
as the **first** NDJSON line.

## Exact files to touch

| File | Change |
|------|--------|
| `web/server.py` | rewrite `ai_chat()` as a streaming generator response |
| `web/templates/ai.html` | consume the stream with `fetch` + `ReadableStream` |
| `config/nginx.conf` | disable proxy buffering for `/api/ai/chat` |
| `systemd/survive-dashboard.service` + `scripts/generate_services.sh` | add `--threads 4` to gunicorn |
| `config/survive.conf` | comment update: TIMEOUT_AI_CHAT becomes idle timeout |
| `tests/test_smoke.sh` | streaming contract test |
| `docs/API.md` | document the NDJSON protocol |

## Implementation order

1. **Server** — in `ai_chat()`, set `"stream": True` in the Ollama payload.
   Replace the single read with a generator:
   ```python
   def generate(upstream):
       yield json.dumps({"sources": sources}) + "\n"
       try:
           for raw_line in upstream:
               chunk = json.loads(raw_line)
               piece = chunk.get("message", {}).get("content", "")
               if piece:
                   yield json.dumps({"delta": piece}) + "\n"
               if chunk.get("done"):
                   yield json.dumps({"done": True, "model": model}) + "\n"
                   return
       except (OSError, json.JSONDecodeError):
           yield json.dumps({"error": "stream interrupted"}) + "\n"
       finally:
           upstream.close()
   ```
   Open the upstream request with
   `urllib.request.urlopen(req, timeout=TIMEOUT_AI_CHAT)` — with streaming,
   `timeout` applies **per socket read** (idle timeout), not total duration.
   Return `Response(stream_with_context(generate(upstream)),
   mimetype="application/x-ndjson", headers={"X-Accel-Buffering": "no"})`.
   Import `Response, stream_with_context` from flask.
   Errors detected BEFORE the first yield (Ollama refused, invalid model)
   must still return plain `jsonify(...), 4xx/502` — same contract as today.

2. **Client** (`ai.html` `sendMessage()`): replace `res.json()` with:
   ```js
   const reader = res.body.getReader();
   const decoder = new TextDecoder();
   let buf = '', aiDiv = null, text = '';
   for (;;) {
     const {value, done} = await reader.read();
     if (done) break;
     buf += decoder.decode(value, {stream: true});
     let nl;
     while ((nl = buf.indexOf('\n')) >= 0) {
       const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
       if (!line.trim()) continue;
       const msg = JSON.parse(line);
       if (msg.delta) {
         if (!aiDiv) { removeTyping(); aiDiv = addMessage('ai', ''); }
         text += msg.delta;
         aiDiv.querySelector('.message-bubble').textContent = text;
         scrollToBottom();
       }
       if (msg.sources) pendingSources = msg.sources;
       if (msg.error) { removeTyping(); addMessage('ai', 'Error: ' + msg.error); }
       if (msg.done && pendingSources?.length) renderSources(aiDiv, pendingSources);
     }
   }
   ```
   Keep the AbortController wiring — `reader.read()` rejects with
   `AbortError` on cancel, which the existing catch handles. Delete the
   55 s warn timer entirely (streaming makes it obsolete).
   Handle non-streaming error responses first: if
   `res.headers.get('content-type')?.includes('application/json')`, fall back
   to the old `res.json()` path.

3. **nginx.conf** — inside the dashboard `location /` is fine for buffered
   pages, but add a dedicated block ABOVE it:
   ```nginx
   location /api/ai/chat {
       proxy_pass         http://127.0.0.1:8080;
       proxy_set_header   Host $host;
       proxy_buffering    off;
       proxy_read_timeout 600s;
   }
   ```

4. **gunicorn threads** — a stream occupies a worker for minutes; with 2 sync
   workers, two concurrent chats freeze the whole dashboard. Change
   `ExecStart` to add `--threads 4` (gthread worker class is implied) in
   `systemd/survive-dashboard.service`, and mirror in
   `scripts/generate_services.sh` and the CLAUDE.md run command.

## Edge cases a weaker model would miss

- **`timeout` semantics flip**: with `stream: False` the 60 s cap was total;
  with streaming it becomes idle-gap-between-chunks. That is the desired
  behavior — a generating model emits a chunk every second. Document this in
  `survive.conf`'s comment or slow models will "work" while the docs say
  they can't.
- **Errors after headers are sent**: once the first NDJSON line is yielded
  you can no longer change the HTTP status — that is why mid-stream failures
  are `{"error": ...}` lines, and pre-stream failures keep real status codes.
  The smoke test must cover both.
- **Client disconnect**: when the browser aborts, Flask raises
  `GeneratorExit` inside `generate()` — the `finally: upstream.close()`
  stops Ollama generation (Ollama cancels on connection close). Without it,
  the Pi keeps burning CPU on an answer nobody will read.
- **Flask-Limiter** counts the request at routing time; streaming duration
  does not consume extra quota. No change needed — but do not move the
  limiter decorator below `@csrf.exempt` (decorator order matters).
- **`decoder.decode(value, {stream: true})`** — without `stream: true`,
  multi-byte UTF-8 (— … •) split across chunks produces mojibake. Weaker
  models always miss this.
- **Rate-limited responses (429)** come from Flask-Limiter as JSON before
  streaming starts — the content-type fallback in client step 2 handles it.
- **The smoke test env has no Ollama** — the streaming path can't be
  exercised end-to-end in CI; test the error contract instead (see below)
  and test the happy path manually on the Pi.

## Acceptance criteria

1. Smoke tests: empty-body 400, form-encoded 415, and (Ollama down) 502
   **all still return application/json with correct status codes** — the
   pre-stream error contract is unchanged. Add an assertion that a valid
   request against a dead Ollama returns 502 JSON, not a 200 stream.
2. Manual on Pi: ask a long question with `gemma4:12b`; first token visible
   in < 5 s; generation runs past 60 s WITHOUT truncation; Cancel stops
   `ollama` CPU usage (verify with `top`) within ~2 s.
3. `curl -N -X POST localhost:8080/api/ai/chat -H 'Content-Type: application/json' -d '{"message":"hi"}'`
   (with Ollama up) prints NDJSON lines incrementally: first `{"sources":...}`,
   then `{"delta":...}` lines, ending with `{"done": true,...}`.
4. Through nginx (`http://survive.local/api/ai/chat`) chunks arrive
   incrementally, not in one burst at the end (proves `proxy_buffering off`).
5. Two simultaneous chats + a third browser tab loading `/` — the dashboard
   still responds (proves `--threads`).
6. pylint ≥ 9.5; shellcheck clean.
