#!/usr/bin/env bash
# Verify the real browser flow without pruning existing rules.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${DSH_HOME:?Set DSH_HOME to an isolated test profile before running live checks}"
python3 "$here/boot.py" "$@"
python3 "$here/verify_flow.py"
