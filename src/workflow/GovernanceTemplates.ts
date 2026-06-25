import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { skillRoutingPolicyTemplate } from '../skills/routing/SkillPolicy.js'
import { computeGovernanceDrift, readGovernanceLock, writeGovernanceLock } from './GovernanceLock.js'
import {
  resolveGovernanceTemplatePack,
  type GovernanceGeneratedFile,
  type GovernancePackId,
} from './GovernanceTemplatePacks.js'
import {
  engineeringStandardsBaselineTemplate,
  engineeringStandardsPolicyTemplate,
  frameworksCatalogTemplate,
} from './EngineeringStandards.js'
import { resourceManifestTemplate, resourcePolicyTemplate } from './ResourceGovernance.js'
import type { VerificationService } from './VerificationProfile.js'
import { toolPolicyTemplate, type ToolOrchestrationMode } from '../tools/ToolPolicy.js'
import { outputPolicyTemplate } from '../output/HTMLArtifactLayer.js'

export type GovernanceMode = 'minimal' | 'standard' | 'critical'
export type GovernanceArtifactTemplateName =
  | 'explore.md'
  | 'mini-prd.md'
  | 'skill-plan.md'
  | 'skill-evidence.md'
  | 'runtime.md'
  | 'reality-check.md'
  | 'resource-cleanup.md'
  | 'ui-spec.md'
  | 'visual-review.md'
  | 'api-contract.md'
  | 'docs-impact.md'
  | 'resource-impact.md'
  | 'standards-impact.md'
  | 'architecture-review.md'
  | 'security-review.md'
  | 'db-change-plan.md'
  | 'e2e-plan.md'
  | 'product-smoke.md'
  | 'plan.md'
  | 'verification.md'
  | 'review.md'
  | 'summary.md'

export interface GovernanceTemplateOptions {
  mode?: GovernanceMode
  projectName?: string
  pack?: GovernancePackId | string
  services?: VerificationService[]
  exclude?: string[]
  overwriteManaged?: boolean
}

export interface GovernanceTemplateResult {
  created: string[]
  updated: string[]
  skipped: string[]
}

export function writeGovernanceTemplates(
  projectDir = process.cwd(),
  options: GovernanceTemplateOptions = {},
): GovernanceTemplateResult {
  const mode = options.mode ?? 'standard'
  const projectName = options.projectName ?? 'Project'
  const pack = resolveGovernanceTemplatePack(options.pack)
  const packMode = pack.modeDefaults[mode]
  const services = options.services ?? pack.defaultServices ?? detectRootServices(projectDir, pack.id)
  const exclude = options.exclude ?? pack.exclude ?? ['node_modules', 'dist', 'tmp', 'vendor']
  const result: GovernanceTemplateResult = { created: [], updated: [], skipped: [] }
  const lockFiles = new Map<string, { path: string; owned: boolean; sha256?: string }>()
  const packOverrides = new Set(pack.generatedFiles.map(file => file.path))
  const overwritePaths = options.overwriteManaged
    ? new Set(computeGovernanceDrift(projectDir).clean.map(entry => entry.path))
    : new Set<string>()
  for (const file of readGovernanceLock(projectDir)?.files ?? []) {
    lockFiles.set(file.path, file)
  }

  if (!packOverrides.has('docs/workflow/README.md')) {
    writeTracked(result, lockFiles, projectDir, 'docs/workflow/README.md', workflowReadme(projectName, mode, pack.id), overwritePaths)
  }
  writeTracked(result, lockFiles, projectDir, 'docs/workflow/templates/explore.md', governanceTemplateContent('explore.md'), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'docs/workflow/templates/mini-prd.md', governanceTemplateContent('mini-prd.md'), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'docs/workflow/templates/skill-plan.md', governanceTemplateContent('skill-plan.md'), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'docs/workflow/templates/skill-evidence.md', governanceTemplateContent('skill-evidence.md'), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'docs/workflow/templates/runtime.md', governanceTemplateContent('runtime.md'), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'docs/workflow/templates/reality-check.md', governanceTemplateContent('reality-check.md'), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'docs/workflow/templates/resource-cleanup.md', governanceTemplateContent('resource-cleanup.md'), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'docs/workflow/templates/ui-spec.md', governanceTemplateContent('ui-spec.md'), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'docs/workflow/templates/visual-review.md', governanceTemplateContent('visual-review.md'), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'docs/workflow/templates/api-contract.md', governanceTemplateContent('api-contract.md'), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'docs/workflow/templates/docs-impact.md', governanceTemplateContent('docs-impact.md'), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'docs/workflow/templates/resource-impact.md', governanceTemplateContent('resource-impact.md'), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'docs/workflow/templates/standards-impact.md', governanceTemplateContent('standards-impact.md'), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'docs/workflow/templates/architecture-review.md', governanceTemplateContent('architecture-review.md'), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'docs/workflow/templates/security-review.md', governanceTemplateContent('security-review.md'), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'docs/workflow/templates/db-change-plan.md', governanceTemplateContent('db-change-plan.md'), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'docs/workflow/templates/e2e-plan.md', governanceTemplateContent('e2e-plan.md'), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'docs/workflow/templates/product-smoke.md', governanceTemplateContent('product-smoke.md'), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'docs/workflow/templates/plan.md', governanceTemplateContent('plan.md'), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'docs/workflow/templates/verification.md', governanceTemplateContent('verification.md'), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'docs/workflow/templates/review.md', governanceTemplateContent('review.md'), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'docs/workflow/templates/summary.md', governanceTemplateContent('summary.md'), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'docs/workflow/templates/github-actions-scale-preflight.yml', githubActionsPreflightTemplate(), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'docs/workflow/templates/pre-push-scale-preflight.sh', prePushPreflightTemplate(), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'docs/worklog/metrics.md', metricsTemplate(), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'scripts/qa/product-smoke.ps1', productSmokePowerShellScript(), overwritePaths)
  writeTracked(result, lockFiles, projectDir, 'scripts/qa/product-smoke.sh', productSmokeShellScript(), overwritePaths)
  writeTracked(result, lockFiles, projectDir, '.scale/verification.json', verificationMatrixTemplate(mode, {
    services,
    exclude,
    artifactGate: packMode.artifactGate,
  }), overwritePaths)
  writeTracked(result, lockFiles, projectDir, '.scale/skills.json', skillRoutingPolicyTemplate(mode), overwritePaths)
  writeTracked(result, lockFiles, projectDir, '.scale/tools.json', toolPolicyTemplate(toolModeFromGovernanceMode(mode)), overwritePaths)
  writeTracked(result, lockFiles, projectDir, '.scale/resource-policy.json', resourcePolicyTemplate(), overwritePaths)
  writeTracked(result, lockFiles, projectDir, '.scale/assets.json', resourceManifestTemplate(), overwritePaths)
  writeTracked(result, lockFiles, projectDir, '.scale/output-policy.json', outputPolicyTemplate(), overwritePaths)
  writeTracked(result, lockFiles, projectDir, '.scale/product-smoke.json', productSmokeConfigTemplate(mode), overwritePaths)
  writeTracked(result, lockFiles, projectDir, '.scale/engineering-standards.json', engineeringStandardsPolicyTemplate(), overwritePaths)
  writeTracked(result, lockFiles, projectDir, '.scale/engineering-standards-baseline.json', engineeringStandardsBaselineTemplate(), overwritePaths)
  writeTracked(result, lockFiles, projectDir, '.scale/frameworks.json', frameworksCatalogTemplate(), overwritePaths)

  for (const file of pack.generatedFiles) {
    writePackGeneratedFile(result, lockFiles, projectDir, pack.id, pack.version, file, overwritePaths)
  }

  const lockPath = join(projectDir, '.scale', 'governance.lock.json')
  writeGovernanceLock(projectDir, {
    pack: pack.id,
    packVersion: pack.version,
    scaleVersion: packageVersion(),
    files: [...lockFiles.values()],
  })
  result.created.push(lockPath)

  return result
}

export function governanceTemplateContent(name: GovernanceArtifactTemplateName): string {
  switch (name) {
    case 'explore.md': return exploreTemplate()
    case 'mini-prd.md': return miniPrdTemplate()
    case 'skill-plan.md': return skillPlanTemplate()
    case 'skill-evidence.md': return skillEvidenceTemplate()
    case 'runtime.md': return runtimeTemplate()
    case 'reality-check.md': return realityCheckTemplate()
    case 'resource-cleanup.md': return resourceCleanupTemplate()
    case 'ui-spec.md': return uiSpecTemplate()
    case 'visual-review.md': return visualReviewTemplate()
    case 'api-contract.md': return apiContractTemplate()
    case 'docs-impact.md': return docsImpactTemplate()
    case 'resource-impact.md': return resourceImpactTemplate()
    case 'standards-impact.md': return standardsImpactTemplate()
    case 'architecture-review.md': return architectureReviewTemplate()
    case 'security-review.md': return securityReviewTemplate()
    case 'db-change-plan.md': return dbChangePlanTemplate()
    case 'e2e-plan.md': return e2ePlanTemplate()
    case 'product-smoke.md': return productSmokeTemplate()
    case 'plan.md': return planTemplate()
    case 'verification.md': return verificationTemplate()
    case 'review.md': return reviewTemplate()
    case 'summary.md': return summaryTemplate()
  }
}

function writeIfMissing(result: GovernanceTemplateResult, path: string, content: string, overwrite = false): 'created' | 'updated' | 'skipped' {
  if (existsSync(path)) {
    if (overwrite) {
      writeFileSync(path, content, 'utf-8')
      result.updated.push(path)
      return 'updated'
    }
    result.skipped.push(path)
    return 'skipped'
  }
  const dir = path.split(/[\\/]/).slice(0, -1).join('/')
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, content, 'utf-8')
  result.created.push(path)
  return 'created'
}

function writeTracked(
  result: GovernanceTemplateResult,
  lockFiles: Map<string, { path: string; owned: boolean; sha256?: string }>,
  projectDir: string,
  relativePath: string,
  content: string,
  overwritePaths: Set<string>,
): void {
  const status = writeIfMissing(result, join(projectDir, relativePath), content, overwritePaths.has(relativePath))
  if (status !== 'skipped') lockFiles.set(relativePath, { path: relativePath, owned: true })
}

function writePackGeneratedFile(
  result: GovernanceTemplateResult,
  lockFiles: Map<string, { path: string; owned: boolean; sha256?: string }>,
  projectDir: string,
  packId: string,
  packVersion: number,
  file: GovernanceGeneratedFile,
  overwritePaths: Set<string>,
): void {
  const content = shouldUseGeneratedHeader(file)
    ? generatedHeader(packId, packVersion) + file.content
    : file.content
  const status = writeIfMissing(result, join(projectDir, file.path), content, overwritePaths.has(file.path))
  if (status !== 'skipped') lockFiles.set(file.path, { path: file.path, owned: file.owned })
}

function detectRootServices(projectDir: string, packId: GovernancePackId): VerificationService[] {
  if (packId === 'moe-workspace' || packId === 'go-service-matrix') return []
  if (existsSync(join(projectDir, 'package.json'))) {
    return [{ name: detectNodeServiceName(projectDir), path: '.', type: 'node', required: true }]
  }
  if (existsSync(join(projectDir, 'go.mod'))) {
    return [{ name: basename(projectDir) || 'app', path: '.', type: 'go', required: true }]
  }
  if (
    existsSync(join(projectDir, 'pyproject.toml')) ||
    existsSync(join(projectDir, 'requirements.txt')) ||
    existsSync(join(projectDir, 'setup.py'))
  ) {
    return [{ name: basename(projectDir) || 'app', path: '.', type: 'python', required: true }]
  }
  return []
}

function detectNodeServiceName(projectDir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8')) as { name?: unknown }
    const raw = typeof pkg.name === 'string' ? pkg.name : ''
    const normalized = raw
      .replace(/^@[^/]+\//, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (normalized) return normalized
  } catch (error) {
    // Fall back to the directory name when package.json is absent or malformed.
    void error
  }
  return basename(projectDir) || 'app'
}

function shouldUseGeneratedHeader(file: GovernanceGeneratedFile): boolean {
  return file.kind === 'doc' || file.kind === 'template' || file.kind === 'script'
}

function generatedHeader(packId: string, packVersion: number): string {
  return `# Generated by scale-engine governance pack: ${packId}@${packVersion}
# Edit policy: prefer editing the pack in scale-engine; local overrides should be documented.

`
}

function workflowReadme(projectName: string, mode: GovernanceMode, packId = 'standard'): string {
  return `# ${projectName} Workflow

Governance mode: ${mode}
Governance pack: ${packId}

## Task Levels

| Level | Use for | Required artifacts |
| --- | --- | --- |
| S | typo, comments, small local edits | relevant validation only |
| M | bug fixes, new APIs, 2-5 files | explore, skill plan, plan, verification, review, summary |
| L | cross-module or architecture changes | full artifacts plus human confirmation |
| CRITICAL | auth, permissions, migrations, production config | rollback plan, security review, full verification |

## Standard Task Directory

\`\`\`text
.planning/tasks/<yyyy-mm-dd>-<task-slug>/
├── explore.md
├── mini-prd.md
├── plan.md
├── runtime.md
├── reality-check.md
├── resource-cleanup.md
├── verification.md
├── review.md
├── summary.md
├── artifact-manifest.json
└── artifacts/
    ├── index.html
    └── release-report.html
\`\`\`

## Verification

Use service-aware verification when configured:

\`\`\`bash
scale preflight --service all
scale preflight --service all --preflight-profile full
scale verify <task-id> --profile default
scale verify <task-id> --service <service-name>
scale verify <task-id> --artifact-gate warn
scale verify <task-id> --artifact-gate block
scale verify <task-id> --require-installed-skills
scale verify <task-id> --profile productSmoke
scale task-artifacts check --dir .planning/tasks/<task-dir> --level L
scale artifact render --task-id <task-dir> --type release-report
scale artifact doctor --task-id <task-dir>
\`\`\`

Keep \`.scale/verification.json\` as the source of truth for profiles and service commands.
Keep \`.scale/skills.json\` as the source of truth for active skill routing policy.
Keep \`.scale/output-policy.json\` as the source of truth for derived HTML artifact types, source Markdown mapping, security policy, and Git retention behavior.
Keep \`.scale/resource-policy.json\` and \`.scale/assets.json\` as the source of truth for generated reports, temporary files, module documentation, media, reusable scripts, and Git retention policy.
Keep \`.scale/engineering-standards.json\` and \`.scale/frameworks.json\` as the source of truth for logging, security, ORM, architecture, framework, UI/UX, testing, and coding standard checks.
Keep \`.scale/engineering-standards-baseline.json\` as the temporary exception list for known legacy standards findings; it must not be used to hide new or changed-file problems.
Use \`artifactGate: "warn"\` while introducing the workflow, then move M/L/CRITICAL work to \`"block"\` once templates and local gates are stable.

## Workflow Upgrade

Do not rerun \`scale init\` as a blind upgrade command. Generated governance files may contain local project adaptations.

Use the guarded upgrade flow:

\`\`\`bash
scale upgrade check --dir .
scale upgrade plan --dir . --html
scale upgrade apply --dir . --confirm
scale upgrade rollback --dir .
scale tools outdated --dir .
scale skill outdated --dir .
scale preflight --preflight-profile quick
\`\`\`

Rules:

- \`.scale/governance.lock.json\` records generated file hashes and pack versions.
- Clean or missing generated files can be planned safely.
- Locally changed generated files require manual review before replacement or merge.
- \`scale upgrade apply --confirm\` only restores missing generated files and refreshes the lock after writing \`.scale/backups/upgrade-*/manifest.json\`.
- \`scale upgrade rollback\` only rolls back the latest SCALE-managed safe apply.
- Third-party skills, MCP servers, browser tools, desktop automation, and external CLI tools are never auto-installed by the upgrade flow.
- Community sources require source, install script, permission, and changelog review. Desktop automation is treated as high risk.

## HTML Artifacts

Markdown remains the editable source of truth for task artifacts. HTML artifacts are derived human-review surfaces for plan comparison, implementation plans, code reviews, status reports, incident reports, and release reports.

Use HTML when a human needs to compare, review, or sign off. Keep source Markdown, manifest metadata, and safety checks in place so the derived HTML stays traceable and does not leak secrets or remote scripts.

## Active Skill Routing

SCALE plans required skills from task description, service selection, and changed files. UI/API work requires a Mini-PRD plus domain evidence such as \`ui-spec.md\`, \`visual-review.md\`, or \`api-contract.md\`. Security and database work require explicit review or rollback artifacts.

Tool orchestration is part of the workflow contract:

- UI/UX work requires \`impeccable\` as the deterministic anti-pattern gate, and should use \`taste-skill\`, \`awesome-design-md\`, \`ui-ux-pro-max\`, and \`frontend-design\` as direction/supporting skills alongside browser screenshots, responsive checks, and visual review evidence.
- Web research, logged-in pages, and dynamic browser work require \`web-access\` evidence, source citations, and browser/network/console evidence when available.
- Browser E2E work should combine \`webapp-testing\`, Playwright, Agent Browser, web-access, or Chrome DevTools MCP according to the target and record screenshots plus console/network findings.
- Desktop or client-side GUI automation uses CUA/computer-use only with explicit operator-safety notes, desktop screenshots, and a side-effect boundary.
- External agent or CLI orchestration such as Codex, Gemini CLI, OpenCode, WPS, or WeChat automation must record version checks, exact commands, output summaries, and dry-run or safe-mode evidence.

When a task records \`servicesTouched\`, \`scale verify <task-id>\` uses those services automatically. You can still override selection with \`--service all\`, \`--service api\`, or \`--service api,gateway\`.

Before M/L work, check whether required workflow skills are physically installed:

\`\`\`bash
scale skill doctor --json
scale skill check --require-installed --json
\`\`\`

## Workspace Lifecycle

Before finishing an agent-created branch or deleting a temporary worktree, inspect root and child repository state:

\`\`\`bash
scale workspace status --json
scale workspace finish --summary
scale workspace finish --json
scale workspace cleanup --dir <temporary-worktree> --dry-run --json
scale workspace cleanup --dir <temporary-worktree> --apply --confirm <branch-or-head> --json
\`\`\`

Do not remove a temporary worktree while any submodule or nested repository has uncommitted or unpushed work. Child repositories must be committed and reviewed in their own remotes, then the root repository can record any required pointer or governance updates. Cleanup defaults to dry-run. Applying cleanup requires the reported confirmation token, normally the temporary branch name.

Use \`scale ship <task-id>\` for governed commits. It checks MOE/submodule child repository state before staging reviewed root files, so dirty or unpushed child work cannot be hidden inside a root commit. It also enforces the GitLab Flow branch lifecycle: work happens on short branches, merges target \`dev\`, production lands on \`master\`, and release publishing is triggered by user-created \`vX.Y.Z\` tags. Direct governed commits on \`dev\`, \`master\`, \`main\`, or detached HEAD are blocked. Raw \`git add .\` is outside the governed path and must not be used for MOE releases.

## Resource Governance

Use asset scanning before committing generated reports, media, temporary scripts, or long-lived documentation changes:

\`\`\`bash
scale assets scan --json
scale assets doctor --json
scale assets settle --task-id <task-id> --artifact-dir .planning/tasks/<task-dir>
\`\`\`

Default policy:

- maintained module docs, standards, contracts, ADRs, reusable scripts: commit and keep current.
- task planning, verification, runtime-contract, reality-check, and cleanup artifacts: keep in \`.planning/tasks\`; promote final truth to maintained docs when useful.
- screenshots, videos, E2E reports, coverage, temporary scripts, and runtime logs: keep out of Git unless explicitly promoted.
- large media: use Git LFS or external artifact storage instead of normal Git history.

## Engineering Standards

Use standards scanning before reviewing or shipping M/L/CRITICAL work:

\`\`\`bash
scale standards scan --json
scale standards doctor --json
scale standards doctor --changed --json
scale standards doctor --changed-files src/example.ts,src/example.test.ts --json
scale standards baseline --write --artifact-dir .planning/tasks/<task-dir> --task-id <task-id> --json
scale standards settle --task-id <task-id> --artifact-dir .planning/tasks/<task-dir>
scale preflight --preflight-profile full --json
scale verify <task-id> --json
\`\`\`

Default policy:

- ad-hoc console/output logging is allowed only for CLI/script paths.
- sensitive fields such as token, password, secret, authorization, cookie, and credentials must not be logged.
- hardcoded secret-like assignments are blocked before review or release.
- SQL must use parameterized queries, ORM bind parameters, or safe query builders.
- unsafe HTML sinks, dynamic code execution, empty catch blocks, and type suppressions require remediation before release.
- framework and architecture rules live in \`.scale/frameworks.json\` and module standards docs.
- \`.scale/frameworks.json > bannedImports\` blocks direct use of deprecated ORMs, unsafe SDKs, or off-system UI components.
- \`.scale/frameworks.json > lastReviewedAt/reviewIntervalDays\` warns when module framework decisions need review.
- \`.scale/engineering-standards.json > blockingRules\` promotes selected warning rule IDs to release-blocking findings.
- \`.scale/engineering-standards.json > allowedFindingPatterns\` allows narrow rule/path/evidence exceptions without hiding unrelated findings in the same file.
- \`.scale/engineering-standards-baseline.json\` may hold known legacy findings during rollout, but normal task gates should prefer \`--changed\` or \`--changed-files\` so new work is blocked without forcing a whole-repo cleanup.
- \`.scale/verification.json > policy.engineeringStandardsGate\` controls whether preflight and task verification treat standards as \`off\`, \`warn\`, or \`block\`.
- \`.scale/product-smoke.json\` defines real product-path probes. Use it to prove a routed user/business flow, not only build, unit tests, or \`/health\`.
- \`.scale/verification.json > policy.productSmokeGate\` controls whether missing or failed product smoke evidence warns or blocks M/L/CRITICAL delivery.
- \`.scale/verification.json > policy.ecosystemReadinessGate\` controls whether CI preflight treats missing governed tools or workflow skills as \`off\`, \`warn\`, or \`block\`; \`policy.ecosystemReadinessSkillScope\` selects \`required\`, \`recommended\`, or \`all\` skill tiers for blocking.
- Full standards scans are for release readiness, scheduled remediation, and architecture cleanup. Changed-file scans are the default for day-to-day feature and bug branches.
- Use \`scale standards baseline --write\` only during an explicit rollout or remediation planning task. It writes the machine-readable baseline and a \`standards-legacy-debt.md\` classification report for staged cleanup.

## Automation Templates

Optional automation templates are generated under \`docs/workflow/templates/\`:

- \`github-actions-scale-preflight.yml\`: CI workflow that runs \`scale preflight --service all --preflight-profile ci\`.
- \`pre-push-scale-preflight.sh\`: local pre-push hook template that runs the default quick preflight.

Keep these templates advisory until \`scale preflight --service all --preflight-profile full\` is reliable locally for the project.
`
}

function exploreTemplate(): string {
  return `# Explore

## Files Read

- TBD

## Current Behavior

TBD

## Main Conflict

TBD

## Affected Modules

TBD

## Evidence
TBD
`
}

function miniPrdTemplate(): string {
  return `# Mini-PRD

## Background

TBD

## Target Users

TBD

## Core Scenario

TBD

## Non-Goals

TBD

## User Path

TBD

## Permission Rules

TBD

## Data Impact

TBD

## Exception Scenarios

1. TBD
2. TBD
3. TBD

## Acceptance Criteria

- [ ] TBD

## Rollback Or Disable Strategy
TBD
`
}

function skillPlanTemplate(): string {
  return `# Skill Plan

## Detected Intents

| Domain | Score | Evidence |
| --- | ---: | --- |
|  |  |  |

## Required Skills

- TBD

## Recommended Skills

- TBD

## Required Artifacts

- TBD

## Required Verification Evidence

- TBD

## Tool Orchestration

| Capability | Primary Tool Or Skill | Fallback | Required Evidence |
| --- | --- | --- | --- |
| UI/UX design | impeccable | taste-skill, awesome-design-md, ui-ux-pro-max, frontend-design | design-system, impeccable-report, ui-spec.md, visual-review.md |
| Web research or logged-in pages | web-access | agent-browser, Chrome DevTools MCP | source citations, browser evidence |
| Browser E2E | webapp-testing, Playwright | agent-browser, web-access | screenshot, console, network evidence |
| Desktop GUI automation | CUA/computer-use | manual verification | desktop screenshot, operator-safety notes |
| External agent CLI | codex/gemini/opencode CLI | manual review | version check, exact command output |

## Skipped Skills

| Skill | Reason | Fallback Evidence |
| --- | --- | --- |
|  |  |  |
`
}

function skillEvidenceTemplate(): string {
  return `# Skill Evidence

## Planned Skills

- TBD

## Tool Selection Rationale

TBD

## Used Skills

| Skill | Phase | Trigger | Evidence | Status |
| --- | --- | --- | --- | --- |
| skill-id | plan/build/verify/review | why it was selected | command, screenshot, report, or artifact path | executed/skipped/fallback |

## Browser Or Web Evidence

| Tool | Target | Evidence | Result |
| --- | --- | --- | --- |
| web-access/agent-browser/Chrome DevTools MCP | URL or local target | screenshot, console log, network finding, source URL | passed/failed/skipped |

## Desktop Or External CLI Evidence

| Tool | Scope | Safety Boundary | Evidence | Result |
| --- | --- | --- | --- | --- |
| cua/codex/gemini/opencode/wps/wechat | command or app target | read-only/dry-run/test account/manual approval | output summary, screenshot, or report path | passed/failed/skipped |

## Skipped Skills

| Skill | Reason | Fallback Evidence |
| --- | --- | --- |
| skill-id | why it could not run | manual review, alternate command, or explicit risk |
`
}

function runtimeTemplate(): string {
  return `# Runtime Contract

## Configuration Source

- Source: TBD
- Environment/profile: TBD
- Runtime overrides: TBD
- Secrets boundary: TBD

## Service Topology

| Service | URL Or Command | Config Source | Auth Mode | Status |
| --- | --- | --- | --- | --- |
| TBD | TBD | TBD | TBD | Not checked |

## Verification Boundary

- Confirmed:
- Not covered:
- Credential-gated:
- Environment-gated:
`
}

function realityCheckTemplate(): string {
  return `# Reality Check

## Confirmed

- TBD

## Fact Sources

| Claim | Source | Evidence Type |
| --- | --- | --- |
| TBD | file / command / runtime / dashboard / external source | direct / inferred / unverified |

## Not Verified

- TBD

## Unsupported Claims

| Claim | Why Unsupported | Required Proof |
| --- | --- | --- |
| TBD | TBD | TBD |

## Stub / Fake / Partial

- TBD

## Credential-Gated

- TBD

## Environment-Gated

- TBD

## User-Visible Risk

- TBD
`
}

function resourceCleanupTemplate(): string {
  return `# Resource Cleanup

## New Resources

| Resource | Location | Keep / Move / Delete | Reason |
| --- | --- | --- | --- |
| TBD | TBD | TBD | TBD |

## Docs Promotion

- Promote to docs:
- Keep in planning:
- Keep local/runtime only:
- Delete before handoff:
`
}

function uiSpecTemplate(): string {
  return `# UI Spec

## User Goal

TBD

## Primary Flow

TBD

## Interaction States

- Default:
- Loading:
- Empty:
- Error:
- Success:

## Responsive Behavior

TBD

## Accessibility Requirements

TBD

## Acceptance Criteria

- [ ] TBD
`
}

function visualReviewTemplate(): string {
  return `# Visual Review

## Screenshots Or Evidence

TBD

## Layout And Responsiveness

TBD

## Text Fit And Overlap

TBD

## Accessibility Notes

TBD

## Final Verdict
TBD
`
}

function apiContractTemplate(): string {
  return `# API Contract

## Endpoint Or Interface

TBD

## Request

TBD

## Response

TBD

## Errors

TBD

## Permission Rules

TBD

## Compatibility Notes

TBD

## Acceptance Criteria

- [ ] TBD
`
}

function docsImpactTemplate(): string {
  return `# Docs Impact

## Code Changes Requiring Docs

- TBD

## Documentation Updated

- TBD

## No-Docs-Needed Rationale

TBD

## Links Checked

- TBD
`
}

function toolModeFromGovernanceMode(mode: GovernanceMode): ToolOrchestrationMode {
  if (mode === 'critical') return 'block'
  if (mode === 'minimal') return 'advisory'
  return 'evidence-required'
}

function resourceImpactTemplate(): string {
  return `# Resource Impact

## Resources Created

| Path | Type | Git Policy | Retention |
| --- | --- | --- | --- |
| TBD | canonical-doc/task-artifact/evidence-report/temporary/reusable-script/generated-media/contract/decision-record | commit/ignore/lfs/external/review | TBD |

## Resources Updated

- TBD

## Cross-Repository And Data Impact

| Scope | Path / System | Required Action | Owner / Follow-up |
| --- | --- | --- | --- |
| Related repository | TBD | commit separately / no change / blocked | TBD |
| Data file or generated artifact | TBD | commit / ignore / regenerate / archive | TBD |
| Configuration file | TBD | document / deploy / rollback | TBD |

## External Dependencies

| Dependency | Type | Change | Verification |
| --- | --- | --- | --- |
| TBD | service / package / API / credential / scheduler | TBD | TBD |

## Resources Promoted To Maintained Docs

- TBD

## Resources To Delete Or Archive Before Finish

- TBD

## Source Of Truth Updates

- [ ] .scale/resource-policy.json
- [ ] .scale/assets.json
- [ ] docs/modules/<module>/README.md
`
}

function standardsImpactTemplate(): string {
  return `# Standards Impact

## Standards Checked

- Source files / docs:
  - \`.scale/engineering-standards.json\`:
  - \`.scale/frameworks.json\`:
  - \`docs/standards/\`:
- Commands:
  - \`scale standards doctor --changed --json\`:
  - \`scale standards scan --json\`:

- [ ] Logging and redaction
- [ ] Architecture boundaries
- [ ] ORM/database access
- [ ] Framework/component conventions
- [ ] UI/UX acceptance where user-facing
- [ ] Test and verification rigor
- [ ] Security-sensitive inputs and outputs

## Findings

| Severity | Rule | Path | Decision |
| --- | --- | --- | --- |
| TBD | TBD | TBD | fix/accept/escalate |

## Norm Compliance Verdict

- Project conventions followed: yes / no / not applicable
- Architecture conventions followed: yes / no / not applicable
- Framework/component conventions followed: yes / no / not applicable
- Any accepted deviation and owner: TBD

## Policy Updates

- [ ] .scale/engineering-standards.json
- [ ] .scale/frameworks.json
- [ ] docs/standards/

## Settlement

- Standards scan:
- Standards doctor:
`
}

function architectureReviewTemplate(): string {
  return `# Architecture Review

## Scope

- Modules touched:
- Public contracts touched:
- Data flow touched:

## Architecture Sources

| Source | What It Proves |
| --- | --- |
| CodeGraph context / trace | TBD |
| \`docs/architecture/\` or module docs | TBD |
| \`.scale/frameworks.json\` or standards docs | TBD |

## Boundary Checks

- [ ] API/controller layer does not bypass service/usecase layer
- [ ] Domain layer is not coupled to infrastructure details
- [ ] Repository/ORM usage follows project conventions
- [ ] Shared framework components are reused instead of duplicated
- [ ] New abstractions remove real complexity

## Hallucination Guards

- Claims based on direct source evidence:
- Claims inferred from patterns:
- Claims not verified and therefore excluded from final answer:

## Risks

- TBD

## Decision

- Approved/changes required:
`
}

function securityReviewTemplate(): string {
  return `# Security Review

## Assets And Trust Boundaries

TBD

## Authorization Rules

TBD

## Abuse Cases

1. TBD
2. TBD
3. TBD

## Sensitive Data Impact

TBD

## Rollback Or Disable Strategy

TBD

## Final Verdict
TBD
`
}

function dbChangePlanTemplate(): string {
  return `# DB Change Plan

## Schema Or Data Change

TBD

## SQL / Migration Inventory

| File Or Command | Operation | Environment | Owner |
| --- | --- | --- | --- |
| TBD | schema / data backfill / index / permission / seed | dev / test / prod | TBD |

## Application And Service Coupling

- Services that must be deployed with this DB change: TBD
- Feature flags or compatibility mode: TBD
- Third-party or reporting systems affected: TBD

## Backward Compatibility

TBD

## Migration Steps

TBD

## Rollback Plan

TBD

## Verification
TBD

## Release Note

- Required in release report: yes / no
- Operator instructions: TBD
`
}

function e2ePlanTemplate(): string {
  return `# E2E Plan

## User Paths

TBD

## Browser Coverage

TBD

## Test Data

TBD

## Assertions

TBD

## Evidence
TBD
`
}

function productSmokeTemplate(): string {
  return `# Product Smoke

## Real Product Path

Describe the smallest end-to-end path that proves the change works through the real product boundary.

Example:

\`\`\`text
UI or client -> gateway/router -> service -> database/storage/queue -> observable result
\`\`\`

Do not use a green health endpoint as the only proof when the user-facing path depends on routing, authentication, storage, async tasks, browser behavior, or third-party integration.

## Quick Setup

1. Open \`.scale/product-smoke.json\`.
2. Replace the example command with one real product path command.
3. Set that probe's \`enabled\` field to \`true\`.
4. Run \`scale preflight --profile productSmoke --json\`.
5. Run \`scale runtime final-check --level M --json\`.

\`status: "skipped"\` means no real product path was exercised. It does not count as completion evidence.

## Setup

- Base URL:
- Test user or tenant:
- Required fixtures:
- Services that must be running:

## Smoke Commands

| Command | Expected Result | Evidence Artifact |
| --- | --- | --- |
| TBD | TBD | TBD |

## Runtime Evidence

Record at least one runtime evidence item:

\`\`\`bash
scale runtime record \\
  --kind command \\
  --title "Product smoke: <flow>" \\
  --status passed \\
  --command "<exact smoke command>" \\
  --exit-code 0 \\
  --summary "<business result, task id, status, or observable output>" \\
  --artifacts ".agent/logs/<service>/<smoke>.json" \\
  --metadata-json '{"productSmoke":true,"realProductPath":true}'
\`\`\`

## Assertions

- [ ] Request crossed the real product boundary, not only an isolated unit.
- [ ] Authentication or user identity path was exercised when relevant.
- [ ] Persistence/storage/queue side effect was verified when relevant.
- [ ] Async task or eventual state was polled to terminal status when relevant.
- [ ] Failure output is specific enough to diagnose the failing layer.
- [ ] Runtime artifacts are ignored or deliberately promoted according to resource governance.
`
}

function planTemplate(): string {
  return `# Plan

## Approach

TBD

## Boundaries

TBD

## Exception Contract

1. TBD
2. TBD
3. TBD

## Rollback Plan

TBD

## Human Confirmation

- Required for L/CRITICAL tasks:
- Confirmation source:
- Execution boundary approved:

## Test Strategy
TBD
`
}

function verificationTemplate(): string {
  return `# Verification

## Commands Run

| Command | Result | Notes |
| --- | --- | --- |
|  |  |  |

## Output Summary

TBD

## Failures And Fixes

TBD

## Regression / Stability Checks

- Previously stable path reviewed:
- Live/runtime path checked:
- Cross-OS path checked:
- Same-pattern scan result:

## Learning Evidence

- Memory recall query/result:
- Project knowledge updated:
- Cortex instinct/failure replay recorded:
- Prevention gate or test added:

## Final Status
TBD
`
}

function reviewTemplate(): string {
  return `# Review

## Code Review

TBD

## Security Review

TBD

## Same-Pattern Scan

TBD

## Residual Risks
TBD
`
}

function summaryTemplate(): string {
  return `# Summary

## Delivered Changes

TBD

## Files And Operations

| Area | Paths Or Commands | Reason | User-Visible Impact |
| --- | --- | --- | --- |
| Code | TBD | TBD | TBD |
| Config | TBD | TBD | TBD |
| Data / Generated Files | TBD | TBD | TBD |
| Related Repositories | TBD | TBD | TBD |

## Release / Deployment Disclosure

- Release or deployment requested: no
- SQL or migration changes: none
- Configuration changes: none
- Related projects that must ship together: none
- External services or third-party systems affected: none
- Runtime/dashboard evidence: TBD
- Rollback or disable path: TBD

## Remaining Risks

TBD

## Learning And Prevention

- What failed or nearly escaped:
- Root cause:
- Memory/Cortex entry or failure replay:
- New gate, test, or checklist that prevents repeat:

## Follow-Ups

TBD

## Metric Row

| Date | Task | Level | Services | Files Changed | First Verification Pass | Fix Iterations | Artifact Complete | Residual Risk | Final Gate |
| --- | --- | --- | --- | ---: | --- | ---: | --- | --- | --- |
|  |  |  |  |  |  |  |  |  |  |
`
}

function metricsTemplate(): string {
  return `# Workflow Metrics

<!-- SCALE_METRICS:START -->
| Date | Task | Level | Services | Files Changed | First Verification Pass | Fix Iterations | Rework Needed | Artifact Complete | Residual Risk | Final Gate |
| --- | --- | --- | --- | ---: | --- | ---: | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |  |  |  |
<!-- SCALE_METRICS:END -->

## Monthly Review

### Repeated Failure Patterns

TBD

### Slowest Gates

TBD

### Documentation Gaps

TBD

### Product Design Misses

TBD

### Proposed Workflow Changes
TBD
`
}

function verificationMatrixTemplate(
  mode: GovernanceMode,
  options: { services?: VerificationService[]; exclude?: string[]; artifactGate?: 'off' | 'warn' | 'block' } = {},
): string {
  return JSON.stringify({
    version: 1,
    defaultProfile: 'default',
    profiles: {
      default: {
        commands: {},
        services: options.services?.filter(service => service.required !== false).map(service => service.name) ?? [],
      },
      productSmoke: {
        commands: {
          smoke: 'powershell -ExecutionPolicy Bypass -File scripts/qa/product-smoke.ps1',
        },
        services: options.services?.filter(service => service.required !== false).map(service => service.name) ?? [],
      },
    },
    services: options.services ?? [],
    exclude: options.exclude ?? ['node_modules', 'dist', 'tmp', 'vendor'],
    policy: {
      mode,
      optionalToolsWarnOnly: true,
      artifactGate: options.artifactGate ?? (mode === 'critical' ? 'block' : 'warn'),
      artifactGateLevels: ['M', 'L', 'CRITICAL'],
      engineeringStandardsGate: mode === 'minimal' ? 'warn' : 'block',
      productSmokeGate: mode === 'critical' ? 'block' : 'warn',
      ecosystemReadinessGate: mode === 'minimal' ? 'warn' : 'block',
      ecosystemReadinessPacks: ['full'],
      ecosystemReadinessSkillScope: 'required',
    },
  }, null, 2) + '\n'
}

function productSmokeConfigTemplate(mode: GovernanceMode): string {
  return JSON.stringify({
    version: 1,
    gate: mode === 'critical' ? 'block' : 'warn',
    requiredForLevels: ['M', 'L', 'CRITICAL'],
    emptyProbeBehavior: 'block',
    setupGuide: [
      'Set probes[].enabled=true only after replacing the example command with a real product path.',
      'Use a command that crosses the real boundary: client/UI -> gateway/router -> service -> persistence or observable result.',
      'Run: scale preflight --profile productSmoke --json',
      'Run: scale runtime final-check --level M --json',
    ],
    runtimeEvidence: {
      requiredKind: 'command',
      requiredStatus: 'passed',
      requireArtifacts: true,
    },
    probes: [
      {
        id: 'example-business-flow',
        enabled: false,
        description: 'Replace with a real user/product path such as UI -> gateway -> service -> database/storage.',
        command: 'curl -fsS http://127.0.0.1:3000/health',
        expected: {
          exitCode: 0,
          evidenceArtifact: '.agent/logs/product-smoke.json',
        },
      },
    ],
  }, null, 2) + '\n'
}

function productSmokePowerShellScript(): string {
  return `# Product smoke probe runner generated by scale-engine.
$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
$ConfigPath = Join-Path $Root ".scale\\product-smoke.json"
$LogDir = Join-Path $Root ".agent\\logs"
$LogPath = Join-Path $LogDir "product-smoke.json"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$NodeProgram = @'
${productSmokeNodeProgram()}
'@

$TempFile = [System.IO.Path]::GetTempFileName() + ".js"
Set-Content -Path $TempFile -Value $NodeProgram -Encoding UTF8
try {
  node $TempFile $ConfigPath $LogPath
  exit $LASTEXITCODE
} finally {
  Remove-Item -Force $TempFile -ErrorAction SilentlyContinue
}
`
}

function productSmokeShellScript(): string {
  return `#!/usr/bin/env sh
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG_PATH="$ROOT/.scale/product-smoke.json"
LOG_DIR="$ROOT/.agent/logs"
LOG_PATH="$LOG_DIR/product-smoke.json"

mkdir -p "$LOG_DIR"

node - "$CONFIG_PATH" "$LOG_PATH" <<'NODE'
${productSmokeNodeProgram()}
NODE
`
}

function productSmokeNodeProgram(): string {
  return `const fs = require('fs');
const cp = require('child_process');
const path = require('path');

const configPath = process.argv[2];
const logPath = process.argv[3];

function writeReport(report) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, JSON.stringify(report, null, 2) + '\\n', 'utf8');
  process.stdout.write(JSON.stringify(report, null, 2) + '\\n');
}

if (!fs.existsSync(configPath)) {
  writeReport({
    version: 1,
    status: 'failed',
    verifiedAt: new Date().toISOString(),
    message: 'Missing .scale/product-smoke.json',
    results: []
  });
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\\uFEFF/, ''));
const probes = Array.isArray(config.probes) ? config.probes.filter(probe => probe && probe.enabled === true) : [];

if (probes.length === 0) {
  const status = config.emptyProbeBehavior === 'block' ? 'failed' : 'skipped';
  writeReport({
    version: 1,
    status,
    verifiedAt: new Date().toISOString(),
    message: 'No enabled product smoke probes. Enable probes in .scale/product-smoke.json after defining the real product path.',
    results: []
  });
  process.exit(status === 'failed' ? 1 : 0);
}

const results = probes.map((probe) => {
  const startedAt = new Date().toISOString();
  const expectedExitCode = Number.isInteger(probe.expected && probe.expected.exitCode) ? probe.expected.exitCode : 0;
  const command = String(probe.command || '');
  if (!command.trim()) {
    return {
      id: String(probe.id || 'unnamed-probe'),
      description: String(probe.description || ''),
      command,
      expectedExitCode,
      exitCode: 1,
      status: 'failed',
      startedAt,
      endedAt: new Date().toISOString(),
      outputTail: 'Probe command is empty'
    };
  }
  const result = cp.spawnSync(command, {
    cwd: process.cwd(),
    shell: true,
    encoding: 'utf8',
    timeout: Number(config.timeoutMs || 180000)
  });
  const output = String(result.stdout || '') + String(result.stderr || '') + String(result.error ? result.error.message : '');
  const exitCode = typeof result.status === 'number' ? result.status : 1;
  return {
    id: String(probe.id || 'unnamed-probe'),
    description: String(probe.description || ''),
    command,
    expectedExitCode,
    exitCode,
    status: exitCode === expectedExitCode ? 'passed' : 'failed',
    startedAt,
    endedAt: new Date().toISOString(),
    outputTail: output.length > 2000 ? output.slice(-2000) : output
  };
});

const failed = results.filter(result => result.status !== 'passed');
writeReport({
  version: 1,
  status: failed.length === 0 ? 'passed' : 'failed',
  verifiedAt: new Date().toISOString(),
  results
});
process.exit(failed.length === 0 ? 0 : 1);
`
}

function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as { version?: string }
    return pkg.version ?? '0.0.0-dev'
  } catch {
    return '0.0.0-dev'
  }
}

function githubActionsPreflightTemplate(): string {
  return `name: SCALE Preflight

on:
  pull_request:
  push:
    branches:
      - main
      - master

permissions:
  contents: read

jobs:
  preflight:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install project dependencies when present
        shell: bash
        run: |
          if [ -f package-lock.json ]; then
            npm ci
          elif [ -f package.json ]; then
            npm install
          fi

      - name: Run SCALE preflight
        run: npx @hongmaple0820/scale-engine@latest preflight --service all --profile ci --preflight-profile ci
`
}

function prePushPreflightTemplate(): string {
  return `#!/usr/bin/env sh
set -eu

if command -v scale >/dev/null 2>&1; then
  scale preflight --service all
else
  npx @hongmaple0820/scale-engine@latest preflight --service all
fi
`
}
