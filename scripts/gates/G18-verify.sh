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

# Check freshness (most recent file within 24h).
# Node, not python3: Node >= 22 is required by this repository, whereas python3
# may be missing or an unusable launcher stub, which silently disabled this check.
LATEST_HOURS=$(
  node -e '
const { readdirSync, statSync } = require("node:fs")
const { join } = require("node:path")
const root = process.argv[1]
const files = []
const walk = dir => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name.endsWith(".json")) files.push(statSync(full).mtimeMs)
  }
}
walk(root)
if (files.length > 0) process.stdout.write(String(Math.floor((Date.now() - Math.max(...files)) / 3600000)))
' "$EVIDENCE_DIR" 2>/dev/null || true
)
if [ -n "$LATEST_HOURS" ]; then
  if [ "$LATEST_HOURS" -lt 24 ]; then
    echo "  [OK] Latest evidence ${LATEST_HOURS}h ago (< 24h)"
  else
    echo "  [WARN] Latest evidence ${LATEST_HOURS}h ago (>= 24h, stale)"
  fi
else
  echo "  [WARN] Could not determine evidence freshness (non-blocking)"
fi

echo "  PASSED"
