# PLAN-chat-memory: Multi-turn conversations with persistent history

**Rank: #2.**

## Goal

Every chat message is a brand-new, single-turn request: the client sends only
the current message, so follow-ups like "what about for a child?" or "give me
more detail on step 2" get answers with zero context. A page refresh also
wipes the visible conversation.

After this change: the client sends recent conversation history with each
request, the server validates and injects it into the Ollama call, and the
conversation survives page reloads via localStorage. This is the difference
between a Q&A box and an assistant.

## Exact files to touch

| File | Change |
|------|--------|
| `web/server.py` | validate + inject `history` in `ai_chat()` |
| `web/templates/ai.html` | maintain/send/persist history; restore on load |
| `tests/test_smoke.sh` | malformed-history rejection tests |
| `docs/API.md` | document the `history` field |

## Implementation order

1. **Server — accept `history`** in `ai_chat()` after the model check:
   ```python
   history = data.get("history", [])
   if not isinstance(history, list):
       return jsonify({"error": "history must be a list"}), 400
   clean_history = []
   for turn in history[-8:]:                      # cap turn count
       if not isinstance(turn, dict):
           return jsonify({"error": "invalid history entry"}), 400
       role = turn.get("role")
       content = turn.get("content")
       if role not in ("user", "assistant") or not isinstance(content, str):
           return jsonify({"error": "invalid history entry"}), 400
       clean_history.append({"role": role, "content": content[:2000]})
   # Total char budget so history + RAG fit in num_ctx 4096 (~16k chars):
   total = 0
   budgeted = []
   for turn in reversed(clean_history):           # keep the most recent turns
       total += len(turn["content"])
       if total > 3000:
           break
       budgeted.append(turn)
   clean_history = list(reversed(budgeted))
   ```
   Build messages as `[system] + clean_history + [current user message]`.
   **Retrieval uses ONLY the current message** — do not concatenate history
   into the Kiwix query (it degrades search precision and is the mistake a
   weaker model will make).

2. **Client — track history** in `ai.html`:
   - Module-level `let chatHistory = [];` (array of `{role, content}`).
   - In `sendMessage()`: include `history: chatHistory` in the POST body
     (before pushing the current message).
   - On successful completion (the `done` line): push
     `{role:'user', content: msg}` and `{role:'assistant', content: text}`,
     then `saveHistory()`.
   - `saveHistory()` / `loadHistory()`: localStorage key `survive_chat_v1`,
     value `JSON.stringify(chatHistory.slice(-20))`. Wrap `localStorage`
     access in try/catch (private-browsing mode throws).
   - On page load: `loadHistory()`; if non-empty, re-render each turn with the
     existing `addMessage()` (skip the welcome bubble in that case), and show
     a small "restored previous conversation — Clear to start fresh" note.
   - `clearChat()`: also `chatHistory = []` and remove the localStorage key.

3. **Do NOT store sources in history** — `addMessage` renders them separately;
   the assistant history content is the plain answer text only (sources would
   bloat the context budget and confuse the model).

4. **Error turns are not history**: only push to `chatHistory` on a clean
   `done`; aborted/errored exchanges leave history untouched (the user will
   retry the same question).

## Edge cases a weaker model would miss

- **Never trust client roles**: without the `role in ("user","assistant")`
  whitelist, a crafted request injects `{"role":"system", ...}` and overrides
  the survival system prompt. This is the security-critical line.
- **Budget math**: 8 turns × 2000 chars = 16k chars ≈ the entire num_ctx —
  which is why the second 3000-char total budget exists. RAG excerpts
  (~5-7k chars) + history (3k) + question (4k max) still fits ~16k. If
  PLAN-pdf-text-search lands too, these budgets already account for it.
- **`MAX_CONTENT_LENGTH` is 64 KB** (app config): 8×2000-char turns ≈ 16 KB
  of JSON — fits, no config change needed. Do not raise the cap.
- **Trim oldest, keep newest**: the reversed/append/reverse dance keeps the
  most recent turns. Naively slicing `[:3000 chars]` from the front keeps the
  OLDEST context — subtle and wrong.
- **localStorage in `file://`-like or private contexts throws** — every
  access needs try/catch or the whole chat page dies on some browsers.
- **The restore path must use `textContent` rendering** (it does, via
  `addMessage`) — restored history is attacker-controllable via localStorage,
  same XSS rules as live messages.
- **history is optional**: absent/empty `history` must behave exactly like
  today (all existing smoke tests must pass unchanged).

## Acceptance criteria

1. Smoke tests (all in the no-Ollama env, exercising validation only):
   - POST `{"message":"hi","history":"bad"}` → HTTP 400.
   - POST `{"message":"hi","history":[{"role":"system","content":"x"}]}` → 400.
   - POST `{"message":"hi","history":[]}` → 502 (Ollama down — unchanged
     contract; proves empty history is accepted).
2. With mock Ollama: send message A, then message B with history — the mock
   records the request body; assert it contains the system prompt first, then
   A's user/assistant pair, then B.
3. Playwright: send a message (mock backends), reload the page, the previous
   exchange is still rendered; click Clear, reload, only the welcome bubble
   shows.
4. pylint ≥ 9.5; all pre-existing smoke tests still green.
