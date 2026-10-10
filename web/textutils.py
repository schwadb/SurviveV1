"""
SurviveV1 — pure text helpers shared by the dashboard routes.

Everything here is dependency-free and side-effect-free so it can be unit
tested without importing the Flask app: a deliberately small Markdown
renderer for the notes feature, GPX/GeoJSON conversion for map pins, slug
generation, and a tolerant CSV reader for repeater lists.
"""

import csv
import html
import math
import io
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

# ── Slugs ──────────────────────────────────────────────────────────────────────
_SLUG_RE = re.compile(r"[^a-z0-9]+")
SLUG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")


def slugify(title: str, fallback: str = "note") -> str:
    """Lower-case, dash-separated, filesystem-safe slug (max 80 chars)."""
    slug = _SLUG_RE.sub("-", (title or "").lower()).strip("-")[:80].strip("-")
    return slug or fallback


# ── Markdown (safe subset) ─────────────────────────────────────────────────────
# Raw HTML is never passed through: the whole input is escaped first and only
# the constructs below are turned back into tags. Links are limited to http(s),
# mailto and site-relative targets so a note cannot smuggle a javascript: URL.
_INLINE_CODE = re.compile(r"`([^`\n]+)`")
_BOLD = re.compile(r"\*\*(.+?)\*\*")
_ITALIC = re.compile(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])")
_LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
_ULIST = re.compile(r"^\s*[-*]\s+(.*)$")
_OLIST = re.compile(r"^\s*\d+[.)]\s+(.*)$")
_CHECK = re.compile(r"^\[([ xX])\]\s+(.*)$")
_SAFE_URL = re.compile(r"^(https?://|mailto:|/|#)", re.IGNORECASE)


def _inline(text: str) -> str:
    """Apply inline formatting to an already-escaped line."""
    def _link(match):
        label, url = match.group(1), match.group(2)
        if not _SAFE_URL.match(url):
            return match.group(0)
        return f'<a href="{url}" rel="noopener">{label}</a>'

    text = _INLINE_CODE.sub(r"<code>\1</code>", text)
    text = _LINK.sub(_link, text)
    text = _BOLD.sub(r"<strong>\1</strong>", text)
    text = _ITALIC.sub(r"<em>\1</em>", text)
    return text


def _list_item(content: str) -> str:
    check = _CHECK.match(content)
    if check:
        done = check.group(1).lower() == "x"
        box = "&#9745;" if done else "&#9744;"
        cls = ' class="done"' if done else ""
        return f"<li{cls}>{box} {_inline(check.group(2))}</li>"
    return f"<li>{_inline(content)}</li>"


def render_markdown(source: str) -> str:  # pylint: disable=too-many-branches,too-many-statements
    """Render a safe subset of Markdown to HTML.

    Supported: headings, paragraphs, **bold**, *italic*, `code`, fenced code
    blocks, - / 1. lists (with [ ] checkboxes), > quotes, --- rules, links.
    """
    out = []
    lines = html.escape(source or "", quote=False).replace("\r\n", "\n").split("\n")
    para: list = []
    list_tag = None
    in_code = False
    in_quote = False

    def flush_para():
        if para:
            out.append("<p>" + "<br>".join(_inline(ln) for ln in para) + "</p>")
            para.clear()

    def close_list():
        nonlocal list_tag
        if list_tag:
            out.append(f"</{list_tag}>")
            list_tag = None

    def close_quote():
        nonlocal in_quote
        if in_quote:
            out.append("</blockquote>")
            in_quote = False

    for raw in lines:
        line = raw.rstrip()
        if line.startswith("```"):
            flush_para()
            close_list()
            close_quote()
            if in_code:
                out.append("</code></pre>")
            else:
                out.append("<pre><code>")
            in_code = not in_code
            continue
        if in_code:
            out.append(raw)
            continue

        if not line.strip():
            flush_para()
            close_list()
            close_quote()
            continue

        heading = _HEADING.match(line)
        if heading:
            flush_para()
            close_list()
            close_quote()
            level = len(heading.group(1))
            out.append(f"<h{level}>{_inline(heading.group(2).strip())}</h{level}>")
            continue

        if line.strip() in ("---", "***", "___"):
            flush_para()
            close_list()
            close_quote()
            out.append("<hr>")
            continue

        if line.startswith("&gt;"):
            flush_para()
            close_list()
            if not in_quote:
                out.append("<blockquote>")
                in_quote = True
            out.append(f"<p>{_inline(line[4:].strip())}</p>")
            continue
        close_quote()

        ul = _ULIST.match(line)
        ol = _OLIST.match(line) if not ul else None
        if ul or ol:
            flush_para()
            tag = "ul" if ul else "ol"
            if list_tag != tag:
                close_list()
                out.append(f"<{tag}>")
                list_tag = tag
            out.append(_list_item((ul or ol).group(1).strip()))
            continue

        close_list()
        para.append(line.strip())

    flush_para()
    close_list()
    close_quote()
    if in_code:
        out.append("</code></pre>")
    return "\n".join(out)


def first_heading(source: str) -> str:
    """Title of a note: its first heading, else its first non-empty line."""
    for line in (source or "").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        match = _HEADING.match(stripped)
        return (match.group(2) if match else stripped)[:120]
    return ""


# ── Map pins: GeoJSON and GPX ─────────────────────────────────────────────────
PIN_ICONS = ("pin", "water", "fuel", "medical", "camp", "cache", "home",
             "food", "danger", "radio", "tools", "people")
PIN_COLORS = ("#3fb950", "#58a6ff", "#f85149", "#d29922", "#a371f7",
              "#f778ba", "#e6edf3", "#8b949e")


def _num(value, lo, hi):
    """Parse a coordinate, returning None when missing or out of range."""
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(num) or num < lo or num > hi:
        return None
    return num


def clean_pin(data: dict) -> dict:
    """Validate and normalise a pin payload from a client. Raises ValueError."""
    if not isinstance(data, dict):
        raise ValueError("pin must be an object")
    lat = _num(data.get("lat"), -90, 90)
    lon = _num(data.get("lon"), -180, 180)
    if lat is None or lon is None:
        raise ValueError("lat/lon out of range")
    name = str(data.get("name") or "").strip()[:120] or "Unnamed"
    icon = str(data.get("icon") or "pin")
    if icon not in PIN_ICONS:
        icon = "pin"
    color = str(data.get("color") or PIN_COLORS[0]).lower()
    if not re.fullmatch(r"#[0-9a-f]{6}", color):
        color = PIN_COLORS[0]
    notes = str(data.get("notes") or "")[:4000]
    hidden = 1 if data.get("hidden") else 0
    return {"name": name, "lat": round(lat, 7), "lon": round(lon, 7),
            "icon": icon, "color": color, "notes": notes, "hidden": hidden}


def pins_to_geojson(pins: list) -> str:
    features = []
    for pin in pins:
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [pin["lon"], pin["lat"]]},
            "properties": {k: pin.get(k) for k in
                           ("id", "name", "icon", "color", "notes", "hidden",
                            "created", "updated")},
        })
    return json.dumps({"type": "FeatureCollection", "features": features},
                      ensure_ascii=False, indent=1)


def pins_to_gpx(pins: list) -> str:
    root = ET.Element("gpx", version="1.1", creator="SurviveV1",
                      xmlns="http://www.topografix.com/GPX/1/1")
    for pin in pins:
        wpt = ET.SubElement(root, "wpt", lat=f"{pin['lat']:.7f}", lon=f"{pin['lon']:.7f}")
        ET.SubElement(wpt, "name").text = pin["name"]
        if pin.get("notes"):
            ET.SubElement(wpt, "desc").text = pin["notes"]
        ET.SubElement(wpt, "sym").text = pin.get("icon") or "pin"
        ET.SubElement(wpt, "type").text = pin.get("color") or ""
        if pin.get("updated"):
            ET.SubElement(wpt, "time").text = str(pin["updated"])
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode")


def parse_pins(text: str, limit: int = 2000) -> list:
    """Parse pins from GeoJSON or GPX text. Unknown or malformed entries are
    skipped. Returns cleaned pin dicts (no ids)."""
    text = (text or "").strip()
    if not text:
        return []
    pins = []
    if text.startswith("{") or text.startswith("["):
        data = json.loads(text)
        features = data.get("features", []) if isinstance(data, dict) else data
        for feat in features[:limit]:
            if not isinstance(feat, dict):
                continue
            geom = feat.get("geometry") or {}
            props = feat.get("properties") or {}
            coords = geom.get("coordinates") if geom.get("type") == "Point" else None
            if not coords or len(coords) < 2:
                continue
            try:
                pins.append(clean_pin({**props, "lon": coords[0], "lat": coords[1]}))
            except ValueError:
                continue
        return pins
    root = ET.fromstring(text)
    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag.split("}")[0] + "}"
    for wpt in root.iter(f"{ns}wpt"):
        if len(pins) >= limit:
            break
        name = (wpt.findtext(f"{ns}name") or "").strip()
        notes = (wpt.findtext(f"{ns}desc") or wpt.findtext(f"{ns}cmt") or "").strip()
        icon = (wpt.findtext(f"{ns}sym") or "").strip().lower()
        color = (wpt.findtext(f"{ns}type") or "").strip()
        try:
            pins.append(clean_pin({"name": name, "notes": notes, "icon": icon,
                                   "color": color, "lat": wpt.get("lat"),
                                   "lon": wpt.get("lon")}))
        except ValueError:
            continue
    return pins


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


# ── Kiwix catalog (OPDS Atom feed) ────────────────────────────────────────────
_ATOM = "{http://www.w3.org/2005/Atom}"
_DC = "{http://purl.org/dc/terms/}"
_THR = "{http://purl.org/syndication/thread/1.0}"
_ZIM_BUILD_RE = re.compile(r"_(\d{4}-\d{2})\.zim$", re.IGNORECASE)
KIWIX_CATEGORIES = ("wikipedia", "wikibooks", "wikiversity", "wikivoyage",
                    "wiktionary", "wikisource", "wikiquote", "wikinews",
                    "stack_exchange", "gutenberg", "ted", "phet", "ifixit",
                    "vikidia", "other")


def zim_name_prefix(filename: str) -> str:
    """'wikipedia_en_all_maxi_2026-02.zim' -> 'wikipedia_en_all_maxi'."""
    base = filename.rsplit("/", 1)[-1]
    base = _ZIM_BUILD_RE.sub("", base)
    if base.lower().endswith(".zim"):
        base = base[:-4]
    return base


def _text(node, tag: str, default: str = "") -> str:
    found = node.find(tag)
    return (found.text or "").strip() if found is not None and found.text else default


def parse_kiwix_catalog(xml_text) -> dict:
    """Parse an OPDS 'entries' feed from library.kiwix.org into plain dicts."""
    root = ET.fromstring(xml_text)
    total = root.findtext(f"{_ATOM}totalResults") or root.findtext("totalResults") or "0"
    entries = []
    for entry in root.iter(f"{_ATOM}entry"):
        size = 0
        url = ""
        for link in entry.findall(f"{_ATOM}link"):
            if link.get("rel") == "http://opds-spec.org/acquisition/open-access":
                url = link.get("href", "")
                try:
                    size = int(link.get("length") or 0)
                except ValueError:
                    size = 0
        if url.endswith(".meta4"):
            url = url[:-len(".meta4")]
        name = _text(entry, f"{_ATOM}name")
        tags = [t for t in _text(entry, f"{_ATOM}tags").split(";") if t and not t.startswith("_")]
        entries.append({
            "name": name,
            "title": _text(entry, f"{_ATOM}title"),
            "summary": _text(entry, f"{_ATOM}summary")[:300],
            "language": _text(entry, f"{_ATOM}language"),
            "category": _text(entry, f"{_ATOM}category"),
            "flavour": _text(entry, f"{_ATOM}flavour"),
            "updated": _text(entry, f"{_ATOM}updated")[:10],
            "articles": _text(entry, f"{_ATOM}articleCount"),
            "media": _text(entry, f"{_ATOM}mediaCount"),
            "tags": tags[:6],
            "size": size,
            "url": url,
            "file": url.rsplit("/", 1)[-1] if url else "",
        })
    try:
        total_int = int(total)
    except ValueError:
        total_int = len(entries)
    return {"total": total_int, "entries": entries}


def parse_kiwix_languages(xml_text) -> list:
    """Parse the catalog's language list: [{code, name, count}] sorted by count."""
    root = ET.fromstring(xml_text)
    langs = []
    for entry in root.iter(f"{_ATOM}entry"):
        code = _text(entry, f"{_DC}language")
        if not code:
            continue
        try:
            count = int(_text(entry, f"{_THR}count", "0"))
        except ValueError:
            count = 0
        langs.append({"code": code, "name": _text(entry, f"{_ATOM}title", code), "count": count})
    langs.sort(key=lambda l: (-l["count"], l["name"]))
    return langs


# ── Repeater CSV (CHIRP / RepeaterBook / generic) ─────────────────────────────
# Column aliases, lower-cased. The first alias present in a file wins.
_REPEATER_COLUMNS = {
    "name":      ("name", "callsign", "call sign", "call"),
    "frequency": ("frequency", "freq", "output", "output freq", "downlink"),
    "offset":    ("offset", "input", "input freq", "uplink"),
    "duplex":    ("duplex", "shift"),
    "tone":      ("rtonefreq", "tone", "pl", "ctcss", "uplink tone", "ctonefreq"),
    "mode":      ("mode", "modulation"),
    "location":  ("location", "city", "nearest city", "landmark", "qth"),
    "state":     ("state", "st", "region", "province"),
    "notes":     ("comment", "comments", "notes", "note", "use"),
}


def parse_repeater_csv(text: str, source: str = "", limit: int = 20000) -> list:
    """Read a repeater list exported from CHIRP, RepeaterBook or a spreadsheet
    into normalised rows. Columns are matched by name, case-insensitively."""
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return []
    lookup = {}
    lowered = {f.strip().lower(): f for f in reader.fieldnames if f}
    for key, aliases in _REPEATER_COLUMNS.items():
        for alias in aliases:
            if alias in lowered:
                lookup[key] = lowered[alias]
                break
    rows = []
    for raw in reader:
        if len(rows) >= limit:
            break
        row = {key: (raw.get(col) or "").strip() for key, col in lookup.items()}
        if not row.get("frequency"):
            continue
        row["source"] = source
        rows.append(row)
    return rows
