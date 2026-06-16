import type { AgentPlatform } from '../artifact/types.js'

export type AcpSupportStatus = 'candidate' | 'adapter-only' | 'external-only'

export type AcpExecutionMode = 'acp-subprocess' | 'scale-adapter' | 'manual-bridge'

export interface AcpPlatformBridge {
  requestedPlatform: string
  platform?: AgentPlatform
  acpStatus: AcpSupportStatus
  executionMode: AcpExecutionMode
  transport: 'stdio-json-rpc' | 'adapter-api' | 'custom'
  notes: string
}

export interface AcpCollaborationPlan {
  version: 'acp-collaboration-plan-v1'
  task: string
  strategy: 'acp-first-with-adapter-fallback'
  protocol: {
    name: 'Agent Client Protocol'
    localTransport: 'JSON-RPC over stdio'
    remoteTransport: 'HTTP/WebSocket planned'
  }
  bridges: AcpPlatformBridge[]
  handoffChannels: string[]
  reviewGates: string[]
  warnings: string[]
}

const localPlatformAliases: Record<string, AgentPlatform> = {
  'claude-code': 'claude-code',
  claude: 'claude-code',
  codex: 'codex',
  'codex-cli': 'codex',
  gemini: 'gemini',
  'gemini-cli': 'gemini',
  opencode: 'opencode',
  'open-code': 'opencode',
  cursor: 'cursor',
  openclaw: 'openclaw',
  hermes: 'hermes',
  trae: 'trae',
  workbuddy: 'workbuddy',
  vsc: 'vsc',
  qcoder: 'qcoder',
  qoder: 'qoder',
  'deepseek-tui': 'deepseek-tui',
  aider: 'aider',
  windsurf: 'windsurf',
  kimi: 'kimi',
  doubao: 'doubao',
  kiro: 'kiro',
  jcode: 'jcode',
  cline: 'cline',
  kilocode: 'kilocode',
  antigravity: 'antigravity',
}

const acpCandidatePlatforms = new Set<AgentPlatform>(['claude-code', 'codex', 'gemini'])

const defaultPlatforms: AgentPlatform[] = ['claude-code', 'codex', 'gemini', 'opencode', 'cursor']

function createBridge(requestedPlatform: string): AcpPlatformBridge {
  const normalized = requestedPlatform.trim().toLowerCase()
  const platform = localPlatformAliases[normalized]
  if (!platform) {
    return {
      requestedPlatform,
      acpStatus: 'external-only',
      executionMode: 'manual-bridge',
      transport: 'custom',
      notes: 'No local SCALE adapter is declared for this platform; use a custom ACP bridge or keep it as a manual handoff.',
    }
  }
  if (acpCandidatePlatforms.has(platform)) {
    return {
      requestedPlatform,
      platform,
      acpStatus: 'candidate',
      executionMode: 'acp-subprocess',
      transport: 'stdio-json-rpc',
      notes: 'Eligible for ACP-first orchestration when a compatible local ACP agent/provider is installed.',
    }
  }
  return {
    requestedPlatform,
    platform,
    acpStatus: 'adapter-only',
    executionMode: 'scale-adapter',
    transport: 'adapter-api',
    notes: 'Use the existing SCALE adapter until this platform exposes a compatible ACP bridge.',
  }
}

export function createAcpCollaborationPlan(options: {
  task: string
  platforms?: string[]
}): AcpCollaborationPlan {
  const requested = (options.platforms?.length ? options.platforms : defaultPlatforms).map(platform => platform.trim()).filter(Boolean)
  const bridges = requested.map(createBridge)
  const external = bridges.filter(bridge => bridge.acpStatus === 'external-only')
  return {
    version: 'acp-collaboration-plan-v1',
    task: options.task,
    strategy: 'acp-first-with-adapter-fallback',
    protocol: {
      name: 'Agent Client Protocol',
      localTransport: 'JSON-RPC over stdio',
      remoteTransport: 'HTTP/WebSocket planned',
    },
    bridges,
    handoffChannels: [
      'task-brief: pass scope, files, acceptance criteria, and constraints to each agent',
      'artifact-evidence: collect plan, diff, command output, and review artifacts in SCALE',
      'review-gate: require a verifier or reviewer role before marking the collaboration complete',
    ],
    reviewGates: [
      'acp-or-adapter-availability-checked',
      'agent-brief-normalized',
      'handoff-artifacts-recorded',
      'verification-evidence-attached',
      'manual-fallback-declared-for-external-only-platforms',
    ],
    warnings: external.length > 0
      ? [`No local platform mapping for: ${external.map(bridge => bridge.requestedPlatform).join(', ')}`]
      : [],
  }
}

export function renderAcpCollaborationPlanMarkdown(plan: AcpCollaborationPlan): string {
  return [
    '# ACP Collaboration Plan',
    '',
    `Task: ${plan.task}`,
    `Strategy: ${plan.strategy}`,
    `Protocol: ${plan.protocol.name}; local transport ${plan.protocol.localTransport}`,
    '',
    '## Bridges',
    '',
    plan.bridges.map(bridge => [
      `- ${bridge.requestedPlatform}`,
      `  - mode: ${bridge.executionMode}`,
      `  - status: ${bridge.acpStatus}`,
      `  - transport: ${bridge.transport}`,
      `  - notes: ${bridge.notes}`,
    ].join('\n')).join('\n'),
    '',
    '## Handoff Channels',
    '',
    plan.handoffChannels.map(channel => `- ${channel}`).join('\n'),
    '',
    '## Review Gates',
    '',
    plan.reviewGates.map(gate => `- ${gate}`).join('\n'),
    plan.warnings.length > 0 ? '' : undefined,
    plan.warnings.length > 0 ? '## Warnings' : undefined,
    plan.warnings.length > 0 ? '' : undefined,
    plan.warnings.length > 0 ? plan.warnings.map(warning => `- ${warning}`).join('\n') : undefined,
    '',
  ].filter((line): line is string => line !== undefined).join('\n')
}
