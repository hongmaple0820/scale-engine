#!/usr/bin/env bash
# Compatibility wrapper for the maintained documentation health gate.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ "${1:-}" = "all" ] || [ -z "${1:-}" ]; then
  exec node scripts/workflow/docs-health.mjs
fi

if [ -f "$1" ]; then
  exec node scripts/workflow/docs-health.mjs --check source-doc-health --check markdown-link-health
fi

echo "Usage: bash scripts/validate-docs.sh [all|file]" >&2
exit 2
