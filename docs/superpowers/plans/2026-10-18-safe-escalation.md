# Safe persistent escalation implementation plan

> **For agentic workers:** Execute inline using executing-plans and test-driven-development; obtain a fresh final security review.

**Goal:** Save a narrowly defined shell prefix in the Web approval UI and automatically approve future matching host-access requests.

**Architecture:** Track live calls and pending approvals; delegate rule evaluation to permission-rules; require a versioned explicit grant. Persist comment-preserving YAML and fail closed on missing dependencies or ambiguity.

**Tech Stack:** ESM JavaScript, node:test, Cordis, dsh-permission-rules, yaml, Python Playwright, Chromium.

**Spec:** `docs/superpowers/specs/2026-10-18-safe-escalation-design.md` (user approved).

## Global constraints

Work only in this plugin and isolated test data. Preserve unfinished changes in `.tmp/baseline`. No harness fork, rule migration, live-profile changes, publishing, or arbitrary shell approval. Old rules never automatically gain danger-full-access.

## Review focus

- Real waterfall scoping and listener order must reach the answerer before browser forwarding.
- Commands rewritten between pre-execute and execute must be checked again.
- A cancelled or answered approval must not remain writable.
- Rule edits and failed reloads must not retain automatic host access.
- Browser results must include tool completion, not just disappearing approval UI.

### Task 1: Literal prefix rules and YAML persistence

Files: `src/prefix.js`, `src/rules-file.js`, `test/prefix.test.js`, `test/rules-file.test.js`, `package.json`.

- [x] Add failing tests for misplaced subcommands, compound/newline commands, unsafe scalars, secondary YAML lists, malformed documents, and duplicate saves; use the actual permission-rules compiler/matcher.
- [x] Run focused tests and observe failures.
- [x] Render versioned grant tags and raw command constraints; use YAML Document parsing for insertion, with exact-tool scope and validation.
- [x] Run focused tests to green.

### Task 2: Live approval and automatic escalation

Files: `src/index.js`, `src/escalation.js`, `src/endpoints.js`, `test/escalation.test.js`, `test/integration.test.js`, `test/endpoints.test.js`.

Interfaces: `createEscalationListener({ enabled, calls, runtime })`; live call records hold exec, final gate, dispatch state; pending records are keyed by session and call with a random browser handle.

- [x] Replace truncated/stale tests with behavior tests covering explicit grants, ordered deny/ask, rewritten calls, revoked/malformed rules, engine absence/dry-run, wrong identity, stale and concurrent saves, missing authentication, and cleanup.
- [x] Run focused tests and observe failures.
- [x] Use the engine's public matchRules with fresh compileRulesChain over runtime.resolveSources and current config; match only the actual danger-full-access call. Preserve the pre-execute decision.
- [x] Track pending approval lifetime around next(); bind endpoints to an opaque handle; require connection admission; atomically write with a private temp file and reload the engine.
- [x] Run all tests and syntax checks to green.

### Task 3: Browser behavior, documentation, security review

Files: `src/client.js`, `scripts/live.py`, `scripts/boot.py`, new deterministic browser verification script/fixture, README and affected docs.

- [x] Show explicit host-access wording and disable conflicting controls during save; include the server-provided approval handle in save.
- [x] Fix launcher argument ordering and Chromium path override; run real pnpm dsh web in isolated DSH_HOME.
- [x] With Chromium, save a harmless prefix; repeat it without clicking; confirm approval/decided plus tool/result; verify a different prefix waits and rejection prevents execution; save screenshots.
- [x] Update docs for the actual behavior and old-rule compatibility boundary.
- [x] Run npm test, npm run check, browser checks, and npm pack --dry-run; request fresh security review and resolve material findings before final verification.


## Execution ledger

- Preserved initial unfinished patch and truncated test in `.tmp/baseline`; implementation stayed on `fix/safe-persistent-escalation` in the requested directory.
- Initial regression runs reproduced unordered argv matching, unsafe YAML insertion, stale approvals, missing admission, temp-root authorization storage, duplicate call ids, and stale compilation after live pattern-mode changes. Each was rerun after its fix.
- Independent read-only review identified the temporary-root, compilation-cache, and duplicate-id issues; follow-up review verified their fixes and the approval-generation guard, with no remaining Critical/Important issues within reviewed source scope.
- Real Web testing uses the archived DSH_HOME only. Its market-disabled rule engine was enabled with its network proxy disabled. Actual model calls verified manual grant, automatic repeat without a panel, and an unmatched rejected call against durable events.
- The host's stock file-manager icon endpoint returns 404 during conversation rendering. The verifier records it and excludes exactly that unrelated URL; all other HTTP and browser errors remain failures.
- The daily profile, harness source and permission-rules source were not modified. Arbitrary custom execution backends and cross-workspace protection of a deliberately misplaced host ledger are operator trust requirements, not claimed sandbox guarantees.
