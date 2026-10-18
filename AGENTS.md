# AGENTS.md

These instructions apply to this repository and its subdirectories. `dsh-always-allow` is a standalone DeepSeek Harness plugin, primarily used through the browser UI launched with `pnpm dsh web`.

## Read first

- [README.md](README.md): installation, configuration, authorization scope, revocation, and [file responsibilities](README.md#file-responsibilities).
- [docs/rules-format.md](docs/rules-format.md): semantics of the rules this plugin generates.
- [docs/PITFALLS.md](docs/PITFALLS.md): historical Cordis and Web integration pitfalls; source code and README define current behavior.
- [docs/verification/](docs/verification/): dated verification records. Historical passing results do not verify current changes.

## Required security invariants

- Ordinary `tools/pre-execute` decisions and sandbox escalation inside a tool are separate questions. Call `next()` when delegating a waterfall; never replace downstream policy with an unconditional allow.
- Automatic approval applies only to explicitly authorized `danger-full-access` prefixes. Legacy allow rules, workspace tags, and readable grant ids cannot create host authorization by themselves.
- Use the public permission-rules compiler and matcher with current source bytes and configuration. Do not implement a simplified matcher or rely on optional audit events or potentially stale compilation caches.
- The overall policy's first match must allow execution. A matching explicit grant rule and an exact host authorization record are also required. A later grant cannot override an initial deny/ask.
- Grants bind the workspace, rules file, tool, complete prefix, and target permission. The host ledger at `$DSH_HOME/always-allow/grants.json` must remain outside model-writable locations, including workspaces, OS temporary roots, and their symlink aliases. Custom executors and multiple workspaces must preserve this condition too.
- Approval must belong to the current live agent/session/tool/call. A callId is not globally unique; overlapping duplicate ids must remain quarantined until their associated executions finish. Finished, cancelled, or ineligible calls must not save grants.
- Both propose and save require Connection admission. Missing admission services, rule engines, or valid policy must prevent saving while preserving the human approval path.
- Validate the approval token, current command, and approval lifetime when saving, and recheck before atomic commit. Preserve comments and rule order through the YAML AST, reject unsupported or invalid documents, and avoid overwriting concurrent edits.
- Match executable paths by their complete literal spelling. Do not reduce them to basenames or automatically merge equivalent paths. Check excluded commands and mandatory subcommands by basename so path spellings cannot bypass those restrictions.
- The permanent-approval button for an executable path and its risk explanation must share a yellow frame. Explain file replacement, symlink redirection, execution directory, and later argument risks. Path saves require `allowExecutablePath: true`; host escalation still requires explicit `allowHost: true`.
- Prefix authorization does not pin executable contents or guarantee harmless later arguments. Do not promise either property in documentation or UI copy.

## Development and verification

Keep ESM and the existing function-plugin exports. Avoid adding default exports, inject declarations, or slots without checking their effects on Loader and client composition. Registrations must be cleaned up when the plugin unloads. Verify scope and listener-order changes through the real Cordis call chain.

For code or permission-behavior changes, reproduce the issue and add an effective regression test before changing the implementation. Run:

```sh
npm test
npm run check
```

Syntax-check changed Python scripts. For approval UI, scoping, listener order, or end-to-end authorization changes, follow README to run `scripts/boot.py` and `scripts/verify_flow.py` with an isolated DSH_HOME; add `--executable-path` for the path flow. These checks require Python Playwright, Chromium, and zstd. Use `DSH_HARNESS`, `DSH_PROFILE`, and `PLAYWRIGHT_CHROMIUM` to select the test environment.

Real messages invoke the currently configured model. Use probes that only print markers, and check `approval/asked`, `approval/decided`, `tool/result`, and `turn/end`; a disappearing card alone does not establish successful automatic approval. Retain screenshots and inspect warnings and layout. Use test services you started and clean up their processes after verification.

For documentation-only changes or file reorganization, check references and `git diff --check`; do not repeat model calls or the entire browser suite. Run `npm pack --dry-run` when changing package entry points or file inclusion. Report only checks actually performed.

## Documentation and local data

Maintain file responsibilities in README only; do not duplicate that inventory here. Update README, relevant rule documentation, and CHANGELOG when behavior changes. Store verification records in `docs/verification/` and designs/plans in `docs/superpowers/`. Keep local screenshots, session reports, and probes in `.tmp/`. Never commit authentication tokens, credentials, host authorization records, or test profiles.

The user's daily profile, isolated test profiles, harness source, and permission-rules source are separate locations. Do not write test settings into the user's daily configuration. Keep cross-repository work within the current task's authorization and read the target repository's AGENTS.md before editing it. Never weaken authorization checks or silently prune existing user rules to make tests pass.
