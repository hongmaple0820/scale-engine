// Video orchestrator (M2): submit → persist handle → poll → download → commit.
// Providers only speak their own protocol; this module owns persistence
// (onSubmitted fires before the first poll so a crash can reattach), timeouts,
// cancellation and the download SSRF/size guards.
//
// The provider never controls a local path: the output is always
// `assets/generated.<ext>` with the extension derived from the response
// content-type, and downloads are written to a `.part` file then renamed.

import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { MediaError } from '../errors.js'
import type { AssetRecord, MediaProviderHandle, VideoJobRequest } from '../types.js'
import type { MediaProvider, VideoPollResult } from '../providers/types.js'
import { isProviderUrlAllowed } from '../providers/image/OpenAICompatibleImageProvider.js'
import { EvidenceWriter } from '../evidence/EvidenceWriter.js'
import { appendJobEvent } from '../jobs/JobStore.js'
import { sha256Buffer } from '../assets/hash.js'

const DEFAULT_POLL_TIMEOUT_SECONDS = 1800
const MIN_POLL_TIMEOUT_SECONDS = 10
const MAX_POLL_TIMEOUT_SECONDS = 3600
const MIN_POLL_MS = 250
const MAX_POLL_MS = 30_000
const DEFAULT_POLL_MS = 2000
const DOWNLOAD_TIMEOUT_MS = 60_000
const DEFAULT_MAX_VIDEO_MB = 512
/** Plan M2: reference images travel inline, so keep the payload bounded. */
export const MAX_FIRST_FRAME_BYTES = 10 * 1024 * 1024

export interface VideoOrchestratorOptions {
  taskDir: string
  taskId: string
  request: VideoJobRequest
  provider: MediaProvider
  /** persisted handle from a previous process — poll it instead of resubmitting */
  existingHandle?: MediaProviderHandle
  isCancelled?: () => boolean
  onStage?: (info: { stage: string; ms: number }) => void
  /** called once, before the first poll; JobService persists the snapshot here */
  onSubmitted?: (handle: MediaProviderHandle) => void
  evidence?: EvidenceWriter
}

export interface VideoOutcome {
  output: AssetRecord
  handle: MediaProviderHandle
  usage?: Record<string, unknown>
}

function clampPollTimeout(seconds: number | undefined): number {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return DEFAULT_POLL_TIMEOUT_SECONDS
  return Math.min(MAX_POLL_TIMEOUT_SECONDS, Math.max(MIN_POLL_TIMEOUT_SECONDS, Math.floor(seconds)))
}

function clampPollMs(ms: number | undefined): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return DEFAULT_POLL_MS
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, Math.floor(ms)))
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function maxVideoBytes(): number {
  const raw = process.env.MEDIA_VIDEO_MAX_MB?.trim()
  const value = raw ? Number(raw) : Number.NaN
  const mb = Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_VIDEO_MB
  return mb * 1024 * 1024
}

/** First frame must stay inside the task dir; returns an absolute path. */
function resolveFirstFrame(taskDir: string, assetPath: string | undefined): string | undefined {
  if (!assetPath) return undefined
  const base = resolve(taskDir)
  const resolved = resolve(base, assetPath)
  const rel = relative(base, resolved)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new MediaError('MEDIA_VIDEO_REQUEST_INVALID', 'firstFrameAssetPath escapes the task directory')
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    throw new MediaError('MEDIA_VIDEO_REQUEST_INVALID', 'firstFrameAssetPath points at a missing file')
  }
  const size = statSync(resolved).size
  if (size > MAX_FIRST_FRAME_BYTES) {
    throw new MediaError(
      'MEDIA_VIDEO_REQUEST_INVALID',
      `firstFrameAssetPath is ${size} bytes, over the ${MAX_FIRST_FRAME_BYTES} byte reference-image limit`,
    )
  }
  return resolved
}

function extensionFor(contentType: string | undefined): string {
  if (contentType?.includes('webm')) return 'webm'
  if (contentType?.includes('quicktime')) return 'mov'
  return 'mp4'
}

interface DownloadedVideo {
  data: Buffer
  contentType: string
}

async function downloadVideo(url: string): Promise<DownloadedVideo> {
  const guard = isProviderUrlAllowed(url)
  if (!guard.ok) {
    throw new MediaError('MEDIA_PROVIDER_DOWNLOAD_REJECTED', guard.reason ?? 'provider download URL is not allowed')
  }
  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  } catch (error) {
    throw new MediaError(
      'MEDIA_PROVIDER_REQUEST_FAILED',
      `video download failed: ${error instanceof Error ? error.message : String(error)}`,
      { retryable: true },
    )
  }
  if (!response.ok) {
    throw new MediaError('MEDIA_PROVIDER_REQUEST_FAILED', `video download returned HTTP ${response.status}`, {
      retryable: response.status === 429 || response.status >= 500,
    })
  }
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
  if (!contentType.startsWith('video/') && !contentType.startsWith('application/octet-stream')) {
    throw new MediaError('MEDIA_PROVIDER_DOWNLOAD_REJECTED', `download is not a video: ${contentType || 'unknown content-type'}`)
  }
  const limit = maxVideoBytes()
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > limit) {
    throw new MediaError('MEDIA_QUOTA_EXCEEDED', `video download declares ${declared} bytes, over the ${limit} byte limit`)
  }
  const data = Buffer.from(await response.arrayBuffer())
  if (data.length === 0) {
    throw new MediaError('MEDIA_PROVIDER_RESPONSE_INVALID', 'video download returned an empty body')
  }
  if (data.length > limit) {
    throw new MediaError('MEDIA_QUOTA_EXCEEDED', `video download is ${data.length} bytes, over the ${limit} byte limit`)
  }
  return { data, contentType }
}

function writeOutput(taskDir: string, extension: string, data: Buffer): string {
  const assetsDir = join(taskDir, 'assets')
  mkdirSync(assetsDir, { recursive: true })
  const dest = join(assetsDir, `generated.${extension}`)
  const part = `${dest}.part`
  try {
    writeFileSync(part, data)
    renameSync(part, dest)
  } catch (error) {
    try { rmSync(part, { force: true }) } catch { /* temp only */ }
    throw error
  }
  return dest
}

async function cancelBestEffort(provider: MediaProvider, handle: MediaProviderHandle, evidence: EvidenceWriter, taskDir: string): Promise<void> {
  if (!provider.cancelVideo) return
  try {
    await provider.cancelVideo(handle.jobId)
    evidence.append('video_cancel_requested', 'ok', { providerJobId: handle.jobId })
  } catch (error) {
    evidence.append('video_cancel_requested', 'error', {
      providerJobId: handle.jobId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  appendJobEvent(taskDir, { at: new Date().toISOString(), type: 'provider_cancel_requested', data: { providerJobId: handle.jobId } })
}

export async function generateVideoForJob(options: VideoOrchestratorOptions): Promise<VideoOutcome> {
  const { taskDir, taskId, request, provider } = options
  const evidence = options.evidence ?? new EvidenceWriter(taskDir, taskId)
  const isCancelled = options.isCancelled ?? (() => false)
  if (!provider.submitVideo || !provider.pollVideo) {
    throw new MediaError('MEDIA_PROVIDER_UNAVAILABLE', `provider "${provider.id}" cannot generate video`)
  }

  let handle = options.existingHandle
  if (!handle) {
    if (isCancelled()) throw new MediaError('MEDIA_JOB_CANCELLED', 'cancelled before video submission')
    const submittedAt = new Date()
    const firstFramePath = resolveFirstFrame(taskDir, request.firstFrameAssetPath)
    const submit = await provider.submitVideo({
      prompt: request.prompt,
      durationSeconds: request.durationSeconds,
      aspectRatio: request.aspectRatio ?? '16:9',
      resolution: request.resolution ?? '720p',
      ...(request.model ? { model: request.model } : {}),
      ...(firstFramePath ? { firstFramePath } : {}),
    })
    handle = {
      providerId: provider.id,
      jobId: submit.jobId,
      submittedAt: submittedAt.toISOString(),
      pollAfterMs: clampPollMs(submit.pollAfterMs),
      deadlineAt: new Date(
        submittedAt.getTime() + clampPollTimeout(request.pollTimeoutSeconds) * 1000,
      ).toISOString(),
      ...(submit.metadata ? { metadata: submit.metadata } : {}),
    }
    // Persist before polling: a crash now leaves a handle recovery can reattach.
    options.onSubmitted?.(handle)
    evidence.append('video_submitted', 'ok', { provider: provider.id, providerJobId: handle.jobId })
    appendJobEvent(taskDir, { at: new Date().toISOString(), type: 'provider_submitted', data: { provider: provider.id, providerJobId: handle.jobId } })
  } else {
    evidence.append('video_reattached', 'ok', { provider: provider.id, providerJobId: handle.jobId })
  }

  const deadline = Date.parse(handle.deadlineAt ?? '')
  const deadlineMs = Number.isFinite(deadline) ? deadline : Date.now() + DEFAULT_POLL_TIMEOUT_SECONDS * 1000
  const pollMs = clampPollMs(handle.pollAfterMs)
  let lastProgress = -1
  let consecutiveErrors = 0
  let completed: VideoPollResult | undefined

  while (!completed) {
    if (isCancelled()) {
      await cancelBestEffort(provider, handle, evidence, taskDir)
      throw new MediaError('MEDIA_JOB_CANCELLED', 'cancelled while waiting for the video provider')
    }
    if (Date.now() > deadlineMs) {
      await cancelBestEffort(provider, handle, evidence, taskDir)
      throw new MediaError('MEDIA_PROVIDER_TIMEOUT', `video provider did not finish before ${new Date(deadlineMs).toISOString()}`)
    }
    let poll: VideoPollResult
    try {
      poll = await provider.pollVideo(handle.jobId, handle.metadata)
    } catch (error) {
      const mediaError = error instanceof MediaError
        ? error
        : new MediaError('MEDIA_PROVIDER_REQUEST_FAILED', error instanceof Error ? error.message : String(error), { retryable: true })
      if (!mediaError.retryable) throw mediaError
      consecutiveErrors += 1
      // Plan M2: after a short error burst, back off exponentially (capped at
      // one poll interval) so a flaky provider is not hammered for the whole
      // poll window — while still respecting the deadline above.
      const backoff = consecutiveErrors > 3
        ? Math.min(pollMs * 2 ** Math.min(consecutiveErrors - 3, 4), MAX_POLL_MS)
        : pollMs
      await sleep(backoff)
      continue
    }
    consecutiveErrors = 0
    switch (poll.status) {
      case 'queued':
      case 'running': {
        const progress = typeof poll.progress === 'number' ? Math.floor(poll.progress) : undefined
        if (progress !== undefined && progress >= lastProgress + 10) {
          lastProgress = progress
          evidence.append('video_progress', 'ok', { progress })
          appendJobEvent(taskDir, { at: new Date().toISOString(), type: 'provider_progress', data: { progress } })
        }
        await sleep(pollMs)
        continue
      }
      case 'completed':
        completed = poll
        break
      case 'cancelled':
        throw new MediaError('MEDIA_JOB_CANCELLED', 'video provider reported the job as cancelled')
      case 'expired':
        throw new MediaError('MEDIA_PROVIDER_TIMEOUT', 'video provider reported the job as expired')
      case 'failed':
        throw new MediaError(
          'MEDIA_PROVIDER_REQUEST_FAILED',
          poll.error?.message ?? 'video provider reported a failure',
          { retryable: poll.error?.retryable ?? false },
        )
    }
  }

  let data: Buffer
  let contentType = completed.contentType ?? ''
  if (completed.artifacts && completed.artifacts.length > 0) {
    const artifact = completed.artifacts[0]
    data = artifact.data
    contentType = artifact.contentType || contentType
  } else if (completed.downloadUrl) {
    const downloaded = await downloadVideo(completed.downloadUrl)
    data = downloaded.data
    contentType = downloaded.contentType || contentType
  } else {
    throw new MediaError('MEDIA_PROVIDER_RESPONSE_INVALID', 'completed video response carried no artifact or download URL')
  }
  if (data.length === 0) {
    throw new MediaError('MEDIA_PROVIDER_RESPONSE_INVALID', 'video provider returned an empty artifact')
  }
  if (data.length > maxVideoBytes()) {
    throw new MediaError('MEDIA_QUOTA_EXCEEDED', `video is ${data.length} bytes, over the configured MEDIA_VIDEO_MAX_MB limit`)
  }

  const dest = writeOutput(taskDir, extensionFor(contentType), data)
  const relativePath = relative(taskDir, dest).split('\\').join('/')
  const sha256 = sha256Buffer(data)
  const output: AssetRecord = {
    id: `asset-${taskId}-video`,
    path: relativePath,
    kind: 'video',
    bytes: data.length,
    sha256,
    probe: { durationSec: request.durationSeconds },
  }
  evidence.append('video_completed', 'ok', {
    provider: provider.id,
    providerJobId: handle.jobId,
    path: relativePath,
    bytes: output.bytes,
    sha256,
  })
  appendJobEvent(taskDir, { at: new Date().toISOString(), type: 'provider_completed', data: { providerJobId: handle.jobId, bytes: output.bytes } })

  return { output, handle, ...(completed.usage ? { usage: completed.usage } : {}) }
}
