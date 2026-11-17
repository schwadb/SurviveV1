"""
System: admin login, status page, download progress, one-click update,
nightly auto-update schedule, per-service restart, and machine health.

Admin-only actions shell out to systemctl through the exact commands
allowlisted by scripts/install_sudoers.sh (no wildcards). The content update
runs detached (minutes to hours); its state is reconstructed from disk by
common._read_job_state because gunicorn workers share no memory.
"""

import os
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

from flask import (
    Blueprint, jsonify, redirect, render_template, request, session, url_for,
)
from werkzeug.security import check_password_hash

from common import (
    _ANSI_RE,
    _TTLCache,
    _admin_hash,
    _admin_required,
    _compute_connectivity,
    _connectivity_cache,
    _launch_detached,
    _read_job_state,
    _require_json,
    admin_configured,
    check_all_services,
    get_content_stats,
    get_recent_downloads,
    get_storage_info,
    is_admin,
)
from settings import OLLAMA_IS_REMOTE, REPO_DIR, STORAGE_PATH
from constants import CATEGORIES, DOWNLOAD_CATEGORIES, SERVICES
from extensions import csrf, limiter

bp = Blueprint("system", __name__)


# ── Login / logout ────────────────────────────────────────────────────────────
@bp.route("/login", methods=["GET", "POST"])
@limiter.limit("5 per minute", methods=["POST"])
def login():
    """Elevate an anonymous guest to admin. CSRF-protected form POST."""
    if request.method == "GET":
        if is_admin():
            return redirect(url_for("core.index"))
        return render_template("login.html", configured=admin_configured())

    stored = _admin_hash()
    password = request.form.get("password", "")
    if not stored:
        return render_template(
            "login.html", configured=False,
            error="No admin password is set on this device."), 403
    if not check_password_hash(stored, password):
        return render_template(
            "login.html", configured=True,
            error="Incorrect password."), 401
    # Success — regenerate the session to prevent fixation, then mark admin.
    session.clear()
    session["admin"] = True
    dest = request.args.get("next", "")
    # Only allow same-site relative redirects.
    if not dest.startswith("/") or dest.startswith("//"):
        dest = url_for("core.index")
    return redirect(dest)


@bp.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return redirect(url_for("core.index"))


# ── Status APIs ───────────────────────────────────────────────────────────────
@bp.route("/api/status")
def api_status():
    """System status API endpoint."""
    svc = check_all_services()
    return jsonify({
        "storage": get_storage_info(),
        "services": {name: {"running": v["running"], "port": v["port"]} for name, v in svc.items()},
        "content": get_content_stats(),
        "timestamp": datetime.now().isoformat(),
    })


@bp.route("/api/recent")
def api_recent():
    return jsonify(get_recent_downloads())


def _tail_active_log():
    """Return {file, line} for the last activity line of the newest download
    log, or None. Reads only the file's tail — logs can be hundreds of MB."""
    logs_dir = STORAGE_PATH / ".logs"
    try:
        log_files = [p for p in logs_dir.iterdir() if p.is_file()] if logs_dir.exists() else []
    except OSError:
        return None
    if not log_files:
        return None
    newest = max(log_files, key=lambda p: p.stat().st_mtime)
    try:
        size = newest.stat().st_size
        with open(newest, "rb") as fh:
            fh.seek(max(0, size - 500))
            tail = fh.read().decode("utf-8", errors="replace")
    except OSError:
        return None
    lines = [ln for ln in tail.splitlines() if ln.strip()]
    if not lines:
        return None
    return {"file": newest.name, "line": _ANSI_RE.sub("", lines[-1]).strip()}


def _compute_download_status() -> dict:
    """Assemble per-category download progress from artifacts the downloader
    already writes (.download_progress + content sizes + .logs tail)."""
    progress_file = STORAGE_PATH / ".download_progress"
    completed = set()
    try:
        if progress_file.exists():
            completed = {
                ln.strip() for ln in progress_file.read_text().splitlines() if ln.strip()
            }
    except OSError:
        pass

    stats = get_content_stats()  # cached; no extra walk
    cats = []
    for cat in DOWNLOAD_CATEGORIES:
        size_gb = stats.get(cat["dir"], {}).get("size_gb", 0)
        if cat["id"] in completed:
            status = "complete"
        elif size_gb and size_gb > 0:
            status = "in_progress"
        else:
            status = "pending"
        cats.append({
            "id": cat["id"],
            "name": cat["name"],
            "budget_gb": cat["budget_gb"],
            "size_gb": size_gb,
            "status": status,
        })

    return {
        "categories": cats,
        "active_log": _tail_active_log(),
        "complete": sum(1 for c in cats if c["status"] == "complete"),
        "total": len(cats),
    }


_downloads_cache = _TTLCache(15.0)


@bp.route("/api/downloads")
def api_downloads():
    """Per-category download progress for the dashboard."""
    return jsonify(_downloads_cache.get(_compute_download_status))


@bp.route("/api/connectivity")
def api_connectivity():
    """Server-side internet check. The browser cannot probe external hosts
    itself (blocked by our connect-src 'self' CSP), and the Pi's connectivity
    is what matters for downloads anyway."""
    return jsonify(_connectivity_cache.get(_compute_connectivity))


# ── One-click content update ─────────────────────────────────────────────────
# POST /api/update/start launches scripts/update_content.sh detached from the
# request (updates run minutes to hours). State lives on disk — pid file plus
# a finish marker appended to the log by the wrapper — because gunicorn runs
# multiple workers and the one that spawned the process is not necessarily
# the one answering the next status poll.
UPDATE_SCRIPT = REPO_DIR / "scripts" / "update_content.sh"
_UPDATE_FINISH_MARK = "UPDATE_FINISHED exit="


def _update_paths() -> tuple:
    logs_dir = STORAGE_PATH / ".logs"
    return logs_dir / "update_content.log", logs_dir / "update_content.pid"


def _read_update_state() -> dict:
    """Current update-run state, reconstructed purely from disk artifacts."""
    log_file, pid_file = _update_paths()
    return _read_job_state(log_file, pid_file, _UPDATE_FINISH_MARK, tail_lines=25)


@bp.route("/api/update/status")
def api_update_status():
    """Poll target for the dashboard's update button."""
    return jsonify(_read_update_state())


@bp.route("/api/update/start", methods=["POST"])
@csrf.exempt
@limiter.limit("3 per minute")
@_admin_required
def api_update_start():
    """Kick off a safe content refresh (scripts/update_content.sh) in the
    background: new videos/books/PDFs, missing ZIMs, AI model updates —
    never replacement builds of existing large ZIMs. Admin-only."""
    err = _require_json()
    if err:
        return err

    state = _read_update_state()
    if state["running"]:
        return jsonify({"error": "An update is already running"}), 409
    if not _compute_connectivity()["online"]:
        return jsonify({"error": "No internet connection — connect the Pi first"}), 503
    if not UPDATE_SCRIPT.exists():
        return jsonify({"error": f"Update script missing: {UPDATE_SCRIPT}"}), 500

    log_file, pid_file = _update_paths()
    try:
        pid = _launch_detached(UPDATE_SCRIPT, [], log_file, pid_file, _UPDATE_FINISH_MARK)
    except OSError as exc:
        return jsonify({"error": f"Could not start update: {exc}"}), 500
    return jsonify({"started": True, "pid": pid}), 202


# ── Nightly auto-update schedule (systemd timer) ─────────────────────────────
UPDATE_TIMER = "survive-content-update.timer"


def _timer_state() -> dict:
    """Ask systemd about the nightly timer. No sudo needed to read."""
    state = {"available": False, "enabled": False, "active": False,
             "next_run": None, "last_run": None}
    systemctl = shutil.which("systemctl")
    if not systemctl:
        return state
    try:
        out = subprocess.run(
            [systemctl, "show", UPDATE_TIMER, "--no-pager",
             "-p", "UnitFileState", "-p", "ActiveState",
             "-p", "NextElapseUSecRealtime", "-p", "LastTriggerUSec"],
            capture_output=True, text=True, timeout=4, check=False,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return state
    props = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
    if not props or props.get("UnitFileState", "") in ("", "not-found"):
        return state
    state["available"] = True
    state["enabled"] = props.get("UnitFileState") == "enabled"
    state["active"] = props.get("ActiveState") == "active"
    state["next_run"] = props.get("NextElapseUSecRealtime") or None
    state["last_run"] = props.get("LastTriggerUSec") or None
    if state["next_run"] in ("n/a", "0"):
        state["next_run"] = None
    if state["last_run"] in ("n/a", "0"):
        state["last_run"] = None
    return state


def _schedule_info() -> dict:
    info = _timer_state()
    info["time"] = os.environ.get("SURVIVE_AUTO_UPDATE_TIME", "02:30")
    try:
        cap = int(os.environ.get("SURVIVE_AUTO_UPDATE_RATE_LIMIT", "2097152") or 0)
    except ValueError:
        cap = 0
    info["rate_limit_kbps"] = cap // 1024 if cap else 0
    return info


@bp.route("/api/update/schedule")
def api_update_schedule():
    return jsonify(_schedule_info())


@bp.route("/api/update/schedule", methods=["POST"])
@csrf.exempt
@limiter.limit("6 per minute")
@_admin_required
def api_update_schedule_set():
    """Turn the nightly timer on or off via the sudoers-allowlisted commands."""
    err = _require_json()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    enable = bool(data.get("enabled"))
    verb = "enable" if enable else "disable"
    cmd = ["sudo", "-n", "/usr/bin/systemctl", verb, "--now", UPDATE_TIMER]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15, check=False)
    except (OSError, subprocess.SubprocessError) as exc:
        return jsonify({"error": f"Could not run systemctl: {exc}"}), 500
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()[:200]
        return jsonify({"error": "systemctl refused — run scripts/install_sudoers.sh on the Pi. "
                                 + detail, "manual": " ".join(cmd[2:])}), 500
    return jsonify(_schedule_info())


# ── Per-service restart ───────────────────────────────────────────────────────
@bp.route("/api/service/<name>/restart", methods=["POST"])
@csrf.exempt
@limiter.limit("6 per minute")
@_admin_required
# Each early return is a distinct client-facing error contract (415/404/400/
# 500); collapsing them would obscure which failure the caller hit.
# pylint: disable=too-many-return-statements
def api_service_restart(name):
    """Restart one managed service via the sudoers-allowlisted systemctl.
    Admin-only. The unit name is looked up from SERVICES (never taken from the
    URL) so only known units can be targeted."""
    err = _require_json()
    if err:
        return err
    svc = SERVICES.get(name)
    if not svc:
        return jsonify({"error": "Unknown service"}), 404
    unit = svc.get("unit")
    if not unit:
        return jsonify({"error": "This service has no restart control"}), 400
    # The AI service may live on a remote host (SURVIVE_OLLAMA_HOST) we can't
    # restart from here.
    if name == "ai" and OLLAMA_IS_REMOTE:
        return jsonify({"error": "AI runs on a remote host — restart it there"}), 400

    cmd = ["sudo", "-n", "/usr/bin/systemctl", "restart", unit]
    # Restarting the dashboard's own unit kills the worker handling this
    # request, so detach it (same pattern as the updater) and return 202.
    if unit == "survive-dashboard":
        try:
            subprocess.Popen(  # pylint: disable=consider-using-with
                cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, start_new_session=True,
            )
        except OSError as exc:
            return jsonify({"error": f"Could not restart: {exc}"}), 500
        return jsonify({"restarting": unit, "detached": True}), 202

    try:
        result = subprocess.run(cmd, capture_output=True, text=True,
                                timeout=30, check=False)
    except (OSError, subprocess.SubprocessError) as exc:
        return jsonify({"error": f"Restart failed: {exc}"}), 500
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()[:200]
        return jsonify({"error": f"systemctl restart {unit} failed: {detail}",
                        "hint": "run scripts/install_sudoers.sh"}), 500
    return jsonify({"restarted": unit}), 200


# ── Machine health ────────────────────────────────────────────────────────────
def _read_throttle_state() -> dict:
    """Parse `vcgencmd get_throttled` (Pi firmware). Bits: 0 under-voltage
    now, 1 freq-capped now, 2 throttled now, 3 soft temp limit now; bits
    16-19 = the same conditions since boot. All-False when vcgencmd is
    missing or its output is unparseable (CI, non-Pi hardware — and some
    setups print a permission error on stdout WITH exit code 0, so the
    output parse is the only trustworthy signal)."""
    state = {"undervoltage": False, "throttled": False, "capped": False,
             "soft_temp_limit": False, "occurred_since_boot": False, "raw": None}
    try:
        out = subprocess.run(
            ["vcgencmd", "get_throttled"],
            capture_output=True, text=True, timeout=2, check=False,
        ).stdout.strip()
        bits = int(out.split("=")[1], 16)  # e.g. "throttled=0x50005"
    except (OSError, subprocess.SubprocessError, IndexError, ValueError):
        return state
    state.update({
        "undervoltage": bool(bits & 0x1),
        "capped": bool(bits & 0x2),
        "throttled": bool(bits & 0x4),
        "soft_temp_limit": bool(bits & 0x8),
        "occurred_since_boot": bool(bits & 0xF0000),
        "raw": hex(bits),
    })
    return state


def _compute_system_health() -> dict:
    """CPU temp, throttle state, RAM/swap, load, uptime. Every source is
    individually guarded so non-Pi environments return zeros, never errors."""
    temp_c = 0.0
    try:
        raw = Path("/sys/class/thermal/thermal_zone0/temp").read_text(encoding="ascii")
        temp_c = round(int(raw.strip()) / 1000, 1)
    except (OSError, ValueError):
        pass

    meminfo = {}
    try:
        for line in Path("/proc/meminfo").read_text(encoding="ascii").splitlines():
            key, _, rest = line.partition(":")
            meminfo[key] = int(rest.split()[0])  # kB
    except (OSError, ValueError, IndexError):
        pass
    mem_total = meminfo.get("MemTotal", 0)
    # MemAvailable (not MemFree — that's always ~0 due to page cache) is the
    # number that actually predicts OOM.
    mem_avail = meminfo.get("MemAvailable", 0)
    swap_total = meminfo.get("SwapTotal", 0)
    swap_free = meminfo.get("SwapFree", 0)

    try:
        load = os.getloadavg()
    except OSError:
        load = (0.0, 0.0, 0.0)

    uptime_s = 0.0
    try:
        uptime_s = float(Path("/proc/uptime").read_text(encoding="ascii").split()[0])
    except (OSError, ValueError, IndexError):
        pass

    return {
        "temperature_c": temp_c,
        "throttle": _read_throttle_state(),
        "memory": {
            "total_mb": round(mem_total / 1024),
            "available_mb": round(mem_avail / 1024),
            "used_percent": round((1 - mem_avail / mem_total) * 100, 1) if mem_total else 0,
            "swap_total_mb": round(swap_total / 1024),
            "swap_used_percent": round((1 - swap_free / swap_total) * 100, 1) if swap_total else 0,
        },
        "load": {"avg_1m": round(load[0], 2), "avg_5m": round(load[1], 2),
                 "avg_15m": round(load[2], 2), "cores": os.cpu_count() or 0},
        "uptime_days": round(uptime_s / 86400, 1),
    }


# 5 s TTL: temperature moves fast during inference, and the reads are cheap —
# but with no cache at all, N open status tabs would stack vcgencmd calls.
_system_cache = _TTLCache(5.0)


@bp.route("/api/system")
def api_system():
    """Machine health for the status page (thermals are what silently ruin
    CPU inference on under-cooled or under-powered Pis)."""
    return jsonify(_system_cache.get(_compute_system_health))


@bp.route("/status")
def status_page():
    return render_template(
        "status.html",
        storage=get_storage_info(),
        content=get_content_stats(),
        services=check_all_services(),
        categories=CATEGORIES,
        recent=get_recent_downloads(),
        downloads=_downloads_cache.get(_compute_download_status),
        system=_system_cache.get(_compute_system_health),
    )
