#!/usr/bin/env bash
# Convenience wrapper for save_test.py; see that file for options.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$here/save_test.py" "$@"
