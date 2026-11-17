"""
SurviveV1 — Flask extension instances shared by every blueprint.

They are created here without an app and bound in server.py with
init_app(), which lets blueprint modules decorate their views
(@limiter.limit, @csrf.exempt) without importing the app object and
creating circular imports.
"""

import os

from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_wtf.csrf import CSRFProtect

# CSRF is enabled for HTML form POSTs. JSON APIs are exempted individually
# and defended by a strict application/json Content-Type check instead --
# browsers cannot send that cross-origin without a CORS preflight.
csrf = CSRFProtect()

# Per-IP rate limiting; protects /api/ai/chat (which proxies to Ollama and
# can pin the Pi's CPU) and /search (which walks the 800 GB storage tree).
# storage_uri defaults to memory:// (per-gunicorn-worker counters, so
# effective limits are ~2x with 2 workers — acceptable for a LAN appliance).
# Set SURVIVE_LIMITER_STORAGE="redis://127.0.0.1:6379" (with a local redis and
# `pip install limits[redis]`) to make limits exact across workers.
limiter = Limiter(
    get_remote_address,
    default_limits=["120 per minute"],
    storage_uri=os.environ.get("SURVIVE_LIMITER_STORAGE", "memory://"),
)
