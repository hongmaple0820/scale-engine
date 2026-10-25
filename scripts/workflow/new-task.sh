#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Output governance (plan 2026-10-24): scale projects keep workflow state under
# .scale/state/; legacy projects keep .planning/ and .agent/state as-is.
if [ -d "$PROJECT_ROOT/.scale" ]; then
  PLANNING_TASKS="$PROJECT_ROOT/.scale/state/planning/tasks"
  AGENT_STATE="$PROJECT_ROOT/.scale/state/agent"
else
  PLANNING_TASKS="$PROJECT_ROOT/.planning/tasks"
  AGENT_STATE="$PROJECT_ROOT/.agent/state"
fi
NAME="${1:-}"
LEVEL="${2:-M}"

if [ -z "$NAME" ]; then
  echo "usage: bash scripts/workflow/new-task.sh task-slug [S|M|L|CRITICAL]"
  exit 1
fi

case "$LEVEL" in
  S|M|L|CRITICAL) ;;
  *)
    echo "invalid level: $LEVEL"
    exit 1
    ;;
esac

DATE="$(date +%Y-%m-%d)"
TASK_ID="$DATE-$NAME"
TASK_DIR="$PLANNING_TASKS/$TASK_ID"
STATE_DIR="$AGENT_STATE"
STATE_FILE="$STATE_DIR/current.json"
PY_STATE="$PROJECT_ROOT/scripts/lib/workflow_state.py"
TEMPLATE_DIR="$PROJECT_ROOT/docs/workflow/templates"

mkdir -p "$TASK_DIR" "$STATE_DIR"

for file in explore.md mini-prd.md plan.md runtime.md reality-check.md resource-cleanup.md verification.md review.md summary.md; do
  target="$TASK_DIR/$file"
  if [ ! -f "$target" ]; then
    if [ -f "$TEMPLATE_DIR/$file" ]; then
      sed "s/{{TASK_ID}}/$TASK_ID/g; s/{{DATE}}/$DATE/g; s/{{LEVEL}}/$LEVEL/g; s/{{TASK_SLUG}}/$NAME/g" "$TEMPLATE_DIR/$file" > "$target"
    else
      printf '# %s - %s\n\nDate: %s\nLevel: %s\n\n## Notes\n\n- TODO\n' "${file%.md}" "$TASK_ID" "$DATE" "$LEVEL" > "$target"
    fi
  fi
done

python3 "$PY_STATE" init "$STATE_FILE" "$TASK_ID" "$LEVEL" "${PLANNING_TASKS#"$PROJECT_ROOT"/}/$TASK_ID"
echo "[NEW-TASK] created: $TASK_DIR"
echo "[NEW-TASK] state: $STATE_FILE"
echo "[NEW-TASK] next: fill explore.md, runtime.md, and reality-check.md before execution"
