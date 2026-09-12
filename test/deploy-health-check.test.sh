#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if grep -Fq '/tmp/phbox-health.json' "$ROOT/deploy.sh"; then
  printf '%s\n' 'deploy.sh must not use the shared /tmp/phbox-health.json path' >&2
  exit 1
fi

# Load the real deploy functions without invoking main.
python3 -c '
from pathlib import Path
import sys
source = Path(sys.argv[1]).read_text()
source = source.replace("\nmain \"$@\"\n", "\n")
Path(sys.argv[2]).write_text(source)
' "$ROOT/deploy.sh" "$WORK/deploy-lib.sh"

output="$({
  source "$WORK/deploy-lib.sh"
  COMPOSE=(true)
  curl() { printf '%s\n' '{"ok":true}'; }
  sleep() { :; }
  health_check
})"

if ! grep -Fxq '{"ok":true}' <<<"$output"; then
  printf '%s\n' 'health_check did not emit the successful in-memory response' >&2
  exit 1
fi
