// Job state machine (v3 plan §4.2, narrowed per the P0 review: single-machine
// MVP keeps the transitions that a local, serial executor can actually be in;
// provider reconciliation states arrive with real providers in P3).

import type { MediaJobStatus } from '../types.js'
import { MediaError } from '../errors.js'

const TRANSITIONS: Record<MediaJobStatus, readonly MediaJobStatus[]> = {
  created: ['validated', 'failed_validation', 'cancelled'],
  validated: ['running', 'cancelled'],
  running: ['packaging', 'failed', 'cancelled', 'interrupted'],
  packaging: ['succeeded', 'failed', 'interrupted'],
  interrupted: ['running', 'cancelled'],
  failed: ['running'],
  failed_validation: ['validated'],
  cancelled: [],
  succeeded: [],
}

export function canTransition(from: MediaJobStatus, to: MediaJobStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function assertTransition(from: MediaJobStatus, to: MediaJobStatus): void {
  if (!canTransition(from, to)) {
    throw new MediaError('MEDIA_JOB_STATE', `illegal job transition ${from} -> ${to}`)
  }
}

/** statuses a task may be found in after the process died mid-flight */
export const INTERRUPTIBLE_STATUSES: readonly MediaJobStatus[] = ['running', 'packaging']
