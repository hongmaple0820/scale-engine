import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { WorkflowEvalRun } from './WorkflowEval.js'

export interface BenchmarkData {
  timestamp: string
  version: string
  summary: {
    passAt1: number     // 0-1
    passAt3: number     // 0-1
    totalCases: number
    avgDurationMs: number
    avgTokens: number
    avgCostUsd: number
  }
  byCategory: Record<string, {
    total: number
    passed: number
    avgDurationMs: number
    avgTokens: number
  }>
  trends: Array<{
    date: string
    passAt1: number
    totalCases: number
  }>
}

export function publishBenchmark(data: BenchmarkData, outputDir: string = '.scale/benchmarks'): string {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })
  const filename = `benchmark-${data.version}-${data.timestamp.replace(/[:.]/g, '-')}.json`
  const path = join(outputDir, filename)
  writeFileSync(path, JSON.stringify(data, null, 2))
  return path
}

export function createBenchmarkSummary(version: string): BenchmarkData {
  return {
    timestamp: new Date().toISOString(),
    version,
    summary: {
      passAt1: 0,
      passAt3: 0,
      totalCases: 0,
      avgDurationMs: 0,
      avgTokens: 0,
      avgCostUsd: 0,
    },
    byCategory: {},
    trends: [],
  }
}

export function createBenchmarkFromWorkflowEval(run: WorkflowEvalRun, version: string): BenchmarkData {
  const durationByCase = run.cases.map(item =>
    item.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0),
  )
  const byCategory: BenchmarkData['byCategory'] = {}

  for (const item of run.cases) {
    const bucket = byCategory[item.type] ?? {
      total: 0,
      passed: 0,
      avgDurationMs: 0,
      avgTokens: 0,
    }
    bucket.total++
    if (item.passed) bucket.passed++
    bucket.avgDurationMs += item.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0)
    bucket.avgTokens += item.estimatedTokens
    byCategory[item.type] = bucket
  }

  for (const bucket of Object.values(byCategory)) {
    bucket.avgDurationMs = average(bucket.avgDurationMs, bucket.total)
    bucket.avgTokens = average(bucket.avgTokens, bucket.total)
  }

  return {
    timestamp: run.generatedAt,
    version,
    summary: {
      passAt1: run.metrics.passAt1Rate,
      passAt3: run.metrics.passAt3Rate,
      totalCases: run.metrics.total,
      avgDurationMs: average(durationByCase.reduce((sum, value) => sum + value, 0), durationByCase.length),
      avgTokens: average(run.metrics.estimatedTokens, run.metrics.total),
      avgCostUsd: 0,
    },
    byCategory,
    trends: [{
      date: run.generatedAt.slice(0, 10),
      passAt1: run.metrics.passAt1Rate,
      totalCases: run.metrics.total,
    }],
  }
}

function average(total: number, count: number): number {
  return count === 0 ? 0 : Math.round((total / count) * 100) / 100
}
