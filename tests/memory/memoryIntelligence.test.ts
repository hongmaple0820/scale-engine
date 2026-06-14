// Tests for MemoryIntelligence — quality scoring, conflict detection, freshness decay

import { describe, it, expect } from 'vitest'
import {
  scoreMemoryQuality,
  detectMemoryConflicts,
  applyFreshnessDecay,
  summarizeMemoryIntelligence,
} from '../../src/memory/MemoryIntelligence.js'
import type { MemoryProviderRecallItem } from '../../src/memory/MemoryProviders.js'

function makeItem(overrides: Partial<MemoryProviderRecallItem> = {}): MemoryProviderRecallItem {
  return {
    provider: 'gbrain',
    id: 'item-1',
    title: 'Test Item',
    summary: 'A test memory item',
    confidence: 0.8,
    score: 0.7,
    evidencePaths: ['/path/to/evidence'],
    metadata: {},
    ...overrides,
  }
}

describe('scoreMemoryQuality', () => {
  it('returns zero-score report for empty items', () => {
    const report = scoreMemoryQuality({ items: [] })
    expect(report.totalRecalled).toBe(0)
    expect(report.qualityScore.overall).toBe(0)
    expect(report.qualityScore.warnings).toContain('No memory items recalled.')
    expect(report.recommendations.length).toBeGreaterThan(0)
  })

  it('scores high-quality items with high overall', () => {
    const items = [
      makeItem({ confidence: 0.9, score: 0.85, evidencePaths: ['/ev1'] }),
      makeItem({ id: 'item-2', confidence: 0.95, score: 0.9, evidencePaths: ['/ev2'] }),
    ]
    const report = scoreMemoryQuality({ items })
    expect(report.qualityScore.overall).toBeGreaterThan(0.6)
    expect(report.qualityScore.signals.confidence).toBeGreaterThan(0.8)
    expect(report.qualityScore.signals['cross-provider']).toBe(1) // governed gbrain route present
    expect(report.qualityScore.signals['evidence-backed']).toBe(1) // all have evidence
  })

  it('scores low-confidence items with low overall', () => {
    const items = [
      makeItem({ confidence: 0.2, score: 0.1, evidencePaths: [] }),
      makeItem({ id: 'item-2', confidence: 0.3, score: 0.2, evidencePaths: [] }),
    ]
    const report = scoreMemoryQuality({ items })
    expect(report.qualityScore.overall).toBeLessThan(0.5)
    expect(report.qualityScore.warnings.length).toBeGreaterThan(0)
  })

  it('penalizes expired items in freshness score', () => {
    const oldDate = new Date(Date.now() - 200 * 60 * 60 * 1000).toISOString() // 200 hours ago
    const items = [
      makeItem({ metadata: { createdAt: oldDate } }),
      makeItem({ id: 'item-2', metadata: { createdAt: new Date().toISOString() } }),
    ]
    const report = scoreMemoryQuality({ items, maxAge: 168 })
    expect(report.freshnessDistribution.expired).toBe(1)
    expect(report.freshnessDistribution.fresh).toBe(1)
    expect(report.qualityScore.signals.freshness).toBeLessThan(1)
  })

  it('groups provider breakdown correctly', () => {
    const items = [
      makeItem(),
      makeItem({ id: 'item-2' }),
      makeItem({ id: 'item-3' }),
    ]
    const report = scoreMemoryQuality({ items })
    expect(report.providerBreakdown['gbrain'].count).toBe(3)
  })
})

describe('detectMemoryConflicts', () => {
  it('returns empty conflicts for non-overlapping items', () => {
    const items = [
      makeItem({ title: 'Topic A', summary: 'About A' }),
      makeItem({ title: 'Topic B', id: 'item-2', summary: 'About B' }),
    ]
    const conflicts = detectMemoryConflicts(items)
    expect(conflicts).toEqual([])
  })

  it('detects conflict when same topic has different summaries', () => {
    const items = [
      makeItem({ title: 'Auth Config', summary: 'Use JWT tokens' }),
      makeItem({ title: 'Auth Config', id: 'item-2', summary: 'Use session cookies', provider: 'gbrain' }),
    ]
    const conflicts = detectMemoryConflicts(items)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].topic).toBe('authconfig')
    expect(conflicts[0].items).toHaveLength(2)
    expect(conflicts[0].resolution).toBeDefined()
  })

  it('does not conflict when same topic has same summary', () => {
    const items = [
      makeItem({ title: 'Auth Config', summary: 'Use JWT' }),
      makeItem({ title: 'Auth Config', id: 'item-2', summary: 'Use JWT', provider: 'gbrain' }),
    ]
    const conflicts = detectMemoryConflicts(items)
    expect(conflicts).toHaveLength(0)
  })

  it('resolves by highest confidence when confidences differ', () => {
    const items = [
      makeItem({ title: 'Deploy', summary: 'Deploy to prod', confidence: 0.9 }),
      makeItem({ title: 'Deploy', id: 'item-2', summary: 'Deploy to staging', confidence: 0.5, provider: 'gbrain' }),
    ]
    const conflicts = detectMemoryConflicts(items)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].resolution).toBe('highest-confidence')
    expect(conflicts[0].resolvedSummary).toBe('Deploy to prod')
  })
})

describe('applyFreshnessDecay', () => {
  it('does not decay fresh items', () => {
    const items = [makeItem({ metadata: { createdAt: new Date().toISOString() } })]
    const decayed = applyFreshnessDecay(items, 168)
    expect(decayed[0].confidence).toBe(items[0].confidence)
  })

  it('decays stale items (past half maxAge) by 0.7x', () => {
    const staleDate = new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString() // 100 hours
    const items = [makeItem({ metadata: { createdAt: staleDate } })]
    const decayed = applyFreshnessDecay(items, 168)
    expect(decayed[0].confidence).toBeCloseTo(items[0].confidence * 0.7, 1)
  })

  it('decays expired items (past maxAge) by 0.3x', () => {
    const expiredDate = new Date(Date.now() - 200 * 60 * 60 * 1000).toISOString() // 200 hours
    const items = [makeItem({ metadata: { createdAt: expiredDate } })]
    const decayed = applyFreshnessDecay(items, 168)
    expect(decayed[0].confidence).toBeCloseTo(items[0].confidence * 0.3, 1)
  })

  it('leaves items without timestamp unchanged', () => {
    const items = [makeItem({ metadata: {} })]
    const decayed = applyFreshnessDecay(items, 168)
    expect(decayed[0].confidence).toBe(items[0].confidence)
  })
})

describe('summarizeMemoryIntelligence', () => {
  it('produces readable report', () => {
    const items = [
      makeItem({ confidence: 0.9, score: 0.85 }),
      makeItem({ provider: 'gbrain', id: 'item-2', confidence: 0.8, score: 0.75 }),
    ]
    const report = scoreMemoryQuality({ items })
    const text = summarizeMemoryIntelligence(report)
    expect(text).toContain('Memory Intelligence Report')
    expect(text).toContain('Total Recalled')
    expect(text).toContain('Quality Score')
    expect(text).toContain('Quality Signals')
    expect(text).toContain('Freshness')
  })
})
