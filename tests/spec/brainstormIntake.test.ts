import { describe, expect, it } from 'vitest'
import { intakeBrainstorm } from '../../src/spec/BrainstormIntake.js'
import { compileAcceptanceChecks } from '../../src/spec/AcceptanceCompiler.js'

describe('intakeBrainstorm (P2-D)', () => {
  it('converts a Given/When/Then line into an EARS criterion', () => {
    const r = intakeBrainstorm('Given a logged-in user, When they click logout, Then the session ends')
    expect(r.converted).toBe(1)
    expect(r.criteria[0].id).toBe('BS-001')
    expect(r.criteria[0].text).toMatch(/^WHEN they click logout \(given a logged-in user\) THEN the system SHALL the session ends$/i)
  })

  it('converts a When/Then line', () => {
    const r = intakeBrainstorm('When the token expires, Then the API returns 401')
    expect(r.converted).toBe(1)
    expect(r.criteria[0].text).toContain('WHEN the token expires THEN the system SHALL the API returns 401')
  })

  it('keeps already-EARS lines as-is', () => {
    const r = intakeBrainstorm('WHEN saved THEN the system SHALL persist the record')
    expect(r.criteria[0].text).toContain('WHEN saved')
    expect(r.criteria[0].kind).toBe('event')
  })

  it('turns bullet checklist items into SHALL statements', () => {
    const r = intakeBrainstorm('- [ ] users can reset their password\n* export data as CSV')
    expect(r.converted).toBe(2)
    expect(r.criteria[0].text).toContain('SHALL')
    expect(r.criteria[0].text).toContain('reset their password')
    expect(r.criteria[1].text).toContain('export data as CSV')
  })

  it('drops headings but records them', () => {
    const r = intakeBrainstorm('# Brainstorm\n## Goals\n- [ ] login works')
    expect(r.dropped).toContain('# Brainstorm')
    expect(r.dropped).toContain('## Goals')
    expect(r.converted).toBe(1)
  })

  it('produces criteria that feed the acceptance compiler', () => {
    const r = intakeBrainstorm('Given a cart, When checkout, Then the order is created within 2 seconds')
    const compiled = compileAcceptanceChecks(r.criteria)
    // "within 2 seconds" -> property (measurable threshold)
    expect(compiled.checks).toHaveLength(1)
    expect(compiled.checks[0].kind).toBe('property')
    expect(compiled.coverage).toBe(1)
  })

  it('respects a custom id prefix', () => {
    const r = intakeBrainstorm('- [ ] does a thing', { idPrefix: 'SUPER' })
    expect(r.criteria[0].id).toBe('SUPER-001')
  })
})
