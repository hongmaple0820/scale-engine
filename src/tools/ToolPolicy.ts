import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

export type ToolOrchestrationMode = 'off' | 'advisory' | 'evidence-required' | 'block'
export type ToolDestructiveActionPolicy = 'allow' | 'confirm' | 'block'

export interface ToolPolicyToolConfig {
  enabled: boolean
  requiredFor: string[]
  recommendedFor?: string[]
  allowedDomains?: string[]
  destructiveActions?: ToolDestructiveActionPolicy
  command?: string
  mcpToolName?: string
  evidenceRequired?: boolean
}

export interface ToolPolicyFile {
  version?: number
  mode?: ToolOrchestrationMode
  tools?: Record<string, Partial<ToolPolicyToolConfig>>
}

export interface ResolvedToolPolicy {
  version: number
  mode: ToolOrchestrationMode
  tools: Record<string, ToolPolicyToolConfig>
  warnings: string[]
}

export interface RequiredTool {
  id: string
  config: ToolPolicyToolConfig
}

export const DEFAULT_TOOL_POLICY: ResolvedToolPolicy = {
  version: 1,
  mode: 'evidence-required',
  warnings: [],
  tools: {
    'web-access': {
      enabled: true,
      requiredFor: ['webResearch'],
      recommendedFor: ['browserAutomation'],
      destructiveActions: 'block',
      evidenceRequired: true,
    },
    impeccable: {
      enabled: true,
      requiredFor: ['ui'],
      destructiveActions: 'block',
      evidenceRequired: true,
    },
    'taste-skill': {
      enabled: true,
      requiredFor: [],
      recommendedFor: ['ui'],
      destructiveActions: 'block',
      evidenceRequired: true,
    },
    'awesome-design-md': {
      enabled: true,
      requiredFor: [],
      recommendedFor: ['ui'],
      destructiveActions: 'block',
      evidenceRequired: true,
    },
    'ui-ux-pro-max': {
      enabled: true,
      requiredFor: [],
      recommendedFor: ['ui'],
      destructiveActions: 'block',
      evidenceRequired: true,
    },
    'frontend-design': {
      enabled: true,
      requiredFor: [],
      recommendedFor: ['ui'],
      destructiveActions: 'block',
      evidenceRequired: true,
    },
    'agent-browser': {
      enabled: true,
      requiredFor: ['browserAutomation'],
      recommendedFor: ['ui', 'e2e'],
      allowedDomains: ['localhost', '127.0.0.1'],
      destructiveActions: 'confirm',
      command: 'agent-browser',
      evidenceRequired: true,
    },
    playwright: {
      enabled: true,
      requiredFor: ['e2e'],
      recommendedFor: ['browserAutomation', 'ui'],
      destructiveActions: 'confirm',
      command: 'npx playwright',
      evidenceRequired: true,
    },
    'mcp-chrome-devtools': {
      enabled: true,
      requiredFor: ['browserAutomation'],
      recommendedFor: ['ui', 'e2e'],
      destructiveActions: 'confirm',
      mcpToolName: 'chrome-devtools',
      evidenceRequired: true,
    },
    'desktop-cua': {
      enabled: true,
      requiredFor: ['desktopAutomation'],
      destructiveActions: 'confirm',
      command: 'python -c "import cua"',
      evidenceRequired: true,
    },
    'codex-cli': {
      enabled: true,
      requiredFor: [],
      recommendedFor: ['externalCli', 'review'],
      destructiveActions: 'confirm',
      command: 'codex',
      evidenceRequired: true,
    },
    rtk: {
      enabled: true,
      requiredFor: ['externalCli'],
      recommendedFor: ['review'],
      destructiveActions: 'block',
      command: 'rtk',
      evidenceRequired: true,
    },
    'gemini-cli': {
      enabled: true,
      requiredFor: [],
      recommendedFor: ['externalCli', 'review'],
      destructiveActions: 'confirm',
      command: 'gemini',
      evidenceRequired: true,
    },
    'opencode-cli': {
      enabled: true,
      requiredFor: [],
      recommendedFor: ['externalCli', 'review'],
      destructiveActions: 'confirm',
      command: 'opencode',
      evidenceRequired: true,
    },
  },
}

export function toolPolicyPath(projectDir = process.cwd(), scaleDir = '.scale'): string {
  const root = isAbsolute(scaleDir) ? scaleDir : join(resolve(projectDir), scaleDir)
  return join(root, 'tools.json')
}

export function loadToolPolicy(projectDir = process.cwd(), scaleDir = '.scale'): ResolvedToolPolicy {
  const path = toolPolicyPath(projectDir, scaleDir)
  if (!existsSync(path)) {
    return {
      ...DEFAULT_TOOL_POLICY,
      warnings: [`No tool policy found at ${path}; using built-in defaults.`],
    }
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as ToolPolicyFile
    return resolveToolPolicy(parsed)
  } catch (error) {
    return {
      ...DEFAULT_TOOL_POLICY,
      warnings: [`Failed to read ${path}: ${(error as Error).message}; using built-in defaults.`],
    }
  }
}

export function resolveToolPolicy(input: ToolPolicyFile | null | undefined): ResolvedToolPolicy {
  const warnings: string[] = []
  const mode = normalizeMode(input?.mode)
  if (input?.mode && !mode) {
    warnings.push(`Invalid tool policy mode "${String(input.mode)}"; using ${DEFAULT_TOOL_POLICY.mode}.`)
  }

  const tools: Record<string, ToolPolicyToolConfig> = {}
  const ids = new Set([...Object.keys(DEFAULT_TOOL_POLICY.tools), ...Object.keys(input?.tools ?? {})])
  for (const id of ids) {
    const base = DEFAULT_TOOL_POLICY.tools[id] ?? {
      enabled: true,
      requiredFor: [],
      destructiveActions: 'confirm' as ToolDestructiveActionPolicy,
      evidenceRequired: true,
    }
    const override = input?.tools?.[id] ?? {}
    tools[id] = {
      ...base,
      ...override,
      requiredFor: override.requiredFor ?? base.requiredFor ?? [],
      recommendedFor: override.recommendedFor ?? base.recommendedFor,
      allowedDomains: override.allowedDomains ?? base.allowedDomains,
    }
  }

  return {
    version: typeof input?.version === 'number' ? input.version : DEFAULT_TOOL_POLICY.version,
    mode: mode ?? DEFAULT_TOOL_POLICY.mode,
    tools,
    warnings,
  }
}

export function requiredToolsForDomains(policy: ResolvedToolPolicy, domains: string[]): RequiredTool[] {
  const domainSet = new Set(domains)
  return Object.entries(policy.tools)
    .filter(([, config]) => config.enabled && config.requiredFor.some(domain => domainSet.has(domain)))
    .map(([id, config]) => ({ id, config }))
}

export function toolPolicyTemplate(mode: ToolOrchestrationMode = 'evidence-required'): string {
  return JSON.stringify({
    version: 1,
    mode,
    tools: DEFAULT_TOOL_POLICY.tools,
  }, null, 2) + '\n'
}

function normalizeMode(value: unknown): ToolOrchestrationMode | undefined {
  if (value === 'off' || value === 'advisory' || value === 'evidence-required' || value === 'block') return value
  return undefined
}
