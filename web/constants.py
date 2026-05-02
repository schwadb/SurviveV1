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
    "kiwix":    {"name": "Wikipedia & Books",  "port": PORT_KIWIX,    "icon": "📚", "color": "#2980b9"},
    "kolibri":  {"name": "Khan Academy",       "port": PORT_KOLIBRI,  "icon": "🎓", "color": "#27ae60"},
    "calibre":  {"name": "E-book Library",     "port": PORT_CALIBRE,  "icon": "📖", "color": "#8e44ad"},
    "jellyfin": {"name": "Videos",             "port": PORT_JELLYFIN, "icon": "🎬", "color": "#e74c3c"},
    "maps":     {"name": "Offline Maps",       "port": PORT_MAPS,     "icon": "🗺️", "color": "#f39c12"},
    "ai":       {"name": "AI Assistant",       "port": PORT_OLLAMA,   "icon": "🤖", "color": "#16a085"},
}

# ── Content budget ─────────────────────────────────────────────────────────────
CONTENT_BUDGET_GB = 800  # target total content size in GB

# ── Category → directory mapping ──────────────────────────────────────────────
# Download scripts use directory names that don't always match category IDs.
# Each category ID maps to a list of directory names to search.
CATEGORY_DIR_MAP = {
    "medical": ["medical", "medicine_advanced", "first_aid"],
    "medicine_advanced": ["medicine_advanced", "medical"],
    "obstetrics": ["obstetrics", "medicine_advanced"],
    "dental": ["dental", "medicine_advanced"],
    "psychology": ["psychology", "mental_health"],
    "food": ["food", "farming", "foraging", "food_preservation"],
    "animal_husbandry": ["animal_husbandry", "livestock"],
    "seeds": ["seeds", "seed_saving"],
    "beeswax": ["beeswax", "beekeeping"],
    "fermentation": ["fermentation", "brewing"],
    "shelter": ["shelter", "construction", "building"],
    "sanitation": ["sanitation", "waste", "hygiene"],
    "water_systems": ["water_systems", "water", "wells"],
    "energy": ["energy", "solar", "power"],
    "skills": ["skills", "wilderness", "bushcraft"],
    "blacksmithing": ["blacksmithing", "metalwork"],
    "primitive_skills": ["primitive_skills", "primitive_crafts"],
    "tools": ["tools", "repair", "iFixit"],
    "permaculture": ["permaculture", "food_forest", "agroforestry"],
    "communication": ["communication", "radio", "ham_radio"],
    "security": ["security", "defense", "military_manuals"],
    "community": ["community", "governance", "economics"],
    "education": ["education", "science", "khan_academy"],
    "reference": ["reference", "books", "peace_corps"],
    "maps": ["maps", "navigation", "topographic"],
    "military": ["military", "military_manuals", "security"],
    "videos": ["videos"],
}
