import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MemoryFabric } from '../../src/memory/MemoryFabric.js'
import { settleMemoryLearning } from '../../src/memory/MemoryLearning.js'
import { RuntimeEvidenceLedger } from '../../src/runtime/RuntimeEvidenceLedger.js'
import { SessionLedger } from '../../src/runtime/SessionLedger.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-memory-learning-'))
  dirs.push(dir)
  return dir
}

describe('MemoryLearning', () => {
  it('settles runtime evidence into a reviewable learning candidate without leaking secrets', async () => {
    const projectDir = makeProject()
    const scaleDir = '.scale'
    const sessionLedger = new SessionLedger({ projectDir, scaleDir })
    sessionLedger.start({ sessionId: 'SESSION-LEARN', taskId: 'TASK-LEARN', level: 'M', summary: 'Memory learning' })
    sessionLedger.append('SESSION-LEARN', {
      type: 'phase.completed',
      phase: 'verify',
      message: 'verification passed with token=raw-secret-value',
    })
    const evidence = new RuntimeEvidenceLedger({ projectDir, scaleDir }).record({
      taskId: 'TASK-LEARN',
      sessionId: 'SESSION-LEARN',
      kind: 'command',
      title: 'targeted tests',
      status: 'passed',
      command: 'npm test -- --token raw-secret-value',
      exitCode: 0,
      summary: 'tests passed with password=raw-secret-value',
    })

    const pack = await new MemoryFabric({ projectDir, scaleDir }).createContextPack({
      taskId: 'TASK-LEARN',
      sessionId: 'SESSION-LEARN',
      task: 'Settle runtime evidence into durable learning',
      level: 'M',
    })

    const result = settleMemoryLearning({ projectDir, scaleDir, pack })

    expect(result.candidate.status).toBe('candidate')
    expect(result.candidate.recommendedAction).toBe('review-for-knowledge-base')
    expect(result.candidate.promotable).toBe(true)
    expect(result.candidate.evidenceIds).toContain(evidence.id)
    expect(result.candidate.sessionEventIds.length).toBeGreaterThan(0)
    expect(result.files.json).toContain('learning-candidates')
    expect(existsSync(result.files.json)).toBe(true)
    expect(existsSync(result.files.markdown)).toBe(true)

    const serialized = [
      JSON.stringify(result.candidate),
      readFileSync(result.files.json, 'utf-8'),
      readFileSync(result.files.markdown, 'utf-8'),
    ].join('\n')
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).not.toContain('raw-secret-value')
  })

  it('blocks promotion when failed runtime evidence is still present', async () => {
    const projectDir = makeProject()
    const scaleDir = '.scale'
    new RuntimeEvidenceLedger({ projectDir, scaleDir }).record({
      taskId: 'TASK-FAIL',
      sessionId: 'SESSION-FAIL',
      kind: 'command',
      title: 'full verification',
      status: 'failed',
      exitCode: 1,
      summary: 'full test suite failed',
    })

    const pack = await new MemoryFabric({ projectDir, scaleDir }).createContextPack({
      taskId: 'TASK-FAIL',
      sessionId: 'SESSION-FAIL',
      task: 'Settle failed runtime evidence',
      level: 'M',
    })

    const result = settleMemoryLearning({ projectDir, scaleDir, pack })

    expect(result.candidate.promotable).toBe(false)
    expect(result.candidate.recommendedAction).toBe('resolve-failures-first')
    expect(result.candidate.warnings.join('\n')).toContain('failed runtime evidence')
  })

  it('allows promotion review when failed runtime evidence was resolved by later passed evidence', async () => {
    const projectDir = makeProject()
    const scaleDir = '.scale'
    const times = [
      '2026-05-18T00:00:00.000Z',
      '2026-05-18T00:01:00.000Z',
    ]
    const ledger = new RuntimeEvidenceLedger({
      projectDir,
      scaleDir,
      now: () => new Date(times.shift() ?? '2026-05-18T00:02:00.000Z'),
    })
    ledger.record({
      taskId: 'TASK-RESOLVED',
      sessionId: 'SESSION-RESOLVED',
      kind: 'command',
      title: 'AI OS verification command 1',
      status: 'failed',
      exitCode: 1,
      summary: 'unterminated quote in command',
      metadata: { stepId: 'verify-command:1' },
    })
    ledger.record({
      taskId: 'TASK-RESOLVED',
      sessionId: 'SESSION-RESOLVED',
      kind: 'command',
      title: 'AI OS verification command 1',
      status: 'passed',
      exitCode: 0,
      summary: 'fixed command passed',
      metadata: { stepId: 'verify-command:1' },
    })

    const pack = await new MemoryFabric({ projectDir, scaleDir }).createContextPack({
      taskId: 'TASK-RESOLVED',
      sessionId: 'SESSION-RESOLVED',
      task: 'Settle resolved runtime evidence',
      level: 'M',
    })

    const result = settleMemoryLearning({ projectDir, scaleDir, pack })

    expect(result.candidate.recommendedAction).toBe('review-for-knowledge-base')
    expect(result.candidate.promotable).toBe(true)
    expect(result.candidate.warnings.join('\n')).not.toContain('failed runtime evidence')
    expect(result.candidate.tags).toContain('resolved-failure-evidence')
    expect(result.candidate.evidenceSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'failed',
        resolved: true,
      }),
    ]))
  })

  it('rejects relative scaleDir values that escape the project root', async () => {
    const projectDir = makeProject()
    const pack = await new MemoryFabric({ projectDir, scaleDir: '.scale' }).createContextPack({
      taskId: 'TASK-ESCAPE-REL',
      sessionId: 'SESSION-ESCAPE-REL',
      task: 'Reject escaped relative scale dir',
      level: 'M',
    })

    expect(() => settleMemoryLearning({
      projectDir,
      scaleDir: '../escaped-scale',
      pack,
    })).toThrow('Memory learning scale root path escapes allowed directories')
  })

  it('allows an explicit absolute scaleDir root and keeps output inside it', async () => {
    const projectDir = makeProject()
    const externalScaleRoot = join(makeProject(), 'external-scale')
    const pack = await new MemoryFabric({ projectDir, scaleDir: '.scale' }).createContextPack({
      taskId: 'TASK-ESCAPE-ABS',
      sessionId: 'SESSION-ESCAPE-ABS',
      task: 'Allow explicit absolute scale dir',
      level: 'M',
    })

    const result = settleMemoryLearning({
      projectDir,
      scaleDir: externalScaleRoot,
      pack,
    })

    expect(result.files.json).toBe(join(externalScaleRoot, 'memory', 'learning-candidates', `${result.candidate.id}.json`))
    expect(result.files.markdown).toBe(join(externalScaleRoot, 'memory', 'learning-candidates', `${result.candidate.id}.md`))
    expect(existsSync(result.files.json)).toBe(true)
    expect(existsSync(result.files.markdown)).toBe(true)
  })
})
