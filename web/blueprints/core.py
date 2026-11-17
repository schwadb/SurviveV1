"""
Core pages: home, category browser, file browser/serving, search, health,
and the captive-portal probe answers.

Path traversal guard: both /serve/<path> and /files?path= use
Path.resolve().relative_to(storage_root). Symlinks that escape storage are
caught because resolve() follows them before the check.
"""

import logging
from datetime import datetime
from pathlib import Path

from flask import (
    Blueprint, abort, jsonify, redirect, render_template, request,
    send_from_directory, url_for,
)

from blueprints.notes import _search_notes
from common import _safe_walk, check_all_services, get_storage_info
from settings import CAPTIVE_REDIRECT, STORAGE_PATH
from constants import CATEGORIES
from extensions import limiter
from search_index import (
    _index_meta,
    _kiwix_search,
    _query_doc_index,
    _query_search_index,
    _search_walk,
    _trigger_index_build,
)

bp = Blueprint("core", __name__)


@bp.route("/")
def index():
    storage = get_storage_info()
    return render_template(
        "index.html",
        categories=CATEGORIES,
        services=check_all_services(),
        storage=storage,
        now=datetime.now(),
    )


@bp.route("/category/<cat_id>")
def category(cat_id):
    cat = next((c for c in CATEGORIES if c["id"] == cat_id), None)
    if not cat:
        return redirect(url_for("core.index"))

    files = []
    try:
        search_dirs = [
            STORAGE_PATH / "pdfs" / cat_id,
            STORAGE_PATH / "books" / cat_id,
            STORAGE_PATH / "videos" / cat_id,
            STORAGE_PATH / cat_id,  # top-level dir (e.g. maps/, zim/ via "maps" / "reference" id)
        ]
        for d in search_dirs:
            if d.exists():
                for f in _safe_walk(d):
                    files.append({
                        "name": f.stem,
                        "filename": f.name,
                        "ext": f.suffix.lower().lstrip("."),
                        "path": str(f.relative_to(STORAGE_PATH)),
                        "size_mb": round(f.stat().st_size / (1024**2), 1),
                    })
    except OSError as e:
        logging.warning("category listing failed for %s: %s", cat_id, e)

    return render_template("category.html", cat=cat, files=files, categories=CATEGORIES)


@bp.route("/files")
def browse_files():
    """File browser for all content."""
    rel_path = request.args.get("path", "")
    # Path traversal guard: resolve the requested path and refuse anything
    # that escapes the storage root.
    storage_root = STORAGE_PATH.resolve()
    try:
        browse_dir = (STORAGE_PATH / rel_path).resolve() if rel_path else storage_root
        browse_dir.relative_to(storage_root)
    except (ValueError, OSError):
        abort(403)
    if not browse_dir.exists() or not browse_dir.is_dir():
        abort(404)

    items = []
    try:
        for item in sorted(browse_dir.iterdir()):
            if item.name.startswith("."):
                continue
            stat = item.stat()
            items.append({
                "name": item.name,
                "is_dir": item.is_dir(),
                "size_mb": round(stat.st_size / (1024**2), 1) if item.is_file() else None,
                "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d"),
                "path": str(item.relative_to(STORAGE_PATH)),
                "ext": item.suffix.lower().lstrip(".") if item.is_file() else "",
            })
    except PermissionError as e:
        logging.warning("browse_files permission denied at %s: %s", browse_dir, e)

    parent = str(Path(rel_path).parent) if rel_path else None
    return render_template(
        "files.html",
        items=items,
        current_path=rel_path,
        parent=parent,
        categories=CATEGORIES,
    )


@bp.route("/serve/<path:filepath>")
def serve_file(filepath):
    """Serve a file from storage."""
    full_path = (STORAGE_PATH / filepath).resolve()
    storage_root = STORAGE_PATH.resolve()
    # Prevent path traversal — ensure the resolved path is inside storage root
    try:
        full_path.relative_to(storage_root)
    except ValueError:
        return render_template("error.html", code=403, message="Access forbidden"), 403
    if not full_path.exists():
        return render_template("error.html", code=404, message="File not found"), 404
    return send_from_directory(str(full_path.parent), full_path.name)


@bp.route("/apps")
def apps_page():
    """List the sideloadable installers under $STORAGE/apps for hotspot guests."""
    apps_root = STORAGE_PATH / "apps"
    groups = {"android": [], "windows": []}
    for platform, items in groups.items():
        pdir = apps_root / platform
        if not pdir.exists():
            continue
        for f in sorted(_safe_walk(pdir), key=lambda p: p.name):
            try:
                size_mb = round(f.stat().st_size / (1024 * 1024), 1)
            except OSError:
                size_mb = 0
            items.append({
                "name": f.name,
                "path": str(f.relative_to(STORAGE_PATH)),
                "size_mb": size_mb,
            })
    have_any = any(groups.values())
    return render_template("apps.html", groups=groups, have_any=have_any)


@bp.route("/search")
@limiter.limit("30 per minute")
def search():
    query = request.args.get("q", "").strip()[:200]  # cap at 200 chars to prevent ReDoS
    results = []
    article_results = []
    doc_results = []
    note_results = []

    if query and len(query) >= 2:
        indexed = _query_search_index(query)
        if indexed is None:
            # Index not ready yet — serve via the live walk this once and
            # kick off a background build for next time.
            results = _search_walk(query)
            _trigger_index_build()
        else:
            results = indexed
        # Second section: full-text hits inside Kiwix articles (best-effort).
        article_results = _kiwix_search(query, limit=5)
        # Third section: full-text hits inside local PDFs/EPUBs.
        doc_results = _query_doc_index(query) or []
        # Fourth: the shared notebook.
        note_results = _search_notes(query)

    meta = _index_meta()
    return render_template(
        "search.html",
        query=query,
        results=results,
        article_results=article_results,
        doc_results=doc_results,
        note_results=note_results,
        categories=CATEGORIES,
        index_count=meta["count"],
        index_built_at=meta["built_at"],
    )


@bp.route("/health")
@limiter.exempt
def health():
    """Lightweight liveness probe for systemd ExecStartPost and external checks."""
    return jsonify({"status": "ok"}), 200


# ── Captive portal ────────────────────────────────────────────────────────────
# On the hotspot, dnsmasq resolves every hostname to 10.42.0.1, so an OS
# connectivity probe reaches these routes. Answering them with anything OTHER
# than the expected success response makes the phone open its captive-portal
# sign-in window pointed at our dashboard. All are @limiter.exempt: phones poll
# these aggressively and a 429 would break portal detection.

@bp.route("/generate_204")
@bp.route("/gen_204")
@limiter.exempt
def captive_android():
    """Android probes expect HTTP 204. Returning a 302 to the dashboard is what
    makes Android raise the 'Sign in to network' notification."""
    return redirect(CAPTIVE_REDIRECT, code=302)


@bp.route("/hotspot-detect.html")
@bp.route("/library/test/success.html")
@limiter.exempt
def captive_apple():
    """Apple expects the literal body 'Success'. Anything else opens the
    Captive Network Assistant showing our page."""
    return (
        '<!DOCTYPE html><html><head><meta http-equiv="refresh" '
        f'content="0; url={CAPTIVE_REDIRECT}"></head><body>'
        f'<a href="{CAPTIVE_REDIRECT}">Open SurviveV1</a></body></html>',
        200, {"Content-Type": "text/html"},
    )


@bp.route("/ncsi.txt")
@bp.route("/connecttest.txt")
@bp.route("/redirect")
@limiter.exempt
def captive_windows():
    """Windows NCSI expects 'Microsoft Connect Test'/HTTP 200; a redirect
    triggers its captive-portal flow."""
    return redirect(CAPTIVE_REDIRECT, code=302)
