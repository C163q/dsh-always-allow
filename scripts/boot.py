#!/usr/bin/env python3
"""Start a live `dsh web` instance and record it for the other scripts.

    scripts/boot.sh [--port N] [--patch FILE]...

Verifies, in order, that the two halves of the plugin actually mounted:

  * the host half answers `401` on `/always-allow/propose` — `401` is the only
    status that proves a live route, because the SPA fallback answers every
    unmatched request with `405`/`404`;
  * the browser half appears in `__DSH_BOOT__`, which the host composes only
    for entries whose fiber activated.

Both checks are necessary: a pending fiber produces neither, and it does so
without printing any error.
"""

from __future__ import annotations

import argparse
import sys

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))

from live import (  # noqa: E402
    boot_entries,
    fail,
    fetch_index,
    free_port,
    ok,
    probe_route,
    start_instance,
    stop_instance,
)

PACKAGE = "dsh-always-allow"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=None,
                        help="listen port (default: an unused one)")
    parser.add_argument("--patch", action="append", default=[],
                        help="extra patch overlay (repeatable); probes only")
    parser.add_argument("--keep", action="store_true",
                        help="leave a previously recorded instance running")
    args = parser.parse_args()

    port = args.port or free_port()
    extra = [part for patch in args.patch for part in ("--patch", patch)]

    print(f"starting dsh web on port {port} (profile from $DSH_PROFILE or 'web')")
    state = start_instance(port, extra)
    print(f"  url:   {state['url']}")
    print(f"  log:   {state['log']}")

    status = probe_route(port)
    if status != 401:
        stop_instance(state)
        fail(f"/always-allow/propose answered {status}, expected 401 — "
             "the host half did not register its route. Check the log; a declared "
             "Service that no row provides leaves the fiber pending with no error.")
    ok("host route is live (401 at the authentication gate)")

    entries = boot_entries(fetch_index(port, state["token"]))
    ids = [entry.get("id") for entry in entries]
    if PACKAGE not in ids:
        stop_instance(state)
        fail(f"{PACKAGE} is missing from __DSH_BOOT__ ({len(ids)} entries) — "
             "the browser half did not compose. A pending or inactive row produces this.")
    ok(f"browser half composed ({len(ids)} entries)")

    print("\ninstance ready. Next:")
    print("  scripts/approval_test.sh     drive a real escalation approval")
    print("  scripts/screenshot.sh        capture the current page")
    return 0


if __name__ == "__main__":
    sys.exit(main())
