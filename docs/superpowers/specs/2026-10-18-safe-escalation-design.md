# Safe persistent shell approvals

## Scope

Complete dsh-always-allow for the real `dsh web` approval flow without changing the harness or dsh-permission-rules repositories. Keep the user's unfinished working tree. Use an isolated DSH_HOME and harmless commands for browser validation.

## Findings

- The unfinished escalation implementation relies on permissionRules/decision session events. The installed engine intentionally disables those events on current prerelease harness versions to preserve session readability.
- The previous matcher searches allow rules without honoring an earlier deny/ask and reimplements only part of the engine.
- The saved argv rule does not represent a literal prefix: the engine accepts a subcommand token anywhere and command words anywhere in a pipeline.
- Pending calls are never withdrawn after completion; saving is not bound to a currently pending approval or its agent.
- The HTTP endpoint skips authorization when the connection service is absent.
- YAML insertion is textual and may append into another top-level list; tool names and reason text are not safely serialized.
- Existing tests include a truncated JavaScript file and a stale mocked integration case.

## Recommended implementation

1. Use the public dsh-permission-rules matcher and its live runtime to evaluate the complete ordered rules. Do not read decision audit logs or implement a second matcher. Freshly load rules before an automatic grant so deletion, disabled enforcement, a malformed file, an earlier deny/ask, and a changed configuration cannot silently retain a grant.
2. New rules carry a versioned explicit escalation-grant tag backed by an exact host authorization record and the literal prefix, and match the raw command with a word boundary plus conservative character restrictions. Preserve tool and subcommand identity. Old argv-only rules keep their existing ordinary-rule meaning but are never automatically promoted to host access. The UI states when a saved prefix grants danger-full-access.
3. Automatically answer only a live, tracked shell invocation, for the same agent, tool, call id, requested mode and justification. Check the actual current arguments again at approval time, after any argument rewriting. Only the known danger-full-access reason format is eligible. Unknown, stale, cancelled, compound, or ambiguous calls continue to human approval.
4. Bind propose/save to a currently pending approval. Remove it when the approval settles; clean up execution state on completion, cancellation, eviction, and plugin disposal. Revalidate after asynchronous writes. Disable conflicting UI actions while saving.
5. Refuse HTTP access if the connection admission service is unavailable. Use a YAML document parser to preserve comments and rule order, serialize scalars safely, reject malformed or unsupported documents, and append atomically with a private temporary file. Immediately reload the runtime after saving.
6. Keep autoApproveEscalation opt-in. Limit new rules to the exact approving shell tool. Preserve allow-once and reject and explain why a permanent prefix is unavailable.

## Alternatives

- Patch harness escalation metadata: stronger structured request identity, but requires a maintained harness fork; outside this plugin-only repair.
- Repair audit-log matching: smaller code change but unavailable on the current host and unable to validate current arguments or rule revocation; rejected.

## Validation

Use regression tests against the real Cordis waterfall and installed permission-rules matcher/runtime. Cover ordered deny/ask, no hit, no engine, dry-run, malformed/revoked rules, wrong tool/agent/call, rewritten arguments, compound commands/newlines, word boundaries, stale saves, missing authentication, YAML integrity, and duplicate saves. Run Playwright with system Chromium through a real `dsh web`, save a harmless prefix, request it again without clicking, verify actual completion and approval audit records, and capture both manual and automatic paths. Also verify a different prefix still asks and rejection prevents execution.


## Implementation review decisions

- Authorization records live in `$DSH_HOME/always-allow/grants.json`, outside the session workspace, `/tmp`, and `os.tmpdir()`, including aliases. An opaque id is only a reference to a scoped record; it is not a bearer credential. A workspace tag alone never grants host access. Keep the ledger outside every independently model-writable directory.
- The current engine caches compiled rules without the compilation settings in the key. Automatic escalation therefore uses its public `compileRulesChain` and `matchRules` on `resolveSources` plus current file bytes/configuration, without using that cache.
- An approval request contains no execution token. Overlapping identical session/call ids are quarantined through all their live executions, including calls evicted from UI eligibility.
- Tests use host ledgers under the repo's ignored test directory, outside each test workspace; OS-temp ledgers are explicitly rejected.
