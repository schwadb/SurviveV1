# PLAN-wifi-hotspot: Wi-Fi access point + captive portal for grid-down access

**Rank: #3.**

## Goal

SurviveV1 assumes a working router: every access URL (`survive.local:8080`,
`192.168.x.x`) presumes the Pi and the user's phone share existing Wi-Fi
infrastructure. In the actual scenario the product is built for — grid down,
no router — **nothing can reach the device**. Every comparable project
(PrepperPi, Internet-in-a-Box, PrepperDisk) broadcasts its own network;
SurviveV1 does not. This is the largest remaining gap between "demo on my
desk" and "works in the field".

After this change: the Pi broadcasts a WPA2 network (default SSID `SURVIVE`),
hands out addresses, resolves **all** DNS names to itself, and answers the
OS captive-portal probes so phones automatically pop the "sign in to
network" sheet showing the dashboard. The hotspot auto-activates on boot
*only when no known Wi-Fi network is available* (home Wi-Fi wins), and a
toggle script switches it manually.

## Exact files to touch

| File | Change |
|------|--------|
| `scripts/hotspot.sh` | NEW — `on` / `off` / `status` / `install` subcommands |
| `config/survive.conf` + `config/survive.conf.example` | `SURVIVE_HOTSPOT_SSID`, `SURVIVE_HOTSPOT_PASS`, `SURVIVE_HOTSPOT_AUTO` |
| `config/nginx.conf` | captive-portal probe endpoints |
| `install/wizard.sh` | optional "enable hotspot" step after hostname selection |
| `docs/TROUBLESHOOTING.md` | hotspot section (regulatory domain, rfkill, band) |
| `CLAUDE.md` | document the hotspot commands |

## Implementation order

1. **Config defaults** in both conf files:
   ```bash
   SURVIVE_HOTSPOT_SSID="SURVIVE"
   SURVIVE_HOTSPOT_PASS="survive2026"   # WPA2 requires 8-63 chars
   SURVIVE_HOTSPOT_AUTO="Y"             # auto-fallback when no known Wi-Fi
   ```

2. **`scripts/hotspot.sh`** (house style: `set -euo pipefail`, source
   `survive.conf`, color helpers). Target **NetworkManager via `nmcli`** —
   Pi OS Bookworm's default network stack. Do NOT install hostapd/dnsmasq
   packages; NM runs its own dnsmasq for shared connections.

   `install` subcommand (idempotent — `nmcli con show survive-hotspot` first):
   ```bash
   rfkill unblock wifi
   # Wi-Fi is soft-blocked until a country is set on fresh installs:
   raspi-config nonint do_wifi_country "${SURVIVE_WIFI_COUNTRY:-US}" 2>/dev/null || true
   nmcli con add type wifi ifname wlan0 con-name survive-hotspot \
       autoconnect "${SURVIVE_HOTSPOT_AUTO:-Y}" ssid "$SURVIVE_HOTSPOT_SSID"
   nmcli con modify survive-hotspot \
       802-11-wireless.mode ap 802-11-wireless.band bg 802-11-wireless.channel 6 \
       ipv4.method shared ipv4.addresses 10.42.0.1/24 \
       wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$SURVIVE_HOTSPOT_PASS" \
       connection.autoconnect-priority -10
   ```
   Priority `-10` is the load-bearing detail: known infrastructure networks
   default to priority 0, so NM joins home Wi-Fi when present and falls back
   to broadcasting the hotspot when it is not — exactly the grid-down
   behavior wanted, with zero user action.

   Then write the wildcard-DNS drop-in (NM's shared-mode dnsmasq reads it):
   ```bash
   mkdir -p /etc/NetworkManager/dnsmasq-shared.d
   echo 'address=/#/10.42.0.1' > /etc/NetworkManager/dnsmasq-shared.d/survive-captive.conf
   ```

   `on` = `nmcli con up survive-hotspot`; `off` = `nmcli con down ...`;
   `status` = parse `nmcli -t -f NAME,DEVICE con show --active` plus
   `iw dev wlan0 station dump | grep -c Station` for client count.

3. **Uplink guard in `on`**: if the current default route uses wlan0
   (`ip -o route get 1.1.1.1 2>/dev/null | grep -q "dev wlan0"`), warn that
   activating the AP disconnects the Pi's own internet (mid-download!) and
   require `--force`. Ethernet uplinks are unaffected — `ipv4.method shared`
   even NATs hotspot clients out through eth0 as a bonus.

4. **`config/nginx.conf`** — captive-probe endpoints, added inside the
   existing `server` block *above* the `location /` proxy:
   ```nginx
   location = /generate_204        { return 302 http://10.42.0.1/; }  # Android
   location = /gen_204             { return 302 http://10.42.0.1/; }
   location = /hotspot-detect.html { return 302 http://10.42.0.1/; }  # iOS/macOS
   location = /connecttest.txt     { return 302 http://10.42.0.1/; }  # Windows
   location = /ncsi.txt            { return 302 http://10.42.0.1/; }
   location = /canonical.html      { return 302 http://10.42.0.1/; }  # Firefox
   location = /success.txt         { return 302 http://10.42.0.1/; }
   ```
   The wildcard DNS sends every probe host (connectivitycheck.gstatic.com,
   captive.apple.com, …) to nginx; the non-204/non-"Success" responses are
   what make each OS open its captive sheet with the dashboard in it.

5. **`install/wizard.sh`**: after the hostname step, one y/N question
   ("Broadcast a SURVIVE Wi-Fi network when no known Wi-Fi is available?").
   On yes: persist the three conf vars and call
   `bash "$REPO_DIR/scripts/hotspot.sh" install`. Follow the wizard's
   existing prompt/summary style; add the SSID/password to the final
   summary screen.

6. **Docs**: TROUBLESHOOTING gets: "hotspot invisible" → rfkill/country;
   "connected but no portal" → some Androids need opening any http:// URL
   once; "5 GHz" → deliberately unsupported (band bg chosen for phone
   compatibility and because 5 GHz AP requires regulatory config that varies
   by country).

## Edge cases a weaker model would miss

- **Bookworm ≠ Bullseye.** Pi OS Bookworm uses NetworkManager; Bullseye used
  dhcpcd, where none of the nmcli calls exist. Detect with
  `systemctl is-active NetworkManager` at the top of `hotspot.sh` and exit
  with a clear "requires Pi OS Bookworm" error otherwise — do not attempt a
  hostapd fallback path; two half-tested stacks are worse than one.
- **rfkill soft-block on fresh installs**: until a Wi-Fi country is set,
  `wlan0` is soft-blocked and `nmcli con up` fails with a misleading
  "device not ready". The `rfkill unblock wifi` + `do_wifi_country` pair in
  `install` is mandatory, and `do_wifi_country` needs root — the script
  should `[[ $EUID -eq 0 ]]` check like the wizard does.
- **The Pi cannot be AP and Wi-Fi client simultaneously** on the onboard
  radio. `con up survive-hotspot` silently disconnects any active Wi-Fi
  uplink — hence the `--force` guard in step 3. A weaker model will test on
  an ethernet-connected dev box and never notice.
- **WPA2 PSK length**: 8–63 characters, enforced by nmcli with an opaque
  error. Validate in the script and in the wizard prompt (re-ask on short
  input, same pattern as the wizard's other validations).
- **`address=/#/10.42.0.1` hijacks DNS for hotspot clients only** — the
  drop-in lives in `dnsmasq-shared.d`, which NM uses solely for
  `ipv4.method shared` interfaces. Do NOT put it in `/etc/dnsmasq.conf` or
  in `dnsmasq.d/` — that would poison DNS for the Pi itself and break
  downloads the next time internet exists.
- **iOS captive sheet is a pseudo-browser** (no tabs, ephemeral storage).
  The dashboard works, but localStorage-backed pages (inventory,
  checklists) silently lose data there. Add a one-line banner to the portal
  landing (index already has the offline banner area): "Tip: open
  http://10.42.0.1 in your real browser for full functionality."
- **Do not redirect to `survive.local`** in the nginx probe endpoints —
  mDNS does not work inside most captive sheets. The numeric
  `10.42.0.1` always resolves because it never resolves.
- **CI has no NetworkManager**: `hotspot.sh` must pass shellcheck but its
  functionality cannot run in CI — keep all nmcli calls behind subcommands
  (never at top level) so `bash -n` and shellcheck are the CI gate, and note
  the manual test matrix in the PR description instead.

## Acceptance criteria

1. `shellcheck --severity=warning --exclude=SC1090,SC1091 scripts/hotspot.sh`
   passes; `bash -n` passes.
2. On a Pi 5 (Bookworm): `sudo bash scripts/hotspot.sh install && sudo bash
   scripts/hotspot.sh on --force` → `nmcli -t -f NAME,DEVICE con show
   --active` lists `survive-hotspot:wlan0`.
3. A phone sees SSID `SURVIVE`, joins with the configured password, and the
   captive sheet opens showing the dashboard within ~5 s (test one Android
   and one iOS device).
4. From the connected phone: `http://anything.example` in a browser lands on
   the dashboard (wildcard DNS works); Wikipedia at
   `http://10.42.0.1/wiki/` loads.
5. With the home Wi-Fi in range and credentials known to NM, reboot → Pi
   joins home Wi-Fi (hotspot NOT active). Move out of range (or
   `nmcli con modify <home> connection.autoconnect no` to simulate), reboot →
   hotspot IS active. This validates the priority fallback.
6. `sudo bash scripts/hotspot.sh off` restores the previous Wi-Fi uplink
   within 30 s without a reboot.
