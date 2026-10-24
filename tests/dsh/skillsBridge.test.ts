// dsh-scale skillsBridge (T2.2) — .scale/skills phase-workflow skills exposed
// through a dsh-skill provider. Names must satisfy /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
// provider/candidate consistency is validated at the registry boundary.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createScaleSkillProvider,
  scanScaleSkills,
  SCALE_SKILL_PROVIDER,
} from '../../packages/dsh-scale/src/skillsBridge.js'

const root = mkdtempSync(join(tmpdir(), 'dsh-skills-'))

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

function writeSkill(phase: string, file: string, body: string) {
  const dir = join(root, '.scale', 'skills', phase)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, file), body)
}

writeSkill('DEFINE', 'deep-interview.md', [
  '# skill: deep-interview',
  '',
  '## Phase',
  'DEFINE',
  '',
  '## Purpose',
  'Interrogate ambiguity before spec generation.',
  '',
  '## Triggers',
  '- Command: `scale define`',
  '- Keywords: interview, ambiguity',
  '',
  '## Body',
  'Ask one question at a time.',
].join('\n'))

writeSkill('BUILD', 'tdd-implementation.md', [
  '# skill: tdd-implementation',
  '',
  '## Purpose',
  'Implement code using the TDD cycle.',
  '',
  '## Triggers',
  '- Keywords: build, implement, code',
].join('\n'))

// not a skill — must be skipped
writeFileSync(join(root, '.scale', 'skills', 'BUILD', '_INDEX.md'), '# index')

describe('scanScaleSkills', () => {
  it('finds phase skills, skipping _INDEX.md, deriving description and whenToUse', () => {
    const entries = scanScaleSkills(root)
    expect(entries.map(e => e.name).sort()).toEqual(['deep-interview', 'tdd-implementation'])
    const di = entries.find(e => e.name === 'deep-interview')!
    expect(di.phase).toBe('DEFINE')
    expect(di.description).toContain('Interrogate ambiguity')
    expect(di.whenToUse).toContain('interview')
    expect(di.path).toBe('.scale/skills/DEFINE/deep-interview.md')
  })

  it('returns [] when .scale/skills does not exist', () => {
    expect(scanScaleSkills(join(root, 'empty-project'))).toEqual([])
    expect(existsSync(join(root, 'empty-project'))).toBe(false)
  })
})

describe('createScaleSkillProvider (dsh-skill contract)', () => {
  it('list() returns valid candidates: kebab names, provider self-consistent, finite rank', async () => {
    const provider = createScaleSkillProvider(() => root)
    const out = await provider.list()
    const candidates = Array.isArray(out) ? out : out.candidates
    for (const c of candidates) {
      expect(c.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(c.provider).toBe(SCALE_SKILL_PROVIDER)
      expect(c.description.length).toBeGreaterThan(0)
      expect(Number.isFinite(c.rank)).toBe(true)
      expect(c.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    }
    expect(candidates).toHaveLength(2)
  })

  it('get() lazily loads the full markdown body as content', async () => {
    const provider = createScaleSkillProvider(() => root)
    const out = await provider.list()
    const candidates = Array.isArray(out) ? out : out.candidates
    const candidate = candidates.find(c => c.name === 'deep-interview')!
    const definition = await provider.get(candidate)
    expect(definition?.content).toContain('# skill: deep-interview')
    expect(definition?.content).toContain('Ask one question at a time.')
    expect(definition?.name).toBe(candidate.name)
  })

  it('get() returns undefined for a locator it does not own', async () => {
    const provider = createScaleSkillProvider(() => root)
    const definition = await provider.get({
      name: 'foreign', description: 'x', invocation: { modelInvocable: true, userInvocable: true },
      source: 'elsewhere', provider: 'other', rank: 1,
    })
    expect(definition).toBeUndefined()
  })
})
