# Troubleshooting

## No permanent-approval button

Check that both plugins are installed and enabled in the same profile. dshmarket keeps its own disabled list in `$DSH_HOME/profiles/web/.dsh-market/state.json`; an enabled YAML row does not override that list. In a profile previously affected by proxy rewriting, explicitly disable permission-rules' `network.enabled` and `network.injectEnv` before enabling it.

The `/always-allow` route refuses requests when Connection admission is missing, permission-rules is absent or in dry-run mode, or the two rule paths differ. A 401/403 means admission failed; reopen the launch URL for the exact host/port. A 503 means a required service or configuration is unavailable. Save errors display their reason in the card.

Only a currently pending tracked shell approval can offer a prefix. Finished, cancelled, evicted, agentless, ambiguous duplicate-id, and non-shell calls have no writable approval. Refused compound, quoted, escaped, multiline, or excluded commands show an explanation; approve those one call at a time.

## Saving works but a later escalation asks again

- Enable `autoApproveEscalation: true`; its default is false.
- Save while the actual target is `danger-full-access`. Saving an ordinary pre-execute approval does not grant host access.
- Legacy `argv` allow entries have no host authorization. Click again on a current escalation to create an explicit grant.
- Inspect earlier rules: a first-match deny/ask still prevents automatic approval. A preceding ordinary allow requires a separate matching explicit grant and host-ledger record.
- Keep the workspace, tool, and rule-file path the same. A grant for bash does not grant pwsh access.
- Ensure DSH_HOME and its authorization ledger are outside the workspace and OS temporary writable roots. A missing or corrupt ledger never authorizes anything.
- Current rule bytes and compile configuration are checked on each escalation; malformed edits and live pattern-mode changes can require human approval even if the engine's ordinary cache retains an old rule.

If a save reports that its approval or file changed, retry from the current card. The plugin refuses stale writes instead of overwriting newer policy.

## Verify the real Web flow

Use `scripts/boot.py` and `scripts/verify_flow.py` as documented in README. The latter checks durable outcomes; a hidden card alone is not evidence of approval. Local HTTP probes bypass ambient HTTP proxies, while the browser runs through Chromium. Screenshots and the report are under `.tmp/browser/`.

The test profile must be isolated and must keep earlier rules from shadowing the test prefix. Use a harmless test command and review test prompts before selecting a paid model. No rule pruning is needed for `verify_flow.py` when a clean isolated rules file is used.
