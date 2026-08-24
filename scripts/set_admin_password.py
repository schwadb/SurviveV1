#!/usr/bin/env python3
"""Set (or change) the SurviveV1 dashboard admin password.

Standalone by design — does NOT import web/server.py (which starts background
threads on import). Writes a werkzeug password hash to config/.admin_password
with 0600 permissions; the dashboard reads it (TTL-cached) with no restart
needed.

    python3 scripts/set_admin_password.py
    python3 scripts/set_admin_password.py --file /custom/path
"""
import argparse
import getpass
import os
import sys
from pathlib import Path

try:
    from werkzeug.security import generate_password_hash
except ImportError:
    sys.exit("werkzeug is required (it ships with Flask): pip install werkzeug")

REPO_DIR = Path(__file__).resolve().parent.parent
DEFAULT_FILE = REPO_DIR / "config" / ".admin_password"


def main() -> int:
    parser = argparse.ArgumentParser(description="Set the dashboard admin password.")
    parser.add_argument("--file", default=os.environ.get(
        "SURVIVE_ADMIN_PASSWORD_FILE", str(DEFAULT_FILE)))
    args = parser.parse_args()
    dest = Path(args.file)

    pw1 = getpass.getpass("New admin password: ")
    if len(pw1) < 8:
        print("Password must be at least 8 characters.", file=sys.stderr)
        return 1
    pw2 = getpass.getpass("Confirm password: ")
    if pw1 != pw2:
        print("Passwords do not match.", file=sys.stderr)
        return 1

    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(generate_password_hash(pw1), encoding="utf-8")
    dest.chmod(0o600)
    print(f"Admin password set ({dest}). Guests stay read-only; "
          f"log in at /login to manage the device.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
