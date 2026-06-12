import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { InstinctExtractor, type Observation, type Instinct } from '../../src/cortex/InstinctExtractor.js'
import { InstinctStore } from '../../src/cortex/InstinctStore.js'
import { SessionInjector } from '../../src/cortex/SessionInjector.js'
import { EVIDENCE_DISCIPLINE_PROMPT } from '../../src/agents/evidenceDiscipline.js'

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

describe('InstinctStore', () => {
  it('saves and loads instincts', () => {
    const dir = makeDir('cortex-store-')
    const store = new InstinctStore(dir)
    const instinct = makeInstinct()

    store.save(instinct)
    const loaded = store.loadAll()

    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe(instinct.id)
    expect(loaded[0].trigger).toBe(instinct.trigger)
    expect(loaded[0].confidence).toBe(instinct.confidence)
  })

  it('deduplicates by trigger, keeping higher confidence', () => {
    const dir = makeDir('cortex-dedup-')
    const store = new InstinctStore(dir)

    // findByTrigger uses sha256(trigger) as id, so save with matching id
    const { createHash } = require('node:crypto')
    const triggerHash = 'instinct-' + createHash('sha256').update('same-trigger').digest('hex').slice(0, 10)

    store.save(makeInstinct({ id: triggerHash, trigger: 'same-trigger', confidence: 0.5 }))
    store.save(makeInstinct({ id: triggerHash, trigger: 'same-trigger', confidence: 0.9 }))

    const loaded = store.loadAll()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].confidence).toBe(0.9)
  })

  it('increments observations when saving lower-confidence duplicate', () => {
    const dir = makeDir('cortex-incr-')
    const store = new InstinctStore(dir)

    const { createHash } = require('node:crypto')
    const triggerHash = 'instinct-' + createHash('sha256').update('my-trigger').digest('hex').slice(0, 10)

    store.save(makeInstinct({ id: triggerHash, trigger: 'my-trigger', confidence: 0.7, observations: 3 }))
    store.save(makeInstinct({ id: triggerHash, trigger: 'my-trigger', confidence: 0.5, observations: 2 }))

    const loaded = store.loadAll()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].observations).toBe(5) // 3 + 2
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

  it('records application and updates hit rate', () => {
    const dir = makeDir('cortex-hitrate-')
    const store = new InstinctStore(dir)

    store.save(makeInstinct({ id: 'i1', trigger: 't1', observations: 10, appliedCount: 3 }))
    store.recordApplication('i1', true)

    const loaded = store.loadAll()
    expect(loaded[0].appliedCount).toBe(4)
    expect(loaded[0].hitRate).toBeCloseTo(0.4)
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

    store.save(makeInstinct({ id: 'i1', trigger: 't1' }))
    expect(store.loadAll()).toHaveLength(1)

    store.delete('i1')
    expect(store.loadAll()).toHaveLength(0)
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

    store.save(makeInstinct({ id: 'i1', trigger: 't1', confidence: 0.9, action: '## Action\nAlways lint first' }))
    store.save(makeInstinct({ id: 'i2', trigger: 't2', confidence: 0.5 })) // should not appear

    const injector = new SessionInjector(store)
    const injection = injector.build()

    expect(injection.instinctCount).toBe(1)
    expect(injection.content).toContain('NEAR-CERTAIN') // 0.9 maps to NEAR-CERTAIN
    expect(injection.content).toContain('Always lint first')
    expect(injection.metadata.instinctsApplied).toEqual(['i1'])
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
