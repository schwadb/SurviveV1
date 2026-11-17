"""Shared fixture for the SurviveV1 unit tests.

web/settings.py reads SURVIVE_STORAGE_PATH at import time and web/server.py
starts a daemon index-refresher thread on import, so the import MUST happen
lazily, inside the fixture, after the env var points at a temp dir — and
exactly once per session (a reload would re-register Flask routes and explode).

The app is split into modules (web/settings.py, common.py, search_index.py and
the web/blueprints/ package). Tests reach a module's helpers through the
small fixtures below (``ai``, ``idx``, ``sysm`` ...) rather than through the
``server`` module, which now only builds the app.

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


def _module(name):
    import importlib  # noqa: PLC0415
    return importlib.import_module(name)


@pytest.fixture(scope="session")
def cfg(server):  # pylint: disable=unused-argument
    """web/settings.py — paths, timeouts, Ollama location."""
    return _module("settings")


@pytest.fixture(scope="session")
def common(server):  # pylint: disable=unused-argument
    """web/common.py — caches, admin auth, service probes, job helpers."""
    return _module("common")


@pytest.fixture(scope="session")
def idx(server):  # pylint: disable=unused-argument
    """web/search_index.py — filename/doc/drug indexes and Kiwix search."""
    return _module("search_index")


@pytest.fixture(scope="session")
def ai(server):  # pylint: disable=unused-argument
    return _module("blueprints.ai")


@pytest.fixture(scope="session")
def sysm(server):  # pylint: disable=unused-argument
    """blueprints.system — login, status, update, service restart, health."""
    return _module("blueprints.system")


@pytest.fixture(scope="session")
def notes(server):  # pylint: disable=unused-argument
    return _module("blueprints.notes")


@pytest.fixture(scope="session")
def comms(server):  # pylint: disable=unused-argument
    return _module("blueprints.comms")


@pytest.fixture
def admin_password(cfg, common):
    """Set a known admin password for the duration of a test, then clear it.
    Returns the plaintext so the test can log in."""
    from werkzeug.security import generate_password_hash  # noqa: PLC0415
    pw = "test-admin-pw"
    cfg.ADMIN_PASSWORD_FILE.write_text(generate_password_hash(pw), encoding="utf-8")
    common._admin_hash_cache.invalidate()  # bust the 5 s TTL cache
    yield pw
    try:
        cfg.ADMIN_PASSWORD_FILE.unlink()
    except FileNotFoundError:
        pass
    common._admin_hash_cache.invalidate()


@pytest.fixture(scope="session")
def storage(server):
    """The temp storage dir the server module was imported against."""
    return Path(os.environ["SURVIVE_STORAGE_PATH"])


@pytest.fixture(scope="session")
def client(server):
    """Flask test client (CSRF stays enabled; GETs and the JSON-exempt chat
    endpoint work without tokens)."""
    return server.app.test_client()
