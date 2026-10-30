// ADR-8: media spend is recorded in the one ModelUsageLedger under
// metadata.domain='media' / metadata.costCny — never in a second cost ledger.
// CostAnalyzer must surface it per domain and in the CNY total.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { CostAnalyzer } from '../../src/runtime/CostAnalyzer.js'
import { ModelUsageLedger } from '../../src/runtime/ModelUsageLedger.js'

const root = mkdtempSync(join(tmpdir(), 'media-cost-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('CostAnalyzer media aggregation (ADR-8)', () => {
  it('aggregates media spend by domain without a second ledger', () => {
    const scaleDir = join(root, '.scale')
    const ledger = new ModelUsageLedger(scaleDir)
    ledger.record({
      provider: 'scale-media',
      taskId: 'job-media-1',
      metadata: { domain: 'media', costCny: 1.25, jobType: 'generate_image', costStatus: 'actual' },
    })
    ledger.record({
      provider: 'scale-media',
      taskId: 'job-media-2',
      metadata: { domain: 'media', costCny: 0, jobType: 'generate_video', costStatus: 'actual' },
    })
    ledger.record({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      taskId: 'job-llm-1',
      inputTokens: 1000,
      outputTokens: 500,
      estimatedCostUsd: 0.01,
    })

    const analyzer = new CostAnalyzer()
    const breakdown = analyzer.analyze(analyzer.loadRecords(join(scaleDir, 'model-usage')))

    expect(breakdown.byDomain.media).toMatchObject({ calls: 2, costCny: 1.25 })
    expect(breakdown.byDomain.llm.calls).toBe(1)
    expect(breakdown.total.costCny).toBe(1.25)

    const report = analyzer.renderReport(breakdown, [])
    expect(report).toContain('Media spend: ¥1.25 CNY')

    // Media records carry CNY only: no invented USD estimate.
    const mediaRecords = ledger.list({}).filter(record => record.metadata?.domain === 'media')
    expect(mediaRecords).toHaveLength(2)
    expect(mediaRecords.every(record => !record.estimatedCostUsd)).toBe(true)
  })
})
