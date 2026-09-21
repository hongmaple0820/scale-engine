#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "[G4] Lint"
cd "$ROOT"

# Sub-step 1: Shell script syntax validation
echo "  [G4] Checking shell script syntax..."
SCRIPTS=(
  "$ROOT/scripts/gates/all.sh"
  "$ROOT/scripts/gates/G1-verify.sh"
  "$ROOT/scripts/gates/G2-verify.sh"
  "$ROOT/scripts/gates/G3-verify.sh"
  "$ROOT/scripts/gates/G4-verify.sh"
  "$ROOT/scripts/gates/G5-verify.sh"
  "$ROOT/scripts/gates/G6-verify.sh"
  "$ROOT/scripts/gates/G7-verify.sh"
  "$ROOT/scripts/init-plan.sh"
  "$ROOT/scripts/preflight/all.sh"
  "$ROOT/scripts/checkpoint/save.sh"
  "$ROOT/scripts/checkpoint/resume.sh"
  "$ROOT/scripts/workflow/new-task.sh"
  "$ROOT/scripts/workflow/explore.sh"
  "$ROOT/scripts/workflow/checkpoint.sh"
  "$ROOT/scripts/workflow/resume.sh"
  "$ROOT/scripts/workflow/lint-scaffold.sh"
  "$ROOT/scripts/workflow/verify.sh"
)

for script in "${SCRIPTS[@]}"; do
  [ -f "$script" ] && bash -n "$script"
done

[ -f "$ROOT/scripts/lib/workflow_state.py" ] && {
  if py_output=$(python3 -m py_compile "$ROOT/scripts/lib/workflow_state.py" 2>&1); then
    :
  elif printf '%s' "$py_output" | grep -q 'SyntaxError'; then
    echo "  [BLOCK] python3 syntax error in scripts/lib/workflow_state.py"
    printf '%s\n' "$py_output"
    exit 1
  else
    # python3 present but unusable in this shell (Windows App Execution Alias stub,
    # missing interpreter). Non-blocking, same policy as the missing .ps1 helpers below.
    echo "  [WARN] python3 unavailable for py_compile (non-blocking)"
  fi
}

for script in \
  "$ROOT/scripts/workflow/check-reality.ps1" \
  "$ROOT/scripts/workflow/check-docs-scope.ps1" \
  "$ROOT/scripts/workflow/write-runtime-contract.ps1"; do
  [ -f "$script" ] || { echo "  [WARN] missing $script (non-blocking)"; }
done

echo "  [OK] Shell script syntax passed"

# Sub-step 2: TypeScript lint (ESLint)
echo "  [G4] Running TypeScript lint..."
if npm run lint 2>&1; then
  echo "  [OK] TypeScript lint passed"
else
  echo "  [BLOCK] TypeScript lint failed"
  exit 1
fi

echo "  PASSED"
