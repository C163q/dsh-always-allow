#!/usr/bin/env python3
"""Capture the current page of the recorded instance.

    scripts/screenshot.sh [--out FILE] [--full] [--selector CSS]

Useful after `approval_test.sh --keep-open`, and for eyeballing any change that
only shows up in the browser.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from live import instance_url, launch_page  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=".tmp/shot.png")
    parser.add_argument("--full", action="store_true", help="capture the full page")
    parser.add_argument("--selector", default=None,
                        help="capture one element instead of the viewport")
    parser.add_argument("--settle", type=float, default=3.0,
                        help="seconds to wait before capturing")
    args = parser.parse_args()

    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)

    playwright, browser, page, errors = launch_page()
    try:
        page.goto(instance_url(), wait_until="networkidle", timeout=60_000)
        page.wait_for_timeout(int(args.settle * 1_000))
        if args.selector:
            page.locator(args.selector).first.screenshot(path=str(target))
        else:
            page.screenshot(path=str(target), full_page=args.full)
        print(f"wrote {target}")
        for line in errors[-5:]:
            print(f"  console: {line}")
        return 0
    finally:
        browser.close()
        playwright.stop()


if __name__ == "__main__":
    sys.exit(main())
