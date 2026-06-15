#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ERRORS=0

echo "========================================"
echo "[VALIDATE] configuration"
echo "========================================"

REQUIRED_FILES=(
  "AGENTS.md"
  "CLAUDE.md"
  "README.md"
  "Makefile"
  ".scale/workspace.json"
  ".scale/governance.lock.json"
  ".scale/evals/suites/workflow-baseline.json"
  ".agent/project.json"
  ".claude/settings.json"
  ".claude/workflow.json"
)

echo "[CHECK] required files..."
for file in "${REQUIRED_FILES[@]}"; do
  if [ -f "$PROJECT_ROOT/$file" ]; then
    echo "[OK] $file"
  else
    echo "[ERROR] missing: $file"
    ERRORS=$((ERRORS+1))
  fi
done
echo ""

echo "[CHECK] executable scripts..."
REQUIRED_SCRIPTS=(
  "scripts/preflight/all.sh"
  "scripts/gates/all.sh"
  "scripts/hooks/check-dangerous-file.sh"
  "scripts/hooks/check-explore.sh"
  "scripts/hooks/check-tdd.sh"
  "scripts/hooks/check-context.sh"
  ".claude/hooks/session-start-reminder.sh"
  ".claude/hooks/gate-execute-phase.sh"
  ".claude/hooks/session-end-gate.sh"
  "scripts/workflow/verify.sh"
  "scripts/workflow/plan.sh"
  "scripts/gates/G8-verify.sh"
  "scripts/checkpoint/save.sh"
)

for script in "${REQUIRED_SCRIPTS[@]}"; do
  if [ -f "$PROJECT_ROOT/$script" ]; then
    if [ ! -x "$PROJECT_ROOT/$script" ]; then
      chmod +x "$PROJECT_ROOT/$script" 2>/dev/null || true
    fi
    echo "[OK] $script"
  else
    echo "[ERROR] missing: $script"
    ERRORS=$((ERRORS+1))
  fi
done
echo ""

echo "[CHECK] JSON files..."
if command -v python3 >/dev/null 2>&1; then
  python3 - "$PROJECT_ROOT" <<'PY' || ERRORS=$((ERRORS+1))
from __future__ import annotations
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
paths = [
    root / ".scale" / "workspace.json",
    root / ".scale" / "governance.lock.json",
    root / ".scale" / "evals" / "suites" / "workflow-baseline.json",
    root / ".agent" / "project.json",
    root / ".claude" / "settings.json",
    root / ".claude" / "workflow.json",
]

failed = False
for path in paths:
    try:
        with path.open(encoding="utf-8") as f:
            json.load(f)
        print(f"[OK] {path.relative_to(root)}")
    except Exception as exc:
        failed = True
        print(f"[ERROR] invalid JSON: {path.relative_to(root)} :: {exc}")

raise SystemExit(1 if failed else 0)
PY
else
  echo "[ERROR] python3 not available for JSON validation"
  ERRORS=$((ERRORS+1))
fi
echo ""

echo "[CHECK] Claude hooks..."
if command -v python3 >/dev/null 2>&1; then
  python3 - "$PROJECT_ROOT" <<'PY' || ERRORS=$((ERRORS+1))
from __future__ import annotations
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
settings = json.loads((root / ".claude" / "settings.json").read_text(encoding="utf-8"))
hooks = settings.get("hooks", {})
required = {
    "SessionStart": "bash .claude/hooks/session-start-reminder.sh",
    "PreToolUse": "bash scripts/hooks/check-dangerous-file.sh",
    "Stop": "bash .claude/hooks/session-end-gate.sh",
}

failed = False
for hook_name, command in required.items():
    entries = hooks.get(hook_name)
    if not isinstance(entries, list):
        print(f"[ERROR] missing hook group: {hook_name}")
        failed = True
        continue
    if not any(isinstance(entry, dict) and entry.get("command") == command for entry in entries):
        print(f"[ERROR] missing hook command for {hook_name}: {command}")
        failed = True
    else:
        print(f"[OK] {hook_name}: {command}")

raise SystemExit(1 if failed else 0)
PY
else
  echo "[ERROR] python3 not available for hook validation"
  ERRORS=$((ERRORS+1))
fi
echo ""

echo "[CHECK] shell LF endings..."
CRLF_FILES=$(python3 - "$PROJECT_ROOT" <<'PY'
from __future__ import annotations
import sys
from pathlib import Path

root = Path(sys.argv[1])
for base in [root / "scripts"]:
    if not base.exists():
        continue
    for path in base.rglob("*.sh"):
        try:
            data = path.read_bytes()
        except OSError:
            continue
        if b"\r\n" in data:
            print(path.relative_to(root))
PY
)

if [ -n "$CRLF_FILES" ]; then
  echo "[ERROR] shell scripts contain CRLF:"
  echo "$CRLF_FILES"
  ERRORS=$((ERRORS+1))
else
  echo "[OK] shell scripts use LF"
fi
echo ""

echo "[CHECK] portable shell features..."
if command -v python3 >/dev/null 2>&1; then
  python3 - "$PROJECT_ROOT" <<'PY' || ERRORS=$((ERRORS+1))
from __future__ import annotations
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
patterns = [
    (re.compile(r"\bmapfile\b"), "mapfile requires Bash 4; use a while-read loop"),
    (re.compile(r"\breadarray\b"), "readarray requires Bash 4; use a while-read loop"),
    (re.compile(r"\bdeclare\s+-A\b"), "associative arrays require Bash 4; aggregate with awk/python"),
    (re.compile(r"\bfind\b[^\n]*\s-printf\b"), "GNU find -printf is not available on stock macOS"),
]
failed = False
scan_roots = [root / "scripts", root / ".claude" / "hooks"]
for base in scan_roots:
    if not base.exists():
        continue
    for path in sorted(base.rglob("*.sh")):
        rel = path.relative_to(root)
        if rel.as_posix() == "scripts/validate-config.sh":
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for index, line in enumerate(text.splitlines(), start=1):
            for pattern, reason in patterns:
                if pattern.search(line):
                    failed = True
                    print(f"[ERROR] non-portable shell feature: {rel}:{index}: {reason}")
if not failed:
    print("[OK] shell scripts avoid Bash 4-only and GNU find -printf patterns")
raise SystemExit(1 if failed else 0)
PY
else
  echo "[ERROR] python3 not available for shell portability validation"
  ERRORS=$((ERRORS+1))
fi
echo ""

echo "========================================"
if [ "$ERRORS" -eq 0 ]; then
  echo "[VALIDATE] OK"
  exit 0
else
  echo "[VALIDATE] FAIL: $ERRORS issue(s)"
  exit 1
fi
