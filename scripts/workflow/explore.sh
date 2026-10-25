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
STATE_DIR="$AGENT_STATE"
STATE_FILE="$STATE_DIR/current.json"
EXPLORE_FILE="$STATE_DIR/explore.json"
PY_STATE="$PROJECT_ROOT/scripts/lib/workflow_state.py"

mkdir -p "$STATE_DIR"

if [ "$#" -eq 0 ]; then
  echo "usage: bash scripts/workflow/explore.sh file1 file2 \"main contradiction\""
  exit 1
fi

CONTRADICTION_PARTS=()
REAL_FILES=()
for item in "$@"; do
  if [ -f "$PROJECT_ROOT/$item" ]; then
    REAL_FILES+=("$item")
  else
    CONTRADICTION_PARTS+=("$item")
  fi
done

CONTRADICTION="${CONTRADICTION_PARTS[*]}"
python3 "$PY_STATE" explore "$STATE_FILE" "$EXPLORE_FILE" "$CONTRADICTION" "${REAL_FILES[@]}"
echo "[EXPLORE] recorded ${#REAL_FILES[@]} files"
echo "[EXPLORE] main contradiction: ${CONTRADICTION:-not set}"
