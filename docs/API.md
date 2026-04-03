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

Sends a message to the local Ollama AI assistant.

```bash
curl -X POST http://localhost:8080/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "How do I purify water?", "model": "tinyllama"}'
```

**Request body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | yes | User's question |
| `model` | string | no | Ollama model name (default: `tinyllama`) |

**Response (success):**
```json
{
  "response": "To purify water in a survival situation...",
  "model": "tinyllama"
}
```

**Response (error):**
```json
{
  "error": "Connection refused"
}
```
HTTP status 500 on AI error.

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
