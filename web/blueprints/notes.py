"""
Notes and shared files: a Markdown notebook and a drop box on the drive.

Notes are $STORAGE/notes/<slug>.md rendered by textutils.render_markdown (a
deliberately small subset that HTML-escapes everything first). Writes are
open to the LAN (CSRF form) — the notebook is a shared pad for whoever is on
the hotspot — while deletes are admin-only. The same model applies to
$STORAGE/shared/: anyone may upload, only an admin may delete.
"""

import logging
from datetime import datetime

from flask import Blueprint, abort, redirect, render_template, request, url_for
from werkzeug.utils import secure_filename

import textutils
from common import _admin_required, _free_bytes
from settings import FREE_SPACE_MARGIN, STORAGE_PATH
from extensions import limiter

bp = Blueprint("notes", __name__)

# ── Notes ─────────────────────────────────────────────────────────────────────
NOTES_DIR = STORAGE_PATH / "notes"
_NOTE_MAX_BYTES = 512 * 1024
_NOTES_MAX = 5000


def _note_path(slug: str):
    """Path for a slug, or None if the slug is not well-formed."""
    if not textutils.SLUG_PATTERN.match(slug or ""):
        return None
    return NOTES_DIR / f"{slug}.md"


def _note_read(slug: str):
    path = _note_path(slug)
    if not path or not path.is_file():
        return None
    try:
        body = path.read_text(encoding="utf-8", errors="replace")
        st = path.stat()
    except OSError:
        return None
    return {"slug": slug, "body": body, "title": textutils.first_heading(body) or slug,
            "modified": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M"),
            "size": st.st_size}


def _list_notes(query: str = "") -> list:
    """All notes, newest first; `query` filters on title/body (case-insensitive)."""
    notes = []
    if not NOTES_DIR.is_dir():
        return notes
    needle = query.strip().lower()
    for path in NOTES_DIR.glob("*.md"):
        slug = path.stem
        if not textutils.SLUG_PATTERN.match(slug):
            continue
        try:
            body = path.read_text(encoding="utf-8", errors="replace")
            mtime = path.stat().st_mtime
        except OSError:
            continue
        if needle and needle not in body.lower() and needle not in slug:
            continue
        lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
        snippet = ""
        if needle:
            for ln in lines:
                if needle in ln.lower():
                    snippet = ln[:160]
                    break
        if not snippet:
            snippet = " ".join(lines[1:3])[:160] if len(lines) > 1 else ""
        notes.append({"slug": slug, "title": textutils.first_heading(body) or slug,
                      "snippet": snippet, "mtime": mtime,
                      "modified": datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M")})
    notes.sort(key=lambda n: n["mtime"], reverse=True)
    return notes


def _unique_slug(base: str) -> str:
    slug = base
    n = 2
    while (NOTES_DIR / f"{slug}.md").exists():
        slug = f"{base[:74]}-{n}"
        n += 1
    return slug


def _search_notes(query: str, limit: int = 10) -> list:
    """Used by the main /search page for its notes section."""
    return _list_notes(query)[:limit]


@bp.route("/notes")
def notes_page():
    query = request.args.get("q", "").strip()[:100]
    return render_template("notes.html", notes=_list_notes(query), query=query)


@bp.route("/notes/new")
def note_new():
    return render_template("note_edit.html", note=None, body="")


@bp.route("/notes/<slug>")
def note_view(slug):
    note = _note_read(slug)
    if not note:
        abort(404)
    if request.args.get("edit"):
        return render_template("note_edit.html", note=note, body=note["body"])
    return render_template("note_view.html", note=note,
                           rendered=textutils.render_markdown(note["body"]))


@bp.route("/notes/save", methods=["POST"])
@limiter.limit("30 per minute")
def note_save():
    """Create or update a note. CSRF-protected HTML form; open to the LAN —
    the notebook is a shared pad for whoever is on the hotspot."""
    body = request.form.get("body", "").replace("\r\n", "\n")
    if len(body.encode("utf-8")) > _NOTE_MAX_BYTES:
        return render_template("error.html", code=413, message="Note too long (512 KB max)"), 413
    if not body.strip():
        return redirect(url_for("notes.notes_page"))
    slug = request.form.get("slug", "").strip()
    try:
        NOTES_DIR.mkdir(parents=True, exist_ok=True)
        if slug:
            path = _note_path(slug)
            if not path:
                abort(400)
        else:
            if sum(1 for _ in NOTES_DIR.glob("*.md")) >= _NOTES_MAX:
                return render_template("error.html", code=507, message="Too many notes"), 507
            slug = _unique_slug(textutils.slugify(textutils.first_heading(body)))
            path = NOTES_DIR / f"{slug}.md"
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(body, encoding="utf-8")
        tmp.replace(path)
    except OSError as exc:
        logging.warning("note save failed: %s", exc)
        return render_template("error.html", code=500, message="Could not save the note"), 500
    return redirect(url_for("notes.note_view", slug=slug))


@bp.route("/notes/<slug>/delete", methods=["POST"])
@_admin_required
def note_delete(slug):
    path = _note_path(slug)
    if not path or not path.is_file():
        abort(404)
    try:
        path.unlink()
    except OSError:
        abort(500)
    return redirect(url_for("notes.notes_page"))


# ── Shared files: drop zone for personal documents ───────────────────────────
SHARED_DIR = STORAGE_PATH / "shared"
_SHARED_MAX_FILES = 20000


def _shared_listing() -> list:
    items = []
    if not SHARED_DIR.is_dir():
        return items
    for entry in SHARED_DIR.iterdir():
        if entry.name.startswith("."):
            continue
        try:
            st = entry.stat()
        except OSError:
            continue
        items.append({
            "name": entry.name, "is_dir": entry.is_dir(),
            "size_mb": round(st.st_size / 1024 ** 2, 2) if entry.is_file() else None,
            "modified": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M"),
            "ext": entry.suffix.lower().lstrip(".") if entry.is_file() else "",
        })
    items.sort(key=lambda i: (not i["is_dir"], i["name"].lower()))
    return items


@bp.route("/shared")
def shared_page():
    return render_template("shared.html", items=_shared_listing(),
                           free_gb=round(_free_bytes() / 1024 ** 3, 1),
                           message=request.args.get("m", "")[:200])


@bp.route("/shared/upload", methods=["POST"])
@limiter.limit("20 per minute")
def shared_upload():
    """Multipart upload into $STORAGE/shared. Open to the LAN (CSRF form);
    deletion is admin-only. Streams to disk, keeps the free-space margin."""
    files = [f for f in request.files.getlist("files") if f and f.filename]
    if not files:
        return redirect(url_for("notes.shared_page", m="Pick at least one file."))
    declared = request.content_length or 0
    if _free_bytes() - declared < FREE_SPACE_MARGIN:
        return redirect(url_for("notes.shared_page",
                                m="Not enough free space (10 GB is always kept free)."))
    try:
        SHARED_DIR.mkdir(parents=True, exist_ok=True)
        if sum(1 for _ in SHARED_DIR.iterdir()) + len(files) > _SHARED_MAX_FILES:
            return redirect(url_for("notes.shared_page", m="The shared folder is full."))
        saved = []
        for upload in files:
            name = secure_filename(upload.filename)[:150]
            if not name:
                continue
            dest = SHARED_DIR / name
            stem, suffix = dest.stem, dest.suffix
            n = 2
            while dest.exists():
                dest = SHARED_DIR / f"{stem}-{n}{suffix}"
                n += 1
            upload.save(str(dest))
            saved.append(dest.name)
    except OSError as exc:
        logging.warning("upload failed: %s", exc)
        return redirect(url_for("notes.shared_page", m="Upload failed — is the drive full?"))
    note = f"Saved {len(saved)} file(s)." if saved else "Nothing saved — bad filename?"
    return redirect(url_for("notes.shared_page", m=note))


@bp.route("/shared/delete", methods=["POST"])
@_admin_required
def shared_delete():
    name = secure_filename(request.form.get("name", ""))
    target = SHARED_DIR / name
    if not name or not target.is_file():
        abort(404)
    try:
        target.unlink()
    except OSError:
        abort(500)
    return redirect(url_for("notes.shared_page", m=f"Deleted {name}."))
