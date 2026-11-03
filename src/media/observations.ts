// Media observations (M5): task terminal states flow back into the Cortex
// observation log as structured `Observation` records (domain: 'media').
// Design constraints from the plan:
//  - dedupe: the same `jobId + attempt + kind` is written once, even across
//    process restarts (the day's .scale/observations/<date>.jsonl is scanned
//    before writing);
//  - recording must never affect the task outcome — every failure mode (bad
//    dir, unwritable file, read error) degrades to a logged warning;
//  - observations reuse the gate-shaped Observation (gateName: 'media') so the
//    existing InstinctExtractor pipeline consumes them unchanged; no absolute
//    paths leave the task directory.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../core/logger.js'
import type {
  MediaObservationKind,
  MediaObservationContext,
  Observation,
} from '../cortex/InstinctExtractor.js'
import type { MediaJob } from './types.js'

export interface MediaObservationInput {
  job: MediaJob
  /** where this terminal state came from — selects the observation kind */
  kind: MediaObservationKind
  /** overrides the action id derived from the job type (defaults to catalog) */
  actionId?: string
  /** task-relative error detail, trimmed to keep the JSONL line bounded */
  rootCause?: string
}

const MEDIA_OBSERVATION_GATE = 'media'
const ERROR_PATTERN_MAX = 180
const ROOT_CAUSE_MAX = 300

export function observationsDirOf(root: string): string {
  return join(root, '.scale', 'observations')
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Scan the day's observation file for a `media` observation with the same
 * jobId + attempt + kind. File-level read problems are treated as "not seen"
 * — a corrupt/partial file must not wedge the writer (the file is append-only,
 * so a bad line cannot be repaired from here anyway).
 */
export function hasMediaObservation(root: string, key: { jobId: string; attempt: number; kind: MediaObservationKind }): boolean {
  const file = join(observationsDirOf(root), `${todayStamp()}.jsonl`)
  if (!existsSync(file)) return false
  try {
    const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Partial<Observation>
        if (parsed.domain !== 'media') continue
        const media = parsed.media
        if (!media) continue
        if (media.jobId === key.jobId && media.attempt === key.attempt && media.kind === key.kind) return true
      } catch {
        continue // malformed line — skip it
      }
    }
  } catch (error) {
    logger.warn({ err: error, file }, 'media observation dedupe scan failed; assuming not yet recorded')
  }
  return false
}

/** Trimmed failure text for `errorPattern`/`rootCause` — bounded JSONL lines. */
function clampText(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined
  const normalized = value.replace(/\s+/gu, ' ').trim()
  if (!normalized) return undefined
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized
}

function providerIdOf(job: MediaJob): string | undefined {
  return job.provider?.providerId
}

/**
 * Map a terminal media job state onto the gate-shaped Observation format.
 * Pure: no I/O, no clock beyond the caller-supplied timestamp.
 */
export function buildMediaObservation(input: MediaObservationInput, timestamp: string): Observation {
  const { job, kind } = input
  const media: MediaObservationContext = {
    kind,
    jobId: job.id,
    actionId: input.actionId ?? `media.${job.type}`,
    ...(providerIdOf(job) ? { providerId: providerIdOf(job) } : {}),
    ...(job.error?.code ? { errorCode: job.error.code } : {}),
    estimatedCny: job.cost?.estimatedCny ?? null,
    ...(typeof job.cost?.actualCny === 'number' ? { actualCny: job.cost.actualCny } : {}),
    attempt: job.attempt,
  }
  return {
    timestamp,
    sessionId: `media:${job.id}`,
    gateName: MEDIA_OBSERVATION_GATE,
    gateStatus: 'FAIL',
    errorPattern: clampText(job.error?.code ?? kind, ERROR_PATTERN_MAX),
    filePaths: job.outputs.map((output: { path: string }) => output.path),
    rootCause: clampText(input.rootCause, ROOT_CAUSE_MAX),
    tokensUsed: 0,
    modelUsed: providerIdOf(job) ?? 'n/a',
    domain: 'media',
    media,
  }
}

/**
 * Record a media observation. Best-effort by contract: any failure (scan,
 * mkdir, write) is logged and swallowed — the caller's task result is never
 * affected. Dedupe scans the day's file first so a process restart cannot
 * duplicate a record for the same jobId + attempt + kind.
 */
export function recordMediaObservation(root: string, input: MediaObservationInput): void {
  try {
    const key = { jobId: input.job.id, attempt: input.job.attempt, kind: input.kind }
    if (hasMediaObservation(root, key)) return
    const dir = observationsDirOf(root)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const observation = buildMediaObservation(input, new Date().toISOString())
    writeFileSync(join(dir, `${todayStamp()}.jsonl`), JSON.stringify(observation) + '\n', { flag: 'a' })
  } catch (error) {
    logger.warn(
      { err: error, jobId: input.job.id, kind: input.kind },
      'media observation recording failed (ignored; task result unaffected)',
    )
  }
}

/**
 * Terminal-state helper: pick the observation kind from the final job status
 * and error code. `cancelled` jobs are NOT observed (a human decision, not a
 * learning signal — except explicit approval rejections, which are).
 */
export function observationKindFor(job: MediaJob): MediaObservationKind | undefined {
  if (job.error?.code === 'MEDIA_PROVIDER_TIMEOUT') return 'provider_timeout'
  switch (job.status) {
    case 'failed':
      return 'job_failed'
    case 'failed_validation':
      return 'validation_failed'
    case 'cancelled':
      return job.approval?.status === 'rejected' ? 'approval_rejected' : undefined
    default:
      return undefined
  }
}

/** Convenience wrapper for JobService terminal hooks: derives kind, dedupes, never throws. */
export function observeTerminalState(
  root: string,
  job: MediaJob,
  options: { rootCause?: string; actionId?: string } = {},
): void {
  const kind = observationKindFor(job)
  if (!kind) return
  recordMediaObservation(root, {
    job,
    kind,
    ...(options.actionId ? { actionId: options.actionId } : {}),
    ...(options.rootCause ? { rootCause: options.rootCause } : {}),
  })
}
