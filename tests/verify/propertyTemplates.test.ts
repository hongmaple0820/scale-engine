import { describe, expect, it } from 'vitest'
import { generatePropertyTemplate, generatePropertyTemplates } from '../../src/verify/PropertyTemplates.js'
import type { AcceptanceCheck } from '../../src/spec/AcceptanceCompiler.js'

const propCheck: AcceptanceCheck = {
  checkId: 'CHK-PERF-010',
  clauseId: 'PERF-010',
  clauseText: 'The endpoint SHALL respond within 200 ms at p95',
  kind: 'property',
  needsHuman: false,
  rationale: 'measurable',
}
const cmdCheck: AcceptanceCheck = {
  checkId: 'CHK-A-1', clauseId: 'A-1', clauseText: 'WHEN x THEN SHALL return 200', kind: 'command', needsHuman: false, rationale: 'behavioral',
}

describe('generatePropertyTemplate (P4-D)', () => {
  it('returns null for non-property checks', () => {
    expect(generatePropertyTemplate(cmdCheck)).toBeNull()
  })

  it('generates a fast-check template by default', () => {
    const t = generatePropertyTemplate(propCheck)
    expect(t?.framework).toBe('fast-check')
    expect(t?.template).toContain('fc.')
    expect(t?.template).toContain('CHK-PERF-010')
  })

  it('generates a vitest template when requested', () => {
    const t = generatePropertyTemplate(propCheck, { framework: 'vitest' })
    expect(t?.framework).toBe('vitest')
    expect(t?.template).toContain('expect(')
  })

  it('filters templates to property checks only', () => {
    const list = generatePropertyTemplates([propCheck, cmdCheck])
    expect(list).toHaveLength(1)
    expect(list[0].checkId).toBe('CHK-PERF-010')
  })
})
