import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { MemoryBrain, type MemoryNode } from './MemoryBrain.js'
import { externalCommandExists } from '../core/ExternalCommand.js'
import { runGbrainCommandSync } from '../core/GbrainRuntime.js'

export type MemoryProviderKind = 'scale-local' | 'agentmemory' | 'gbrain' | 'memos' | 'generic-http'
export type MemoryProviderCapability = 'keyword-recall' | 'semantic-recall' | 'graph-recall' | 'session-memory' | 'mcp' | 'write-memory'
export type MemoryProviderSafetyLevel = 'trusted-local' | 'review-required' | 'blocked'
export type MemoryProviderWriteMode = 'disabled' | 'candidate-only' | 'enabled'

export interface MemoryProviderConfig {
  id: string
  kind: MemoryProviderKind
  enabled: boolean
  priority: number
  endpoint?: string
  homeDir?: string
  statusPath?: string
  searchPath?: string
  apiKeyEnv?: string
  capabilities: MemoryProviderCapability[]
  safetyLevel: MemoryProviderSafetyLevel
  writeMode: MemoryProviderWriteMode
  attribution?: {
    license: string
    sourceUrl: string
    notice: string
  }
}

export interface MemoryProviderRoutingConfig {
  mode: 'auto' | 'local-only' | 'external-first'
  defaultOrder: string[]
  allowExternalWrite: boolean
  requireEvidence: boolean
  maxResultsPerProvider: number
}

export interface MemoryProvidersConfig {
  version: '1.0'
  routing: MemoryProviderRoutingConfig
  providers: MemoryProviderConfig[]
}

export interface MemoryProviderStatus {
  id: string
  kind: MemoryProviderKind
  enabled: boolean
  available: boolean
  selectedByDefault: boolean
  priority: number
  capabilities: MemoryProviderCapability[]
  safetyLevel: MemoryProviderSafetyLevel
  writeMode: MemoryProviderWriteMode
  reason: string
}

export interface MemoryProviderStatusReport {
  projectDir: string
  scaleDir: string
  configPath: string
  configExists: boolean
  routing: MemoryProviderRoutingConfig
  providers: MemoryProviderStatus[]
  availableProviderCount: number
  warnings: string[]
}

export interface MemoryProviderRecallInput {
  query: string
  task?: string
  files?: string[]
  limit?: number
  provider?: string
  includeCandidates?: boolean
}

export interface MemoryProviderRecallItem {
  provider: string
  id: string
  title: string
  summary: string
  confidence: number
  score: number
  evidencePaths: string[]
  sourceUrl?: string
  metadata?: Record<string, unknown>
}

export interface MemoryProviderRecallReport {
  ok: boolean
  projectDir: string
  generatedAt: string
  query: string
  providerOrder: string[]
  selectedProviders: string[]
  fallbackUsed: boolean
  items: MemoryProviderRecallItem[]
  providerStatuses: MemoryProviderStatus[]
  contextSavings: {
    naiveContextTokens: number
    recalledTokens: number
    reduction: number
  }
  warnings: string[]
}

export interface MemoryProviderUseReport {
  ok: boolean
  projectDir: string
  scaleDir: string
  path: string
  existed: boolean
  provider: string
  mode: MemoryProviderRoutingConfig['mode']
  previousOrder: string[]
  nextOrder: string[]
  providerStatus?: MemoryProviderStatus
  warnings: string[]
}

export interface GbrainCliHealth {
  available: boolean
  degraded: boolean
  reason: string
  status?: string
  healthScore?: number
  issues?: string[]
  recoveryHint?: string
  nextCommands?: string[]
}

export function defaultMemoryProvidersConfig(): MemoryProvidersConfig {
  return {
    version: '1.0',
    routing: {
      mode: 'external-first',
      defaultOrder: ['gbrain', 'memos', 'agentmemory', 'scale-local'],
      allowExternalWrite: false,
      requireEvidence: true,
      maxResultsPerProvider: 5,
    },
    providers: [
      {
        id: 'agentmemory',
        kind: 'agentmemory',
        enabled: true,
        priority: 90,
        endpoint: process.env.AGENTMEMORY_ENDPOINT ?? process.env.AGENTMEMORY_URL ?? 'http://localhost:3111',
        statusPath: '/health',
        searchPath: '/search',
        apiKeyEnv: process.env.AGENTMEMORY_SECRET ? 'AGENTMEMORY_SECRET' : undefined,
        capabilities: ['semantic-recall', 'session-memory', 'mcp'],
        safetyLevel: 'review-required',
        writeMode: 'disabled',
        attribution: {
          license: 'Apache-2.0',
          sourceUrl: 'https://github.com/rohitg00/agentmemory',
          notice: 'Self-hosted local memory server. Start with: npx @agentmemory/agentmemory. Optional AGENTMEMORY_SECRET for protected deployments.',
        },
      },
      {
        id: 'gbrain',
        kind: 'gbrain',
        enabled: true,
        priority: 95,
        endpoint: process.env.GBRAIN_ENDPOINT,
        statusPath: '/health',
        searchPath: '/search',
        apiKeyEnv: 'GBRAIN_API_KEY',
        capabilities: ['semantic-recall', 'graph-recall', 'session-memory', 'mcp'],
        safetyLevel: 'review-required',
        writeMode: 'disabled',
        attribution: {
          license: 'MIT',
          sourceUrl: 'https://github.com/garrytan/gbrain',
          notice: 'Optional graph memory provider. Treat returned knowledge as recall evidence, not final truth.',
        },
      },
      {
        id: 'memos',
        kind: 'memos',
        enabled: true,
        priority: 85,
        endpoint: process.env.MEMOS_BASE_URL ?? 'http://localhost:8001/api/openmem/v1',
        statusPath: '/health',
        searchPath: '/search/memory',
        apiKeyEnv: 'MEMOS_API_KEY',
        capabilities: ['semantic-recall', 'graph-recall', 'session-memory', 'mcp'],
        safetyLevel: 'review-required',
        writeMode: 'disabled',
        attribution: {
          license: 'Apache-2.0',
          sourceUrl: 'https://github.com/MemTensor/MemOS',
          notice: 'Memory Operating System — graph-first memory with 3-layer architecture (L1 Trace → L2 Policy → L3 World Model). Self-hosted via Docker or cloud API. Get API key from memos-dashboard.openmem.net or self-host with Docker.',
        },
      },
      {
        id: 'scale-local',
        kind: 'scale-local',
        enabled: true,
        priority: 10,
        capabilities: ['keyword-recall'],
        safetyLevel: 'trusted-local',
        writeMode: 'candidate-only',
      },
    ],
  }
}

export function memoryProvidersConfigPath(projectDir = process.cwd(), scaleDir = '.scale'): string {
  return join(resolveScaleRoot(projectDir, scaleDir), 'memory-providers.json')
}

export function writeMemoryProvidersConfig(options: {
  projectDir?: string
  scaleDir?: string
  force?: boolean
} = {}): { path: string; written: boolean; config: MemoryProvidersConfig } {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const path = memoryProvidersConfigPath(projectDir, options.scaleDir)
  if (existsSync(path) && !options.force) {
    return { path, written: false, config: loadMemoryProvidersConfig(projectDir, options.scaleDir).config }
  }
  mkdirSync(dirname(path), { recursive: true })
  const config = defaultMemoryProvidersConfig()
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8')
  return { path, written: true, config }
}

function saveMemoryProvidersConfig(projectDir: string, scaleDir: string | undefined, config: MemoryProvidersConfig): string {
  const path = memoryProvidersConfigPath(projectDir, scaleDir)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8')
  return path
}

export function loadMemoryProvidersConfig(projectDir = process.cwd(), scaleDir = '.scale'): {
  config: MemoryProvidersConfig
  path: string
  exists: boolean
} {
  const path = memoryProvidersConfigPath(projectDir, scaleDir)
  if (!existsSync(path)) return { config: defaultMemoryProvidersConfig(), path, exists: false }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<MemoryProvidersConfig>
    const defaults = defaultMemoryProvidersConfig()
    return {
      path,
      exists: true,
      config: {
        version: '1.0',
        routing: {
          ...defaults.routing,
          ...(parsed.routing ?? {}),
          defaultOrder: Array.isArray(parsed.routing?.defaultOrder) ? parsed.routing.defaultOrder.map(String) : defaults.routing.defaultOrder,
          maxResultsPerProvider: positiveInt(parsed.routing?.maxResultsPerProvider, defaults.routing.maxResultsPerProvider),
        },
        providers: normalizeProviders(parsed.providers, defaults.providers),
      },
    }
  } catch {
    return { config: defaultMemoryProvidersConfig(), path, exists: true }
  }
}

export function inspectMemoryProviders(options: {
  projectDir?: string
  scaleDir?: string
} = {}): MemoryProviderStatusReport {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const loaded = loadMemoryProvidersConfig(projectDir, options.scaleDir)
  const statuses = loaded.config.providers
    .map(provider => providerStatus(provider, loaded.config.routing, projectDir))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
  return {
    projectDir,
    scaleDir: resolveScaleRoot(projectDir, options.scaleDir),
    configPath: loaded.path,
    configExists: loaded.exists,
    routing: loaded.config.routing,
    providers: statuses,
    availableProviderCount: statuses.filter(status => status.available).length,
    warnings: providerWarnings(statuses, loaded.config),
  }
}

export function useMemoryProvider(options: {
  projectDir?: string
  scaleDir?: string
  provider: string
  mode?: MemoryProviderRoutingConfig['mode']
  endpoint?: string
  writeMode?: MemoryProviderWriteMode
  allowExternalWrite?: boolean
}): MemoryProviderUseReport {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const loaded = loadMemoryProvidersConfig(projectDir, options.scaleDir)
  const provider = String(options.provider).trim()
  const config: MemoryProvidersConfig = {
    ...loaded.config,
    routing: {
      ...loaded.config.routing,
    },
    providers: loaded.config.providers.map(item => ({ ...item })),
  }
  const target = config.providers.find(item => item.id === provider)
  if (!target) {
    return {
      ok: false,
      projectDir,
      scaleDir: resolveScaleRoot(projectDir, options.scaleDir),
      path: loaded.path,
      existed: loaded.exists,
      provider,
      mode: config.routing.mode,
      previousOrder: [...loaded.config.routing.defaultOrder],
      nextOrder: [...loaded.config.routing.defaultOrder],
      warnings: [`Unknown memory provider: ${provider}`],
    }
  }

  const previousOrder = [...config.routing.defaultOrder]
  target.enabled = true
  if (options.endpoint) target.endpoint = options.endpoint
  if (options.writeMode) target.writeMode = options.writeMode

  const nextOrder = [provider, ...config.routing.defaultOrder.filter(item => item !== provider)]
  config.routing.defaultOrder = nextOrder
  if (typeof options.allowExternalWrite === 'boolean') config.routing.allowExternalWrite = options.allowExternalWrite
  if (options.mode) config.routing.mode = options.mode
  else if (target.kind === 'scale-local') config.routing.mode = 'local-only'
  else if (config.routing.mode === 'local-only') config.routing.mode = 'external-first'

  const path = saveMemoryProvidersConfig(projectDir, options.scaleDir, config)
  const status = inspectMemoryProviders({ projectDir, scaleDir: options.scaleDir })
  return {
    ok: true,
    projectDir,
    scaleDir: resolveScaleRoot(projectDir, options.scaleDir),
    path,
    existed: loaded.exists,
    provider,
    mode: status.routing.mode,
    previousOrder,
    nextOrder: [...status.routing.defaultOrder],
    providerStatus: status.providers.find(item => item.id === provider),
    warnings: status.warnings,
  }
}

export async function recallMemoryProviders(options: {
  projectDir?: string
  scaleDir?: string
} & MemoryProviderRecallInput): Promise<MemoryProviderRecallReport> {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const loaded = loadMemoryProvidersConfig(projectDir, options.scaleDir)
  const statuses = inspectMemoryProviders({ projectDir, scaleDir: options.scaleDir }).providers
  const limit = Math.max(1, Math.floor(options.limit ?? loaded.config.routing.maxResultsPerProvider))
  const providers = orderedProviders(loaded.config, options.provider)
  const warnings: string[] = []
  const items: MemoryProviderRecallItem[] = []
  const selectedProviders: string[] = []
  let fallbackUsed = false

  for (const provider of providers) {
    const status = statuses.find(item => item.id === provider.id)
    if (!status?.available) {
      warnings.push(`${provider.id} skipped: ${status?.reason ?? 'not available'}`)
      continue
    }
    try {
      const recalled = provider.kind === 'scale-local'
        ? recallLocal(projectDir, options.scaleDir, provider, options, limit)
        : await recallExternal(provider, options, limit, projectDir)
      if (recalled.length > 0) {
        selectedProviders.push(provider.id)
        items.push(...recalled)
      }
      if (provider.kind === 'scale-local' && providers.some(item => item.kind !== 'scale-local')) fallbackUsed = true
    } catch (error) {
      warnings.push(`${provider.id} recall failed: ${(error as Error).message}`)
    }
    if (items.length >= limit && !options.provider) break
  }

  // Calculate token savings: naive context (all memory nodes) vs. targeted recall
  const brain = new MemoryBrain({ projectDir, scaleDir: options.scaleDir })
  let naiveContextTokens = 0
  try {
    const allNodes = brain.list()
    naiveContextTokens = estimateTokens(allNodes.map(n => `${n.title}\n${n.summary}`).join('\n'))
  } finally {
    brain.close()
  }
  const recalledTokens = estimateTokens(items.map(item => `${item.title}\n${item.summary}`).join('\n'))
  const reduction = naiveContextTokens > 0 && recalledTokens > 0
    ? Math.round((naiveContextTokens / recalledTokens) * 100) / 100
    : 1

  return {
    ok: items.length > 0,
    projectDir,
    generatedAt: new Date().toISOString(),
    query: options.query,
    providerOrder: providers.map(provider => provider.id),
    selectedProviders,
    fallbackUsed,
    items: items
      .sort((a, b) => b.score - a.score || b.confidence - a.confidence)
      .slice(0, limit),
    providerStatuses: statuses,
    contextSavings: { naiveContextTokens, recalledTokens, reduction },
    warnings,
  }
}

function orderedProviders(config: MemoryProvidersConfig, providerId?: string): MemoryProviderConfig[] {
  const candidates = config.routing.mode === 'local-only'
    ? config.providers.filter(provider => provider.kind === 'scale-local')
    : config.providers
  const selected = providerId ? candidates.filter(provider => provider.id === providerId) : candidates
  const order = config.routing.mode === 'local-only'
    ? ['scale-local']
    : config.routing.defaultOrder
  return selected.sort((a, b) => {
    const ai = order.indexOf(a.id)
    const bi = order.indexOf(b.id)
    const orderRank = (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
    return orderRank || b.priority - a.priority || a.id.localeCompare(b.id)
  })
}

function recallLocal(
  projectDir: string,
  scaleDir: string | undefined,
  provider: MemoryProviderConfig,
  input: MemoryProviderRecallInput,
  limit: number,
): MemoryProviderRecallItem[] {
  const brain = new MemoryBrain({ projectDir, scaleDir })
  try {
    const active = brain.query(input.query, { limit, status: 'active' }).nodes
    const nodes = active.length > 0 || !input.includeCandidates
      ? active
      : brain.query(input.query, { limit }).nodes
    return nodes.map(node => nodeToRecall(provider.id, node))
  } finally {
    brain.close()
  }
}

async function recallExternal(
  provider: MemoryProviderConfig,
  input: MemoryProviderRecallInput,
  limit: number,
  projectDir: string,
): Promise<MemoryProviderRecallItem[]> {
  if (provider.kind === 'gbrain' && commandExists('gbrain')) {
    return recallGbrainCli(provider, input, limit, projectDir)
  }
  if (provider.kind === 'memos') {
    return recallMemos(provider, input, limit)
  }
  if (!provider.endpoint) return []
  const response = await fetch(new URL(provider.searchPath ?? '/search', provider.endpoint), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(provider.apiKeyEnv && process.env[provider.apiKeyEnv] ? { authorization: `Bearer ${process.env[provider.apiKeyEnv]}` } : {}),
    },
    body: JSON.stringify({
      query: input.query,
      task: input.task,
      files: input.files ?? [],
      limit,
    }),
    signal: AbortSignal.timeout(2500),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json() as unknown
  const raw = extractExternalResults(data)
  return raw.slice(0, limit).map((item, index) => externalToRecall(provider.id, item, index))
}

function extractExternalResults(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data.filter(isRecord)
  if (!isRecord(data)) return []
  for (const key of ['results', 'items', 'memories', 'nodes', 'documents']) {
    const value = data[key]
    if (Array.isArray(value)) return value.filter(isRecord)
  }
  return []
}

async function recallMemos(
  provider: MemoryProviderConfig,
  input: MemoryProviderRecallInput,
  limit: number,
): Promise<MemoryProviderRecallItem[]> {
  if (!provider.endpoint) return []
  const apiKey = provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined
  const userId = process.env.MEMOS_USER_ID ?? 'scale-engine'
  const conversationId = process.env.MEMOS_CONVERSATION_ID ?? 'default'
  try {
    const response = await fetch(new URL('/search/memory', provider.endpoint), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Token ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        query: input.query,
        user_id: userId,
        conversation_id: conversationId,
        memory_limit_number: limit,
        include_preference: true,
        include_tool_memory: true,
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`MemOS HTTP ${response.status}`)
    const data = await response.json() as {
      code?: number
      data?: {
        text_memories?: Array<Record<string, unknown>>
        preference_memories?: Array<Record<string, unknown>>
        tool_memories?: Array<Record<string, unknown>>
      }
    }
    if (data.code && data.code !== 200) throw new Error(`MemOS error code ${data.code}`)
    const items: MemoryProviderRecallItem[] = []
    const allMemories = [
      ...(data.data?.text_memories ?? []),
      ...(data.data?.preference_memories ?? []),
      ...(data.data?.tool_memories ?? []),
    ]
    for (let i = 0; i < Math.min(allMemories.length, limit); i++) {
      const mem = allMemories[i]
      items.push(externalToRecall('memos', mem, i))
    }
    return items
  } catch (error) {
    throw new Error(`MemOS recall failed: ${(error as Error).message}`)
  }
}

function externalToRecall(provider: string, item: Record<string, unknown>, index: number): MemoryProviderRecallItem {
  const title = firstString(item.title, item.name, item.summary, item.content, item.text) ?? `${provider} memory ${index + 1}`
  const summary = firstString(item.summary, item.content, item.text, item.body, item.markdown) ?? title
  const confidence = clampNumber(item.confidence ?? item.relevance ?? item.score, 0.5)
  const score = clampNumber(item.score ?? item.relevance ?? item.confidence, confidence)
  return {
    provider,
    id: firstString(item.id, item.key, item.memoryId) ?? `${provider}-${index + 1}`,
    title: truncate(title, 140),
    summary: truncate(summary, 500),
    confidence,
    score,
    evidencePaths: arrayOfStrings(item.evidencePaths ?? item.evidence_paths ?? item.sources),
    sourceUrl: firstString(item.url, item.sourceUrl, item.source_url),
    metadata: item,
  }
}

function nodeToRecall(provider: string, node: MemoryNode): MemoryProviderRecallItem {
  return {
    provider,
    id: node.id,
    title: node.title,
    summary: node.summary,
    confidence: node.confidence,
    score: node.confidence,
    evidencePaths: node.evidencePaths,
    metadata: {
      type: node.type,
      scope: node.scope,
      status: node.status,
      entities: node.entities,
    },
  }
}

function providerStatus(provider: MemoryProviderConfig, routing: MemoryProviderRoutingConfig, projectDir: string): MemoryProviderStatus {
  if (!provider.enabled) {
    return {
      ...providerStatusBase(provider, routing),
      available: false,
      reason: 'disabled by memory provider policy',
    }
  }
  if (provider.kind === 'scale-local') {
    return {
      ...providerStatusBase(provider, routing),
      available: true,
      reason: 'local MemoryBrain fallback is available',
    }
  }
  if (provider.kind === 'gbrain' && commandExists('gbrain')) {
    const health = inspectGbrainCliHealth({ projectDir, env: providerGbrainEnv(provider, projectDir) })
    if (health.available) {
      return {
        ...providerStatusBase(provider, routing),
        available: true,
        reason: health.reason,
      }
    }
    if (!provider.endpoint) {
      return {
        ...providerStatusBase(provider, routing),
        available: false,
        reason: health.reason,
      }
    }
  }
  if (provider.kind === 'agentmemory') {
    const amHealth = inspectAgentmemoryHealth(provider.endpoint)
    return {
      ...providerStatusBase(provider, routing),
      available: amHealth.available,
      reason: amHealth.reason,
    }
  }
  if (provider.kind === 'memos') {
    const memosHealth = inspectMemosHealth(provider.endpoint, provider.apiKeyEnv)
    return {
      ...providerStatusBase(provider, routing),
      available: memosHealth.available,
      reason: memosHealth.reason,
    }
  }
  if (!provider.endpoint) {
    return {
      ...providerStatusBase(provider, routing),
      available: false,
      reason: provider.kind === 'gbrain'
        ? `${provider.id} requires either a local gbrain CLI install or endpoint configuration before autonomous use`
        : `${provider.id} requires endpoint configuration before autonomous use`,
    }
  }
  return {
    ...providerStatusBase(provider, routing),
    available: true,
    reason: `${provider.id} endpoint configured; recall is read-only unless policy enables writes`,
  }
}

export function inspectGbrainCliHealth(options: { projectDir?: string; env?: NodeJS.ProcessEnv } = {}): GbrainCliHealth {
  const result = runGbrainCommandSync(['doctor', '--json'], {
    timeout: 10_000,
    cwd: options.projectDir,
    env: options.env,
  })
  const output = `${result.stdout}\n${result.stderr}`.trim()
  const parsed = parseGbrainDoctorReport(output)
  if (parsed && gbrainCoreRecallReady(parsed)) {
    return gbrainCoreReadyHealth(parsed)
  }
  if (parsed) {
    const status = typeof parsed.status === 'string' ? parsed.status : undefined
    const healthScore = typeof parsed.health_score === 'number' ? parsed.health_score : undefined
    const issues = gbrainCoreRecallIssues(parsed)
    const issueDetails = gbrainCoreRecallIssueDetails(parsed, issues)
    return {
      available: false,
      degraded: false,
      reason: issueDetails.length > 0
        ? `gbrain doctor reported core recall issue(s): ${issueDetails.join(', ')}`
        : `gbrain doctor did not prove core recall readiness: ${status ?? 'unknown status'}`,
      status,
      healthScore,
      issues,
      recoveryHint: gbrainRecoveryHint(issues),
      nextCommands: gbrainRecoveryCommands(issues),
    }
  }
  if (result.exitCode === 0) {
    return { available: true, degraded: false, reason: 'gbrain doctor passed; graph-backed recall is available' }
  }
  const noBrainConfigured = /no brain configured/i.test(output)
  return {
    available: false,
    degraded: false,
    reason: noBrainConfigured
      ? 'gbrain CLI is installed but no brain is configured; run `gbrain init --pglite` before autonomous recall'
      : `gbrain CLI is installed but doctor failed: ${firstLine(output)}`,
    issues: noBrainConfigured ? ['no-brain-configured'] : ['doctor-failed'],
    recoveryHint: noBrainConfigured
      ? 'Initialize a local PGLite brain or configure a Postgres-backed gbrain before relying on cross-session recall.'
      : 'Run gbrain doctor --json and repair the reported database or provider issue before relying on cross-session recall.',
    nextCommands: noBrainConfigured
      ? ['gbrain init --pglite --no-embedding', 'gbrain doctor --json', 'scale memory provider status --json']
      : ['gbrain doctor --json', 'scale memory provider status --json'],
  }
}

function gbrainCoreReadyHealth(report: GbrainDoctorReport): GbrainCliHealth {
  const status = typeof report.status === 'string' ? report.status : undefined
  const healthScore = typeof report.health_score === 'number' ? report.health_score : undefined
  const nonOkChecks = gbrainDoctorChecks(report)
    .filter(check => check.status !== 'ok')
    .map(check => check.name)
    .filter(Boolean)
  const optionalIssues = nonOkChecks.filter(check => !GBRAIN_CORE_RECALL_CHECKS.has(check))
  if (status === 'healthy' || optionalIssues.length === 0) {
    return {
      available: true,
      degraded: false,
      reason: 'gbrain doctor passed; graph-backed recall is available',
      status,
      healthScore,
    }
  }
  return {
    available: true,
    degraded: true,
    reason: `gbrain core recall is available; optional doctor warnings: ${optionalIssues.slice(0, 3).join(', ')}`,
    status,
    healthScore,
  }
}

interface AgentmemoryHealth {
  available: boolean
  reason: string
}

function inspectAgentmemoryHealth(endpoint?: string): AgentmemoryHealth {
  const url = endpoint ?? 'http://localhost:3111'
  try {
    // Quick TCP check: try to connect to the agentmemory server
    const { request } = require('node:http')
    const req = request(`${url}/health`, { method: 'GET', timeout: 2000 }, () => {
      // just checking connectivity
    })
    req.on('error', () => {})
    req.end()
    // Synchronous check via spawn
    const { spawnSync } = require('node:child_process')
    const result = spawnSync('node', ['-e', `
      const http = require('http');
      const req = http.get('${url}/health', {timeout: 2000}, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => { process.stdout.write(JSON.stringify({status: res.statusCode, body: data})); process.exit(0); });
      });
      req.on('error', () => { process.stdout.write('{"error":"connect refused"}'); process.exit(1); });
      req.on('timeout', () => { req.destroy(); process.stdout.write('{"error":"timeout"}'); process.exit(1); });
    `], { timeout: 3000, encoding: 'utf8' })
    if (result.status === 0 && result.stdout) {
      const parsed = JSON.parse(result.stdout)
      if (parsed.status === 200) {
        return { available: true, reason: `agentmemory server responding at ${url}` }
      }
    }
    return {
      available: false,
      reason: `agentmemory server not reachable at ${url}. Start with: npx @agentmemory/agentmemory`,
    }
  } catch {
    return {
      available: false,
      reason: `agentmemory server not reachable at ${url}. Start with: npx @agentmemory/agentmemory`,
    }
  }
}

interface MemosHealth {
  available: boolean
  reason: string
}

function inspectMemosHealth(endpoint?: string, apiKeyEnv?: string): MemosHealth {
  const url = endpoint ?? 'http://localhost:8001/api/openmem/v1'
  const apiKey = apiKeyEnv ? process.env[apiKeyEnv] : undefined
  // Cloud API requires key; self-hosted may not
  const isCloud = url.includes('memt.ai') || url.includes('memtensor.cn')
  if (isCloud && !apiKey) {
    return { available: false, reason: `MemOS cloud API requires MEMOS_API_KEY. Get one from memos-dashboard.openmem.net` }
  }
  try {
    const { spawnSync } = require('node:child_process')
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (apiKey) headers['authorization'] = `Token ${apiKey}`
    const result = spawnSync('node', ['-e', `
      const http = require('http');
      const url = new URL('${url}/health');
      const opts = { hostname: url.hostname, port: url.port || 80, path: url.pathname, method: 'GET', timeout: 3000, headers: ${JSON.stringify(headers)} };
      const req = http.request(opts, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => { process.stdout.write(JSON.stringify({status: res.statusCode})); process.exit(0); });
      });
      req.on('error', () => { process.stdout.write('{"error":"connect refused"}'); process.exit(1); });
      req.on('timeout', () => { req.destroy(); process.stdout.write('{"error":"timeout"}'); process.exit(1); });
      req.end();
    `], { timeout: 5000, encoding: 'utf8' })
    if (result.status === 0 && result.stdout) {
      const parsed = JSON.parse(result.stdout)
      if (parsed.status >= 200 && parsed.status < 400) {
        return { available: true, reason: `MemOS server responding at ${url}` }
      }
    }
    return {
      available: false,
      reason: `MemOS server not reachable at ${url}. Self-host: docker compose up. Cloud: set MEMOS_API_KEY from memos-dashboard.openmem.net`,
    }
  } catch {
    return {
      available: false,
      reason: `MemOS server not reachable at ${url}. Self-host: docker compose up. Cloud: set MEMOS_API_KEY from memos-dashboard.openmem.net`,
    }
  }
}

interface GbrainDoctorReport {
  status?: unknown
  health_score?: unknown
  checks?: unknown
}

interface GbrainDoctorCheck {
  name: string
  status: string
  message?: string
}

function parseGbrainDoctorReport(output: string): GbrainDoctorReport | null {
  const json = extractFirstJsonObject(output)
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as unknown
    return isRecord(parsed) ? parsed as GbrainDoctorReport : null
  } catch {
    return null
  }
}

function extractFirstJsonObject(output: string): string | null {
  const start = output.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < output.length; index += 1) {
    const char = output[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return output.slice(start, index + 1)
    }
  }
  return null
}

function gbrainCoreRecallReady(report: GbrainDoctorReport): boolean {
  const checks = gbrainDoctorChecks(report)
  const connection = checks.find(check => check.name === 'connection')
  if (connection) {
    if (connection.status !== 'ok') return false

    const legacyRecallChecks = checks.filter(check => check.name === 'schema_version' || check.name === 'brain_score')
    if (legacyRecallChecks.length > 0) return legacyRecallChecks.some(check => check.status === 'ok')

    return true
  }

  const status = typeof report.status === 'string' ? report.status.toLowerCase() : undefined
  return status === 'healthy' || status === 'ok'
}

const GBRAIN_CORE_RECALL_CHECKS = new Set(['connection', 'schema_version', 'brain_score'])

function gbrainCoreRecallIssues(report: GbrainDoctorReport): string[] {
  const checks = gbrainDoctorChecks(report)
  const byName = new Map(checks.map(check => [check.name, check.status]))
  const issues: string[] = []
  const connection = byName.get('connection')
  if (connection && connection !== 'ok') issues.push('connection')
  const schema = byName.get('schema_version')
  const brainScore = byName.get('brain_score')
  if ((schema || brainScore) && schema !== 'ok' && brainScore !== 'ok') {
    if (schema && schema !== 'ok') issues.push('schema_version')
    if (brainScore && brainScore !== 'ok') issues.push('brain_score')
  }
  return issues
}

function gbrainCoreRecallIssueDetails(report: GbrainDoctorReport, issues: string[]): string[] {
  const checks = gbrainDoctorChecks(report)
  return issues.map(issue => {
    const message = checks.find(check => check.name === issue)?.message
    return message ? `${issue} (${compactText(message)})` : issue
  })
}

function gbrainRecoveryHint(issues: string[]): string | undefined {
  if (issues.includes('connection')) {
    return 'Configured gbrain DB is unreachable. If this is a local PGLite brain, back up the database directory before reinitializing; otherwise configure a reachable Postgres URL.'
  }
  if (issues.includes('schema_version') || issues.includes('brain_score')) {
    return 'gbrain connected but did not prove recall readiness; run doctor/migrations and recheck memory provider status.'
  }
  return undefined
}

function gbrainRecoveryCommands(issues: string[]): string[] | undefined {
  if (issues.includes('connection')) {
    return [
      'gbrain doctor --json',
      'gbrain init --url <postgresql://...> --non-interactive',
      'scale memory provider status --json',
    ]
  }
  if (issues.includes('schema_version') || issues.includes('brain_score')) {
    return [
      'gbrain doctor --json',
      'gbrain init --migrate-only',
      'scale memory provider status --json',
    ]
  }
  return undefined
}

function gbrainDoctorChecks(report: GbrainDoctorReport): GbrainDoctorCheck[] {
  if (!Array.isArray(report.checks)) return []
  return report.checks.filter(isRecord).map(check => ({
    name: String(check.name ?? ''),
    status: String(check.status ?? ''),
    message: typeof check.message === 'string' ? check.message : undefined,
  })).filter(check => check.name)
}

function providerStatusBase(provider: MemoryProviderConfig, routing: MemoryProviderRoutingConfig): Omit<MemoryProviderStatus, 'available' | 'reason'> {
  return {
    id: provider.id,
    kind: provider.kind,
    enabled: provider.enabled,
    selectedByDefault: routing.defaultOrder.includes(provider.id),
    priority: provider.priority,
    capabilities: provider.capabilities,
    safetyLevel: provider.safetyLevel,
    writeMode: provider.writeMode,
  }
}

function providerWarnings(statuses: MemoryProviderStatus[], config: MemoryProvidersConfig): string[] {
  const warnings: string[] = []
  if (!config.routing.allowExternalWrite && statuses.some(status => status.writeMode === 'enabled' && status.kind !== 'scale-local')) {
    warnings.push('External memory write is configured on a provider while routing.allowExternalWrite is false.')
  }
  const expectsScaleLocalFallback = config.providers.some(provider => provider.kind === 'scale-local') ||
    config.routing.defaultOrder.includes('scale-local')
  if (expectsScaleLocalFallback && !statuses.some(status => status.kind === 'scale-local' && status.available)) {
    warnings.push('scale-local fallback is unavailable; autonomous recall may fail closed.')
  }
  for (const status of statuses) {
    if (status.kind !== 'scale-local' && status.enabled && status.safetyLevel !== 'review-required') {
      warnings.push(`${status.id} should remain review-required until privacy and retention boundaries are recorded.`)
    }
  }
  return warnings
}

function recallGbrainCli(
  provider: MemoryProviderConfig,
  input: MemoryProviderRecallInput,
  limit: number,
  projectDir: string,
): MemoryProviderRecallItem[] {
  const result = runGbrainCli(['query', input.query], 8_000, provider, projectDir)
  let parsed = parseGbrainResults(result.stdout)
  if (parsed.length === 0 && result.exitCode !== 0 && !result.timedOut) {
    throw new Error(firstLine(result.stderr) || `gbrain query failed with exit code ${result.exitCode}`)
  }
  if (parsed.length === 0 && result.exitCode === 0) {
    const fallback = runGbrainCli(['search', input.query], 8_000, provider, projectDir, { outputMode: 'native' })
    parsed = parseGbrainResults(fallback.stdout)
    if (parsed.length === 0 && fallback.exitCode !== 0 && !fallback.timedOut) {
      throw new Error(firstLine(fallback.stderr) || `gbrain search failed with exit code ${fallback.exitCode}`)
    }
  }
  return parsed
    .slice(0, limit)
    .map((item, index) => externalToRecall('gbrain', item, index))
}

function runGbrainCli(
  args: string[],
  timeout: number,
  provider: MemoryProviderConfig,
  projectDir: string,
  options: { outputMode?: 'json' | 'native' } = {},
): { stdout: string; stderr: string; exitCode: number; timedOut: boolean } {
  const providerEnv = providerGbrainEnv(provider, projectDir) ?? process.env
  const outputMode = options.outputMode ?? 'json'
  const env = {
    ...providerEnv,
    ...(outputMode === 'json'
      ? { GBRAIN_OUTPUT_MODE: process.env.GBRAIN_OUTPUT_MODE ?? 'json' }
      : {}),
  }
  const result = runGbrainCommandSync(args, {
    timeout,
    env,
  })
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
  }
}

function parseGbrainResults(stdout: string): Array<Record<string, unknown>> {
  const trimmed = stdout.trim()
  if (!trimmed) return []
  try {
    return extractExternalResults(JSON.parse(trimmed))
  } catch {
    return parseGbrainTextResults(trimmed)
  }
}

function parseGbrainTextResults(stdout: string): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = []
  const lines = stdout.split(/\r?\n/)
  let current: Record<string, unknown> | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    if (/^\[last-retrieved\]\s+write-back failed/i.test(line)) continue
    const ranked = line.match(/^(\d+)\.\s+(.*)$/)
    if (ranked) {
      if (current) records.push(current)
      current = { title: ranked[2], summary: ranked[2] }
      continue
    }
    const scored = line.match(/^\[(\d+(?:\.\d+)?)\]\s+(.+?)(?:\s+--\s+(.*))?$/)
    if (scored) {
      if (current) records.push(current)
      current = {
        title: scored[2],
        summary: scored[3] ?? scored[2],
        score: Number(scored[1]),
        confidence: Number(scored[1]),
      }
      continue
    }
    if (line.startsWith('- ') || line.startsWith('• ')) {
      if (current) current.summary = `${String(current.summary ?? '')} ${line.slice(2)}`.trim()
      continue
    }
    if (current) {
      current.summary = `${String(current.summary ?? '')} ${line}`.trim()
    }
  }
  if (current) records.push(current)
  return records
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? 'unknown error'
}

function compactText(value: string, maxLength = 200): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`
}

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token for English text
  return Math.ceil(text.length / 4)
}

function commandExists(command: string): boolean {
  return externalCommandExists(command)
}

function normalizeProviders(input: unknown, defaults: MemoryProviderConfig[]): MemoryProviderConfig[] {
  if (!Array.isArray(input)) return defaults
  const byId = new Map(defaults.map(provider => [provider.id, provider]))
  const providers = input.filter(isRecord).map(item => {
    const id = String(item.id ?? '')
    const base = byId.get(id)
    return {
      ...(base ?? {}),
      ...item,
      id,
      kind: normalizeKind(item.kind, base?.kind),
      enabled: item.enabled !== false && Boolean(item.enabled ?? base?.enabled ?? false),
      priority: positiveInt(item.priority, base?.priority ?? 0),
      homeDir: typeof item.homeDir === 'string' ? item.homeDir : base?.homeDir,
      capabilities: arrayOfStrings(item.capabilities) as MemoryProviderCapability[],
      safetyLevel: normalizeSafety(item.safetyLevel, base?.safetyLevel),
      writeMode: normalizeWriteMode(item.writeMode, base?.writeMode),
    } as MemoryProviderConfig
  }).filter(provider => provider.id)
  return providers
}

function providerGbrainEnv(provider: MemoryProviderConfig, projectDir: string): NodeJS.ProcessEnv | undefined {
  const configuredHome = provider.homeDir?.trim()
  if (!configuredHome) return undefined
  const homeDir = resolveProviderPath(configuredHome, projectDir)
  return {
    ...process.env,
    GBRAIN_HOME: homeDir,
    GBRAIN_AUDIT_DIR: process.env.GBRAIN_AUDIT_DIR ?? join(homeDir, 'audit'),
  }
}

function resolveProviderPath(value: string, projectDir: string): string {
  return isAbsolute(value) ? value : resolve(projectDir, value)
}

function normalizeKind(value: unknown, fallback: MemoryProviderKind = 'generic-http'): MemoryProviderKind {
  return ['scale-local', 'agentmemory', 'gbrain', 'memos', 'generic-http'].includes(String(value))
    ? value as MemoryProviderKind
    : fallback
}

function normalizeSafety(value: unknown, fallback: MemoryProviderSafetyLevel = 'review-required'): MemoryProviderSafetyLevel {
  return ['trusted-local', 'review-required', 'blocked'].includes(String(value))
    ? value as MemoryProviderSafetyLevel
    : fallback
}

function normalizeWriteMode(value: unknown, fallback: MemoryProviderWriteMode = 'disabled'): MemoryProviderWriteMode {
  return ['disabled', 'candidate-only', 'enabled'].includes(String(value))
    ? value as MemoryProviderWriteMode
    : fallback
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function resolveScaleRoot(projectDir: string, scaleDir?: string): string {
  return isAbsolute(scaleDir ?? '') ? scaleDir as string : join(projectDir, scaleDir ?? '.scale')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function firstString(...values: unknown[]): string | undefined {
  return values.map(value => typeof value === 'string' ? value.trim() : '').find(Boolean)
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

function clampNumber(value: unknown, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(0.01, Math.min(1, Math.round(number * 100) / 100))
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars - 3)}...` : value
}
