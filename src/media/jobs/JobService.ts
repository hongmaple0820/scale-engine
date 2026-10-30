// Job service (v3 plan §4, M2): the single business layer every entry point
// (CLI, API, MCP, DSH) goes through. Single-writer via the repo's cross-process
// FileLock (held across the async pipeline); idempotency keys dedupe creates;
// a snapshot found mid-flight is recovered as `interrupted`, never faked.
//
// M2 adds governance before any provider spend: approval (ADR-7), daily budget
// reserve/settle, storage quota, and provider availability. Costs are recorded
// in the unified ModelUsageLedger (ADR-8), never in a second cost ledger.

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acquireFileSync, FileLockTimeoutError } from '../../core/FileLock.js'
import { logger } from '../../core/logger.js'
import { MediaError, toJobError } from '../errors.js'
import type {
  AssetRecord,
  ExportJobRequest,
  ImageJobRequest,
  MediaApprovalRef,
  MediaJob,
  MediaJobCost,
  MediaJobStatus,
  MediaJobType,
  MediaProviderHandle,
  SpeechJobRequest,
  Storyboard,
  VideoJobRequest,
} from '../types.js'
import { validateStoryboard } from '../validation/validateStoryboard.js'
import { validateExportRequest, validateVideoRequest, validateSpeechRequest } from '../validation/validateJobRequests.js'
import { renderStoryboard } from '../render/RenderOrchestrator.js'
import { runExport } from '../export/ExportOrchestrator.js'
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
import { recordMediaLedgerEvent } from './ledger.js'
import { observeTerminalState } from '../observations.js'
import { actionForJobType } from '../actions/registry.js'
import { estimateMediaJobCost, recordMediaCost } from '../cost/MediaCostAdapter.js'
import { generateImageForJob, validateImageRequest } from '../render/ImageOrchestrator.js'
import { generateVideoForJob } from '../render/VideoOrchestrator.js'
import { generateSpeechForJob } from '../render/SpeechOrchestrator.js'
import { getSpeechProvider, getVideoProvider } from '../providers/ProviderRegistry.js'
import { assertAssetRefsAvailable } from '../assets/materialize.js'
import { decideApproval } from '../approvals/policy.js'
import { notifyApprovalRequested } from '../approvals/notify.js'
import {
  decideApprovalRecord,
  findApproval,
  latestApprovals,
  requestApprovalRecord,
  sweepExpiredApprovals,
} from '../approvals/ApprovalStore.js'
import type { ApprovalRecord } from '../approvals/types.js'
import { budgetSummary, reserveBudget, settleBudget } from '../budget/BudgetLedger.js'
import { assertStorageAvailable } from '../storage/QuotaGuard.js'

const LOCK_ROOT = (workspace: MediaWorkspace) => join(workspace.projectDir, '.locks')
/** Run-lock TTLs: a long render must not be stolen mid-flight; a video poll
 *  may legitimately run for the maximum poll ceiling (3600s) plus download. */
export const RUN_LOCK_TTL_MS = 30 * 60 * 1000
export const VIDEO_RUN_LOCK_TTL_MS = 70 * 60 * 1000
const RUN_LOCK_WAIT_MS = 3000 // second writer fails fast instead of queueing blindly

export function runLockTtlMsFor(type: MediaJobType): number {
  return type === 'generate_video' ? VIDEO_RUN_LOCK_TTL_MS : RUN_LOCK_TTL_MS
}

export interface CreateJobOptions {
  root: string
  projectId?: string
  /** render (storyboard) by default; provider types use their request object */
  type?: MediaJobType
  storyboard?: Storyboard
  imageRequest?: Partial<ImageJobRequest>
  videoRequest?: Partial<VideoJobRequest>
  speechRequest?: Partial<SpeechJobRequest>
  exportRequest?: Partial<ExportJobRequest>
  requestedBy?: string
  idempotencyKey?: string
}

export interface RunJobOptions {
  root: string
  projectId?: string
  taskId: string
  ffmpegBin?: string
  ffprobeBin?: string
  /**
   * Re-checked under the run lock. Start endpoints pass 'created' so a
   * cross-process race cannot turn a /run into an implicit retry.
   */
  expectedStatus?: MediaJobStatus
}

export interface DecideJobApprovalOptions {
  root: string
  projectId?: string
  approvalId: string
  approve: boolean
  decidedBy?: string
  reason?: string
}

export interface DecideJobApprovalResult {
  approval: ApprovalRecord
  job?: MediaJob
}

function nowIso(): string {
  return new Date().toISOString()
}

function elapsedMs(startedAt: string | undefined): number | undefined {
  if (!startedAt) return undefined
  const started = Date.parse(startedAt)
  if (!Number.isFinite(started)) return undefined
  return Math.max(0, Date.now() - started)
}

function approvalRefOf(record: ApprovalRecord): MediaApprovalRef {
  return {
    id: record.id,
    status: record.status,
    mode: record.mode,
    requestedAt: record.requestedAt,
    expiresAt: record.expiresAt,
    estimatedCny: record.estimatedCny,
    ...(record.decidedAt ? { decidedAt: record.decidedAt } : {}),
    ...(record.decidedBy ? { decidedBy: record.decidedBy } : {}),
  }
}

function readRequestFile<T>(taskDir: string, name: string): T {
  return JSON.parse(readFileSync(join(taskDir, name), 'utf-8')) as T
}

function requestFileName(type: MediaJobType): string {
  switch (type) {
    case 'generate_image': return 'image-request.json'
    case 'generate_video': return 'video-request.json'
    case 'generate_speech': return 'speech-request.json'
    case 'export': return 'export-request.json'
    default: return 'storyboard.json'
  }
}

function estimateParams(
  type: MediaJobType,
  inputs: {
    storyboard?: Storyboard
    imageRequest?: ImageJobRequest
    videoRequest?: VideoJobRequest
    speechRequest?: SpeechJobRequest
    exportRequest?: ExportJobRequest
  },
): Record<string, unknown> {
  switch (type) {
    case 'render': return { storyboard: inputs.storyboard }
    case 'generate_image': return { imageRequest: inputs.imageRequest }
    case 'generate_video': return { videoRequest: inputs.videoRequest }
    case 'generate_speech': return { speechRequest: inputs.speechRequest }
    case 'export': return { exportRequest: inputs.exportRequest }
  }
}

function missingProvider(kind: 'video' | 'speech', providerId: string, featureEnv: string): MediaError {
  return new MediaError(
    'MEDIA_PROVIDER_UNAVAILABLE',
    `no ${kind} provider "${providerId}" is registered; set ${featureEnv}=mock to enable the deterministic test provider`,
  )
}

/**
 * Export preflight (M4): the source task must exist, be a succeeded render in
 * this project, and carry a real output file. The output video path is
 * re-resolved at run time by the export orchestrator (never trusted from the
 * snapshot alone).
 */
function assertExportSourceAvailable(workspace: MediaWorkspace, sourceTaskId: string): void {
  const found = findExportSource(workspace, sourceTaskId)
  const finalPath = join(found.dir, 'output', 'final.mp4')
  if (!existsSync(finalPath)) {
    throw new MediaError('MEDIA_EXPORT_SOURCE_INVALID', `source task "${sourceTaskId}" has no output/final.mp4`)
  }
}

function findExportSource(workspace: MediaWorkspace, sourceTaskId: string): { dir: string; job: MediaJob } {
  let found: { dir: string; job: MediaJob }
  try {
    found = findJob(workspace, sourceTaskId)
  } catch (error) {
    if (error instanceof MediaError && error.code === 'MEDIA_JOB_NOT_FOUND') {
      throw new MediaError('MEDIA_EXPORT_SOURCE_INVALID', `source task "${sourceTaskId}" does not exist in project "${workspace.projectId}"`)
    }
    throw error
  }
  if (found.job.status !== 'succeeded') {
    throw new MediaError('MEDIA_EXPORT_SOURCE_INVALID', `source task "${sourceTaskId}" is "${found.job.status}", not "succeeded"`)
  }
  if (found.job.type !== 'render') {
    throw new MediaError('MEDIA_EXPORT_SOURCE_INVALID', `source task "${sourceTaskId}" is a "${found.job.type}" task; only render tasks can be exported`)
  }
  return found
}

const JOB_TYPES: readonly MediaJobType[] = ['render', 'generate_image', 'generate_video', 'generate_speech', 'export']

export function createJob(options: CreateJobOptions): { job: MediaJob; taskDir: string; deduplicated: boolean } {
  const workspace = openWorkspace(options.root, options.projectId)
  const type = options.type ?? 'render'
  // REST/MCP pass caller strings at runtime; never fall through to the render
  // branch with an unknown type.
  if (!JOB_TYPES.includes(type)) {
    throw new MediaError('MEDIA_ACTION_UNKNOWN', `unknown media task type "${String(type)}"`)
  }

  return withLockedSync(workspace, 'media-create', () => {
    // Idempotency dedupe runs before validation: replaying a request body that
    // was legal when the job was created must keep returning that job even if
    // the validator has since become stricter.
    if (options.idempotencyKey) {
      const existing = findJobByIdempotencyKey(workspace, options.idempotencyKey)
      if (existing) {
        recordMediaLedgerEvent(workspace.root, existing, {
          type: 'tool.invoked',
          summary: `media.create ${existing.type}`,
          metadata: { actionId: actionForJobType(existing.type)?.id ?? null, deduplicated: true },
        })
        return { job: existing, taskDir: taskDirOf(workspace, existing.id), deduplicated: true }
      }
    }

    let storyboard: Storyboard | undefined
    let imageRequest: ImageJobRequest | undefined
    let videoRequest: VideoJobRequest | undefined
    let speechRequest: SpeechJobRequest | undefined
    let exportRequest: ExportJobRequest | undefined
    switch (type) {
      case 'render': {
        storyboard = options.storyboard as Storyboard
        const validation = validateStoryboard(storyboard)
        if (!validation.ok) {
          throw new MediaError('MEDIA_STORYBOARD_INVALID', `storyboard rejected:\n- ${validation.errors.join('\n- ')}`)
        }
        // create-time asset ref check: source tasks must already exist and be
        // succeeded; no copying happens until render (and it runs after dedupe
        // above, so a replay still returns its existing job).
        assertAssetRefsAvailable(workspace, storyboard)
        break
      }
      case 'generate_image':
        imageRequest = validateImageRequest(options.imageRequest)
        break
      case 'generate_video':
        videoRequest = validateVideoRequest(options.videoRequest)
        if (!getVideoProvider(videoRequest.providerId)) {
          throw missingProvider('video', videoRequest.providerId, 'MEDIA_FEATURE_VIDEO')
        }
        break
      case 'generate_speech':
        speechRequest = validateSpeechRequest(options.speechRequest)
        if (!getSpeechProvider(speechRequest.providerId)) {
          throw missingProvider('speech', speechRequest.providerId, 'MEDIA_FEATURE_SPEECH')
        }
        break
      case 'export':
        exportRequest = validateExportRequest(options.exportRequest)
        // The source must already be a succeeded render in this project; the
        // export itself only runs ffmpeg locally, but the source contract is
        // checked up front so invalid requests never create a task dir.
        assertExportSourceAvailable(workspace, exportRequest.sourceTaskId)
        break
    }

    const action = actionForJobType(type)
    if (!action) throw new MediaError('MEDIA_ACTION_UNKNOWN', `no action catalog entry for job type "${type}"`)
    const cost: MediaJobCost = estimateMediaJobCost(action.id, estimateParams(type, { storyboard, imageRequest, videoRequest, speechRequest, exportRequest }))
    const decision = decideApproval(action, cost.estimatedCny)

    const taskId = `job-${nowIso().slice(0, 10)}-${randomUUID().slice(0, 8)}`
    const taskDir = createTaskDir(workspace, taskId)

    let approvalRef: MediaApprovalRef | undefined
    let status: MediaJobStatus = 'created'
    if (decision.required) {
      const record = requestApprovalRecord({
        root: workspace.root,
        taskId,
        projectId: workspace.projectId,
        jobType: type,
        actionId: action.id,
        mode: decision.mode ?? 'threshold',
        estimatedCny: cost.estimatedCny,
        ...(decision.thresholdCny === undefined ? {} : { thresholdCny: decision.thresholdCny }),
      })
      approvalRef = approvalRefOf(record)
      status = 'awaiting_approval'
    }

    const job: MediaJob = {
      id: taskId,
      projectId: workspace.projectId,
      type,
      status,
      schemaVersion: 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      requestedBy: options.requestedBy ?? 'cli',
      idempotencyKey: options.idempotencyKey,
      input: {
        ...(storyboard ? { storyboardFile: 'storyboard.json' } : {}),
        ...(imageRequest ? { imageRequestFile: 'image-request.json' } : {}),
        ...(videoRequest ? { videoRequestFile: 'video-request.json' } : {}),
        ...(speechRequest ? { speechRequestFile: 'speech-request.json' } : {}),
        ...(exportRequest ? { exportRequestFile: 'export-request.json' } : {}),
      },
      attempt: 1,
      outputs: [],
      cost,
      ...(approvalRef ? { approval: approvalRef } : {}),
    }
    writeFileSync(join(taskDir, requestFileName(type)), JSON.stringify(
      storyboard ?? imageRequest ?? videoRequest ?? speechRequest ?? exportRequest,
      null,
      1,
    ), 'utf-8')
    writeSnapshot(taskDir, job)
    appendJobEvent(taskDir, {
      at: nowIso(),
      type: 'created',
      data: {
        requestedBy: job.requestedBy,
        idempotencyKey: options.idempotencyKey,
        jobType: type,
        status,
        estimatedCny: cost.estimatedCny,
        ...(approvalRef ? { approvalId: approvalRef.id, approvalMode: approvalRef.mode } : {}),
      },
    })
    recordMediaLedgerEvent(workspace.root, job, {
      type: 'tool.invoked',
      summary: `media.create ${type}`,
      metadata: {
        actionId: action.id,
        deduplicated: false,
        estimatedCny: cost.estimatedCny,
        ...(approvalRef ? { approvalId: approvalRef.id, approvalStatus: approvalRef.status } : {}),
      },
    })
    if (approvalRef) {
      recordMediaLedgerEvent(workspace.root, job, {
        type: 'approval.requested',
        summary: `media.approval.requested ${type}`,
        metadata: {
          actionId: action.id,
          approvalId: approvalRef.id,
          approvalMode: approvalRef.mode,
          estimatedCny: cost.estimatedCny,
          ...(decision.thresholdCny === undefined ? {} : { thresholdCny: decision.thresholdCny }),
          reason: decision.reason,
        },
      })
      // M4 best-effort notification (webhook/Feishu); failure never blocks or
      // reverts the approval request — the outcome is recorded in the event.
      const notified = notifyApprovalRequested({
        approvalId: approvalRef.id,
        taskId,
        projectId: workspace.projectId,
        jobType: type,
        estimatedCny: cost.estimatedCny,
        expiresAt: approvalRef.expiresAt,
      })
      appendJobEvent(taskDir, {
        at: nowIso(),
        type: 'approval_notified',
        data: { channel: notified.channel, ok: notified.ok, ...(notified.reason ? { reason: notified.reason } : {}) },
      })
    }
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
  const workspace = openWorkspace(root, projectId)
  const found = findJob(workspace, taskId)
  // Task detail is a lazy expiry checkpoint (plan M2): an overdue pending
  // approval turns its task into `cancelled` instead of leaving it parked.
  if (found.job.status === 'awaiting_approval') {
    sweepExpiredApprovalJobs(workspace.root, workspace.projectId)
    return { job: findJob(workspace, taskId).job, taskDir: found.dir }
  }
  return { job: found.job, taskDir: found.dir }
}

export function listProjectJobs(root: string, projectId?: string): MediaJob[] {
  return listJobs(openWorkspace(root, projectId))
}

export function readJobStoryboard(root: string, projectId: string | undefined, taskId: string): Storyboard {
  const { dir } = findJob(openWorkspace(root, projectId), taskId)
  return JSON.parse(readFileSync(join(dir, 'storyboard.json'), 'utf-8')) as Storyboard
}

function runLockTtlFor(job: MediaJob): number {
  return runLockTtlMsFor(job.type)
}

function acquireRunLock(workspace: MediaWorkspace, ttlMs: number): ReturnType<typeof acquireFileSync> {
  try {
    return acquireFileSync('media-run', LOCK_ROOT(workspace), { ttlMs, waitMs: RUN_LOCK_WAIT_MS })
  } catch (error) {
    if (error instanceof FileLockTimeoutError) {
      throw new MediaError('MEDIA_LOCK_TIMEOUT', 'another media job is running in this project; retry when it finishes', { retryable: true })
    }
    throw error
  }
}

/**
 * Run (or continue) a job. Legal from created/validated/failed/interrupted and
 * (after an approval decision) from awaiting_approval. A snapshot found
 * mid-flight is first recovered as interrupted; video jobs keep their provider
 * handle so the retry reattaches instead of paying for a second submission.
 */
export async function runJob(options: RunJobOptions): Promise<MediaJob> {
  const workspace = openWorkspace(options.root, options.projectId)
  let ttlMs = RUN_LOCK_TTL_MS
  try {
    ttlMs = runLockTtlFor(findJob(workspace, options.taskId).job)
  } catch {
    // not-found surfaces under the lock with the normal error code
  }
  // Acquire before the async pipeline so lock contention is a start failure
  // the caller can surface (MEDIA_LOCK_TIMEOUT), not a silent detached no-op.
  const lock = acquireRunLock(workspace, ttlMs)
  try {
    return await runLocked(workspace, options)
  } finally {
    lock.release()
  }
}

function validateStoredRequest(workspace: MediaWorkspace, taskDir: string, job: MediaJob): void {
  switch (job.type) {
    case 'render': {
      const storyboard = readRequestFile<Storyboard>(taskDir, 'storyboard.json')
      const validation = validateStoryboard(storyboard)
      if (!validation.ok) {
        throw new MediaError('MEDIA_STORYBOARD_INVALID', 'storyboard still invalid; create a new job with fixed input')
      }
      assertAssetRefsAvailable(workspace, storyboard)
      break
    }
    case 'generate_image':
      validateImageRequest(readRequestFile(taskDir, 'image-request.json'))
      break
    case 'generate_video':
      validateVideoRequest(readRequestFile(taskDir, 'video-request.json'))
      break
    case 'generate_speech':
      validateSpeechRequest(readRequestFile(taskDir, 'speech-request.json'))
      break
    case 'export':
      validateExportRequest(readRequestFile(taskDir, 'export-request.json'))
      assertExportSourceAvailable(workspace, readRequestFile<ExportJobRequest>(taskDir, 'export-request.json').sourceTaskId)
      break
  }
}

async function runLocked(workspace: MediaWorkspace, options: RunJobOptions): Promise<MediaJob> {
  const found = findJob(workspace, options.taskId)
  const taskDir = found.dir
  const job = found.job
  if (options.expectedStatus && job.status !== options.expectedStatus) {
    throw new MediaError(
      'MEDIA_ACTION_INVALID_STATE',
      `task "${job.id}" in status "${job.status}" cannot be started; expected "${options.expectedStatus}"`,
    )
  }
  if (job.status === 'succeeded' || job.status === 'cancelled') return job
  if (INTERRUPTIBLE_STATUSES.includes(job.status)) {
    job.status = 'interrupted'
    job.error = { code: 'MEDIA_JOB_INTERRUPTED', message: 'recovered from a mid-flight process exit; retrying', retryable: true }
    writeSnapshot(taskDir, job)
  }

  // Approval gate: normally the decision endpoint flips the job back to
  // `created`, so reaching here means an external/decision race. Re-check.
  if (job.status === 'awaiting_approval') {
    const record = job.approval ? findApproval(workspace.root, job.approval.id) : undefined
    if (!record) throw new MediaError('MEDIA_APPROVAL_INVALID', `approval record for task "${job.id}" is missing`)
    if (record.status === 'pending') {
      throw new MediaError('MEDIA_APPROVAL_REQUIRED', `task "${job.id}" is awaiting approval "${record.id}"`, { retryable: true })
    }
    if (record.status !== 'approved') {
      throw new MediaError('MEDIA_APPROVAL_INVALID', `approval "${record.id}" is ${record.status}; the task cannot run`)
    }
    assertTransition('awaiting_approval', 'created')
    job.status = 'created'
    job.approval = approvalRefOf(record)
    writeSnapshot(taskDir, job)
  }

  const isRetry = Boolean(job.error)
  const reattachHandle: MediaProviderHandle | undefined =
    job.status === 'interrupted' && job.type === 'generate_video' ? job.provider : undefined

  if (job.status === 'created') {
    assertTransition('created', 'validated')
    job.status = 'validated'
    writeSnapshot(taskDir, job)
  }
  if (job.status === 'failed_validation') {
    validateStoredRequest(workspace, taskDir, job)
    assertTransition('failed_validation', 'validated')
    job.status = 'validated'
    writeSnapshot(taskDir, job)
  }

  // Preflight before any provider spend: storage, provider availability, budget.
  assertStorageAvailable(workspace)
  assertTransition(job.status, 'running')
  if (job.type === 'generate_video') {
    const request = readRequestFile<VideoJobRequest>(taskDir, 'video-request.json')
    if (!getVideoProvider(request.providerId)) throw missingProvider('video', request.providerId, 'MEDIA_FEATURE_VIDEO')
  }
  if (job.type === 'generate_speech') {
    const request = readRequestFile<SpeechJobRequest>(taskDir, 'speech-request.json')
    if (!getSpeechProvider(request.providerId)) throw missingProvider('speech', request.providerId, 'MEDIA_FEATURE_SPEECH')
  }
  const estimatedCny = job.cost?.estimatedCny ?? null
  const billable = job.type !== 'render' || (estimatedCny ?? 0) > 0
  if (billable) {
    reserveBudget({ root: workspace.root, taskId: job.id, projectId: workspace.projectId, estimatedCny })
  }

  job.status = 'running'
  job.startedAt = nowIso()
  if (isRetry) job.attempt += 1
  job.error = undefined
  writeSnapshot(taskDir, job)
  appendJobEvent(taskDir, { at: nowIso(), type: 'running', data: { attempt: job.attempt, reattached: Boolean(reattachHandle) } })
  recordMediaLedgerEvent(workspace.root, job, {
    type: 'task.started',
    summary: `media.run ${job.type}`,
    metadata: { actionId: actionForJobType(job.type)?.id ?? null, attempt: job.attempt, retry: isRetry },
  })

  const cancelFlag = join(taskDir, 'cancel.requested')
  const isCancelled = () => existsSync(cancelFlag)
  const onStage = (info: { stage: string; ms: number }) => {
    job.stage = info.stage
    writeSnapshot(taskDir, job)
  }

  let costModel: string | undefined
  try {
    let output: AssetRecord
    let extras: AssetRecord[] | undefined
    let providerUsage: Record<string, unknown> | undefined
    switch (job.type) {
      case 'generate_image': {
        const request = readRequestFile<ImageJobRequest>(taskDir, 'image-request.json')
        const outcome = await generateImageForJob({ taskDir, taskId: job.id, request, isCancelled, onStage })
        output = outcome.output
        break
      }
      case 'generate_video': {
        const request = validateVideoRequest(readRequestFile(taskDir, 'video-request.json'))
        const provider = getVideoProvider(request.providerId)
        if (!provider) throw missingProvider('video', request.providerId, 'MEDIA_FEATURE_VIDEO')
        if (!reattachHandle) job.provider = undefined
        const outcome = await generateVideoForJob({
          taskDir,
          taskId: job.id,
          request,
          provider,
          ...(reattachHandle ? { existingHandle: reattachHandle } : {}),
          isCancelled,
          onStage,
          onSubmitted: handle => {
            job.provider = handle
            writeSnapshot(taskDir, job)
          },
        })
        output = outcome.output
        providerUsage = outcome.usage
        costModel = request.model
        break
      }
      case 'generate_speech': {
        const request = validateSpeechRequest(readRequestFile(taskDir, 'speech-request.json'))
        const provider = getSpeechProvider(request.providerId)
        if (!provider) throw missingProvider('speech', request.providerId, 'MEDIA_FEATURE_SPEECH')
        const outcome = await generateSpeechForJob({ taskDir, taskId: job.id, request, provider, isCancelled, onStage })
        output = outcome.output
        providerUsage = outcome.usage
        costModel = request.model
        break
      }
      case 'export': {
        const request = validateExportRequest(readRequestFile(taskDir, 'export-request.json'))
        const source = findExportSource(workspace, request.sourceTaskId)
        const outcome = await runExport({
          taskDir,
          taskId: job.id,
          request,
          sourceTask: { id: source.job.id, dir: source.dir },
          isCancelled,
          onStage,
          ffmpegBin: options.ffmpegBin,
          ffprobeBin: options.ffprobeBin,
        })
        output = outcome.output
        extras = outcome.extras
        break
      }
      default: {
        const storyboard = readRequestFile<Storyboard>(taskDir, 'storyboard.json')
        const outcome = await renderStoryboard({
          workspace,
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
        extras = outcome.extras
      }
    }

    const usageCost = providerUsage && typeof providerUsage.costCny === 'number' && Number.isFinite(providerUsage.costCny)
      ? providerUsage.costCny
      : undefined
    const actualCny = usageCost ?? job.cost?.estimatedCny ?? null
    if (job.cost) job.cost = { ...job.cost, actualCny }
    settleBudget({ root: workspace.root, taskId: job.id, actualCny })
    recordMediaCost({ root: workspace.root, job, actualCny, ...(costModel ? { model: costModel } : {}) })
    // Plan M2: warn when the actual exceeds the reserved estimate by >20% so
    // an underpriced catalog entry is visible even though the work is done.
    const estimateCny = job.cost?.estimatedCny
    if (
      typeof estimateCny === 'number' && estimateCny > 0 &&
      typeof actualCny === 'number' && actualCny > estimateCny * 1.2
    ) {
      logger.warn(
        { taskId: job.id, jobType: job.type, estimateCny, actualCny },
        'media cost exceeded the reserved estimate by more than 20%',
      )
    }

    assertTransition('running', 'packaging')
    job.status = 'packaging'
    writeSnapshot(taskDir, job)
    assertTransition('packaging', 'succeeded')
    job.status = 'succeeded'
    job.stage = undefined
    job.outputs = extras && extras.length > 0 ? [output, ...extras] : [output]
    job.finishedAt = nowIso()
    writeSnapshot(taskDir, job)
    appendJobEvent(taskDir, { at: nowIso(), type: 'succeeded', data: { outputSha256: output.sha256, bytes: output.bytes } })
    recordMediaLedgerEvent(workspace.root, job, {
      type: 'evidence.recorded',
      summary: `media.succeeded ${job.type}`,
      duration: elapsedMs(job.startedAt),
      metadata: {
        actionId: actionForJobType(job.type)?.id ?? null,
        outcome: 'succeeded',
        outputSha256: output.sha256,
        outputBytes: output.bytes,
        costCny: actualCny,
      },
    })
    return job
  } catch (error) {
    const jobError = toJobError(error)
    // Terminal accounting: keep the estimate for failures/cancellations (never
    // invent spend, but also never release an estimate that may have been used).
    settleBudget({ root: workspace.root, taskId: job.id, actualCny: null })
    recordMediaCost({ root: workspace.root, job, actualCny: null, ...(costModel ? { model: costModel } : {}) })

    if (jobError.code === 'MEDIA_JOB_CANCELLED') {
      job.status = 'cancelled'
      job.error = jobError
      job.finishedAt = nowIso()
      writeSnapshot(taskDir, job)
      appendJobEvent(taskDir, { at: nowIso(), type: 'cancelled' })
      recordMediaLedgerEvent(workspace.root, job, {
        type: 'task.cancelled',
        summary: `media.cancelled ${job.type}`,
        duration: elapsedMs(job.startedAt),
        metadata: { actionId: actionForJobType(job.type)?.id ?? null, outcome: 'cancelled' },
      })
      // M5 observation (best-effort, never throws): only approval rejections
      // produce a record; operator cancels are not a learning signal.
      observeTerminalState(workspace.root, job)
      return job
    }
    job.status = 'failed'
    job.error = jobError
    job.finishedAt = nowIso()
    writeSnapshot(taskDir, job)
    appendJobEvent(taskDir, { at: nowIso(), type: 'failed', data: jobError })
    recordMediaLedgerEvent(workspace.root, job, {
      type: 'evidence.recorded',
      summary: `media.failed ${job.type}`,
      duration: elapsedMs(job.startedAt),
      metadata: {
        actionId: actionForJobType(job.type)?.id ?? null,
        outcome: 'failed',
        errorCode: jobError.code,
      },
    })
    // M5 observation (plan: 失败不影响任务结果) — runs before the rethrow and
    // swallows its own errors so the throw below always carries the real cause.
    observeTerminalState(workspace.root, job, { rootCause: jobError.message })
    throw error
  }
}

export function cancelJob(root: string, projectId: string | undefined, taskId: string): MediaJob {
  const workspace = openWorkspace(root, projectId)
  const found = findJob(workspace, taskId)
  if (['succeeded', 'cancelled'].includes(found.job.status)) return found.job
  // Cooperative cancel must not queue behind the run lock: the runner holds it
  // for the whole pipeline, so waiting here would stall (and time out) exactly
  // when cancellation matters most — a long video poll.
  if (['running', 'packaging'].includes(found.job.status)) {
    writeFileSync(join(found.dir, 'cancel.requested'), nowIso(), 'utf-8')
    appendJobEvent(found.dir, { at: nowIso(), type: 'cancel_requested' })
    return readSnapshot(found.dir)
  }
  return withLockedSync(workspace, 'media-run', () => {
    const { dir: taskDir, job } = findJob(workspace, taskId)
    if (['succeeded', 'cancelled'].includes(job.status)) return job
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
    recordMediaLedgerEvent(workspace.root, job, {
      type: 'task.cancelled',
      summary: `media.cancelled ${job.type}`,
      metadata: { actionId: actionForJobType(job.type)?.id ?? null, outcome: 'cancelled' },
    })
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
  // Expiry checkpoint before recovery: an overdue pending approval cancels its
  // parked task, and recovery must never restart an awaiting task.
  sweepExpiredApprovalJobs(root, projectId)
  const workspace = openWorkspace(root, projectId)
  return withLockedSync(workspace, 'media-run', () => {
    const recovered = recoverInterruptedJobs(workspace)
    for (const taskId of recovered) {
      const { job } = findJob(workspace, taskId)
      if (job.status === 'failed' && job.error?.code === 'MEDIA_PROVIDER_TIMEOUT') {
        recordMediaLedgerEvent(workspace.root, job, {
          type: 'evidence.recorded',
          summary: `media.provider_expired ${job.type}`,
          metadata: {
            actionId: actionForJobType(job.type)?.id ?? null,
            outcome: 'failed',
            errorCode: job.error.code,
            providerJobId: job.provider?.jobId ?? null,
          },
        })
        continue
      }
      recordMediaLedgerEvent(workspace.root, job, {
        type: 'evidence.recorded',
        summary: `media.interrupted ${job.type}`,
        metadata: { actionId: actionForJobType(job.type)?.id ?? null, outcome: 'interrupted' },
      })
    }
    return recovered
  }, {
    ttlMs: RUN_LOCK_TTL_MS,
    waitMs: RUN_LOCK_WAIT_MS,
  })
}

/**
 * Approve or reject a pending request. Approving flips the job back to
 * `created` so the normal run endpoint can start it; rejecting cancels it.
 */
export function decideJobApproval(options: DecideJobApprovalOptions): DecideJobApprovalResult {
  const workspace = openWorkspace(options.root, options.projectId)
  return withLockedSync(workspace, 'media-create', () => {
    let record: ApprovalRecord
    try {
      record = decideApprovalRecord({
        root: workspace.root,
        id: options.approvalId,
        approve: options.approve,
        decidedBy: options.decidedBy ?? 'dashboard',
        ...(options.reason ? { reason: options.reason } : {}),
      })
    } catch (error) {
      // Deciding an already-expired request still has to release the parked
      // task: the sweep path cannot be reused here (we hold the create lock).
      if (error instanceof MediaError && error.code === 'MEDIA_APPROVAL_EXPIRED') {
        const expired = findApproval(workspace.root, options.approvalId)
        if (expired) applyExpiredApproval(workspace, expired)
      }
      throw error
    }

    let found: { dir: string; job: MediaJob } | undefined
    try {
      found = findJob(workspace, record.taskId)
    } catch {
      found = undefined // task removed: the approval record still stands
    }
    if (!found) return { approval: record }

    const { dir: taskDir, job } = found
    if (job.status === 'awaiting_approval') {
      job.approval = approvalRefOf(record)
      if (record.status === 'approved') {
        assertTransition('awaiting_approval', 'created')
        job.status = 'created'
      } else {
        assertTransition('awaiting_approval', 'cancelled')
        job.status = 'cancelled'
        job.finishedAt = nowIso()
      }
      writeSnapshot(taskDir, job)
      appendJobEvent(taskDir, {
        at: nowIso(),
        type: record.status === 'approved' ? 'approval_approved' : 'approval_rejected',
        data: { approvalId: record.id, decidedBy: record.decidedBy },
      })
      // M5 observation (best-effort): an explicit rejection is a learning
      // signal (plan kind 'approval_rejected'); the approval's action id is
      // authoritative over the job-type-derived default.
      if (record.status === 'rejected' && record.actionId) {
        observeTerminalState(workspace.root, job, { actionId: record.actionId })
      }
    }
    recordMediaLedgerEvent(workspace.root, job, {
      type: 'approval.resolved',
      summary: `media.approval.${record.status}`,
      metadata: {
        actionId: actionForJobType(job.type)?.id ?? null,
        approvalId: record.id,
        approvalStatus: record.status,
        decidedBy: record.decidedBy ?? null,
      },
    })
    return { approval: record, job }
  })
}

/** Latest approval records for a project, lazily expiring overdue pendings. */
export function listProjectApprovals(root: string, projectId?: string): ApprovalRecord[] {
  sweepExpiredApprovalJobs(root, projectId)
  const workspace = openWorkspace(root, projectId)
  return latestApprovals(workspace.root, workspace.projectId)
}

/**
 * Lazy expiry checkpoint (plan M2): mark overdue pendings and release the
 * tasks they parked (awaiting_approval → cancelled). Never runs the task.
 */
export function sweepExpiredApprovalJobs(root: string, projectId?: string): ApprovalRecord[] {
  const workspace = openWorkspace(root, projectId)
  const expired = sweepExpiredApprovals(workspace.root, workspace.projectId)
  for (const record of expired) {
    // Cheap unlocked pre-check first; most expired records have no parked task.
    try {
      const { job } = findJob(workspace, record.taskId)
      if (job.status !== 'awaiting_approval' || job.approval?.id !== record.id) continue
    } catch {
      continue
    }
    withLockedSync(workspace, 'media-create', () => applyExpiredApproval(workspace, record), {
      ttlMs: RUN_LOCK_TTL_MS,
      waitMs: RUN_LOCK_WAIT_MS,
    })
  }
  return expired
}

/** Caller holds the `media-create` lock. */
function applyExpiredApproval(workspace: MediaWorkspace, record: ApprovalRecord): void {
  let found: { dir: string; job: MediaJob }
  try {
    found = findJob(workspace, record.taskId)
  } catch {
    return // task removed: the approval record still stands on its own
  }
  const { dir: taskDir, job } = found
  if (job.status !== 'awaiting_approval' || job.approval?.id !== record.id) return
  assertTransition('awaiting_approval', 'cancelled')
  job.status = 'cancelled'
  job.approval = approvalRefOf(record)
  job.error = {
    code: 'MEDIA_APPROVAL_EXPIRED',
    message: `approval "${record.id}" expired before a decision`,
    retryable: false,
  }
  job.finishedAt = nowIso()
  writeSnapshot(taskDir, job)
  appendJobEvent(taskDir, { at: nowIso(), type: 'approval_expired', data: { approvalId: record.id } })
  recordMediaLedgerEvent(workspace.root, job, {
    type: 'task.cancelled',
    summary: 'media.approval.expired',
    metadata: {
      actionId: actionForJobType(job.type)?.id ?? null,
      approvalId: record.id,
      approvalStatus: record.status,
      outcome: 'cancelled',
    },
  })
  recordMediaLedgerEvent(workspace.root, job, {
    type: 'approval.resolved',
    summary: 'media.approval.expired',
    metadata: {
      actionId: actionForJobType(job.type)?.id ?? null,
      approvalId: record.id,
      approvalStatus: record.status,
      decidedBy: record.decidedBy ?? 'system',
    },
  })
}

export function projectBudgetSummary(root: string, projectId?: string): ReturnType<typeof budgetSummary> {
  const workspace = openWorkspace(root, projectId)
  return budgetSummary(workspace.root)
}
