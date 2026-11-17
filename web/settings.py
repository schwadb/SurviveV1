"""
SurviveV1 — Runtime settings for the dashboard.

Everything the server reads from the environment at startup lives here so
every blueprint sees the same values. All settings have defaults (see the
table in CLAUDE.md).
"""

import logging
import os
import re
from pathlib import Path

from constants import PORT_OLLAMA

# ── Paths ─────────────────────────────────────────────────────────────────────
# The installed dashboard runs from a copy under /opt/survive, but the scripts
# it launches (update, rescan, ZIM downloads) live in the git clone.
# generate_services.sh exports SURVIVE_REPO_DIR; dev runs fall back to the tree.
WEB_DIR = Path(__file__).resolve().parent
REPO_DIR = Path(os.environ.get("SURVIVE_REPO_DIR") or WEB_DIR.parent)
DATA_DIR = Path(os.environ.get("SURVIVE_DATA_DIR", REPO_DIR / "data"))
_configured_storage = Path(os.environ.get("SURVIVE_STORAGE_PATH", "/mnt/survive"))
# Snapshot at startup — does not track live mount/unmount after the server starts.
STORAGE_MOUNTED = _configured_storage.exists()
STORAGE_PATH = _configured_storage if STORAGE_MOUNTED else DATA_DIR

# Admin password hash written by scripts/set_admin_password.py. Guests never
# log in; auth exists ONLY to elevate to admin (one password).
ADMIN_PASSWORD_FILE = Path(os.environ.get(
    "SURVIVE_ADMIN_PASSWORD_FILE",
    str(WEB_DIR.parent / "config" / ".admin_password"),
))

# ── Tunable timeouts (seconds) — override via environment or survive.conf ────
TIMEOUT_SERVICE_CHECK = float(os.environ.get("SURVIVE_SERVICE_CHECK_TIMEOUT", "1"))
TIMEOUT_OLLAMA_LIST = float(os.environ.get("SURVIVE_OLLAMA_LIST_TIMEOUT", "2"))
# 300, not 60: this is an IDLE timeout between stream chunks, and the one
# gap that must survive is the COLD LOAD — gemma4:12b is 7.6 GB read from a
# USB drive into RAM before the first token exists, which alone takes
# 30-80 s on a Pi 5. At 60 s the dashboard declared the AI dead exactly and
# only when the user picked the best model.
TIMEOUT_AI_CHAT = float(os.environ.get("SURVIVE_AI_CHAT_TIMEOUT", "300"))
# Timeout for internal Kiwix calls; retrieval must never eat the chat budget.
TIMEOUT_KIWIX = TIMEOUT_OLLAMA_LIST

# ── Misc limits ───────────────────────────────────────────────────────────────
CACHE_TTL = 60.0  # seconds — how long content-stat / recent-file caches are valid
# Search is capped to avoid walking 800 GB to exhaustion with zero matches.
MAX_FILES_CHECKED = 500_000
# Downloads and uploads must never fill the drive completely: Kiwix needs
# scratch space and a full disk corrupts in-flight ZIMs.
FREE_SPACE_MARGIN = 10 * 1024 ** 3

# ── Captive portal ────────────────────────────────────────────────────────────
# On the hotspot, dnsmasq resolves every hostname to 10.42.0.1, so an OS
# connectivity probe reaches the dashboard. Where to send such probes:
CAPTIVE_REDIRECT = "http://10.42.0.1:8080/"
# Hostnames the OS uses for its connectivity probe — used to show a hint banner
# when the dashboard is being viewed inside the captive mini-browser.
CAPTIVE_HOSTS = frozenset({
    "connectivitycheck.gstatic.com", "clients3.google.com",
    "www.google.com", "captive.apple.com", "www.apple.com",
    "www.msftconnecttest.com", "www.msftncsi.com", "detectportal.firefox.com",
})


# ── Ollama location ───────────────────────────────────────────────────────────
def _resolve_ollama_base() -> str:
    """Base URL for the Ollama API. Defaults to the local server, but
    SURVIVE_OLLAMA_HOST can point at a more powerful satellite box (an x86
    mini-PC) so the always-on Pi offloads inference. Garbage falls back to
    localhost with a log line rather than breaking startup."""
    raw = os.environ.get("SURVIVE_OLLAMA_HOST", "").strip()
    default = f"http://localhost:{PORT_OLLAMA}"
    if not raw:
        return default
    if not re.match(r"^https?://[^/\s]+$", raw.rstrip("/")):
        logging.getLogger(__name__).warning(
            "SURVIVE_OLLAMA_HOST=%r is not a valid http(s)://host[:port] URL "
            "-- falling back to %s", raw, default)
        return default
    return raw.rstrip("/")


# Whether AI runs on a remote host (affects service-check method + restart UI).
OLLAMA_BASE = _resolve_ollama_base()
OLLAMA_IS_REMOTE = OLLAMA_BASE != f"http://localhost:{PORT_OLLAMA}"
