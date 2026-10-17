#!/usr/bin/env bash
# Convenience wrapper for approval_test.py; see that file for options.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$here/approval_test.py" "$@"
