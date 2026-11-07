import { describe, expect, it } from 'vitest'
import { detectSpecDrift, extractCodeTokens } from '../../src/spec/SpecDriftDetector.js'

describe('extractCodeTokens', () => {
  it('keeps path-like and identifier-like tokens, drops stopwords', () => {
    const tokens = extractCodeTokens('WHEN src/auth/oauth.ts handles tokenRefresh THEN the system SHALL return 200')
    expect(tokens).toContain('src/auth/oauth.ts')
    expect(tokens).toContain('tokenrefresh')
    expect(tokens).not.toContain('when')
    expect(tokens).not.toContain('shall')
  })
})

describe('detectSpecDrift (P1-C)', () => {
  const clauses = [
    { id: 'FR-AUTH-001', text: 'WHEN src/auth/oauth.ts receives a callback THEN SHALL validate state' },
    { id: 'FR-BILL-002', text: 'WHEN src/billing/invoice.ts is saved THEN SHALL persist totals' },
  ]

  it('flags drift when code changes but spec files are untouched', () => {
    const r = detectSpecDrift({
      clauses,
      changedFiles: ['src/auth/oauth.ts', 'README.md'],
      specFiles: ['.scale/specs/auth.md'],
    })
    expect(r.ok).toBe(false)
    expect(r.specTouched).toBe(false)
    expect(r.driftCount).toBe(1)
    expect(r.findings[0].clauseId).toBe('FR-AUTH-001')
    expect(r.findings[0].changedFiles).toContain('src/auth/oauth.ts')
    expect(r.findings[0].suggestedUpdate).toContain('FR-AUTH-001')
  })

  it('does not flag when the spec file is updated in the same change set', () => {
    const r = detectSpecDrift({
      clauses,
      changedFiles: ['src/auth/oauth.ts', '.scale/specs/auth.md'],
      specFiles: ['.scale/specs/auth.md'],
    })
    expect(r.ok).toBe(true)
    expect(r.specTouched).toBe(true)
    expect(r.findings).toHaveLength(0)
  })

  it('does not flag when no changed file matches any clause token', () => {
    const r = detectSpecDrift({
      clauses,
      changedFiles: ['docs/readme.md', 'scripts/build.mjs'],
      specFiles: ['.scale/specs/auth.md'],
    })
    expect(r.ok).toBe(true)
    expect(r.driftCount).toBe(0)
  })

  it('treats missing specFiles as touched to avoid false positives', () => {
    const r = detectSpecDrift({ clauses, changedFiles: ['src/auth/oauth.ts'] })
    expect(r.specTouched).toBe(true)
    expect(r.ok).toBe(true)
  })

  it('reports multiple clauses touching multiple files', () => {
    const r = detectSpecDrift({
      clauses,
      changedFiles: ['src/auth/oauth.ts', 'src/billing/invoice.ts'],
      specFiles: ['spec.md'],
    })
    expect(r.driftCount).toBe(2)
    expect(r.findings.map(f => f.clauseId).sort()).toEqual(['FR-AUTH-001', 'FR-BILL-002'])
  })

  it('ignores clauses with no code tokens', () => {
    const r = detectSpecDrift({
      clauses: [{ id: 'UX-1', text: 'The interface SHALL be user-friendly' }],
      changedFiles: ['src/auth/oauth.ts'],
      specFiles: ['spec.md'],
    })
    expect(r.ok).toBe(true)
  })
})
