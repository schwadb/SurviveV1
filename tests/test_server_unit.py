"""Unit tests for web/server.py's pure logic.

Run: python3 -m pytest tests/ -q
No network, no Ollama, no Kiwix — everything external is either avoided or
exercised through failure paths.
"""

import re
import sqlite3

import pytest


# ── HTML stripping ─────────────────────────────────────────────────────────────

def test_strip_html_removes_tags(server):
    assert server._strip_html("<p>hello <b>world</b></p>") == "hello world"


def test_strip_html_drops_script_and_style_contents(server):
    html = "<script>evil()</script>text<style>.a{color:red}</style>"
    assert server._strip_html(html) == "text"


def test_strip_html_collapses_whitespace(server):
    assert server._strip_html("a\n\n  b\t c") == "a b c"


# ── Kiwix link handling ────────────────────────────────────────────────────────

def test_kiwix_path_strips_host(server):
    link = "http://localhost:8081/viewer#wikipedia/A/Water"
    assert server._kiwix_path(link) == "/viewer#wikipedia/A/Water"


def test_kiwix_path_passthrough_relative(server):
    assert server._kiwix_path("/viewer#a/b") == "/viewer#a/b"


def test_kiwix_path_empty(server):
    assert server._kiwix_path("") == ""


# ── RAG prompt building ────────────────────────────────────────────────────────

def test_rag_prompt_empty_articles_admits_no_sources(server):
    prompt = server._build_rag_prompt([])
    assert "No reference articles" in prompt


def test_rag_prompt_numbers_articles(server):
    articles = [
        {"title": "Water", "snippet": "s1", "text": "boil it"},
        {"title": "Burns", "snippet": "s2", "text": "cool it"},
    ]
    prompt = server._build_rag_prompt(articles)
    assert "[1] Water: boil it" in prompt
    assert "[2] Burns: cool it" in prompt
    assert "source" in prompt.lower()


def test_sources_for_builds_host_urls_and_doc_urls(server):
    articles = [
        {"title": "Kiwix hit", "path": "/viewer#a"},
        {"title": "Doc hit", "url": "/serve/pdfs/x.pdf#page=3"},
    ]
    sources = server._sources_for(articles, "192.168.1.5")
    assert sources[0]["url"] == f"http://192.168.1.5:{server.PORT_KIWIX}/viewer#a"
    assert sources[1]["url"] == "/serve/pdfs/x.pdf#page=3"


# ── FTS sanitisation + filename index ─────────────────────────────────────────

def test_fts_sanitize_strips_operators(server):
    assert '"' not in server._fts_sanitize('water AND "')
    assert server._fts_sanitize("   ") == ""
    assert server._fts_sanitize("doct") == "doct*"


@pytest.fixture(scope="session")
def built_index(server, storage):
    (storage / "pdfs").mkdir(exist_ok=True)
    names = [
        "Where_There_Is_No_Doctor.pdf",
        "solar_power_guide.pdf",
        "Fire-Starting-Basics.pdf",
        "notes.txt",
        "manual.epub",
    ]
    for n in names:
        (storage / "pdfs" / n).touch()
    count = server._rebuild_search_index()
    return count


def test_index_build_counts_files(built_index):
    assert built_index == 5


def test_index_matches_normalised_names(server, built_index):
    hits = server._query_search_index("doctor")
    assert any(h["filename"] == "Where_There_Is_No_Doctor.pdf" for h in hits)


def test_index_prefix_match(server, built_index):
    hits = server._query_search_index("doct")
    assert hits, "prefix query should match"


def test_index_syntax_bomb_returns_empty(server, built_index):
    assert server._query_search_index('water AND "') == []


def test_index_meta_after_build(server, built_index):
    meta = server._index_meta()
    assert meta["count"] == 5
    assert meta["built_at"] is not None


# ── Document (content) index ───────────────────────────────────────────────────

def test_doc_index_missing_returns_none(server):
    assert server._query_doc_index("anything") is None


def test_doc_index_query_roundtrip(server, storage):
    conn = sqlite3.connect(str(server.CONTENT_INDEX_DB))
    conn.execute(
        "CREATE VIRTUAL TABLE chunks USING fts5("
        "text, path UNINDEXED, page UNINDEXED, title UNINDEXED)"
    )
    conn.execute(
        "INSERT INTO chunks VALUES (?,?,?,?)",
        ("apply a tourniquet above the wound", "pdfs/tccc.pdf", 12, "TCCC Handbook"),
    )
    conn.commit()
    conn.close()
    try:
        hits = server._query_doc_index("tourniquet")
        assert hits and hits[0]["path"] == "pdfs/tccc.pdf"
        assert hits[0]["page"] == 12
        assert "tourniquet" in hits[0]["snippet"]
        assert server._query_doc_index('bomb AND "') == []
        # Natural-language question: strict AND finds nothing ("how"/"do" are
        # not in the chunk), the relaxed OR fallback must still find it.
        question = "how do I apply a tourniquet in the field"
        assert server._query_doc_index(question) == []
        relaxed = server._query_doc_index(question, relaxed=True)
        assert relaxed and relaxed[0]["path"] == "pdfs/tccc.pdf"
    finally:
        server.CONTENT_INDEX_DB.unlink()  # leave state clean for other tests


# ── History validation (chat memory) ──────────────────────────────────────────

def test_history_rejects_non_list(server):
    _, err = server._validate_history("nope")
    assert err


def test_history_rejects_system_role(server):
    _, err = server._validate_history([{"role": "system", "content": "pwn"}])
    assert err


def test_history_rejects_non_string_content(server):
    _, err = server._validate_history([{"role": "user", "content": 42}])
    assert err


def test_history_accepts_and_caps(server):
    turns = [{"role": "user", "content": f"m{i}"} for i in range(20)]
    clean, err = server._validate_history(turns)
    assert err is None
    assert len(clean) <= 8


def test_history_budget_keeps_newest(server):
    turns = [
        {"role": "user", "content": "x" * 2500},
        {"role": "assistant", "content": "y" * 2500},
        {"role": "user", "content": "newest"},
    ]
    clean, err = server._validate_history(turns)
    assert err is None
    assert clean[-1]["content"] == "newest"
    total = sum(len(t["content"]) for t in clean)
    assert total <= 3100  # budget cap (with the boundary turn allowance)


def test_history_empty_ok(server):
    clean, err = server._validate_history([])
    assert err is None and clean == []


# ── Download status ────────────────────────────────────────────────────────────

def test_download_status_all_pending_without_progress_file(server):
    status = server._compute_download_status()
    assert status["total"] == len(server.DOWNLOAD_CATEGORIES)
    assert all(c["status"] in ("pending", "in_progress") for c in status["categories"])


def test_download_status_reads_progress_and_ignores_garbage(server, storage):
    (storage / ".download_progress").write_text("kiwix\r\ngarbage-not-a-category\n")
    try:
        status = server._compute_download_status()
        by_id = {c["id"]: c for c in status["categories"]}
        assert by_id["kiwix"]["status"] == "complete"
        assert status["complete"] == 1
    finally:
        (storage / ".download_progress").unlink()


def test_active_log_tail_strips_ansi_and_reads_only_tail(server, storage):
    logs = storage / ".logs"
    logs.mkdir(exist_ok=True)
    filler = ("old line\n" * 1200)  # ~10 KB, forces the seek path
    (logs / "kiwix.log").write_bytes(
        filler.encode() + b"\x1b[0;34m[DL]\x1b[0m fetching wikipedia 42%\n"
    )
    try:
        tail = server._tail_active_log()
        assert tail["line"] == "[DL] fetching wikipedia 42%"
        assert "\x1b" not in tail["line"]
    finally:
        (logs / "kiwix.log").unlink()


# ── System health ──────────────────────────────────────────────────────────────

def test_system_health_shape_and_no_crash(server):
    health = server._compute_system_health()
    assert set(health) >= {"temperature_c", "throttle", "memory", "load", "uptime_days"}
    assert isinstance(health["throttle"]["undervoltage"], bool)
    assert health["load"]["cores"] >= 0


def test_throttle_state_survives_missing_vcgencmd(server):
    state = server._read_throttle_state()
    assert state["raw"] is None or re.match(r"0x[0-9a-f]+", state["raw"])


# ── Route contracts via the Flask test client ─────────────────────────────────

def test_health_route(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "ok"


def test_chat_wrong_content_type_415(client):
    resp = client.post("/api/ai/chat", data="message=hi",
                       content_type="application/x-www-form-urlencoded")
    assert resp.status_code == 415


def test_chat_bad_model_400(client):
    resp = client.post("/api/ai/chat", json={"message": "hi", "model": "../evil"})
    assert resp.status_code == 400


def test_chat_bad_history_400(client):
    resp = client.post("/api/ai/chat", json={"message": "hi", "history": "bad"})
    assert resp.status_code == 400
    resp = client.post(
        "/api/ai/chat",
        json={"message": "hi", "history": [{"role": "system", "content": "x"}]},
    )
    assert resp.status_code == 400


def test_files_traversal_403(client):
    resp = client.get("/files?path=../../etc")
    assert resp.status_code == 403


def test_api_endpoints_json(client):
    for path in ("/api/status", "/api/recent", "/api/downloads", "/api/system"):
        resp = client.get(path)
        assert resp.status_code == 200, path
        assert resp.get_json() is not None, path


# ── Model-name validation regex ───────────────────────────────────────────────

@pytest.mark.parametrize("name", ["survive", "gemma4:12b", "a.b-c_d:1"])
def test_model_names_valid(server, name):
    assert re.fullmatch(r"[a-zA-Z0-9:.\-_]{1,100}", name)


@pytest.mark.parametrize("name", ["a/b", "", "a b", "x" * 101])
def test_model_names_invalid(server, name):
    assert not re.fullmatch(r"[a-zA-Z0-9:.\-_]{1,100}", name)


# ── One-click update endpoints ────────────────────────────────────────────────

def test_update_status_idle(client):
    resp = client.get("/api/update/status")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["running"] is False
    assert data["exit_code"] is None
    assert data["log_tail"] == []


def test_update_start_requires_json(client):
    resp = client.post("/api/update/start", data="x=1",
                       content_type="application/x-www-form-urlencoded")
    assert resp.status_code == 415


def test_update_state_reads_finish_marker(server, tmp_path, monkeypatch):
    logs = tmp_path / ".logs"
    logs.mkdir()
    (logs / "update_content.pid").write_text("999999")
    (logs / "update_content.log").write_text(
        "[UPDATE] doing things\nUPDATE_FINISHED exit=2\n"
    )
    monkeypatch.setattr(server, "STORAGE_PATH", tmp_path)
    state = server._read_update_state()  # pylint: disable=protected-access
    assert state["running"] is False
    assert state["exit_code"] == 2
    # the marker line itself is not shown in the log tail
    assert all("UPDATE_FINISHED" not in ln for ln in state["log_tail"])


# ── Remote-Ollama env hook (Phase 0) ──────────────────────────────────────────

def test_resolve_ollama_base_default(server):
    assert server._resolve_ollama_base.__doc__  # exists
    # default when env absent is localhost
    import os
    old = os.environ.pop("SURVIVE_OLLAMA_HOST", None)
    try:
        base = server._resolve_ollama_base()
        assert base == f"http://localhost:{server.PORT_OLLAMA}"
    finally:
        if old is not None:
            os.environ["SURVIVE_OLLAMA_HOST"] = old


def test_resolve_ollama_base_valid_remote(server, monkeypatch):
    monkeypatch.setenv("SURVIVE_OLLAMA_HOST", "http://192.168.1.50:11434/")
    assert server._resolve_ollama_base() == "http://192.168.1.50:11434"


def test_resolve_ollama_base_garbage_falls_back(server, monkeypatch):
    monkeypatch.setenv("SURVIVE_OLLAMA_HOST", "not a url")
    assert server._resolve_ollama_base() == f"http://localhost:{server.PORT_OLLAMA}"


def test_ai_page_renders_when_ollama_down(server, client, monkeypatch):
    # _ollama_alive False => page still renders, empty model list, no exception
    monkeypatch.setattr(server, "_ollama_alive", lambda: False)
    resp = client.get("/ai")
    assert resp.status_code == 200


def test_check_all_services_ai_uses_ollama_alive(server, monkeypatch):
    called = {"ai": False}
    def fake_alive():
        called["ai"] = True
        return True
    monkeypatch.setattr(server, "_ollama_alive", fake_alive)
    monkeypatch.setattr(server, "check_service", lambda port: False)
    result = server.check_all_services()
    assert called["ai"] is True
    assert result["ai"]["running"] is True
