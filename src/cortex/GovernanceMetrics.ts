// SCALE Cortex — Governance ROI Metrics
// 对齐 ECC: multi-hook governance ROI measurement
// Tracks: gate pass rates, token costs, instinct hit rate, auto-fix success, savings

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../core/logger.js'
import type { Instinct } from './InstinctExtractor.js'
import {
  loadInstinctRuntimeEvidence,
  type InstinctRuntimeEvidence,
  type InstinctRuntimeEvidenceSummary,
} from './InstinctRuntimeEvidence.js'
import { dedupeCortexObservations, loadGateEvidenceObservations } from './GateEvidenceObservations.js'
import { loadAutoFixEventObservations } from './AutoFixEventObservations.js'

export interface GovernanceMetrics {
  // Gate metrics
  gates: {
    totalRuns: number
    passRate: number
    failRate: number
    avgDurationMs: number
    byGate: Record<string, { runs: number; passed: number; avgTokens: number }>
  }
  // Instinct metrics
  instincts: {
    totalExtracted: number
    totalInjected: number
    totalApplied: number
    hitRate: number
    byConfidence: Record<string, { count: number; hitRate: number }>
    runtimeEvidence?: InstinctRuntimeEvidenceSummary
  }
  // Cost metrics
  cost: {
    totalTokens: number
    totalCost: number
    avgTokensPerGate: number
    estimatedSavingsFromCaching: number
    estimatedSavingsFromInstincts: number
  }
  // Auto-fix metrics
  autoFix: {
    totalAttempts: number
    successRate: number
    avgAttemptsPerFix: number
    totalTimeSavedMinutes: number
  }
  // Trends (last 7 days vs previous 7 days)
  trends: {
    passRateDelta: number
    costDelta: number
    instinctHitRateDelta: number
  }
  period: { start: string; end: string }
}

interface GovernanceObservation {
  timestamp: string
  sessionId?: string
  gateName?: string
  gateStatus?: string
  durationMs?: number
  tokensUsed?: number
  estimatedCostUsd?: number
}

// ---------------------------------------------------------------------------
// GovernanceMetricsCalculator
// ---------------------------------------------------------------------------

export class GovernanceMetricsCalculator {
  private scaleDir: string

  constructor(scaleDir: string = join(process.cwd(), '.scale')) {
    this.scaleDir = scaleDir
  }

  /**
   * Compute full governance metrics from observation logs and instinct store.
   */
  compute(instincts: Instinct[], lookbackDays: number = 30): GovernanceMetrics {
    const observations = this.loadObservations(lookbackDays)
    const prevObservations = this.loadObservationsRange(lookbackDays, lookbackDays * 2)

    // Gates
    const gateMetrics = this.computeGateMetrics(observations)

    // Instincts
    const instinctMetrics = this.computeInstinctMetrics(instincts, loadInstinctRuntimeEvidence(this.scaleDir, lookbackDays))

    // Cost
    const cost = this.computeCostMetrics(observations, instinctMetrics)

    // Auto-fix
    const autoFix = this.computeAutoFixMetrics(observations)

    // Trends
    const trends = this.computeTrends(observations, prevObservations, instinctMetrics)

    return {
      gates: gateMetrics,
      instincts: instinctMetrics,
      cost,
      autoFix,
      trends,
      period: {
        start: new Date(Date.now() - lookbackDays * 86400000).toISOString().slice(0, 10),
        end: new Date().toISOString().slice(0, 10),
      },
    }
  }

  /**
   * Render metrics as a terminal report.
   */
  render(metrics: GovernanceMetrics): string {
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`
    const usd = (n: number) => `$${n.toFixed(2)}`

    return [
      'SCALE Cortex — Governance ROI Report',
      `Period: ${metrics.period.start} → ${metrics.period.end}`,
      '',
      '═══ Gate Performance ═══',
      `  Total runs:    ${metrics.gates.totalRuns}`,
      `  Pass rate:     ${pct(metrics.gates.passRate)}`,
      `  Fail rate:     ${pct(metrics.gates.failRate)}`,
      `  Avg duration:  ${metrics.gates.avgDurationMs}ms`,
      '',
      '═══ Instinct Performance ═══',
      `  Extracted:     ${metrics.instincts.totalExtracted}`,
      `  Injected:      ${metrics.instincts.totalInjected}`,
      `  Applied:       ${metrics.instincts.totalApplied}`,
      `  Hit rate:      ${pct(metrics.instincts.hitRate)}`,
      '',
      '═══ Cost Analysis ═══',
      `  Total tokens:  ${metrics.cost.totalTokens.toLocaleString()}`,
      `  Total cost:    ${usd(metrics.cost.totalCost)}`,
      `  Avg token/gate: ${Math.round(metrics.cost.avgTokensPerGate).toLocaleString()}`,
      `  Saved (cache):  ${usd(metrics.cost.estimatedSavingsFromCaching)}`,
      `  Saved (instinct): ${usd(metrics.cost.estimatedSavingsFromInstincts)}`,
      '',
      '═══ Auto-Fix ═══',
      `  Attempts:      ${metrics.autoFix.totalAttempts}`,
      `  Success rate:  ${pct(metrics.autoFix.successRate)}`,
      `  Avg attempts:  ${metrics.autoFix.avgAttemptsPerFix.toFixed(1)}`,
      `  Time saved:    ${metrics.autoFix.totalTimeSavedMinutes} min`,
      '',
      '═══ Trends (△ vs previous period) ═══',
      `  Pass rate:     ${metrics.trends.passRateDelta > 0 ? '+' : ''}${pct(metrics.trends.passRateDelta)}`,
      `  Cost:          ${metrics.trends.costDelta > 0 ? '+' : ''}${usd(metrics.trends.costDelta)}`,
      `  Instinct hit:  ${metrics.trends.instinctHitRateDelta > 0 ? '+' : ''}${pct(metrics.trends.instinctHitRateDelta)}`,
      '',
      `ROI Score: ${this.computeROIScore(metrics)}/100`,
    ].join('\n')
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private loadObservations(lookbackDays: number): GovernanceObservation[] {
    return this.loadObservationsRange(0, lookbackDays)
  }

  private loadObservationsRange(startDaysAgo: number, endDaysAgo: number): GovernanceObservation[] {
    const obsDir = join(this.scaleDir, 'observations')
    const start = Date.now() - endDaysAgo * 86400000
    const end = Date.now() - startDaysAgo * 86400000

    const results: GovernanceObservation[] = []
    if (existsSync(obsDir)) {
      try {
        for (const file of readdirSync(obsDir)) {
          if (!file.endsWith('.jsonl')) continue
          const lines = readFileSync(join(obsDir, file), 'utf-8').split('\n').filter(Boolean)
          for (const [index, line] of lines.entries()) {
            try {
              const obs = parseGovernanceObservation(JSON.parse(line))
              if (!obs) {
                logger.debug({ file, lineNumber: index + 1 }, 'Skipped malformed observation line')
                continue
              }
              const ts = new Date(obs.timestamp).getTime()
              if (Number.isFinite(ts) && ts >= start && ts < end) results.push(obs)
            } catch (err) {
              logger.debug({ err, file, lineNumber: index + 1 }, 'Skipped malformed observation line')
            }
          }
        }
      } catch (err) { logger.warn({ err }, 'Failed to load observations') }
    }

    for (const obs of loadGateEvidenceObservations(this.scaleDir)) {
      const ts = new Date(obs.timestamp).getTime()
      if (Number.isFinite(ts) && ts >= start && ts < end) results.push(obs)
    }

    for (const obs of loadAutoFixEventObservations(this.scaleDir)) {
      const ts = new Date(obs.timestamp).getTime()
      if (Number.isFinite(ts) && ts >= start && ts < end) results.push(obs)
    }

    return dedupeCortexObservations(results)
  }

  private computeGateMetrics(observations: GovernanceObservation[]): GovernanceMetrics['gates'] {
    const byGate: Record<string, { runs: number; passed: number; avgTokens: number }> = {}
    let totalRuns = 0
    let totalPassed = 0
    let totalDuration = 0

    for (const obs of observations) {
      totalRuns++
      if (obs.gateStatus === 'PASS') totalPassed++

      if (obs.gateName) {
        if (!byGate[obs.gateName]) byGate[obs.gateName] = { runs: 0, passed: 0, avgTokens: 0 }
        byGate[obs.gateName].runs++
        if (obs.gateStatus === 'PASS') byGate[obs.gateName].passed++
        byGate[obs.gateName].avgTokens += obs.tokensUsed ?? 0
      }
      totalDuration += obs.durationMs ?? 0
    }

    // Finalize averages
    for (const gate of Object.values(byGate)) {
      gate.avgTokens = gate.runs > 0 ? Math.round(gate.avgTokens / gate.runs) : 0
    }

    return {
      totalRuns,
      passRate: totalRuns > 0 ? totalPassed / totalRuns : 0,
      failRate: totalRuns > 0 ? (totalRuns - totalPassed) / totalRuns : 0,
      avgDurationMs: totalRuns > 0 ? Math.round(totalDuration / totalRuns) : 0,
      byGate,
    }
  }

  private computeInstinctMetrics(
    instincts: Instinct[],
    runtimeEvidence: InstinctRuntimeEvidence,
  ): GovernanceMetrics['instincts'] {
    const byConfidence: Record<string, { count: number; hitRate: number }> = {
      'near-certain (0.9)': { count: 0, hitRate: 0 },
      'strong (0.7)': { count: 0, hitRate: 0 },
      'moderate (0.5)': { count: 0, hitRate: 0 },
      'tentative (0.3)': { count: 0, hitRate: 0 },
    }
    const runtimeBuckets: Record<string, { denominator: number; successes: number }> = {}

    for (const i of instincts) {
      const bucket = i.confidence >= 0.9 ? 'near-certain (0.9)' :
        i.confidence >= 0.7 ? 'strong (0.7)' :
        i.confidence >= 0.5 ? 'moderate (0.5)' : 'tentative (0.3)'
      byConfidence[bucket].count++
      if (!runtimeBuckets[bucket]) runtimeBuckets[bucket] = { denominator: 0, successes: 0 }
      if (runtimeEvidence.summary.source === 'session-and-audit') {
        runtimeBuckets[bucket].denominator += Math.max(
          runtimeEvidence.injectionEventsById.get(i.id) ?? 0,
          runtimeEvidence.applicationEventsById.get(i.id) ?? 0,
        )
        runtimeBuckets[bucket].successes += runtimeEvidence.successfulApplicationsById.get(i.id) ?? 0
      } else if (runtimeEvidence.summary.source === 'session') {
        runtimeBuckets[bucket].denominator += runtimeEvidence.injectionEventsById.get(i.id) ?? 0
        runtimeBuckets[bucket].successes += runtimeEvidence.successfulApplicationsById.get(i.id) ?? 0
      } else if (runtimeEvidence.summary.source === 'audit') {
        runtimeBuckets[bucket].denominator += runtimeEvidence.applicationEventsById.get(i.id) ?? 0
        runtimeBuckets[bucket].successes += runtimeEvidence.successfulApplicationsById.get(i.id) ?? 0
      } else {
        byConfidence[bucket].hitRate += i.hitRate
      }
    }

    for (const [bucketName, bucket] of Object.entries(byConfidence)) {
      const runtimeBucket = runtimeBuckets[bucketName]
      if (runtimeEvidence.summary.source === 'session' || runtimeEvidence.summary.source === 'session-and-audit' || runtimeEvidence.summary.source === 'audit') {
        bucket.hitRate = runtimeBucket && runtimeBucket.denominator > 0
          ? clampRatio(runtimeBucket.successes / runtimeBucket.denominator)
          : 0
      } else {
        bucket.hitRate = bucket.count > 0 ? bucket.hitRate / bucket.count : 0
      }
    }

    if (runtimeEvidence.summary.source !== 'none' && runtimeEvidence.summary.source !== 'legacy') {
      const denominator = runtimeEvidence.summary.source === 'audit'
        ? runtimeEvidence.summary.applicationEvents
        : runtimeEvidence.summary.source === 'session-and-audit'
          ? Math.max(runtimeEvidence.summary.injectionEvents, runtimeEvidence.summary.applicationEvents)
          : runtimeEvidence.summary.injectionEvents
      return {
        totalExtracted: instincts.length,
        totalInjected: denominator,
        totalApplied: runtimeEvidence.summary.successfulApplications,
        hitRate: denominator > 0 ? clampRatio(runtimeEvidence.summary.successfulApplications / denominator) : 0,
        byConfidence,
        runtimeEvidence: runtimeEvidence.summary,
      }
    }

    const totalApplied = instincts.reduce((sum, i) => sum + i.appliedCount, 0)
    const totalObs = instincts.reduce((sum, i) => sum + i.observations, 0)
    const hasLegacyCounters = instincts.some(i => i.appliedCount > 0 || i.hitRate > 0)

    return {
      totalExtracted: instincts.length,
      totalInjected: instincts.filter(i => i.confidence >= 0.7).length,
      totalApplied,
      hitRate: totalObs > 0 ? totalApplied / totalObs : 0,
      byConfidence,
      runtimeEvidence: {
        source: hasLegacyCounters ? 'legacy' : 'none',
        injectionEvents: 0,
        applicationEvents: 0,
        successfulApplications: 0,
      },
    }
  }

  private computeCostMetrics(
    observations: GovernanceObservation[],
    _instinctMetrics: GovernanceMetrics['instincts'],
  ): GovernanceMetrics['cost'] {
    const totalTokens = observations.reduce((sum, o) => sum + (o.tokensUsed ?? 0), 0)
    const totalCost = observations.reduce((sum, o) => sum + (o.estimatedCostUsd ?? 0), 0)

    return {
      totalTokens,
      totalCost,
      avgTokensPerGate: observations.length > 0 ? totalTokens / observations.length : 0,
      estimatedSavingsFromCaching: totalCost * 0.15,   // ~15% from caching
      estimatedSavingsFromInstincts: totalCost * 0.10,  // ~10% from instinct prevention
    }
  }

  private computeAutoFixMetrics(observations: GovernanceObservation[]): GovernanceMetrics['autoFix'] {
    const autoFixObs = observations.filter(o => o.gateName?.includes('auto-fix'))
    const successes = autoFixObs.filter(o => o.gateStatus === 'PASS').length
    const totalAttempts = autoFixObs.length

    return {
      totalAttempts,
      successRate: totalAttempts > 0 ? successes / totalAttempts : 0,
      avgAttemptsPerFix: totalAttempts > 0 ? totalAttempts / Math.max(successes, 1) : 0,
      totalTimeSavedMinutes: successes * 5, // ~5 min saved per auto-fix
    }
  }

  private computeTrends(
    current: GovernanceObservation[],
    previous: GovernanceObservation[],
    instinctMetrics: GovernanceMetrics['instincts'],
  ): GovernanceMetrics['trends'] {
    const currentPassRate = current.length > 0
      ? current.filter(o => o.gateStatus === 'PASS').length / current.length
      : 0
    const prevPassRate = previous.length > 0
      ? previous.filter(o => o.gateStatus === 'PASS').length / previous.length
      : 0

    const currentCost = current.reduce((s, o) => s + (o.estimatedCostUsd ?? 0), 0)
    const prevCost = previous.reduce((s, o) => s + (o.estimatedCostUsd ?? 0), 0)

    return {
      passRateDelta: currentPassRate - prevPassRate,
      costDelta: currentCost - prevCost,
      instinctHitRateDelta: 0, // Requires historical hit rate data
    }
  }

  private computeROIScore(metrics: GovernanceMetrics): number {
    let score = 50 // baseline

    // Gate pass rate contributes up to 20 points
    score += Math.round(metrics.gates.passRate * 20)

    // Instinct hit rate contributes up to 15 points
    score += Math.round(metrics.instincts.hitRate * 15)

    // Auto-fix success contributes up to 10 points
    score += Math.round(metrics.autoFix.successRate * 10)

    // Positive cost savings contribute up to 5 points
    if (metrics.cost.estimatedSavingsFromCaching > 0) score += 3
    if (metrics.cost.estimatedSavingsFromInstincts > 0) score += 2

    return Math.min(100, Math.max(0, score))
  }
}

function parseGovernanceObservation(value: unknown): GovernanceObservation | null {
  if (!isRecord(value) || typeof value.timestamp !== 'string') return null
  return {
    timestamp: value.timestamp,
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : undefined,
    gateName: typeof value.gateName === 'string' ? value.gateName : undefined,
    gateStatus: typeof value.gateStatus === 'string' ? value.gateStatus : undefined,
    durationMs: finiteNumber(value.durationMs),
    tokensUsed: finiteNumber(value.tokensUsed),
    estimatedCostUsd: finiteNumber(value.estimatedCostUsd),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}
