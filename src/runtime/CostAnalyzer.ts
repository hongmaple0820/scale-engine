import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ModelUsageRecord, ModelUsageReport } from './ModelUsageLedger.js'
import { logger } from '../core/logger.js'

export interface CostBreakdown {
  byModel: Record<string, { tokens: number; cost: number; calls: number }>
  byTaskType: Record<string, { tokens: number; cost: number; calls: number }>
  byGate: Record<string, { tokens: number; cost: number; calls: number }>
  byDay: Record<string, { tokens: number; cost: number; calls: number }>
  /** Cost domain (`llm` by default; media writes metadata.domain='media') */
  byDomain: Record<string, { tokens: number; cost: number; calls: number; costCny: number }>
  total: { tokens: number; cost: number; calls: number; costCny: number }
}

export interface OptimizationSuggestion {
  category: 'model-downgrade' | 'cache-opportunity' | 'batch-opportunity' | 'gate-optimization'
  description: string
  estimatedMonthlySavings: number
  confidence: number // 0-1
}

export class CostAnalyzer {
  /**
   * Load all usage records from the ledger.
   */
  loadRecords(usageDir: string = join(process.cwd(), '.scale', 'model-usage')): ModelUsageRecord[] {
    if (!existsSync(usageDir)) return []
    const records: ModelUsageRecord[] = []
    try {
      for (const file of readdirSync(usageDir)) {
        if (!file.endsWith('.jsonl')) continue
        const lines = readFileSync(join(usageDir, file), 'utf-8').split('\n').filter(Boolean)
        for (const line of lines) {
          try { records.push(JSON.parse(line)) } catch {}
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to read usage records')
    }
    return records
  }

  /**
   * Analyze records into a cost breakdown.
   */
  analyze(records: ModelUsageRecord[], lookbackDays: number = 30): CostBreakdown {
    const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000
    const recent = records.filter(r => {
      const ts = r.timestamp ? new Date(r.timestamp).getTime() : 0
      return ts >= cutoff
    })

    const breakdown: CostBreakdown = {
      byModel: {},
      byTaskType: {},
      byGate: {},
      byDay: {},
      byDomain: {},
      total: { tokens: 0, cost: 0, calls: 0, costCny: 0 },
    }

    for (const r of recent) {
      const tokens = r.totalTokens
      const cost = r.estimatedCostUsd ?? (tokens / 1_000_000) * this.estimateCostPerToken(r.model ?? r.provider)
      const day = r.timestamp ? new Date(r.timestamp).toISOString().slice(0, 10) : 'unknown'
      const model = r.model ?? r.provider
      const taskType = r.taskId ?? 'uncategorized'
      const domain = typeof r.metadata?.domain === 'string' ? r.metadata.domain : 'llm'
      const costCny = typeof r.metadata?.costCny === 'number' && Number.isFinite(r.metadata.costCny) ? r.metadata.costCny : 0

      // By model
      if (!breakdown.byModel[model]) breakdown.byModel[model] = { tokens: 0, cost: 0, calls: 0 }
      breakdown.byModel[model].tokens += tokens
      breakdown.byModel[model].cost += cost
      breakdown.byModel[model].calls++

      // By task
      if (!breakdown.byTaskType[taskType]) breakdown.byTaskType[taskType] = { tokens: 0, cost: 0, calls: 0 }
      breakdown.byTaskType[taskType].tokens += tokens
      breakdown.byTaskType[taskType].cost += cost
      breakdown.byTaskType[taskType].calls++

      // By day
      if (!breakdown.byDay[day]) breakdown.byDay[day] = { tokens: 0, cost: 0, calls: 0 }
      breakdown.byDay[day].tokens += tokens
      breakdown.byDay[day].cost += cost
      breakdown.byDay[day].calls++

      if (!breakdown.byDomain[domain]) breakdown.byDomain[domain] = { tokens: 0, cost: 0, calls: 0, costCny: 0 }
      breakdown.byDomain[domain].tokens += tokens
      breakdown.byDomain[domain].cost += cost
      breakdown.byDomain[domain].calls++
      breakdown.byDomain[domain].costCny += costCny

      breakdown.total.tokens += tokens
      breakdown.total.cost += cost
      breakdown.total.calls++
      breakdown.total.costCny += costCny
    }

    return breakdown
  }

  /**
   * Generate optimization suggestions based on usage patterns.
   */
  suggestOptimizations(breakdown: CostBreakdown): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = []

    // Model downgrade suggestion: if fast tier isn't used much for gate checks
    const totalCost = breakdown.total.cost
    for (const [model, data] of Object.entries(breakdown.byModel)) {
      if (model.includes('opus') && data.cost > 2) {
        suggestions.push({
          category: 'model-downgrade',
          description: `Gate checks using ${model} (${data.calls} calls, $${data.cost.toFixed(2)}) -- consider downgrading to sonnet for non-critical gates`,
          estimatedMonthlySavings: data.cost * 0.5,
          confidence: 0.8,
        })
      }
      if (model.includes('sonnet') && data.cost > 1 && data.calls > 20) {
        suggestions.push({
          category: 'model-downgrade',
          description: `${model} used for ${data.calls} calls -- check if simpler tasks could use haiku`,
          estimatedMonthlySavings: data.cost * 0.3,
          confidence: 0.6,
        })
      }
    }

    // Cache suggestion
    if (breakdown.total.calls > 10 && breakdown.total.cost > 1) {
      const estimatedCacheableState = breakdown.total.calls * 0.25 // ~25% of gate calls are cacheable
      suggestions.push({
        category: 'cache-opportunity',
        description: `${breakdown.total.calls} total calls -- enable smart caching for gate pre-checks to save ~${Math.round(estimatedCacheableState)} calls`,
        estimatedMonthlySavings: totalCost * 0.15, // ~15% from caching
        confidence: 0.7,
      })
    }

    // Batch suggestion: many small calls could be combined
    if (breakdown.total.calls > 50) {
      suggestions.push({
        category: 'batch-opportunity',
        description: `${breakdown.total.calls} calls -- consider batching gate checks into single context windows`,
        estimatedMonthlySavings: totalCost * 0.1,
        confidence: 0.5,
      })
    }

    return suggestions
  }

  private estimateCostPerToken(model: string): number {
    if (model.includes('opus')) return 15.0
    if (model.includes('sonnet')) return 3.0
    if (model.includes('haiku')) return 0.25
    return 0.5 // default
  }

  /**
   * Generate a full ROI report with optimization opportunities.
   */
  renderReport(breakdown: CostBreakdown, suggestions: OptimizationSuggestion[]): string {
    const lines: string[] = [
      'SCALE Cost Report',
      `Total: ${breakdown.total.calls} calls, ${breakdown.total.tokens.toLocaleString()} tokens, $${breakdown.total.cost.toFixed(2)}`,
      ...(breakdown.total.costCny > 0 ? [`Media spend: ¥${breakdown.total.costCny.toFixed(2)} CNY (metadata.costCny)`] : []),
      '',
      '--- By Model ---',
      ...Object.entries(breakdown.byModel)
        .sort(([,a], [,b]) => b.cost - a.cost)
        .map(([m, d]) => `  ${m}: $${d.cost.toFixed(2)} (${d.calls} calls, ${d.tokens.toLocaleString()} tokens)`),
      '',
      '--- By Day ---',
      ...Object.entries(breakdown.byDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-14)
        .map(([day, d]) => `  ${day}: $${d.cost.toFixed(2)} (${d.calls} calls)`),
      '',
      '--- Optimization Suggestions ---',
      ...(suggestions.length > 0
        ? suggestions.map(s => `  [${s.category}] ${s.description}\n    Est. monthly savings: $${s.estimatedMonthlySavings.toFixed(2)} (confidence: ${Math.round(s.confidence * 100)}%)`)
        : ['  No optimization suggestions at this time.']),
      '',
      `Potential monthly savings: $${suggestions.reduce((sum, s) => sum + s.estimatedMonthlySavings, 0).toFixed(2)}`,
    ]
    return lines.join('\n')
  }
}
