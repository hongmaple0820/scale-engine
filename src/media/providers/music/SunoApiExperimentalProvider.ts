// Experimental music provider for the self-hosted gcui-art/suno-api service
// (v3 plan §8.6). DEFAULT OFF: Suno's ToS (rev. 2026-08-10, eff. 2026-09-03)
// bans automated data extraction; the adapter is removable, never a default,
// and never a CI/acceptance dependency. Opt-in requires an explicit env flag
// plus a user-deployed service URL; cookies stay inside the user's own
// deployment and never enter SCALE config.

import { MediaError } from '../../errors.js'
import type { MediaProvider, ProviderCapabilities, ProviderConfigStatus } from '../types.js'

export const SUNO_API_ID = 'suno-api'

export function isSunoEnabled(): boolean {
  return (process.env.MEDIA_ENABLE_EXPERIMENTAL_PROVIDERS ?? '')
    .split(',')
    .map(entry => entry.trim())
    .includes(SUNO_API_ID)
}

function sunoBaseUrl(): string | undefined {
  return process.env.MEDIA_SUNO_BASE_URL?.trim().replace(/\/+$/, '') || undefined
}

interface SunoCliptestResponse {
  data?: Array<{ id?: string; audio_url?: string; title?: string }>
}

/** Raw wire client — only reachable when the experimental gate is on. */
export async function sunoGenerate(input: {
  prompt: string
  custom?: boolean
  lyrics?: string
  title?: string
}): Promise<Array<{ id: string; audioUrl?: string; title?: string }>> {
  const base = sunoBaseUrl()
  if (!base) throw new MediaError('MEDIA_PROVIDER_UNAVAILABLE', 'MEDIA_SUNO_BASE_URL is not set')
  const endpoint = input.custom ? `${base}/api/custom_generate` : `${base}/api/generate`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(
      input.custom
        ? { prompt: input.lyrics ?? '', tags: input.prompt, title: input.title ?? '' }
        : { prompt: input.prompt, make_instrumental: false, wait_audio: false },
    ),
    signal: AbortSignal.timeout(60000),
  }).catch((error: unknown) => {
    throw new MediaError('MEDIA_PROVIDER_REQUEST_FAILED', `suno-api request failed: ${error instanceof Error ? error.message : String(error)}`, { retryable: true })
  })
  if (!response.ok) throw new MediaError('MEDIA_PROVIDER_REQUEST_FAILED', `suno-api responded ${response.status}`, { retryable: response.status >= 500 })
  const payload = (await response.json().catch(() => ({}))) as SunoCliptestResponse
  return (payload.data ?? [])
    .filter(item => typeof item.id === 'string')
    .map(item => ({ id: item.id as string, audioUrl: item.audio_url, title: item.title }))
}

export const SunoApiExperimentalProvider: MediaProvider = {
  id: SUNO_API_ID,
  kind: 'music',
  enabled: isSunoEnabled(),
  getCapabilities(): ProviderCapabilities {
    return {
      kind: 'music',
      models: ['suno (unofficial)'],
      async: true,
      canEstimate: false,
      canCancel: false,
      notes: 'default-OFF experimental adapter for a self-hosted suno-api service; see v3 plan §8.6 for the compliance boundary',
    }
  },
  validateConfig(): ProviderConfigStatus {
    if (!isSunoEnabled()) {
      return { ok: false, configured: false, message: 'disabled by default — requires MEDIA_ENABLE_EXPERIMENTAL_PROVIDERS=suno-api and MEDIA_SUNO_BASE_URL; review Suno ToS before enabling' }
    }
    if (!sunoBaseUrl()) return { ok: false, configured: false, message: 'MEDIA_SUNO_BASE_URL is not set' }
    return { ok: true, configured: true, message: `experimental, enabled (${sunoBaseUrl()})` }
  },
}
