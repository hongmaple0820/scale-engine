// Media provider contracts (v3 plan §8): providers are capability adapters —
// no UI, no job management, no authorization decisions. Every provider must
// describe its config status honestly (configured ≠ enabled ≠ connected).
//
// M2 adds asynchronous video and speech. Video is submit → poll → cancel with
// a persisted handle; the engine (VideoOrchestrator) owns persistence, timeouts
// and downloads, providers only speak their own protocol.

export type ProviderKind = 'image' | 'music' | 'video' | 'speech'

export interface ProviderCapabilities {
  kind: ProviderKind
  models: string[]
  async: boolean
  canEstimate: boolean
  canCancel: boolean
  notes: string
}

export interface ProviderConfigStatus {
  ok: boolean
  configured: boolean
  message: string
}

export interface ProviderArtifact {
  filename: string
  data: Buffer
  contentType: string
}

export interface ImageGenerationRequest {
  prompt: string
  /** WxH, e.g. 1024x1024 — validated by the engine before reaching providers */
  size: string
  model?: string
}

export interface ImageGenerationResult {
  artifacts: ProviderArtifact[]
  model: string
  /** provider-reported usage when available; never fabricated */
  usage?: Record<string, unknown>
}

// --- video ---------------------------------------------------------------------

export interface VideoProviderRequest {
  prompt: string
  durationSeconds: number
  aspectRatio: string
  resolution: string
  model?: string
  /** already-contained task-local path; provider reads bytes, never a URL */
  firstFramePath?: string
}

export interface VideoSubmitResult {
  /** provider-side job id; never used as a local filename */
  jobId: string
  /** provider-suggested poll interval in ms (engine clamps to 2s..30s) */
  pollAfterMs?: number
  /** provider-specific opaque state persisted with the handle */
  metadata?: Record<string, string | number | boolean>
}

export type VideoPollStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired'

export interface VideoPollResult {
  status: VideoPollStatus
  progress?: number
  /** artifacts for in-process providers (mock); remote providers use downloadUrl */
  artifacts?: ProviderArtifact[]
  /** remote result URL; the engine enforces https + host allowlist before download */
  downloadUrl?: string
  contentType?: string
  error?: { code: string; message: string; retryable?: boolean }
  usage?: Record<string, unknown>
}

export interface MediaProvider {
  id: string
  kind: ProviderKind
  /** gated availability — false means the registry will not hand this out */
  enabled: boolean
  getCapabilities(): ProviderCapabilities
  validateConfig(): ProviderConfigStatus
  generateImage?(request: ImageGenerationRequest): Promise<ImageGenerationResult>
  submitVideo?(request: VideoProviderRequest): Promise<VideoSubmitResult>
  pollVideo?(jobId: string, metadata?: Record<string, string | number | boolean>): Promise<VideoPollResult>
  cancelVideo?(jobId: string): Promise<void>
  generateSpeech?(request: SpeechProviderRequest): Promise<SpeechGenerationResult>
}

// --- speech --------------------------------------------------------------------

export interface SpeechProviderRequest {
  text: string
  voice: string
  format: 'mp3' | 'wav'
  model?: string
}

export interface SpeechGenerationResult {
  artifacts: ProviderArtifact[]
  model: string
  voice: string
  usage?: Record<string, unknown>
}
