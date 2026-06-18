import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { governanceTemplateContent, writeGovernanceTemplates } from '../../src/workflow/GovernanceTemplates.js'
import { computeGovernanceDrift } from '../../src/workflow/GovernanceLock.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-governance-'))
  dirs.push(dir)
  return dir
}

describe('writeGovernanceTemplates', () => {
  it('creates workflow templates, metrics, and verification matrix', () => {
    const dir = makeDir()

    const result = writeGovernanceTemplates(dir, { mode: 'critical', projectName: 'Demo' })

    expect(result.created).toEqual(expect.arrayContaining([
      join(dir, 'docs', 'workflow', 'README.md'),
      join(dir, 'docs', 'workflow', 'templates', 'mini-prd.md'),
      join(dir, 'docs', 'workflow', 'templates', 'skill-plan.md'),
      join(dir, 'docs', 'workflow', 'templates', 'skill-evidence.md'),
      join(dir, 'docs', 'workflow', 'templates', 'runtime.md'),
      join(dir, 'docs', 'workflow', 'templates', 'reality-check.md'),
      join(dir, 'docs', 'workflow', 'templates', 'resource-cleanup.md'),
      join(dir, 'docs', 'workflow', 'templates', 'ui-spec.md'),
      join(dir, 'docs', 'workflow', 'templates', 'docs-impact.md'),
      join(dir, 'docs', 'workflow', 'templates', 'resource-impact.md'),
      join(dir, 'docs', 'workflow', 'templates', 'standards-impact.md'),
      join(dir, 'docs', 'workflow', 'templates', 'architecture-review.md'),
      join(dir, 'docs', 'workflow', 'templates', 'github-actions-scale-preflight.yml'),
      join(dir, 'docs', 'workflow', 'templates', 'pre-push-scale-preflight.sh'),
      join(dir, 'docs', 'workflow', 'templates', 'product-smoke.md'),
      join(dir, 'docs', 'worklog', 'metrics.md'),
      join(dir, 'scripts', 'qa', 'product-smoke.ps1'),
      join(dir, 'scripts', 'qa', 'product-smoke.sh'),
      join(dir, '.scale', 'verification.json'),
      join(dir, '.scale', 'product-smoke.json'),
      join(dir, '.scale', 'skills.json'),
      join(dir, '.scale', 'tools.json'),
      join(dir, '.scale', 'resource-policy.json'),
      join(dir, '.scale', 'assets.json'),
      join(dir, '.scale', 'output-policy.json'),
      join(dir, '.scale', 'engineering-standards.json'),
      join(dir, '.scale', 'engineering-standards-baseline.json'),
      join(dir, '.scale', 'frameworks.json'),
      join(dir, '.scale', 'governance.lock.json'),
    ]))
    expect(readFileSync(join(dir, 'docs', 'workflow', 'README.md'), 'utf-8')).toContain('Governance mode: critical')
    expect(readFileSync(join(dir, 'docs', 'workflow', 'README.md'), 'utf-8')).toContain('Tool orchestration is part of the workflow contract')
    expect(readFileSync(join(dir, 'docs', 'workflow', 'README.md'), 'utf-8')).toContain('## Workflow Upgrade')
    expect(readFileSync(join(dir, 'docs', 'workflow', 'README.md'), 'utf-8')).toContain('## HTML Artifacts')
    expect(readFileSync(join(dir, 'docs', 'workflow', 'README.md'), 'utf-8')).toContain('.planning/tasks/<yyyy-mm-dd>-<task-slug>/')
    expect(readFileSync(join(dir, 'docs', 'workflow', 'templates', 'skill-plan.md'), 'utf-8')).toContain('## Tool Orchestration')
    expect(readFileSync(join(dir, 'docs', 'workflow', 'templates', 'skill-evidence.md'), 'utf-8')).toContain('## Browser Or Web Evidence')
    expect(readFileSync(join(dir, 'docs', 'workflow', 'templates', 'reality-check.md'), 'utf-8')).toContain('## Credential-Gated')
    expect(readFileSync(join(dir, 'docs', 'workflow', 'templates', 'verification.md'), 'utf-8')).toContain('## Learning Evidence')
    expect(readFileSync(join(dir, 'docs', 'workflow', 'templates', 'summary.md'), 'utf-8')).toContain('## Learning And Prevention')
    expect(readFileSync(join(dir, 'docs', 'workflow', 'templates', 'product-smoke.md'), 'utf-8')).toContain('## Real Product Path')
    expect(readFileSync(join(dir, 'docs', 'workflow', 'templates', 'product-smoke.md'), 'utf-8')).toContain('## Quick Setup')
    expect(readFileSync(join(dir, 'docs', 'workflow', 'templates', 'product-smoke.md'), 'utf-8')).toContain('scale preflight --profile productSmoke --json')
    expect(readFileSync(join(dir, 'docs', 'workflow', 'templates', 'product-smoke.md'), 'utf-8')).toContain('"productSmoke":true')
    expect(readFileSync(join(dir, 'scripts', 'qa', 'product-smoke.ps1'), 'utf-8')).toContain('$ConfigPath = Join-Path $Root ".scale\\product-smoke.json"')
    expect(readFileSync(join(dir, 'scripts', 'qa', 'product-smoke.sh'), 'utf-8')).toContain('CONFIG_PATH="$ROOT/.scale/product-smoke.json"')
    expect(readFileSync(join(dir, 'scripts', 'qa', 'product-smoke.ps1'), 'utf-8')).toContain("replace(/^\\uFEFF/, '')")
    const githubActionsPreflight = readFileSync(join(dir, 'docs', 'workflow', 'templates', 'github-actions-scale-preflight.yml'), 'utf-8')
    expect(githubActionsPreflight).toContain('permissions:')
    expect(githubActionsPreflight).toContain('contents: read')
    expect(githubActionsPreflight).toContain('scale-engine@latest preflight --service all --profile ci --preflight-profile ci')
    const verification = JSON.parse(readFileSync(join(dir, '.scale', 'verification.json'), 'utf-8'))
    expect(verification.policy).toMatchObject({
      mode: 'critical',
      artifactGate: 'block',
      engineeringStandardsGate: 'block',
      productSmokeGate: 'block',
      ecosystemReadinessGate: 'block',
      ecosystemReadinessPacks: ['full'],
    })
    expect(verification.profiles.productSmoke.commands.smoke).toBe('powershell -ExecutionPolicy Bypass -File scripts/qa/product-smoke.ps1')
    expect(JSON.parse(readFileSync(join(dir, '.scale', 'product-smoke.json'), 'utf-8'))).toMatchObject({
      version: 1,
      gate: 'block',
      setupGuide: expect.arrayContaining([
        'Set probes[].enabled=true only after replacing the example command with a real product path.',
      ]),
      runtimeEvidence: {
        requiredKind: 'command',
      },
    })
    expect(JSON.parse(readFileSync(join(dir, '.scale', 'skills.json'), 'utf-8')).policy).toMatchObject({
      mode: 'block',
      requireSkillPlan: true,
    })
    const skills = JSON.parse(readFileSync(join(dir, '.scale', 'skills.json'), 'utf-8'))
    expect(skills.skillSources).toMatchObject({
      primaryRoot: '.scale/skills',
      fallbackRoots: ['skills'],
    })
    expect(skills.domains.ui.requiredSkills).toContain('awesome-design-md')
    expect(skills.domains.ui.requiredSkills).toContain('ui-ux-pro-max')
    expect(skills.domains.ui.recommendedSkills).toContain('frontend-design')
    expect(skills.domains.ui.recommendedSkills).toContain('webapp-testing')
    expect(skills.domains.webResearch.requiredSkills).toContain('web-access')
    expect(skills.domains.browserAutomation.recommendedSkills).toEqual(expect.arrayContaining(['agent-browser', 'mcp-chrome-devtools']))
    expect(skills.domains.desktopAutomation.requiredSkills).toContain('turix-cua')
    expect(skills.domains.externalCli.recommendedSkills).toEqual(expect.arrayContaining(['codex-cli', 'gemini-cli', 'opencode-cli']))
    expect(skills.domains.review.requiredSkills).toContain('code-reviewer')
    expect(skills.domains.docs.recommendedSkills).toContain('update-docs')
    expect(skills.domains.resourceGovernance.requiredArtifacts).toContain('resource-impact.md')
    expect(skills.domains.engineeringStandards.requiredArtifacts).toContain('standards-impact.md')
    expect(JSON.parse(readFileSync(join(dir, '.scale', 'resource-policy.json'), 'utf-8')).retainedRuntimeDirectories).toContain('test-results')
    const outputPolicy = JSON.parse(readFileSync(join(dir, '.scale', 'output-policy.json'), 'utf-8'))
    expect(outputPolicy.templates).toHaveProperty('release-report')
    expect(outputPolicy.safety.allowRemoteScripts).toBe(false)
    const tools = JSON.parse(readFileSync(join(dir, '.scale', 'tools.json'), 'utf-8'))
    expect(tools.mode).toBe('block')
    expect(tools.tools).toHaveProperty('agent-browser')
    expect(tools.tools).toHaveProperty('desktop-cua')
    const engineeringStandards = JSON.parse(readFileSync(join(dir, '.scale', 'engineering-standards.json'), 'utf-8'))
    expect(engineeringStandards.logging.sensitiveFields).toContain('token')
    expect(engineeringStandards.blockingRules).toEqual([])
    expect(JSON.parse(readFileSync(join(dir, '.scale', 'engineering-standards-baseline.json'), 'utf-8'))).toMatchObject({
      version: 1,
      findings: [],
    })
    const frameworks = JSON.parse(readFileSync(join(dir, '.scale', 'frameworks.json'), 'utf-8'))
    expect(frameworks.bannedImports).toEqual([])
    expect(frameworks.reviewIntervalDays).toBe(90)
  })

  it('generates project-scaffold pack wrappers and governance lock', () => {
    const dir = makeDir()

    const result = writeGovernanceTemplates(dir, {
      mode: 'standard',
      projectName: 'Scaffold',
      pack: 'project-scaffold',
    })

    expect(result.created).toEqual(expect.arrayContaining([
      join(dir, 'scripts', 'workflow', 'new-task.sh'),
      join(dir, 'scripts', 'workflow', 'new-task.ps1'),
      join(dir, 'scripts', 'gates', 'all.sh'),
      join(dir, 'scripts', 'gates', 'all.ps1'),
      join(dir, '.scale', 'governance.lock.json'),
    ]))
    expect(readFileSync(join(dir, 'scripts', 'workflow', 'new-task.sh'), 'utf-8')).toContain('@hongmaple0820/scale-engine@latest')
    expect(readFileSync(join(dir, 'scripts', 'workflow', 'new-task.sh'), 'utf-8')).toContain('Windows npm scale was detected inside WSL')
    expect(readFileSync(join(dir, 'scripts', 'workflow', 'new-task.ps1'), 'utf-8')).toContain('Invoke-Scale')
    expect(readFileSync(join(dir, 'scripts', 'workflow', 'new-task.ps1'), 'utf-8')).toContain('exit $LASTEXITCODE')
    expect(JSON.parse(readFileSync(join(dir, '.scale', 'governance.lock.json'), 'utf-8'))).toMatchObject({
      pack: 'project-scaffold',
      packVersion: 2,
    })
    expect(JSON.parse(readFileSync(join(dir, '.scale', 'verification.json'), 'utf-8')).policy).toMatchObject({
      mode: 'standard',
      ecosystemReadinessGate: 'block',
      ecosystemReadinessSkillScope: 'required',
    })
  })

  it('auto-detects a root Node service for runnable project-scaffold demos', () => {
    const dir = makeDir()
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: '@demo/small-app',
      scripts: {
        build: 'tsc --noEmit',
        lint: 'tsc --noEmit',
        test: 'vitest run',
      },
    }, null, 2), 'utf-8')

    writeGovernanceTemplates(dir, {
      mode: 'standard',
      projectName: 'Small App',
      pack: 'project-scaffold',
    })

    const matrix = JSON.parse(readFileSync(join(dir, '.scale', 'verification.json'), 'utf-8'))
    expect(matrix.profiles.default.services).toEqual(['small-app'])
    expect(matrix.services).toEqual([
      { name: 'small-app', path: '.', type: 'node', required: true },
    ])
  })

  it('generates Go service-matrix verification config', () => {
    const dir = makeDir()

    writeGovernanceTemplates(dir, { mode: 'standard', pack: 'go-service-matrix' })

    const matrix = JSON.parse(readFileSync(join(dir, '.scale', 'verification.json'), 'utf-8'))
    expect(matrix.profiles.default.services).toEqual(['netdisk', 'auth', 'gateway'])
    expect(matrix.services.map((service: { name: string }) => service.name)).toEqual(['netdisk', 'auth', 'gateway'])
    expect(matrix.exclude).toEqual(expect.arrayContaining(['OpenList', 'gfast', 'mcp-zero']))
  })

  it('generates node-library workflow entry points and single-repo topology', () => {
    const dir = makeDir()
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: '@demo/node-workflow',
      scripts: {
        build: 'tsc --noEmit',
        lint: 'eslint src/**/*.ts',
        test: 'vitest run',
        typecheck: 'tsc --noEmit',
      },
    }, null, 2), 'utf-8')

    const result = writeGovernanceTemplates(dir, {
      mode: 'standard',
      projectName: 'Node Workflow',
      pack: 'node-library',
    })

    expect(result.created).toEqual(expect.arrayContaining([
      join(dir, 'scripts', 'preflight', 'all.sh'),
      join(dir, 'scripts', 'preflight', 'all.ps1'),
      join(dir, 'docs', 'workflow', 'node-library.md'),
      join(dir, '.scale', 'workspace.json'),
      join(dir, '.planning', 'tasks', '.gitkeep'),
    ]))
    expect(readFileSync(join(dir, 'scripts', 'preflight', 'all.sh'), 'utf-8')).toContain('[PREFLIGHT] node-library workflow')
    expect(readFileSync(join(dir, 'scripts', 'preflight', 'all.ps1'), 'utf-8')).toContain("[PREFLIGHT] node-library workflow")
    const nodeLibraryDoc = readFileSync(join(dir, 'docs', 'workflow', 'node-library.md'), 'utf-8')
    expect(nodeLibraryDoc).toContain('feature/fix/docs/chore/codex -> dev -> master -> tag/publish')
    expect(nodeLibraryDoc).toContain('pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/preflight/all.ps1')
    expect(JSON.parse(readFileSync(join(dir, '.scale', 'workspace.json'), 'utf-8'))).toMatchObject({
      topology: 'single',
      repositories: [
        { name: 'root', path: '.', role: 'root', required: true },
      ],
      finishPolicy: {
        requireCleanRepositories: true,
        requirePushedBranches: true,
        requireRootPointerUpdate: false,
      },
    })
  })

  it('generates MOE workspace topology and documentation', () => {
    const dir = makeDir()

    const result = writeGovernanceTemplates(dir, { mode: 'critical', projectName: 'MOE Demo', pack: 'moe-workspace' })

    expect(result.created).toEqual(expect.arrayContaining([
      join(dir, '.scale', 'workspace.json'),
      join(dir, 'docs', 'workflow', 'moe-workspace.md'),
    ]))
    expect(JSON.parse(readFileSync(join(dir, '.scale', 'workspace.json'), 'utf-8'))).toMatchObject({
      topology: 'moe',
      finishPolicy: {
        requireCleanRepositories: true,
        requirePushedBranches: true,
        requireRootPointerUpdate: true,
      },
    })
    expect(readFileSync(join(dir, 'docs', 'workflow', 'moe-workspace.md'), 'utf-8')).toContain('MOE Workspace Governance')
    expect(readFileSync(join(dir, 'docs', 'workflow', 'README.md'), 'utf-8')).toContain('Governance pack: moe-workspace')
  })

  it('generates scale-engine-repo governance assets', () => {
    const dir = makeDir()

    const result = writeGovernanceTemplates(dir, {
      mode: 'standard',
      projectName: 'scale-engine',
      pack: 'scale-engine-repo',
    })

    expect(result.created).toEqual(expect.arrayContaining([
      join(dir, '.scale', 'workspace.json'),
      join(dir, '.agent', 'project.json'),
      join(dir, '.claude', 'settings.json'),
      join(dir, '.claude', 'workflow.json'),
      join(dir, '.claude', 'hooks', 'session-start-reminder.sh'),
      join(dir, '.claude', 'hooks', 'gate-execute-phase.sh'),
      join(dir, '.claude', 'hooks', 'session-end-gate.sh'),
      join(dir, 'scripts', 'hooks', 'check-dangerous-file.sh'),
      join(dir, 'scripts', 'hooks', 'check-explore.sh'),
      join(dir, 'scripts', 'hooks', 'check-tdd.sh'),
      join(dir, 'scripts', 'hooks', 'check-context.sh'),
      join(dir, 'scripts', 'workflow', 'new-task.sh'),
      join(dir, 'scripts', 'workflow', 'explore.sh'),
      join(dir, 'scripts', 'workflow', 'resume.sh'),
      join(dir, 'scripts', 'workflow', 'verify.sh'),
      join(dir, 'scripts', 'gates', 'all.sh'),
      join(dir, 'scripts', 'workflow', 'new-task.ps1'),
      join(dir, 'scripts', 'workflow', 'explore.ps1'),
      join(dir, 'scripts', 'workflow', 'resume.ps1'),
      join(dir, 'scripts', 'workflow', 'verify.ps1'),
      join(dir, 'scripts', 'gates', 'all.ps1'),
      join(dir, 'AGENTS.md'),
      join(dir, 'CLAUDE.md'),
      join(dir, 'Makefile'),
      join(dir, 'docs', 'guides', 'GETTING_STARTED.md'),
      join(dir, 'docs', 'guides', 'DEVELOPMENT_WORKFLOW.md'),
      join(dir, 'docs', 'workflow', 'README.md'),
      join(dir, '.scale', 'governance.lock.json'),
    ]))
    expect(JSON.parse(readFileSync(join(dir, '.scale', 'governance.lock.json'), 'utf-8'))).toMatchObject({
      pack: 'scale-engine-repo',
      packVersion: 1,
    })
    expect(JSON.parse(readFileSync(join(dir, '.scale', 'workspace.json'), 'utf-8'))).toMatchObject({
      topology: 'single',
      branchPolicy: {
        integrationBranch: 'dev',
        productionBranch: 'master',
        requireAuthorScopeDate: true,
      },
      finishPolicy: {
        requirePushedBranches: true,
      },
    })
    expect(JSON.parse(readFileSync(join(dir, '.agent', 'project.json'), 'utf-8'))).toMatchObject({
      profiles: {
        default: {
          checks: ['lint', 'typecheck', 'test', 'build'],
        },
      },
    })
    const claudeSettings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8'))
    expect(claudeSettings.permissions.allow).toContain('Bash(bash scripts/hooks/*: *)')
    expect(claudeSettings.permissions.allow).toContain('Bash(bash .claude/hooks/*: *)')
    expect(claudeSettings.hooks.SessionStart).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'bash .claude/hooks/session-start-reminder.sh' }),
    ]))
    expect(claudeSettings.hooks.PreToolUse).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'bash scripts/hooks/check-dangerous-file.sh' }),
      expect.objectContaining({ command: 'bash scripts/hooks/check-explore.sh' }),
      expect.objectContaining({ command: 'bash scripts/hooks/check-tdd.sh' }),
      expect.objectContaining({ command: 'bash .claude/hooks/gate-execute-phase.sh' }),
    ]))
    expect(claudeSettings.hooks.Stop).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'bash .claude/hooks/session-end-gate.sh' }),
    ]))
    expect(readFileSync(join(dir, 'docs', 'guides', 'GETTING_STARTED.md'), 'utf-8')).toContain('make preflight')
    expect(readFileSync(join(dir, 'scripts', 'gates', 'all.sh'), 'utf-8')).toContain('preflight --service all')
    expect(readFileSync(join(dir, 'scripts', 'workflow', 'verify.sh'), 'utf-8')).toContain('scale preflight')
    const workflowReadme = readFileSync(join(dir, 'docs', 'workflow', 'README.md'), 'utf-8')
    expect(workflowReadme).toContain('GitLab Flow')
    expect(workflowReadme).toContain('make workflow-aios-adopt')
    expect(workflowReadme).toContain('pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/workflow/verify.ps1 -Profile default')
    const makefile = readFileSync(join(dir, 'Makefile'), 'utf-8')
    expect(makefile).toContain('POWERSHELL ?= $(shell command -v pwsh')
    expect(makefile).toContain('$(POWERSHELL) -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-scale.ps1')
    expect(makefile).toContain('workflow-aios-adopt:')
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf-8')).toContain('make workflow-aios-adopt')
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toContain('make workflow-aios-adopt')
  })

  it('generates resource governance pack documentation', () => {
    const dir = makeDir()

    const result = writeGovernanceTemplates(dir, { mode: 'critical', projectName: 'Resource Demo', pack: 'resource-governance' })

    expect(result.created).toEqual(expect.arrayContaining([
      join(dir, 'docs', 'workflow', 'resource-governance.md'),
      join(dir, 'docs', 'modules', 'README.md'),
      join(dir, 'docs', 'workflow', 'templates', '.gitignore.scale-assets.example'),
    ]))
    expect(readFileSync(join(dir, 'docs', 'workflow', 'resource-governance.md'), 'utf-8')).toContain('Resource Governance')
    expect(JSON.parse(readFileSync(join(dir, '.scale', 'governance.lock.json'), 'utf-8'))).toMatchObject({
      pack: 'resource-governance',
      packVersion: 1,
    })
  })

  it('generates whitespace-clean markdown templates', () => {
    const names = [
      'explore.md',
      'mini-prd.md',
      'skill-plan.md',
      'skill-evidence.md',
      'runtime.md',
      'reality-check.md',
      'resource-cleanup.md',
      'ui-spec.md',
      'visual-review.md',
      'docs-impact.md',
      'resource-impact.md',
      'standards-impact.md',
      'architecture-review.md',
      'api-contract.md',
      'security-review.md',
      'db-change-plan.md',
      'e2e-plan.md',
      'product-smoke.md',
      'plan.md',
      'verification.md',
      'review.md',
      'summary.md',
    ] as const

    for (const name of names) {
      const content = governanceTemplateContent(name)
      expect(content).toMatch(/\n$/)
      expect(content).not.toMatch(/\n\n$/)
      expect(content.split('\n').some(line => /[ \t]$/.test(line))).toBe(false)
    }
  })

  it('does not overwrite existing templates', () => {
    const dir = makeDir()
    const readme = join(dir, 'docs', 'workflow', 'README.md')
    writeGovernanceTemplates(dir)
    writeFileSync(readme, 'custom\n', 'utf-8')

    const result = writeGovernanceTemplates(dir)

    expect(result.skipped).toContain(readme)
    expect(readFileSync(readme, 'utf-8')).toBe('custom\n')
    expect(existsSync(join(dir, 'docs', 'workflow', 'templates', 'summary.md'))).toBe(true)
  })

  it('does not erase existing governance drift when init is rerun', () => {
    const dir = makeDir()
    const readme = join(dir, 'docs', 'workflow', 'README.md')
    writeGovernanceTemplates(dir, { pack: 'project-scaffold' })
    writeFileSync(readme, '# Local change\n', 'utf-8')

    writeGovernanceTemplates(dir, { pack: 'project-scaffold' })

    expect(computeGovernanceDrift(dir).changed.map(item => item.path)).toContain('docs/workflow/README.md')
  })
})
