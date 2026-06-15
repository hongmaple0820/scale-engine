#!/usr/bin/env bash
# G18: Runtime Evidence — verify runtime evidence exists and is fresh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "[G18] Runtime Evidence"
echo "  Checking evidence directory..."

cd "$REPO_ROOT"

SCALE_DIR="${SCALE_DIR:-.scale}"
EVIDENCE_DIR="$SCALE_DIR/evidence"

if [ ! -d "$EVIDENCE_DIR" ]; then
  echo "  [BLOCK] No $EVIDENCE_DIR directory found"
  exit 1
fi

EVIDENCE_COUNT=$(find "$EVIDENCE_DIR" -name "*.json" -type f 2>/dev/null | wc -l | tr -d ' ')
echo "  [INFO] $EVIDENCE_COUNT evidence file(s)"

if [ "$EVIDENCE_COUNT" -eq 0 ]; then
  echo "  [BLOCK] No evidence files found"
  exit 1
fi

# Check freshness (most recent file within 24h)
LATEST_HOURS=$(
  python3 - "$EVIDENCE_DIR" <<'PY'
from pathlib import Path
import sys
import time

root = Path(sys.argv[1])
files = [path for path in root.rglob("*.json") if path.is_file()]
if files:
    latest = max(files, key=lambda path: path.stat().st_mtime)
    print(int((time.time() - latest.stat().st_mtime) // 3600))
PY
)
if [ -n "$LATEST_HOURS" ]; then
  if [ "$LATEST_HOURS" -lt 24 ]; then
    echo "  [OK] Latest evidence ${LATEST_HOURS}h ago (< 24h)"
  else
    echo "  [WARN] Latest evidence ${LATEST_HOURS}h ago (>= 24h, stale)"
  fi
fi

echo "  PASSED"
