// OpenAI-compatible image generation adapter (v3 plan §8). Speaks
// POST {baseUrl}/images/generations with a bearer key from the environment —
// the key never enters the repo, task dirs, or evidence. SSRF guard: HTTPS
// only, loopback HTTP requires explicit opt-in, cloud-metadata hosts always
// denied.

import { MediaError } from '../../errors.js'
import type { ImageGenerationRequest, ImageGenerationResult, MediaProvider, ProviderCapabilities, ProviderConfigStatus } from '../types.js'

export const OPENAI_COMPATIBLE_ID = 'openai-compatible'

export function resolveProviderBaseUrl(): string | undefined {
  const base = process.env.MEDIA_OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1'
  return base.replace(/\/+$/, '')
}

export function isProviderUrlAllowed(rawUrl: string): { ok: boolean; reason?: string } {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { ok: false, reason: `provider URL is not a valid URL: ${rawUrl}` }
  }
  const host = parsed.hostname.toLowerCase()
  const localAllowed = process.env.MEDIA_PROVIDER_ALLOW_LOCAL === '1' && (host === '127.0.0.1' || host === 'localhost' || host === '[::1]')
  if (parsed.protocol === 'http:' && !localAllowed) {
    return { ok: false, reason: 'provider URL must use HTTPS (loopback HTTP needs MEDIA_PROVIDER_ALLOW_LOCAL=1)' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `unsupported provider protocol: ${parsed.protocol}` }
  }
  if (host === '169.254.169.254' || host.endsWith('.internal') || host === 'metadata.google.internal') {
    return { ok: false, reason: `provider host is denied: ${host}` }
  }
  return { ok: true }
}

function apiKey(): string | undefined {
  return process.env.MEDIA_OPENAI_API_KEY?.trim() || undefined
}

export const OpenAICompatibleImageProvider: MediaProvider = {
  id: OPENAI_COMPATIBLE_ID,
  kind: 'image',
  enabled: true,
  getCapabilities(): ProviderCapabilities {
    return {
      kind: 'image',
      models: [process.env.MEDIA_OPENAI_IMAGE_MODEL?.trim() || 'gpt-image-1'],
      async: false,
      canEstimate: false,
      canCancel: false,
      notes: 'OpenAI-compatible /images/generations; key via MEDIA_OPENAI_API_KEY, base via MEDIA_OPENAI_BASE_URL',
    }
  },
  validateConfig(): ProviderConfigStatus {
    const base = resolveProviderBaseUrl()
    if (!base) return { ok: false, configured: false, message: 'no base URL' }
    const allowed = isProviderUrlAllowed(base)
    if (!allowed.ok) return { ok: false, configured: false, message: allowed.reason ?? 'provider URL rejected' }
    if (!apiKey()) return { ok: false, configured: false, message: 'MEDIA_OPENAI_API_KEY is not set' }
    return { ok: true, configured: true, message: `configured (${base})` }
  },
  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const base = resolveProviderBaseUrl()
    const allowed = isProviderUrlAllowed(base ?? '')
    if (!base || !allowed.ok) {
      throw new MediaError('MEDIA_PROVIDER_REQUEST_FAILED', allowed.reason ?? 'provider base URL missing')
    }
    const key = apiKey()
    if (!key) throw new MediaError('MEDIA_PROVIDER_UNAVAILABLE', 'MEDIA_OPENAI_API_KEY is not set', { retryable: false })

    const model = request.model?.trim() || process.env.MEDIA_OPENAI_IMAGE_MODEL?.trim() || 'gpt-image-1'
    let response: Response
    try {
      response = await fetch(`${base}/images/generations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, prompt: request.prompt, size: request.size, n: 1 }),
        signal: AbortSignal.timeout(300000),
      })
    } catch (error) {
      throw new MediaError('MEDIA_PROVIDER_REQUEST_FAILED', `image generation request failed: ${error instanceof Error ? error.message : String(error)}`, { retryable: true })
    }
    if (!response.ok) {
      throw new MediaError('MEDIA_PROVIDER_REQUEST_FAILED', `provider responded ${response.status}`, { retryable: response.status === 429 || response.status >= 500 })
    }
    const payload = (await response.json().catch(() => null)) as {
      data?: Array<{ b64_json?: string; url?: string }>
      usage?: Record<string, unknown>
    } | null
    const first = payload?.data?.[0]
    if (!first) {
      throw new MediaError('MEDIA_PROVIDER_RESPONSE_INVALID', 'provider response has no image data')
    }
    if (first.b64_json) {
      return {
        artifacts: [{ filename: 'generated.png', data: Buffer.from(first.b64_json, 'base64'), contentType: 'image/png' }],
        model,
        usage: payload?.usage,
      }
    }
    if (first.url) {
      const allowedUrl = isProviderUrlAllowed(first.url)
      if (!allowedUrl.ok) throw new MediaError('MEDIA_PROVIDER_RESPONSE_INVALID', `provider returned a denied URL: ${allowedUrl.reason}`)
      const imageResponse = await fetch(first.url, { signal: AbortSignal.timeout(120000) }).catch((error: unknown) => {
        throw new MediaError('MEDIA_PROVIDER_REQUEST_FAILED', `image download failed: ${error instanceof Error ? error.message : String(error)}`, { retryable: true })
      })
      if (!imageResponse.ok) throw new MediaError('MEDIA_PROVIDER_REQUEST_FAILED', `image download responded ${imageResponse.status}`, { retryable: true })
      const data = Buffer.from(await imageResponse.arrayBuffer())
      return { artifacts: [{ filename: 'generated.png', data, contentType: imageResponse.headers.get('content-type') ?? 'image/png' }], model, usage: payload?.usage }
    }
    throw new MediaError('MEDIA_PROVIDER_RESPONSE_INVALID', 'provider response has neither b64_json nor url')
  },
}
