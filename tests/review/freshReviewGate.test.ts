import { describe, expect, it } from 'vitest'
import { applyFreshGate, normalizeFreshGateMode } from '../../src/review/freshReviewGate.js'
import type { FreshVerifyVerdict } from '../../src/review/FreshContextVerifier.js'
import type { ReviewFinding } from '../../src/workflow/ReviewStore.js'

function verdict(decision: FreshVerifyVerdict['decision'], unmet: string[] = []): FreshVerifyVerdict {
  return {
    decision,
    confidence: 0.5,
    rationale: `heuristic ${decision}`,
    unmetSurfaces: unmet,
    modelUsed: 'heuristic',
    advisory: true,
    createdAt: Date.now(),
  }
}

const baseFinding: ReviewFinding = { category: 'logic', severity: 'MEDIUM', description: 'existing' }

describe('normalizeFreshGateMode', () => {
  it('defaults unknown values to off', () => {
    expect(normalizeFreshGateMode(undefined)).toBe('off')
    expect(normalizeFreshGateMode('')).toBe('off')
    expect(normalizeFreshGateMode('whatever')).toBe('off')
    expect(normalizeFreshGateMode('WARN')).toBe('warn')
    expect(normalizeFreshGateMode('Block')).toBe('block')
  })
})

describe('applyFreshGate (P1-A effort-tuned gate)', () => {
  it('off keeps advisory semantics even for unverified', () => {
    const r = applyFreshGate({ passed: true, findings: [baseFinding], verdict: verdict('unverified', ['x']), gate: 'off' })
    expect(r.passed).toBe(true)
    expect(r.findings).toHaveLength(1)
    expect(r.enforced).toBe(false)
  })

  it('warn surfaces unverified as LOW without blocking', () => {
    const r = applyFreshGate({ passed: true, findings: [], verdict: verdict('unverified', ['surface A']), gate: 'warn' })
    expect(r.passed).toBe(true)
    expect(r.enforced).toBe(false)
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].severity).toBe('LOW')
    expect(r.findings[0].description).toContain('surface A')
  })

  it('block upgrades unverified to CRITICAL and fails the review', () => {
    const r = applyFreshGate({ passed: true, findings: [baseFinding], verdict: verdict('unverified', ['surface B']), gate: 'block' })
    expect(r.passed).toBe(false)
    expect(r.enforced).toBe(true)
    expect(r.findings.some(f => f.severity === 'CRITICAL' && f.description.includes('surface B'))).toBe(true)
    // existing findings preserved
    expect(r.findings.some(f => f.description === 'existing')).toBe(true)
  })

  it('block does not block a verified verdict', () => {
    const r = applyFreshGate({ passed: true, findings: [], verdict: verdict('verified'), gate: 'block' })
    expect(r.passed).toBe(true)
    expect(r.enforced).toBe(false)
    expect(r.findings).toHaveLength(0)
  })

  it('uncertain never blocks (nothing to verify against)', () => {
    const r = applyFreshGate({ passed: true, findings: [], verdict: verdict('uncertain'), gate: 'block' })
    expect(r.passed).toBe(true)
    expect(r.enforced).toBe(false)
  })

  it('no verdict is a no-op', () => {
    const r = applyFreshGate({ passed: false, findings: [baseFinding], verdict: undefined, gate: 'block' })
    expect(r.passed).toBe(false)
    expect(r.findings).toHaveLength(1)
    expect(r.enforced).toBe(false)
  })
})
