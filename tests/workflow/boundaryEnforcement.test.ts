import { describe, it, expect } from 'vitest'
import {
  evaluateBoundaries,
  evaluateConstraints,
  pathMatchesGlob,
  formatBoundaryWarnings,
  formatConstraintWarnings,
  isEnforcedBoundaryProfile,
  countBoundaryBlockers,
} from '../../src/workflow/BoundaryEnforcement.js'

describe('pathMatchesGlob', () => {
  it('matches exact paths and is case/separator insensitive', () => {
    expect(pathMatchesGlob('src/a.ts', 'src/a.ts')).toBe(true)
    expect(pathMatchesGlob('SRC\\A.ts', 'src/a.ts')).toBe(true)
    expect(pathMatchesGlob('src/a.ts', 'src/b.ts')).toBe(false)
  })

  it('treats a bare directory as a recursive prefix', () => {
    expect(pathMatchesGlob('src/auth/oauth.ts', 'src/auth')).toBe(true)
    expect(pathMatchesGlob('src/authx/x.ts', 'src/auth')).toBe(false)
  })

  it('supports * (within-segment) and ** (across-segment) globs', () => {
    expect(pathMatchesGlob('src/foo.ts', 'src/*.ts')).toBe(true)
    expect(pathMatchesGlob('src/nested/foo.ts', 'src/*.ts')).toBe(false)
    expect(pathMatchesGlob('src/nested/deep/foo.ts', 'src/**')).toBe(true)
    expect(pathMatchesGlob('lib/foo.ts', 'src/**')).toBe(false)
  })
})

describe('evaluateBoundaries', () => {
  it('returns undefined when nothing is declared', () => {
    expect(evaluateBoundaries(['src/a.ts'], undefined)).toBeUndefined()
    expect(evaluateBoundaries(['src/a.ts'], { files: [], tools: [], forbidden: [] })).toBeUndefined()
  })

  it('flags files outside the allow-list', () => {
    const report = evaluateBoundaries(
      ['src/auth/login.ts', 'src/billing/charge.ts'],
      { files: ['src/auth/**'], tools: [], forbidden: [] },
    )
    expect(report?.violations).toEqual([{ file: 'src/billing/charge.ts', kind: 'outside-allowed' }])
    expect(report?.advisory).toBe(true)
  })

  it('flags forbidden paths and reports the matched glob (forbidden wins over allowed)', () => {
    const report = evaluateBoundaries(
      ['src/auth/secrets.ts'],
      { files: ['src/**'], tools: [], forbidden: ['**/secrets.ts'] },
    )
    expect(report?.violations).toEqual([
      { file: 'src/auth/secrets.ts', kind: 'forbidden-touched', matchedGlob: '**/secrets.ts' },
    ])
  })

  it('passes clean when every changed file is allowed and none forbidden', () => {
    const report = evaluateBoundaries(
      ['src/auth/login.ts'],
      { files: ['src/auth/**'], tools: [], forbidden: ['**/*.env'] },
    )
    expect(report?.violations).toEqual([])
    expect(report?.changedFiles).toBe(1)
  })

  it('does not flag outside-allowed when only forbidden is declared', () => {
    const report = evaluateBoundaries(
      ['anywhere/file.ts'],
      { files: [], tools: [], forbidden: ['secret/**'] },
    )
    expect(report?.violations).toEqual([])
  })
})

describe('evaluateConstraints', () => {
  it('returns undefined when no constraints declared', () => {
    expect(evaluateConstraints([], ['src/perf.test.ts'])).toBeUndefined()
    expect(evaluateConstraints(undefined, undefined)).toBeUndefined()
  })

  it('marks a constraint covered when a surface item shares a significant token', () => {
    const report = evaluateConstraints(
      ['login latency must not regress'],
      ['benchmarks/latency.bench.ts'],
    )
    expect(report?.covered).toBe(1)
    expect(report?.uncovered).toEqual([])
  })

  it('lists constraints with no guarding surface as uncovered', () => {
    const report = evaluateConstraints(
      ['no new npm dependencies', 'backward compatible CLI flags'],
      ['tests/cli/flags.test.ts'],
    )
    // "compatible"/"flags" overlaps the CLI flags test; the dependency one does not.
    expect(report?.uncovered).toEqual(['no new npm dependencies'])
    expect(report?.covered).toBe(1)
    expect(report?.advisory).toBe(true)
  })
})

describe('formatters', () => {
  it('emit nothing when clean', () => {
    expect(formatBoundaryWarnings(undefined)).toEqual([])
    expect(formatBoundaryWarnings({ declaredAllowed: 1, declaredForbidden: 0, changedFiles: 1, violations: [], advisory: true })).toEqual([])
    expect(formatConstraintWarnings(undefined)).toEqual([])
    expect(formatConstraintWarnings({ declared: 1, covered: 1, uncovered: [], advisory: true })).toEqual([])
  })

  it('render violation and uncovered lines', () => {
    const b = formatBoundaryWarnings({
      declaredAllowed: 1,
      declaredForbidden: 1,
      changedFiles: 2,
      violations: [
        { file: 'src/x.ts', kind: 'outside-allowed' },
        { file: 'a/secrets.ts', kind: 'forbidden-touched', matchedGlob: '**/secrets.ts' },
      ],
      advisory: true,
    })
    expect(b.join('\n')).toContain('[OUTSIDE-ALLOWED] src/x.ts')
    expect(b.join('\n')).toContain('[FORBIDDEN] a/secrets.ts (matched **/secrets.ts)')

    const c = formatConstraintWarnings({ declared: 2, covered: 1, uncovered: ['no new deps'], advisory: true })
    expect(c.join('\n')).toContain('[UNGUARDED] no new deps')
  })

  it('escalate labels from advisory to blocking when the report is enforced', () => {
    const b = formatBoundaryWarnings({
      declaredAllowed: 1, declaredForbidden: 0, changedFiles: 1,
      violations: [{ file: 'src/x.ts', kind: 'outside-allowed' }],
      advisory: false,
    })
    expect(b[0]).toContain('[BLOCKER]')
    expect(b[0]).toContain('blocking under enforced profile')

    const c = formatConstraintWarnings({ declared: 1, covered: 0, uncovered: ['no new deps'], advisory: false })
    expect(c[0]).toContain('[BLOCKER]')
    expect(c[0]).toContain('blocking under enforced profile')
  })
})

describe('isEnforcedBoundaryProfile (decision E1)', () => {
  it('treats full/ci/strict (and name-suffixed variants) as enforced', () => {
    for (const p of ['full', 'ci', 'strict', 'CI', 'team-strict', 'release:full', 'node_ci']) {
      expect(isEnforcedBoundaryProfile(p)).toBe(true)
    }
  })

  it('keeps default/auto (and unset) advisory', () => {
    for (const p of ['default', 'auto', 'quick', 'official', undefined]) {
      expect(isEnforcedBoundaryProfile(p)).toBe(false)
    }
  })
})

describe('countBoundaryBlockers', () => {
  it('sums boundary violations and uncovered constraints', () => {
    const boundary = evaluateBoundaries(
      ['src/billing/charge.ts', 'src/auth/secrets.ts'],
      { files: ['src/auth/**'], tools: [], forbidden: ['**/secrets.ts'] },
      true,
    )
    const constraint = evaluateConstraints(['no new npm dependencies'], ['tests/cli/flags.test.ts'], true)
    // one outside-allowed + one forbidden-touched + one uncovered constraint
    expect(countBoundaryBlockers(boundary, constraint)).toBe(3)
  })

  it('is zero for clean or undefined reports', () => {
    expect(countBoundaryBlockers(undefined, undefined)).toBe(0)
    const clean = evaluateBoundaries(['src/auth/login.ts'], { files: ['src/auth/**'], tools: [], forbidden: [] }, true)
    const covered = evaluateConstraints(['login latency must not regress'], ['benchmarks/latency.bench.ts'], true)
    expect(countBoundaryBlockers(clean, covered)).toBe(0)
  })
})

describe('enforced flag sets advisory mode (detection unchanged)', () => {
  it('reports advisory:false under enforcement but the same violations', () => {
    const args = ['src/billing/charge.ts'] as string[]
    const boundaries = { files: ['src/auth/**'], tools: [], forbidden: [] }
    const advisory = evaluateBoundaries(args, boundaries)
    const enforced = evaluateBoundaries(args, boundaries, true)
    expect(advisory?.advisory).toBe(true)
    expect(enforced?.advisory).toBe(false)
    expect(enforced?.violations).toEqual(advisory?.violations)

    const cAdvisory = evaluateConstraints(['no new npm dependencies'], [])
    const cEnforced = evaluateConstraints(['no new npm dependencies'], [], true)
    expect(cAdvisory?.advisory).toBe(true)
    expect(cEnforced?.advisory).toBe(false)
    expect(cEnforced?.uncovered).toEqual(cAdvisory?.uncovered)
  })
})
