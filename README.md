# dsh-always-allow

**"Always allow commands that start with …" for DeepSeek Harness approvals.**

The stock approval panel offers two answers: *reject* and *allow once*. Approving
`git status` for the tenth time in one session is noise. This plugin adds the
third answer — a one-click **prefix rule** — and writes it into the workspace
rule file that [`dsh-permission-rules`](https://github.com/PerryLink/dsh-permission-rules)
already reads.

It is how [Codex handles approvals](https://learn.chatgpt.com/docs/agent-approvals-security#sandbox-and-approvals)
("always allow commands that start with `git status`") and how
[opencode's `always`](https://opencode.ai/docs/zh-cn/permissions/) behaves, on
top of this harness's existing declarative rule engine.

---

## What you see

While a shell approval is pending, a strip appears above the composer:

```
[ Always allow git status* ]   Writes this workspace rule file, which permission-rules reads
```

Clicking it appends one rule and the prompt clears:

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

From then on, every `git status …` in that workspace runs without asking —
`git status --short`, `git status -s`, and so on — while `git push` still asks.

**This plugin never answers an approval itself.** It returns the neutral
`{kind: 'allow'}` passthrough from `tools/pre-execute`, so `permission-rules`
still makes every decision. There is one authority, not two.

---

## Install

Requirements: a DeepSeek Harness profile (the `dsh` CLI on your `PATH`) **and**
the `dsh-permission-rules` plugin installed and enabled in the same profile.
This plugin writes that plugin's rule file; it does nothing on its own.

```sh
# from npm
dsh plugin --profile web add dsh-always-allow

# or from a local checkout / tarball
dsh plugin --profile web add ./dsh-always-allow
dsh plugin --profile web add ./dsh-always-allow-0.1.0.tgz

# or straight from git (see "git installs" below)
dsh plugin --profile web add github:you/dsh-always-allow#<commit-sha>
```

Then verify the layer before starting:

```sh
dsh --profile web --dump-config | grep -A 12 '== dsh-always-allow'
```

The row should show `rulesFile`, `toolNames`, `maxTracked`, and
`autoApproveEscalation` under
`# == dsh-always-allow`.

Remove it the same way:

```sh
dsh plugin --profile web remove dsh-always-allow
```

### Prerequisite: disable the permission-rules network proxy

If you installed `dsh-permission-rules` and do not want it rewriting
`ALL_PROXY` / `HTTP(S)_PROXY` for every shell command, add this row to
`$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
- id: permission-rules
  name: dsh-permission-rules
  config:
    rulesFile: .dsh/rules.yaml
    badFilePolicy: fail
    maxRules: 256
    patternMode: glob
    watch: true
    network:
      enabled: false      # the proxy never starts
      injectEnv: false    # belt-and-braces: no environment rewriting
  disabled: false
```

A patch row **replaces the whole config** of the row it targets, which is why
every key is restated. With `network.enabled: false` the proxy code path is
never entered, so no subprocess environment is touched.

### Git installs

A git install pulls *sources*, and pnpm refuses to run a dependency's
`prepare` script until it is authorized — as code execution on your machine,
outside any agent sandbox. Copy the exact key pnpm prints under `allowBuilds`
in the profile's `pnpm-workspace.yaml`, then re-run `add`. Pin a commit
(`github:you/repo#<sha>`) so later pushes cannot silently change what runs.

---

## Configuration

Set in `cordis.patch.yml`, validated at mount; an invalid value fails the
plugin loudly instead of silently falling back.

| Key | Default | Meaning |
| --- | --- | --- |
| `rulesFile` | `.dsh/rules.yaml` | Rule file, resolved against the session workspace unless absolute. Must match the `rulesFile` of your `permission-rules` row. |
| `toolNames` | `[bash, pwsh]` | Shell Tools whose arguments carry the command line. Only tools with a `command` string argument are supported. |
| `maxTracked` | `128` | Pending approvals remembered for the browser half (oldest evicted first). |
| `autoApproveEscalation` | `false` | Also answer sandbox-escalation approvals from a saved rule. See below. |

Example override:

```yaml
- id: always-allow
  name: dsh-always-allow
  config:
    rulesFile: .dsh/rules.yaml
    toolNames: [bash, pwsh, shell]
    maxTracked: 64
```

---

## Two different approvals

A shell Tool can raise **two** unrelated approvals, and a saved rule only
answers the first:

| Approval | Raised by | Consults the rules? |
| --- | --- | --- |
| "may this command run?" | the `tools/pre-execute` waterfall | **yes** — `dsh-permission-rules` decides |
| "may this call leave the sandbox?" | the Tool body, mid-execute | **no** — it asks the approval service directly |

That is why a rule can feel like it "did not take effect": the command prompt
stops appearing, and a *different* prompt — one whose reason reads
`escalate sandbox to danger-full-access: …` — shows up for the same command.

Set `autoApproveEscalation: true` to close that second gap:

```yaml
- id: always-allow
  config:
    rulesFile: .dsh/rules.yaml
    toolNames: [bash, pwsh]
    maxTracked: 128
    autoApproveEscalation: true
```

When it is on, an escalation whose command is covered by a saved `allow` rule is
answered automatically. When it is off (the default), every escalation still
reaches a human.

**Read this before turning it on.** A rule grants "this command may run"; an
escalation asks for "this call may leave the sandbox", which is full host
access. Turning this on means every saved prefix — and every command it covers,
including one rewritten later — can obtain that access without a click. That is
the same trade Codex makes by default; it is still a strictly larger grant than
the rule itself states.

This option needs `dsh-permission-rules` installed and **enabled**: the plugin
reads its *compiled* rules through its `permissionRulesRuntime` Service rather
than parsing rule files itself, so exactly one engine resolves rules, with that
engine's own caching and file watching.

Rules carrying a dimension this plugin cannot evaluate faithfully — `params`,
`paths`, `absent`, `when`, `agents`, `network` — deliberately do **not**
auto-approve. A false negative costs one click; a false positive would grant
permission the rule never expressed.

## Which prefixes are offered

A saved rule must never cover more than the user approved. Anything doubtful
gets no button at all, and the strip explains why.

| Command line | Button |
| --- | --- |
| `ls -la` | **`ls*`** — arguments stay free |
| `git status --short` | **`git status*`** — `-s` and `--short` both hit it |
| `npm install -g x` | **`npm install*`** |
| `git` (bare) | none — *needs a subcommand, otherwise `git push --force` would be allowed* |
| `git push --force` | **`git push*`** — one call at a time is still available |
| `rm -rf build` | none — *destructive commands are never prefix-allowed* |
| `echo hi > out` | none — *compound: a prefix cannot describe it* |
| `FOO=1 git status` | none — *an environment assignment is not a literal prefix* |
| `"my program" --flag` | none — *a quoted command word is not a literal prefix* |

Never prefix-allowed regardless of arguments: `sudo`, `doas`, `su`, `sh`,
`bash`, `zsh`, `xargs`, `env`, `find`, `rm`, `dd`, `chmod`, `chown`, `curl`,
`wget`, `install`, `kill`, and the rest of the list in
[`src/prefix.js`](./src/prefix.js).

New rules are **appended** to the file, so an earlier narrower `deny` or `ask`
rule keeps winning on the engine's first-match basis.

---

## Security notes

- The rule file is written to the **workspace**, so it travels with the project
  and applies to every session started there.
- The HTTP route is checked with the same Connection trust/credential admission
  as `/api`, so a foreign page cannot spend your session to widen your rules.
  Requests are `POST`-only, body-capped at 4 KiB, and serialized per process
  (read-modify-write cannot interleave), with an atomic temp-file-and-rename
  write so `badFilePolicy: fail` never sees a half-written document.
- Prefix rules are inherently broader than one invocation. If you want one-off
  control, keep using *allow once*; the plugin never removes that option.

---

## Development

```sh
npm test        # node:test — unit + integration against a real Cordis context
npm run check   # syntax check every source file
```

The integration tests mount the plugin the way the Loader does and skip
cleanly when the harness checkout is not present. Point them at a different
checkout with `DSH_CORDIS_PATH=/path/to/deepseek-harness/vendor/cordis/lib/index.js`.

### Live verification

Unit tests cannot see the failures this plugin actually had. A pending `inject`
freezes the row, an inactive entry never enters the client boot graph, and a
panel that throws leaves an *empty* composer — all three look identical to "the
plugin is not installed", and none of them is visible to `node --test`.

`scripts/` drives a real `dsh web` in a real Chromium instead:

```sh
scripts/check_all.sh          # enablement, boot, panel render, rule save
scripts/probe.sh              # just: is this plugin actually active?
scripts/boot.sh --port 4170   # start an instance and record it in .tmp/
scripts/approval_test.sh      # raise a real approval, assert the three buttons
scripts/save_test.sh          # click always-allow, assert the rule was written
scripts/screenshot.sh         # capture the page (--selector for one element)
scripts/rules.sh list         # show the saved rules in this workspace
scripts/rules.sh prune --plugin-saved   # remove the rules this plugin wrote
scripts/rules.sh clear        # remove every rule
```

A saved `allow` rule is **sticky**: once it exists, `dsh-permission-rules` stops
asking about that command, so a re-run of the panel test would see no approval at
all. `approval_test.sh --prune` and `save_test.sh --prune` clear this plugin's own
rules first for that reason, and `check_all.sh` passes `--prune` for both.
Pruning is surgical — only the matching rule blocks are dropped, so comments
elsewhere in the file survive.

`approval_test.sh` requests `sandbox_permissions` in its prompt, because that is
what raises the approval waterfall; a plain read never does. Required: Python
Playwright and a system Chromium (override the path with `PLAYWRIGHT_CHROMIUM`).
Each script exits non-zero on failure and prints the browser console errors,
which is how the missing `resolveReason` and `renderSlot` props were found.

```
src/index.js        plugin entry: command tracking, route, atomic rule append
src/prefix.js       pure prefix derivation + refusal vocabulary
src/rules-file.js   pure YAML rendering and insertion
src/endpoints.js    transport-neutral propose/save operations
src/config.js       config resolution and defaults
src/client.js       browser bundle: the approval panel takeover
test/               node:test suites
scripts/            live verification against a real browser
docs/               rule format, troubleshooting, and PITFALLS.md
```

`docs/PITFALLS.md` records the Harness traps that fail **silently** — a pending
`inject` freezing the row, the market plugin's own disabled list, a route that
registers and is disposed milliseconds later. Each one is written down with the
symptom it produced, because none of them reports an error.

---

## License

Apache-2.0.
