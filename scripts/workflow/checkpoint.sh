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
PHASE="${1:-execute}"

python3 "$PY_STATE" checkpoint "$STATE_FILE" "$PROJECT_ROOT" "$PHASE"

echo "[CHECKPOINT] saved: phase=$PHASE"
echo "[CHECKPOINT] state: $STATE_FILE"
