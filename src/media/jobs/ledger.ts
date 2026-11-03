// Adapter into the unified ExecutionLedger (v3 plan §6.1 M0). Only structured
// summaries land here; storyboards and provider payloads stay in the task
// directory. Ledger failures never fail a media job.

import { logger } from '../../core/logger.js'
import { ExecutionLedger, type ExecutionEventType } from '../../runtime/ExecutionLedger.js'
import type { MediaJob } from '../types.js'

export const MEDIA_LEDGER_AGENT_ID = 'scale-media'

export interface MediaLedgerEventInput {
  type: ExecutionEventType
  summary: string
  metadata?: Record<string, unknown>
  duration?: number
}

export function mediaSessionId(jobId: string): string {
  return `media:${jobId}`
}

type LedgerJob = Pick<MediaJob, 'id' | 'type' | 'projectId' | 'status'>

export function recordMediaLedgerEvent(root: string, job: LedgerJob, event: MediaLedgerEventInput): void {
  try {
    const ledger = new ExecutionLedger({ projectDir: root })
    ledger.record({
      agentId: MEDIA_LEDGER_AGENT_ID,
      sessionId: mediaSessionId(job.id),
      taskId: job.id,
      type: event.type,
      summary: event.summary,
      ...(event.duration === undefined ? {} : { duration: event.duration }),
      metadata: {
        domain: 'media',
        projectId: job.projectId,
        jobType: job.type,
        status: job.status,
        ...(event.metadata ?? {}),
      },
    })
  } catch (error) {
    logger.warn({ err: error, jobId: job.id, eventType: event.type }, 'media ledger write failed')
  }
}
