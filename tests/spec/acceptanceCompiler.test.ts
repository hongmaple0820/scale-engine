import { describe, expect, it } from 'vitest'
import {
  compileAcceptanceChecks,
  compileFromSuccessCriteria,
  type AcceptanceCriterionInput,
} from '../../src/spec/AcceptanceCompiler.js'

describe('compileAcceptanceChecks (P1-B)', () => {
  it('compiles EARS event/error criteria into command checks', () => {
    const criteria: AcceptanceCriterionInput[] = [
      { id: 'FR-AUTH-001', text: 'WHEN a valid OAuth state is presented THEN the system SHALL return 200', kind: 'event' },
      { id: 'FR-AUTH-002', text: 'IF the OAuth state is expired THEN the system SHALL reject with 401', kind: 'error' },
    ]
    const r = compileAcceptanceChecks(criteria)
    expect(r.checks.every(c => c.kind === 'command' && !c.needsHuman)).toBe(true)
    expect(r.checks[0].commandTemplate).toContain('--grep "CHK-FR-AUTH-001"')
    expect(r.summary.automatable).toBe(2)
    expect(r.coverage).toBe(1)
  })

  it('compiles measurable thresholds into property checks', () => {
    const r = compileAcceptanceChecks([
      { id: 'FR-PERF-010', text: 'The endpoint SHALL respond within 200 ms at p95', kind: 'ubiquitous' },
    ])
    expect(r.checks[0].kind).toBe('property')
    expect(r.checks[0].needsHuman).toBe(false)
    expect(r.checks[0].commandTemplate).toContain('property assertion required')
  })

  it('downgrades subjective wording to needsHuman checklist', () => {
    const r = compileAcceptanceChecks([
      { id: 'FR-UX-001', text: 'The interface SHALL be user-friendly and intuitive', kind: 'ubiquitous' },
    ])
    expect(r.checks[0].kind).toBe('checklist')
    expect(r.checks[0].needsHuman).toBe(true)
    expect(r.checks[0].commandTemplate).toBeUndefined()
    expect(r.coverage).toBe(0)
  })

  it('falls back to needsHuman when no observable outcome exists', () => {
    const r = compileAcceptanceChecks([
      { id: 'AC-1', text: 'The system SHALL be well architected' },
    ])
    expect(r.checks[0].needsHuman).toBe(true)
    expect(r.checks[0].rationale).toContain('human checklist')
  })

  it('builds bidirectional traceability clause <-> check ids', () => {
    const r = compileAcceptanceChecks([
      { id: 'FR-X-001', text: 'WHEN saved THEN SHALL persist', kind: 'event' },
      { id: 'FR-X-001', text: 'WHEN read THEN SHALL return stored value', kind: 'event' },
    ])
    expect(r.traceability).toHaveLength(1)
    expect(r.traceability[0].clauseId).toBe('FR-X-001')
    expect(r.traceability[0].checkIds).toEqual(['CHK-FR-X-001', 'CHK-FR-X-001-2'])
    expect(r.summary.total).toBe(2)
  })

  it('reports byKind and coverage for a mixed spec', () => {
    const r = compileAcceptanceChecks([
      { id: 'A-1', text: 'WHEN login THEN SHALL return token', kind: 'event' },
      { id: 'A-2', text: 'SHALL respond within 50 ms', kind: 'ubiquitous' },
      { id: 'A-3', text: 'SHALL be intuitive', kind: 'ubiquitous' },
    ])
    expect(r.summary.byKind).toEqual({ command: 1, property: 1, checklist: 1 })
    expect(r.summary.automatable).toBe(2)
    expect(r.summary.needsHuman).toBe(1)
    expect(r.coverage).toBeCloseTo(0.667, 3)
  })

  it('handles empty input', () => {
    const r = compileAcceptanceChecks([])
    expect(r.checks).toHaveLength(0)
    expect(r.coverage).toBe(0)
    expect(r.traceability).toHaveLength(0)
  })

  it('honors a custom test runner prefix', () => {
    const r = compileAcceptanceChecks(
      [{ id: 'FR-R-001', text: 'WHEN called THEN SHALL return 200', kind: 'event' }],
      { testRunner: 'pnpm vitest run --' },
    )
    expect(r.checks[0].commandTemplate).toMatch(/^pnpm vitest run -- --grep/)
  })
})

describe('compileFromSuccessCriteria', () => {
  it('parses "ID: text" and bare lines', () => {
    const r = compileFromSuccessCriteria([
      'FR-AUTH-001: WHEN valid THEN SHALL return 200',
      'The page SHALL be intuitive',
    ])
    expect(r.checks).toHaveLength(2)
    expect(r.checks[0].clauseId).toBe('FR-AUTH-001')
    expect(r.checks[0].kind).toBe('command')
    expect(r.checks[1].clauseId).toBe('AC-2')
    expect(r.checks[1].needsHuman).toBe(true)
  })
})
