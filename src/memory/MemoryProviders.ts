import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { externalCommandExists } from '../core/ExternalCommand.js'
import { runGbrainCommandSync } from '../core/GbrainRuntime.js'
import { MemoryBrain, type MemoryNode } from './MemoryBrain.js'

export type MemoryProviderKind = 'gbrain' | 'hrain'
export type MemoryProviderCapability = 'semantic-recall' | 'graph-recall' | 'session-memory' | 'mcp' | 'write-memory'
export type MemoryProviderSafetyLevel = 'review-required' | 'blocked'
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
      mode: 'local-only',
      defaultOrder: ['hrain', 'gbrain'],
      allowExternalWrite: false,
      requireEvidence: true,
      maxResultsPerProvider: 5,
    },
    providers: [
      {
        id: 'hrain',
        kind: 'hrain',
        enabled: true,
        priority: 60,
        capabilities: ['semantic-recall', 'session-memory', 'write-memory'],
        safetyLevel: 'review-required',
        writeMode: 'candidate-only',
        attribution: {
          license: 'MIT',
          sourceUrl: 'https://github.com/hongmaple0820/scale-engine',
          notice: 'Local SCALE memory brain. Uses project-scoped evidence-backed memory without external embedding services.',
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
    const providers = normalizeProviders(parsed.providers, defaults.providers)
    const providerIds = new Set(providers.map(provider => provider.id))
    const defaultOrder = normalizeProviderOrder(
      Array.isArray(parsed.routing?.defaultOrder) ? parsed.routing.defaultOrder.map(String) : defaults.routing.defaultOrder,
      providerIds,
      defaults.routing.defaultOrder,
    )
    return {
      path,
      exists: true,
      config: {
        version: '1.0',
        routing: {
          ...defaults.routing,
          ...(parsed.routing ?? {}),
          mode: normalizeRoutingMode(parsed.routing?.mode, defaults.routing.mode),
          defaultOrder,
          maxResultsPerProvider: positiveInt(parsed.routing?.maxResultsPerProvider, defaults.routing.maxResultsPerProvider),
        },
        providers,
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
  const order = loaded.config.routing.defaultOrder
  const statuses = loaded.config.providers
    .map(provider => providerStatus(provider, loaded.config.routing, projectDir, options.scaleDir))
    .sort((a, b) => {
      const ai = order.indexOf(a.id)
      const bi = order.indexOf(b.id)
      const orderRank = (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
      return orderRank || b.priority - a.priority || a.id.localeCompare(b.id)
    })
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
  let target = config.providers.find(item => item.id === provider)
  if (!target) {
    const defaultProvider = defaultMemoryProvidersConfig().providers.find(item => item.id === provider)
    if (defaultProvider) {
      target = { ...defaultProvider }
      config.providers.push(target)
    }
  }
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
  const mode = options.mode ?? defaultModeForProvider(target, config.routing.mode)
  config.routing.mode = normalizeRoutingMode(mode, config.routing.mode)

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
      const recalled = await recallExternal(provider, options, limit, projectDir, options.scaleDir)
      if (recalled.length > 0) {
        if (!options.provider && provider.id !== providers[0]?.id) fallbackUsed = true
        selectedProviders.push(provider.id)
        items.push(...recalled)
        if (!options.provider && loaded.config.routing.mode === 'local-only') break
      }
    } catch (error) {
      warnings.push(`${provider.id} recall failed: ${(error as Error).message}`)
    }
    if (items.length >= limit && !options.provider) break
  }

  // Provider routing is explicit: local hrain participates only when configured or selected by defaults.
  const naiveContextTokens = 0
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
  const candidates = config.providers.filter(provider => provider.enabled)
  const selected = providerId
    ? candidates.filter(provider => provider.id === providerId)
    : candidates.filter(provider => config.routing.mode !== 'local-only' || isLocalProvider(provider))
  const order = config.routing.defaultOrder
  return selected.sort((a, b) => {
    const ai = order.indexOf(a.id)
    const bi = order.indexOf(b.id)
    const orderRank = (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
    return orderRank || b.priority - a.priority || a.id.localeCompare(b.id)
  })
}

function defaultModeForProvider(
  provider: MemoryProviderConfig,
  fallback: MemoryProviderRoutingConfig['mode'],
): MemoryProviderRoutingConfig['mode'] {
  if (provider.kind === 'hrain') return 'local-only'
  if (provider.kind === 'gbrain') return 'external-first'
  return fallback
}

async function recallExternal(
  provider: MemoryProviderConfig,
  input: MemoryProviderRecallInput,
  limit: number,
  projectDir: string,
  scaleDir?: string,
): Promise<MemoryProviderRecallItem[]> {
  if (provider.kind === 'hrain') {
    return recallHrain(provider, input, limit, projectDir, scaleDir)
  }
  if (provider.kind === 'gbrain' && commandExists('gbrain')) {
    return recallGbrainCli(provider, input, limit, projectDir)
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

function providerStatus(provider: MemoryProviderConfig, routing: MemoryProviderRoutingConfig, projectDir: string, scaleDir?: string): MemoryProviderStatus {
  if (!provider.enabled) {
    return {
      ...providerStatusBase(provider, routing),
      available: false,
      reason: 'disabled by memory provider policy',
    }
  }
  if (provider.kind === 'hrain') {
    return {
      ...providerStatusBase(provider, routing),
      available: true,
      reason: `hrain local memory is available at ${normalizeProjectPath(projectDir, hrainDbPath(provider, projectDir, scaleDir))}; no external embedding service required`,
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
  if (!provider.endpoint) {
    return {
      ...providerStatusBase(provider, routing),
      available: false,
      reason: `${provider.id} requires either a local gbrain CLI install or endpoint configuration before autonomous use`,
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
      ? 'gbrain CLI is installed but no brain is configured; use local hrain or initialize a local embedding-backed gbrain before autonomous recall'
      : `gbrain CLI is installed but doctor failed: ${firstLine(output)}`,
    issues: noBrainConfigured ? ['no-brain-configured'] : ['doctor-failed'],
    recoveryHint: noBrainConfigured
      ? 'Use `scale memory provider use hrain --mode local-only` for a dependency-free local memory path, or initialize gbrain with a local embedding provider such as Ollama.'
      : 'Run gbrain doctor --json and repair the reported database or provider issue before relying on cross-session recall.',
    nextCommands: noBrainConfigured
      ? [
        'scale memory provider use hrain --mode local-only --json',
        'gbrain init --pglite --embedding-model ollama:nomic-embed-text --embedding-dimensions 768',
        'gbrain doctor --json',
        'scale memory provider status --json',
      ]
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
  if (!config.routing.allowExternalWrite && statuses.some(status => status.writeMode === 'enabled')) {
    warnings.push('External memory write is configured on a provider while routing.allowExternalWrite is false.')
  }
  for (const status of statuses) {
    if (status.enabled && status.safetyLevel !== 'review-required') {
      warnings.push(`${status.id} should remain review-required until privacy and retention boundaries are recorded.`)
    }
  }
  return warnings
}

function recallHrain(
  provider: MemoryProviderConfig,
  input: MemoryProviderRecallInput,
  limit: number,
  projectDir: string,
  scaleDir?: string,
): MemoryProviderRecallItem[] {
  const dbPath = hrainDbPath(provider, projectDir, scaleDir)
  if (!existsSync(dbPath)) return []
  const brain = new MemoryBrain({
    projectDir,
    dbPath,
  })
  try {
    const query = [input.query, input.task, ...(input.files ?? [])].filter(Boolean).join('\n')
    const active = brain.query(query, { limit, status: 'active' }).nodes
    const candidates = input.includeCandidates && active.length < limit
      ? brain.query(query, { limit: limit - active.length, status: 'candidate' }).nodes
      : []
    return [...active, ...candidates]
      .slice(0, limit)
      .map(node => hrainNodeToRecallItem(provider, node, projectDir, scaleDir))
  } finally {
    brain.close()
  }
}

function hrainNodeToRecallItem(provider: MemoryProviderConfig, node: MemoryNode, projectDir: string, scaleDir?: string): MemoryProviderRecallItem {
  return {
    provider: 'hrain',
    id: node.id,
    title: truncate(node.title, 140),
    summary: truncate(node.summary, 500),
    confidence: node.confidence,
    score: node.confidence,
    evidencePaths: node.evidencePaths,
    metadata: {
      type: node.type,
      layer: node.layer,
      scope: node.scope,
      status: node.status,
      localPath: normalizeProjectPath(projectDir, hrainDbPath(provider, projectDir, scaleDir)),
    },
  }
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

function isLocalProvider(provider: MemoryProviderConfig): boolean {
  return provider.kind === 'hrain' || (provider.kind === 'gbrain' && !provider.endpoint)
}

function normalizeProviders(input: unknown, defaults: MemoryProviderConfig[]): MemoryProviderConfig[] {
  if (!Array.isArray(input)) return defaults
  const byId = new Map(defaults.map(provider => [provider.id, provider]))
  const providers = input.filter(isRecord).map(item => {
    const id = String(item.id ?? '')
    const base = byId.get(id)
    if (!base) return null
    return {
      ...base,
      ...item,
      id,
      kind: normalizeKind(item.kind, base.kind),
      enabled: item.enabled !== false && Boolean(item.enabled ?? base.enabled),
      priority: positiveInt(item.priority, base.priority),
      homeDir: typeof item.homeDir === 'string' ? item.homeDir : base.homeDir,
      capabilities: Array.isArray(item.capabilities)
        ? arrayOfStrings(item.capabilities) as MemoryProviderCapability[]
        : [...base.capabilities],
      safetyLevel: normalizeSafety(item.safetyLevel, base.safetyLevel),
      writeMode: normalizeWriteMode(item.writeMode, base.writeMode),
    } as MemoryProviderConfig
  }).filter((provider): provider is MemoryProviderConfig => Boolean(provider?.id))
  return providers.length > 0 ? providers : defaults
}

function normalizeProviderOrder(input: string[], providerIds: Set<string>, fallback: string[]): string[] {
  const ordered = [...new Set(input)].filter(id => providerIds.has(id))
  for (const id of fallback) {
    if (providerIds.has(id) && !ordered.includes(id)) ordered.push(id)
  }
  for (const id of providerIds) {
    if (!ordered.includes(id)) ordered.push(id)
  }
  return ordered
}

function normalizeRoutingMode(value: unknown, fallback: MemoryProviderRoutingConfig['mode']): MemoryProviderRoutingConfig['mode'] {
  if (value === 'auto' || value === 'external-first' || value === 'local-only') return value
  return fallback
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

function normalizeKind(value: unknown, fallback: MemoryProviderKind = 'gbrain'): MemoryProviderKind {
  return value === 'gbrain' || value === 'hrain' ? value : fallback
}

function normalizeSafety(value: unknown, fallback: MemoryProviderSafetyLevel = 'review-required'): MemoryProviderSafetyLevel {
  return ['review-required', 'blocked'].includes(String(value))
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

function hrainDbPath(provider: MemoryProviderConfig, projectDir: string, scaleDir?: string): string {
  const homeDir = provider.homeDir?.trim()
    ? resolveProviderPath(provider.homeDir, projectDir)
    : join(resolveScaleRoot(projectDir, scaleDir), 'memory')
  return join(homeDir, 'brain.sqlite')
}

function normalizeProjectPath(projectDir: string, targetPath: string): string {
  const relativePath = targetPath.startsWith(projectDir)
    ? targetPath.slice(projectDir.length).replace(/^[/\\]/, '')
    : targetPath
  return relativePath.replace(/\\/g, '/')
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
