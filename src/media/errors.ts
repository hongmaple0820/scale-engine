// Stable media error codes (v3 plan §4.1/§9.1) — CLI/API/MCP share these.
// `retryable` is deliberate: retry_wait only applies to safe, explicit errors.

export type MediaErrorCode =
  | 'MEDIA_STORYBOARD_INVALID'
  | 'MEDIA_ASSET_REF_INVALID'
  | 'MEDIA_BIN_MISSING'
  | 'MEDIA_RENDER_FAILED'
  | 'MEDIA_ENCODE_FAILED'
  | 'MEDIA_PROBE_FAILED'
  | 'MEDIA_OUTPUT_INVALID'
  | 'MEDIA_JOB_NOT_FOUND'
  | 'MEDIA_JOB_STATE'
  | 'MEDIA_JOB_CANCELLED'
  | 'MEDIA_LOCK_TIMEOUT'
  | 'MEDIA_WORKSPACE_ERROR'
  | 'MEDIA_PROVIDER_UNAVAILABLE'
  | 'MEDIA_PROVIDER_REQUEST_FAILED'
  | 'MEDIA_PROVIDER_RESPONSE_INVALID'
  | 'MEDIA_IMAGE_REQUEST_INVALID'

export class MediaError extends Error {
  readonly code: MediaErrorCode
  readonly retryable: boolean

  constructor(code: MediaErrorCode, message: string, options: { retryable?: boolean } = {}) {
    super(message)
    this.name = 'MediaError'
    this.code = code
    this.retryable = options.retryable ?? false
  }

  toJSON(): { code: MediaErrorCode; message: string; retryable: boolean } {
    return { code: this.code, message: this.message, retryable: this.retryable }
  }
}

export function toJobError(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof MediaError) {
    return { code: error.code, message: error.message, retryable: error.retryable }
  }
  return { code: 'MEDIA_RENDER_FAILED', message: error instanceof Error ? error.message : String(error), retryable: false }
}
