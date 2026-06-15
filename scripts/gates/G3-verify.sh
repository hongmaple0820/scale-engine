#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "$PROJECT_ROOT"

changed=()
while IFS= read -r path; do
  [ -n "$path" ] && changed+=("$path")
done < <(git status --short --untracked-files=all 2>/dev/null | awk '{print $2}' | tr -d '\r')

if [ "${#changed[@]}" -eq 0 ]; then
  echo "[G3] no working tree changes; skip"
  exit 0
fi

code_changed=0
test_changed=0

for path in "${changed[@]}"; do
  case "$path" in
    src/*.ts|src/*/*.ts|src/*/*/*.ts|packages/*.ts|packages/*/*.ts|packages/*/*/*.ts)
      code_changed=1
      ;;
    tests/*.ts|tests/*/*.ts|tests/*/*/*.ts|**/*.test.ts|**/*.spec.ts)
      test_changed=1
      ;;
  esac
done

if [ "$code_changed" -eq 0 ]; then
  echo "[G3] no source behavior changes detected; skip"
  exit 0
fi

if [ "$test_changed" -eq 0 ]; then
  echo "[G3] source changes detected without matching test changes"
  exit 1
fi

echo "[G3] passed"
