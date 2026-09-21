#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG="$ROOT/.agent/project.json"
PROFILE="default"
SERVICE=""
LIST=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --profile)
      PROFILE="${2:-}"
      shift 2
      ;;
    --service)
      SERVICE="${2:-}"
      shift 2
      ;;
    --list)
      LIST=true
      shift
      ;;
    *)
      echo "usage: bash scripts/workflow/verify.sh [--profile name] [--service name] [--list]"
      exit 2
      ;;
  esac
done

if [ ! -f "$CONFIG" ]; then
  echo "[VERIFY] missing .agent/project.json"
  exit 1
fi

run_check_command() {
  local relative_path="$1"
  local command="$2"
  local workdir="$ROOT/$relative_path"

  # In Windows-hosted worktrees, WSL/Linux Node can pick up Windows node_modules
  # and miss platform-specific optional packages such as Rollup native builds.
  # Prefer Windows PowerShell for npm/npx checks when the checkout is under /mnt.
  if command -v powershell.exe >/dev/null 2>&1; then
    local physical_dir
    physical_dir="$(cd "$workdir" && pwd -P)"
    if [[ "$physical_dir" == /mnt/* ]] && [[ "$command" =~ ^(npm|npx)[[:space:]] ]]; then
      local win_dir escaped_dir escaped_command
      win_dir="$(wslpath -w "$physical_dir" 2>/dev/null || printf '%s' "$physical_dir")"
      escaped_dir="${win_dir//\'/\'\'}"
      escaped_command="${command//\'/\'\'}"
      powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '$escaped_dir'; cmd.exe /d /c '$escaped_command'" < /dev/null
      return $?
    fi
  fi

  (cd "$workdir" && bash -lc "$command") < /dev/null
}

if [ "$LIST" = true ]; then
  node - "$CONFIG" <<'JS'
const { readFileSync } = require('node:fs')
const cfg = JSON.parse(readFileSync(process.argv[2], 'utf-8'))
console.log('profiles:')
for (const name of Object.keys(cfg.profiles ?? {}).sort()) console.log(`  - ${name}`)
console.log('services:')
for (const [name, service] of Object.entries(cfg.services ?? {}).sort()) {
  console.log(`  - ${name}: ${service.path ?? '.'}`)
}
JS
  exit 0
fi

if [ "$PROFILE" = "scaffold" ] && [ -z "$SERVICE" ]; then
  node "$ROOT/scripts/workflow/docs-health.mjs" --report .agent/logs/docs-health/verify-scaffold-report.json
  node "$ROOT/scripts/workflow/learning-health.mjs" --report .agent/logs/learning-health/verify-scaffold-report.json
  bash "$ROOT/scripts/workflow/lint-scaffold.sh"
  bash "$ROOT/scripts/gates/all.sh" --dry-run
  echo "[VERIFY] profile scaffold passed"
  exit 0
fi

PLAN="$(node "$ROOT/scripts/workflow/verify-plan.mjs" "$CONFIG" "$PROFILE" "$SERVICE")"

STATUS=0
while IFS=$'\t' read -r kind name path check tools command; do
  [ -z "$kind" ] && continue
  case "$kind" in
    ERROR)
      echo "[VERIFY] $name"
      STATUS=1
      ;;
    SKIP)
      echo "[VERIFY] skip $name/$check: $command"
      ;;
    RUN)
      IFS=',' read -ra tool_list <<< "$tools"
      for tool in "${tool_list[@]}"; do
        if [ -n "$tool" ] && [ "$tool" != "-" ] && ! command -v "$tool" >/dev/null 2>&1; then
          echo "[VERIFY] missing tool for $name/$check: $tool"
          STATUS=1
        fi
      done
      if [ "$STATUS" -ne 0 ]; then
        continue
      fi
      log_dir="$ROOT/.agent/logs/$name"
      mkdir -p "$log_dir"
      echo "[VERIFY] run $name/$check"
      if ! run_check_command "$path" "$command" >"$log_dir/$check.log" 2>&1; then
        echo "[VERIFY] failed $name/$check; log: .agent/logs/$name/$check.log"
        STATUS=1
      fi
      ;;
  esac
done <<< "$PLAN"

if [ "$STATUS" -ne 0 ]; then
  echo "[VERIFY] failed"
  exit "$STATUS"
fi

echo "[VERIFY] passed"
