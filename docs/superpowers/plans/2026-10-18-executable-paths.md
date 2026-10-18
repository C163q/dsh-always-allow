# Executable path prefix approvals

User-approved change: executable paths such as `bin/fff-timer-query` may participate in automatic approval, with a yellow frame around permanent approval and explicit risk copy.

- Preserve the entire unquoted literal path, without basename rewriting or path normalization. Support relative and absolute forward-slash paths. Preserve interpreter/destructive exclusions and required subcommands by checking the executable basename case-insensitively, including common Windows executable extensions.
- Add `executablePath: true` to path proposals. Require explicit `allowExecutablePath` acknowledgement on saves so an older client cannot silently grant a newly eligible path without showing the warning.
- Wrap the path permanent button and warning in a yellow themed panel; explain replacement/symlink, relative working directory, and later argument risks in Chinese and English. Keep ordinary command UI and existing host-grant controls.
- Test prefix derivation, real-engine raw matching/word boundaries, path-risk consent before persistence, and actual durable automatic approvals. Use a harmless executable path in the real Web browser smoke, inspect its warning border/copy, save screenshots, and verify automatic repeat and unmatched rejection.

Files: src/prefix.js, src/endpoints.js, src/client.js; associated prefix/rules/endpoints tests; scripts/verify_flow.py; README and changelog.

Completed: failing regressions observed before implementation; 53 tests and syntax checks pass. Chromium verified the warning group, 2 px yellow border, narrow-screen containment, successful direct executable-path execution, automatic repeat with no approval panel, and rejection of a different path. Independent review found no material regression. Evidence is recorded in docs/verification-2026-10-18.md and .tmp/path-browser/.
