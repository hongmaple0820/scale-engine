// Media provider contracts (v3 plan §8): providers are capability adapters —
// no UI, no job management, no authorization decisions. Every provider must
// describe its config status honestly (configured ≠ enabled ≠ connected).

export type ProviderKind = 'image' | 'music' | 'video'

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

export interface MediaProvider {
  id: string
  kind: ProviderKind
  /** gated availability — false means the registry will not hand this out */
  enabled: boolean
  getCapabilities(): ProviderCapabilities
  validateConfig(): ProviderConfigStatus
  generateImage?(request: ImageGenerationRequest): Promise<ImageGenerationResult>
}
