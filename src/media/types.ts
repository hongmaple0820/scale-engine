// Media workflow contracts (v3 plan §3/§4/§6). Scene DSL v0.1 is declarative
// only: no embedded code, no URLs — the validator is the security boundary,
// the renderer is a trusted template.

export const SCENE_DSL_VERSION = '0.2'
/** v0.1 storyboards remain valid input — accepted, never rewritten on disk */
export const ACCEPTED_DSL_VERSIONS = ['0.1', '0.2'] as const

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
  /** task-relative path under assets/ — validated, never a URL or absolute path */
  src: string
  width: number
  height: number
}

export type SceneElement = TextElement | RectElement | ImageElement

export interface SubtitleCue {
  startMs: number
  endMs: number
  text: string
}

export interface StoryboardScene {
  id: string
  durationMs: number
  elements: SceneElement[]
  transitionOut?: SceneTransition
}

export interface Storyboard {
  schemaVersion: string
  title?: string
  canvas: StoryboardCanvas
  output?: StoryboardOutput
  scenes: StoryboardScene[]
  subtitles?: SubtitleCue[]
}

// --- jobs ----------------------------------------------------------------------

export type MediaJobStatus =
  | 'created'
  | 'validated'
  | 'running'
  | 'packaging'
  | 'succeeded'
  | 'failed'
  | 'failed_validation'
  | 'cancelled'
  | 'interrupted'

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
  type: 'render' | 'generate_image'
  status: MediaJobStatus
  schemaVersion: 1
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  requestedBy: string
  idempotencyKey?: string
  /** task-relative input references — exactly one is set, by job type */
  input: { storyboardFile?: string; imageRequestFile?: string }
  attempt: number
  stage?: string
  error?: MediaJobError
  outputs: AssetRecord[]
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
