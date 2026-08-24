"""Shared fixture for the SurviveV1 unit tests.

web/server.py reads SURVIVE_STORAGE_PATH at import time and starts a daemon
index-refresher thread on import, so the import MUST happen lazily, inside the
fixture, after the env var points at a temp dir — and exactly once per session
(a reload would re-register Flask routes and explode).

The refresher thread sleeps 60+ s before its first build, so it is inert for
the life of a (fast) test run; tests must not wait on it or race it.
"""

import os
import sys
from pathlib import Path

import pytest


@pytest.fixture(scope="session")
def server(tmp_path_factory):
    storage = tmp_path_factory.mktemp("storage")
    os.environ["SURVIVE_STORAGE_PATH"] = str(storage)
    # Point the admin-password file into the temp dir so auth tests control it
    # and never touch the real repo config/.admin_password.
    os.environ["SURVIVE_ADMIN_PASSWORD_FILE"] = str(storage / ".admin_password")
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "web"))
    import server as srv  # noqa: PLC0415 — deliberate lazy import, see docstring

    # Rate limits are shared across the session (memory:// storage), so many
    # login/update POSTs in one run would trip the 3-5/min limits and make
    # tests order-dependent. Disable the limiter for unit tests — the smoke
    # suite exercises real limits against a live server instead.
    srv.limiter.enabled = False

    return srv


@pytest.fixture
def admin_password(server):
    """Set a known admin password for the duration of a test, then clear it.
    Returns the plaintext so the test can log in."""
    from werkzeug.security import generate_password_hash  # noqa: PLC0415
    pw = "test-admin-pw"
    server.ADMIN_PASSWORD_FILE.write_text(generate_password_hash(pw), encoding="utf-8")
    server._admin_hash_cache._ts = 0.0  # bust the 5 s TTL cache
    yield pw
    try:
        server.ADMIN_PASSWORD_FILE.unlink()
    except FileNotFoundError:
        pass
    server._admin_hash_cache._ts = 0.0


@pytest.fixture(scope="session")
def storage(server):
    """The temp storage dir the server module was imported against."""
    return Path(os.environ["SURVIVE_STORAGE_PATH"])


@pytest.fixture(scope="session")
def client(server):
    """Flask test client (CSRF stays enabled; GETs and the JSON-exempt chat
    endpoint work without tokens)."""
    return server.app.test_client()
