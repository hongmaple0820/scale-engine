#!/bin/bash
if [ -z "${PROJECT_ROOT:-}" ]; then
    PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi

PROJECT_CONFIG_FILE="$PROJECT_ROOT/.agent/project.json"

require_project_config() {
    if [ ! -f "$PROJECT_CONFIG_FILE" ]; then
        echo "[CONFIG] missing .agent/project.json"
        exit 1
    fi
    if ! command -v jq >/dev/null 2>&1 && ! command -v python3 >/dev/null 2>&1; then
        echo "[CONFIG] missing jq or python3"
        exit 1
    fi
}

configured_stack() {
    require_project_config
    if command -v jq >/dev/null 2>&1; then
        jq -r '.stack // "auto"' "$PROJECT_CONFIG_FILE" | tr -d '\r'
    else
        python3 - "$PROJECT_CONFIG_FILE" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
print(data.get("stack") or "auto")
PY
    fi
}

detect_stack() {
    require_project_config
    local selected
    selected="$(configured_stack)"
    if [ "$selected" != "auto" ] && [ "$selected" != "null" ] && [ -n "$selected" ]; then
        echo "$selected"
        return 0
    fi

    if ! command -v jq >/dev/null 2>&1; then
        detected="$(python3 - "$PROJECT_CONFIG_FILE" "$PROJECT_ROOT" <<'PY'
import json
import pathlib
import sys
with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
root = pathlib.Path(sys.argv[2])
for stack, cfg in (data.get("stacks") or {}).items():
    for marker in cfg.get("detect") or []:
        if (root / marker).exists():
            print(stack)
            raise SystemExit(0)
print("none")
PY
)"
        # python3 may be present but unusable (Windows App Execution Alias stub,
        # missing interpreter). Report "none" rather than an empty stack, which
        # downstream gates would misread as an unknown stack.
        if [ -n "$detected" ] && [ "$detected" != "null" ]; then
            echo "$detected"
        else
            echo "none"
        fi
        return 0
    fi

    while IFS= read -r stack; do
        while IFS= read -r marker; do
            if [ -e "$PROJECT_ROOT/$marker" ]; then
                echo "$stack"
                return 0
            fi
        done < <(jq -r --arg stack "$stack" '.stacks[$stack].detect[]?' "$PROJECT_CONFIG_FILE" | tr -d '\r')
    done < <(jq -r '.stacks | keys[]' "$PROJECT_CONFIG_FILE" | tr -d '\r')

    echo "none"
}

stack_exists() {
    local stack="$1"
    require_project_config
    if command -v jq >/dev/null 2>&1; then
        jq -e --arg stack "$stack" '.stacks[$stack] != null' "$PROJECT_CONFIG_FILE" >/dev/null
    else
        python3 - "$PROJECT_CONFIG_FILE" "$stack" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
raise SystemExit(0 if sys.argv[2] in (data.get("stacks") or {}) else 1)
PY
    fi
}

gate_command() {
    local stack="$1"
    local gate="$2"
    require_project_config
    if command -v jq >/dev/null 2>&1; then
        jq -r --arg stack "$stack" --arg gate "$gate" '.stacks[$stack].commands[$gate] // empty' "$PROJECT_CONFIG_FILE" | tr -d '\r'
    else
        python3 - "$PROJECT_CONFIG_FILE" "$stack" "$gate" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
print(((data.get("stacks") or {}).get(sys.argv[2]) or {}).get("commands", {}).get(sys.argv[3], ""))
PY
    fi
}

required_tools() {
    local stack="$1"
    local gate="$2"
    require_project_config
    if command -v jq >/dev/null 2>&1; then
        jq -r --arg stack "$stack" --arg gate "$gate" '(.stacks[$stack].required_tools[$gate] // [])[]' "$PROJECT_CONFIG_FILE" | tr -d '\r'
    else
        python3 - "$PROJECT_CONFIG_FILE" "$stack" "$gate" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
tools = (((data.get("stacks") or {}).get(sys.argv[2]) or {}).get("required_tools", {}).get(sys.argv[3]) or [])
print("\n".join(tools))
PY
    fi
}

check_required_tools() {
    local stack="$1"
    local gate="$2"
    local missing=0

    while IFS= read -r tool; do
        if [ -n "$tool" ] && ! command -v "$tool" >/dev/null 2>&1; then
            echo "[$gate] missing tool: $tool"
            missing=$((missing+1))
        fi
    done < <(required_tools "$stack" "$gate")

    if [ "$missing" -gt 0 ]; then
        return 1
    fi
}

run_gate_command() {
    local stack="$1"
    local gate="$2"
    local command="$3"
    local label="${4:-$gate}"

    if [ -z "$command" ]; then
        echo "[$label] skip: no $gate command configured for $stack"
        return 0
    fi

    check_required_tools "$stack" "$gate"
    mkdir -p "$PROJECT_ROOT/.agent/logs"
    (cd "$PROJECT_ROOT" && bash -lc "$command")
}
