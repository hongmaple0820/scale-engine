import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createSkillPlan,
  evaluateSkillGate,
  resolveSkillRoutingPolicy,
  TaskIntentClassifier,
} from '../../src/skills/routing/index.js'

describe('skill routing', () => {
  it('classifies UI tasks from description and files', () => {
    const policy = resolveSkillRoutingPolicy(null)
    const intents = new TaskIntentClassifier(policy).classify({
      description: 'Improve responsive UI layout and visual review',
      files: ['src/components/FileGrid.tsx'],
      level: 'M',
    })

    expect(intents[0].domain).toBe('ui')
    expect(intents[0].reasons.join(',')).toContain('keyword:ui')
    expect(policy.skillSources).toMatchObject({
      primaryRoot: '.scale/skills',
      fallbackRoots: ['skills'],
    })
  })

  it('keeps skill source roots explicit and normalized', () => {
    const policy = resolveSkillRoutingPolicy({
      skillSources: {
        primaryRoot: '.agent/skills/',
        fallbackRoots: ['.scale/skills', '.agent/skills', 'skills\\'],
        globalRoots: ['~/.agents/skills/', '~/.codex/skills'],
      },
    })

    expect(policy.skillSources).toEqual({
      primaryRoot: '.agent/skills',
      fallbackRoots: ['.scale/skills', 'skills'],
      globalRoots: ['~/.agents/skills', '~/.codex/skills'],
    })
  })

  it('creates a domain-specific skill plan with artifacts and skills', () => {
    const policy = resolveSkillRoutingPolicy(null)
    const plan = createSkillPlan({
      taskId: 'TASK-1',
      taskName: 'Auth permission fix',
      description: 'Fix tenant permission and auth token handling',
      level: 'CRITICAL',
      files: ['src/auth/guard.ts'],
      policy,
    })

    expect(plan.intents.map(intent => intent.domain)).toContain('security')
    expect(plan.requiredSkills).toContain('security-review')
    expect(plan.requiredArtifacts).toEqual(expect.arrayContaining(['skill-plan.md', 'security-review.md']))
    expect(plan.mode).toBe('block')
  })

  it('requires Mini-PRD for user-facing UI and API work at M level', () => {
    const policy = resolveSkillRoutingPolicy(null)
    const uiPlan = createSkillPlan({
      taskId: 'TASK-UI',
      taskName: 'File grid polish',
      description: 'Improve responsive UI flow and visual states',
      level: 'M',
      files: ['src/components/FileGrid.tsx'],
      policy,
    })
    const apiPlan = createSkillPlan({
      taskId: 'TASK-API',
      taskName: 'Share endpoint',
      description: 'Add API endpoint for share links',
      level: 'M',
      files: ['src/api/share.ts'],
      policy,
    })

    expect(uiPlan.requiredArtifacts).toEqual(expect.arrayContaining(['mini-prd.md', 'ui-spec.md', 'visual-review.md']))
    expect(apiPlan.requiredArtifacts).toEqual(expect.arrayContaining(['mini-prd.md', 'api-contract.md']))
  })

  it('routes UI work to design-system-first skills with browser testing evidence', () => {
    const policy = resolveSkillRoutingPolicy(null)
    const plan = createSkillPlan({
      taskId: 'TASK-UI-SKILLS',
      taskName: 'Dashboard visual polish',
      description: 'Improve React dashboard UI, responsive states, and browser interaction quality',
      level: 'M',
      files: ['src/components/Dashboard.tsx', 'src/styles/dashboard.css'],
      policy,
    })

    expect(plan.intents.map(intent => intent.domain)).toContain('ui')
    expect(plan.requiredSkills).toContain('impeccable')
    expect(plan.requiredSkills).not.toContain('awesome-design-md')
    expect(plan.requiredSkills).not.toContain('ui-ux-pro-max')
    expect(plan.recommendedSkills).toContain('taste-skill')
    expect(plan.recommendedSkills).toContain('awesome-design-md')
    expect(plan.recommendedSkills).toContain('ui-ux-pro-max')
    expect(plan.recommendedSkills).toContain('frontend-design')
    expect(plan.recommendedSkills).toContain('webapp-testing')
    expect(plan.recommendedSkills).toEqual(expect.arrayContaining(['agent-browser', 'mcp-chrome-devtools']))
    expect(plan.requiredArtifacts).toEqual(expect.arrayContaining(['skill-evidence.md', 'ui-spec.md', 'visual-review.md']))
    expect(plan.requiredVerification).toEqual(expect.arrayContaining(['design-system', 'screenshot', 'responsive-check', 'browser-run', 'visual-review']))
  })

  it('routes document parsing work to LiteParse evidence', () => {
    const policy = resolveSkillRoutingPolicy(null)
    const plan = createSkillPlan({
      taskId: 'TASK-DOC-PARSE',
      taskName: 'Parse vendor PDF',
      description: 'Parse PDF with OCR and source citation before knowledge ingestion',
      level: 'M',
      files: ['docs/source/vendor.pdf'],
      policy,
    })

    expect(plan.intents.map(intent => intent.domain)).toContain('documentParsing')
    expect(plan.recommendedSkills).toContain('liteparse')
    expect(plan.requiredArtifacts).toEqual(expect.arrayContaining(['docs-impact.md', 'skill-evidence.md']))
    expect(plan.requiredVerification).toEqual(expect.arrayContaining(['parse-output', 'source-citation']))
  })

  it('routes diagramming work to D2 validation evidence', () => {
    const policy = resolveSkillRoutingPolicy(null)
    const plan = createSkillPlan({
      taskId: 'TASK-DIAGRAM',
      taskName: 'Architecture diagram',
      description: 'Create a D2 architecture diagram and validate it',
      level: 'M',
      files: ['docs/diagrams/runtime.d2'],
      policy,
    })

    expect(plan.intents.map(intent => intent.domain)).toContain('diagramming')
    expect(plan.recommendedSkills).toContain('d2-diagram')
    expect(plan.requiredArtifacts).toEqual(expect.arrayContaining(['architecture-review.md', 'skill-evidence.md']))
    expect(plan.requiredVerification).toContain('diagram-validate')
  })

  it('routes orchestration work to optional OpenSquilla review evidence', () => {
    const policy = resolveSkillRoutingPolicy(null)
    const plan = createSkillPlan({
      taskId: 'TASK-ORCH',
      taskName: 'Workflow orchestrator routing',
      description: 'Review agent orchestration, MetaSkill routing, and token cost tradeoffs',
      level: 'L',
      files: ['src/orchestration/EffectsWiring.ts'],
      policy,
    })

    expect(plan.intents.map(intent => intent.domain)).toContain('orchestration')
    expect(plan.recommendedSkills).toContain('opensquilla')
    expect(plan.requiredArtifacts).toEqual(expect.arrayContaining(['architecture-review.md', 'skill-evidence.md']))
    expect(plan.requiredVerification).toContain('orchestration-review')
  })

  it('routes web research and logged-in browser work to web access evidence', () => {
    const policy = resolveSkillRoutingPolicy(null)
    const plan = createSkillPlan({
      taskId: 'TASK-WEB',
      taskName: 'Verify external docs',
      description: 'Search online, inspect a logged-in dynamic web page, and verify latest browser behavior with source citations',
      level: 'M',
      files: ['docs/research.md'],
      policy,
    })

    expect(plan.intents.map(intent => intent.domain)).toEqual(expect.arrayContaining(['webResearch', 'browserAutomation']))
    expect(plan.requiredSkills).toContain('web-access')
    expect(plan.recommendedSkills).toEqual(expect.arrayContaining(['agent-browser', 'mcp-chrome-devtools']))
    expect(plan.requiredArtifacts).toEqual(expect.arrayContaining(['skill-evidence.md', 'verification.md']))
    expect(plan.requiredVerification).toEqual(expect.arrayContaining(['source-citation', 'browser-evidence', 'network-console-check']))
  })

  it('routes desktop application automation to CUA safety evidence', () => {
    const policy = resolveSkillRoutingPolicy(null)
    const plan = createSkillPlan({
      taskId: 'TASK-DESKTOP',
      taskName: 'WPS desktop smoke test',
      description: 'Operate the Windows desktop app, WPS, and WeChat workflow to collect data and verify GUI behavior',
      level: 'L',
      files: ['docs/worklog/tasks/demo/verification.md'],
      policy,
    })

    expect(plan.intents.map(intent => intent.domain)).toContain('desktopAutomation')
    expect(plan.requiredSkills).toContain('turix-cua')
    expect(plan.recommendedSkills).toEqual(expect.arrayContaining(['agent-browser', 'web-access']))
    expect(plan.requiredArtifacts).toEqual(expect.arrayContaining(['skill-plan.md', 'skill-evidence.md', 'verification.md']))
    expect(plan.requiredVerification).toEqual(expect.arrayContaining(['desktop-screenshot', 'operator-safety', 'side-effect-boundary']))
  })

  it('routes external agent CLI orchestration to explicit command evidence', () => {
    const policy = resolveSkillRoutingPolicy(null)
    const plan = createSkillPlan({
      taskId: 'TASK-CLI',
      taskName: 'Cross-agent review',
      description: 'Use codex, gemini cli, and opencode as external CLI reviewers before merge',
      level: 'M',
      files: ['src/api/cli.ts'],
      policy,
    })

    expect(plan.intents.map(intent => intent.domain)).toContain('externalCli')
    expect(plan.recommendedSkills).toEqual(expect.arrayContaining(['codex-cli', 'gemini-cli', 'opencode-cli']))
    expect(plan.requiredArtifacts).toEqual(expect.arrayContaining(['skill-plan.md', 'skill-evidence.md', 'verification.md']))
    expect(plan.requiredVerification).toEqual(expect.arrayContaining(['cli-version-check', 'command-output', 'dry-run-or-safe-mode']))
  })

  it('routes docs impact work to update-docs and docs-impact evidence', () => {
    const policy = resolveSkillRoutingPolicy(null)
    const plan = createSkillPlan({
      taskId: 'TASK-DOCS',
      taskName: 'Document CLI cleanup',
      description: 'Update documentation and README for a CLI behavior change',
      level: 'M',
      files: ['docs/workflow/README.md', 'src/api/cli.ts'],
      policy,
    })

    expect(plan.intents.map(intent => intent.domain)).toContain('docs')
    expect(plan.recommendedSkills).toContain('update-docs')
    expect(plan.requiredArtifacts).toEqual(expect.arrayContaining(['docs-impact.md', 'skill-evidence.md']))
  })

  it('routes generated reports and media to resource governance evidence', () => {
    const policy = resolveSkillRoutingPolicy(null)
    const plan = createSkillPlan({
      taskId: 'TASK-ASSETS',
      taskName: 'Clean resource outputs',
      description: 'Settle screenshots, e2e report, temporary files, and documentation drift after feature work',
      level: 'M',
      files: ['test-results/upload/report.json', 'playwright-report/index.html', 'tmp/probe.sql', 'docs/modules/auth/product.md'],
      policy,
    })

    expect(plan.intents.map(intent => intent.domain)).toContain('resourceGovernance')
    expect(plan.requiredArtifacts).toEqual(expect.arrayContaining(['resource-impact.md', 'docs-impact.md']))
    expect(plan.requiredVerification).toEqual(expect.arrayContaining(['asset-scan', 'asset-doctor']))
  })

  it('routes framework, logging, and coding standard work to standards evidence', () => {
    const policy = resolveSkillRoutingPolicy(null)
    const plan = createSkillPlan({
      taskId: 'TASK-STANDARDS',
      taskName: 'Harden coding standards',
      description: 'Enforce logging desensitization, ORM usage rules, coding standards, framework conventions, and architecture boundaries',
      level: 'L',
      files: ['.scale/engineering-standards.json', 'src/business/upload.ts', 'docs/standards/backend.md'],
      policy,
    })

    expect(plan.intents.map(intent => intent.domain)).toContain('engineeringStandards')
    expect(plan.requiredArtifacts).toEqual(expect.arrayContaining(['standards-impact.md', 'architecture-review.md', 'security-review.md']))
    expect(plan.requiredVerification).toEqual(expect.arrayContaining(['standards-scan', 'standards-doctor']))
  })

  it('routes PR and review work to code-reviewer and pr-creator', () => {
    const policy = resolveSkillRoutingPolicy(null)
    const plan = createSkillPlan({
      taskId: 'TASK-PR',
      taskName: 'Prepare PR',
      description: 'Review local changes and create a pull request for the feature branch',
      level: 'M',
      files: ['src/api/cli.ts'],
      policy,
    })

    expect(plan.intents.map(intent => intent.domain)).toEqual(expect.arrayContaining(['review', 'release']))
    expect(plan.requiredSkills).toContain('code-reviewer')
    expect(plan.recommendedSkills).toContain('pr-creator')
    expect(plan.requiredArtifacts).toEqual(expect.arrayContaining(['review.md', 'skill-evidence.md']))
  })

  it('checks required skill artifacts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scale-skill-gate-'))
    try {
      const artifactsDir = join(dir, 'task')
      mkdirSync(artifactsDir)
      writeFileSync(join(artifactsDir, 'skill-plan.md'), '# Skill Plan\n\n## Detected Intents\n\n## Required Skills\n', 'utf-8')

      const result = evaluateSkillGate({
        projectDir: dir,
        artifactsDir,
        level: 'M',
        requiredArtifacts: ['skill-plan.md', 'ui-spec.md'],
        mode: 'block',
      })

      expect(result.complete).toBe(false)
      expect(result.blocked).toBe(true)
      expect(result.missing).toEqual(['ui-spec.md'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('requires skill evidence to cover required skills with concrete status', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scale-skill-evidence-'))
    try {
      const artifactsDir = join(dir, 'task')
      mkdirSync(artifactsDir)
      writeFileSync(join(artifactsDir, 'skill-plan.md'), '# Skill Plan\n\n## Detected Intents\n\n| Domain | Score | Evidence |\n| --- | ---: | --- |\n| ui | 8 | frontend file |\n\n## Required Skills\n\n- frontend-design\n', 'utf-8')
      writeFileSync(join(artifactsDir, 'skill-evidence.md'), '# Skill Evidence\n\n| Skill | Status |\n| --- | --- |\n| TBD | TBD |\n', 'utf-8')

      const placeholder = evaluateSkillGate({
        projectDir: dir,
        artifactsDir,
        level: 'M',
        requiredArtifacts: ['skill-plan.md', 'skill-evidence.md'],
        requiredSkills: ['frontend-design'],
        mode: 'block',
      })
      expect(placeholder.blocked).toBe(true)
      expect(placeholder.incomplete[0]).toMatchObject({ file: 'skill-evidence.md', reason: 'contains template placeholders' })

      writeFileSync(join(artifactsDir, 'skill-evidence.md'), '# Skill Evidence\n\n| Skill | Status | Evidence |\n| --- | --- | --- |\n| frontend-design | executed | docs/worklog/tasks/demo/ui-spec.md |\n', 'utf-8')
      const complete = evaluateSkillGate({
        projectDir: dir,
        artifactsDir,
        level: 'M',
        requiredArtifacts: ['skill-plan.md', 'skill-evidence.md'],
        requiredSkills: ['frontend-design'],
        mode: 'block',
      })
      expect(complete.complete).toBe(true)
      expect(complete.blocked).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not accept an unfilled skill plan template as evidence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scale-skill-plan-placeholder-'))
    try {
      const artifactsDir = join(dir, 'task')
      mkdirSync(artifactsDir)
      writeFileSync(join(artifactsDir, 'skill-plan.md'), '# Skill Plan\n\n## Detected Intents\n\n| Domain | Score | Evidence |\n| --- | ---: | --- |\n|  |  |  |\n\n## Required Skills\n\n- TBD\n', 'utf-8')

      const result = evaluateSkillGate({
        projectDir: dir,
        artifactsDir,
        level: 'M',
        requiredArtifacts: ['skill-plan.md'],
        requiredSkills: ['frontend-design'],
        mode: 'block',
      })

      expect(result.complete).toBe(false)
      expect(result.blocked).toBe(true)
      expect(result.incomplete).toEqual(expect.arrayContaining([
        expect.objectContaining({ file: 'skill-plan.md', reason: 'contains template placeholders' }),
      ]))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
