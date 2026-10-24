// dsh-scale cortexBridge — must read the format InstinctStore actually
// writes (<domain>/<id>.yaml). The first implementation read manifest.json +
// flat .md files and silently matched nothing.

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { InstinctStore } from '../../src/cortex/InstinctStore.js'
import type { Instinct } from '../../src/cortex/InstinctExtractor.js'
import { buildCortexContext } from '../../packages/dsh-scale/src/cortexBridge.js'

const root = mkdtempSync(join(tmpdir(), 'dsh-cortex-'))

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

function makeInstinct(overrides: Partial<Instinct> = {}): Instinct {
  const now = new Date().toISOString()
  return {
    id: '',
    trigger: 'before claiming a gate passed',
    confidence: 0.9,
    domain: 'governance',
    source: 'observation.log',
    scope: 'global',
    action: 'Run the gate command and attach its output before reporting any pass.',
    evidence: ['gate-quality failed twice when skipped'],
    observations: 3,
    createdAt: now,
    updatedAt: now,
    appliedCount: 0,
    hitRate: 0,
    ...overrides,
  }
}

describe('buildCortexContext — real InstinctStore format', () => {
  it('returns the evidence-discipline contract even with zero instincts', () => {
    const projectDir = join(root, 'empty')
    const entry = buildCortexContext(projectDir)
    expect(entry).not.toBeNull()
    expect(entry!.content).toContain('证据纪律')
    expect(entry!.id).toBe('scale-cortex')
    expect(entry!.order).toBe(900)
  })

  it('injects a saved high-confidence instinct (format compatibility)', () => {
    const projectDir = join(root, 'with-instinct')
    const store = new InstinctStore(join(projectDir, '.scale', 'instincts'))
    const id = store.save(makeInstinct())
    expect(id).not.toBe('')

    const entry = buildCortexContext(projectDir)
    expect(entry).not.toBeNull()
    expect(entry!.content).toContain('证据纪律')
    expect(entry!.content).toContain('SCALE Cortex Instincts')
    expect(entry!.content).toContain('governance')
  })

  it('never creates a .scale/instincts directory just by reading (createDirs:false)', () => {
    const projectDir = join(root, 'no-side-effect')
    buildCortexContext(projectDir)
    expect(existsSync(join(projectDir, '.scale', 'instincts'))).toBe(false)
  })
})
