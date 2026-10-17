# Troubleshooting

## No strip appears at all

In order:

1. **Is `dsh-permission-rules` installed and enabled?** This plugin only writes
   its rule file. Check with `dsh --profile web --dump-config` that the
   `permission-rules` row is present and not `disabled: true`.
2. **Did the plugin activate?** Start the profile and watch stderr. A failed
   row prints `always-allow (dsh-always-allow): Error: …`. A silent absence
   usually means the row is not in the composed config — check for
   `skipping profile bundle "dsh-always-allow"`.
3. **Is the pending tool one of `toolNames`?** Only `bash` and `pwsh` by
   default. Approving a `read` or an MCP tool will never show the strip.

## The strip says the approval already ended

The pending approval was answered (or the session moved on) between the render
and the click. Nothing was written; refusing here is intentional.

## The strip explains why there is no button

That is the refusals table in the README working as designed. `never`,
`compound`, `unsafe`, and `too-broad` all mean "a prefix from this command
would cover more than you approved". Approve one call at a time instead.

## A saved rule does not take effect

- **Wrong file.** The plugin writes `rulesFile` resolved against the *session
  workspace*. If your `permission-rules` row points somewhere else, the rule
  lands where nothing reads it. Both default to `.dsh/rules.yaml`.
- **A narrower rule wins first.** Rules evaluate first-match, and this plugin
  appends. Look for an earlier `deny` or `ask`.
- **The workspace differs.** A rule saved in one workspace does not apply to
  another directory.

## "the rule file uses flow-style `rules: [...]`"

The existing document is flow style. Convert it to block style:

```yaml
rules:
  - match: { tools: [bash], argv: { command: "ls" } }
    action: allow
    reason: "…"
```

## Every Tool call now fails with a rule-file error

That is `badFilePolicy: fail` doing its job: the rule document no longer
parses, so the engine refuses rather than silently allowing. Fix the YAML — or
delete the file to restore stock behaviour, then re-add rules.

## Requests are refused with 401 / "not authorized"

The `/always-allow` route applies the same admission as `/api`. A 401 means
the browser session is not authenticated for this host (an expired session, or
a request through a different origin). Reload the page using the tokenized URL
the CLI printed.
