import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GuardrailEffectivenessGate,
  KnowledgeUtilizationGate,
  WorkflowThoroughnessGate,
} from '../../src/workflow/gates/MetaGovernanceGates.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

describe('GuardrailEffectivenessGate', () => {
  it('recognizes the installed Claude hook guardrail surface', async () => {
    const projectDir = makeProject()
    const scaleDir = join(projectDir, '.scale')
    mkdirSync(join(projectDir, '.claude', 'hooks'), { recursive: true })
    writeFileSync(join(projectDir, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        PreToolUse: [{ command: 'node .claude/hooks/shield-pre-tool.js' }],
      },
    }, null, 2), 'utf-8')
    writeFileSync(join(projectDir, '.claude', 'hooks', 'shield-pre-tool.js'), 'process.exit(0)\n', 'utf-8')
    mkdirSync(join(scaleDir, 'events'), { recursive: true })
    writeFileSync(join(scaleDir, 'events', '2026-06-13.jsonl'), `${JSON.stringify({ type: 'guardrail.detector.triggered' })}\n`, 'utf-8')

    const result = await new GuardrailEffectivenessGate(scaleDir).execute()

    expect(result.passed).toBe(true)
    expect(result.blockers).toEqual([])
    expect(result.evidenceItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Detector Config', passed: true }),
      expect.objectContaining({ label: 'Detector Activity', passed: true }),
    ]))
  })

  it('fails when no guardrail config or hook surface exists', async () => {
    const projectDir = makeProject()

    const result = await new GuardrailEffectivenessGate(join(projectDir, '.scale')).execute()

    expect(result.passed).toBe(false)
    expect(result.blockers).toEqual(['护栏配置不完整'])
    expect(result.evidenceItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Detector Config', passed: false }),
    ]))
  })
})

describe('KnowledgeUtilizationGate', () => {
  it('recognizes Cortex instincts and audit applications as learning evidence', async () => {
    const projectDir = makeProject()
    const scaleDir = join(projectDir, '.scale')
    mkdirSync(join(scaleDir, 'memory'), { recursive: true })
    mkdirSync(join(scaleDir, 'instincts', 'general'), { recursive: true })
    writeFileSync(join(scaleDir, 'memory', 'brain.sqlite'), '', 'utf-8')
    writeFileSync(join(scaleDir, 'instincts', 'general', 'instinct-test.yaml'), 'id: instinct-test\n', 'utf-8')
    writeFileSync(join(scaleDir, 'instincts', '.audit.jsonl'), `${JSON.stringify({ op: 'apply', id: 'instinct-test' })}\n`, 'utf-8')

    const result = await new KnowledgeUtilizationGate(scaleDir).execute()

    expect(result.passed).toBe(true)
    expect(result.evidenceItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Knowledge Base', passed: true }),
      expect.objectContaining({ label: 'Lesson Extraction', passed: true }),
    ]))
    expect(result.evidence).toContain('learning signal')
  })

  it('fails when a knowledge store exists without lessons or learning signals', async () => {
    const projectDir = makeProject()
    const scaleDir = join(projectDir, '.scale')
    writeFileSync(join(scaleDir, 'knowledge.db'), '', 'utf-8')

    const result = await new KnowledgeUtilizationGate(scaleDir).execute()

    expect(result.passed).toBe(false)
    expect(result.evidenceItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Lesson Extraction', passed: false }),
    ]))
  })
})

describe('WorkflowThoroughnessGate', () => {
  it('recognizes current workflow state, planning artifacts, reviews, and evidence', async () => {
    const projectDir = makeProject()
    const scaleDir = join(projectDir, '.scale')
    const taskArtifactsDir = join(projectDir, '.planning', 'tasks', 'task-current')
    mkdirSync(taskArtifactsDir, { recursive: true })
    mkdirSync(join(scaleDir, 'state'), { recursive: true })
    mkdirSync(join(scaleDir, 'specs'), { recursive: true })
    mkdirSync(join(scaleDir, 'plans'), { recursive: true })
    mkdirSync(join(scaleDir, 'metrics'), { recursive: true })
    mkdirSync(join(scaleDir, 'evidence'), { recursive: true })
    mkdirSync(join(scaleDir, 'reviews'), { recursive: true })
    for (const file of ['mini-prd.md', 'explore.md', 'plan.md', 'verification.md', 'review.md']) {
      writeFileSync(join(taskArtifactsDir, file), `# ${file}\n`, 'utf-8')
    }
    writeFileSync(join(scaleDir, 'state', 'explore.json'), JSON.stringify({ fileCount: 1 }), 'utf-8')
    writeFileSync(join(scaleDir, 'state', 'current.json'), JSON.stringify({
      artifactsDir: '.planning/tasks/task-current',
      completedGates: ['G0', 'G4', 'G5'],
      filesModified: ['src/workflow/gates/MetaGovernanceGates.ts'],
      lastSpecId: 'SPEC-1',
      lastPlanId: 'PLAN-1',
      lastTaskId: 'TASK-1',
    }, null, 2), 'utf-8')
    writeFileSync(join(scaleDir, 'specs', 'SPEC-1.md'), '# Spec\n', 'utf-8')
    writeFileSync(join(scaleDir, 'plans', 'PLAN-1.md'), '# Plan\n', 'utf-8')
    writeFileSync(join(scaleDir, 'metrics', 'tasks.jsonl'), `${JSON.stringify({ taskId: 'TASK-1' })}\n`, 'utf-8')
    writeFileSync(join(scaleDir, 'evidence', 'GATE-G0-1.json'), JSON.stringify({ gate: 'G0', passed: true }), 'utf-8')
    writeFileSync(join(scaleDir, 'reviews', 'REVIEW-1.json'), JSON.stringify({ passed: true }), 'utf-8')

    const result = await new WorkflowThoroughnessGate(scaleDir).execute()

    expect(result.passed).toBe(true)
    expect(result.evidenceItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Phase: explore', passed: true }),
      expect.objectContaining({ label: 'Phase: plan', passed: true }),
      expect.objectContaining({ label: 'Phase: verify', passed: true }),
      expect.objectContaining({ label: 'Phase: review', passed: true }),
      expect.objectContaining({ label: 'Artifact Coverage', passed: true }),
    ]))
  })
})

function makeProject(): string {
  const projectDir = mkdtempSync(join(tmpdir(), 'scale-meta-gates-'))
  dirs.push(projectDir)
  mkdirSync(join(projectDir, '.scale'), { recursive: true })
  return projectDir
}
