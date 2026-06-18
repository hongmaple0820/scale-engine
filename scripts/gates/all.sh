#!/usr/bin/env bash
# Run workflow and quality gates.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

DRY_RUN=false
MODE="all"
SERVICES=()

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/gates/all.sh [--dry-run] [--workflow|--quality|--fast-lane|--all] [--service <root|all>]

Examples:
  bash scripts/gates/all.sh --dry-run
  bash scripts/gates/all.sh --workflow
  bash scripts/gates/all.sh --fast-lane
  bash scripts/gates/all.sh --quality --service root
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      ;;
    --workflow)
      MODE="workflow"
      ;;
    --quality)
      MODE="quality"
      ;;
    --all)
      MODE="all"
      ;;
    --fast-lane)
      MODE="fast-lane"
      ;;
    --service)
      shift
      if [ -z "${1:-}" ]; then
        echo "[GATE] --service requires a value" >&2
        exit 1
      fi
      SERVICES+=("$1")
      ;;
    root|all)
      SERVICES+=("$1")
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[GATE] unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

case "$MODE" in
  workflow) GATES=(G1 G2 G3 G16) ;;
  quality) GATES=(G0 G4 G5 G6 G7 G8 G17 G18 G19 G20) ;;
  fast-lane) GATES=(G0 G3 G4 G5) ;;
  meta) GATES=(G9 G10 G11 G12 G13 G14 G15 G21 G22) ;;
  all) GATES=(G0 G1 G2 G3 G4 G5 G6 G7 G8 G16 G17 G18 G19 G20 G21 G22) ;;
  *)
    echo "[GATE] invalid mode: $MODE" >&2
    exit 1
    ;;
esac

PASSED=0
FAILED=0
SKIPPED=0
TOTAL_START_MS=$(date +%s 2>/dev/null || echo 0)
TOTAL_START_MS=$((TOTAL_START_MS * 1000))
GATE_TIMES=""

echo "========================================"
echo "[GATE] mode: $MODE"
echo "========================================"

for gate in "${GATES[@]}"; do
  script="$SCRIPT_DIR/${gate}-verify.sh"
  echo "[GATE] $gate"

  if [ ! -f "$script" ]; then
    echo "  skipped: missing $script"
    SKIPPED=$((SKIPPED + 1))
    GATE_TIMES="${GATE_TIMES}${gate}:skipped\n"
    continue
  fi

  if [ "$DRY_RUN" = true ]; then
    if bash -n "$script"; then
      echo "  schedulable"
      PASSED=$((PASSED + 1))
    else
      echo "  syntax failed"
      FAILED=$((FAILED + 1))
    fi
    GATE_TIMES="${GATE_TIMES}${gate}:dry-run\n"
    continue
  fi

  GATE_START_MS=$(date +%s 2>/dev/null || echo 0)
  GATE_START_MS=$((GATE_START_MS * 1000))

  if [[ "$gate" =~ ^G[4-7]$ ]]; then
    if bash "$script" "${SERVICES[@]}"; then
      PASSED=$((PASSED + 1))
    else
      FAILED=$((FAILED + 1))
    fi
  else
    if bash "$script"; then
      PASSED=$((PASSED + 1))
    else
      FAILED=$((FAILED + 1))
    fi
  fi

  GATE_END_MS=$(date +%s 2>/dev/null || echo 0)
  GATE_END_MS=$((GATE_END_MS * 1000))
  GATE_DURATION=$((GATE_END_MS - GATE_START_MS))
  echo "  duration: ${GATE_DURATION}ms"
  GATE_TIMES="${GATE_TIMES}${gate}:${GATE_DURATION}ms\n"
  echo ""
done

TOTAL_END_MS=$(date +%s 2>/dev/null || echo 0)
TOTAL_END_MS=$((TOTAL_END_MS * 1000))
TOTAL_DURATION=$((TOTAL_END_MS - TOTAL_START_MS))

echo "========================================"
echo "[GATE] summary"
echo "passed:  $PASSED"
echo "failed:  $FAILED"
echo "skipped: $SKIPPED"
echo "duration: ${TOTAL_DURATION}ms"
echo "========================================"

if [ -n "$GATE_TIMES" ]; then
  echo "[GATE] per-gate timing:"
  echo -e "$GATE_TIMES" | while IFS=: read -r g d; do
    if [ -n "$g" ]; then
      echo "  $g: $d"
    fi
  done
fi

if [ "$DRY_RUN" = true ]; then
  for node_script in \
    scripts/workflow/docs-health.mjs \
    scripts/workflow/run-vitest.mjs \
    scripts/workflow/setup-smoke.mjs
  do
    if [ -f "$PROJECT_ROOT/$node_script" ]; then
      echo "[DRY-RUN] node --check $node_script"
      if node --check "$PROJECT_ROOT/$node_script" >/dev/null; then
        echo "  schedulable"
      else
        echo "  syntax failed"
        FAILED=$((FAILED + 1))
      fi
    fi
  done
fi

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi

exit 0
