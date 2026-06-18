#!/usr/bin/env bash
# G17: Documentation Hygiene - verify maintained and changed markdown links.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "[G17] Documentation Hygiene"
cd "$REPO_ROOT"
node scripts/workflow/docs-health.mjs \
  --check markdown-link-health \
  --report .agent/logs/docs-health/g17-link-health-report.json
