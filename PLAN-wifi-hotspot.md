# PLAN-wifi-hotspot: Pi as a standalone Wi-Fi access point (grid-down mode)

**Rank: #3.**

## Goal

The entire product assumes a working LAN — but in the actual grid-down
scenario it is built for, there is no router. Today, if the power grid (and
thus the home Wi-Fi) is out, the 800 GB knowledge base is reachable only with
an HDMI monitor and keyboard plugged into the Pi.

After this change: `sudo bash scripts/hotspot.sh enable` turns the Pi into its
own Wi-Fi access point (SSID `SurviveV1`), phones/laptops join it directly,
and the dashboard is reachable at a stable, printed URL. `disable` returns to
normal client Wi-Fi. The install wizard offers it as an optional step, and the
dashboard's storage-banner area shows how to reach the device when in AP mode.

## Exact files to touch

| File | Change |
|------|--------|
| `scripts/hotspot.sh` | NEW — enable/disable/status via NetworkManager |
| `install/wizard.sh` | optional "grid-down hotspot" step after map region |
| `config/survive.conf` | `SURVIVE_HOTSPOT_SSID` / `SURVIVE_HOTSPOT_PASS` defaults |
| `docs/TROUBLESHOOTING.md` | hotspot section (recovery, IP, band notes) |
| `README.md` | one paragraph + the 10.42.0.1 URL in the access table |

## Implementation order

1. **`scripts/hotspot.sh`** (house style: `set -euo pipefail`, conf-sourcing
   header WITH the env-override capture pattern from
   `scripts/build_ebook_library.sh` — copy that exact block):
   - Subcommands: `enable`, `disable`, `status` (default `status`).
   - Preconditions for `enable`:
     - `command -v nmcli` — if absent, die with: "NetworkManager is required
       (Raspberry Pi OS Bookworm default). Older dhcpcd systems are not
       supported."
     - `[[ $EUID -eq 0 ]]` — die "run with sudo".
     - `nmcli radio wifi` must not be `disabled` → `nmcli radio wifi on`.
     - Regulatory domain: if `iw reg get 2>/dev/null | grep -q "country 00"`,
       warn that Wi-Fi country is unset (`sudo raspi-config nonint
       do_wifi_country US`) — AP mode on channel selection can fail without it.
   - `enable`:
     ```bash
     SSID="${SURVIVE_HOTSPOT_SSID:-SurviveV1}"
     PASS="${SURVIVE_HOTSPOT_PASS:-survive2026}"
     nmcli connection delete survive-hotspot 2>/dev/null || true
     nmcli connection add type wifi ifname wlan0 con-name survive-hotspot \
         autoconnect no ssid "$SSID" \
         802-11-wireless.mode ap 802-11-wireless.band bg \
         ipv4.method shared ipv6.method disabled \
         wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$PASS"
     nmcli connection up survive-hotspot
     ```
     `ipv4.method shared` makes NetworkManager run its own DHCP+NAT on
     10.42.0.0/24 — the Pi is always **10.42.0.1**. Print a boxed summary:
     SSID, password, and `http://10.42.0.1:8080` (+ the survive.local name,
     which also works via mDNS on the AP subnet).
   - `disable`: `nmcli connection down survive-hotspot` then
     `nmcli connection delete survive-hotspot`; print "rejoining known Wi-Fi
     networks (if any)".
   - `status`: `nmcli -t -f NAME,DEVICE,STATE connection show --active | grep
     survive-hotspot` → print AP active + client count via
     `iw dev wlan0 station dump | grep -c ^Station` (|| echo 0).
   - Password validation: WPA-PSK requires 8–63 chars — check and die early
     with a clear message, because nmcli's own error is cryptic.

2. **`install/wizard.sh`**: after the map-region step, add an optional
   `choose_hotspot()` — y/N prompt ("Enable grid-down Wi-Fi hotspot mode
   now?"), explaining that enabling it **disconnects the Pi from home Wi-Fi**
   (they coexist only with Ethernet for internet). If yes, prompt for
   SSID/password (defaults from above), write both into the generated
   `survive.conf`, and note in the summary screen. Do NOT auto-enable during
   install — downloads need internet; print the enable command in the final
   success screen instead.

3. **`config/survive.conf`**: add the two commented defaults.

4. **Docs**: TROUBLESHOOTING gains "Hotspot mode" covering: how to recover if
   you enabled AP over SSH-via-Wi-Fi and locked yourself out (plug in
   Ethernet, or the connection is `autoconnect no` so a **reboot** returns to
   normal Wi-Fi — this is a deliberate dead-man switch), why band `bg`
   (2.4 GHz reaches farther and every phone supports it), and the 10.42.0.1
   address.

## Edge cases a weaker model would miss

- **Enabling the AP kills your SSH session if you're connected over Wi-Fi** —
  wlan0 can't be client and AP at once. The script must detect
  `who am i`/`SSH_CONNECTION` + active wlan0 client connection and require a
  `--force` flag (or typed "yes") with a warning, exactly like the wizard's
  format guard. Ethernet SSH is unaffected.
- **`autoconnect no` is the dead-man switch**: if a user enables AP and walks
  away, a power cycle restores normal Wi-Fi. `autoconnect yes` would brick
  headless boxes into AP-only mode. If the user wants persistent AP mode,
  document `nmcli connection modify survive-hotspot connection.autoconnect
  yes` — an explicit, informed step.
- **Band `bg`, not `a`**: 5 GHz AP channels are region-locked and fail
  silently with `country 00`; 2.4 GHz works everywhere and penetrates walls —
  in a disaster that's the right trade.
- **`ipv6.method disabled`** avoids NM's shared-mode IPv6 RA quirks on
  Bookworm (spurious `activation failed` on some kernels).
- **ufw**: `setup/install.sh` opens 8080/80 etc. — those rules are
  interface-agnostic so AP clients pass; do NOT add interface-scoped rules.
- **rfkill**: fresh Pis with Wi-Fi country unset are soft-blocked
  (`rfkill list wifi`) — `nmcli radio wifi on` clears NM's block but not
  rfkill's; add `rfkill unblock wifi || true` before enabling.
- **The smoke-test/CI env has no NetworkManager** — every nmcli call sits
  behind the `command -v nmcli` guard; shellcheck must pass, and `status` on
  a NM-less box prints "NetworkManager not available" and exits 0 (it's used
  by `scripts/status.sh` later; non-zero would break `set -e` callers).

## Acceptance criteria

1. `bash -n scripts/hotspot.sh` and shellcheck (CI flags) pass.
2. On a machine without NetworkManager: `bash scripts/hotspot.sh status`
   exits 0 with the "not available" message; `enable` exits non-zero with the
   Bookworm message.
3. On a real Pi 5 (manual): `sudo bash scripts/hotspot.sh enable` → a phone
   sees SSID `SurviveV1`, joins with the password, loads
   `http://10.42.0.1:8080` AND `http://survive.local:8080`; `status` shows
   1 client; `disable` restores home Wi-Fi within ~15 s; after `enable` +
   reboot, the Pi is back on home Wi-Fi (dead-man switch verified).
4. Wizard run-through shows the new step, writes the two conf keys, and the
   success screen prints the enable command.
5. Password `short` is rejected with the 8-char message before any nmcli call.
