// Governed action catalog (v3 plan §5.1). A manifest describes an externally
// invocable action once; MCP/REST/DSH/CLI read it instead of hard-coding
// risk, cost, approval or availability per surface.

export type MediaRisk = 'low' | 'medium' | 'high'

export type MediaCostUnit = 'image' | 'video_second' | 'speech_char' | 'render_minute' | 'export'

export type MediaActionSurface = 'mcp' | 'rest' | 'dsh' | 'cli'

export type MediaMilestone = 'M0' | 'M2' | 'M4'

export type MediaApprovalMode = 'never' | 'threshold' | 'always'

export interface MediaCostSpec {
  /** Key into the static price table; null means cost unknown (fail-closed). */
  pricingKey: string | null

  /** Unit consumed by the estimate function for this action. */
  unit: MediaCostUnit
}

export interface MediaApprovalSpec {
  mode: MediaApprovalMode

  /** Required when mode === 'threshold'. CNY. */
  thresholdCny?: number
}

export interface MediaActionInvocation {
  /** MCP tool name that triggers this action. */
  toolName: string

  /** Fixed parameters merged into the tool call (for example `{ type: 'render' }`). */
  fixed?: Record<string, unknown>
}

export interface MediaActionManifest {
  /** Stable id, for example `media.generate_video`. */
  id: string
  title: string
  description: string
  risk: MediaRisk
  cost: MediaCostSpec
  approval: MediaApprovalSpec
  longRunning: boolean

  /** Actions become invocable only once this milestone is implemented. */
  availableIn: MediaMilestone

  invoke: MediaActionInvocation

  /** Surfaces the action is intended to be visible on once available. */
  surfaces: MediaActionSurface[]

  /** JSON Schema metadata shared by MCP tool declarations and docs. */
  paramsSchema: Record<string, unknown>
}
