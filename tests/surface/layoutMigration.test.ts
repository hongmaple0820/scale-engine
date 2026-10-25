// Layout v2 migration (plan 2026-10-24 §3) — move into buckets, compat links
// at legacy paths, rollback; probe-based consolidated roots; uninstall.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  migrateLayoutV2,
  rollbackLayoutV2,
} from '../../src/surface/LayoutMigration.js'
import { isLayoutV2, resolveScalePath, agentStateRoot, planningRoot, workflowDocsRoot } from '../../src/surface/ScaleSurface.js'

const root = mkdtempSync(join(tmpdir(), 'scale-migrate-'))

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

function legacyProject(name: string): string {
  const dir = join(root, name)
  const scaleDir = join(dir, '.scale')
  mkdirSync(scaleDir, { recursive: true })
  // representative flat entries
  writeFileSync(join(scaleDir, 'config.yaml'), 'mode: standard\n', 'utf-8')
  writeFileSync(join(scaleDir, 'policy.yaml'), 'rules: []\n', 'utf-8')
  mkdirSync(join(scaleDir, 'events'), { recursive: true })
  writeFileSync(join(scaleDir, 'events', 'x.jsonl'), 'XLINE\n', 'utf-8')
  mkdirSync(join(scaleDir, 'evidence', 'runtime'), { recursive: true })
  writeFileSync(join(scaleDir, 'evidence', 'runtime', 'RTE-1.json'), '{}', 'utf-8')
  mkdirSync(join(scaleDir, 'specs'), { recursive: true })
  writeFileSync(join(scaleDir, 'specs', 'spec.md'), '# s', 'utf-8')
  mkdirSync(join(scaleDir, 'instincts'), { recursive: true })
  writeFileSync(join(scaleDir, 'GLOSSARY.md'), '# g', 'utf-8')
  return dir
}

describe('migrateLayoutV2', () => {
  it('moves entries into buckets and leaves working compat links at legacy paths', () => {
    const dir = legacyProject('basic')
    const scaleDir = join(dir, '.scale')
    const report = migrateLayoutV2(dir)

    expect(isLayoutV2(scaleDir)).toBe(true)
    // physical locations moved
    expect(existsSync(join(scaleDir, 'config', 'config.yaml'))).toBe(true)
    expect(existsSync(join(scaleDir, 'state', 'events', 'x.jsonl'))).toBe(true)
    // self-named buckets (evidence/specs) stay in place — bucket root IS the data
    expect(existsSync(join(scaleDir, 'evidence', 'runtime', 'RTE-1.json'))).toBe(true)
    expect(existsSync(join(scaleDir, 'specs', 'spec.md'))).toBe(true)
    // legacy flat paths still resolve (compat links) — the 129 hardcoded readers
    expect(readFileSync(join(scaleDir, 'events', 'x.jsonl'), 'utf-8')).toContain('XLINE')
    expect(readFileSync(join(scaleDir, 'config.yaml'), 'utf-8')).toContain('standard')
    expect(readFileSync(join(scaleDir, 'evidence', 'runtime', 'RTE-1.json'), 'utf-8')).toBe('{}')
    // manifest.json / layout.json never move
    expect(report.moved.length).toBeGreaterThan(0)
    // self-named buckets are skipped, not moved
    expect(report.moved.map(m => m.from)).not.toContain('evidence')
  })

  it('resolveScalePath and the compat links agree after migration', () => {
    const dir = legacyProject('agree')
    const scaleDir = join(dir, '.scale')
    migrateLayoutV2(dir)
    const resolved = resolveScalePath(scaleDir, 'config.yaml')
    expect(readFileSync(resolved, 'utf-8')).toContain('standard')
  })

  it('is idempotent (second run is a no-op)', () => {
    const dir = legacyProject('idempotent')
    migrateLayoutV2(dir)
    const again = migrateLayoutV2(dir)
    expect(again.skipped).toContain('already-v2')
    expect(again.moved.map(m => m.from).sort()).toEqual(['GLOSSARY.md', 'config.yaml', 'events', 'instincts', 'policy.yaml'])
  })

  it('rollback restores the flat layout with content intact', () => {
    const dir = legacyProject('rollback')
    const scaleDir = join(dir, '.scale')
    migrateLayoutV2(dir)
    rollbackLayoutV2(dir)

    expect(isLayoutV2(scaleDir)).toBe(false)
    expect(readFileSync(join(scaleDir, 'events', 'x.jsonl'), 'utf-8')).toBe('XLINE\n')
    expect(readFileSync(join(scaleDir, 'config.yaml'), 'utf-8')).toContain('standard')
    expect(existsSync(join(scaleDir, 'evidence', 'runtime', 'RTE-1.json'))).toBe(true)
    expect(existsSync(join(scaleDir, 'config', 'config.yaml'))).toBe(false)
  })

  it('throws cleanly without a .scale directory', () => {
    const empty = join(root, 'empty-project')
    mkdirSync(empty, { recursive: true })
    expect(() => migrateLayoutV2(empty)).toThrow(/no \.scale directory/)
  })
})

describe('probe-based consolidated roots', () => {
  it('scale projects get .scale roots; non-scale projects keep legacy', () => {
    const scaleProject = join(root, 'with-scale')
    mkdirSync(join(scaleProject, '.scale'), { recursive: true })
    expect(planningRoot(scaleProject)).toBe(join(scaleProject, '.scale', 'state', 'planning'))
    expect(agentStateRoot(scaleProject)).toBe(join(scaleProject, '.scale', 'state', 'agent'))
    expect(workflowDocsRoot(scaleProject)).toBe(join(scaleProject, '.scale', 'reports', 'workflow'))

    const legacyProjectDir = join(root, 'no-scale')
    mkdirSync(legacyProjectDir, { recursive: true })
    expect(planningRoot(legacyProjectDir)).toBe(join(legacyProjectDir, '.planning'))
    expect(agentStateRoot(legacyProjectDir)).toBe(join(legacyProjectDir, '.agent', 'state'))
  })

  it('workflowDocsRoot prefers an existing legacy docs/workflow over the default', () => {
    const dir = join(root, 'legacy-docs')
    mkdirSync(join(dir, 'docs', 'workflow'), { recursive: true })
    expect(workflowDocsRoot(dir)).toBe(join(dir, 'docs', 'workflow'))
  })
})
