#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG="$ROOT/.scale/artifacts/dashboard-service/session-start-hook.log"
mkdir -p "$(dirname "$LOG")"

if command -v powershell.exe >/dev/null 2>&1; then
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ROOT/scripts/dashboard-service.ps1" ensure >>"$LOG" 2>&1 || true
elif command -v pwsh >/dev/null 2>&1; then
  pwsh -NoProfile -ExecutionPolicy Bypass -File "$ROOT/scripts/dashboard-service.ps1" ensure >>"$LOG" 2>&1 || true
elif [ -f "$ROOT/dist/api/cli.js" ]; then
  node "$ROOT/dist/api/cli.js" dashboard daemon ensure --dir "$ROOT" >>"$LOG" 2>&1 || true
fi
