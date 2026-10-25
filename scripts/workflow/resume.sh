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
STATE_FILE="$AGENT_STATE/current.json"
PY_STATE="$PROJECT_ROOT/scripts/lib/workflow_state.py"

if [ ! -f "$STATE_FILE" ]; then
  echo "[RESUME] no workflow state"
  exit 0
fi

for key in task_id level phase updated_at artifacts_dir runtime_contract reality_check resource_cleanup explored_files main_contradiction completed_gates open_tasks files_modified; do
  value=$(python3 "$PY_STATE" get "$STATE_FILE" "$key" "")
  printf "%-20s %s\n" "$key:" "$value"
done

TASK_ID=$(python3 "$PY_STATE" get "$STATE_FILE" task_id "")
PHASE=$(python3 "$PY_STATE" get "$STATE_FILE" phase "")
ARTIFACTS=$(python3 "$PY_STATE" get "$STATE_FILE" artifacts_dir "")

echo ""
case "$PHASE" in
  explore)
    echo "next: fill $ARTIFACTS/plan.md, $ARTIFACTS/runtime.md, and $ARTIFACTS/reality-check.md, then run make gate-workflow"
    ;;
  plan)
    echo "next: execute $ARTIFACTS/plan.md, then run make checkpoint PHASE=execute"
    ;;
  execute)
    echo "next: run make gate-quality and update $ARTIFACTS/verification.md"
    ;;
  verify)
    echo "next: update $ARTIFACTS/review.md, $ARTIFACTS/summary.md, and $ARTIFACTS/resource-cleanup.md"
    ;;
  done)
    echo "next: review final diff and prepare handoff"
    ;;
  *)
    echo "next: inspect current task ${TASK_ID:-unknown} and choose the next workflow phase"
    ;;
esac
