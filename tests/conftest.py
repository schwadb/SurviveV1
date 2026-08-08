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
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "web"))
    import server as srv  # noqa: PLC0415 — deliberate lazy import, see docstring

    return srv


@pytest.fixture(scope="session")
def storage(server):
    """The temp storage dir the server module was imported against."""
    return Path(os.environ["SURVIVE_STORAGE_PATH"])


@pytest.fixture(scope="session")
def client(server):
    """Flask test client (CSRF stays enabled; GETs and the JSON-exempt chat
    endpoint work without tokens)."""
    return server.app.test_client()
