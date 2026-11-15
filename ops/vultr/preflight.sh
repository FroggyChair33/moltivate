#!/usr/bin/env bash
# Read-only prerequisites check. Does not print credentials or mutate the VM.
set -euo pipefail
missing=0
for command_name in python3 git ffmpeg ffprobe systemctl; do
  if command -v "$command_name" >/dev/null 2>&1; then
    printf 'OK: %s available\n' "$command_name"
  else
    printf 'MISSING: %s\n' "$command_name"
    missing=1
  fi
done
if command -v python3 >/dev/null 2>&1; then
  python3 - <<'PY' || missing=1
import sys
import importlib.util
print('Python:', sys.version.split()[0])
if sys.version_info[:2] != (3, 12):
    raise SystemExit('Baseline requires Python 3.12; do not replace system Python.')
if importlib.util.find_spec('venv') is None:
    raise SystemExit('Missing venv support; install python3-venv.')
PY
fi
printf '%s\n' 'This checks prerequisites only; it does not establish live-service readiness.'
exit "$missing"
