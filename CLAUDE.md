# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Offline-first survival knowledge base for Raspberry Pi 5 + Hailo-8L AI Hat. Flask dashboard at `:8080` aggregates six backend services and provides search, file browsing, and an AI chat interface over ~800 GB of curated content stored on a USB SSD at `/mnt/survive`.

**Critical hardware constraint:** The Hailo-8L NPU (13 TOPS) is a vision accelerator — it **cannot** accelerate Ollama LLMs. All LLM inference is CPU-only. The Hailo-10H (AI HAT+) would support LLM offload but is not the target hardware here. Model size limits by RAM: 4 GB Pi → up to ~3B params; 8 GB Pi → up to ~7B params.

---

## Commands

### Lint and test

```bash
# Shell scripts
shellcheck --severity=warning --exclude=SC1090,SC1091 --shell=bash \
  $(find . -name "*.sh" ! -path "./.git/*")

# Python
pylint web/server.py \
  --disable=C0114,C0115,C0116 \
  --disable=R0903,R0913,R0914 \
  --fail-under=7.0

# Smoke tests (starts server on :18080, runs 16 assertions, tears down)
SURVIVE_STORAGE_PATH=/tmp/survive_test bash tests/test_smoke.sh
```

### Run the dashboard locally

```bash
pip install -r requirements.txt

# Dev server (single-threaded Flask)
PORT=8080 SURVIVE_STORAGE_PATH=/tmp/survive_test python3 web/server.py

# Production (gunicorn, 2 workers — same as systemd unit)
cd web && gunicorn --bind 0.0.0.0:8080 --workers 2 --timeout 120 server:app
```

### Content and AI

```bash
bash download/download_all.sh          # download all content (takes days)
bash ai/setup_ollama.sh                # install Ollama, pull RAM-appropriate models
bash ai/query.sh "How do I purify water?"   # CLI query
bash ai/query.sh --model phi3:mini "..."    # explicit model
bash ai/query.sh --interactive              # open chat session
```

### Services

```bash
bash scripts/start_services.sh   # start all services, health-checks dashboard
bash scripts/stop_services.sh    # stop all
bash scripts/status.sh           # show running/stopped state
bash scripts/update_content.sh   # re-run download scripts for newer versions
```

---

## Architecture

### Web server (`web/server.py`)

Single-file Flask app. All port constants and the `SERVICES` registry live in `web/constants.py` — **never hardcode ports**. The `_inject_globals()` context processor makes every port constant available in every Jinja template automatically.

Key patterns:

- **Path traversal guard:** both `/serve/<path>` and `/files?path=` use `Path.resolve().relative_to(storage_root)`. Symlinks that escape storage are caught because `resolve()` follows them before the check.
- **`_safe_walk(root)`:** `os.walk(followlinks=False)` + hidden-dir pruning. Use this instead of `Path.rglob()` everywhere to prevent symlink loops on user-supplied storage.
- **TTL caches:** `get_content_stats()` and `get_recent_downloads()` wrap expensive storage walks with a 60-second cache (`_content_stats_cache`, `_recent_cache`). Update `_CACHE_TTL` if tuning.
- **Concurrent service checks:** `check_all_services()` uses `ThreadPoolExecutor` to probe all six backend ports in parallel. Page load cost = one `TIMEOUT_SERVICE_CHECK` period (~1 s), not N × 1 s.
- **Rate limiting:** Flask-Limiter at 120/min default, 30/min on `/search`, 5/min on `/api/ai/chat`.
- **CSRF:** Flask-WTF `CSRFProtect` on HTML form POSTs; `/api/ai/chat` is `@csrf.exempt` but enforces `Content-Type: application/json` (browsers cannot send that cross-origin without a CORS preflight).

Environment variables the server reads at startup (all have defaults):

| Var | Default | Effect |
|-----|---------|--------|
| `SURVIVE_STORAGE_PATH` | `/mnt/survive` | Root for all content; falls back to `repo/data` if missing |
| `PORT` | `8080` | Listen port |
| `SECRET_KEY` | auto-generated | Flask session key (persisted to `config/.secret_key`) |
| `SURVIVE_SERVICE_CHECK_TIMEOUT` | `1` | TCP probe timeout (s) |
| `SURVIVE_OLLAMA_LIST_TIMEOUT` | `2` | Ollama model-list fetch timeout (s) |
| `SURVIVE_AI_CHAT_TIMEOUT` | `60` | AI chat completion timeout (s) |

### Configuration (`config/survive.conf`)

Bash-sourced by every shell script. Standard pattern at the top of each script:

```bash
_CONF="$REPO_DIR/config/survive.conf"
if [[ ! -f "$_CONF" ]]; then echo "[WARN] Config not found at $_CONF -- using defaults" >&2
else source "$_CONF"; fi
```

`SURVIVE_STORAGE_PATH` in this file drives every script's path resolution. `SURVIVE_AI_MODEL` sets the default Ollama model name (default: `survive`, the custom Modelfile-derived model).

### Storage layout

All content under `$SURVIVE_STORAGE_PATH` (`/mnt/survive` by default):

```
/mnt/survive/
├── zim/                  # Kiwix ZIM archives (Wikipedia, Stack Exchange, etc.)
├── videos/<category>/    # yt-dlp downloads
├── books/<category>/     # EPUB files
├── pdfs/<category>/      # PDF files
├── maps/                 # Martin tile server files + martin_config.yaml
├── ai_models/ollama/     # Ollama model blobs (OLLAMA_MODELS env var)
├── kolibri/              # Kolibri app data (KOLIBRI_HOME env var)
├── .kiwix_library.xml    # Kiwix library index (auto-generated)
└── .logs/                # Per-script download logs and yt-dlp archives
```

### AI model (`ai/Modelfile.survival`)

Defines the `survive` Ollama model. Built from `llama3.2:1b` with a large survival-domain system prompt. `num_ctx 2048` is intentionally conservative — raising it above 2048 will OOM a 4 GB Pi when other services are loaded. To change the base model, edit the `FROM` line and re-run `bash ai/setup_ollama.sh`.

`ai/setup_ollama.sh pull_models` gates model downloads by detected RAM:
- Any RAM: `tinyllama`, `llama3.2:1b`
- ≥6 GB: `phi3:mini`, `llama3.2:3b`
- ≥8 GB + ≥10 GB free disk: `mistral:7b-q4_0`

### Systemd (`systemd/*.service`)

Production deployment runs gunicorn under `User=pi` at `/opt/survive`. Path `/opt/survive/web` with venv at `/opt/survive/venv`. `ExecStartPost` polls `/health` to confirm readiness before systemd marks the unit active. Use `scripts/generate_services.sh` to rewrite the service files after changing `SURVIVE_STORAGE_PATH`.

### Templates (`web/templates/`)

All templates extend `base.html`. The nav bar in `base.html` uses `PORT_KIWIX`, `PORT_KOLIBRI`, etc. injected by `_inject_globals()`. A sticky amber banner is shown automatically when `storage_mounted` is `False` (injected alongside the port constants).

### CI (`.github/workflows/test.yml`)

Three jobs: `shellcheck` (all `*.sh`), `python` (pylint + smoke tests), `validate-configs` (nginx + YAML). ShellCheck excludes `SC1090`/`SC1091` — dynamic `source "$_CONF"` is intentional. Pylint threshold is 7.0 with docstring and naming rules disabled.
