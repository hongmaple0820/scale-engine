// SCALE Engine — Memory Intelligence (v0.35.0)
// Unified memory retrieval quality engine with governed-provider scoring, conflict detection, freshness management

import type { MemoryProviderRecallItem } from './MemoryProviders.js'

export type MemoryQualitySignal = 'confidence' | 'relevance' | 'freshness' | 'evidence-backed' | 'cross-provider' | 'no-contradiction'

export interface MemoryQualityScore {
  overall: number          // 0-1
  signals: Record<MemoryQualitySignal, number>
  warnings: string[]
}

export interface MemoryConflict {
  topic: string
  items: Array<{ provider: string; id: string; summary: string; confidence: number }>
  resolution: 'newest-wins' | 'highest-confidence' | 'manual-review'
  resolvedSummary?: string
}

export interface MemoryIntelligenceReport {
  totalRecalled: number
  qualityScore: MemoryQualityScore
  conflicts: MemoryConflict[]
  freshnessDistribution: { fresh: number; stale: number; expired: number }
  providerBreakdown: Record<string, { count: number; avgQuality: number }>
  recommendations: string[]
}

export interface MemoryIntelligenceInput {
  items: MemoryProviderRecallItem[]
  task?: string
  maxAge?: number  // hours, default 168 (7 days)
}

export function scoreMemoryQuality(input: MemoryIntelligenceInput): MemoryIntelligenceReport {
  const { items, maxAge = 168 } = input
  if (items.length === 0) {
    return {
      totalRecalled: 0,
      qualityScore: {
        overall: 0,
        signals: {
          confidence: 0,
          relevance: 0,
          freshness: 0,
          'evidence-backed': 0,
          'cross-provider': 0,
          'no-contradiction': 0,
        },
        warnings: ['No memory items recalled.'],
      },
      conflicts: [],
      freshnessDistribution: { fresh: 0, stale: 0, expired: 0 },
      providerBreakdown: {},
      recommendations: ['Increase memory provider coverage or relax recall filters.'],
    }
  }

  const conflicts = detectMemoryConflicts(items)
  const freshness = classifyFreshness(items, maxAge)
  const providers = groupByProvider(items)

  const confidenceScore = avg(items.map(i => i.confidence))
  const relevanceScore = avg(items.map(i => i.score))
  const freshnessScore = (freshness.fresh * 1.0 + freshness.stale * 0.5) / items.length
  const evidenceScore = items.filter(i => i.evidencePaths.length > 0).length / items.length
  const governedProviderScore = items.some(item => item.provider === 'gbrain') ? 1 : 0
  const contradictionScore = conflicts.length === 0 ? 1 : Math.max(0, 1 - conflicts.length * 0.2)

  const signals: Record<MemoryQualitySignal, number> = {
    confidence: round(confidenceScore),
    relevance: round(relevanceScore),
    freshness: round(freshnessScore),
    'evidence-backed': round(evidenceScore),
    'cross-provider': round(governedProviderScore),
    'no-contradiction': round(contradictionScore),
  }

  const overall = round(
    confidenceScore * 0.25 +
    relevanceScore * 0.25 +
    freshnessScore * 0.2 +
    evidenceScore * 0.15 +
    governedProviderScore * 0.05 +
    contradictionScore * 0.1,
  )

  const warnings: string[] = []
  if (confidenceScore < 0.5) warnings.push('Average memory confidence is low.')
  if (freshness.expired > 0) warnings.push(`${freshness.expired} expired memory item(s) detected.`)
  if (conflicts.length > 0) warnings.push(`${conflicts.length} memory conflict(s) detected.`)
  if (evidenceScore < 0.3) warnings.push('Most memory items lack evidence paths.')

  const recommendations: string[] = []
  if (overall < 0.5) recommendations.push('Improve memory provider quality or add more evidence-backed memories.')
  if (freshness.expired > items.length * 0.3) recommendations.push('Prune expired memories to improve recall quality.')
  if (conflicts.length > 0) recommendations.push('Resolve memory contradictions to prevent conflicting guidance.')
  if (governedProviderScore < 1) recommendations.push('Route recall through gbrain before claiming governed memory readiness.')

  return {
    totalRecalled: items.length,
    qualityScore: { overall, signals, warnings },
    conflicts,
    freshnessDistribution: freshness,
    providerBreakdown: providers,
    recommendations,
  }
}

export function detectMemoryConflicts(items: MemoryProviderRecallItem[]): MemoryConflict[] {
  const conflicts: MemoryConflict[] = []
  const byTitle = new Map<string, MemoryProviderRecallItem[]>()

  for (const item of items) {
    const key = normalizeTopic(item.title)
    const group = byTitle.get(key) ?? []
    group.push(item)
    byTitle.set(key, group)
  }

  for (const [topic, group] of byTitle) {
    if (group.length < 2) continue

    // Check if summaries differ significantly
    const summaries = group.map(i => normalizeTopic(i.summary))
    const allSame = summaries.every(s => s === summaries[0])
    if (allSame) continue

    const resolution = group.every(i => i.confidence === group[0].confidence)
      ? 'newest-wins'
      : 'highest-confidence'

    const resolved = resolution === 'highest-confidence'
      ? group.reduce((best, curr) => curr.confidence > best.confidence ? curr : best)
      : group[group.length - 1]

    conflicts.push({
      topic,
      items: group.map(i => ({
        provider: i.provider,
        id: i.id,
        summary: i.summary,
        confidence: i.confidence,
      })),
      resolution,
      resolvedSummary: resolved.summary,
    })
  }

  return conflicts
}

export function applyFreshnessDecay(items: MemoryProviderRecallItem[], maxAgeHours = 168): MemoryProviderRecallItem[] {
  return items.map(item => {
    const age = getItemAgeHours(item)
    if (age === undefined) return item
    if (age > maxAgeHours) {
      return { ...item, confidence: item.confidence * 0.3, score: item.score * 0.3 }
    }
    if (age > maxAgeHours / 2) {
      return { ...item, confidence: item.confidence * 0.7, score: item.score * 0.7 }
    }
    return item
  })
}

export function summarizeMemoryIntelligence(report: MemoryIntelligenceReport): string {
  const lines: string[] = [
    `## Memory Intelligence Report`,
    '',
    `**Total Recalled:** ${report.totalRecalled}`,
    `**Quality Score:** ${(report.qualityScore.overall * 100).toFixed(0)}%`,
    '',
    '### Quality Signals',
  ]

  for (const [signal, score] of Object.entries(report.qualityScore.signals)) {
    lines.push(`- ${signal}: ${(score * 100).toFixed(0)}%`)
  }

  if (report.qualityScore.warnings.length > 0) {
    lines.push('', '### Warnings')
    for (const w of report.qualityScore.warnings) lines.push(`- ${w}`)
  }

  if (report.conflicts.length > 0) {
    lines.push('', `### Conflicts (${report.conflicts.length})`)
    for (const c of report.conflicts) {
      lines.push(`- **${c.topic}**: ${c.items.length} items, resolution: ${c.resolution}`)
    }
  }

  lines.push('', '### Freshness')
  lines.push(`- Fresh: ${report.freshnessDistribution.fresh}`)
  lines.push(`- Stale: ${report.freshnessDistribution.stale}`)
  lines.push(`- Expired: ${report.freshnessDistribution.expired}`)

  if (report.recommendations.length > 0) {
    lines.push('', '### Recommendations')
    for (const r of report.recommendations) lines.push(`- ${r}`)
  }

  return lines.join('\n')
}

function classifyFreshness(items: MemoryProviderRecallItem[], maxAgeHours: number): { fresh: number; stale: number; expired: number } {
  let fresh = 0, stale = 0, expired = 0
  for (const item of items) {
    const age = getItemAgeHours(item)
    if (age === undefined) { fresh++; continue }
    if (age > maxAgeHours) expired++
    else if (age > maxAgeHours / 2) stale++
    else fresh++
  }
  return { fresh, stale, expired }
}

function groupByProvider(items: MemoryProviderRecallItem[]): Record<string, { count: number; avgQuality: number }> {
  const groups = new Map<string, MemoryProviderRecallItem[]>()
  for (const item of items) {
    const group = groups.get(item.provider) ?? []
    group.push(item)
    groups.set(item.provider, group)
  }
  const result: Record<string, { count: number; avgQuality: number }> = {}
  for (const [provider, group] of groups) {
    result[provider] = {
      count: group.length,
      avgQuality: round(avg(group.map(i => (i.confidence + i.score) / 2))),
    }
  }
  return result
}

function getItemAgeHours(item: MemoryProviderRecallItem): number | undefined {
  const ts = item.metadata?.createdAt ?? item.metadata?.timestamp
  if (typeof ts !== 'string') return undefined
  const date = new Date(ts)
  if (isNaN(date.getTime())) return undefined
  return (Date.now() - date.getTime()) / (1000 * 60 * 60)
}

function normalizeTopic(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50)
}

function avg(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
