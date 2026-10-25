#!/bin/bash
# Create an implementation plan directory and update workflow state.
# Usage: bash scripts/workflow/plan.sh "feature-name" [level]

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
  echo "[PLAN] usage: bash scripts/workflow/plan.sh feature-name [S|M|L|CRITICAL]"
  exit 1
fi

DATE="$(date +%Y-%m-%d)"
TASK_ID="${DATE}-${NAME}"
TASK_DIR="$PLANNING_TASKS/$TASK_ID"
STATE_DIR="$AGENT_STATE"
STATE_FILE="$STATE_DIR/current.json"
if [ -d "$PROJECT_ROOT/.scale/reports/workflow/templates" ]; then
  TEMPLATES="$PROJECT_ROOT/.scale/reports/workflow/templates"
else
  TEMPLATES="$PROJECT_ROOT/docs/workflow/templates"
fi
PY_STATE="$PROJECT_ROOT/scripts/lib/workflow_state.py"

mkdir -p "$TASK_DIR" "$STATE_DIR"

for file in explore.md mini-prd.md spec.md plan.md tasks.md runtime.md reality-check.md resource-cleanup.md verification.md review.md summary.md; do
  target="$TASK_DIR/$file"
  if [ -f "$TEMPLATES/$file" ]; then
    sed "s/{{TASK_ID}}/$TASK_ID/g; s/{{NAME}}/$NAME/g; s/{{DATE}}/$DATE/g; s/{{LEVEL}}/$LEVEL/g" "$TEMPLATES/$file" > "$target"
  else
    cat > "$target" <<EOF
# ${file%.md} - $NAME

Date: $DATE
Level: $LEVEL

Fill in this plan artifact.
EOF
  fi
done

python3 "$PY_STATE" plan "$STATE_FILE" "$TASK_ID" "$LEVEL" "${PLANNING_TASKS#"$PROJECT_ROOT"/}/$TASK_ID"

echo "[PLAN] task artifacts dir: $TASK_DIR"
echo "[PLAN] state: $STATE_FILE"
