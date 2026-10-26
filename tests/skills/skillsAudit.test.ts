// Skills governance audit — productized from the 2026-10-24 one-off that
// found 37/64 references missing and a waiver expired for three months.
// The repo self-check hard-enforces the machine-independent invariants
// (waiver validity, config health) everywhere, and full REQUIRED resolution
// wherever the global skill roots exist (CI runners don't have them).

import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { auditSkills, auditSkillsForCI } from '../../src/skills/SkillsAudit.js'

const root = mkdtempSync(join(tmpdir(), 'skills-audit-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function fixture(name: string, options: { waived?: Array<{ id: string; expiresAt: string }>; localSkills?: string[] } = {}) {
  const dir = join(root, name)
  mkdirSync(join(dir, '.scale', 'skills'), { recursive: true })
  for (const skill of options.localSkills ?? []) {
    mkdirSync(join(dir, '.scale', 'skills', skill), { recursive: true })
  }
  writeFileSync(join(dir, '.scale', 'skills.json'), JSON.stringify({
    version: 1,
    policy: { mode: 'warn', waivedRecommendedSkills: options.waived ?? [] },
    skillSources: { primaryRoot: '.scale/skills', fallbackRoots: [], globalRoots: ['~/.no-such-root-scale-test'] },
    domains: {
      ui: { requiredSkills: ['impeccable'], recommendedSkills: ['taste-skill'] },
      review: { requiredSkills: ['code-reviewer'], recommendedSkills: [] },
    },
  }), 'utf-8')
  return dir
}

describe('auditSkills (fixture semantics)', () => {
  it('flags missing REQUIRED vs recommended distinctly', () => {
    const report = auditSkills(fixture('missing'), { includeGlobalRoots: false })
    expect(report.missingRequired).toBe(2)
    expect(report.missing.some(m => !m.required)).toBe(true)
    expect(report.ok).toBe(false)
  })

  it('resolves installed project-local skills and passes', () => {
    const report = auditSkills(fixture('installed', { localSkills: ['impeccable', 'code-reviewer', 'taste-skill'] }), { includeGlobalRoots: false })
    expect(report.missingRequired).toBe(0)
    expect(report.ok).toBe(true)
    expect(report.present).toBe(3)
  })

  it('resolves skills installed as directory symlinks (e.g. wewrite install.sh)', () => {
    const dir = fixture('symlinked', { localSkills: ['impeccable'] })
    const target = join(root, 'symlink-target', 'code-reviewer')
    mkdirSync(target, { recursive: true })
    try {
      symlinkSync(target, join(dir, '.scale', 'skills', 'code-reviewer'), 'dir')
    } catch {
      return // Windows without symlink privilege — the invariant is covered on other platforms
    }
    const report = auditSkills(dir, { includeGlobalRoots: false })
    expect(report.missingRequired).toBe(0)
    expect(report.ok).toBe(true)
    expect(report.present).toBe(2)
  })

  it('waived recommended entries are deliberate gaps, not failures', () => {
    const report = auditSkills(
      fixture('waived', {
        localSkills: ['impeccable', 'code-reviewer'],
        waived: [{ id: 'taste-skill', expiresAt: '2099-01-01' }],
      }),
      { includeGlobalRoots: false },
    )
    expect(report.missing).toEqual([])
    expect(report.ok).toBe(true)
  })

  it('expired waivers fail the audit regardless of resolution', () => {
    const report = auditSkills(
      fixture('expired', {
        localSkills: ['impeccable', 'code-reviewer'],
        waived: [{ id: 'taste-skill', expiresAt: '2026-07-31' }],
      }),
      { includeGlobalRoots: false, now: new Date('2026-10-25T00:00:00Z') },
    )
    expect(report.expiredWaivers).toEqual([{ id: 'taste-skill', expiresAt: '2026-07-31' }])
    expect(report.ok).toBe(false)
  })

  it('unreadable skills.json fails loudly', () => {
    const dir = join(root, 'no-config')
    mkdirSync(join(dir, '.scale'), { recursive: true })
    const report = auditSkillsForCI(dir)
    expect(report.ok).toBe(false)
    expect(report.missingRequired).toBe(1)
  })
})

describe('repo self-check (governance self-heal)', () => {
  const repoRoot = process.cwd()

  it('no expired waivers and skills.json healthy — machine-independent, CI-enforced', () => {
    const report = auditSkillsForCI(repoRoot)
    expect(report.expiredWaivers).toEqual([])
    expect(report.totalReferenced).toBeGreaterThan(0)
  })

  const globalRootsExist = existsSync(join(homedir(), '.agents', 'skills'))
  it.runIf(globalRootsExist)('every REQUIRED skill resolves (global roots present on this machine)', () => {
    const report = auditSkills(repoRoot)
    expect(report.missing.filter(m => m.required)).toEqual([])
  })
})
