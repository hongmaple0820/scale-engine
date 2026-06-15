#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_FILE="$PROJECT_ROOT/.agent/state/current.json"
PY_STATE="$PROJECT_ROOT/scripts/lib/workflow_state.py"

echo "========================================"
echo "[G2] Plan gate"
echo "========================================"

PLAN_FILE=""
LEVEL=""

if [ -f "$STATE_FILE" ] && [ -f "$PY_STATE" ]; then
  ARTIFACTS_DIR="$(python3 "$PY_STATE" get "$STATE_FILE" artifacts_dir "" 2>/dev/null || true)"
  LEVEL="$(python3 "$PY_STATE" get "$STATE_FILE" level "" 2>/dev/null || true)"
  if [ -n "$ARTIFACTS_DIR" ] && [ -f "$PROJECT_ROOT/$ARTIFACTS_DIR/plan.md" ]; then
    PLAN_FILE="$PROJECT_ROOT/$ARTIFACTS_DIR/plan.md"
  fi
fi

if [ -z "$PLAN_FILE" ] && [ -d "$PROJECT_ROOT/.planning/tasks" ]; then
  PLAN_FILE="$(
    python3 - "$PROJECT_ROOT/.planning/tasks" <<'PY'
from pathlib import Path
import sys

root = Path(sys.argv[1])
plans = [path for path in root.rglob("plan.md") if path.is_file()]
if plans:
    print(max(plans, key=lambda path: path.stat().st_mtime))
PY
  )"
fi

if [ -z "$PLAN_FILE" ] || [ ! -f "$PLAN_FILE" ]; then
  echo "[G2] missing plan.md"
  echo "[G2] run: bash scripts/workflow/new-task.sh <task> M"
  exit 1
fi

echo "[G2] checking: $PLAN_FILE"
TASK_DIR="$(dirname "$PLAN_FILE")"

for required in runtime.md reality-check.md resource-cleanup.md; do
  if [ ! -f "$TASK_DIR/$required" ]; then
    echo "[G2] missing required task artifact: $required"
    exit 1
  fi
done

for heading in \
  "## Confirmed" \
  "## Not Verified" \
  "## Stub / Fake / Partial" \
  "## Credential-Gated" \
  "## Environment-Gated" \
  "## User-Visible Risk"; do
  if ! grep -Fq "$heading" "$TASK_DIR/reality-check.md"; then
    echo "[G2] reality-check.md missing required section: $heading"
    exit 1
  fi
done

if command -v powershell >/dev/null 2>&1; then
  powershell -NoProfile -ExecutionPolicy Bypass -File "$PROJECT_ROOT/scripts/workflow/check-reality.ps1" -Path "$TASK_DIR/reality-check.md"
elif command -v pwsh >/dev/null 2>&1; then
  pwsh -NoProfile -ExecutionPolicy Bypass -File "$PROJECT_ROOT/scripts/workflow/check-reality.ps1" -Path "$TASK_DIR/reality-check.md"
else
  echo "[G2] PowerShell unavailable; bash reality-check headings passed"
fi

if ! grep -Eiq "scope|boundary|boundaries|limit|non-goal" "$PLAN_FILE"; then
  echo "[G2] plan.md missing scope/boundary section"
  exit 1
fi

EXCEPTION_COUNT="$(grep -Eic "exception|error|fail|failure|rollback" "$PLAN_FILE" || true)"
if [ "${EXCEPTION_COUNT:-0}" -lt 3 ]; then
  echo "[G2] insufficient exception/error coverage: ${EXCEPTION_COUNT:-0} < 3"
  exit 1
fi

if ! grep -Eiq "rollback|recovery|disable|fallback" "$PLAN_FILE"; then
  echo "[G2] missing rollback/recovery strategy"
  exit 1
fi

if ! grep -Eiq "acceptance|success criteria|definition of done" "$PLAN_FILE"; then
  echo "[G2] missing acceptance criteria"
  exit 1
fi

case "$LEVEL" in
  L|CRITICAL)
    if ! grep -Eiq "human confirmation|review before execution" "$PLAN_FILE"; then
      echo "[G2] L/CRITICAL plan should record human confirmation requirement"
      exit 1
    fi
    ;;
esac

echo "[G2] passed"
echo "[G2] exception/error mentions: $EXCEPTION_COUNT"
