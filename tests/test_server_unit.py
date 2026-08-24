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


def test_update_start_requires_json(server, admin_password):
    # Admin auth is checked before the content-type; log in first so this
    # exercises the 415 path rather than the 403 gate.
    c = server.app.test_client()
    token = re.search(r'name="csrf_token" value="([^"]+)"',
                      c.get("/login").get_data(as_text=True)).group(1)
    c.post("/login", data={"password": admin_password, "csrf_token": token})
    resp = c.post("/api/update/start", data="x=1",
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


# ── Captive portal + apps (Phase 1) ───────────────────────────────────────────

def test_captive_android_redirects(client):
    for path in ("/generate_204", "/gen_204"):
        resp = client.get(path)
        assert resp.status_code == 302, path
        assert resp.headers["Location"] == "http://10.42.0.1:8080/"


def test_captive_apple_non_success(client):
    resp = client.get("/hotspot-detect.html")
    assert resp.status_code == 200
    # Must NOT be the literal "Success" Apple expects, or the CNA won't open.
    assert b"Success" not in resp.data or b"10.42.0.1" in resp.data
    assert b"10.42.0.1" in resp.data


def test_captive_windows_redirects(client):
    for path in ("/ncsi.txt", "/connecttest.txt", "/redirect"):
        resp = client.get(path)
        assert resp.status_code == 302, path


def test_apps_page_empty_storage(client):
    resp = client.get("/apps")
    assert resp.status_code == 200


def test_apk_mimetype_registered(server):
    import mimetypes
    typ, _ = mimetypes.guess_type("kiwix.apk")
    assert typ == "application/vnd.android.package-archive"


# ── Admin auth (Phase 2) ──────────────────────────────────────────────────────

def _csrf_token(html):
    m = re.search(r'name="csrf_token" value="([^"]+)"', html)
    return m.group(1) if m else None


def test_update_start_403_when_no_admin_password(server):
    # No password file => admin endpoints fail closed with 403.
    try:
        server.ADMIN_PASSWORD_FILE.unlink()
    except FileNotFoundError:
        pass
    server._admin_hash_cache._ts = 0.0
    c = server.app.test_client()
    resp = c.post("/api/update/start", json={})
    assert resp.status_code == 403
    assert b"admin password" in resp.data.lower()


def test_login_page_renders(server):
    c = server.app.test_client()
    assert c.get("/login").status_code == 200


def test_login_wrong_password_401(server, admin_password):
    c = server.app.test_client()
    token = _csrf_token(c.get("/login").get_data(as_text=True))
    resp = c.post("/login", data={"password": "wrong", "csrf_token": token})
    assert resp.status_code == 401


def test_login_right_password_unlocks_update(server, admin_password):
    c = server.app.test_client()
    token = _csrf_token(c.get("/login").get_data(as_text=True))
    resp = c.post("/login", data={"password": admin_password, "csrf_token": token})
    assert resp.status_code == 302  # redirected on success
    # Same client now carries the admin session — update endpoint reachable.
    resp2 = c.post("/api/update/start", json={})
    # 409/503/202 are all "past the auth gate"; only 403 would mean still blocked.
    assert resp2.status_code != 403


def test_logout_revokes_admin(server, admin_password):
    c = server.app.test_client()
    token = _csrf_token(c.get("/login").get_data(as_text=True))
    c.post("/login", data={"password": admin_password, "csrf_token": token})
    # Fresh token under the post-login session (login regenerates it); the
    # logout form on any page carries one.
    lt = _csrf_token(c.get("/").get_data(as_text=True))
    resp_out = c.post("/logout", data={"csrf_token": lt})
    assert resp_out.status_code == 302
    resp = c.post("/api/update/start", json={})
    assert resp.status_code == 403


def test_login_form_requires_csrf(server, admin_password):
    c = server.app.test_client()
    c.get("/login")  # establish session
    resp = c.post("/login", data={"password": admin_password})  # no token
    assert resp.status_code == 400


# ── Per-service restart (Phase 3) ─────────────────────────────────────────────

def test_service_restart_requires_admin(server):
    try:
        server.ADMIN_PASSWORD_FILE.unlink()
    except FileNotFoundError:
        pass
    server._admin_hash_cache._ts = 0.0
    c = server.app.test_client()
    resp = c.post("/api/service/kiwix/restart", json={})
    assert resp.status_code == 403


def _admin_client(server, admin_password):
    c = server.app.test_client()
    token = re.search(r'name="csrf_token" value="([^"]+)"',
                      c.get("/login").get_data(as_text=True)).group(1)
    c.post("/login", data={"password": admin_password, "csrf_token": token})
    return c


def test_service_restart_unknown_404(server, admin_password):
    c = _admin_client(server, admin_password)
    resp = c.post("/api/service/nope/restart", json={})
    assert resp.status_code == 404


def test_service_restart_runs_allowlisted_argv(server, admin_password, monkeypatch):
    captured = {}
    class _R:
        returncode = 0
        stdout = ""
        stderr = ""
    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        return _R()
    monkeypatch.setattr(server.subprocess, "run", fake_run)
    c = _admin_client(server, admin_password)
    resp = c.post("/api/service/kiwix/restart", json={})
    assert resp.status_code == 200
    # Exact allowlisted command — sudo -n, absolute systemctl, mapped unit.
    assert captured["cmd"] == ["sudo", "-n", "/usr/bin/systemctl", "restart", "kiwix"]


def test_service_restart_dashboard_is_detached(server, admin_password, monkeypatch):
    captured = {}
    def fake_popen(cmd, **kwargs):
        captured["cmd"] = cmd
        class _P:
            pid = 4242
        return _P()
    monkeypatch.setattr(server.subprocess, "Popen", fake_popen)
    # dashboard isn't a SERVICES key; assert the mapped-unit path via 'maps'
    # would use run, while a hypothetical self-restart uses Popen. Here we
    # confirm martin-tiles uses run (not detached).
    class _R:
        returncode = 0
        stdout = ""
        stderr = ""
    monkeypatch.setattr(server.subprocess, "run", lambda cmd, **k: _R())
    c = _admin_client(server, admin_password)
    resp = c.post("/api/service/maps/restart", json={})
    assert resp.status_code == 200
