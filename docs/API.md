# SurviveV1 Dashboard API

Base URL: `http://survive.local:8080`

All endpoints return JSON unless otherwise noted. No authentication required (local network only).

---

## GET /api/status

Returns system-wide status: storage usage, running services, content inventory.

```bash
curl http://localhost:8080/api/status
```

**Response:**
```json
{
  "storage": {
    "total_gb": 931.5,
    "used_gb": 423.1,
    "free_gb": 508.4,
    "percent": 45.4
  },
  "services": {
    "kiwix":   { "running": true,  "port": 8081 },
    "kolibri": { "running": true,  "port": 8082 },
    "calibre": { "running": false, "port": 8083 },
    "jellyfin":{ "running": true,  "port": 8096 },
    "maps":    { "running": true,  "port": 3000  },
    "ai":      { "running": true,  "port": 11434 }
  },
  "content": {
    "zim":    { "count": 12, "size_gb": 182.4, "exists": true },
    "videos": { "count": 2341, "size_gb": 148.2, "exists": true },
    "books":  { "count": 890, "size_gb": 18.4, "exists": true },
    "pdfs":   { "count": 234, "size_gb": 4.1, "exists": true },
    "maps":   { "count": 3, "size_gb": 72.1, "exists": true }
  },
  "timestamp": "2025-04-01T14:32:01.123456"
}
```

---

## GET /api/recent

Returns the 20 most recently modified content files.

```bash
curl http://localhost:8080/api/recent
```

**Response:**
```json
[
  {
    "name": "wikipedia_en_all_maxi_2024-01.zim",
    "path": "zim/wikipedia/wikipedia_en_all_maxi_2024-01.zim",
    "size_mb": 98304.0,
    "modified": "2025-03-28T09:12:44"
  }
]
```

---

## POST /api/ai/chat

Sends a message to the local Ollama AI assistant. The question first full-text
searches the local Kiwix library; the top article excerpts are injected into
the model's system prompt (retrieval-augmented generation) and returned as a
`sources` list. The completion is **streamed** as newline-delimited JSON
(`Content-Type: application/x-ndjson`).

```bash
curl -N -X POST http://localhost:8080/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "How do I purify water?", "model": "survive"}'
```

**Request body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | yes | User's question (truncated to 4096 chars) |
| `model` | string | no | Ollama model name (default: `survive`) |
| `history` | array | no | Prior turns `[{"role": "user"\|"assistant", "content": "..."}]` for multi-turn context. Only `user`/`assistant` roles are accepted (400 otherwise); the server keeps at most the last 8 turns / ~3000 chars. |

**Response (success) — one JSON object per line, in order:**
```
{"sources": [{"title": "Water purification", "url": "http://survive.local:8081/viewer#..."}]}
{"delta": "To purify "}
{"delta": "water, boil it..."}
{"done": true, "model": "survive"}
```
- `sources` is always the first line (may be an empty array if nothing matched).
- `delta` lines carry incremental token text; concatenate them for the answer.
- A mid-stream failure is emitted as a `{"error": "..."}` line.

**Pre-stream errors** keep real HTTP status codes with a JSON body (the stream
has not started yet):
| Status | Cause |
|--------|-------|
| 400 | Missing `message` |
| 415 | `Content-Type` is not `application/json` |
| 429 | Rate limit (5/min) exceeded |
| 502 | Ollama unreachable |

```json
{"error": "AI service unavailable"}
```

> Note: with streaming, `SURVIVE_AI_CHAT_TIMEOUT` is an *idle* timeout between
> chunks, not a cap on total answer length — long answers are no longer truncated.

---

## GET /api/downloads

Per-category content-download progress, assembled from `.download_progress`,
content sizes, and the newest `.logs/*.log` tail.

```bash
curl http://localhost:8080/api/downloads
```

**Response:**
```json
{
  "categories": [
    {"id": "kiwix", "name": "Wikipedia & ZIM", "budget_gb": 190,
     "size_gb": 182.4, "status": "complete"}
  ],
  "active_log": {"file": "kiwix.log", "line": "[DL] downloading wikipedia_en... 42%"},
  "complete": 1,
  "total": 7
}
```
`status` is one of `complete` (recorded in `.download_progress`),
`in_progress` (its content dir has grown), or `pending`.

---

## GET /api/system

Machine health (cached 5 s): CPU temperature, Pi firmware throttle state
(current + since-boot sticky bits), RAM/swap via MemAvailable, load average,
uptime. All fields degrade to zeros/False on non-Pi hardware.

```bash
curl http://localhost:8080/api/system
```

**Response:**
```json
{
  "temperature_c": 52.1,
  "throttle": {"undervoltage": false, "capped": false, "throttled": false,
               "soft_temp_limit": false, "occurred_since_boot": false, "raw": "0x0"},
  "memory": {"total_mb": 16384, "available_mb": 12100, "used_percent": 26.1,
             "swap_total_mb": 512, "swap_used_percent": 0.0},
  "load": {"avg_1m": 0.42, "avg_5m": 0.31, "avg_15m": 0.25, "cores": 4},
  "uptime_days": 3.2
}
```

---

## GET /api/connectivity

Server-side internet reachability check (the Pi's own connectivity, cached 30 s).

```bash
curl http://localhost:8080/api/connectivity
```

**Response:** `{"online": true}`

---

## POST /api/update/start

Launch a background "safe refresh" of all local content
(`scripts/update_content.sh`): new videos, books, PDFs, newly-added or
missing Kiwix ZIMs, and AI model updates. Existing large ZIM builds are
never replaced. Requires `Content-Type: application/json` (415 otherwise);
409 if an update is already running; 503 if the Pi is offline.
Rate-limited to 3/min.

```bash
curl -X POST http://localhost:8080/api/update/start \
  -H "Content-Type: application/json" -d '{}'
```

**Response:** `202 {"started": true, "pid": 12345}`

---

## GET /api/update/status

State of the current/last update run, reconstructed from on-disk artifacts
(log + pid file), so it survives dashboard restarts.

```bash
curl http://localhost:8080/api/update/status
```

**Response:**

```json
{
  "running": false,
  "started": "2026-08-17T10:00:00",
  "exit_code": 0,
  "log_tail": ["[UPDATE] Content update complete"]
}
```

`exit_code` is `null` while running or before any run; the log lives at
`$STORAGE/.logs/update_content.log`.

---

## GET /search

Search for files by name. Returns HTML page.

```
GET /search?q=water+purification
```

| Parameter | Description |
|-----------|-------------|
| `q` | Search query (2–200 characters) |

Returns HTML with matching files from `/mnt/survive`.

---

## GET /serve/&lt;path&gt;

Serve a file from storage directly.

```bash
curl http://localhost:8080/serve/pdfs/military_manuals/FM21-76_Army_Survival_Manual.pdf \
  -o FM21-76.pdf
```

- Path is relative to `SURVIVE_STORAGE_PATH`
- Path traversal is blocked (403 if path escapes storage root)
- Returns 404 if file not found

---

## GET /category/&lt;id&gt;

Returns an HTML page listing all files in a content category.

Available category IDs: `medical`, `food`, `shelter`, `energy`, `skills`, `communication`, `security`, `maps`, `reference`, `videos`, and more — see `web/server.py` `CATEGORIES` list.

---

## GET /files

Browse the file system interactively.

```
GET /files?path=pdfs/military_manuals
```

| Parameter | Description |
|-----------|-------------|
| `path` | Relative path within storage (optional, default: root) |

Returns HTML directory listing.

---

## Service Ports

| Service | Port | URL |
|---------|------|-----|
| Dashboard | 8080 | http://survive.local:8080 |
| Kiwix (Wikipedia) | 8081 | http://survive.local:8081 |
| Kolibri (Khan Academy) | 8082 | http://survive.local:8082 |
| Calibre-Web (E-books) | 8083 | http://survive.local:8083 |
| Jellyfin (Videos) | 8096 | http://survive.local:8096 |
| Martin (Maps) | 3000 | http://survive.local:3000 |
| Ollama (AI) | 11434 | http://survive.local:11434 |

---

## Configuration

Timeouts and other API behaviour can be tuned via environment variables (or `config/survive.conf`):

| Variable | Default | Description |
|----------|---------|-------------|
| `SURVIVE_SERVICE_CHECK_TIMEOUT` | `1` | Seconds to wait when testing service ports |
| `SURVIVE_OLLAMA_LIST_TIMEOUT` | `2` | Seconds to wait for Ollama model list |
| `SURVIVE_AI_CHAT_TIMEOUT` | `60` | Seconds to wait for AI chat completion |
| `SURVIVE_STORAGE_PATH` | `/mnt/survive` | Root of content storage |
