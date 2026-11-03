// Provider registry (v3 plan §8.3, M2 feature flags). `enabled` gates access —
// a disabled provider cannot be reached through any entry point. Video/speech
// registration is evaluated per call from MEDIA_FEATURE_VIDEO /
// MEDIA_FEATURE_SPEECH, never frozen at module load.
//
// M2 scope note: the live video adapter (Seedance) is deliberately not shipped
// — its endpoints/model were not verified against a real key (see S0 record in
// docs/plans/2026-10-29-media-platform-v2-plan.md). `live` therefore registers
// no video provider and the feature report says so instead of pretending.

import type { MediaProvider, ProviderConfigStatus } from './types.js'
import { MockImageProvider } from './image/MockImageProvider.js'
import { OpenAICompatibleImageProvider } from './image/OpenAICompatibleImageProvider.js'
import { SunoApiExperimentalProvider } from './music/SunoApiExperimentalProvider.js'
import { MockVideoProvider } from './video/MockVideoProvider.js'
import { MockSpeechProvider } from './speech/MockSpeechProvider.js'
import { OpenAISpeechProvider } from './speech/OpenAISpeechProvider.js'

export type FeatureMode = 'off' | 'mock' | 'live'

export interface ProviderFeature {
  kind: 'video' | 'speech'
  mode: FeatureMode
  message: string
}

export interface ProviderSummary {
  id: string
  kind: MediaProvider['kind']
  enabled: boolean
  configured: boolean
  message: string
  models: string[]
}

function featureMode(envName: string): { mode: FeatureMode; raw?: string } {
  const raw = process.env[envName]?.trim().toLowerCase()
  if (raw === 'mock' || raw === 'live') return { mode: raw }
  return { mode: 'off', raw }
}

function registryEntries(): MediaProvider[] {
  const entries: MediaProvider[] = [MockImageProvider, OpenAICompatibleImageProvider, SunoApiExperimentalProvider]

  const video = featureMode('MEDIA_FEATURE_VIDEO')
  if (video.mode === 'mock') entries.push(MockVideoProvider)
  // video.mode === 'live': intentionally no adapter yet (S0 not verified)

  const speech = featureMode('MEDIA_FEATURE_SPEECH')
  if (speech.mode === 'mock') entries.push(MockSpeechProvider)
  if (speech.mode === 'live') entries.push(OpenAISpeechProvider)

  return entries
}

export function listProviderFeatures(): ProviderFeature[] {
  const video = featureMode('MEDIA_FEATURE_VIDEO')
  const speech = featureMode('MEDIA_FEATURE_SPEECH')
  const invalid = (raw: string | undefined) => raw !== undefined && raw !== 'off' && raw !== 'mock' && raw !== 'live'
  return [
    {
      kind: 'video',
      mode: video.mode,
      message:
        video.mode === 'mock'
          ? 'mock video provider registered (synthetic bytes, no network)'
          : video.mode === 'live'
            ? 'live video is not implemented in this build (S0 not verified); no provider registered'
            : invalid(video.raw)
              ? `ignored invalid MEDIA_FEATURE_VIDEO="${video.raw}"`
              : 'video providers disabled',
    },
    {
      kind: 'speech',
      mode: speech.mode,
      message:
        speech.mode === 'mock'
          ? 'mock speech provider registered'
          : speech.mode === 'live'
            ? 'OpenAI-compatible speech registered; usable only when configured (kept visible on purpose)'
            : invalid(speech.raw)
              ? `ignored invalid MEDIA_FEATURE_SPEECH="${speech.raw}"`
              : 'speech providers disabled',
    },
  ]
}

export function listProviders(): ProviderSummary[] {
  return registryEntries().map(provider => {
    const status: ProviderConfigStatus = provider.validateConfig()
    return {
      id: provider.id,
      kind: provider.kind,
      enabled: provider.enabled,
      configured: status.configured,
      message: status.message,
      models: provider.getCapabilities().models,
    }
  })
}

export function getProvider(id: string): MediaProvider | undefined {
  const provider = registryEntries().find(entry => entry.id === id)
  if (!provider || !provider.enabled) return undefined
  return provider
}

export function getVideoProvider(id: string): MediaProvider | undefined {
  const provider = getProvider(id)
  return provider?.kind === 'video' && provider.submitVideo ? provider : undefined
}

export function getSpeechProvider(id: string): MediaProvider | undefined {
  const provider = getProvider(id)
  return provider?.kind === 'speech' && provider.generateSpeech ? provider : undefined
}
