# Changelog

## v0.2.1 - 2026-10-18

### Fixed

- The panel silently offered two buttons where other approvals offer three. A
  refused proposal (`compound`, `never`, `too-broad`, …) renders no
  "allow forever" button, but the `blocked.<code>` sentence explaining WHY was
  reachable only from the save handler — whose button is the one not rendered,
  so it could never appear. The card now states the reason under the command.

## v0.2.0 - 2026-10-18

### Added

- `autoApproveEscalation` (default `false`). When enabled, a sandbox-escalation
  approval is answered from a saved `allow` rule covering the command, instead
  of asking again. A rule says "this command may run"; an escalation asks "may
  this call leave the sandbox" — a strictly stronger grant — so this is opt-in
  and documented as such. Requires `dsh-permission-rules`, whose COMPILED rules
  are read through its `permissionRulesRuntime` Service: no second rule engine,
  no second YAML parser, and the engine's own file watching and caching apply.

### Fixed

- The `tools/pre-execute` listener returned `{kind:'allow'}` instead of calling
  `next()`. In a waterfall that makes the decision FINAL, so every listener
  after this plugin — `permission-rules` included — was vetoed and its `deny`
  and `ask` decisions never happened. Ordinary approvals were unreachable while
  this plugin was mounted.
- The integration test asserted the broken behaviour (`ask` in, `allow` out), so
  the suite stayed green. It now asserts that a downstream `ask` and `deny`
  survive.

## v0.1.1

### Fixed

- The browser half never loaded. It took over `conversation.composer` but
  declared `conversation.approval.detail` as a child slot, which the stock
  approval entry already owns, so registration threw and the whole half failed.
  The command is now read from the Chat snapshot the way the shipped
  `ApprovalCommand` detail renderer does, so no child slot is claimed.
- The panel threw while rendering an approval that carried a `displayReason`,
  because `resolveReason` was missing from the injected face. `renderSlot` was
  also called without the children declaration that provides it. Both replaced:
  `resolveReason` is injected, and the command comes from `useChat`.
- The host half was permanently pending: `inject` declared `connection`, which
  the composing tree does not always provide before this row. Only `webServer`
  is declared now; the trust check reads `connection` lazily per request.
- The approval panel is now reached at all: it registers in
  `conversation.composer` at priority 0 and elects only while an approval is
  pending, instead of rendering a banner in `conversation.input.dock` that no
  approval ever showed.

### Added

- `scripts/` live verification: `check_all.sh`, `probe.sh`, `boot.sh`,
  `approval_test.sh`, `save_test.sh`, `screenshot.sh`. These drive a real
  `dsh web` in Chromium, because every failure above was invisible to unit
  tests.
- `docs/PITFALLS.md` records the Harness traps that fail silently.

## v0.1.0

### Added

- Approval panel offering **"Always allow `<prefix>`"** for pending shell Tool
  approvals, with `zh`/`en` copy.
- Prefix derivation (`src/prefix.js`): one command word, plus exactly one
  literal subcommand when the command's meaning lives in its first argument.
  Refusals carry a stable code (`empty`, `unsafe`, `compound`, `too-broad`,
  `never`) so the panel can explain a missing button.
- Rule append (`src/rules-file.js`) into the workspace rule file
  `dsh-permission-rules` already reads, preserving existing rules and comments.
- `/always-allow` host route (`propose`, `save`) behind the Connection trust
  check, with a bounded map of pending approvals.
