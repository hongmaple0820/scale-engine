// OpenAI-compatible speech adapter (M2). Speaks POST {baseUrl}/audio/speech
// and expects audio bytes back. Keys are read from the environment only and
// never enter task dirs or evidence. SSRF policy is shared with the image
// adapter: HTTPS only, loopback HTTP needs MEDIA_PROVIDER_ALLOW_LOCAL=1,
// cloud-metadata hosts always denied.
//
// Live verification was NOT performed in this checkout (no key); the contract
// is pinned by injected-fetch tests and the provider reports itself unusable
// until configured.

import { MediaError } from '../../errors.js'
import type {
  MediaProvider,
  ProviderCapabilities,
  ProviderConfigStatus,
  SpeechGenerationResult,
  SpeechProviderRequest,
} from '../types.js'
import { isProviderUrlAllowed } from '../image/OpenAICompatibleImageProvider.js'

export const OPENAI_SPEECH_ID = 'openai-speech'

export function resolveSpeechBaseUrl(): string | undefined {
  const base = process.env.MEDIA_SPEECH_BASE_URL?.trim() || process.env.MEDIA_OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1'
  return base.replace(/\/+$/, '')
}

function speechKey(): string | undefined {
  return process.env.MEDIA_SPEECH_API_KEY?.trim() || process.env.MEDIA_OPENAI_API_KEY?.trim() || undefined
}

function speechModel(): string {
  return process.env.MEDIA_SPEECH_MODEL?.trim() || 'gpt-4o-mini-tts'
}

function defaultVoice(): string {
  return process.env.MEDIA_SPEECH_VOICE?.trim() || 'alloy'
}

export const OpenAISpeechProvider: MediaProvider = {
  id: OPENAI_SPEECH_ID,
  kind: 'speech',
  enabled: true,
  getCapabilities(): ProviderCapabilities {
    return {
      kind: 'speech',
      models: [speechModel()],
      async: false,
      canEstimate: false,
      canCancel: false,
      notes: 'OpenAI-compatible /audio/speech; MEDIA_SPEECH_BASE_URL/_API_KEY/_MODEL/_VOICE (falls back to MEDIA_OPENAI_*)',
    }
  },
  validateConfig(): ProviderConfigStatus {
    const base = resolveSpeechBaseUrl()
    if (!base) return { ok: false, configured: false, message: 'no base URL' }
    const allowed = isProviderUrlAllowed(base)
    if (!allowed.ok) return { ok: false, configured: false, message: allowed.reason ?? 'provider URL rejected' }
    if (!speechKey()) return { ok: false, configured: false, message: 'MEDIA_SPEECH_API_KEY (or MEDIA_OPENAI_API_KEY) is not set' }
    return { ok: true, configured: true, message: `configured (${base})` }
  },
  async generateSpeech(request: SpeechProviderRequest): Promise<SpeechGenerationResult> {
    const base = resolveSpeechBaseUrl()
    const allowed = isProviderUrlAllowed(base ?? '')
    if (!base || !allowed.ok) {
      throw new MediaError('MEDIA_PROVIDER_REQUEST_FAILED', allowed.reason ?? 'provider base URL missing')
    }
    const key = speechKey()
    if (!key) throw new MediaError('MEDIA_PROVIDER_UNAVAILABLE', 'MEDIA_SPEECH_API_KEY is not set', { retryable: false })

    const model = request.model?.trim() || speechModel()
    const voice = request.voice.trim() || defaultVoice()
    const format = request.format === 'wav' ? 'wav' : 'mp3'
    let response: Response
    try {
      response = await fetch(`${base}/audio/speech`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, input: request.text, voice, response_format: format }),
        signal: AbortSignal.timeout(120000),
      })
    } catch (error) {
      throw new MediaError(
        'MEDIA_PROVIDER_REQUEST_FAILED',
        `speech request failed: ${error instanceof Error ? error.message : String(error)}`,
        { retryable: true },
      )
    }
    if (!response.ok) {
      throw new MediaError(
        'MEDIA_PROVIDER_REQUEST_FAILED',
        `provider responded ${response.status}`,
        { retryable: response.status === 429 || response.status >= 500 },
      )
    }
    const data = Buffer.from(await response.arrayBuffer())
    if (data.length === 0) {
      throw new MediaError('MEDIA_PROVIDER_RESPONSE_INVALID', 'provider returned empty audio')
    }
    const contentType = response.headers.get('content-type') ?? (format === 'wav' ? 'audio/wav' : 'audio/mpeg')
    return {
      artifacts: [{ filename: `speech.${format}`, data, contentType }],
      model,
      voice,
      usage: { characters: [...request.text].length },
    }
  },
}
