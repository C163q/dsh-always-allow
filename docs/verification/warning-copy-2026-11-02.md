# Short approval copy verification

The Chinese and English path-risk, host-access, compound-command, and unavailable-service messages were shortened. Unsupported shell syntax and excluded commands retain their restrictions and one-time approval controls, with no extra refusal hint. Host authorization and prefix matching were unchanged.

The new refusal-hint regression failed against the previous bundle, then passed after removing the two unwanted messages from both dictionaries. Tests read the dictionaries registered by the shipped client bundle. A clean dependency installation on Node 24.22.0 passed `npm test` (54 tests, no failures or skips) and `npm run check`. Python syntax compilation and `git diff --check` passed. The local check report is `.tmp/warnings-node24-report.json`.

DeepSeek Harness `0.2.1-rc.5` and permission-rules 0.7.15 ran in the existing isolated test profile. `scripts/verify_flow.py --executable-path` passed with three real model messages: manual grant and successful marker output, automatic repeat with zero approval cards, and rejection of a different prefix without execution. Durable approval ids, outcomes, tool results, and completed turns were checked.

Desktop and 620 px screenshots were inspected. The short warning and permanent-approval button share a solid 2 px yellow frame. At the tested desktop width, the captured frame was 685 by 128 px; the preceding longer-copy capture was 685 by 147 px. The long-path button remained inside the frame at both widths. Browser errors were empty; the sole resource failure was the previously documented stock file-manager icon 404.

Final screenshots and the browser report are in `.tmp/warnings-browser/`, including `path-risk-panel.png`, `01-manual-approval.png`, and `04-mobile-path-warning.png`. The daily profile and other plugin repositories were unchanged.
