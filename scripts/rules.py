#!/usr/bin/env python3
"""Inspect and prune always-allow rules in the workspace rule file.

    scripts/rules.sh list
    scripts/rules.sh prune --command aa1b2c3d
    scripts/rules.sh prune --plugin-saved
    scripts/rules.sh clear

A saved `allow` rule is *sticky*: once it exists, `dsh-permission-rules` stops
asking about that command, so an approval never appears again. That is the
feature working, but it makes a re-run of the approval test look broken — the
second run sees no panel at all.

Pruning is surgical, not a rewrite: rule blocks are split on their own top-level
`  - ` boundaries and only the matching blocks are dropped, so comments
elsewhere in the file survive. The file is parsed with PyYAML only to *identify*
which block to drop, never to re-serialize the document.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import yaml

# Every rule this plugin writes carries this phrase in its reason, which is how
# a plugin-authored rule is told apart from a hand-written one.
PLUGIN_REASON = "saved from the approval prompt"

ITEM = re.compile(r"^  - ", re.MULTILINE)


def default_rules_file() -> Path:
    """The rule file this plugin writes for the current workspace."""
    return Path.cwd() / ".dsh/rules.yaml"


def split_document(text: str) -> tuple[str, list[str]]:
    """Split a rules document into its preamble and one chunk per rule.

    @param text - current file contents.
    @returns the text before the first rule and the rule blocks themselves.
    """
    starts = [match.start() for match in ITEM.finditer(text)]
    if not starts:
        return text, []
    preamble = text[: starts[0]]
    blocks = []
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(text)
        blocks.append(text[start:end])
    return preamble, blocks


def parse_block(block: str) -> dict:
    """Parse one rule block, tolerating anything unexpected as an empty mapping."""
    try:
        parsed = yaml.safe_load(block)
    except yaml.YAMLError:
        return {}
    if isinstance(parsed, list) and parsed:
        first = parsed[0]
        return first if isinstance(first, dict) else {}
    return parsed if isinstance(parsed, dict) else {}


def argv_command(rule: dict) -> str | None:
    """The literal command word a rule matches on, when it has one."""
    match = rule.get("match")
    if not isinstance(match, dict):
        return None
    argv = match.get("argv")
    if not isinstance(argv, dict):
        return None
    command = argv.get("command")
    return command if isinstance(command, str) else None


def reason_of(rule: dict) -> str:
    reason = rule.get("reason")
    return reason if isinstance(reason, str) else ""


def describe(rule: dict) -> str:
    command = argv_command(rule)
    args = ((rule.get("match") or {}).get("argv") or {}).get("args")
    action = rule.get("action", "?")
    prefix = command or "(no command)"
    if isinstance(args, list) and args:
        prefix = f"{prefix} {' '.join(str(arg) for arg in args)}"
    origin = "plugin" if PLUGIN_REASON in reason_of(rule) else "hand-written"
    return f"{action:5} {prefix}  [{origin}]"


def prune(text: str, *, commands: set[str] | None = None,
          plugin_saved: bool = False) -> tuple[str, list[str]]:
    """Drop matching rule blocks and return the new document plus what went.

    @param text - current file contents.
    @param commands - command words whose rules are removed.
    @param plugin_saved - remove every rule this plugin wrote, regardless of command.
    @returns the rewritten document and a description of each removed rule.
    """
    preamble, blocks = split_document(text)
    kept: list[str] = []
    removed: list[str] = []
    for block in blocks:
        rule = parse_block(block)
        command = argv_command(rule)
        is_plugin = PLUGIN_REASON in reason_of(rule)
        drop = (plugin_saved and is_plugin) or (commands is not None and command in commands)
        if drop:
            removed.append(describe(rule))
        else:
            kept.append(block)

    if not removed:
        return text, []

    if not kept:
        # Keep a BLOCK-style empty list, not `rules: []`: the plugin fills an
        # empty block list in place and refuses a non-empty flow list, so a
        # pruned file must stay in the shape its own writer can extend.
        return "rules:\n", removed

    body = "".join(kept).rstrip() + "\n"
    head = preamble if preamble.strip() else "rules:\n"
    if not re.search(r"^rules:", head, re.MULTILINE):
        head = "rules:\n"
    return head + body, removed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", choices=["list", "prune", "clear"])
    parser.add_argument("--file", type=Path, default=None,
                        help="rule file (default: ./.dsh/rules.yaml)")
    parser.add_argument("--command", action="append", default=[],
                        help="command word whose rule is removed (repeatable)")
    parser.add_argument("--plugin-saved", action="store_true",
                        help="remove every rule this plugin wrote")
    args = parser.parse_args()

    path = args.file or default_rules_file()
    text = path.read_text() if path.exists() else ""

    if args.action == "list":
        _, blocks = split_document(text)
        if not blocks:
            print(f"no rules in {path}")
            return 0
        print(f"{len(blocks)} rule(s) in {path}")
        for block in blocks:
            print(f"  {describe(parse_block(block))}")
        return 0

    if args.action == "clear":
        removed = [describe(parse_block(block)) for block in split_document(text)[1]]
        if not removed:
            print(f"no rules in {path}; nothing to clear")
            return 0
        path.write_text("rules:\n")
        for line in removed:
            print(f"  removed {line}")
        print(f"cleared {len(removed)} rule(s) in {path}")
        return 0

    if not args.command and not args.plugin_saved:
        parser.error("prune needs --command or --plugin-saved")

    rewritten, removed = prune(text, commands=set(args.command) or None,
                               plugin_saved=args.plugin_saved)
    if not removed:
        print(f"nothing to prune in {path}")
        return 0
    path.write_text(rewritten)
    for line in removed:
        print(f"  removed {line}")
    print(f"pruned {len(removed)} rule(s) in {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
