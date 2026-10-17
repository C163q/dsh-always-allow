#!/usr/bin/env python3
"""Drive one real escalation approval and report what the panel rendered.

    scripts/approval_test.sh [--keep-open] [--prompt TEXT]

The approval waterfall is only raised when a Tool asks for more authority than
the sandbox grants, so the prompt must request `sandbox_permissions`. A plain
read never reaches it, which is why a naive "run this command" test proves
nothing.

Exit codes: `0` the panel rendered with the three expected buttons, `1` the
panel is missing or wrong, `2` the run never reached an approval state.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from live import (  # noqa: E402
    COMPOSER,
    escalation_prompt,
    PANEL_BUTTON,
    PANEL_CARD,
    PANEL_ROOT,
    instance_url,
    launch_page,
    ok,
    fail,
)

# The three answers this plugin promises. The two stock ones must survive
# unchanged; the third is the feature.
EXPECTED = ("拒绝", "永久放行", "允许一次")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prompt", default=None,
                        help="prompt sent to the agent; defaults to a fresh escalation request")
    parser.add_argument("--timeout", type=float, default=180.0,
                        help="seconds to wait for the approval state")
    parser.add_argument("--shot", default=".tmp/approval.png",
                        help="screenshot written when the approval appears")
    parser.add_argument("--prune", action="store_true",
                        help="remove this plugin's saved rules first, so a re-run still raises an approval")
    parser.add_argument("--keep-open", action="store_true",
                        help="leave the page open so the panel can be inspected by hand")
    args = parser.parse_args()
    prompt = args.prompt or escalation_prompt()

    if args.prune:
        from rules import default_rules_file, prune

        existing = default_rules_file()
        if existing.exists():
            rewritten, removed = prune(existing.read_text(), plugin_saved=True)
            if removed:
                existing.write_text(rewritten)
                for line in removed:
                    print(f"pruned {line}")

    url = instance_url()
    shot = Path(args.shot)
    shot.parent.mkdir(parents=True, exist_ok=True)

    playwright, browser, page, errors = launch_page()
    try:
        page.goto(url, wait_until="networkidle", timeout=60_000)
        page.wait_for_selector(COMPOSER, timeout=60_000)
        page.wait_for_timeout(2_000)

        composer = page.locator(COMPOSER).first
        composer.click()
        composer.type(prompt)
        page.keyboard.press("Enter")

        deadline = args.timeout
        seen = False
        waited = 0.0
        while waited < deadline:
            page.wait_for_timeout(2_000)
            waited += 2.0
            # An approval takeover REPLACES the composer, so the disappearance
            # of the composer input is the reliable "an approval is pending"
            # signal. Sidebar text is not: a previous session's 待审批 badge
            # would match on a page that has no pending approval at all.
            if page.locator(COMPOSER).count() == 0 or page.locator(PANEL_CARD).count():
                seen = True
                # Let the panel finish its first proposal fetch.
                page.wait_for_timeout(2_500)
                break

        page.screenshot(path=str(shot))

        if not seen:
            fail(f"no approval state within {deadline}s — the prompt did not reach the "
                 "approval waterfall. The drawer must request sandbox_permissions.")
            return 2

        card = page.locator(PANEL_CARD).count()
        buttons = page.locator(PANEL_BUTTON).count()
        composer_left = page.locator(COMPOSER).count()

        if card == 0:
            print("the approval card did not render:")
            print(f"  {PANEL_ROOT}: {page.locator(PANEL_ROOT).count()}")
            print(f"  composer inputs: {composer_left} "
                  "(0 means the takeover produced an empty slot)")
            for line in errors[-8:]:
                print(f"  error: {line}")
            fail("the panel took over the composer but rendered nothing")
            return 1

        labels = [page.locator(PANEL_BUTTON).nth(index).inner_text().strip()
                  for index in range(buttons)]
        print("panel:", page.locator(PANEL_CARD).inner_text()[:300].replace("\n", " | "))
        print("buttons:", labels)

        missing = [label for label in EXPECTED
                   if not any(label in rendered for rendered in labels)]
        if missing:
            fail(f"missing buttons: {missing}")
            return 1

        ok("the approval panel renders reject / always-allow / allow-once")
        print(f"\nscreenshot: {shot}")
        if args.keep_open:
            print("page left open; press Ctrl-C to close")
            try:
                while True:
                    page.wait_for_timeout(5_000)
            except KeyboardInterrupt:
                pass
        return 0
    finally:
        browser.close()
        playwright.stop()


if __name__ == "__main__":
    sys.exit(main())
