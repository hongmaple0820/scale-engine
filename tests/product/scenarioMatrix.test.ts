import { describe, expect, it } from 'vitest'
import { buildScenarioMatrix } from '../../src/product/ScenarioMatrix.js'

describe('buildScenarioMatrix (P2-C)', () => {
  const report = buildScenarioMatrix()

  it('totals match the row count', () => {
    expect(report.summary.total).toBe(report.rows.length)
    expect(report.summary.covered + report.summary.partial + report.summary.gap).toBe(report.summary.total)
  })

  it('coding scenarios are covered by governance packs', () => {
    const coding = report.rows.filter(r => r.scenario === 'coding' && r.coverage === 'covered')
    expect(coding.length).toBeGreaterThanOrEqual(3)
    expect(coding.every(r => r.packs.length > 0)).toBe(true)
  })

  it('media and office scenarios are partial (documented gaps)', () => {
    const media = report.rows.find(r => r.scenario === 'media')
    const office = report.rows.find(r => r.scenario === 'office')
    expect(media?.coverage).toBe('partial')
    expect(office?.coverage).toBe('partial')
    expect(media?.note).toContain('content-media')
    expect(office?.note).toContain('office-automation')
  })

  it('monorepo/MOE is partial (no dedicated pack)', () => {
    const moe = report.rows.find(r => r.form.includes('MOE'))
    expect(moe?.coverage).toBe('partial')
    expect(moe?.packs).toEqual([])
  })

  it('gaps list every non-covered row', () => {
    const nonCovered = report.rows.filter(r => r.coverage !== 'covered')
    expect(report.gaps.length).toBe(nonCovered.length)
  })

  it('every row carries a label, form, and note', () => {
    for (const row of report.rows) {
      expect(row.scenarioLabel.length).toBeGreaterThan(0)
      expect(row.form.length).toBeGreaterThan(0)
      expect(row.note.length).toBeGreaterThan(0)
    }
  })
})
