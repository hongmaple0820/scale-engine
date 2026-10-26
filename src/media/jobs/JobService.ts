// Job service (v3 plan §4): the single business layer every entry point
// (CLI now; API/MCP/DSH later) goes through. Single-writer via the repo's
// cross-process FileLock (held across the async pipeline — a second writer
// fails fast instead of queueing blindly); idempotency keys dedupe creates;
// a snapshot found mid-flight is recovered as `interrupted`, never faked.

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acquireFileSync, FileLockTimeoutError } from '../../core/FileLock.js'
import { MediaError, toJobError } from '../errors.js'
import type { AssetRecord, ImageJobRequest, MediaJob, Storyboard } from '../types.js'
import { validateStoryboard } from '../validation/validateStoryboard.js'
import { renderStoryboard } from '../render/RenderOrchestrator.js'
import {
  appendJobEvent,
  createTaskDir,
  findJob,
  findJobByIdempotencyKey,
  listJobs,
  openWorkspace,
  readSnapshot,
  recoverInterruptedJobs,
  taskDirOf,
  writeSnapshot,
  type MediaWorkspace,
} from './JobStore.js'
import { assertTransition, INTERRUPTIBLE_STATUSES } from './jobStateMachine.js'
import { generateImageForJob, validateImageRequest } from '../render/ImageOrchestrator.js'

const LOCK_ROOT = (workspace: MediaWorkspace) => join(workspace.projectDir, '.locks')
const RUN_LOCK_TTL_MS = 30 * 60 * 1000 // a long render must not be stolen mid-flight
const RUN_LOCK_WAIT_MS = 3000 // second writer fails fast instead of queueing blindly

export interface CreateJobOptions {
  root: string
  projectId?: string
  /** job type — render (storyboard) by default; generate_image uses imageRequest */
  type?: 'render' | 'generate_image'
  storyboard?: Storyboard
  imageRequest?: Partial<ImageJobRequest>
  requestedBy?: string
  idempotencyKey?: string
}

export interface RunJobOptions {
  root: string
  projectId?: string
  taskId: string
  ffmpegBin?: string
  ffprobeBin?: string
}

function nowIso(): string {
  return new Date().toISOString()
}

export function createJob(options: CreateJobOptions): { job: MediaJob; taskDir: string; deduplicated: boolean } {
  const workspace = openWorkspace(options.root, options.projectId)
  const type = options.type ?? 'render'
  let storyboard: Storyboard | undefined
  let imageRequest: ImageJobRequest | undefined
  if (type === 'render') {
    storyboard = options.storyboard as Storyboard
    const validation = validateStoryboard(storyboard)
    if (!validation.ok) {
      throw new MediaError('MEDIA_STORYBOARD_INVALID', `storyboard rejected:\n- ${validation.errors.join('\n- ')}`)
    }
  } else {
    imageRequest = validateImageRequest(options.imageRequest)
  }

  return withLockedSync(workspace, 'media-create', () => {
    if (options.idempotencyKey) {
      const existing = findJobByIdempotencyKey(workspace, options.idempotencyKey)
      if (existing) {
        return { job: existing, taskDir: taskDirOf(workspace, existing.id), deduplicated: true }
      }
    }

    const taskId = `job-${nowIso().slice(0, 10)}-${randomUUID().slice(0, 8)}`
    const taskDir = createTaskDir(workspace, taskId)
    const job: MediaJob = {
      id: taskId,
      projectId: workspace.projectId,
      type,
      status: 'created',
      schemaVersion: 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      requestedBy: options.requestedBy ?? 'cli',
      idempotencyKey: options.idempotencyKey,
      input: type === 'render' ? { storyboardFile: 'storyboard.json' } : { imageRequestFile: 'image-request.json' },
      attempt: 1,
      outputs: [],
    }
    if (storyboard) writeFileSync(join(taskDir, 'storyboard.json'), JSON.stringify(storyboard, null, 1), 'utf-8')
    if (imageRequest) writeFileSync(join(taskDir, 'image-request.json'), JSON.stringify(imageRequest, null, 1), 'utf-8')
    writeSnapshot(taskDir, job)
    appendJobEvent(taskDir, { at: nowIso(), type: 'created', data: { requestedBy: job.requestedBy, idempotencyKey: options.idempotencyKey, jobType: type } })
    return { job, taskDir, deduplicated: false }
  })
}

function withLockedSync<T>(workspace: MediaWorkspace, key: string, fn: () => T, lockOptions?: { ttlMs?: number; waitMs?: number }): T {
  const lock = acquireFileSync(key, LOCK_ROOT(workspace), { ttlMs: 10_000, waitMs: 5_000, ...lockOptions })
  try {
    return fn()
  } finally {
    lock.release()
  }
}

export function getJob(root: string, projectId: string | undefined, taskId: string): { job: MediaJob; taskDir: string } {
  const found = findJob(openWorkspace(root, projectId), taskId)
  return { job: found.job, taskDir: found.dir }
}

export function listProjectJobs(root: string, projectId?: string): MediaJob[] {
  return listJobs(openWorkspace(root, projectId))
}

export function readJobStoryboard(root: string, projectId: string | undefined, taskId: string): Storyboard {
  const { dir } = findJob(openWorkspace(root, projectId), taskId)
  return JSON.parse(readFileSync(join(dir, 'storyboard.json'), 'utf-8')) as Storyboard
}

/**
 * Run (or continue) a render job. Legal from created/validated/failed/
 * interrupted; a snapshot found mid-flight is first recovered as interrupted.
 * The lock is held across the whole async pipeline and released in finally.
 */
export async function runJob(options: RunJobOptions): Promise<MediaJob> {
  const workspace = openWorkspace(options.root, options.projectId)
  const lock = acquireFileSync('media-run', LOCK_ROOT(workspace), { ttlMs: RUN_LOCK_TTL_MS, waitMs: RUN_LOCK_WAIT_MS })
  try {
    return await runLocked(workspace, options)
  } catch (error) {
    if (error instanceof FileLockTimeoutError) {
      throw new MediaError('MEDIA_LOCK_TIMEOUT', 'another media job is running in this project; retry when it finishes', { retryable: true })
    }
    throw error
  } finally {
    lock.release()
  }
}

async function runLocked(workspace: MediaWorkspace, options: RunJobOptions): Promise<MediaJob> {
  const { dir: taskDir, job } = findJob(workspace, options.taskId)
  if (job.status === 'succeeded' || job.status === 'cancelled') return job
  if (INTERRUPTIBLE_STATUSES.includes(job.status)) {
    job.status = 'interrupted'
    job.error = { code: 'MEDIA_JOB_INTERRUPTED', message: 'recovered from a mid-flight process exit; retrying', retryable: true }
    writeSnapshot(taskDir, job)
  }
  const isRetry = Boolean(job.error)

  if (job.status === 'created') {
    assertTransition('created', 'validated')
    job.status = 'validated'
    writeSnapshot(taskDir, job)
  }
  if (job.status === 'failed_validation') {
    if (job.type === 'generate_image') {
      validateImageRequest(JSON.parse(readFileSync(join(taskDir, 'image-request.json'), 'utf-8')))
    } else {
      const storyboard = JSON.parse(readFileSync(join(taskDir, 'storyboard.json'), 'utf-8')) as Storyboard
      const validation = validateStoryboard(storyboard)
      if (!validation.ok) {
        throw new MediaError('MEDIA_STORYBOARD_INVALID', 'storyboard still invalid; create a new job with fixed input')
      }
    }
    assertTransition('failed_validation', 'validated')
    job.status = 'validated'
    writeSnapshot(taskDir, job)
  }
  assertTransition(job.status, 'running')
  job.status = 'running'
  job.startedAt = nowIso()
  if (isRetry) job.attempt += 1
  job.error = undefined
  writeSnapshot(taskDir, job)
  appendJobEvent(taskDir, { at: nowIso(), type: 'running', data: { attempt: job.attempt } })

  const cancelFlag = join(taskDir, 'cancel.requested')
  const isCancelled = () => existsSync(cancelFlag)
  const onStage = (info: { stage: string; ms: number }) => {
    job.stage = info.stage
    writeSnapshot(taskDir, job)
  }

  try {
    let output: AssetRecord
    if (job.type === 'generate_image') {
      const request = JSON.parse(readFileSync(join(taskDir, 'image-request.json'), 'utf-8')) as ImageJobRequest
      const outcome = await generateImageForJob({ taskDir, taskId: job.id, request, isCancelled, onStage })
      output = outcome.output
    } else {
      const storyboard = JSON.parse(readFileSync(join(taskDir, 'storyboard.json'), 'utf-8')) as Storyboard
      const outcome = await renderStoryboard({
        taskDir,
        taskId: job.id,
        storyboard,
        requestedBy: job.requestedBy,
        ffmpegBin: options.ffmpegBin,
        ffprobeBin: options.ffprobeBin,
        isCancelled,
        onStage,
      })
      output = outcome.output
    }
    assertTransition('running', 'packaging')
    job.status = 'packaging'
    writeSnapshot(taskDir, job)
    assertTransition('packaging', 'succeeded')
    job.status = 'succeeded'
    job.stage = undefined
    job.outputs = [output]
    job.finishedAt = nowIso()
    writeSnapshot(taskDir, job)
    appendJobEvent(taskDir, { at: nowIso(), type: 'succeeded', data: { outputSha256: output.sha256, bytes: output.bytes } })
    return job
  } catch (error) {
    const jobError = toJobError(error)
    if (jobError.code === 'MEDIA_JOB_CANCELLED') {
      job.status = 'cancelled'
      job.error = jobError
      job.finishedAt = nowIso()
      writeSnapshot(taskDir, job)
      appendJobEvent(taskDir, { at: nowIso(), type: 'cancelled' })
      return job
    }
    job.status = 'failed'
    job.error = jobError
    job.finishedAt = nowIso()
    writeSnapshot(taskDir, job)
    appendJobEvent(taskDir, { at: nowIso(), type: 'failed', data: jobError })
    throw error
  }
}

export function cancelJob(root: string, projectId: string | undefined, taskId: string): MediaJob {
  const workspace = openWorkspace(root, projectId)
  return withLockedSync(workspace, 'media-run', () => {
    const { dir: taskDir, job } = findJob(workspace, taskId)
    if (['succeeded', 'cancelled'].includes(job.status)) return job
    // cooperative: running/packaging jobs observe the flag between stages
    if (['running', 'packaging'].includes(job.status)) {
      writeFileSync(join(taskDir, 'cancel.requested'), nowIso(), 'utf-8')
      appendJobEvent(taskDir, { at: nowIso(), type: 'cancel_requested' })
      return readSnapshot(taskDir)
    }
    assertTransition(job.status, 'cancelled')
    job.status = 'cancelled'
    job.finishedAt = nowIso()
    writeSnapshot(taskDir, job)
    appendJobEvent(taskDir, { at: nowIso(), type: 'cancelled' })
    return job
  }, { ttlMs: RUN_LOCK_TTL_MS, waitMs: RUN_LOCK_WAIT_MS })
}

export function retryJob(options: RunJobOptions): Promise<MediaJob> {
  const workspace = openWorkspace(options.root, options.projectId)
  const { job } = findJob(workspace, options.taskId)
  if (!['failed', 'interrupted', 'failed_validation'].includes(job.status)) {
    throw new MediaError('MEDIA_JOB_STATE', `job "${options.taskId}" in status "${job.status}" is not retryable`)
  }
  return runJob(options)
}

export function recoverJobs(root: string, projectId?: string): string[] {
  return withLockedSync(openWorkspace(root, projectId), 'media-run', () => recoverInterruptedJobs(openWorkspace(root, projectId)), {
    ttlMs: RUN_LOCK_TTL_MS,
    waitMs: RUN_LOCK_WAIT_MS,
  })
}
