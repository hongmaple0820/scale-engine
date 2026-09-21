#!/bin/bash
# G3 — source behavior changes must ship with matching test changes.
#
# Exemption: set SCALE_GATE_SKIP_TESTS_REASON="<why>" to record an explicit,
# greppable reason for changes that legitimately carry no test update
# (comment-only edits, pure type/format refactors, docs inside src/).
# Deliverable evidence for the exemption belongs in the task's verification.md (G8).
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "$PROJECT_ROOT"

skip_reason="${SCALE_GATE_SKIP_TESTS_REASON:-}"

# Collect the change set twice-free and unambiguously: paths only, so names with
# spaces survive (unlike the porcelain status prefixes).
changed=()
while IFS= read -r path; do
  [ -n "$path" ] && changed+=("$path")
done < <(
  {
    git diff --name-only HEAD 2>/dev/null || true
    git ls-files --others --exclude-standard 2>/dev/null || true
  } | tr -d '\r' | sort -u
)

if [ "${#changed[@]}" -eq 0 ]; then
  echo "[G3] no working tree changes; skip"
  exit 0
fi

code_changed=0
test_changed=0

for path in "${changed[@]}"; do
  case "$path" in
    *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx|tests/*)
      test_changed=1
      continue
      ;;
    src/*.ts|src/*.tsx|packages/*.ts|packages/*.tsx)
      code_changed=1
      ;;
  esac
done

if [ "$code_changed" -eq 0 ]; then
  echo "[G3] no source behavior changes detected; skip"
  exit 0
fi

if [ "$test_changed" -eq 1 ]; then
  echo "[G3] passed"
  exit 0
fi

if [ -n "$skip_reason" ]; then
  echo "[G3] source changes detected without test changes; exempted"
  echo "[G3] reason: $skip_reason"
  echo "[G3] document this exemption in the task verification.md (G8)"
  exit 0
fi

echo "[G3] source changes detected without matching test changes"
echo "[G3] add or update tests under tests/, or record an exemption:"
echo "[G3]   SCALE_GATE_SKIP_TESTS_REASON=\"<why no test update applies>\" bash scripts/gates/G3-verify.sh"
exit 1
