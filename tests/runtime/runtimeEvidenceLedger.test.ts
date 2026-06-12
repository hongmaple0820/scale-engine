import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RuntimeEvidenceLedger } from '../../src/runtime/RuntimeEvidenceLedger.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-runtime-evidence-'))
  dirs.push(dir)
  return dir
}

describe('RuntimeEvidenceLedger', () => {
  it('records redacted runtime evidence under .scale/evidence/runtime', () => {
    const projectDir = makeProject()
    const ledger = new RuntimeEvidenceLedger({ projectDir, now: () => new Date('2026-05-18T00:00:00.000Z') })

    const record = ledger.record({
      taskId: 'TASK-RUNTIME',
      sessionId: 'SESSION-1',
      kind: 'command',
      title: 'build',
      status: 'passed',
      command: 'npm run build -- --token raw-token',
      exitCode: 0,
      summary: 'Build passed password=raw-password',
      artifacts: ['docs/worklog/tasks/TASK-RUNTIME/verification.md'],
      metadata: {
        authorization: 'Bearer raw-bearer',
      },
    })

    const file = join(projectDir, '.scale', 'evidence', 'runtime', `${record.id}.json`)
    expect(existsSync(file)).toBe(true)
    const raw = readFileSync(file, 'utf-8')
    expect(raw).not.toContain('raw-token')
    expect(raw).not.toContain('raw-password')
    expect(raw).not.toContain('raw-bearer')
    expect(record.redactionApplied).toBe(true)
    expect(record.createdAt).toBe('2026-05-18T00:00:00.000Z')
  })

  it('filters by task and summarizes failed evidence', () => {
    const projectDir = makeProject()
    const ledger = new RuntimeEvidenceLedger({ projectDir })

    const failed = ledger.record({
      taskId: 'TASK-A',
      kind: 'command',
      title: 'test',
      status: 'failed',
      exitCode: 1,
      summary: 'tests failed',
    })
    ledger.record({
      taskId: 'TASK-A',
      kind: 'skill',
      title: 'review',
      status: 'passed',
      summary: 'review completed',
    })
    ledger.record({
      taskId: 'TASK-B',
      kind: 'command',
      title: 'build',
      status: 'passed',
      summary: 'build completed',
    })

    expect(ledger.list({ taskId: 'TASK-A' })).toHaveLength(2)
    expect(ledger.summary({ taskId: 'TASK-A' })).toMatchObject({
      total: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      ok: false,
      latestFailure: expect.objectContaining({ id: failed.id }),
    })
  })

  it('treats older failed evidence as resolved after a later passed record for the same step', () => {
    const projectDir = makeProject()
    const times = [
      '2026-05-18T00:00:00.000Z',
      '2026-05-18T00:01:00.000Z',
      '2026-05-18T00:02:00.000Z',
    ]
    const ledger = new RuntimeEvidenceLedger({
      projectDir,
      now: () => new Date(times.shift() ?? '2026-05-18T00:03:00.000Z'),
    })

    ledger.record({
      taskId: 'TASK-A',
      sessionId: 'SESSION-A',
      kind: 'command',
      title: 'AI OS verification command 1',
      status: 'failed',
      exitCode: 1,
      summary: 'unterminated quote',
      metadata: { stepId: 'verify-command:1' },
    })
    ledger.record({
      taskId: 'TASK-A',
      sessionId: 'SESSION-A',
      kind: 'command',
      title: 'AI OS verification command 1',
      status: 'passed',
      exitCode: 0,
      summary: 'fixed command passed',
      metadata: { stepId: 'verify-command:1' },
    })
    const unresolved = ledger.record({
      taskId: 'TASK-A',
      sessionId: 'SESSION-A',
      kind: 'command',
      title: 'AI OS verification command 2',
      status: 'failed',
      exitCode: 1,
      summary: 'still failing',
      metadata: { stepId: 'verify-command:2' },
    })

    expect(ledger.summary({ taskId: 'TASK-A', sessionId: 'SESSION-A' })).toMatchObject({
      total: 3,
      passed: 1,
      failed: 1,
      resolvedFailed: 1,
      ok: false,
      latestFailure: expect.objectContaining({ id: unresolved.id }),
    })
  })
})
