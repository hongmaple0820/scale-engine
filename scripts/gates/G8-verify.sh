#!/usr/bin/env bash
# G8: document, config, and workflow artifact health.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "========================================"
echo "[G8] Documentation and artifact health"
echo "========================================"

cd "$PROJECT_ROOT"
node scripts/workflow/docs-health.mjs --report .agent/logs/docs-health/g8-docs-health-report.json
