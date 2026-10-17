#!/usr/bin/env bash
# Full live verification: enablement, mount, panel render, and rule save.
#
#   scripts/check_all.sh [--port N]
#
# Runs the real GUI in a real browser end to end. This is deliberately not a
# unit test: the failures this plugin had (a pending fiber, an empty panel
# takeover, a missing injected prop) are all invisible to unit tests, and each
# one looked exactly like "the feature is not installed".
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
port=""
while [ $# -gt 0 ]; do
  case "$1" in
    --port) port="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

echo "== 1/4 enablement =="
"$here/probe.sh" --running 2>/dev/null || "$here/probe.sh"

echo
echo "== 2/4 boot =="
if [ -n "$port" ]; then
  "$here/boot.sh" --port "$port"
else
  "$here/boot.sh"
fi

echo
echo "== 3/4 panel renders =="
# Prune first: a saved always-allow rule suppresses the next approval, which
# would make the panel test pass vacuously or fail confusingly.
"$here/approval_test.sh" --prune

echo
echo "== 4/4 rule saves =="
"$here/save_test.sh" --prune

echo
echo "all live checks passed"
