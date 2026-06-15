#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_FILE="$ROOT/.agent/state/current.json"
PY_STATE="$ROOT/scripts/lib/workflow_state.py"

cd "$ROOT"

resolve_powershell() {
  if command -v pwsh >/dev/null 2>&1; then
    command -v pwsh
    return 0
  fi
  if command -v powershell >/dev/null 2>&1; then
    command -v powershell
    return 0
  fi
  return 1
}

run_powershell_file() {
  local script="$1"
  shift
  local ps
  ps="$(resolve_powershell)" || return 127
  case "$(uname -s 2>/dev/null || echo unknown)" in
    MINGW*|MSYS*|CYGWIN*|Windows_NT)
      "$ps" -NoProfile -ExecutionPolicy Bypass -File "$script" "$@"
      ;;
    *)
      "$ps" -NoProfile -File "$script" "$@"
      ;;
  esac
}

run_diff_check() {
  git diff --check -- "$@" >/dev/null
}

if [ -f "$STATE_FILE" ]; then
  FILES_MODIFIED="$(python3 "$PY_STATE" get "$STATE_FILE" files_modified "" | tr ',' '\n' | sed 's/^ *//; s/ *$//' | sed '/^$/d')"
  if [ -n "$FILES_MODIFIED" ]; then
    PATHS=()
    while IFS= read -r path; do
      [ -n "$path" ] && PATHS+=("$path")
    done <<EOF
$FILES_MODIFIED
EOF
    run_diff_check "${PATHS[@]}"
  fi
else
  echo "[G6] no active workflow state; skip scoped diff check and rely on explicit git diff --check in final verification"
fi

if [ -f "$STATE_FILE" ]; then
  LEVEL=$(python3 "$PY_STATE" get "$STATE_FILE" level "")
  ARTIFACTS=$(python3 "$PY_STATE" get "$STATE_FILE" artifacts_dir "")
  case "$LEVEL" in
    M|L|CRITICAL)
      if [ -z "$ARTIFACTS" ] || [ ! -d "$ROOT/$ARTIFACTS" ]; then
        echo "[G6] task artifacts_dir missing"
        exit 1
      fi
      for file in explore.md plan.md runtime.md reality-check.md resource-cleanup.md verification.md review.md summary.md; do
        if [ ! -f "$ROOT/$ARTIFACTS/$file" ]; then
          echo "[G6] missing task artifact: $file"
          exit 1
        fi
      done
      ;;
  esac
fi

if resolve_powershell >/dev/null 2>&1; then
  run_powershell_file "$ROOT/scripts/workflow/check-docs-scope.ps1"
fi

echo "[G6] diff hygiene and task artifacts present"
