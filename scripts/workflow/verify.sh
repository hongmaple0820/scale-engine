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
  python3 - "$CONFIG" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as f:
    cfg = json.load(f)
print("profiles:")
for name in sorted((cfg.get("profiles") or {}).keys()):
    print(f"  - {name}")
print("services:")
for name, service in sorted((cfg.get("services") or {}).items()):
    print(f"  - {name}: {service.get('path', '.')}")
PY
  exit 0
fi

if [ "$PROFILE" = "scaffold" ] && [ -z "$SERVICE" ]; then
  node "$ROOT/scripts/workflow/docs-health.mjs" --report .agent/logs/docs-health/verify-scaffold-report.json
  bash "$ROOT/scripts/workflow/lint-scaffold.sh"
  bash "$ROOT/scripts/gates/all.sh" --dry-run
  echo "[VERIFY] profile scaffold passed"
  exit 0
fi

PLAN="$(
python3 - "$CONFIG" "$PROFILE" "$SERVICE" <<'PY'
import json
import sys

config_path, profile_name, selected_service = sys.argv[1:4]
with open(config_path, encoding="utf-8") as f:
    cfg = json.load(f)

profiles = cfg.get("profiles") or {}
services = cfg.get("services") or {}
stacks = cfg.get("stacks") or {}

if selected_service:
    service_names = [selected_service]
    checks = (profiles.get(profile_name) or {}).get("checks") or ["lint", "test"]
else:
    profile = profiles.get(profile_name)
    if profile is None:
        print(f"ERROR\tunknown profile: {profile_name}")
        raise SystemExit(0)
    service_names = profile.get("services") or []
    checks = profile.get("checks") or ["lint", "test"]
    if service_names == "*":
        service_names = sorted(services.keys())

if not service_names:
    print(f"ERROR\tprofile has no services: {profile_name}")
    raise SystemExit(0)

for name in service_names:
    service = services.get(name)
    if not service:
        print(f"ERROR\tunknown service: {name}")
        continue
    stack_name = service.get("stack") or "custom"
    stack = stacks.get(stack_name) or {}
    commands = dict(stack.get("commands") or {})
    commands.update(service.get("commands") or {})
    required_tools = dict(stack.get("required_tools") or {})
    required_tools.update(service.get("required_tools") or {})
    path = service.get("path") or "."
    for check in checks:
        command = commands.get(check)
        if not command:
            print(f"SKIP\t{name}\t{path}\t{check}\tno command configured")
            continue
        tools = ",".join(required_tools.get(check) or []) or "-"
        print(f"RUN\t{name}\t{path}\t{check}\t{tools}\t{command}")
PY
)"

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
