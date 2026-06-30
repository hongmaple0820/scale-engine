import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { inspectToolCapabilities, type ToolCapabilityEntry, type ToolCapabilityReport } from '../tools/ToolCapabilityRegistry.js'
import { loadToolPolicy, type ResolvedToolPolicy, type ToolDestructiveActionPolicy } from '../tools/ToolPolicy.js'

export type AgentOsCapabilityKind = 'skill' | 'mcp' | 'cli' | 'provider' | 'connector' | 'browser' | 'desktop'
export type AgentOsCapabilityStatus = 'available' | 'missing' | 'disabled' | 'blocked' | 'degraded'
export type AgentOsCapabilityTrust = 'trusted' | 'review-required' | 'restricted' | 'blocked'
export type AgentOsCapabilitySideEffect = 'read' | 'write' | 'network' | 'process' | 'credential' | 'destructive'
export type AgentOsApprovalPolicy = 'none' | 'on-write' | 'on-risk' | 'always'

export interface AgentOsCapabilityOperation {
  id: string
  title: string
  primitive: boolean
  sideEffects: AgentOsCapabilitySideEffect[]
}

export interface AgentOsCapabilityDescriptor {
  id: string
  kind: AgentOsCapabilityKind
  displayName: string
  version?: string
  status: AgentOsCapabilityStatus
  installed: boolean
  trust: AgentOsCapabilityTrust
  operations: AgentOsCapabilityOperation[]
  sideEffects: AgentOsCapabilitySideEffect[]
  requiredEvidence: string[]
  approvalPolicy: AgentOsApprovalPolicy
  fallback?: string
  healthCheck?: string
  source?: string
  detectedPath?: string
  missingReason?: string
  projectRefs?: string[]
  lastCheckedAt?: string
  policyEnabled: boolean
  requiredFor: string[]
  recommendedFor: string[]
}

export interface AgentOsCapabilityReport {
  version: 1
  projectDir: string
  ok: boolean
  summary: {
    total: number
    available: number
    missing: number
    disabled: number
    blocked: number
    degraded: number
    restricted: number
    approvalRequired: number
  }
  descriptors: AgentOsCapabilityDescriptor[]
  parity: AgentOsCapabilityParityEntry[]
  warnings: string[]
}

export interface AgentOsCapabilityParityEntry {
  userAction: string
  cli: string
  api: string
  agentTool: string
  state: 'covered'
}

export interface BuildAgentOsCapabilityReportOptions {
  projectDir?: string
  scaleDir?: string
  capabilityIds?: string[]
  toolReport?: ToolCapabilityReport
  policy?: ResolvedToolPolicy
  registry?: AgentOsCapabilityRegistry
  includeRegistry?: boolean
}

export interface AgentOsCapabilityRegistryState {
  version: 1
  updatedAt: string
  capabilities: AgentOsCapabilityDescriptor[]
}

export interface AgentOsCapabilityRegistryOptions {
  projectDir?: string
  scaleDir?: string
  now?: () => Date
}

export interface RegisterAgentOsCapabilityInput {
  id: string
  kind: AgentOsCapabilityKind
  displayName?: string
  version?: string
  status?: AgentOsCapabilityStatus
  trust?: AgentOsCapabilityTrust
  operations?: AgentOsCapabilityOperation[]
  sideEffects?: AgentOsCapabilitySideEffect[]
  requiredEvidence?: string[]
  approvalPolicy?: AgentOsApprovalPolicy
  fallback?: string
  healthCheck?: string
  source?: string
  detectedPath?: string
  missingReason?: string
  projectRefs?: string[]
  policyEnabled?: boolean
  requiredFor?: string[]
  recommendedFor?: string[]
}

export function buildAgentOsCapabilityReport(options: BuildAgentOsCapabilityReportOptions = {}): AgentOsCapabilityReport {
  const projectDir = options.projectDir ?? process.cwd()
  const policy = options.policy ?? loadToolPolicy(projectDir, options.scaleDir ?? '.scale')
  const usingImplicitPolicy = policy.warnings.some(warning => warning.startsWith('No tool policy found at '))
  const toolReport = options.toolReport ?? inspectToolCapabilities({
    projectDir,
    toolIds: normalizeCapabilityIds(options.capabilityIds),
  })
  const dynamicDescriptors = toolReport.tools.map(tool => toDescriptor(tool, policy, { usingImplicitPolicy }))
  const registry = options.registry ?? new AgentOsCapabilityRegistry({ projectDir, scaleDir: options.scaleDir })
  const registeredDescriptors = options.includeRegistry === false ? [] : registry.list()
  const descriptors = applyCapabilityFilter(mergeDescriptors(dynamicDescriptors, registeredDescriptors), options.capabilityIds)
  const summary = summarize(descriptors)
  return {
    version: 1,
    projectDir,
    ok: descriptors.every(descriptor => descriptor.status === 'available' || descriptor.status === 'disabled'),
    summary,
    descriptors,
    parity: defaultCapabilityParity(),
    warnings: [...policy.warnings],
  }
}

export class AgentOsCapabilityRegistry {
  private path: string
  private now: () => Date

  constructor(options: AgentOsCapabilityRegistryOptions = {}) {
    const projectDir = resolve(options.projectDir ?? process.cwd())
    const scaleRoot = isAbsolute(options.scaleDir ?? '')
      ? options.scaleDir as string
      : join(projectDir, options.scaleDir ?? '.scale')
    this.path = join(scaleRoot, 'capabilities.json')
    this.now = options.now ?? (() => new Date())
  }

  register(input: RegisterAgentOsCapabilityInput): AgentOsCapabilityDescriptor {
    const state = this.load()
    const descriptor = normalizeRegisteredCapability(input, this.isoNow())
    const next = [
      ...state.capabilities.filter(item => item.id !== descriptor.id),
      descriptor,
    ].sort((a, b) => a.id.localeCompare(b.id))
    this.save({ version: 1, updatedAt: this.isoNow(), capabilities: next })
    return descriptor
  }

  trust(id: string, trust: AgentOsCapabilityTrust = 'trusted'): AgentOsCapabilityDescriptor {
    const state = this.load()
    const current = state.capabilities.find(item => item.id === id)
    if (!current) throw new Error(`Capability not registered: ${id}`)
    const updated: AgentOsCapabilityDescriptor = {
      ...current,
      trust,
      status: trust === 'blocked' ? 'blocked' : current.installed ? 'available' : current.status,
      policyEnabled: trust !== 'blocked',
      lastCheckedAt: this.isoNow(),
    }
    this.save({
      version: 1,
      updatedAt: this.isoNow(),
      capabilities: state.capabilities.map(item => item.id === id ? updated : item),
    })
    return updated
  }

  disable(id: string, reason?: string): AgentOsCapabilityDescriptor {
    const state = this.load()
    const current = state.capabilities.find(item => item.id === id)
    if (!current) throw new Error(`Capability not registered: ${id}`)
    const updated: AgentOsCapabilityDescriptor = {
      ...current,
      status: 'disabled',
      policyEnabled: false,
      missingReason: reason ?? current.missingReason,
      lastCheckedAt: this.isoNow(),
    }
    this.save({
      version: 1,
      updatedAt: this.isoNow(),
      capabilities: state.capabilities.map(item => item.id === id ? updated : item),
    })
    return updated
  }

  list(): AgentOsCapabilityDescriptor[] {
    return this.load().capabilities
  }

  load(): AgentOsCapabilityRegistryState {
    if (!existsSync(this.path)) {
      return { version: 1, updatedAt: this.isoNow(), capabilities: [] }
    }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf-8')) as Partial<AgentOsCapabilityRegistryState>
      return {
        version: 1,
        updatedAt: String(parsed.updatedAt ?? this.isoNow()),
        capabilities: Array.isArray(parsed.capabilities)
          ? parsed.capabilities.map(item => normalizeRegisteredCapability(item, this.isoNow()))
          : [],
      }
    } catch {
      return { version: 1, updatedAt: this.isoNow(), capabilities: [] }
    }
  }

  getPath(): string {
    return this.path
  }

  private save(state: AgentOsCapabilityRegistryState): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, `${JSON.stringify(state, null, 2)}\n`, 'utf-8')
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}

function normalizeCapabilityIds(capabilityIds: string[] | undefined): string[] | undefined {
  if (!capabilityIds) return undefined
  return capabilityIds.map(capabilityId => {
    if (capabilityId === 'cua') return 'desktop-cua'
    return capabilityId
  })
}

function applyCapabilityFilter(descriptors: AgentOsCapabilityDescriptor[], capabilityIds: string[] | undefined): AgentOsCapabilityDescriptor[] {
  const normalized = normalizeCapabilityIds(capabilityIds)
  if (!normalized?.length) return descriptors
  const wanted = new Set(normalized)
  return descriptors.filter(descriptor => wanted.has(descriptor.id))
}

function mergeDescriptors(dynamicDescriptors: AgentOsCapabilityDescriptor[], registeredDescriptors: AgentOsCapabilityDescriptor[]): AgentOsCapabilityDescriptor[] {
  const merged = new Map<string, AgentOsCapabilityDescriptor>()
  for (const descriptor of dynamicDescriptors) merged.set(descriptor.id, descriptor)
  for (const descriptor of registeredDescriptors) {
    const current = merged.get(descriptor.id)
    merged.set(descriptor.id, current ? mergeDescriptor(current, descriptor) : descriptor)
  }
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id))
}

function mergeDescriptor(dynamicDescriptor: AgentOsCapabilityDescriptor, registeredDescriptor: AgentOsCapabilityDescriptor): AgentOsCapabilityDescriptor {
  return {
    ...dynamicDescriptor,
    ...registeredDescriptor,
    installed: registeredDescriptor.installed || dynamicDescriptor.installed,
    detectedPath: registeredDescriptor.detectedPath ?? dynamicDescriptor.detectedPath,
    missingReason: registeredDescriptor.missingReason ?? dynamicDescriptor.missingReason,
    operations: registeredDescriptor.operations.length > 0 ? registeredDescriptor.operations : dynamicDescriptor.operations,
    requiredEvidence: registeredDescriptor.requiredEvidence.length > 0 ? registeredDescriptor.requiredEvidence : dynamicDescriptor.requiredEvidence,
    requiredFor: uniqueStrings([...dynamicDescriptor.requiredFor, ...registeredDescriptor.requiredFor]),
    recommendedFor: uniqueStrings([...dynamicDescriptor.recommendedFor, ...registeredDescriptor.recommendedFor]),
  }
}

function toDescriptor(tool: ToolCapabilityEntry, policy: ResolvedToolPolicy, options: { usingImplicitPolicy?: boolean } = {}): AgentOsCapabilityDescriptor {
  const config = policy.tools[tool.id]
  const forceBlockedUntilProjectPolicy = options.usingImplicitPolicy === true && tool.id === 'desktop-cua'
  const policyEnabled = forceBlockedUntilProjectPolicy ? false : config?.enabled ?? true
  const destructiveActions = forceBlockedUntilProjectPolicy ? 'block' : config?.destructiveActions ?? 'confirm'
  const status = resolveStatus(tool, policyEnabled, destructiveActions)
  const sideEffects = resolveSideEffects(tool, destructiveActions)
  return {
    id: tool.id,
    kind: mapKind(tool.category),
    displayName: tool.name,
    version: tool.version,
    status,
    installed: tool.installed,
    trust: resolveTrust(tool, status),
    operations: operationsFor(tool, sideEffects),
    sideEffects,
    requiredEvidence: evidenceFor(tool),
    approvalPolicy: approvalFor(destructiveActions, sideEffects),
    fallback: fallbackFor(tool),
    healthCheck: healthCheckFor(tool),
    source: tool.source,
    detectedPath: tool.detectedPath,
    missingReason: tool.missingReason,
    policyEnabled,
    requiredFor: config?.requiredFor ?? tool.requiredFor,
    recommendedFor: config?.recommendedFor ?? tool.recommendedFor ?? [],
    lastCheckedAt: new Date().toISOString(),
  }
}

function normalizeRegisteredCapability(input: Partial<RegisterAgentOsCapabilityInput & AgentOsCapabilityDescriptor>, checkedAt: string): AgentOsCapabilityDescriptor {
  const id = String(input.id ?? '').trim()
  if (!id) throw new Error('Capability id is required.')
  const kind = normalizeKind(input.kind)
  const sideEffects = normalizeSideEffects(input.sideEffects)
  return {
    id,
    kind,
    displayName: String(input.displayName ?? input.id ?? id),
    version: input.version,
    status: normalizeStatus(input.status),
    installed: input.installed ?? normalizeStatus(input.status) === 'available',
    trust: normalizeTrust(input.trust),
    operations: Array.isArray(input.operations) && input.operations.length > 0
      ? input.operations.map(operation => ({
        id: String(operation.id),
        title: String(operation.title),
        primitive: Boolean(operation.primitive),
        sideEffects: normalizeSideEffects(operation.sideEffects),
      }))
      : [{
        id: 'invoke',
        title: `Invoke ${String(input.displayName ?? id)} through governed policy`,
        primitive: true,
        sideEffects,
      }],
    sideEffects,
    requiredEvidence: uniqueStrings(input.requiredEvidence ?? evidenceForKind(kind)),
    approvalPolicy: input.approvalPolicy ?? approvalForSideEffects(sideEffects),
    fallback: input.fallback ?? `Document manual evidence or disable ${id} until the capability is configured.`,
    healthCheck: input.healthCheck ?? 'registry-declared',
    source: input.source ?? 'project capability registry',
    detectedPath: input.detectedPath,
    missingReason: input.missingReason,
    projectRefs: uniqueStrings(input.projectRefs ?? []),
    lastCheckedAt: input.lastCheckedAt ?? checkedAt,
    policyEnabled: input.policyEnabled ?? normalizeTrust(input.trust) !== 'blocked',
    requiredFor: uniqueStrings(input.requiredFor ?? []),
    recommendedFor: uniqueStrings(input.recommendedFor ?? []),
  }
}

function normalizeKind(value: unknown): AgentOsCapabilityKind {
  const normalized = String(value ?? 'connector')
  const kinds: AgentOsCapabilityKind[] = ['skill', 'mcp', 'cli', 'provider', 'connector', 'browser', 'desktop']
  return kinds.includes(normalized as AgentOsCapabilityKind) ? normalized as AgentOsCapabilityKind : 'connector'
}

function normalizeStatus(value: unknown): AgentOsCapabilityStatus {
  const normalized = String(value ?? 'available')
  const statuses: AgentOsCapabilityStatus[] = ['available', 'missing', 'disabled', 'blocked', 'degraded']
  return statuses.includes(normalized as AgentOsCapabilityStatus) ? normalized as AgentOsCapabilityStatus : 'available'
}

function normalizeTrust(value: unknown): AgentOsCapabilityTrust {
  const normalized = String(value ?? 'review-required')
  const trust: AgentOsCapabilityTrust[] = ['trusted', 'review-required', 'restricted', 'blocked']
  return trust.includes(normalized as AgentOsCapabilityTrust) ? normalized as AgentOsCapabilityTrust : 'review-required'
}

function normalizeSideEffects(value: unknown): AgentOsCapabilitySideEffect[] {
  const effects: AgentOsCapabilitySideEffect[] = ['read', 'write', 'network', 'process', 'credential', 'destructive']
  const raw = Array.isArray(value) ? value.map(String) : ['read']
  return uniqueStrings(raw).filter((item): item is AgentOsCapabilitySideEffect => effects.includes(item as AgentOsCapabilitySideEffect))
}

function evidenceForKind(kind: AgentOsCapabilityKind): string[] {
  if (kind === 'provider') return ['provider-health', 'model-or-endpoint', 'usage-boundary']
  if (kind === 'connector') return ['bridge-registration', 'heartbeat', 'scope']
  if (kind === 'mcp') return ['mcp-tool-call', 'sanitized-output', 'server-health']
  if (kind === 'browser') return ['screenshot', 'console-summary', 'network-summary', 'viewport']
  if (kind === 'desktop') return ['operator-boundary', 'before-screenshot', 'after-screenshot']
  if (kind === 'cli') return ['command', 'exit-code', 'output-summary']
  return ['skill-loaded', 'task-artifact', 'verification-note']
}

function approvalForSideEffects(sideEffects: AgentOsCapabilitySideEffect[]): AgentOsApprovalPolicy {
  if (sideEffects.includes('destructive') || sideEffects.includes('credential')) return 'always'
  if (sideEffects.includes('write') || sideEffects.includes('process') || sideEffects.includes('network')) return 'on-risk'
  return 'none'
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.map(item => item.trim()).filter(Boolean))]
}

function mapKind(category: ToolCapabilityEntry['category']): AgentOsCapabilityKind {
  if (category === 'browser') return 'browser'
  if (category === 'desktop') return 'desktop'
  return category
}

function resolveStatus(
  tool: ToolCapabilityEntry,
  policyEnabled: boolean,
  destructiveActions: ToolDestructiveActionPolicy,
): AgentOsCapabilityStatus {
  if (!policyEnabled) return destructiveActions === 'block' ? 'blocked' : 'disabled'
  if (!tool.installed) return 'missing'
  if (tool.category === 'desktop' && destructiveActions === 'block') return 'blocked'
  return 'available'
}

function resolveTrust(tool: ToolCapabilityEntry, status: AgentOsCapabilityStatus): AgentOsCapabilityTrust {
  if (status === 'blocked') return 'blocked'
  if (tool.category === 'desktop' || tool.category === 'browser' || tool.category === 'mcp') return 'restricted'
  if (tool.category === 'cli') return tool.id === 'rtk' ? 'trusted' : 'review-required'
  if (tool.source === 'project skill routing policy') return 'trusted'
  return tool.installed ? 'trusted' : 'review-required'
}

function resolveSideEffects(tool: ToolCapabilityEntry, destructiveActions: ToolDestructiveActionPolicy): AgentOsCapabilitySideEffect[] {
  const effects = new Set<AgentOsCapabilitySideEffect>(['read'])
  if (tool.category === 'cli' || tool.category === 'browser' || tool.category === 'desktop') effects.add('process')
  if (tool.category === 'mcp' || tool.category === 'browser') effects.add('network')
  if (tool.category === 'desktop') {
    effects.add('write')
    effects.add('credential')
  }
  if (destructiveActions === 'confirm' || destructiveActions === 'allow') effects.add('write')
  if (destructiveActions === 'block') effects.add('destructive')
  return [...effects]
}

function operationsFor(tool: ToolCapabilityEntry, sideEffects: AgentOsCapabilitySideEffect[]): AgentOsCapabilityOperation[] {
  const operations: AgentOsCapabilityOperation[] = [
    {
      id: 'inspect',
      title: `Inspect ${tool.name} availability and metadata`,
      primitive: true,
      sideEffects: ['read'],
    },
  ]
  if (tool.category === 'skill') {
    operations.push({
      id: 'read_skill',
      title: `Read ${tool.name} instructions on demand`,
      primitive: true,
      sideEffects: ['read'],
    })
    return operations
  }
  operations.push({
    id: 'invoke',
    title: `Invoke ${tool.name} through governed policy`,
    primitive: true,
    sideEffects,
  })
  return operations
}

function evidenceFor(tool: ToolCapabilityEntry): string[] {
  if (tool.category === 'browser') return ['screenshot', 'console-summary', 'network-summary', 'viewport']
  if (tool.category === 'desktop') return ['operator-boundary', 'before-screenshot', 'after-screenshot']
  if (tool.category === 'mcp') return ['mcp-tool-call', 'sanitized-output', 'server-health']
  if (tool.category === 'cli') return ['command', 'exit-code', 'output-summary']
  return ['skill-loaded', 'task-artifact', 'verification-note']
}

function approvalFor(
  destructiveActions: ToolDestructiveActionPolicy,
  sideEffects: AgentOsCapabilitySideEffect[],
): AgentOsApprovalPolicy {
  if (destructiveActions === 'block') return 'always'
  if (destructiveActions === 'confirm') return 'on-risk'
  if (sideEffects.includes('write')) return 'on-write'
  return 'none'
}

function fallbackFor(tool: ToolCapabilityEntry): string {
  if (tool.category === 'browser') return 'Use manual smoke evidence with screenshots and console/network notes.'
  if (tool.category === 'desktop') return 'Use a manual operator checklist with screenshots and affected-app notes.'
  if (tool.category === 'mcp') return 'Use a read-only CLI or documented manual evidence path.'
  if (tool.category === 'cli') return tool.installHint ?? `Install or configure ${tool.name}, or record manual evidence.`
  return tool.installHint ?? `Install or configure skill ${tool.id}, or document a fallback artifact.`
}

function healthCheckFor(tool: ToolCapabilityEntry): string {
  if (tool.command) return `${tool.command} ${(tool.versionArgs ?? ['--version']).join(' ')}`
  if (tool.envFlag) return `env:${tool.envFlag}`
  return tool.detectedPath ? `file:${tool.detectedPath}` : 'skill-path-discovery'
}

function summarize(descriptors: AgentOsCapabilityDescriptor[]): AgentOsCapabilityReport['summary'] {
  return {
    total: descriptors.length,
    available: descriptors.filter(descriptor => descriptor.status === 'available').length,
    missing: descriptors.filter(descriptor => descriptor.status === 'missing').length,
    disabled: descriptors.filter(descriptor => descriptor.status === 'disabled').length,
    blocked: descriptors.filter(descriptor => descriptor.status === 'blocked').length,
    degraded: descriptors.filter(descriptor => descriptor.status === 'degraded').length,
    restricted: descriptors.filter(descriptor => descriptor.trust === 'restricted').length,
    approvalRequired: descriptors.filter(descriptor => descriptor.approvalPolicy !== 'none').length,
  }
}

function defaultCapabilityParity(): AgentOsCapabilityParityEntry[] {
  return [
    {
      userAction: 'Inspect capabilities',
      cli: 'scale capability list',
      api: 'GET /api/v1/capabilities',
      agentTool: 'capability_list',
      state: 'covered',
    },
    {
      userAction: 'Check capability health',
      cli: 'scale capability doctor',
      api: 'GET /api/v1/capabilities?doctor=true',
      agentTool: 'capability_doctor',
      state: 'covered',
    },
    {
      userAction: 'Map capabilities for a task',
      cli: 'scale capability map --task "<task>"',
      api: 'POST /api/v1/capabilities/map',
      agentTool: 'capability_map',
      state: 'covered',
    },
  ]
}
