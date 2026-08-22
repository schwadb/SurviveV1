"""
SurviveV1 — Shared constants for the web server.
All service port numbers live here to avoid magic numbers scattered across code.
"""

# ── Service ports ──────────────────────────────────────────────────────────────
PORT_DASHBOARD = 8080
PORT_KIWIX     = 8081
PORT_KOLIBRI   = 8082
PORT_CALIBRE   = 8083
PORT_JELLYFIN  = 8096
PORT_MAPS      = 3000
PORT_OLLAMA    = 11434

# ── Service registry ──────────────────────────────────────────────────────────
SERVICES = {
    "kiwix":    {"name": "Wikipedia & Books", "port": PORT_KIWIX,
                 "icon": "📚", "color": "#2980b9"},
    "kolibri":  {"name": "Khan Academy",      "port": PORT_KOLIBRI,
                 "icon": "🎓", "color": "#27ae60"},
    "calibre":  {"name": "E-book Library",    "port": PORT_CALIBRE,
                 "icon": "📖", "color": "#8e44ad"},
    "jellyfin": {"name": "Videos",            "port": PORT_JELLYFIN,
                 "icon": "🎬", "color": "#e74c3c"},
    "maps":     {"name": "Offline Maps",      "port": PORT_MAPS,
                 "icon": "🗺️", "color": "#f39c12"},
    "ai":       {"name": "AI Assistant",      "port": PORT_OLLAMA,
                 "icon": "🤖", "color": "#16a085"},
}

# ── Content budget ─────────────────────────────────────────────────────────────
CONTENT_BUDGET_GB = 800  # target total content size in GB

# ── Download categories (dashboard progress view) ───────────────────────────────
# IMPORTANT: each `id` MUST equal the first argument of the matching
# run_category call in download/download_all.sh — that literal string is what
# gets written to $STORAGE_PATH/.download_progress. A mismatch makes the
# category read as "pending" forever. `dir` is the storage subdir whose size is
# reported (must be a key produced by _compute_content_stats in server.py).
# NOTE on "dir": several libraries are delivered as Kiwix ZIMs, so their bytes
# live under zim/ and count toward the "kiwix" row — NOT their own row. The
# Gutenberg library (~207 GB) is a ZIM (zim/books/gutenberg_*.zim), so it is
# counted under "Wikipedia, Gutenberg & ZIM"; the separate "E-Books (EPUB)"
# row measures only the small curated EPUB folder (books/). Likewise Khan
# Academy now ships as a ZIM (zim/education/), counted under the kiwix row.
DOWNLOAD_CATEGORIES = [
    {"id": "kiwix",         "name": "Wikipedia, Gutenberg & ZIM", "budget_gb": 600, "dir": "zim"},
    {"id": "videos",        "name": "Survival Videos",     "budget_gb": 150, "dir": "videos"},
    {"id": "books",         "name": "E-Books (EPUB)",      "budget_gb": 1,   "dir": "books"},
    {"id": "maps",          "name": "Offline Maps",        "budget_gb": 70,  "dir": "maps"},
    {"id": "kolibri",       "name": "Khan Academy (Kolibri)", "budget_gb": 200, "dir": "kolibri"},
    {"id": "gaps",          "name": "Expert Gap Content",  "budget_gb": 15,  "dir": "pdfs"},
    {"id": "mental_health", "name": "Mental Health",       "budget_gb": 5,   "dir": "pdfs"},
]

# ── Knowledge categories ───────────────────────────────────────────────────────
# Static declarative data; used by server routes and templates to enumerate
# content areas. Each entry maps to a storage subdirectory (pdfs/, books/,
# videos/<id>/) and drives the category page and search-result grouping.
CATEGORIES = [
    # ── Core Survival ─────────────────────────────────────────
    {"id": "medical", "name": "Medical & First Aid", "icon": "🏥",
     "color": "#e74c3c", "desc": "Emergency medicine, first aid, TCCC, trauma"},
    {"id": "medicine_advanced", "name": "Advanced Medicine", "icon": "🩺",
     "color": "#c0392b", "desc": "Surgery, obstetrics, dental, psychiatric care in austere"},
    {"id": "obstetrics", "name": "Childbirth & Midwifery", "icon": "👶",
     "color": "#e91e8c", "desc": "Emergency delivery, midwifery, prenatal care without hospital"},
    {"id": "dental", "name": "Dental Emergency", "icon": "🦷",
     "color": "#9b59b6", "desc": "Tooth extraction, abscess, fillings without a dentist"},
    {"id": "psychology", "name": "Mental Health & Survival Psychology", "icon": "🧠",
     "color": "#8e44ad", "desc": "Psychological first aid, grief, resilience, disaster psychology"},
    # ── Food & Water ──────────────────────────────────────────
    {"id": "food", "name": "Food & Water", "icon": "🌾",
     "color": "#27ae60", "desc": "Farming, foraging, food preservation, water purification"},
    {"id": "animal_husbandry", "name": "Animal Husbandry", "icon": "🐓",
     "color": "#2ecc71", "desc": "Chickens, goats, cattle, rabbits — health, breeding, butchering"},
    {"id": "seeds", "name": "Seed Saving", "icon": "🌱",
     "color": "#1abc9c", "desc": "Storing and propagating open-pollinated seeds, generations"},
    {"id": "beeswax", "name": "Beekeeping", "icon": "🐝",
     "color": "#f39c12", "desc": "Hive management, honey harvest, wax, mead, disease prevention"},
    {"id": "fermentation", "name": "Fermentation & Brewing", "icon": "🍺",
     "color": "#d35400", "desc": "Lacto-fermentation, beer, mead, vinegar, cheese, tinctures"},
    # ── Infrastructure ────────────────────────────────────────
    {"id": "shelter", "name": "Shelter & Construction", "icon": "🏠",
     "color": "#8e44ad", "desc": "Building techniques, earthships, log cabins, off-grid"},
    {"id": "sanitation", "name": "Sanitation & Waste", "icon": "🚽",
     "color": "#795548", "desc": "Composting toilets, humanure, greywater, disease prevention"},
    {"id": "water_systems", "name": "Water Systems & Wells", "icon": "💧",
     "color": "#2980b9", "desc": "Hand-dug wells, rainwater, filtration, distribution systems"},
    {"id": "energy", "name": "Energy & Power", "icon": "⚡",
     "color": "#f39c12", "desc": "Solar, wind, batteries, biogas, generators"},
    # ── Skills & Crafts ───────────────────────────────────────
    {"id": "skills", "name": "Wilderness & Primitive Skills", "icon": "🪓",
     "color": "#16a085", "desc": "Fire, navigation, foraging, tracking, shelter building"},
    {"id": "blacksmithing", "name": "Blacksmithing & Metalwork", "icon": "⚒️",
     "color": "#607d8b", "desc": "Forge building, tool making, repair, knife making"},
    {"id": "primitive_skills", "name": "Primitive Crafts", "icon": "🧵",
     "color": "#8d6e63", "desc": "Brain tanning, soap making, candles, fiber, 18th-century crafts"},
    {"id": "tools", "name": "Tools & Repair", "icon": "🔧",
     "color": "#2980b9", "desc": "iFixit guides, woodworking, mechanical repair"},
    {"id": "permaculture", "name": "Permaculture & Food Forest", "icon": "🌳",
     "color": "#4caf50", "desc": "Zone design, guild planting, food forest, water earthworks"},
    # ── Communications & Community ────────────────────────────
    {"id": "communication", "name": "Communications & Radio", "icon": "📡",
     "color": "#c0392b", "desc": "Ham radio, Morse code, CHIRP programming, emergency frequencies"},
    {"id": "security", "name": "Security & Defense", "icon": "🛡️",
     "color": "#37474f", "desc": "Perimeter defense, hand signals, community security doctrine"},
    {"id": "community", "name": "Community & Social Survival", "icon": "👥",
     "color": "#5c6bc0", "desc": "Post-collapse governance, barter economy, conflict resolution"},
    # ── Reference ─────────────────────────────────────────────
    {"id": "education", "name": "Education & Science", "icon": "🔬",
     "color": "#2c3e50", "desc": "Khan Academy, science, math, engineering"},
    {"id": "reference", "name": "Reference & Books", "icon": "📚",
     "color": "#7f8c8d", "desc": "Wikipedia, Gutenberg library, manuals"},
    {"id": "maps", "name": "Maps & Navigation", "icon": "🗺️",
     "color": "#d35400", "desc": "Offline maps, topographic charts, navigation"},
    {"id": "military", "name": "Military Manuals", "icon": "⚔️",
     "color": "#2c3e50", "desc": "Army survival, field manuals, TCCC"},
    {"id": "videos", "name": "How-To Videos", "icon": "🎬",
     "color": "#8e44ad", "desc": "Step-by-step survival and skills videos"},
]
