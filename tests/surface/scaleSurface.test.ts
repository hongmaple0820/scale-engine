// ScaleSurface (output governance, plan 2026-10-24) — manifest registry,
// classification, dual-layout resolution, init recording, tmp TTL.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  CLEANABLE_KINDS,
  classifyScalePath,
  isLayoutV2,
  listSurface,
  loadManifest,
  recordSurfaceFromInit,
  recordWritings,
  resolveScalePath,
  sweepScaleTmp,
} from '../../src/surface/ScaleSurface.js'

const root = mkdtempSync(join(tmpdir(), 'scale-surface-'))

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

function project(name: string): string {
  const dir = join(root, name)
  mkdirSync(join(dir, '.scale'), { recursive: true })
  return dir
}

describe('classifyScalePath — the clean-safety classifier', () => {
  it('evidence and specs are never cleanable', () => {
    expect(classifyScalePath('evidence/runtime/x.json')).toBe('evidence')
    expect(classifyScalePath('specs/checkout-flow.md')).toBe('specs')
    expect(CLEANABLE_KINDS.has(classifyScalePath('evidence/runtime/x.json'))).toBe(false)
    expect(CLEANABLE_KINDS.has(classifyScalePath('specs/myspec/x/requirements.md'))).toBe(false)
  })

  it('config layer is never cleanable', () => {
    expect(classifyScalePath('config.yaml')).toBe('config')
    expect(classifyScalePath('policy.yaml')).toBe('config')
    expect(classifyScalePath('thresholds.json')).toBe('config')
    expect(CLEANABLE_KINDS.has('config' as never)).toBe(false)
  })

  it('tmp/cache/reports are cleanable; runtime state is its own bucket', () => {
    expect(classifyScalePath('tmp/anything')).toBe('tmp')
    expect(classifyScalePath('cache/idx')).toBe('cache')
    expect(classifyScalePath('vectors/x.bin')).toBe('cache')
    expect(classifyScalePath('reports/2026-10-24-x')).toBe('reports')
    expect(classifyScalePath('events/x.jsonl')).toBe('state')
    for (const kind of ['tmp', 'cache', 'reports']) {
      expect(CLEANABLE_KINDS.has(kind as never)).toBe(true)
    }
  })
})

describe('manifest round-trip', () => {
  it('records, merges by path, and reloads', () => {
    const dir = project('manifest')
    const scaleDir = join(dir, '.scale')
    const added = recordWritings(scaleDir, [
      { path: '.claude/settings.json', kind: 'external', platform: 'claude-code', idempotent: 'json-merge' },
      { path: 'AGENTS.md', kind: 'external', idempotent: 'markers' },
    ], 'test')
    expect(added).toBe(2)

    // re-record one path → merge, no duplicate
    const addedAgain = recordWritings(scaleDir, [
      { path: 'AGENTS.md', kind: 'external', by: 'test-2' },
    ], 'test')
    expect(addedAgain).toBe(0)

    const manifest = loadManifest(scaleDir)
    expect(manifest.writings).toHaveLength(2)
    const agents = manifest.writings.find(w => w.path === 'AGENTS.md')!
    expect(agents.by).toBe('test-2')
    expect(manifest.writings.find(w => w.path === '.claude/settings.json')!.platform).toBe('claude-code')
  })

  it('survives a corrupted manifest file (tolerant load)', () => {
    const dir = project('corrupt')
    writeFileSync(join(dir, '.scale', 'manifest.json'), '{broken', 'utf-8')
    expect(loadManifest(join(dir, '.scale')).writings).toEqual([])
    // and recording over it heals the file
    expect(recordWritings(join(dir, '.scale'), [{ path: 'X.md' }], 't')).toBe(1)
    expect(loadManifest(join(dir, '.scale')).writings).toHaveLength(1)
  })
})

describe('recordSurfaceFromInit — orchestration-layer registration', () => {
  it('records external writes and the .scale config layer; ignores .scale internals', () => {
    const dir = project('init')
    const created = [
      join(dir, '.claude', 'settings.json'),
      join(dir, 'AGENTS.md'),
      join(dir, '.scale', 'config.yaml'),
      join(dir, '.scale', 'events'),          // state dir — not tracked
      join(dir, '.scale', 'evidence', 'runtime', 'a.json'), // evidence — not tracked
      'E:/somewhere/outside/x.txt',           // outside project — not tracked
    ]
    const added = recordSurfaceFromInit(dir, created, 'scale setup')
    expect(added).toBe(3) // settings.json + AGENTS.md + config.yaml

    const manifest = loadManifest(join(dir, '.scale'))
    const paths = manifest.writings.map(w => w.path).sort()
    expect(paths).toEqual(['.claude/settings.json', '.scale/config.yaml', 'AGENTS.md'])
    expect(manifest.writings.find(w => w.path === '.scale/config.yaml')!.kind).toBe('config')
    expect(manifest.writings.find(w => w.path === '.claude/settings.json')!.kind).toBe('external')
  })
})

describe('dual-layout resolution', () => {
  it('legacy layout returns flat paths', () => {
    const dir = project('legacy')
    expect(resolveScalePath(join(dir, '.scale'), 'evidence')).toBe(join(dir, '.scale', 'evidence'))
    expect(resolveScalePath(join(dir, '.scale'), 'config.yaml')).toBe(join(dir, '.scale', 'config.yaml'))
    expect(isLayoutV2(join(dir, '.scale'))).toBe(false)
  })

  it('v2 layout maps names into buckets; self-named buckets stay in place', () => {
    const dir = project('v2')
    writeFileSync(join(dir, '.scale', 'layout.json'), '{"version":2}', 'utf-8')
    expect(isLayoutV2(join(dir, '.scale'))).toBe(true)
    expect(resolveScalePath(join(dir, '.scale'), 'evidence')).toBe(join(dir, '.scale', 'evidence'))
    expect(resolveScalePath(join(dir, '.scale'), 'evidence/runtime')).toBe(join(dir, '.scale', 'evidence', 'runtime'))
    expect(resolveScalePath(join(dir, '.scale'), 'config.yaml')).toBe(join(dir, '.scale', 'config', 'config.yaml'))
    expect(resolveScalePath(join(dir, '.scale'), 'events')).toBe(join(dir, '.scale', 'state', 'events'))
    expect(resolveScalePath(join(dir, '.scale'), 'something-new')).toBe(join(dir, '.scale', 'state', 'something-new'))
  })
})

describe('sweepScaleTmp — 72h TTL', () => {
  it('removes only entries older than ttl', () => {
    const dir = project('tmp')
    const scaleDir = join(dir, '.scale')
    mkdirSync(join(scaleDir, 'tmp', 'old'), { recursive: true })
    mkdirSync(join(scaleDir, 'tmp', 'fresh'), { recursive: true })
    writeFileSync(join(scaleDir, 'tmp', 'old', 'x'), 'x', 'utf-8')
    writeFileSync(join(scaleDir, 'tmp', 'fresh', 'x'), 'x', 'utf-8')
    const threeDaysAgo = new Date(Date.now() - 73 * 60 * 60 * 1000)
    utimesSync(join(scaleDir, 'tmp', 'old'), threeDaysAgo, threeDaysAgo)

    const removed = sweepScaleTmp(scaleDir)
    expect(removed).toBe(1)
    expect(existsSync(join(scaleDir, 'tmp', 'old'))).toBe(false)
    expect(existsSync(join(scaleDir, 'tmp', 'fresh'))).toBe(true)
  })

  it('is a no-op without a tmp dir and never throws', () => {
    const dir = project('no-tmp')
    expect(sweepScaleTmp(join(dir, '.scale'))).toBe(0)
  })
})

describe('listSurface — doctor data', () => {
  it('reports registered/unregistered/missing external writes', () => {
    const dir = project('doctor')
    // registered + exists
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(join(dir, '.claude', 'settings.json'), '{}', 'utf-8')
    recordWritings(join(dir, '.scale'), [{ path: '.claude/settings.json', kind: 'external', platform: 'claude-code' }], 't')
    // unregistered: exists on disk, not in manifest
    writeFileSync(join(dir, 'AGENTS.md'), '# x', 'utf-8')
    // missing: registered but absent
    recordWritings(join(dir, '.scale'), [{ path: '.zcode/config.json', kind: 'external' }], 't')

    const listing = listSurface(dir)
    expect(listing.external).toHaveLength(2)
    expect(listing.unregistered).toContain('AGENTS.md')
    expect(listing.missing).toEqual(['.zcode/config.json'])
    expect(listing.roots.length).toBeGreaterThanOrEqual(7)
  })
})
