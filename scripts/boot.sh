#!/usr/bin/env bash
# Convenience wrapper for boot.py; see that file for options.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$here/boot.py" "$@"
