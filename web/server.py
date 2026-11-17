#!/usr/bin/env python3
"""
SurviveV1 — Dashboard Web Server

Flask app serving the offline survival knowledge portal. This module builds
the app: configuration, request-size limits, CSRF + rate limiting, template
globals, security headers, error pages — and registers the feature
blueprints from web/blueprints/ (see that package's docstring for the map of
routes). Run directly for the dev server, or via gunicorn as ``server:app``.
"""

import logging
import mimetypes
import os
import secrets
from datetime import datetime

from flask import Flask, render_template, request
from flask.wrappers import Request

from blueprints import ALL_BLUEPRINTS
from common import admin_configured, is_admin
from settings import CAPTIVE_HOSTS, STORAGE_MOUNTED, TIMEOUT_AI_CHAT, WEB_DIR
from constants import (
    PORT_CALIBRE,
    PORT_DASHBOARD,
    PORT_JELLYFIN,
    PORT_KIWIX,
    PORT_KOLIBRI,
    PORT_MAPS,
    PORT_MESHCORE,
    PORT_MESHTASTIC,
    PORT_OLLAMA,
)
from extensions import csrf, limiter
from search_index import start_index_refresher

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = Flask(__name__)
app.config.update(
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_HTTPONLY=True,
    # Cap POST body size: the chat API only needs a JSON envelope; large bodies
    # would pin the Pi's memory before rate limiting or JSON parsing can reject them.
    MAX_CONTENT_LENGTH=64 * 1024,  # 64 KB
)

# A few routes legitimately take big bodies (file uploads, note text, pin
# imports). Rather than lift the global 64 KB cap, the request class answers
# a per-path limit; everything else keeps the tight default.
_BODY_LIMITS = (
    ("/shared/upload", 2 * 1024 ** 3),          # 2 GB — personal files
    ("/comms/repeaters/upload", 20 * 1024 ** 2),  # 20 MB — CSV lists
    ("/api/map/pins/import", 4 * 1024 ** 2),     # 4 MB — GPX/GeoJSON
    ("/notes/save", 512 * 1024),                 # 512 KB — one note
)


class _SizedRequest(Request):
    @property
    def max_content_length(self):
        for prefix, limit in _BODY_LIMITS:
            if self.path.startswith(prefix):
                return limit
        return app.config["MAX_CONTENT_LENGTH"]

    @max_content_length.setter
    def max_content_length(self, _value):  # Werkzeug assigns this in __init__
        pass


app.request_class = _SizedRequest

# Without this, send_from_directory serves .apk as octet-stream and some
# Android browsers rename the download to .zip, which breaks installation.
mimetypes.add_type("application/vnd.android.package-archive", ".apk")

# Extensions are created in extensions.py (so blueprints can decorate with
# them) and bound to the app here.
csrf.init_app(app)
limiter.init_app(app)


def _configure_secret_key(flask_app) -> None:
    """Set flask_app.secret_key from env, persisted file, or freshly generated value."""
    key_file = WEB_DIR.parent / "config" / ".secret_key"
    if os.environ.get("SECRET_KEY"):
        flask_app.secret_key = os.environ["SECRET_KEY"]
    elif key_file.exists():
        flask_app.secret_key = key_file.read_text().strip()
        key_file.chmod(0o600)  # enforce permissions on every startup
    else:
        new_key = secrets.token_hex(32)
        key_file.parent.mkdir(parents=True, exist_ok=True)
        key_file.write_text(new_key)
        key_file.chmod(0o600)
        flask_app.secret_key = new_key


_configure_secret_key(app)


# Single source of truth for service ports in all templates.
@app.context_processor
def _inject_globals():
    return {
        "PORT_DASHBOARD": PORT_DASHBOARD,
        "PORT_KIWIX": PORT_KIWIX,
        "PORT_KOLIBRI": PORT_KOLIBRI,
        "PORT_CALIBRE": PORT_CALIBRE,
        "PORT_JELLYFIN": PORT_JELLYFIN,
        "PORT_MAPS": PORT_MAPS,
        "PORT_MESHTASTIC": PORT_MESHTASTIC,
        "PORT_MESHCORE": PORT_MESHCORE,
        "PORT_OLLAMA": PORT_OLLAMA,
        "storage_mounted": STORAGE_MOUNTED,
        "now": datetime.now(),
        "TIMEOUT_AI_CHAT": TIMEOUT_AI_CHAT,
        # True when viewed inside a captive-portal mini-browser (the OS probe
        # Host header), so base.html can nudge the user to a real browser.
        "in_captive_browser": request.host.split(":")[0] in CAPTIVE_HOSTS,
        "is_admin": is_admin(),
        "admin_configured": admin_configured(),
    }


@app.after_request
def _security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    # Inline styles and scripts are used throughout the templates; unsafe-inline is
    # required until they are extracted to static files. This still blocks injected
    # external resources and data: URIs.
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "font-src 'self'; "
        "object-src 'none'; "
        "frame-ancestors 'none';",
    )
    return response


for _bp in ALL_BLUEPRINTS:
    app.register_blueprint(_bp)


@app.errorhandler(404)
def not_found(_e):
    return render_template("error.html", code=404, message="Page not found"), 404


@app.errorhandler(403)
def forbidden(_e):
    return render_template("error.html", code=403, message="Access forbidden"), 403


@app.errorhandler(500)
def server_error(_e):
    logging.exception("Internal server error")
    return render_template("error.html", code=500, message="Internal server error"), 500


# Start the background search-index refresher at import time so it runs under
# gunicorn (which imports this module) as well as the dev server.
start_index_refresher()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    host = os.environ.get("HOST", "0.0.0.0")
    # Debug mode disabled in production — never expose stack traces to users
    logging.info("SurviveV1 Dashboard starting on %s:%d", host, port)
    app.run(host=host, port=port, debug=False)
