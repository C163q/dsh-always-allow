#!/usr/bin/env python3
"""Report the live state that decides whether this plugin works at all.

    scripts/probe.sh [--running]

Prints the three things that silently disabled it before, so a regression is one
command away instead of an afternoon:

  1. profile enablement — the bundle list, and the market plugin's own disabled
     list (the UI switch writes THERE, not to `cordis.patch.yml`);
  2. host route — `401` proves a live route; `405`/`404` means the SPA fallback
     answered, so the route is absent;
  3. browser half — whether the package appears in `__DSH_BOOT__`.

Any of the three failing produces the same user-visible symptom — no approval
panel — which is why they are reported together.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from live import (  # noqa: E402
    PROFILE,
    boot_entries,
    fetch_index,
    free_port,
    load_state,
    ok,
    probe_route,
    start_instance,
    stop_instance,
)

PACKAGE = "dsh-always-allow"
PROFILE_DIR = Path(os.environ.get("DSH_HOME", str(Path.home() / ".dsh"))) / "profiles" / PROFILE


def check_enablement() -> bool:
    """Report the two places that decide whether the row is active."""
    healthy = True

    manifest = PROFILE_DIR / "package.json"
    if manifest.exists():
        parsed = json.loads(manifest.read_text())
        bundles = parsed.get("dsh", {}).get("profile", {}).get("bundles", [])
        if PACKAGE in bundles:
            ok(f"{PACKAGE} is in dsh.profile.bundles")
        else:
            print(f"FAIL: {PACKAGE} is NOT in dsh.profile.bundles — its bundle patch "
                  "is never read, so neither half loads.")
            healthy = False
    else:
        print(f"note: no profile manifest at {manifest}")

    market = PROFILE_DIR / ".dsh-market/state.json"
    if market.exists():
        disabled = json.loads(market.read_text()).get("disabled", [])
        if PACKAGE in disabled:
            print(f"FAIL: the market plugin lists {PACKAGE} as disabled "
                  f"({market}). The Settings switch writes here, NOT to "
                  "cordis.patch.yml, so dump-config can look enabled while the "
                  "row is inactive at runtime.")
            healthy = False
        else:
            ok("not disabled by the market plugin")
    return healthy


def check_live(state: dict | None) -> bool:
    spawned = state is None
    if spawned:
        port = free_port()
        print(f"starting a throwaway instance on port {port} to inspect the route")
        state = start_instance(port)
    try:
        status = probe_route(state["port"])
        if status != 401:
            print(f"FAIL: /always-allow/propose answered {status}. The SPA fallback "
                  "answers unmatched requests with 405/404, so this means the route "
                  "is absent — check the startup log for a pending fiber.")
            return False
        ok("host route is live (401 at the authentication gate)")

        entries = boot_entries(fetch_index(state["port"], state["token"]))
        ids = [entry.get("id") for entry in entries]
        if PACKAGE not in ids:
            print(f"FAIL: {PACKAGE} is missing from __DSH_BOOT__ ({len(ids)} entries) — "
                  "the browser half did not compose.")
            return False
        ok(f"browser half composed ({len(ids)} entries)")
        return True
    finally:
        if spawned:
            stop_instance(state)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--running", action="store_true",
                        help="inspect the recorded instance instead of a throwaway one")
    args = parser.parse_args()

    healthy = check_enablement()
    state = None
    if args.running:
        try:
            state = load_state()
        except SystemExit:
            state = None
    healthy = check_live(state) and healthy

    print()
    print("all checks passed" if healthy else "at least one check failed — see FAIL lines above")
    return 0 if healthy else 1


if __name__ == "__main__":
    sys.exit(main())
