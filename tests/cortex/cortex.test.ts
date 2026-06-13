import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { InstinctExtractor, type Observation, type Instinct } from '../../src/cortex/InstinctExtractor.js'
import { InstinctStore } from '../../src/cortex/InstinctStore.js'
import { SessionInjector } from '../../src/cortex/SessionInjector.js'
import { validateInstinct } from '../../src/cortex/InstinctValidation.js'
import { EVIDENCE_DISCIPLINE_PROMPT } from '../../src/agents/evidenceDiscipline.js'
import { GovernanceMetricsCalculator } from '../../src/cortex/GovernanceMetrics.js'
import { reviewInstinctCandidates } from '../../src/cortex/InstinctCandidateReview.js'

const dirs: string[] = []

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    timestamp: new Date().toISOString(),
    sessionId: 'test-session',
    gateName: 'G5',
    gateStatus: 'FAIL',
    errorPattern: 'test failure',
    filePaths: ['src/foo.ts'],
    rootCause: 'missing assertion',
    resolution: 'add expect() call',
    tokensUsed: 1000,
    modelUsed: 'test-model',
    ...overrides,
  }
}

function makeInstinct(overrides: Partial<Instinct> = {}): Instinct {
  return {
    id: 'instinct-test123',
    trigger: 'test failure',
    confidence: 0.7,
    domain: 'testing',
    source: 'test',
    scope: 'global',
    action: '## Action\nFix the test',
    evidence: ['[2026-05-27] G5: test failure'],
    observations: 5,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    appliedCount: 2,
    hitRate: 0.4,
    ...overrides,
  }
}

function writeGateEvidence(dir: string, overrides: Record<string, unknown> = {}): void {
  const evidenceDir = join(dir, 'evidence')
  mkdirSync(evidenceDir, { recursive: true })

  const id = typeof overrides.id === 'string' ? overrides.id : `GATE-G5-${Date.now()}-test`
  const record = {
    id,
    gate: 'G5',
    status: 'FAILED',
    passed: false,
    evidence: 'Typecheck failed',
    evidenceItems: [{
      id: `${id}-item`,
      kind: 'command',
      label: 'Typecheck command',
      passed: false,
      path: 'src/foo.ts',
      detail: 'tsc exited with code 2',
      exitCode: 2,
      durationMs: 1200,
      rawEstimatedTokens: 250,
      estimatedCostUsd: 0.01,
    }],
    blockers: ['Typecheck failed: tsc exited with code 2'],
    durationMs: 1200,
    createdAt: Date.now(),
    ...overrides,
  }

  writeFileSync(join(evidenceDir, `${id}.json`), JSON.stringify(record, null, 2))
}

function writeCortexSessionEvent(dir: string, instinctIds: string[], timestamp = new Date().toISOString()): void {
  const sessionsDir = join(dir, 'events', 'sessions')
  mkdirSync(sessionsDir, { recursive: true })
  writeFileSync(join(sessionsDir, 'SESSION-CORTEX.jsonl'), `${JSON.stringify({
    type: 'session.started',
    sessionId: 'SESSION-CORTEX',
    createdAt: timestamp,
    data: {
      metadata: {
        cortex: {
          instinctsApplied: instinctIds,
        },
      },
    },
  })}\n`, 'utf-8')
}

describe('InstinctExtractor', () => {
  it('loads observations from JSONL files', () => {
    const dir = makeDir('cortex-obs-')
    const obsDir = join(dir, 'observations')
    mkdirSync(obsDir, { recursive: true })

    const obs1 = makeObservation({ gateName: 'G3' })
    const obs2 = makeObservation({ gateName: 'G5', gateStatus: 'PASS' })
    writeFileSync(join(obsDir, '2026-05-27.jsonl'), JSON.stringify(obs1) + '\n' + JSON.stringify(obs2) + '\n')

    const extractor = new InstinctExtractor(dir)
    const loaded = extractor.loadObservations()

    expect(loaded).toHaveLength(2)
    expect(loaded[0].gateName).toBe('G3')
    expect(loaded[1].gateName).toBe('G5')
  })

  it('returns empty array when observations directory does not exist', () => {
    const dir = makeDir('cortex-no-obs-')
    const extractor = new InstinctExtractor(dir)
    expect(extractor.loadObservations()).toEqual([])
  })

  it('loads gate evidence files as observations', () => {
    const dir = makeDir('cortex-gate-evidence-')
    writeGateEvidence(dir, {
      id: 'GATE-G4-1781290000000-test',
      gate: 'G4',
      createdAt: 1781290000000,
    })

    const extractor = new InstinctExtractor(dir)
    const loaded = extractor.loadObservations()

    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({
      sessionId: 'GATE-G4-1781290000000-test',
      gateName: 'G4',
      gateStatus: 'FAIL',
      filePaths: ['src/foo.ts'],
      tokensUsed: 250,
      modelUsed: 'gate-evidence',
    })
    expect(loaded[0].errorPattern).toContain('G4: Typecheck failed')
  })

  it('detects patterns from failed gate evidence without observations JSONL', () => {
    const dir = makeDir('cortex-gate-pattern-')
    writeGateEvidence(dir, {
      id: 'GATE-G5-1781290000001-a',
      createdAt: 1781290000001,
    })
    writeGateEvidence(dir, {
      id: 'GATE-G5-1781290000002-b',
      createdAt: 1781290000002,
    })

    const extractor = new InstinctExtractor(dir)
    const patterns = extractor.detectPatterns(extractor.loadObservations())

    expect(patterns).toHaveLength(1)
    expect(patterns[0].count).toBe(2)
    expect(patterns[0].pattern).toContain('G5: Typecheck failed')
  })

  it('skips malformed JSONL lines', () => {
    const dir = makeDir('cortex-malformed-')
    const obsDir = join(dir, 'observations')
    mkdirSync(obsDir, { recursive: true })
    writeFileSync(join(obsDir, '2026-05-27.jsonl'), 'not-json\n' + JSON.stringify(makeObservation()) + '\n')

    const extractor = new InstinctExtractor(dir)
    expect(extractor.loadObservations()).toHaveLength(1)
  })

  it('detects patterns from failure observations', () => {
    const extractor = new InstinctExtractor(makeDir('cortex-patterns-'))
    const observations = [
      makeObservation({ errorPattern: 'lint-error', gateName: 'G4' }),
      makeObservation({ errorPattern: 'lint-error', gateName: 'G4' }),
      makeObservation({ errorPattern: 'type-error', gateName: 'G5' }),
      makeObservation({ gateName: 'G5', gateStatus: 'PASS' }), // should be ignored
    ]

    const patterns = extractor.detectPatterns(observations)
    expect(patterns).toHaveLength(2)
    expect(patterns[0].pattern).toBe('lint-error')
    expect(patterns[0].count).toBe(2)
    expect(patterns[1].pattern).toBe('type-error')
    expect(patterns[1].count).toBe(1)
  })

  it('extracts instincts with correct confidence scoring', () => {
    const extractor = new InstinctExtractor(makeDir('cortex-extract-'))

    // 10+ observations with 3+ root causes → 0.9
    const highPattern = {
      pattern: 'frequent-failure',
      count: 12,
      observations: Array.from({ length: 12 }, () => makeObservation()),
      rootCauses: ['rc1', 'rc2', 'rc3'],
      resolutions: ['fix1'],
    }

    // 1 observation → 0.3
    const lowPattern = {
      pattern: 'rare-failure',
      count: 1,
      observations: [makeObservation()],
      rootCauses: [],
      resolutions: [],
    }

    const instincts = extractor.extract([highPattern, lowPattern])
    expect(instincts).toHaveLength(2)
    expect(instincts[0].confidence).toBe(0.9) // sorted desc
    expect(instincts[1].confidence).toBe(0.3)
  })

  it('infers domain from pattern keywords', () => {
    const extractor = new InstinctExtractor(makeDir('cortex-domain-'))

    const securityPattern = {
      pattern: 'security vulnerability in auth',
      count: 3,
      observations: Array.from({ length: 3 }, () => makeObservation()),
      rootCauses: ['weak-auth'],
      resolutions: [],
    }

    const instincts = extractor.extract([securityPattern])
    expect(instincts[0].domain).toBe('security')
  })

  it('records observations to daily JSONL files', () => {
    const dir = makeDir('cortex-record-')
    const extractor = new InstinctExtractor(dir)
    const obs = makeObservation({ gateName: 'G16' })

    extractor.recordObservation(obs)

    const today = new Date().toISOString().slice(0, 10)
    const file = join(dir, 'observations', `${today}.jsonl`)
    expect(existsSync(file)).toBe(true)
  })
})

describe('GovernanceMetricsCalculator', () => {
  it('skips malformed observation lines without dropping valid metrics', () => {
    const dir = makeDir('cortex-metrics-malformed-')
    const obsDir = join(dir, 'observations')
    mkdirSync(obsDir, { recursive: true })

    const obs = makeObservation({
      timestamp: new Date(Date.now() - 1000).toISOString(),
      gateName: 'G7',
      gateStatus: 'PASS',
    })
    writeFileSync(join(obsDir, '2026-05-27.jsonl'), 'not-json\n' + JSON.stringify(obs) + '\n')

    const calculator = new GovernanceMetricsCalculator(dir)
    const metrics = calculator.compute([], 30)

    expect(metrics.gates.totalRuns).toBe(1)
    expect(metrics.gates.passRate).toBe(1)
    expect(metrics.gates.byGate.G7.runs).toBe(1)
  })

  it('computes gate metrics from gate evidence files', () => {
    const dir = makeDir('cortex-metrics-gate-evidence-')
    const now = Date.now() - 1000
    writeGateEvidence(dir, {
      id: `GATE-G4-${now}-pass`,
      gate: 'G4',
      status: 'PASSED',
      passed: true,
      blockers: [],
      durationMs: 100,
      createdAt: now,
      evidenceItems: [{
        id: 'pass-item',
        kind: 'command',
        label: 'Lint command',
        passed: true,
        path: 'src/foo.ts',
        durationMs: 100,
        rawEstimatedTokens: 200,
        estimatedCostUsd: 0.02,
      }],
    })
    writeGateEvidence(dir, {
      id: `GATE-G5-${now + 1}-fail`,
      gate: 'G5',
      durationMs: 300,
      createdAt: now + 1,
      evidenceItems: [{
        id: 'fail-item',
        kind: 'command',
        label: 'Test command',
        passed: false,
        path: 'src/bar.ts',
        detail: 'vitest failed',
        exitCode: 1,
        durationMs: 300,
        rawEstimatedTokens: 100,
        estimatedCostUsd: 0.01,
      }],
    })

    const calculator = new GovernanceMetricsCalculator(dir)
    const metrics = calculator.compute([], 30)

    expect(metrics.gates.totalRuns).toBe(2)
    expect(metrics.gates.passRate).toBe(0.5)
    expect(metrics.gates.avgDurationMs).toBe(200)
    expect(metrics.gates.byGate.G4.runs).toBe(1)
    expect(metrics.gates.byGate.G4.passed).toBe(1)
    expect(metrics.gates.byGate.G5.runs).toBe(1)
    expect(metrics.cost.totalTokens).toBe(300)
    expect(metrics.cost.totalCost).toBeCloseTo(0.03)
  })

  it('computes auto-fix metrics from persisted auto-fix attempt events', () => {
    const dir = makeDir('cortex-metrics-autofix-events-')
    const eventsDir = join(dir, 'events')
    mkdirSync(eventsDir, { recursive: true })
    const now = Date.now() - 1000
    const events = [
      {
        id: 'EVT-autofix-pass',
        type: 'autofix.attempt',
        timestamp: now,
        sessionId: 'auto-fix-test',
        payload: { category: 'lint', success: true, durationMs: 100 },
      },
      {
        id: 'EVT-autofix-fail',
        type: 'autofix.attempt',
        timestamp: now + 1,
        sessionId: 'auto-fix-test',
        payload: { category: 'test', success: false, durationMs: 200 },
      },
    ]
    writeFileSync(join(eventsDir, new Date(now).toISOString().slice(0, 10) + '.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n', 'utf-8')

    const calculator = new GovernanceMetricsCalculator(dir)
    const metrics = calculator.compute([], 30)

    expect(metrics.autoFix).toMatchObject({
      totalAttempts: 2,
      successRate: 0.5,
      avgAttemptsPerFix: 2,
      totalTimeSavedMinutes: 5,
    })
    expect(metrics.gates.byGate['auto-fix:lint']).toMatchObject({ runs: 1, passed: 1 })
    expect(metrics.gates.byGate['auto-fix:test']).toMatchObject({ runs: 1, passed: 0 })
  })

  it('computes instinct hit rate from runtime session injection and application audit evidence', () => {
    const dir = makeDir('cortex-runtime-instinct-metrics-')
    const store = new InstinctStore(join(dir, 'instincts'))
    const succeededId = store.save(makeInstinct({
      id: 'instinct-runtime-success',
      trigger: 'runtime success',
      confidence: 0.9,
      observations: 4,
      appliedCount: 0,
      hitRate: 0,
    }))
    const failedId = store.save(makeInstinct({
      id: 'instinct-runtime-failed',
      trigger: 'runtime failed',
      confidence: 0.7,
      observations: 4,
      appliedCount: 0,
      hitRate: 0,
    }))

    writeCortexSessionEvent(dir, [succeededId, failedId])
    store.recordApplication(succeededId, true)
    store.recordApplication(failedId, false)

    const metrics = new GovernanceMetricsCalculator(dir).compute(store.loadAll(), 30)

    expect(metrics.instincts.runtimeEvidence).toEqual({
      source: 'session-and-audit',
      injectionEvents: 2,
      applicationEvents: 2,
      successfulApplications: 1,
    })
    expect(metrics.instincts.totalInjected).toBe(2)
    expect(metrics.instincts.totalApplied).toBe(1)
    expect(metrics.instincts.hitRate).toBe(0.5)
    expect(metrics.instincts.byConfidence['near-certain (0.9)'].hitRate).toBe(1)
    expect(metrics.instincts.byConfidence['strong (0.7)'].hitRate).toBe(0)
  })
})

describe('InstinctCandidateReview', () => {
  it('accepts unresolved high-confidence failure patterns', () => {
    const extractor = new InstinctExtractor(makeDir('cortex-review-accepted-'))
    const observations = Array.from({ length: 5 }, (_, index) => makeObservation({
      timestamp: new Date(Date.UTC(2026, 5, 12, 10, index)).toISOString(),
      gateName: 'G5',
      errorPattern: 'G5: Tests failed',
      rootCause: 'Tests failed',
      filePaths: ['src/foo.ts'],
    }))

    const patterns = extractor.detectPatterns(observations)
    const instincts = extractor.extract(patterns)
    const reviews = reviewInstinctCandidates(instincts, patterns, observations)

    expect(instincts[0].confidence).toBe(0.7)
    expect(reviews).toHaveLength(1)
    expect(reviews[0].status).toBe('accepted')
    expect(reviews[0].reasons[0]).toContain('no later passing gate')
  })

  it('marks candidates stale when later passing gate evidence covers the same path', () => {
    const extractor = new InstinctExtractor(makeDir('cortex-review-stale-'))
    const failures = Array.from({ length: 5 }, (_, index) => makeObservation({
      timestamp: new Date(Date.UTC(2026, 5, 12, 10, index)).toISOString(),
      gateName: 'G7',
      errorPattern: 'G7: CRITICAL secret.assignment in src/index.ts:1',
      rootCause: 'CRITICAL secret.assignment in src/index.ts:1',
      filePaths: ['src/index.ts'],
    }))
    const observations = [
      ...failures,
      makeObservation({
        timestamp: new Date(Date.UTC(2026, 5, 12, 11, 0)).toISOString(),
        gateName: 'G7',
        gateStatus: 'PASS',
        errorPattern: undefined,
        rootCause: undefined,
        filePaths: ['src'],
      }),
    ]

    const patterns = extractor.detectPatterns(observations)
    const instincts = extractor.extract(patterns)
    const reviews = reviewInstinctCandidates(instincts, patterns, observations)

    expect(reviews).toHaveLength(1)
    expect(reviews[0].status).toBe('stale')
    expect(reviews[0].reasons[0]).toContain('later passing G7 gate')
    expect(reviews[0].laterPassingGateAt).toBe('2026-06-12T11:00:00.000Z')
  })
})

describe('InstinctStore', () => {
  it('saves and loads instincts', () => {
    const dir = makeDir('cortex-store-')
    const store = new InstinctStore(dir)
    const instinct = makeInstinct()

    const savedId = store.save(instinct)
    const loaded = store.loadAll()

    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe(savedId)
    expect(loaded[0].trigger).toBe(instinct.trigger)
    expect(loaded[0].confidence).toBe(instinct.confidence)
  })

  it('deduplicates by trigger, keeping higher confidence', () => {
    const dir = makeDir('cortex-dedup-')
    const store = new InstinctStore(dir)

    store.save(makeInstinct({ trigger: 'same-trigger', confidence: 0.5 }))
    store.save(makeInstinct({ trigger: 'same-trigger', confidence: 0.9 }))

    const loaded = store.loadAll()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].confidence).toBe(0.9)
  })

  it('increments observations when saving lower-confidence duplicate', () => {
    const dir = makeDir('cortex-incr-')
    const store = new InstinctStore(dir)

    store.save(makeInstinct({ trigger: 'my-trigger', confidence: 0.7, observations: 3 }))
    store.save(makeInstinct({ trigger: 'my-trigger', confidence: 0.5, observations: 2 }))

    const loaded = store.loadAll()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].observations).toBe(5) // 3 + 2
  })

  it('rejects invalid instincts before they can be injected', () => {
    const dir = makeDir('cortex-hygiene-')
    const store = new InstinctStore(dir)
    const invalid = makeInstinct({
      trigger: '   ',
      confidence: 0.6,
      action: 'FYI',
    })

    const validation = validateInstinct(invalid)
    expect(validation.ok).toBe(false)

    expect(store.save(invalid)).toBe('')
    expect(store.loadAll()).toEqual([])
    expect(store.getInjectionInstincts()).toEqual([])
    expect(store.history().map(entry => entry.op)).toEqual(['reject'])
  })

  it('deduplicates only within the same scope and project', () => {
    const dir = makeDir('cortex-scope-')
    const store = new InstinctStore(dir)

    const globalId = store.save(makeInstinct({ trigger: 'same-trigger', scope: 'global', confidence: 0.9 }))
    const projectAId = store.save(makeInstinct({ trigger: 'same-trigger', scope: 'project', projectId: 'project-a', confidence: 0.9 }))
    const projectBId = store.save(makeInstinct({ trigger: 'same-trigger', scope: 'project', projectId: 'project-b', confidence: 0.9 }))

    expect(new Set([globalId, projectAId, projectBId]).size).toBe(3)
    expect(store.loadAll()).toHaveLength(3)
    expect(store.findByKey('same-trigger', 'global')?.id).toBe(globalId)
    expect(store.findByKey('same-trigger', 'project', 'project-a')?.id).toBe(projectAId)
    expect(store.findByKey('same-trigger', 'project', 'project-b')?.id).toBe(projectBId)

    const projectAInjectionIds = store.getInjectionInstincts('project-a').map(i => i.id)
    expect(projectAInjectionIds).toContain(globalId)
    expect(projectAInjectionIds).toContain(projectAId)
    expect(projectAInjectionIds).not.toContain(projectBId)

    const unscopedInjectionIds = store.getInjectionInstincts().map(i => i.id)
    expect(unscopedInjectionIds).toContain(globalId)
    expect(unscopedInjectionIds).not.toContain(projectAId)
    expect(unscopedInjectionIds).not.toContain(projectBId)
  })

  it('queries by minConfidence and domain', () => {
    const dir = makeDir('cortex-query-')
    const store = new InstinctStore(dir)

    store.save(makeInstinct({ id: 'i1', trigger: 't1', confidence: 0.9, domain: 'security' }))
    store.save(makeInstinct({ id: 'i2', trigger: 't2', confidence: 0.5, domain: 'testing' }))
    store.save(makeInstinct({ id: 'i3', trigger: 't3', confidence: 0.7, domain: 'security' }))

    const highConf = store.query({ minConfidence: 0.7 })
    expect(highConf).toHaveLength(2)

    const secOnly = store.query({ domain: 'security' })
    expect(secOnly).toHaveLength(2)

    const secHigh = store.query({ domain: 'security', minConfidence: 0.8 })
    expect(secHigh).toHaveLength(1)
    expect(secHigh[0].confidence).toBe(0.9)
  })

  it('returns injection instincts (0.7+ confidence)', () => {
    const dir = makeDir('cortex-inject-')
    const store = new InstinctStore(dir)

    store.save(makeInstinct({ id: 'i1', trigger: 't1', confidence: 0.9 }))
    store.save(makeInstinct({ id: 'i2', trigger: 't2', confidence: 0.5 }))
    store.save(makeInstinct({ id: 'i3', trigger: 't3', confidence: 0.7 }))

    const injection = store.getInjectionInstincts()
    expect(injection).toHaveLength(2)
    expect(injection.every(i => i.confidence >= 0.7)).toBe(true)
  })

  it('parses blank project_id without consuming the next yaml key', () => {
    const dir = makeDir('cortex-blank-project-id-')
    const store = new InstinctStore(dir)

    const savedId = store.save(makeInstinct({
      trigger: 'blank project id',
      scope: 'project',
      projectId: undefined,
      confidence: 0.5,
      observations: 3,
    }))

    const loaded = store.findById(savedId)

    expect(loaded?.projectId).toBeUndefined()
    expect(loaded?.observations).toBe(3)
    expect(store.getInjectionInstincts(undefined, { allowModerateFallback: true }).map(i => i.id)).toEqual([savedId])
  })

  it('records application and updates hit rate', () => {
    const dir = makeDir('cortex-hitrate-')
    const store = new InstinctStore(dir)

    const id = store.save(makeInstinct({ id: 'i1', trigger: 't1', observations: 10, appliedCount: 3 }))
    store.recordApplication(id, true)

    const loaded = store.loadAll()
    expect(loaded[0].appliedCount).toBe(4)
    expect(loaded[0].hitRate).toBeCloseTo(0.4)
    expect(store.history(id).map(entry => entry.op)).toContain('apply')
  })

  it('computes stats by domain and confidence bucket', () => {
    const dir = makeDir('cortex-stats-')
    const store = new InstinctStore(dir)

    store.save(makeInstinct({ id: 'i1', trigger: 't1', confidence: 0.9, domain: 'security' }))
    store.save(makeInstinct({ id: 'i2', trigger: 't2', confidence: 0.7, domain: 'testing' }))
    store.save(makeInstinct({ id: 'i3', trigger: 't3', confidence: 0.3, domain: 'security' }))

    const stats = store.stats()
    expect(stats.total).toBe(3)
    expect(stats.byDomain.security).toBe(2)
    expect(stats.byDomain.testing).toBe(1)
    expect(stats.byConfidence['near-certain (0.9)']).toBe(1)
    expect(stats.byConfidence['strong (0.7)']).toBe(1)
    expect(stats.byConfidence['tentative (0.3)']).toBe(1)
  })

  it('deletes instincts by id', () => {
    const dir = makeDir('cortex-delete-')
    const store = new InstinctStore(dir)

    const id = store.save(makeInstinct({ id: 'i1', trigger: 't1' }))
    expect(store.loadAll()).toHaveLength(1)

    store.delete(id)
    expect(store.loadAll()).toHaveLength(0)
  })

  it('keeps append-only audit history and restores deleted snapshots', () => {
    const dir = makeDir('cortex-audit-')
    const store = new InstinctStore(dir)

    const id = store.save(makeInstinct({ trigger: 'audit-trigger', confidence: 0.7, observations: 1 }))
    store.save(makeInstinct({
      trigger: 'audit-trigger',
      confidence: 0.9,
      observations: 2,
      action: '## Action\nFix the audit regression with a targeted check',
    }))
    expect(store.findById(id)?.confidence).toBe(0.9)
    expect(store.delete(id)).toBe(true)
    expect(store.findById(id)).toBeNull()

    const history = store.history(id)
    expect(history.map(entry => entry.op)).toEqual(['save', 'replace', 'delete'])

    const deleteEntry = history.find(entry => entry.op === 'delete')!
    expect(store.restore(deleteEntry.auditId)).toBe(true)
    expect(store.findById(id)?.confidence).toBe(0.9)
    expect(store.history(id).map(entry => entry.op)).toEqual(['save', 'replace', 'delete', 'restore'])
  })

  it('handles empty store gracefully', () => {
    const dir = makeDir('cortex-empty-')
    const store = new InstinctStore(dir)

    expect(store.loadAll()).toEqual([])
    expect(store.findById('nonexistent')).toBeNull()
    expect(store.findByTrigger('nonexistent')).toBeNull()
    expect(store.getInjectionInstincts()).toEqual([])
    expect(store.stats().total).toBe(0)
    expect(store.delete('nonexistent')).toBe(false)
  })
})

describe('SessionInjector', () => {
  it('builds injection with high-confidence instincts', () => {
    const dir = makeDir('cortex-injector-')
    const store = new InstinctStore(dir)

    const savedId = store.save(makeInstinct({ id: 'i1', trigger: 't1', confidence: 0.9, action: '## Action\nAlways lint first' }))
    store.save(makeInstinct({ id: 'i2', trigger: 't2', confidence: 0.5 })) // should not appear

    const injector = new SessionInjector(store)
    const injection = injector.build()

    expect(injection.instinctCount).toBe(1)
    expect(injection.content).toContain('NEAR-CERTAIN') // 0.9 maps to NEAR-CERTAIN
    expect(injection.content).toContain('Always lint first')
    expect(injection.metadata.instinctsApplied).toEqual([savedId])
  })

  it('uses reviewed moderate fallback when no strong instinct is available', () => {
    const dir = makeDir('cortex-moderate-fallback-')
    const store = new InstinctStore(dir)

    const savedId = store.save(makeInstinct({
      trigger: 'workflow incomplete',
      confidence: 0.5,
      observations: 3,
      action: '## Action\nRecord workflow evidence before claiming completion',
    }))
    store.save(makeInstinct({
      trigger: 'under-observed',
      confidence: 0.5,
      observations: 2,
      action: '## Action\nDo not inject yet',
    }))

    expect(store.getInjectionInstincts()).toEqual([])

    const injection = new SessionInjector(store).build()

    expect(injection.instinctCount).toBe(1)
    expect(injection.content).toContain('reviewed moderate-confidence')
    expect(injection.content).toContain('MODERATE')
    expect(injection.content).toContain('Record workflow evidence before claiming completion')
    expect(injection.metadata.instinctsApplied).toEqual([savedId])
  })

  it('builds minimal injection for constrained context', () => {
    const dir = makeDir('cortex-minimal-')
    const store = new InstinctStore(dir)

    store.save(makeInstinct({ id: 'i1', trigger: 't1', confidence: 0.7 }))

    const injector = new SessionInjector(store)
    const injection = injector.buildMinimal()

    expect(injection.instinctCount).toBe(1)
    expect(injection.content.length).toBeLessThan(500) // minimal is shorter
    expect(injection.content).toContain('证据纪律') // contract present even when minimal
  })

  it('keeps the evidence-discipline contract in minimal injection with no instincts', () => {
    const dir = makeDir('cortex-minimal-empty-')
    const store = new InstinctStore(dir)
    store.save(makeInstinct({ confidence: 0.3 })) // below injection threshold

    const injection = new SessionInjector(store).buildMinimal()

    expect(injection.instinctCount).toBe(0)
    expect(injection.content).toContain('证据纪律')
  })

  it('returns empty injection when no high-confidence instincts', () => {
    const dir = makeDir('cortex-no-inject-')
    const store = new InstinctStore(dir)
    store.save(makeInstinct({ confidence: 0.3 }))

    const injector = new SessionInjector(store)
    const injection = injector.build()

    expect(injection.instinctCount).toBe(0)
    expect(injection.content).not.toContain('Learned Instincts')
  })

  it('always injects the evidence-discipline segment, even with no instincts', () => {
    const dir = makeDir('cortex-evidence-')
    const store = new InstinctStore(dir)
    store.save(makeInstinct({ confidence: 0.3 })) // below injection threshold

    const injector = new SessionInjector(store)
    const injection = injector.build()

    expect(injection.instinctCount).toBe(0)
    expect(injection.content).toContain('证据纪律')
    expect(injection.content).toContain(EVIDENCE_DISCIPLINE_PROMPT)
  })

  it('includes prior session history with anti-replay sentinels', () => {
    const dir = makeDir('cortex-prior-')
    const store = new InstinctStore(dir)
    store.save(makeInstinct({ id: 'i1', trigger: 't1', confidence: 0.9 }))

    const injector = new SessionInjector(store)
    const injection = injector.build('my-project', [{
      sessionId: 's1',
      timestamp: '2026-05-26T10:00:00Z',
      summary: 'Fixed auth bug',
      taskCompleted: 'auth-fix',
      filesChanged: ['src/auth.ts'],
      gatesPassed: true,
    }])

    expect(injection.content).toContain('HISTORICAL CONTEXT')
    expect(injection.content).toContain('Fixed auth bug')
    expect(injection.content).toContain('DO NOT RE-EXECUTE')
  })

  it('detects project type from filesystem', () => {
    const dir = makeDir('cortex-detect-')
    writeFileSync(join(dir, 'package.json'), '{}')
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')

    const injector = new SessionInjector(new InstinctStore(join(dir, 'instincts')))
    const project = injector.detectProject(dir)

    expect(project.projectType).toBe('node')
    expect(project.packageManager).toBe('pnpm')
  })
})
