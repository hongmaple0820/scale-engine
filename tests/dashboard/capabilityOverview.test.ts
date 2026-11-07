import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { buildCapabilityOverview, resolveCapabilityTier } from '../../src/dashboard/CapabilityOverview.js'

let dirs: string[] = []
function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-cap-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

const noTools = { commandExists: () => false }

describe('resolveCapabilityTier', () => {
  it('Level 1 when no optional tools present', () => {
    expect(resolveCapabilityTier(noTools).level).toBe(1)
  })
  it('Level 2 when codegraph present', () => {
    expect(resolveCapabilityTier({ commandExists: c => c === 'codegraph' }).level).toBe(2)
  })
  it('Level 3 when an external engine present', () => {
    expect(resolveCapabilityTier({ commandExists: c => c === 'gbrain' }).level).toBe(3)
  })
})

describe('buildCapabilityOverview (P2-A)', () => {
  it('reports all sources empty on a fresh project', () => {
    const dir = makeDir()
    const overview = buildCapabilityOverview({ projectDir: dir, scaleDir: join(dir, '.scale'), probe: noTools })
    expect(overview.tier.level).toBe(1)
    expect(overview.sources.every(s => !s.ready)).toBe(true)
    expect(overview.readyRatio).toBe(`0/${overview.sources.length}`)
    // empty sources still carry an explanatory reason
    expect(overview.sources[0].reason).toContain('no data yet')
  })

  it('marks sources ready when their evidence files exist', () => {
    const dir = makeDir()
    const scale = join(dir, '.scale')
    mkdirSync(join(scale, 'evidence', 'runtime'), { recursive: true })
    writeFileSync(join(scale, 'evidence', 'runtime', 'RTE-1.json'), '{}')
    mkdirSync(join(scale, 'reviews'), { recursive: true })
    writeFileSync(join(scale, 'reviews', 'REVIEW-1.json'), '{}')
    mkdirSync(join(dir, 'evals', 'golden'), { recursive: true })
    writeFileSync(join(dir, 'evals', 'golden', 'suite.json'), '{}')

    const overview = buildCapabilityOverview({ projectDir: dir, scaleDir: scale, probe: noTools })
    const byId = Object.fromEntries(overview.sources.map(s => [s.id, s]))
    expect(byId['runtime-evidence'].ready).toBe(true)
    expect(byId['review-evidence'].ready).toBe(true)
    expect(byId['golden-evals'].ready).toBe(true)
    expect(byId['model-usage'].ready).toBe(false)
    expect(overview.readyRatio).toBe(`3/${overview.sources.length}`)
  })

  it('includes P1 review and golden data sources', () => {
    const dir = makeDir()
    const overview = buildCapabilityOverview({ projectDir: dir, scaleDir: join(dir, '.scale'), probe: noTools })
    const ids = overview.sources.map(s => s.id)
    expect(ids).toContain('review-evidence')
    expect(ids).toContain('golden-evals')
  })
})
