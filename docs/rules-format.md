# The rule this plugin writes

`dsh-always-allow` writes into the rule file owned by
[`dsh-permission-rules`](https://github.com/PerryLink/dsh-permission-rules)
(see that package's `docs/rules-format.md` for the complete format). This page
documents only the subset the plugin produces and how to edit it afterwards.

## Shape

```yaml
rules:
  - match:
      tools: [bash, pwsh]
      argv:
        command: "git"
        args: ["status"]
    action: allow
    reason: "Always allow \"git status\" in this workspace (saved from the approval prompt)"
```

- `match.tools` — the `toolNames` config value at save time. A command is only
  matched for these Tools.
- `match.argv.command` — the literal command word.
- `match.argv.args` — **a prefix list**, not an exact list. `["status"]` matches
  `git status`, `git status -s`, and `git status --short`; it does not match
  `git push`.
- `action` — always `allow`. This plugin never writes `deny` or `ask`.
- `reason` — required by the engine. It reads well in the file and shows up in
  any UI that surfaces the matching rule.

## Why a prefix, and why appended

Rules evaluate **first match wins**. The plugin appends, so a narrower `deny`
or `ask` rule you wrote earlier — or that a previous version of this plugin
wrote — keeps winning:

```yaml
rules:
  - match:
      tools: [bash]
      argv: { command: "git", args: ["push"] }
    action: deny
    reason: "Never push from an agent session"

  # appended later by dsh-always-allow
  - match:
      tools: [bash]
      argv: { command: "git", args: ["status"] }
    action: allow
    reason: "Always allow \"git status\" …"
```

`git push` hits the deny; `git status` falls through to the allow.

## Adding a prefix by hand

Copy an existing entry and edit the words. Both fields accept the literal
command words the plugin would produce:

```yaml
  - match:
      tools: [bash, pwsh]
      argv: { command: "pnpm", args: ["test"] }
    action: allow
    reason: "Run tests without asking"
```

## Narrowing or revoking

Delete the entry (the engine reloads the file when `watch: true`, the default),
or add a narrower `deny` **above** it. Deleting the file entirely restores the
stock behaviour: every shell call asks again.

## What the file must not contain

The plugin only appends when the document has a block-style `rules:` key. A
flow-style `rules: [{ … }]` document is refused rather than rewritten, because
preserving its formatting generically is not worth the risk of corrupting an
allow list. Convert it to block style if you want the button to work.

`badFilePolicy: fail` (the recommended setting) means a file that no longer
parses makes the engine **refuse** Tool calls rather than fall back to
allowing them. Keep edits syntactically valid.
