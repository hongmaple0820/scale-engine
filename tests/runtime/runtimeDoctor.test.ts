import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { evaluateFinalReportReadiness } from '../../src/runtime/FinalReportGuard.js'
import { doctorRuntimeEvidence } from '../../src/runtime/RuntimeDoctor.js'
import { RuntimeEvidenceLedger } from '../../src/runtime/RuntimeEvidenceLedger.js'
import { SessionLedger } from '../../src/runtime/SessionLedger.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-runtime-doctor-'))
  dirs.push(dir)
  return dir
}

describe('runtime doctor', () => {
  it('warns when M level work has no passed completion evidence', () => {
    const projectDir = makeProject()
    new SessionLedger({ projectDir }).start({ sessionId: 'SESSION-1', taskId: 'TASK-1', level: 'M' })

    const report = doctorRuntimeEvidence({ projectDir, taskId: 'TASK-1', sessionId: 'SESSION-1', level: 'M' })

    expect(report.blocked).toBe(false)
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Runtime completion evidence',
        status: 'warn',
      }),
    ]))
    expect(evaluateFinalReportReadiness({ projectDir, taskId: 'TASK-1', sessionId: 'SESSION-1', level: 'M' })).toMatchObject({
      ready: false,
      blocked: true,
    })
  })

  it('blocks final readiness when failed evidence exists and passes after scoped success', () => {
    const projectDir = makeProject()
    const ledger = new RuntimeEvidenceLedger({ projectDir })
    ledger.record({
      taskId: 'TASK-1',
      sessionId: 'SESSION-1',
      kind: 'command',
      title: 'test',
      status: 'failed',
      exitCode: 1,
      summary: 'test failed',
    })

    expect(evaluateFinalReportReadiness({ projectDir, taskId: 'TASK-1', sessionId: 'SESSION-1', level: 'M' })).toMatchObject({
      ready: false,
      blocked: true,
    })

    const otherProject = makeProject()
    const cleanLedger = new RuntimeEvidenceLedger({ projectDir: otherProject })
    new SessionLedger({ projectDir: otherProject }).start({ sessionId: 'SESSION-2', taskId: 'TASK-2', level: 'M' })
    cleanLedger.record({
      taskId: 'TASK-2',
      sessionId: 'SESSION-2',
      kind: 'command',
      title: 'test',
      status: 'passed',
      exitCode: 0,
      summary: 'test passed',
    })

    expect(evaluateFinalReportReadiness({ projectDir: otherProject, taskId: 'TASK-2', sessionId: 'SESSION-2', level: 'M' })).toMatchObject({
      ready: true,
      blocked: false,
    })
  })

  it('does not block final readiness for expected red reproduction evidence after later success', () => {
    const projectDir = makeProject()
    const ledger = new RuntimeEvidenceLedger({ projectDir })
    new SessionLedger({ projectDir }).start({ sessionId: 'SESSION-RED', taskId: 'TASK-RED', level: 'M' })
    ledger.record({
      taskId: 'TASK-RED',
      sessionId: 'SESSION-RED',
      kind: 'command',
      title: 'red reproduction',
      status: 'failed',
      exitCode: 1,
      summary: 'expected failing test reproduced the bug',
      metadata: {
        expectedRed: true,
        phase: 'reproduce',
      },
    })
    ledger.record({
      taskId: 'TASK-RED',
      sessionId: 'SESSION-RED',
      kind: 'command',
      title: 'green regression',
      status: 'passed',
      exitCode: 0,
      summary: 'regression passed after fix',
    })

    const report = doctorRuntimeEvidence({ projectDir, taskId: 'TASK-RED', sessionId: 'SESSION-RED', level: 'M' })
    expect(report.blocked).toBe(false)
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Runtime failed evidence',
        status: 'ok',
      }),
    ]))
    expect(evaluateFinalReportReadiness({ projectDir, taskId: 'TASK-RED', sessionId: 'SESSION-RED', level: 'M' })).toMatchObject({
      ready: true,
      blocked: false,
    })
  })

  it('does not block final readiness after a failed step is resolved by later passed evidence', () => {
    const projectDir = makeProject()
    const ledger = new RuntimeEvidenceLedger({ projectDir })
    new SessionLedger({ projectDir }).start({ sessionId: 'SESSION-RESOLVED', taskId: 'TASK-RESOLVED', level: 'M' })
    ledger.record({
      taskId: 'TASK-RESOLVED',
      sessionId: 'SESSION-RESOLVED',
      kind: 'command',
      title: 'AI OS verification command 1',
      status: 'failed',
      exitCode: 1,
      summary: 'unterminated quote in command',
      metadata: {
        stepId: 'verify-command:1',
      },
    })
    ledger.record({
      taskId: 'TASK-RESOLVED',
      sessionId: 'SESSION-RESOLVED',
      kind: 'command',
      title: 'AI OS verification command 1',
      status: 'passed',
      exitCode: 0,
      summary: 'fixed command passed',
      metadata: {
        stepId: 'verify-command:1',
      },
    })

    const report = doctorRuntimeEvidence({ projectDir, taskId: 'TASK-RESOLVED', sessionId: 'SESSION-RESOLVED', level: 'M' })
    expect(report.blocked).toBe(false)
    expect(report.evidence).toMatchObject({
      failed: 0,
      resolvedFailed: 1,
      ok: true,
    })
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Runtime failed evidence',
        status: 'ok',
        message: expect.stringContaining('resolved failed record'),
      }),
    ]))
    expect(evaluateFinalReportReadiness({ projectDir, taskId: 'TASK-RESOLVED', sessionId: 'SESSION-RESOLVED', level: 'M' })).toMatchObject({
      ready: true,
      blocked: false,
    })
  })

  it('blocks final readiness when product smoke policy is block and only generic evidence exists', () => {
    const projectDir = makeProject()
    mkdirSync(join(projectDir, '.scale'), { recursive: true })
    writeFileSync(join(projectDir, '.scale', 'verification.json'), JSON.stringify({
      version: 1,
      profiles: { default: { commands: {} } },
      policy: { productSmokeGate: 'block' },
    }, null, 2), 'utf-8')

    const ledger = new RuntimeEvidenceLedger({ projectDir })
    new SessionLedger({ projectDir }).start({ sessionId: 'SESSION-SMOKE', taskId: 'TASK-SMOKE', level: 'M' })
    ledger.record({
      taskId: 'TASK-SMOKE',
      sessionId: 'SESSION-SMOKE',
      kind: 'command',
      title: 'unit tests',
      status: 'passed',
      exitCode: 0,
      summary: 'unit tests passed',
    })

    const missingSmoke = evaluateFinalReportReadiness({ projectDir, taskId: 'TASK-SMOKE', sessionId: 'SESSION-SMOKE', level: 'M' })
    expect(missingSmoke).toMatchObject({
      ready: false,
      blocked: true,
    })
    expect(missingSmoke.reasons.join('\n')).toContain('No passed product smoke evidence')

    ledger.record({
      taskId: 'TASK-SMOKE',
      sessionId: 'SESSION-SMOKE',
      kind: 'command',
      title: 'Product smoke: cross-driver copy',
      status: 'passed',
      exitCode: 0,
      summary: 'gateway -> netdisk -> storage task completed',
      metadata: { productSmoke: true },
    })

    expect(evaluateFinalReportReadiness({ projectDir, taskId: 'TASK-SMOKE', sessionId: 'SESSION-SMOKE', level: 'M' })).toMatchObject({
      ready: true,
      blocked: false,
    })
  })
})
