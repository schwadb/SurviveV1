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
