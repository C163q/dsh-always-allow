# Harness rc.5 compatibility verification

Target: DeepSeek Harness `dsh-v0.2.1-rc.5`, commit `b830ec950faba0a46dda564be3e2d854afed94f1`, compared with `dsh-v0.2.1-rc.2`. Plugin runtime sources remain at v0.3.1 behavior; permission-rules is the published `0.7.15` package. Browser verification used Linux, Node 26.11.1, Python Playwright, system Chromium, and the target checkout's built Web assets.

## Source compatibility

The comparison found no implementation changes in the plugin's owning integration surfaces: core tools and scope, sandbox escalation, bash/pwsh tools, user approval, Connection admission, client module loading, approval UI, Slots, or vendored Cordis. Their package release versions changed. The escalation reason, scoped waterfall dispatch, execution-object identity, and pending-approval API retain the behavior this plugin uses.

The reasoning-body Slot upgrade introduces `rawText` and changes the meaning of `text`; this plugin does not contribute to that Slot. Conversation header customization does not change the approval composer entry. Session format remains v4. No approval-policy or client-module migration was needed.

## Changes

- Pin the test scope package to `0.2.1-rc.5` and update the entire locked Harness peer group to that release. Updating scope alone reproduced `ERESOLVE` against the old exact rc.2 peer requirements. Preserve unrelated locked package versions; do not bypass peer validation.
- Wait for an editable composer and an enabled Send button in `verify_flow.py`. The previous immediate fill/Enter sequence failed to submit the first probe in a newly prepared profile: a blank session existed, but no `user/message` or approval event followed. Waiting for the enabled Send action and clicking it completed both flows below.

## Published-dependency checks

Two independent clean directories installed the committed dependency graph without Harness checkout links. Node 22.23.3 and Node 24.22.0 each passed `npm ci`, `npm run check`, `npm test` (53 tests, zero failures or skips), and `npm ls --all`. The latter reported optional development-tool peers as absent, with no invalid or missing required peers. Scope, Cordis, permission-rules, and YAML imports resolved inside each clean directory's own `node_modules`.

The sandboxed test runner initially reported only seven passing files rather than individual cases. The matrix was rerun outside that sandbox and confirmed all 53 cases on each Node version. Python syntax compilation and `git diff --check` also passed.

Local reports: `.tmp/rc5-node22-report.json` and `.tmp/rc5-node24-report.json`. These local checks do not establish the status of a remote GitHub Actions run.

## Real Web verification

A dedicated test DSH_HOME outside the model workspace and OS temporary roots loaded only the official base/Web bundles, permission-rules, and this plugin. Its dedicated workspace contained fresh test rules; the user's daily profile and other plugin repositories were unchanged. The profile's first-run notice was dismissed and its workspace selected before executing the final verification scripts.

Both `scripts/verify_flow.py --executable-path` and `scripts/verify_flow.py` passed against that instance. Each used three real model messages and unique local programs that only printed markers:

1. Manual save produced a matching `approval/asked` and `approval/decided` pair with `allowed-once`, followed by a successful `AA_SAFE_FIRST` tool result and a completed turn.
2. The same prefix with another argument produced `allowed-once` and `AA_SAFE_REPEAT`, with zero approval-card appearances.
3. Another program prefix still displayed approval. Rejection produced `rejected` and an error tool result without the sentinel output.

The path button and replacement, symlink, execution-directory, and later-argument warning shared a solid 2 px yellow frame (`rgb(247, 173, 49)`). Screenshots were inspected at 1400 px and 620 px widths; the button remained within the frame. The ordinary command flow had no path-risk frame.

Reports contained no page or unexpected console/resource errors. Both recorded the known stock `/open-in-app/icon/filemanager` 404, the sole excluded resource failure. Final reports and screenshots are in `.tmp/rc5-browser-final/` and `.tmp/rc5-browser-ordinary/`; the path screenshots include `01-manual-approval.png`, `04-mobile-path-warning.png`, and `path-risk-panel.png`.

This verifies the tested Linux Web configuration with permission-rules 0.7.15. It does not certify other executors, operating systems, or newer permission-rules versions.
