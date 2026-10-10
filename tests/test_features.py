"""Tests for the maps, library manager, notes, shared files, comms and
auto-update features. Pure helpers are covered directly; routes go through
the Flask test client. No network: catalog parsing uses canned XML."""

import io

import pytest


def _as_admin(client):
    """Mark the test session as admin without going through the CSRF form."""
    with client.session_transaction() as sess:
        sess["admin"] = True


def _as_guest(client):
    with client.session_transaction() as sess:
        sess.pop("admin", None)


# ── textutils: markdown ────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def tu(server):  # pylint: disable=unused-argument
    import textutils  # noqa: PLC0415  (web/ is on sys.path after the server import)
    return textutils


def test_markdown_escapes_raw_html(tu):
    out = tu.render_markdown("<script>alert(1)</script>\n\n<b>x</b>")
    assert "<script>" not in out
    assert "&lt;script&gt;" in out
    assert "<b>" not in out


def test_markdown_basic_blocks(tu):
    src = "# Title\n\nSome **bold** and *it* and `code`.\n\n- one\n- [x] done\n- [ ] todo\n\n1. a\n2. b\n\n> quote\n\n---\n\n```\nraw <x>\n```"
    out = tu.render_markdown(src)
    assert "<h1>Title</h1>" in out
    assert "<strong>bold</strong>" in out and "<em>it</em>" in out and "<code>code</code>" in out
    assert out.count("<li") == 5 and 'class="done"' in out
    assert "<ol>" in out and "<ul>" in out
    assert "<blockquote>" in out and "<hr>" in out
    assert "<pre><code>\nraw &lt;x&gt;" in out


def test_markdown_links_block_javascript(tu):
    out = tu.render_markdown("[ok](https://a.b) [rel](/notes) [bad](javascript:alert(1))")
    assert 'href="https://a.b"' in out and 'href="/notes"' in out
    assert "javascript:" not in out.split("href")[-1] or 'href="javascript' not in out


def test_first_heading_and_slug(tu):
    assert tu.first_heading("\n\n## Water  \nbody") == "Water"
    assert tu.first_heading("plain first line") == "plain first line"
    assert tu.slugify("Water Sources: North Ridge!") == "water-sources-north-ridge"
    assert tu.slugify("???") == "note"
    assert tu.SLUG_PATTERN.match("water-sources-2")
    assert not tu.SLUG_PATTERN.match("../etc")


# ── textutils: pins ────────────────────────────────────────────────────────────

def test_clean_pin_validates(tu):
    pin = tu.clean_pin({"name": " Spring ", "lat": "45.5", "lon": -120, "icon": "water",
                        "color": "#58A6FF", "notes": "x", "hidden": True})
    assert pin == {"name": "Spring", "lat": 45.5, "lon": -120.0, "icon": "water",
                   "color": "#58a6ff", "notes": "x", "hidden": 1}
    assert tu.clean_pin({"lat": 0, "lon": 0, "icon": "nope", "color": "red"})["icon"] == "pin"
    with pytest.raises(ValueError):
        tu.clean_pin({"lat": 91, "lon": 0})
    with pytest.raises(ValueError):
        tu.clean_pin({"lat": "nan", "lon": 0})


def test_pins_gpx_geojson_roundtrip(tu):
    pins = [{"id": 1, "name": "Camp", "lat": 44.1, "lon": -121.3, "icon": "camp",
             "color": "#d29922", "notes": "flat & dry", "hidden": 0,
             "created": "2026-01-01T00:00:00+00:00", "updated": "2026-01-02T00:00:00+00:00"}]
    gpx = tu.pins_to_gpx(pins)
    back = tu.parse_pins(gpx)
    assert back[0]["name"] == "Camp" and back[0]["icon"] == "camp" and back[0]["notes"] == "flat & dry"
    geo = tu.pins_to_geojson(pins)
    back2 = tu.parse_pins(geo)
    assert back2[0]["lat"] == 44.1 and back2[0]["color"] == "#d29922"
    assert tu.parse_pins("") == []
    with pytest.raises(ValueError):
        tu.parse_pins("{not json")


# ── textutils: catalog + repeaters ─────────────────────────────────────────────

CATALOG_XML = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/">
  <totalResults>2</totalResults>
  <entry>
    <title>Where There Is No Doctor</title><summary>Village health</summary>
    <language>eng</language><name>hesperian_en_doctor</name><flavour>maxi</flavour>
    <category>other</category><tags>medicine;_pictures:yes</tags>
    <updated>2026-03-01T00:00:00Z</updated><articleCount>120</articleCount>
    <link rel="http://opds-spec.org/acquisition/open-access" type="application/x-zim"
          href="https://lb.download.kiwix.org/zim/other/hesperian_en_doctor_2026-03.zim.meta4" length="123456"/>
  </entry>
</feed>"""

LANG_XML = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/"
      xmlns:thr="http://purl.org/syndication/thread/1.0">
  <entry><title>English</title><dc:language>eng</dc:language><thr:count>1301</thr:count></entry>
  <entry><title>français</title><dc:language>fra</dc:language><thr:count>517</thr:count></entry>
</feed>"""


def test_parse_kiwix_catalog(tu):
    data = tu.parse_kiwix_catalog(CATALOG_XML)
    assert data["total"] == 2
    e = data["entries"][0]
    assert e["name"] == "hesperian_en_doctor" and e["size"] == 123456
    assert e["url"].endswith("hesperian_en_doctor_2026-03.zim") and e["file"] == "hesperian_en_doctor_2026-03.zim"
    assert e["tags"] == ["medicine"] and e["updated"] == "2026-03-01"


def test_parse_kiwix_languages(tu):
    langs = tu.parse_kiwix_languages(LANG_XML)
    assert [l["code"] for l in langs] == ["eng", "fra"]


def test_zim_name_prefix(tu):
    assert tu.zim_name_prefix("wikipedia_en_all_maxi_2026-02.zim") == "wikipedia_en_all_maxi"
    assert tu.zim_name_prefix("x/y/ted_mul_science_2026-05.zim") == "ted_mul_science"
    assert tu.zim_name_prefix("odd.zim") == "odd"


def test_parse_repeater_csv_chirp_and_generic(tu):
    chirp = ("Location,Name,Frequency,Duplex,Offset,Tone,rToneFreq,cToneFreq,Mode,Comment\n"
             "0,W7ABC,146.880000,-,0.600000,Tone,100.0,100.0,FM,Bend OR\n"
             "1,,,,,,,,,\n")
    rows = tu.parse_repeater_csv(chirp, "chirp.csv")
    assert len(rows) == 1
    assert rows[0]["name"] == "W7ABC" and rows[0]["tone"] == "100.0" and rows[0]["source"] == "chirp.csv"
    generic = "Callsign,Output Freq,Input Freq,PL,City,State\nK7XYZ,444.100,449.100,88.5,Sisters,OR\n"
    rows = tu.parse_repeater_csv(generic)
    assert rows[0]["frequency"] == "444.100" and rows[0]["location"] == "Sisters" and rows[0]["state"] == "OR"
    assert tu.parse_repeater_csv("") == []


# ── routes: maps + pins ────────────────────────────────────────────────────────

def test_maps_page_relaxes_headers(client):
    resp = client.get("/maps")
    assert resp.status_code == 200
    assert "blob:" in resp.headers["Content-Security-Policy"]
    assert "geolocation=(self)" in resp.headers["Permissions-Policy"]
    # Other pages keep the strict policy.
    assert "blob:" not in client.get("/").headers["Content-Security-Policy"]


def test_pins_crud_and_export(client):
    resp = client.post("/api/map/pins", json={"name": "Well", "lat": 1.5, "lon": 2.5, "icon": "water"})
    assert resp.status_code == 201
    pin_id = resp.get_json()["id"]
    assert client.post("/api/map/pins", json={"lat": 999, "lon": 0}).status_code == 400
    assert client.post("/api/map/pins", data="x", content_type="text/plain").status_code == 415
    resp = client.put(f"/api/map/pins/{pin_id}", json={"hidden": True, "notes": "dry in August"})
    assert resp.status_code == 200 and resp.get_json()["hidden"] == 1
    gpx = client.get("/api/map/pins/export?format=gpx")
    assert gpx.status_code == 200 and b"<wpt" in gpx.data
    imported = client.post("/api/map/pins/import", json={"text": gpx.data.decode()})
    assert imported.status_code == 201 and imported.get_json()["imported"] >= 1
    assert client.post("/api/map/pins/import", json={"text": "nothing"}).status_code == 400
    assert client.delete(f"/api/map/pins/{pin_id}", json={}).status_code == 200
    assert client.delete(f"/api/map/pins/{pin_id}", json={}).status_code == 404
    names = [p["name"] for p in client.get("/api/map/pins").get_json()["pins"]]
    assert "Well" in names  # the imported copy survives


# ── routes: library manager ────────────────────────────────────────────────────

def test_content_page_and_local_listing(client, storage):
    (storage / "zim" / "sideload").mkdir(parents=True, exist_ok=True)
    (storage / "zim" / "sideload" / "fake_en_all_2026-01.zim").write_bytes(b"ZIM\x04data")
    try:
        assert client.get("/content").status_code == 200
        local = client.get("/api/content/local").get_json()["zims"]
        assert local and local[0]["name"] == "fake_en_all" and local[0]["registered"] is False
        assert client.get("/api/content/jobs").get_json()["running"] == 0
    finally:
        (storage / "zim" / "sideload" / "fake_en_all_2026-01.zim").unlink()


def test_content_download_requires_admin_and_validates(client, admin_password):
    url = "https://download.kiwix.org/zim/other/x_en_all_2026-01.zim"
    assert client.post("/api/content/download", json={"url": url}).status_code == 403
    _as_admin(client)
    try:
        assert client.post("/api/content/download", json={"url": "https://evil.example/x.zim"}).status_code == 400
        assert client.post("/api/content/download", json={"url": url, "size": 10 ** 15}).status_code == 507
        assert client.post("/api/content/download", data="x", content_type="text/plain").status_code == 415
    finally:
        _as_guest(client)


# ── routes: notes + shared ─────────────────────────────────────────────────────

def test_notes_lifecycle(client, server, admin_password):
    server.app.config["WTF_CSRF_ENABLED"] = False
    try:
        resp = client.post("/notes/save", data={"body": "# Fuel cache\n\n20 L **diesel** behind the barn"})
        assert resp.status_code == 302 and resp.headers["Location"].endswith("/notes/fuel-cache")
        page = client.get("/notes/fuel-cache")
        assert page.status_code == 200 and b"<strong>diesel</strong>" in page.data
        assert client.get("/notes/fuel-cache?edit=1").status_code == 200
        assert b"Fuel cache" in client.get("/notes?q=barn").data
        assert b"NOTE" in client.get("/search?q=barn").data
        assert client.get("/notes/..%2fetc").status_code == 404
        # Deleting is admin-only: guests are bounced to the login page.
        resp = client.post("/notes/fuel-cache/delete")
        assert resp.status_code == 302 and "/login" in resp.headers["Location"]
        _as_admin(client)
        assert client.post("/notes/fuel-cache/delete").status_code == 302
        assert client.get("/notes/fuel-cache").status_code == 404
    finally:
        _as_guest(client)
        server.app.config["WTF_CSRF_ENABLED"] = True


def test_note_save_rejects_missing_csrf(client):
    assert client.post("/notes/save", data={"body": "# x"}).status_code == 400


def test_shared_upload_download_delete(client, server, admin_password):
    server.app.config["WTF_CSRF_ENABLED"] = False
    try:
        assert client.get("/shared").status_code == 200
        payload = b"x" * 200_000  # above the 64 KB global cap: the per-route limit must apply
        resp = client.post("/shared/upload", data={"files": (io.BytesIO(payload), "../evil name.PDF")},
                           content_type="multipart/form-data", follow_redirects=True)
        assert resp.status_code == 200 and b"Saved 1" in resp.data
        assert (server.SHARED_DIR / "evil_name.PDF").read_bytes() == payload
        assert client.get("/serve/shared/evil_name.PDF").status_code == 200
        resp = client.post("/shared/delete", data={"name": "evil_name.PDF"})
        assert resp.status_code == 302 and "/login" in resp.headers["Location"]
        _as_admin(client)
        client.post("/shared/delete", data={"name": "evil_name.PDF"})
        assert not (server.SHARED_DIR / "evil_name.PDF").exists()
    finally:
        _as_guest(client)
        server.app.config["WTF_CSRF_ENABLED"] = True


def test_body_limit_still_tight_elsewhere(client):
    resp = client.post("/api/ai/chat", data=b"{" + b"x" * 70_000, content_type="application/json")
    assert resp.status_code == 413


# ── routes: comms + schedule ───────────────────────────────────────────────────

def test_comms_pages_and_csv_import(client, server, admin_password):
    for path in ("/comms", "/comms/morse", "/comms/repeaters"):
        assert client.get(path).status_code == 200
    csv = "Location,Name,Frequency,Duplex,Offset,Tone,rToneFreq,Mode,Comment\n0,W7ABC,146.880,-,0.6,Tone,100.0,FM,Bend\n"
    server.app.config["WTF_CSRF_ENABLED"] = False
    try:
        _as_admin(client)
        resp = client.post("/comms/repeaters/upload", data={"file": (io.BytesIO(csv.encode()), "mine.csv")},
                           content_type="multipart/form-data", follow_redirects=True)
        assert resp.status_code == 200 and b"W7ABC" in resp.data
        assert b"W7ABC" in client.get("/comms/repeaters?band=2m&q=bend").data
        assert b"W7ABC" not in client.get("/comms/repeaters?band=70cm").data
        client.post("/comms/repeaters/delete", data={"name": "mine.csv"})
        assert not (server.REPEATERS_DIR / "mine.csv").exists()
    finally:
        _as_guest(client)
        server.app.config["WTF_CSRF_ENABLED"] = True


def test_schedule_api_shape(client):
    data = client.get("/api/update/schedule").get_json()
    assert set(data) >= {"available", "enabled", "time", "rate_limit_kbps"}
    assert client.post("/api/update/schedule", json={"enabled": True}).status_code == 403
