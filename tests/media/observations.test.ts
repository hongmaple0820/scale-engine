// M5 media observations: terminal state → Observation mapping, day-file
// dedupe (incl. across a simulated process restart), and the failure-isolation
// contract (recording never affects a task result).

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildMediaObservation,
  hasMediaObservation,
  observeTerminalState,
  observationKindFor,
  observationsDirOf,
  recordMediaObservation,
} from '../../src/media/observations.js'
import { createJob, decideJobApproval, runJob, getJob } from '../../src/media/index.js'
import type { MediaJob } from '../../src/media/types.js'
import type { Observation } from '../../src/cortex/InstinctExtractor.js'

const root = join(tmpdir(), `media-obs-${Date.now().toString(36)}`)
const obsDir = join(root, '.scale', 'observations')

beforeEach(() => {
  rmSync(obsDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  mkdirSync(root, { recursive: true })
})

afterEach(() => {
  rmSync(obsDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function makeJob(overrides: Partial<MediaJob> = {}): MediaJob {
  return {
    id: 'job-2026-10-30-abcdef01',
    projectId: 'default',
    type: 'generate_image',
    status: 'failed',
    schemaVersion: 1,
    createdAt: '2026-10-30T08:00:00.000Z',
    updatedAt: '2026-10-30T08:01:00.000Z',
    requestedBy: 'cli',
    input: { imageRequestFile: 'image-request.json' },
    attempt: 1,
    outputs: [{ id: 'img-1', path: 'output/cover.png', kind: 'image', bytes: 12, sha256: 'aa'.repeat(32) }],
    error: { code: 'MEDIA_PROVIDER_REQUEST_FAILED', message: 'upstream 500', retryable: true },
    provider: { providerId: 'openai-compatible', jobId: 'prov-1', submittedAt: '2026-10-30T08:00:01.000Z' },
    cost: { estimatedCny: 0.5, reservedCny: 0.5 },
    ...overrides,
  } as MediaJob
}

function readDayLines(): Observation[] {
  const file = join(obsDir, `${new Date().toISOString().slice(0, 10)}.jsonl`)
  if (!existsSync(file)) return []
  const parsed: Observation[] = []
  for (const line of readFileSync(file, 'utf-8').split('\n').filter(Boolean)) {
    try {
      parsed.push(JSON.parse(line) as Observation)
    } catch {
      // pre-seeded corrupt lines (corrupt-file test) are not observations
    }
  }
  return parsed
}

describe('buildMediaObservation mapping', () => {
  it('maps a failed job onto the gate-shaped Observation with domain media', () => {
    const obs = buildMediaObservation({ job: makeJob(), kind: 'job_failed', rootCause: 'upstream 500 (gateway)' }, '2026-10-30T08:01:00.000Z')
    expect(obs.sessionId).toBe('media:job-2026-10-30-abcdef01')
    expect(obs.gateName).toBe('media')
    expect(obs.gateStatus).toBe('FAIL')
    expect(obs.timestamp).toBe('2026-10-30T08:01:00.000Z')
    expect(obs.tokensUsed).toBe(0)
    expect(obs.modelUsed).toBe('openai-compatible')
    expect(obs.errorPattern).toBe('MEDIA_PROVIDER_REQUEST_FAILED')
    expect(obs.rootCause).toBe('upstream 500 (gateway)')
    // task-relative paths only
    expect(obs.filePaths).toEqual(['output/cover.png'])
    expect(obs.domain).toBe('media')
    expect(obs.media).toMatchObject({
      kind: 'job_failed',
      jobId: 'job-2026-10-30-abcdef01',
      actionId: 'media.generate_image',
      providerId: 'openai-compatible',
      errorCode: 'MEDIA_PROVIDER_REQUEST_FAILED',
      estimatedCny: 0.5,
      attempt: 1,
    })
  })

  it('defaults modelUsed to n/a without a provider and estimatedCny to null without cost', () => {
    const job = makeJob({ provider: undefined, cost: undefined, error: undefined })
    const obs = buildMediaObservation({ job, kind: 'job_failed' }, '2026-10-30T08:01:00.000Z')
    expect(obs.modelUsed).toBe('n/a')
    expect(obs.media?.estimatedCny).toBeNull()
    expect(obs.media?.providerId).toBeUndefined()
    expect(obs.media?.errorCode).toBeUndefined()
    // no error → pattern falls back to the kind
    expect(obs.errorPattern).toBe('job_failed')
  })

  it('honors an explicit actionId override (approval records carry the catalog id)', () => {
    const obs = buildMediaObservation(
      { job: makeJob(), kind: 'approval_rejected', actionId: 'media.generate_image' },
      '2026-10-30T08:01:00.000Z',
    )
    expect(obs.media?.kind).toBe('approval_rejected')
    expect(obs.media?.actionId).toBe('media.generate_image')
  })
})

describe('observationKindFor', () => {
  it('maps failure states and the provider timeout error code', () => {
    expect(observationKindFor(makeJob({ status: 'failed' }))).toBe('job_failed')
    expect(observationKindFor(makeJob({ status: 'failed', error: { code: 'MEDIA_PROVIDER_TIMEOUT', message: 'x', retryable: true } }))).toBe('provider_timeout')
    expect(observationKindFor(makeJob({ status: 'failed_validation' }))).toBe('validation_failed')
  })

  it('observes approval rejections but not operator cancels', () => {
    const rejected = makeJob({
      status: 'cancelled',
      approval: { id: 'ap-1', status: 'rejected', mode: 'always', requestedAt: 'x', expiresAt: 'y', estimatedCny: 1 },
    })
    const operatorCancel = makeJob({ status: 'cancelled' })
    expect(observationKindFor(rejected)).toBe('approval_rejected')
    expect(observationKindFor(operatorCancel)).toBeUndefined()
  })

  it('returns undefined for non-terminal / succeeded states', () => {
    expect(observationKindFor(makeJob({ status: 'succeeded' }))).toBeUndefined()
    expect(observationKindFor(makeJob({ status: 'running' }))).toBeUndefined()
  })
})

describe('recordMediaObservation dedupe + isolation', () => {
  it('writes one line and dedupes the same jobId+attempt+kind', () => {
    const job = makeJob()
    recordMediaObservation(root, { job, kind: 'job_failed' })
    recordMediaObservation(root, { job, kind: 'job_failed' })
    expect(readDayLines()).toHaveLength(1)
  })

  it('writes again when the attempt differs (retry is a new event)', () => {
    recordMediaObservation(root, { job: makeJob({ attempt: 1 }), kind: 'job_failed' })
    recordMediaObservation(root, { job: makeJob({ attempt: 2 }), kind: 'job_failed' })
    expect(readDayLines()).toHaveLength(2)
  })

  it('survives a process restart: a pre-seeded day file suppresses the duplicate', () => {
    // Simulate an earlier process having written the record for this attempt.
    const seeded = buildMediaObservation({ job: makeJob(), kind: 'job_failed' }, '2026-10-30T07:59:00.000Z')
    mkdirSync(obsDir, { recursive: true })
    writeFileSync(join(obsDir, `${new Date().toISOString().slice(0, 10)}.jsonl`), JSON.stringify(seeded) + '\n', 'utf-8')
    expect(hasMediaObservation(root, { jobId: seeded.media!.jobId, attempt: seeded.media!.attempt, kind: seeded.media!.kind })).toBe(true)
    recordMediaObservation(root, { job: makeJob(), kind: 'job_failed' })
    expect(readDayLines()).toHaveLength(1) // the seeded line, not a new one
  })

  it('is a no-op (not a record) for non-observed states via observeTerminalState', () => {
    observeTerminalState(root, makeJob({ status: 'succeeded' }))
    observeTerminalState(root, makeJob({ status: 'cancelled' })) // operator cancel
    expect(readDayLines()).toHaveLength(0)
  })

  it('never throws when the observations dir is unwritable (task result unaffected)', () => {
    // observationsDirOf(root) collides with an existing FILE → mkdir/write fail.
    const blocked = join(tmpdir(), `media-obs-blocked-${Date.now().toString(36)}`)
    mkdirSync(join(blocked, '.scale'), { recursive: true })
    writeFileSync(join(blocked, '.scale', 'observations'), 'not a directory', 'utf-8')
    expect(() => observeTerminalState(blocked, makeJob({ status: 'failed' }))).not.toThrow()
    rmSync(join(blocked, '.scale', 'observations'), { force: true })
    rmSync(blocked, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('treats a corrupt day file as not-yet-recorded and still appends', () => {
    mkdirSync(obsDir, { recursive: true })
    writeFileSync(join(obsDir, `${new Date().toISOString().slice(0, 10)}.jsonl`), '{broken json\n', 'utf-8')
    recordMediaObservation(root, { job: makeJob(), kind: 'job_failed' })
    const lines = readDayLines()
    expect(lines).toHaveLength(1) // the new record; the broken line is skipped on read
  })

  it('exposes the observations dir under .scale (same file the Cortex extractor reads)', () => {
    recordMediaObservation(root, { job: makeJob(), kind: 'job_failed' })
    expect(observationsDirOf(root)).toBe(join(root, '.scale', 'observations'))
    expect(existsSync(join(obsDir, `${new Date().toISOString().slice(0, 10)}.jsonl`))).toBe(true)
  })
})

describe('JobService terminal hooks (integration, real runJob path)', () => {
  const ENV_KEYS = ['MEDIA_OPENAI_API_KEY', 'MEDIA_APPROVAL_MODE', 'MEDIA_APPROVAL_THRESHOLD_CNY'] as const
  const savedEnv: Record<string, string | undefined> = {}
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
  })
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
  })

  it('a failed runJob produces exactly one media observation (and rethrows the real error)', async () => {
    // approval gate off: this test exercises the run/observe path, not approvals
    process.env.MEDIA_APPROVAL_MODE = 'off'
    const created = createJob({
      root,
      type: 'generate_image',
      imageRequest: { prompt: 'will fail', size: '1024x1024', providerId: 'openai-compatible' },
    })
    // No MEDIA_OPENAI_API_KEY → provider unavailable, task fails for real.
    await expect(runJob({ root, taskId: created.job.id })).rejects.toThrow(/MEDIA_OPENAI_API_KEY/)
    expect(getJob(root, undefined, created.job.id).job.status).toBe('failed')
    const lines = readDayLines()
    expect(lines).toHaveLength(1)
    const obs = lines[0]
    expect(obs.domain).toBe('media')
    expect(obs.gateName).toBe('media')
    expect(obs.gateStatus).toBe('FAIL')
    expect(obs.media?.jobId).toBe(created.job.id)
    expect(obs.media?.kind).toBe('job_failed')
    expect(obs.media?.errorCode).toBe('MEDIA_PROVIDER_UNAVAILABLE')
    expect(obs.sessionId).toBe(`media:${created.job.id}`)
  }, 60000)

  it('an approval rejection produces an approval_rejected observation with the catalog actionId', () => {
    const created = createJob({
      root,
      type: 'generate_image',
      imageRequest: { prompt: 'reject observation', size: '1024x1024', providerId: 'openai-compatible' },
    })
    expect(created.job.status).toBe('awaiting_approval')
    decideJobApproval({ root, approvalId: created.job.approval?.id ?? '', approve: false, decidedBy: 'tester', reason: 'no budget' })
    const lines = readDayLines()
    expect(lines).toHaveLength(1)
    expect(lines[0].media?.kind).toBe('approval_rejected')
    expect(lines[0].media?.actionId).toBe('media.generate_image')
    expect(lines[0].rootCause).toBeUndefined() // job.error is unset on the reject path
  }, 60000)
})
