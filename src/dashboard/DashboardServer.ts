/**
 * Dashboard Server 2.0 — Unified Hono server with Node.js adapter
 * SPA architecture, SSE real-time, ECharts visualization
 */
import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, mkdirSync, type Dirent } from 'node:fs'
import { basename, join, dirname, extname, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import Database from 'better-sqlite3'
import type { ServerType } from '@hono/node-server'
import type { EventBus } from '../core/eventBus.js'
import type { Gate } from '../artifact/types.js'
import type { IArtifactStore } from '../artifact/store.js'
import type { IFSM } from '../artifact/fsm.js'
import type { IEvolutionEvaluator, EvolutionMetrics } from '../evolution/EvolutionEvaluator.js'
import type { DetectorStatisticsTracker } from '../guardrails/DetectorEnhanced.js'
import { MemoryBrain, type MemoryNode, type MemoryReviewAction } from '../memory/MemoryBrain.js'
import {
  inspectMemoryProviders,
  recallMemoryProviders,
  type MemoryProviderRecallReport,
  type MemoryProviderStatusReport,
} from '../memory/MemoryProviders.js'
import { dumpCodeGraphData, type TopologyGraph } from '../codegraph/CodeIntelligence.js'
import { classifyLayers } from '../topology/LayerClassifier.js'
import { mapDomains } from '../topology/DomainMapper.js'
import { generateTour } from '../topology/TourGenerator.js'
import { aggregateGovernanceMetrics } from './MetricsAggregator.js'
import { logger } from '../core/logger.js'
import { RuntimeEvidenceLedger, type RuntimeEvidenceRecord } from '../runtime/RuntimeEvidenceLedger.js'
import {
  optimizeCodingPrompt,
  type PromptOptimizationLanguageInput,
  type PromptOptimizationResult,
} from '../prompts/PromptOptimizer.js'
import { PhasePromptRegistry, type PromptTemplate } from '../prompts/PhasePromptRegistry.js'
import { listVisualVibePacks, listVisualVibeTemplates, type VisualVibeTemplate } from '../prompts/VibeTemplateGallery.js'
import { createAiOsPlan, type AiOsRuntimePlan } from '../runtime/AiOsRuntime.js'
import type { SkillTaskLevel } from '../skills/routing/index.js'
import { externalCommandExists, resolveExternalCommandPath, runExternalCommandSync } from '../core/ExternalCommand.js'
import { SUPPORTED_AGENTS } from '../adapters/index.js'
import {
  buildFeishuEventConsumeCommand,
  buildFeishuSendMessageCommand,
  type FeishuCommandPlan,
} from '../communication/FeishuChannelProvider.js'
import {
  AgentControlPlane,
  type AgentControlReport,
  type AgentControlSessionSummary,
  type AgentControlMessageRecord,
  type AgentControlTranscriptReport,
  type AgentControlTranscriptSearchReport,
  type AgentControlConversationSummary,
} from './AgentControlPlane.js'
import {
  ensureDashboardService,
  readDashboardServiceStatus,
  restartDashboardService,
  startDashboardService,
  type DashboardServiceStatus,
} from './DashboardServiceSupervisor.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MEMORY_REVIEW_ACTIONS = ['approve', 'reject', 'stale', 'restore'] as const
const DASHBOARD_SERVICE_STATUS_CACHE_TTL_MS = 750
const DASHBOARD_REPORT_CACHE_TTL_MS = 1500
const DASHBOARD_CAPABILITY_REPORT_CACHE_TTL_MS = 60000

// ── Types ────────────────────────────────────────────────────────────────

export interface DashboardState {
  artifacts: ArtifactTreeNode[]
  evolutionMetrics: EvolutionMetrics | null
  detectorStats: DetectorStatSummary[]
  autoDefectStats: AutoDefectSummary | null
  recentEvents: RecentEvent[]
  timestamp: number
}

interface DashboardCacheEntry<T> {
  expiresAt: number
  value: T
}

export interface AutoDefectSummary {
  totalDefects: number
  autoCreatedCount: number
  byRootCause: Record<string, number>
  bySeverity: Record<string, number>
  recentDefects: RecentDefect[]
}

export interface RecentDefect {
  id: string
  title: string
  rootCause: string
  severity: string
  detector: string
  createdAt: number
}

export interface ArtifactTreeNode {
  id: string
  type: string
  title: string
  status: string
  version: number
  children: ArtifactTreeNode[]
  gates?: GateSummary[]
}

export interface GateSummary {
  name: string
  required: boolean
  passed: boolean
}

export interface DetectorStatSummary {
  name: string
  totalTriggers: number
  bySeverity: Record<string, number>
  lastTrigger?: number
}

export interface RecentEvent {
  type: string
  timestamp: number
  artifactId?: string
  data?: Record<string, unknown>
}

export interface DashboardProjectSummary {
  id: string
  name: string
  projectDir: string
  scaleDir: string
  url?: string
  current?: boolean
}

export interface DashboardKnowledgeReport {
  project: DashboardProjectSummary
  local: {
    available: boolean
    total: number
    byStatus: Record<string, number>
    nodes: MemoryNode[]
  }
  providers?: MemoryProviderStatusReport
  recall?: MemoryProviderRecallReport
  warnings: string[]
}

export interface DashboardDocumentSummary {
  name: string
  path: string
  type: string
  size: number
  updatedAt?: number
}

export interface DashboardDocumentTreeNode {
  name: string
  path: string
  type: 'folder' | 'document'
  size?: number
  docType?: string
  children?: DashboardDocumentTreeNode[]
}

export interface DashboardKnowledgeEntrySummary {
  id: string
  title: string
  content: string
  type: string
  tags: string[]
  score: number
  createdAt: number
  updatedAt: number
  source?: string
}

export interface DashboardKnowledgeGraphNode {
  id: string
  label: string
  kind: string
  group: string
  source: string
  path?: string
}

export interface DashboardKnowledgeGraphEdge {
  source: string
  target: string
  label?: string
}

export interface DashboardKnowledgeGraphReport {
  status: DashboardDataSourceStatus
  source: string
  reportPath?: string
  nodeCount: number
  edgeCount: number
  nodes: DashboardKnowledgeGraphNode[]
  edges: DashboardKnowledgeGraphEdge[]
  emptyReason?: string
}

export interface DashboardKnowledgeBaseReport {
  project: DashboardProjectSummary
  generatedAt: number
  summary: {
    documents: number
    entries: number
    graphNodes: number
    graphEdges: number
    memoryNodes: number
    memoryEdges: number
  }
  documents: DashboardDocumentSummary[]
  documentTree: DashboardDocumentTreeNode[]
  entries: DashboardKnowledgeEntrySummary[]
  graph: DashboardKnowledgeGraphReport
  memoryGraph: DashboardKnowledgeGraphReport
  exports: {
    report: string
    documents: string
    graph: string
    memoryGraph: string
  }
  warnings: string[]
}

export type DashboardPromptSource = 'builtin' | 'project' | 'global'

export interface DashboardPromptTemplateSummary extends PromptTemplate {
  source: DashboardPromptSource
  command?: string
}

export interface DashboardPromptPackSummary {
  id: string
  name: string
  description: string
  phases: string[]
  templateIds: string[]
  command: string
  source?: 'phase' | 'vibe'
}

export interface DashboardVisualVibeTemplateSummary extends VisualVibeTemplate {
  command: string
}

export interface DashboardPromptStudioReport {
  project: DashboardProjectSummary
  generatedAt: number
  summary: {
    vibeTemplates: number
    phasePrompts: number
    packs: number
    customPrompts: number
  }
  commands: {
    vibeIndex: string
    vibeTemplate: string
    vibePack: string
    promptOptimize: string
  }
  vibeTemplates: DashboardVisualVibeTemplateSummary[]
  phasePrompts: DashboardPromptTemplateSummary[]
  packs: DashboardPromptPackSummary[]
  warnings: string[]
}

export interface DashboardPromptOptimizationReport {
  project: DashboardProjectSummary
  generatedAt: number
  result: PromptOptimizationResult
}

export interface DashboardIntegrationProviderReport {
  id: string
  name: string
  category: 'message-channel' | 'knowledge-provider'
  description: string
  status: DashboardDataSourceStatus
  command: string
  commandAvailable: boolean
  commandPath?: string
  configBoundary: string
  authModes: DashboardIntegrationAuthMode[]
  setupCommands: string[]
  verifyCommands: string[]
  dryRunSendPlan?: FeishuCommandPlan
  eventConsumePlan?: FeishuCommandPlan
  routeConfig?: DashboardFeishuRouteSummary
  routeConfigs?: DashboardFeishuRouteSummary[]
  knowledgeConfig?: DashboardKnowledgeProviderSummary
  scope: {
    level: 'machine' | 'project' | 'workspace'
    projectScoped: boolean
    projectId: string
    projectDir: string
    description: string
  }
  platformTargets: Array<{
    id: string
    name: string
    status: DashboardDataSourceStatus
    settingsPath?: string
    knowledgeDocPath?: string
  }>
  actions: Array<{
    id: string
    label: string
    kind: 'probe' | 'dry-run' | 'read'
    plan: FeishuCommandPlan
  }>
  safetyRules: string[]
  nextAction?: string
  warnings: string[]
}

export interface DashboardIntegrationAuthMode {
  id: 'cli-profile' | 'app-secret' | 'api-key' | 'qr'
  label: string
  description: string
  status: DashboardDataSourceStatus
  configured: boolean
  sensitive: boolean
  fields: string[]
  setupCommand?: string
  authUrl?: string
}

export type DashboardFeishuRouteTargetType = 'chat' | 'user'

export interface DashboardFeishuRouteConfig {
  version: 1
  enabled: boolean
  routeId: string
  routeName: string
  projectId: string
  projectDir: string
  agentPlatformId: string
  agentSessionId: string
  targetType: DashboardFeishuRouteTargetType
  targetId: string
  eventKey: string
  commandPrefix: string
  allowWriteCommands: boolean
  importKnowledge: boolean
  notes?: string
  updatedAt: number
}

export interface DashboardFeishuRouteConfigFile {
  version: 1
  provider: 'feishu'
  projectId: string
  projectDir: string
  routes: DashboardFeishuRouteConfig[]
  updatedAt: number
}

export interface DashboardFeishuRouteSummary extends DashboardFeishuRouteConfig {
  configPath: string
  configured: boolean
  platformStatus: DashboardDataSourceStatus
  targetLabel: string
  dryRunSendPlan?: FeishuCommandPlan
  eventConsumePlan: FeishuCommandPlan
  warnings: string[]
}

export interface DashboardIntegrationRouteUpdateResult {
  provider: 'feishu'
  ok: boolean
  saved: boolean
  route: DashboardFeishuRouteSummary
  routes?: DashboardFeishuRouteSummary[]
  error?: string
}

export type DashboardKnowledgeProviderAuthMode = 'api-key' | 'qr'

export interface DashboardKnowledgeProviderConfig {
  version: 1
  provider: 'tencent-ima'
  enabled: boolean
  authMode: DashboardKnowledgeProviderAuthMode
  clientId: string
  knowledgeBaseId: string
  hasApiKey: boolean
  apiKeyMasked?: string
  qrAuthorized: boolean
  notes?: string
  updatedAt: number
}

export interface DashboardKnowledgeProviderSummary extends DashboardKnowledgeProviderConfig {
  configPath: string
  configured: boolean
  consoleUrl: string
  authLabel: string
  warnings: string[]
}

export interface DashboardKnowledgeProviderUpdateResult {
  provider: 'tencent-ima'
  ok: boolean
  saved: boolean
  config: DashboardKnowledgeProviderSummary
  error?: string
}

export interface DashboardIntegrationActionResult {
  provider: string
  action: string
  ok: boolean
  status: 'passed' | 'failed' | 'blocked'
  startedAt: number
  finishedAt: number
  durationMs: number
  plan?: FeishuCommandPlan
  stdout?: string
  stderr?: string
  error?: string
}

export interface DashboardAgentOsAcceptanceStep {
  id: string
  label: string
  status: 'passed' | 'failed' | 'blocked'
  startedAt: number
  finishedAt: number
  durationMs: number
  command?: string
  args?: string[]
  stdout?: string
  stderr?: string
  error?: string
}

export interface DashboardAgentOsAcceptanceReport {
  ok: boolean
  status: 'passed' | 'failed' | 'blocked' | 'missing'
  score: number
  generatedAt: number
  path: string
  steps: DashboardAgentOsAcceptanceStep[]
  warnings: string[]
  nextActions: string[]
}

export interface DashboardFeishuAuthStartResult {
  provider: 'feishu'
  ok: boolean
  status: 'started' | 'blocked' | 'failed'
  startedAt: number
  finishedAt: number
  durationMs: number
  command: string
  args: string[]
  verificationUrl?: string
  userCode?: string
  deviceCode?: string
  expiresIn?: number
  setupCommand?: string
  stdout?: string
  stderr?: string
  error?: string
}

export type DashboardConnectorConfigScope = 'machine' | 'workspace' | 'project' | 'agent-platform' | 'session'
export type DashboardConnectorPublicUrlRequirement = 'no' | 'optional' | 'yes'

export interface DashboardConnectorAuthMode {
  id: string
  label: string
  description: string
  fields: string[]
  sensitive: boolean
  setupCommand?: string
}

export interface DashboardConnectorChannel {
  id: string
  name: string
  status: DashboardDataSourceStatus
  transport: string[]
  publicUrlRequired: DashboardConnectorPublicUrlRequirement
  configScope: DashboardConnectorConfigScope
  sessionScope: 'user' | 'chat' | 'thread' | 'project'
  capabilities: string[]
  authModes: DashboardConnectorAuthMode[]
  defaultSetup: string[]
  notes: string[]
  recommended: boolean
  warnings: string[]
}

export interface DashboardAgentConnectConfig {
  version: 1
  enabled: boolean
  managementApi: {
    enabled: boolean
    host: string
    port: number
    hasToken: boolean
    tokenMasked?: string
    corsOrigins: string[]
  }
  bridge: {
    enabled: boolean
    host: string
    port: number
    path: string
    hasToken: boolean
    tokenMasked?: string
    allowPlatforms: string[]
    defaultProjectId: string
    protocolVersion: 1
  }
  webhook: {
    enabled: boolean
    path: string
    hasToken: boolean
    tokenMasked?: string
  }
  automation: {
    cronEnabled: boolean
    heartbeatEnabled: boolean
    heartbeatIntervalMins: number
    maxTurnTimeMins: number
    resetOnIdleMins: number
    longTaskNotifications: boolean
  }
  updatedAt: number
}

export interface DashboardAgentConnectConfigSummary extends DashboardAgentConnectConfig {
  configPath: string
  configured: boolean
  endpoints: {
    managementApi: string
    bridgeWebSocket: string
    webhook: string
  }
  commands: string[]
  warnings: string[]
}

export interface DashboardAgentConnectUpdateResult {
  ok: boolean
  saved: boolean
  config: DashboardAgentConnectConfigSummary
  error?: string
}

export interface DashboardAgentOsBootstrapResult extends DashboardAgentConnectUpdateResult {
  agentOs: DashboardAgentOsReadinessReport
  secrets: {
    path: string
    rawStored: boolean
    tokens: {
      managementApi: string
      bridge: string
      webhook: string
    }
  }
  actions: string[]
  warnings: string[]
}

export interface DashboardBridgeSession {
  id: string
  projectId: string
  projectName: string
  platform: string
  agentPlatformId: string
  agentSessionId: string
  scope: 'user' | 'chat' | 'thread' | 'project'
  user: string
  title: string
  active: boolean
  capabilities: string[]
  createdAt: number
  updatedAt: number
  lastSeenAt?: number
}

export interface DashboardBridgeSessionStore {
  version: 1
  activeSessionId?: string
  sessions: DashboardBridgeSession[]
}

export interface DashboardBridgeEventRecord {
  id: string
  sessionId: string
  agentSessionId: string
  platform: string
  type: string
  direction: 'inbound' | 'outbound'
  payload: Record<string, unknown>
  createdAt: number
}

export interface DashboardConnectorWorkflowReport {
  summary: {
    channels: number
    readyChannels: number
    partialChannels: number
    agentPlatforms: number
    providerPresets: number
    skillPresets: number
    automationLoops: number
  }
  config: DashboardAgentConnectConfigSummary
  channels: DashboardConnectorChannel[]
  bridge: {
    protocolVersion: 1
    enabled: boolean
    websocketEndpoint: string
    tokenRequired: boolean
    sessionKeyFormat: string
    adapterRegistration: string[]
    inboundTypes: string[]
    outboundTypes: string[]
    restEndpoints: string[]
    capabilities: string[]
  }
  managementApi: {
    enabled: boolean
    baseUrl: string
    auth: string
    endpoints: string[]
  }
  providerPresets: Array<{
    id: string
    name: string
    tier: number
    agents: string[]
    models: string[]
    features: string[]
    authFields: string[]
    source: string
  }>
  skillPresets: Array<{
    id: string
    name: string
    required: boolean
    defaultInstall: boolean
    category: string
    reason: string
  }>
  automationLoops: Array<{
    id: string
    name: string
    enabled: boolean
    trigger: string
    action: string
    guardrail: string
  }>
  daemon: {
    status: DashboardServiceStatus['status']
    serviceDir: string
    healthUrl: string
    installed: boolean
    supervisorAlive: boolean
    commands: string[]
    hooks: string[]
  }
  configModel: Array<{
    scope: DashboardConnectorConfigScope
    owner: string
    storage: string
    examples: string[]
  }>
  commands: {
    configure: string[]
    verify: string[]
    agentRuntime: string[]
  }
  warnings: string[]
}

export interface DashboardAgentOsReadinessStage {
  id: string
  title: string
  description: string
  status: DashboardDataSourceStatus
  score: number
  tab: 'overview' | 'messages' | 'agent-connect' | 'knowledge' | 'automation' | 'diagnostics'
  primaryAction: string
  evidence: string[]
  blockers: string[]
  commands: string[]
}

export interface DashboardAgentOsReadinessReport {
  score: number
  status: DashboardDataSourceStatus
  primaryAction: string
  summary: {
    ready: number
    partial: number
    missing: number
    error: number
    remoteControlReady: boolean
    mobileControlReady: boolean
    knowledgeReady: boolean
    daemonReady: boolean
  }
  stages: DashboardAgentOsReadinessStage[]
}

export interface DashboardIntegrationsReport {
  project: DashboardProjectSummary
  generatedAt: number
  summary: {
    providers: number
    ready: number
    partial: number
    missing: number
  }
  providers: DashboardIntegrationProviderReport[]
  connectorWorkflow: DashboardConnectorWorkflowReport
  agentOs: DashboardAgentOsReadinessReport
  acceptance: DashboardAgentOsAcceptanceReport
  warnings: string[]
}

export interface DashboardAgentPlanReport {
  project: DashboardProjectSummary
  generatedAt: number
  task: AiOsRuntimePlan['task']
  governance: {
    effectiveMode: AiOsRuntimePlan['governance']['effectiveMode']
    workflowProfile: AiOsRuntimePlan['adaptiveWorkflow']['profile']
    evaluatorRisk: AiOsRuntimePlan['evaluator']['riskLevel']
  }
  toolStrategy: AiOsRuntimePlan['toolStrategy']['summary']
  agentCollaboration: AiOsRuntimePlan['agentCollaboration']
  recommendations: string[]
}

export interface DashboardProjectsSummaryReport {
  generatedAt: number
  sinceDays: number
  currentProjectId: string
  totals: {
    projects: number
    readyProjects: number
    warningProjects: number
    missingProjects: number
    documents: number
    localMemoryNodes: number
    activeMemoryNodes: number
    commandRuns: number
    failedCommandRuns: number
    gateFailures: number
  }
  projects: DashboardProjectOverview[]
  warnings: string[]
}

export type DashboardDataSourceStatus = 'ready' | 'partial' | 'missing' | 'error'
export type DashboardRefreshMode = 'sse' | 'polling' | 'manual' | 'snapshot'

export interface DashboardDataSourceSignal {
  id: string
  title: string
  description: string
  status: DashboardDataSourceStatus
  refreshMode: DashboardRefreshMode
  source: string
  count?: number
  lastUpdated?: number
  emptyReason?: string
  action?: string
}

export interface DashboardCapabilityReport {
  project: DashboardProjectSummary
  generatedAt: number
  summary: {
    total: number
    ready: number
    partial: number
    missing: number
    error: number
  }
  realtime: {
    status: DashboardDataSourceStatus
    mode: 'event-bus' | 'heartbeat-only'
    busAvailable: boolean
    heartbeatOnly: boolean
    refreshIntervalMs: number
  }
  writeOps: {
    artifactTransitions: boolean
    memoryReview: boolean
    promptOptimization: boolean
    documentEditing: boolean
    knowledgeImport: boolean
  }
  dataSources: DashboardDataSourceSignal[]
  warnings: string[]
}

export interface DashboardProjectOverview {
  project: DashboardProjectSummary
  health: 'ready' | 'warning' | 'missing'
  scaleDirExists: boolean
  documents: {
    total: number
    byType: Record<string, number>
  }
  knowledge: {
    available: boolean
    total: number
    active: number
  }
  metrics: {
    available: boolean
    commandRuns: number
    failedCommandRuns: number
    commandPassRate: number
    gateFailures: number
    recentTasks: number
    recentFirstPassRate: number
  }
  warnings: string[]
}

export interface DashboardOptions {
  port?: number
  host?: string
  store?: IArtifactStore
  fsm?: IFSM
  evaluator?: IEvolutionEvaluator
  detectorTracker?: DetectorStatisticsTracker
  bus?: EventBus
  projectDir?: string
  scaleDir?: string
  projectName?: string
  projectUrl?: string
  currentProjectId?: string
  projects?: DashboardProjectSummary[]
}

// ── Dashboard Server ─────────────────────────────────────────────────────

export class DashboardServer {
  private app: Hono
  private bus: EventBus | null
  private store: IArtifactStore | null
  private fsm: IFSM | null
  private evaluator: IEvolutionEvaluator | null
  private detectorTracker: DetectorStatisticsTracker | null
  private port: number
  private host: string
  private projectDir: string
  private scaleDir: string
  private currentProject: DashboardProjectSummary
  private projects: DashboardProjectSummary[]
  private server: ServerType | null = null
  private dashboardServiceStatusCache: DashboardCacheEntry<DashboardServiceStatus> | null = null
  private agentControlReportCache: DashboardCacheEntry<AgentControlReport> | null = null
  private integrationsReportCache: DashboardCacheEntry<DashboardIntegrationsReport> | null = null
  private dashboardCapabilityReportCache: DashboardCacheEntry<DashboardCapabilityReport> | null = null

  constructor(options: DashboardOptions = {}) {
    this.app = new Hono()
    this.bus = options.bus ?? null
    this.store = options.store ?? null
    this.fsm = options.fsm ?? null
    this.evaluator = options.evaluator ?? null
    this.detectorTracker = options.detectorTracker ?? null
    this.port = options.port ?? 3210
    this.host = options.host ?? '0.0.0.0'
    this.projectDir = resolve(options.projectDir ?? process.cwd())
    this.scaleDir = resolve(options.scaleDir ?? join(this.projectDir, '.scale'))
    this.currentProject = normalizeProjectSummary({
      id: options.currentProjectId,
      name: options.projectName,
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
      url: options.projectUrl,
      current: true,
    })
    this.projects = normalizeProjectList(options.projects, this.currentProject)

    this.setupMiddleware()
    this.setupSPA()
    this.setupAPI()
    this.setupSSE()
    this.setupWriteOps()
  }

  // ── Middleware ────────────────────────────────────────────────────────

  private setupMiddleware(): void {
    this.app.use('*', cors())
  }

  // ── SPA Serves ───────────────────────────────────────────────────────

  private setupSPA(): void {
    // Vue dashboard is the canonical UI and is served from the dashboard root.
    const packagedVueSpa = join(__dirname, 'spa')
    const projectVueSpa = join(__dirname, '..', '..', 'dist', 'dashboard', 'spa')
    const hasVueDashboard = (dir: string) => existsSync(join(dir, 'index.html')) && existsSync(join(dir, 'assets'))
    const vueSpaDir = hasVueDashboard(packagedVueSpa) ? packagedVueSpa : hasVueDashboard(projectVueSpa) ? projectVueSpa : ''
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
    }

    const serveStatic = (c: Context, prefix: string, dir: string, fallbackToIndex = false) => {
      const path = c.req.path.replace(prefix, '') || 'index.html'
      const filePath = join(dir, path)
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        if (!fallbackToIndex) return c.notFound()
        const indexPath = join(dir, 'index.html')
        if (!existsSync(indexPath)) return c.notFound()
        return new Response(readFileSync(indexPath), {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
        })
      }
      const ext = extname(filePath)
      const contentType = mimeTypes[ext] ?? 'application/octet-stream'
      const content = readFileSync(filePath)
      return new Response(content, {
        headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache' },
      })
    }

    const serveVueSpa = async (c: Context) => {
      if (existsSync(vueSpaDir)) return this.serveVueSpaIndex(vueSpaDir)
      return c.html('<!doctype html><html><head><title>SCALE Engine Dashboard</title></head><body><main id="app">Run npm run build to generate the Vue dashboard.</main></body></html>', 503)
    }

    this.app.get('/assets/*', (c) => existsSync(vueSpaDir) ? serveStatic(c, '/', vueSpaDir) : c.notFound())

    // Backward-compatible preview URLs from the migration period.
    this.app.get('/spa', (c) => c.redirect('/'))
    this.app.get('/spa/*', (c) => c.redirect('/'))
    this.app.get('/vue', (c) => c.redirect('/'))
    this.app.get('/vue/*', (c) => c.redirect('/'))

    // Root Vue dashboard.
    this.app.get('/', serveVueSpa)

    this.app.get('/favicon.ico', () => new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'public, max-age=86400' },
    }))

    // Legacy views (backward compat)
    const distViews = join(__dirname, 'views')
    const srcViews = join(__dirname, '..', '..', 'src', 'dashboard', 'views')
    const viewsDir = existsSync(distViews) ? distViews : srcViews

    this.app.get('/legacy/:view', (c) => {
      const view = c.req.param('view')
      const viewMap: Record<string, string> = {
        'artifacts': 'artifact-flow.html',
        'sessions': 'session-timeline.html',
        'knowledge': 'knowledge-graph.html',
        'evolution': 'evolution-metrics.html',
        'agents': 'agent-stats.html',
        'topology': 'topology.html',
      }
      const viewFile = viewMap[view]
      if (!viewFile) return c.notFound()
      try {
        const content = readFileSync(join(viewsDir, viewFile), 'utf-8')
        return c.html(content)
      } catch {
        return c.notFound()
      }
    })

    // Health check
    this.app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now(), version: '2.0.0' }))
  }

  // ── API Routes ───────────────────────────────────────────────────────

  private async serveVueSpaIndex(vueSpaDir: string): Promise<Response> {
    const indexPath = join(vueSpaDir, 'index.html')
    if (!existsSync(indexPath)) return new Response(null, { status: 404 })
    const html = readFileSync(indexPath, 'utf-8')
    const bootstrap = await this.getDashboardBootstrapSnapshot()
    const script = `<script>window.__SCALE_DASHBOARD_BOOTSTRAP__=${escapeJsonForHtml(bootstrap)};</script>`
    const content = html.includes('</body>')
      ? html.replace('</body>', `    ${script}\n  </body>`)
      : `${html}\n${script}`
    return new Response(content, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
    })
  }

  private async getDashboardBootstrapSnapshot(): Promise<Record<string, unknown>> {
    const failures: Record<string, string> = {}
    const read = async <T>(key: string, producer: () => T | Promise<T>, fallback: T): Promise<T> => {
      try {
        return await producer()
      } catch (error) {
        failures[key] = error instanceof Error ? error.message : String(error)
        return fallback
      }
    }

    return {
      generatedAt: Date.now(),
      endpoints: {
        '/api/projects': await read('projects', () => this.projects, []),
        '/api/dashboard/service': await read('dashboardService', () => this.getDashboardServiceStatus(), null),
        '/api/integrations': await read('integrations', () => this.getIntegrationsReport(), null),
        '/api/agent-control': await read('agentControl', () => this.getAgentControlReport(), null),
      },
      failures,
    }
  }

  private async createDashboardAgentPlanReport(body: Record<string, unknown>): Promise<DashboardAgentPlanReport> {
    const task = String(body.task ?? body.scenario ?? '').trim()
    const plan = await createAiOsPlan({
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
      taskId: typeof body.taskId === 'string' && body.taskId.trim() ? body.taskId.trim() : undefined,
      task,
      level: normalizeDashboardTaskLevel(body.level),
      files: toStringArray(body.files),
      services: toStringArray(body.services ?? body.service),
      budget: parsePositiveIntFromUnknown(body.budget, 3600),
    })
    return {
      project: this.currentProject,
      generatedAt: Date.now(),
      task: plan.task,
      governance: {
        effectiveMode: plan.governance.effectiveMode,
        workflowProfile: plan.adaptiveWorkflow.profile,
        evaluatorRisk: plan.evaluator.riskLevel,
      },
      toolStrategy: plan.toolStrategy.summary,
      agentCollaboration: plan.agentCollaboration,
      recommendations: plan.agentCollaboration.recommendations,
    } satisfies DashboardAgentPlanReport
  }

  private setupAPI(): void {
    this.app.get('/api/health', (c) => c.json({
      status: 'ok',
      timestamp: Date.now(),
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
      pid: process.pid,
    }))
    // Project metadata for multi-project dashboard launchers
    this.app.get('/api/project', (c) => c.json(this.currentProject))
    this.app.get('/api/projects', (c) => c.json(this.projects))
    this.app.get('/api/projects/summary', (c) => {
      const sinceDays = parsePositiveInt(c.req.query('days'), 7)
      const limit = parsePositiveInt(c.req.query('limit'), 100)
      return c.json(this.getProjectsSummary(sinceDays, limit))
    })
    this.app.get('/api/dashboard/capabilities', (c) => c.json(this.getDashboardCapabilityReport()))
    this.app.get('/api/capabilities', (c) => c.json(this.getDashboardCapabilityReport()))
    this.app.get('/api/dashboard/service', (c) => c.json(this.getDashboardServiceStatus()))
    this.app.post('/api/dashboard/service/actions/:action', (c) => {
      try {
        return c.json(this.runDashboardServiceAction(c.req.param('action')))
      } catch (error) {
        return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400)
      }
    })

    // Full dashboard state
    this.app.get('/api/state', async (c) => c.json(await this.getDashboardState()))

    // Artifact tree
    this.app.get('/api/artifacts', async (c) => c.json(await this.getArtifactTree()))

    // Evolution metrics
    this.app.get('/api/evolution', async (c) => c.json(await this.getEvolutionMetrics()))

    // Detector stats
    this.app.get('/api/detectors', (c) => c.json(this.getDetectorStats()))

    // Recent events
    this.app.get('/api/events', async (c) => {
      const limit = parseInt(c.req.query('limit') ?? '50')
      return c.json(await this.getRecentEvents(limit))
    })

    // Auto-defect stats
    this.app.get('/api/auto-defects', async (c) => c.json(await this.getAutoDefectStats()))

    // Governance metrics (aggregated from MetricsAggregator)
    this.app.get('/api/metrics', (c) => {
      try {
        const metrics = aggregateGovernanceMetrics({
          projectDir: this.projectDir,
          scaleDir: this.scaleDir,
          sinceDays: parseInt(c.req.query('days') ?? '7'),
        })
        return c.json(metrics)
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
      }
    })

    // Topology graph
    this.app.get('/api/topology', (c) => c.json(this.getTopology()))

    // Guided tour
    this.app.get('/api/topology/tour', (c) => c.json(generateTour(this.getTopology())))

    // Domain mapping
    this.app.get('/api/topology/domains', (c) => {
      const graph = this.getTopology()
      return c.json(mapDomains(graph))
    })

    // Available documents in .scale/
    this.app.get('/api/documents', (c) => {
      return c.json(this.listDocuments())
    })

    // Serve a document by path
    this.app.get('/api/documents/*', (c) => {
      const docPath = c.req.path.replace('/api/documents/', '')
      return this.serveDocument(docPath, c)
    })

    // Memory/knowledge view. Provider recall is explicit to keep page load cheap.
    this.app.get('/api/knowledge', async (c) => {
      const query = (c.req.query('query') ?? '').trim()
      const limit = parsePositiveInt(c.req.query('limit'), 20)
      const includeProviders = c.req.query('providers') !== 'false'
      const runRecall = c.req.query('recall') === '1' || c.req.query('recall') === 'true'
      const provider = c.req.query('provider')?.trim() || undefined
      return c.json(await this.getKnowledgeReport({ query, limit, includeProviders, runRecall, provider }))
    })

    // Repo-native knowledge base: docs, SQLite knowledge, Graphify graph, and gbrain visualization.
    this.app.get('/api/knowledge-base', (c) => c.json(this.getKnowledgeBaseReport()))

    this.app.get('/api/integrations', (c) => c.json(this.getIntegrationsReport()))
    this.app.get('/api/integrations/agent-connect', (c) => c.json(this.getAgentConnectConfig()))
    this.app.put('/api/integrations/agent-connect', async (c) => {
      const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}))
      const result = this.saveAgentConnectConfig(body)
      if (result.ok) this.invalidateDashboardReportCaches()
      return c.json(result, result.ok ? 200 : 400)
    })
    this.app.post('/api/integrations/agent-os/bootstrap-local', (c) => {
      const result = this.bootstrapLocalAgentOs()
      if (result.ok) this.invalidateDashboardReportCaches()
      return c.json(result, result.ok ? 200 : 400)
    })
    this.app.post('/api/integrations/agent-os/acceptance', (c) => {
      const result = this.runAgentOsAcceptance()
      return c.json(result)
    })
    this.app.get('/api/v1/status', (c) => c.json(this.getManagementApiStatus()))
    this.app.post('/api/v1/reload', (c) => c.json({
      ok: true,
      reloadedAt: Date.now(),
      config: this.getAgentConnectConfig(),
      status: this.getManagementApiStatus(),
    }))
    this.app.post('/api/v1/restart', async (c) => {
      const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}))
      if (body.execute === true) {
        const result = restartDashboardService({ projectDir: this.projectDir, scaleDir: this.scaleDir, port: this.port, host: this.host })
        return c.json({ ok: true, executed: true, result })
      }
      return c.json({
        ok: true,
        executed: false,
        action: 'restart-dashboard-service',
        command: `scale dashboard daemon restart --dir "${this.projectDir}" --port ${this.port} --json`,
      })
    })
    this.app.get('/api/v1/config', (c) => c.json(this.getAgentConnectConfig()))
    this.app.get('/api/v1/projects', (c) => c.json({ projects: this.projects, currentProject: this.currentProject }))
    this.app.get('/api/v1/projects/:projectName/sessions', (c) => {
      const project = this.findManagementProject(c.req.param('projectName'))
      if (!project) return c.json({ ok: false, error: 'Project not found.' }, 404)
      return c.json({ ok: true, project, sessions: this.getAgentControlReport().sessions })
    })
    this.app.post('/api/v1/projects/:projectName/send', async (c) => {
      const project = this.findManagementProject(c.req.param('projectName'))
      if (!project) return c.json({ ok: false, error: 'Project not found.' }, 404)
      const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}))
      try {
        const sessionId = normalizeSingleLine(body.sessionId, this.getAgentControlReport().sessions[0]?.sessionId ?? 'default')
        const message = this.getAgentControlPlane().sendMessage(sessionId, {
          text: body.text,
          dryRun: body.dryRun,
          from: normalizeSingleLine(body.from, 'management-api'),
        })
        this.invalidateDashboardReportCaches()
        return c.json({
          ok: true,
          project,
          message,
        })
      } catch (error) {
        return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400)
      }
    })
    this.app.get('/api/v1/projects/:projectName/providers', (c) => {
      const project = this.findManagementProject(c.req.param('projectName'))
      if (!project) return c.json({ ok: false, error: 'Project not found.' }, 404)
      const integrations = this.getIntegrationsReport()
      const agentControl = this.getAgentControlReport()
      return c.json({
        ok: true,
        project,
        providers: integrations.providers,
        channels: integrations.connectorWorkflow.channels,
        platformTargets: agentControl.platformTargets,
        modelOptions: agentControl.modelOptions,
      })
    })
    this.app.post('/api/v1/projects/:projectName/model', async (c) => {
      const project = this.findManagementProject(c.req.param('projectName'))
      if (!project) return c.json({ ok: false, error: 'Project not found.' }, 404)
      const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}))
      try {
        const report = this.getAgentControlReport()
        const sessionId = normalizeSingleLine(body.sessionId, report.sessions[0]?.sessionId ?? 'default')
        const existing = report.sessions.find(session => session.sessionId === sessionId)
        const session = this.getAgentControlPlane().saveSession(sessionId, {
          name: body.name ?? existing?.name,
          platformId: body.platformId ?? existing?.platformId,
          modelId: body.modelId ?? existing?.modelId,
          channelProvider: body.channelProvider ?? existing?.channelProvider,
          commandPrefix: body.commandPrefix ?? existing?.commandPrefix,
          mode: body.mode ?? existing?.mode,
          autoImportKnowledge: typeof body.autoImportKnowledge === 'boolean' ? body.autoImportKnowledge : existing?.autoImportKnowledge,
        })
        this.invalidateDashboardReportCaches()
        return c.json({
          ok: true,
          project,
          session,
        })
      } catch (error) {
        return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400)
      }
    })
    this.app.get('/api/v1/cron', (c) => c.json({
      ok: true,
      loops: this.getIntegrationsReport().connectorWorkflow.automationLoops,
    }))
    this.app.post('/api/v1/cron/:id/exec', (c) => {
      const loop = this.getIntegrationsReport().connectorWorkflow.automationLoops.find(item => item.id === c.req.param('id'))
      if (!loop) return c.json({ ok: false, error: 'Cron loop not found.' }, 404)
      return c.json({
        ok: true,
        executedAt: Date.now(),
        loop,
        result: loop.enabled ? 'trigger-recorded' : 'loop-disabled',
        dashboardService: this.getDashboardServiceStatus(),
      })
    })
    this.app.get('/api/v1/bridge/adapters', (c) => c.json(this.getBridgeAdaptersReport()))
    this.app.get('/bridge/sessions', (c) => c.json(this.getBridgeSessionsReport()))
    this.app.post('/bridge/sessions', async (c) => {
      const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}))
      try {
        return c.json({ ok: true, session: this.createBridgeSession(body), ...this.getBridgeSessionsReport() })
      } catch (error) {
        return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400)
      }
    })
    this.app.post('/bridge/events', async (c) => {
      const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}))
      try {
        return c.json(this.ingestBridgeEvent(body))
      } catch (error) {
        return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400)
      }
    })
    this.app.get('/bridge/sessions/:id', (c) => {
      const session = this.getBridgeSession(c.req.param('id'))
      return session ? c.json({ ok: true, session }) : c.json({ ok: false, error: 'Bridge session not found.' }, 404)
    })
    this.app.get('/bridge/sessions/:id/events', (c) => {
      try {
        return c.json(this.getBridgeSessionEvents(c.req.param('id'), {
          cursor: c.req.query('cursor'),
          limit: c.req.query('limit'),
        }))
      } catch (error) {
        return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400)
      }
    })
    this.app.delete('/bridge/sessions/:id', (c) => {
      const deleted = this.deleteBridgeSession(c.req.param('id'))
      return deleted ? c.json({ ok: true, deleted }) : c.json({ ok: false, error: 'Bridge session not found.' }, 404)
    })
    this.app.post('/bridge/sessions/switch', async (c) => {
      const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}))
      try {
        return c.json({ ok: true, session: this.switchBridgeSession(body), ...this.getBridgeSessionsReport() })
      } catch (error) {
        return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400)
      }
    })
    this.app.post('/agent-connect/webhook', async (c) => {
      const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}))
      try {
        return c.json(this.ingestAgentConnectWebhook(body))
      } catch (error) {
        return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400)
      }
    })
    this.app.get('/api/integrations/feishu/route', (c) => c.json(this.getFeishuRouteSummary()))
    this.app.get('/api/integrations/feishu/routes', (c) => c.json(this.getFeishuRouteSummaries()))
    this.app.put('/api/integrations/feishu/route', async (c) => {
      const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}))
      const result = this.saveFeishuRouteConfig(body)
      if (result.ok) this.invalidateDashboardReportCaches()
      return c.json(result, result.ok ? 200 : 400)
    })
    this.app.get('/api/integrations/knowledge/tencent-ima', (c) => c.json(this.getTencentImaKnowledgeProviderConfig()))
    this.app.put('/api/integrations/knowledge/tencent-ima', async (c) => {
      const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}))
      const result = this.saveTencentImaKnowledgeProviderConfig(body)
      if (result.ok) this.invalidateDashboardReportCaches()
      return c.json(result, result.ok ? 200 : 400)
    })
    this.app.post('/api/integrations/feishu/actions/:action', (c) => {
      return c.json(this.runFeishuIntegrationAction(c.req.param('action')))
    })
    this.app.post('/api/integrations/feishu/auth/start', (c) => {
      return c.json(this.startFeishuAuthLogin())
    })
    this.app.post('/api/integrations/feishu/config/start', (c) => {
      return c.json(this.startFeishuConfigInit())
    })

    this.app.get('/api/agent-control', (c) => c.json(this.getAgentControlReport()))
    this.app.get('/api/agent-control/transcripts', (c) => c.json(
      this.getAgentControlPlane().searchTranscripts({
        query: c.req.query('query'),
        sessionId: c.req.query('sessionId'),
        status: c.req.query('status'),
        limit: c.req.query('limit'),
      }) satisfies AgentControlTranscriptSearchReport,
    ))
    this.app.put('/api/agent-control/sessions/:sessionId', async (c) => {
      const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}))
      try {
        const session = this.getAgentControlPlane().saveSession(c.req.param('sessionId'), body)
        this.invalidateDashboardReportCaches()
        return c.json({
          ok: true,
          session,
        } satisfies { ok: true; session: AgentControlSessionSummary })
      } catch (error) {
        return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400)
      }
    })
    this.app.get('/api/agent-control/sessions/:sessionId/transcript', (c) => c.json(
      this.getAgentControlPlane().getTranscript(c.req.param('sessionId'), {
        query: c.req.query('query'),
        status: c.req.query('status'),
        limit: c.req.query('limit'),
      }) satisfies AgentControlTranscriptReport,
    ))
    this.app.post('/api/agent-control/sessions/:sessionId/summary', (c) => {
      try {
        return c.json({
          ok: true,
          summary: this.getAgentControlPlane().createSessionSummary(c.req.param('sessionId')),
        } satisfies { ok: true; summary: AgentControlConversationSummary })
      } catch (error) {
        return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400)
      }
    })
    this.app.post('/api/agent-control/sessions/:sessionId/messages', async (c) => {
      const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}))
      try {
        const message = this.getAgentControlPlane().sendMessage(c.req.param('sessionId'), body)
        this.invalidateDashboardReportCaches()
        return c.json({
          ok: true,
          message,
        } satisfies { ok: true; message: AgentControlMessageRecord })
      } catch (error) {
        return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400)
      }
    })
    this.app.post('/api/agent-control/sessions/:sessionId/messages/:messageId/claim', async (c) => {
      const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}))
      try {
        const message = this.getAgentControlPlane().claimMessage(c.req.param('sessionId'), c.req.param('messageId'), body)
        this.invalidateDashboardReportCaches()
        return c.json({
          ok: true,
          message,
        } satisfies { ok: true; message: AgentControlMessageRecord })
      } catch (error) {
        return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400)
      }
    })
    this.app.post('/api/agent-control/sessions/:sessionId/messages/:messageId/complete', async (c) => {
      const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}))
      try {
        const result = this.getAgentControlPlane().completeMessage(c.req.param('sessionId'), c.req.param('messageId'), body)
        this.invalidateDashboardReportCaches()
        return c.json({
          ok: true,
          ...result,
        })
      } catch (error) {
        return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400)
      }
    })
    this.app.get('/api/agent-control/sessions/:sessionId/inbox', (c) => c.json({
      sessionId: c.req.param('sessionId'),
      messages: this.getAgentControlPlane().getInbox(c.req.param('sessionId'), {
        includeClaimed: c.req.query('includeClaimed') === 'true' || c.req.query('includeClaimed') === '1',
      }),
    }))
    this.app.post('/api/agent-control/sessions/:sessionId/replies', async (c) => {
      const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}))
      try {
        const message = this.getAgentControlPlane().postReply(c.req.param('sessionId'), body)
        this.invalidateDashboardReportCaches()
        return c.json({
          ok: true,
          message,
        } satisfies { ok: true; message: AgentControlMessageRecord })
      } catch (error) {
        return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400)
      }
    })

    this.app.get('/api/prompts', (c) => c.json(this.getPromptStudioReport()))
    this.app.post('/api/prompts/optimize', async (c) => {
      const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}))
      const rawPrompt = String(body.rawPrompt ?? body.input ?? body.prompt ?? '').trim()
      if (!rawPrompt) return c.json({ error: 'Prompt input is required.' }, 400)

      try {
        const result = optimizeCodingPrompt({
          rawPrompt,
          title: typeof body.title === 'string' ? body.title : undefined,
          language: normalizeDashboardPromptLanguage(body.language),
          level: typeof body.level === 'string' ? body.level : undefined,
          files: toStringArray(body.files),
          services: toStringArray(body.services ?? body.service),
          successCriteria: toStringArray(body.successCriteria ?? body['success-criteria']),
        })
        return c.json({
          project: this.currentProject,
          generatedAt: Date.now(),
          result,
        } satisfies DashboardPromptOptimizationReport)
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
      }
    })

    const serveAgentPlan = async (c: Context, body: Record<string, unknown>) => {
      const task = String(body.task ?? body.scenario ?? '').trim()
      if (!task) return c.json({ error: 'Task is required.' }, 400)
      try {
        return c.json(await this.createDashboardAgentPlanReport({ ...body, task }))
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
      }
    }

    this.app.get('/api/agent/plan', async (c) => serveAgentPlan(c, {
      task: c.req.query('task') ?? c.req.query('scenario') ?? '',
      taskId: c.req.query('taskId'),
      level: c.req.query('level'),
      files: c.req.query('files'),
      services: c.req.query('services') ?? c.req.query('service'),
      budget: c.req.query('budget'),
    }))

    this.app.post('/api/agent/plan', async (c) => {
      const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}))
      return serveAgentPlan(c, body)
    })

    // Available FSM actions for artifact
    this.app.get('/api/artifacts/:id/actions', async (c) => {
      if (!this.fsm) return c.json({ error: 'FSM not available' }, 503)
      try {
        const actions = await this.fsm.availableActions(c.req.param('id'))
        return c.json({ id: c.req.param('id'), actions })
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
      }
    })
  }

  // ── SSE (Server-Sent Events) ─────────────────────────────────────────

  private setupSSE(): void {
    this.app.get('/api/stream', (c) => {
      return streamSSE(c, async (stream) => {
        // Send initial state
        const state = await this.getDashboardState()
        await stream.writeSSE({ data: JSON.stringify({ type: 'init', state }), event: 'init' })

        // Subscribe to EventBus for real-time updates
        let alive = true
        const heartbeat = setInterval(async () => {
          if (!alive) return
          try {
            await stream.writeSSE({ data: '{}', event: 'heartbeat' })
          } catch {
            alive = false
          }
        }, 30000)

        // Listen for events
        const unsub = this.bus?.on('*', async (event) => {
          if (!alive) return
          try {
            await stream.writeSSE({
              data: JSON.stringify({
                type: 'event',
                event: {
                  type: event.type,
                  timestamp: event.timestamp,
                  artifactId: event.artifactId,
                },
              }),
              event: 'event',
            })
          } catch {
            alive = false
          }
        })

        // Wait until client disconnects
        stream.onAbort(() => {
          alive = false
          clearInterval(heartbeat)
          unsub?.unsubscribe()
        })

        // Keep alive
        while (alive) {
          await new Promise(r => setTimeout(r, 1000))
        }
      })
    })
  }

  // ── Write Operations ─────────────────────────────────────────────────

  private setupWriteOps(): void {
    this.app.put('/api/documents/*', async (c) => {
      const docPath = c.req.path.replace('/api/documents/', '')
      const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}))
      if (typeof body.content !== 'string') return c.json({ error: 'Missing required field: content' }, 400)

      const result = this.writeDashboardDocument(docPath, body.content)
      if (!result.ok) return c.json({ error: result.error }, result.status)
      const evidence = this.recordDashboardDocumentEvidence('edit', result.document)
      return c.json({ success: true, document: result.document, evidence })
    })

    this.app.post('/api/knowledge-base/documents/import', async (c) => {
      const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}))
      const name = typeof body.name === 'string' ? body.name : ''
      const content = typeof body.content === 'string' ? body.content : ''
      const type = typeof body.type === 'string' ? body.type : undefined
      if (!content.trim()) return c.json({ error: 'Missing required field: content' }, 400)

      const result = this.importKnowledgeDocument({ name, content, type })
      if (!result.ok) return c.json({ error: result.error }, result.status)
      const evidence = this.recordDashboardDocumentEvidence('knowledge-import', result.document)
      return c.json({ success: true, document: result.document, evidence })
    })

    // Artifact transition
    this.app.post('/api/artifacts/:id/transition', async (c) => {
      if (!this.fsm || !this.store) return c.json({ error: 'FSM or store not available' }, 503)
      const id = c.req.param('id')
      const body = await c.req.json<{ action: string; reason?: string }>()
      if (!body.action) return c.json({ error: 'Missing required field: action' }, 400)

      try {
        const artifact = await this.store.get(id)
        if (!artifact) return c.json({ error: `Artifact not found: ${id}` }, 404)

        const available = await this.fsm.availableActions(id)
        if (!available.includes(body.action)) {
          return c.json({
            error: `Action "${body.action}" not available for ${artifact.type} in state "${artifact.status}"`,
            availableActions: available,
          }, 400)
        }

        const result = await this.fsm.transition(id, body.action, {
          actor: { kind: 'system', component: 'dashboard' },
          reason: body.reason ?? `Dashboard transition: ${body.action}`,
        })

        if (!result.success) return c.json({ error: 'Transition blocked', blockedBy: result.blockedBy }, 422)
        return c.json({ success: true, artifact: result.artifact, effectsExecuted: result.effectsExecuted })
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
      }
    })

    // Lesson approve
    this.app.post('/api/lessons/:id/approve', async (c) => {
      if (!this.fsm || !this.store) return c.json({ error: 'FSM or store not available' }, 503)
      const id = c.req.param('id')
      try {
        const artifact = await this.store.get(id)
        if (!artifact || artifact.type !== 'Lesson') return c.json({ error: `Lesson not found: ${id}` }, 404)
        if (artifact.status !== 'PROPOSED') return c.json({ error: `Lesson is "${artifact.status}", can only approve from PROPOSED` }, 400)
        const body: { reason?: string } = await c.req.json<{ reason?: string }>().catch(() => ({}))
        const result = await this.fsm.transition(id, 'review', {
          actor: { kind: 'system', component: 'dashboard' },
          reason: body.reason ?? 'Approved via dashboard',
        })
        if (!result.success) return c.json({ error: 'Transition blocked', blockedBy: result.blockedBy }, 422)
        return c.json({ success: true, artifact: result.artifact })
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
      }
    })

    // Lesson reject
    this.app.post('/api/lessons/:id/reject', async (c) => {
      if (!this.fsm || !this.store) return c.json({ error: 'FSM or store not available' }, 503)
      const id = c.req.param('id')
      try {
        const artifact = await this.store.get(id)
        if (!artifact || artifact.type !== 'Lesson') return c.json({ error: `Lesson not found: ${id}` }, 404)
        if (artifact.status !== 'PROPOSED') return c.json({ error: `Lesson is "${artifact.status}", can only reject from PROPOSED` }, 400)
        const body: { reason?: string } = await c.req.json<{ reason?: string }>().catch(() => ({}))
        const result = await this.fsm.transition(id, 'reject', {
          actor: { kind: 'system', component: 'dashboard' },
          reason: body.reason ?? 'Rejected via dashboard',
        })
        if (!result.success) return c.json({ error: 'Transition blocked', blockedBy: result.blockedBy }, 422)
        return c.json({ success: true, artifact: result.artifact })
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
      }
    })

    this.app.post('/api/knowledge/local/:id/review', async (c) => {
      const id = c.req.param('id')
      const body: { action?: string; reason?: string } = await c.req.json<{ action?: string; reason?: string }>().catch(() => ({}))
      const action = normalizeMemoryReviewAction(body.action)
      if (!action) {
        return c.json({
          error: 'Invalid memory review action',
          allowedActions: MEMORY_REVIEW_ACTIONS,
        }, 400)
      }

      let brain: MemoryBrain | null = null
      try {
        brain = new MemoryBrain({ projectDir: this.projectDir, scaleDir: this.scaleDir })
        const report = brain.review(id, action, {
          reason: body.reason ?? `Dashboard memory review: ${action}`,
          actor: 'dashboard',
        })
        if (!report.ok || !report.node) {
          return c.json({
            error: report.warnings[0] ?? 'Memory review transition blocked',
            warnings: report.warnings,
            action,
            previousStatus: report.previousStatus,
            node: report.node,
          }, report.node ? 422 : 404)
        }

        const evidence = this.recordMemoryReviewEvidence({
          action,
          node: report.node,
          previousStatus: report.previousStatus,
          reason: body.reason,
        })
        return c.json({
          success: true,
          action,
          previousStatus: report.previousStatus,
          node: report.node,
          warnings: report.warnings,
          evidence,
        })
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
      } finally {
        brain?.close()
      }
    })
  }

  // ── Data Collection ──────────────────────────────────────────────────

  private recordMemoryReviewEvidence(input: {
    action: MemoryReviewAction
    node: MemoryNode
    previousStatus?: string
    reason?: string
  }): RuntimeEvidenceRecord {
    const ledger = new RuntimeEvidenceLedger({
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
    })
    return ledger.record({
      taskId: 'dashboard-memory-review',
      kind: 'manual',
      status: 'passed',
      title: `Dashboard memory review: ${input.action} ${input.node.id}`,
      summary: `Memory node ${input.node.id} transitioned from ${input.previousStatus ?? 'unknown'} to ${input.node.status}.`,
      artifacts: ['.scale/memory/brain.sqlite', ...input.node.evidencePaths],
      metadata: {
        action: input.action,
        nodeId: input.node.id,
        previousStatus: input.previousStatus,
        nextStatus: input.node.status,
        reason: input.reason,
        source: 'dashboard',
        resolutionKey: `memory-review:${input.node.id}`,
      },
    })
  }

  private recordDashboardDocumentEvidence(
    action: 'edit' | 'knowledge-import',
    document: DashboardDocumentSummary,
  ): RuntimeEvidenceRecord {
    const ledger = new RuntimeEvidenceLedger({
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
    })
    return ledger.record({
      taskId: 'dashboard-document-maintenance',
      kind: 'manual',
      status: 'passed',
      title: `Dashboard ${action}: ${document.path}`,
      summary: `Dashboard ${action} wrote ${document.path}.`,
      artifacts: [document.path],
      metadata: {
        action,
        path: document.path,
        source: 'dashboard',
        resolutionKey: `dashboard-document:${document.path}`,
      },
    })
  }

  async getDashboardState(): Promise<DashboardState> {
    const [artifacts, evolutionMetrics, detectorStats, autoDefectStats, recentEvents] = await Promise.all([
      this.getArtifactTree(),
      this.getEvolutionMetrics(),
      Promise.resolve(this.getDetectorStats()),
      this.getAutoDefectStats(),
      this.getRecentEvents(20),
    ])
    return { artifacts, evolutionMetrics, detectorStats, autoDefectStats, recentEvents, timestamp: Date.now() }
  }

  async getArtifactTree(): Promise<ArtifactTreeNode[]> {
    if (!this.store) return []
    const artifacts = await this.store.query({})
    const byId = new Map<string, ArtifactTreeNode>()

    for (const a of artifacts) {
      byId.set(a.id, {
        id: a.id, type: a.type, title: a.title, status: a.status, version: a.version, children: [],
        gates: a.gates?.map((g: Gate) => ({ name: g.name, required: g.required, passed: g.passed })),
      })
    }

    for (const a of artifacts) {
      if (a.parents?.length) {
        for (const pid of a.parents) {
          const parent = byId.get(pid)
          const child = byId.get(a.id)
          if (parent && child) parent.children.push(child)
        }
      }
    }

    return artifacts
      .filter(a => !a.parents?.length)
      .map(a => byId.get(a.id)!)
      .filter(Boolean)
  }

  async getEvolutionMetrics(): Promise<EvolutionMetrics | null> {
    return this.evaluator?.evaluate() ?? null
  }

  getDetectorStats(): DetectorStatSummary[] {
    if (!this.detectorTracker) return []
    return this.detectorTracker.getAllStats().map(s => ({
      name: s.detectorName,
      totalTriggers: s.totalTriggers,
      bySeverity: s.bySeverity,
      lastTrigger: s.recentTriggers.length > 0 ? s.recentTriggers[s.recentTriggers.length - 1]?.triggeredAt : undefined,
    }))
  }

  async getAutoDefectStats(): Promise<AutoDefectSummary | null> {
    if (!this.store) return null
    const defects = await this.store.query({ type: 'Defect' })
    const autoCreated = defects.filter(d => (d.payload as Record<string, unknown>)?.autoCreated === true)

    const byRootCause: Record<string, number> = {}
    const bySeverity: Record<string, number> = {}
    for (const d of autoCreated) {
      const p = d.payload as Record<string, unknown>
      byRootCause[(p.rootCauseCategory as string) ?? 'unknown'] = (byRootCause[(p.rootCauseCategory as string) ?? 'unknown'] ?? 0) + 1
      bySeverity[(p.severity as string) ?? 'unknown'] = (bySeverity[(p.severity as string) ?? 'unknown'] ?? 0) + 1
    }

    const recentDefects: RecentDefect[] = autoCreated.slice(-10).reverse().map(d => {
      const p = d.payload as Record<string, unknown>
      return {
        id: d.id, title: d.title,
        rootCause: (p.rootCauseCategory as string) ?? 'unknown',
        severity: (p.severity as string) ?? 'unknown',
        detector: (p.detector as string) ?? 'unknown',
        createdAt: d.createdAt ?? (p.timestamp as number ?? 0),
      }
    })

    return { totalDefects: defects.length, autoCreatedCount: autoCreated.length, byRootCause, bySeverity, recentDefects }
  }

  async getRecentEvents(limit: number): Promise<RecentEvent[]> {
    if (!this.bus) return []
    const events = await this.bus.query({ limit })
    return events.map(e => ({
      type: e.type, timestamp: e.timestamp, artifactId: e.artifactId,
      data: e.payload as Record<string, unknown>,
    }))
  }

  getTopology(): TopologyGraph {
    const raw = dumpCodeGraphData({ projectDir: this.projectDir })
    return classifyLayers(raw)
  }

  private getProjectsSummary(sinceDays: number, limit: number): DashboardProjectsSummaryReport {
    const projects = this.projects.slice(0, limit).map(project => this.getProjectOverview(project, sinceDays))
    const warnings = projects.flatMap(project => project.warnings.map(warning => `${project.project.name}: ${warning}`))
    return {
      generatedAt: Date.now(),
      sinceDays,
      currentProjectId: this.currentProject.id,
      totals: {
        projects: projects.length,
        readyProjects: projects.filter(project => project.health === 'ready').length,
        warningProjects: projects.filter(project => project.health === 'warning').length,
        missingProjects: projects.filter(project => project.health === 'missing').length,
        documents: sum(projects, project => project.documents.total),
        localMemoryNodes: sum(projects, project => project.knowledge.total),
        activeMemoryNodes: sum(projects, project => project.knowledge.active),
        commandRuns: sum(projects, project => project.metrics.commandRuns),
        failedCommandRuns: sum(projects, project => project.metrics.failedCommandRuns),
        gateFailures: sum(projects, project => project.metrics.gateFailures),
      },
      projects,
      warnings,
    }
  }

  private getProjectOverview(project: DashboardProjectSummary, sinceDays: number): DashboardProjectOverview {
    const warnings: string[] = []
    const scaleDirExists = existsSync(project.scaleDir)
    if (!scaleDirExists) warnings.push('.scale directory is missing')
    const documents = this.listDocumentsFor(project.projectDir, project.scaleDir)
    const knowledge = this.getLocalKnowledgeSummary(project, warnings)
    const metrics = this.getGovernanceMetricSummary(project, sinceDays, warnings)
    const health: DashboardProjectOverview['health'] = !scaleDirExists
      ? 'missing'
      : warnings.length > 0
        ? 'warning'
        : 'ready'

    return {
      project,
      health,
      scaleDirExists,
      documents: {
        total: documents.length,
        byType: countBy(documents, document => document.type),
      },
      knowledge,
      metrics,
      warnings,
    }
  }

  private getDashboardServiceStatus() {
    const now = Date.now()
    if (this.dashboardServiceStatusCache && this.dashboardServiceStatusCache.expiresAt > now) {
      return this.dashboardServiceStatusCache.value
    }
    const value = readDashboardServiceStatus({
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
      host: '127.0.0.1',
      port: this.port,
    })
    this.dashboardServiceStatusCache = {
      expiresAt: now + DASHBOARD_SERVICE_STATUS_CACHE_TTL_MS,
      value,
    }
    return value
  }

  private invalidateDashboardReportCaches(): void {
    this.dashboardServiceStatusCache = null
    this.agentControlReportCache = null
    this.integrationsReportCache = null
    this.dashboardCapabilityReportCache = null
  }

  private runDashboardServiceAction(action: string) {
    const options = {
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
      host: '127.0.0.1',
      port: this.port,
    }
    if (action === 'ensure') {
      return { ok: true, action, service: ensureDashboardService(options) }
    }
    if (action === 'start') {
      return { ok: true, action, service: startDashboardService(options) }
    }
    if (action === 'restart') {
      return { ok: true, action, service: restartDashboardService(options) }
    }
    throw new Error(`Unsupported dashboard service action: ${action}`)
  }

  private getDashboardCapabilityReport(): DashboardCapabilityReport {
    const now = Date.now()
    if (this.dashboardCapabilityReportCache && this.dashboardCapabilityReportCache.expiresAt > now) {
      return this.dashboardCapabilityReportCache.value
    }
    const warnings: string[] = []
    let metrics: ReturnType<typeof aggregateGovernanceMetrics> | null = null
    try {
      metrics = aggregateGovernanceMetrics({
        projectDir: this.projectDir,
        scaleDir: this.scaleDir,
        sinceDays: 7,
      })
    } catch (error) {
      warnings.push(`metrics aggregation failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    const scaleDirExists = existsSync(this.scaleDir)
    const documents = this.listDocuments()
    const memoryDb = join(this.scaleDir, 'memory', 'brain.sqlite')
    const modelUsageFile = join(this.scaleDir, 'model-usage', 'usage.jsonl')
    const runtimeEvidenceDir = join(this.scaleDir, 'evidence', 'runtime')
    const commandRunsDir = join(this.scaleDir, 'evidence', 'command-runs')
    const aiOsRunsDir = join(this.scaleDir, 'ai-os', 'runs')
    const promptReport = this.getPromptStudioReport()
    const knowledgeBaseSummary = this.getKnowledgeBaseCapabilitySummary(documents)
    const integrationsReport = this.getIntegrationsReport()
    const agentControlReport = this.getAgentControlReport()
    const dashboardService = this.getDashboardServiceStatus()
    const feishuProvider = integrationsReport.providers.find(provider => provider.id === 'feishu')
    const connectorWorkflow = integrationsReport.connectorWorkflow
    const runtimeEvidenceCount = countMatchingFiles(runtimeEvidenceDir, file => file.endsWith('.json'))
    const commandRunCount = metrics?.commandRuns.total ?? countMatchingFiles(commandRunsDir, file => file.endsWith('.json'))
    const agentCollaborationRuns = inspectAiOsAgentCollaborationReports(aiOsRunsDir)
    const modelUsageCount = metrics?.modelUsage.totalRecords ?? 0
    const memoryCount = this.getLocalKnowledgeSummary(this.currentProject, warnings).total
    const busAvailable = Boolean(this.bus)
    const artifactTransitions = Boolean(this.fsm && this.store)
    const dataSources: DashboardDataSourceSignal[] = [
      {
        id: 'project-scale-dir',
        title: 'Project .scale state',
        description: 'Workspace governance state and local evidence root.',
        status: scaleDirExists ? 'ready' : 'missing',
        refreshMode: 'snapshot',
        source: this.scaleDir,
        count: scaleDirExists ? 1 : 0,
        lastUpdated: latestMtime(this.scaleDir),
        emptyReason: scaleDirExists ? undefined : 'The project has no .scale directory yet.',
        action: scaleDirExists ? undefined : 'Run scale bootstrap or initialize the workflow in this project.',
      },
      {
        id: 'dashboard-service',
        title: 'Dashboard service watchdog',
        description: 'Resident dashboard supervisor, health checks, PID files, restart count, and logs.',
        status: dashboardService.supervisorAlive ? 'ready' : dashboardService.serverAlive ? 'partial' : 'missing',
        refreshMode: 'polling',
        source: dashboardService.serviceDir,
        count: dashboardService.restartCount,
        lastUpdated: dashboardService.lastHeartbeatAt,
        emptyReason: dashboardService.supervisorAlive
          ? undefined
          : dashboardService.serverAlive
            ? 'Dashboard server is running without the resident watchdog.'
            : 'Dashboard resident service is not running.',
        action: dashboardService.supervisorAlive ? undefined : 'Run scale dashboard daemon ensure --dir .',
      },
      {
        id: 'runtime-evidence',
        title: 'Runtime evidence ledger',
        description: 'Pass/fail/resolved records produced by governed workflow runs.',
        status: runtimeEvidenceCount > 0 ? 'ready' : 'missing',
        refreshMode: 'polling',
        source: runtimeEvidenceDir,
        count: runtimeEvidenceCount,
        lastUpdated: latestMtime(runtimeEvidenceDir),
        emptyReason: runtimeEvidenceCount > 0 ? undefined : 'No runtime evidence JSON files were found.',
        action: runtimeEvidenceCount > 0 ? undefined : 'Run a governed verify/preflight command that records runtime evidence.',
      },
      {
        id: 'command-runs',
        title: 'Command run evidence',
        description: 'Recorded shell/tool executions, pass rate, and output compression savings.',
        status: commandRunCount > 0 ? 'ready' : 'missing',
        refreshMode: 'polling',
        source: commandRunsDir,
        count: commandRunCount,
        lastUpdated: latestMtime(commandRunsDir),
        emptyReason: commandRunCount > 0 ? undefined : 'No command-run evidence files were found.',
        action: commandRunCount > 0 ? undefined : 'Run commands through the governed runtime or preflight pipeline.',
      },
      {
        id: 'model-usage',
        title: 'Model usage ledger',
        description: 'Actual model token usage and cache savings from scale token record/report.',
        status: modelUsageCount > 0 ? 'ready' : 'missing',
        refreshMode: 'polling',
        source: modelUsageFile,
        count: modelUsageCount,
        lastUpdated: latestMtime(modelUsageFile),
        emptyReason: modelUsageCount > 0 ? undefined : 'No model usage ledger is present, so token/cost charts are empty.',
        action: modelUsageCount > 0 ? undefined : 'Record provider usage with scale token record, then refresh the dashboard.',
      },
      {
        id: 'memory-brain',
        title: 'gbrain memory',
        description: 'Local gbrain memory nodes used by the knowledge page.',
        status: existsSync(memoryDb) ? (memoryCount > 0 ? 'ready' : 'partial') : 'missing',
        refreshMode: 'polling',
        source: memoryDb,
        count: memoryCount,
        lastUpdated: latestMtime(memoryDb),
        emptyReason: existsSync(memoryDb) ? (memoryCount > 0 ? undefined : 'The memory database exists but has no nodes.') : 'No local gbrain database exists.',
        action: memoryCount > 0 ? undefined : 'Capture or approve project memory through the memory workflow.',
      },
      {
        id: 'knowledge-base',
        title: 'Knowledge base',
        description: 'Repo-native knowledge documents, SQLite knowledge entries, Karpathy guidance, and Graphify knowledge graph.',
        status: knowledgeBaseSummary.documents + knowledgeBaseSummary.entries + knowledgeBaseSummary.graphNodes > 0 ? 'ready' : 'missing',
        refreshMode: 'polling',
        source: `${join(this.scaleDir, 'knowledge.db')} + ${join(this.projectDir, 'graphify-out')} + knowledge docs`,
        count: knowledgeBaseSummary.documents + knowledgeBaseSummary.entries,
        lastUpdated: knowledgeBaseSummary.lastUpdated
          ?? latestMtime(join(this.scaleDir, 'knowledge.db'))
          ?? latestMtime(join(this.projectDir, 'graphify-out')),
        emptyReason: knowledgeBaseSummary.documents + knowledgeBaseSummary.entries + knowledgeBaseSummary.graphNodes > 0
          ? undefined
          : 'No knowledge docs, knowledge.db entries, or Graphify graph were found.',
        action: knowledgeBaseSummary.documents + knowledgeBaseSummary.entries + knowledgeBaseSummary.graphNodes > 0
          ? undefined
          : 'Add knowledge docs, run the knowledge ingestion flow, or generate graphify-out/graph.json.',
      },
      {
        id: 'documents',
        title: 'Documents and prototypes',
        description: 'Markdown, JSON, and HTML artifacts available for preview, copy, and download.',
        status: documents.length > 0 ? 'ready' : 'missing',
        refreshMode: 'polling',
        source: `${this.projectDir}/docs + ${this.scaleDir}/docs + ${this.scaleDir}/artifacts + knowledge graph entry docs`,
        count: documents.length,
        lastUpdated: latestMtimeForDocuments(documents, this.projectDir, this.scaleDir),
        emptyReason: documents.length > 0 ? undefined : 'No previewable docs or HTML prototypes were found.',
        action: documents.length > 0 ? undefined : 'Generate or add docs/artifacts under docs, .scale/docs, or .scale/artifacts.',
      },
      {
        id: 'prompt-studio',
        title: 'Prompt Studio',
        description: 'Built-in vibe coding templates, prompt packs, and optimizer API.',
        status: promptReport.summary.vibeTemplates + promptReport.summary.phasePrompts > 0 ? 'ready' : 'missing',
        refreshMode: 'snapshot',
        source: 'src/prompts + .scale/prompts',
        count: promptReport.summary.vibeTemplates + promptReport.summary.phasePrompts + promptReport.summary.packs,
        emptyReason: promptReport.summary.vibeTemplates + promptReport.summary.phasePrompts > 0 ? undefined : 'No prompt templates were discovered.',
        action: promptReport.summary.vibeTemplates + promptReport.summary.phasePrompts > 0 ? undefined : 'Add project prompts under .scale/prompts or use built-in templates.',
      },
      {
        id: 'agent-collaboration',
        title: 'Agent collaboration plans',
        description: 'Machine-readable AI OS agent role selection, DAG handoffs, review gates, token budgets, and guarded execution settlement.',
        status: agentCollaborationRuns.settledAgentExecution > 0 ? 'ready' : agentCollaborationRuns.withAgentCollaboration > 0 ? 'partial' : agentCollaborationRuns.totalReports > 0 ? 'partial' : 'missing',
        refreshMode: 'polling',
        source: aiOsRunsDir,
        count: agentCollaborationRuns.withAgentCollaboration,
        lastUpdated: agentCollaborationRuns.lastUpdated,
        emptyReason: agentCollaborationRuns.settledAgentExecution > 0
          ? undefined
          : agentCollaborationRuns.withAgentCollaboration > 0
            ? `${agentCollaborationRuns.withAgentCollaboration} AI OS run report(s) include agentCollaboration, but none have settled agentExecution evidence yet.`
            : agentCollaborationRuns.totalReports > 0
            ? 'AI OS run reports exist, but none include agentCollaboration yet. Re-run scale ai-os plan/run with the current runtime.'
            : 'No AI OS run reports with agent collaboration plans were found.',
        action: agentCollaborationRuns.settledAgentExecution > 0
          ? undefined
          : agentCollaborationRuns.withAgentCollaboration > 0
            ? 'Run scale ai-os run --mode guarded --verify "<command>" --task "<task>" --json to settle agent execution evidence.'
            : 'Run scale agent plan --task "<task>" --json or scale ai-os run --dry-run --task "<task>" --json.',
      },
      {
        id: 'agent-control-plane',
        title: 'Agent control plane',
        description: 'Dashboard-managed agent sessions, model selection, channel routing, message queue, and agent reply inbox.',
        status: agentControlReport.summary.ready > 0 ? 'ready' : agentControlReport.summary.sessions > 0 ? 'partial' : 'missing',
        refreshMode: 'polling',
        source: `${join(this.scaleDir, 'agents', 'control-plane.json')} + ${join(this.scaleDir, 'agents', 'messages')}`,
        count: agentControlReport.summary.sessions,
        lastUpdated: latestMtime(join(this.scaleDir, 'agents')),
        emptyReason: agentControlReport.summary.ready > 0 ? undefined : agentControlReport.warnings[0] ?? 'No ready agent control session is configured.',
        action: agentControlReport.summary.ready > 0 ? undefined : 'Open Agent Control and configure platform, model, and message route.',
      },
      {
        id: 'agent-connect-workflow',
        title: 'Agent connector workflow',
        description: 'cc-connect style channel catalog, Bridge protocol, management API, webhook, cron, heartbeat, and resident dashboard controls.',
        status: connectorWorkflow.config.configured ? 'ready' : connectorWorkflow.config.enabled ? 'partial' : 'missing',
        refreshMode: 'polling',
        source: connectorWorkflow.config.configPath,
        count: connectorWorkflow.summary.channels,
        lastUpdated: latestMtime(connectorWorkflow.config.configPath),
        emptyReason: connectorWorkflow.config.configured ? undefined : connectorWorkflow.warnings[0] ?? 'Agent connector workflow is not configured.',
        action: connectorWorkflow.config.configured ? undefined : 'Open Integrations and save the Agent Connect Bridge/Management configuration.',
      },
      {
        id: 'feishu-channel',
        title: 'Feishu/Lark message channel',
        description: 'lark-cli based mobile notifications, command intake, event streams, and online knowledge-channel setup.',
        status: feishuProvider?.status ?? 'missing',
        refreshMode: 'snapshot',
        source: feishuProvider?.commandPath ?? 'lark-cli + docs/guides/FEISHU_INTEGRATION.md',
        count: feishuProvider?.commandAvailable ? 1 : 0,
        lastUpdated: latestMtime(join(this.projectDir, 'docs', 'guides', 'FEISHU_INTEGRATION.md')),
        emptyReason: feishuProvider?.warnings[0],
        action: feishuProvider?.nextAction,
      },
      {
        id: 'event-stream',
        title: 'Realtime event stream',
        description: 'Server-sent events used to refresh live runtime changes.',
        status: busAvailable ? 'ready' : 'partial',
        refreshMode: busAvailable ? 'sse' : 'polling',
        source: '/api/stream',
        count: busAvailable ? 1 : 0,
        emptyReason: busAvailable ? undefined : 'The dashboard server is running heartbeat-only SSE because no runtime EventBus was injected.',
        action: busAvailable ? undefined : 'Start the dashboard from an embedded runtime or wire an EventBus into serve.',
      },
      {
        id: 'artifact-fsm',
        title: 'Workflow artifact transitions',
        description: 'Dashboard write path for artifact actions and lesson review transitions.',
        status: artifactTransitions ? 'ready' : 'partial',
        refreshMode: 'manual',
        source: '/api/artifacts/:id/actions + /api/artifacts/:id/transition',
        count: artifactTransitions ? 1 : 0,
        emptyReason: artifactTransitions ? undefined : 'The HTTP dashboard was started without artifact store/FSM injection.',
        action: artifactTransitions ? undefined : 'Wire the serve entrypoint to an artifact store and FSM before enabling dashboard transitions.',
      },
    ]
    const summary = summarizeDataSources(dataSources)
    const report: DashboardCapabilityReport = {
      project: this.currentProject,
      generatedAt: Date.now(),
      summary,
      realtime: {
        status: busAvailable ? 'ready' : 'partial',
        mode: busAvailable ? 'event-bus' : 'heartbeat-only',
        busAvailable,
        heartbeatOnly: !busAvailable,
        refreshIntervalMs: 30000,
      },
      writeOps: {
        artifactTransitions,
        memoryReview: existsSync(memoryDb),
        promptOptimization: true,
        documentEditing: true,
        knowledgeImport: true,
      },
      dataSources,
      warnings: [...warnings, ...knowledgeBaseSummary.warnings, ...promptReport.warnings, ...integrationsReport.warnings, ...agentControlReport.warnings],
    }
    this.dashboardCapabilityReportCache = {
      expiresAt: now + DASHBOARD_CAPABILITY_REPORT_CACHE_TTL_MS,
      value: report,
    }
    return report
  }

  private getIntegrationsReport(): DashboardIntegrationsReport {
    const now = Date.now()
    if (this.integrationsReportCache && this.integrationsReportCache.expiresAt > now) {
      return this.integrationsReportCache.value
    }
    const providers = [
      this.getFeishuIntegrationProvider(),
      this.getTencentImaKnowledgeProvider(),
    ]
    const connectorWorkflow = this.getConnectorWorkflowReport(providers)
    const agentOs = this.getAgentOsReadinessReport(providers, connectorWorkflow)
    const acceptance = this.getAgentOsAcceptanceReport()
    const warnings = [
      ...providers.flatMap(provider => provider.warnings.map(warning => `${provider.name}: ${warning}`)),
      ...connectorWorkflow.warnings.map(warning => `Agent Connect: ${warning}`),
      ...agentOs.stages.flatMap(stage => stage.blockers.map(blocker => `Agent OS ${stage.title}: ${blocker}`)),
      ...acceptance.warnings.map(warning => `Agent OS acceptance: ${warning}`),
    ]
    const report: DashboardIntegrationsReport = {
      project: this.currentProject,
      generatedAt: Date.now(),
      summary: {
        providers: providers.length,
        ready: providers.filter(provider => provider.status === 'ready').length,
        partial: providers.filter(provider => provider.status === 'partial').length,
        missing: providers.filter(provider => provider.status === 'missing').length,
      },
      providers,
      connectorWorkflow,
      agentOs,
      acceptance,
      warnings,
    }
    this.integrationsReportCache = {
      expiresAt: now + DASHBOARD_REPORT_CACHE_TTL_MS,
      value: report,
    }
    return report
  }

  private getAgentOsReadinessReport(
    providers: DashboardIntegrationProviderReport[],
    connectorWorkflow: DashboardConnectorWorkflowReport,
  ): DashboardAgentOsReadinessReport {
    const feishuProvider = providers.find(provider => provider.id === 'feishu')
    const imaProvider = providers.find(provider => provider.id === 'tencent-ima')
    const agentControl = this.getAgentControlReport()
    const dashboardService = this.getDashboardServiceStatus()
    const routeConfigs = feishuProvider?.routeConfigs ?? []
    const configuredRoutes = routeConfigs.filter(route => route.configured).length
    const requiredSkills = connectorWorkflow.skillPresets.filter(skill => skill.required)
    const defaultRequiredSkills = requiredSkills.filter(skill => skill.defaultInstall).length
    const enabledLoops = connectorWorkflow.automationLoops.filter(loop => loop.enabled).length
    const bridgeReady = connectorWorkflow.config.bridge.enabled && connectorWorkflow.config.bridge.hasToken
    const webhookReady = connectorWorkflow.config.webhook.enabled && connectorWorkflow.config.webhook.hasToken
    const managementReady = connectorWorkflow.config.managementApi.enabled && connectorWorkflow.config.managementApi.hasToken
    const readyAgentSession = agentControl.summary.ready > 0
    const hasAgentSession = agentControl.summary.sessions > 0
    const mobileControlReady = Boolean(feishuProvider?.status === 'ready' && configuredRoutes > 0)
    const remoteControlReady = Boolean(connectorWorkflow.config.configured && readyAgentSession && (bridgeReady || webhookReady || mobileControlReady))
    const knowledgeReady = Boolean(imaProvider?.knowledgeConfig?.configured)
    const daemonReady = dashboardService.supervisorAlive && dashboardService.serverAlive

    const stages: DashboardAgentOsReadinessStage[] = [
      {
        id: 'remote-control',
        title: 'Remote control plane',
        description: 'Management API, Bridge/Webhook, and at least one controllable agent session are ready.',
        status: remoteControlReady
          ? 'ready'
          : connectorWorkflow.config.enabled || hasAgentSession ? 'partial' : 'missing',
        score: remoteControlReady ? 100 : connectorWorkflow.config.enabled || hasAgentSession ? 45 : 0,
        tab: 'agent-connect',
        primaryAction: remoteControlReady ? 'Open Agent Control and send a guarded command.' : 'Enable Agent Connect and save management/bridge/webhook tokens.',
        evidence: [
          `management=${managementReady ? 'ready' : 'pending'}`,
          `bridge=${bridgeReady ? 'ready' : 'pending'}`,
          `webhook=${webhookReady ? 'ready' : 'pending'}`,
          `agentSessions=${agentControl.summary.sessions}`,
        ],
        blockers: [
          ...(!managementReady ? ['Management API token is missing or disabled.'] : []),
          ...(!bridgeReady && !webhookReady ? ['Bridge or webhook is not ready for remote message intake.'] : []),
          ...(!readyAgentSession ? ['No ready agent session is available for remote control.'] : []),
        ],
        commands: connectorWorkflow.commands.agentRuntime,
      },
      {
        id: 'mobile-message-channel',
        title: 'Mobile message channel',
        description: 'Feishu/Lark CLI and one project route bind mobile chat/user messages to an agent session.',
        status: mobileControlReady
          ? 'ready'
          : feishuProvider?.commandAvailable || configuredRoutes > 0 ? 'partial' : 'missing',
        score: mobileControlReady ? 100 : feishuProvider?.commandAvailable || configuredRoutes > 0 ? 45 : 0,
        tab: 'messages',
        primaryAction: mobileControlReady ? 'Run dry-run send and consume one event.' : 'Save a Feishu chat/user target for one agent platform.',
        evidence: [
          `larkCli=${feishuProvider?.commandAvailable ? 'visible' : 'missing'}`,
          `routes=${configuredRoutes}/${Math.max(routeConfigs.length, 1)}`,
          `command=${feishuProvider?.commandPath ?? feishuProvider?.command ?? 'lark-cli'}`,
        ],
        blockers: [
          ...(!feishuProvider?.commandAvailable ? ['lark-cli is not visible on PATH.'] : []),
          ...(configuredRoutes === 0 ? ['No Feishu chat/user route is configured.'] : []),
        ],
        commands: feishuProvider?.verifyCommands ?? ['lark-cli doctor'],
      },
      {
        id: 'agent-control-session',
        title: 'Agent session control',
        description: 'Dashboard chat, model routing, message queue, and transcript storage are available for at least one agent session.',
        status: readyAgentSession ? 'ready' : hasAgentSession ? 'partial' : 'missing',
        score: readyAgentSession ? 100 : hasAgentSession ? 45 : 0,
        tab: 'overview',
        primaryAction: readyAgentSession ? 'Open the Agent Control page and send a dashboard message.' : 'Configure one installed agent platform and model.',
        evidence: [
          `sessions=${agentControl.summary.sessions}`,
          `ready=${agentControl.summary.ready}`,
          `queued=${agentControl.summary.queuedMessages}`,
          `failed=${agentControl.summary.failedMessages}`,
        ],
        blockers: [
          ...(!hasAgentSession ? ['No agent-control sessions exist.'] : []),
          ...(hasAgentSession && !readyAgentSession ? ['Existing agent sessions are partial or missing runtime dependencies.'] : []),
        ],
        commands: ['GET /api/agent-control', 'POST /api/agent-control/messages'],
      },
      {
        id: 'knowledge-memory',
        title: 'Memory and knowledge',
        description: 'Default memory skills are declared, and an online knowledge provider can be bound per project.',
        status: knowledgeReady ? 'ready' : defaultRequiredSkills > 0 ? 'partial' : 'missing',
        score: knowledgeReady ? 100 : defaultRequiredSkills > 0 ? 45 : 0,
        tab: 'knowledge',
        primaryAction: knowledgeReady ? 'Run provider recall verification before automatic import.' : 'Configure Tencent ima or keep gbrain-only memory as the default.',
        evidence: [
          `requiredSkills=${defaultRequiredSkills}/${Math.max(requiredSkills.length, 1)}`,
          `ima=${knowledgeReady ? 'configured' : 'pending'}`,
          `provider=${imaProvider?.id ?? 'tencent-ima'}`,
        ],
        blockers: knowledgeReady ? [] : ['Online knowledge provider is not configured; local memory can still work after setup verify.'],
        commands: ['scale setup --verify --pack full --json', 'scale memory provider status --json'],
      },
      {
        id: 'loop-automation',
        title: 'Loop automation',
        description: 'Hooks, heartbeat, long-task notifications, and the dashboard watchdog keep remote work from stalling.',
        status: daemonReady && enabledLoops >= 2 ? 'ready' : dashboardService.supervisorAlive || enabledLoops > 0 ? 'partial' : 'missing',
        score: daemonReady && enabledLoops >= 2 ? 100 : dashboardService.supervisorAlive || enabledLoops > 0 ? 45 : 0,
        tab: 'automation',
        primaryAction: daemonReady && enabledLoops >= 2 ? 'Review recent hook events and notification routes.' : 'Ensure dashboard daemon and enable heartbeat/notification loops.',
        evidence: [
          `daemon=${dashboardService.status}`,
          `supervisor=${dashboardService.supervisorAlive ? 'alive' : 'down'}`,
          `server=${dashboardService.serverAlive ? 'alive' : 'down'}`,
          `enabledLoops=${enabledLoops}/${connectorWorkflow.automationLoops.length}`,
        ],
        blockers: [
          ...(!dashboardService.supervisorAlive ? ['Dashboard daemon supervisor is not alive.'] : []),
          ...(!dashboardService.serverAlive ? ['Dashboard server is not alive.'] : []),
          ...(enabledLoops < 2 ? ['Heartbeat and notification loops are not fully enabled.'] : []),
        ],
        commands: connectorWorkflow.daemon.commands,
      },
      {
        id: 'diagnostic-acceptance',
        title: 'Diagnostic acceptance',
        description: 'Install, doctor, dry-run, event consume, and setup verify commands are available before claiming readiness.',
        status: feishuProvider?.commandAvailable && connectorWorkflow.commands.verify.length > 0 ? 'partial' : 'missing',
        score: feishuProvider?.commandAvailable && connectorWorkflow.commands.verify.length > 0 ? 45 : 0,
        tab: 'diagnostics',
        primaryAction: 'Run setup verify, lark-cli doctor, one dry-run send, and one event consume.',
        evidence: [
          `verifyCommands=${connectorWorkflow.commands.verify.length}`,
          `larkCli=${feishuProvider?.commandAvailable ? 'visible' : 'missing'}`,
        ],
        blockers: ['Acceptance commands must be run in the target operator machine before live remote control is enabled.'],
        commands: connectorWorkflow.commands.verify,
      },
    ]

    const points = stages.reduce((total, stage) => total + stage.score, 0)
    const score = Math.round(points / Math.max(stages.length, 1))
    const status: DashboardDataSourceStatus = score >= 80 ? 'ready' : score >= 35 ? 'partial' : 'missing'
    const primaryStage = stages.find(stage => stage.status !== 'ready') ?? stages[0]
    return {
      score,
      status,
      primaryAction: primaryStage?.primaryAction ?? 'Review Agent OS readiness.',
      summary: {
        ready: stages.filter(stage => stage.status === 'ready').length,
        partial: stages.filter(stage => stage.status === 'partial').length,
        missing: stages.filter(stage => stage.status === 'missing').length,
        error: stages.filter(stage => stage.status === 'error').length,
        remoteControlReady,
        mobileControlReady,
        knowledgeReady,
        daemonReady,
      },
      stages,
    }
  }

  private getAgentControlPlane(): AgentControlPlane {
    const routes = this.getFeishuRouteSummaries()
    return new AgentControlPlane(
      {
        id: this.currentProject.id,
        name: this.currentProject.name,
        projectDir: this.projectDir,
        scaleDir: this.scaleDir,
      },
      this.getAgentPlatformTargets(),
      routes.map(route => ({
        enabled: route.enabled,
        configured: route.configured,
        routeId: route.routeId,
        agentPlatformId: route.agentPlatformId,
        agentSessionId: route.agentSessionId,
        targetType: route.targetType,
        targetId: route.targetId,
        targetLabel: route.targetLabel,
        commandPrefix: route.commandPrefix,
      })),
    )
  }

  private getAgentControlReport(): AgentControlReport {
    const now = Date.now()
    if (this.agentControlReportCache && this.agentControlReportCache.expiresAt > now) {
      return this.agentControlReportCache.value
    }
    const report = this.getAgentControlPlane().getReport()
    this.agentControlReportCache = {
      expiresAt: now + DASHBOARD_REPORT_CACHE_TTL_MS,
      value: report,
    }
    return report
  }

  private getFeishuRouteConfigPath(): string {
    return join(this.scaleDir, 'integrations', 'feishu-channel.json')
  }

  private getTencentImaKnowledgeProviderConfigPath(): string {
    return join(this.scaleDir, 'integrations', 'tencent-ima-knowledge.json')
  }

  private getAgentConnectConfigPath(): string {
    return join(this.scaleDir, 'integrations', 'agent-connect.json')
  }

  private getAgentConnectConfig(): DashboardAgentConnectConfigSummary {
    const warnings: string[] = []
    const configPath = this.getAgentConnectConfigPath()
    let config = defaultAgentConnectConfig(this.currentProject, this.port)
    if (existsSync(configPath)) {
      try {
        config = normalizeAgentConnectConfig(
          JSON.parse(readFileSync(configPath, 'utf-8').replace(/^\uFEFF/, '')),
          this.currentProject,
          config,
        )
      } catch (error) {
        warnings.push(`Agent Connect config is unreadable: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return buildAgentConnectConfigSummary(config, configPath, warnings)
  }

  private saveAgentConnectConfig(input: Record<string, unknown>): DashboardAgentConnectUpdateResult {
    try {
      const previous = this.getAgentConnectConfig()
      const config = normalizeAgentConnectConfig(input, this.currentProject, previous)
      const configPath = this.getAgentConnectConfigPath()
      mkdirSync(dirname(configPath), { recursive: true })
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
      this.invalidateDashboardReportCaches()
      return {
        ok: true,
        saved: true,
        config: this.getAgentConnectConfig(),
      }
    } catch (error) {
      return {
        ok: false,
        saved: false,
        config: this.getAgentConnectConfig(),
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private bootstrapLocalAgentOs(): DashboardAgentOsBootstrapResult {
    const previous = this.getAgentConnectConfig()
    const tokens = {
      managementApi: generateAgentConnectSecret('mgmt'),
      bridge: generateAgentConnectSecret('bridge'),
      webhook: generateAgentConnectSecret('webhook'),
    }
    const dashboardOrigin = `http://127.0.0.1:${this.port}`
    const codexConfigPath = this.ensureLocalAgentPlatformConfig('codex')
    const payload: Record<string, unknown> = {
      ...previous,
      enabled: true,
      managementApi: {
        ...previous.managementApi,
        enabled: true,
        host: previous.managementApi.host || '127.0.0.1',
        port: previous.managementApi.port || 9820,
        token: tokens.managementApi,
        corsOrigins: uniqueStrings([...(previous.managementApi.corsOrigins || []), dashboardOrigin]),
      },
      bridge: {
        ...previous.bridge,
        enabled: true,
        host: previous.bridge.host || '127.0.0.1',
        port: previous.bridge.port || 9810,
        path: previous.bridge.path || '/bridge/ws',
        token: tokens.bridge,
        allowPlatforms: uniqueStrings([...(previous.bridge.allowPlatforms || []), 'feishu', 'bridge-custom', 'matrix']),
        defaultProjectId: previous.bridge.defaultProjectId || this.currentProject.id,
      },
      webhook: {
        ...previous.webhook,
        enabled: true,
        path: previous.webhook.path || '/agent-connect/webhook',
        token: tokens.webhook,
      },
      automation: {
        ...previous.automation,
        cronEnabled: true,
        heartbeatEnabled: true,
        heartbeatIntervalMins: previous.automation.heartbeatEnabled ? previous.automation.heartbeatIntervalMins : 15,
        maxTurnTimeMins: previous.automation.maxTurnTimeMins > 0 ? previous.automation.maxTurnTimeMins : 90,
        resetOnIdleMins: previous.automation.heartbeatEnabled ? previous.automation.resetOnIdleMins : 20,
        longTaskNotifications: true,
      },
    }
    const saved = this.saveAgentConnectConfig(payload)
    const session = this.getAgentControlPlane().saveSession('default', {
      name: `${this.currentProject.name} Codex local control`,
      platformId: 'codex',
      modelId: 'balanced',
      channelProvider: 'dashboard',
      channelRouteId: 'dashboard-local',
      commandPrefix: '/scale',
      mode: 'dry-run',
      autoImportKnowledge: true,
    })
    const secretPath = this.writeAgentConnectLocalSecrets(tokens, saved.config)
    this.invalidateDashboardReportCaches()
    const report = this.getIntegrationsReport()
    const warnings = [
      ...saved.config.warnings,
      'External Feishu route target and Tencent ima authorization still require operator credentials.',
    ]
    return {
      ...saved,
      agentOs: report.agentOs,
      secrets: {
        path: secretPath,
        rawStored: true,
        tokens: {
          managementApi: maskSecret(tokens.managementApi),
          bridge: maskSecret(tokens.bridge),
          webhook: maskSecret(tokens.webhook),
        },
      },
      actions: [
        `Agent Connect config saved to ${saved.config.configPath}`,
        `Codex project control config ensured at ${codexConfigPath}`,
        `Default Agent Control session "${session.sessionId}" is bound to Codex via dashboard-local.`,
        `Raw local secrets stored outside git at ${secretPath}`,
        'Management API, Bridge, Webhook, Cron, Heartbeat, long-task notifications, and daemon watchdog are enabled.',
      ],
      warnings,
    }
  }

  private ensureLocalAgentPlatformConfig(platformId: string): string {
    const settings = agentPlatformPaths(this.projectDir, platformId).find(candidate => candidate.kind === 'settings')
    if (!settings) return ''
    if (!existsSync(settings.path)) {
      mkdirSync(dirname(settings.path), { recursive: true })
      writeFileSync(settings.path, `${JSON.stringify({
        version: 1,
        generatedBy: 'scale-agent-os-bootstrap',
        platform: platformId,
        dashboard: {
          url: `http://127.0.0.1:${this.port}`,
          sessionId: 'default',
        },
        hooks: {
          SessionStart: [
            {
              command: 'scale dashboard daemon ensure --dir . --port 3210 --json',
              nonBlocking: true,
            },
          ],
        },
        updatedAt: Date.now(),
      }, null, 2)}\n`, 'utf-8')
    }
    return settings.path
  }

  private writeAgentConnectLocalSecrets(
    tokens: { managementApi: string; bridge: string; webhook: string },
    config: DashboardAgentConnectConfigSummary,
  ): string {
    const secretDir = join(this.scaleDir, 'secrets')
    const secretPath = join(secretDir, 'agent-connect.local.json')
    mkdirSync(secretDir, { recursive: true })
    writeFileSync(secretPath, `${JSON.stringify({
      version: 1,
      provider: 'agent-connect',
      projectId: this.currentProject.id,
      projectDir: this.projectDir,
      configPath: config.configPath,
      generatedAt: Date.now(),
      note: 'Local-only secrets. Keep this file out of Git. Project config stores masked markers only.',
      tokens,
    }, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 })
    return secretPath
  }

  private getAgentOsAcceptancePath(): string {
    return join(this.scaleDir, 'integrations', 'agent-os-acceptance.json')
  }

  private getAgentOsAcceptanceReport(): DashboardAgentOsAcceptanceReport {
    const path = this.getAgentOsAcceptancePath()
    if (!existsSync(path)) {
      return {
        ok: false,
        status: 'missing',
        score: 0,
        generatedAt: 0,
        path,
        steps: [],
        warnings: ['Agent OS acceptance has not been run yet.'],
        nextActions: ['Run the dashboard Agent OS acceptance check.'],
      }
    }
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8').replace(/^\uFEFF/, '')) as DashboardAgentOsAcceptanceReport
      return normalizeAgentOsAcceptanceReport(parsed, path)
    } catch (error) {
      return {
        ok: false,
        status: 'failed',
        score: 0,
        generatedAt: 0,
        path,
        steps: [],
        warnings: [`Agent OS acceptance report is unreadable: ${error instanceof Error ? error.message : String(error)}`],
        nextActions: ['Run the dashboard Agent OS acceptance check again.'],
      }
    }
  }

  private runAgentOsAcceptance(): DashboardAgentOsAcceptanceReport {
    const steps: DashboardAgentOsAcceptanceStep[] = []
    const addCheck = (id: string, label: string, passed: boolean, error: string, blocked = false) => {
      const startedAt = Date.now()
      const finishedAt = Date.now()
      steps.push({
        id,
        label,
        status: passed ? 'passed' : blocked ? 'blocked' : 'failed',
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        error: passed ? undefined : error,
      })
    }
    const runCommandStep = (id: string, label: string, command: string, args: string[], timeout = 15000) => {
      const startedAt = Date.now()
      try {
        const output = runExternalCommandSync(command, args, {
          cwd: this.projectDir,
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout,
          windowsHide: true,
        })
        const finishedAt = Date.now()
        steps.push({
          id,
          label,
          status: 'passed',
          startedAt,
          finishedAt,
          durationMs: finishedAt - startedAt,
          command,
          args,
          stdout: summarizeCommandOutputForReport(output),
        })
      } catch (error) {
        const finishedAt = Date.now()
        const typed = error as Error & { stdout?: string | Buffer | null; stderr?: string | Buffer | null }
        steps.push({
          id,
          label,
          status: 'failed',
          startedAt,
          finishedAt,
          durationMs: finishedAt - startedAt,
          command,
          args,
          stdout: summarizeCommandOutputForReport(typed.stdout),
          stderr: summarizeCommandOutputForReport(typed.stderr),
          error: typed.message,
        })
      }
    }

    const integrations = this.getIntegrationsReportWithoutAcceptance()
    const agentControl = this.getAgentControlReport()
    const dashboardService = this.getDashboardServiceStatus()
    const feishuProvider = integrations.providers.find(provider => provider.id === 'feishu')
    const imaProvider = integrations.providers.find(provider => provider.id === 'tencent-ima')

    addCheck('integrations-api', 'Integrations API returns Agent OS readiness', integrations.agentOs.score > 0, 'Integrations readiness report is empty.')
    addCheck('agent-control-ready', 'At least one Agent Control session is ready', agentControl.summary.ready > 0, 'No ready Agent Control session is available.', true)
    addCheck('dashboard-daemon', 'Dashboard daemon is resident and serving', dashboardService.supervisorAlive && dashboardService.serverAlive, 'Dashboard daemon supervisor or server is not alive.', true)
    runCommandStep('lark-cli-version', 'lark-cli is installed', 'lark-cli', ['--version'], 10000)
    runCommandStep('lark-cli-skills', 'lark-cli skills are discoverable', 'lark-cli', ['skills', 'list', '--json'], 15000)
    runCommandStep('lark-cli-doctor', 'lark-cli configuration doctor passes', 'lark-cli', ['doctor'], 15000)
    addCheck(
      'feishu-route-target',
      'Feishu route has a real chat/user target',
      Boolean(feishuProvider?.routeConfig?.configured),
      'No Feishu chat/user target is configured for the selected agent platform.',
      true,
    )
    addCheck(
      'tencent-ima-provider',
      'Tencent ima online knowledge provider is configured',
      Boolean(imaProvider?.knowledgeConfig?.configured),
      'Tencent ima Client ID, knowledge-base ID, API Key, or QR authorization is incomplete.',
      true,
    )

    const failed = steps.filter(step => step.status === 'failed')
    const blocked = steps.filter(step => step.status === 'blocked')
    const passed = steps.filter(step => step.status === 'passed')
    const status: DashboardAgentOsAcceptanceReport['status'] = failed.length > 0 ? 'failed' : blocked.length > 0 ? 'blocked' : 'passed'
    const warnings = [
      ...failed.map(step => `${step.label}: ${step.error ?? 'failed'}`),
      ...blocked.map(step => `${step.label}: ${step.error ?? 'blocked'}`),
    ]
    const report: DashboardAgentOsAcceptanceReport = {
      ok: status === 'passed',
      status,
      score: steps.length > 0 ? Math.round((passed.length / steps.length) * 100) : 0,
      generatedAt: Date.now(),
      path: this.getAgentOsAcceptancePath(),
      steps,
      warnings,
      nextActions: acceptanceNextActions(steps),
    }
    mkdirSync(dirname(report.path), { recursive: true })
    writeFileSync(report.path, `${JSON.stringify(report, null, 2)}\n`, 'utf-8')
    this.invalidateDashboardReportCaches()
    return report
  }

  private getIntegrationsReportWithoutAcceptance(): DashboardIntegrationsReport {
    const providers = [
      this.getFeishuIntegrationProvider(),
      this.getTencentImaKnowledgeProvider(),
    ]
    const connectorWorkflow = this.getConnectorWorkflowReport(providers)
    const agentOs = this.getAgentOsReadinessReport(providers, connectorWorkflow)
    return {
      project: this.currentProject,
      generatedAt: Date.now(),
      summary: {
        providers: providers.length,
        ready: providers.filter(provider => provider.status === 'ready').length,
        partial: providers.filter(provider => provider.status === 'partial').length,
        missing: providers.filter(provider => provider.status === 'missing').length,
      },
      providers,
      connectorWorkflow,
      agentOs,
      acceptance: {
        ok: false,
        status: 'missing',
        score: 0,
        generatedAt: 0,
        path: this.getAgentOsAcceptancePath(),
        steps: [],
        warnings: [],
        nextActions: [],
      },
      warnings: [],
    }
  }

  private getManagementApiStatus(): Record<string, unknown> {
    const integrations = this.getIntegrationsReport()
    const agentControl = this.getAgentControlReport()
    const service = this.getDashboardServiceStatus()
    return {
      ok: true,
      generatedAt: Date.now(),
      project: this.currentProject,
      service: {
        status: service.status,
        url: service.url,
        supervisorAlive: service.supervisorAlive,
        serverAlive: service.serverAlive,
        supervisorPid: service.supervisorPid,
        serverPid: service.serverPid,
        lastHeartbeatAt: service.lastHeartbeatAt,
      },
      agentControl: agentControl.summary,
      connectorWorkflow: integrations.connectorWorkflow.summary,
      bridge: {
        sessions: this.readBridgeSessionStore().sessions.length,
        activeSessionId: this.readBridgeSessionStore().activeSessionId,
      },
      security: {
        managementTokenConfigured: integrations.connectorWorkflow.config.managementApi.hasToken,
        bridgeTokenConfigured: integrations.connectorWorkflow.config.bridge.hasToken,
        plaintextTokensStored: false,
      },
    }
  }

  private findManagementProject(projectName: string): DashboardProjectSummary | null {
    const normalized = safeProjectId(decodeURIComponent(projectName || ''))
    return this.projects.find(project => {
      return project.id === projectName
        || project.name === projectName
        || safeProjectId(project.name) === normalized
        || safeProjectId(project.id) === normalized
    }) ?? null
  }

  private getBridgeSessionsPath(): string {
    return join(this.scaleDir, 'agents', 'bridge-sessions.json')
  }

  private getBridgeEventsPath(): string {
    return join(this.scaleDir, 'agents', 'bridge-events.jsonl')
  }

  private readBridgeSessionStore(): DashboardBridgeSessionStore {
    const path = this.getBridgeSessionsPath()
    if (!existsSync(path)) return { version: 1, sessions: [] }
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8').replace(/^\uFEFF/, '')) as { activeSessionId?: unknown; sessions?: unknown[] }
      const sessions = Array.isArray(parsed.sessions)
        ? parsed.sessions.map(item => normalizeBridgeSession(item, this.currentProject)).filter((session): session is DashboardBridgeSession => Boolean(session))
        : []
      return {
        version: 1,
        activeSessionId: normalizeOptionalSingleLine(parsed.activeSessionId),
        sessions,
      }
    } catch {
      return { version: 1, sessions: [] }
    }
  }

  private writeBridgeSessionStore(store: DashboardBridgeSessionStore): void {
    const path = this.getBridgeSessionsPath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify({ version: 1, activeSessionId: store.activeSessionId, sessions: store.sessions }, null, 2)}\n`, 'utf-8')
  }

  private appendBridgeEvent(event: DashboardBridgeEventRecord): void {
    const path = this.getBridgeEventsPath()
    mkdirSync(dirname(path), { recursive: true })
    const previous = existsSync(path) ? readFileSync(path, 'utf-8').trim() : ''
    writeFileSync(path, `${previous ? `${previous}\n` : ''}${JSON.stringify(event)}\n`, 'utf-8')
  }

  private getBridgeSessionsReport(): Record<string, unknown> {
    const store = this.readBridgeSessionStore()
    return {
      project: this.currentProject,
      activeSessionId: store.activeSessionId,
      sessions: store.sessions,
      agentControlSessions: this.getAgentControlReport().sessions,
      storagePath: this.getBridgeSessionsPath(),
    }
  }

  private createBridgeSession(input: Record<string, unknown>): DashboardBridgeSession {
    const config = this.getAgentConnectConfig()
    if (!config.bridge.enabled) throw new Error('Bridge is not enabled in Agent Connect config.')
    const platform = normalizeSingleLine(input.platform, config.bridge.allowPlatforms[0] ?? 'bridge-custom')
    if (!config.bridge.allowPlatforms.includes(platform)) {
      throw new Error(`Bridge platform is not allowed: ${platform}`)
    }
    const agentPlatformId = normalizeSingleLine(input.agentPlatformId, normalizeSingleLine(input.platformId, 'codex'))
    const agentSessionId = safeProjectId(normalizeSingleLine(input.agentSessionId ?? input.sessionId, `${platform}-${agentPlatformId}`))
    const now = Date.now()
    const store = this.readBridgeSessionStore()
    const existing = store.sessions.find(session => session.agentSessionId === agentSessionId || session.id === normalizeOptionalSingleLine(input.id))
    const session: DashboardBridgeSession = {
      id: existing?.id ?? `bridge-${now}-${Math.random().toString(36).slice(2, 8)}`,
      projectId: this.currentProject.id,
      projectName: this.currentProject.name,
      platform,
      agentPlatformId,
      agentSessionId,
      scope: normalizeBridgeScope(input.scope),
      user: normalizeSingleLine(input.user, normalizeSingleLine(input.userId, 'remote-user')),
      title: normalizeSingleLine(input.title, `${platform} ${agentSessionId}`),
      active: normalizeBoolean(input.active, store.sessions.length === 0),
      capabilities: toStringArray(input.capabilities),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastSeenAt: now,
    }
    const sessions = store.sessions.filter(item => item.id !== session.id && item.agentSessionId !== session.agentSessionId)
      .map(item => session.active ? { ...item, active: false } : item)
    sessions.unshift(session)
    this.writeBridgeSessionStore({
      version: 1,
      activeSessionId: session.active ? session.id : store.activeSessionId,
      sessions,
    })
    this.getAgentControlPlane().saveSession(agentSessionId, {
      name: session.title,
      platformId: agentPlatformId,
      channelProvider: 'dashboard',
      mode: 'interactive',
      commandPrefix: '/scale',
      autoImportKnowledge: true,
    })
    return session
  }

  private ingestBridgeEvent(input: Record<string, unknown>): Record<string, unknown> {
    const type = normalizeSingleLine(input.type, 'message')
    const session = this.resolveBridgeSessionForEvent(input)
    const event = this.recordBridgeEvent(session, type, 'inbound', input)

    if (type === 'register') {
      return {
        ok: true,
        event,
        session,
        outbound: [{
          type: 'register_ack',
          sessionId: session.id,
          agentSessionId: session.agentSessionId,
          projectId: session.projectId,
          createdAt: Date.now(),
        }],
      }
    }
    if (type === 'ping') {
      return {
        ok: true,
        event,
        session,
        outbound: [{ type: 'pong', sessionId: session.id, createdAt: Date.now() }],
      }
    }
    if (type === 'message') {
      const text = normalizeBridgeMessageText(input)
      if (!text) throw new Error('Bridge message text is required.')
      const message = this.getAgentControlPlane().sendMessage(session.agentSessionId, {
        text,
        dryRun: input.dryRun,
        from: `bridge:${session.platform}:${session.user}`,
      })
      return {
        ok: true,
        event,
        session,
        agentMessage: message,
        outbound: [{
          type: 'preview_start',
          sessionId: session.id,
          agentSessionId: session.agentSessionId,
          messageId: message.id,
          status: message.status,
          createdAt: message.createdAt,
        }],
      }
    }
    return {
      ok: true,
      event,
      session,
      outbound: [{
        type: `${type}_ack`,
        sessionId: session.id,
        createdAt: Date.now(),
      }],
    }
  }

  private ingestAgentConnectWebhook(input: Record<string, unknown>): Record<string, unknown> {
    const config = this.getAgentConnectConfig()
    if (!config.webhook.enabled) throw new Error('Agent Connect webhook is not enabled.')
    const platform = normalizeSingleLine(input.platform, normalizeSingleLine(input.channel, 'feishu'))
    const agentPlatformId = normalizeSingleLine(input.agentPlatformId, normalizeSingleLine(input.platformId, platform === 'feishu' ? 'codex' : platform))
    const agentSessionId = safeProjectId(normalizeSingleLine(input.agentSessionId ?? input.sessionId, `${platform}-${agentPlatformId}`))
    const session = this.createBridgeSession({
      platform: config.bridge.allowPlatforms.includes(platform) ? platform : 'bridge-custom',
      agentPlatformId,
      agentSessionId,
      user: input.user ?? input.userId ?? input.senderId ?? input.openId ?? 'webhook-user',
      title: input.title ?? `${platform} webhook ${agentSessionId}`,
      active: true,
      capabilities: ['text', 'webhook'],
    })
    const text = normalizeBridgeMessageText(input)
    if (!text) throw new Error('Webhook message text is required.')
    const event = this.recordBridgeEvent(session, 'webhook', 'inbound', input)
    const message = this.getAgentControlPlane().sendMessage(agentSessionId, {
      text,
      dryRun: input.dryRun,
      from: `webhook:${platform}:${session.user}`,
    })
    return {
      ok: true,
      event,
      session,
      agentMessage: message,
    }
  }

  private resolveBridgeSessionForEvent(input: Record<string, unknown>): DashboardBridgeSession {
    const existingId = normalizeOptionalSingleLine(input.sessionId ?? input.id)
    const agentSessionId = normalizeOptionalSingleLine(input.agentSessionId)
    const existing = existingId ? this.getBridgeSession(existingId) : agentSessionId ? this.getBridgeSession(agentSessionId) : null
    if (existing) {
      const now = Date.now()
      const store = this.readBridgeSessionStore()
      const sessions = store.sessions.map(item => item.id === existing.id ? { ...item, updatedAt: now, lastSeenAt: now } : item)
      this.writeBridgeSessionStore({ ...store, sessions })
      return sessions.find(item => item.id === existing.id) ?? existing
    }
    return this.createBridgeSession(input)
  }

  private recordBridgeEvent(
    session: DashboardBridgeSession,
    type: string,
    direction: DashboardBridgeEventRecord['direction'],
    payload: Record<string, unknown>,
  ): DashboardBridgeEventRecord {
    const event: DashboardBridgeEventRecord = {
      id: `BEV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId: session.id,
      agentSessionId: session.agentSessionId,
      platform: session.platform,
      type,
      direction,
      payload: sanitizeBridgePayload(payload),
      createdAt: Date.now(),
    }
    this.appendBridgeEvent(event)
    return event
  }

  private getBridgeSessionEvents(
    id: string,
    input: { cursor?: unknown; limit?: unknown } = {},
  ): Record<string, unknown> {
    const session = this.getBridgeSession(id)
    if (!session) throw new Error('Bridge session not found.')
    const cursor = parseNonNegativeIntFromUnknown(input.cursor, 0)
    const limit = Math.min(parsePositiveIntFromUnknown(input.limit, 50), 200)
    const transcript = this.getAgentControlPlane().getTranscript(session.agentSessionId, { limit: 1000 })
    const messages = transcript.messages
      .filter(message => message.createdAt > cursor)
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(0, limit)
    const events = messages.map(message => ({
      id: `agent-${message.id}`,
      type: message.direction === 'agent-to-operator' ? 'reply' : 'preview_start',
      sessionId: session.id,
      agentSessionId: session.agentSessionId,
      messageId: message.id,
      status: message.status,
      text: message.text,
      from: message.from,
      to: message.to,
      evidencePath: message.evidencePath,
      createdAt: message.createdAt,
    }))
    const nextCursor = messages.reduce((max, message) => Math.max(max, message.createdAt), cursor)
    return {
      ok: true,
      session,
      cursor,
      nextCursor,
      events,
    }
  }

  private getBridgeSession(id: string): DashboardBridgeSession | null {
    const normalized = normalizeSingleLine(id, '')
    return this.readBridgeSessionStore().sessions.find(session => session.id === normalized || session.agentSessionId === normalized) ?? null
  }

  private deleteBridgeSession(id: string): DashboardBridgeSession | null {
    const store = this.readBridgeSessionStore()
    const session = this.getBridgeSession(id)
    if (!session) return null
    const sessions = store.sessions.filter(item => item.id !== session.id)
    this.writeBridgeSessionStore({
      version: 1,
      activeSessionId: store.activeSessionId === session.id ? sessions[0]?.id : store.activeSessionId,
      sessions: sessions.map((item, index) => ({ ...item, active: store.activeSessionId === session.id ? index === 0 : item.active })),
    })
    return session
  }

  private switchBridgeSession(input: Record<string, unknown>): DashboardBridgeSession {
    const id = normalizeSingleLine(input.id ?? input.sessionId ?? input.agentSessionId, '')
    const store = this.readBridgeSessionStore()
    const session = store.sessions.find(item => item.id === id || item.agentSessionId === id)
    if (!session) throw new Error('Bridge session not found.')
    const now = Date.now()
    const next = {
      version: 1 as const,
      activeSessionId: session.id,
      sessions: store.sessions.map(item => item.id === session.id
        ? { ...item, active: true, updatedAt: now, lastSeenAt: now }
        : { ...item, active: false }),
    }
    this.writeBridgeSessionStore(next)
    return next.sessions.find(item => item.id === session.id) ?? session
  }

  private getBridgeAdaptersReport(): Record<string, unknown> {
    const integrations = this.getIntegrationsReport()
    const config = integrations.connectorWorkflow.config
    return {
      ok: true,
      enabled: config.bridge.enabled,
      tokenConfigured: config.bridge.hasToken,
      allowPlatforms: config.bridge.allowPlatforms,
      websocketEndpoint: config.endpoints.bridgeWebSocket,
      adapters: integrations.connectorWorkflow.channels
        .filter(channel => channel.id === 'bridge-custom' || config.bridge.allowPlatforms.includes(channel.id))
        .map(channel => ({
          id: channel.id,
          name: channel.name,
          status: channel.status,
          transport: channel.transport,
          capabilities: channel.capabilities,
          warnings: channel.warnings,
        })),
    }
  }

  private getConnectorWorkflowReport(providers: DashboardIntegrationProviderReport[]): DashboardConnectorWorkflowReport {
    const config = this.getAgentConnectConfig()
    const feishuProvider = providers.find(provider => provider.id === 'feishu')
    const channels = buildConnectorChannelCatalog(config, feishuProvider)
    const dashboardService = this.getDashboardServiceStatus()
    const warnings = [
      ...config.warnings,
      ...channels.flatMap(channel => channel.warnings.map(warning => `${channel.name}: ${warning}`)),
    ]
    const automationLoops = buildConnectorAutomationLoops(config)
    return {
      summary: {
        channels: channels.length,
        readyChannels: channels.filter(channel => channel.status === 'ready').length,
        partialChannels: channels.filter(channel => channel.status === 'partial').length,
        agentPlatforms: this.getAgentPlatformTargets().length,
        providerPresets: CONNECTOR_PROVIDER_PRESETS.length,
        skillPresets: CONNECTOR_SKILL_PRESETS.length,
        automationLoops: automationLoops.length,
      },
      config,
      channels,
      bridge: {
        protocolVersion: 1,
        enabled: config.bridge.enabled,
        websocketEndpoint: config.endpoints.bridgeWebSocket,
        tokenRequired: true,
        sessionKeyFormat: '{platform}:{scope}:{user}',
        adapterRegistration: [
          'register declares platform, display name, project binding, and capabilities.',
          'Adapter remains stateless; SCALE stores project/session state under .scale.',
          'Adapter should reconnect and re-register after network interruption.',
        ],
        inboundTypes: ['register', 'message', 'card_action', 'preview_ack', 'ping'],
        outboundTypes: ['register_ack', 'reply', 'reply_stream', 'preview_start', 'update_message', 'delete_message', 'card', 'buttons', 'typing_start', 'typing_stop', 'audio', 'image', 'file', 'pong', 'error'],
        restEndpoints: [
          'GET /bridge/sessions',
          'POST /bridge/sessions',
          'POST /bridge/events',
          'GET /bridge/sessions/{id}',
          'GET /bridge/sessions/{id}/events',
          'DELETE /bridge/sessions/{id}',
          'POST /bridge/sessions/switch',
          'POST /agent-connect/webhook',
        ],
        capabilities: ['text', 'image', 'file', 'audio', 'card', 'buttons', 'typing', 'update_message', 'preview', 'delete_message', 'reconstruct_reply'],
      },
      managementApi: {
        enabled: config.managementApi.enabled,
        baseUrl: config.endpoints.managementApi,
        auth: 'Bearer token or token query parameter; token is required when enabled.',
        endpoints: [
          'GET /api/v1/status',
          'POST /api/v1/reload',
          'POST /api/v1/restart',
          'GET /api/v1/config',
          'GET /api/v1/projects',
          'GET /api/v1/projects/{name}/sessions',
          'POST /api/v1/projects/{name}/send',
          'GET /api/v1/projects/{name}/providers',
          'POST /api/v1/projects/{name}/model',
          'GET /api/v1/cron',
          'POST /api/v1/cron/{id}/exec',
          'GET /api/v1/bridge/adapters',
        ],
      },
      providerPresets: CONNECTOR_PROVIDER_PRESETS,
      skillPresets: CONNECTOR_SKILL_PRESETS,
      automationLoops,
      daemon: {
        status: dashboardService.status,
        serviceDir: dashboardService.serviceDir,
        healthUrl: dashboardService.healthUrl,
        installed: dashboardService.installed,
        supervisorAlive: dashboardService.supervisorAlive,
        commands: [
          'scale dashboard daemon ensure --dir .',
          'scale dashboard daemon status --dir .',
          'scale dashboard daemon restart --dir .',
        ],
        hooks: [
          'SessionStart: ensure dashboard daemon before remote-control sessions.',
          'PermissionRequest: send Feishu/Bark/local notification and keep task unblocked.',
          'Stop/Submit: summarize context and push completion status to the configured route.',
          'Health watchdog: restart dashboard server when health probe fails.',
        ],
      },
      configModel: [
        {
          scope: 'machine',
          owner: 'Operator machine profile',
          storage: 'CLI/keychain/env only',
          examples: ['lark-cli profile', 'provider API keys', 'OS service credentials'],
        },
        {
          scope: 'project',
          owner: 'Current SCALE workspace',
          storage: '.scale/integrations/*.json',
          examples: ['agent-connect.json', 'feishu-channel.json', 'tencent-ima-knowledge.json'],
        },
        {
          scope: 'agent-platform',
          owner: 'Agent runtime adapter',
          storage: '.scale/integrations/feishu-channel.json routes[]',
          examples: ['codex route', 'openclaw route', 'hermes route'],
        },
        {
          scope: 'session',
          owner: 'Agent Control Plane',
          storage: '.scale/agents/control-plane.json + .scale/agents/messages/',
          examples: ['model selection', 'channel route', 'message queue', 'reply records'],
        },
      ],
      commands: {
        configure: [
          'scale setup --pack full --memory-provider gbrain --memory-mode external-first --apply --yes',
          'lark-cli config init --new --lang zh',
          'lark-cli auth login --recommend --no-wait',
          'Open Dashboard > Integrations > Agent Connect and save Bridge/Management settings.',
        ],
        verify: [
          'scale setup --verify --pack full --json',
          'lark-cli doctor',
          'GET /api/integrations',
          'GET /api/agent-control',
          'GET /api/dashboard/service',
        ],
        agentRuntime: [
          'scale agent-control inbox --session <session-id> --claim-first --agent-id <agent-id> --json',
          'scale agent-control reply --session <session-id> --message <message-id> --text "<result>" --agent-id <agent-id> --json',
        ],
      },
      warnings,
    }
  }

  private getFeishuRouteSummary(platformId?: string): DashboardFeishuRouteSummary {
    const platformTargets = this.getAgentPlatformTargets()
    return this.buildFeishuRouteSummary(this.selectFeishuRouteConfig(this.readFeishuRouteConfigs(), platformId), platformTargets)
  }

  private getFeishuRouteSummaries(): DashboardFeishuRouteSummary[] {
    const platformTargets = this.getAgentPlatformTargets()
    const configuredRoutes = this.readFeishuRouteConfigs()
    const routeByPlatform = new Map(configuredRoutes.map(route => [route.agentPlatformId, route]))
    for (const target of platformTargets) {
      if (!routeByPlatform.has(target.id)) {
        routeByPlatform.set(target.id, defaultFeishuRouteConfig(this.currentProject, target.id))
      }
    }
    return [...routeByPlatform.values()]
      .sort((left, right) => left.agentPlatformId.localeCompare(right.agentPlatformId))
      .map(route => this.buildFeishuRouteSummary(route, platformTargets))
  }

  private readFeishuRouteConfigs(warnings: string[] = []): DashboardFeishuRouteConfig[] {
    const configPath = this.getFeishuRouteConfigPath()
    if (!existsSync(configPath)) return [defaultFeishuRouteConfig(this.currentProject)]
    try {
      const parsed = JSON.parse(readFileSync(configPath, 'utf-8').replace(/^\uFEFF/, '')) as unknown
      const routes = isRecordValue(parsed) && Array.isArray(parsed.routes)
        ? parsed.routes.map(route => normalizeFeishuRouteConfig(route, this.currentProject))
        : [normalizeFeishuRouteConfig(parsed, this.currentProject)]
      return dedupeFeishuRoutes(routes)
    } catch (error) {
      warnings.push(`Project Feishu route config is unreadable: ${error instanceof Error ? error.message : String(error)}`)
      return [defaultFeishuRouteConfig(this.currentProject)]
    }
  }

  private selectFeishuRouteConfig(routes: DashboardFeishuRouteConfig[], platformId?: string): DashboardFeishuRouteConfig {
    const fallback = defaultFeishuRouteConfig(this.currentProject, platformId)
    return routes.find(route => platformId && route.agentPlatformId === platformId)
      ?? routes.find(route => route.enabled && route.targetId.trim())
      ?? routes[0]
      ?? fallback
  }

  private saveFeishuRouteConfig(input: Record<string, unknown>): DashboardIntegrationRouteUpdateResult {
    try {
      const route = normalizeFeishuRouteConfig(input, this.currentProject, { strict: true })
      const configPath = this.getFeishuRouteConfigPath()
      mkdirSync(dirname(configPath), { recursive: true })
      const routes = dedupeFeishuRoutes([
        route,
        ...this.readFeishuRouteConfigs().filter(existing => existing.agentPlatformId !== route.agentPlatformId),
      ])
      const payload: DashboardFeishuRouteConfigFile = {
        version: 1,
        provider: 'feishu',
        projectId: this.currentProject.id,
        projectDir: this.currentProject.projectDir,
        routes,
        updatedAt: Date.now(),
      }
      writeFileSync(configPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
      const summaries = this.getFeishuRouteSummaries()
      return {
        provider: 'feishu',
        ok: true,
        saved: true,
        route: summaries.find(summary => summary.agentPlatformId === route.agentPlatformId)
          ?? this.buildFeishuRouteSummary(route, this.getAgentPlatformTargets()),
        routes: summaries,
      }
    } catch (error) {
      const route = this.getFeishuRouteSummary()
      return {
        provider: 'feishu',
        ok: false,
        saved: false,
        route,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private buildFeishuRouteSummary(
    route: DashboardFeishuRouteConfig,
    platformTargets: DashboardIntegrationProviderReport['platformTargets'],
  ): DashboardFeishuRouteSummary {
    const warnings: string[] = []
    const targetId = route.targetId.trim()
    const configured = route.enabled && Boolean(targetId) && !isPlaceholderFeishuTarget(targetId)
    const platformStatus = platformTargets.find(target => target.id === route.agentPlatformId)?.status ?? 'missing'
    if (!route.enabled) warnings.push('Project Feishu route is disabled.')
    if (!targetId || isPlaceholderFeishuTarget(targetId)) warnings.push('Project Feishu route target is not configured.')
    if (platformStatus !== 'ready') warnings.push(`Agent platform "${route.agentPlatformId}" is not installed in this project.`)

    const eventConsumePlan = buildFeishuEventConsumeCommand({
      eventKey: route.eventKey,
      as: 'bot',
      timeout: '30s',
      maxEvents: 1,
      quiet: true,
    })
    const dryRunSendPlan = configured
      ? buildFeishuSendMessageCommand({
        ...(route.targetType === 'user' ? { userId: targetId } : { chatId: targetId }),
        text: `SCALE dashboard route probe: ${this.currentProject.name}/${route.agentPlatformId}/${route.agentSessionId}`,
        mode: 'text',
        as: 'bot',
        dryRun: true,
        idempotencyKey: `scale-dashboard-${route.routeId}`,
      })
      : undefined

    return {
      ...route,
      configPath: this.getFeishuRouteConfigPath(),
      configured,
      platformStatus,
      targetLabel: `${route.targetType}:${targetId || '<unset>'}`,
      dryRunSendPlan,
      eventConsumePlan,
      warnings,
    }
  }

  private getFeishuIntegrationProvider(): DashboardIntegrationProviderReport {
    const commandPath = resolveExternalCommandPath('lark-cli') ?? undefined
    const commandAvailable = Boolean(commandPath) || externalCommandExists('lark-cli')
    const providerWarnings: string[] = []
    const platformTargets = this.getAgentPlatformTargets()
    const routes = this.readFeishuRouteConfigs(providerWarnings)
    const routeConfigs = this.getFeishuRouteSummaries()
    const routeConfig = this.buildFeishuRouteSummary(this.selectFeishuRouteConfig(routes), platformTargets)
    const setupCommands = [
      'scale setup --pack full --memory-provider gbrain --memory-mode external-first --apply --yes',
      'lark-cli config init --new --lang zh',
      'lark-cli auth login --recommend --no-wait',
    ]
    const verifyCommands = [
      'lark-cli --version',
      'lark-cli skills list --json',
      'lark-cli doctor',
      'scale setup --verify --pack full --json',
      'scale memory provider status --json',
    ]
    const dryRunSendPlan = routeConfig.dryRunSendPlan ?? buildFeishuSendMessageCommand({
      chatId: '<oc_xxx>',
      text: 'SCALE dashboard Feishu dry-run probe. Confirm target chat/user before live delivery.',
      mode: 'text',
      as: 'bot',
      dryRun: true,
    })
    const eventConsumePlan = routeConfig.eventConsumePlan
    const doctorPlan: FeishuCommandPlan = {
      command: 'lark-cli',
      args: ['doctor'],
      risk: 'read',
      requiresConfirmation: false,
      description: 'Run lark-cli doctor against the active machine profile.',
    }
    const warnings = commandAvailable
      ? ['lark-cli is visible on PATH; run lark-cli doctor before claiming remote-control readiness.']
      : ['lark-cli is not visible on PATH; Feishu remote notification and command intake are not configured.']
    const status = commandAvailable ? (routeConfig.configured ? 'ready' : 'partial') : 'missing'
    return {
      id: 'feishu',
      name: 'Feishu/Lark message channel',
      category: 'message-channel',
      description: 'Per-agent-platform mobile notifications, command intake, event consume, and guarded remote-control routes through lark-cli.',
      status,
      command: 'lark-cli',
      commandAvailable,
      commandPath,
      configBoundary: 'lark-cli profile/keychain; never commit app credentials to the repository.',
      authModes: [
        {
          id: 'cli-profile',
          label: 'lark-cli profile',
          description: 'Recommended. Credentials are kept in the machine lark-cli profile/keychain.',
          status: commandAvailable ? 'partial' : 'missing',
          configured: commandAvailable,
          sensitive: true,
          fields: ['profile'],
          setupCommand: 'lark-cli auth login --recommend --no-wait',
        },
        {
          id: 'app-secret',
          label: 'App ID / App Secret',
          description: 'Use when the operator provisions a custom Feishu app. The secret should be written to the local CLI profile, not the project repo.',
          status: commandAvailable ? 'partial' : 'missing',
          configured: commandAvailable,
          sensitive: true,
          fields: ['appId', 'appSecret'],
          setupCommand: 'lark-cli config init --new --lang zh',
        },
        {
          id: 'qr',
          label: 'QR login',
          description: 'Use browser or mobile QR authorization when the CLI supports interactive login.',
          status: commandAvailable ? 'partial' : 'missing',
          configured: commandAvailable,
          sensitive: true,
          fields: ['loginSession'],
          setupCommand: 'lark-cli auth login --recommend --no-wait',
        },
      ],
      setupCommands,
      verifyCommands,
      dryRunSendPlan,
      eventConsumePlan,
      routeConfig,
      routeConfigs,
      scope: {
        level: 'machine',
        projectScoped: false,
        projectId: this.currentProject.id,
        projectDir: this.projectDir,
        description: 'lark-cli credentials live in the user/machine profile; project routes live in .scale/integrations/feishu-channel.json and bind Feishu messages to one project, agent platform, and session.',
      },
      platformTargets,
      actions: [
        { id: 'doctor', label: 'Run lark-cli doctor', kind: 'probe', plan: doctorPlan },
        { id: 'dry-run-send', label: 'Send dry-run message', kind: 'dry-run', plan: dryRunSendPlan },
        { id: 'consume-once', label: 'Consume one message event', kind: 'read', plan: eventConsumePlan },
      ],
      safetyRules: [
        'Outbound messages stay dry-run until a chat/user target is confirmed.',
        'Write-capable /scale commands require explicit approval before live execution.',
        'Long logs remain in SCALE evidence; Feishu receives short status and artifact links.',
        'Reviewed Feishu summaries can be imported into .scale/knowledge/imports/ or gbrain after privacy review.',
      ],
      nextAction: commandAvailable
        ? routeConfig.configured
          ? 'Run lark-cli doctor and consume one event before enabling live command routing.'
          : 'Save a project Feishu route target in the dashboard, then run lark-cli doctor.'
        : 'Install with scale setup --pack full --apply --yes, then run lark-cli config init --new --lang zh.',
      warnings: [...warnings, ...providerWarnings, ...routeConfig.warnings],
    }
  }

  private getTencentImaKnowledgeProvider(): DashboardIntegrationProviderReport {
    const config = this.getTencentImaKnowledgeProviderConfig()
    const status: DashboardDataSourceStatus = config.configured ? 'ready' : config.enabled ? 'partial' : 'missing'
    return {
      id: 'tencent-ima',
      name: 'Tencent ima knowledge provider',
      category: 'knowledge-provider',
      description: 'External online knowledge-base provider for agent retrieval and remote coding context. Configure Client ID plus API Key or QR authorization.',
      status,
      command: 'browser',
      commandAvailable: true,
      configBoundary: 'Project-level provider metadata is stored in .scale/integrations/tencent-ima-knowledge.json; raw API keys are not written to the repository.',
      authModes: [
        {
          id: 'api-key',
          label: 'Client ID / API Key',
          description: 'Use the ima agent interface credentials. The dashboard stores only a masked key marker.',
          status: config.hasApiKey ? 'partial' : 'missing',
          configured: config.hasApiKey,
          sensitive: true,
          fields: ['clientId', 'apiKey', 'knowledgeBaseId'],
          authUrl: config.consoleUrl,
        },
        {
          id: 'qr',
          label: 'QR authorization',
          description: 'Use when the operator wants mobile/browser authorization instead of pasting an API key.',
          status: config.qrAuthorized ? 'partial' : 'missing',
          configured: config.qrAuthorized,
          sensitive: true,
          fields: ['clientId', 'qrAuthorized', 'knowledgeBaseId'],
          authUrl: config.consoleUrl,
        },
      ],
      setupCommands: [
        'open https://ima.qq.com/agent-interface',
        'Create or open an ima agent interface, then copy Client ID and API Key into the dashboard provider form.',
        'Use QR authorization when the operator should approve access from mobile instead of pasting a token.',
      ],
      verifyCommands: [
        'Confirm Client ID exists in .scale/integrations/tencent-ima-knowledge.json',
        'Confirm API Key is stored only as a masked marker or use QR authorization.',
        'Run scale setup --verify --pack full --json after enabling external memory providers.',
      ],
      knowledgeConfig: config,
      scope: {
        level: 'project',
        projectScoped: true,
        projectId: this.currentProject.id,
        projectDir: this.projectDir,
        description: 'Tencent ima is configured per project so each Agent OS workspace can bind a different online knowledge base.',
      },
      platformTargets: this.getAgentPlatformTargets(),
      actions: [],
      safetyRules: [
        'Do not commit raw API keys or OAuth artifacts.',
        'Use project-scoped knowledge-base IDs so one workspace cannot leak another workspace context.',
        'Import external knowledge into gbrain only after privacy review.',
      ],
      nextAction: config.configured
        ? 'Run a provider recall verification before enabling automatic knowledge import.'
        : 'Open ima agent interface, configure Client ID and API Key or QR authorization, then save the provider.',
      warnings: config.warnings,
    }
  }

  private getTencentImaKnowledgeProviderConfig(): DashboardKnowledgeProviderSummary {
    const warnings: string[] = []
    const configPath = this.getTencentImaKnowledgeProviderConfigPath()
    let config = defaultTencentImaKnowledgeProviderConfig()
    if (existsSync(configPath)) {
      try {
        config = normalizeTencentImaKnowledgeProviderConfig(JSON.parse(readFileSync(configPath, 'utf-8').replace(/^\uFEFF/, '')))
      } catch (error) {
        warnings.push(`Tencent ima provider config is unreadable: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return buildTencentImaKnowledgeProviderSummary(config, configPath, warnings)
  }

  private saveTencentImaKnowledgeProviderConfig(input: Record<string, unknown>): DashboardKnowledgeProviderUpdateResult {
    try {
      const previous = this.getTencentImaKnowledgeProviderConfig()
      const config = normalizeTencentImaKnowledgeProviderConfig({
        ...previous,
        ...input,
        hasApiKey: typeof input.apiKey === 'string' && input.apiKey.trim()
          ? true
          : typeof input.hasApiKey === 'boolean'
            ? input.hasApiKey
            : previous.hasApiKey,
        apiKeyMasked: typeof input.apiKey === 'string' && input.apiKey.trim()
          ? maskSecret(input.apiKey.trim())
          : typeof input.apiKeyMasked === 'string'
            ? input.apiKeyMasked
            : previous.apiKeyMasked,
      })
      const configPath = this.getTencentImaKnowledgeProviderConfigPath()
      mkdirSync(dirname(configPath), { recursive: true })
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
      return {
        provider: 'tencent-ima',
        ok: true,
        saved: true,
        config: this.getTencentImaKnowledgeProviderConfig(),
      }
    } catch (error) {
      return {
        provider: 'tencent-ima',
        ok: false,
        saved: false,
        config: this.getTencentImaKnowledgeProviderConfig(),
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private runFeishuIntegrationAction(action: string): DashboardIntegrationActionResult {
    const provider = this.getFeishuIntegrationProvider()
    const selected = provider.actions.find(candidate => candidate.id === action)
    const startedAt = Date.now()
    if (!selected) {
      return {
        provider: 'feishu',
        action,
        ok: false,
        status: 'blocked',
        startedAt,
        finishedAt: startedAt,
        durationMs: 0,
        error: `Unsupported Feishu integration action: ${action}`,
      }
    }
    if (selected.plan.requiresConfirmation || (selected.plan.risk === 'write' && !selected.plan.args.includes('--dry-run'))) {
      return {
        provider: 'feishu',
        action,
        ok: false,
        status: 'blocked',
        startedAt,
        finishedAt: startedAt,
        durationMs: 0,
        plan: selected.plan,
        error: 'Live write-capable Feishu actions are blocked from the dashboard unless they are dry-run.',
      }
    }
    if (action === 'dry-run-send' && !provider.routeConfig?.configured) {
      return {
        provider: 'feishu',
        action,
        ok: false,
        status: 'blocked',
        startedAt,
        finishedAt: startedAt,
        durationMs: 0,
        plan: selected.plan,
        error: 'Project Feishu route target is not configured. Save chat/user target before running message dry-run.',
      }
    }
    if (!provider.commandAvailable) {
      return {
        provider: 'feishu',
        action,
        ok: false,
        status: 'blocked',
        startedAt,
        finishedAt: startedAt,
        durationMs: 0,
        plan: selected.plan,
        error: 'lark-cli is not available on PATH.',
      }
    }
    try {
      const output = runExternalCommandSync(selected.plan.command, selected.plan.args, {
        cwd: this.projectDir,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: action === 'consume-once' ? 35000 : 15000,
        windowsHide: true,
      })
      const finishedAt = Date.now()
      return {
        provider: 'feishu',
        action,
        ok: true,
        status: 'passed',
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        plan: selected.plan,
        stdout: String(output).slice(0, 12000),
      }
    } catch (error) {
      const finishedAt = Date.now()
      const typed = error as Error & { stdout?: string | Buffer | null; stderr?: string | Buffer | null }
      return {
        provider: 'feishu',
        action,
        ok: false,
        status: 'failed',
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        plan: selected.plan,
        stdout: stringifyCommandOutput(typed.stdout).slice(0, 12000),
        stderr: stringifyCommandOutput(typed.stderr).slice(0, 12000),
        error: typed.message,
      }
    }
  }

  private startFeishuAuthLogin(): DashboardFeishuAuthStartResult {
    const startedAt = Date.now()
    const command = 'lark-cli'
    const args = ['auth', 'login', '--recommend', '--no-wait', '--json']
    if (!externalCommandExists(command)) {
      return {
        provider: 'feishu',
        ok: false,
        status: 'blocked',
        startedAt,
        finishedAt: startedAt,
        durationMs: 0,
        command,
        args,
        error: 'lark-cli is not available on PATH.',
      }
    }
    if (this.latestAcceptanceHasMissingLarkConfig()) {
      return {
        provider: 'feishu',
        ok: false,
        status: 'blocked',
        startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        command,
        args,
        setupCommand: 'lark-cli config init --new --lang zh',
        error: 'lark-cli is installed but not configured. Run config init, finish browser/mobile setup, then start auth again.',
      }
    }
    try {
      const output = runExternalCommandSync(command, args, {
        cwd: this.projectDir,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 15000,
        windowsHide: true,
      })
      const stdout = String(output).slice(0, 12000)
      const parsed = parseJsonObject(stdout)
      const finishedAt = Date.now()
      const verificationUrl = firstString(
        parsed.verification_uri_complete,
        parsed.verificationUriComplete,
        parsed.verification_url,
        parsed.verificationUrl,
        parsed.verification_uri,
        parsed.verificationUri,
        parsed.url,
      )
      return {
        provider: 'feishu',
        ok: Boolean(verificationUrl),
        status: verificationUrl ? 'started' : 'failed',
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        command,
        args,
        verificationUrl,
        userCode: firstString(parsed.user_code, parsed.userCode),
        deviceCode: firstString(parsed.device_code, parsed.deviceCode),
        expiresIn: parseNonNegativeIntFromUnknown(parsed.expires_in ?? parsed.expiresIn, 0) || undefined,
        stdout,
        error: verificationUrl ? undefined : 'lark-cli auth login did not return a verification URL.',
      }
    } catch (error) {
      const finishedAt = Date.now()
      const typed = error as Error & { stdout?: string | Buffer | null; stderr?: string | Buffer | null }
      const stdout = stringifyCommandOutput(typed.stdout).slice(0, 12000)
      const stderr = stringifyCommandOutput(typed.stderr).slice(0, 12000)
      const text = `${typed.message}\n${stdout}\n${stderr}`.toLowerCase()
      const needsConfig = text.includes('not configured') || text.includes('config init')
      return {
        provider: 'feishu',
        ok: false,
        status: needsConfig ? 'blocked' : 'failed',
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        command,
        args,
        setupCommand: needsConfig ? 'lark-cli config init --new --lang zh' : undefined,
        stdout,
        stderr,
        error: needsConfig
          ? 'lark-cli is installed but not configured. Run config init, finish browser/mobile setup, then start auth again.'
          : typed.message,
      }
    }
  }

  private startFeishuConfigInit(): DashboardFeishuAuthStartResult {
    const startedAt = Date.now()
    const command = 'lark-cli'
    const args = ['config', 'init', '--new', '--lang', 'zh']
    const setupCommand = argsToCommand(command, args)
    if (!externalCommandExists(command)) {
      return {
        provider: 'feishu',
        ok: false,
        status: 'blocked',
        startedAt,
        finishedAt: startedAt,
        durationMs: 0,
        command,
        args,
        setupCommand,
        error: 'lark-cli is not available on PATH.',
      }
    }
    return {
      provider: 'feishu',
      ok: false,
      status: 'blocked',
      startedAt,
      finishedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      command,
      args,
      setupCommand,
      error: 'lark-cli config init is interactive. Run the setup command in a terminal, complete browser/mobile authorization, then rerun acceptance.',
    }
  }

  private latestAcceptanceHasMissingLarkConfig(): boolean {
    const report = this.getAgentOsAcceptanceReport()
    const doctor = report.steps.find(step => step.id === 'lark-cli-doctor')
    const text = `${doctor?.stdout ?? ''}\n${doctor?.stderr ?? ''}\n${doctor?.error ?? ''}`.toLowerCase()
    return doctor?.status === 'failed'
      && (text.includes('config_file:fail') || text.includes('not configured') || text.includes('config init'))
  }

  private getAgentPlatformTargets(): DashboardIntegrationProviderReport['platformTargets'] {
    return SUPPORTED_AGENTS.map(id => {
      const paths = agentPlatformPaths(this.projectDir, id)
      const installed = paths.some(candidate => existsSync(candidate.path))
      return {
        id,
        name: agentPlatformName(id),
        status: installed ? 'ready' : 'missing',
        settingsPath: paths.find(candidate => candidate.kind === 'settings')?.relative,
        knowledgeDocPath: paths.find(candidate => candidate.kind === 'knowledge')?.relative,
      }
    })
  }

  private getGovernanceMetricSummary(
    project: DashboardProjectSummary,
    sinceDays: number,
    warnings: string[],
  ): DashboardProjectOverview['metrics'] {
    try {
      const metrics = aggregateGovernanceMetrics({
        projectDir: project.projectDir,
        scaleDir: project.scaleDir,
        sinceDays,
      })
      const commandRuns = metrics.commandRuns.total
      return {
        available: true,
        commandRuns,
        failedCommandRuns: metrics.commandRuns.failed,
        commandPassRate: commandRuns > 0 ? metrics.commandRuns.passed / commandRuns : 0,
        gateFailures: metrics.gateFailures.failed,
        recentTasks: metrics.taskMetrics.recentTasks,
        recentFirstPassRate: metrics.taskMetrics.recentFirstPassRate,
      }
    } catch (error) {
      warnings.push(`governance metrics failed: ${error instanceof Error ? error.message : String(error)}`)
      return {
        available: false,
        commandRuns: 0,
        failedCommandRuns: 0,
        commandPassRate: 0,
        gateFailures: 0,
        recentTasks: 0,
        recentFirstPassRate: 0,
      }
    }
  }

  private getLocalKnowledgeSummary(
    project: DashboardProjectSummary,
    warnings: string[],
  ): DashboardProjectOverview['knowledge'] {
    const dbPath = join(project.scaleDir, 'memory', 'brain.sqlite')
    if (!existsSync(dbPath)) return { available: false, total: 0, active: 0 }
    let brain: MemoryBrain | null = null
    try {
      brain = new MemoryBrain({ projectDir: project.projectDir, scaleDir: project.scaleDir })
      const nodes = brain.list()
      return {
        available: true,
        total: nodes.length,
        active: nodes.filter(node => node.status === 'active').length,
      }
    } catch (error) {
      warnings.push(`local memory brain failed: ${error instanceof Error ? error.message : String(error)}`)
      return { available: false, total: 0, active: 0 }
    } finally {
      brain?.close()
    }
  }

  private listDocuments(): DashboardDocumentSummary[] {
    return this.listDocumentsFor(this.projectDir, this.scaleDir)
  }

  private listDocumentsFor(projectDir: string, scaleDir: string): DashboardDocumentSummary[] {
    const docs: DashboardDocumentSummary[] = []
    const addFile = (path: string) => {
      const fullPath = join(projectDir, path)
      if (!existsSync(fullPath) || !statSync(fullPath).isFile()) return
      const stat = statSync(fullPath)
      docs.push({ name: basename(path), path, type: extname(path).slice(1), size: stat.size, updatedAt: stat.mtimeMs })
    }
    const scanDir = (dir: string, prefix: string) => {
      if (!existsSync(dir)) return
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name)
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
        if (isDashboardRuntimeDocumentNoise(relPath)) continue
        if (entry.isDirectory()) {
          scanDir(fullPath, relPath)
        } else if (entry.isFile() && /\.(html|md|json)$/.test(entry.name)) {
          const stat = statSync(fullPath)
          docs.push({ name: entry.name, path: relPath, type: extname(entry.name).slice(1), size: stat.size, updatedAt: stat.mtimeMs })
        }
      }
    }
    // Scan common doc locations
    scanDir(join(scaleDir, 'docs'), '.scale/docs')
    scanDir(join(scaleDir, 'artifacts'), '.scale/artifacts')
    scanDir(join(scaleDir, 'knowledge'), '.scale/knowledge')
    scanDir(join(scaleDir, 'graphify-knowledge', 'entries'), '.scale/graphify-knowledge/entries')
    scanDir(join(projectDir, 'docs'), 'docs')
    addFile('graphify-out/GRAPH_REPORT.md')
    addFile('graphify-out/graph.json')
    addFile('graphify-out/manifest.json')
    return dedupeDocuments(docs)
  }

  private serveDocument(docPath: string, c: Context): Response {
    const resolved = this.resolveExistingDocument(docPath)
    if (resolved) {
      const ext = extname(resolved.fullPath)
      const contentType = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.json' ? 'application/json' : 'text/plain; charset=utf-8'
      const headers: Record<string, string> = { 'Content-Type': contentType, 'Cache-Control': 'no-cache' }
      if (c.req.query('download') === '1' || c.req.query('download') === 'true') {
        headers['Content-Disposition'] = contentDispositionAttachment(basename(resolved.documentPath))
      }
      return new Response(readFileSync(resolved.fullPath), { headers })
    }
    return c.json({ error: 'Document not found' }, 404)
  }

  private writeDashboardDocument(
    rawDocPath: string,
    content: string,
  ): { ok: true; document: DashboardDocumentSummary } | { ok: false; status: 400 | 404 | 413; error: string } {
    if (content.length > 2_000_000) return { ok: false, status: 413, error: 'Document content exceeds 2MB.' }
    const documentPath = normalizeDashboardDocumentPath(rawDocPath)
    if (!documentPath) return { ok: false, status: 400, error: 'Invalid document path.' }
    if (!this.isEditableDocumentPath(documentPath)) {
      return { ok: false, status: 400, error: 'Document is not editable from the dashboard.' }
    }
    const resolved = this.resolveExistingDocument(documentPath)
    if (!resolved) return { ok: false, status: 404, error: 'Document not found.' }
    const validation = validateEditableDocumentContent(documentPath, content)
    if (validation) return { ok: false, status: 400, error: validation }

    writeFileSync(resolved.fullPath, content, 'utf-8')
    return { ok: true, document: this.createDocumentSummary(documentPath, resolved.fullPath) }
  }

  private importKnowledgeDocument(input: {
    name: string
    content: string
    type?: string
  }): { ok: true; document: DashboardDocumentSummary } | { ok: false; status: 400 | 413; error: string } {
    if (input.content.length > 2_000_000) return { ok: false, status: 413, error: 'Knowledge document content exceeds 2MB.' }
    const fileName = sanitizeKnowledgeImportName(input.name, input.type)
    const documentPath = this.nextKnowledgeImportPath(fileName)
    const validation = validateEditableDocumentContent(documentPath, input.content)
    if (validation) return { ok: false, status: 400, error: validation }
    const resolved = this.resolveWritableDocument(documentPath)
    if (!resolved) return { ok: false, status: 400, error: 'Invalid knowledge import path.' }

    mkdirSync(dirname(resolved.fullPath), { recursive: true })
    writeFileSync(resolved.fullPath, input.content, 'utf-8')
    return { ok: true, document: this.createDocumentSummary(documentPath, resolved.fullPath) }
  }

  private nextKnowledgeImportPath(fileName: string): string {
    const ext = extname(fileName)
    const base = fileName.slice(0, fileName.length - ext.length)
    for (let index = 0; index < 1000; index += 1) {
      const suffix = index === 0 ? '' : `-${index + 1}`
      const candidate = `.scale/knowledge/imports/${base}${suffix}${ext}`
      if (!this.resolveExistingDocument(candidate)) return candidate
    }
    return `.scale/knowledge/imports/${base}-${Date.now()}${ext}`
  }

  private resolveExistingDocument(rawDocPath: string): { documentPath: string; fullPath: string } | null {
    const documentPath = normalizeDashboardDocumentPath(rawDocPath)
    if (!documentPath) return null
    for (const candidate of this.documentPathCandidates(documentPath)) {
      if (existsSync(candidate.fullPath) && statSync(candidate.fullPath).isFile()) return candidate
    }
    return null
  }

  private resolveWritableDocument(rawDocPath: string): { documentPath: string; fullPath: string } | null {
    const documentPath = normalizeDashboardDocumentPath(rawDocPath)
    if (!documentPath) return null
    return this.documentPathCandidates(documentPath)[0] ?? null
  }

  private documentPathCandidates(documentPath: string): Array<{ documentPath: string; fullPath: string }> {
    const candidates: Array<{ root: string; relativePath: string }> = []
    if (documentPath.startsWith('.scale/')) {
      candidates.push({ root: this.scaleDir, relativePath: documentPath.slice('.scale/'.length) })
    }
    candidates.push({ root: this.projectDir, relativePath: documentPath })
    return candidates
      .map(candidate => ({
        documentPath,
        fullPath: resolve(candidate.root, candidate.relativePath),
        root: resolve(candidate.root),
      }))
      .filter(candidate => isPathInside(candidate.fullPath, candidate.root))
      .map(({ documentPath: path, fullPath }) => ({ documentPath: path, fullPath }))
  }

  private isEditableDocumentPath(documentPath: string): boolean {
    const ext = extname(documentPath).toLowerCase()
    if (!['.md', '.json', '.html'].includes(ext)) return false
    if (documentPath.startsWith('.scale/knowledge/imports/')) return true
    const editable = new Set([
      ...this.listDocuments().map(document => document.path),
      ...this.listKnowledgeDocuments().map(document => document.path),
    ])
    return editable.has(documentPath)
  }

  private createDocumentSummary(documentPath: string, fullPath: string): DashboardDocumentSummary {
    const stat = statSync(fullPath)
    return {
      name: basename(documentPath),
      path: documentPath,
      type: extname(documentPath).slice(1),
      size: stat.size,
      updatedAt: stat.mtimeMs,
    }
  }

  private async getKnowledgeReport(options: {
    query: string
    limit: number
    includeProviders: boolean
    runRecall: boolean
    provider?: string
  }): Promise<DashboardKnowledgeReport> {
    const warnings: string[] = []
    const local = this.getLocalKnowledge(options.query, options.limit, warnings)
    let providers: MemoryProviderStatusReport | undefined
    let recall: MemoryProviderRecallReport | undefined

    if (options.includeProviders) {
      try {
        providers = inspectMemoryProviders({ projectDir: this.projectDir, scaleDir: this.scaleDir })
      } catch (error) {
        warnings.push(`memory provider status failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    if (options.runRecall && options.query.length > 0) {
      try {
        recall = await recallMemoryProviders({
          projectDir: this.projectDir,
          scaleDir: this.scaleDir,
          query: options.query,
          limit: options.limit,
          includeCandidates: true,
          provider: options.provider,
        })
      } catch (error) {
        warnings.push(`memory provider recall failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    return { project: this.currentProject, local, providers, recall, warnings }
  }

  private getLocalKnowledge(
    query: string,
    limit: number,
    warnings: string[],
  ): DashboardKnowledgeReport['local'] {
    const dbPath = join(this.scaleDir, 'memory', 'brain.sqlite')
    if (!existsSync(dbPath)) return { available: false, total: 0, byStatus: {}, nodes: [] }
    let brain: MemoryBrain | null = null
    try {
      brain = new MemoryBrain({ projectDir: this.projectDir, scaleDir: this.scaleDir })
      const allNodes = brain.list()
      const nodes = query
        ? brain.query(query, { limit }).nodes
        : allNodes.slice(0, limit)
      return {
        available: true,
        total: allNodes.length,
        byStatus: countBy(allNodes, node => node.status),
        nodes,
      }
    } catch (error) {
      warnings.push(`local memory brain failed: ${error instanceof Error ? error.message : String(error)}`)
      return { available: false, total: 0, byStatus: {}, nodes: [] }
    } finally {
      brain?.close()
    }
  }

  private getKnowledgeBaseCapabilitySummary(
    documents: DashboardDocumentSummary[],
  ): {
    documents: number
    entries: number
    graphNodes: number
    lastUpdated?: number
    warnings: string[]
  } {
    const graphPath = join(this.projectDir, 'graphify-out', 'graph.json')
    const manifestPath = join(this.scaleDir, 'graph', 'manifest.json')
    const graphStatPath = existsSync(manifestPath) ? manifestPath : existsSync(graphPath) ? graphPath : undefined
    const graphNodes = graphStatPath ? 1 : 0
    const summaryWarnings: string[] = []
    let entries = 0
    try {
      entries = this.countKnowledgeEntries()
    } catch (error) {
      summaryWarnings.push(`knowledge.db count failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    const knowledgeDocs = documents.filter(document => isKnowledgeDocument(document.path))
    const lastUpdated = latestMtimeForDocuments(knowledgeDocs, this.projectDir, this.scaleDir)
      ?? (graphStatPath ? latestMtime(graphStatPath) : undefined)
      ?? latestMtime(join(this.scaleDir, 'knowledge.db'))
    return {
      documents: knowledgeDocs.length,
      entries,
      graphNodes,
      lastUpdated,
      warnings: summaryWarnings,
    }
  }

  private countKnowledgeEntries(): number {
    const dbPath = join(this.scaleDir, 'knowledge.db')
    if (!existsSync(dbPath)) return 0
    let db: Database.Database | null = null
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true })
      const row = db.prepare('SELECT COUNT(1) AS total FROM knowledge_entries').get() as { total?: number } | undefined
      return Number(row?.total ?? 0)
    } finally {
      db?.close()
    }
  }

  private getKnowledgeBaseReport(): DashboardKnowledgeBaseReport {
    const warnings: string[] = []
    const documents = this.listKnowledgeDocuments()
    const entries = this.listKnowledgeEntries(warnings)
    const graph = this.getGraphifyKnowledgeGraph()
    const memoryGraph = this.getGbrainMemoryGraph(warnings)

    if (graph.status === 'error' && graph.emptyReason) warnings.push(graph.emptyReason)
    if (memoryGraph.status === 'error' && memoryGraph.emptyReason) warnings.push(memoryGraph.emptyReason)

    return {
      project: this.currentProject,
      generatedAt: Date.now(),
      summary: {
        documents: documents.length,
        entries: entries.length,
        graphNodes: graph.nodeCount,
        graphEdges: graph.edgeCount,
        memoryNodes: memoryGraph.nodeCount,
        memoryEdges: memoryGraph.edgeCount,
      },
      documents,
      documentTree: buildDocumentTree(documents),
      entries,
      graph,
      memoryGraph,
      exports: {
        report: '/api/knowledge-base',
        documents: '/api/documents',
        graph: graph.source,
        memoryGraph: '/api/knowledge',
      },
      warnings,
    }
  }

  private listKnowledgeDocuments(): DashboardDocumentSummary[] {
    const docs = this.listDocuments()
    const specialPaths = [
      'src/skills/karpathy-guidelines/SKILL.md',
      'docs/CODE_INTELLIGENCE.md',
      'docs/MEMORY_FABRIC.md',
      'docs/MEMORY_BRAIN.md',
      'docs/THIRD_PARTY_SKILLS.md',
      'docs/EXTERNAL_REFERENCES.md',
      '.scale/code-intelligence.json',
      '.scale/graph/manifest.json',
      'graphify-out/GRAPH_REPORT.md',
      'graphify-out/graph.json',
    ]

    for (const path of specialPaths) {
      const fullPath = join(this.projectDir, path)
      if (!existsSync(fullPath) || !statSync(fullPath).isFile()) continue
      const stat = statSync(fullPath)
      docs.push({
        name: basename(path),
        path,
        type: extname(path).slice(1),
        size: stat.size,
        updatedAt: stat.mtimeMs,
      })
    }

    return dedupeDocuments(docs).filter(document => isKnowledgeDocument(document.path))
  }

  private listKnowledgeEntries(warnings: string[]): DashboardKnowledgeEntrySummary[] {
    const dbPath = join(this.scaleDir, 'knowledge.db')
    if (!existsSync(dbPath)) return []

    let db: Database.Database | null = null
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true })
      const rows = db.prepare(`
        SELECT id, title, content, type, tags, score, createdAt, updatedAt, source
        FROM knowledge_entries
        ORDER BY updatedAt DESC
        LIMIT 200
      `).all() as KnowledgeEntryRow[]

      return rows.map(row => ({
        id: String(row.id),
        title: String(row.title || row.id),
        content: String(row.content || ''),
        type: String(row.type || 'unknown'),
        tags: parseStringList(row.tags),
        score: Number(row.score || 0),
        createdAt: Number(row.createdAt || 0),
        updatedAt: Number(row.updatedAt || 0),
        source: typeof row.source === 'string' ? row.source : undefined,
      }))
    } catch (error) {
      warnings.push(`knowledge.db read failed: ${error instanceof Error ? error.message : String(error)}`)
      return []
    } finally {
      db?.close()
    }
  }

  private getGraphifyKnowledgeGraph(): DashboardKnowledgeGraphReport {
    const graphPath = join(this.projectDir, 'graphify-out', 'graph.json')
    const reportPath = join(this.projectDir, 'graphify-out', 'GRAPH_REPORT.md')
    const manifestPath = join(this.scaleDir, 'graph', 'manifest.json')
    const source = existsSync(graphPath) ? 'graphify-out/graph.json' : existsSync(manifestPath) ? '.scale/graph/manifest.json' : 'graphify-out/graph.json'

    if (!existsSync(graphPath) && !existsSync(manifestPath)) {
      return {
        status: 'missing',
        source,
        reportPath: existsSync(reportPath) ? 'graphify-out/GRAPH_REPORT.md' : undefined,
        nodeCount: 0,
        edgeCount: 0,
        nodes: [],
        edges: [],
        emptyReason: 'Graphify graph was not found.',
      }
    }

    try {
      const raw = JSON.parse(readFileSync(existsSync(graphPath) ? graphPath : manifestPath, 'utf-8')) as unknown
      const rawNodes = extractGraphNodes(raw)
      const rawEdges = extractGraphEdges(raw)
      const nodes = rawNodes.slice(0, 160).map((node, index) => normalizeGraphNode(node, index, 'graphify'))
      const nodeIds = new Set(nodes.map(node => node.id))
      const edges = rawEdges
        .map(edge => normalizeGraphEdge(edge))
        .filter(edge => edge && nodeIds.has(edge.source) && nodeIds.has(edge.target))
        .slice(0, 260) as DashboardKnowledgeGraphEdge[]

      return {
        status: rawNodes.length > 0 ? 'ready' : 'partial',
        source,
        reportPath: existsSync(reportPath) ? 'graphify-out/GRAPH_REPORT.md' : undefined,
        nodeCount: rawNodes.length,
        edgeCount: rawEdges.length,
        nodes,
        edges,
        emptyReason: rawNodes.length > 0 ? undefined : 'Graphify graph exists but has no readable nodes.',
      }
    } catch (error) {
      return {
        status: 'error',
        source,
        reportPath: existsSync(reportPath) ? 'graphify-out/GRAPH_REPORT.md' : undefined,
        nodeCount: 0,
        edgeCount: 0,
        nodes: [],
        edges: [],
        emptyReason: `Graphify graph read failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  private getGbrainMemoryGraph(warnings: string[]): DashboardKnowledgeGraphReport {
    const dbPath = join(this.scaleDir, 'memory', 'brain.sqlite')
    if (!existsSync(dbPath)) {
      return {
        status: 'missing',
        source: '.scale/memory/brain.sqlite',
        nodeCount: 0,
        edgeCount: 0,
        nodes: [],
        edges: [],
        emptyReason: 'No local gbrain database exists.',
      }
    }

    let brain: MemoryBrain | null = null
    try {
      brain = new MemoryBrain({ projectDir: this.projectDir, scaleDir: this.scaleDir })
      const memories = brain.list()
      const nodes: DashboardKnowledgeGraphNode[] = []
      const edges: DashboardKnowledgeGraphEdge[] = []

      for (const memory of memories.slice(0, 120)) {
        const memoryId = `memory:${memory.id}`
        nodes.push({
          id: memoryId,
          label: memory.title || memory.id,
          kind: memory.type || 'memory',
          group: memory.layer || memory.status || 'memory',
          source: 'gbrain',
        })

        const layer = memory.layer || 'unknown-layer'
        const layerId = `layer:${layer}`
        if (!nodes.some(node => node.id === layerId)) {
          nodes.push({
            id: layerId,
            label: layer,
            kind: 'layer',
            group: 'memory-layer',
            source: 'gbrain',
          })
        }
        edges.push({ source: memoryId, target: layerId, label: 'layer' })

        for (const evidencePath of (memory.evidencePaths || []).slice(0, 4)) {
          const evidenceId = `evidence:${evidencePath}`
          if (!nodes.some(node => node.id === evidenceId)) {
            nodes.push({
              id: evidenceId,
              label: basename(evidencePath),
              kind: 'evidence',
              group: 'evidence',
              source: 'gbrain',
              path: evidencePath,
            })
          }
          edges.push({ source: memoryId, target: evidenceId, label: 'evidence' })
        }
      }

      return {
        status: memories.length > 0 ? 'ready' : 'partial',
        source: '.scale/memory/brain.sqlite',
        nodeCount: nodes.length,
        edgeCount: edges.length,
        nodes,
        edges: edges.slice(0, 240),
        emptyReason: memories.length > 0 ? undefined : 'The gbrain database exists but has no memory nodes.',
      }
    } catch (error) {
      warnings.push(`gbrain graph failed: ${error instanceof Error ? error.message : String(error)}`)
      return {
        status: 'error',
        source: '.scale/memory/brain.sqlite',
        nodeCount: 0,
        edgeCount: 0,
        nodes: [],
        edges: [],
        emptyReason: `gbrain graph failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    } finally {
      brain?.close()
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  private getPromptStudioReport(): DashboardPromptStudioReport {
    const warnings: string[] = []
    let phasePrompts: DashboardPromptTemplateSummary[] = []
    let packs: DashboardPromptPackSummary[] = []

    try {
      const registry = new PhasePromptRegistry(this.projectDir)
      phasePrompts = registry.listPrompts().map(prompt => ({
        ...prompt,
        source: classifyPromptSource(prompt.id),
        command: prompt.id.includes(':') ? undefined : `scale vibe --phase ${prompt.phase}`,
      }))
      packs = registry.listPacks().map(pack => ({
        id: pack.id,
        name: pack.name,
        description: pack.description,
        phases: pack.phases,
        templateIds: pack.templates.map(template => template.id),
        command: `scale vibe --pack ${pack.id}`,
        source: 'phase' as const,
      }))
    } catch (error) {
      warnings.push(`phase prompt registry failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    const vibeTemplates = listVisualVibeTemplates().map(template => ({
      ...template,
      command: `scale vibe --template ${template.id}`,
    }))
    const existingPackIds = new Set(packs.map(pack => pack.id))
    for (const pack of listVisualVibePacks()) {
      if (existingPackIds.has(pack.id)) continue
      packs.push({
        id: pack.id,
        name: pack.name,
        description: pack.description,
        phases: [],
        templateIds: pack.templateIds,
        command: `scale vibe --pack ${pack.id}`,
        source: 'vibe',
      })
    }

    return {
      project: this.currentProject,
      generatedAt: Date.now(),
      summary: {
        vibeTemplates: vibeTemplates.length,
        phasePrompts: phasePrompts.length,
        packs: packs.length,
        customPrompts: phasePrompts.filter(prompt => prompt.source !== 'builtin').length,
      },
      commands: {
        vibeIndex: 'scale vibe-index',
        vibeTemplate: 'scale vibe --template <template-id> --app "<project>"',
        vibePack: 'scale vibe --pack <pack-id> --app "<project>"',
        promptOptimize: 'scale prompt optimize --input "<raw prompt>" --json',
      },
      vibeTemplates,
      phasePrompts,
      packs,
      warnings,
    }
  }

  async start(): Promise<void> {
    try {
      const { serve } = await import('@hono/node-server')
      this.server = serve({
        fetch: this.app.fetch,
        port: this.port,
        hostname: this.host,
      })
      logger.info({ port: this.port, host: this.host }, 'Dashboard 2.0 started')
    } catch {
      // Fallback: Bun runtime
      // @ts-expect-error Bun runtime API
      if (typeof Bun !== 'undefined') {
        // @ts-expect-error Bun runtime API
        Bun.serve({ port: this.port, fetch: this.app.fetch })
        logger.info({ port: this.port }, 'Dashboard 2.0 started (Bun)')
      } else {
        throw new Error('No compatible runtime found. Install @hono/node-server for Node.js.')
      }
    }
  }

  stop(): void {
    this.server?.close()
    this.server = null
    logger.info('Dashboard 2.0 stopped')
  }

  /** Get the underlying Hono app (for testing or embedding) */
  getApp(): Hono {
    return this.app
  }
}

function normalizeProjectSummary(input: Partial<DashboardProjectSummary> & {
  projectDir: string
  scaleDir: string
}): DashboardProjectSummary {
  const projectDir = resolve(input.projectDir)
  const scaleDir = resolve(input.scaleDir)
  const name = input.name?.trim() || basename(projectDir) || 'project'
  return {
    id: input.id?.trim() || safeProjectId(name),
    name,
    projectDir,
    scaleDir,
    url: input.url,
    current: input.current,
  }
}

function normalizeProjectList(
  projects: DashboardProjectSummary[] | undefined,
  currentProject: DashboardProjectSummary,
): DashboardProjectSummary[] {
  const input = projects && projects.length > 0 ? projects : [currentProject]
  const seen = new Set<string>()
  const normalized: DashboardProjectSummary[] = []
  for (const project of input) {
    const item = normalizeProjectSummary({
      ...project,
      current: project.id === currentProject.id || project.projectDir === currentProject.projectDir,
    })
    let id = item.id
    let suffix = 2
    while (seen.has(id)) id = `${item.id}-${suffix++}`
    seen.add(id)
    normalized.push({ ...item, id })
  }
  if (!normalized.some(project => project.current)) {
    normalized.unshift(currentProject)
  }
  return normalized.map(project => ({ ...project, current: project.projectDir === currentProject.projectDir }))
}

function stringifyCommandOutput(value: string | Buffer | null | undefined): string {
  if (!value) return ''
  return typeof value === 'string' ? value : value.toString('utf8')
}

function summarizeCommandOutputForReport(value: string | Buffer | null | undefined, limit = 2000): string | undefined {
  const normalized = stringifyCommandOutput(value)
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .trim()
  if (!normalized) return undefined
  const parsed = parseJsonObject(normalized)
  if (parsed) {
    const parts: string[] = []
    if (typeof parsed.ok === 'boolean') parts.push(`ok=${parsed.ok}`)
    if (Array.isArray(parsed.skills)) {
      const names = parsed.skills
        .map(item => isRecordValue(item) ? normalizeSingleLine(item.name, '') : '')
        .filter(Boolean)
      parts.push(`skills=${names.length}`)
      if (names.length > 0) parts.push(`sample=${names.slice(0, 8).join(', ')}`)
    }
    if (Array.isArray(parsed.checks)) {
      const checks = parsed.checks
        .map(item => {
          if (!isRecordValue(item)) return ''
          const name = normalizeSingleLine(item.name, '')
          const status = normalizeSingleLine(item.status, '')
          return name && status ? `${name}:${status}` : ''
        })
        .filter(Boolean)
      if (checks.length > 0) parts.push(`checks=${checks.join(', ')}`)
    }
    if (isRecordValue(parsed._notice)) parts.push('notice=true')
    if (parts.length > 0) return parts.join('; ')
  }
  const safe = normalized
    .replace(/["\\]/g, "'")
    .replace(/[^\t\n\r\x20-\x7E\u0080-\uFFFF]/g, '')
  if (safe.length <= limit) return safe
  return `[truncated to last ${limit} chars]\n${safe.slice(-limit)}`
}

function argsToCommand(command: string, args: string[]): string {
  return [command, ...args].map(part => /^[a-z0-9_./:@=-]+$/i.test(part) ? part : `"${part.replace(/"/g, '\\"')}"`).join(' ')
}

function agentPlatformName(id: string): string {
  const names: Record<string, string> = {
    'claude-code': 'Claude Code',
    codex: 'OpenAI Codex',
    opencode: 'OpenCode',
    cursor: 'Cursor',
    gemini: 'Gemini CLI',
    openclaw: 'OpenClaw',
    hermes: 'Hermes',
    trae: 'Trae',
    workbuddy: 'WorkBuddy',
    vsc: 'VS Code/VSC',
    qcoder: 'QCoder',
    'deepseek-tui': 'DeepSeek TUI',
    aider: 'Aider',
    windsurf: 'Windsurf',
    kimi: 'Kimi',
    doubao: 'Doubao',
    kiro: 'Kiro',
    qoder: 'Qoder',
    jcode: 'JCode',
    cline: 'Cline',
    kilocode: 'Kilo Code',
    antigravity: 'Antigravity',
  }
  return names[id] ?? id
}

function agentPlatformPaths(projectDir: string, id: string): Array<{ kind: 'settings' | 'knowledge'; path: string; relative: string }> {
  const pair = (settings: string, knowledge: string) => [
    { kind: 'settings' as const, relative: settings, path: join(projectDir, settings) },
    { kind: 'knowledge' as const, relative: knowledge, path: join(projectDir, knowledge) },
  ]
  const genericSettings = `.${id}/settings.json`
  const genericKnowledge = 'AGENTS.md'
  const mapping: Record<string, Array<{ kind: 'settings' | 'knowledge'; path: string; relative: string }>> = {
    'claude-code': pair('.claude/settings.json', 'CLAUDE.md'),
    codex: pair('.codex/hooks.json', 'AGENTS.md'),
    opencode: pair('.opencode/hooks.json', 'AGENTS.md'),
    cursor: pair('.cursor/settings.json', '.cursorrules'),
    gemini: pair('.gemini/settings.json', 'GEMINI.md'),
    openclaw: pair('.openclaw/settings.json', 'AGENTS.md'),
    hermes: pair('.hermes/settings.json', '.hermes.md'),
    trae: pair('.trae/settings.json', 'TRAE.md'),
    workbuddy: pair('.workbuddy/settings.json', 'WORKBUDDY.md'),
    vsc: pair('.vscode/scale.json', 'VSC.md'),
    qcoder: pair('.qwen/settings.json', 'QWEN.md'),
    'deepseek-tui': pair('.deepseek/config.toml', '.deepseek/instructions.md'),
    aider: pair('.aider.conf.yml', 'AIDER.md'),
    windsurf: pair('.windsurf/settings.json', '.windsurf/rules.md'),
    kimi: pair('.kimi/settings.json', '.kimi/rules.md'),
    doubao: pair('.doubao/settings.json', '.doubao/rules.md'),
    kiro: pair('.kiro/settings.json', '.kiro/rules/SCALE.md'),
    qoder: pair('.qoder/settings.json', '.qoder/rules/SCALE.md'),
    jcode: pair('.jcode/settings.json', 'JCODE.md'),
    cline: pair('.cline/settings.json', '.clinerules/SCALE.md'),
    kilocode: pair('.kilocode/settings.json', 'AGENTS.md'),
    antigravity: pair('.agents/hooks.json', '.agents/rules/SCALE.md'),
  }
  return mapping[id] ?? pair(genericSettings, genericKnowledge)
}

const CONNECTOR_PROVIDER_PRESETS: DashboardConnectorWorkflowReport['providerPresets'] = [
  {
    id: 'minimax',
    name: 'MiniMax',
    tier: 1,
    agents: ['claude-code', 'codex', 'opencode'],
    models: ['MiniMax-M3', 'MiniMax-M3-highspeed', 'MiniMax-M2.7'],
    features: ['1M context', 'OpenAI-compatible', 'Anthropic-compatible', 'multimodal'],
    authFields: ['baseUrl', 'apiKey', 'model'],
    source: 'cc-connect provider preset model',
  },
  {
    id: 'aigocode',
    name: 'AIGoCode',
    tier: 2,
    agents: ['claude-code', 'codex', 'gemini', 'opencode'],
    models: ['claude-sonnet', 'gpt-codex', 'gemini-pro'],
    features: ['Claude Code', 'Codex', 'Gemini', 'relay API'],
    authFields: ['baseUrl', 'apiKey', 'model'],
    source: 'cc-connect provider preset model',
  },
  {
    id: 'aihubmix',
    name: 'AIHubMix',
    tier: 2,
    agents: ['claude-code', 'codex', 'gemini', 'opencode'],
    models: ['claude', 'gpt', 'gemini', 'qwen', 'deepseek'],
    features: ['multi-format API', 'high concurrency', 'global model catalog'],
    authFields: ['baseUrl', 'apiKey', 'model'],
    source: 'cc-connect provider preset model',
  },
  {
    id: 'dmxapi',
    name: 'DMXAPI',
    tier: 2,
    agents: ['claude-code', 'codex', 'opencode'],
    models: ['claude', 'gpt', 'gemini'],
    features: ['model relay', 'enterprise billing', 'OpenAI-compatible'],
    authFields: ['baseUrl', 'apiKey', 'model'],
    source: 'cc-connect provider preset model',
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    tier: 2,
    agents: ['codex', 'opencode', 'gemini'],
    models: ['qwen', 'deepseek', 'multimodal'],
    features: ['China-friendly API', 'multimodal', 'pay as you go'],
    authFields: ['baseUrl', 'apiKey', 'model'],
    source: 'cc-connect provider preset model',
  },
]

const CONNECTOR_SKILL_PRESETS: DashboardConnectorWorkflowReport['skillPresets'] = [
  {
    id: 'gbrain-memory',
    name: 'gbrain local memory',
    required: true,
    defaultInstall: true,
    category: 'memory',
    reason: 'Persistent local memory is mandatory for full remote-agent workflow recall and summaries.',
  },
  {
    id: 'find-skills',
    name: 'Find Skills',
    required: true,
    defaultInstall: true,
    category: 'skill-discovery',
    reason: 'Agents must be able to discover missing third-party capabilities instead of leaving setup incomplete.',
  },
  {
    id: 'feishu-card',
    name: 'Feishu card rendering',
    required: false,
    defaultInstall: true,
    category: 'message-channel',
    reason: 'Rich mobile cards make approvals, task completion, and summaries easier to review from Feishu.',
  },
  {
    id: 'feishu-doc-reader',
    name: 'Feishu document reader',
    required: false,
    defaultInstall: true,
    category: 'knowledge-provider',
    reason: 'Remote coding needs external docs and Feishu wiki/doc context as first-class retrieval inputs.',
  },
  {
    id: 'hookify-rules',
    name: 'Hook rules',
    required: true,
    defaultInstall: true,
    category: 'loop-engineering',
    reason: 'Hooks drive permission notices, long-task completion pushes, context summary cards, and daemon health loops.',
  },
  {
    id: 'configure-notifications',
    name: 'Notification setup',
    required: true,
    defaultInstall: true,
    category: 'message-channel',
    reason: 'Agent tasks must push permission, failure, completion, and review events to mobile channels.',
  },
]

function defaultAgentConnectConfig(project: DashboardProjectSummary, dashboardPort = 3210): DashboardAgentConnectConfig {
  return {
    version: 1,
    enabled: false,
    managementApi: {
      enabled: false,
      host: '127.0.0.1',
      port: 9820,
      hasToken: false,
      corsOrigins: [`http://127.0.0.1:${dashboardPort}`],
    },
    bridge: {
      enabled: false,
      host: '127.0.0.1',
      port: 9810,
      path: '/bridge/ws',
      hasToken: false,
      allowPlatforms: ['feishu', 'bridge-custom'],
      defaultProjectId: project.id,
      protocolVersion: 1,
    },
    webhook: {
      enabled: false,
      path: '/agent-connect/webhook',
      hasToken: false,
    },
    automation: {
      cronEnabled: false,
      heartbeatEnabled: false,
      heartbeatIntervalMins: 30,
      maxTurnTimeMins: 0,
      resetOnIdleMins: 30,
      longTaskNotifications: true,
    },
    updatedAt: Date.now(),
  }
}

function normalizeAgentConnectConfig(
  input: unknown,
  project: DashboardProjectSummary,
  previous?: DashboardAgentConnectConfig,
): DashboardAgentConnectConfig {
  const source = isRecordValue(input) ? input : {}
  const fallback = previous ?? defaultAgentConnectConfig(project)
  const managementSource = isRecordValue(source.managementApi) ? source.managementApi : {}
  const bridgeSource = isRecordValue(source.bridge) ? source.bridge : {}
  const webhookSource = isRecordValue(source.webhook) ? source.webhook : {}
  const automationSource = isRecordValue(source.automation) ? source.automation : {}
  const managementToken = normalizeOptionalSingleLine(managementSource.token)
  const bridgeToken = normalizeOptionalSingleLine(bridgeSource.token)
  const webhookToken = normalizeOptionalSingleLine(webhookSource.token)
  const allowPlatforms = toStringArray(bridgeSource.allowPlatforms).length > 0
    ? toStringArray(bridgeSource.allowPlatforms)
    : fallback.bridge.allowPlatforms
  const corsOrigins = toStringArray(managementSource.corsOrigins).length > 0
    ? toStringArray(managementSource.corsOrigins)
    : fallback.managementApi.corsOrigins
  return {
    version: 1,
    enabled: normalizeBoolean(source.enabled, fallback.enabled),
    managementApi: {
      enabled: normalizeBoolean(managementSource.enabled, fallback.managementApi.enabled),
      host: normalizeHost(managementSource.host, fallback.managementApi.host),
      port: normalizePort(managementSource.port, fallback.managementApi.port),
      hasToken: Boolean(managementToken) || normalizeBoolean(managementSource.hasToken, fallback.managementApi.hasToken),
      tokenMasked: managementToken ? maskSecret(managementToken) : normalizeOptionalSingleLine(managementSource.tokenMasked) ?? fallback.managementApi.tokenMasked,
      corsOrigins,
    },
    bridge: {
      enabled: normalizeBoolean(bridgeSource.enabled, fallback.bridge.enabled),
      host: normalizeHost(bridgeSource.host, fallback.bridge.host),
      port: normalizePort(bridgeSource.port, fallback.bridge.port),
      path: normalizeUrlPath(bridgeSource.path, fallback.bridge.path),
      hasToken: Boolean(bridgeToken) || normalizeBoolean(bridgeSource.hasToken, fallback.bridge.hasToken),
      tokenMasked: bridgeToken ? maskSecret(bridgeToken) : normalizeOptionalSingleLine(bridgeSource.tokenMasked) ?? fallback.bridge.tokenMasked,
      allowPlatforms,
      defaultProjectId: normalizeSingleLine(bridgeSource.defaultProjectId, project.id),
      protocolVersion: 1,
    },
    webhook: {
      enabled: normalizeBoolean(webhookSource.enabled, fallback.webhook.enabled),
      path: normalizeUrlPath(webhookSource.path, fallback.webhook.path),
      hasToken: Boolean(webhookToken) || normalizeBoolean(webhookSource.hasToken, fallback.webhook.hasToken),
      tokenMasked: webhookToken ? maskSecret(webhookToken) : normalizeOptionalSingleLine(webhookSource.tokenMasked) ?? fallback.webhook.tokenMasked,
    },
    automation: {
      cronEnabled: normalizeBoolean(automationSource.cronEnabled, fallback.automation.cronEnabled),
      heartbeatEnabled: normalizeBoolean(automationSource.heartbeatEnabled, fallback.automation.heartbeatEnabled),
      heartbeatIntervalMins: parsePositiveIntFromUnknown(automationSource.heartbeatIntervalMins, fallback.automation.heartbeatIntervalMins),
      maxTurnTimeMins: parseNonNegativeIntFromUnknown(automationSource.maxTurnTimeMins, fallback.automation.maxTurnTimeMins),
      resetOnIdleMins: parseNonNegativeIntFromUnknown(automationSource.resetOnIdleMins, fallback.automation.resetOnIdleMins),
      longTaskNotifications: normalizeBoolean(automationSource.longTaskNotifications, fallback.automation.longTaskNotifications),
    },
    updatedAt: Date.now(),
  }
}

function normalizeBridgeSession(input: unknown, project: DashboardProjectSummary): DashboardBridgeSession | null {
  if (!isRecordValue(input)) return null
  const id = normalizeOptionalSingleLine(input.id)
  const agentSessionId = normalizeOptionalSingleLine(input.agentSessionId)
  if (!id || !agentSessionId) return null
  return {
    id,
    projectId: normalizeSingleLine(input.projectId, project.id),
    projectName: normalizeSingleLine(input.projectName, project.name),
    platform: normalizeSingleLine(input.platform, 'bridge-custom'),
    agentPlatformId: normalizeSingleLine(input.agentPlatformId, normalizeSingleLine(input.platformId, 'codex')),
    agentSessionId,
    scope: normalizeBridgeScope(input.scope),
    user: normalizeSingleLine(input.user, 'remote-user'),
    title: normalizeSingleLine(input.title, agentSessionId),
    active: normalizeBoolean(input.active, false),
    capabilities: toStringArray(input.capabilities),
    createdAt: parseNonNegativeIntFromUnknown(input.createdAt, Date.now()),
    updatedAt: parseNonNegativeIntFromUnknown(input.updatedAt, Date.now()),
    lastSeenAt: parseNonNegativeIntFromUnknown(input.lastSeenAt, 0) || undefined,
  }
}

function normalizeBridgeScope(value: unknown): DashboardBridgeSession['scope'] {
  const normalized = String(value ?? 'user').trim().toLowerCase()
  return normalized === 'chat' || normalized === 'thread' || normalized === 'project' || normalized === 'user'
    ? normalized
    : 'user'
}

function normalizeBridgeMessageText(input: Record<string, unknown>): string {
  const direct = firstString(input.text, input.message)
  if (direct) return direct
  const content = isRecordValue(input.content) ? input.content : {}
  const contentText = firstString(content.text, content.message)
  if (contentText) return contentText
  const event = isRecordValue(input.event) ? input.event : {}
  const eventText = firstString(event.text, event.message)
  if (eventText) return eventText
  return ''
}

function sanitizeBridgePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}
  const secretKeys = new Set(['token', 'secret', 'authorization', 'password', 'webhooksecret'])
  for (const [key, value] of Object.entries(payload)) {
    if (secretKeys.has(key.toLowerCase())) {
      sanitized[key] = '***'
      continue
    }
    sanitized[key] = value
  }
  return sanitized
}

function buildAgentConnectConfigSummary(
  config: DashboardAgentConnectConfig,
  configPath: string,
  warnings: string[] = [],
): DashboardAgentConnectConfigSummary {
  const missing: string[] = []
  if (!config.enabled) missing.push('Agent Connect workflow is disabled.')
  if (config.managementApi.enabled && !config.managementApi.hasToken) missing.push('Management API requires a token before remote control is allowed.')
  if (config.bridge.enabled && !config.bridge.hasToken) missing.push('Bridge requires a token before adapters can connect.')
  if (config.bridge.enabled && config.bridge.allowPlatforms.length === 0) missing.push('Bridge has no allowed adapter platforms.')
  if (config.webhook.enabled && !config.webhook.hasToken) missing.push('Webhook endpoint requires a token before external triggers are accepted.')
  const endpoints = {
    managementApi: `http://${config.managementApi.host}:${config.managementApi.port}/api/v1`,
    bridgeWebSocket: `ws://${config.bridge.host}:${config.bridge.port}${config.bridge.path}`,
    webhook: `http://${config.managementApi.host}:${config.managementApi.port}${config.webhook.path}`,
  }
  const configured = config.enabled
    && (!config.managementApi.enabled || config.managementApi.hasToken)
    && (!config.bridge.enabled || (config.bridge.hasToken && config.bridge.allowPlatforms.length > 0))
    && (!config.webhook.enabled || config.webhook.hasToken)
  return {
    ...config,
    configPath,
    configured,
    endpoints,
    commands: [
      'scale dashboard daemon ensure --dir .',
      'GET /api/integrations/agent-connect',
      'PUT /api/integrations/agent-connect',
      'GET /api/agent-control',
    ],
    warnings: [...warnings, ...missing],
  }
}

function buildConnectorChannelCatalog(
  config: DashboardAgentConnectConfigSummary,
  feishuProvider?: DashboardIntegrationProviderReport,
): DashboardConnectorChannel[] {
  const feishuWarnings = feishuProvider?.warnings ?? []
  const feishuConfiguredRoutes = feishuProvider?.routeConfigs?.filter(route => route.configured).length ?? 0
  const bridgeStatus: DashboardDataSourceStatus = config.bridge.enabled
    ? config.bridge.hasToken && config.bridge.allowPlatforms.length > 0 ? 'ready' : 'partial'
    : 'missing'
  const channel = (
    item: Omit<DashboardConnectorChannel, 'status' | 'warnings'> & {
      status?: DashboardDataSourceStatus
      warnings?: string[]
    },
  ): DashboardConnectorChannel => ({
    ...item,
    status: item.status ?? 'missing',
    warnings: item.warnings ?? [],
  })
  return [
    channel({
      id: 'dashboard-local',
      name: 'Dashboard local chat',
      status: 'ready',
      transport: ['REST', 'local queue'],
      publicUrlRequired: 'no',
      configScope: 'session',
      sessionScope: 'project',
      capabilities: ['text', 'model-switch', 'mode-switch', 'inbox', 'reply'],
      authModes: [{ id: 'local', label: 'Local dashboard', description: 'Uses the local dashboard session and Agent Control queue.', fields: ['sessionId'], sensitive: false }],
      defaultSetup: ['Open Dashboard > Agents and create a session.'],
      notes: ['Use this when no external message platform is configured.'],
      recommended: true,
    }),
    channel({
      id: 'feishu',
      name: 'Feishu/Lark',
      status: feishuProvider?.status ?? 'missing',
      transport: ['WebSocket', 'event consume', 'REST send'],
      publicUrlRequired: 'no',
      configScope: 'agent-platform',
      sessionScope: 'chat',
      capabilities: ['text', 'image', 'file', 'card', 'buttons', 'mentions', 'mobile-notification', 'command-intake'],
      authModes: [
        { id: 'cli-profile', label: 'lark-cli profile', description: 'Recommended machine profile login.', fields: ['profile'], sensitive: true, setupCommand: 'lark-cli auth login --recommend --no-wait' },
        { id: 'app-secret', label: 'App ID / Secret', description: 'Custom app credentials stored outside git.', fields: ['appId', 'appSecret'], sensitive: true, setupCommand: 'lark-cli config init --new --lang zh' },
        { id: 'qr', label: 'QR authorization', description: 'Interactive mobile/browser login.', fields: ['loginSession'], sensitive: true },
      ],
      defaultSetup: ['lark-cli config init --new --lang zh', 'lark-cli auth login --recommend --no-wait', 'Save one route per agent platform in Dashboard > Integrations.'],
      notes: [`Configured routes: ${feishuConfiguredRoutes}`],
      recommended: true,
      warnings: feishuWarnings,
    }),
    channel({
      id: 'wecom',
      name: 'WeCom',
      transport: ['WebSocket', 'Webhook'],
      publicUrlRequired: 'optional',
      configScope: 'agent-platform',
      sessionScope: 'chat',
      capabilities: ['text', 'image', 'voice', 'file', 'mentions'],
      authModes: [{ id: 'app-secret', label: 'Corp/App secret', description: 'Corp ID, agent ID, secret, and callback token.', fields: ['corpId', 'agentId', 'secret', 'token', 'aesKey'], sensitive: true }],
      defaultSetup: ['Create a WeCom app, then map it to an agent platform route.'],
      notes: ['Webhook mode needs public URL; WebSocket mode can avoid public ingress.'],
      recommended: false,
    }),
    channel({
      id: 'dingtalk',
      name: 'DingTalk',
      transport: ['stream', 'Webhook'],
      publicUrlRequired: 'optional',
      configScope: 'agent-platform',
      sessionScope: 'chat',
      capabilities: ['text', 'image', 'file', 'richText', 'mentions'],
      authModes: [{ id: 'app-secret', label: 'Client ID / Secret', description: 'DingTalk app credentials.', fields: ['clientId', 'clientSecret'], sensitive: true }],
      defaultSetup: ['Create a DingTalk app and bind callback/stream credentials.'],
      notes: ['Good fallback for China enterprise teams.'],
      recommended: false,
    }),
    channel({
      id: 'slack',
      name: 'Slack',
      transport: ['Socket Mode', 'Events API'],
      publicUrlRequired: 'optional',
      configScope: 'agent-platform',
      sessionScope: 'thread',
      capabilities: ['text', 'file', 'thread', 'assistant-api', 'buttons'],
      authModes: [{ id: 'token', label: 'Bot/App tokens', description: 'Slack bot token and app token.', fields: ['botToken', 'appToken', 'signingSecret'], sensitive: true }],
      defaultSetup: ['Create Slack app, enable Socket Mode or Events API, then bind project route.'],
      notes: ['Thread session scope maps well to parallel agent tasks.'],
      recommended: false,
    }),
    channel({
      id: 'telegram',
      name: 'Telegram',
      transport: ['long-poll', 'Webhook'],
      publicUrlRequired: 'optional',
      configScope: 'agent-platform',
      sessionScope: 'user',
      capabilities: ['text', 'image', 'file', 'audio', 'buttons'],
      authModes: [{ id: 'token', label: 'Bot token', description: 'BotFather token.', fields: ['token'], sensitive: true }],
      defaultSetup: ['Create Telegram bot and paste token into machine profile or secret store.'],
      notes: ['Webhook mode needs public URL; long-poll is simpler for local use.'],
      recommended: false,
    }),
    channel({
      id: 'discord',
      name: 'Discord',
      transport: ['Gateway', 'Interactions'],
      publicUrlRequired: 'optional',
      configScope: 'agent-platform',
      sessionScope: 'thread',
      capabilities: ['text', 'file', 'thread', 'buttons', 'typing'],
      authModes: [{ id: 'token', label: 'Bot token', description: 'Discord bot token and intents.', fields: ['token', 'intents'], sensitive: true }],
      defaultSetup: ['Create Discord application, enable bot intents, and bind project route.'],
      notes: ['Thread isolation is useful for multi-agent project rooms.'],
      recommended: false,
    }),
    channel({
      id: 'matrix',
      name: 'Matrix',
      transport: ['sync API'],
      publicUrlRequired: 'no',
      configScope: 'agent-platform',
      sessionScope: 'chat',
      capabilities: ['text', 'encrypted-room', 'file', 'auto-join'],
      authModes: [{ id: 'token', label: 'Access token', description: 'Matrix homeserver access token.', fields: ['homeserver', 'accessToken', 'userId'], sensitive: true }],
      defaultSetup: ['Create Matrix account and generate a dedicated access token.'],
      notes: ['Works well for self-hosted collaboration rooms.'],
      recommended: false,
    }),
    channel({
      id: 'qq',
      name: 'QQ OneBot',
      transport: ['OneBot'],
      publicUrlRequired: 'no',
      configScope: 'agent-platform',
      sessionScope: 'chat',
      capabilities: ['text', 'image', 'file'],
      authModes: [{ id: 'token', label: 'OneBot token', description: 'NapCat/OneBot connection token.', fields: ['baseUrl', 'accessToken'], sensitive: true }],
      defaultSetup: ['Run a OneBot-compatible gateway and bind the base URL.'],
      notes: ['Unofficial bridge quality depends on the local gateway.'],
      recommended: false,
    }),
    channel({
      id: 'qqbot',
      name: 'QQ official bot',
      transport: ['Gateway', 'Interactions'],
      publicUrlRequired: 'optional',
      configScope: 'agent-platform',
      sessionScope: 'chat',
      capabilities: ['text', 'inline-keyboard', 'mentions'],
      authModes: [{ id: 'app-secret', label: 'App ID / Secret', description: 'QQ bot app credentials.', fields: ['appId', 'appSecret', 'token'], sensitive: true }],
      defaultSetup: ['Create QQ bot, enable interaction intent, then bind route.'],
      notes: ['Use official bots when compliance matters.'],
      recommended: false,
    }),
    channel({
      id: 'weixin-ilink',
      name: 'Weixin ilink',
      transport: ['ilink API', 'QR setup'],
      publicUrlRequired: 'no',
      configScope: 'machine',
      sessionScope: 'user',
      capabilities: ['text', 'image', 'file', 'mobile-notification'],
      authModes: [{ id: 'qr', label: 'QR/token bind', description: 'Scan QR or bind an existing bearer token.', fields: ['token', 'accountId'], sensitive: true }],
      defaultSetup: ['Run setup, scan QR, and store token outside git.'],
      notes: ['Use only where personal-account bridge policy is acceptable.'],
      recommended: false,
    }),
    channel({
      id: 'wps-xiezuo',
      name: 'WPS collaboration',
      transport: ['OpenAPI'],
      publicUrlRequired: 'optional',
      configScope: 'agent-platform',
      sessionScope: 'chat',
      capabilities: ['text', 'document-context', 'collaboration'],
      authModes: [{ id: 'app-secret', label: 'App ID / Secret', description: 'WPS collaboration app credentials.', fields: ['appId', 'appSecret', 'baseUrl'], sensitive: true }],
      defaultSetup: ['Create WPS collaboration app and bind route.'],
      notes: ['Useful for document-heavy Chinese enterprise workflows.'],
      recommended: false,
    }),
    channel({
      id: 'max-webhook',
      name: 'MAX webhook',
      transport: ['long-poll', 'Webhook'],
      publicUrlRequired: 'optional',
      configScope: 'agent-platform',
      sessionScope: 'chat',
      capabilities: ['text', 'webhook-delivery'],
      authModes: [{ id: 'token', label: 'Bot token / webhook secret', description: 'MAX bot token and webhook secret.', fields: ['token', 'webhookUrl', 'webhookSecret'], sensitive: true }],
      defaultSetup: ['Use long-poll for local testing and webhook for high traffic.'],
      notes: ['Webhook mode should sit behind a reverse proxy in production.'],
      recommended: false,
    }),
    channel({
      id: 'bridge-custom',
      name: 'Custom Bridge adapter',
      status: bridgeStatus,
      transport: ['WebSocket', 'REST sessions'],
      publicUrlRequired: 'no',
      configScope: 'project',
      sessionScope: 'project',
      capabilities: ['text', 'image', 'file', 'audio', 'card', 'buttons', 'stream-preview'],
      authModes: [{ id: 'token', label: 'Bridge token', description: 'Required shared token for external adapters.', fields: ['token', 'allowPlatforms'], sensitive: true }],
      defaultSetup: ['Enable Bridge in Dashboard > Integrations > Agent Connect.', 'Connect adapter to ws://host:port/bridge/ws?token=*** and send register.'],
      notes: ['Best path for platforms not built into SCALE yet.'],
      recommended: true,
      warnings: bridgeStatus === 'ready' ? [] : ['Bridge is not fully configured.'],
    }),
  ]
}

function buildConnectorAutomationLoops(config: DashboardAgentConnectConfigSummary): DashboardConnectorWorkflowReport['automationLoops'] {
  return [
    {
      id: 'permission-request',
      name: 'Permission request push',
      enabled: config.enabled && config.automation.longTaskNotifications,
      trigger: 'Agent requests approval or a write-capable command is blocked.',
      action: 'Push a short approval card to the configured message channel.',
      guardrail: 'Never auto-approve destructive actions.',
    },
    {
      id: 'long-task-complete',
      name: 'Long task completion push',
      enabled: config.enabled && config.automation.longTaskNotifications,
      trigger: 'Agent turn completes, fails, or times out.',
      action: 'Send mobile completion/failure notification with evidence link.',
      guardrail: 'Send summary only; keep full logs in local evidence.',
    },
    {
      id: 'context-summary',
      name: 'Context summary card',
      enabled: config.enabled,
      trigger: 'Context approaches compression or the session ends.',
      action: 'Persist summary card to project knowledge and optionally push to message channel.',
      guardrail: 'Review before importing external/private content into memory.',
    },
    {
      id: 'cron',
      name: 'Cron prompt/command loop',
      enabled: config.automation.cronEnabled,
      trigger: 'Scheduled time or delayed timer.',
      action: 'Run prompt or guarded shell command against a target session.',
      guardrail: 'Use explicit session_key and dry-run for writes until verified.',
    },
    {
      id: 'heartbeat',
      name: 'Heartbeat awareness loop',
      enabled: config.automation.heartbeatEnabled,
      trigger: `Every ${config.automation.heartbeatIntervalMins} minute(s) while idle.`,
      action: 'Ask agent to check inbox/tasks with full session context.',
      guardrail: 'Skip when the session is busy.',
    },
    {
      id: 'daemon-watchdog',
      name: 'Dashboard daemon watchdog',
      enabled: config.enabled,
      trigger: 'Dashboard health probe fails or service process exits.',
      action: 'Restart resident dashboard service and keep local panel reachable.',
      guardrail: 'Record restart count and last error under .scale/artifacts/dashboard-service.',
    },
  ]
}

function defaultFeishuRouteConfig(project: DashboardProjectSummary, platformId = 'codex'): DashboardFeishuRouteConfig {
  const safePlatformId = (SUPPORTED_AGENTS as readonly string[]).includes(platformId) ? platformId : 'codex'
  return {
    version: 1,
    enabled: true,
    routeId: `feishu-${safeProjectId(project.id || project.name)}-${safeProjectId(safePlatformId)}`,
    routeName: `${project.name} ${agentPlatformName(safePlatformId)} Feishu route`,
    projectId: project.id,
    projectDir: project.projectDir,
    agentPlatformId: safePlatformId,
    agentSessionId: 'default',
    targetType: 'chat',
    targetId: '',
    eventKey: 'im.message.receive_v1',
    commandPrefix: '/scale',
    allowWriteCommands: false,
    importKnowledge: true,
    updatedAt: Date.now(),
  }
}

function dedupeFeishuRoutes(routes: DashboardFeishuRouteConfig[]): DashboardFeishuRouteConfig[] {
  const byPlatform = new Map<string, DashboardFeishuRouteConfig>()
  for (const route of routes) {
    if (!route.agentPlatformId) continue
    byPlatform.set(route.agentPlatformId, route)
  }
  return [...byPlatform.values()].sort((left, right) => left.agentPlatformId.localeCompare(right.agentPlatformId))
}

function normalizeFeishuRouteConfig(
  input: unknown,
  project: DashboardProjectSummary,
  options: { strict?: boolean } = {},
): DashboardFeishuRouteConfig {
  const source = isRecordValue(input) ? input : {}
  const fallback = defaultFeishuRouteConfig(project)
  const explicitTargetType = typeof source.targetType === 'string' ? source.targetType.trim().toLowerCase() : ''
  if (options.strict && explicitTargetType && explicitTargetType !== 'chat' && explicitTargetType !== 'user') {
    throw new Error('Feishu route targetType must be "chat" or "user".')
  }
  const agentPlatformId = normalizeSingleLine(source.agentPlatformId, fallback.agentPlatformId)
  const supportedAgentIds = SUPPORTED_AGENTS as readonly string[]
  if (options.strict && agentPlatformId && !supportedAgentIds.includes(agentPlatformId)) {
    throw new Error(`Unsupported agent platform for Feishu route: ${agentPlatformId}`)
  }
  const commandPrefix = normalizeCommandPrefix(source.commandPrefix, fallback.commandPrefix)
  return {
    version: 1,
    enabled: normalizeBoolean(source.enabled, fallback.enabled),
    routeId: normalizeSingleLine(source.routeId, fallback.routeId),
    routeName: normalizeSingleLine(source.routeName, fallback.routeName),
    projectId: project.id,
    projectDir: project.projectDir,
    agentPlatformId: supportedAgentIds.includes(agentPlatformId) ? agentPlatformId : fallback.agentPlatformId,
    agentSessionId: normalizeSingleLine(source.agentSessionId, fallback.agentSessionId),
    targetType: explicitTargetType === 'user' ? 'user' : 'chat',
    targetId: normalizeSingleLine(source.targetId, fallback.targetId),
    eventKey: normalizeSingleLine(source.eventKey, fallback.eventKey),
    commandPrefix,
    allowWriteCommands: normalizeBoolean(source.allowWriteCommands, fallback.allowWriteCommands),
    importKnowledge: normalizeBoolean(source.importKnowledge, fallback.importKnowledge),
    notes: normalizeOptionalSingleLine(source.notes),
    updatedAt: Date.now(),
  }
}

function normalizeSingleLine(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.replace(/[\r\n\t]+/g, ' ').trim()
  return normalized || fallback
}

function normalizeOptionalSingleLine(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/[\r\n\t]+/g, ' ').trim()
  return normalized || undefined
}

function normalizeOptionalLongText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/\u0000/g, '').trim()
  if (!normalized) return undefined
  return normalized.length > 4000 ? `[truncated to last 4000 chars]\n${normalized.slice(-4000)}` : normalized
}

function normalizeCommandPrefix(value: unknown, fallback: string): string {
  const normalized = normalizeSingleLine(value, fallback)
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function normalizeHost(value: unknown, fallback: string): string {
  const normalized = normalizeSingleLine(value, fallback)
  return /^[a-z0-9.-]+$/i.test(normalized) ? normalized : fallback
}

function normalizeUrlPath(value: unknown, fallback: string): string {
  const normalized = normalizeSingleLine(value, fallback)
  const path = normalized.startsWith('/') ? normalized : `/${normalized}`
  return /^\/[a-z0-9/_-]+$/i.test(path) ? path : fallback
}

function normalizePort(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function defaultTencentImaKnowledgeProviderConfig(): DashboardKnowledgeProviderConfig {
  return {
    version: 1,
    provider: 'tencent-ima',
    enabled: false,
    authMode: 'api-key',
    clientId: '',
    knowledgeBaseId: '',
    hasApiKey: false,
    qrAuthorized: false,
    updatedAt: Date.now(),
  }
}

function normalizeTencentImaKnowledgeProviderConfig(input: unknown): DashboardKnowledgeProviderConfig {
  const source = isRecordValue(input) ? input : {}
  const fallback = defaultTencentImaKnowledgeProviderConfig()
  const authMode = source.authMode === 'qr' ? 'qr' : 'api-key'
  return {
    version: 1,
    provider: 'tencent-ima',
    enabled: normalizeBoolean(source.enabled, fallback.enabled),
    authMode,
    clientId: normalizeSingleLine(source.clientId, fallback.clientId),
    knowledgeBaseId: normalizeSingleLine(source.knowledgeBaseId, fallback.knowledgeBaseId),
    hasApiKey: normalizeBoolean(source.hasApiKey, fallback.hasApiKey),
    apiKeyMasked: normalizeOptionalSingleLine(source.apiKeyMasked),
    qrAuthorized: normalizeBoolean(source.qrAuthorized, fallback.qrAuthorized),
    notes: normalizeOptionalSingleLine(source.notes),
    updatedAt: Date.now(),
  }
}

function buildTencentImaKnowledgeProviderSummary(
  config: DashboardKnowledgeProviderConfig,
  configPath: string,
  warnings: string[] = [],
): DashboardKnowledgeProviderSummary {
  const missing: string[] = []
  if (!config.enabled) missing.push('Tencent ima provider is disabled.')
  if (!config.clientId) missing.push('Tencent ima Client ID is not configured.')
  if (!config.knowledgeBaseId) missing.push('Tencent ima knowledge-base ID is not configured.')
  if (config.authMode === 'api-key' && !config.hasApiKey) missing.push('Tencent ima API Key has not been marked as configured.')
  if (config.authMode === 'qr' && !config.qrAuthorized) missing.push('Tencent ima QR authorization has not been completed.')
  return {
    ...config,
    configPath,
    configured: missing.length === 0,
    consoleUrl: 'https://ima.qq.com/agent-interface',
    authLabel: config.authMode === 'qr' ? 'QR authorization' : 'Client ID / API Key',
    warnings: [...warnings, ...missing],
  }
}

function maskSecret(secret: string): string {
  const normalized = secret.trim()
  if (normalized.length <= 8) return '***'
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`
}

function generateAgentConnectSecret(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString('hex')}`
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)))
}

function normalizeAgentOsAcceptanceReport(input: unknown, path: string): DashboardAgentOsAcceptanceReport {
  const source = isRecordValue(input) ? input : {}
  const steps = Array.isArray(source.steps)
    ? source.steps.flatMap((item): DashboardAgentOsAcceptanceStep[] => {
        if (!isRecordValue(item)) return []
        const id = normalizeSingleLine(item.id, '')
        const label = normalizeSingleLine(item.label, id)
        if (!id || !label) return []
        const statusText = normalizeSingleLine(item.status, 'failed')
        const status: DashboardAgentOsAcceptanceStep['status'] = statusText === 'passed' || statusText === 'blocked' ? statusText : 'failed'
        const command = normalizeOptionalSingleLine(item.command)
        return [{
          id,
          label,
          status,
          startedAt: parseNonNegativeIntFromUnknown(item.startedAt, 0),
          finishedAt: parseNonNegativeIntFromUnknown(item.finishedAt, 0),
          durationMs: parseNonNegativeIntFromUnknown(item.durationMs, 0),
          command,
          args: toStringArray(item.args),
          stdout: normalizeOptionalLongText(item.stdout),
          stderr: normalizeOptionalLongText(item.stderr),
          error: normalizeOptionalLongText(item.error),
        }]
      })
    : []
  const statusText = normalizeSingleLine(source.status, 'missing')
  const status: DashboardAgentOsAcceptanceReport['status'] = statusText === 'passed' || statusText === 'failed' || statusText === 'blocked'
    ? statusText
    : 'missing'
  return {
    ok: normalizeBoolean(source.ok, status === 'passed'),
    status,
    score: Math.max(0, Math.min(100, parseNonNegativeIntFromUnknown(source.score, 0))),
    generatedAt: parseNonNegativeIntFromUnknown(source.generatedAt, 0),
    path,
    steps,
    warnings: toStringArray(source.warnings),
    nextActions: toStringArray(source.nextActions),
  }
}

function acceptanceNextActions(steps: DashboardAgentOsAcceptanceStep[]): string[] {
  const actions: string[] = []
  const byId = new Map(steps.map(step => [step.id, step]))
  if (byId.get('lark-cli-doctor')?.status !== 'passed') {
    actions.push('Run lark-cli config init --new --lang zh, then complete browser/mobile authorization and rerun acceptance.')
  }
  if (byId.get('feishu-route-target')?.status !== 'passed') {
    actions.push('Save a real Feishu chat_id or open_id route target for the active agent platform.')
  }
  if (byId.get('tencent-ima-provider')?.status !== 'passed') {
    actions.push('Configure Tencent ima Client ID, knowledge-base ID, and API Key or QR authorization.')
  }
  if (byId.get('dashboard-daemon')?.status !== 'passed') {
    actions.push('Run scale dashboard daemon ensure --dir . --port 3210 --json.')
  }
  return uniqueStrings(actions)
}

function isDashboardRuntimeDocumentNoise(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase()
  return normalized.startsWith('.scale/artifacts/dashboard-service/')
    || /\/dashboard-service-[^/]+\.(json|md|html)$/.test(normalized)
}

function isPlaceholderFeishuTarget(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return !normalized
    || normalized.includes('<')
    || normalized.includes('>')
    || normalized.includes('xxx')
    || normalized.includes('example')
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeProjectId(name: string): string {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return id || 'project'
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function parsePositiveIntFromUnknown(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function parseNonNegativeIntFromUnknown(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function classifyPromptSource(id: string): DashboardPromptSource {
  if (id.startsWith('project:')) return 'project'
  if (id.startsWith('global:')) return 'global'
  return 'builtin'
}

function normalizeDashboardPromptLanguage(value: unknown): PromptOptimizationLanguageInput {
  const normalized = String(value ?? 'auto').trim().toLowerCase()
  return normalized === 'zh' || normalized === 'en' || normalized === 'auto' ? normalized : 'auto'
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(',').map(item => item.trim()).filter(Boolean)
  return []
}

function normalizeDashboardTaskLevel(value: unknown): SkillTaskLevel {
  const normalized = String(value ?? 'M').trim().toUpperCase()
  if (normalized === 'S' || normalized === 'M' || normalized === 'L' || normalized === 'CRITICAL') return normalized
  return 'M'
}

function escapeJsonForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function normalizeMemoryReviewAction(value: string | undefined): MemoryReviewAction | null {
  if (!value) return null
  return (MEMORY_REVIEW_ACTIONS as readonly string[]).includes(value) ? value as MemoryReviewAction : null
}

function normalizeDashboardDocumentPath(rawPath: string): string | null {
  try {
    const decoded = rawPath
      .split('/')
      .map(segment => decodeURIComponent(segment))
      .join('/')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
    if (!decoded || decoded.includes('\0')) return null
    if (decoded.startsWith('../') || decoded.includes('/../') || decoded === '..') return null
    if (/^[a-zA-Z]:\//.test(decoded)) return null
    return decoded
  } catch {
    return null
  }
}

function validateEditableDocumentContent(documentPath: string, content: string): string | null {
  if (extname(documentPath).toLowerCase() !== '.json') return null
  try {
    JSON.parse(content)
    return null
  } catch (error) {
    return `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`
  }
}

function sanitizeKnowledgeImportName(name: string, type?: string): string {
  const requestedExt = extname(name).toLowerCase()
  const typeExt = typeof type === 'string' ? `.${type.replace(/^\./, '').toLowerCase()}` : ''
  const ext = ['.md', '.json', '.html'].includes(requestedExt)
    ? requestedExt
    : ['.md', '.json', '.html'].includes(typeExt)
      ? typeExt
      : '.md'
  const withoutExt = requestedExt ? name.slice(0, name.length - requestedExt.length) : name
  const safeBase = withoutExt
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^\.+/, '')
    .replace(/-+/g, '-')
    .slice(0, 80)
  return `${safeBase || 'knowledge-note'}${ext}`
}

function contentDispositionAttachment(fileName: string): string {
  const asciiName = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

function isPathInside(fullPath: string, root: string): boolean {
  const normalizedFullPath = resolve(fullPath)
  const normalizedRoot = resolve(root)
  const rel = relative(normalizedRoot, normalizedFullPath)
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

interface KnowledgeEntryRow {
  id: unknown
  title: unknown
  content: unknown
  type: unknown
  tags: unknown
  score: unknown
  createdAt: unknown
  updatedAt: unknown
  source?: unknown
}

function dedupeDocuments(documents: DashboardDocumentSummary[]): DashboardDocumentSummary[] {
  const seen = new Map<string, DashboardDocumentSummary>()
  for (const document of documents) {
    if (!seen.has(document.path)) seen.set(document.path, document)
  }
  return [...seen.values()].sort((left, right) => left.path.localeCompare(right.path))
}

function buildDocumentTree(documents: DashboardDocumentSummary[]): DashboardDocumentTreeNode[] {
  const roots: DashboardDocumentTreeNode[] = []
  const folderByPath = new Map<string, DashboardDocumentTreeNode>()

  const ensureFolder = (parts: string[], depth: number): DashboardDocumentTreeNode[] => {
    if (depth >= parts.length) return roots
    const path = parts.slice(0, depth + 1).join('/')
    const parentChildren = depth === 0 ? roots : ensureFolder(parts, depth - 1)
    let folder = folderByPath.get(path)
    if (!folder) {
      folder = { name: parts[depth] || path, path, type: 'folder', children: [] }
      folderByPath.set(path, folder)
      parentChildren.push(folder)
    }
    return folder.children ?? []
  }

  for (const document of documents) {
    const parts = document.path.split('/').filter(Boolean)
    const folderParts = parts.slice(0, -1)
    const children = folderParts.length > 0 ? ensureFolder(folderParts, folderParts.length - 1) : roots
    children.push({
      name: document.name,
      path: document.path,
      type: 'document',
      size: document.size,
      docType: document.type,
    })
  }

  const sortTree = (nodes: DashboardDocumentTreeNode[]) => {
    nodes.sort((left, right) => {
      if (left.type !== right.type) return left.type === 'folder' ? -1 : 1
      return left.name.localeCompare(right.name)
    })
    for (const node of nodes) sortTree(node.children ?? [])
  }
  sortTree(roots)
  return roots
}

function isKnowledgeDocument(path: string): boolean {
  const normalized = path.toLowerCase()
  const keywords = [
    'knowledge',
    'memory',
    'graph',
    'code-intelligence',
    'code_intelligence',
    'karpathy',
    'llm',
    'context',
    'skill',
    'workflow',
    'governance',
  ]
  return normalized.startsWith('.scale/knowledge/')
    || normalized.startsWith('.scale/graphify-knowledge/')
    || normalized.startsWith('graphify-out/')
    || keywords.some(keyword => normalized.includes(keyword))
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  if (typeof value !== 'string') return []
  const trimmed = value.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed)) return parsed.map(item => String(item).trim()).filter(Boolean)
  } catch {
    // Fall back to comma-separated tags.
  }
  return trimmed.split(',').map(item => item.trim()).filter(Boolean)
}

function extractGraphNodes(raw: unknown): Record<string, unknown>[] {
  const record = asRecord(raw)
  const candidates = [
    record.nodes,
    asRecord(record.graph).nodes,
    asRecord(record.elements).nodes,
    asRecord(record.data).nodes,
  ]
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue
    return candidate
      .map(item => asRecord(asRecord(item).data ?? item))
      .filter(item => Object.keys(item).length > 0)
  }
  return []
}

function extractGraphEdges(raw: unknown): Record<string, unknown>[] {
  const record = asRecord(raw)
  const candidates = [
    record.edges,
    record.links,
    asRecord(record.graph).edges,
    asRecord(record.graph).links,
    asRecord(record.elements).edges,
    asRecord(record.data).edges,
  ]
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue
    return candidate
      .map(item => asRecord(asRecord(item).data ?? item))
      .filter(item => Object.keys(item).length > 0)
  }
  return []
}

function normalizeGraphNode(
  node: Record<string, unknown>,
  index: number,
  source: string,
): DashboardKnowledgeGraphNode {
  const id = firstString(node.id, node.key, node.name, node.path, node.label) || `${source}:node:${index}`
  const label = firstString(node.label, node.name, node.title, node.path, node.id) || id
  const kind = firstString(node.kind, node.type, node.category, node.nodeType) || 'node'
  const group = firstString(node.group, node.layer, node.domain, node.package, node.kind, node.type) || kind
  return {
    id,
    label,
    kind,
    group,
    source,
    path: firstString(node.path, node.file, node.filePath),
  }
}

function normalizeGraphEdge(edge: Record<string, unknown>): DashboardKnowledgeGraphEdge | null {
  const source = firstString(edge.source, edge.from, edge.src, edge.start, edge.sourceId)
  const target = firstString(edge.target, edge.to, edge.dst, edge.end, edge.targetId)
  if (!source || !target) return null
  return {
    source,
    target,
    label: firstString(edge.label, edge.type, edge.kind, edge.relation),
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text.trim()) as unknown
    return isRecordValue(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return undefined
}

function countBy<T>(items: T[], selector: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const key = selector(item)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

function sum<T>(items: T[], selector: (item: T) => number): number {
  return items.reduce((total, item) => total + selector(item), 0)
}

function summarizeDataSources(dataSources: DashboardDataSourceSignal[]): DashboardCapabilityReport['summary'] {
  return {
    total: dataSources.length,
    ready: dataSources.filter(source => source.status === 'ready').length,
    partial: dataSources.filter(source => source.status === 'partial').length,
    missing: dataSources.filter(source => source.status === 'missing').length,
    error: dataSources.filter(source => source.status === 'error').length,
  }
}

function countMatchingFiles(dir: string, predicate: (file: string) => boolean): number {
  if (!existsSync(dir)) return 0
  let count = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name)
    if (entry.isDirectory()) {
      count += countMatchingFiles(absolute, predicate)
      continue
    }
    if (entry.isFile() && predicate(entry.name)) count += 1
  }
  return count
}

function inspectAiOsAgentCollaborationReports(dir: string): {
  totalReports: number
  withAgentCollaboration: number
  settledAgentExecution: number
  lastUpdated?: number
} {
  if (!existsSync(dir)) return { totalReports: 0, withAgentCollaboration: 0, settledAgentExecution: 0 }
  let totalReports = 0
  let withAgentCollaboration = 0
  let settledAgentExecution = 0
  let lastUpdated: number | undefined
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = inspectAiOsAgentCollaborationReports(absolute)
      totalReports += nested.totalReports
      withAgentCollaboration += nested.withAgentCollaboration
      settledAgentExecution += nested.settledAgentExecution
      if (nested.lastUpdated && (!lastUpdated || nested.lastUpdated > lastUpdated)) lastUpdated = nested.lastUpdated
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    totalReports += 1
    const modified = statSync(absolute).mtimeMs
    if (!lastUpdated || modified > lastUpdated) lastUpdated = modified
    try {
      const parsed = JSON.parse(readFileSync(absolute, 'utf-8')) as {
        plan?: { agentCollaboration?: unknown }
        agentExecution?: { status?: unknown }
      }
      if (parsed.plan?.agentCollaboration && typeof parsed.plan.agentCollaboration === 'object') {
        withAgentCollaboration += 1
      }
      if (parsed.agentExecution?.status === 'settled') {
        settledAgentExecution += 1
      }
    } catch {
      // Invalid historical reports should not break dashboard capability discovery.
    }
  }
  return { totalReports, withAgentCollaboration, settledAgentExecution, lastUpdated }
}

function latestMtime(path: string, options: { maxEntries?: number; maxDepth?: number } = {}): number | undefined {
  if (!existsSync(path)) return undefined
  const stat = statSync(path)
  if (stat.isFile()) return stat.mtimeMs
  const maxEntries = options.maxEntries ?? 1200
  const maxDepth = options.maxDepth ?? 8
  let latest = stat.mtimeMs
  let scanned = 0
  const stack: Array<{ path: string; depth: number }> = [{ path, depth: 0 }]
  while (stack.length > 0 && scanned < maxEntries) {
    const current = stack.pop()
    if (!current) break
    let entries: Dirent<string>[]
    try {
      entries = readdirSync(current.path, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (scanned >= maxEntries) break
      scanned += 1
      const childPath = join(current.path, entry.name)
      let childStat
      try {
        childStat = statSync(childPath)
      } catch {
        continue
      }
      if (childStat.mtimeMs > latest) latest = childStat.mtimeMs
      if (entry.isDirectory() && current.depth < maxDepth) {
        stack.push({ path: childPath, depth: current.depth + 1 })
      }
    }
  }
  return latest
}

function latestMtimeForDocuments(
  documents: Array<{ path: string }>,
  projectDir: string,
  scaleDir: string,
): number | undefined {
  let latest: number | undefined
  for (const document of documents) {
    const candidates = [join(projectDir, document.path), join(scaleDir, document.path)]
    for (const candidate of candidates) {
      const value = latestMtime(candidate)
      if (value && (!latest || value > latest)) latest = value
    }
  }
  return latest
}
