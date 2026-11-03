// SCALE media engine — public surface (v3 plan §2.1: one business layer,
// many entries). CLI is wired today; REST/MCP/DSH adapters consume the same
// JobService later.

export * from './types.js'
export { MediaError, toJobError, type MediaErrorCode } from './errors.js'
export {
  listActions,
  availableActions,
  getAction,
  getActionForTool,
  actionForJobType,
  isActionAvailable,
  availableCreateTypes,
  milestoneRank,
  catalogIntegrityErrors,
  assertCatalogIntegrity,
  catalogCoverageErrors,
  createTypeEnumErrors,
  IMPLEMENTED_MILESTONE,
  type ListActionsOptions,
} from './actions/registry.js'
export { MEDIA_ACTION_MANIFESTS } from './actions/manifests.js'
export { estimateCost, type CostEstimate, type CostEstimateLine } from './actions/estimate.js'
export {
  MEDIA_PRICE_TABLE,
  PRICING_MAX_AGE_DAYS,
  resolvePrice,
  priceAgeDays,
  isPriceStale,
  type MediaPriceEntry,
} from './actions/pricing.js'
export type {
  MediaActionManifest,
  MediaActionInvocation,
  MediaActionSurface,
  MediaApprovalMode,
  MediaApprovalSpec,
  MediaCostSpec,
  MediaCostUnit,
  MediaMilestone,
  MediaRisk,
} from './actions/types.js'
export { validateStoryboard, storyboardTotalMs, storyboardAssetRefs, STORYBOARD_LIMITS, type ValidationResult } from './validation/validateStoryboard.js'
export { validateVideoRequest, validateSpeechRequest } from './validation/validateJobRequests.js'
export {
  ASSET_REF_SCHEME,
  ASSET_REF_MAX_LENGTH,
  ASSET_REST_MAX_LENGTH,
  isAssetRef,
  parseAssetRef,
  tryParseAssetRef,
  assetRefTaskPath,
  assetRefExternalPath,
  assetRefExternalSrc,
  assetRefFrom,
  collectAssetRefs,
  type AssetRef,
  type AssetRefNode,
} from './assets/refs.js'
export {
  materializeAssets,
  assertAssetRefsAvailable,
  type MaterializeOptions,
  type MaterializedAsset,
  type MaterializeResult,
} from './assets/materialize.js'
export { expandStoryboardTemplate, type BatchOptions } from './storyboard/batch.js'
export { buildPageHtml, buildSrt } from './render/SceneRenderer.js'
export { captureFrames, captureStill, type CaptureOptions, type CaptureResult, type StillCaptureOptions } from './render/FrameCapture.js'
export {
  splitNarrationSentences,
  buildAutoCues,
  withAutoSubtitles,
  type AutoSubtitleOptions,
} from './render/SubtitleBuilder.js'
export {
  planAudioMix,
  mixStoryboardAudio,
  resolveAssetPath,
  type AudioMixPlan,
  type PlanAudioMixOptions,
  type ClipAudioRef,
  type MixStoryboardAudioOptions,
  type MixStoryboardAudioResult,
  type PlannedAudioInput,
} from './render/AudioMixer.js'
export { renderSceneOverlay, overlayElementsOf, type OverlayOptions, type OverlayResult } from './render/OverlayRenderer.js'
export { composeSegments, type ComposeOptions, type ComposeResult } from './render/ClipComposer.js'
export {
  resolveMediaBin,
  requireMediaBin,
  mediaBinVersion,
  synthesizeAudio,
  encodeVideo,
  encodeSegment,
  normalizeClip,
  extractClipAudio,
  overlayPng,
  concatSegments,
  mixAudio,
  ensureSilentAudio,
  muxAudio,
  probeVideo,
  hasSubtitleFilter,
  extractStill,
  type AudioInput,
  type EncodeOptions,
  type MediaBinKind,
  type NormalizeClipOptions,
} from './render/FfmpegAdapter.js'
export {
  planTemplate,
  assembleTemplate,
  listTemplates,
  requireTemplate,
  narrationDurationMs,
  isVideoSrc,
} from './templates/assemble.js'
export {
  BUILTIN_TEMPLATES,
  TEMPLATE_IDS,
  getBuiltinTemplate,
} from './templates/builtin.js'
export type {
  AssembleOptions,
  MediaTemplateId,
  PlannedSlot,
  TemplateDefinition,
  TemplatePlan,
  TemplateSlot,
  TemplateSlotKind,
  TemplateSlotValues,
} from './templates/types.js'
export { renderStoryboard, type RenderOutcome, type RenderStageInfo, type RenderOrchestratorOptions } from './render/RenderOrchestrator.js'
export { generateImageForJob, validateImageRequest, type ImageOrchestratorOptions } from './render/ImageOrchestrator.js'
export { generateVideoForJob, type VideoOrchestratorOptions, type VideoOutcome } from './render/VideoOrchestrator.js'
export { generateSpeechForJob, type SpeechOrchestratorOptions, type SpeechOutcome } from './render/SpeechOrchestrator.js'
export {
  listProviders,
  getProvider,
  getVideoProvider,
  getSpeechProvider,
  listProviderFeatures,
  type ProviderSummary,
  type ProviderFeature,
  type FeatureMode,
} from './providers/ProviderRegistry.js'
export { solidColorPng } from './providers/image/MockImageProvider.js'
export type {
  MediaProvider,
  ProviderKind,
  ProviderCapabilities,
  ProviderConfigStatus,
  ProviderArtifact,
  ImageGenerationRequest,
  ImageGenerationResult,
  VideoProviderRequest,
  VideoSubmitResult,
  VideoPollStatus,
  VideoPollResult,
  SpeechProviderRequest,
  SpeechGenerationResult,
} from './providers/types.js'
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
  decideJobApproval,
  listProjectApprovals,
  sweepExpiredApprovalJobs,
  projectBudgetSummary,
  runLockTtlMsFor,
  RUN_LOCK_TTL_MS,
  VIDEO_RUN_LOCK_TTL_MS,
  type CreateJobOptions,
  type RunJobOptions,
  type DecideJobApprovalOptions,
  type DecideJobApprovalResult,
} from './jobs/JobService.js'
export { estimateMediaJobCost, recordMediaCost } from './cost/MediaCostAdapter.js'
export {
  approvalMode,
  approvalThresholdCny,
  approvalTtlMinutes,
  dailyBudgetCny,
  budgetReservationTtlMinutes,
  decideApproval,
  DEFAULT_APPROVAL_THRESHOLD_CNY,
  DEFAULT_DAILY_BUDGET_CNY,
  DEFAULT_APPROVAL_TTL_MINUTES,
  DEFAULT_BUDGET_RESERVATION_TTL_MINUTES,
} from './approvals/policy.js'
export {
  approvalFilePath,
  readApprovalRecords,
  appendApprovalRecord,
  latestApprovals,
  findApproval,
  requestApprovalRecord,
  decideApprovalRecord,
  sweepExpiredApprovals,
  type RequestApprovalInput,
  type DecideApprovalInput,
} from './approvals/ApprovalStore.js'
export type { ApprovalRecord, ApprovalMode, ApprovalStatus, ApprovalDecision } from './approvals/types.js'
export {
  budgetFilePath,
  budgetEntries,
  budgetSummary,
  spendForDay,
  reserveBudget,
  settleBudget,
  type BudgetEntry,
  type BudgetEntryStatus,
  type ReserveBudgetInput,
  type SettleBudgetInput,
} from './budget/BudgetLedger.js'
export { assertStorageAvailable, freeBytesOf, projectQuotaBytes, minFreeBytes } from './storage/QuotaGuard.js'
export { mediaSurfaceRoots, classifyMediaPath } from '../surface/ScaleSurface.js'
export {
  collectGcCandidates,
  summarizeAssets,
  INTERMEDIATE_DIRS,
  PROTECTED_PATHS,
  type AssetIndexEntry,
  type AssetIndexSummary,
  type TaskCategory,
} from './storage/AssetIndex.js'
export {
  planGc,
  applyGc,
  runGc,
  gcMinAgeDays,
  gcReportPath,
  keepIntermediates,
  type GcPlan,
  type GcPlanEntry,
} from './storage/gc.js'
export {
  listPublishAdapters,
  getPublishAdapter,
  previewPublish,
  readPublishManifest,
  LOCAL_PREVIEW_ADAPTER,
  type PublishAdapter,
  type PublishPreview,
} from './publish/PublishAdapter.js'
export {
  buildPublishManifest,
  validatePublishManifest,
  publishManifestPath,
  PUBLISH_MANIFEST_VERSION,
  type PublishManifest,
  type PublishManifestAsset,
  type ManifestValidationIssue,
} from './export/PublishPackage.js'
export {
  EXPORT_PROFILES,
  EXPORT_PROFILE_IDS,
  isExportProfileId,
  resolveExportProfile,
  type ExportProfile,
} from './export/profiles.js'
export { runExport, type ExportOrchestratorOptions, type ExportOutcome } from './export/ExportOrchestrator.js'
export { validateExportRequest } from './validation/validateJobRequests.js'
export {
  notifyApprovalRequested,
  approvalNotificationText,
  type ApprovalNotifyInput,
  type ApprovalNotifyResult,
} from './approvals/notify.js'
export { EvidenceWriter, redact } from './evidence/EvidenceWriter.js'
export {
  buildMediaObservation,
  observeTerminalState,
  observationKindFor,
  recordMediaObservation,
  hasMediaObservation,
  observationsDirOf,
  type MediaObservationInput,
} from './observations.js'
export type {
  MediaObservationKind,
  MediaObservationContext,
} from '../cortex/InstinctExtractor.js'
