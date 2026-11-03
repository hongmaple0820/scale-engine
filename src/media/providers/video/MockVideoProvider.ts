// Deterministic in-process video provider (M2, S0-reduced scope). No network,
// no spend. Completion is a pure function of the persisted submit metadata, so
// a task survives a process restart and can still be polled to completion.
//
// The artifact is synthetic MP4-shaped bytes, not a playable video: it lets the
// whole submit → poll → commit → evidence chain run without FFmpeg or keys.
// Tests that need media semantics must not claim playback support from this.

import { createHash } from 'node:crypto'
import { MediaError } from '../../errors.js'
import type {
  MediaProvider,
  ProviderCapabilities,
  ProviderConfigStatus,
  VideoPollResult,
  VideoProviderRequest,
  VideoSubmitResult,
} from '../types.js'

export const MOCK_VIDEO_ID = 'mock-video'

const cancelled = new Set<string>()

function latencyMs(): number {
  const raw = Number(process.env.MEDIA_MOCK_VIDEO_LATENCY_MS)
  if (!Number.isFinite(raw)) return 1500
  return Math.min(60_000, Math.max(0, Math.floor(raw)))
}

/** Deterministic synthetic bytes: an ftyp box followed by a hash-derived body. */
export function syntheticMp4(seed: string): Buffer {
  const digest = createHash('sha256').update(seed).digest()
  const payload = Buffer.concat([Buffer.alloc(28), digest, Buffer.alloc(28, 0x01)])
  const size = Buffer.alloc(4)
  size.writeUInt32BE(payload.length + 8)
  return Buffer.concat([size, Buffer.from('ftypisom', 'ascii'), payload])
}

export const MockVideoProvider: MediaProvider = {
  id: MOCK_VIDEO_ID,
  kind: 'video',
  enabled: true,
  getCapabilities(): ProviderCapabilities {
    return {
      kind: 'video',
      models: ['mock-video'],
      async: true,
      canEstimate: true,
      canCancel: true,
      notes: 'in-process state machine; synthetic bytes, no network, no cost',
    }
  },
  validateConfig(): ProviderConfigStatus {
    return { ok: true, configured: true, message: 'always available (dev/test only)' }
  },
  async submitVideo(request: VideoProviderRequest): Promise<VideoSubmitResult> {
    if (!request.prompt.trim()) throw new MediaError('MEDIA_VIDEO_REQUEST_INVALID', 'prompt must not be empty')
    const jobId = `mock-${createHash('sha256').update(`${request.prompt}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 12)}`
    return {
      jobId,
      pollAfterMs: 250,
      metadata: {
        submittedAt: Date.now(),
        latencyMs: latencyMs(),
        durationSeconds: request.durationSeconds,
        resolution: request.resolution,
      },
    }
  },
  async pollVideo(jobId: string, metadata?: Record<string, string | number | boolean>): Promise<VideoPollResult> {
    if (cancelled.has(jobId)) return { status: 'cancelled' }
    const submittedAt = typeof metadata?.submittedAt === 'number' ? metadata.submittedAt : Number.NaN
    if (!Number.isFinite(submittedAt)) {
      throw new MediaError('MEDIA_PROVIDER_RESPONSE_INVALID', `mock video handle "${jobId}" has no submittedAt metadata`)
    }
    const latency = typeof metadata?.latencyMs === 'number' ? metadata.latencyMs : 1500
    const elapsed = Date.now() - submittedAt
    if (elapsed < latency) {
      const duration = typeof metadata?.durationSeconds === 'number' ? metadata.durationSeconds : 0
      return { status: 'running', progress: latency === 0 ? 1 : Math.min(1, elapsed / latency), usage: { seconds: duration } }
    }
    return {
      status: 'completed',
      progress: 1,
      artifacts: [{ filename: 'mock.mp4', data: syntheticMp4(jobId), contentType: 'video/mp4' }],
      contentType: 'video/mp4',
      usage: { seconds: typeof metadata?.durationSeconds === 'number' ? metadata.durationSeconds : 0, synthetic: true },
    }
  },
  async cancelVideo(jobId: string): Promise<void> {
    cancelled.add(jobId)
  },
}

/** test seam: clear in-memory cancellation between cases */
export function resetMockVideoProvider(): void {
  cancelled.clear()
}
