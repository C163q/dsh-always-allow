# Verification: clean-install CI

## Failure and root cause

GitHub's Node 22 job failed during test module loading with missing `dsh-permission-rules`, `@deepseek-ai/cordis`, and `yaml`. The workflow ran syntax checks and tests without installing dependencies. Local dependency links to the developer's harness checkout had hidden that omission.

A fresh archive of the committed repository, extracted outside the plugin directory so Node could not find its node_modules through parent traversal, reproduced the same four failing test files. Installing declared dependencies then exposed a second issue: `@deepseek-ai/dsh-scope` was pinned to `0.2.1-alpha.1`, while the resolved `@deepseek-ai/dsh-agent@0.2.1-rc.2` required scope `0.2.1-rc.2`.

## Change

- Run `npm ci` before checks/tests in both GitHub matrix jobs and enable npm caching through setup-node.
- Commit `package-lock.json` with published npm artifacts and integrity hashes.
- Align the development scope dependency to `0.2.1-rc.2`; do not suppress peer conflicts with force or legacy-peer-deps.
- Update contributor instructions to require a clean dependency installation and lockfile maintenance.

## Validation

Each matrix case used its own fresh checkout with no inherited node_modules or harness links. A precompiled Node binary was invoked directly, with its directory first in PATH so npm's test scripts used the intended version.

| Runtime | npm | Install | Syntax | Tests |
| --- | --- | --- | --- | --- |
| Node 22.23.3 | 10.9.9 | `npm ci`, passed | `npm run check`, passed | `npm test`, 53 passed, 0 failed, 0 skipped |
| Node 24.22.0 | 11.21.1 | `npm ci`, passed | `npm run check`, passed | `npm test`, 53 passed, 0 failed, 0 skipped |

Both installs reported zero audit vulnerabilities. Import resolution for permission-rules, Cordis, and yaml was checked to stay inside each checkout's node_modules. Every resolved lockfile artifact points to registry.npmjs.org; no local paths or linked packages are present.

The change affects dependency installation and test tooling, not approval behavior. Browser/model tests were not repeated. These are local reproductions of the CI matrix; they do not claim a completed GitHub Actions run.
