// SCALE Engine — Configuration Profiles
// Pre-defined profiles that bundle common settings into simple choices.
// Users select a profile during `scale init`, then customize only what they need.

export interface ConfigProfile {
  id: string
  name: string
  description: string
  /** Which config sections are visible/relevant at this level */
  sections: ConfigSection[]
  /** Default values for this profile */
  defaults: ProfileDefaults
}

export type ConfigSection = 'basic' | 'guardrails' | 'knowledge' | 'evolution' | 'models' | 'advanced'
export type DependencyBootstrapPackId = 'ui' | 'memory' | 'knowledge' | 'external-cli'

export interface ProfileBootstrapPlan {
  profileId: string
  governancePack?: string
  packs: DependencyBootstrapPackId[]
  inspectCommand: string
  applyCommand: string
}

export interface ProfileDefaults {
  scenario: 'sandbox' | 'standard' | 'critical'
  guardrails: {
    enabled: boolean
    detectors: string[]
    autoLint: boolean
    beforeStop: boolean
  }
  knowledge: {
    enabled: boolean
    vectorSearch: boolean
  }
  evolution: {
    enabled: boolean
    autoApprove: boolean
  }
  models: {
    routing: 'simple' | 'advanced'
  }
}

export const PROFILES: Record<string, ConfigProfile> = {
  minimal: {
    id: 'minimal',
    name: 'Minimal',
    description: 'Basic artifact management. No guardrails, no knowledge, no evolution. Good for trying SCALE.',
    sections: ['basic'],
    defaults: {
      scenario: 'sandbox',
      guardrails: { enabled: false, detectors: [], autoLint: false, beforeStop: false },
      knowledge: { enabled: false, vectorSearch: false },
      evolution: { enabled: false, autoApprove: false },
      models: { routing: 'simple' },
    },
  },
  standard: {
    id: 'standard',
    name: 'Standard',
    description: 'Guardrails + lint + test verification. Recommended for most projects.',
    sections: ['basic', 'guardrails'],
    defaults: {
      scenario: 'standard',
      guardrails: {
        enabled: true,
        detectors: ['dangerous-command', 'role-permission', 'brute-retry', 'premature-done'],
        autoLint: true,
        beforeStop: true,
      },
      knowledge: { enabled: false, vectorSearch: false },
      evolution: { enabled: false, autoApprove: false },
      models: { routing: 'simple' },
    },
  },
  advanced: {
    id: 'advanced',
    name: 'Advanced',
    description: 'Full governance: guardrails + graphify knowledge recall + gbrain memory routing + evolution + model routing.',
    sections: ['basic', 'guardrails', 'knowledge', 'evolution', 'models', 'advanced'],
    defaults: {
      scenario: 'standard',
      guardrails: {
        enabled: true,
        detectors: ['dangerous-command', 'role-permission', 'brute-retry', 'premature-done', 'blame-shift', 'idle-tool', 'busy-loop'],
        autoLint: true,
        beforeStop: true,
      },
      knowledge: { enabled: true, vectorSearch: true },
      evolution: { enabled: true, autoApprove: false },
      models: { routing: 'advanced' },
    },
  },
  'china-local': {
    id: 'china-local',
    name: 'China Local',
    description: 'Optimized for local model deployment in China (Qwen/GLM/DeepSeek compatible). Reduced guardrails for local model contexts.',
    sections: ['basic', 'guardrails', 'models'],
    defaults: {
      scenario: 'standard',
      guardrails: {
        enabled: true,
        detectors: ['dangerous-command', 'role-permission', 'brute-retry', 'premature-done'],
        autoLint: true,
        beforeStop: false,
      },
      knowledge: { enabled: false, vectorSearch: false },
      evolution: { enabled: false, autoApprove: false },
      models: { routing: 'advanced' },
    },
  },
}

const PROFILE_BOOTSTRAP_PACKS: Record<string, DependencyBootstrapPackId[]> = {
  minimal: ['external-cli'],
  standard: ['external-cli'],
  advanced: ['external-cli', 'memory', 'knowledge'],
  'china-local': ['external-cli'],
}

const GOVERNANCE_PACK_BOOTSTRAP_PACKS: Record<string, DependencyBootstrapPackId[]> = {
  'frontend-app': ['ui'],
}

/**
 * Get profile by ID, falling back to 'standard' if not found.
 */
export function getProfile(id: string): ConfigProfile {
  return PROFILES[id] ?? PROFILES.standard
}

/**
 * List all available profiles for display.
 */
export function listProfiles(): Array<{
  id: string
  name: string
  description: string
  bootstrapPacks: DependencyBootstrapPackId[]
  dependencyBootstrapCommand: string
}> {
  return Object.values(PROFILES).map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    bootstrapPacks: getRecommendedBootstrapPacks(p.id),
    dependencyBootstrapCommand: getBootstrapPlanForProfile(p.id).inspectCommand,
  }))
}

export function getRecommendedBootstrapPacks(profileId: string, governancePack?: string): DependencyBootstrapPackId[] {
  const profile = getProfile(profileId)
  const selected = [
    ...(PROFILE_BOOTSTRAP_PACKS[profile.id] ?? PROFILE_BOOTSTRAP_PACKS.standard),
    ...(governancePack ? (GOVERNANCE_PACK_BOOTSTRAP_PACKS[governancePack] ?? []) : []),
  ]
  return unique(selected)
}

export function getBootstrapPlanForProfile(profileId: string, governancePack?: string): ProfileBootstrapPlan {
  const profile = getProfile(profileId)
  const packs = getRecommendedBootstrapPacks(profile.id, governancePack)
  const packArg = packs.join(',')
  const memoryArgs = packs.includes('memory') ? ' --memory-provider gbrain --memory-mode external-first' : ''
  return {
    profileId: profile.id,
    governancePack,
    packs,
    inspectCommand: `scale setup --pack ${packArg}${memoryArgs} --json`,
    applyCommand: `scale setup --pack ${packArg}${memoryArgs} --apply --yes`,
  }
}

/**
 * Generate config.yaml content for a given profile.
 * Returns only the sections relevant to the profile level.
 */
export function generateConfigForProfile(
  profileId: string,
  projectInfo: { name: string; type?: string; agents?: string[] }
): string {
  const profile = getProfile(profileId)
  const d = profile.defaults
  const lines: string[] = []

  lines.push(`# SCALE Engine Configuration`)
  lines.push(`# Profile: ${profile.name} — ${profile.description}`)
  lines.push(`# Customize below, or change profile with: scale config profile <id>`)
  lines.push(``)
  lines.push(`version: 1`)
  lines.push(`profile: ${profileId}`)
  lines.push(``)
  lines.push(`project:`)
  lines.push(`  name: ${projectInfo.name}`)
  if (projectInfo.type) lines.push(`  type: ${projectInfo.type}`)
  lines.push(``)
  lines.push(`storage:`)
  lines.push(`  db: .scale/scale.db`)
  lines.push(`  events: .scale/events`)
  lines.push(`  artifacts: .scale/artifacts`)
  if (d.knowledge.vectorSearch) {
    lines.push(`  knowledge:`)
    lines.push(`    backend: graphify`)
    lines.push(`    graph: graphify-out/graph.json`)
    lines.push(`  memory:`)
    lines.push(`    provider: gbrain`)
  }
  lines.push(``)

  if (projectInfo.agents && projectInfo.agents.length > 0) {
    lines.push(`agents:`)
    for (const agent of projectInfo.agents) {
      lines.push(`  - name: ${agent}`)
    }
    lines.push(``)
  }

  if (profile.sections.includes('guardrails')) {
    lines.push(`guardrails:`)
    lines.push(`  preTool:`)
    lines.push(`    enabled: ${d.guardrails.enabled}`)
    if (d.guardrails.detectors.length > 0) {
      lines.push(`    detectors:`)
      for (const det of d.guardrails.detectors) {
        lines.push(`      - ${det}`)
      }
    }
    lines.push(`  postTool:`)
    lines.push(`    enabled: ${d.guardrails.enabled}`)
    lines.push(`    autoLint:`)
    lines.push(`      enabled: ${d.guardrails.autoLint}`)
    lines.push(`  beforeStop:`)
    lines.push(`    enabled: ${d.guardrails.beforeStop}`)
    lines.push(`    requireVerification: true`)
    lines.push(``)
  }

  if (profile.sections.includes('knowledge')) {
    lines.push(`knowledge:`)
    lines.push(`  extraction:`)
    lines.push(`    enabled: ${d.knowledge.enabled}`)
    lines.push(`  recall:`)
    lines.push(`    topK: 3`)
    lines.push(`    minRelevance: 0.4`)
    lines.push(``)
  }

  if (profile.sections.includes('evolution')) {
    lines.push(`evolution:`)
    lines.push(`  enabled: ${d.evolution.enabled}`)
    lines.push(`  autoApprove: ${d.evolution.autoApprove}`)
    lines.push(``)
  }

  if (profile.sections.includes('models')) {
    lines.push(`models:`)
    lines.push(`  defaults:`)
    if (d.models.routing === 'simple') {
      lines.push(`    all: claude-sonnet-4-5`)
    } else if (profileId === 'china-local') {
      lines.push(`    explore: qwen-2.5-72b`)
      lines.push(`    plan: deepseek-v3`)
      lines.push(`    implement: qwen-2.5-72b`)
      lines.push(`    verify: qwen-2.5-7b`)
      lines.push(`    architect: glm-4-plus`)
    } else {
      lines.push(`    explore: claude-haiku`)
      lines.push(`    plan: claude-sonnet-4-5`)
      lines.push(`    implement: claude-sonnet-4-5`)
      lines.push(`    verify: claude-haiku`)
      lines.push(`    architect: claude-opus-4-5`)
    }
    lines.push(``)
  }

  lines.push(`logging:`)
  lines.push(`  level: info`)
  lines.push(`  file: .scale/scale.log`)

  return lines.join('\n')
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}
