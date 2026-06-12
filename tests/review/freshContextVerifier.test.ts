import { describe, expect, it } from 'vitest'
import { JsonLlmClient } from '../../src/review/JsonLlmClient.js'
import { FreshContextVerifier } from '../../src/review/FreshContextVerifier.js'

// Disabled client => deterministic heuristic, no network.
function offlineVerifier(): FreshContextVerifier {
  return new FreshContextVerifier(new JsonLlmClient(false))
}

describe('FreshContextVerifier heuristic fallback (P2.2)', () => {
  it('is uncertain when no verification surface is declared', async () => {
    const verdict = await offlineVerifier().verify({
      verificationSurface: [],
      diffSummary: '# src/a.ts\n+ const x = 1',
      gateSummary: 'critical=0 high=0 medium=0 low=0',
    })
    expect(verdict.decision).toBe('uncertain')
    expect(verdict.modelUsed).toBe('heuristic')
    expect(verdict.advisory).toBe(true)
  })

  it('marks unverified and lists surfaces with no diff evidence', async () => {
    const verdict = await offlineVerifier().verify({
      outcome: 'add login + benchmark',
      verificationSurface: ['tests/login.test.ts', 'npm run benchmark'],
      diffSummary: '# src/login.ts\n+ export function login() {}',
      gateSummary: 'critical=0 high=0 medium=0 low=0',
    })
    expect(verdict.decision).toBe('unverified')
    expect(verdict.unmetSurfaces).toContain('npm run benchmark')
    expect(verdict.unmetSurfaces).not.toContain('tests/login.test.ts')
  })

  it('verifies when every declared surface is evidenced by the diff', async () => {
    const verdict = await offlineVerifier().verify({
      outcome: 'add login test',
      verificationSurface: ['tests/login.test.ts'],
      diffSummary: '# tests/login.test.ts\n+ it("login works")',
      gateSummary: 'critical=0 high=0 medium=0 low=0',
    })
    expect(verdict.decision).toBe('verified')
    expect(verdict.unmetSurfaces).toHaveLength(0)
  })

  it('does not let a clean gate summary override missing diff evidence', async () => {
    // Fresh verifier trusts artifacts, not the build agent's gate claims: a
    // green gate summary must not flip an unmet surface to "verified".
    const verdict = await offlineVerifier().verify({
      verificationSurface: ['npm run benchmark'],
      diffSummary: '# README.md\n+ docs only',
      gateSummary: 'critical=0 high=0 medium=0 low=0',
    })
    expect(verdict.decision).toBe('unverified')
  })
})
