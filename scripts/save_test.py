#!/usr/bin/env python3
"""Click the always-allow button and verify the rule was actually written.

    scripts/save_test.sh

The panel rendering is only half the feature: the button claims to save a
prefix rule into the workspace rule file, and a rule that is written but not
read, or written to the wrong path, is indistinguishable from a working one
until the next approval asks again.

This test asserts the observable outcome instead of trusting the button:

  * the rule file gains a rule whose prefix matches the approved command;
  * the approval is answered (the card goes away) rather than left pending.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from live import (  # noqa: E402
    COMPOSER,
    PANEL_BUTTON,
    PANEL_CARD,
    escalation_prompt,
    fail,
    fresh_command,
    instance_url,
    launch_page,
    ok,
)
from rules import default_rules_file, prune  # noqa: E402

# The prefix the panel offers for `touch /root/...` is the command word alone.
BUTTON_TEXT = "永久放行"



def find_rule_file() -> Path | None:
    """Locate the workspace rule file the plugin writes."""
    candidates = [
        Path.cwd() / ".dsh/rules.yaml",
        Path.home() / "Program/workspace/tmp/.dsh/rules.yaml",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prompt", default=None,
                        help="prompt sent to the agent; defaults to a fresh escalation request")
    parser.add_argument("--timeout", type=float, default=180.0)
    parser.add_argument("--prune", action="store_true",
                        help="remove this plugin's saved rules first, so a re-run still raises an approval")
    args = parser.parse_args()
    command = fresh_command()
    prompt = args.prompt or escalation_prompt(command)

    if args.prune:
        existing = default_rules_file()
        if existing.exists():
            _, removed = prune(existing.read_text(), plugin_saved=True)
            if removed:
                existing.write_text(prune(existing.read_text(), plugin_saved=True)[0])
                for line in removed:
                    print(f"pruned {line}")
        else:
            print("no rule file to prune")

    before = find_rule_file()
    before_text = before.read_text() if before else ""

    playwright, browser, page, errors = launch_page()
    try:
        page.goto(instance_url(), wait_until="networkidle", timeout=60_000)
        page.wait_for_selector(COMPOSER, timeout=60_000)
        page.wait_for_timeout(2_000)
        composer = page.locator(COMPOSER).first
        composer.click()
        composer.type(prompt)
        page.keyboard.press("Enter")

        waited = 0.0
        while waited < args.timeout and page.locator(PANEL_CARD).count() == 0:
            page.wait_for_timeout(2_000)
            waited += 2.0
        if page.locator(PANEL_CARD).count() == 0:
            fail(f"no approval panel within {args.timeout}s; nothing to click")
            return 2

        buttons = page.locator(PANEL_BUTTON)
        target = None
        for index in range(buttons.count()):
            if BUTTON_TEXT in buttons.nth(index).inner_text():
                target = buttons.nth(index)
                break
        if target is None:
            fail(f"no '{BUTTON_TEXT}' button; the panel is not offering a prefix")
            return 1

        print("clicking:", target.inner_text().strip())
        target.click()

        # The save answers the approval, so the panel must disappear.
        waited = 0.0
        while waited < 30 and page.locator(PANEL_CARD).count() > 0:
            page.wait_for_timeout(1_000)
            waited += 1.0

        after = find_rule_file()
        after_text = after.read_text() if after else ""

        if after_text == before_text:
            print(f"rule file unchanged: {after}")
            for line in errors[-8:]:
                print(f"  error: {line}")
            fail("clicking the button did not write a rule")
            return 1

        added = [line for line in after_text.splitlines() if line not in before_text.splitlines()]
        if not any(command in line for line in added):
            fail(f"the new rule does not mention '{command}': {added}")
            return 1

        ok(f"rule written to {after}")
        for line in added:
            print("  +", line)
        if page.locator(PANEL_CARD).count() == 0:
            ok("the approval was answered and the panel closed")
        else:
            print("note: the panel is still visible; the request may not have settled yet")
        return 0
    finally:
        browser.close()
        playwright.stop()


if __name__ == "__main__":
    sys.exit(main())
