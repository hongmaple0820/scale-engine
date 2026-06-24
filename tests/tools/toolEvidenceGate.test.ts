import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createSkillPlan, resolveSkillRoutingPolicy } from '../../src/skills/routing/index.js'
import { inspectToolCapabilities } from '../../src/tools/ToolCapabilityRegistry.js'
import { ToolEvidenceStore } from '../../src/tools/ToolEvidenceStore.js'
import { evaluateToolEvidenceGate } from '../../src/tools/ToolEvidenceGate.js'
import { ToolOrchestrator } from '../../src/tools/ToolOrchestrator.js'
import { resolveToolPolicy } from '../../src/tools/ToolPolicy.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-tool-gate-'))
  dirs.push(dir)
  return dir
}

function writeSkill(projectDir: string, skillId: string): void {
  const dir = join(projectDir, '.agents', 'skills', skillId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${skillId}\n---\n`, 'utf-8')
}

function uiPlan(projectDir: string) {
  const skillPlan = createSkillPlan({
    taskId: 'TASK-UI-GATE',
    taskName: 'Improve upload page UI',
    description: 'Improve frontend UI and responsive behavior',
    level: 'M',
    files: ['src/components/Upload.tsx'],
    policy: resolveSkillRoutingPolicy(null),
  })
  const orchestrator = new ToolOrchestrator({
    projectDir,
    policy: resolveToolPolicy({ mode: 'evidence-required' }),
    capabilityReport: inspectToolCapabilities({
      projectDir,
      toolIds: ['impeccable', 'taste-skill', 'awesome-design-md', 'ui-ux-pro-max', 'frontend-design'],
    }),
  })
  return orchestrator.plan({ skillPlan })
}

describe('ToolEvidenceGate', () => {
  it('blocks M level required tools when no execution evidence exists', () => {
    const projectDir = makeProject()
    writeSkill(projectDir, 'impeccable')
    const evidenceStore = new ToolEvidenceStore({ projectDir })

    const result = evaluateToolEvidenceGate({
      projectDir,
      level: 'M',
      plan: uiPlan(projectDir),
      evidenceStore,
    })

    expect(result).toMatchObject({
      mode: 'evidence-required',
      applies: true,
      checked: true,
      complete: false,
      blocked: true,
    })
    expect(result.missing.map(item => item.toolId)).toEqual(expect.arrayContaining(['impeccable']))
  })

  it('requires passed evidence and treats dry-run skipped evidence as incomplete by default', () => {
    const projectDir = makeProject()
    writeSkill(projectDir, 'impeccable')
    const evidenceStore = new ToolEvidenceStore({ projectDir })
    const plan = uiPlan(projectDir)

    evidenceStore.save({
      taskId: plan.taskId,
      domain: 'ui',
      tool: 'impeccable',
      adapter: 'skill',
      status: 'skipped',
      sanitizedInput: {},
      outputSummary: 'Dry-run only.',
      outputPaths: [],
      safetyPolicy: ['dry-run'],
    })
    evidenceStore.save({
      taskId: plan.taskId,
      domain: 'ui',
      tool: 'taste-skill',
      adapter: 'skill',
      status: 'passed',
      sanitizedInput: {},
      outputSummary: 'Design review completed.',
      outputPaths: ['docs/worklog/tasks/demo/visual-review.md'],
      safetyPolicy: ['redact-secrets'],
    })

    const result = evaluateToolEvidenceGate({
      projectDir,
      level: 'M',
      plan,
      evidenceStore,
    })

    expect(result.complete).toBe(false)
    expect(result.blocked).toBe(true)
    expect(result.skipped.map(item => item.toolId)).toEqual(['impeccable'])
    expect(result.passed.map(item => item.toolId)).toEqual([])
  })

  it('passes when every required tool has passed evidence and skips S level checks', () => {
    const projectDir = makeProject()
    writeSkill(projectDir, 'impeccable')
    const evidenceStore = new ToolEvidenceStore({ projectDir })
    const plan = uiPlan(projectDir)

    for (const step of plan.steps.filter(step => step.required)) {
      evidenceStore.save({
        taskId: plan.taskId,
        domain: step.domain,
        tool: step.toolId,
        adapter: step.adapter,
        status: 'passed',
        sanitizedInput: {},
        outputSummary: `${step.toolId} completed.`,
        outputPaths: [`docs/worklog/tasks/demo/${step.toolId}.md`],
        safetyPolicy: ['redact-secrets'],
      })
    }

    const complete = evaluateToolEvidenceGate({
      projectDir,
      level: 'M',
      plan,
      evidenceStore,
    })
    const small = evaluateToolEvidenceGate({
      projectDir,
      level: 'S',
      plan,
      evidenceStore,
    })

    expect(complete).toMatchObject({
      complete: true,
      blocked: false,
    })
    expect(small).toMatchObject({
      applies: false,
      checked: false,
      complete: true,
      blocked: false,
    })
  })
})
