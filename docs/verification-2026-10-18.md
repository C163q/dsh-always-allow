# Verification: persistent sandbox approvals

Environment: Linux, Node 26.11.1, the local DeepSeek Harness Web build `0.2.1-rc.2-687f282`, permission-rules 0.7.15, Python Playwright and system Chromium. This is evidence for that configuration, not a Windows or arbitrary-backend certification.

## Findings corrected

- The unfinished implementation depended on audit events that current hosts intentionally disable; the preceding matcher skipped policy precedence.
- `argv.args` was incorrectly documented as an ordered prefix. Real-engine regression tests reproduced `git push status` matching the old `git status` rule.
- Call ids are only session-local, and overlapping duplicate ids are not unique execution identities. Finished or ambiguous calls must not remain writable approvals.
- A workspace tag alone cannot prove human consent. Exact grants are retained outside the model's writable roots, including OS temporary areas; reading a grant id cannot widen it.
- The current engine's compilation cache omits live compilation settings. Automatic grants therefore use the public compiler/matcher with current source bytes and current settings.
- Regex insertion into YAML could append into a different list or mishandle scalar control characters. AST edits, complete validation, stale-file checks, and atomic commit replaced it.

## Automated checks

`npm test` passes all seven test files. `node --test --test-isolation=none 'test/**/*.test.js'` reports 49 individual tests passing. The latter reporting flag was used with Node 26; the package's normal test command does not require it.

`npm run check`, Python syntax compilation, `git diff --check`, and `npm pack --dry-run` pass. A separate reviewer checked the authorization implementation and verified fixes to the temporary-root ledger, duplicate-id quarantine, live-configuration compilation, and delayed-save UI issues. Follow-up review of legacy-rule reauthorization found no remaining Critical/Important permission issues within the reviewed source scope.

## Actual browser flow

The selected real model received three explicit single-bash-call messages. A unique local Node program printed a marker and did not modify files. Playwright verified:

1. The first danger-full-access request showed the permanent-prefix button and the host-access explanation. Clicking saved the rule; the logged outcome was `allowed-once`, and the successful tool result contained exactly `AA_SAFE_FIRST`.
2. Repeating that prefix with another argument showed zero approval cards. Its logged outcome was `allowed-once`, and its successful tool result contained exactly `AA_SAFE_REPEAT`.
3. A different program prefix still showed approval. Clicking reject logged `rejected`; its tool result was an error and did not contain the sentinel output.

Every step matched `approval/asked` and `approval/decided` ids and completed a durable turn. Report and screenshots remain locally in `.tmp/browser-verified/` (`report.json`, `01-manual-approval.png`, `02-automatic-completion.png`, `03-unmatched-approval.png`). The report records a 404 from the stock `/open-in-app/icon/filemanager` endpoint; only that unrelated asset error is excluded. Other HTTP and browser errors fail verification.

The archived test DSH_HOME had permission-rules disabled in dshmarket despite its enabled YAML row. Only that test copy was enabled, with its proxy disabled. The user's daily profile, harness source, and permission-rules source were unchanged. The daily installation links to this checkout and already enables automatic escalation; restart its Web process to load the implementation.

## Authorization limits

Existing rules remain ordinary policy until explicitly reauthorized. A new grant can follow a legacy ordinary allow, but an overall first-match deny/ask still prevents automatic escalation. Removing the explicit grant rule stops the automatic match; removing the corresponding host-ledger id additionally prevents restoration of an old grant rule.

DSH_HOME must remain outside every model-writable root, including independently configured workspaces and custom executor mounts. A prefix can invoke arbitrary behavior permitted by its program and later arguments; it is a durable user authorization, not a proof that its program is harmless. Already-unrestricted host code is outside the protection this plugin can provide.
