# Harness 0.2.2-rc.1 compatibility verification

Target: DeepSeek Harness `dsh-v0.2.2-rc.1`, commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`, compared with `dsh-v0.2.1-rc.5`. The plugin's runtime sources and approval UI are unchanged. Existing rules and host-ledger records require no conversion or renewed consent for this upgrade.

## Integration surfaces

Harness has pre-stable APIs; this release includes breaking changes to tool execution, Cordis configuration and Loader persistence, and Session projection APIs. Node.js 24.9 is its new minimum. These are not covered by an interface-stability promise through 0.2.3.

The plugin's integration points retain the contracts it uses: scoped tool waterfalls, the same execution object's identity through the pipeline, the escalation reason and target, Connection HTTP admission, and pending-approval handles. Session format remains v4. The plugin does not directly consume the changed projection registration or wire-frame APIs.

The new `conversation.approval.card` factory accepts an optional `onAlways` callback. Ordinary tool approvals still supply only one-time allow and reject callbacks. The shared card's fixed permanent label and lack of a dedicated permanent-button risk region would require additional adaptation to preserve this plugin's explicit prefix labels, path warning group, and save states. The current composer contribution is retained; adopting that factory is a separate UI change, not a compatibility requirement.

## Dependency and CI changes

The test baseline uses published Harness `0.2.2-rc.1` packages, Cordis `4.1.0`, and permission-rules `0.7.21`. Packages imported directly by the new pipeline test are declared as development dependencies. The npm lockfile preserves unrelated package versions and resolves the Harness peer group consistently; obsolete dependencies disappear where the new packages no longer need them.

Updating only scope and Cordis against the old lock reproduced `ERESOLVE`. In addition, permission-rules `0.7.15` does not include `0.2.2` prereleases in its published npm peer ranges. Version `0.7.21` includes them. The test graph was updated together without `--force`, `--legacy-peer-deps`, or peer overrides. The plugin's runtime peer requirement remains `^0.7.15`: the earlier Web checks below establish that version's tested runtime behavior independently of its npm installation constraints. The plugin's Harness engine range now explicitly lists `0.2.2` prereleases.

CI installs with `npm ci`, checks the dependency graph with `npm ls --all`, then runs syntax checks and tests on Node 24.9.0 and the latest Node 24. The older plugin runtime engine range is retained for older Harness deployments; development checks now require the newer Harness minimum.

## Published-dependency verification

Two independent clean directories installed the lockfile without Harness checkout links. Node 24.9.0 and Node 24.22.0 each passed:

- `npm ci`.
- `npm test`: 55 tests, zero failures or skips.
- `npm run check`.
- `npm ls --all`: no invalid or missing required peers; optional peers may be absent.
- Import-resolution checks for Cordis, scope, the public tools pipeline, permission-rules, and YAML, all inside the clean directory's own `node_modules`.

The new pipeline test initially failed against the previous dependency graph because `@deepseek-ai/dsh-tools/pipeline` was not exported there. With the new dependencies it runs an in-memory shell stand-in through the real tool pipeline, approval service, and managed Session. It verifies explicit saving, an automatic repeat without human forwarding, rejection of another prefix, earlier deny precedence, the `never` policy, matching durable approval pairs, and route cleanup on unload. It starts no processes and invokes no model.

Local reports are `.tmp/rc22-node249-report.json` and `.tmp/rc22-node24-report.json`. These are local results, not a remote GitHub Actions result.

## Real Web verification

Linux Web verification used the target checkout's built assets, Node 26.13.0, Python Playwright, system Chromium, an isolated DSH_HOME outside the model workspace and OS temporary roots, and a dedicated workspace. The user's daily configuration and other plugin repositories were unchanged. The plugin was source-linked; permission-rules came from the published package installation.

Both ordinary and executable-path flows passed first with permission-rules `0.7.15`, then with the newly locked `0.7.21`. Each completed flow used three real model messages and unique local programs that only printed markers:

1. Saving the prefix produced matching `approval/asked` and `approval/decided` events with `allowed-once`, successful `AA_SAFE_FIRST` output, and `turn/end`.
2. Repeating the prefix produced `allowed-once`, successful `AA_SAFE_REPEAT` output, and `turn/end`, with zero approval-card appearances.
3. A different prefix still displayed approval. Rejecting it produced `rejected`, an error tool result, and `turn/end`, without executing the sentinel program.

The final `0.7.21` runs used `scripts/verify_flow.py` and `scripts/verify_flow.py --executable-path`. Screenshots were inspected at 1400 × 900 and 620 × 900. The path button and risk explanation shared a solid 2 px yellow frame (`rgb(247, 173, 49)`); the narrow card fit within the viewport and its button remained inside the frame. Ordinary prefixes had no path-risk frame. The verification script now waits for responsive layout and the sidebar's CSS collapse transition before capturing the narrow view; capturing immediately after resizing had shown the sidebar still covering part of the card.

Both final reports contained no page or unexpected console/resource errors. The known stock `/open-in-app/icon/filemanager` 404 was the sole excluded failure. An initial fixture startup lacked its absolute rules file and the rule service correctly refused activation under `badFilePolicy: fail`; adding `rules: []` before the final runs removed that activation warning.

Final reports and screenshots are in `.tmp/rc22-browser-0721-path/` and `.tmp/rc22-browser-0721-ordinary/`. The test service was stopped and its port confirmed closed.

This verifies the described Linux Web deployment and published Node test graph. It does not establish Windows/pwsh behavior, other execution backends, or a clean-profile tarball installation.
