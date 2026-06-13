import { createHash } from 'node:crypto'
import type { Instinct, Observation, PatternMatch } from './InstinctExtractor.js'

export type InstinctCandidateStatus = 'accepted' | 'stale' | 'needs-review'

export interface ReviewedInstinctCandidate {
  instinct: Instinct
  status: InstinctCandidateStatus
  reasons: string[]
  latestFailureAt?: string
  laterPassingGateAt?: string
}

export interface InstinctCandidateReviewOptions {
  maxAgeDays?: number
  now?: Date
}

export interface ReviewedInstinctSelection {
  eligibleReviews: ReviewedInstinctCandidate[]
  saveableReviews: ReviewedInstinctCandidate[]
  rejectedReviews: ReviewedInstinctCandidate[]
  instincts: Instinct[]
  summary: Record<InstinctCandidateStatus, number>
}

export function reviewInstinctCandidates(
  instincts: Instinct[],
  patterns: PatternMatch[],
  observations: Observation[],
  options: InstinctCandidateReviewOptions = {},
): ReviewedInstinctCandidate[] {
  const patternByInstinctId = new Map(patterns.map(pattern => [
    instinctIdForPattern(pattern.pattern),
    pattern,
  ]))

  return instincts.map(instinct => reviewCandidate(
    instinct,
    patternByInstinctId.get(instinct.id),
    observations,
    options,
  ))
}

export function selectReviewedInstinctCandidates(
  reviews: ReviewedInstinctCandidate[],
  minConfidence: number,
  includeStale: boolean,
): ReviewedInstinctSelection {
  const eligibleReviews = reviews.filter(review => review.instinct.confidence >= minConfidence)
  const saveableReviews = includeStale
    ? eligibleReviews
    : eligibleReviews.filter(review => review.status === 'accepted')
  const rejectedReviews = eligibleReviews.filter(review => !saveableReviews.includes(review))

  return {
    eligibleReviews,
    saveableReviews,
    rejectedReviews,
    instincts: saveableReviews.map(review => review.instinct),
    summary: candidateReviewSummary(eligibleReviews),
  }
}

export function formatRejectedCandidate(review: ReviewedInstinctCandidate) {
  return {
    id: review.instinct.id,
    trigger: review.instinct.trigger,
    confidence: review.instinct.confidence,
    status: review.status,
    reasons: review.reasons,
    latestFailureAt: review.latestFailureAt,
    laterPassingGateAt: review.laterPassingGateAt,
  }
}

export function candidateReviewSummary(reviews: ReviewedInstinctCandidate[]): Record<InstinctCandidateStatus, number> {
  return reviews.reduce<Record<InstinctCandidateStatus, number>>((summary, review) => {
    summary[review.status]++
    return summary
  }, { accepted: 0, stale: 0, 'needs-review': 0 })
}

function reviewCandidate(
  instinct: Instinct,
  pattern: PatternMatch | undefined,
  observations: Observation[],
  options: InstinctCandidateReviewOptions,
): ReviewedInstinctCandidate {
  if (!pattern) {
    return {
      instinct,
      status: 'needs-review',
      reasons: ['source pattern unavailable'],
    }
  }

  const failureTimes = pattern.observations
    .map(obs => Date.parse(obs.timestamp))
    .filter(Number.isFinite)
  const latestFailureMs = Math.max(...failureTimes)
  const latestFailureAt = Number.isFinite(latestFailureMs)
    ? new Date(latestFailureMs).toISOString()
    : undefined

  if (!latestFailureAt) {
    return {
      instinct,
      status: 'needs-review',
      reasons: ['failure observations have no valid timestamp'],
    }
  }

  const staleReasons: string[] = []
  const laterPass = findLaterPassingGate(pattern, observations, latestFailureMs)
  if (laterPass) {
    staleReasons.push(`later passing ${laterPass.gateName} gate at ${laterPass.timestamp}`)
  }

  const maxAgeDays = options.maxAgeDays
  if (maxAgeDays !== undefined) {
    const nowMs = options.now?.getTime() ?? Date.now()
    if (nowMs - latestFailureMs > maxAgeDays * 86400000) {
      staleReasons.push(`latest failure is older than ${maxAgeDays} day(s)`)
    }
  }

  if (staleReasons.length > 0) {
    return {
      instinct,
      status: 'stale',
      reasons: staleReasons,
      latestFailureAt,
      laterPassingGateAt: laterPass?.timestamp,
    }
  }

  return {
    instinct,
    status: 'accepted',
    reasons: ['no later passing gate evidence found'],
    latestFailureAt,
  }
}

function findLaterPassingGate(
  pattern: PatternMatch,
  observations: Observation[],
  latestFailureMs: number,
): Observation | undefined {
  const failedGates = new Set(pattern.observations.map(obs => obs.gateName))
  const failedPaths = uniqueStrings(pattern.observations.flatMap(obs => obs.filePaths))

  return observations
    .filter(obs => {
      if (obs.gateStatus !== 'PASS') return false
      if (!failedGates.has(obs.gateName)) return false
      const ts = Date.parse(obs.timestamp)
      if (!Number.isFinite(ts) || ts <= latestFailureMs) return false
      return failedPaths.length === 0 || pathsOverlap(failedPaths, obs.filePaths)
    })
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))[0]
}

function pathsOverlap(left: string[], right: string[]): boolean {
  if (right.length === 0) return true
  return left.some(leftPath => right.some(rightPath => isSameOrNestedPath(leftPath, rightPath)))
}

function isSameOrNestedPath(left: string, right: string): boolean {
  const a = normalizePath(left)
  const b = normalizePath(right)
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/g, '').toLowerCase()
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(value => value.trim().length > 0)))
}

function instinctIdForPattern(pattern: string): string {
  return `instinct-${createHash('sha256').update(pattern).digest('hex').slice(0, 10)}`
}
