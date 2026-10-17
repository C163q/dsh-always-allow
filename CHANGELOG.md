# Changelog

## v0.1.0

### Added

- Approval strip offering **"Always allow `<prefix>`"** for pending shell Tool
  approvals, rendered in `conversation.input.dock` with `zh`/`en` copy.
- Prefix derivation (`src/prefix.js`): one command word, plus exactly one
  literal subcommand when the command's meaning lives in its first argument.
  Refusals carry a stable code (`empty`, `unsafe`, `compound`, `too-broad`,
  `never`) so the strip can explain a missing button.
- Atomic, serialized append into the workspace rule file read by
  `dsh-permission-rules` (`src/rules-file.js`, `src/index.js`).
- Plugin-owned `/always-allow` route on `ctx.webServer`, admitted through the
  Connection trust check (`src/index.js`).
- Config: `rulesFile`, `toolNames`, `maxTracked`, validated at mount
  (`src/config.js`).
- `node:test` suites for prefix derivation, rule rendering, endpoints, config,
  and a real-Cordis integration test covering mount, event tracking, both
  endpoints, authentication, method handling, and config failure.

### Notes

- The plugin never answers an approval and never evaluates a rule: it returns
  the neutral `{kind: 'allow'}` passthrough so `dsh-permission-rules` remains
  the only authority.
- The route is registered on this plugin's own `ctx.webServer` rather than
  through `connection.rpc.handle()`. `HostConnectionService` binds its routes on
  the provider's context, which does not declare `webServer`, so the generic
  channel fails activation with `cannot get property "webServer" without inject`
  for every consumer plugin.
