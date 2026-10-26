// Provider registry (v3 plan §8.3): mock first, one OpenAI-compatible image
// provider, experimental music provider default-OFF. `enabled` gates access —
// a disabled provider cannot be reached through any entry point.

import type { MediaProvider, ProviderConfigStatus } from './types.js'
import { MockImageProvider } from './image/MockImageProvider.js'
import { OpenAICompatibleImageProvider } from './image/OpenAICompatibleImageProvider.js'
import { SunoApiExperimentalProvider } from './music/SunoApiExperimentalProvider.js'

const REGISTRY: MediaProvider[] = [MockImageProvider, OpenAICompatibleImageProvider, SunoApiExperimentalProvider]

export interface ProviderSummary {
  id: string
  kind: MediaProvider['kind']
  enabled: boolean
  configured: boolean
  message: string
  models: string[]
}

export function listProviders(): ProviderSummary[] {
  return REGISTRY.map(provider => {
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
  const provider = REGISTRY.find(entry => entry.id === id)
  if (!provider || !provider.enabled) return undefined
  return provider
}
