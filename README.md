# dsh-always-allow

Adds **Always allow `<command prefix>`** to DeepSeek Harness Web approvals. With explicit opt-in, a prefix saved during a `danger-full-access` approval can answer future matching sandbox requests automatically.

## Install and configure

Requires `dsh-permission-rules` 0.7.15 or compatible 0.7.x, installed and **enabled in the same profile**. Install this checkout with your usual CLI:

```sh
pnpm dsh plugin --profile web add /absolute/path/to/dsh-always-allow
```

Set both rows in `$DSH_HOME/profiles/web/cordis.patch.yml` (default DSH_HOME: `~/.dsh`). The row ids below are the bundle defaults:

```yaml
- id: permission-rules
  config:
    rulesFile: .dsh/rules.yaml
    badFilePolicy: fail
    patternMode: glob
    watch: true
    network:
      enabled: false
      injectEnv: false
  disabled: false
- id: always-allow
  config:
    rulesFile: .dsh/rules.yaml
    toolNames: [bash, pwsh]
    maxTracked: 128
    autoApproveEscalation: true
  disabled: false
```

`autoApproveEscalation` defaults to **false**. Enable it to use persistent sandbox approvals; the approval card then explains that saving grants the displayed prefix and later arguments `danger-full-access` in this workspace. Ordinary approvals saved outside an actual sandbox escalation create ordinary allow rules only.

Start with `pnpm dsh web`. If the profile uses dshmarket, also enable **both** plugins in its UI: the market's disabled list overrides an enabled YAML row. The example disables permission-rules' network proxy; this plugin never changes proxy environment variables.

| Option | Default | Meaning |
| --- | --- | --- |
| `rulesFile` | `.dsh/rules.yaml` | Relative to the requesting session workspace; must match permission-rules. Absolute paths are supported. |
| `toolNames` | `[bash, pwsh]` | Tools whose arguments include a `command` string. A saved rule applies only to the tool being approved. |
| `maxTracked` | `128` | Maximum calls eligible for the permanent-approval UI. Evicted calls still require human approval. |
| `autoApproveEscalation` | `false` | Permit new explicit grants to answer `danger-full-access` requests. Turning it off stops automatic escalation approvals. |

## Permission boundaries

There are two independent questions: the `tools/pre-execute` permission decision and the sandbox request raised inside the tool body. The plugin always delegates the first question. It answers the second only when all of these hold:

- A live, unambiguous invocation belongs to the same agent, session, tool, and call id, and its final pre-execute decision was allow.
- Its current command is a supported literal prefix, and its actual target and justification match the sandbox question.
- The first matching ordinary policy rule under the engine's current configuration is allow, and an explicit grant rule also matches. The plugin uses the engine's public compiler and matcher on current file bytes, preserving deny/ask precedence without relying on optional audit events or cached compilation.
- The rule references a matching authorization in the host ledger at `$DSH_HOME/always-allow/grants.json`. Each authorization binds the workspace, rules file, tool, prefix, and target mode.

The ledger must be outside the session workspace **and** OS temporary writable roots (`/tmp` and `os.tmpdir()`), including symlink aliases. A workspace rule cannot manufacture or widen a ledger record. Reading an authorization id does not grant permission to change its scope. Keep DSH_HOME outside every model-writable directory; custom executors or extra writable mounts must preserve this condition. The plugin cannot protect authorization from an already unrestricted host process or a user-approved command that can modify DSH_HOME.

**Legacy allow rules never gain host access automatically.** Existing `argv` rules are preserved, but require a new explicit click to obtain a host grant. The old `argv.args` format matches argument tokens anywhere; it is not a literal prefix. New rules constrain the raw command, its word boundary, and its character grammar.

Missing dependencies, disabled enforcement, malformed rules, revoked rules, changed commands, cancelled/finished approvals, and overlapping duplicate call ids all leave approval to a human. Host HTTP requests require the same Connection admission as the Harness API; the route refuses access if that service is unavailable.

## Prefixes

| Command | Offered prefix |
| --- | --- |
| `git status --short` | `git status` |
| `npm install pkg` | `npm install` |
| `ls -la` | `ls` |
| `bin/fff-timer-query --status` | `bin/fff-timer-query`, with a yellow risk panel |
| `/usr/bin/git status -s` | `/usr/bin/git status`, with a yellow risk panel |
| `git` | None: needs a subcommand |
| `rm -rf build`, `bash script.sh` | None: excluded command |
| `git status; other`, multiline commands, redirects | None: compound command |
| Assignments, quoted words, expansions, escaped words | None: ambiguous or unsupported syntax |

Executable paths preserve the full literal spelling: `bin/probe`, `./bin/probe`, and `/opt/bin/probe` are separate prefixes. Relative and absolute forward-slash paths without quoting or expansions are supported. Existing exclusions and required subcommands are checked against the basename, case-insensitively, including common `.exe`, `.com`, `.cmd`, and `.bat` endings. These name checks do not establish the executable's identity.

For a path prefix, the permanent-approval button sits inside a yellow frame with a risk explanation: the file may be replaced, a symlink may be redirected, relative paths depend on the execution directory, and later arguments are also allowed. The server requires an explicit path-risk acknowledgement from the client before saving, so an older client cannot silently grant a path without this UI.

Later simple arguments remain free. A prefix such as `npm install` can execute package scripts; the UI grants the prefix's full capabilities, not a guarantee that every argument or executable is harmless. Use **Allow once** when that breadth is inappropriate. Refusal copy appears under commands that have no permanent prefix.

## Revoke

Set `autoApproveEscalation: false` to stop all automatic grants. Remove or narrow the workspace rule to stop matching it immediately; an earlier deny/ask still wins. To permanently revoke a stored authorization against restoration of an old workspace rule, stop the Web service and remove its id from `$DSH_HOME/always-allow/grants.json` (or remove that ledger to revoke all grants). A missing ledger fails closed. Restart afterwards.

The ledger is host policy: backing up a workspace alone does not transfer host access to another workspace or machine.

## Verify

```sh
npm install
npm test
npm run check

# Use an isolated DSH_HOME containing the two enabled plugins.
DSH_HOME=/path/outside/workspace/to/test-home python3 scripts/boot.py \
  --patch /path/to/deepseek-harness/apps/web/tests/pin-browse-picker.overlay.yml
DSH_HOME=/path/outside/workspace/to/test-home python3 scripts/verify_flow.py --executable-path
```

`verify_flow.py` uses Python Playwright and system Chromium (`PLAYWRIGHT_CHROMIUM` overrides its path). It sends real messages to the selected model, saves a prefix for a unique local Node program that only prints a marker, repeats it without clicking, and rejects a different probe prefix. It requires matching durable `approval/asked`, `approval/decided`, `tool/result`, and `turn/end` events, and captures screenshots in `.tmp/browser/`. Use test rules without earlier matching allow/deny/ask entries. The report records resource failures; only the stock `/open-in-app/icon/filemanager` 404 is excluded from the plugin error check. This script uses the host's v4 session format and needs `zstd`.

Older `approval_test.sh` and `save_test.sh` are exploratory helpers; they do not establish automatic approval. Do not run their `--prune` options on production rules. [Troubleshooting](docs/troubleshooting.md), [rule format](docs/rules-format.md), and [framework notes](docs/PITFALLS.md) provide details.

Apache-2.0.
