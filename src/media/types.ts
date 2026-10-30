// Media workflow contracts (v3 plan §3/§4/§6). Scene DSL v0.1 is declarative
// only: no embedded code, no URLs — the validator is the security boundary,
// the renderer is a trusted template.

export const SCENE_DSL_VERSION = '0.4'
/** v0.1–v0.3 storyboards remain valid input — accepted, never rewritten on disk */
export const ACCEPTED_DSL_VERSIONS = ['0.1', '0.2', '0.3', '0.4'] as const

export type TransitionType = 'fade' | 'slide' | 'wipe'
export type TransitionDirection = 'left' | 'right' | 'up' | 'down'

export interface SceneTransition {
  type: TransitionType
  /** required for slide/wipe — the edge the outgoing scene moves toward / gets wiped toward */
  direction?: TransitionDirection
  durationMs: number
}

export interface StoryboardCanvas {
  width: number
  height: number
  fps: number
  background: string
}

export interface StoryboardOutput {
  videoCodec?: string
  pixelFormat?: string
  audioCodec?: string
  crf?: number
  preset?: string
}

export type ElementAnimationType = 'fadeIn' | 'fadeInUp' | 'slideUp' | 'progressBar'

export interface ElementAnimation {
  type: ElementAnimationType
  delayMs?: number
  durationMs: number
}

export interface ElementBase {
  x: number | 'center'
  y: number
  animation?: ElementAnimation
}

export interface TextElement extends ElementBase {
  type: 'text'
  content: string
  fontFamily: string
  fontSize: number
  color: string
}

export interface RectElement extends ElementBase {
  type: 'rect'
  width: number
  height: number
  color: string
  radius?: number
}

export interface ImageElement extends ElementBase {
  type: 'image'
  /**
   * Path relative to the task's assets/ (validated, never a URL or absolute
   * path), or — schemaVersion 0.3 only — an `asset://<taskId>/assets/<path>`
   * reference materialized into this task before rendering.
   */
  src: string
  width: number
  height: number
}

/**
 * Full-canvas video clip (v0.4). The scene duration stays authoritative: the
 * clip is trimmed, fitted to the canvas and looped when needed. Video elements
 * are composited by ffmpeg, not captured by the HTML renderer.
 */
export interface VideoElement {
  type: 'video'
  /** task-relative path (relative to assets/) or an asset:// reference */
  src: string
  fit?: 'cover' | 'contain'
  /** default true: reference audio is discarded, narration/BGM carry sound */
  muted?: boolean
  trimStartMs?: number
  trimEndMs?: number
  /** loop the trimmed range when it is shorter than the scene */
  loop?: boolean
}

export type SceneElement = TextElement | RectElement | ImageElement | VideoElement

export interface SubtitleCue {
  startMs: number
  endMs: number
  text: string
}

/** Global audio beds (v0.4): at most one narration and one bgm per board. */
export interface AudioTrack {
  /** task-relative path (relative to assets/) or an asset:// reference */
  src: string
  kind: 'narration' | 'bgm'
  /** 0–1, default 1 */
  volume?: number
  /** loop until the film ends (bgm typically) */
  loop?: boolean
  fadeInMs?: number
  fadeOutMs?: number
}

export interface SubtitleSpec {
  mode: 'none' | 'burn' | 'srt' | 'both'
  /** default auto when mode is not 'none' */
  source?: 'auto' | 'file'
  /** required when source='file' */
  src?: string
}

export interface StoryboardScene {
  id: string
  durationMs: number
  elements: SceneElement[]
  transitionOut?: SceneTransition
  /** the only text source for `subtitleOptions.source='auto'` (v0.4) */
  narrationText?: string
}

export interface Storyboard {
  schemaVersion: string
  title?: string
  canvas: StoryboardCanvas
  output?: StoryboardOutput
  scenes: StoryboardScene[]
  subtitles?: SubtitleCue[]
  audioTracks?: AudioTrack[]
  subtitleOptions?: SubtitleSpec
}

// --- jobs ----------------------------------------------------------------------

export type MediaJobStatus =
  | 'created'
  | 'validated'
  | 'awaiting_approval'
  | 'running'
  | 'packaging'
  | 'succeeded'
  | 'failed'
  | 'failed_validation'
  | 'cancelled'
  | 'interrupted'

export type MediaJobType = 'render' | 'generate_image' | 'generate_video' | 'generate_speech' | 'export'

export interface MediaJobError {
  code: string
  message: string
  retryable: boolean
}

export interface ImageJobRequest {
  prompt: string
  size: string
  providerId: string
  model?: string
}

export interface VideoJobRequest {
  prompt: string
  /** 1..60 — validated by the engine before reaching providers */
  durationSeconds: number
  aspectRatio?: '16:9' | '9:16' | '1:1'
  resolution?: '480p' | '720p' | '1080p'
  providerId: string
  model?: string
  /**
   * Optional task-local first frame (`assets/...`) — the provider orchestrator
   * re-checks containment and existence before uploading anything.
   */
  firstFrameAssetPath?: string
  /** Hard ceiling for submit+poll; 10..3600 seconds, default 1800. */
  pollTimeoutSeconds?: number
}

export interface SpeechJobRequest {
  text: string
  providerId: string
  voice?: string
  format?: 'mp3' | 'wav'
  model?: string
}

/** Export profile id (M4): target canvas + cover timing, resolved by profiles.ts. */
export type ExportProfileId = '16x9-1080p' | '9x16-1080p' | '1x1-1080p'

/**
 * Multi-spec export request (M4). The source task must be a succeeded render
 * whose output is a real video file; exports are written into a NEW task dir
 * (the source stays read-only). `publish` metadata turns the job into a
 * publish package (manifest.json) — same job type, richer output.
 */
export interface ExportJobRequest {
  sourceTaskId: string
  profiles?: ExportProfileId[]
  /** seconds into the source film for the cover still; default 0 */
  coverAtSec?: number
  /** 'srt' side-copies the source SRT; 'burn' bakes it into each export */
  subtitles?: 'none' | 'srt' | 'burn'
  publish?: PublishMetadata
}

/** Publish-package metadata — user-supplied text, never LLM-generated. */
export interface PublishMetadata {
  title: string
  description?: string
  tags?: string[]
  /** hints only; the engine never publishes anywhere itself */
  platformHints?: string[]
}

export interface MediaProviderHandle {
  providerId: string
  jobId: string
  submittedAt: string
  /** provider-suggested poll interval, clamped by the orchestrator */
  pollAfterMs?: number
  /** absolute ISO deadline; past it the job fails provider_timeout */
  deadlineAt?: string
  /** provider-specific, persisted verbatim so recovery can reattach */
  metadata?: Record<string, string | number | boolean>
}

export interface MediaApprovalRef {
  id: string
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  mode: 'threshold' | 'always'
  requestedAt: string
  expiresAt: string
  estimatedCny: number | null
  decidedAt?: string
  decidedBy?: string
}

export interface MediaJobCost {
  /** null when the price is not confirmed (fail-closed) */
  estimatedCny: number | null
  reservedCny: number
  actualCny?: number | null
  pricingKey?: string
  unit?: string
  quantity?: number | null
}

export interface AssetProbe {
  durationSec?: number
  videoCodec?: string
  audioCodec?: string
  width?: number
  height?: number
}

export interface AssetRecord {
  id: string
  /** task-relative path */
  path: string
  kind: 'video' | 'audio' | 'image' | 'other'
  bytes: number
  sha256: string
  probe?: AssetProbe
}

export interface MediaJob {
  id: string
  projectId: string
  type: MediaJobType
  status: MediaJobStatus
  schemaVersion: 1
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  requestedBy: string
  idempotencyKey?: string
  /** task-relative input references — exactly one is set, by job type */
  input: { storyboardFile?: string; imageRequestFile?: string; videoRequestFile?: string; speechRequestFile?: string; exportRequestFile?: string }
  attempt: number
  stage?: string
  error?: MediaJobError
  outputs: AssetRecord[]
  /** remote provider state; written before polling so recovery can reattach */
  provider?: MediaProviderHandle
  approval?: MediaApprovalRef
  cost?: MediaJobCost
}

export interface JobEvent {
  at: string
  type: string
  data?: Record<string, unknown>
}

export interface EvidenceEvent {
  eventId: string
  at: string
  taskId: string
  actor: string
  action: string
  result: 'ok' | 'error'
  data?: Record<string, unknown>
}

export interface VideoProbe extends AssetProbe {
  durationSec?: number
}
