import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createSkillPlan, resolveSkillRoutingPolicy } from '../../src/skills/routing/index.js'
import { inspectToolCapabilities } from '../../src/tools/ToolCapabilityRegistry.js'
import { ToolEvidenceStore } from '../../src/tools/ToolEvidenceStore.js'
import { resolveToolPolicy } from '../../src/tools/ToolPolicy.js'
import { ToolOrchestrator, type ToolExecutionPlan } from '../../src/tools/ToolOrchestrator.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-tool-orchestrator-'))
  dirs.push(dir)
  return dir
}

function writeSkill(projectDir: string, skillId: string): string {
  const dir = join(projectDir, '.agents', 'skills', skillId)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'SKILL.md')
  writeFileSync(file, `---\nname: ${skillId}\n---\n`, 'utf-8')
  return file
}

function uiSkillPlan() {
  return createSkillPlan({
    taskId: 'TASK-UI',
    taskName: 'Improve upload page UI',
    description: 'Build frontend ui and responsive visual review',
    level: 'M',
    files: ['src/components/Upload.tsx'],
    policy: resolveSkillRoutingPolicy({
      policy: { mode: 'block', enforceLevels: ['M', 'L', 'CRITICAL'], requireSkillPlan: true },
    }),
  })
}

describe('ToolOrchestrator', () => {
  it('builds a tool execution plan from skill plan, tool policy, and capability status', () => {
    const projectDir = makeProject()
    const homeDir = makeProject()
    const capabilityReport = inspectToolCapabilities({
      projectDir,
      homeDir,
      toolIds: ['impeccable', 'taste-skill', 'awesome-design-md', 'ui-ux-pro-max', 'frontend-design', 'agent-browser'],
      commandExists: () => false,
    })
    const orchestrator = new ToolOrchestrator({
      projectDir,
      policy: resolveToolPolicy({ mode: 'block' }),
      capabilityReport,
    })

    const plan = orchestrator.plan({ skillPlan: uiSkillPlan() })

    expect(plan.mode).toBe('block')
    expect(plan.steps.map(step => step.toolId)).toEqual(expect.arrayContaining(['impeccable', 'taste-skill', 'awesome-design-md', 'ui-ux-pro-max']))
    expect(plan.steps.find(step => step.toolId === 'impeccable')).toMatchObject({
      required: true,
      status: 'missing',
    })
    expect(plan.steps.find(step => step.toolId === 'taste-skill')).toMatchObject({
      required: false,
      status: 'missing',
    })
    expect(plan.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('impeccable'),
    ]))
  })

  it('runs ready steps in dry-run mode and writes skipped evidence', async () => {
    const projectDir = makeProject()
    writeSkill(projectDir, 'impeccable')

    const evidenceStore = new ToolEvidenceStore({ projectDir })
    const orchestrator = new ToolOrchestrator({
      projectDir,
      policy: resolveToolPolicy({ mode: 'evidence-required' }),
      evidenceStore,
      capabilityReport: inspectToolCapabilities({
        projectDir,
        toolIds: ['impeccable'],
      }),
    })
    const plan = orchestrator.plan({ skillPlan: uiSkillPlan() })

    const report = await orchestrator.run(plan, { dryRun: true })

    expect(report.ok).toBe(true)
    expect(report.evidence.map(item => item.status)).toEqual(['skipped'])
    expect(evidenceStore.summary('TASK-UI')).toMatchObject({
      total: 1,
      skipped: 1,
      ok: true,
    })
  })

  it('records failed execution evidence and marks the report failed', async () => {
    const projectDir = makeProject()
    writeSkill(projectDir, 'awesome-design-md')

    const evidenceStore = new ToolEvidenceStore({ projectDir })
    const orchestrator = new ToolOrchestrator({
      projectDir,
      policy: resolveToolPolicy({ mode: 'evidence-required' }),
      evidenceStore,
      capabilityReport: inspectToolCapabilities({
        projectDir,
        toolIds: ['awesome-design-md'],
      }),
      executeStep: async step => ({
        status: 'failed',
        outputSummary: `failed ${step.toolId} token=secret-token-value`,
        outputPaths: [],
        exitCode: 1,
      }),
    })
    const plan = orchestrator.plan({ skillPlan: {
      ...uiSkillPlan(),
      requiredSkills: ['awesome-design-md'],
      recommendedSkills: [],
    } })

    const report = await orchestrator.run(plan)

    expect(report.ok).toBe(false)
    expect(report.blockers).toEqual([expect.stringContaining('awesome-design-md')])
    const evidence = evidenceStore.list('TASK-UI')
    expect(evidence).toHaveLength(1)
    expect(evidence[0]).toMatchObject({
      tool: 'awesome-design-md',
      status: 'failed',
      exitCode: 1,
    })
    expect(evidence[0].outputSummary).not.toContain('secret-token-value')
  })

  it('runs a safe CLI version check with the default executor and records passed evidence', async () => {
    const projectDir = makeProject()
    const evidenceStore = new ToolEvidenceStore({ projectDir })
    const orchestrator = new ToolOrchestrator({
      projectDir,
      policy: resolveToolPolicy({ mode: 'evidence-required' }),
      evidenceStore,
    })
    const plan: ToolExecutionPlan = {
      taskId: 'TASK-CLI',
      taskName: 'Check external CLI evidence',
      mode: 'evidence-required',
      blockers: [],
      warnings: [],
      steps: [
        {
          id: 'tool-1-node-version',
          toolId: 'node-version',
          domain: 'externalCli',
          adapter: 'cli',
          required: true,
          status: 'ready',
          reason: 'Node is available.',
          capability: {
            id: 'node-version',
            name: 'Node.js',
            category: 'cli',
            command: process.execPath,
            versionArgs: ['--version'],
            requiredFor: ['externalCli'],
            installed: true,
            status: 'installed',
            checkedPaths: [`PATH:${process.execPath}`],
          },
        },
      ],
    }

    const report = await orchestrator.run(plan)

    expect(report.ok).toBe(true)
    expect(report.evidence[0]).toMatchObject({
      tool: 'node-version',
      adapter: 'cli',
      status: 'passed',
      exitCode: 0,
    })
    expect(report.evidence[0].version).toMatch(/^v\d+/)
    expect(evidenceStore.summary('TASK-CLI')).toMatchObject({
      total: 1,
      passed: 1,
      ok: true,
    })
  })

  it('records installed skill files as passed readiness evidence', async () => {
    const projectDir = makeProject()
    const skillPath = writeSkill(projectDir, 'code-reviewer')
    const evidenceStore = new ToolEvidenceStore({ projectDir })
    const orchestrator = new ToolOrchestrator({
      projectDir,
      policy: resolveToolPolicy({ mode: 'evidence-required' }),
      evidenceStore,
      capabilityReport: inspectToolCapabilities({
        projectDir,
        toolIds: ['code-reviewer'],
      }),
    })
    const plan: ToolExecutionPlan = {
      taskId: 'TASK-SKILL',
      taskName: 'Check skill readiness',
      mode: 'evidence-required',
      blockers: [],
      warnings: [],
      steps: [
        {
          id: 'tool-1-code-reviewer',
          toolId: 'code-reviewer',
          domain: 'review',
          adapter: 'skill',
          required: true,
          status: 'ready',
          reason: 'Tool is available.',
          capability: inspectToolCapabilities({ projectDir, toolIds: ['code-reviewer'] }).tools[0],
        },
      ],
    }

    const report = await orchestrator.run(plan)

    expect(report.ok).toBe(true)
    expect(report.evidence[0]).toMatchObject({
      tool: 'code-reviewer',
      adapter: 'skill',
      status: 'passed',
      exitCode: 0,
      outputPaths: [skillPath],
      safetyPolicy: expect.arrayContaining(['skill-file-readiness-check']),
    })
    expect(report.evidence[0].outputSummary).toContain('Skill usage evidence must still be captured')
  })

  it('classifies browser and desktop automation tools with side-effect aware adapters', () => {
    const projectDir = makeProject()
    writeSkill(projectDir, 'turix-cua')
    const capabilityReport = inspectToolCapabilities({
      projectDir,
      toolIds: ['agent-browser', 'desktop-cua', 'turix-cua'],
      commandExists: () => true,
      runVersion: () => ({ ok: true, stdout: '1.0.0' }),
    })
    const policy = resolveToolPolicy({
      mode: 'evidence-required',
      tools: {
        'desktop-cua': {
          enabled: true,
          requiredFor: ['desktopAutomation'],
        },
      },
    })
    const orchestrator = new ToolOrchestrator({
      projectDir,
      policy,
      capabilityReport,
    })
    const skillPlan = createSkillPlan({
      taskId: 'TASK-DESKTOP',
      taskName: 'Desktop automation smoke',
      description: 'Run browser automation and desktop automation for a Windows desktop app',
      level: 'M',
      files: ['tests/desktop/smoke.test.ts'],
      policy: resolveSkillRoutingPolicy(null),
    })

    const plan = orchestrator.plan({ skillPlan })

    expect(plan.steps.find(step => step.toolId === 'agent-browser')).toMatchObject({
      adapter: 'browser',
    })
    expect(plan.steps.find(step => step.toolId === 'desktop-cua')).toMatchObject({
      adapter: 'desktop',
      required: true,
    })
  })
})
