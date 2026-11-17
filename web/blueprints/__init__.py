"""
SurviveV1 — Dashboard blueprints.

Each module owns one area of the dashboard and exposes a Flask ``Blueprint``
named ``bp``. server.py registers them all; URL paths are unchanged from the
original single-file app (no url_prefix), only endpoint names gained a
``<blueprint>.`` prefix (e.g. ``url_for("notes.note_view")``).

    core     /, /category, /files, /serve, /apps, /search, /health, captive portal
    ai       /ai, /api/ai/chat (RAG + streaming proxy to Ollama)
    maps     /maps, /api/map/*
    content  /content, /api/content/* (Kiwix catalog, ZIM downloads, rescan)
    notes    /notes/*, /shared/*
    comms    /comms/*
    drugs    /drugs/*, /api/drugs/*
    system   /login, /logout, /status, /api/status, /api/downloads,
             /api/update/*, /api/service/*, /api/system, /api/connectivity
"""

from blueprints import ai, comms, content, core, drugs, maps, notes, system

ALL_BLUEPRINTS = (
    core.bp, ai.bp, maps.bp, content.bp, notes.bp, comms.bp, drugs.bp, system.bp,
)
