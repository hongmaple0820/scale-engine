<script setup lang="ts">
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { GraphChart } from 'echarts/charts'
import { LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ECharts, EChartsOption } from 'echarts'
import {
  darkTheme,
  enUS,
  NAlert,
  NButton,
  NCard,
  NConfigProvider,
  NDataTable,
  NDescriptions,
  NDescriptionsItem,
  NEmpty,
  NInput,
  NInputGroup,
  NLayout,
  NLayoutContent,
  NLayoutHeader,
  NLayoutSider,
  NList,
  NListItem,
  NMenu,
  NProgress,
  NSelect,
  NSpace,
  NSkeleton,
  NSpin,
  NStatistic,
  NSwitch,
  NTabPane,
  NTabs,
  NTag,
  NText,
  NThing,
  zhCN,
  type DataTableColumns,
} from 'naive-ui'

echarts.use([GraphChart, LegendComponent, TooltipComponent, CanvasRenderer])

type Lang = 'zh' | 'en'
type PageKey = 'overview' | 'workflow' | 'topology' | 'monitoring' | 'costs' | 'knowledge' | 'agents' | 'integrations' | 'documents' | 'prompts'
type SourceStatus = 'ready' | 'partial' | 'missing' | 'error'
type RefreshMode = 'sse' | 'polling' | 'manual' | 'snapshot'
type MonitorTab = 'overview' | 'detectors' | 'defects' | 'commands'
type KnowledgeTab = 'base' | 'memory' | 'graph'
type GraphKey = 'graphify' | 'memory'
type LoadKey = 'projects' | 'capabilities' | 'dashboardService' | 'metrics' | 'state' | 'topology' | 'domains' | 'documents' | 'knowledge' | 'knowledgeBase' | 'integrations' | 'agentControl' | 'prompts'
type CommandCenterArea = 'agent' | 'channel' | 'knowledge' | 'loop' | 'cost'
type IntegrationTab = 'overview' | 'messages' | 'agent-connect' | 'knowledge' | 'automation' | 'diagnostics'

interface ProjectSummary {
  id: string
  name: string
  projectDir: string
  scaleDir: string
  url?: string
  current?: boolean
}

interface DataSourceSignal {
  id: string
  title: string
  description: string
  status: SourceStatus
  refreshMode: RefreshMode
  source: string
  count?: number
  lastUpdated?: number
  emptyReason?: string
  action?: string
}

interface CapabilityReport {
  project: ProjectSummary
  generatedAt: number
  summary: { total: number; ready: number; partial: number; missing: number; error: number }
  realtime: {
    status: SourceStatus
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
  dataSources: DataSourceSignal[]
  warnings: string[]
}

interface DashboardServiceStatus {
  status: 'running' | 'starting' | 'stopped' | 'unhealthy' | 'unknown'
  projectDir: string
  scaleDir: string
  host: string
  port: number
  url: string
  healthUrl: string
  serviceDir: string
  statusPath: string
  logPath: string
  serverLogPath: string
  launcherPath: string
  supervisorPid?: number
  serverPid?: number
  supervisorAlive: boolean
  serverAlive: boolean
  lastHeartbeatAt?: number
  lastStartedAt?: number
  lastRestartAt?: number
  restartCount: number
  lastError?: string
  taskName?: string
  installed: boolean
}

interface IntegrationCommandPlan {
  command: string
  args: string[]
  risk: 'read' | 'write'
  requiresConfirmation: boolean
  description: string
}

type FeishuRouteTargetType = 'chat' | 'user'

interface FeishuRouteConfig {
  version: 1
  enabled: boolean
  routeId: string
  routeName: string
  projectId: string
  projectDir: string
  agentPlatformId: string
  agentSessionId: string
  targetType: FeishuRouteTargetType
  targetId: string
  eventKey: string
  commandPrefix: string
  allowWriteCommands: boolean
  importKnowledge: boolean
  notes?: string
  updatedAt: number
}

interface FeishuRouteSummary extends FeishuRouteConfig {
  configPath: string
  configured: boolean
  platformStatus: SourceStatus
  targetLabel: string
  dryRunSendPlan?: IntegrationCommandPlan
  eventConsumePlan: IntegrationCommandPlan
  warnings: string[]
}

interface IntegrationProviderReport {
  id: string
  name: string
  category: 'message-channel' | 'knowledge-provider'
  description: string
  status: SourceStatus
  command: string
  commandAvailable: boolean
  commandPath?: string
  configBoundary: string
  authModes: Array<{
    id: 'cli-profile' | 'app-secret' | 'api-key' | 'qr'
    label: string
    description: string
    status: SourceStatus
    configured: boolean
    sensitive: boolean
    fields: string[]
    setupCommand?: string
    authUrl?: string
  }>
  setupCommands: string[]
  verifyCommands: string[]
  dryRunSendPlan?: IntegrationCommandPlan
  eventConsumePlan?: IntegrationCommandPlan
  routeConfig?: FeishuRouteSummary
  routeConfigs?: FeishuRouteSummary[]
  knowledgeConfig?: KnowledgeProviderSummary
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
    status: SourceStatus
    settingsPath?: string
    knowledgeDocPath?: string
  }>
  actions: Array<{
    id: string
    label: string
    kind: 'probe' | 'dry-run' | 'read'
    plan: IntegrationCommandPlan
  }>
  safetyRules: string[]
  nextAction?: string
  warnings: string[]
}

interface IntegrationRouteUpdateResult {
  provider: 'feishu'
  ok: boolean
  saved: boolean
  route: FeishuRouteSummary
  routes?: FeishuRouteSummary[]
  error?: string
}

interface KnowledgeProviderConfig {
  version: 1
  provider: 'tencent-ima'
  enabled: boolean
  authMode: 'api-key' | 'qr'
  clientId: string
  knowledgeBaseId: string
  hasApiKey: boolean
  apiKeyMasked?: string
  qrAuthorized: boolean
  notes?: string
  updatedAt: number
}

interface KnowledgeProviderSummary extends KnowledgeProviderConfig {
  configPath: string
  configured: boolean
  consoleUrl: string
  authLabel: string
  warnings: string[]
}

interface KnowledgeProviderUpdateResult {
  provider: 'tencent-ima'
  ok: boolean
  saved: boolean
  config: KnowledgeProviderSummary
  error?: string
}

interface IntegrationActionResult {
  provider: string
  action: string
  ok: boolean
  status: 'passed' | 'failed' | 'blocked'
  startedAt: number
  finishedAt: number
  durationMs: number
  plan?: IntegrationCommandPlan
  stdout?: string
  stderr?: string
  error?: string
}

interface FeishuAuthStartResult {
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

type ConnectorConfigScope = 'machine' | 'workspace' | 'project' | 'agent-platform' | 'session'
type ConnectorPublicUrlRequirement = 'no' | 'optional' | 'yes'

interface ConnectorAuthMode {
  id: string
  label: string
  description: string
  fields: string[]
  sensitive: boolean
  setupCommand?: string
}

interface ConnectorChannel {
  id: string
  name: string
  status: SourceStatus
  transport: string[]
  publicUrlRequired: ConnectorPublicUrlRequirement
  configScope: ConnectorConfigScope
  sessionScope: 'user' | 'chat' | 'thread' | 'project'
  capabilities: string[]
  authModes: ConnectorAuthMode[]
  defaultSetup: string[]
  notes: string[]
  recommended: boolean
  warnings: string[]
}

interface AgentConnectConfig {
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

interface AgentConnectConfigSummary extends AgentConnectConfig {
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

interface AgentConnectUpdateResult {
  ok: boolean
  saved: boolean
  config: AgentConnectConfigSummary
  error?: string
}

interface AgentOsBootstrapResult extends AgentConnectUpdateResult {
  agentOs?: AgentOsReadinessReport
  secrets?: {
    path: string
    rawStored: boolean
    tokens: {
      managementApi: string
      bridge: string
      webhook: string
    }
  }
  actions?: string[]
  warnings?: string[]
}

interface ConnectorWorkflowReport {
  summary: { channels: number; readyChannels: number; partialChannels: number; agentPlatforms: number; providerPresets: number; skillPresets: number; automationLoops: number }
  config: AgentConnectConfigSummary
  channels: ConnectorChannel[]
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
  providerPresets: Array<{ id: string; name: string; tier: number; agents: string[]; models: string[]; features: string[]; authFields: string[]; source: string }>
  skillPresets: Array<{ id: string; name: string; required: boolean; defaultInstall: boolean; category: string; reason: string }>
  automationLoops: Array<{ id: string; name: string; enabled: boolean; trigger: string; action: string; guardrail: string }>
  daemon: { status: DashboardServiceStatus['status']; serviceDir: string; healthUrl: string; installed: boolean; supervisorAlive: boolean; commands: string[]; hooks: string[] }
  configModel: Array<{ scope: ConnectorConfigScope; owner: string; storage: string; examples: string[] }>
  commands: { configure: string[]; verify: string[]; agentRuntime: string[] }
  warnings: string[]
}

interface AgentOsReadinessStage {
  id: string
  title: string
  description: string
  status: SourceStatus
  score: number
  tab: IntegrationTab
  primaryAction: string
  evidence: string[]
  blockers: string[]
  commands: string[]
}

interface AgentOsReadinessReport {
  score: number
  status: SourceStatus
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
  stages: AgentOsReadinessStage[]
}

interface AgentOsAcceptanceStep {
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

interface AgentOsAcceptanceReport {
  ok: boolean
  status: 'passed' | 'failed' | 'blocked' | 'missing'
  score: number
  generatedAt: number
  path: string
  steps: AgentOsAcceptanceStep[]
  warnings: string[]
  nextActions: string[]
}

interface IntegrationsReport {
  project: ProjectSummary
  generatedAt: number
  summary: { providers: number; ready: number; partial: number; missing: number }
  providers: IntegrationProviderReport[]
  connectorWorkflow: ConnectorWorkflowReport
  agentOs: AgentOsReadinessReport
  acceptance: AgentOsAcceptanceReport
  warnings: string[]
}

type AgentControlMode = 'dry-run' | 'interactive' | 'live-guarded'
type AgentControlMessageStatus = 'queued' | 'claimed' | 'completed' | 'failed' | 'cancelled' | 'blocked' | 'delivered'
type AgentControlWorkbenchTab = 'chat' | 'history' | 'summary' | 'setup'

interface AgentControlModelOption {
  id: string
  label: string
  provider: string
  tier: string
  modelId: string
  maxTokens: number
  costPerMToken: number
  modalities: string[]
}

interface AgentControlSession {
  version: 1
  sessionId: string
  name: string
  platformId: string
  platformName: string
  platformStatus: SourceStatus
  modelId: string
  model?: AgentControlModelOption
  channelProvider: 'dashboard' | 'feishu'
  channelRouteId: string
  commandPrefix: string
  mode: AgentControlMode
  autoImportKnowledge: boolean
  updatedAt: number
  status: SourceStatus | 'blocked'
  channel: {
    provider: 'dashboard' | 'feishu'
    configured: boolean
    targetLabel: string
    routeId: string
  }
  messageCount: number
  pendingCount: number
  lastMessageAt?: number
  warnings: string[]
}

interface AgentControlMessage {
  id: string
  sessionId: string
  direction: 'operator-to-agent' | 'agent-to-operator' | 'system'
  from: string
  to: string
  text: string
  status: AgentControlMessageStatus
  createdAt: number
  platformId: string
  modelId: string
  channelProvider: 'dashboard' | 'feishu'
  channelRouteId: string
  dryRun: boolean
  commandPlan?: IntegrationCommandPlan
  responsePreview?: string
  claimedBy?: string
  claimedAt?: number
  completedAt?: number
  result?: 'completed' | 'failed' | 'cancelled'
  evidencePath?: string
  warnings: string[]
}

interface AgentControlReport {
  project: ProjectSummary
  generatedAt: number
  summary: { sessions: number; ready: number; partial: number; missing: number; queuedMessages: number; claimedMessages: number; completedMessages: number; failedMessages: number }
  modelOptions: AgentControlModelOption[]
  platformTargets: IntegrationProviderReport['platformTargets']
  sessions: AgentControlSession[]
  messages: AgentControlMessage[]
  commands: { pollInbox: string; claimMessage: string; completeMessage: string; postReply: string; sendMessage: string; getTranscript?: string; searchTranscripts?: string; summarizeSession?: string; cliPoll: string; cliReply: string }
  warnings: string[]
}

interface AgentConversationSummary {
  sessionId: string
  title: string
  generatedAt: number
  messageCount: number
  operatorMessages: number
  agentMessages: number
  pendingMessages: number
  completedMessages: number
  blockedMessages: number
  firstMessageAt?: number
  lastMessageAt?: number
  latestOperatorText?: string
  latestAgentText?: string
  openItems: string[]
  decisions: string[]
  nextActions: string[]
  warnings: string[]
  markdown: string
}

interface AgentTranscriptReport {
  session: AgentControlSession
  generatedAt: number
  messageCount: number
  messages: AgentControlMessage[]
  summary: AgentConversationSummary
  storage: { messagesPath: string; summaryPath: string }
}

interface AgentTranscriptSearchHit {
  sessionId: string
  sessionName: string
  platformName: string
  message: AgentControlMessage
  matchPreview: string
}

interface AgentTranscriptSearchReport {
  query: string
  generatedAt: number
  total: number
  hits: AgentTranscriptSearchHit[]
}

interface CommandCenterCheck {
  id: string
  area: CommandCenterArea
  title: string
  description: string
  status: SourceStatus
  metric: string
  actionLabel: string
  page: PageKey
}

interface CommandCenterPath {
  id: string
  title: string
  description: string
  status: SourceStatus
  page: PageKey
  steps: Array<{ label: string; status: SourceStatus }>
}

interface AgentSessionDraft {
  sessionId: string
  name: string
  platformId: string
  modelId: string
  channelProvider: 'dashboard' | 'feishu'
  commandPrefix: string
  mode: AgentControlMode
  autoImportKnowledge: boolean
}

interface MetricsReport {
  taskMetrics?: { recentTasks?: number; recentFirstPassRate?: number }
  gateFailures?: { total?: number; failed?: number; byGate?: Record<string, number> }
  commandRuns?: {
    total: number
    passed: number
    failed: number
    rawEstimatedTokens: number
    compressedEstimatedTokens: number
    savedEstimatedTokens: number
  }
  modelUsage?: {
    totalRecords: number
    totalInputTokens: number
    totalOutputTokens: number
    totalTokens: number
    cacheEligibleTokens: number
    cacheCreationInputTokens: number
    cacheReadInputTokens: number
    cachedTokens: number
    cacheSavingsTokens: number
    estimatedCostUsd?: number
    byProvider: Record<string, { records: number; totalTokens: number; cacheSavingsTokens: number }>
  }
}

interface GateSummary {
  name: string
  required: boolean
  passed: boolean
}

interface ArtifactTreeNode {
  id: string
  type: string
  title: string
  status: string
  version: number
  children: ArtifactTreeNode[]
  gates?: GateSummary[]
}

interface DetectorStat {
  name: string
  totalTriggers: number
  bySeverity: Record<string, number>
  lastTrigger?: number
}

interface RecentDefect {
  id: string
  title: string
  rootCause: string
  severity: string
  detector: string
  createdAt: number
}

interface AutoDefectStats {
  totalDefects: number
  autoCreatedCount: number
  byRootCause: Record<string, number>
  bySeverity: Record<string, number>
  recentDefects: RecentDefect[]
}

interface RecentEvent {
  type: string
  timestamp: number
  artifactId?: string
  data?: Record<string, unknown>
}

interface DashboardState {
  artifacts?: ArtifactTreeNode[]
  evolutionMetrics?: Record<string, unknown> | null
  detectorStats?: DetectorStat[]
  autoDefectStats?: AutoDefectStats | null
  recentEvents?: RecentEvent[]
  timestamp?: number
}

interface TopologyNode {
  id: string
  name?: string
  kind?: string
  layer?: string
  filePath?: string
  line?: number
  signature?: string
  domain?: string
}

interface TopologyEdge {
  source: string
  target: string
  kind?: string
}

interface TopologyReport {
  nodes?: TopologyNode[]
  edges?: TopologyEdge[]
}

interface DomainSummary {
  id: string
  name: string
  nodes: TopologyNode[]
  count: number
}

interface DocumentItem {
  name: string
  path: string
  type: string
  size: number
}

interface KnowledgeNode {
  id: string
  title?: string
  summary?: string
  status?: string
  confidence?: number
  layer?: string
  type?: string
  source?: string
  evidencePaths?: string[]
}

interface KnowledgeReport {
  local?: {
    available: boolean
    total: number
    byStatus: Record<string, number>
    nodes: KnowledgeNode[]
  }
  providers?: Record<string, unknown>
  recall?: Record<string, unknown>
  warnings?: string[]
}

interface KnowledgeEntry {
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

interface KnowledgeGraphNode {
  id: string
  label: string
  kind: string
  group: string
  source: string
  path?: string
}

interface KnowledgeGraphEdge {
  source: string
  target: string
  label?: string
}

interface KnowledgeGraphReport {
  status: SourceStatus
  source: string
  reportPath?: string
  nodeCount: number
  edgeCount: number
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
  emptyReason?: string
}

interface KnowledgeBaseReport {
  summary?: {
    documents: number
    entries: number
    graphNodes: number
    graphEdges: number
    memoryNodes: number
    memoryEdges: number
  }
  documents?: DocumentItem[]
  entries?: KnowledgeEntry[]
  graph?: KnowledgeGraphReport
  memoryGraph?: KnowledgeGraphReport
  exports?: Record<string, string>
  warnings?: string[]
}

interface PromptItem {
  id?: string
  name?: string
  title?: string
  description?: string
  command?: string
  copyPrompt?: string
  template?: string
  templateIds?: string[]
  phases?: string[]
  phase?: string
  role?: string
  bestFor?: string[]
  scaleWorkflow?: string[]
  suggestedSkills?: string[]
  suggestedTools?: string[]
  outputs?: string[]
  coachingQuestions?: string[]
  methodologyReferences?: string[]
  source?: string
  kind?: 'vibe' | 'phase' | 'pack'
  label?: string
}

interface PromptReport {
  summary?: { vibeTemplates: number; phasePrompts: number; packs: number; customPrompts: number }
  commands?: Record<string, string>
  vibeTemplates?: PromptItem[]
  phasePrompts?: PromptItem[]
  packs?: PromptItem[]
  warnings?: string[]
}

interface AgentPlanReport {
  project?: ProjectSummary
  generatedAt?: number
  task?: { taskId?: string; task: string; level: string; files: string[]; services: string[] }
  governance?: { effectiveMode: string; workflowProfile: string; evaluatorRisk: string }
  toolStrategy?: { totalSteps: number; requiredSteps: number; highRiskSteps: number; estimatedCostUnits: number; fallbackCoveredSteps: number }
  agentCollaboration?: {
    strategy: string
    mode: string
    roles: Array<{ profileId: string; name: string; responsibility: string; required: boolean; budgetTokens: number; reason: string }>
    handoffs: Array<{ from: string; to: string; artifact: string; exitCriteria: string[] }>
    reviewGates: Array<{ id: string; owner: string; required: boolean; reason: string }>
    budget: { totalTokens: number; assignedTokens: number; reserveTokens: number }
    summary: { totalRoles: number; requiredRoles: number; reviewerRoles: number; handoffCount: number; reviewGateCount: number; multiAgentRecommended: boolean; reviewEscalated: boolean }
    recommendations: string[]
  }
  recommendations?: string[]
  error?: string
}

interface DashboardBootstrap {
  generatedAt?: number
  endpoints?: Record<string, unknown>
  failures?: Record<string, string>
}

declare global {
  interface Window {
    __SCALE_DASHBOARD_BOOTSTRAP__?: DashboardBootstrap
  }
}

interface PositionedTopologyNode {
  node: TopologyNode
  x: number
  y: number
  degree: number
}

interface KnowledgeGraphChartDatum {
  id: string
  name: string
  value: number
  symbolSize: number
  category: number
  draggable: boolean
  raw: KnowledgeGraphNode
  itemStyle: { color: string }
  label?: { show: boolean }
}

interface KnowledgeGraphChartClick {
  componentType?: string
  seriesType?: string
  dataType?: string
  data?: {
    id?: string
    raw?: KnowledgeGraphNode
  }
}

interface DocumentGroup {
  folder: string
  documents: DocumentItem[]
}

interface BarRow {
  label: string
  value: number
  width: string
  tone: string
}

const lang = ref<Lang>((localStorage.getItem('scale-dashboard-lang') as Lang) || 'zh')
const dark = ref(localStorage.getItem('scale-dashboard-theme') !== 'light')
const dashboardBootstrap = readDashboardBootstrap()
const dashboardTransportAvailable = typeof globalThis.fetch === 'function' || typeof globalThis.XMLHttpRequest === 'function'
const initialPage = location.hash.slice(1) as PageKey
const activePage = ref<PageKey>(isPageKey(initialPage) ? initialPage : 'overview')
const loading = ref(false)
const notice = ref('')
const loadingResources = ref<Record<LoadKey, boolean>>({
  projects: false,
  capabilities: false,
  dashboardService: false,
  metrics: false,
  state: false,
  topology: false,
  domains: false,
  documents: false,
  knowledge: false,
  knowledgeBase: false,
  integrations: false,
  agentControl: false,
  prompts: false,
})
const resourceErrors = ref<Partial<Record<LoadKey, string>>>({})
const sseStatus = ref<'live' | 'polling' | 'reconnecting'>('polling')
const lastLoaded = ref<number | null>(dashboardBootstrap?.generatedAt || null)
const projects = ref<ProjectSummary[]>(bootstrapEndpoint<ProjectSummary[]>('/api/projects', []))
const currentProjectUrl = ref('')
const capabilities = ref<CapabilityReport | null>(bootstrapEndpoint<CapabilityReport | null>('/api/dashboard/capabilities', null))
const dashboardService = ref<DashboardServiceStatus | null>(bootstrapEndpoint<DashboardServiceStatus | null>('/api/dashboard/service', null))
const metrics = ref<MetricsReport | null>(bootstrapEndpoint<MetricsReport | null>('/api/metrics', null))
const state = ref<DashboardState | null>(bootstrapEndpoint<DashboardState | null>('/api/state', null))
const topology = ref<TopologyReport | null>(bootstrapEndpoint<TopologyReport | null>('/api/topology', null))
const domains = ref<unknown>(bootstrapEndpoint<unknown>('/api/topology/domains', null))
const documents = ref<DocumentItem[]>(bootstrapEndpoint<DocumentItem[]>('/api/documents', []))
const selectedDocument = ref<DocumentItem | null>(null)
const documentContent = ref('')
const knowledge = ref<KnowledgeReport | null>(null)
const knowledgeBase = ref<KnowledgeBaseReport | null>(bootstrapEndpoint<KnowledgeBaseReport | null>('/api/knowledge-base', null))
const integrations = ref<IntegrationsReport | null>(bootstrapEndpoint<IntegrationsReport | null>('/api/integrations', null))
const agentControl = ref<AgentControlReport | null>(bootstrapEndpoint<AgentControlReport | null>('/api/agent-control', null))
const integrationActionLoading = ref('')
const integrationActionResult = ref<IntegrationActionResult | null>(null)
const agentOsAcceptanceLoading = ref(false)
const agentOsAcceptanceResult = ref<AgentOsAcceptanceReport | null>(null)
const feishuAuthLoading = ref(false)
const feishuAuthResult = ref<FeishuAuthStartResult | null>(null)
const feishuConfigLoading = ref(false)
const feishuConfigResult = ref<FeishuAuthStartResult | null>(null)
const activeIntegrationTab = ref<IntegrationTab>('overview')
const feishuRouteDraft = ref<FeishuRouteConfig>(createEmptyFeishuRouteDraft())
const feishuRouteDirty = ref(false)
const feishuRouteSaveLoading = ref(false)
const agentConnectDraft = ref<AgentConnectConfig>(createEmptyAgentConnectDraft())
const agentConnectTokenInputs = ref({ managementApi: '', bridge: '', webhook: '' })
const agentConnectDirty = ref(false)
const agentConnectSaveLoading = ref(false)
const agentOsBootstrapLoading = ref(false)
const imaConfigDraft = ref<KnowledgeProviderConfig>(createEmptyImaConfigDraft())
const imaApiKeyInput = ref('')
const imaConfigDirty = ref(false)
const imaConfigSaveLoading = ref(false)
const prompts = ref<PromptReport | null>(bootstrapEndpoint<PromptReport | null>('/api/prompts', null))
const stream = ref<EventSource | null>(null)

const workflowStatusFilter = ref('all')
const workflowTypeFilter = ref('all')
const workflowSearch = ref('')
const selectedArtifactId = ref('')
const artifactActions = ref<Record<string, string[]>>({})
const artifactActionLoading = ref('')

const topologySearch = ref('')
const topologyLayerFilters = ref<string[]>([])
const topologyKindFilters = ref<string[]>([])
const selectedTopologyId = ref('')

const monitoringTab = ref<MonitorTab>('overview')
const documentSearch = ref('')
const documentFavorites = ref<Set<string>>(new Set(readLocalArray('scale-doc-favorites')))
const documentEditMode = ref(false)
const documentDraft = ref('')
const knowledgeTab = ref<KnowledgeTab>('base')
const knowledgeQuery = ref('')
const selectedKnowledgeDocument = ref<DocumentItem | null>(null)
const knowledgeDocumentContent = ref('')
const knowledgeDocumentEditMode = ref(false)
const knowledgeDocumentDraft = ref('')
const knowledgeImportName = ref('knowledge-note.md')
const knowledgeImportContent = ref('')
const activeGraphKey = ref<GraphKey>('graphify')
const graphNodeLimit = ref(600)
const graphFocusMode = ref(false)
const graphChartEl = ref<HTMLElement | null>(null)
const selectedGraphNodes = ref<Record<GraphKey, KnowledgeGraphNode | null>>({
  graphify: null,
  memory: null,
})
const graphNodePreview = ref<Record<GraphKey, string>>({
  graphify: '',
  memory: '',
})
const promptSearch = ref('')
const promptKindFilter = ref('all')
const selectedPromptId = ref('')
const optimizeInput = ref('')
const optimizeResult = ref<Record<string, unknown> | null>(null)
const agentPlanTask = ref('')
const agentPlanFiles = ref('')
const agentPlanLevel = ref('M')
const agentPlanBudget = ref('3600')
const agentPlanLoading = ref(false)
const agentPlanResult = ref<AgentPlanReport | null>(null)
const selectedAgentSessionId = ref('')
const agentSessionDraft = ref<AgentSessionDraft>(createEmptyAgentSessionDraft())
const agentSessionDirty = ref(false)
const agentSessionSaving = ref(false)
const agentWorkbenchTab = ref<AgentControlWorkbenchTab>('chat')
const agentTranscript = ref<AgentTranscriptReport | null>(null)
const agentTranscriptLoading = ref(false)
const agentTranscriptSearch = ref('')
const agentTranscriptStatus = ref<'all' | AgentControlMessageStatus>('all')
const agentTranscriptSearchReport = ref<AgentTranscriptSearchReport | null>(null)
const agentSummarySaving = ref(false)
const agentKnowledgeImporting = ref(false)
const agentMessageDraft = ref('')
const agentMessageSending = ref(false)
const agentMessageActionLoading = ref('')

let refreshTimer: number | undefined
let knowledgeGraphChart: ECharts | null = null
let knowledgeGraphChartTheme: 'dark' | 'light' = 'light'
let knowledgeGraphFingerprint = ''
let graphResizeObserver: ResizeObserver | null = null

const theme = computed(() => dark.value ? darkTheme : null)
const naiveLocale = computed(() => lang.value === 'zh' ? zhCN : enUS)
const pageTitle = computed(() => t(`nav.${activePage.value}`))
const currentProject = computed(() => capabilities.value?.project || projects.value.find(project => project.current))
const dataSources = computed(() => capabilities.value?.dataSources || [])
const tokenSource = computed(() => sourceById('model-usage'))
const memorySource = computed(() => sourceById('memory-brain'))
const knowledgeBaseSource = computed(() => sourceById('knowledge-base'))
const dashboardServiceSource = computed(() => sourceById('dashboard-service'))
const dashboardServiceAlertType = computed(() => dashboardService.value?.supervisorAlive
  ? 'success'
  : dashboardService.value?.serverAlive ? 'warning' : 'error')
const dashboardServiceAlertText = computed(() => {
  if (dashboardService.value?.supervisorAlive) return t('service.ready')
  const sourceText = sourceReason(dashboardServiceSource.value)
  if (sourceText) return sourceText
  return dashboardService.value?.serverAlive
    ? t('source.dashboard-service.reason.partial')
    : t('source.dashboard-service.reason')
})
const feishuSource = computed(() => sourceById('feishu-channel'))
const agentControlSource = computed(() => sourceById('agent-control-plane'))
const agentControlAlertType = computed(() => {
  if (agentControl.value?.summary.ready) return 'success'
  if (agentControl.value?.summary.partial) return 'warning'
  return statusTag(agentControlSource.value?.status || 'missing')
})
const agentControlAlertText = computed(() => {
  if (agentControl.value?.summary.ready) return t('agents.ready')
  const sourceText = sourceReason(agentControlSource.value)
  if (sourceText) return sourceText
  return agentControl.value
    ? t('source.agent-control-plane.reason.partial')
    : t('source.agent-control-plane.reason')
})
const documentSource = computed(() => sourceById('documents'))
const commandSource = computed(() => sourceById('command-runs'))
const feishuProvider = computed(() => integrations.value?.providers.find(provider => provider.id === 'feishu') || null)
const imaProvider = computed(() => integrations.value?.providers.find(provider => provider.id === 'tencent-ima') || null)
const connectorWorkflow = computed(() => integrations.value?.connectorWorkflow || null)
const agentOsReadiness = computed(() => integrations.value?.agentOs || null)
const agentOsAcceptance = computed(() => agentOsAcceptanceResult.value || integrations.value?.acceptance || null)
const agentOsPrimaryStage = computed(() => agentOsReadiness.value?.stages.find(stage => stage.status !== 'ready') || agentOsReadiness.value?.stages[0] || null)
const agentOsReadinessScore = computed(() => agentOsReadiness.value?.score ?? integrationWizardScore.value)
const agentOsReadinessTone = computed(() => agentOsReadiness.value?.status === 'ready' ? 'success' : 'warning')
const connectorChannels = computed(() => connectorWorkflow.value?.channels || [])
const bridgeEndpointPreview = computed(() => agentConnectDraft.value.bridge.enabled
  ? `ws://${agentConnectDraft.value.bridge.host}:${agentConnectDraft.value.bridge.port}${agentConnectDraft.value.bridge.path}?token=***`
  : connectorWorkflow.value?.config.endpoints.bridgeWebSocket || '')
const managementEndpointPreview = computed(() => agentConnectDraft.value.managementApi.enabled
  ? `http://${agentConnectDraft.value.managementApi.host}:${agentConnectDraft.value.managementApi.port}/api/v1`
  : connectorWorkflow.value?.config.endpoints.managementApi || '')
const messageChannelProviders = computed(() => integrations.value?.providers.filter(provider => provider.category === 'message-channel') || [])
const knowledgeProviderIntegrations = computed(() => integrations.value?.providers.filter(provider => provider.category === 'knowledge-provider') || [])
const feishuDryRunCommand = computed(() => commandPlanText(feishuProvider.value?.dryRunSendPlan))
const feishuEventCommand = computed(() => commandPlanText(feishuProvider.value?.eventConsumePlan))
const feishuRouteDryRunCommand = computed(() => previewFeishuRouteSendCommand(feishuRouteDraft.value))
const feishuRouteEventCommand = computed(() => previewFeishuRouteEventCommand(feishuRouteDraft.value))
const selectedFeishuRouteSummary = computed(() => feishuProvider.value?.routeConfigs?.find(route => route.agentPlatformId === feishuRouteDraft.value.agentPlatformId) || feishuProvider.value?.routeConfig)
const feishuRouteTargetOptions = computed(() => [
  { label: t('integrations.chatTarget'), value: 'chat' },
  { label: t('integrations.userTarget'), value: 'user' },
])
const feishuPlatformOptions = computed(() => (feishuProvider.value?.platformTargets || []).map(target => ({
  label: `${target.name} · ${statusLabel(target.status)}`,
  value: target.id,
})))
const agentSessions = computed(() => agentControl.value?.sessions || [])
const selectedAgentSession = computed(() => agentSessions.value.find(session => session.sessionId === selectedAgentSessionId.value) || agentSessions.value[0] || null)
const selectedAgentMessages = computed(() => (agentControl.value?.messages || [])
  .filter(message => message.sessionId === selectedAgentSession.value?.sessionId)
  .sort((left, right) => left.createdAt - right.createdAt))
const agentTimelineMessages = computed(() => [...(agentTranscript.value?.session.sessionId === selectedAgentSession.value?.sessionId
  ? agentTranscript.value.messages
  : selectedAgentMessages.value)].sort((left, right) => left.createdAt - right.createdAt))
const agentConversationSummary = computed(() => agentTranscript.value?.session.sessionId === selectedAgentSession.value?.sessionId
  ? agentTranscript.value.summary
  : null)
const agentTranscriptStorage = computed(() => agentTranscript.value?.session.sessionId === selectedAgentSession.value?.sessionId
  ? agentTranscript.value.storage
  : null)
const agentConversationStats = computed(() => {
  const summary = agentConversationSummary.value
  return [
    { label: t('agents.totalMessages'), value: summary?.messageCount ?? agentTimelineMessages.value.length },
    { label: t('agents.operatorMessages'), value: summary?.operatorMessages ?? agentTimelineMessages.value.filter(message => message.direction === 'operator-to-agent').length },
    { label: t('agents.agentMessages'), value: summary?.agentMessages ?? agentTimelineMessages.value.filter(message => message.direction === 'agent-to-operator').length },
    { label: t('agents.blockedMessages'), value: summary?.blockedMessages ?? agentTimelineMessages.value.filter(message => ['blocked', 'failed', 'cancelled'].includes(message.status)).length },
  ]
})
const agentModelOptions = computed(() => (agentControl.value?.modelOptions || []).map(model => ({
  label: `${model.label} · ${model.provider}`,
  value: model.id,
})))
const agentPlatformOptions = computed(() => (agentControl.value?.platformTargets || []).map(target => ({
  label: `${target.name} · ${statusLabel(target.status)}`,
  value: target.id,
})))
const agentModeOptions = computed(() => [
  { label: t('agents.modeDryRun'), value: 'dry-run' },
  { label: t('agents.modeInteractive'), value: 'interactive' },
  { label: t('agents.modeLiveGuarded'), value: 'live-guarded' },
])
const agentChannelOptions = computed(() => [
  { label: t('agents.channelDashboard'), value: 'dashboard' },
  { label: t('agents.channelFeishu'), value: 'feishu' },
])
const agentTranscriptStatusOptions = computed(() => [
  { label: t('agents.allStatuses'), value: 'all' },
  ...(['queued', 'claimed', 'completed', 'failed', 'cancelled', 'blocked', 'delivered'] as AgentControlMessageStatus[]).map(status => ({
    label: status,
    value: status,
  })),
])
const agentSelectedChannelHealth = computed(() => {
  const session = selectedAgentSession.value
  if (!session) return { type: 'default' as const, text: t('agents.noSessionSelected') }
  if (session.channel.provider === 'feishu' && !session.channel.configured) {
    return { type: 'warning' as const, text: t('agents.channelNeedsFeishuConfig') }
  }
  if (session.status === 'ready') return { type: 'success' as const, text: t('agents.channelReady') }
  return { type: 'warning' as const, text: session.warnings[0] || t('source.agent-control-plane.reason.partial') }
})
const commandCenterChecks = computed<CommandCenterCheck[]>(() => {
  const workflow = connectorWorkflow.value
  const graphSummary = knowledgeBase.value?.summary
  const requiredSkills = workflow?.skillPresets.filter(skill => skill.required) || []
  const enabledLoops = workflow?.automationLoops.filter(loop => loop.enabled).length || 0
  const readyChannels = workflow?.summary.readyChannels || 0
  const feishuRoutes = feishuProvider.value?.routeConfigs || []
  const configuredFeishuRoutes = feishuRoutes.filter(route => route.configured).length
  const hasAgentSession = (agentControl.value?.summary.sessions || 0) > 0
  const readyAgentSessions = agentControl.value?.summary.ready || 0
  const memoryCount = knowledgeBase.value?.summary.memoryNodes || knowledge.value?.local?.total || 0
  const modelRecords = modelUsage.value?.totalRecords || 0
  return [
    {
      id: 'dashboard-watchdog',
      area: 'loop',
      title: t('commandCenter.watchdog'),
      description: t('commandCenter.watchdogDesc'),
      status: dashboardService.value?.supervisorAlive && dashboardService.value.serverAlive ? 'ready' : dashboardService.value?.serverAlive ? 'partial' : 'missing',
      metric: dashboardService.value?.status || t('common.unknown'),
      actionLabel: t('commandCenter.openAgents'),
      page: 'agents',
    },
    {
      id: 'agent-control',
      area: 'agent',
      title: t('commandCenter.agentControl'),
      description: t('commandCenter.agentControlDesc'),
      status: readyAgentSessions > 0 ? 'ready' : hasAgentSession ? 'partial' : 'missing',
      metric: `${agentControl.value?.summary.sessions || 0} ${t('agents.sessions')}`,
      actionLabel: t('commandCenter.openAgents'),
      page: 'agents',
    },
    {
      id: 'agent-connect',
      area: 'channel',
      title: t('commandCenter.agentConnect'),
      description: t('commandCenter.agentConnectDesc'),
      status: workflow?.config.configured ? 'ready' : workflow?.config.enabled ? 'partial' : 'missing',
      metric: workflow?.config.configured ? t('common.ready') : `${readyChannels}/${workflow?.summary.channels || 0} ${t('integrations.readyChannels')}`,
      actionLabel: t('commandCenter.openIntegrations'),
      page: 'integrations',
    },
    {
      id: 'feishu-route',
      area: 'channel',
      title: t('commandCenter.feishuRoute'),
      description: t('commandCenter.feishuRouteDesc'),
      status: configuredFeishuRoutes > 0 ? 'ready' : feishuProvider.value?.commandAvailable ? 'partial' : 'missing',
      metric: `${configuredFeishuRoutes}/${Math.max(feishuRoutes.length, 1)} ${t('integrations.routeConfiguredShort')}`,
      actionLabel: t('commandCenter.openIntegrations'),
      page: 'integrations',
    },
    {
      id: 'knowledge-graph',
      area: 'knowledge',
      title: t('commandCenter.knowledgeGraph'),
      description: t('commandCenter.knowledgeGraphDesc'),
      status: (graphSummary?.graphNodes || 0) > 0 ? 'ready' : knowledgeBaseSource.value?.status || 'missing',
      metric: `${formatNumber(graphSummary?.graphNodes || 0)} / ${formatNumber(graphSummary?.graphEdges || 0)}`,
      actionLabel: t('commandCenter.openKnowledge'),
      page: 'knowledge',
    },
    {
      id: 'memory',
      area: 'knowledge',
      title: t('commandCenter.memory'),
      description: t('commandCenter.memoryDesc'),
      status: memoryCount > 0 ? 'ready' : memorySource.value?.status === 'ready' ? 'partial' : memorySource.value?.status || 'missing',
      metric: `${formatNumber(memoryCount)} ${t('overview.memory')}`,
      actionLabel: t('commandCenter.openKnowledge'),
      page: 'knowledge',
    },
    {
      id: 'default-skills',
      area: 'loop',
      title: t('commandCenter.defaultSkills'),
      description: t('commandCenter.defaultSkillsDesc'),
      status: requiredSkills.length > 0 ? 'partial' : 'missing',
      metric: `${requiredSkills.length || 0} ${t('integrations.defaultInstall')}`,
      actionLabel: t('commandCenter.openIntegrations'),
      page: 'integrations',
    },
    {
      id: 'model-usage',
      area: 'cost',
      title: t('commandCenter.modelUsage'),
      description: t('commandCenter.modelUsageDesc'),
      status: modelRecords > 0 ? 'ready' : tokenSource.value?.status || 'missing',
      metric: `${formatNumber(modelRecords)} ${t('costs.modelUsage')}`,
      actionLabel: t('commandCenter.openCosts'),
      page: 'costs',
    },
    {
      id: 'automation-loops',
      area: 'loop',
      title: t('commandCenter.automationLoops'),
      description: t('commandCenter.automationLoopsDesc'),
      status: enabledLoops >= 2 ? 'ready' : (workflow?.automationLoops.length || 0) > 0 ? 'partial' : 'missing',
      metric: `${enabledLoops}/${workflow?.automationLoops.length || 0}`,
      actionLabel: t('commandCenter.openIntegrations'),
      page: 'integrations',
    },
  ]
})
const commandCenterReadyCount = computed(() => commandCenterChecks.value.filter(check => check.status === 'ready').length)
const commandCenterScore = computed(() => {
  if (commandCenterChecks.value.length === 0) return 0
  const points = commandCenterChecks.value.reduce((total, check) => total + (check.status === 'ready' ? 1 : check.status === 'partial' ? 0.45 : 0), 0)
  return Math.round((points / commandCenterChecks.value.length) * 100)
})
const commandCenterTone = computed(() => commandCenterScore.value >= 80 ? 'success' : commandCenterScore.value >= 45 ? 'warning' : 'error')
const commandCenterPrimaryAction = computed(() => commandCenterChecks.value.find(check => check.status !== 'ready') || commandCenterChecks.value[0])
const commandCenterNextActions = computed(() => commandCenterChecks.value
  .filter(check => check.status !== 'ready')
  .slice(0, 5))
const commandCenterPaths = computed<CommandCenterPath[]>(() => {
  const workflow = connectorWorkflow.value
  const routeReady = (feishuProvider.value?.routeConfigs || []).some(route => route.configured)
  const bridgeReady = Boolean(workflow?.config.bridge.enabled && workflow.config.bridge.hasToken)
  const webhookReady = Boolean(workflow?.config.webhook.enabled && workflow.config.webhook.hasToken)
  const agentReady = (agentControl.value?.summary.ready || 0) > 0
  const graphReady = (knowledgeBase.value?.summary.graphNodes || 0) > 0
  const memoryReady = (knowledgeBase.value?.summary.memoryNodes || knowledge.value?.local?.total || 0) > 0
  const usageReady = (modelUsage.value?.totalRecords || 0) > 0
  return [
    {
      id: 'remote-coding',
      title: t('commandCenter.pathRemoteCoding'),
      description: t('commandCenter.pathRemoteCodingDesc'),
      page: 'integrations',
      status: routeReady && bridgeReady && agentReady ? 'ready' : agentReady || routeReady || bridgeReady ? 'partial' : 'missing',
      steps: [
        { label: t('commandCenter.stepAgent'), status: agentReady ? 'ready' : hasAgentControlSessionStatus() },
        { label: t('commandCenter.stepFeishu'), status: routeReady ? 'ready' : feishuProvider.value?.commandAvailable ? 'partial' : 'missing' },
        { label: t('commandCenter.stepBridge'), status: bridgeReady ? 'ready' : workflow?.config.bridge.enabled ? 'partial' : 'missing' },
      ],
    },
    {
      id: 'local-chat',
      title: t('commandCenter.pathLocalChat'),
      description: t('commandCenter.pathLocalChatDesc'),
      page: 'agents',
      status: agentReady ? 'ready' : hasAgentControlSessionStatus(),
      steps: [
        { label: t('commandCenter.stepSession'), status: hasAgentControlSessionStatus() },
        { label: t('commandCenter.stepModel'), status: selectedAgentSession.value?.model ? 'ready' : 'partial' },
        { label: t('commandCenter.stepQueue'), status: (agentControl.value?.summary.queuedMessages || 0) === 0 ? 'ready' : 'partial' },
      ],
    },
    {
      id: 'knowledge-memory',
      title: t('commandCenter.pathKnowledgeMemory'),
      description: t('commandCenter.pathKnowledgeMemoryDesc'),
      page: 'knowledge',
      status: graphReady && memoryReady ? 'ready' : graphReady || memoryReady ? 'partial' : 'missing',
      steps: [
        { label: t('commandCenter.stepDocuments'), status: (knowledgeBase.value?.summary.documents || 0) > 0 ? 'ready' : 'missing' },
        { label: t('commandCenter.stepGraph'), status: graphReady ? 'ready' : 'missing' },
        { label: t('commandCenter.stepMemory'), status: memoryReady ? 'ready' : memorySource.value?.status || 'missing' },
      ],
    },
    {
      id: 'ops-loop',
      title: t('commandCenter.pathOpsLoop'),
      description: t('commandCenter.pathOpsLoopDesc'),
      page: 'monitoring',
      status: dashboardService.value?.supervisorAlive && usageReady && webhookReady ? 'ready' : dashboardService.value?.supervisorAlive || usageReady || webhookReady ? 'partial' : 'missing',
      steps: [
        { label: t('commandCenter.stepWatchdog'), status: dashboardService.value?.supervisorAlive ? 'ready' : 'missing' },
        { label: t('commandCenter.stepWebhook'), status: webhookReady ? 'ready' : workflow?.config.webhook.enabled ? 'partial' : 'missing' },
        { label: t('commandCenter.stepUsage'), status: usageReady ? 'ready' : tokenSource.value?.status || 'missing' },
      ],
    },
  ]
})
const integrationWizardSteps = computed<CommandCenterCheck[]>(() => {
  const workflow = connectorWorkflow.value
  const routeConfigs = feishuProvider.value?.routeConfigs || []
  const configuredRoutes = routeConfigs.filter(route => route.configured).length
  const tokenReady = Boolean(
    workflow?.config.managementApi.hasToken
    && workflow.config.bridge.hasToken
    && workflow.config.webhook.hasToken,
  )
  const bridgeReady = Boolean(workflow?.config.bridge.enabled && workflow.config.bridge.hasToken)
  const webhookReady = Boolean(workflow?.config.webhook.enabled && workflow.config.webhook.hasToken)
  const requiredSkills = workflow?.skillPresets.filter(skill => skill.required) || []
  return [
    {
      id: 'feishu-cli',
      area: 'channel',
      title: t('integrations.wizardFeishuCli'),
      description: t('integrations.wizardFeishuCliDesc'),
      status: feishuProvider.value?.status === 'ready' ? 'ready' : feishuProvider.value?.commandAvailable ? 'partial' : 'missing',
      metric: feishuProvider.value?.commandAvailable ? feishuProvider.value.commandPath || feishuProvider.value.command : t('status.missing'),
      actionLabel: t('integrations.runDoctor'),
      page: 'integrations',
    },
    {
      id: 'agent-connect-config',
      area: 'channel',
      title: t('integrations.wizardAgentConnect'),
      description: t('integrations.wizardAgentConnectDesc'),
      status: workflow?.config.configured ? 'ready' : workflow?.config.enabled ? 'partial' : 'missing',
      metric: workflow?.config.configPath || '.scale/integrations/agent-connect.json',
      actionLabel: t('integrations.saveAgentConnect'),
      page: 'integrations',
    },
    {
      id: 'tokens',
      area: 'channel',
      title: t('integrations.wizardTokens'),
      description: t('integrations.wizardTokensDesc'),
      status: tokenReady ? 'ready' : agentConnectTokenInputs.value.managementApi || agentConnectTokenInputs.value.bridge || agentConnectTokenInputs.value.webhook ? 'partial' : 'missing',
      metric: tokenReady ? t('common.ready') : t('integrations.tokenPlaceholder'),
      actionLabel: t('integrations.generateLocalTokens'),
      page: 'integrations',
    },
    {
      id: 'bridge-webhook',
      area: 'channel',
      title: t('integrations.wizardBridgeWebhook'),
      description: t('integrations.wizardBridgeWebhookDesc'),
      status: bridgeReady && webhookReady ? 'ready' : workflow?.config.bridge.enabled || workflow?.config.webhook.enabled ? 'partial' : 'missing',
      metric: `${bridgeReady ? 'Bridge' : '-'} / ${webhookReady ? 'Webhook' : '-'}`,
      actionLabel: t('integrations.applyRecommended'),
      page: 'integrations',
    },
    {
      id: 'feishu-route',
      area: 'channel',
      title: t('integrations.wizardRoute'),
      description: t('integrations.wizardRouteDesc'),
      status: configuredRoutes > 0 ? 'ready' : feishuProvider.value?.commandAvailable ? 'partial' : 'missing',
      metric: `${configuredRoutes}/${Math.max(routeConfigs.length, 1)} ${t('integrations.routeConfiguredShort')}`,
      actionLabel: t('integrations.saveRoute'),
      page: 'integrations',
    },
    {
      id: 'required-skills',
      area: 'loop',
      title: t('integrations.wizardSkills'),
      description: t('integrations.wizardSkillsDesc'),
      status: requiredSkills.length > 0 ? 'partial' : 'missing',
      metric: `${requiredSkills.length} ${t('integrations.defaultInstall')}`,
      actionLabel: t('integrations.skillPresets'),
      page: 'integrations',
    },
  ]
})
const integrationWizardScore = computed(() => {
  if (integrationWizardSteps.value.length === 0) return 0
  const points = integrationWizardSteps.value.reduce((total, step) => total + (step.status === 'ready' ? 1 : step.status === 'partial' ? 0.45 : 0), 0)
  return Math.round((points / integrationWizardSteps.value.length) * 100)
})
const integrationWizardTone = computed(() => integrationWizardScore.value >= 80 ? 'success' : 'warning')

watch(feishuProvider, provider => {
  if (feishuRouteDirty.value) return
  const route = provider?.routeConfigs?.find(candidate => candidate.agentPlatformId === feishuRouteDraft.value.agentPlatformId)
    || provider?.routeConfig
    || provider?.routeConfigs?.[0]
  if (!route) return
  feishuRouteDraft.value = routeDraftFromSummary(route)
}, { immediate: true })

watch(imaProvider, provider => {
  if (imaConfigDirty.value || !provider?.knowledgeConfig) return
  imaConfigDraft.value = imaConfigDraftFromSummary(provider.knowledgeConfig)
  imaApiKeyInput.value = ''
}, { immediate: true })

watch(connectorWorkflow, report => {
  if (agentConnectDirty.value || !report?.config) return
  agentConnectDraft.value = agentConnectDraftFromSummary(report.config)
  agentConnectTokenInputs.value = { managementApi: '', bridge: '', webhook: '' }
}, { immediate: true })

watch(agentControl, report => {
  if (!report?.sessions.length) return
  if (!selectedAgentSessionId.value || !report.sessions.some(session => session.sessionId === selectedAgentSessionId.value)) {
    selectedAgentSessionId.value = report.sessions[0]!.sessionId
  }
  if (!agentSessionDirty.value) syncAgentSessionDraft()
  if (activePage.value === 'agents') void loadAgentTranscript()
}, { immediate: true })

watch(selectedAgentSessionId, () => {
  if (!agentSessionDirty.value) syncAgentSessionDraft()
  agentTranscriptSearch.value = ''
  agentTranscriptStatus.value = 'all'
  agentTranscriptSearchReport.value = null
  if (activePage.value === 'agents') void loadAgentTranscript()
})

watch(activePage, page => {
  void refreshActivePage(page)
  if (page === 'agents') void loadAgentTranscript()
})

const menuOptions = computed(() => [
  { label: t('nav.overview'), key: 'overview' },
  { label: t('nav.workflow'), key: 'workflow' },
  { label: t('nav.topology'), key: 'topology' },
  { label: t('nav.monitoring'), key: 'monitoring' },
  { label: t('nav.costs'), key: 'costs' },
  { label: t('nav.knowledge'), key: 'knowledge' },
  { label: t('nav.agents'), key: 'agents' },
  { label: t('nav.integrations'), key: 'integrations' },
  { label: t('nav.documents'), key: 'documents' },
  { label: t('nav.prompts'), key: 'prompts' },
])

const sourceColumns = computed<DataTableColumns<DataSourceSignal>>(() => [
  {
    title: t('table.source'),
    key: 'title',
    minWidth: 260,
    render(row) {
      return h('div', { class: 'source-row' }, [
        h('div', { class: 'source-title' }, row.title),
        h('div', { class: 'source-desc' }, sourceDescription(row)),
        h('div', { class: 'source-path' }, row.source),
      ])
    },
  },
  {
    title: t('table.status'),
    key: 'status',
    width: 130,
    render(row) {
      return h(NTag, { type: statusTag(row.status), size: 'small' }, { default: () => statusLabel(row.status) })
    },
  },
  { title: t('table.count'), key: 'count', width: 100, render: row => formatNumber(row.count || 0) },
  { title: t('table.refresh'), key: 'refreshMode', width: 130, render: row => refreshLabel(row.refreshMode) },
  {
    title: t('table.reason'),
    key: 'emptyReason',
    minWidth: 260,
    render(row) {
      const reason = sourceReason(row)
      return reason ? h('div', { class: 'empty-reason' }, reason) : h('span', { class: 'muted' }, t('common.ok'))
    },
  },
])

const artifactColumns = computed<DataTableColumns<ArtifactTreeNode>>(() => [
  {
    title: t('workflow.artifact'),
    key: 'title',
    minWidth: 260,
    render(row) {
      return h('button', {
        class: ['link-button', selectedArtifactId.value === row.id ? 'active' : ''],
        onClick: () => selectArtifact(row.id),
      }, `${row.title || row.id}`)
    },
  },
  { title: t('workflow.type'), key: 'type', width: 130 },
  {
    title: t('workflow.status'),
    key: 'status',
    width: 140,
    render(row) {
      return h(NTag, { size: 'small', type: statusTone(row.status) }, { default: () => runtimeLabel(row.status) })
    },
  },
  { title: t('workflow.version'), key: 'version', width: 100 },
  {
    title: t('workflow.gates'),
    key: 'gates',
    minWidth: 220,
    render(row) {
      const gates = row.gates || []
      if (gates.length === 0) return h('span', { class: 'muted' }, '-')
      return h('div', { class: 'tag-row' }, gates.map(gate => h(NTag, {
        size: 'small',
        type: gate.passed ? 'success' : gate.required ? 'error' : 'warning',
      }, { default: () => gate.name })))
    },
  },
])

const knowledgeColumns = computed<DataTableColumns<KnowledgeNode>>(() => [
  {
    title: t('knowledge.memory'),
    key: 'title',
    minWidth: 280,
    render(row) {
      return h('div', { class: 'source-row' }, [
        h('div', { class: 'source-title' }, row.title || row.id),
        h('div', { class: 'source-desc' }, row.summary || row.source || '-'),
        h('div', { class: 'source-path' }, (row.evidencePaths || []).join(', ')),
      ])
    },
  },
  { title: t('table.status'), key: 'status', width: 120, render: row => runtimeLabel(row.status || '-') },
  { title: t('knowledge.layer'), key: 'layer', width: 130, render: row => row.layer || '-' },
  { title: t('knowledge.confidence'), key: 'confidence', width: 120, render: row => formatPercent(Number(row.confidence || 0)) },
  {
    title: t('table.action'),
    key: 'action',
    width: 240,
    render(row) {
      const id = row.id
      return h('div', { class: 'doc-actions' }, [
        actionButton(t('knowledge.approve'), () => reviewMemory(id, 'approve')),
        actionButton(t('knowledge.stale'), () => reviewMemory(id, 'stale')),
        actionButton(t('knowledge.reject'), () => reviewMemory(id, 'reject')),
      ])
    },
  },
])

const promptItems = computed<PromptItem[]>(() => {
  const vibe = (prompts.value?.vibeTemplates || []).map(item => ({ ...item, kind: 'vibe' as const, label: item.name || item.id }))
  const phase = (prompts.value?.phasePrompts || []).map(item => ({ ...item, kind: 'phase' as const, label: item.title || item.name || item.id }))
  const packs = (prompts.value?.packs || []).map(item => ({ ...item, kind: 'pack' as const, label: item.name || item.id }))
  return [...vibe, ...phase, ...packs]
})

const filteredPromptItems = computed(() => {
  const query = promptSearch.value.trim().toLowerCase()
  return promptItems.value.filter(item => {
    const kindOk = promptKindFilter.value === 'all' || item.kind === promptKindFilter.value
    const text = `${item.label || ''} ${item.id || ''} ${item.description || ''} ${item.command || ''}`.toLowerCase()
    return kindOk && (!query || text.includes(query))
  })
})

const selectedPrompt = computed(() => {
  return promptItems.value.find(item => String(item.id) === selectedPromptId.value) || filteredPromptItems.value[0] || promptItems.value[0]
})

const selectedPromptText = computed(() => {
  const prompt = selectedPrompt.value
  if (!prompt) return ''
  if (typeof prompt.copyPrompt === 'string') return prompt.copyPrompt
  if (typeof prompt.template === 'string') return prompt.template
  if (Array.isArray(prompt.templateIds)) {
    return `Pack: ${prompt.name}\n\n${prompt.description || ''}\n\nTemplates:\n${prompt.templateIds.join('\n')}`
  }
  return JSON.stringify(prompt, null, 2)
})

const selectedPromptAgentTask = computed(() => {
  const prompt = selectedPrompt.value
  const label = String(prompt?.label || prompt?.id || t('prompts.gallery'))
  const description = prompt?.description ? `: ${prompt.description}` : ''
  return `Use ${label}${description}`
})

const agentPlanReadOnlyUrl = computed(() => {
  const params = new URLSearchParams()
  params.set('task', agentPlanTask.value.trim() || selectedPromptAgentTask.value)
  params.set('level', agentPlanLevel.value)
  if (agentPlanFiles.value.trim()) params.set('files', agentPlanFiles.value.trim())
  if (agentPlanBudget.value.trim()) params.set('budget', agentPlanBudget.value.trim())
  return `/api/agent/plan?${params.toString()}`
})

const agentPlanJson = computed(() => agentPlanResult.value ? JSON.stringify(agentPlanResult.value, null, 2) : '')

const flatArtifacts = computed(() => flattenArtifacts(state.value?.artifacts || []))
const artifactTypes = computed(() => unique(flatArtifacts.value.map(item => item.type)).map(value => ({ label: value, value })))
const artifactStatuses = computed(() => unique(flatArtifacts.value.map(item => item.status)).map(value => ({ label: runtimeLabel(value), value })))

const filteredArtifacts = computed(() => {
  const query = workflowSearch.value.trim().toLowerCase()
  return flatArtifacts.value.filter(item => {
    const statusOk = workflowStatusFilter.value === 'all' || item.status === workflowStatusFilter.value
    const typeOk = workflowTypeFilter.value === 'all' || item.type === workflowTypeFilter.value
    const text = `${item.id} ${item.title} ${item.type} ${item.status}`.toLowerCase()
    return statusOk && typeOk && (!query || text.includes(query))
  })
})

const selectedArtifact = computed(() => flatArtifacts.value.find(item => item.id === selectedArtifactId.value) || filteredArtifacts.value[0])
const gateRows = computed(() => flatArtifacts.value.flatMap(artifact => (artifact.gates || []).map(gate => ({ artifact, gate }))))
const gateTotals = computed(() => {
  const gates = gateRows.value
  return {
    total: gates.length,
    passed: gates.filter(item => item.gate.passed).length,
    failedRequired: gates.filter(item => item.gate.required && !item.gate.passed).length,
  }
})

const topologyNodes = computed(() => topology.value?.nodes || [])
const topologyEdges = computed(() => topology.value?.edges || [])
const topologyDegree = computed(() => {
  const degree = new Map<string, number>()
  for (const edge of topologyEdges.value) {
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1)
  }
  return degree
})

const topologyLayerOptions = computed(() => unique(topologyNodes.value.map(node => node.layer || 'unknown')).map(value => ({ label: value, value })))
const topologyKindOptions = computed(() => unique(topologyNodes.value.map(node => node.kind || 'unknown')).map(value => ({ label: value, value })))

const visibleTopologyNodes = computed(() => {
  const query = topologySearch.value.trim().toLowerCase()
  const nodes = topologyNodes.value.filter(node => {
    const layer = node.layer || 'unknown'
    const kind = node.kind || 'unknown'
    const layerOk = topologyLayerFilters.value.length === 0 || topologyLayerFilters.value.includes(layer)
    const kindOk = topologyKindFilters.value.length === 0 || topologyKindFilters.value.includes(kind)
    const text = `${node.id} ${node.name || ''} ${node.filePath || ''} ${node.signature || ''}`.toLowerCase()
    return layerOk && kindOk && (!query || text.includes(query))
  })
  return [...nodes]
    .sort((left, right) => (topologyDegree.value.get(right.id) || 0) - (topologyDegree.value.get(left.id) || 0))
    .slice(0, 260)
})

const visibleTopologyIdSet = computed(() => new Set(visibleTopologyNodes.value.map(node => node.id)))
const visibleTopologyEdges = computed(() => topologyEdges.value.filter(edge => visibleTopologyIdSet.value.has(edge.source) && visibleTopologyIdSet.value.has(edge.target)).slice(0, 420))
const topologySvgNodes = computed<PositionedTopologyNode[]>(() => layoutTopology(visibleTopologyNodes.value, topologyDegree.value))
const topologyPositionMap = computed(() => new Map(topologySvgNodes.value.map(item => [item.node.id, item])))
const topologySvgEdges = computed(() => visibleTopologyEdges.value.flatMap(edge => {
  const source = topologyPositionMap.value.get(edge.source)
  const target = topologyPositionMap.value.get(edge.target)
  return source && target ? [{ edge, source, target }] : []
}))
const selectedTopologyNode = computed(() => topologyNodes.value.find(node => node.id === selectedTopologyId.value) || visibleTopologyNodes.value[0])

const domainSummaries = computed(() => normalizeDomains(domains.value, topologyNodes.value))

const detectors = computed(() => state.value?.detectorStats || [])
const autoDefects = computed(() => state.value?.autoDefectStats || null)
const recentEvents = computed(() => state.value?.recentEvents || [])
const commandRuns = computed(() => metrics.value?.commandRuns)
const modelUsage = computed(() => metrics.value?.modelUsage)
const commandPassRate = computed(() => {
  const runs = commandRuns.value
  if (!runs || runs.total === 0) return 0
  return Math.round((runs.passed / runs.total) * 100)
})
const commandSavingsRate = computed(() => {
  const runs = commandRuns.value
  if (!runs || runs.rawEstimatedTokens === 0) return 0
  return Math.round((runs.savedEstimatedTokens / runs.rawEstimatedTokens) * 100)
})
const rootCauseBars = computed(() => toBars(autoDefects.value?.byRootCause || {}, 'root'))
const severityBars = computed(() => toBars(autoDefects.value?.bySeverity || {}, 'severity'))
const providerRows = computed(() => Object.entries(modelUsage.value?.byProvider || {}).map(([provider, row]) => ({ provider, ...row })))

const filteredDocuments = computed(() => {
  const query = documentSearch.value.trim().toLowerCase()
  return documents.value.filter(doc => {
    return !query || `${doc.name} ${doc.path} ${doc.type}`.toLowerCase().includes(query)
  }).sort((left, right) => {
    const favLeft = documentFavorites.value.has(left.path) ? 0 : 1
    const favRight = documentFavorites.value.has(right.path) ? 0 : 1
    return favLeft - favRight || left.path.localeCompare(right.path)
  })
})
const documentGroups = computed(() => groupDocuments(filteredDocuments.value))
const prototypeDocs = computed(() => documents.value.filter(doc => doc.type === 'html'))
const docPreviewUrl = computed(() => selectedDocument.value ? documentUrl(selectedDocument.value.path) : '')
const renderedDocumentHtml = computed(() => {
  if (!selectedDocument.value || selectedDocument.value.type !== 'md') return ''
  return renderMarkdown(documentContent.value)
})

const knowledgeDocuments = computed(() => knowledgeBase.value?.documents || [])
const knowledgeDocumentGroups = computed(() => groupDocuments(knowledgeDocuments.value))
const knowledgeEntries = computed(() => knowledgeBase.value?.entries || [])
const knowledgeDocPreviewUrl = computed(() => selectedKnowledgeDocument.value ? documentUrl(selectedKnowledgeDocument.value.path) : '')
const renderedKnowledgeDocumentHtml = computed(() => {
  if (!selectedKnowledgeDocument.value || selectedKnowledgeDocument.value.type !== 'md') return ''
  return renderMarkdown(knowledgeDocumentContent.value)
})
const activeKnowledgeGraph = computed(() => activeGraphKey.value === 'graphify'
  ? knowledgeBase.value?.graph
  : knowledgeBase.value?.memoryGraph)
const activeKnowledgeGraphStatus = computed(() => activeKnowledgeGraph.value?.status || 'missing')
const activeKnowledgeGraphSource = computed(() => activeKnowledgeGraph.value?.source || (activeGraphKey.value === 'graphify'
  ? 'graphify-out/graph.json'
  : '.scale/memory/brain.sqlite'))
const activeKnowledgeGraphDownloadName = computed(() => activeGraphKey.value === 'graphify'
  ? 'scale-graphify-knowledge-graph.json'
  : 'scale-gbrain-memory-graph.json')
const activeKnowledgeGraphHasData = computed(() => Boolean(activeKnowledgeGraph.value?.nodes?.length))
const selectedGraphNode = computed(() => selectedGraphNodes.value[activeGraphKey.value])
const selectedGraphPreview = computed(() => graphNodePreview.value[activeGraphKey.value])
const knowledgeGraphOptions = computed(() => [
  {
    label: `${t('knowledge.graphify')} (${knowledgeBase.value?.graph?.nodeCount || 0})`,
    value: 'graphify',
  },
  {
    label: `${t('knowledge.memoryGraph')} (${knowledgeBase.value?.memoryGraph?.nodeCount || 0})`,
    value: 'memory',
  },
])
const graphNodeLimitOptions = [
  { label: '200', value: 200 },
  { label: '600', value: 600 },
  { label: '1000', value: 1000 },
  { label: '2000', value: 2000 },
]
const activeKnowledgeGraphVisibleSummary = computed(() => {
  const graph = activeKnowledgeGraph.value
  const total = graph?.nodeCount || graph?.nodes?.length || 0
  const visible = Math.min(total, graphNodeLimit.value)
  return t('knowledge.visibleGraphSummary', {
    visible,
    total,
    edges: visibleKnowledgeGraphEdgeCount(graph, graphNodeLimit.value),
  })
})
const knowledgeGraphChartOption = computed(() => buildKnowledgeGraphChartOption(
  activeKnowledgeGraph.value,
  activeGraphKey.value,
  graphNodeLimit.value,
))
const knowledgeNodes = computed(() => knowledge.value?.local?.nodes || [])
const knowledgeReviewQueue = computed(() => knowledgeNodes.value.filter(node => ['candidate', 'stale'].includes(String(node.status || ''))))
const knowledgeStatusRows = computed(() => Object.entries(knowledge.value?.local?.byStatus || {}).map(([status, count]) => ({ status, count })))

function setResourceLoading(key: LoadKey, value: boolean) {
  loadingResources.value = { ...loadingResources.value, [key]: value }
}

function isResourceLoading(key: LoadKey): boolean {
  return Boolean(loadingResources.value[key])
}

function resourceError(key: LoadKey): string {
  return resourceErrors.value[key] || ''
}

async function loadDashboardResource<T>(
  key: LoadKey,
  label: string,
  url: string,
  apply: (value: T) => void,
  timeoutMs = dashboardResourceTimeout(key),
): Promise<void> {
  setResourceLoading(key, true)
  resourceErrors.value = { ...resourceErrors.value, [key]: undefined }
  try {
    apply(await fetchJSON<T>(url, timeoutMs))
  } catch (error) {
    const message = `${label}: ${errorMessage(error)}`
    resourceErrors.value = { ...resourceErrors.value, [key]: message }
    throw new Error(message)
  } finally {
    setResourceLoading(key, false)
  }
}

function dashboardResourceTimeout(key: LoadKey): number {
  if (key === 'capabilities' || key === 'knowledgeBase') return 25000
  if (key === 'documents' || key === 'topology' || key === 'domains') return 18000
  if (key === 'integrations' || key === 'agentControl') return 16000
  if (key === 'state' || key === 'prompts' || key === 'metrics') return 22000
  if (key === 'knowledge') return 20000
  return 12000
}

async function refreshAll() {
  loading.value = true
  if (isPartialLoadNotice(notice.value)) notice.value = ''
  const failures: string[] = []
  const load = async <T>(key: LoadKey, label: string, url: string, apply: (value: T) => void) => {
    try {
      await loadDashboardResource<T>(key, label, url, apply)
    } catch (error) {
      failures.push(errorMessage(error))
    }
  }
  const batches: Array<Array<() => Promise<void>>> = [
    [
      () => load('projects', 'projects', '/api/projects', value => { projects.value = value }),
      () => load('dashboardService', 'dashboard-service', '/api/dashboard/service', value => { dashboardService.value = value }),
    ],
    [
      () => load('capabilities', 'capabilities', '/api/dashboard/capabilities', value => { capabilities.value = value }),
    ],
    [
      () => load('documents', 'documents', '/api/documents', value => { documents.value = value }),
      () => load('integrations', 'integrations', '/api/integrations', value => { integrations.value = value }),
      () => load('agentControl', 'agent-control', '/api/agent-control', value => { agentControl.value = value }),
    ],
    [
      () => load('knowledgeBase', 'knowledge-base', '/api/knowledge-base', value => { knowledgeBase.value = value }),
    ],
    [
      () => load('metrics', 'metrics', '/api/metrics', value => { metrics.value = value }),
      () => load('state', 'state', '/api/state', value => { state.value = value }),
      () => load('topology', 'topology', '/api/topology', value => { topology.value = value }),
      () => load('domains', 'domains', '/api/topology/domains', value => { domains.value = value }),
      () => load('prompts', 'prompts', '/api/prompts', value => { prompts.value = value }),
    ],
  ]
  for (const batch of batches) {
    await Promise.all(batch.map(task => task()))
  }

  currentProjectUrl.value = capabilities.value?.project.url || ''
  if (!selectedDocument.value && documents.value.length > 0) {
    await selectDocument(documents.value[0]).catch(error => failures.push(`document-preview: ${errorMessage(error)}`))
  }
  if (!selectedKnowledgeDocument.value && knowledgeDocuments.value.length > 0) {
    await selectKnowledgeDocument(knowledgeDocuments.value[0]!).catch(error => failures.push(`knowledge-preview: ${errorMessage(error)}`))
  }
  if (!selectedPromptId.value && promptItems.value.length > 0) selectedPromptId.value = String(promptItems.value[0]?.id || '')
  if (!selectedArtifactId.value && flatArtifacts.value.length > 0) selectedArtifactId.value = flatArtifacts.value[0]!.id
  if (!selectedTopologyId.value && visibleTopologyNodes.value.length > 0) selectedTopologyId.value = visibleTopologyNodes.value[0]!.id
  await loadKnowledge(false).catch(error => failures.push(`knowledge-recall: ${errorMessage(error)}`))
  notice.value = failures.length > 0 ? `${t('common.partialLoad')}: ${failures.slice(0, 4).join('; ')}` : ''
  lastLoaded.value = Date.now()
  loading.value = false
}

async function refreshActivePage(page: PageKey = activePage.value) {
  loading.value = true
  if (isPartialLoadNotice(notice.value)) notice.value = ''
  const failures: string[] = []
  const load = async <T>(key: LoadKey, label: string, url: string, apply: (value: T) => void) => {
    try {
      await loadDashboardResource<T>(key, label, url, apply)
    } catch (error) {
      failures.push(errorMessage(error))
    }
  }

  await Promise.all([
    load('projects', 'projects', '/api/projects', value => { projects.value = value }),
    load('dashboardService', 'dashboard-service', '/api/dashboard/service', value => { dashboardService.value = value }),
  ])

  if (page === 'integrations') {
    await Promise.all([
      load('integrations', 'integrations', '/api/integrations', value => { integrations.value = value }),
      load('agentControl', 'agent-control', '/api/agent-control', value => { agentControl.value = value }),
    ])
  } else if (page === 'agents') {
    await load('agentControl', 'agent-control', '/api/agent-control', value => { agentControl.value = value })
  } else if (page === 'knowledge') {
    await load('knowledgeBase', 'knowledge-base', '/api/knowledge-base', value => { knowledgeBase.value = value })
    await loadKnowledge(false).catch(error => failures.push(`knowledge-recall: ${errorMessage(error)}`))
  } else if (page === 'documents') {
    await load('documents', 'documents', '/api/documents', value => { documents.value = value })
    if (!selectedDocument.value && documents.value.length > 0) {
      await selectDocument(documents.value[0]).catch(error => failures.push(`document-preview: ${errorMessage(error)}`))
    }
  } else if (page === 'prompts') {
    await load('prompts', 'prompts', '/api/prompts', value => { prompts.value = value })
    if (!selectedPromptId.value && promptItems.value.length > 0) selectedPromptId.value = String(promptItems.value[0]?.id || '')
  } else if (page === 'topology') {
    await Promise.all([
      load('topology', 'topology', '/api/topology', value => { topology.value = value }),
      load('domains', 'domains', '/api/topology/domains', value => { domains.value = value }),
    ])
    if (!selectedTopologyId.value && visibleTopologyNodes.value.length > 0) selectedTopologyId.value = visibleTopologyNodes.value[0]!.id
  } else if (page === 'costs') {
    await load('metrics', 'metrics', '/api/metrics', value => { metrics.value = value })
  } else if (page === 'workflow' || page === 'monitoring' || page === 'overview') {
    await Promise.all([
      load('capabilities', 'capabilities', '/api/dashboard/capabilities', value => { capabilities.value = value }),
      load('state', 'state', '/api/state', value => { state.value = value }),
      load('metrics', 'metrics', '/api/metrics', value => { metrics.value = value }),
    ])
    currentProjectUrl.value = capabilities.value?.project.url || ''
  }

  notice.value = failures.length > 0 ? `${t('common.partialLoad')}: ${failures.slice(0, 4).join('; ')}` : ''
  lastLoaded.value = Date.now()
  loading.value = false
}

async function loadKnowledge(runRecall: boolean) {
  const query = encodeURIComponent(knowledgeQuery.value.trim())
  const recall = runRecall && query ? '&recall=1' : ''
  await loadDashboardResource<KnowledgeReport>('knowledge', 'knowledge', `/api/knowledge?providers=${runRecall ? 'true' : 'false'}&limit=80${query ? `&query=${query}` : ''}${recall}`, value => {
    knowledge.value = value
  })
}

async function selectArtifact(id: string) {
  selectedArtifactId.value = id
  if (!id || artifactActions.value[id]) return
  try {
    const response = await fetchJSON<{ actions: string[] }>(`/api/artifacts/${encodeURIComponent(id)}/actions`)
    artifactActions.value = { ...artifactActions.value, [id]: response.actions || [] }
  } catch {
    artifactActions.value = { ...artifactActions.value, [id]: [] }
  }
}

async function transitionArtifact(action: string) {
  const artifact = selectedArtifact.value
  if (!artifact) return
  artifactActionLoading.value = action
  try {
    const response = await dashboardFetch(`/api/artifacts/${encodeURIComponent(artifact.id)}/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reason: `dashboard:${action}` }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      notice.value = JSON.stringify(payload)
      return
    }
    notice.value = t('workflow.transitionRecorded')
    await refreshAll()
  } finally {
    artifactActionLoading.value = ''
  }
}

async function selectDocument(document: DocumentItem) {
  selectedDocument.value = document
  documentEditMode.value = false
  documentDraft.value = ''
  if (document.type === 'html') {
    documentContent.value = ''
    return
  }
  try {
    documentContent.value = await fetchDocumentText(document.path)
  } catch (error) {
    documentContent.value = ''
    notice.value = `${t('documents.preview')}: ${errorMessage(error)}`
  }
}

async function selectKnowledgeDocument(document: DocumentItem) {
  selectedKnowledgeDocument.value = document
  knowledgeDocumentEditMode.value = false
  knowledgeDocumentDraft.value = ''
  if (document.type === 'html') {
    knowledgeDocumentContent.value = ''
    return
  }
  try {
    knowledgeDocumentContent.value = await fetchDocumentText(document.path)
  } catch (error) {
    knowledgeDocumentContent.value = ''
    notice.value = `${t('knowledge.preview')}: ${errorMessage(error)}`
  }
}

async function fetchDocumentText(path: string) {
  const response = await dashboardFetch(documentUrl(path))
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.text()
}

async function startDocumentEdit() {
  if (!selectedDocument.value) return
  documentDraft.value = documentContent.value || await fetchDocumentText(selectedDocument.value.path)
  documentEditMode.value = true
}

function cancelDocumentEdit() {
  documentEditMode.value = false
  documentDraft.value = ''
}

async function saveDocumentEdit() {
  if (!selectedDocument.value) return
  const updated = await saveDocumentContent(selectedDocument.value.path, documentDraft.value)
  documentContent.value = documentDraft.value
  selectedDocument.value = updated
  updateDocumentCollections(updated)
  documentEditMode.value = false
  notice.value = t('documents.saved')
}

async function startKnowledgeDocumentEdit() {
  if (!selectedKnowledgeDocument.value) return
  knowledgeDocumentDraft.value = knowledgeDocumentContent.value || await fetchDocumentText(selectedKnowledgeDocument.value.path)
  knowledgeDocumentEditMode.value = true
}

function cancelKnowledgeDocumentEdit() {
  knowledgeDocumentEditMode.value = false
  knowledgeDocumentDraft.value = ''
}

async function saveKnowledgeDocumentEdit() {
  if (!selectedKnowledgeDocument.value) return
  const updated = await saveDocumentContent(selectedKnowledgeDocument.value.path, knowledgeDocumentDraft.value)
  knowledgeDocumentContent.value = knowledgeDocumentDraft.value
  selectedKnowledgeDocument.value = updated
  updateDocumentCollections(updated)
  knowledgeDocumentEditMode.value = false
  notice.value = t('documents.saved')
}

async function saveDocumentContent(path: string, content: string): Promise<DocumentItem> {
  const response = await dashboardFetch(documentUrl(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  const payload = await response.json().catch(() => ({})) as { document?: DocumentItem; error?: string }
  if (!response.ok || !payload.document) throw new Error(payload.error || `${response.status} ${response.statusText}`)
  return payload.document
}

function updateDocumentCollections(updated: DocumentItem) {
  documents.value = replaceDocument(documents.value, updated)
  if (knowledgeBase.value?.documents) {
    knowledgeBase.value = {
      ...knowledgeBase.value,
      documents: replaceDocument(knowledgeBase.value.documents, updated),
    }
  }
}

function replaceDocument(items: DocumentItem[], updated: DocumentItem): DocumentItem[] {
  const next = items.filter(item => item.path !== updated.path)
  next.push(updated)
  return next.sort((left, right) => left.path.localeCompare(right.path))
}

async function copySelectedDocument() {
  if (!selectedDocument.value) return
  const content = documentContent.value || await fetchDocumentText(selectedDocument.value.path)
  await copyText(content)
}

async function copySelectedKnowledgeDocument() {
  if (!selectedKnowledgeDocument.value) return
  const content = knowledgeDocumentContent.value || await fetchDocumentText(selectedKnowledgeDocument.value.path)
  await copyText(content)
}

function downloadSelectedDocument() {
  if (!selectedDocument.value) return
  downloadDocumentFile(selectedDocument.value.path)
}

function downloadSelectedKnowledgeDocument() {
  if (!selectedKnowledgeDocument.value) return
  downloadDocumentFile(selectedKnowledgeDocument.value.path)
}

function downloadDocumentFile(path: string) {
  const link = document.createElement('a')
  link.href = documentDownloadUrl(path)
  link.download = path.split('/').pop() || 'document.txt'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

async function importKnowledgeDocument() {
  const response = await dashboardFetch('/api/knowledge-base/documents/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: knowledgeImportName.value,
      content: knowledgeImportContent.value,
    }),
  })
  const payload = await response.json().catch(() => ({})) as { document?: DocumentItem; error?: string }
  if (!response.ok || !payload.document) {
    notice.value = payload.error || `${response.status} ${response.statusText}`
    return
  }
  knowledgeImportContent.value = ''
  knowledgeImportName.value = 'knowledge-note.md'
  await refreshAll()
  knowledgeTab.value = 'base'
  await selectKnowledgeDocument(payload.document)
  notice.value = t('knowledge.imported')
}

async function reviewMemory(id: string, action: string) {
  if (!id) return
  const response = await dashboardFetch(`/api/knowledge/local/${encodeURIComponent(id)}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, reason: 'dashboard review' }),
  })
  if (!response.ok) {
    notice.value = await response.text()
    return
  }
  notice.value = t('knowledge.reviewRecorded')
  await loadKnowledge(false)
  await refreshCapabilitiesOnly()
}

async function runIntegrationAction(providerId: string, actionId: string) {
  if (!providerId || !actionId) return
  integrationActionLoading.value = actionId
  integrationActionResult.value = null
  try {
    const response = await dashboardFetch(`/api/integrations/${encodeURIComponent(providerId)}/actions/${encodeURIComponent(actionId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const payload = await response.json().catch(() => ({})) as IntegrationActionResult
    integrationActionResult.value = payload
    if (!response.ok || !payload.ok) {
      notice.value = payload.error || `${response.status} ${response.statusText}`
    }
    await refreshCapabilitiesOnly()
    const refreshed = await fetchJSON<IntegrationsReport>('/api/integrations')
    integrations.value = refreshed
  } catch (error) {
    notice.value = errorMessage(error)
  } finally {
    integrationActionLoading.value = ''
  }
}

function updateFeishuRouteDraft(key: keyof FeishuRouteConfig, value: string | boolean) {
  if (key === 'agentPlatformId' && typeof value === 'string') {
    selectFeishuPlatformRoute(value)
    return
  }
  feishuRouteDraft.value = { ...feishuRouteDraft.value, [key]: value } as FeishuRouteConfig
  feishuRouteDirty.value = true
}

function selectFeishuPlatformRoute(platformId: string) {
  const route = feishuProvider.value?.routeConfigs?.find(candidate => candidate.agentPlatformId === platformId)
  feishuRouteDraft.value = route
    ? routeDraftFromSummary(route)
    : { ...createEmptyFeishuRouteDraft(), agentPlatformId: platformId, projectId: currentProject.value?.id || '', projectDir: currentProject.value?.projectDir || '' }
  feishuRouteDirty.value = false
}

async function saveFeishuRoute() {
  feishuRouteSaveLoading.value = true
  try {
    const response = await dashboardFetch('/api/integrations/feishu/route', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(feishuRouteDraft.value),
    })
    const payload = await response.json().catch(() => ({})) as IntegrationRouteUpdateResult
    if (!response.ok || !payload.ok) {
      notice.value = payload.error || `${response.status} ${response.statusText}`
      return
    }
    feishuRouteDirty.value = false
    feishuRouteDraft.value = routeDraftFromSummary(payload.route)
    notice.value = t('integrations.routeSaved')
    await refreshCapabilitiesOnly()
    integrations.value = await fetchJSON<IntegrationsReport>('/api/integrations')
  } catch (error) {
    notice.value = errorMessage(error)
  } finally {
    feishuRouteSaveLoading.value = false
  }
}

function updateAgentConnectDraft(section: 'root' | 'managementApi' | 'bridge' | 'webhook' | 'automation', key: string, value: string | number | boolean | string[] | null) {
  const normalizedValue = typeof value === 'number' && Number.isNaN(value) ? 0 : value
  if (section === 'root') {
    agentConnectDraft.value = { ...agentConnectDraft.value, [key]: normalizedValue } as AgentConnectConfig
  } else {
    agentConnectDraft.value = {
      ...agentConnectDraft.value,
      [section]: {
        ...agentConnectDraft.value[section],
        [key]: normalizedValue,
      },
    } as AgentConnectConfig
  }
  agentConnectDirty.value = true
}

function updateAgentConnectList(section: 'managementApi' | 'bridge', key: 'corsOrigins' | 'allowPlatforms', value: string) {
  const items = value.split(',').map(item => item.trim()).filter(Boolean)
  updateAgentConnectDraft(section, key, items)
}

function applyRecommendedAgentConnectDefaults() {
  const current = agentConnectDraft.value
  const localOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:3210'
  const allowPlatforms = Array.from(new Set([...(current.bridge.allowPlatforms || []), 'feishu', 'bridge-custom', 'matrix'])).filter(Boolean)
  agentConnectDraft.value = {
    ...current,
    enabled: true,
    managementApi: {
      ...current.managementApi,
      enabled: true,
      host: current.managementApi.host || '127.0.0.1',
      port: current.managementApi.port || 9820,
      corsOrigins: Array.from(new Set([...(current.managementApi.corsOrigins || []), localOrigin])).filter(Boolean),
    },
    bridge: {
      ...current.bridge,
      enabled: true,
      host: current.bridge.host || '127.0.0.1',
      port: current.bridge.port || 9810,
      path: current.bridge.path || '/bridge/ws',
      allowPlatforms,
      defaultProjectId: currentProject.value?.id || current.bridge.defaultProjectId || 'default',
    },
    webhook: {
      ...current.webhook,
      enabled: true,
      path: current.webhook.path || '/agent-connect/webhook',
    },
    automation: {
      ...current.automation,
      cronEnabled: true,
      heartbeatEnabled: true,
      heartbeatIntervalMins: current.automation.heartbeatIntervalMins || 15,
      resetOnIdleMins: current.automation.resetOnIdleMins || 20,
      longTaskNotifications: true,
    },
  }
  agentConnectTokenInputs.value = {
    managementApi: current.managementApi.hasToken ? agentConnectTokenInputs.value.managementApi : agentConnectTokenInputs.value.managementApi || generateLocalSecret('mgmt'),
    bridge: current.bridge.hasToken ? agentConnectTokenInputs.value.bridge : agentConnectTokenInputs.value.bridge || generateLocalSecret('bridge'),
    webhook: current.webhook.hasToken ? agentConnectTokenInputs.value.webhook : agentConnectTokenInputs.value.webhook || generateLocalSecret('webhook'),
  }
  agentConnectDirty.value = true
  notice.value = t('integrations.recommendedApplied')
}

function generateAgentConnectTokens() {
  agentConnectTokenInputs.value = {
    managementApi: agentConnectTokenInputs.value.managementApi || generateLocalSecret('mgmt'),
    bridge: agentConnectTokenInputs.value.bridge || generateLocalSecret('bridge'),
    webhook: agentConnectTokenInputs.value.webhook || generateLocalSecret('webhook'),
  }
  agentConnectDirty.value = true
  notice.value = t('integrations.tokensGenerated')
}

function generateLocalSecret(prefix: string): string {
  const bytes = new Uint8Array(18)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  }
  return `${prefix}_${Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

function listInputValue(items: string[] | undefined): string {
  return (items || []).join(', ')
}

async function saveAgentConnectConfig() {
  agentConnectSaveLoading.value = true
  try {
    const payload = {
      ...agentConnectDraft.value,
      managementApi: {
        ...agentConnectDraft.value.managementApi,
        token: agentConnectTokenInputs.value.managementApi.trim() || undefined,
      },
      bridge: {
        ...agentConnectDraft.value.bridge,
        token: agentConnectTokenInputs.value.bridge.trim() || undefined,
      },
      webhook: {
        ...agentConnectDraft.value.webhook,
        token: agentConnectTokenInputs.value.webhook.trim() || undefined,
      },
    }
    const response = await dashboardFetch('/api/integrations/agent-connect', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const result = await response.json().catch(() => ({})) as AgentConnectUpdateResult
    if (!response.ok || !result.ok) {
      notice.value = result.error || `${response.status} ${response.statusText}`
      return
    }
    agentConnectDirty.value = false
    agentConnectTokenInputs.value = { managementApi: '', bridge: '', webhook: '' }
    agentConnectDraft.value = agentConnectDraftFromSummary(result.config)
    notice.value = t('integrations.agentConnectSaved')
    await refreshCapabilitiesOnly()
    integrations.value = await fetchJSON<IntegrationsReport>('/api/integrations')
  } catch (error) {
    notice.value = errorMessage(error)
  } finally {
    agentConnectSaveLoading.value = false
  }
}

async function bootstrapLocalAgentOs() {
  agentOsBootstrapLoading.value = true
  try {
    const response = await dashboardFetch('/api/integrations/agent-os/bootstrap-local', { method: 'POST' })
    const result = await response.json().catch(() => ({})) as AgentOsBootstrapResult
    if (!response.ok || !result.ok) {
      notice.value = result.error || `${response.status} ${response.statusText}`
      return
    }
    agentConnectDirty.value = false
    agentConnectTokenInputs.value = { managementApi: '', bridge: '', webhook: '' }
    agentConnectDraft.value = agentConnectDraftFromSummary(result.config)
    integrations.value = await fetchJSON<IntegrationsReport>('/api/integrations')
    await Promise.all([
      refreshCapabilitiesOnly().catch(() => undefined),
      refreshAgentControl().catch(() => undefined),
      refreshDashboardService().catch(() => undefined),
    ])
    const score = integrations.value?.agentOs?.score ?? result.agentOs?.score ?? agentOsReadinessScore.value
    notice.value = t('integrations.localBootstrapComplete', { score })
    activeIntegrationTab.value = 'overview'
  } catch (error) {
    notice.value = errorMessage(error)
  } finally {
    agentOsBootstrapLoading.value = false
  }
}

async function runAgentOsAcceptance() {
  agentOsAcceptanceLoading.value = true
  try {
    const response = await dashboardFetch('/api/integrations/agent-os/acceptance', { method: 'POST' })
    const result = await response.json().catch(() => ({})) as AgentOsAcceptanceReport
    agentOsAcceptanceResult.value = result
    const refreshed = await fetchJSON<IntegrationsReport>('/api/integrations')
    integrations.value = refreshed
    if (!response.ok || !result.ok) {
      notice.value = result.nextActions?.[0] || result.warnings?.[0] || `${response.status} ${response.statusText}`
    } else {
      notice.value = t('integrations.acceptancePassed')
    }
  } catch (error) {
    notice.value = errorMessage(error)
  } finally {
    agentOsAcceptanceLoading.value = false
  }
}

async function startFeishuAuth() {
  feishuAuthLoading.value = true
  feishuAuthResult.value = null
  try {
    const response = await dashboardFetch('/api/integrations/feishu/auth/start', { method: 'POST' })
    const result = await response.json().catch(() => ({})) as FeishuAuthStartResult
    feishuAuthResult.value = result
    if (result.verificationUrl) {
      notice.value = t('integrations.feishuAuthStarted')
    } else {
      notice.value = result.setupCommand || result.error || `${response.status} ${response.statusText}`
    }
    const refreshed = await fetchJSON<IntegrationsReport>('/api/integrations')
    integrations.value = refreshed
  } catch (error) {
    notice.value = errorMessage(error)
  } finally {
    feishuAuthLoading.value = false
  }
}

async function startFeishuConfig() {
  feishuConfigLoading.value = true
  feishuConfigResult.value = null
  try {
    const response = await dashboardFetch('/api/integrations/feishu/config/start', { method: 'POST' })
    const result = await response.json().catch(() => ({})) as FeishuAuthStartResult
    feishuConfigResult.value = result
    if (result.verificationUrl) {
      notice.value = t('integrations.feishuConfigStarted')
    } else {
      notice.value = result.setupCommand || result.error || `${response.status} ${response.statusText}`
    }
    const refreshed = await fetchJSON<IntegrationsReport>('/api/integrations')
    integrations.value = refreshed
  } catch (error) {
    notice.value = errorMessage(error)
  } finally {
    feishuConfigLoading.value = false
  }
}

function updateImaConfigDraft(key: keyof KnowledgeProviderConfig, value: string | boolean) {
  imaConfigDraft.value = { ...imaConfigDraft.value, [key]: value } as KnowledgeProviderConfig
  imaConfigDirty.value = true
}

async function saveImaKnowledgeProvider() {
  imaConfigSaveLoading.value = true
  try {
    const response = await dashboardFetch('/api/integrations/knowledge/tencent-ima', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...imaConfigDraft.value, apiKey: imaApiKeyInput.value.trim() || undefined }),
    })
    const payload = await response.json().catch(() => ({})) as KnowledgeProviderUpdateResult
    if (!response.ok || !payload.ok) {
      notice.value = payload.error || `${response.status} ${response.statusText}`
      return
    }
    imaConfigDirty.value = false
    imaApiKeyInput.value = ''
    imaConfigDraft.value = imaConfigDraftFromSummary(payload.config)
    notice.value = t('integrations.knowledgeProviderSaved')
    await refreshCapabilitiesOnly()
    integrations.value = await fetchJSON<IntegrationsReport>('/api/integrations')
  } catch (error) {
    notice.value = errorMessage(error)
  } finally {
    imaConfigSaveLoading.value = false
  }
}

function createEmptyAgentSessionDraft(): AgentSessionDraft {
  return {
    sessionId: 'default',
    name: 'Default agent',
    platformId: 'codex',
    modelId: 'balanced',
    channelProvider: 'dashboard',
    commandPrefix: '/scale',
    mode: 'dry-run',
    autoImportKnowledge: true,
  }
}

function syncAgentSessionDraft() {
  const session = selectedAgentSession.value
  if (!session) {
    agentSessionDraft.value = createEmptyAgentSessionDraft()
    return
  }
  agentSessionDraft.value = {
    sessionId: session.sessionId,
    name: session.name,
    platformId: session.platformId,
    modelId: session.modelId,
    channelProvider: session.channelProvider,
    commandPrefix: session.commandPrefix,
    mode: session.mode,
    autoImportKnowledge: session.autoImportKnowledge,
  }
}

function updateAgentSessionDraft(key: keyof AgentSessionDraft, value: string | boolean) {
  agentSessionDraft.value = { ...agentSessionDraft.value, [key]: value } as AgentSessionDraft
  agentSessionDirty.value = true
}

function selectAgentSession(sessionId: string) {
  selectedAgentSessionId.value = sessionId
  agentSessionDirty.value = false
  syncAgentSessionDraft()
}

async function refreshAgentControl() {
  agentControl.value = await fetchJSON<AgentControlReport>('/api/agent-control')
  await loadAgentTranscript()
}

async function loadAgentTranscript(showNotice = false) {
  const session = selectedAgentSession.value
  if (!session) {
    agentTranscript.value = null
    return
  }
  agentTranscriptLoading.value = true
  try {
    const params = new URLSearchParams()
    const query = agentTranscriptSearch.value.trim()
    if (query) params.set('query', query)
    if (agentTranscriptStatus.value !== 'all') params.set('status', agentTranscriptStatus.value)
    params.set('limit', '500')
    const suffix = params.toString() ? `?${params}` : ''
    agentTranscript.value = await fetchJSON<AgentTranscriptReport>(`/api/agent-control/sessions/${encodeURIComponent(session.sessionId)}/transcript${suffix}`)
    if (showNotice) notice.value = t('agents.transcriptRefreshed')
  } catch (error) {
    if (showNotice) notice.value = errorMessage(error)
  } finally {
    agentTranscriptLoading.value = false
  }
}

async function searchAgentTranscripts() {
  const params = new URLSearchParams()
  const query = agentTranscriptSearch.value.trim()
  if (query) params.set('query', query)
  if (selectedAgentSession.value?.sessionId) params.set('sessionId', selectedAgentSession.value.sessionId)
  if (agentTranscriptStatus.value !== 'all') params.set('status', agentTranscriptStatus.value)
  params.set('limit', '80')
  try {
    agentTranscriptSearchReport.value = await fetchJSON<AgentTranscriptSearchReport>(`/api/agent-control/transcripts?${params}`)
    await loadAgentTranscript(false)
  } catch (error) {
    notice.value = errorMessage(error)
  }
}

async function generateAgentSummary() {
  const session = selectedAgentSession.value
  if (!session) return
  agentSummarySaving.value = true
  try {
    const response = await dashboardFetch(`/api/agent-control/sessions/${encodeURIComponent(session.sessionId)}/summary`, { method: 'POST' })
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; summary?: AgentConversationSummary }
    if (!response.ok || !payload.ok || !payload.summary) {
      notice.value = payload.error || `${response.status} ${response.statusText}`
      return
    }
    if (agentTranscript.value?.session.sessionId === session.sessionId) {
      agentTranscript.value = { ...agentTranscript.value, summary: payload.summary }
    }
    notice.value = t('agents.summaryGenerated')
    await loadAgentTranscript(false)
  } catch (error) {
    notice.value = errorMessage(error)
  } finally {
    agentSummarySaving.value = false
  }
}

async function copyAgentTranscript() {
  const transcript = agentTranscript.value
  if (!transcript) return
  await copyText(JSON.stringify(transcript, null, 2))
}

function downloadAgentTranscript() {
  const transcript = agentTranscript.value
  if (!transcript) return
  downloadJson(`scale-agent-transcript-${transcript.session.sessionId}.json`, transcript)
}

async function copyAgentSummary() {
  const summary = agentConversationSummary.value
  if (!summary) return
  await copyText(summary.markdown)
}

async function importAgentSummaryToKnowledge() {
  const summary = agentConversationSummary.value
  const session = selectedAgentSession.value
  if (!summary || !session) return
  agentKnowledgeImporting.value = true
  try {
    const response = await dashboardFetch('/api/knowledge-base/documents/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `agent-summary-${session.sessionId}.md`,
        content: summary.markdown,
      }),
    })
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string }
    if (!response.ok || !payload.ok) {
      notice.value = payload.error || `${response.status} ${response.statusText}`
      return
    }
    notice.value = t('agents.summaryImported')
    await loadDashboardResource<KnowledgeBaseReport>('knowledgeBase', 'knowledge-base', '/api/knowledge-base', value => {
      knowledgeBase.value = value
    })
    await refreshCapabilitiesOnly()
  } catch (error) {
    notice.value = errorMessage(error)
  } finally {
    agentKnowledgeImporting.value = false
  }
}

async function saveAgentSession() {
  if (!agentSessionDraft.value.sessionId) return
  agentSessionSaving.value = true
  try {
    const response = await dashboardFetch(`/api/agent-control/sessions/${encodeURIComponent(agentSessionDraft.value.sessionId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(agentSessionDraft.value),
    })
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; session?: AgentControlSession }
    if (!response.ok || !payload.ok) {
      notice.value = payload.error || `${response.status} ${response.statusText}`
      return
    }
    agentSessionDirty.value = false
    notice.value = t('agents.sessionSaved')
    await refreshAgentControl()
    await refreshCapabilitiesOnly()
  } catch (error) {
    notice.value = errorMessage(error)
  } finally {
    agentSessionSaving.value = false
  }
}

async function sendAgentMessage() {
  const session = selectedAgentSession.value
  const text = agentMessageDraft.value.trim()
  if (!session || !text) return
  agentMessageSending.value = true
  try {
    const response = await dashboardFetch(`/api/agent-control/sessions/${encodeURIComponent(session.sessionId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, dryRun: session.mode !== 'live-guarded', from: 'dashboard' }),
    })
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; message?: AgentControlMessage }
    if (!response.ok || !payload.ok) {
      notice.value = payload.error || `${response.status} ${response.statusText}`
      return
    }
    agentMessageDraft.value = ''
    notice.value = payload.message?.status === 'blocked' ? t('agents.messageBlocked') : t('agents.messageQueued')
    await refreshAgentControl()
    await refreshCapabilitiesOnly()
  } catch (error) {
    notice.value = errorMessage(error)
  } finally {
    agentMessageSending.value = false
  }
}

async function claimAgentMessage(message: AgentControlMessage) {
  if (!selectedAgentSession.value || message.status !== 'queued') return
  agentMessageActionLoading.value = `claim:${message.id}`
  try {
    const response = await dashboardFetch(`/api/agent-control/sessions/${encodeURIComponent(message.sessionId)}/messages/${encodeURIComponent(message.id)}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'dashboard' }),
    })
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string }
    if (!response.ok || !payload.ok) {
      notice.value = payload.error || `${response.status} ${response.statusText}`
      return
    }
    notice.value = t('agents.messageClaimed')
    await refreshAgentControl()
    await refreshCapabilitiesOnly()
  } catch (error) {
    notice.value = errorMessage(error)
  } finally {
    agentMessageActionLoading.value = ''
  }
}

async function completeAgentMessage(message: AgentControlMessage) {
  if (!selectedAgentSession.value || !['queued', 'claimed'].includes(message.status)) return
  agentMessageActionLoading.value = `complete:${message.id}`
  try {
    const response = await dashboardFetch(`/api/agent-control/sessions/${encodeURIComponent(message.sessionId)}/messages/${encodeURIComponent(message.id)}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'dashboard',
        status: 'completed',
        text: 'Completed from dashboard control plane.',
      }),
    })
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string }
    if (!response.ok || !payload.ok) {
      notice.value = payload.error || `${response.status} ${response.statusText}`
      return
    }
    notice.value = t('agents.messageCompleted')
    await refreshAgentControl()
    await refreshCapabilitiesOnly()
  } catch (error) {
    notice.value = errorMessage(error)
  } finally {
    agentMessageActionLoading.value = ''
  }
}

async function optimizePrompt() {
  const input = optimizeInput.value.trim()
  if (!input) return
  const response = await dashboardFetch('/api/prompts/optimize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawPrompt: input, language: lang.value }),
  })
  optimizeResult.value = await response.json() as Record<string, unknown>
  if (!response.ok) notice.value = JSON.stringify(optimizeResult.value)
}

async function generateAgentPlan() {
  const task = agentPlanTask.value.trim() || selectedPromptAgentTask.value
  if (!task.trim()) return
  agentPlanLoading.value = true
  try {
    const response = await dashboardFetch('/api/agent/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task,
        level: agentPlanLevel.value,
        files: agentPlanFiles.value,
        budget: agentPlanBudget.value,
      }),
    })
    agentPlanResult.value = await response.json() as AgentPlanReport
    if (!response.ok) {
      notice.value = agentPlanResult.value.error || JSON.stringify(agentPlanResult.value)
      return
    }
    notice.value = t('prompts.agentPlanGenerated')
    await refreshCapabilitiesOnly()
  } catch (error) {
    notice.value = errorMessage(error)
  } finally {
    agentPlanLoading.value = false
  }
}

async function refreshCapabilitiesOnly() {
  capabilities.value = await fetchJSON<CapabilityReport>('/api/dashboard/capabilities')
}

async function refreshDashboardService() {
  dashboardService.value = await fetchJSON<DashboardServiceStatus>('/api/dashboard/service')
}

async function runDashboardServiceAction(action: 'ensure' | 'restart') {
  try {
    const response = await dashboardFetch(`/api/dashboard/service/actions/${action}`, { method: 'POST' })
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; service?: DashboardServiceStatus }
    if (!response.ok || !payload.ok) {
      notice.value = payload.error || `${response.status} ${response.statusText}`
      return
    }
    if (payload.service) dashboardService.value = payload.service
    notice.value = action === 'ensure' ? t('service.ensureStarted') : t('service.restartStarted')
    await refreshCapabilitiesOnly()
    await refreshDashboardService()
  } catch (error) {
    notice.value = errorMessage(error)
  }
}

function connectStream() {
  if (typeof globalThis.EventSource !== 'function') {
    sseStatus.value = 'polling'
    return
  }
  stream.value?.close()
  stream.value = new EventSource('/api/stream')
  stream.value.addEventListener('init', () => {
    sseStatus.value = capabilities.value?.realtime.busAvailable ? 'live' : 'polling'
  })
  stream.value.addEventListener('heartbeat', () => {
    sseStatus.value = capabilities.value?.realtime.busAvailable ? 'live' : 'polling'
  })
  stream.value.addEventListener('event', () => {
    sseStatus.value = 'live'
    void refreshAll()
  })
  stream.value.onerror = () => {
    sseStatus.value = 'reconnecting'
  }
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text)
  notice.value = t('common.copied')
}

function downloadText(name: string, text: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function downloadJson(name: string, payload: unknown) {
  downloadText(name, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8')
}

function commandPlanText(plan?: IntegrationCommandPlan): string {
  if (!plan) return ''
  return [plan.command, ...plan.args.map(quoteShellArg)].join(' ')
}

function quoteShellArg(value: string): string {
  if (!value) return '""'
  return /[\s"'<>|&]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
}

function createEmptyFeishuRouteDraft(): FeishuRouteConfig {
  return {
    version: 1,
    enabled: true,
    routeId: 'feishu-project',
    routeName: 'Feishu route',
    projectId: '',
    projectDir: '',
    agentPlatformId: 'codex',
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

function routeDraftFromSummary(route: FeishuRouteSummary): FeishuRouteConfig {
  return {
    version: 1,
    enabled: route.enabled,
    routeId: route.routeId,
    routeName: route.routeName,
    projectId: route.projectId,
    projectDir: route.projectDir,
    agentPlatformId: route.agentPlatformId,
    agentSessionId: route.agentSessionId,
    targetType: route.targetType,
    targetId: route.targetId,
    eventKey: route.eventKey,
    commandPrefix: route.commandPrefix,
    allowWriteCommands: route.allowWriteCommands,
    importKnowledge: route.importKnowledge,
    notes: route.notes,
    updatedAt: route.updatedAt,
  }
}

function createEmptyAgentConnectDraft(): AgentConnectConfig {
  return {
    version: 1,
    enabled: false,
    managementApi: {
      enabled: false,
      host: '127.0.0.1',
      port: 9820,
      hasToken: false,
      corsOrigins: ['http://127.0.0.1:3210'],
    },
    bridge: {
      enabled: false,
      host: '127.0.0.1',
      port: 9810,
      path: '/bridge/ws',
      hasToken: false,
      allowPlatforms: ['feishu', 'bridge-custom'],
      defaultProjectId: '',
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

function agentConnectDraftFromSummary(config: AgentConnectConfigSummary): AgentConnectConfig {
  return {
    version: 1,
    enabled: config.enabled,
    managementApi: {
      enabled: config.managementApi.enabled,
      host: config.managementApi.host,
      port: config.managementApi.port,
      hasToken: config.managementApi.hasToken,
      tokenMasked: config.managementApi.tokenMasked,
      corsOrigins: [...config.managementApi.corsOrigins],
    },
    bridge: {
      enabled: config.bridge.enabled,
      host: config.bridge.host,
      port: config.bridge.port,
      path: config.bridge.path,
      hasToken: config.bridge.hasToken,
      tokenMasked: config.bridge.tokenMasked,
      allowPlatforms: [...config.bridge.allowPlatforms],
      defaultProjectId: config.bridge.defaultProjectId,
      protocolVersion: 1,
    },
    webhook: {
      enabled: config.webhook.enabled,
      path: config.webhook.path,
      hasToken: config.webhook.hasToken,
      tokenMasked: config.webhook.tokenMasked,
    },
    automation: {
      cronEnabled: config.automation.cronEnabled,
      heartbeatEnabled: config.automation.heartbeatEnabled,
      heartbeatIntervalMins: config.automation.heartbeatIntervalMins,
      maxTurnTimeMins: config.automation.maxTurnTimeMins,
      resetOnIdleMins: config.automation.resetOnIdleMins,
      longTaskNotifications: config.automation.longTaskNotifications,
    },
    updatedAt: config.updatedAt,
  }
}

function createEmptyImaConfigDraft(): KnowledgeProviderConfig {
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

function imaConfigDraftFromSummary(config: KnowledgeProviderSummary): KnowledgeProviderConfig {
  return {
    version: 1,
    provider: 'tencent-ima',
    enabled: config.enabled,
    authMode: config.authMode,
    clientId: config.clientId,
    knowledgeBaseId: config.knowledgeBaseId,
    hasApiKey: config.hasApiKey,
    apiKeyMasked: config.apiKeyMasked,
    qrAuthorized: config.qrAuthorized,
    notes: config.notes,
    updatedAt: config.updatedAt,
  }
}

function previewFeishuRouteSendCommand(route: FeishuRouteConfig): string {
  const targetId = route.targetId.trim()
  if (!targetId) return ''
  const targetFlag = route.targetType === 'user' ? '--user-id' : '--chat-id'
  const text = `SCALE dashboard route probe: ${route.projectId || 'project'}/${route.agentPlatformId}/${route.agentSessionId || 'default'}`
  return ['lark-cli', 'im', '+messages-send', '--as', 'bot', targetFlag, targetId, '--text', text, '--dry-run']
    .map((part, index) => index === 0 ? part : quoteShellArg(part))
    .join(' ')
}

function previewFeishuRouteEventCommand(route: FeishuRouteConfig): string {
  return ['lark-cli', 'event', 'consume', route.eventKey || 'im.message.receive_v1', '--as', 'bot', '--timeout', '30s', '--max-events', '1', '--quiet']
    .map((part, index) => index === 0 ? part : quoteShellArg(part))
    .join(' ')
}

function exportTopologySvg() {
  const svg = document.querySelector('.topology-svg')?.outerHTML
  if (!svg) return
  downloadText('scale-topology.svg', svg, 'image/svg+xml;charset=utf-8')
}

function copyDocumentIndex() {
  const text = documents.value.map(doc => `${doc.type}\t${formatSize(doc.size)}\t${doc.path}`).join('\n')
  void copyText(text)
}

function downloadDocumentIndex() {
  downloadJson('scale-documents.json', {
    exportedAt: new Date().toISOString(),
    count: documents.value.length,
    previewableHtml: prototypeDocs.value.length,
    documents: documents.value,
  })
}

function copyKnowledgeBaseReport() {
  void copyText(JSON.stringify(knowledgeBase.value || {}, null, 2))
}

function downloadKnowledgeBaseReport() {
  downloadJson('scale-knowledge-base.json', {
    exportedAt: new Date().toISOString(),
    ...knowledgeBase.value,
  })
}

function downloadKnowledgeGraph(name: string, graph?: KnowledgeGraphReport) {
  downloadJson(name, {
    exportedAt: new Date().toISOString(),
    graph: graph || null,
  })
}

function resetKnowledgeGraphView() {
  knowledgeGraphFingerprint = ''
  knowledgeGraphChart?.clear()
  void renderKnowledgeGraphChart(true)
}

function toggleGraphFocusMode() {
  graphFocusMode.value = !graphFocusMode.value
  void renderKnowledgeGraphChart(true)
}

function renderKnowledgeGraphChart(reset = false) {
  if (activePage.value !== 'knowledge' || knowledgeTab.value !== 'graph') return
  void nextTick(() => {
    if (!graphChartEl.value || !activeKnowledgeGraphHasData.value) return
    const themeName = dark.value ? 'dark' : 'light'
    if (knowledgeGraphChart && knowledgeGraphChartTheme !== themeName) {
      knowledgeGraphChart.dispose()
      knowledgeGraphChart = null
      knowledgeGraphFingerprint = ''
    }
    if (!knowledgeGraphChart) {
      knowledgeGraphChart = echarts.init(graphChartEl.value, dark.value ? 'dark' : undefined, { renderer: 'canvas' })
      knowledgeGraphChartTheme = themeName
      knowledgeGraphChart.on('click', handleKnowledgeGraphChartClick)
    }
    observeGraphChartElement()
    const nextFingerprint = currentKnowledgeGraphFingerprint()
    knowledgeGraphChart.setOption(knowledgeGraphChartOption.value, {
      notMerge: reset || nextFingerprint !== knowledgeGraphFingerprint,
      lazyUpdate: false,
    })
    knowledgeGraphFingerprint = nextFingerprint
    knowledgeGraphChart.resize()
  })
}

function observeGraphChartElement() {
  if (!graphChartEl.value || graphResizeObserver || typeof ResizeObserver === 'undefined') return
  graphResizeObserver = new ResizeObserver(() => knowledgeGraphChart?.resize())
  graphResizeObserver.observe(graphChartEl.value)
}

function resizeKnowledgeGraphChart() {
  knowledgeGraphChart?.resize()
}

function handleKnowledgeGraphChartClick(params: unknown) {
  const event = params as KnowledgeGraphChartClick
  if (event.componentType !== 'series' || event.seriesType !== 'graph' || event.dataType === 'edge') return
  const id = event.data?.id
  const node = event.data?.raw || activeKnowledgeGraph.value?.nodes.find(item => item.id === id)
  if (node) void selectGraphNode(activeGraphKey.value, node)
}

function currentKnowledgeGraphFingerprint() {
  const graph = activeKnowledgeGraph.value
  return [
    activeGraphKey.value,
    dark.value ? 'dark' : 'light',
    lang.value,
    graph?.nodeCount || 0,
    graph?.edgeCount || 0,
    graph?.source || '',
    graphNodeLimit.value,
  ].join(':')
}

function disposeKnowledgeGraphChart() {
  graphResizeObserver?.disconnect()
  graphResizeObserver = null
  knowledgeGraphChart?.dispose()
  knowledgeGraphChart = null
  knowledgeGraphFingerprint = ''
}

async function selectGraphNode(key: GraphKey, node: KnowledgeGraphNode) {
  selectedGraphNodes.value = { ...selectedGraphNodes.value, [key]: node }
  graphNodePreview.value = { ...graphNodePreview.value, [key]: graphNodeDetails(node) }
  if (!node.path) return
  try {
    const content = await fetchDocumentText(node.path)
    graphNodePreview.value = { ...graphNodePreview.value, [key]: content }
  } catch {
    // Keep the structural node details if the backing document is unavailable.
  }
}

async function jumpToGraphNodeDocument(key: GraphKey) {
  const node = selectedGraphNodes.value[key]
  if (!node?.path) return
  const knowledgeDoc = knowledgeDocuments.value.find(doc => doc.path === node.path)
  if (knowledgeDoc) {
    knowledgeTab.value = 'base'
    await selectKnowledgeDocument(knowledgeDoc)
    return
  }
  const doc = documents.value.find(item => item.path === node.path)
  if (doc) {
    activePage.value = 'documents'
    await selectDocument(doc)
  }
}

async function openGraphReport() {
  const reportPath = activeKnowledgeGraph.value?.reportPath
  if (!reportPath) return
  const knowledgeDoc = knowledgeDocuments.value.find(doc => doc.path === reportPath)
  if (knowledgeDoc) {
    knowledgeTab.value = 'base'
    await selectKnowledgeDocument(knowledgeDoc)
  }
}

function graphNodeDetails(node: KnowledgeGraphNode) {
  return JSON.stringify({
    id: node.id,
    label: node.label,
    kind: node.kind,
    group: node.group,
    source: node.source,
    path: node.path,
  }, null, 2)
}

function toggleDocumentFavorite(path: string) {
  const next = new Set(documentFavorites.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  documentFavorites.value = next
  localStorage.setItem('scale-doc-favorites', JSON.stringify([...next]))
}

function setLang(next: Lang) {
  lang.value = next
  localStorage.setItem('scale-dashboard-lang', next)
}

function setTheme(next: boolean) {
  dark.value = next
  localStorage.setItem('scale-dashboard-theme', next ? 'dark' : 'light')
}

function onProjectChange(value: string) {
  if (value) window.location.href = `${value.replace(/\/$/, '')}/`
}

function setPage(page: PageKey) {
  activePage.value = page
  history.replaceState(null, '', `#${page}`)
}

function focusIntegrationStep(stepId: string) {
  activePage.value = 'integrations'
  activeIntegrationTab.value = integrationTabForStep(stepId)
}

function integrationTabForStep(stepId: string): IntegrationTab {
  if (stepId === 'feishu-cli' || stepId === 'feishu-route') return 'messages'
  if (stepId === 'agent-connect-config' || stepId === 'tokens' || stepId === 'bridge-webhook') return 'agent-connect'
  if (stepId === 'required-skills') return 'automation'
  return 'overview'
}

interface DashboardHttpResponse {
  ok: boolean
  status: number
  statusText: string
  json: () => Promise<unknown>
  text: () => Promise<string>
}

async function dashboardFetch(url: string, init?: RequestInit): Promise<DashboardHttpResponse> {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch(url, init)
  }
  if (typeof globalThis.XMLHttpRequest === 'function') {
    return xhrFetch(url, init)
  }
  const bootstrapResponse = readBootstrapResponse(url, init)
  if (bootstrapResponse) return bootstrapResponse
  throw new Error(`Dashboard HTTP transport unavailable: ${url}`)
}

function readBootstrapResponse(url: string, init?: RequestInit): DashboardHttpResponse | null {
  const method = String(init?.method || 'GET').toUpperCase()
  if (method !== 'GET') return null
  const endpoint = normalizeBootstrapEndpoint(url)
  if (!endpoint || !dashboardBootstrap?.endpoints) return null
  if (!Object.prototype.hasOwnProperty.call(dashboardBootstrap.endpoints, endpoint)) return null
  const value = dashboardBootstrap.endpoints[endpoint]
  const body = JSON.stringify(value ?? null)
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => value,
    text: async () => body,
  }
}

function normalizeBootstrapEndpoint(url: string): string {
  const text = String(url || '').trim()
  if (!text) return ''
  const withoutOrigin = text.replace(/^https?:\/\/[^/]+/i, '')
  return withoutOrigin.startsWith('/') ? withoutOrigin : `/${withoutOrigin}`
}

function xhrFetch(url: string, init?: RequestInit): Promise<DashboardHttpResponse> {
  return new Promise((resolveRequest, rejectRequest) => {
    const xhr = new XMLHttpRequest()
    xhr.open(init?.method || 'GET', url, true)
    applyRequestHeaders(xhr, init?.headers)
    xhr.onload = () => {
      const body = xhr.responseText || ''
      resolveRequest({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        statusText: xhr.statusText,
        json: async () => JSON.parse(body || '{}') as unknown,
        text: async () => body,
      })
    }
    xhr.onerror = () => rejectRequest(new Error(`Network request failed: ${url}`))
    xhr.ontimeout = () => rejectRequest(new Error(`Network request timed out: ${url}`))
    xhr.send(init?.body as XMLHttpRequestBodyInit | null | undefined)
  })
}

function applyRequestHeaders(xhr: XMLHttpRequest, headers?: HeadersInit) {
  if (!headers) return
  if (headers instanceof Headers) {
    headers.forEach((value, key) => xhr.setRequestHeader(key, value))
    return
  }
  if (Array.isArray(headers)) {
    headers.forEach(([key, value]) => xhr.setRequestHeader(key, value))
    return
  }
  Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, String(value)))
}

async function fetchJSON<T>(url: string, timeoutMs = 12000): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetchJSONOnce<T>(url, timeoutMs)
    } catch (error) {
      lastError = error
      if (attempt >= 2 || !isTransientDashboardFetchError(error)) throw error
      await sleep(350 * (attempt + 1))
    }
  }
  throw lastError
}

async function fetchJSONOnce<T>(url: string, timeoutMs = 12000): Promise<T> {
  const controller = typeof globalThis.AbortController === 'function' ? new AbortController() : null
  const timeoutError = new Error(`Request timed out after ${timeoutMs}ms: ${url}`)
  const timeout = controller ? globalThis.setTimeout(() => controller.abort(timeoutError), timeoutMs) : undefined
  try {
    const response = await dashboardFetch(url, controller ? { signal: controller.signal } : undefined)
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`)
    return await response.json() as T
  } catch (error) {
    if (controller?.signal.aborted) throw timeoutError
    throw error
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout)
  }
}

function isTransientDashboardFetchError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase()
  return message.includes('failed to fetch')
    || message.includes('network request failed')
    || message.includes('network request timed out')
    || message.includes('request timed out')
    || message.includes('connection refused')
    || message.includes('connection reset')
    || message.includes('err_connection')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => globalThis.setTimeout(resolve, ms))
}

function actionButton(label: string, onClick: () => void) {
  return h('button', { type: 'button', class: 'mini-action', onClick }, label)
}

function sourceById(id: string): DataSourceSignal | undefined {
  return dataSources.value.find(source => source.id === id)
}

function sourceDescription(source: DataSourceSignal): string {
  const mapped = t(`source.${source.id}.desc`)
  return mapped.startsWith('source.') ? source.description : mapped
}

function sourceReason(source?: DataSourceSignal): string {
  if (!source) return ''
  if (!source.emptyReason && !source.action) return ''
  const statusMapped = t(`source.${source.id}.reason.${source.status}`)
  if (!statusMapped.startsWith('source.')) return statusMapped
  const mapped = t(`source.${source.id}.reason`)
  if (!mapped.startsWith('source.')) return mapped
  return [source.emptyReason, source.action].filter(Boolean).join(' ')
}

function hasAgentControlSessionStatus(): SourceStatus {
  if ((agentControl.value?.summary.ready || 0) > 0) return 'ready'
  if ((agentControl.value?.summary.sessions || 0) > 0) return 'partial'
  return 'missing'
}

function statusLabel(status: SourceStatus): string {
  return t(`status.${status}`)
}

function statusTag(status: SourceStatus): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'ready') return 'success'
  if (status === 'partial') return 'warning'
  if (status === 'missing' || status === 'error') return 'error'
  return 'default'
}

function agentStatusLabel(status: AgentControlSession['status']): string {
  return status === 'blocked' ? t('status.blocked') : statusLabel(status)
}

function agentStatusTag(status: AgentControlSession['status']): 'success' | 'warning' | 'error' | 'default' {
  return status === 'blocked' ? 'error' : statusTag(status)
}

function agentMessageStatusTag(status: AgentControlMessageStatus): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'delivered' || status === 'completed') return 'success'
  if (status === 'queued' || status === 'claimed') return 'warning'
  if (status === 'blocked' || status === 'failed' || status === 'cancelled') return 'error'
  return 'default'
}

function statusTone(status: string): 'success' | 'warning' | 'error' | 'default' {
  const normalized = status.toLowerCase()
  if (['done', 'passed', 'approved', 'active', 'closed', 'resolved', 'ready'].some(item => normalized.includes(item))) return 'success'
  if (['fail', 'reject', 'block', 'error'].some(item => normalized.includes(item))) return 'error'
  if (['pending', 'draft', 'candidate', 'proposed', 'partial'].some(item => normalized.includes(item))) return 'warning'
  return 'default'
}

function refreshLabel(mode: string): string {
  return t(`refresh.${mode}`)
}

function runtimeLabel(value: string): string {
  const key = `runtime.${value}`
  const translated = t(key)
  return translated === key ? value : translated
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(lang.value === 'zh' ? 'zh-CN' : 'en-US').format(Number(value || 0))
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '-'
  const normalized = value <= 1 ? value * 100 : value
  return `${Math.round(normalized)}%`
}

function formatCurrency(value?: number): string {
  return new Intl.NumberFormat(lang.value === 'zh' ? 'zh-CN' : 'en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  }).format(value || 0)
}

function formatTime(value?: number | null): string {
  if (!value) return '-'
  return new Date(value).toLocaleString(lang.value === 'zh' ? 'zh-CN' : 'en-US')
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function documentUrl(path: string): string {
  return `/api/documents/${path.split('/').map(segment => encodeURIComponent(segment)).join('/')}`
}

function documentDownloadUrl(path: string): string {
  return `${documentUrl(path)}?download=1`
}

function absoluteDocumentUrl(path: string): string {
  return new URL(documentUrl(path), window.location.origin).href
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function artifactCount(items?: ArtifactTreeNode[]): number {
  return flattenArtifacts(items || []).length
}

function flattenArtifacts(items: ArtifactTreeNode[]): ArtifactTreeNode[] {
  const result: ArtifactTreeNode[] = []
  const walk = (nodes: ArtifactTreeNode[]) => {
    for (const item of nodes) {
      result.push(item)
      walk(item.children || [])
    }
  }
  walk(items)
  return result
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right))
}

function groupDocuments(items: DocumentItem[]): DocumentGroup[] {
  const groups = new Map<string, DocumentItem[]>()
  for (const item of items) {
    const parts = item.path.split('/')
    const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '/'
    const bucket = groups.get(folder) || []
    bucket.push(item)
    groups.set(folder, bucket)
  }
  return [...groups.entries()]
    .map(([folder, docs]) => ({
      folder,
      documents: docs.sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => left.folder.localeCompare(right.folder))
}

function buildKnowledgeGraphChartOption(graph: KnowledgeGraphReport | undefined, key: GraphKey, limit: number): EChartsOption {
  const nodes = graph?.nodes || []
  const edges = graph?.edges || []
  const degree = knowledgeGraphDegree(edges)
  const visibleNodes = [...nodes]
    .sort((left, right) => {
      const degreeDelta = (degree.get(right.id) || 0) - (degree.get(left.id) || 0)
      return degreeDelta || (left.label || left.id).localeCompare(right.label || right.id)
    })
    .slice(0, Math.max(1, limit))
  const groupNames = [...new Set(visibleNodes.map(node => node.group || node.kind || node.source || 'unknown'))]
    .sort((left, right) => left.localeCompare(right))
  const categoryIndex = new Map(groupNames.map((group, index) => [group, index]))
  const nodeIds = new Set(visibleNodes.map(node => node.id))
  const darkMode = dark.value
  const chartNodes: KnowledgeGraphChartDatum[] = visibleNodes.map(node => {
    const group = node.group || node.kind || node.source || 'unknown'
    const nodeDegree = degree.get(node.id) || 0
    return {
      id: node.id,
      name: node.label || node.id,
      value: nodeDegree,
      symbolSize: clamp(18 + Math.sqrt(Math.max(nodeDegree, 1)) * 8, 20, 58),
      category: categoryIndex.get(group) || 0,
      draggable: true,
      raw: node,
      itemStyle: { color: graphColor(group) },
      label: { show: visibleNodes.length <= 70 || nodeDegree >= 3 },
    }
  })
  const chartEdges = edges
    .filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map(edge => ({
      source: edge.source,
      target: edge.target,
      value: edge.label || '',
    }))
  return {
    backgroundColor: 'transparent',
    animationDurationUpdate: 350,
    tooltip: {
      trigger: 'item',
      confine: true,
      backgroundColor: darkMode ? '#161b22' : '#ffffff',
      borderColor: darkMode ? '#30363d' : '#d0d7de',
      textStyle: { color: darkMode ? '#f0f6fc' : '#24292f' },
      formatter: formatKnowledgeGraphTooltip,
    },
    legend: {
      show: groupNames.length > 1 && groupNames.length <= 12,
      top: 8,
      left: 12,
      type: 'scroll',
      textStyle: { color: darkMode ? '#c9d1d9' : '#57606a' },
      data: groupNames,
    },
    series: [{
      id: `knowledge-${key}`,
      type: 'graph',
      layout: 'force',
      data: chartNodes,
      links: chartEdges,
      categories: groupNames.map(group => ({ name: group })),
      roam: true,
      draggable: true,
      scaleLimit: { min: 0.25, max: 5 },
      edgeSymbol: ['none', 'arrow'],
      edgeSymbolSize: [0, 6],
      label: {
        show: visibleNodes.length <= 60,
        position: 'right',
        formatter: '{b}',
        color: darkMode ? '#c9d1d9' : '#24292f',
        fontSize: 11,
      },
      labelLayout: { hideOverlap: true },
      force: {
        repulsion: visibleNodes.length > 120 ? 100 : 220,
        edgeLength: visibleNodes.length > 120 ? [36, 96] : [70, 180],
        gravity: 0.055,
        friction: 0.58,
      },
      lineStyle: {
        color: 'source',
        opacity: darkMode ? 0.28 : 0.36,
        width: 1.1,
        curveness: 0.08,
      },
      emphasis: {
        focus: 'adjacency',
        label: {
          show: true,
          fontWeight: 700,
        },
        lineStyle: {
          opacity: 0.82,
          width: 2.2,
        },
      },
    }],
  }
}

function knowledgeGraphDegree(edges: KnowledgeGraphEdge[]): Map<string, number> {
  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1)
  }
  return degree
}

function visibleKnowledgeGraphEdgeCount(graph: KnowledgeGraphReport | undefined, limit: number): number {
  const nodes = graph?.nodes || []
  const edges = graph?.edges || []
  if (nodes.length === 0 || edges.length === 0) return 0
  const degree = knowledgeGraphDegree(edges)
  const visibleNodeIds = new Set([...nodes]
    .sort((left, right) => {
      const degreeDelta = (degree.get(right.id) || 0) - (degree.get(left.id) || 0)
      return degreeDelta || (left.label || left.id).localeCompare(right.label || right.id)
    })
    .slice(0, Math.max(1, limit))
    .map(node => node.id))
  return edges.filter(edge => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)).length
}

function formatKnowledgeGraphTooltip(params: unknown): string {
  const event = params as {
    dataType?: string
    name?: string
    data?: { raw?: KnowledgeGraphNode; value?: number; source?: string; target?: string }
  }
  if (event.dataType === 'edge') {
    return [
      `<strong>${escapeHtml(t('knowledge.edge'))}</strong>`,
      `${escapeHtml(String(event.data?.source || ''))} -> ${escapeHtml(String(event.data?.target || ''))}`,
      event.data?.value ? escapeHtml(String(event.data.value)) : '',
    ].filter(Boolean).join('<br/>')
  }
  const node = event.data?.raw
  return [
    `<strong>${escapeHtml(node?.label || event.name || '')}</strong>`,
    `${escapeHtml(t('documents.path'))}: ${escapeHtml(node?.path || '-')}`,
    `${escapeHtml(t('knowledge.nodeKind'))}: ${escapeHtml(node?.kind || '-')}`,
    `${escapeHtml(t('knowledge.nodeGroup'))}: ${escapeHtml(node?.group || '-')}`,
    `${escapeHtml(t('table.source'))}: ${escapeHtml(node?.source || '-')}`,
    `${escapeHtml(t('knowledge.degree'))}: ${escapeHtml(String(event.data?.value || 0))}`,
  ].join('<br/>')
}

function graphColor(group?: string): string {
  const palette = ['#18a058', '#2080f0', '#f0a020', '#d03050', '#0891b2', '#7c3aed', '#c2410c', '#4b5563']
  const text = group || 'unknown'
  let hash = 0
  for (const char of text) hash += char.charCodeAt(0)
  return palette[hash % palette.length]!
}

function layoutTopology(nodes: TopologyNode[], degree: Map<string, number>): PositionedTopologyNode[] {
  if (nodes.length === 0) return []
  const centerX = 500
  const centerY = 310
  const radius = Math.max(150, Math.min(280, 52 + nodes.length * 1.8))
  return nodes.map((node, index) => {
    const angle = (Math.PI * 2 * index) / nodes.length
    const layerOffset = ((node.layer || 'unknown').charCodeAt(0) % 5) * 18
    return {
      node,
      x: centerX + Math.cos(angle) * (radius - layerOffset),
      y: centerY + Math.sin(angle) * (radius - layerOffset),
      degree: degree.get(node.id) || 0,
    }
  })
}

function normalizeDomains(raw: unknown, nodes: TopologyNode[]): DomainSummary[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.slice(0, 12).map((item, index) => {
      const record = item as { id?: string; name?: string; nodes?: TopologyNode[] }
      const domainNodes = Array.isArray(record.nodes) ? record.nodes : []
      return {
        id: record.id || record.name || `domain-${index}`,
        name: record.name || record.id || `domain-${index}`,
        nodes: domainNodes,
        count: domainNodes.length,
      }
    })
  }
  if (typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>).slice(0, 12).map(([name, value]) => {
      const record = value as { nodes?: TopologyNode[]; count?: number }
      const domainNodes = Array.isArray(record?.nodes) ? record.nodes : nodes.filter(node => node.domain === name)
      return { id: name, name, nodes: domainNodes, count: Number(record?.count || domainNodes.length) }
    })
  }
  return []
}

function layerColor(layer?: string): string {
  const palette = ['#18a058', '#2080f0', '#f0a020', '#d03050', '#7c3aed', '#0891b2', '#ca8a04']
  const text = layer || 'unknown'
  let hash = 0
  for (const char of text) hash += char.charCodeAt(0)
  return palette[hash % palette.length]!
}

function toBars(record: Record<string, number>, tone: string): BarRow[] {
  const entries = Object.entries(record).sort((left, right) => right[1] - left[1])
  const max = Math.max(...entries.map(([, value]) => value), 1)
  return entries.map(([label, value]) => ({
    label,
    value,
    width: `${Math.max(4, (value / max) * 100)}%`,
    tone,
  }))
}

function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  let html = ''
  let inCode = false
  let listOpen = false
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.startsWith('```')) {
      if (inCode) html += '</code></pre>'
      else html += '<pre><code>'
      inCode = !inCode
      continue
    }
    if (inCode) {
      html += `${escapeHtml(raw)}\n`
      continue
    }
    if (!line.trim()) {
      if (listOpen) {
        html += '</ul>'
        listOpen = false
      }
      continue
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      if (listOpen) {
        html += '</ul>'
        listOpen = false
      }
      const level = heading[1]!.length
      html += `<h${level}>${inlineMarkdown(heading[2]!)}</h${level}>`
      continue
    }
    const item = line.match(/^[-*]\s+(.+)$/)
    if (item) {
      if (!listOpen) {
        html += '<ul>'
        listOpen = true
      }
      html += `<li>${inlineMarkdown(item[1]!)}</li>`
      continue
    }
    if (listOpen) {
      html += '</ul>'
      listOpen = false
    }
    html += `<p>${inlineMarkdown(line)}</p>`
  }
  if (listOpen) html += '</ul>'
  if (inCode) html += '</code></pre>'
  return html
}

function inlineMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+|\/[^)]+|#[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function readLocalArray(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]') as unknown
    return Array.isArray(value) ? value.map(String) : []
  } catch {
    return []
  }
}

function readDashboardBootstrap(): DashboardBootstrap | null {
  try {
    return window.__SCALE_DASHBOARD_BOOTSTRAP__ || null
  } catch {
    return null
  }
}

function bootstrapEndpoint<T>(endpoint: string, fallback: T): T {
  if (!dashboardBootstrap?.endpoints || !Object.prototype.hasOwnProperty.call(dashboardBootstrap.endpoints, endpoint)) {
    return fallback
  }
  return dashboardBootstrap.endpoints[endpoint] as T
}

function isPageKey(value: string): value is PageKey {
  return ['overview', 'workflow', 'topology', 'monitoring', 'costs', 'knowledge', 'agents', 'integrations', 'documents', 'prompts'].includes(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isPartialLoadNotice(value: string): boolean {
  return Boolean(value)
    && (value.startsWith(translations.zh['common.partialLoad'])
      || value.startsWith(translations.en['common.partialLoad']))
}

function t(key: string, params?: Record<string, string | number>): string {
  const value = translations[lang.value][key] || translations.en[key] || key
  if (!params) return value
  return Object.entries(params).reduce((text, [name, replacement]) => text.replaceAll(`{${name}}`, String(replacement)), value)
}

function readinessStageTitle(stage: AgentOsReadinessStage): string {
  return t(`agentOs.${stage.id}.title`)
}

function readinessStageDescription(stage: AgentOsReadinessStage): string {
  return t(`agentOs.${stage.id}.desc`)
}

function readinessStageAction(stage: AgentOsReadinessStage): string {
  return t(`agentOs.${stage.id}.action`)
}

watch([activePage, knowledgeTab, activeGraphKey, graphNodeLimit, graphFocusMode, knowledgeBase, dark, lang], () => {
  if (activePage.value !== 'knowledge' || knowledgeTab.value !== 'graph') return
  if (!activeKnowledgeGraphHasData.value) {
    disposeKnowledgeGraphChart()
    return
  }
  renderKnowledgeGraphChart()
})

onMounted(() => {
  void refreshActivePage()
  connectStream()
  refreshTimer = window.setInterval(() => void refreshActivePage(), 30000)
  window.addEventListener('resize', resizeKnowledgeGraphChart)
  window.addEventListener('hashchange', () => {
    const next = location.hash.slice(1)
    if (isPageKey(next)) activePage.value = next
  })
})

onBeforeUnmount(() => {
  stream.value?.close()
  if (refreshTimer) window.clearInterval(refreshTimer)
  window.removeEventListener('resize', resizeKnowledgeGraphChart)
  disposeKnowledgeGraphChart()
})

const translations: Record<Lang, Record<string, string>> = {
  zh: {
    'nav.overview': '总览',
    'nav.workflow': '工作流',
    'nav.topology': '拓扑',
    'nav.monitoring': '监控',
    'nav.costs': 'Token 与成本',
    'nav.knowledge': '知识库',
    'nav.agents': 'Agent 控制台',
    'nav.integrations': '集成配置',
    'nav.documents': '文档与原型',
    'nav.prompts': '提示词',
    'common.refresh': '刷新',
    'common.copied': '已复制',
    'common.copy': '复制',
    'common.download': '下载',
    'common.exportJson': '导出 JSON',
    'common.edit': '编辑',
    'common.save': '保存',
    'common.cancel': '取消',
    'common.reset': '重置',
    'common.lastLoaded': '最后加载',
    'common.ok': '正常',
    'common.empty': '暂无数据',
    'common.open': '打开',
    'common.newTab': '新窗口',
    'common.search': '搜索',
    'common.view': '查看',
    'common.snapshot': '快照',
    'common.language': '中文',
    'common.theme': '主题',
    'common.partialLoad': '部分数据源加载失败',
    'common.loading': '加载中',
    'common.ready': '已就绪',
    'common.unknown': '未知',
    'status.ready': '就绪',
    'status.partial': '部分闭环',
    'status.missing': '缺失',
    'status.error': '错误',
    'status.blocked': '已阻塞',
    'refresh.sse': '实时事件',
    'refresh.polling': '轮询',
    'refresh.manual': '手动',
    'refresh.snapshot': '快照',
    'table.source': '数据源',
    'table.status': '状态',
    'table.count': '数量',
    'table.refresh': '刷新',
    'table.reason': '说明',
    'table.action': '操作',
    'overview.readySources': '就绪数据源',
    'overview.partialSources': '部分闭环',
    'overview.missingSources': '缺失数据源',
    'overview.artifacts': 'Artifact',
    'overview.commands': '命令证据',
    'overview.memory': '记忆节点',
    'overview.documents': '文档/原型',
    'overview.capabilityMatrix': '能力闭环矩阵',
    'overview.runtimeEvents': '运行时事件',
    'overview.projects': '项目',
    'commandCenter.agentOs': 'Agent OS',
    'commandCenter.title': 'Agent OS 指挥中心',
    'commandCenter.subtitle': '从这里完成远程 coding、消息通道、Agent 对话、记忆、知识库、Hook 循环和守护进程的闭环配置。',
    'commandCenter.readyItems': '项就绪',
    'commandCenter.nextBestActions': '下一步优先处理',
    'commandCenter.liveSignals': '实时信号',
    'commandCenter.allReady': '核心工作流已就绪，可以直接进入 Agent 控制台。',
    'commandCenter.chatNow': '打开 Agent 聊天',
    'commandCenter.configureChannels': '配置消息通道',
    'commandCenter.openAgents': '进入 Agent 控制台',
    'commandCenter.openIntegrations': '进入集成配置',
    'commandCenter.openKnowledge': '进入知识库',
    'commandCenter.openCosts': '查看成本账本',
    'commandCenter.watchdog': '面板守护进程',
    'commandCenter.watchdogDesc': '保持可视化面板和后台 API 常驻，异常时可自动恢复。',
    'commandCenter.agentControl': 'Agent 控制台',
    'commandCenter.agentControlDesc': '管理项目会话、平台、模型、聊天、队列、回复和摘要。',
    'commandCenter.agentConnect': 'Agent Connect',
    'commandCenter.agentConnectDesc': '远程控制 API、Bridge、Webhook、Heartbeat 和 Loop 自动化总开关。',
    'commandCenter.feishuRoute': '飞书消息路由',
    'commandCenter.feishuRouteDesc': '每个 Agent 平台独立绑定飞书 chat/user 和 dry-run 发送计划。',
    'commandCenter.knowledgeGraph': '知识图谱',
    'commandCenter.knowledgeGraphDesc': 'Graphify 文档和代码知识图谱，用于检索、预览和上下文导航。',
    'commandCenter.memory': 'gbrain 记忆',
    'commandCenter.memoryDesc': '沉淀可复用的项目事实、决策、上下文和长期记忆。',
    'commandCenter.defaultSkills': '满血默认能力',
    'commandCenter.defaultSkillsDesc': 'gbrain、hooks、通知、飞书卡片、文档读取等能力必须默认纳入工作流。',
    'commandCenter.modelUsage': '模型用量账本',
    'commandCenter.modelUsageDesc': '记录 provider usage，支撑 Token、缓存和成本分析。',
    'commandCenter.automationLoops': 'Hook/Loop 自动化',
    'commandCenter.automationLoopsDesc': '权限提醒、完成推送、摘要卡、心跳和 watchdog 循环。',
    'commandCenter.pathRemoteCoding': '手机远程 coding',
    'commandCenter.pathRemoteCodingDesc': '飞书或 Bridge 收消息，Agent Control 派发任务，Agent 回复再回到通道。',
    'commandCenter.pathLocalChat': '本地 Agent 聊天',
    'commandCenter.pathLocalChatDesc': '在面板里选择平台和模型，直接与 Agent 对话、查看历史和摘要。',
    'commandCenter.pathKnowledgeMemory': '知识库和记忆',
    'commandCenter.pathKnowledgeMemoryDesc': '把文档、图谱、会话摘要和长期记忆连接成可检索上下文。',
    'commandCenter.pathOpsLoop': '常驻自动化循环',
    'commandCenter.pathOpsLoopDesc': '守护进程、Webhook、成本账本和 Hook 事件让工作流持续运转。',
    'commandCenter.stepAgent': 'Agent 会话',
    'commandCenter.stepFeishu': '飞书路由',
    'commandCenter.stepBridge': 'Bridge',
    'commandCenter.stepSession': '会话',
    'commandCenter.stepModel': '模型',
    'commandCenter.stepQueue': '队列',
    'commandCenter.stepDocuments': '文档',
    'commandCenter.stepGraph': '图谱',
    'commandCenter.stepMemory': '记忆',
    'commandCenter.stepWatchdog': '守护',
    'commandCenter.stepWebhook': 'Webhook',
    'commandCenter.stepUsage': '用量',
    'workflow.title': '工作流闭环',
    'workflow.artifact': 'Artifact',
    'workflow.type': '类型',
    'workflow.status': '状态',
    'workflow.version': '版本',
    'workflow.gates': '门禁',
    'workflow.actions': '可执行动作',
    'workflow.transition': 'Artifact 状态迁移',
    'workflow.transitionDesc': '普通 serve 没有注入 FSM/store 时写操作会显示为部分闭环；嵌入运行时启动后可执行状态迁移。',
    'workflow.transitionRecorded': '状态迁移已写入',
    'workflow.noActions': '当前 Artifact 无可执行动作或运行时未注入 FSM。',
    'workflow.failedRequired': '失败必需门禁',
    'topology.nodes': '节点',
    'topology.edges': '边',
    'topology.layers': '层级',
    'topology.kinds': '类型',
    'topology.domains': '领域',
    'topology.detail': '详情',
    'topology.exportSvg': '导出 SVG',
    'topology.selectHint': '选择节点查看调用/依赖上下文。',
    'monitoring.activeDetectors': '检测器',
    'monitoring.autoDefects': '自动缺陷',
    'monitoring.commandRuns': '命令运行',
    'monitoring.commandPassRate': '命令通过率',
    'monitoring.recentEvents': '近期事件',
    'monitoring.overview': '概览',
    'monitoring.detectors': '检测器',
    'monitoring.defects': '缺陷',
    'monitoring.commands': '命令',
    'monitoring.rootCause': '根因',
    'monitoring.severity': '严重级别',
    'monitoring.triggerDistribution': '触发分布',
    'monitoring.recentAutoDefects': '近期自动缺陷',
    'monitoring.noDetectorData': '没有检测器数据。',
    'monitoring.noDefectData': '没有自动缺陷数据。',
    'monitoring.noCommandData': '没有命令证据数据。',
    'monitoring.tokenSavings': 'Token 节省',
    'monitoring.passed': '通过',
    'monitoring.failed': '失败',
    'costs.modelUsage': '模型用量',
    'costs.noModelUsage': '没有模型用量账本，Token 与成本图表不会凭空造数。',
    'costs.totalTokens': '总 Token',
    'costs.inputTokens': '输入 Token',
    'costs.outputTokens': '输出 Token',
    'costs.cacheSavings': '缓存节省',
    'costs.estimatedCost': '估算成本',
    'costs.commandCompression': '命令输出压缩',
    'costs.providerBreakdown': '供应商拆分',
    'knowledge.memory': '记忆',
    'knowledge.layer': '层级',
    'knowledge.confidence': '置信度',
    'knowledge.query': '搜索/召回记忆',
    'knowledge.recall': '召回',
    'knowledge.localMemory': '本地 gbrain',
    'knowledge.baseTab': '知识库',
    'knowledge.memoryTab': 'gbrain 记忆',
    'knowledge.graphTab': '图谱',
    'knowledge.documents': '知识文档',
    'knowledge.entries': '知识条目',
    'knowledge.graphNodes': '图谱节点',
    'knowledge.preview': '知识预览',
    'knowledge.exportBase': '导出知识库',
    'knowledge.import': '导入',
    'knowledge.imported': '知识文档已导入',
    'knowledge.importName': '文件名，如 team-knowledge.md',
    'knowledge.importContent': '粘贴知识内容',
    'knowledge.noEntries': '没有 SQLite 知识条目。',
    'knowledge.graphify': 'Graphify 知识图谱',
    'knowledge.graphIntegrated': 'Graphify 图谱已集成在主工作流面板，数据源：',
    'knowledge.downloadGraphJson': '下载图谱 JSON',
    'knowledge.openGraphReport': '打开图谱报告',
    'knowledge.memoryGraph': 'gbrain 记忆图谱',
    'knowledge.fitGraph': '适配视图',
    'knowledge.focusGraph': '专注视图',
    'knowledge.exitFocus': '退出专注',
    'knowledge.nodeLimit': '节点数',
    'knowledge.visibleGraphSummary': '显示 {visible}/{total} 节点，{edges} 条边',
    'knowledge.nodePreview': '节点预览',
    'knowledge.selectNode': '选择图谱节点查看详情。',
    'knowledge.edge': '关系',
    'knowledge.nodeKind': '节点类型',
    'knowledge.nodeGroup': '节点分组',
    'knowledge.degree': '连接数',
    'knowledge.providers': '供应商状态',
    'knowledge.recallResult': '召回结果',
    'knowledge.reviewQueue': '待整理/审核',
    'knowledge.approve': '通过',
    'knowledge.reject': '拒绝',
    'knowledge.stale': '过期',
    'knowledge.reviewRecorded': '记忆 review 已写入证据',
    'integrations.providers': '供应商',
    'integrations.feishu': '飞书/Lark 消息通道',
    'integrations.feishuReady': '飞书/Lark 消息通道配置已可用。',
    'integrations.command': '命令',
    'integrations.commandPath': '命令路径',
    'integrations.configBoundary': '配置边界',
    'integrations.scope': '作用域',
    'integrations.projectScope': '当前项目',
    'integrations.agentPlatforms': 'Agent 平台目标',
    'integrations.dynamicActions': '动态控制',
    'integrations.lastAction': '最近一次执行',
    'integrations.setupCommands': '安装/配置命令',
    'integrations.verifyCommands': '验收命令',
    'integrations.dryRunSend': '消息发送预演',
    'integrations.eventConsume': '事件消费预演',
    'integrations.safety': '安全规则',
    'integrations.requiresConfirm': '需要确认',
    'integrations.dryRunOnly': '仅预演',
    'agents.sessions': 'Agent 会话',
    'agents.queuedMessages': '待处理消息',
    'agents.claimedMessages': '执行中消息',
    'agents.completedMessages': '已完成消息',
    'agents.modelCatalog': '模型目录',
    'agents.ready': 'Agent 控制台已接入当前项目，可管理平台、模型、通道和消息队列。',
    'agents.sessionConfig': '会话配置',
    'agents.chatConsole': 'Agent 对话控制台',
    'agents.platform': 'Agent 平台',
    'agents.model': '模型',
    'agents.channel': '消息通道',
    'agents.mode': '控制模式',
    'agents.commandPrefix': '命令前缀',
    'agents.autoImportKnowledge': '自动导入知识',
    'agents.saveSession': '保存会话',
    'agents.sessionSaved': 'Agent 会话已保存',
    'agents.messagePlaceholder': '输入要发给 Agent 的指令、上下文或远程 coding 任务',
    'agents.sendMessage': '发送给 Agent',
    'agents.messageQueued': '消息已进入 Agent 队列',
    'agents.messageBlocked': '消息被阻塞，请先检查通道配置',
    'agents.messageClaimed': '消息已被认领',
    'agents.messageCompleted': '任务已完成并写回回复',
    'agents.noMessages': '当前会话暂无消息',
    'agents.copyInbox': '复制轮询接口',
    'agents.claimMessage': '认领',
    'agents.completeMessage': '完成',
    'agents.claimedBy': '认领人',
    'agents.completedAt': '完成时间',
    'agents.modeDryRun': '预演模式',
    'agents.modeInteractive': '交互模式',
    'agents.modeLiveGuarded': '受控真实通道',
    'agents.channelDashboard': '面板本地队列',
    'agents.channelFeishu': '飞书/Lark CLI',
    'agents.pending': '待处理',
    'agents.lastMessage': '最近消息',
    'agents.route': '路由',
    'agents.dryRun': '预演',
    'agents.operator': '操作者',
    'agents.agent': 'Agent',
    'agents.platformTargets': '平台目标',
    'agents.sessionScope': '按 Agent 平台独立配置消息通道和模型',
    'agents.totalMessages': '消息总数',
    'agents.operatorMessages': '操作者消息',
    'agents.agentMessages': 'Agent 回复',
    'agents.blockedMessages': '阻塞/失败',
    'agents.allStatuses': '全部状态',
    'agents.noSessionSelected': '尚未选择 Agent 会话',
    'agents.channelNeedsFeishuConfig': '当前会话选择了飞书通道，但目标路由还没有完成配置。',
    'agents.channelReady': '当前会话的 Agent 平台、模型和消息通道已形成闭环。',
    'agents.searchHistory': '搜索会话历史',
    'agents.transcriptRefreshed': '会话历史已刷新',
    'agents.generateSummary': '生成摘要卡片',
    'agents.summaryGenerated': '摘要卡片已生成',
    'agents.summaryImported': '摘要卡片已导入知识库',
    'agents.history': '会话历史',
    'agents.summary': '摘要卡片',
    'agents.setup': '平台与模型',
    'agents.searchResults': '检索结果',
    'agents.matches': '条匹配',
    'agents.noHistoryMatches': '没有匹配的会话记录',
    'agents.storage': '持久化位置',
    'agents.storageDesc': 'Agent 会话记录和摘要文件保存在项目 .scale 目录中',
    'agents.transcriptPath': '消息记录',
    'agents.summaryPath': '摘要文件',
    'agents.summaryDesc': '用于回看、交接、周报和知识库沉淀',
    'agents.noSummary': '当前会话还没有摘要，点击“生成摘要卡片”。',
    'agents.importSummary': '导入知识库',
    'agents.openItems': '待处理事项',
    'agents.nextActions': '下一步',
    'agents.platformTargetsDesc': '已检测到的 Agent 平台安装和项目知识文档',
    'agents.modelCatalogDesc': '可供当前 Agent 会话选择的模型路由',
    'service.title': 'Dashboard 常驻服务',
    'service.ready': 'Dashboard 常驻守护已接入；页面和 API 会被后台探活并自动重启。',
    'service.ensure': '启用守护',
    'service.restart': '重启守护',
    'service.heartbeat': '最近心跳',
    'service.restarts': '重启次数',
    'service.installed': '开机任务',
    'service.logs': '日志',
    'service.copyLogPath': '复制日志路径',
    'service.ensureStarted': 'Dashboard 常驻守护已启动',
    'service.restartStarted': 'Dashboard 常驻守护已开始重启',
    'documents.name': '名称',
    'documents.type': '类型',
    'documents.size': '大小',
    'documents.path': '路径',
    'documents.preview': '预览',
    'documents.saved': '文档已保存',
    'documents.prototypeGallery': 'UI 原型',
    'documents.copyIndex': '复制索引',
    'documents.downloadIndex': '下载索引',
    'documents.favorite': '收藏',
    'documents.search': '搜索文档、路径或类型',
    'prompts.gallery': '模板库',
    'prompts.optimizer': '优化器',
    'prompts.input': '输入原始需求或提示词',
    'prompts.optimize': '优化',
    'prompts.command': '命令',
    'prompts.agentPlan': 'Agent 编排计划',
    'prompts.agentPlanGenerate': '生成计划',
    'prompts.agentPlanGenerated': 'Agent 编排计划已生成',
    'prompts.agentPlanOpenJson': '打开 JSON',
    'prompts.agentPlanBudget': 'Token 预算',
    'prompts.agentPlanFiles': '相关文件，逗号分隔',
    'prompts.agentPlanRoles': '角色',
    'prompts.agentPlanHandoffs': '交接',
    'prompts.agentPlanReviewGates': '互审门禁',
    'prompts.agentPlanReserve': '预留 token',
    'prompts.phase': '阶段',
    'prompts.role': '角色',
    'prompts.bestFor': '适用场景',
    'prompts.workflow': '工作流',
    'prompts.skills': '技能',
    'prompts.tools': '工具',
    'prompts.outputs': '产出物',
    'prompts.questions': '引导问题',
    'prompts.references': '方法参考',
    'prompts.search': '搜索模板、pack、命令',
    'source.project-scale-dir.desc': '.scale 工作流目录是否存在。',
    'source.runtime-evidence.desc': '运行时 pass/fail/resolved 证据。',
    'source.command-runs.desc': '命令执行、通过率与压缩节省证据。',
    'source.model-usage.desc': '模型 Token、缓存与成本账本。',
    'source.memory-brain.desc': 'gbrain 本地记忆节点。',
    'source.knowledge-base.desc': '知识文档、SQLite 知识条目、Karpathy 指南与 Graphify 图谱。',
    'source.documents.desc': '可预览、复制、下载的 Markdown/JSON/HTML 文档。',
    'source.prompt-studio.desc': '内置 vibe coding 模板、pack 与优化 API。',
    'source.dashboard-service.desc': 'Dashboard 常驻守护、健康检查、PID、重启次数与日志。',
    'source.feishu-channel.desc': '基于 lark-cli 的手机通知、命令接入、事件流与在线知识通道配置。',
    'source.agent-control-plane.desc': '面板管理的 Agent 会话、模型选择、消息路由、队列和 Agent 回复收件箱。',
    'source.agent-collaboration.desc': 'AI OS agent 角色选择、DAG 交接、互审门禁、token 预算与 guarded execution 结算。',
    'source.event-stream.desc': '用于实时刷新的 Server-Sent Events。',
    'source.artifact-fsm.desc': 'Artifact 状态迁移写操作。',
    'source.project-scale-dir.reason': '项目没有 .scale 目录，请先初始化或运行 bootstrap。',
    'source.runtime-evidence.reason': '没有运行时证据 JSON，请运行会写入 runtime evidence 的 verify/preflight。',
    'source.command-runs.reason': '没有命令执行证据，请通过 governed runtime 或 preflight 管道执行命令。',
    'source.model-usage.reason': '没有 .scale/model-usage/usage.jsonl，请先记录 provider usage。',
    'source.memory-brain.reason': 'gbrain 数据库没有可用记忆节点，请通过记忆工作流沉淀、审核或恢复项目记忆。',
    'source.knowledge-base.reason': '没有知识文档、knowledge.db 条目或 Graphify 图谱，请补充知识文档、运行知识入库或生成 graphify-out/graph.json。',
    'source.documents.reason': '没有可预览文档或 HTML 原型，请在 docs、.scale/docs 或 .scale/artifacts 下生成文件。',
    'source.prompt-studio.reason': '没有发现提示词模板，请检查内置模板注册或 .scale/prompts。',
    'source.dashboard-service.reason': 'Dashboard 常驻守护未运行；请在 Agent 控制台点击启用守护，或运行 scale dashboard daemon ensure。',
    'source.dashboard-service.reason.partial': 'Dashboard 服务器在运行，但 watchdog 未常驻；建议启用守护避免页面挂住。',
    'source.feishu-channel.reason': 'lark-cli 不在 PATH 中；飞书远程通知、命令接入和事件消费尚未配置。',
    'source.feishu-channel.reason.partial': 'lark-cli 已在 PATH 中；请先运行 lark-cli doctor，再确认目标群或用户后开启真实发送。',
    'source.feishu-channel.reason.missing': 'lark-cli 不在 PATH 中；飞书远程通知、命令接入和事件消费尚未配置。',
    'source.agent-control-plane.reason': '没有可用的 Agent 控制会话；请在 Agent 控制台选择平台、模型和消息通道。',
    'source.agent-control-plane.reason.partial': 'Agent 控制会话存在，但平台安装或消息通道还未完全就绪。',
    'source.agent-collaboration.reason': '没有已结算的 agentExecution 证据，请先运行 scale agent plan，再用 scale ai-os run --mode guarded --verify 结算。',
    'source.event-stream.reason': '当前是 heartbeat-only SSE；页面会用轮询刷新。',
    'source.artifact-fsm.reason': 'HTTP 面板没有注入 artifact store/FSM，状态迁移写操作仍是部分闭环。',
    'integrations.routeConfig': '项目消息路由',
    'integrations.routeConfigPath': '配置文件',
    'integrations.routeTarget': '当前目标',
    'integrations.platformStatus': '平台状态',
    'integrations.routeName': '路由名称',
    'integrations.targetType': '目标类型',
    'integrations.targetId': 'Chat/User ID',
    'integrations.chatTarget': '群聊',
    'integrations.userTarget': '用户',
    'integrations.platform': 'Agent 平台',
    'integrations.session': 'Agent 会话',
    'integrations.commandPrefix': '命令前缀',
    'integrations.eventKey': '事件 Key',
    'integrations.notes': '备注',
    'integrations.enableRoute': '启用路由',
    'integrations.allowWrite': '允许写命令',
    'integrations.importKnowledge': '导入知识',
    'integrations.saveRoute': '保存路由',
    'integrations.routeSaved': 'Feishu/Lark 项目消息路由已保存',
    'integrations.routeConfigured': '项目路由已配置；CLI 凭证仍在机器级 lark-cli profile/keychain 中。',
    'integrations.routePending': '项目路由还缺少真实 chat/user 目标；保存后仍保持 dry-run 优先。',
    'integrations.unsaved': '未保存',
    'integrations.routePreview': '实时预览',
    'integrations.routePreviewDesc': '根据当前表单即时生成 CLI 预演命令；不会发送真实消息。',
    'integrations.messageChannels': '消息通信渠道',
    'integrations.knowledgeProviders': '在线知识库供应商',
    'integrations.channels': '通信渠道',
    'integrations.readyChannels': '可用渠道',
    'integrations.agentConnect': 'Agent Connect 工作流',
    'integrations.agentConnectConfigured': 'Agent Connect 已完成项目级配置；Bridge、管理 API、Hook 循环可以进入联调。',
    'integrations.agentConnectPending': 'Agent Connect 还未闭环；请启用工作流并为远程 Bridge/管理 API/Webhook 配置 token。',
    'integrations.setupWizard': '连接向导',
    'integrations.setupWizardDesc': '按顺序完成飞书 CLI、Agent Connect、token、Bridge/Webhook、平台路由和默认能力。',
    'integrations.productSurface': 'Agent OS 集成工作台',
    'integrations.workbench': '消息、控制与知识库接入',
    'integrations.workbenchDesc': '把远程消息、Agent 控制、在线知识库和默认能力拆成可执行步骤；先完成主路径，再看诊断和参考信息。',
    'integrations.configureMessages': '配置消息渠道',
    'integrations.configureAgentConnect': '配置 Agent Connect',
    'integrations.configureKnowledge': '配置知识库',
    'integrations.bootstrapLocal': '一键本地闭环',
    'integrations.localBootstrapComplete': '本地 Agent OS 闭环已初始化，当前闭环进度 {score}%。外部飞书目标和腾讯 ima 授权仍需按项目补齐。',
    'integrations.setupProgress': '闭环进度',
    'integrations.nextActions': '下一步',
    'integrations.nextActionsDesc': '按状态选择要处理的接入步骤。',
    'integrations.configTabs': '配置工作区',
    'integrations.configTabsDesc': '每个区域只展示同一任务上下文里的设置、预览和动作。',
    'integrations.tabOverview': '总览',
    'integrations.tabMessages': '消息渠道',
    'integrations.tabAgentConnect': 'Agent Connect',
    'integrations.tabKnowledge': '知识库',
    'integrations.tabAutomation': '能力与自动化',
    'integrations.tabDiagnostics': '诊断',
    'integrations.agentOsReadiness': 'Agent OS 闭环验收',
    'agentOs.remote-control.title': '远程控制面',
    'agentOs.remote-control.desc': '管理 API、Bridge/Webhook 和至少一个可控 Agent 会话就绪。',
    'agentOs.remote-control.action': '启用 Agent Connect，并保存管理 API、Bridge、Webhook token。',
    'agentOs.mobile-message-channel.title': '手机消息通道',
    'agentOs.mobile-message-channel.desc': '飞书 CLI 和项目路由把手机群聊或用户消息绑定到 Agent 会话。',
    'agentOs.mobile-message-channel.action': '为至少一个 Agent 平台保存飞书群或用户目标。',
    'agentOs.agent-control-session.title': 'Agent 会话控制',
    'agentOs.agent-control-session.desc': '面板聊天、模型路由、消息队列和聊天记录存储可用于 Agent 会话。',
    'agentOs.agent-control-session.action': '配置一个已安装 Agent 平台和模型，并在 Agent 控制台发送消息。',
    'agentOs.knowledge-memory.title': '记忆与知识库',
    'agentOs.knowledge-memory.desc': '默认记忆能力已声明，在线知识库可按项目绑定。',
    'agentOs.knowledge-memory.action': '配置腾讯 ima，或先保持 gbrain 本地记忆作为默认能力。',
    'agentOs.loop-automation.title': 'Loop 自动化',
    'agentOs.loop-automation.desc': 'Hook、心跳、长任务通知和面板守护让远程工作不容易卡住。',
    'agentOs.loop-automation.action': '确保面板守护进程运行，并启用心跳与通知循环。',
    'agentOs.diagnostic-acceptance.title': '诊断验收',
    'agentOs.diagnostic-acceptance.desc': '安装、doctor、dry-run、事件消费和 setup verify 命令可用于上线前验收。',
    'agentOs.diagnostic-acceptance.action': '依次运行 setup verify、lark-cli doctor、dry-run 发送和一次事件消费。',
    'integrations.currentState': '当前状态',
    'integrations.currentStateDesc': '先确认供应商、渠道和平台是否具备接入条件。',
    'integrations.boundaryDesc': '机器级凭证、项目级路由和本地运行时必须分开管理。',
    'integrations.localRuntime': '本地运行时',
    'integrations.localRuntimeDesc': 'Bridge、管理 API 和 Hook 守护命令集中在这里检查。',
    'integrations.authModesDesc': '支持 token/API Key 或扫码授权；敏感值不写入仓库。',
    'integrations.requiredCapabilities': '默认能力',
    'integrations.requiredCapabilitiesDesc': '满血工作流必须包含记忆、通知、Hook、飞书卡片和文档读取。',
    'integrations.providerPresetsDesc': '不同 Agent 平台可复用的接入预设。',
    'integrations.diagnosticTools': '诊断与验收',
    'integrations.diagnosticToolsDesc': '这里集中放安装、doctor、dry-run 和事件消费命令。',
    'integrations.channelMatrixDesc': '只作为能力参考，不再打断主配置流程。',
    'integrations.applyRecommended': '使用推荐本地配置',
    'integrations.generateLocalTokens': '生成本地 token',
    'integrations.tokensGenerated': '已生成本地 token，保存后项目配置只保留掩码。',
    'integrations.recommendedApplied': '已填入推荐本地配置和缺失 token，请检查后保存。',
    'integrations.runDoctor': '运行 doctor',
    'integrations.runAcceptance': '运行一键验收',
    'integrations.acceptancePassed': 'Agent OS 验收已通过',
    'integrations.acceptanceScore': '验收得分',
    'integrations.copyAcceptancePath': '复制验收报告路径',
    'integrations.startFeishuConfig': '启动飞书初始化',
    'integrations.startFeishuAuth': '启动飞书授权',
    'integrations.feishuConfigStarted': '飞书初始化已启动，请打开链接或扫码完成首次配置。',
    'integrations.feishuAuthStarted': '飞书授权已启动，请打开链接或扫码完成授权。',
    'integrations.wizardFeishuCli': '安装与授权飞书 CLI',
    'integrations.wizardFeishuCliDesc': '检测 lark-cli、profile/keychain、doctor 和事件消费能力。',
    'integrations.wizardAgentConnect': '启用 Agent Connect',
    'integrations.wizardAgentConnectDesc': '打开管理 API、Bridge、Webhook 和自动化循环。',
    'integrations.wizardTokens': '配置访问 token',
    'integrations.wizardTokensDesc': '为管理 API、Bridge、Webhook 准备本机密钥，保存时只写掩码。',
    'integrations.wizardBridgeWebhook': '打通 Bridge/Webhook',
    'integrations.wizardBridgeWebhookDesc': '外部消息通道通过 Bridge 或 Webhook 写入 Agent Control。',
    'integrations.wizardRoute': '绑定 Agent 平台路由',
    'integrations.wizardRouteDesc': '每个 Agent 平台独立绑定飞书 chat/user 和会话。',
    'integrations.wizardSkills': '确认满血默认能力',
    'integrations.wizardSkillsDesc': 'gbrain、hooks、通知、飞书卡片和文档读取必须默认纳入工作流。',
    'integrations.enableWorkflow': '启用工作流',
    'integrations.managementApi': '管理 API',
    'integrations.host': '主机',
    'integrations.port': '端口',
    'integrations.token': 'Token',
    'integrations.tokenPlaceholder': '保存后仅显示掩码',
    'integrations.allowPlatforms': '允许平台',
    'integrations.heartbeatInterval': '心跳间隔(分钟)',
    'integrations.maxTurnTime': '单轮上限(分钟)',
    'integrations.resetOnIdle': '空闲重置(分钟)',
    'integrations.longTaskNotify': '长任务通知',
    'integrations.saveAgentConnect': '保存 Agent Connect',
    'integrations.agentConnectSaved': 'Agent Connect 工作流配置已保存',
    'integrations.workflowCommands': '工作流命令',
    'integrations.daemonHooks': '守护与 Hook',
    'integrations.channelMatrix': '渠道能力矩阵',
    'integrations.bridgeProtocol': 'Bridge 协议',
    'integrations.providerPresets': 'Provider 预设',
    'integrations.skillPresets': 'Skill 预设',
    'integrations.defaultInstall': '默认安装',
    'integrations.loopAutomation': 'Loop 自动化',
    'integrations.routeConfiguredShort': '路由已配置',
    'integrations.routePendingShort': '路由待配置',
    'integrations.imaConfig': '腾讯 ima 知识库',
    'integrations.imaConfigured': '腾讯 ima 知识库供应商已配置；Agent 可在启用外部记忆工作流后接入在线知识。',
    'integrations.imaPending': '腾讯 ima 还缺少 Client ID、知识库 ID 或授权方式，请补齐后保存。',
    'integrations.imaKnowledgeBaseId': '知识库 ID',
    'integrations.authMode': '授权方式',
    'integrations.authModes': '授权方式',
    'integrations.enableProvider': '启用供应商',
    'integrations.qrAuthorized': '扫码已授权',
    'integrations.saveProvider': '保存供应商',
    'integrations.knowledgeProviderSaved': '知识库供应商配置已保存',
    'documents.loading': '正在加载文档索引和预览内容',
    'knowledge.loading': '正在加载知识库、记忆和图谱',
  },
  en: {
    'nav.overview': 'Overview',
    'nav.workflow': 'Workflow',
    'nav.topology': 'Topology',
    'nav.monitoring': 'Monitoring',
    'nav.costs': 'Tokens & Cost',
    'nav.knowledge': 'Knowledge',
    'nav.agents': 'Agent Control',
    'nav.integrations': 'Integrations',
    'nav.documents': 'Docs & Prototypes',
    'nav.prompts': 'Prompts',
    'common.refresh': 'Refresh',
    'common.copied': 'Copied',
    'common.copy': 'Copy',
    'common.download': 'Download',
    'common.exportJson': 'Export JSON',
    'common.edit': 'Edit',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.reset': 'Reset',
    'common.lastLoaded': 'Last loaded',
    'common.ok': 'OK',
    'common.empty': 'No data',
    'common.open': 'Open',
    'common.newTab': 'New tab',
    'common.search': 'Search',
    'common.view': 'View',
    'common.snapshot': 'Snapshot',
    'common.language': 'EN',
    'common.theme': 'Theme',
    'common.partialLoad': 'Some data sources failed',
    'common.loading': 'Loading',
    'common.ready': 'Ready',
    'common.unknown': 'Unknown',
    'status.ready': 'Ready',
    'status.partial': 'Partial',
    'status.missing': 'Missing',
    'status.error': 'Error',
    'status.blocked': 'Blocked',
    'refresh.sse': 'SSE',
    'refresh.polling': 'Polling',
    'refresh.manual': 'Manual',
    'refresh.snapshot': 'Snapshot',
    'table.source': 'Source',
    'table.status': 'Status',
    'table.count': 'Count',
    'table.refresh': 'Refresh',
    'table.reason': 'Reason',
    'table.action': 'Action',
    'overview.readySources': 'Ready sources',
    'overview.partialSources': 'Partial loops',
    'overview.missingSources': 'Missing sources',
    'overview.artifacts': 'Artifacts',
    'overview.commands': 'Command evidence',
    'overview.memory': 'Memory nodes',
    'overview.documents': 'Docs/prototypes',
    'overview.capabilityMatrix': 'Capability Matrix',
    'overview.runtimeEvents': 'Runtime Events',
    'overview.projects': 'Projects',
    'commandCenter.agentOs': 'Agent OS',
    'commandCenter.title': 'Agent OS Command Center',
    'commandCenter.subtitle': 'Close the loop for remote coding, message channels, agent chat, memory, knowledge, hooks, and the resident watchdog from one place.',
    'commandCenter.readyItems': 'items ready',
    'commandCenter.nextBestActions': 'Next best actions',
    'commandCenter.liveSignals': 'Live signals',
    'commandCenter.allReady': 'The core workflow is ready. Open Agent Control to work.',
    'commandCenter.chatNow': 'Open Agent chat',
    'commandCenter.configureChannels': 'Configure channels',
    'commandCenter.openAgents': 'Open Agent Control',
    'commandCenter.openIntegrations': 'Open Integrations',
    'commandCenter.openKnowledge': 'Open Knowledge',
    'commandCenter.openCosts': 'Open cost ledger',
    'commandCenter.watchdog': 'Dashboard watchdog',
    'commandCenter.watchdogDesc': 'Keeps the visual panel and local APIs resident and recoverable.',
    'commandCenter.agentControl': 'Agent Control',
    'commandCenter.agentControlDesc': 'Manage project sessions, platforms, models, chat, queues, replies, and summaries.',
    'commandCenter.agentConnect': 'Agent Connect',
    'commandCenter.agentConnectDesc': 'Remote control API, Bridge, webhook, heartbeat, and loop automation switchboard.',
    'commandCenter.feishuRoute': 'Feishu message route',
    'commandCenter.feishuRouteDesc': 'Bind Feishu chat/user targets independently for each agent platform.',
    'commandCenter.knowledgeGraph': 'Knowledge graph',
    'commandCenter.knowledgeGraphDesc': 'Graphify document and code knowledge graph for search, preview, and context navigation.',
    'commandCenter.memory': 'gbrain memory',
    'commandCenter.memoryDesc': 'Persist reusable project facts, decisions, context, and long-term memory.',
    'commandCenter.defaultSkills': 'Full workflow capabilities',
    'commandCenter.defaultSkillsDesc': 'gbrain, hooks, notifications, Feishu cards, and doc readers must be part of the default workflow.',
    'commandCenter.modelUsage': 'Model usage ledger',
    'commandCenter.modelUsageDesc': 'Records provider usage for token, cache, and cost analysis.',
    'commandCenter.automationLoops': 'Hook/Loop automation',
    'commandCenter.automationLoopsDesc': 'Approval nudges, completion push, summary cards, heartbeat, and watchdog loops.',
    'commandCenter.pathRemoteCoding': 'Mobile remote coding',
    'commandCenter.pathRemoteCodingDesc': 'Messages enter via Feishu or Bridge, Agent Control dispatches work, and replies return to the channel.',
    'commandCenter.pathLocalChat': 'Local Agent chat',
    'commandCenter.pathLocalChatDesc': 'Pick platform and model in the panel, chat with the agent, inspect history, and summarize.',
    'commandCenter.pathKnowledgeMemory': 'Knowledge and memory',
    'commandCenter.pathKnowledgeMemoryDesc': 'Connect docs, graph, conversation summaries, and long-term memory into searchable context.',
    'commandCenter.pathOpsLoop': 'Resident automation loop',
    'commandCenter.pathOpsLoopDesc': 'Watchdog, webhook, usage ledger, and hook events keep the workflow running.',
    'commandCenter.stepAgent': 'Agent session',
    'commandCenter.stepFeishu': 'Feishu route',
    'commandCenter.stepBridge': 'Bridge',
    'commandCenter.stepSession': 'Session',
    'commandCenter.stepModel': 'Model',
    'commandCenter.stepQueue': 'Queue',
    'commandCenter.stepDocuments': 'Documents',
    'commandCenter.stepGraph': 'Graph',
    'commandCenter.stepMemory': 'Memory',
    'commandCenter.stepWatchdog': 'Watchdog',
    'commandCenter.stepWebhook': 'Webhook',
    'commandCenter.stepUsage': 'Usage',
    'workflow.title': 'Workflow Closure',
    'workflow.artifact': 'Artifact',
    'workflow.type': 'Type',
    'workflow.status': 'Status',
    'workflow.version': 'Version',
    'workflow.gates': 'Gates',
    'workflow.actions': 'Available actions',
    'workflow.transition': 'Artifact transitions',
    'workflow.transitionDesc': 'Plain serve is partial until FSM/store are injected; embedded runtime can execute transitions.',
    'workflow.transitionRecorded': 'Transition recorded',
    'workflow.noActions': 'No available actions or FSM is not injected.',
    'workflow.failedRequired': 'Failed required gates',
    'topology.nodes': 'Nodes',
    'topology.edges': 'Edges',
    'topology.layers': 'Layers',
    'topology.kinds': 'Kinds',
    'topology.domains': 'Domains',
    'topology.detail': 'Detail',
    'topology.exportSvg': 'Export SVG',
    'topology.selectHint': 'Select a node to inspect dependency context.',
    'monitoring.activeDetectors': 'Detectors',
    'monitoring.autoDefects': 'Auto defects',
    'monitoring.commandRuns': 'Command runs',
    'monitoring.commandPassRate': 'Command pass rate',
    'monitoring.recentEvents': 'Recent events',
    'monitoring.overview': 'Overview',
    'monitoring.detectors': 'Detectors',
    'monitoring.defects': 'Defects',
    'monitoring.commands': 'Commands',
    'monitoring.rootCause': 'Root cause',
    'monitoring.severity': 'Severity',
    'monitoring.triggerDistribution': 'Trigger distribution',
    'monitoring.recentAutoDefects': 'Recent auto defects',
    'monitoring.noDetectorData': 'No detector data.',
    'monitoring.noDefectData': 'No auto-defect data.',
    'monitoring.noCommandData': 'No command evidence.',
    'monitoring.tokenSavings': 'Token savings',
    'monitoring.passed': 'Passed',
    'monitoring.failed': 'Failed',
    'costs.modelUsage': 'Model Usage',
    'costs.noModelUsage': 'No model usage ledger exists; token and cost charts stay empty.',
    'costs.totalTokens': 'Total tokens',
    'costs.inputTokens': 'Input tokens',
    'costs.outputTokens': 'Output tokens',
    'costs.cacheSavings': 'Cache savings',
    'costs.estimatedCost': 'Estimated cost',
    'costs.commandCompression': 'Command compression',
    'costs.providerBreakdown': 'Provider breakdown',
    'knowledge.memory': 'Memory',
    'knowledge.layer': 'Layer',
    'knowledge.confidence': 'Confidence',
    'knowledge.query': 'Search or recall memory',
    'knowledge.recall': 'Recall',
    'knowledge.localMemory': 'Local gbrain',
    'knowledge.baseTab': 'Knowledge base',
    'knowledge.memoryTab': 'gbrain memory',
    'knowledge.graphTab': 'Graph',
    'knowledge.documents': 'Knowledge docs',
    'knowledge.entries': 'Knowledge entries',
    'knowledge.graphNodes': 'Graph nodes',
    'knowledge.preview': 'Knowledge preview',
    'knowledge.exportBase': 'Export knowledge base',
    'knowledge.import': 'Import',
    'knowledge.imported': 'Knowledge document imported',
    'knowledge.importName': 'File name, e.g. team-knowledge.md',
    'knowledge.importContent': 'Paste knowledge content',
    'knowledge.noEntries': 'No SQLite knowledge entries.',
    'knowledge.graphify': 'Graphify knowledge graph',
    'knowledge.graphIntegrated': 'Graphify is integrated into the main workflow dashboard. Source:',
    'knowledge.downloadGraphJson': 'Download graph JSON',
    'knowledge.openGraphReport': 'Open graph report',
    'knowledge.memoryGraph': 'gbrain memory graph',
    'knowledge.fitGraph': 'Fit view',
    'knowledge.focusGraph': 'Focus view',
    'knowledge.exitFocus': 'Exit focus',
    'knowledge.nodeLimit': 'Nodes',
    'knowledge.visibleGraphSummary': '{visible}/{total} nodes, {edges} edges',
    'knowledge.nodePreview': 'Node preview',
    'knowledge.selectNode': 'Select a graph node to inspect it.',
    'knowledge.edge': 'Edge',
    'knowledge.nodeKind': 'Node kind',
    'knowledge.nodeGroup': 'Node group',
    'knowledge.degree': 'Degree',
    'knowledge.providers': 'Provider status',
    'knowledge.recallResult': 'Recall result',
    'knowledge.reviewQueue': 'Review queue',
    'knowledge.approve': 'Approve',
    'knowledge.reject': 'Reject',
    'knowledge.stale': 'Stale',
    'knowledge.reviewRecorded': 'Memory review evidence recorded',
    'integrations.providers': 'Providers',
    'integrations.feishu': 'Feishu/Lark message channel',
    'integrations.feishuReady': 'Feishu/Lark message channel configuration is available.',
    'integrations.command': 'Command',
    'integrations.commandPath': 'Command path',
    'integrations.configBoundary': 'Config boundary',
    'integrations.scope': 'Scope',
    'integrations.projectScope': 'Current project',
    'integrations.agentPlatforms': 'Agent platform targets',
    'integrations.dynamicActions': 'Dynamic controls',
    'integrations.lastAction': 'Last action',
    'integrations.setupCommands': 'Install/configure commands',
    'integrations.verifyCommands': 'Verification commands',
    'integrations.dryRunSend': 'Message dry-run',
    'integrations.eventConsume': 'Event consume dry-run',
    'integrations.safety': 'Safety rules',
    'integrations.requiresConfirm': 'Requires confirmation',
    'integrations.dryRunOnly': 'Dry-run only',
    'agents.sessions': 'Agent sessions',
    'agents.queuedMessages': 'Queued messages',
    'agents.claimedMessages': 'Claimed messages',
    'agents.completedMessages': 'Completed messages',
    'agents.modelCatalog': 'Model catalog',
    'agents.ready': 'Agent control is connected to the current project and can manage platform, model, channel, and queues.',
    'agents.sessionConfig': 'Session config',
    'agents.chatConsole': 'Agent chat console',
    'agents.platform': 'Agent platform',
    'agents.model': 'Model',
    'agents.channel': 'Message channel',
    'agents.mode': 'Control mode',
    'agents.commandPrefix': 'Command prefix',
    'agents.autoImportKnowledge': 'Auto-import knowledge',
    'agents.saveSession': 'Save session',
    'agents.sessionSaved': 'Agent session saved',
    'agents.messagePlaceholder': 'Send instructions, context, or a remote coding task to the agent',
    'agents.sendMessage': 'Send to agent',
    'agents.messageQueued': 'Message queued for the agent',
    'agents.messageBlocked': 'Message blocked; check channel configuration first',
    'agents.messageClaimed': 'Message claimed',
    'agents.messageCompleted': 'Task completed and reply posted',
    'agents.noMessages': 'No messages in this session',
    'agents.copyInbox': 'Copy inbox API',
    'agents.claimMessage': 'Claim',
    'agents.completeMessage': 'Complete',
    'agents.claimedBy': 'Claimed by',
    'agents.completedAt': 'Completed at',
    'agents.modeDryRun': 'Dry-run',
    'agents.modeInteractive': 'Interactive',
    'agents.modeLiveGuarded': 'Live guarded',
    'agents.channelDashboard': 'Dashboard queue',
    'agents.channelFeishu': 'Feishu/Lark CLI',
    'agents.pending': 'pending',
    'agents.lastMessage': 'Last message',
    'agents.route': 'Route',
    'agents.dryRun': 'dry-run',
    'agents.operator': 'Operator',
    'agents.agent': 'Agent',
    'agents.platformTargets': 'Platform targets',
    'agents.sessionScope': 'Message channel and model are configured per agent platform',
    'agents.totalMessages': 'Total messages',
    'agents.operatorMessages': 'Operator messages',
    'agents.agentMessages': 'Agent replies',
    'agents.blockedMessages': 'Blocked/failed',
    'agents.allStatuses': 'All statuses',
    'agents.noSessionSelected': 'No agent session selected',
    'agents.channelNeedsFeishuConfig': 'This session uses Feishu, but the target route is not fully configured.',
    'agents.channelReady': 'The selected agent platform, model, and message channel are closed-loop ready.',
    'agents.searchHistory': 'Search history',
    'agents.transcriptRefreshed': 'Transcript refreshed',
    'agents.generateSummary': 'Generate summary',
    'agents.summaryGenerated': 'Summary card generated',
    'agents.summaryImported': 'Summary card imported into knowledge base',
    'agents.history': 'History',
    'agents.summary': 'Summary',
    'agents.setup': 'Platforms and models',
    'agents.searchResults': 'Search results',
    'agents.matches': 'matches',
    'agents.noHistoryMatches': 'No matching conversation records',
    'agents.storage': 'Storage',
    'agents.storageDesc': 'Agent transcripts and summaries are stored under the project .scale directory',
    'agents.transcriptPath': 'Transcript',
    'agents.summaryPath': 'Summary file',
    'agents.summaryDesc': 'For review, handoff, weekly reports, and knowledge capture',
    'agents.noSummary': 'No summary exists yet. Click Generate summary.',
    'agents.importSummary': 'Import to knowledge',
    'agents.openItems': 'Open items',
    'agents.nextActions': 'Next actions',
    'agents.platformTargetsDesc': 'Detected agent platform installs and project knowledge docs',
    'agents.modelCatalogDesc': 'Model routing options available to the current agent session',
    'service.title': 'Dashboard service',
    'service.ready': 'Dashboard watchdog is connected; the page and API are health-checked and restarted in the background.',
    'service.ensure': 'Ensure watchdog',
    'service.restart': 'Restart watchdog',
    'service.heartbeat': 'Last heartbeat',
    'service.restarts': 'Restarts',
    'service.installed': 'Login task',
    'service.logs': 'Logs',
    'service.copyLogPath': 'Copy log path',
    'service.ensureStarted': 'Dashboard watchdog started',
    'service.restartStarted': 'Dashboard watchdog restart started',
    'integrations.routeConfig': 'Project message route',
    'integrations.routeConfigPath': 'Config file',
    'integrations.routeTarget': 'Current target',
    'integrations.platformStatus': 'Platform status',
    'integrations.routeName': 'Route name',
    'integrations.targetType': 'Target type',
    'integrations.targetId': 'Chat/User ID',
    'integrations.chatTarget': 'Chat',
    'integrations.userTarget': 'User',
    'integrations.platform': 'Agent platform',
    'integrations.session': 'Agent session',
    'integrations.commandPrefix': 'Command prefix',
    'integrations.eventKey': 'Event key',
    'integrations.notes': 'Notes',
    'integrations.enableRoute': 'Enable route',
    'integrations.allowWrite': 'Allow write commands',
    'integrations.importKnowledge': 'Import knowledge',
    'integrations.saveRoute': 'Save route',
    'integrations.routeSaved': 'Feishu/Lark project message route saved',
    'integrations.routeConfigured': 'Project route is configured; CLI credentials still stay in the machine lark-cli profile/keychain.',
    'integrations.routePending': 'Project route is missing a real chat/user target; dry-run remains the default after save.',
    'integrations.unsaved': 'Unsaved',
    'integrations.routePreview': 'Live preview',
    'integrations.routePreviewDesc': 'CLI preview updates from the form; it does not send a real message.',
    'integrations.messageChannels': 'Message channels',
    'integrations.knowledgeProviders': 'Online knowledge providers',
    'integrations.channels': 'Channels',
    'integrations.readyChannels': 'Ready channels',
    'integrations.agentConnect': 'Agent Connect workflow',
    'integrations.agentConnectConfigured': 'Agent Connect project config is complete; Bridge, management API, and hook loops are ready for integration tests.',
    'integrations.agentConnectPending': 'Agent Connect is not closed-loop yet. Enable the workflow and configure tokens for Bridge, management API, or webhook.',
    'integrations.setupWizard': 'Connection wizard',
    'integrations.setupWizardDesc': 'Complete Feishu CLI, Agent Connect, tokens, Bridge/Webhook, platform routes, and required default capabilities in order.',
    'integrations.productSurface': 'Agent OS integration workbench',
    'integrations.workbench': 'Messages, control, and knowledge access',
    'integrations.workbenchDesc': 'Remote messaging, Agent Control, online knowledge providers, and default capabilities are split into executable steps. Finish the main path first, then use diagnostics and references.',
    'integrations.configureMessages': 'Configure messages',
    'integrations.configureAgentConnect': 'Configure Agent Connect',
    'integrations.configureKnowledge': 'Configure knowledge',
    'integrations.bootstrapLocal': 'Bootstrap local loop',
    'integrations.localBootstrapComplete': 'Local Agent OS loop initialized. Current closure score is {score}%. External Feishu targets and Tencent ima authorization still need project credentials.',
    'integrations.setupProgress': 'Closure progress',
    'integrations.nextActions': 'Next actions',
    'integrations.nextActionsDesc': 'Pick the integration step that needs work.',
    'integrations.configTabs': 'Configuration workspace',
    'integrations.configTabsDesc': 'Each area shows only the settings, previews, and actions for one task context.',
    'integrations.tabOverview': 'Overview',
    'integrations.tabMessages': 'Messages',
    'integrations.tabAgentConnect': 'Agent Connect',
    'integrations.tabKnowledge': 'Knowledge',
    'integrations.tabAutomation': 'Capabilities',
    'integrations.tabDiagnostics': 'Diagnostics',
    'integrations.agentOsReadiness': 'Agent OS readiness',
    'agentOs.remote-control.title': 'Remote control plane',
    'agentOs.remote-control.desc': 'Management API, Bridge/Webhook, and at least one controllable agent session are ready.',
    'agentOs.remote-control.action': 'Enable Agent Connect and save management API, Bridge, and webhook tokens.',
    'agentOs.mobile-message-channel.title': 'Mobile message channel',
    'agentOs.mobile-message-channel.desc': 'Feishu CLI and project routes bind mobile chat/user messages to an agent session.',
    'agentOs.mobile-message-channel.action': 'Save a Feishu chat or user target for at least one agent platform.',
    'agentOs.agent-control-session.title': 'Agent session control',
    'agentOs.agent-control-session.desc': 'Dashboard chat, model routing, message queue, and transcript storage are available for agent sessions.',
    'agentOs.agent-control-session.action': 'Configure one installed agent platform and model, then send a message in Agent Control.',
    'agentOs.knowledge-memory.title': 'Memory and knowledge',
    'agentOs.knowledge-memory.desc': 'Default memory capability is declared, and online knowledge can be bound per project.',
    'agentOs.knowledge-memory.action': 'Configure Tencent ima, or keep gbrain local memory as the default capability first.',
    'agentOs.loop-automation.title': 'Loop automation',
    'agentOs.loop-automation.desc': 'Hooks, heartbeat, long-task notifications, and the dashboard watchdog keep remote work from stalling.',
    'agentOs.loop-automation.action': 'Ensure the dashboard daemon is running and enable heartbeat and notification loops.',
    'agentOs.diagnostic-acceptance.title': 'Diagnostic acceptance',
    'agentOs.diagnostic-acceptance.desc': 'Install, doctor, dry-run, event consume, and setup verify commands are available before go-live.',
    'agentOs.diagnostic-acceptance.action': 'Run setup verify, lark-cli doctor, one dry-run send, and one event consume in order.',
    'integrations.currentState': 'Current state',
    'integrations.currentStateDesc': 'Check providers, channels, and platform readiness before editing.',
    'integrations.boundaryDesc': 'Machine credentials, project routes, and local runtime config are managed separately.',
    'integrations.localRuntime': 'Local runtime',
    'integrations.localRuntimeDesc': 'Bridge, management API, and hook daemon commands are checked here.',
    'integrations.authModesDesc': 'Token/API Key and QR authorization are supported; sensitive values are not written to the repo.',
    'integrations.requiredCapabilities': 'Default capabilities',
    'integrations.requiredCapabilitiesDesc': 'The full workflow must include memory, notifications, hooks, Feishu cards, and document readers.',
    'integrations.providerPresetsDesc': 'Reusable integration presets for different agent platforms.',
    'integrations.diagnosticTools': 'Diagnostics and acceptance',
    'integrations.diagnosticToolsDesc': 'Install, doctor, dry-run, and event-consume commands live here.',
    'integrations.channelMatrixDesc': 'Reference only; it no longer interrupts the main configuration flow.',
    'integrations.applyRecommended': 'Use recommended local config',
    'integrations.generateLocalTokens': 'Generate local tokens',
    'integrations.tokensGenerated': 'Local tokens generated. Saving stores only masked markers in project config.',
    'integrations.recommendedApplied': 'Recommended local config and missing tokens are filled. Review and save.',
    'integrations.runDoctor': 'Run doctor',
    'integrations.runAcceptance': 'Run acceptance',
    'integrations.acceptancePassed': 'Agent OS acceptance passed',
    'integrations.acceptanceScore': 'Acceptance score',
    'integrations.copyAcceptancePath': 'Copy acceptance report path',
    'integrations.startFeishuConfig': 'Start Feishu setup',
    'integrations.startFeishuAuth': 'Start Feishu auth',
    'integrations.feishuConfigStarted': 'Feishu setup started. Open the link or scan to complete first-time configuration.',
    'integrations.feishuAuthStarted': 'Feishu authorization started. Open the link or scan to complete authorization.',
    'integrations.wizardFeishuCli': 'Install and authorize Feishu CLI',
    'integrations.wizardFeishuCliDesc': 'Checks lark-cli, profile/keychain, doctor, and event consumption capability.',
    'integrations.wizardAgentConnect': 'Enable Agent Connect',
    'integrations.wizardAgentConnectDesc': 'Turns on management API, Bridge, webhook, and automation loops.',
    'integrations.wizardTokens': 'Configure access tokens',
    'integrations.wizardTokensDesc': 'Prepare local secrets for management API, Bridge, and webhook; saving writes masked markers only.',
    'integrations.wizardBridgeWebhook': 'Connect Bridge/Webhook',
    'integrations.wizardBridgeWebhookDesc': 'External message channels enter Agent Control through Bridge or webhook.',
    'integrations.wizardRoute': 'Bind agent platform routes',
    'integrations.wizardRouteDesc': 'Each agent platform gets an independent Feishu chat/user and session binding.',
    'integrations.wizardSkills': 'Confirm full default capabilities',
    'integrations.wizardSkillsDesc': 'gbrain, hooks, notifications, Feishu cards, and doc readers must be in the default workflow.',
    'integrations.enableWorkflow': 'Enable workflow',
    'integrations.managementApi': 'Management API',
    'integrations.host': 'Host',
    'integrations.port': 'Port',
    'integrations.token': 'Token',
    'integrations.tokenPlaceholder': 'Only a masked marker is shown after save',
    'integrations.allowPlatforms': 'Allowed platforms',
    'integrations.heartbeatInterval': 'Heartbeat interval (min)',
    'integrations.maxTurnTime': 'Max turn time (min)',
    'integrations.resetOnIdle': 'Reset on idle (min)',
    'integrations.longTaskNotify': 'Long-task notify',
    'integrations.saveAgentConnect': 'Save Agent Connect',
    'integrations.agentConnectSaved': 'Agent Connect workflow saved',
    'integrations.workflowCommands': 'Workflow commands',
    'integrations.daemonHooks': 'Daemon and hooks',
    'integrations.channelMatrix': 'Channel matrix',
    'integrations.bridgeProtocol': 'Bridge protocol',
    'integrations.providerPresets': 'Provider presets',
    'integrations.skillPresets': 'Skill presets',
    'integrations.defaultInstall': 'Default install',
    'integrations.loopAutomation': 'Loop automation',
    'integrations.routeConfiguredShort': 'Route configured',
    'integrations.routePendingShort': 'Route pending',
    'integrations.imaConfig': 'Tencent ima knowledge base',
    'integrations.imaConfigured': 'Tencent ima provider is configured; agents can use it after external memory workflow is enabled.',
    'integrations.imaPending': 'Tencent ima still needs Client ID, knowledge-base ID, or authorization before it is ready.',
    'integrations.imaKnowledgeBaseId': 'Knowledge-base ID',
    'integrations.authMode': 'Auth mode',
    'integrations.authModes': 'Auth modes',
    'integrations.enableProvider': 'Enable provider',
    'integrations.qrAuthorized': 'QR authorized',
    'integrations.saveProvider': 'Save provider',
    'integrations.knowledgeProviderSaved': 'Knowledge provider saved',
    'documents.loading': 'Loading document index and previews',
    'knowledge.loading': 'Loading knowledge base, memory, and graphs',
    'documents.name': 'Name',
    'documents.type': 'Type',
    'documents.size': 'Size',
    'documents.path': 'Path',
    'documents.preview': 'Preview',
    'documents.saved': 'Document saved',
    'documents.prototypeGallery': 'UI prototypes',
    'documents.copyIndex': 'Copy index',
    'documents.downloadIndex': 'Download index',
    'documents.favorite': 'Favorite',
    'documents.search': 'Search docs, paths, or types',
    'prompts.gallery': 'Template Gallery',
    'prompts.optimizer': 'Optimizer',
    'prompts.input': 'Paste raw request or prompt',
    'prompts.optimize': 'Optimize',
    'prompts.command': 'Command',
    'prompts.agentPlan': 'Agent Plan',
    'prompts.agentPlanGenerate': 'Generate Plan',
    'prompts.agentPlanGenerated': 'Agent plan generated',
    'prompts.agentPlanOpenJson': 'Open JSON',
    'prompts.agentPlanBudget': 'Token budget',
    'prompts.agentPlanFiles': 'Files, comma-separated',
    'prompts.agentPlanRoles': 'Roles',
    'prompts.agentPlanHandoffs': 'Handoffs',
    'prompts.agentPlanReviewGates': 'Review Gates',
    'prompts.agentPlanReserve': 'reserve tokens',
    'prompts.phase': 'Phase',
    'prompts.role': 'Role',
    'prompts.bestFor': 'Best For',
    'prompts.workflow': 'Workflow',
    'prompts.skills': 'Skills',
    'prompts.tools': 'Tools',
    'prompts.outputs': 'Outputs',
    'prompts.questions': 'Coaching Questions',
    'prompts.references': 'References',
    'prompts.search': 'Search templates, packs, commands',
    'source.project-scale-dir.desc': '.scale workflow directory presence.',
    'source.runtime-evidence.desc': 'Runtime pass/fail/resolved evidence.',
    'source.command-runs.desc': 'Command executions, pass rate, and compression savings.',
    'source.model-usage.desc': 'Model tokens, cache, and cost ledger.',
    'source.memory-brain.desc': 'Local gbrain memory nodes.',
    'source.knowledge-base.desc': 'Knowledge docs, SQLite entries, Karpathy guidance, and Graphify graph.',
    'source.documents.desc': 'Previewable, copyable, downloadable Markdown/JSON/HTML docs.',
    'source.prompt-studio.desc': 'Built-in vibe coding templates, packs, and optimizer API.',
    'source.dashboard-service.desc': 'Resident dashboard watchdog, health checks, PIDs, restart count, and logs.',
    'source.feishu-channel.desc': 'lark-cli based mobile notifications, command intake, event streams, and online knowledge-channel setup.',
    'source.agent-control-plane.desc': 'Dashboard-managed agent sessions, model selection, message routing, queues, and agent reply inbox.',
    'source.agent-collaboration.desc': 'AI OS agent role selection, DAG handoffs, review gates, token budget, and guarded execution settlement.',
    'source.event-stream.desc': 'Server-Sent Events used for live refresh.',
    'source.artifact-fsm.desc': 'Artifact transition write path.',
    'source.project-scale-dir.reason': 'The project has no .scale directory; initialize or bootstrap workflow first.',
    'source.runtime-evidence.reason': 'No runtime evidence JSON files were found; run verify/preflight with runtime evidence enabled.',
    'source.command-runs.reason': 'No command-run evidence was found; execute commands through governed runtime or preflight.',
    'source.model-usage.reason': 'No .scale/model-usage/usage.jsonl file exists; record provider usage first.',
    'source.memory-brain.reason': 'No usable gbrain memory nodes exist; capture, review, or restore project memory.',
    'source.knowledge-base.reason': 'No knowledge docs, knowledge.db entries, or Graphify graph were found; add docs, ingest knowledge, or generate graphify-out/graph.json.',
    'source.documents.reason': 'No previewable docs or HTML prototypes were found under docs, .scale/docs, or .scale/artifacts.',
    'source.prompt-studio.reason': 'No prompt templates were discovered; check built-in registry or .scale/prompts.',
    'source.dashboard-service.reason': 'Dashboard watchdog is not running; click Ensure watchdog in Agent Control or run scale dashboard daemon ensure.',
    'source.dashboard-service.reason.partial': 'Dashboard server is running without the watchdog; enable it to recover from hangs.',
    'source.feishu-channel.reason': 'lark-cli is not on PATH; Feishu remote notifications, command intake, and event consumption are not configured.',
    'source.feishu-channel.reason.partial': 'lark-cli is on PATH; run lark-cli doctor, then confirm the target chat/user before enabling live delivery.',
    'source.feishu-channel.reason.missing': 'lark-cli is not on PATH; Feishu remote notifications, command intake, and event consumption are not configured.',
    'source.agent-control-plane.reason': 'No usable agent control session is configured; select a platform, model, and channel in Agent Control.',
    'source.agent-control-plane.reason.partial': 'Agent control sessions exist, but platform installation or message routing is not fully ready.',
    'source.agent-collaboration.reason': 'No settled agentExecution evidence was found; run scale agent plan, then scale ai-os run --mode guarded --verify.',
    'source.event-stream.reason': 'The server is running heartbeat-only SSE; the UI falls back to polling.',
    'source.artifact-fsm.reason': 'No artifact store/FSM is injected, so transition writes remain partial.',
  },
}
</script>

<template>
  <n-config-provider :theme="theme" :locale="naiveLocale">
    <n-layout has-sider class="layout">
      <n-layout-sider class="sider" :width="252" bordered>
        <div class="brand">
          <span class="brand-mark">S</span>
          <span class="brand-text">SCALE Engine</span>
        </div>
        <n-menu :value="activePage" :options="menuOptions" @update:value="setPage" />
        <div class="sider-footer">
          <n-space vertical size="small">
            <n-tag :type="sseStatus === 'live' ? 'success' : sseStatus === 'polling' ? 'warning' : 'error'" size="small">
              {{ capabilities?.realtime.mode || sseStatus }}
            </n-tag>
            <n-text depth="3" style="font-size: 12px">{{ t('common.lastLoaded') }}: {{ formatTime(lastLoaded) }}</n-text>
          </n-space>
        </div>
      </n-layout-sider>

      <n-layout class="main-layout">
        <n-layout-header class="topbar">
          <div class="topbar-title">
            <h1>{{ pageTitle }}</h1>
            <p>{{ currentProject?.name || 'project' }} · {{ currentProject?.projectDir }}</p>
          </div>
          <div class="topbar-actions">
            <n-select
              v-if="projects.length > 1"
              :value="currentProjectUrl"
              :options="projects.map(project => ({ label: project.name, value: project.url || '' }))"
              style="width: 220px"
              @update:value="onProjectChange"
            />
            <n-button size="small" :loading="loading" @click="refreshAll">{{ t('common.refresh') }}</n-button>
            <n-button size="small" @click="setLang(lang === 'zh' ? 'en' : 'zh')">{{ lang === 'zh' ? 'EN' : '中文' }}</n-button>
            <n-switch :value="dark" @update:value="setTheme">
              <template #checked>Dark</template>
              <template #unchecked>Light</template>
            </n-switch>
          </div>
        </n-layout-header>

        <n-layout-content class="content">
          <n-alert v-if="notice" type="info" closable style="margin-bottom: 12px" @close="notice = ''">
            {{ notice }}
          </n-alert>

          <section v-if="activePage === 'overview'" class="page">
            <div class="command-hero">
              <div class="command-hero-main">
                <n-space align="center" size="small">
                  <n-tag :type="commandCenterTone">{{ t('commandCenter.agentOs') }}</n-tag>
                  <n-text depth="3">{{ currentProject?.name || 'project' }}</n-text>
                </n-space>
                <h2>{{ t('commandCenter.title') }}</h2>
                <p>{{ t('commandCenter.subtitle') }}</p>
                <div class="command-hero-actions">
                  <n-button type="primary" size="large" @click="setPage(commandCenterPrimaryAction?.page || 'agents')">
                    {{ commandCenterPrimaryAction?.actionLabel || t('commandCenter.openAgents') }}
                  </n-button>
                  <n-button size="large" @click="setPage('agents')">{{ t('commandCenter.chatNow') }}</n-button>
                  <n-button size="large" @click="setPage('integrations')">{{ t('commandCenter.configureChannels') }}</n-button>
                </div>
              </div>
              <div class="command-readiness-card">
                <div class="readiness-score">
                  <strong>{{ commandCenterScore }}%</strong>
                  <span>{{ commandCenterReadyCount }}/{{ commandCenterChecks.length }} {{ t('commandCenter.readyItems') }}</span>
                </div>
                <n-progress type="line" :percentage="commandCenterScore" :status="commandCenterTone" :height="10" :border-radius="5" />
                <div class="readiness-meta">
                  <span>{{ t('integrations.readyChannels') }}: {{ connectorWorkflow?.summary.readyChannels || 0 }}/{{ connectorWorkflow?.summary.channels || 0 }}</span>
                  <span>{{ t('agents.sessions') }}: {{ agentControl?.summary.sessions || 0 }}</span>
                  <span>{{ t('knowledge.graphNodes') }}: {{ formatNumber(knowledgeBase?.summary.graphNodes || 0) }}</span>
                </div>
              </div>
            </div>

            <div class="command-layout">
              <n-card :title="t('commandCenter.nextBestActions')">
                <n-empty v-if="commandCenterNextActions.length === 0" :description="t('commandCenter.allReady')" />
                <div v-else class="command-action-list">
                  <button
                    v-for="item in commandCenterNextActions"
                    :key="item.id"
                    type="button"
                    class="command-action"
                    @click="setPage(item.page)"
                  >
                    <span>
                      <strong>{{ item.title }}</strong>
                      <small>{{ item.description }}</small>
                    </span>
                    <span class="command-action-meta">
                      <n-tag :type="statusTag(item.status)" size="small">{{ statusLabel(item.status) }}</n-tag>
                      <small>{{ item.metric }}</small>
                    </span>
                  </button>
                </div>
              </n-card>

              <n-card :title="t('commandCenter.liveSignals')">
                <div class="command-signal-grid">
                  <div class="command-signal">
                    <span>{{ t('overview.readySources') }}</span>
                    <strong>{{ capabilities?.summary.ready || 0 }}</strong>
                  </div>
                  <div class="command-signal">
                    <span>{{ t('overview.partialSources') }}</span>
                    <strong>{{ capabilities?.summary.partial || 0 }}</strong>
                  </div>
                  <div class="command-signal">
                    <span>{{ t('overview.missingSources') }}</span>
                    <strong>{{ capabilities?.summary.missing || 0 }}</strong>
                  </div>
                  <div class="command-signal">
                    <span>{{ t('overview.commands') }}</span>
                    <strong>{{ metrics?.commandRuns?.total || 0 }}</strong>
                  </div>
                  <div class="command-signal">
                    <span>{{ t('overview.memory') }}</span>
                    <strong>{{ knowledgeBase?.summary.memoryNodes || knowledge?.local?.total || 0 }}</strong>
                  </div>
                  <div class="command-signal">
                    <span>{{ t('costs.modelUsage') }}</span>
                    <strong>{{ modelUsage?.totalRecords || 0 }}</strong>
                  </div>
                </div>
              </n-card>
            </div>

            <div class="path-grid">
              <button
                v-for="path in commandCenterPaths"
                :key="path.id"
                type="button"
                class="path-card"
                @click="setPage(path.page)"
              >
                <span class="path-card-head">
                  <strong>{{ path.title }}</strong>
                  <n-tag :type="statusTag(path.status)" size="small">{{ statusLabel(path.status) }}</n-tag>
                </span>
                <small>{{ path.description }}</small>
                <span class="path-steps">
                  <span v-for="step in path.steps" :key="step.label" class="path-step">
                    <span class="status-dot" :class="step.status"></span>
                    {{ step.label }}
                  </span>
                </span>
              </button>
            </div>

            <div class="metric-grid">
              <n-card class="metric-card"><n-statistic :label="t('overview.artifacts')" :value="artifactCount(state?.artifacts)" /></n-card>
              <n-card class="metric-card"><n-statistic :label="t('overview.documents')" :value="documents.length" /></n-card>
              <n-card class="metric-card"><n-statistic :label="t('knowledge.graphNodes')" :value="knowledgeBase?.summary.graphNodes || 0" /></n-card>
              <n-card class="metric-card"><n-statistic :label="t('agents.queuedMessages')" :value="agentControl?.summary.queuedMessages || 0" /></n-card>
            </div>

            <div class="panel-grid">
              <n-card :title="t('overview.capabilityMatrix')">
                <n-data-table :columns="sourceColumns" :data="dataSources" :pagination="{ pageSize: 10 }" />
              </n-card>
              <n-card :title="t('overview.runtimeEvents')">
                <n-empty v-if="recentEvents.length === 0" :description="t('common.empty')" />
                <n-list v-else>
                  <n-list-item v-for="event in recentEvents" :key="`${event.type}-${event.timestamp}`">
                    <n-thing :title="event.type" :description="formatTime(event.timestamp)">
                      <n-text depth="3">{{ event.artifactId || '-' }}</n-text>
                    </n-thing>
                  </n-list-item>
                </n-list>
              </n-card>
            </div>
          </section>

          <section v-else-if="activePage === 'workflow'" class="page">
            <n-alert :type="capabilities?.writeOps.artifactTransitions ? 'success' : 'warning'">
              {{ t('workflow.transition') }}: {{ capabilities?.writeOps.artifactTransitions ? statusLabel('ready') : statusLabel('partial') }}.
              {{ t('workflow.transitionDesc') }}
            </n-alert>

            <div class="metric-grid">
              <n-card><n-statistic :label="t('overview.artifacts')" :value="flatArtifacts.length" /></n-card>
              <n-card><n-statistic :label="t('workflow.gates')" :value="gateTotals.total" /></n-card>
              <n-card><n-statistic :label="t('monitoring.passed')" :value="gateTotals.passed" /></n-card>
              <n-card><n-statistic :label="t('workflow.failedRequired')" :value="gateTotals.failedRequired" /></n-card>
            </div>

            <div class="toolbar">
              <n-input v-model:value="workflowSearch" :placeholder="t('common.search')" style="max-width: 360px" />
              <n-space>
                <n-select v-model:value="workflowStatusFilter" :options="[{ label: 'All', value: 'all' }, ...artifactStatuses]" style="width: 160px" />
                <n-select v-model:value="workflowTypeFilter" :options="[{ label: 'All', value: 'all' }, ...artifactTypes]" style="width: 160px" />
              </n-space>
            </div>

            <div class="two-col wide-left">
              <n-card :title="t('workflow.title')">
                <n-data-table
                  :columns="artifactColumns"
                  :data="filteredArtifacts"
                  :pagination="{ pageSize: 10 }"
                  :row-props="row => ({ style: 'cursor:pointer', onClick: () => selectArtifact(row.id) })"
                />
              </n-card>
              <n-card :title="selectedArtifact?.title || t('workflow.actions')">
                <n-descriptions v-if="selectedArtifact" bordered :column="1" size="small">
                  <n-descriptions-item label="ID">{{ selectedArtifact.id }}</n-descriptions-item>
                  <n-descriptions-item :label="t('workflow.type')">{{ selectedArtifact.type }}</n-descriptions-item>
                  <n-descriptions-item :label="t('workflow.status')">{{ runtimeLabel(selectedArtifact.status) }}</n-descriptions-item>
                </n-descriptions>
                <div class="action-panel">
                  <n-empty v-if="!selectedArtifact || !(artifactActions[selectedArtifact.id] || []).length" :description="t('workflow.noActions')" />
                  <n-space v-else>
                    <n-button
                      v-for="action in artifactActions[selectedArtifact.id]"
                      :key="action"
                      size="small"
                      :loading="artifactActionLoading === action"
                      @click="transitionArtifact(action)"
                    >
                      {{ action }}
                    </n-button>
                  </n-space>
                </div>
              </n-card>
            </div>
          </section>

          <section v-else-if="activePage === 'topology'" class="page">
            <div class="toolbar">
              <n-input v-model:value="topologySearch" :placeholder="t('common.search')" style="max-width: 360px" />
              <n-space>
                <n-select v-model:value="topologyLayerFilters" multiple clearable :placeholder="t('topology.layers')" :options="topologyLayerOptions" style="width: 220px" />
                <n-select v-model:value="topologyKindFilters" multiple clearable :placeholder="t('topology.kinds')" :options="topologyKindOptions" style="width: 220px" />
                <n-button @click="downloadJson('scale-topology.json', topology)">{{ t('common.exportJson') }}</n-button>
                <n-button @click="exportTopologySvg">{{ t('topology.exportSvg') }}</n-button>
              </n-space>
            </div>

            <div class="metric-grid">
              <n-card><n-statistic :label="t('topology.nodes')" :value="topologyNodes.length" /></n-card>
              <n-card><n-statistic :label="t('topology.edges')" :value="topologyEdges.length" /></n-card>
              <n-card><n-statistic :label="t('topology.layers')" :value="topologyLayerOptions.length" /></n-card>
              <n-card><n-statistic :label="t('topology.domains')" :value="domainSummaries.length" /></n-card>
            </div>

            <div class="topology-layout">
              <n-card content-style="padding: 0">
                <svg class="topology-svg" viewBox="0 0 1000 620" role="img">
                  <line
                    v-for="item in topologySvgEdges"
                    :key="`${item.edge.source}-${item.edge.target}-${item.edge.kind || ''}`"
                    :x1="item.source.x"
                    :y1="item.source.y"
                    :x2="item.target.x"
                    :y2="item.target.y"
                    class="topology-edge"
                  />
                  <g
                    v-for="item in topologySvgNodes"
                    :key="item.node.id"
                    class="topology-node"
                    :class="{ selected: selectedTopologyId === item.node.id }"
                    @click="selectedTopologyId = item.node.id"
                  >
                    <circle :cx="item.x" :cy="item.y" :r="8 + Math.min(item.degree, 18)" :fill="layerColor(item.node.layer)" />
                    <text :x="item.x + 14" :y="item.y + 4">{{ item.node.name || item.node.id }}</text>
                  </g>
                </svg>
              </n-card>

              <n-space vertical>
                <n-card :title="t('topology.detail')">
                  <n-empty v-if="!selectedTopologyNode" :description="t('topology.selectHint')" />
                  <n-descriptions v-else bordered :column="1" size="small">
                    <n-descriptions-item label="ID">{{ selectedTopologyNode.id }}</n-descriptions-item>
                    <n-descriptions-item label="Name">{{ selectedTopologyNode.name || '-' }}</n-descriptions-item>
                    <n-descriptions-item label="Kind">{{ selectedTopologyNode.kind || '-' }}</n-descriptions-item>
                    <n-descriptions-item label="Layer">{{ selectedTopologyNode.layer || '-' }}</n-descriptions-item>
                    <n-descriptions-item label="File">{{ selectedTopologyNode.filePath || '-' }}</n-descriptions-item>
                    <n-descriptions-item label="Line">{{ selectedTopologyNode.line || '-' }}</n-descriptions-item>
                    <n-descriptions-item label="Signature">{{ selectedTopologyNode.signature || '-' }}</n-descriptions-item>
                  </n-descriptions>
                </n-card>
                <n-card :title="t('topology.domains')">
                  <n-empty v-if="domainSummaries.length === 0" :description="t('common.empty')" />
                  <div v-else class="domain-list">
                    <button v-for="domain in domainSummaries" :key="domain.id" class="domain-item" @click="topologySearch = domain.name">
                      <span>{{ domain.name }}</span>
                      <strong>{{ domain.count }}</strong>
                    </button>
                  </div>
                </n-card>
              </n-space>
            </div>
          </section>

          <section v-else-if="activePage === 'monitoring'" class="page">
            <div class="metric-grid">
              <n-card><n-statistic :label="t('monitoring.activeDetectors')" :value="detectors.length" /></n-card>
              <n-card><n-statistic :label="t('monitoring.autoDefects')" :value="autoDefects?.autoCreatedCount || 0" /></n-card>
              <n-card><n-statistic :label="t('monitoring.commandRuns')" :value="commandRuns?.total || 0" /></n-card>
              <n-card><n-statistic :label="t('monitoring.commandPassRate')" :value="`${commandPassRate}%`" /></n-card>
              <n-card><n-statistic :label="t('monitoring.recentEvents')" :value="recentEvents.length" /></n-card>
            </div>

            <n-tabs v-model:value="monitoringTab" type="segment">
              <n-tab-pane name="overview" :tab="t('monitoring.overview')">
                <div class="two-col">
                  <n-card :title="t('monitoring.rootCause')">
                    <div v-if="rootCauseBars.length" class="bar-list">
                      <div v-for="row in rootCauseBars" :key="row.label" class="bar-row">
                        <span>{{ runtimeLabel(row.label) }}</span>
                        <div><i :style="{ width: row.width }" /></div>
                        <strong>{{ row.value }}</strong>
                      </div>
                    </div>
                    <n-empty v-else :description="t('monitoring.noDefectData')" />
                  </n-card>
                  <n-card :title="t('monitoring.severity')">
                    <div v-if="severityBars.length" class="bar-list">
                      <div v-for="row in severityBars" :key="row.label" class="bar-row">
                        <span>{{ runtimeLabel(row.label) }}</span>
                        <div><i :style="{ width: row.width }" /></div>
                        <strong>{{ row.value }}</strong>
                      </div>
                    </div>
                    <n-empty v-else :description="t('monitoring.noDefectData')" />
                  </n-card>
                </div>
              </n-tab-pane>
              <n-tab-pane name="detectors" :tab="t('monitoring.detectors')">
                <n-data-table
                  :columns="[
                    { title: t('monitoring.detectors'), key: 'name' },
                    { title: t('monitoring.triggerDistribution'), key: 'totalTriggers' },
                    { title: t('monitoring.severity'), key: 'bySeverity', render: (row) => JSON.stringify(row.bySeverity || {}) },
                    { title: t('overview.runtimeEvents'), key: 'lastTrigger', render: (row) => formatTime(row.lastTrigger) }
                  ]"
                  :data="detectors"
                  :pagination="{ pageSize: 10 }"
                />
              </n-tab-pane>
              <n-tab-pane name="defects" :tab="t('monitoring.defects')">
                <n-data-table
                  :columns="[
                    { title: t('monitoring.defects'), key: 'title' },
                    { title: t('monitoring.rootCause'), key: 'rootCause' },
                    { title: t('monitoring.severity'), key: 'severity' },
                    { title: t('monitoring.detectors'), key: 'detector' },
                    { title: t('overview.runtimeEvents'), key: 'createdAt', render: (row) => formatTime(row.createdAt) }
                  ]"
                  :data="autoDefects?.recentDefects || []"
                  :pagination="{ pageSize: 10 }"
                />
              </n-tab-pane>
              <n-tab-pane name="commands" :tab="t('monitoring.commands')">
                <div class="metric-grid">
                  <n-card><n-statistic :label="t('monitoring.commandRuns')" :value="commandRuns?.total || 0" /></n-card>
                  <n-card><n-statistic :label="t('monitoring.passed')" :value="commandRuns?.passed || 0" /></n-card>
                  <n-card><n-statistic :label="t('monitoring.failed')" :value="commandRuns?.failed || 0" /></n-card>
                  <n-card><n-statistic :label="t('monitoring.tokenSavings')" :value="`${commandSavingsRate}%`" /></n-card>
                </div>
              </n-tab-pane>
            </n-tabs>
          </section>

          <section v-else-if="activePage === 'costs'" class="page">
            <n-alert v-if="tokenSource?.status !== 'ready'" type="warning">
              {{ sourceReason(tokenSource) || t('costs.noModelUsage') }}
            </n-alert>
            <div class="metric-grid">
              <n-card><n-statistic :label="t('costs.totalTokens')" :value="modelUsage?.totalTokens || 0" /></n-card>
              <n-card><n-statistic :label="t('costs.inputTokens')" :value="modelUsage?.totalInputTokens || 0" /></n-card>
              <n-card><n-statistic :label="t('costs.outputTokens')" :value="modelUsage?.totalOutputTokens || 0" /></n-card>
              <n-card><n-statistic :label="t('costs.cacheSavings')" :value="modelUsage?.cacheSavingsTokens || 0" /></n-card>
              <n-card><n-statistic :label="t('costs.estimatedCost')" :value="formatCurrency(modelUsage?.estimatedCostUsd)" /></n-card>
            </div>
            <div class="two-col">
              <n-card :title="t('costs.providerBreakdown')">
                <n-data-table
                  :columns="[
                    { title: 'Provider', key: 'provider' },
                    { title: 'Records', key: 'records' },
                    { title: 'Tokens', key: 'totalTokens' },
                    { title: 'Savings', key: 'cacheSavingsTokens' }
                  ]"
                  :data="providerRows"
                />
              </n-card>
              <n-card :title="t('costs.commandCompression')">
                <n-descriptions bordered :column="1" size="small">
                  <n-descriptions-item label="Total">{{ commandRuns?.total || 0 }}</n-descriptions-item>
                  <n-descriptions-item label="Passed">{{ commandRuns?.passed || 0 }}</n-descriptions-item>
                  <n-descriptions-item label="Failed">{{ commandRuns?.failed || 0 }}</n-descriptions-item>
                  <n-descriptions-item label="Raw">{{ formatNumber(commandRuns?.rawEstimatedTokens || 0) }}</n-descriptions-item>
                  <n-descriptions-item label="Compressed">{{ formatNumber(commandRuns?.compressedEstimatedTokens || 0) }}</n-descriptions-item>
                  <n-descriptions-item label="Saved">{{ formatNumber(commandRuns?.savedEstimatedTokens || 0) }}</n-descriptions-item>
                </n-descriptions>
                <n-progress type="line" :percentage="commandSavingsRate" indicator-placement="inside" />
              </n-card>
            </div>
          </section>

          <section v-else-if="activePage === 'knowledge'" class="page">
            <div class="metric-grid">
              <n-card><n-statistic :label="t('knowledge.documents')" :value="knowledgeBase?.summary?.documents || 0" /></n-card>
              <n-card><n-statistic :label="t('knowledge.entries')" :value="knowledgeBase?.summary?.entries || 0" /></n-card>
              <n-card><n-statistic :label="t('knowledge.graphNodes')" :value="knowledgeBase?.summary?.graphNodes || 0" /></n-card>
              <n-card><n-statistic :label="t('knowledge.localMemory')" :value="knowledge?.local?.total || 0" /></n-card>
            </div>
            <n-tabs v-model:value="knowledgeTab" type="segment" animated>
              <n-tab-pane name="base" :tab="t('knowledge.baseTab')">
                <n-alert v-if="isResourceLoading('knowledgeBase') || isResourceLoading('knowledge')" type="info" style="margin-bottom: 12px">
                  {{ t('knowledge.loading') }}
                </n-alert>
                <n-alert v-if="resourceError('knowledgeBase') || resourceError('knowledge')" type="warning" style="margin-bottom: 12px">
                  {{ resourceError('knowledgeBase') || resourceError('knowledge') }}
                </n-alert>
                <n-alert v-if="knowledgeBaseSource?.status !== 'ready'" type="warning">
                  {{ sourceReason(knowledgeBaseSource) }}
                </n-alert>
                <div class="toolbar">
                  <n-space>
                    <n-button @click="copyKnowledgeBaseReport">{{ t('common.copy') }}</n-button>
                    <n-button @click="downloadKnowledgeBaseReport">{{ t('knowledge.exportBase') }}</n-button>
                  </n-space>
                </div>
                <div class="import-panel">
                  <n-input v-model:value="knowledgeImportName" :placeholder="t('knowledge.importName')" style="max-width: 260px" />
                  <n-input
                    v-model:value="knowledgeImportContent"
                    type="textarea"
                    :placeholder="t('knowledge.importContent')"
                    :autosize="{ minRows: 2, maxRows: 6 }"
                  />
                  <n-button type="primary" :disabled="!knowledgeImportContent.trim()" @click="importKnowledgeDocument">{{ t('knowledge.import') }}</n-button>
                </div>
                <div class="doc-shell">
                  <n-card class="doc-list" :title="`${t('knowledge.documents')} (${knowledgeDocuments.length})`">
                    <div v-if="isResourceLoading('knowledgeBase')" class="skeleton-list">
                      <n-skeleton v-for="item in 6" :key="item" text :repeat="2" />
                    </div>
                    <n-empty v-else-if="knowledgeDocumentGroups.length === 0" :description="t('common.empty')" />
                    <div v-else class="doc-tree-list">
                      <section v-for="group in knowledgeDocumentGroups" :key="group.folder" class="doc-folder">
                        <div class="doc-folder-title">{{ group.folder }}</div>
                        <button
                          v-for="doc in group.documents"
                          :key="doc.path"
                          class="doc-tree-button"
                          :class="{ active: selectedKnowledgeDocument?.path === doc.path }"
                          @click="selectKnowledgeDocument(doc)"
                        >
                          <span>{{ doc.type.toUpperCase() }}</span>
                          <strong>{{ doc.name }}</strong>
                          <small>{{ formatSize(doc.size) }}</small>
                        </button>
                      </section>
                    </div>
                  </n-card>
                  <n-space vertical size="large">
                    <n-card :title="selectedKnowledgeDocument?.name || t('knowledge.preview')">
                      <template #header-extra>
                        <div class="doc-actions">
                          <n-button size="small" :disabled="!selectedKnowledgeDocument" @click="copySelectedKnowledgeDocument">{{ t('common.copy') }}</n-button>
                          <n-button size="small" :disabled="!selectedKnowledgeDocument" @click="downloadSelectedKnowledgeDocument">{{ t('common.download') }}</n-button>
                          <n-button v-if="!knowledgeDocumentEditMode" size="small" :disabled="!selectedKnowledgeDocument" @click="startKnowledgeDocumentEdit">{{ t('common.edit') }}</n-button>
                          <n-button v-if="knowledgeDocumentEditMode" size="small" type="primary" @click="saveKnowledgeDocumentEdit">{{ t('common.save') }}</n-button>
                          <n-button v-if="knowledgeDocumentEditMode" size="small" @click="cancelKnowledgeDocumentEdit">{{ t('common.cancel') }}</n-button>
                          <n-button size="small" :disabled="!selectedKnowledgeDocument" tag="a" :href="knowledgeDocPreviewUrl" target="_blank">{{ t('common.open') }}</n-button>
                        </div>
                      </template>
                      <n-spin :show="isResourceLoading('knowledgeBase') && !selectedKnowledgeDocument">
                        <n-input
                        v-if="knowledgeDocumentEditMode"
                        v-model:value="knowledgeDocumentDraft"
                        class="editor-box"
                        type="textarea"
                        :autosize="{ minRows: 18, maxRows: 32 }"
                        />
                        <iframe v-else-if="selectedKnowledgeDocument?.type === 'html'" class="doc-preview" :src="knowledgeDocPreviewUrl" />
                        <pre v-else-if="selectedKnowledgeDocument?.type === 'json'" class="code-box">{{ knowledgeDocumentContent || t('common.empty') }}</pre>
                        <div v-else-if="selectedKnowledgeDocument?.type === 'md'" class="markdown-body" v-html="renderedKnowledgeDocumentHtml" />
                        <pre v-else class="code-box">{{ knowledgeDocumentContent || t('common.empty') }}</pre>
                      </n-spin>
                    </n-card>
                    <n-card :title="`${t('knowledge.entries')} (${knowledgeEntries.length})`">
                      <n-empty v-if="knowledgeEntries.length === 0" :description="t('knowledge.noEntries')" />
                      <n-list v-else>
                        <n-list-item v-for="entry in knowledgeEntries" :key="entry.id">
                          <n-thing :title="entry.title" :description="entry.content">
                            <template #header-extra>
                              <n-space>
                                <n-tag size="small">{{ entry.type }}</n-tag>
                                <n-tag v-for="tag in entry.tags.slice(0, 4)" :key="tag" size="small">{{ tag }}</n-tag>
                              </n-space>
                            </template>
                          </n-thing>
                        </n-list-item>
                      </n-list>
                    </n-card>
                  </n-space>
                </div>
              </n-tab-pane>

              <n-tab-pane name="memory" :tab="t('knowledge.memoryTab')">
                <n-alert v-if="memorySource?.status !== 'ready'" type="warning">
                  {{ sourceReason(memorySource) }}
                </n-alert>
                <div class="toolbar">
                  <n-input-group style="max-width: 560px">
                    <n-input v-model:value="knowledgeQuery" :placeholder="t('knowledge.query')" @keyup.enter="loadKnowledge(true)" />
                    <n-button @click="loadKnowledge(true)">{{ t('knowledge.recall') }}</n-button>
                  </n-input-group>
                  <n-space>
                    <n-button @click="copyText(JSON.stringify(knowledge, null, 2))">{{ t('common.copy') }}</n-button>
                    <n-button @click="downloadJson('scale-gbrain-memory.json', knowledge)">{{ t('common.exportJson') }}</n-button>
                  </n-space>
                </div>
                <div class="metric-grid">
                  <n-card><n-statistic :label="t('knowledge.localMemory')" :value="knowledge?.local?.total || 0" /></n-card>
                  <n-card><n-statistic :label="t('knowledge.reviewQueue')" :value="knowledgeReviewQueue.length" /></n-card>
                  <n-card v-for="row in knowledgeStatusRows" :key="row.status"><n-statistic :label="runtimeLabel(row.status)" :value="row.count" /></n-card>
                </div>
                <div class="two-col wide-left">
                  <n-card :title="t('knowledge.localMemory')">
                    <n-data-table :columns="knowledgeColumns" :data="knowledgeNodes" :pagination="{ pageSize: 10 }" />
                  </n-card>
                  <n-space vertical>
                    <n-card :title="t('knowledge.providers')">
                      <pre class="code-box">{{ JSON.stringify(knowledge?.providers || {}, null, 2) }}</pre>
                    </n-card>
                    <n-card :title="t('knowledge.recallResult')">
                      <pre class="code-box">{{ JSON.stringify(knowledge?.recall || {}, null, 2) }}</pre>
                    </n-card>
                  </n-space>
                </div>
              </n-tab-pane>

              <n-tab-pane name="graph" :tab="t('knowledge.graphTab')">
                <n-alert v-if="activeGraphKey === 'graphify'" type="info" style="margin-bottom: 12px">
                  {{ t('knowledge.graphIntegrated') }} {{ activeKnowledgeGraphSource }}
                  <n-space style="margin-top: 8px">
                    <n-button size="small" :disabled="!activeKnowledgeGraphHasData" @click="downloadKnowledgeGraph(activeKnowledgeGraphDownloadName, activeKnowledgeGraph)">{{ t('knowledge.downloadGraphJson') }}</n-button>
                    <n-button size="small" :disabled="!activeKnowledgeGraph?.reportPath" @click="openGraphReport">{{ t('knowledge.openGraphReport') }}</n-button>
                  </n-space>
                </n-alert>
                <div class="graph-workbench" :class="{ 'graph-focus': graphFocusMode }">
                  <div class="toolbar graph-toolbar">
                    <n-space align="center" wrap>
                      <n-select v-model:value="activeGraphKey" :options="knowledgeGraphOptions" style="width: 320px" />
                      <n-input-group style="width: 180px">
                        <n-button size="small" disabled>{{ t('knowledge.nodeLimit') }}</n-button>
                        <n-select v-model:value="graphNodeLimit" size="small" :options="graphNodeLimitOptions" />
                      </n-input-group>
                      <n-tag :type="statusTag(activeKnowledgeGraphStatus)">{{ statusLabel(activeKnowledgeGraphStatus) }}</n-tag>
                      <n-tag>{{ activeKnowledgeGraphVisibleSummary }}</n-tag>
                      <n-text depth="3">{{ activeKnowledgeGraphSource }}</n-text>
                    </n-space>
                    <n-space>
                      <n-button size="small" :disabled="!activeKnowledgeGraphHasData" @click="toggleGraphFocusMode">{{ graphFocusMode ? t('knowledge.exitFocus') : t('knowledge.focusGraph') }}</n-button>
                      <n-button size="small" :disabled="!activeKnowledgeGraphHasData" @click="resetKnowledgeGraphView">{{ t('knowledge.fitGraph') }}</n-button>
                      <n-button size="small" @click="downloadKnowledgeGraph(activeKnowledgeGraphDownloadName, activeKnowledgeGraph)">{{ t('common.download') }}</n-button>
                    </n-space>
                  </div>
                  <div class="graph-shell">
                    <n-card class="graph-canvas-card" :bordered="false">
                      <n-empty v-if="!activeKnowledgeGraphHasData" :description="activeKnowledgeGraph?.emptyReason || t('common.empty')" />
                      <div v-else ref="graphChartEl" class="knowledge-graph-chart" />
                    </n-card>
                    <n-card class="graph-inspector" :title="t('knowledge.nodePreview')">
                      <n-empty v-if="!selectedGraphNode" :description="t('knowledge.selectNode')" />
                      <div v-else class="graph-preview">
                        <div class="graph-preview-head">
                          <strong>{{ selectedGraphNode.label }}</strong>
                          <n-tag size="small">{{ selectedGraphNode.kind || selectedGraphNode.group || 'node' }}</n-tag>
                        </div>
                        <n-descriptions bordered :column="1" size="small">
                          <n-descriptions-item label="ID">{{ selectedGraphNode.id }}</n-descriptions-item>
                          <n-descriptions-item :label="t('knowledge.nodeGroup')">{{ selectedGraphNode.group || '-' }}</n-descriptions-item>
                          <n-descriptions-item :label="t('table.source')">{{ selectedGraphNode.source || '-' }}</n-descriptions-item>
                          <n-descriptions-item :label="t('documents.path')">{{ selectedGraphNode.path || '-' }}</n-descriptions-item>
                        </n-descriptions>
                        <n-space>
                          <n-button size="small" :disabled="!selectedGraphNode.path" @click="jumpToGraphNodeDocument(activeGraphKey)">{{ t('common.open') }}</n-button>
                          <n-button size="small" @click="copyText(selectedGraphPreview)">{{ t('common.copy') }}</n-button>
                          <n-button size="small" @click="downloadText(`${selectedGraphNode?.id || 'graph-node'}.txt`, selectedGraphPreview)">{{ t('common.download') }}</n-button>
                        </n-space>
                        <pre class="code-box compact">{{ selectedGraphPreview || t('common.empty') }}</pre>
                      </div>
                    </n-card>
                  </div>
                </div>
              </n-tab-pane>
            </n-tabs>
          </section>

          <section v-else-if="activePage === 'agents'" class="page agent-page">
            <div class="metric-grid">
              <n-card><n-statistic :label="t('agents.sessions')" :value="agentControl?.summary.sessions || 0" /></n-card>
              <n-card><n-statistic :label="t('overview.readySources')" :value="agentControl?.summary.ready || 0" /></n-card>
              <n-card><n-statistic :label="t('agents.queuedMessages')" :value="agentControl?.summary.queuedMessages || 0" /></n-card>
              <n-card><n-statistic :label="t('agents.claimedMessages')" :value="agentControl?.summary.claimedMessages || 0" /></n-card>
              <n-card><n-statistic :label="t('agents.completedMessages')" :value="agentControl?.summary.completedMessages || 0" /></n-card>
              <n-card><n-statistic :label="t('agents.modelCatalog')" :value="agentControl?.modelOptions.length || 0" /></n-card>
            </div>

            <n-alert :type="agentControlAlertType">
              {{ agentControlAlertText }}
            </n-alert>

            <div class="agent-workspace-grid">
              <aside class="agent-rail">
                <div class="agent-section-head">
                  <div>
                    <strong>{{ t('agents.sessions') }}</strong>
                    <small>{{ t('agents.sessionScope') }}</small>
                  </div>
                  <n-button size="small" :loading="agentTranscriptLoading" @click="refreshAgentControl">{{ t('common.refresh') }}</n-button>
                </div>
                <n-empty v-if="agentSessions.length === 0" :description="t('common.empty')" />
                <div v-else class="agent-session-list">
                  <button
                    v-for="session in agentSessions"
                    :key="session.sessionId"
                    class="agent-session-button"
                    :class="{ active: selectedAgentSession?.sessionId === session.sessionId }"
                    @click="selectAgentSession(session.sessionId)"
                  >
                    <span>
                      <strong>{{ session.name }}</strong>
                      <n-tag size="small" :type="agentStatusTag(session.status)">{{ agentStatusLabel(session.status) }}</n-tag>
                    </span>
                    <small>{{ session.platformName }} / {{ session.model?.label || session.modelId }}</small>
                    <small>{{ session.channel.provider }} · {{ session.channel.targetLabel }} · {{ t('agents.pending') }} {{ session.pendingCount }}</small>
                  </button>
                </div>
                <n-alert :type="agentSelectedChannelHealth.type" size="small">
                  {{ agentSelectedChannelHealth.text }}
                </n-alert>
                <div class="agent-quick-stats">
                  <div v-for="row in agentConversationStats" :key="row.label">
                    <span>{{ row.label }}</span>
                    <strong>{{ row.value }}</strong>
                  </div>
                </div>
              </aside>

              <main class="agent-workspace-main">
                <div class="agent-workspace-toolbar">
                  <n-input-group>
                    <n-input v-model:value="agentTranscriptSearch" :placeholder="t('agents.searchHistory')" @keyup.enter="searchAgentTranscripts" />
                    <n-select v-model:value="agentTranscriptStatus" :options="agentTranscriptStatusOptions" style="width: 160px" />
                    <n-button :loading="agentTranscriptLoading" @click="searchAgentTranscripts">{{ t('common.search') }}</n-button>
                  </n-input-group>
                  <n-space>
                    <n-button size="small" :disabled="!agentTranscript" @click="copyAgentTranscript">{{ t('common.copy') }}</n-button>
                    <n-button size="small" :disabled="!agentTranscript" @click="downloadAgentTranscript">{{ t('common.exportJson') }}</n-button>
                  </n-space>
                </div>

                <n-tabs v-model:value="agentWorkbenchTab" type="segment" animated>
                  <n-tab-pane name="chat" :tab="t('agents.chatConsole')">
                    <n-spin :show="agentTranscriptLoading">
                      <div class="agent-message-list agent-message-list-large">
                        <n-empty v-if="agentTimelineMessages.length === 0" :description="t('agents.noMessages')" />
                        <article
                          v-for="message in agentTimelineMessages"
                          :key="message.id"
                          class="agent-message"
                          :class="[message.direction, message.status]"
                        >
                          <header>
                            <strong>{{ message.direction === 'operator-to-agent' ? t('agents.operator') : t('agents.agent') }}</strong>
                            <n-space align="center" size="small">
                              <n-tag size="small" :type="agentMessageStatusTag(message.status)">{{ message.status }}</n-tag>
                              <n-text depth="3">{{ formatTime(message.createdAt) }}</n-text>
                            </n-space>
                          </header>
                          <p>{{ message.text }}</p>
                          <n-text depth="3">{{ message.platformId }} / {{ message.modelId }} / {{ message.channelProvider }}{{ message.dryRun ? ` · ${t('agents.dryRun')}` : '' }}</n-text>
                          <n-text v-if="message.claimedBy" depth="3">{{ t('agents.claimedBy') }} {{ message.claimedBy }} / {{ formatTime(message.claimedAt) }}</n-text>
                          <n-text v-if="message.completedAt" depth="3">{{ t('agents.completedAt') }} {{ formatTime(message.completedAt) }}</n-text>
                          <n-text v-if="message.evidencePath" depth="3">{{ message.evidencePath }}</n-text>
                          <pre v-if="message.commandPlan" class="code-box compact">{{ commandPlanText(message.commandPlan) }}</pre>
                          <div v-if="message.commandPlan || message.direction === 'operator-to-agent'" class="doc-actions">
                            <n-button v-if="message.commandPlan" size="small" @click="copyText(commandPlanText(message.commandPlan))">{{ t('common.copy') }}</n-button>
                            <n-button
                              v-if="message.direction === 'operator-to-agent' && message.status === 'queued'"
                              size="small"
                              :loading="agentMessageActionLoading === `claim:${message.id}`"
                              @click="claimAgentMessage(message)"
                            >
                              {{ t('agents.claimMessage') }}
                            </n-button>
                            <n-button
                              v-if="message.direction === 'operator-to-agent' && ['queued', 'claimed'].includes(message.status)"
                              size="small"
                              type="primary"
                              :loading="agentMessageActionLoading === `complete:${message.id}`"
                              @click="completeAgentMessage(message)"
                            >
                              {{ t('agents.completeMessage') }}
                            </n-button>
                          </div>
                          <div v-if="message.warnings.length" class="agent-warning-list">
                            <n-alert v-for="warning in message.warnings" :key="warning" type="warning">{{ warning }}</n-alert>
                          </div>
                        </article>
                      </div>
                    </n-spin>
                    <div class="agent-compose agent-compose-sticky">
                      <n-input
                        v-model:value="agentMessageDraft"
                        type="textarea"
                        :placeholder="t('agents.messagePlaceholder')"
                        :autosize="{ minRows: 4, maxRows: 9 }"
                      />
                      <n-space>
                        <n-button
                          type="primary"
                          :loading="agentMessageSending"
                          :disabled="!selectedAgentSession || !agentMessageDraft.trim()"
                          @click="sendAgentMessage"
                        >
                          {{ t('agents.sendMessage') }}
                        </n-button>
                        <n-button :disabled="!agentControl" @click="copyText(agentControl?.commands.pollInbox || '')">{{ t('agents.copyInbox') }}</n-button>
                        <n-button :disabled="!selectedAgentSession" @click="generateAgentSummary">{{ t('agents.generateSummary') }}</n-button>
                      </n-space>
                    </div>
                  </n-tab-pane>

                  <n-tab-pane name="history" :tab="t('agents.history')">
                    <div class="agent-history-grid">
                      <section>
                        <div class="agent-section-head">
                          <div>
                            <strong>{{ t('agents.searchResults') }}</strong>
                            <small>{{ agentTranscriptSearchReport?.total ?? 0 }} {{ t('agents.matches') }}</small>
                          </div>
                          <n-button size="small" @click="searchAgentTranscripts">{{ t('agents.searchHistory') }}</n-button>
                        </div>
                        <n-empty v-if="!agentTranscriptSearchReport?.hits.length" :description="t('agents.noHistoryMatches')" />
                        <div v-else class="agent-search-list">
                          <button
                            v-for="hit in agentTranscriptSearchReport.hits"
                            :key="hit.message.id"
                            class="agent-search-hit"
                            @click="selectAgentSession(hit.sessionId)"
                          >
                            <span>
                              <strong>{{ hit.sessionName }}</strong>
                              <n-tag size="small" :type="agentMessageStatusTag(hit.message.status)">{{ hit.message.status }}</n-tag>
                            </span>
                            <small>{{ hit.platformName }} / {{ formatTime(hit.message.createdAt) }}</small>
                            <p>{{ hit.matchPreview }}</p>
                          </button>
                        </div>
                      </section>
                      <section class="agent-storage-panel">
                        <div class="agent-section-head">
                          <div>
                            <strong>{{ t('agents.storage') }}</strong>
                            <small>{{ t('agents.storageDesc') }}</small>
                          </div>
                        </div>
                        <n-descriptions bordered :column="1" size="small">
                          <n-descriptions-item :label="t('agents.transcriptPath')">{{ agentTranscriptStorage?.messagesPath || '-' }}</n-descriptions-item>
                          <n-descriptions-item :label="t('agents.summaryPath')">{{ agentTranscriptStorage?.summaryPath || '-' }}</n-descriptions-item>
                          <n-descriptions-item :label="t('agents.lastMessage')">{{ formatTime(agentConversationSummary?.lastMessageAt) }}</n-descriptions-item>
                        </n-descriptions>
                        <pre class="code-box compact">{{ JSON.stringify(agentControl?.commands || {}, null, 2) }}</pre>
                      </section>
                    </div>
                  </n-tab-pane>

                  <n-tab-pane name="summary" :tab="t('agents.summary')">
                    <div class="agent-summary-layout">
                      <section class="agent-summary-card">
                        <div class="agent-section-head">
                          <div>
                            <strong>{{ agentConversationSummary?.title || t('agents.summary') }}</strong>
                            <small>{{ t('agents.summaryDesc') }}</small>
                          </div>
                          <n-space>
                            <n-button size="small" type="primary" :loading="agentSummarySaving" @click="generateAgentSummary">{{ t('agents.generateSummary') }}</n-button>
                            <n-button size="small" :disabled="!agentConversationSummary" @click="copyAgentSummary">{{ t('common.copy') }}</n-button>
                            <n-button size="small" :loading="agentKnowledgeImporting" :disabled="!agentConversationSummary" @click="importAgentSummaryToKnowledge">{{ t('agents.importSummary') }}</n-button>
                          </n-space>
                        </div>
                        <pre class="code-box agent-summary-markdown">{{ agentConversationSummary?.markdown || t('agents.noSummary') }}</pre>
                      </section>
                      <section class="agent-summary-side">
                        <div class="agent-list-block">
                          <strong>{{ t('agents.openItems') }}</strong>
                          <n-empty v-if="!agentConversationSummary?.openItems.length" :description="t('common.empty')" />
                          <ul v-else>
                            <li v-for="item in agentConversationSummary.openItems" :key="item">{{ item }}</li>
                          </ul>
                        </div>
                        <div class="agent-list-block">
                          <strong>{{ t('agents.nextActions') }}</strong>
                          <ul>
                            <li v-for="item in agentConversationSummary?.nextActions || []" :key="item">{{ item }}</li>
                          </ul>
                        </div>
                      </section>
                    </div>
                  </n-tab-pane>

                  <n-tab-pane name="setup" :tab="t('agents.setup')">
                    <div class="two-col">
                      <section class="agent-panel">
                        <div class="agent-section-head">
                          <div>
                            <strong>{{ t('agents.platformTargets') }}</strong>
                            <small>{{ t('agents.platformTargetsDesc') }}</small>
                          </div>
                        </div>
                        <div class="platform-target-grid">
                          <div v-for="target in agentControl?.platformTargets || []" :key="target.id" class="platform-target">
                            <div class="platform-target-head">
                              <strong>{{ target.name }}</strong>
                              <n-tag size="small" :type="statusTag(target.status)">{{ statusLabel(target.status) }}</n-tag>
                            </div>
                            <n-text depth="3">{{ target.settingsPath || '-' }}</n-text>
                            <n-text depth="3">{{ target.knowledgeDocPath || '-' }}</n-text>
                          </div>
                        </div>
                      </section>
                      <section class="agent-panel">
                        <div class="agent-section-head">
                          <div>
                            <strong>{{ t('agents.modelCatalog') }}</strong>
                            <small>{{ t('agents.modelCatalogDesc') }}</small>
                          </div>
                        </div>
                        <div class="agent-model-grid">
                          <div v-for="model in agentControl?.modelOptions || []" :key="model.id" class="agent-model-item">
                            <strong>{{ model.label }}</strong>
                            <small>{{ model.provider }} · {{ model.tier }} · {{ formatNumber(model.maxTokens) }} tokens</small>
                          </div>
                        </div>
                      </section>
                    </div>
                  </n-tab-pane>
                </n-tabs>
              </main>

              <aside class="agent-inspector">
                <section class="agent-panel">
                  <div class="agent-section-head">
                    <div>
                      <strong>{{ t('agents.sessionConfig') }}</strong>
                      <small>{{ selectedAgentSession?.sessionId || '-' }}</small>
                    </div>
                    <n-tag v-if="agentSessionDirty" type="warning" size="small">{{ t('integrations.unsaved') }}</n-tag>
                  </div>
                  <div class="agent-config-grid compact-config">
                    <label>
                      <span>{{ t('integrations.session') }}</span>
                      <n-input :value="agentSessionDraft.sessionId" @update:value="value => updateAgentSessionDraft('sessionId', value)" />
                    </label>
                    <label>
                      <span>{{ t('documents.name') }}</span>
                      <n-input :value="agentSessionDraft.name" @update:value="value => updateAgentSessionDraft('name', value)" />
                    </label>
                    <label>
                      <span>{{ t('agents.platform') }}</span>
                      <n-select :value="agentSessionDraft.platformId" :options="agentPlatformOptions" @update:value="value => updateAgentSessionDraft('platformId', value)" />
                    </label>
                    <label>
                      <span>{{ t('agents.model') }}</span>
                      <n-select :value="agentSessionDraft.modelId" :options="agentModelOptions" @update:value="value => updateAgentSessionDraft('modelId', value)" />
                    </label>
                    <label>
                      <span>{{ t('agents.channel') }}</span>
                      <n-select :value="agentSessionDraft.channelProvider" :options="agentChannelOptions" @update:value="value => updateAgentSessionDraft('channelProvider', value)" />
                    </label>
                    <label>
                      <span>{{ t('agents.mode') }}</span>
                      <n-select :value="agentSessionDraft.mode" :options="agentModeOptions" @update:value="value => updateAgentSessionDraft('mode', value)" />
                    </label>
                    <label>
                      <span>{{ t('agents.commandPrefix') }}</span>
                      <n-input :value="agentSessionDraft.commandPrefix" @update:value="value => updateAgentSessionDraft('commandPrefix', value)" />
                    </label>
                    <label class="agent-switch-row">
                      <span>{{ t('agents.autoImportKnowledge') }}</span>
                      <n-switch :value="agentSessionDraft.autoImportKnowledge" @update:value="value => updateAgentSessionDraft('autoImportKnowledge', value)" />
                    </label>
                  </div>
                  <n-space>
                    <n-button type="primary" :loading="agentSessionSaving" @click="saveAgentSession">{{ t('agents.saveSession') }}</n-button>
                    <n-button :disabled="!agentSessionDirty" @click="syncAgentSessionDraft">{{ t('common.reset') }}</n-button>
                  </n-space>
                </section>

                <section v-if="selectedAgentSession" class="agent-panel">
                  <div class="agent-section-head">
                    <div>
                      <strong>{{ t('agents.route') }}</strong>
                      <small>{{ selectedAgentSession.channel.provider }}</small>
                    </div>
                    <n-tag size="small" :type="agentStatusTag(selectedAgentSession.status)">{{ agentStatusLabel(selectedAgentSession.status) }}</n-tag>
                  </div>
                  <n-descriptions bordered :column="1" size="small">
                    <n-descriptions-item :label="t('agents.route')">{{ selectedAgentSession.channel.routeId }}</n-descriptions-item>
                    <n-descriptions-item :label="t('integrations.routeTarget')">{{ selectedAgentSession.channel.targetLabel }}</n-descriptions-item>
                    <n-descriptions-item :label="t('agents.lastMessage')">{{ formatTime(selectedAgentSession.lastMessageAt) }}</n-descriptions-item>
                  </n-descriptions>
                  <div v-if="selectedAgentSession.warnings.length" class="agent-warning-list">
                    <n-alert v-for="warning in selectedAgentSession.warnings" :key="warning" type="warning">{{ warning }}</n-alert>
                  </div>
                </section>

                <section class="agent-panel">
                  <div class="agent-section-head">
                    <div>
                      <strong>{{ t('service.title') }}</strong>
                      <small>{{ dashboardService?.url || '-' }}</small>
                    </div>
                    <n-tag :type="dashboardService?.supervisorAlive ? 'success' : dashboardService?.serverAlive ? 'warning' : 'error'" size="small">
                      {{ dashboardService?.status || statusLabel('missing') }}
                    </n-tag>
                  </div>
                  <n-alert :type="dashboardServiceAlertType" size="small">
                    {{ dashboardServiceAlertText }}
                  </n-alert>
                  <n-space>
                    <n-button size="small" @click="refreshDashboardService">{{ t('common.refresh') }}</n-button>
                    <n-button size="small" type="primary" @click="runDashboardServiceAction('ensure')">{{ t('service.ensure') }}</n-button>
                    <n-button size="small" @click="runDashboardServiceAction('restart')">{{ t('service.restart') }}</n-button>
                    <n-button size="small" :disabled="!dashboardService?.logPath" @click="copyText(dashboardService?.logPath || '')">{{ t('service.copyLogPath') }}</n-button>
                  </n-space>
                  <n-descriptions bordered :column="1" size="small">
                    <n-descriptions-item label="Supervisor PID">{{ dashboardService?.supervisorPid || '-' }}</n-descriptions-item>
                    <n-descriptions-item label="Server PID">{{ dashboardService?.serverPid || '-' }}</n-descriptions-item>
                    <n-descriptions-item :label="t('service.heartbeat')">{{ formatTime(dashboardService?.lastHeartbeatAt) }}</n-descriptions-item>
                    <n-descriptions-item :label="t('service.restarts')">{{ dashboardService?.restartCount ?? 0 }}</n-descriptions-item>
                  </n-descriptions>
                  <n-text v-if="dashboardService?.lastError" type="error">{{ dashboardService.lastError }}</n-text>
                </section>
              </aside>
            </div>
          </section>

          <section v-else-if="activePage === 'integrations'" class="page">
            <div class="integration-workbench">
              <section class="integration-hero">
                <div class="integration-hero-main">
                  <n-text depth="3">{{ t('integrations.productSurface') }}</n-text>
                  <h2>{{ t('integrations.workbench') }}</h2>
                  <p>{{ t('integrations.workbenchDesc') }}</p>
                  <n-space wrap>
                    <n-button type="primary" :loading="agentOsBootstrapLoading" @click="bootstrapLocalAgentOs">{{ t('integrations.bootstrapLocal') }}</n-button>
                    <n-button @click="activeIntegrationTab = 'messages'">{{ t('integrations.configureMessages') }}</n-button>
                    <n-button @click="activeIntegrationTab = 'agent-connect'">{{ t('integrations.configureAgentConnect') }}</n-button>
                    <n-button @click="activeIntegrationTab = 'knowledge'">{{ t('integrations.configureKnowledge') }}</n-button>
                    <n-button @click="activeIntegrationTab = 'diagnostics'">{{ t('integrations.runDoctor') }}</n-button>
                  </n-space>
                </div>
                <aside class="integration-score-card">
                  <div class="integration-score-head">
                    <span>{{ t('integrations.setupProgress') }}</span>
                    <strong>{{ agentOsReadinessScore }}%</strong>
                  </div>
                  <n-progress type="line" :percentage="agentOsReadinessScore" :status="agentOsReadinessTone" :height="10" :border-radius="5" :show-indicator="false" />
                  <div class="integration-status-strip">
                    <span>
                      <strong>{{ agentOsReadiness?.summary.ready || 0 }}/{{ agentOsReadiness?.stages.length || 0 }}</strong>
                      {{ t('overview.readySources') }}
                    </span>
                    <span>
                      <strong>{{ agentOsReadiness?.summary.partial || 0 }}</strong>
                      {{ t('overview.partialSources') }}
                    </span>
                    <span>
                      <strong>{{ agentOsReadiness?.summary.missing || 0 }}</strong>
                      {{ t('overview.missingSources') }}
                    </span>
                  </div>
                </aside>
              </section>

              <n-alert :type="statusTag(feishuSource?.status || 'missing')">
                {{ feishuSource?.status === 'ready' ? t('integrations.feishuReady') : sourceReason(feishuSource) || feishuProvider?.nextAction || t('source.feishu-channel.reason') }}
              </n-alert>
              <n-alert v-if="isResourceLoading('integrations') && !integrations" type="info">
                {{ t('common.loading') }} integrations...
              </n-alert>
              <n-alert v-if="resourceError('integrations') && !integrations" type="warning">
                {{ resourceError('integrations') }}
              </n-alert>

              <div class="integration-layout">
                <aside class="integration-step-rail">
                  <div class="panel-heading">
                    <h3>{{ t('integrations.nextActions') }}</h3>
                    <n-text depth="3">{{ t('integrations.nextActionsDesc') }}</n-text>
                  </div>
                  <button
                    v-for="step in integrationWizardSteps"
                    :key="step.id"
                    type="button"
                    class="integration-step"
                    :class="{ active: activeIntegrationTab === integrationTabForStep(step.id) }"
                    @click="focusIntegrationStep(step.id)"
                  >
                    <span class="integration-step-title">
                      <strong>{{ step.title }}</strong>
                      <n-tag size="small" :type="statusTag(step.status)">{{ statusLabel(step.status) }}</n-tag>
                    </span>
                    <small>{{ step.description }}</small>
                    <span class="integration-step-meta">{{ step.metric }}</span>
                  </button>
                </aside>

                <main class="integration-task-board">
                  <div class="integration-task-toolbar">
                    <div>
                      <h3>{{ t('integrations.configTabs') }}</h3>
                      <n-text depth="3">{{ t('integrations.configTabsDesc') }}</n-text>
                    </div>
                    <n-space wrap>
                      <n-button size="small" type="primary" :loading="agentOsBootstrapLoading" @click="bootstrapLocalAgentOs">{{ t('integrations.bootstrapLocal') }}</n-button>
                      <n-button size="small" @click="applyRecommendedAgentConnectDefaults">{{ t('integrations.applyRecommended') }}</n-button>
                      <n-button size="small" @click="generateAgentConnectTokens">{{ t('integrations.generateLocalTokens') }}</n-button>
                      <n-button size="small" :type="agentConnectDirty ? 'primary' : 'default'" :loading="agentConnectSaveLoading" :disabled="!agentConnectDirty" @click="saveAgentConnectConfig">{{ t('integrations.saveAgentConnect') }}</n-button>
                    </n-space>
                  </div>

                  <n-tabs v-model:value="activeIntegrationTab" type="line" animated class="integration-tabs">
                    <n-tab-pane name="overview" :tab="t('integrations.tabOverview')">
                      <div class="integration-tab-layout">
                        <section class="config-panel">
                          <div class="panel-heading">
                            <h3>{{ t('integrations.agentOsReadiness') }}</h3>
                            <n-text depth="3">{{ agentOsPrimaryStage ? readinessStageAction(agentOsPrimaryStage) : t('integrations.currentStateDesc') }}</n-text>
                          </div>
                          <div class="integration-stat-strip compact">
                            <span>
                              <strong>{{ agentOsReadiness?.summary.ready || 0 }}</strong>
                              {{ t('overview.readySources') }}
                            </span>
                            <span>
                              <strong>{{ agentOsReadiness?.summary.partial || 0 }}</strong>
                              {{ t('overview.partialSources') }}
                            </span>
                            <span>
                              <strong>{{ agentOsReadiness?.summary.missing || 0 }}</strong>
                              {{ t('overview.missingSources') }}
                            </span>
                          </div>
                          <div class="readiness-stage-grid">
                            <button
                              v-for="stage in agentOsReadiness?.stages || []"
                              :key="stage.id"
                              type="button"
                              class="readiness-stage"
                              @click="activeIntegrationTab = stage.tab"
                            >
                              <span class="readiness-stage-head">
                                <strong>{{ readinessStageTitle(stage) }}</strong>
                                <n-tag size="small" :type="statusTag(stage.status)">{{ statusLabel(stage.status) }}</n-tag>
                              </span>
                              <small>{{ readinessStageDescription(stage) }}</small>
                              <span class="readiness-stage-foot">
                                <span>{{ stage.score }}%</span>
                                <n-text depth="3">{{ readinessStageAction(stage) }}</n-text>
                              </span>
                            </button>
                          </div>
                          <div class="inline-section">
                            <div class="panel-heading">
                              <h3>{{ t('integrations.currentState') }}</h3>
                              <n-text depth="3">{{ t('integrations.currentStateDesc') }}</n-text>
                            </div>
                          </div>
                          <div class="provider-tile-grid">
                            <div v-for="provider in integrations?.providers || []" :key="provider.id" class="provider-tile">
                              <div class="provider-tile-head">
                                <strong>{{ provider.name }}</strong>
                                <n-tag size="small" :type="statusTag(provider.status)">{{ statusLabel(provider.status) }}</n-tag>
                              </div>
                              <p>{{ provider.description }}</p>
                              <n-text depth="3">{{ provider.scope.description }}</n-text>
                            </div>
                          </div>
                        </section>
                        <aside class="config-panel">
                          <div class="panel-heading">
                            <h3>{{ t('integrations.configBoundary') }}</h3>
                            <n-text depth="3">{{ t('integrations.boundaryDesc') }}</n-text>
                          </div>
                          <n-descriptions bordered :column="1" size="small">
                            <n-descriptions-item :label="t('integrations.routeConfigPath')">{{ connectorWorkflow?.config.configPath || '-' }}</n-descriptions-item>
                            <n-descriptions-item label="Feishu">{{ feishuProvider?.configBoundary || '-' }}</n-descriptions-item>
                            <n-descriptions-item label="Tencent ima">{{ imaProvider?.configBoundary || '-' }}</n-descriptions-item>
                            <n-descriptions-item label="Management API">{{ managementEndpointPreview || '-' }}</n-descriptions-item>
                          </n-descriptions>
                        </aside>
                      </div>
                    </n-tab-pane>

                    <n-tab-pane name="messages" :tab="t('integrations.tabMessages')">
                      <div class="integration-tab-layout wide">
                        <section class="config-panel">
                          <div class="panel-heading">
                            <h3>{{ feishuProvider?.name || t('integrations.feishu') }}</h3>
                            <n-text depth="3">{{ feishuProvider?.description || t('integrations.feishuReady') }}</n-text>
                          </div>
                          <n-alert :type="selectedFeishuRouteSummary?.configured ? 'success' : 'warning'">
                            {{ selectedFeishuRouteSummary?.configured ? t('integrations.routeConfigured') : t('integrations.routePending') }}
                          </n-alert>
                          <n-descriptions bordered :column="1" size="small">
                            <n-descriptions-item :label="t('table.status')">
                              <n-tag :type="statusTag(feishuProvider?.status || 'missing')">{{ statusLabel(feishuProvider?.status || 'missing') }}</n-tag>
                            </n-descriptions-item>
                            <n-descriptions-item :label="t('integrations.commandPath')">{{ feishuProvider?.commandPath || '-' }}</n-descriptions-item>
                            <n-descriptions-item :label="t('integrations.routeTarget')">{{ selectedFeishuRouteSummary?.targetLabel || '-' }}</n-descriptions-item>
                            <n-descriptions-item :label="t('table.action')">{{ feishuProvider?.nextAction || '-' }}</n-descriptions-item>
                          </n-descriptions>
                          <div class="route-form-grid">
                            <label>
                              <span>{{ t('integrations.routeName') }}</span>
                              <n-input
                                :value="feishuRouteDraft.routeName"
                                :input-props="{ id: 'feishu-route-name', name: 'feishu-route-name', autocomplete: 'off' }"
                                @update:value="value => updateFeishuRouteDraft('routeName', value)"
                              />
                            </label>
                            <div class="route-form-field">
                              <span>{{ t('integrations.targetType') }}</span>
                              <n-select
                                :value="feishuRouteDraft.targetType"
                                :options="feishuRouteTargetOptions"
                                :aria-label="t('integrations.targetType')"
                                :input-props="{ id: 'feishu-target-type', name: 'feishu-target-type', autocomplete: 'off' }"
                                @update:value="value => updateFeishuRouteDraft('targetType', value)"
                              />
                            </div>
                            <label>
                              <span>{{ t('integrations.targetId') }}</span>
                              <n-input
                                :value="feishuRouteDraft.targetId"
                                :input-props="{ id: 'feishu-target-id', name: 'feishu-target-id', autocomplete: 'off' }"
                                placeholder="oc_xxx / ou_xxx"
                                @update:value="value => updateFeishuRouteDraft('targetId', value)"
                              />
                            </label>
                            <div class="route-form-field">
                              <span>{{ t('integrations.platform') }}</span>
                              <n-select
                                :value="feishuRouteDraft.agentPlatformId"
                                :options="feishuPlatformOptions"
                                :aria-label="t('integrations.platform')"
                                :input-props="{ id: 'feishu-agent-platform', name: 'feishu-agent-platform', autocomplete: 'off' }"
                                @update:value="value => updateFeishuRouteDraft('agentPlatformId', value)"
                              />
                            </div>
                            <label>
                              <span>{{ t('integrations.session') }}</span>
                              <n-input
                                :value="feishuRouteDraft.agentSessionId"
                                :input-props="{ id: 'feishu-agent-session', name: 'feishu-agent-session', autocomplete: 'off' }"
                                @update:value="value => updateFeishuRouteDraft('agentSessionId', value)"
                              />
                            </label>
                            <label>
                              <span>{{ t('integrations.commandPrefix') }}</span>
                              <n-input
                                :value="feishuRouteDraft.commandPrefix"
                                :input-props="{ id: 'feishu-command-prefix', name: 'feishu-command-prefix', autocomplete: 'off' }"
                                @update:value="value => updateFeishuRouteDraft('commandPrefix', value)"
                              />
                            </label>
                            <label>
                              <span>{{ t('integrations.eventKey') }}</span>
                              <n-input
                                :value="feishuRouteDraft.eventKey"
                                :input-props="{ id: 'feishu-event-key', name: 'feishu-event-key', autocomplete: 'off' }"
                                @update:value="value => updateFeishuRouteDraft('eventKey', value)"
                              />
                            </label>
                            <label>
                              <span>{{ t('integrations.notes') }}</span>
                              <n-input
                                :value="feishuRouteDraft.notes || ''"
                                :input-props="{ id: 'feishu-route-notes', name: 'feishu-route-notes', autocomplete: 'off' }"
                                @update:value="value => updateFeishuRouteDraft('notes', value)"
                              />
                            </label>
                          </div>
                          <n-space align="center" wrap>
                            <n-space align="center" size="small">
                              <n-text>{{ t('integrations.enableRoute') }}</n-text>
                              <n-switch :value="feishuRouteDraft.enabled" @update:value="value => updateFeishuRouteDraft('enabled', value)" />
                            </n-space>
                            <n-space align="center" size="small">
                              <n-text>{{ t('integrations.allowWrite') }}</n-text>
                              <n-switch :value="feishuRouteDraft.allowWriteCommands" @update:value="value => updateFeishuRouteDraft('allowWriteCommands', value)" />
                            </n-space>
                            <n-space align="center" size="small">
                              <n-text>{{ t('integrations.importKnowledge') }}</n-text>
                              <n-switch :value="feishuRouteDraft.importKnowledge" @update:value="value => updateFeishuRouteDraft('importKnowledge', value)" />
                            </n-space>
                            <n-button type="primary" size="small" :loading="feishuRouteSaveLoading" @click="saveFeishuRoute">
                              {{ t('integrations.saveRoute') }}
                            </n-button>
                            <n-button size="small" :loading="feishuConfigLoading" @click="startFeishuConfig">{{ t('integrations.startFeishuConfig') }}</n-button>
                            <n-button size="small" :loading="feishuAuthLoading" @click="startFeishuAuth">{{ t('integrations.startFeishuAuth') }}</n-button>
                            <n-tag v-if="feishuRouteDirty" type="warning" size="small">{{ t('integrations.unsaved') }}</n-tag>
                          </n-space>
                          <n-alert v-if="feishuConfigResult" :type="feishuConfigResult.ok ? 'success' : feishuConfigResult.status === 'blocked' ? 'warning' : 'error'">
                            {{ feishuConfigResult.verificationUrl || feishuConfigResult.setupCommand || feishuConfigResult.error || feishuConfigResult.status }}
                          </n-alert>
                          <n-space v-if="feishuConfigResult?.verificationUrl || feishuConfigResult?.setupCommand" size="small">
                            <n-button v-if="feishuConfigResult?.verificationUrl" size="small" tag="a" :href="feishuConfigResult.verificationUrl" target="_blank">{{ t('common.open') }}</n-button>
                            <n-button size="small" @click="copyText(feishuConfigResult?.verificationUrl || feishuConfigResult?.setupCommand || '')">{{ t('common.copy') }}</n-button>
                          </n-space>
                          <n-alert v-if="feishuAuthResult" :type="feishuAuthResult.ok ? 'success' : feishuAuthResult.status === 'blocked' ? 'warning' : 'error'">
                            {{ feishuAuthResult.verificationUrl || feishuAuthResult.setupCommand || feishuAuthResult.error || feishuAuthResult.status }}
                          </n-alert>
                          <n-space v-if="feishuAuthResult?.verificationUrl || feishuAuthResult?.setupCommand" size="small">
                            <n-button v-if="feishuAuthResult?.verificationUrl" size="small" tag="a" :href="feishuAuthResult.verificationUrl" target="_blank">{{ t('common.open') }}</n-button>
                            <n-button size="small" @click="copyText(feishuAuthResult?.verificationUrl || feishuAuthResult?.setupCommand || '')">{{ t('common.copy') }}</n-button>
                          </n-space>
                        </section>
                        <aside class="config-panel">
                          <div class="panel-heading">
                            <h3>{{ t('integrations.routePreview') }}</h3>
                            <n-text depth="3">{{ t('integrations.routePreviewDesc') }}</n-text>
                          </div>
                          <pre class="code-box compact">{{ feishuRouteDryRunCommand || t('common.empty') }}</pre>
                          <pre class="code-box compact">{{ feishuRouteEventCommand }}</pre>
                          <div class="inline-section">
                            <h3>{{ t('integrations.dynamicActions') }}</h3>
                            <n-space>
                              <n-button
                                v-for="action in feishuProvider?.actions || []"
                                :key="action.id"
                                size="small"
                                :type="action.kind === 'dry-run' ? 'primary' : 'default'"
                                :loading="integrationActionLoading === action.id"
                                :disabled="Boolean(integrationActionLoading) || !feishuProvider?.commandAvailable"
                                @click="runIntegrationAction('feishu', action.id)"
                              >
                                {{ action.label }}
                              </n-button>
                            </n-space>
                          </div>
                          <div class="inline-section">
                            <h3>{{ t('integrations.agentPlatforms') }}</h3>
                            <div class="platform-target-list">
                              <button v-for="target in feishuProvider?.platformTargets || []" :key="target.id" type="button" class="platform-target compact" @click="selectFeishuPlatformRoute(target.id)">
                                <span class="platform-target-head">
                                  <strong>{{ target.name }}</strong>
                                  <n-tag size="small" :type="statusTag(target.status)">{{ statusLabel(target.status) }}</n-tag>
                                </span>
                                <n-text depth="3">{{ feishuProvider?.routeConfigs?.find(route => route.agentPlatformId === target.id)?.configured ? t('integrations.routeConfiguredShort') : t('integrations.routePendingShort') }}</n-text>
                              </button>
                            </div>
                          </div>
                        </aside>
                      </div>
                    </n-tab-pane>

                    <n-tab-pane name="agent-connect" :tab="t('integrations.tabAgentConnect')">
                      <div class="integration-tab-layout wide">
                        <section class="config-panel">
                          <div class="panel-heading">
                            <h3>{{ t('integrations.agentConnect') }}</h3>
                            <n-text depth="3">{{ connectorWorkflow?.config.configured ? t('integrations.agentConnectConfigured') : t('integrations.agentConnectPending') }}</n-text>
                          </div>
                          <n-descriptions bordered :column="1" size="small">
                            <n-descriptions-item :label="t('integrations.routeConfigPath')">{{ connectorWorkflow?.config.configPath || '-' }}</n-descriptions-item>
                            <n-descriptions-item label="Management API">{{ managementEndpointPreview || '-' }}</n-descriptions-item>
                            <n-descriptions-item label="Bridge">{{ bridgeEndpointPreview || '-' }}</n-descriptions-item>
                            <n-descriptions-item label="Webhook">{{ connectorWorkflow?.config.endpoints.webhook || '-' }}</n-descriptions-item>
                          </n-descriptions>
                          <div class="route-form-grid">
                            <label>
                              <span>{{ t('integrations.enableWorkflow') }}</span>
                              <n-switch :value="agentConnectDraft.enabled" :aria-label="t('integrations.enableWorkflow')" @update:value="value => updateAgentConnectDraft('root', 'enabled', value)" />
                            </label>
                            <label>
                              <span>{{ t('integrations.managementApi') }}</span>
                              <n-switch :value="agentConnectDraft.managementApi.enabled" :aria-label="t('integrations.managementApi')" @update:value="value => updateAgentConnectDraft('managementApi', 'enabled', value)" />
                            </label>
                            <label>
                              <span>{{ t('integrations.host') }}</span>
                              <n-input :value="agentConnectDraft.managementApi.host" :input-props="{ id: 'agent-connect-management-host', name: 'agentConnectManagementHost', autocomplete: 'off' }" @update:value="value => updateAgentConnectDraft('managementApi', 'host', value)" />
                            </label>
                            <label>
                              <span>{{ t('integrations.port') }}</span>
                              <n-input-number :value="agentConnectDraft.managementApi.port" :min="1" :max="65535" :input-props="{ id: 'agent-connect-management-port', name: 'agentConnectManagementPort', autocomplete: 'off' }" @update:value="value => updateAgentConnectDraft('managementApi', 'port', value || 9820)" />
                            </label>
                            <label>
                              <span>{{ t('integrations.token') }}</span>
                              <n-input v-model:value="agentConnectTokenInputs.managementApi" type="password" show-password-on="click" :placeholder="agentConnectDraft.managementApi.tokenMasked || t('integrations.tokenPlaceholder')" :input-props="{ id: 'agent-connect-management-token', name: 'agentConnectManagementToken', autocomplete: 'new-password' }" />
                            </label>
                            <label>
                              <span>CORS</span>
                              <n-input :value="listInputValue(agentConnectDraft.managementApi.corsOrigins)" :input-props="{ id: 'agent-connect-management-cors', name: 'agentConnectManagementCorsOrigins', autocomplete: 'off' }" @update:value="value => updateAgentConnectList('managementApi', 'corsOrigins', value)" />
                            </label>
                            <label>
                              <span>Bridge</span>
                              <n-switch :value="agentConnectDraft.bridge.enabled" aria-label="Bridge" @update:value="value => updateAgentConnectDraft('bridge', 'enabled', value)" />
                            </label>
                            <label>
                              <span>{{ t('integrations.port') }}</span>
                              <n-input-number :value="agentConnectDraft.bridge.port" :min="1" :max="65535" :input-props="{ id: 'agent-connect-bridge-port', name: 'agentConnectBridgePort', autocomplete: 'off' }" @update:value="value => updateAgentConnectDraft('bridge', 'port', value || 9810)" />
                            </label>
                            <label>
                              <span>Path</span>
                              <n-input :value="agentConnectDraft.bridge.path" :input-props="{ id: 'agent-connect-bridge-path', name: 'agentConnectBridgePath', autocomplete: 'off' }" @update:value="value => updateAgentConnectDraft('bridge', 'path', value)" />
                            </label>
                            <label>
                              <span>{{ t('integrations.token') }}</span>
                              <n-input v-model:value="agentConnectTokenInputs.bridge" type="password" show-password-on="click" :placeholder="agentConnectDraft.bridge.tokenMasked || t('integrations.tokenPlaceholder')" :input-props="{ id: 'agent-connect-bridge-token', name: 'agentConnectBridgeToken', autocomplete: 'new-password' }" />
                            </label>
                            <label>
                              <span>{{ t('integrations.allowPlatforms') }}</span>
                              <n-input :value="listInputValue(agentConnectDraft.bridge.allowPlatforms)" :input-props="{ id: 'agent-connect-bridge-allow-platforms', name: 'agentConnectBridgeAllowPlatforms', autocomplete: 'off' }" @update:value="value => updateAgentConnectList('bridge', 'allowPlatforms', value)" />
                            </label>
                            <label>
                              <span>Webhook</span>
                              <n-switch :value="agentConnectDraft.webhook.enabled" aria-label="Webhook" @update:value="value => updateAgentConnectDraft('webhook', 'enabled', value)" />
                            </label>
                            <label>
                              <span>Webhook Path</span>
                              <n-input :value="agentConnectDraft.webhook.path" :input-props="{ id: 'agent-connect-webhook-path', name: 'agentConnectWebhookPath', autocomplete: 'off' }" @update:value="value => updateAgentConnectDraft('webhook', 'path', value)" />
                            </label>
                            <label>
                              <span>{{ t('integrations.token') }}</span>
                              <n-input v-model:value="agentConnectTokenInputs.webhook" type="password" show-password-on="click" :placeholder="agentConnectDraft.webhook.tokenMasked || t('integrations.tokenPlaceholder')" :input-props="{ id: 'agent-connect-webhook-token', name: 'agentConnectWebhookToken', autocomplete: 'new-password' }" />
                            </label>
                            <label>
                              <span>Cron</span>
                              <n-switch :value="agentConnectDraft.automation.cronEnabled" aria-label="Cron" @update:value="value => updateAgentConnectDraft('automation', 'cronEnabled', value)" />
                            </label>
                            <label>
                              <span>Heartbeat</span>
                              <n-switch :value="agentConnectDraft.automation.heartbeatEnabled" aria-label="Heartbeat" @update:value="value => updateAgentConnectDraft('automation', 'heartbeatEnabled', value)" />
                            </label>
                            <label>
                              <span>{{ t('integrations.heartbeatInterval') }}</span>
                              <n-input-number :value="agentConnectDraft.automation.heartbeatIntervalMins" :min="1" :max="1440" :input-props="{ id: 'agent-connect-heartbeat-interval', name: 'agentConnectHeartbeatIntervalMins', autocomplete: 'off' }" @update:value="value => updateAgentConnectDraft('automation', 'heartbeatIntervalMins', value || 30)" />
                            </label>
                            <label>
                              <span>{{ t('integrations.maxTurnTime') }}</span>
                              <n-input-number :value="agentConnectDraft.automation.maxTurnTimeMins" :min="0" :max="1440" :input-props="{ id: 'agent-connect-max-turn-time', name: 'agentConnectMaxTurnTimeMins', autocomplete: 'off' }" @update:value="value => updateAgentConnectDraft('automation', 'maxTurnTimeMins', value || 0)" />
                            </label>
                            <label>
                              <span>{{ t('integrations.resetOnIdle') }}</span>
                              <n-input-number :value="agentConnectDraft.automation.resetOnIdleMins" :min="0" :max="1440" :input-props="{ id: 'agent-connect-reset-on-idle', name: 'agentConnectResetOnIdleMins', autocomplete: 'off' }" @update:value="value => updateAgentConnectDraft('automation', 'resetOnIdleMins', value || 0)" />
                            </label>
                            <label>
                              <span>{{ t('integrations.longTaskNotify') }}</span>
                              <n-switch :value="agentConnectDraft.automation.longTaskNotifications" :aria-label="t('integrations.longTaskNotify')" @update:value="value => updateAgentConnectDraft('automation', 'longTaskNotifications', value)" />
                            </label>
                          </div>
                          <n-space align="center" wrap>
                            <n-button type="primary" size="small" :loading="agentOsBootstrapLoading" @click="bootstrapLocalAgentOs">{{ t('integrations.bootstrapLocal') }}</n-button>
                            <n-button :type="agentConnectDirty ? 'primary' : 'default'" size="small" :loading="agentConnectSaveLoading" :disabled="!agentConnectDirty" @click="saveAgentConnectConfig">{{ t('integrations.saveAgentConnect') }}</n-button>
                            <n-button size="small" @click="applyRecommendedAgentConnectDefaults">{{ t('integrations.applyRecommended') }}</n-button>
                            <n-button size="small" @click="generateAgentConnectTokens">{{ t('integrations.generateLocalTokens') }}</n-button>
                            <n-tag v-if="agentConnectDirty" type="warning" size="small">{{ t('integrations.unsaved') }}</n-tag>
                          </n-space>
                        </section>
                        <aside class="config-panel">
                          <div class="panel-heading">
                            <h3>{{ t('integrations.localRuntime') }}</h3>
                            <n-text depth="3">{{ t('integrations.localRuntimeDesc') }}</n-text>
                          </div>
                          <pre class="code-box compact">{{ (connectorWorkflow?.commands.configure || []).join('\n') }}</pre>
                          <pre class="code-box compact">{{ (connectorWorkflow?.daemon.hooks || []).join('\n') }}</pre>
                          <n-descriptions bordered :column="1" size="small">
                            <n-descriptions-item label="Bridge">{{ connectorWorkflow?.bridge.websocketEndpoint || '-' }}</n-descriptions-item>
                            <n-descriptions-item label="Inbound">{{ connectorWorkflow?.bridge.inboundTypes.join(', ') || '-' }}</n-descriptions-item>
                            <n-descriptions-item label="Outbound">{{ connectorWorkflow?.bridge.outboundTypes.join(', ') || '-' }}</n-descriptions-item>
                          </n-descriptions>
                        </aside>
                      </div>
                    </n-tab-pane>

                    <n-tab-pane name="knowledge" :tab="t('integrations.tabKnowledge')">
                      <div class="integration-tab-layout wide">
                        <section class="config-panel">
                          <div class="panel-heading">
                            <h3>{{ t('integrations.imaConfig') }}</h3>
                            <n-text depth="3">{{ imaProvider?.knowledgeConfig?.configured ? t('integrations.imaConfigured') : t('integrations.imaPending') }}</n-text>
                          </div>
                          <n-descriptions bordered :column="1" size="small">
                            <n-descriptions-item :label="t('integrations.routeConfigPath')">{{ imaProvider?.knowledgeConfig?.configPath || '-' }}</n-descriptions-item>
                            <n-descriptions-item label="Console">
                              <a :href="imaProvider?.knowledgeConfig?.consoleUrl || 'https://ima.qq.com/agent-interface'" target="_blank">https://ima.qq.com/agent-interface</a>
                            </n-descriptions-item>
                            <n-descriptions-item label="Auth">{{ imaProvider?.knowledgeConfig?.authLabel || '-' }}</n-descriptions-item>
                            <n-descriptions-item label="API Key">{{ imaProvider?.knowledgeConfig?.apiKeyMasked || (imaProvider?.knowledgeConfig?.hasApiKey ? 'configured' : '-') }}</n-descriptions-item>
                          </n-descriptions>
                          <div class="route-form-grid">
                            <label>
                              <span>Client ID</span>
                              <n-input :value="imaConfigDraft.clientId" placeholder="ima client id" :input-props="{ id: 'ima-client-id', name: 'imaClientId', autocomplete: 'off' }" @update:value="value => updateImaConfigDraft('clientId', value)" />
                            </label>
                            <label>
                              <span>{{ t('integrations.imaKnowledgeBaseId') }}</span>
                              <n-input :value="imaConfigDraft.knowledgeBaseId" placeholder="knowledge base id" :input-props="{ id: 'ima-knowledge-base-id', name: 'imaKnowledgeBaseId', autocomplete: 'off' }" @update:value="value => updateImaConfigDraft('knowledgeBaseId', value)" />
                            </label>
                            <label>
                              <span>{{ t('integrations.authMode') }}</span>
                              <n-select
                                :value="imaConfigDraft.authMode"
                                :options="[{ label: 'API Key', value: 'api-key' }, { label: 'QR', value: 'qr' }]"
                                :input-props="{ id: 'ima-auth-mode', name: 'imaAuthMode', autocomplete: 'off' }"
                                :aria-label="t('integrations.authMode')"
                                @update:value="value => updateImaConfigDraft('authMode', value)"
                              />
                            </label>
                            <label>
                              <span>API Key</span>
                              <n-input v-model:value="imaApiKeyInput" type="password" show-password-on="click" placeholder="Stored as masked marker only" :input-props="{ id: 'ima-api-key', name: 'imaApiKey', autocomplete: 'new-password' }" />
                            </label>
                            <label>
                              <span>{{ t('integrations.notes') }}</span>
                              <n-input :value="imaConfigDraft.notes || ''" :input-props="{ id: 'ima-notes', name: 'imaNotes', autocomplete: 'off' }" @update:value="value => updateImaConfigDraft('notes', value)" />
                            </label>
                          </div>
                          <n-space align="center" wrap>
                            <n-space align="center" size="small">
                              <n-text>{{ t('integrations.enableProvider') }}</n-text>
                              <n-switch :value="imaConfigDraft.enabled" :aria-label="t('integrations.enableProvider')" @update:value="value => updateImaConfigDraft('enabled', value)" />
                            </n-space>
                            <n-space align="center" size="small">
                              <n-text>{{ t('integrations.qrAuthorized') }}</n-text>
                              <n-switch :value="imaConfigDraft.qrAuthorized" :aria-label="t('integrations.qrAuthorized')" @update:value="value => updateImaConfigDraft('qrAuthorized', value)" />
                            </n-space>
                            <n-button type="primary" size="small" :loading="imaConfigSaveLoading" @click="saveImaKnowledgeProvider">
                              {{ t('integrations.saveProvider') }}
                            </n-button>
                            <n-tag v-if="imaConfigDirty" type="warning" size="small">{{ t('integrations.unsaved') }}</n-tag>
                          </n-space>
                        </section>
                        <aside class="config-panel">
                          <div class="panel-heading">
                            <h3>{{ t('integrations.authModes') }}</h3>
                            <n-text depth="3">{{ t('integrations.authModesDesc') }}</n-text>
                          </div>
                          <div v-for="mode in imaProvider?.authModes || []" :key="mode.id" class="auth-mode-card">
                            <div class="provider-tile-head">
                              <strong>{{ mode.label }}</strong>
                              <n-tag size="small" :type="mode.configured ? 'success' : 'warning'">{{ mode.configured ? statusLabel('ready') : statusLabel('partial') }}</n-tag>
                            </div>
                            <n-text depth="3">{{ mode.description }}</n-text>
                            <n-text depth="3">{{ mode.fields.join(', ') }}</n-text>
                          </div>
                        </aside>
                      </div>
                    </n-tab-pane>

                    <n-tab-pane name="automation" :tab="t('integrations.tabAutomation')">
                      <div class="integration-tab-layout">
                        <section class="config-panel">
                          <div class="panel-heading">
                            <h3>{{ t('integrations.requiredCapabilities') }}</h3>
                            <n-text depth="3">{{ t('integrations.requiredCapabilitiesDesc') }}</n-text>
                          </div>
                          <div class="provider-tile-grid">
                            <div v-for="skill in connectorWorkflow?.skillPresets || []" :key="skill.id" class="provider-tile">
                              <div class="provider-tile-head">
                                <strong>{{ skill.name }}</strong>
                                <n-tag size="small" :type="skill.defaultInstall ? 'success' : 'default'">{{ skill.defaultInstall ? t('integrations.defaultInstall') : skill.category }}</n-tag>
                              </div>
                              <p>{{ skill.reason }}</p>
                            </div>
                          </div>
                          <div class="inline-section">
                            <h3>{{ t('integrations.loopAutomation') }}</h3>
                            <div class="provider-tile-grid">
                              <div v-for="loop in connectorWorkflow?.automationLoops || []" :key="loop.id" class="provider-tile">
                                <div class="provider-tile-head">
                                  <strong>{{ loop.name }}</strong>
                                  <n-tag size="small" :type="loop.enabled ? 'success' : 'warning'">{{ loop.enabled ? statusLabel('ready') : statusLabel('partial') }}</n-tag>
                                </div>
                                <n-text depth="3">{{ loop.trigger }}</n-text>
                                <p>{{ loop.action }}</p>
                                <small>{{ loop.guardrail }}</small>
                              </div>
                            </div>
                          </div>
                        </section>
                        <aside class="config-panel">
                          <div class="panel-heading">
                            <h3>{{ t('integrations.providerPresets') }}</h3>
                            <n-text depth="3">{{ t('integrations.providerPresetsDesc') }}</n-text>
                          </div>
                          <div class="provider-tile-grid single">
                            <div v-for="preset in connectorWorkflow?.providerPresets || []" :key="preset.id" class="provider-tile">
                              <div class="provider-tile-head">
                                <strong>{{ preset.name }}</strong>
                                <n-tag size="small">T{{ preset.tier }}</n-tag>
                              </div>
                              <n-text depth="3">{{ preset.agents.join(', ') }}</n-text>
                              <p>{{ preset.features.join(', ') }}</p>
                            </div>
                          </div>
                        </aside>
                      </div>
                    </n-tab-pane>

                    <n-tab-pane name="diagnostics" :tab="t('integrations.tabDiagnostics')">
                      <div class="integration-tab-layout">
                        <section class="config-panel">
                          <div class="panel-heading">
                            <h3>{{ t('integrations.diagnosticTools') }}</h3>
                            <n-text depth="3">{{ t('integrations.diagnosticToolsDesc') }}</n-text>
                          </div>
                          <n-space wrap style="margin-bottom: 12px">
                            <n-button type="primary" :loading="agentOsAcceptanceLoading" @click="runAgentOsAcceptance">{{ t('integrations.runAcceptance') }}</n-button>
                            <n-button :disabled="!agentOsAcceptance?.path" @click="copyText(agentOsAcceptance?.path || '')">{{ t('integrations.copyAcceptancePath') }}</n-button>
                          </n-space>
                          <div v-if="agentOsAcceptance" class="acceptance-summary">
                            <div class="integration-score-head">
                              <span>{{ t('integrations.acceptanceScore') }}</span>
                              <strong>{{ agentOsAcceptance.score }}%</strong>
                            </div>
                            <n-progress type="line" :percentage="agentOsAcceptance.score" :status="agentOsAcceptance.status === 'passed' ? 'success' : 'warning'" :height="8" :show-indicator="false" />
                            <n-tag :type="agentOsAcceptance.status === 'passed' ? 'success' : agentOsAcceptance.status === 'failed' ? 'error' : 'warning'">{{ agentOsAcceptance.status }}</n-tag>
                            <div v-if="agentOsAcceptance.nextActions.length" class="diagnostic-evidence">
                              <n-tag v-for="action in agentOsAcceptance.nextActions" :key="action" type="warning" size="small">{{ action }}</n-tag>
                            </div>
                          </div>
                          <div v-if="agentOsAcceptance?.steps?.length" class="diagnostic-stage-list">
                            <div v-for="step in agentOsAcceptance.steps" :key="step.id" class="diagnostic-stage">
                              <div class="provider-tile-head">
                                <strong>{{ step.label }}</strong>
                                <n-tag size="small" :type="step.status === 'passed' ? 'success' : step.status === 'blocked' ? 'warning' : 'error'">{{ step.status }}</n-tag>
                              </div>
                              <n-text depth="3">{{ step.durationMs }}ms</n-text>
                              <pre v-if="step.command" class="code-box compact">{{ [step.command, ...(step.args || [])].join(' ') }}</pre>
                              <n-alert v-if="step.error" :type="step.status === 'blocked' ? 'warning' : 'error'" size="small">{{ step.error }}</n-alert>
                            </div>
                          </div>
                          <div class="diagnostic-stage-list">
                            <div v-for="stage in agentOsReadiness?.stages || []" :key="stage.id" class="diagnostic-stage">
                              <div class="provider-tile-head">
                                <strong>{{ readinessStageTitle(stage) }}</strong>
                                <n-tag size="small" :type="statusTag(stage.status)">{{ statusLabel(stage.status) }}</n-tag>
                              </div>
                              <n-text depth="3">{{ readinessStageAction(stage) }}</n-text>
                              <div class="diagnostic-evidence">
                                <n-tag v-for="item in stage.evidence" :key="`${stage.id}-${item}`" size="small">{{ item }}</n-tag>
                              </div>
                              <n-alert v-if="stage.blockers.length" type="warning" size="small">
                                {{ stage.blockers.join('；') }}
                              </n-alert>
                              <pre v-if="stage.commands.length" class="code-box compact">{{ stage.commands.join('\n') }}</pre>
                            </div>
                          </div>
                          <div class="two-col compact">
                            <div>
                              <strong>{{ t('integrations.setupCommands') }}</strong>
                              <pre class="code-box compact">{{ (feishuProvider?.setupCommands || []).join('\n') }}</pre>
                              <n-button size="small" @click="copyText((feishuProvider?.setupCommands || []).join('\n'))">{{ t('common.copy') }}</n-button>
                            </div>
                            <div>
                              <strong>{{ t('integrations.verifyCommands') }}</strong>
                              <pre class="code-box compact">{{ (feishuProvider?.verifyCommands || []).join('\n') }}</pre>
                              <n-button size="small" @click="copyText((feishuProvider?.verifyCommands || []).join('\n'))">{{ t('common.copy') }}</n-button>
                            </div>
                          </div>
                          <div class="two-col compact">
                            <div>
                              <strong>{{ t('integrations.dryRunSend') }}</strong>
                              <n-tag :type="feishuProvider?.dryRunSendPlan?.requiresConfirmation ? 'warning' : 'success'">
                                {{ feishuProvider?.dryRunSendPlan?.requiresConfirmation ? t('integrations.requiresConfirm') : t('integrations.dryRunOnly') }}
                              </n-tag>
                              <pre class="code-box compact">{{ feishuDryRunCommand || t('common.empty') }}</pre>
                            </div>
                            <div>
                              <strong>{{ t('integrations.eventConsume') }}</strong>
                              <n-tag>{{ feishuProvider?.eventConsumePlan?.risk || 'read' }}</n-tag>
                              <pre class="code-box compact">{{ feishuEventCommand || t('common.empty') }}</pre>
                            </div>
                          </div>
                        </section>
                        <aside class="config-panel">
                          <div class="panel-heading">
                            <h3>{{ t('integrations.channelMatrix') }}</h3>
                            <n-text depth="3">{{ t('integrations.channelMatrixDesc') }}</n-text>
                          </div>
                          <div class="provider-tile-grid single compact-scroll">
                            <div v-for="channel in connectorChannels" :key="channel.id" class="provider-tile">
                              <div class="provider-tile-head">
                                <strong>{{ channel.name }}</strong>
                                <n-tag size="small" :type="statusTag(channel.status)">{{ statusLabel(channel.status) }}</n-tag>
                              </div>
                              <n-text depth="3">{{ channel.transport.join(' / ') }}</n-text>
                              <p>{{ channel.capabilities.slice(0, 4).join(', ') }}</p>
                            </div>
                          </div>
                        </aside>
                      </div>
                      <section v-if="integrationActionResult" class="config-panel">
                        <div class="panel-heading">
                          <h3>{{ t('integrations.lastAction') }}</h3>
                          <n-space align="center">
                            <n-tag :type="integrationActionResult.ok ? 'success' : integrationActionResult.status === 'blocked' ? 'warning' : 'error'">
                              {{ integrationActionResult.status }}
                            </n-tag>
                            <n-text>{{ integrationActionResult.action }}</n-text>
                            <n-text depth="3">{{ integrationActionResult.durationMs }}ms</n-text>
                          </n-space>
                        </div>
                        <pre class="code-box compact">{{ [integrationActionResult.error, integrationActionResult.stdout, integrationActionResult.stderr].filter(Boolean).join('\n\n') || t('common.empty') }}</pre>
                      </section>
                    </n-tab-pane>
                  </n-tabs>
                </main>
              </div>
            </div>
          </section>

          <section v-else-if="activePage === 'documents'" class="page">
            <n-alert v-if="isResourceLoading('documents')" type="info">
              {{ t('documents.loading') }}
            </n-alert>
            <n-alert v-if="resourceError('documents')" type="warning">
              {{ resourceError('documents') }}
            </n-alert>
            <n-alert v-if="documentSource?.status === 'missing'" type="warning">
              {{ sourceReason(documentSource) }}
            </n-alert>
            <div class="toolbar">
              <n-input v-model:value="documentSearch" :placeholder="t('documents.search')" style="max-width: 420px" />
              <n-space>
                <n-button @click="copyDocumentIndex">{{ t('documents.copyIndex') }}</n-button>
                <n-button @click="downloadDocumentIndex">{{ t('documents.downloadIndex') }}</n-button>
              </n-space>
            </div>
            <n-card v-if="prototypeDocs.length" :title="t('documents.prototypeGallery')">
              <div class="prototype-grid">
                <div v-for="doc in prototypeDocs" :key="doc.path" class="prototype-card">
                  <iframe :src="documentUrl(doc.path)" />
                  <div class="prototype-body">
                    <strong>{{ doc.name }}</strong>
                    <span>{{ doc.path }}</span>
                    <div class="doc-actions">
                      <n-button size="small" @click="selectDocument(doc)">{{ t('documents.preview') }}</n-button>
                      <n-button size="small" tag="a" :href="documentUrl(doc.path)" target="_blank">{{ t('common.newTab') }}</n-button>
                      <n-button size="small" @click="copyText(absoluteDocumentUrl(doc.path))">{{ t('common.copy') }}</n-button>
                    </div>
                  </div>
                </div>
              </div>
            </n-card>
            <div class="doc-shell">
              <n-card class="doc-list" :title="`${t('nav.documents')} (${filteredDocuments.length})`">
                <div v-if="isResourceLoading('documents')" class="skeleton-list">
                  <n-skeleton v-for="item in 8" :key="item" text :repeat="2" />
                </div>
                <n-empty v-else-if="documentGroups.length === 0" :description="t('common.empty')" />
                <div v-else class="doc-tree-list">
                  <section v-for="group in documentGroups" :key="group.folder" class="doc-folder">
                    <div class="doc-folder-title">{{ group.folder }}</div>
                    <button
                      v-for="doc in group.documents"
                      :key="doc.path"
                      class="doc-tree-button"
                      :class="{ active: selectedDocument?.path === doc.path }"
                      @click="selectDocument(doc)"
                    >
                      <span>{{ doc.type.toUpperCase() }}</span>
                      <strong>{{ doc.name }}</strong>
                      <small>{{ formatSize(doc.size) }}</small>
                      <i @click.stop="toggleDocumentFavorite(doc.path)">{{ documentFavorites.has(doc.path) ? '★' : '☆' }}</i>
                    </button>
                  </section>
                </div>
              </n-card>
              <n-card :title="selectedDocument?.name || t('documents.preview')">
                <template #header-extra>
                  <div class="doc-actions">
                    <n-button size="small" :disabled="!selectedDocument" @click="copySelectedDocument">{{ t('common.copy') }}</n-button>
                    <n-button size="small" :disabled="!selectedDocument" @click="downloadSelectedDocument">{{ t('common.download') }}</n-button>
                    <n-button v-if="!documentEditMode" size="small" :disabled="!selectedDocument" @click="startDocumentEdit">{{ t('common.edit') }}</n-button>
                    <n-button v-if="documentEditMode" size="small" type="primary" @click="saveDocumentEdit">{{ t('common.save') }}</n-button>
                    <n-button v-if="documentEditMode" size="small" @click="cancelDocumentEdit">{{ t('common.cancel') }}</n-button>
                    <n-button size="small" :disabled="!selectedDocument" tag="a" :href="docPreviewUrl" target="_blank">{{ t('common.open') }}</n-button>
                  </div>
                </template>
                <n-spin :show="isResourceLoading('documents') && !selectedDocument">
                  <n-input
                  v-if="documentEditMode"
                  v-model:value="documentDraft"
                  class="editor-box"
                  type="textarea"
                  :autosize="{ minRows: 18, maxRows: 32 }"
                  />
                  <iframe v-else-if="selectedDocument?.type === 'html'" class="doc-preview" :src="docPreviewUrl" />
                  <pre v-else-if="selectedDocument?.type === 'json'" class="code-box">{{ documentContent || t('common.empty') }}</pre>
                  <div v-else-if="selectedDocument?.type === 'md'" class="markdown-body" v-html="renderedDocumentHtml" />
                  <pre v-else class="code-box">{{ documentContent || t('common.empty') }}</pre>
                </n-spin>
              </n-card>
            </div>
          </section>

          <section v-else-if="activePage === 'prompts'" class="page">
            <div class="metric-grid">
              <n-card><n-statistic label="Vibe" :value="prompts?.summary?.vibeTemplates || 0" /></n-card>
              <n-card><n-statistic label="Phase" :value="prompts?.summary?.phasePrompts || 0" /></n-card>
              <n-card><n-statistic label="Packs" :value="prompts?.summary?.packs || 0" /></n-card>
              <n-card><n-statistic label="Project" :value="prompts?.summary?.customPrompts || 0" /></n-card>
            </div>
            <div class="toolbar">
              <n-input v-model:value="promptSearch" :placeholder="t('prompts.search')" style="max-width: 420px" />
              <n-select
                v-model:value="promptKindFilter"
                :options="[
                  { label: 'All', value: 'all' },
                  { label: 'Vibe', value: 'vibe' },
                  { label: 'Phase', value: 'phase' },
                  { label: 'Pack', value: 'pack' }
                ]"
                style="width: 160px"
              />
            </div>
            <div class="prompt-layout">
              <n-card class="prompt-list" :title="t('prompts.gallery')">
                <n-empty v-if="filteredPromptItems.length === 0" :description="t('common.empty')" />
                <n-list v-else>
                  <n-list-item v-for="item in filteredPromptItems" :key="String(item.id)">
                    <button class="prompt-item" :class="{ active: selectedPrompt?.id === item.id }" @click="selectedPromptId = String(item.id)">
                      <span>{{ item.label }}</span>
                      <small>{{ item.kind }} · {{ item.source || 'builtin' }}</small>
                    </button>
                  </n-list-item>
                </n-list>
              </n-card>
              <n-space vertical size="large">
                <n-card :title="String(selectedPrompt?.label || t('prompts.gallery'))">
                  <template #header-extra>
                    <n-space>
                      <n-tag v-if="selectedPrompt?.kind">{{ selectedPrompt.kind }}</n-tag>
                      <n-button size="small" @click="copyText(selectedPromptText)">{{ t('common.copy') }}</n-button>
                      <n-button size="small" @click="downloadText(`${selectedPrompt?.id || 'prompt'}.md`, selectedPromptText)">{{ t('common.download') }}</n-button>
                    </n-space>
                  </template>
                  <p v-if="selectedPrompt?.command" class="muted">{{ t('prompts.command') }}: {{ selectedPrompt.command }}</p>
                  <p v-if="selectedPrompt?.description" class="muted">{{ selectedPrompt.description }}</p>
                  <div class="prompt-meta-grid">
                    <div v-if="selectedPrompt?.phase || selectedPrompt?.role" class="prompt-meta-card">
                      <strong>{{ t('prompts.role') }}</strong>
                      <span v-if="selectedPrompt?.role">{{ selectedPrompt.role }}</span>
                      <small v-if="selectedPrompt?.phase">{{ t('prompts.phase') }}: {{ selectedPrompt.phase }}</small>
                    </div>
                    <div v-if="selectedPrompt?.bestFor?.length" class="prompt-meta-card">
                      <strong>{{ t('prompts.bestFor') }}</strong>
                      <div class="prompt-chip-row">
                        <n-tag v-for="item in selectedPrompt.bestFor" :key="item" size="small">{{ item }}</n-tag>
                      </div>
                    </div>
                    <div v-if="selectedPrompt?.scaleWorkflow?.length" class="prompt-meta-card">
                      <strong>{{ t('prompts.workflow') }}</strong>
                      <div class="prompt-chip-row">
                        <n-tag v-for="item in selectedPrompt.scaleWorkflow" :key="item" size="small" type="info">{{ item }}</n-tag>
                      </div>
                    </div>
                    <div v-if="selectedPrompt?.suggestedSkills?.length" class="prompt-meta-card">
                      <strong>{{ t('prompts.skills') }}</strong>
                      <div class="prompt-chip-row">
                        <n-tag v-for="item in selectedPrompt.suggestedSkills" :key="item" size="small">{{ item }}</n-tag>
                      </div>
                    </div>
                    <div v-if="selectedPrompt?.suggestedTools?.length" class="prompt-meta-card">
                      <strong>{{ t('prompts.tools') }}</strong>
                      <div class="prompt-chip-row">
                        <n-tag v-for="item in selectedPrompt.suggestedTools" :key="item" size="small" type="success">{{ item }}</n-tag>
                      </div>
                    </div>
                    <div v-if="selectedPrompt?.outputs?.length" class="prompt-meta-card">
                      <strong>{{ t('prompts.outputs') }}</strong>
                      <div class="prompt-chip-row">
                        <n-tag v-for="item in selectedPrompt.outputs" :key="item" size="small" type="warning">{{ item }}</n-tag>
                      </div>
                    </div>
                    <div v-if="selectedPrompt?.methodologyReferences?.length" class="prompt-meta-card">
                      <strong>{{ t('prompts.references') }}</strong>
                      <ul>
                        <li v-for="item in selectedPrompt.methodologyReferences" :key="item">{{ item }}</li>
                      </ul>
                    </div>
                    <div v-if="selectedPrompt?.coachingQuestions?.length" class="prompt-meta-card">
                      <strong>{{ t('prompts.questions') }}</strong>
                      <ul>
                        <li v-for="item in selectedPrompt.coachingQuestions" :key="item">{{ item }}</li>
                      </ul>
                    </div>
                  </div>
                  <pre class="code-box">{{ selectedPromptText }}</pre>
                </n-card>
                <n-card :title="t('prompts.agentPlan')">
                  <n-space vertical>
                    <n-input
                      v-model:value="agentPlanTask"
                      type="textarea"
                      :autosize="{ minRows: 3 }"
                      :placeholder="selectedPromptAgentTask"
                    />
                    <n-input-group>
                      <n-select
                        v-model:value="agentPlanLevel"
                        :options="[
                          { label: 'S', value: 'S' },
                          { label: 'M', value: 'M' },
                          { label: 'L', value: 'L' },
                          { label: 'CRITICAL', value: 'CRITICAL' }
                        ]"
                        style="width: 132px"
                      />
                      <n-input v-model:value="agentPlanBudget" :placeholder="t('prompts.agentPlanBudget')" style="width: 150px" />
                      <n-input v-model:value="agentPlanFiles" :placeholder="t('prompts.agentPlanFiles')" />
                      <n-button type="primary" :disabled="!dashboardTransportAvailable" :loading="agentPlanLoading" @click="generateAgentPlan">{{ t('prompts.agentPlanGenerate') }}</n-button>
                      <n-button tag="a" :href="agentPlanReadOnlyUrl" target="_blank">{{ t('prompts.agentPlanOpenJson') }}</n-button>
                    </n-input-group>
                    <div v-if="agentPlanResult?.agentCollaboration" class="agent-plan-summary">
                      <div class="agent-plan-head">
                        <strong>{{ agentPlanResult.agentCollaboration.mode }}</strong>
                        <span>{{ agentPlanResult.agentCollaboration.summary.totalRoles }} {{ t('prompts.agentPlanRoles') }}</span>
                        <span>{{ agentPlanResult.agentCollaboration.summary.reviewGateCount }} {{ t('prompts.agentPlanReviewGates') }}</span>
                        <span>{{ agentPlanResult.agentCollaboration.budget.reserveTokens }} {{ t('prompts.agentPlanReserve') }}</span>
                      </div>
                      <div class="prompt-meta-grid">
                        <div class="prompt-meta-card">
                          <strong>{{ t('prompts.agentPlanRoles') }}</strong>
                          <ul>
                            <li v-for="role in agentPlanResult.agentCollaboration.roles" :key="role.profileId">
                              {{ role.profileId }} · {{ role.responsibility }} · {{ role.required ? 'required' : 'optional' }}
                            </li>
                          </ul>
                        </div>
                        <div class="prompt-meta-card">
                          <strong>{{ t('prompts.agentPlanHandoffs') }}</strong>
                          <ul>
                            <li v-for="handoff in agentPlanResult.agentCollaboration.handoffs" :key="`${handoff.from}-${handoff.to}-${handoff.artifact}`">
                              {{ handoff.from }} -> {{ handoff.to }} · {{ handoff.artifact }}
                            </li>
                          </ul>
                        </div>
                        <div class="prompt-meta-card">
                          <strong>{{ t('prompts.agentPlanReviewGates') }}</strong>
                          <ul>
                            <li v-for="gate in agentPlanResult.agentCollaboration.reviewGates" :key="gate.id">
                              {{ gate.id }} · {{ gate.owner }} · {{ gate.required ? 'required' : 'optional' }}
                            </li>
                          </ul>
                        </div>
                      </div>
                      <n-space>
                        <n-button size="small" @click="copyText(agentPlanJson)">{{ t('common.copy') }}</n-button>
                        <n-button size="small" @click="downloadText('agent-collaboration.json', agentPlanJson, 'application/json;charset=utf-8')">{{ t('common.download') }}</n-button>
                      </n-space>
                    </div>
                    <pre v-if="agentPlanResult" class="code-box compact">{{ agentPlanJson }}</pre>
                  </n-space>
                </n-card>
                <n-card :title="t('prompts.optimizer')">
                  <n-space vertical>
                    <n-input v-model:value="optimizeInput" type="textarea" :autosize="{ minRows: 5 }" :placeholder="t('prompts.input')" />
                    <n-button type="primary" :disabled="!optimizeInput.trim()" @click="optimizePrompt">{{ t('prompts.optimize') }}</n-button>
                    <pre v-if="optimizeResult" class="code-box">{{ JSON.stringify(optimizeResult, null, 2) }}</pre>
                  </n-space>
                </n-card>
              </n-space>
            </div>
          </section>
        </n-layout-content>
      </n-layout>
    </n-layout>
  </n-config-provider>
</template>
