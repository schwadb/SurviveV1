"""
AI assistant: retrieval-augmented, streaming chat proxy to Ollama.

ai_chat() first calls _retrieve_context() (Kiwix full-text search + the local
document and drug indexes) and injects the excerpts into the system prompt via
_build_rag_prompt(). The Ollama completion is streamed to the client as
newline-delimited JSON. Requires gunicorn --threads (a stream holds a worker)
and nginx proxy_buffering off on /api/ai/chat.
"""

import json
import logging
import os
import re
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from flask import Blueprint, Response, jsonify, render_template, request, stream_with_context

from common import _ollama_alive
from settings import OLLAMA_BASE, TIMEOUT_AI_CHAT, TIMEOUT_OLLAMA_LIST
from constants import CATEGORIES, PORT_KIWIX
from extensions import csrf, limiter
from search_index import (
    _drug_by_id,
    _fetch_article_text,
    _kiwix_search,
    _query_doc_index,
    _query_drug_index,
)

bp = Blueprint("ai", __name__)


# ── Retrieval (RAG over the local library) ────────────────────────────────────
def _retrieve_context(query: str) -> list:
    """Search Kiwix and the local document index, enriching Kiwix hits with
    article text fetched concurrently. Returns [{title, path|url, snippet,
    text}]; empty list if nothing found anywhere."""
    articles = _kiwix_search(query)
    doc_chunks = _query_doc_index(query, limit=2, relaxed=True) or []
    if doc_chunks:
        # Share the num_ctx budget: 2 Kiwix articles + 2 doc chunks instead of 3+0.
        articles = articles[:2]
    if articles:
        with ThreadPoolExecutor(max_workers=len(articles)) as ex:
            texts = list(ex.map(
                lambda a: _fetch_article_text(a["path"], fallback=a["snippet"]),
                articles,
            ))
        for article, text in zip(articles, texts):
            article["text"] = text
    for chunk in doc_chunks:
        page_note = f" (p.{chunk['page']})" if chunk.get("page") else ""
        articles.append({
            "title": f"{chunk['title']}{page_note}",
            # Dashboard-relative link into the actual document; browsers'
            # built-in PDF viewers honour the #page= anchor.
            "url": f"/serve/{chunk['path']}"
                   + (f"#page={chunk['page']}" if chunk.get("page") else ""),
            "snippet": chunk["snippet"],
            "text": chunk["snippet"],
        })
    # Medical questions are a top use case — add at most one drug-label hit so
    # the AI can cite dosage/warnings from the offline FDA data.
    drug_hits = _query_drug_index(query, mode="drug", limit=1) or []
    for d in drug_hits[:1]:
        name = d.get("brand_name") or d.get("generic_name") or "drug"
        detail = _drug_by_id(d["id"]) or {}
        excerpt = " ".join(str(detail.get(f, "")) for f in
                           ("purpose", "indications", "dosage", "warnings"))[:1200]
        if excerpt.strip():
            articles.append({
                "title": f"Drug label: {name}",
                "url": f"/drugs/{d['id']}",
                "snippet": excerpt[:300],
                "text": excerpt,
            })
    return articles


_BASE_SYSTEM_PROMPT = (
    "You are a survival expert assistant running offline on a Raspberry Pi. "
    "Help with practical survival, medicine, food, water, shelter, energy, "
    "and skills. Be concise and practical. No internet available."
)


def _build_rag_prompt(articles: list) -> str:
    """Compose the system prompt, injecting retrieved reference excerpts."""
    if not articles:
        return (
            _BASE_SYSTEM_PROMPT
            + " No reference articles were found for this question in the "
            "local library; say so if you are unsure rather than guessing."
        )
    lines = [_BASE_SYSTEM_PROMPT, "", "Reference excerpts from the offline library:"]
    for i, article in enumerate(articles, 1):
        lines.append(f"[{i}] {article['title']}: {article.get('text', article['snippet'])}")
    lines.append(
        "Answer using these excerpts where relevant and mention which source "
        "numbers you used."
    )
    return "\n".join(lines)


def _validate_history(raw) -> tuple:
    """Validate and budget client-supplied conversation history.

    Returns (clean_history, error). The role whitelist is security-critical:
    without it a crafted request injects {"role": "system", ...} and overrides
    the survival system prompt. The char budget keeps history + RAG excerpts
    + question inside the survive model's num_ctx 4096 (~16k chars)."""
    if not isinstance(raw, list):
        return [], "history must be a list"
    clean = []
    for turn in raw[-8:]:  # cap turn count first
        if not isinstance(turn, dict):
            return [], "invalid history entry"
        role = turn.get("role")
        content = turn.get("content")
        if role not in ("user", "assistant") or not isinstance(content, str):
            return [], "invalid history entry"
        clean.append({"role": role, "content": content[:2000]})
    # Char budget: walk from the newest turn backwards, keep what fits.
    total = 0
    budgeted = []
    for turn in reversed(clean):
        total += len(turn["content"])
        if total > 3000:
            break
        budgeted.append(turn)
    return list(reversed(budgeted)), None


def _sources_for(articles: list, req_host: str) -> list:
    """Build clickable source links for the response. Kiwix hits get absolute
    URLs rooted at the caller's host (so they work over LAN, localhost, or
    survive.local); document hits carry a ready-made dashboard-relative URL."""
    return [
        {"title": a["title"],
         "url": a.get("url") or f"http://{req_host}:{PORT_KIWIX}{a['path']}"}
        for a in articles
    ]


# ── Routes ────────────────────────────────────────────────────────────────────
@bp.route("/ai")
def ai_page():
    ai_running = _ollama_alive()
    models = []
    if ai_running:
        try:
            with urllib.request.urlopen(
                f"{OLLAMA_BASE}/api/tags", timeout=TIMEOUT_OLLAMA_LIST
            ) as r:
                data = json.loads(r.read())
                models = [m["name"] for m in data.get("models", [])]
        except (OSError, json.JSONDecodeError) as e:
            logging.debug("Could not fetch Ollama model list: %s", e)
    return render_template("ai.html", ai_running=ai_running, models=models, categories=CATEGORIES)


@bp.route("/api/ai/chat", methods=["POST"])
@csrf.exempt
@limiter.limit("5 per minute")
# Each early return is a distinct client-facing error contract (415/400/404/502);
# collapsing them would obscure which failure the caller actually hit.
# pylint: disable=too-many-return-statements
def ai_chat():
    """Retrieval-augmented, streaming proxy to the local Ollama API.

    Before calling Ollama, the user's question is used to full-text search the
    local Kiwix library; the top article excerpts are injected into the system
    prompt (RAG) and returned as a `sources` list. The Ollama completion is
    streamed back as newline-delimited JSON (application/x-ndjson):

        {"sources": [...]}      # always first
        {"delta": "..."}        # zero or more token chunks
        {"done": true, "model": "..."}

    Errors detected BEFORE streaming starts keep real HTTP status codes and a
    JSON body (415/400/502). A failure mid-stream is emitted as an
    {"error": ...} line, since the status line is already committed.
    """
    # Strict Content-Type check: browsers cannot send application/json
    # cross-origin without a CORS preflight, so this blocks CSRF-style
    # form POSTs from a malicious page while the user is on the dashboard.
    if (request.content_type or "").split(";")[0].strip() != "application/json":
        return jsonify({"error": "Content-Type must be application/json"}), 415

    data = request.get_json(silent=True)
    if not data or "message" not in data:
        return jsonify({"error": "No message"}), 400

    model = data.get("model", os.environ.get("SURVIVE_AI_MODEL", "survive"))
    # Validate model name: allow alphanumeric, colon, dot, dash, underscore only.
    # Prevents path traversal or injection into the Ollama API URL.
    if not re.fullmatch(r"[a-zA-Z0-9:.\-_]{1,100}", model):
        return jsonify({"error": "Invalid model name"}), 400

    history, history_error = _validate_history(data.get("history", []))
    if history_error:
        return jsonify({"error": history_error}), 400

    message = str(data["message"])[:4096]  # bound message length to one context window

    # RAG retrieval (best-effort — never blocks the answer if Kiwix is down).
    # Retrieval uses ONLY the current message — mixing in history degrades
    # full-text search precision.
    articles = _retrieve_context(message)
    sources = _sources_for(articles, request.host.split(":")[0])
    system_prompt = _build_rag_prompt(articles)

    payload = json.dumps({
        "model": model,
        "messages": (
            [{"role": "system", "content": system_prompt}]
            + history
            + [{"role": "user", "content": message}]
        ),
        "stream": True,
    }).encode()
    req = urllib.request.Request(
        f"{OLLAMA_BASE}/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
    )

    # Open the upstream connection now so a dead/refusing Ollama yields a real
    # 502 with a JSON body, before any streaming headers are committed.
    try:
        # pylint: disable=consider-using-with
        upstream = urllib.request.urlopen(req, timeout=TIMEOUT_AI_CHAT)
    except urllib.error.HTTPError as exc:
        # Ollama is reachable but rejected the request. Reporting this as
        # "service unavailable" sends users hunting a dead service when the
        # real cause is usually a model that is not installed.
        detail = ""
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:200]
        except OSError:
            pass
        logging.warning("Ollama rejected the request (%s): %s", exc.code, detail)
        if exc.code == 404:
            return jsonify({"error": (
                f"Model '{model}' is not installed. Available models are listed "
                "in the dropdown; install more with: bash ai/setup_ollama.sh setup"
            )}), 404
        return jsonify({"error": f"AI service error (HTTP {exc.code})"}), 502
    except (OSError, json.JSONDecodeError):
        logging.exception("AI chat proxy error (connect)")
        return jsonify({"error": "AI service unavailable — is Ollama running? "
                                 "Check: systemctl status ollama"}), 502

    def generate():
        # With streaming, TIMEOUT_AI_CHAT is a per-read idle timeout, not a
        # total-duration cap, so long answers from slow models are not truncated.
        yield json.dumps({"sources": sources}) + "\n"
        try:
            for raw_line in upstream:
                if not raw_line.strip():
                    continue
                chunk = json.loads(raw_line)
                piece = chunk.get("message", {}).get("content", "")
                if piece:
                    yield json.dumps({"delta": piece}) + "\n"
                if chunk.get("done"):
                    yield json.dumps({"done": True, "model": model}) + "\n"
                    return
        except (OSError, json.JSONDecodeError):
            logging.exception("AI chat proxy error (stream)")
            yield json.dumps({"error": "stream interrupted"}) + "\n"
        finally:
            # Closing the upstream tells Ollama to stop generating when the
            # browser disconnects, so the Pi's CPU isn't wasted on a dead read.
            upstream.close()

    return Response(
        stream_with_context(generate()),
        mimetype="application/x-ndjson",
        headers={"X-Accel-Buffering": "no"},
    )
