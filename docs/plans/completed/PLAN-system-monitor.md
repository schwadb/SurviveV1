# PLAN-system-monitor: CPU temp, throttling, and RAM on the dashboard

**Rank: #4.**

## Goal

CPU-only LLM inference pins all four Pi 5 cores for minutes; under-cooled or
under-powered Pis then **thermal-throttle or brown-out**, which users
experience as "the AI got slow / the Pi rebooted" with no visible cause. The
dashboard shows disk and services but nothing about the machine itself.

After this change: `/api/system` reports CPU temperature, throttle state
(including the sticky "has throttled since boot" bits), load average, RAM and
swap usage, and uptime. The status page gets a System Health card, and a red
banner appears when the Pi is currently throttled or under-voltage — the two
conditions that silently ruin the AI experience.

## Exact files to touch

| File | Change |
|------|--------|
| `web/server.py` | `_compute_system_health()` + `/api/system` route (TTL cache 5 s) |
| `web/templates/status.html` | System Health card + include in the 15 s poller |
| `web/templates/base.html` | small warning strip when throttled (status page injects; keep base untouched if simpler — see step 4) |
| `tests/test_smoke.sh` | `/api/system` JSON assertion |
| `docs/API.md` | endpoint docs |

## Implementation order

1. **`_compute_system_health()` in server.py** — stdlib only, every source
   individually guarded so non-Pi/CI environments return zeros, never errors:
   - **Temperature**: read `/sys/class/thermal/thermal_zone0/temp`
     (millidegrees → `round(int(v)/1000, 1)`). This path exists on the Pi and
     most Linux VMs; on failure default `0.0`. Do NOT shell out to `vcgencmd`
     for temperature — the sysfs read is free and permissionless.
   - **Throttling**: `subprocess.run(["vcgencmd", "get_throttled"], ...)`,
     parse `throttled=0x50005`. Bit meanings (Raspberry Pi firmware):
     bit 0 under-voltage NOW, bit 1 freq-capped NOW, bit 2 throttled NOW,
     bit 3 soft temp limit NOW; bits 16–19 = same conditions since boot.
     Return `{"undervoltage": bool, "throttled": bool, "capped": bool,
     "occurred_since_boot": bool, "raw": "0x..."}`. If vcgencmd is missing
     (CI, non-Pi) → all False, raw None. Timeout 2 s.
   - **Memory**: parse `/proc/meminfo` — MemTotal, MemAvailable, SwapTotal,
     SwapFree → used percentages. MemAvailable (not MemFree) is the number
     that matters.
   - **Load**: `os.getloadavg()` 3-tuple + `os.cpu_count()`.
   - **Uptime**: first float of `/proc/uptime`, rendered as days/hours.
2. **Route**: `_system_cache = _TTLCache(5.0)`;
   `@app.route("/api/system")` → `jsonify(_system_cache.get(_compute_system_health))`.
3. **Status page card**: four stat tiles (Temp °C, Load / cores, RAM %,
   Swap %) + a throttle line. Color rules: temp ≥ 80 red (Pi 5 soft limit is
   85), ≥ 70 amber; RAM ≥ 90 % red. If `occurred_since_boot` but not current:
   amber note "throttling occurred earlier — check cooling/PSU".
4. **Warning banner**: render inside status.html only (skip base.html — a
   global banner needs the data on every route and this endpoint should stay
   off the hot path of every page load). The 15 s poller updates it.
5. **Poller**: add `/api/system` to the existing `Promise.all` in
   status.html's `refreshStatus()` and update tiles via `data-sys-*`
   attributes with `textContent`.

## Edge cases a weaker model would miss

- **`vcgencmd` needs the `video` group** on some setups; as User=pi under
  systemd it works, but under sudo-less shells it can fail with a permissions
  message **on stdout with exit 0** — treat unparseable output the same as
  missing binary (all-False), don't trust the exit code alone.
- **The throttle value is hex with a `throttled=` prefix** — parse with
  `int(value.split("=")[1], 16)`; a weaker model regexes for decimal and
  reports garbage.
- **Sticky vs current bits**: reporting only bit 2 misses the most useful
  signal — "it throttled during last night's model run" (bit 18) is exactly
  what a user debugging slow AI needs to see.
- **MemAvailable vs MemFree**: MemFree on Linux is always near zero (page
  cache); using it shows a perpetual fake OOM.
- **`os.getloadavg()` raises OSError on some containers** — guard it like the
  file reads (default `(0.0, 0.0, 0.0)`).
- **Cache TTL 5 s, not 60**: temperature during inference moves fast, and the
  sysfs/vcgencmd cost is microscopic; but no cache at all lets the 15 s×N-tabs
  poller stack subprocess calls.
- **The smoke-test env has none of the Pi interfaces** — the acceptance test
  asserts the endpoint returns valid JSON with the right KEYS, not values.

## Acceptance criteria

1. Smoke: `check_json "GET /api/system" "/api/system"` passes, and a grep
   asserts the body contains `"temperature_c"`, `"load"`, `"memory"`,
   `"throttle"`.
2. On CI/non-Pi: endpoint returns 200 with zeros/False — no 500, nothing in
   the error log.
3. On a real Pi (manual): tile shows a plausible temp (30–70 °C idle);
   `stress-ng --cpu 4` for 2 min raises the displayed temp on the next poll;
   pulling a marginal PSU trick (or `vcgencmd get_throttled` showing sticky
   bits) renders the amber "occurred earlier" note.
4. Status page tiles update in place every 15 s (watch temp change without
   reload).
5. pylint ≥ 9.5; all smoke tests green.
