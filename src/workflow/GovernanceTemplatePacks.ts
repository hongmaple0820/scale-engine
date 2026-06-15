import type { GovernanceMode } from './GovernanceTemplates.js'
import type { VerificationService } from './VerificationProfile.js'
import { workspaceTopologyTemplate } from './WorkspaceTopology.js'
import { defaultWorkflowEvalSuite } from '../eval/WorkflowEval.js'

export type GovernancePackId =
  | 'standard'
  | 'project-scaffold'
  | 'scale-engine-repo'
  | 'moe-workspace'
  | 'resource-governance'
  | 'go-service-matrix'
  | 'node-library'
  | 'frontend-app'
  | 'solo-dev'

export interface GovernanceGeneratedFile {
  path: string
  kind: 'doc' | 'template' | 'script' | 'config'
  owned: boolean
  content: string
}

export interface GovernancePackModeConfig {
  artifactGate: 'off' | 'warn' | 'block'
  skillRoutingMode: 'off' | 'warn' | 'block'
}

export interface GovernanceTemplatePack {
  id: GovernancePackId
  version: number
  description: string
  modeDefaults: Record<GovernanceMode, GovernancePackModeConfig>
  defaultServices?: VerificationService[]
  exclude?: string[]
  generatedFiles: GovernanceGeneratedFile[]
}

export function listGovernanceTemplatePacks(): GovernanceTemplatePack[] {
  return PACKS
}

export function resolveGovernanceTemplatePack(id: string | string[] | undefined): GovernanceTemplatePack {
  const normalized = normalizeGovernancePackId(id)
  const pack = PACKS.find(candidate => candidate.id === normalized)
  if (!pack) {
    const supported = PACKS.map(candidate => candidate.id).join(', ')
    throw new Error(`Unknown governance pack "${id}". Supported packs: ${supported}`)
  }
  return pack
}

function normalizeGovernancePackId(id: string | string[] | undefined): GovernancePackId {
  if (Array.isArray(id)) {
    const lastValid = [...id].reverse().find(value => PACKS.some(candidate => candidate.id === value))
    return (lastValid ?? id[id.length - 1] ?? 'standard') as GovernancePackId
  }
  return (id || 'standard') as GovernancePackId
}

const modeDefaults: GovernanceTemplatePack['modeDefaults'] = {
  minimal: { artifactGate: 'off', skillRoutingMode: 'warn' },
  standard: { artifactGate: 'warn', skillRoutingMode: 'warn' },
  critical: { artifactGate: 'block', skillRoutingMode: 'block' },
}

const PACKS: GovernanceTemplatePack[] = [
  {
    id: 'standard',
    version: 1,
    description: 'Generic SCALE governance output.',
    modeDefaults,
    generatedFiles: [],
  },
  {
    id: 'project-scaffold',
    version: 2,
    description: 'Reference project governance scaffold with workflow wrappers.',
    modeDefaults,
    generatedFiles: workflowWrapperFiles(),
  },
  {
    id: 'scale-engine-repo',
    version: 1,
    description: 'Self-hosted repository workflow for developing scale-engine itself.',
    modeDefaults,
    generatedFiles: scaleEngineRepoFiles(),
  },
  {
    id: 'moe-workspace',
    version: 1,
    description: 'MOE multi-repository workspace governance with explicit topology and finish policy.',
    modeDefaults,
    generatedFiles: [
      { path: '.scale/workspace.json', kind: 'config', owned: true, content: workspaceTopologyTemplate({ topology: 'moe' }) },
      { path: 'docs/workflow/moe-workspace.md', kind: 'doc', owned: true, content: moeWorkspaceGuide() },
    ],
  },
  {
    id: 'resource-governance',
    version: 1,
    description: 'Project resource lifecycle governance for docs, media, reports, scripts, and temporary outputs.',
    modeDefaults,
    generatedFiles: [
      { path: 'docs/workflow/resource-governance.md', kind: 'doc', owned: true, content: resourceGovernanceGuide() },
      { path: 'docs/modules/README.md', kind: 'doc', owned: true, content: moduleDocsIndex() },
      { path: 'docs/workflow/templates/.gitignore.scale-assets.example', kind: 'template', owned: true, content: resourceGitignoreExample() },
    ],
  },
  {
    id: 'go-service-matrix',
    version: 1,
    description: 'Go multi-service repository governance.',
    modeDefaults,
    defaultServices: [
      { name: 'netdisk', path: 'amdox-go-netdisk', type: 'go', required: true },
      { name: 'auth', path: 'amdox-go-auth', type: 'go', required: true },
      { name: 'gateway', path: 'amdox-go-gateway', type: 'go', required: true },
    ],
    exclude: ['OpenList', 'gfast', 'mcp-zero'],
    generatedFiles: [],
  },
  {
    id: 'node-library',
    version: 2,
    description: 'Node/npm library governance with build, test, diff, and pack checks.',
    modeDefaults,
    generatedFiles: [
      ...workflowWrapperFiles(),
      { path: 'scripts/preflight/all.sh', kind: 'script', owned: true, content: nodeLibraryPreflightShellScript() },
      { path: 'scripts/preflight/all.ps1', kind: 'script', owned: true, content: nodeLibraryPreflightPowerShellScript() },
      { path: '.scale/workspace.json', kind: 'config', owned: true, content: workspaceTopologyTemplate({ topology: 'single' }) },
      { path: 'docs/workflow/node-library.md', kind: 'doc', owned: true, content: nodeLibraryGuide() },
      { path: '.planning/tasks/.gitkeep', kind: 'config', owned: true, content: '' },
    ],
  },
  {
    id: 'frontend-app',
    version: 1,
    description: 'Frontend app governance with UI and visual evidence requirements.',
    modeDefaults,
    generatedFiles: [],
  },
  {
    id: 'solo-dev',
    version: 1,
    description: 'Lightweight governance for solo developers — warns instead of blocking, minimal overhead.',
    modeDefaults: {
      minimal: { artifactGate: 'off' as const, skillRoutingMode: 'off' as const },
      standard: { artifactGate: 'warn' as const, skillRoutingMode: 'warn' as const },
      critical: { artifactGate: 'warn' as const, skillRoutingMode: 'warn' as const },
    },
    defaultServices: [],
    generatedFiles: [
      { path: '.scale/config.yaml', kind: 'config' as const, owned: true, content: '' },
      { path: '.scale/workspace.json', kind: 'config' as const, owned: true, content: '' },
    ],
  },
]

function workflowWrapper(label: string, scaleCommand: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail

is_wsl() {
  grep -qiE "(microsoft|wsl)" /proc/version /proc/sys/kernel/osrelease 2>/dev/null
}

is_windows_npm_shim() {
  local command_path="$1"
  printf '%s' "$command_path" | grep -qiE '^/mnt/[a-z]/.*nodejs/[^/]+$'
}

run_scale() {
  local scale_path=""
  scale_path="$(command -v scale 2>/dev/null || true)"
  if [ -n "$scale_path" ]; then
    if is_wsl && is_windows_npm_shim "$scale_path"; then
      echo "[scale-engine] Windows npm scale was detected inside WSL: $scale_path" >&2
      echo "[scale-engine] Use the matching PowerShell wrapper (*.ps1), or install scale-engine inside WSL with a Linux Node.js toolchain." >&2
      return 2
    fi
    scale "$@"
  else
    local npx_path=""
    npx_path="$(command -v npx 2>/dev/null || true)"
    if [ -n "$npx_path" ] && is_wsl && is_windows_npm_shim "$npx_path"; then
      echo "[scale-engine] Windows npm npx was detected inside WSL: $npx_path" >&2
      echo "[scale-engine] Use the matching PowerShell wrapper (*.ps1), or install Node.js/npm inside WSL." >&2
      return 2
    fi
    npx @hongmaple0820/scale-engine@latest "$@"
  fi
}

echo "[scale-engine] compatibility wrapper: scripts/${label}.sh -> scale ${scaleCommand}" >&2
run_scale ${scaleCommand} "$@"
`
}

function workflowWrapperFiles(): GovernanceGeneratedFile[] {
  return [
    { path: 'scripts/workflow/new-task.sh', kind: 'script', owned: true, content: workflowWrapper('workflow/new-task', 'create-prd') },
    { path: 'scripts/workflow/explore.sh', kind: 'script', owned: true, content: workflowWrapper('workflow/explore', 'skill scan') },
    { path: 'scripts/workflow/resume.sh', kind: 'script', owned: true, content: workflowWrapper('workflow/resume', 'status') },
    { path: 'scripts/workflow/verify.sh', kind: 'script', owned: true, content: workflowWrapper('workflow/verify', 'preflight') },
    { path: 'scripts/gates/all.sh', kind: 'script', owned: true, content: workflowWrapper('gates/all', 'preflight --service all') },
    { path: 'scripts/workflow/new-task.ps1', kind: 'script', owned: true, content: powershellWorkflowWrapper('workflow/new-task', 'create-prd') },
    { path: 'scripts/workflow/explore.ps1', kind: 'script', owned: true, content: powershellWorkflowWrapper('workflow/explore', 'skill scan') },
    { path: 'scripts/workflow/resume.ps1', kind: 'script', owned: true, content: powershellWorkflowWrapper('workflow/resume', 'status') },
    { path: 'scripts/workflow/verify.ps1', kind: 'script', owned: true, content: powershellWorkflowWrapper('workflow/verify', 'preflight') },
    { path: 'scripts/gates/all.ps1', kind: 'script', owned: true, content: powershellWorkflowWrapper('gates/all', 'preflight --service all') },
  ]
}

function scaleEngineRepoFiles(): GovernanceGeneratedFile[] {
  return [
    { path: '.scale/workspace.json', kind: 'config', owned: true, content: scaleEngineRepoWorkspaceJson() },
    { path: '.agent/project.json', kind: 'config', owned: true, content: scaleEngineRepoProjectJson() },
    { path: '.claude/settings.json', kind: 'config', owned: true, content: scaleEngineRepoClaudeSettings() },
    { path: '.claude/workflow.json', kind: 'config', owned: true, content: scaleEngineRepoClaudeWorkflow() },
    { path: '.claude/hooks/session-start-reminder.sh', kind: 'script', owned: true, content: scaleEngineSessionStartHook() },
    { path: '.claude/hooks/gate-execute-phase.sh', kind: 'script', owned: true, content: scaleEngineExecutePhaseHook() },
    { path: '.claude/hooks/session-end-gate.sh', kind: 'script', owned: true, content: scaleEngineSessionEndHook() },
    { path: 'scripts/hooks/check-dangerous-file.sh', kind: 'script', owned: true, content: scaleEngineDangerousFileHook() },
    { path: 'scripts/hooks/check-explore.sh', kind: 'script', owned: true, content: scaleEngineExploreHook() },
    { path: 'scripts/hooks/check-tdd.sh', kind: 'script', owned: true, content: scaleEngineTddHook() },
    { path: 'scripts/hooks/check-context.sh', kind: 'script', owned: true, content: scaleEngineContextHook() },
    ...workflowWrapperFiles(),
    { path: 'AGENTS.md', kind: 'config', owned: true, content: scaleEngineRepoAgentsMd() },
    { path: 'CLAUDE.md', kind: 'config', owned: true, content: scaleEngineRepoClaudeMd() },
    { path: 'Makefile', kind: 'config', owned: true, content: scaleEngineRepoMakefile() },
    { path: 'docs/guides/GETTING_STARTED.md', kind: 'config', owned: true, content: scaleEngineRepoGettingStartedGuide() },
    { path: 'docs/guides/DEVELOPMENT_WORKFLOW.md', kind: 'config', owned: true, content: scaleEngineRepoDevelopmentWorkflowGuide() },
    { path: 'docs/workflow/README.md', kind: 'config', owned: true, content: scaleEngineRepoWorkflowReadme() },
  ]
}

function powershellWorkflowWrapper(label: string, scaleCommand: string): string {
  const commandParts = scaleCommand.split(/\s+/).filter(Boolean)
  const psArgs = commandParts.map(part => `'${part.replace(/'/g, "''")}'`).join(', ')
  return `$ErrorActionPreference = 'Stop'

function Invoke-Scale {
  param([string[]]$ScaleArgs)

  if (Get-Command scale -ErrorAction SilentlyContinue) {
    & scale @ScaleArgs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    return
  }

  & npx @hongmaple0820/scale-engine@latest @ScaleArgs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

[Console]::Error.WriteLine("[scale-engine] compatibility wrapper: scripts/${label}.ps1 -> scale ${scaleCommand}")
$scaleArgs = @(${psArgs}) + $args
Invoke-Scale -ScaleArgs $scaleArgs
`
}

function scaleEngineWorkflowBaselineEvalJson(): string {
  return `${JSON.stringify(defaultWorkflowEvalSuite(), null, 2)}\n`
}

function scaleEngineWorkflowPlanShellScript(): string {
  return `#!/bin/bash
# Create an implementation plan directory and update workflow state.
# Usage: bash scripts/workflow/plan.sh "feature-name" [level]

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="\${1:-}"
LEVEL="\${2:-M}"

if [ -z "$NAME" ]; then
  echo "[PLAN] usage: bash scripts/workflow/plan.sh feature-name [S|M|L|CRITICAL]"
  exit 1
fi

DATE="$(date +%Y-%m-%d)"
TASK_ID="\${DATE}-\${NAME}"
TASK_DIR="$PROJECT_ROOT/.planning/tasks/$TASK_ID"
STATE_DIR="$PROJECT_ROOT/.agent/state"
STATE_FILE="$STATE_DIR/current.json"
TEMPLATES="$PROJECT_ROOT/docs/workflow/templates"
PY_STATE="$PROJECT_ROOT/scripts/lib/workflow_state.py"

mkdir -p "$TASK_DIR" "$STATE_DIR"

for file in explore.md mini-prd.md spec.md plan.md tasks.md runtime.md reality-check.md resource-cleanup.md verification.md review.md summary.md; do
  target="$TASK_DIR/$file"
  if [ -f "$TEMPLATES/$file" ]; then
    sed "s/{{TASK_ID}}/$TASK_ID/g; s/{{NAME}}/$NAME/g; s/{{DATE}}/$DATE/g; s/{{LEVEL}}/$LEVEL/g" "$TEMPLATES/$file" > "$target"
  else
    cat > "$target" <<EOF
# \${file%.md} - $NAME

Date: $DATE
Level: $LEVEL

Fill in this plan artifact.
EOF
  fi
done

python3 "$PY_STATE" plan "$STATE_FILE" "$TASK_ID" "$LEVEL" ".planning/tasks/$TASK_ID"

echo "[PLAN] task artifacts dir: $TASK_DIR"
echo "[PLAN] state: $STATE_FILE"
`
}

function scaleEngineGatesAllShellScript(): string {
  return `#!/usr/bin/env bash
# Run workflow and quality gates.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"

DRY_RUN=false
MODE="all"
SERVICES=()

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/gates/all.sh [--dry-run] [--workflow|--quality|--all] [--service <root|all>]

Examples:
  bash scripts/gates/all.sh --dry-run
  bash scripts/gates/all.sh --workflow
  bash scripts/gates/all.sh --quality --service root
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      ;;
    --workflow)
      MODE="workflow"
      ;;
    --quality)
      MODE="quality"
      ;;
    --all)
      MODE="all"
      ;;
    --service)
      shift
      if [ -z "\${1:-}" ]; then
        echo "[GATE] --service requires a value" >&2
        exit 1
      fi
      SERVICES+=("$1")
      ;;
    root|all)
      SERVICES+=("$1")
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[GATE] unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

case "$MODE" in
  workflow) GATES=(G1 G2 G3) ;;
  quality) GATES=(G4 G5 G6 G7 G8) ;;
  all) GATES=(G1 G2 G3 G4 G5 G6 G7 G8) ;;
  *)
    echo "[GATE] invalid mode: $MODE" >&2
    exit 1
    ;;
esac

PASSED=0
FAILED=0
SKIPPED=0

echo "========================================"
echo "[GATE] mode: $MODE"
echo "========================================"

for gate in "\${GATES[@]}"; do
  script="$SCRIPT_DIR/\${gate}-verify.sh"
  echo "[GATE] $gate"

  if [ ! -f "$script" ]; then
    echo "  skipped: missing $script"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [ "$DRY_RUN" = true ]; then
    if bash -n "$script"; then
      echo "  schedulable"
      PASSED=$((PASSED + 1))
    else
      echo "  syntax failed"
      FAILED=$((FAILED + 1))
    fi
    continue
  fi

  if [[ "$gate" =~ ^G[4-7]$ ]]; then
    if bash "$script" "\${SERVICES[@]}"; then
      PASSED=$((PASSED + 1))
    else
      FAILED=$((FAILED + 1))
    fi
  else
    if bash "$script"; then
      PASSED=$((PASSED + 1))
    else
      FAILED=$((FAILED + 1))
    fi
  fi
  echo ""
done

echo "========================================"
echo "[GATE] summary"
echo "passed:  $PASSED"
echo "failed:  $FAILED"
echo "skipped: $SKIPPED"
echo "========================================"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi

exit 0
`
}

function scaleEngineG8VerifyShellScript(): string {
  return `#!/usr/bin/env bash
# G8: document and workflow artifact standards verification.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")/../.." && pwd)"

echo "========================================"
echo "[G8] Document standards gate"
echo "========================================"

cd "$PROJECT_ROOT"

CHANGED_MD="$(
  {
    git diff --name-only --diff-filter=AM HEAD -- '*.md' 2>/dev/null || true
    git ls-files --others --exclude-standard -- '*.md' 2>/dev/null || true
  } | sort -u
)"

if [ -z "$CHANGED_MD" ]; then
  echo "[G8] passed: no new/modified markdown files"
  exit 0
fi

echo "[G8] checking changed markdown files:"
echo "$CHANGED_MD"
echo ""

ALL_PASS=true

while IFS= read -r file; do
  [ -z "$file" ] && continue
  filepath="$PROJECT_ROOT/$file"
  [ -f "$filepath" ] || continue

  echo "[G8] checking: $file"

  if grep -qiE "(password|secret|token|api_key)[[:space:]]*[:=][[:space:]]*['\\"][^'\\"]{8,}" "$filepath" 2>/dev/null; then
    echo "  [FAIL] possible hardcoded secret detected"
    ALL_PASS=false
  fi

  if grep -q $'\\r' "$filepath" 2>/dev/null; then
    echo "  [WARN] CRLF detected in markdown"
  fi

  if grep -nE '[[:blank:]]$' "$filepath" >/dev/null 2>&1; then
    echo "  [WARN] trailing whitespace detected"
  fi

  if grep -qE '\\[[^]]+\\]\\(https?://(localhost|127\\.0\\.0\\.1)' "$filepath" 2>/dev/null; then
    echo "  [WARN] localhost links found; prefer relative paths or runtime notes"
  fi
done <<< "$CHANGED_MD"

echo ""
if [ "$ALL_PASS" = true ]; then
  echo "[G8] passed"
  exit 0
fi

echo "[G8] failed"
exit 1
`
}

function scaleEngineSpecTemplate(): string {
  return `# Spec - {{TASK_ID}}

Date: {{DATE}}
Level: {{LEVEL}}

## What


## Why


## Boundaries


## Acceptance Criteria

- [ ]
`
}

function scaleEngineTasksTemplate(): string {
  return `# Tasks - {{TASK_ID}}

Date: {{DATE}}
Level: {{LEVEL}}

## Task List

- [ ]
`
}

function scaleEngineWorkflowStatePython(): string {
  return `#!/usr/bin/env python3
"""Small helper for .agent/state/current.json.

The workflow scripts run in Git Bash, WSL, and PowerShell-adjacent
environments where jq is not always installed. Keep canonical state
reads and writes in Python's standard library.
"""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def save(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\\n", encoding="utf-8")
    tmp.replace(path)


def default_state(task_id: str = "", level: str = "M") -> dict:
    return {
        "task_id": task_id,
        "level": level,
        "phase": "explore",
        "artifacts_dir": "",
        "runtime_contract": "",
        "reality_check": "",
        "resource_cleanup": "",
        "explored_files": [],
        "file_count": 0,
        "main_contradiction": "",
        "completed_gates": [],
        "open_tasks": [],
        "files_modified": [],
        "updated_at": now(),
    }


def cmd_init(args: list[str]) -> int:
    state_path = Path(args[0])
    task_id, level, artifacts_dir = args[1], args[2], args[3]
    data = default_state(task_id, level)
    data["artifacts_dir"] = artifacts_dir
    data["runtime_contract"] = str(Path(artifacts_dir) / "runtime.md")
    data["reality_check"] = str(Path(artifacts_dir) / "reality-check.md")
    data["resource_cleanup"] = str(Path(artifacts_dir) / "resource-cleanup.md")
    save(state_path, data)
    return 0


def cmd_explore(args: list[str]) -> int:
    state_path = Path(args[0])
    detail_path = Path(args[1])
    contradiction = args[2]
    files = args[3:]
    data = load(state_path) or default_state(
        "ad-hoc-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
        "M",
    )
    data.update(
        {
            "phase": "explore",
            "explored_files": files,
            "file_count": len(files),
            "main_contradiction": contradiction,
            "updated_at": now(),
        }
    )
    save(state_path, data)
    save(
        detail_path,
        {
            "updated_at": data["updated_at"],
            "files": files,
            "file_count": len(files),
            "main_contradiction": contradiction,
            "skills_checked": True,
        },
    )
    return 0


def cmd_plan(args: list[str]) -> int:
    state_path = Path(args[0])
    task_id, level, artifacts_dir = args[1], args[2], args[3]
    data = load(state_path) or default_state(task_id, level)
    data.update(
        {
            "task_id": task_id,
            "level": level,
            "phase": "plan",
            "artifacts_dir": artifacts_dir,
            "runtime_contract": str(Path(artifacts_dir) / "runtime.md"),
            "reality_check": str(Path(artifacts_dir) / "reality-check.md"),
            "resource_cleanup": str(Path(artifacts_dir) / "resource-cleanup.md"),
            "updated_at": now(),
        }
    )
    save(state_path, data)
    return 0


def cmd_checkpoint(args: list[str]) -> int:
    state_path = Path(args[0])
    root = Path(args[1])
    phase = args[2]
    data = load(state_path) or default_state(
        "ad-hoc-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
        "M",
    )
    try:
        result = subprocess.run(
            ["git", "diff", "--name-only"],
            cwd=root,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        files = [line for line in result.stdout.splitlines() if line]
    except Exception:
        files = []
    data["phase"] = phase
    data["files_modified"] = files
    data["updated_at"] = now()
    data.setdefault("completed_gates", [])
    data.setdefault("open_tasks", [])
    save(state_path, data)
    return 0


def cmd_get(args: list[str]) -> int:
    data = load(Path(args[0]))
    value = data.get(args[1], args[2] if len(args) > 2 else "")
    if isinstance(value, list):
        print(", ".join(str(v) for v in value))
    else:
        print(value)
    return 0


def cmd_len(args: list[str]) -> int:
    data = load(Path(args[0]))
    value = data.get(args[1], [])
    if isinstance(value, list):
        print(len(value))
    else:
        print(int(value or 0))
    return 0


def cmd_add_gates(args: list[str]) -> int:
    state_path = Path(args[0])
    data = load(state_path)
    existing = data.get("completed_gates", [])
    if not isinstance(existing, list):
        existing = []
    data["completed_gates"] = sorted(set(str(item) for item in existing + args[1:]))
    data["phase"] = "verify"
    data["updated_at"] = now()
    save(state_path, data)
    return 0


COMMANDS = {
    "init": cmd_init,
    "explore": cmd_explore,
    "plan": cmd_plan,
    "checkpoint": cmd_checkpoint,
    "get": cmd_get,
    "len": cmd_len,
    "add-gates": cmd_add_gates,
}


if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
    print("usage: workflow_state.py <command> ...", file=sys.stderr)
    raise SystemExit(2)

raise SystemExit(COMMANDS[sys.argv[1]](sys.argv[2:]))
`
}

function moeWorkspaceGuide(): string {
  return `# MOE Workspace Governance

MOE workspaces are multi-repository engineering environments where the root checkout, sibling repositories, external repositories, submodules, and temporary agent worktrees must be finished as one coordinated unit. Independent child projects should not be placed inside the root checkout unless they are intentional submodules.

## Source Of Truth

- \`.scale/workspace.json\`: repository topology, branch policy, and finish policy.
- \`.scale/verification.json\`: service matrix and verification commands.
- \`docs/worklog/tasks/<task>/\`: task artifacts, verification evidence, and cross-repository impact.

## Required Finish Checks

Before deleting an agent worktree or reporting a task complete:

1. Run \`scale workspace map --json\` to confirm the expected repositories are known.
2. Run \`scale workspace finish --summary\` for the short blocker list; use \`--json\` only when full audit detail is needed.
3. Commit and push child repository work in each repository's own remote.
4. Review whether the root repository needs a submodule pointer, lock file, integration metadata, or documentation update.
5. Run service-aware verification for every touched service.

## Repository Layout

Prefer sibling or absolute repository paths:

\`\`\`json
{
  "repositories": [
    { "name": "root", "path": ".", "role": "root", "required": true },
    { "name": "api", "path": "../api", "role": "external", "required": true, "remote": "origin" }
  ]
}
\`\`\`

Nested paths such as \`services/api\` are only appropriate for monorepos or intentional submodules. In MOE/polyrepo mode, SCALE warns when a child repository path sits under the root checkout because that layout easily causes Git status, branch, and commit-scope conflicts.

\`scale ship <task-id>\` performs the same child-repository boundary check before creating a root commit. Dirty or unpushed child repositories block shipping. The default branch policy follows GitLab Flow: short branches merge to \`dev\`, verified production changes land on \`master\`, and release publishing is triggered by user-created \`vX.Y.Z\` tags. Direct governed commits on \`dev\`, \`master\`, \`main\`, or detached HEAD are blocked. Raw \`git add .\` bypasses this protection and is not allowed for governed MOE workspaces.

## Branch Naming

Use readable branches with author/platform/scope/date context, for example:

\`\`\`text
feature/maple-codex-storage-policy-0515
fix/zpei-claude-upload-retry-0515
codex/moe-workspace-governance-0515
\`\`\`

Protected branches such as \`dev\`, \`main\`, and \`master\` require explicit human authorization before direct pushes.
`
}

function resourceGovernanceGuide(): string {
  return `# Resource Governance

This project uses SCALE resource governance to keep generated outputs, maintained documentation, task evidence, media, and temporary files from collapsing into one unmanaged document pile.

## Source Of Truth

- \`.scale/resource-policy.json\`: asset classes, retention rules, owners, module mapping, and size limits.
- \`.scale/assets.json\`: explicit long-lived resource catalog and source-of-truth declarations.
- \`docs/modules/\`: maintained module-level product, architecture, API, and operations documentation.
- \`docs/decisions/\`: ADRs and superseded architecture decisions.

## Default Git Policy

| Resource | Default policy |
| --- | --- |
| Module docs, standards, ADRs, contracts, reusable scripts | Commit |
| Task worklog artifacts | Review before commit |
| E2E reports, coverage, screenshots, videos, logs | Ignore or external artifact storage |
| Temporary scripts and scratch files | Ignore and delete after settlement |
| Large media | Git LFS or external storage |

## Required Finish Behavior

Before reporting a M/L/CRITICAL task complete:

1. Run \`scale assets scan --json\`.
2. Run \`scale assets doctor --json\`.
3. Run \`scale assets settle --task-id <task-id> --artifact-dir <task-dir>\`.
4. Promote final product or architecture truth into maintained docs.
5. Keep raw reports, screenshots, videos, and logs out of Git unless they are deliberately promoted.
6. Delete or archive expired temporary files.
`
}

function moduleDocsIndex(): string {
  return `# Module Documentation

Use one directory per maintained module:

\`\`\`text
docs/modules/<module>/
├── README.md
├── product.md
├── architecture.md
├── api.md
└── operations.md
\`\`\`

Keep task-specific drafts in \`docs/worklog/tasks/\`. Promote only final, durable decisions and user-facing behavior into module documentation.
`
}

function resourceGitignoreExample(): string {
  return `# SCALE resource governance runtime outputs
.scale/tmp/
.scale/reports/
.scale/resource-reports/
tmp/
temp/
test-results/
playwright-report/
coverage/

# Raw generated media should be promoted deliberately or stored externally
*.webm
*.mp4
*.mov
*.wav
*.mp3
`
}

function nodeLibraryGuide(): string {
  return `# Node Library Workflow

This repository uses the latest SCALE repository workflow for Node/npm package delivery.

## Command Entry Points

\`\`\`bash
bash scripts/preflight/all.sh
bash scripts/gates/all.sh --dry-run
bash scripts/workflow/new-task.sh
bash scripts/workflow/resume.sh
bash scripts/workflow/verify.sh --preflight-profile quick
\`\`\`

PowerShell:

\`\`\`powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/preflight/all.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/gates/all.ps1 --dry-run
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/workflow/new-task.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/workflow/resume.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/workflow/verify.ps1 --preflight-profile quick
\`\`\`

## Default Verification Matrix

- quick loop: \`npm run build\`, \`npm run lint\`, \`npm test\`
- release loop: run \`npm run release:check\` when available; otherwise add \`npm run typecheck\`, \`npm run smoke:setup\`, \`npm audit --omit=dev\`, \`git diff --check\`, and \`npm pack --dry-run\`
- product smoke: enable a real probe in \`.scale/product-smoke.json\` instead of treating a health endpoint as completion proof

## Branch Policy

This repository follows a GitLab Flow variant:

\`\`\`text
feature/fix/docs/chore/codex -> dev -> master -> tag/publish
\`\`\`

Use short-lived branches for governed work. Direct governed commits on \`dev\`, \`master\`, or \`main\` are blocked by SCALE ship rules.

## Release Expectations

Before a package release or demo handoff:

1. Run \`bash scripts/preflight/all.sh\` or the PowerShell equivalent.
2. Run \`scale preflight --preflight-profile full --json\`.
3. Run \`npm run release:check\` when the package exposes it, or run the equivalent build/test/smoke/audit/pack commands explicitly.
4. Run \`git diff --check\` if it is not already included in the release command.
5. Confirm runtime evidence and review artifacts for M/L/CRITICAL work.
`
}

function nodeLibraryPreflightShellScript(): string {
  return `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

ERRORS=0
WARNINGS=0

note_ok() { echo "[OK] $*"; }
note_warn() { echo "[WARN] $*"; WARNINGS=$((WARNINGS + 1)); }
note_error() { echo "[ERROR] $*"; ERRORS=$((ERRORS + 1)); }

find_python() {
  for candidate in python3 python py; do
    if command -v "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

json_valid() {
  local file="$1"
  if command -v node >/dev/null 2>&1; then
    node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8').replace(/^\\\\uFEFF/, ''))" "$file" >/dev/null
    return $?
  fi
  local py
  py="$(find_python || true)"
  if [ -n "$py" ]; then
    "$py" -c "import json,sys; json.load(open(sys.argv[1], encoding='utf-8-sig'))" "$file" >/dev/null
    return $?
  fi
  return 2
}

package_script_exists() {
  local script_name="$1"
  node - "$PROJECT_ROOT/package.json" "$script_name" <<'NODE' >/dev/null
const fs = require('fs');
const pkgPath = process.argv[2];
const scriptName = process.argv[3];
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8').replace(/^\\uFEFF/, ''));
process.exit(pkg.scripts && Object.prototype.hasOwnProperty.call(pkg.scripts, scriptName) ? 0 : 1);
NODE
}

echo "========================================"
echo "[PREFLIGHT] node-library workflow"
echo "========================================"
echo ""

echo "[CHECK] required tools"
if command -v git >/dev/null 2>&1; then
  note_ok "git"
else
  note_error "git is required"
fi

if command -v node >/dev/null 2>&1; then
  note_ok "node $(node --version)"
else
  note_error "node is required"
fi

if command -v npm >/dev/null 2>&1; then
  note_ok "npm $(npm --version)"
elif command -v pnpm >/dev/null 2>&1; then
  note_ok "pnpm $(pnpm --version)"
else
  note_error "npm or pnpm is required"
fi
echo ""

echo "[CHECK] optional tools"
for tool in bash rg jq gh graphify; do
  if command -v "$tool" >/dev/null 2>&1; then
    note_ok "$tool"
  else
    note_warn "$tool is not installed"
  fi
done
PYTHON_BIN="$(find_python || true)"
if [ -n "$PYTHON_BIN" ]; then
  note_ok "$PYTHON_BIN"
else
  note_warn "python is not installed"
fi
echo ""

echo "[CHECK] required directories"
for dir in \
  ".scale" \
  ".planning/tasks" \
  "docs/workflow" \
  "docs/workflow/templates" \
  "docs/worklog" \
  "scripts/gates" \
  "scripts/preflight" \
  "scripts/qa" \
  "scripts/workflow" \
  "src" \
  "tests"; do
  if [ -d "$PROJECT_ROOT/$dir" ]; then
    note_ok "$dir"
  else
    note_error "missing directory: $dir"
  fi
done
echo ""

echo "[CHECK] governance JSON files"
for file in \
  ".scale/verification.json" \
  ".scale/workspace.json" \
  ".scale/skills.json" \
  ".scale/tools.json" \
  ".scale/resource-policy.json" \
  ".scale/assets.json" \
  ".scale/output-policy.json" \
  ".scale/product-smoke.json" \
  ".scale/engineering-standards.json" \
  ".scale/engineering-standards-baseline.json" \
  ".scale/frameworks.json" \
  ".scale/governance.lock.json"; do
  if [ ! -f "$PROJECT_ROOT/$file" ]; then
    note_error "missing JSON file: $file"
    continue
  fi
  if json_valid "$PROJECT_ROOT/$file"; then
    note_ok "$file"
  else
    note_error "invalid JSON: $file"
  fi
done
echo ""

echo "[CHECK] key workflow docs"
for file in \
  "docs/workflow/README.md" \
  "docs/workflow/node-library.md" \
  "docs/worklog/metrics.md"; do
  if [ -f "$PROJECT_ROOT/$file" ]; then
    note_ok "$file"
  else
    note_error "missing file: $file"
  fi
done
echo ""

echo "[CHECK] package scripts"
for script_name in build lint test typecheck; do
  if package_script_exists "$script_name"; then
    note_ok "package.json scripts.$script_name"
  else
    note_error "missing package.json script: $script_name"
  fi
done
echo ""

echo "[CHECK] gate wrappers"
if [ -f "$PROJECT_ROOT/scripts/gates/all.sh" ] && bash -n "$PROJECT_ROOT/scripts/gates/all.sh"; then
  note_ok "scripts/gates/all.sh syntax"
else
  note_error "scripts/gates/all.sh is missing or invalid"
fi
echo ""

echo "========================================"
if [ "$ERRORS" -eq 0 ]; then
  echo "[PREFLIGHT] PASSED with $WARNINGS warning(s)"
  exit 0
fi

echo "[PREFLIGHT] FAILED with $ERRORS error(s), $WARNINGS warning(s)"
exit 1
`
}

function nodeLibraryPreflightPowerShellScript(): string {
  return `$ErrorActionPreference = 'Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\\..')).Path
$Errors = 0
$Warnings = 0

function Note-Ok([string]$Message) {
  Write-Host "[OK] $Message"
}

function Note-Warn([string]$Message) {
  $script:Warnings++
  Write-Host "[WARN] $Message"
}

function Note-Error([string]$Message) {
  $script:Errors++
  Write-Host "[ERROR] $Message"
}

function Test-JsonFile([string]$Path) {
  try {
    $raw = Get-Content -Raw $Path
    $clean = $raw.TrimStart([char]0xFEFF)
    $null = $clean | ConvertFrom-Json
    return $true
  } catch {
    return $false
  }
}

function Test-PackageScript([string]$Name) {
  $pkg = Get-Content -Raw (Join-Path $ProjectRoot 'package.json') | ConvertFrom-Json
  return $null -ne $pkg.scripts.$Name
}

Write-Host '========================================'
Write-Host '[PREFLIGHT] node-library workflow'
Write-Host '========================================'
Write-Host ''

Write-Host '[CHECK] required tools'
if (Get-Command git -ErrorAction SilentlyContinue) {
  Note-Ok 'git'
} else {
  Note-Error 'git is required'
}

$Node = Get-Command node -ErrorAction SilentlyContinue
if ($Node) {
  Note-Ok ("node " + (node --version))
} else {
  Note-Error 'node is required'
}

$Npm = Get-Command npm -ErrorAction SilentlyContinue
$Pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if ($Npm) {
  Note-Ok ("npm " + (npm --version))
} elseif ($Pnpm) {
  Note-Ok ("pnpm " + (pnpm --version))
} else {
  Note-Error 'npm or pnpm is required'
}
Write-Host ''

Write-Host '[CHECK] optional tools'
foreach ($Tool in @('bash', 'rg', 'jq', 'gh', 'graphify', 'python', 'python3')) {
  if (Get-Command $Tool -ErrorAction SilentlyContinue) {
    Note-Ok $Tool
  } else {
    Note-Warn "$Tool is not installed"
  }
}
Write-Host ''

Write-Host '[CHECK] required directories'
foreach ($Dir in @(
  '.scale',
  '.planning\\tasks',
  'docs\\workflow',
  'docs\\workflow\\templates',
  'docs\\worklog',
  'scripts\\gates',
  'scripts\\preflight',
  'scripts\\qa',
  'scripts\\workflow',
  'src',
  'tests'
)) {
  if (Test-Path (Join-Path $ProjectRoot $Dir)) {
    Note-Ok $Dir
  } else {
    Note-Error "missing directory: $Dir"
  }
}
Write-Host ''

Write-Host '[CHECK] governance JSON files'
foreach ($File in @(
  '.scale\\verification.json',
  '.scale\\workspace.json',
  '.scale\\skills.json',
  '.scale\\tools.json',
  '.scale\\resource-policy.json',
  '.scale\\assets.json',
  '.scale\\output-policy.json',
  '.scale\\product-smoke.json',
  '.scale\\engineering-standards.json',
  '.scale\\engineering-standards-baseline.json',
  '.scale\\frameworks.json',
  '.scale\\governance.lock.json'
)) {
  $Path = Join-Path $ProjectRoot $File
  if (-not (Test-Path $Path)) {
    Note-Error "missing JSON file: $File"
    continue
  }
  if (Test-JsonFile $Path) {
    Note-Ok $File
  } else {
    Note-Error "invalid JSON: $File"
  }
}
Write-Host ''

Write-Host '[CHECK] key workflow docs'
foreach ($File in @(
  'docs\\workflow\\README.md',
  'docs\\workflow\\node-library.md',
  'docs\\worklog\\metrics.md'
)) {
  if (Test-Path (Join-Path $ProjectRoot $File)) {
    Note-Ok $File
  } else {
    Note-Error "missing file: $File"
  }
}
Write-Host ''

Write-Host '[CHECK] package scripts'
foreach ($ScriptName in @('build', 'lint', 'test', 'typecheck')) {
  if (Test-PackageScript $ScriptName) {
    Note-Ok "package.json scripts.$ScriptName"
  } else {
    Note-Error "missing package.json script: $ScriptName"
  }
}
Write-Host ''

Write-Host '[CHECK] gate wrappers'
$GateScript = Join-Path $ProjectRoot 'scripts\\gates\\all.ps1'
if (Test-Path $GateScript) {
  $null = [System.Management.Automation.Language.Parser]::ParseFile($GateScript, [ref]$null, [ref]$null)
  if ($?) {
    Note-Ok 'scripts/gates/all.ps1 syntax'
  } else {
    Note-Error 'scripts/gates/all.ps1 is invalid'
  }
} else {
  Note-Error 'missing scripts/gates/all.ps1'
}
Write-Host ''

Write-Host '========================================'
if ($Errors -eq 0) {
  Write-Host "[PREFLIGHT] PASSED with $Warnings warning(s)"
  exit 0
}

Write-Host "[PREFLIGHT] FAILED with $Errors error(s), $Warnings warning(s)"
exit 1
`
}

function scaleEngineRepoWorkspaceJson(): string {
  return `${JSON.stringify({
    version: 1,
    topology: 'single',
    repositories: [
      {
        name: 'root',
        path: '.',
        role: 'root',
        required: true,
      },
    ],
    branchPolicy: {
      mode: 'gitlab-flow',
      integrationBranch: 'dev',
      productionBranch: 'master',
      protectedBranches: ['dev', 'master', 'main'],
      featurePrefixes: ['feature/', 'feat/', 'fix/', 'chore/', 'docs/', 'codex/'],
      releasePrefixes: ['release/'],
      hotfixPrefixes: ['hotfix/'],
      requireAuthorScopeDate: true,
    },
    finishPolicy: {
      requireCleanRepositories: true,
      requirePushedBranches: true,
      requireRootPointerUpdate: false,
      requireReviewArtifacts: false,
    },
  }, null, 2)}\n`
}

function scaleEngineRepoProjectJson(): string {
  return `${JSON.stringify({
    version: '1.1',
    stack: 'auto',
    coverage_threshold: 80,
    profiles: {
      scaffold: {
        description: 'Validate the repository workflow scaffold itself.',
        checks: ['lint'],
      },
      default: {
        description: 'Validate the scale-engine repository.',
        services: ['root'],
        checks: ['lint', 'typecheck', 'test', 'build'],
      },
      all: {
        description: 'Run the full repository validation surface.',
        services: '*',
        checks: ['lint', 'typecheck', 'test', 'build', 'security'],
      },
    },
    services: {
      root: {
        path: '.',
        stack: 'node',
        required: true,
        commands: {
          typecheck: 'npm run typecheck',
        },
      },
    },
    stacks: {
      node: {
        detect: ['package.json'],
        commands: {
          build: 'npm run build',
          lint: 'npm run lint',
          typecheck: 'npm run typecheck',
          test: 'npm run test',
          coverage: 'npm run coverage',
          security: 'npm audit --audit-level=high',
        },
        required_tools: {
          build: ['npm'],
          lint: ['npm'],
          typecheck: ['npm'],
          test: ['npm'],
          coverage: ['npm'],
          security: ['npm'],
        },
      },
    },
  }, null, 2)}\n`
}

function scaleEngineRepoClaudeSettings(): string {
  return `${JSON.stringify({
    permissions: {
      allow: [
        'Read',
        'Grep',
        'Glob',
        'WebSearch',
        'WebFetch',
        'Agent',
        'Skill',
        'Bash(rtk *: *)',
        'Bash(bash scripts/*: *)',
        'Bash(bash scripts/hooks/*: *)',
        'Bash(bash .claude/hooks/*: *)',
        'Bash(powershell -NoProfile -ExecutionPolicy Bypass -File scripts/*: *)',
        'Write(.claude/**)',
        'Write(.agent/**)',
        'Write(.scale/**)',
        'Write(docs/**)',
        'Write(scripts/**)',
        'Write(README.md)',
        'Write(AGENTS.md)',
        'Write(CLAUDE.md)',
        'Write(Makefile)',
        'Write(.gitignore)',
        'Edit(.claude/**)',
        'Edit(.agent/**)',
        'Edit(.scale/**)',
        'Edit(docs/**)',
        'Edit(scripts/**)',
        'Edit(README.md)',
        'Edit(AGENTS.md)',
        'Edit(CLAUDE.md)',
        'Edit(Makefile)',
        'Edit(.gitignore)',
      ],
      deny: [
        'Write(.env*)',
        'Edit(.env*)',
        'Write(*secret*)',
        'Edit(*secret*)',
        'Write(*token*)',
        'Edit(*token*)',
        'Write(*password*)',
        'Edit(*password*)',
      ],
    },
    hooks: {
      SessionStart: [
        {
          matcher: '',
          command: 'bash .claude/hooks/session-start-reminder.sh',
          timeout: 3000,
          description: 'Show concise scale-engine workflow entry points.',
        },
      ],
      PreToolUse: [
        {
          matcher: 'Write|Edit|MultiEdit',
          command: 'bash scripts/hooks/check-dangerous-file.sh',
          timeout: 3000,
          description: 'Block edits to secrets, runtime databases, and generated dependency output.',
        },
        {
          matcher: 'Write|Edit|MultiEdit',
          command: 'bash scripts/hooks/check-explore.sh',
          timeout: 3000,
          description: 'Require recorded exploration before medium or larger source changes.',
        },
        {
          matcher: 'Write|Edit|MultiEdit',
          command: 'bash scripts/hooks/check-tdd.sh',
          timeout: 3000,
          description: 'Warn when TypeScript implementation changes lack nearby test evidence.',
        },
        {
          matcher: 'Write|Edit|MultiEdit',
          command: 'bash .claude/hooks/gate-execute-phase.sh',
          timeout: 3000,
          description: 'Route code edits through the repository workflow phase gates.',
        },
      ],
      Stop: [
        {
          matcher: '',
          command: 'bash .claude/hooks/session-end-gate.sh',
          timeout: 5000,
          description: 'Summarize uncommitted code changes and verification expectations before handoff.',
        },
      ],
    },
  }, null, 2)}\n`
}

function shellScript(lines: string[]): string {
  return `${lines.join('\n')}\n`
}

function scaleEngineSessionStartHook(): string {
  return shellScript([
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'echo "[scale-engine] workflow: read AGENTS.md, use rtk for shell commands, run make preflight or scripts/preflight/all.ps1 before handoff."',
  ])
}

function scaleEngineExecutePhaseHook(): string {
  return shellScript([
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"',
    'FILE_PATH="${CLAUDE_FILE_PATH:-${1:-}}"',
    '',
    'if [ -z "$FILE_PATH" ]; then',
    '  exit 0',
    'fi',
    '',
    'case "$FILE_PATH" in',
    '  src/*.ts|src/**/*.ts|tests/*.ts|tests/**/*.ts) ;;',
    '  *) exit 0 ;;',
    'esac',
    '',
    'STATE_FILE="$ROOT/.agent/state/current.json"',
    'if [ ! -f "$STATE_FILE" ]; then',
    '  echo "[scale-engine] workflow state is not initialized. Run: bash scripts/workflow/new-task.sh <task-slug> M"',
    '  exit 0',
    'fi',
    '',
    'if command -v python3 >/dev/null 2>&1; then',
    '  PHASE="$(python3 "$ROOT/scripts/lib/workflow_state.py" get "$STATE_FILE" phase unknown 2>/dev/null || echo unknown)"',
    'else',
    '  PHASE="unknown"',
    'fi',
    '',
    'case "$PHASE" in',
    '  explore|plan|execute|verify|review|ship|done|unknown) exit 0 ;;',
    '  *)',
    '    echo "[scale-engine] unexpected workflow phase: $PHASE"',
    '    exit 0',
    '    ;;',
    'esac',
  ])
}

function scaleEngineSessionEndHook(): string {
  return shellScript([
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"',
    'cd "$ROOT"',
    '',
    'CHANGED_CODE="$(git diff --name-only -- src tests package.json package-lock.json 2>/dev/null | head -20 || true)"',
    'if [ -n "$CHANGED_CODE" ]; then',
    '  echo "[scale-engine] changed code/package files:"',
    '  echo "$CHANGED_CODE"',
    '  echo "[scale-engine] expected verification: npm run typecheck and targeted Vitest or scripts/preflight/all.ps1."',
    'fi',
    '',
    'exit 0',
  ])
}

function scaleEngineDangerousFileHook(): string {
  return shellScript([
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'FILE_PATH="${CLAUDE_FILE_PATH:-${1:-}}"',
    'if [ -z "$FILE_PATH" ]; then',
    '  exit 0',
    'fi',
    '',
    'case "$FILE_PATH" in',
    '  *.env|*.env.*|*.key|*.pem|*.p12|*.crt|*secret*|*credential*|*password*|*token*)',
    '    echo "[scale-engine] blocked sensitive file edit: $FILE_PATH"',
    '    exit 2',
    '    ;;',
    '  node_modules/*|dist/*|coverage/*|test-results/*|playwright-report/*|.scale/events/*|.scale/evidence/*|.scale/state/*|.scale/*.db*)',
    '    echo "[scale-engine] blocked generated/runtime file edit: $FILE_PATH"',
    '    exit 2',
    '    ;;',
    'esac',
    '',
    'exit 0',
  ])
}

function scaleEngineExploreHook(): string {
  return shellScript([
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"',
    'FILE_PATH="${CLAUDE_FILE_PATH:-${1:-}}"',
    'STATE_FILE="$ROOT/.agent/state/current.json"',
    'PY_STATE="$ROOT/scripts/lib/workflow_state.py"',
    '',
    'if [ -z "$FILE_PATH" ]; then',
    '  exit 0',
    'fi',
    '',
    'case "$FILE_PATH" in',
    '  src/*.ts|src/**/*.ts|tests/*.ts|tests/**/*.ts) ;;',
    '  *) exit 0 ;;',
    'esac',
    '',
    'if [ ! -f "$STATE_FILE" ]; then',
    '  echo "[scale-engine] no workflow state found. For M/L work run: bash scripts/workflow/new-task.sh <task-slug> M"',
    '  exit 0',
    'fi',
    '',
    'if ! command -v python3 >/dev/null 2>&1; then',
    '  exit 0',
    'fi',
    '',
    'LEVEL="$(python3 "$PY_STATE" get "$STATE_FILE" level S 2>/dev/null || echo S)"',
    'FILE_COUNT="$(python3 "$PY_STATE" get "$STATE_FILE" file_count 0 2>/dev/null || echo 0)"',
    '',
    'case "$LEVEL" in',
    '  M|L|CRITICAL)',
    '    if [ "${FILE_COUNT:-0}" -lt 3 ]; then',
    '      echo "[scale-engine] M/L/CRITICAL work should record exploration of at least 3 relevant files before editing source."',
    '      echo "[scale-engine] run: bash scripts/workflow/explore.sh <files...> \'<main contradiction>\'"',
    '      exit 2',
    '    fi',
    '    ;;',
    'esac',
    '',
    'exit 0',
  ])
}

function scaleEngineTddHook(): string {
  return shellScript([
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'FILE_PATH="${CLAUDE_FILE_PATH:-${1:-}}"',
    'if [ -z "$FILE_PATH" ]; then',
    '  exit 0',
    'fi',
    '',
    'case "$FILE_PATH" in',
    '  src/*.ts|src/**/*.ts) ;;',
    '  *) exit 0 ;;',
    'esac',
    '',
    'case "$FILE_PATH" in',
    '  *.test.ts|*.spec.ts|src/api/cli.ts) exit 0 ;;',
    'esac',
    '',
    'BASENAME="$(basename "$FILE_PATH" .ts)"',
    'if ! find tests src -name "*${BASENAME}*.test.ts" -o -name "*${BASENAME}*.spec.ts" 2>/dev/null | grep -q .; then',
    '  echo "[scale-engine] test evidence warning: changed $FILE_PATH without a nearby *${BASENAME}*.test.ts file."',
    'fi',
    '',
    'exit 0',
  ])
}

function scaleEngineContextHook(): string {
  return shellScript([
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'FILE_PATH="${CLAUDE_FILE_PATH:-${1:-}}"',
    'if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then',
    '  exit 0',
    'fi',
    '',
    'case "$FILE_PATH" in',
    '  src/*.ts|src/**/*.ts) ;;',
    '  *) exit 0 ;;',
    'esac',
    '',
    'if grep -Eq "(fetch\\\\(|execa\\\\(|spawn\\\\(|execFile\\\\(|readFileSync\\\\(|writeFileSync\\\\()" "$FILE_PATH" 2>/dev/null; then',
    '  if ! grep -Eq "(timeout|AbortController|try \\\\{|catch \\\\{|safe|validate|z\\\\.)" "$FILE_PATH" 2>/dev/null; then',
    '    echo "[scale-engine] context warning: $FILE_PATH touches IO/process APIs; check timeout, validation, and error handling."',
    '  fi',
    'fi',
    '',
    'exit 0',
  ])
}

function scaleEngineRepoClaudeWorkflow(): string {
  return `${JSON.stringify({
    version: '2.0',
    project: 'scale-engine',
    description: 'Repository workflow for developing scale-engine itself.',
    currentPhase: 'idle',
    currentTier: 'standard',
    phaseHistory: [],
    gates: {
      G1_explore: {
        status: 'pending',
        description: 'Explore current repo state and record the main contradiction.',
        verification: 'bash scripts/gates/G1-verify.sh',
        autoCheck: false,
        verifiedAt: null,
      },
      G2_plan: {
        status: 'pending',
        description: 'Plan includes scope, risk, rollback, and reality check.',
        verification: 'bash scripts/gates/G2-verify.sh',
        autoCheck: false,
        verifiedAt: null,
      },
      G3_tdd: {
        status: 'pending',
        description: 'Behavior changes in src/ should be accompanied by test changes.',
        verification: 'bash scripts/gates/G3-verify.sh',
        autoCheck: true,
        verifiedAt: null,
      },
      G4_lint: {
        status: 'pending',
        description: 'Workflow scripts parse and required helper files exist.',
        verification: 'bash scripts/gates/G4-verify.sh',
        autoCheck: true,
        verifiedAt: null,
      },
      G5_test: {
        status: 'pending',
        description: 'Repository lint, typecheck, test, and build pass.',
        verification: 'bash scripts/gates/G5-verify.sh',
        autoCheck: true,
        verifiedAt: null,
      },
      G6_artifacts: {
        status: 'pending',
        description: 'Task evidence and diff hygiene are complete.',
        verification: 'bash scripts/gates/G6-verify.sh',
        autoCheck: true,
        verifiedAt: null,
      },
      G7_security: {
        status: 'pending',
        description: 'Security validation passes or is explicitly blocked.',
        verification: 'bash scripts/gates/G7-verify.sh',
        autoCheck: false,
        verifiedAt: null,
      },
      G8_docs: {
        status: 'pending',
        description: 'Changed markdown and workflow artifacts meet documentation hygiene rules.',
        verification: 'bash scripts/gates/G8-verify.sh',
        autoCheck: true,
        verifiedAt: null,
      },
    },
    tierConfig: {
      sandbox: {
        flow: ['execute', 'verify'],
        gates: ['G4', 'G5'],
        description: 'Small local changes.',
      },
      standard: {
        flow: ['explore', 'plan', 'execute', 'verify', 'consolidate'],
        gates: ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G8'],
        description: 'Default repository workflow.',
      },
      critical: {
        flow: ['explore', 'plan', 'review', 'execute', 'verify', 'security', 'consolidate'],
        gates: ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8'],
        description: 'Release, security, or destructive changes.',
      },
    },
    autoEscalation: {
      enabled: true,
      rules: [
        {
          pattern: 'auth|security|token|credential|oauth|permission',
          escalateTo: 'critical',
          reason: 'Security-sensitive change',
        },
        {
          pattern: 'release|publish|tag|npm',
          escalateTo: 'critical',
          reason: 'Release-sensitive change',
        },
      ],
    },
    lastUpdated: '2026-05-20T00:00:00Z',
  }, null, 2)}\n`
}

function scaleEngineRepoAgentsMd(): string {
  return `# AGENTS.md

本文件是 \`scale-engine\` 仓库的工程化工作流入口，面向在本仓库里直接开发 \`scale-engine\` 本身的 Agent 和维护者。

## 先读

1. \`README.md\`
2. \`docs/guides/GETTING_STARTED.md\`
3. \`docs/guides/DEVELOPMENT_WORKFLOW.md\`
4. \`docs/workflow/README.md\`
5. \`.scale/workspace.json\`

## 工作原则

- 先读现状，再改文件；不要把 scaffold 的默认假设直接覆盖到本仓库现实。
- 重要规则优先落到脚本、门禁、配置和模板，不只停留在口头约定。
- 未运行验证，不得声称通过；\`dry-run\` 只代表入口可调度，不代表质量通过。
- 需要执行 shell 命令时，优先使用 \`rtk\` 前缀。
- 不覆盖用户已有未提交改动，不把本地 worktree、缓存、日志、截图混进提交。

## 推荐入口

\`\`\`bash
make preflight
make new-task NAME=workflow-adaptation LEVEL=M
make plan NAME=workflow-adaptation LEVEL=M
make explore FILES='AGENTS.md CLAUDE.md README.md' MSG='main contradiction'
make gate-workflow
make gate-quality
make verify PROFILE=default
make bootstrap-scale
make workflow-upgrade-check
make workflow-upgrade-plan
make workflow-aios-adopt
\`\`\`

PowerShell:

\`\`\`powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/workflow/verify.ps1 -Profile default
\`\`\`

## 任务等级

| Level | 场景 | 最低要求 |
| --- | --- | --- |
| S | typo、小范围文档、纯注释 | 读相关文件并运行最小相关验证 |
| M | 常规 bug、小功能、脚本或治理优化 | 记录 explore/plan/verification/summary |
| L | 跨模块、跨流程、模板体系或发布链路调整 | 完整计划、风险、回滚、评审证据 |
| CRITICAL | 安全、权限、发布、破坏性操作 | 人工确认、完整验证、安全检查 |

## 交付要求

最终汇报至少说明：

- 改了什么。
- 实际运行了哪些验证命令，结果是什么。
- 哪些地方未验证，为什么。
- 如果工作流规则变了，同步更新了哪些文档和配置。
`
}

function scaleEngineRepoClaudeMd(): string {
  return `# CLAUDE.md

Claude / Codex 在本仓库开发 \`scale-engine\` 时，默认遵循 \`AGENTS.md\`。

## 先读

1. \`AGENTS.md\`
2. \`docs/guides/GETTING_STARTED.md\`
3. \`docs/guides/DEVELOPMENT_WORKFLOW.md\`
4. \`docs/workflow/README.md\`

## 常用命令

\`\`\`bash
make preflight
make gate-workflow
make gate-quality
make verify PROFILE=default
make scale-smoke TASK='workflow adaptation' FILES='AGENTS.md,README.md'
make workflow-upgrade-check
make workflow-upgrade-plan
make workflow-aios-adopt
\`\`\`

## 约束

- 没有实际验证结果，不说“已通过”。
- 不确定的事实明确标记为 \`[UNCERTAIN]\`。
- 修改前先看 Git 状态。
- 需要 shell 命令时优先用 \`rtk\` 前缀。
`
}

function scaleEngineRepoMakefile(): string {
  return `.PHONY: help preflight new-task plan explore checkpoint gate gate-workflow gate-quality resume status lint-scaffold verify verify-list validate bootstrap-scale bootstrap-scale-install bootstrap-scale-latest workflow-upgrade-check workflow-upgrade-plan workflow-upgrade-apply workflow-upgrade-rollback workflow-upgrade-verify workflow-aios-adopt scale-version scale-mode scale-context scale-codegraph scale-eval scale-radar scale-dashboard scale-smoke

SCALE ?= scale
POWERSHELL ?= $(shell command -v pwsh 2>/dev/null || command -v powershell 2>/dev/null || echo pwsh)
SCALE_VERSION ?= locked
TASK ?= scale-engine workflow adaptation
FILES ?= AGENTS.md,CLAUDE.md,README.md
LEVEL ?= M
PHASE ?= plan
SERVICES ?=
BUDGET ?= 2400

help:
\t@echo "make preflight | make new-task NAME=x LEVEL=M | make explore FILES='...' MSG='...'"
\t@echo "make plan NAME=x LEVEL=M | make gate-workflow | make gate-quality | make verify PROFILE=default"
\t@echo "make bootstrap-scale | make workflow-upgrade-check | make workflow-upgrade-plan | make workflow-aios-adopt"

gate:
\tbash scripts/gates/all.sh --all

gate-workflow:
\tbash scripts/gates/all.sh --workflow

gate-quality:
\tbash scripts/gates/all.sh --quality

new-task:
\t@if [ -z "$(NAME)" ]; then echo "usage: make new-task NAME=x LEVEL=M"; exit 1; fi
\tbash scripts/workflow/new-task.sh "$(NAME)" "$(or $(LEVEL),M)"

plan:
\t@if [ -z "$(NAME)" ]; then echo "usage: make plan NAME=x LEVEL=M"; exit 1; fi
\tbash scripts/workflow/plan.sh "$(NAME)" "$(or $(LEVEL),M)"

explore:
\t@if [ -z "$(FILES)" ]; then echo "usage: make explore FILES='file1 file2' MSG='main contradiction'"; exit 1; fi
\tbash scripts/workflow/explore.sh $(FILES) "$(MSG)"

checkpoint:
\tbash scripts/workflow/checkpoint.sh "$(or $(PHASE),execute)"

resume:
\tbash scripts/workflow/resume.sh

status: resume

lint-scaffold:
\tbash scripts/workflow/lint-scaffold.sh

verify:
\tbash scripts/workflow/verify.sh --profile "$(or $(PROFILE),default)"

verify-list:
\tbash scripts/workflow/verify.sh --list

validate:
\tbash scripts/validate-config.sh

preflight:
\tbash scripts/preflight/all.sh

bootstrap-scale:
\t$(POWERSHELL) -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-scale.ps1 -Version "$(or $(SCALE_VERSION),locked)"

bootstrap-scale-install:
\t$(POWERSHELL) -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-scale.ps1 -Version "$(or $(SCALE_VERSION),locked)" -AutoInstall

bootstrap-scale-latest:
\t$(POWERSHELL) -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-scale.ps1 -Version latest -AutoInstall

workflow-upgrade-check:
\t$(SCALE) upgrade check --dir .

workflow-upgrade-plan:
\t$(SCALE) upgrade plan --dir . --html

workflow-upgrade-apply:
\t$(SCALE) upgrade apply --dir . --confirm

workflow-upgrade-rollback:
\t$(SCALE) upgrade rollback --dir .

workflow-upgrade-verify:
\t$(SCALE) preflight --dir . --service all --preflight-profile quick

workflow-aios-adopt:
\t$(SCALE) ai-os adopt --dir . --task "$(TASK)" --files "$(FILES)" --level "$(LEVEL)" --budget "$(BUDGET)" --lang zh

scale-version:
\t$(SCALE) --version

scale-mode:
\t$(SCALE) governance mode --task "$(TASK)" --files "$(FILES)"

scale-context:
\t$(SCALE) context budget --dir .

scale-codegraph:
\t$(SCALE) codegraph status --dir .

scale-eval:
\t$(SCALE) eval run --dir .

scale-radar:
\t$(SCALE) skill radar --dir . --task "$(TASK)" --phase "$(PHASE)" --level "$(LEVEL)" --files "$(FILES)" --services "$(SERVICES)"

scale-dashboard:
\t$(SCALE) artifact dashboard --dir . --lang zh

scale-smoke:
\t$(POWERSHELL) -NoProfile -ExecutionPolicy Bypass -File scripts/workflow/scale-smoke.ps1 -Task "$(TASK)" -Files "$(FILES)" -Level "$(LEVEL)" -Phase "$(PHASE)" -Services "$(SERVICES)"
`
}

function scaleEngineRepoGettingStartedGuide(): string {
  return `# SCALE Engine 仓库上手

这份文档面向要开发 \`scale-engine\` 仓库本身的人，不是面向安装 CLI 的最终用户。

## 15 分钟路径

1. 先读根目录 [README.md](../../README.md)。
2. 跑本仓库 workflow 预检：

\`\`\`bash
make preflight
\`\`\`

3. 看当前可用验证面：

\`\`\`bash
make verify-list
\`\`\`

4. 建一个任务骨架并记录探索：

\`\`\`bash
make new-task NAME=example LEVEL=M
make plan NAME=example LEVEL=M
make explore FILES='AGENTS.md CLAUDE.md README.md package.json' MSG='main contradiction'
make gate-workflow
\`\`\`

5. 做完改动后跑质量面：

\`\`\`bash
make gate-quality
make verify PROFILE=default
git diff --check
\`\`\`

## 你应该看到什么

- \`.scale/workspace.json\` 明确了 \`dev -> master\` 的仓库分支策略。
- \`.agent/project.json\` 定义了本仓库的 Node/TypeScript 验证命令。
- \`scripts/gates/*\` 和 \`scripts/workflow/*\` 不是说明文档，而是可执行入口。
- \`.planning/tasks/<date>-<task>/\` 用于任务级证据，不再把临时过程写进 \`docs/\`。

## 常见误区

- \`make gate-workflow\` 通过，不代表代码质量通过。
- \`make gate-quality\` 通过，也不代表你已经记录了风险、回滚和未验证项。
- \`G8\` 会检查改动过的 Markdown 和工作流文档卫生，不替代业务验证。
- \`--dry-run\` 只能证明入口存在，不能写成“测试通过”。
- 不要把 \`.claude/worktrees/\`、\`.agent/state/\`、日志或截图提交进仓库。
`
}

function scaleEngineRepoDevelopmentWorkflowGuide(): string {
  return `# SCALE Engine 开发工作流

这份文档说明日常如何在 \`scale-engine\` 仓库里按最新工程化工作流工作。

## 标准闭环

\`\`\`text
探索 -> 规划 -> 执行 -> 验证 -> 沉淀
\`\`\`

## 1. 探索

目标：先弄清真实仓库状态，再动手。

\`\`\`bash
make new-task NAME=task-slug LEVEL=M
make plan NAME=task-slug LEVEL=M
make explore FILES='AGENTS.md CLAUDE.md README.md package.json src/api/cli.ts' MSG='main contradiction'
make gate-workflow
\`\`\`

最低要求：

- 至少读 3 个相关文件。
- 写清主矛盾，而不是只列文件名。
- 对不确定项明确标出，不靠猜。

## 2. 规划

在 \`.planning/tasks/<task>/plan.md\` 里至少补齐这些信息：

- scope / boundary
- acceptance criteria
- exception / failure path
- rollback / fallback
- verification commands

如果任务改动发布、权限、安全、凭据、npm 发版或破坏性行为，按 \`CRITICAL\` 处理。

## 3. 执行

原则：

- 最小必要修改。
- 优先复用现有脚本和 \`npm\` 命令，不再发明第二套命令。
- 改 \`src/\` 行为时，原则上同步改 \`tests/\`，否则会被 G3 拦下。

## 4. 验证

推荐顺序：

\`\`\`bash
make gate-quality
make verify PROFILE=default
git diff --check
\`\`\`

其中：

- \`G4\` 验证 workflow 脚本本身可解析。
- \`G5\` 运行 \`lint + typecheck + test + build\`。
- \`G6\` 检查任务证据和 diff hygiene。
- \`G7\` 是安全面，默认走 \`npm audit --audit-level=high\`。
- \`G8\` 检查 Markdown 与工作流文档的基础卫生。

## 5. 沉淀

应该留下：

- \`verification.md\`
- \`review.md\`
- \`summary.md\`
- 必要的长期规则文档更新

不应该留下：

- 临时日志
- worktree 状态
- 截图、trace、缓存
- 只对一次任务有意义的中间文件
`
}

function scaleEngineRepoWorkflowReadme(): string {
  return `# SCALE Engine 仓库工作流

这里描述的是 \`scale-engine\` 仓库自身的工程化工作流，不是终端用户如何使用 \`scale\` CLI。

## 入口

- 新维护者先读 [GETTING_STARTED.md](../guides/GETTING_STARTED.md)
- 日常开发读 [DEVELOPMENT_WORKFLOW.md](../guides/DEVELOPMENT_WORKFLOW.md)
- 机器可读分支策略看 [../../.scale/workspace.json](../../.scale/workspace.json)

## 最小命令面

\`\`\`bash
make preflight
make new-task NAME=workflow-adaptation LEVEL=M
make plan NAME=workflow-adaptation LEVEL=M
make explore FILES='AGENTS.md CLAUDE.md README.md package.json' MSG='main contradiction'
make gate-workflow
make gate-quality
make verify PROFILE=default
\`\`\`

PowerShell:

\`\`\`powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/workflow/verify.ps1 -Profile default
\`\`\`

## 门禁说明

| Gate | 作用 |
| --- | --- |
| G1 | 探索是否记录到状态文件，且至少读了 3 个文件 |
| G2 | 计划是否包含边界、异常、回滚、现实校验 |
| G3 | \`src/\` 行为改动是否伴随测试改动 |
| G4 | workflow 脚本是否可解析 |
| G5 | \`lint + typecheck + test + build\` 是否通过 |
| G6 | 任务证据和 \`git diff --check\` 是否通过 |
| G7 | 安全面是否通过 |
| G8 | Markdown 与工作流文档是否符合基础卫生规则 |

## 分支策略

当前仓库采用 GitLab Flow 风格：

\`\`\`text
feature/fix/docs/chore/codex -> dev -> master
\`\`\`

约束：

- \`dev\` 是集成分支。
- \`master\` 是生产基线。
- \`release/*\` 只在必须从生产基线隔离发版时使用。
- \`hotfix/*\` 用于生产紧急修复，并要求回流 \`dev\`。

## 升级入口

如果要把仓库工作流继续升级到更新的 \`scale-engine\` 版本，先跑：

\`\`\`bash
make bootstrap-scale
make workflow-upgrade-check
make workflow-upgrade-plan
make workflow-aios-adopt
\`\`\`

先审计划，再决定是否 \`make workflow-upgrade-apply\`。如果计划提示 AI OS runtime 尚未接入，使用 \`make workflow-aios-adopt\` 生成运行态目录、首份 dry-run、benchmark 和 doctor 报告。
`
}
