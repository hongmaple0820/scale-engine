#!/usr/bin/env bash
# Measure gate execution times and produce a CSV report.
# Usage: bash scripts/performance/measure-gates.sh [--runs N] [--mode fast-lane|workflow|all] [--output FILE]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
GATES_SCRIPT="$PROJECT_DIR/scripts/gates/all.sh"

RUNS=3
MODE="fast-lane"
OUTPUT="$PROJECT_DIR/performance-trend.csv"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --runs) shift; RUNS="$1" ;;
    --mode) shift; MODE="$1" ;;
    --output) shift; OUTPUT="$1" ;;
    -h|--help)
      echo "Usage: $0 [--runs N] [--mode fast-lane|workflow|all] [--output FILE]"
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
  shift
done

echo "============================================"
echo " SCALE Engine — Performance Measurement"
echo "============================================"
echo " Mode:     $MODE"
echo " Runs:     $RUNS"
echo " Output:   $OUTPUT"
echo " Date:     $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo " Machine:  $(uname -s) $(uname -m)"
echo " Node:     $(node --version 2>/dev/null || echo 'N/A')"
echo "============================================"
echo ""

# CSV header
echo "run,gate,duration_ms,status" > "$OUTPUT"

TOTAL_SUM=0

for run in $(seq 1 "$RUNS"); do
  echo "--- Run $run/$RUNS ---"
  RUN_START=$(date +%s 2>/dev/null || echo 0)
  RUN_START=$((RUN_START * 1000))

  # Run gates and capture output
  GATE_OUTPUT=$(bash "$GATES_SCRIPT" "--$MODE" 2>&1) || true

  RUN_END=$(date +%s 2>/dev/null || echo 0)
  RUN_END=$((RUN_END * 1000))
  RUN_DURATION=$((RUN_END - RUN_START))

  # Parse per-gate timing from output
  while IFS= read -r line; do
    if [[ "$line" =~ ^\[GATE\]\ ([A-Z0-9]+)$ ]]; then
      CURRENT_GATE="${BASH_REMATCH[1]}"
    elif [[ "$line" =~ ^[[:space:]]+duration:\ ([0-9]+)ms$ ]] && [ -n "${CURRENT_GATE:-}" ]; then
      DURATION="${BASH_REMATCH[1]}"
      echo "$run,$CURRENT_GATE,$DURATION,pass" >> "$OUTPUT"
      CURRENT_GATE=""
    elif [[ "$line" =~ ^[[:space:]]+skipped ]]; then
      if [ -n "${CURRENT_GATE:-}" ]; then
        echo "$run,$CURRENT_GATE,0,skipped" >> "$OUTPUT"
        CURRENT_GATE=""
      fi
    fi
  done <<< "$GATE_OUTPUT"

  TOTAL_SUM=$((TOTAL_SUM + RUN_DURATION))
  echo "  Total: ${RUN_DURATION}ms"
  echo ""
done

# Summary
echo "============================================"
echo " Summary ($RUNS runs, mode: $MODE)"
echo "============================================"
echo ""
echo " Per-gate averages:"
awk -F, '
  NR > 1 && $4 == "pass" {
    total[$2] += $3
    count[$2] += 1
  }
  END {
    for (gate in total) {
      printf "%s,%d,%d\n", gate, total[gate] / count[gate], count[gate]
    }
  }
' "$OUTPUT" | sort | while IFS=, read -r gate avg count; do
  [ -n "$gate" ] && echo "  $gate: ${avg}ms avg (${count} samples)"
done

if [ "$RUNS" -gt 0 ]; then
  echo ""
  echo " Total average: $((TOTAL_SUM / RUNS))ms"
fi

echo ""
echo " CSV written to: $OUTPUT"
echo "============================================"
