// Approval + budget policy from the environment (M2). Invalid values fall
// back to the safe defaults rather than disabling governance: an unreadable
// threshold must never turn into "run everything".

import type { MediaActionManifest } from '../actions/types.js'
import type { ApprovalDecision, ApprovalMode } from './types.js'

export const DEFAULT_APPROVAL_THRESHOLD_CNY = 5
export const DEFAULT_DAILY_BUDGET_CNY = 50
export const DEFAULT_APPROVAL_TTL_MINUTES = 1440
export const DEFAULT_BUDGET_RESERVATION_TTL_MINUTES = 1440

function numberEnv(name: string, fallback: number, min: number): number {
  const raw = process.env[name]?.trim()
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < min) return fallback
  return value
}

export function approvalMode(): ApprovalMode {
  const raw = process.env.MEDIA_APPROVAL_MODE?.trim().toLowerCase()
  if (raw === 'off' || raw === 'always' || raw === 'threshold') return raw
  return 'threshold'
}

export function approvalThresholdCny(manifestThreshold: number | undefined): number {
  const explicit = process.env.MEDIA_APPROVAL_THRESHOLD_CNY?.trim()
  if (explicit !== undefined && explicit !== '') {
    return numberEnv('MEDIA_APPROVAL_THRESHOLD_CNY', DEFAULT_APPROVAL_THRESHOLD_CNY, 0)
  }
  return typeof manifestThreshold === 'number' && manifestThreshold >= 0 ? manifestThreshold : DEFAULT_APPROVAL_THRESHOLD_CNY
}

export function approvalTtlMinutes(): number {
  return numberEnv('MEDIA_APPROVAL_TTL_MINUTES', DEFAULT_APPROVAL_TTL_MINUTES, 1)
}

export function dailyBudgetCny(): number {
  return numberEnv('MEDIA_DAILY_BUDGET_CNY', DEFAULT_DAILY_BUDGET_CNY, 0)
}

export function budgetReservationTtlMinutes(): number {
  return numberEnv('MEDIA_BUDGET_RESERVATION_TTL_MINUTES', DEFAULT_BUDGET_RESERVATION_TTL_MINUTES, 1)
}

/**
 * Decide whether an action needs human approval.
 * - off        → never
 * - always     → always (even local/free actions)
 * - threshold  → manifest `never` skips; otherwise unknown cost requires
 *                approval, and estimated cost >= threshold requires it.
 */
export function decideApproval(
  action: Pick<MediaActionManifest, 'id' | 'approval'>,
  estimatedCny: number | null,
): ApprovalDecision {
  const mode = approvalMode()
  if (mode === 'off') return { required: false, reason: 'MEDIA_APPROVAL_MODE=off' }
  if (mode === 'always') {
    return { required: true, mode: 'always', reason: 'MEDIA_APPROVAL_MODE=always' }
  }
  if (action.approval.mode === 'never') {
    return { required: false, reason: `action ${action.id} is declared approval:never` }
  }
  const threshold = approvalThresholdCny(action.approval.thresholdCny)
  if (estimatedCny === null) {
    return { required: true, mode: 'threshold', thresholdCny: threshold, reason: 'cost is unknown (fail-closed)' }
  }
  if (estimatedCny >= threshold) {
    return {
      required: true,
      mode: 'threshold',
      thresholdCny: threshold,
      reason: `estimated ${estimatedCny} CNY >= threshold ${threshold} CNY`,
    }
  }
  return { required: false, reason: `estimated ${estimatedCny} CNY < threshold ${threshold} CNY` }
}
