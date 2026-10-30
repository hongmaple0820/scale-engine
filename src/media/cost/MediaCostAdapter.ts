// Media cost adapter (M2, ADR-8): media spend is recorded in the unified
// ModelUsageLedger — there is no second cost ledger. CNY values live in
// `metadata.costCny` (the ledger's native `estimatedCostUsd` is left untouched:
// converting currencies would invent an exchange rate).
//
// A job's cost object is created at create time from the static price table and
// finalized when the job reaches a terminal status.

import { join } from 'node:path'
import { logger } from '../../core/logger.js'
import { ModelUsageLedger } from '../../runtime/ModelUsageLedger.js'
import type { MediaJob, MediaJobCost } from '../types.js'
import { estimateCost } from '../actions/estimate.js'

export function estimateMediaJobCost(actionId: string, params: Record<string, unknown>): MediaJobCost {
  const estimate = estimateCost(actionId, params)
  const line = estimate.breakdown[0]
  return {
    estimatedCny: estimate.estimatedCny,
    reservedCny: 0,
    pricingKey: line?.pricingKey,
    unit: line?.unit,
    quantity: line?.quantity ?? null,
  }
}

export interface RecordMediaCostOptions {
  root: string
  job: MediaJob
  /** final CNY amount; null keeps the estimate (never invents spend) */
  actualCny: number | null
  model?: string
}

/**
 * Append the job's cost to the unified usage ledger. Ledger failures are
 * logged, never allowed to fail the media job.
 */
export function recordMediaCost(options: RecordMediaCostOptions): void {
  const { root, job, actualCny } = options
  try {
    const ledger = new ModelUsageLedger(join(root, '.scale'))
    const cost = job.cost
    const costCny = actualCny ?? cost?.estimatedCny ?? null
    ledger.record({
      provider: job.provider?.providerId ?? 'scale-media',
      ...(options.model ? { model: options.model } : {}),
      taskId: job.id,
      sessionId: `media:${job.id}`,
      metadata: {
        domain: 'media',
        jobType: job.type,
        projectId: job.projectId,
        costStatus: actualCny === null ? 'estimated' : 'actual',
        ...(costCny === null ? {} : { costCny }),
        ...(cost?.pricingKey ? { pricingKey: cost.pricingKey } : {}),
        ...(cost?.unit ? { unit: cost.unit } : {}),
        ...(typeof cost?.quantity === 'number' ? { quantity: cost.quantity } : {}),
      },
    })
  } catch (error) {
    logger.warn({ err: error, jobId: job.id }, 'media cost ledger write failed')
  }
}
