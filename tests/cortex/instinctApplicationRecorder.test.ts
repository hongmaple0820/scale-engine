import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { recordRuntimeInstinctApplications } from '../../src/cortex/InstinctApplicationRecorder.js'
import { InstinctStore } from '../../src/cortex/InstinctStore.js'
import { GovernanceMetricsCalculator } from '../../src/cortex/GovernanceMetrics.js'
import { loadInstinctRuntimeEvidence } from '../../src/cortex/InstinctRuntimeEvidence.js'
import { SessionLedger } from '../../src/runtime/SessionLedger.js'
import type { Instinct } from '../../src/cortex/InstinctExtractor.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

function makeProject(prefix: string): { projectDir: string; scaleDir: string } {
  const projectDir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(projectDir)
  return { projectDir, scaleDir: join(projectDir, '.scale') }
}

function makeInstinct(overrides: Partial<Instinct> = {}): Instinct {
  return {
    id: 'instinct-runtime-recorder',
    trigger: 'runtime recorder',
    confidence: 0.9,
    domain: 'governance',
    source: 'test',
    scope: 'global',
    action: '## Action\nRecord runtime instinct outcomes after governed workflow phases',
    evidence: ['[2026-06-13] runtime recorder'],
    observations: 4,
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z',
    appliedCount: 0,
    hitRate: 0,
    ...overrides,
  }
}

describe('recordRuntimeInstinctApplications', () => {
  it('records current runtime session instinct outcomes into the audit trail', () => {
    const { projectDir, scaleDir } = makeProject('scale-instinct-recorder-')
    const store = new InstinctStore(join(scaleDir, 'instincts'))
    const instinctId = store.save(makeInstinct())
    const ledger = new SessionLedger({ projectDir, scaleDir })
    ledger.start({
      sessionId: 'SESSION-INSTINCT-RECORDER',
      taskId: 'TASK-INSTINCT-RECORDER',
      metadata: { cortex: { instinctsApplied: [instinctId] } },
    })

    const report = recordRuntimeInstinctApplications({
      projectDir,
      scaleDir,
      phase: 'verify',
      success: true,
      store,
      ledger,
    })

    expect(report).toMatchObject({
      checked: true,
      phase: 'verify',
      success: true,
      sessionId: 'SESSION-INSTINCT-RECORDER',
      instinctIds: [instinctId],
      recorded: [instinctId],
      skipped: [],
    })
    expect(store.history(instinctId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: 'apply', reason: 'application-succeeded' }),
    ]))
    expect(ledger.listEvents('SESSION-INSTINCT-RECORDER')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'note',
        phase: 'verify',
        data: {
          cortex: {
            instinctApplication: {
              instinctId,
              phase: 'verify',
              success: true,
            },
          },
        },
      }),
    ]))

    const evidence = loadInstinctRuntimeEvidence(scaleDir, 30)
    expect(evidence.summary).toMatchObject({
      source: 'session-and-audit',
      injectionEvents: 1,
      applicationEvents: 1,
      successfulApplications: 1,
    })
  })

  it('deduplicates repeated same-outcome records and keeps changed outcomes measurable', () => {
    const { projectDir, scaleDir } = makeProject('scale-instinct-recorder-dedupe-')
    const store = new InstinctStore(join(scaleDir, 'instincts'))
    const instinctId = store.save(makeInstinct({ trigger: 'runtime recorder dedupe' }))
    const ledger = new SessionLedger({ projectDir, scaleDir })
    ledger.start({
      sessionId: 'SESSION-INSTINCT-DEDUPE',
      metadata: { cortex: { instinctsApplied: [instinctId] } },
    })

    const failed = recordRuntimeInstinctApplications({
      projectDir,
      scaleDir,
      phase: 'verify',
      success: false,
      store,
      ledger,
    })
    const duplicateFailed = recordRuntimeInstinctApplications({
      projectDir,
      scaleDir,
      phase: 'verify',
      success: false,
      store,
      ledger,
    })
    const succeeded = recordRuntimeInstinctApplications({
      projectDir,
      scaleDir,
      phase: 'verify',
      success: true,
      store,
      ledger,
    })

    expect(failed.recorded).toEqual([instinctId])
    expect(duplicateFailed.recorded).toEqual([])
    expect(duplicateFailed.skipped).toEqual([{ id: instinctId, reason: 'already-recorded' }])
    expect(succeeded.recorded).toEqual([instinctId])

    const applications = store.history(instinctId).filter(entry => entry.op === 'apply')
    expect(applications.map(entry => entry.reason)).toEqual([
      'application-failed',
      'application-succeeded',
    ])

    const metrics = new GovernanceMetricsCalculator(scaleDir).compute(store.loadAll(), 30)
    expect(metrics.instincts.runtimeEvidence).toMatchObject({
      source: 'session-and-audit',
      injectionEvents: 1,
      applicationEvents: 2,
      successfulApplications: 1,
    })
    expect(metrics.instincts.totalInjected).toBe(2)
    expect(metrics.instincts.totalApplied).toBe(1)
    expect(metrics.instincts.hitRate).toBe(0.5)
  })

  it('does not write application audit entries when no runtime session exists', () => {
    const { projectDir, scaleDir } = makeProject('scale-instinct-recorder-no-session-')
    const store = new InstinctStore(join(scaleDir, 'instincts'))
    const instinctId = store.save(makeInstinct({ trigger: 'runtime recorder no session' }))

    const report = recordRuntimeInstinctApplications({
      projectDir,
      scaleDir,
      phase: 'ship',
      success: true,
      store,
    })

    expect(report).toMatchObject({
      checked: false,
      phase: 'ship',
      success: true,
      reason: 'no-runtime-session',
      recorded: [],
      skipped: [],
    })
    expect(store.history(instinctId).filter(entry => entry.op === 'apply')).toEqual([])
  })
})
