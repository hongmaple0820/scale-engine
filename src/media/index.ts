// SCALE media engine — public surface (v3 plan §2.1: one business layer,
// many entries). CLI is wired today; REST/MCP/DSH adapters consume the same
// JobService later.

export * from './types.js'
export { MediaError, toJobError, type MediaErrorCode } from './errors.js'
export { validateStoryboard, storyboardTotalMs, storyboardAssetRefs, STORYBOARD_LIMITS, type ValidationResult } from './validation/validateStoryboard.js'
export { expandStoryboardTemplate, type BatchOptions } from './storyboard/batch.js'
export { buildPageHtml, buildSrt } from './render/SceneRenderer.js'
export { captureFrames, type CaptureOptions, type CaptureResult } from './render/FrameCapture.js'
export {
  resolveMediaBin,
  requireMediaBin,
  mediaBinVersion,
  synthesizeAudio,
  encodeVideo,
  probeVideo,
  hasSubtitleFilter,
  extractStill,
  type MediaBinKind,
} from './render/FfmpegAdapter.js'
export { renderStoryboard, type RenderOutcome, type RenderStageInfo, type RenderOrchestratorOptions } from './render/RenderOrchestrator.js'
export { generateImageForJob, validateImageRequest, type ImageOrchestratorOptions } from './render/ImageOrchestrator.js'
export { listProviders, getProvider, type ProviderSummary } from './providers/ProviderRegistry.js'
export { solidColorPng } from './providers/image/MockImageProvider.js'
export type { MediaProvider, ProviderKind, ProviderCapabilities, ProviderConfigStatus, ProviderArtifact, ImageGenerationRequest, ImageGenerationResult } from './providers/types.js'
export { OPENAI_COMPATIBLE_ID, isProviderUrlAllowed, resolveProviderBaseUrl } from './providers/image/OpenAICompatibleImageProvider.js'
export { SUNO_API_ID, isSunoEnabled, sunoGenerate } from './providers/music/SunoApiExperimentalProvider.js'
export { canTransition, assertTransition, INTERRUPTIBLE_STATUSES } from './jobs/jobStateMachine.js'
export {
  openWorkspace,
  createTaskDir,
  writeSnapshot,
  readSnapshot,
  appendJobEvent,
  readJobEvents,
  listJobs,
  listTaskDirs,
  findJob,
  findJobByIdempotencyKey,
  recoverInterruptedJobs,
  taskDirOf,
  type MediaWorkspace,
} from './jobs/JobStore.js'
export {
  createJob,
  runJob,
  getJob,
  listProjectJobs,
  cancelJob,
  retryJob,
  recoverJobs,
  readJobStoryboard,
  type CreateJobOptions,
  type RunJobOptions,
} from './jobs/JobService.js'
export { EvidenceWriter, redact } from './evidence/EvidenceWriter.js'
