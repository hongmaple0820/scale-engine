import { describe, expect, it } from 'vitest'
import { resolveLeanPolicy } from '../../src/workflow/LeanPolicy.js'

describe('resolveLeanPolicy (P4-A)', () => {
  it('lean S runs minimal verification with no artifacts', () => {
    const p = resolveLeanPolicy({ level: 'S', lean: true })
    expect(p.verificationDepth).toBe('minimal')
    expect(p.requireArtifacts).toBe(false)
    expect(p.minVerificationCommands).toBe(0)
  })

  it('lean M skips heavy artifacts but requires one command', () => {
    const p = resolveLeanPolicy({ level: 'M', lean: true })
    expect(p.requireArtifacts).toBe(false)
    expect(p.minVerificationCommands).toBe(1)
    expect(p.freshGate).toBe('off')
  })

  it('lean NEVER downgrades L (isolated review + block gate retained)', () => {
    const p = resolveLeanPolicy({ level: 'L', lean: true })
    expect(p.verificationDepth).toBe('full')
    expect(p.isolatedReview).toBe(true)
    expect(p.freshGate).toBe('block')
    expect(p.requireArtifacts).toBe(true)
  })

  it('lean NEVER downgrades CRITICAL', () => {
    const p = resolveLeanPolicy({ level: 'CRITICAL', lean: true })
    expect(p.isolatedReview).toBe(true)
    expect(p.freshGate).toBe('block')
    expect(p.minVerificationCommands).toBe(3)
  })

  it('non-lean L is still full', () => {
    const p = resolveLeanPolicy({ level: 'L' })
    expect(p.verificationDepth).toBe('full')
    expect(p.isolatedReview).toBe(true)
  })
})
