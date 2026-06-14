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
type PageKey = 'overview' | 'workflow' | 'topology' | 'monitoring' | 'costs' | 'knowledge' | 'documents' | 'prompts'
type SourceStatus = 'ready' | 'partial' | 'missing' | 'error'
type RefreshMode = 'sse' | 'polling' | 'manual' | 'snapshot'
type MonitorTab = 'overview' | 'detectors' | 'defects' | 'commands'
type KnowledgeTab = 'base' | 'memory' | 'graph'
type GraphKey = 'graphify' | 'memory'

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
const sseStatus = ref<'live' | 'polling' | 'reconnecting'>('polling')
const lastLoaded = ref<number | null>(null)
const projects = ref<ProjectSummary[]>([])
const currentProjectUrl = ref('')
const capabilities = ref<CapabilityReport | null>(null)
const metrics = ref<MetricsReport | null>(null)
const state = ref<DashboardState | null>(null)
const topology = ref<TopologyReport | null>(null)
const domains = ref<unknown>(null)
const documents = ref<DocumentItem[]>([])
const selectedDocument = ref<DocumentItem | null>(null)
const documentContent = ref('')
const knowledge = ref<KnowledgeReport | null>(null)
const knowledgeBase = ref<KnowledgeBaseReport | null>(null)
const prompts = ref<PromptReport | null>(null)
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
const documentSource = computed(() => sourceById('documents'))
const commandSource = computed(() => sourceById('command-runs'))

const menuOptions = computed(() => [
  { label: t('nav.overview'), key: 'overview' },
  { label: t('nav.workflow'), key: 'workflow' },
  { label: t('nav.topology'), key: 'topology' },
  { label: t('nav.monitoring'), key: 'monitoring' },
  { label: t('nav.costs'), key: 'costs' },
  { label: t('nav.knowledge'), key: 'knowledge' },
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

async function refreshAll() {
  loading.value = true
  const failures: string[] = []
  const [
    projectList,
    capabilityReport,
    metricReport,
    dashboardState,
    topologyReport,
    domainReport,
    documentList,
    knowledgeBaseReport,
    promptReport,
  ] = await Promise.allSettled([
    fetchJSON<ProjectSummary[]>('/api/projects'),
    fetchJSON<CapabilityReport>('/api/dashboard/capabilities'),
    fetchJSON<MetricsReport>('/api/metrics'),
    fetchJSON<DashboardState>('/api/state'),
    fetchJSON<TopologyReport>('/api/topology'),
    fetchJSON<unknown>('/api/topology/domains'),
    fetchJSON<DocumentItem[]>('/api/documents'),
    fetchJSON<KnowledgeBaseReport>('/api/knowledge-base'),
    fetchJSON<PromptReport>('/api/prompts'),
  ])

  applySettled(projectList, 'projects', value => { projects.value = value }, failures)
  applySettled(capabilityReport, 'capabilities', value => { capabilities.value = value }, failures)
  applySettled(metricReport, 'metrics', value => { metrics.value = value }, failures)
  applySettled(dashboardState, 'state', value => { state.value = value }, failures)
  applySettled(topologyReport, 'topology', value => { topology.value = value }, failures)
  applySettled(domainReport, 'domains', value => { domains.value = value }, failures)
  applySettled(documentList, 'documents', value => { documents.value = value }, failures)
  applySettled(knowledgeBaseReport, 'knowledge-base', value => { knowledgeBase.value = value }, failures)
  applySettled(promptReport, 'prompts', value => { prompts.value = value }, failures)

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

async function loadKnowledge(runRecall: boolean) {
  const query = encodeURIComponent(knowledgeQuery.value.trim())
  const recall = runRecall && query ? '&recall=1' : ''
  knowledge.value = await fetchJSON<KnowledgeReport>(`/api/knowledge?providers=true&limit=80${query ? `&query=${query}` : ''}${recall}`)
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

async function fetchJSON<T>(url: string): Promise<T> {
  const response = await dashboardFetch(url)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`)
  return await response.json() as T
}

function applySettled<T>(
  result: PromiseSettledResult<T>,
  label: string,
  apply: (value: T) => void,
  failures: string[],
) {
  if (result.status === 'fulfilled') {
    apply(result.value)
    return
  }
  failures.push(`${label}: ${errorMessage(result.reason)}`)
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
  const mapped = t(`source.${source.id}.reason`)
  if (!mapped.startsWith('source.')) return mapped
  return [source.emptyReason, source.action].filter(Boolean).join(' ')
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

function isPageKey(value: string): value is PageKey {
  return ['overview', 'workflow', 'topology', 'monitoring', 'costs', 'knowledge', 'documents', 'prompts'].includes(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function t(key: string, params?: Record<string, string | number>): string {
  const value = translations[lang.value][key] || translations.en[key] || key
  if (!params) return value
  return Object.entries(params).reduce((text, [name, replacement]) => text.replaceAll(`{${name}}`, String(replacement)), value)
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
  void refreshAll()
  connectStream()
  refreshTimer = window.setInterval(() => void refreshAll(), 30000)
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
    'status.ready': '就绪',
    'status.partial': '部分闭环',
    'status.missing': '缺失',
    'status.error': '错误',
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
    'source.agent-collaboration.reason': '没有已结算的 agentExecution 证据，请先运行 scale agent plan，再用 scale ai-os run --mode guarded --verify 结算。',
    'source.event-stream.reason': '当前是 heartbeat-only SSE；页面会用轮询刷新。',
    'source.artifact-fsm.reason': 'HTTP 面板没有注入 artifact store/FSM，状态迁移写操作仍是部分闭环。',
  },
  en: {
    'nav.overview': 'Overview',
    'nav.workflow': 'Workflow',
    'nav.topology': 'Topology',
    'nav.monitoring': 'Monitoring',
    'nav.costs': 'Tokens & Cost',
    'nav.knowledge': 'Knowledge',
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
    'status.ready': 'Ready',
    'status.partial': 'Partial',
    'status.missing': 'Missing',
    'status.error': 'Error',
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
            <div class="metric-grid">
              <n-card class="metric-card"><n-statistic :label="t('overview.readySources')" :value="capabilities?.summary.ready || 0" /></n-card>
              <n-card class="metric-card"><n-statistic :label="t('overview.partialSources')" :value="capabilities?.summary.partial || 0" /></n-card>
              <n-card class="metric-card"><n-statistic :label="t('overview.missingSources')" :value="capabilities?.summary.missing || 0" /></n-card>
              <n-card class="metric-card"><n-statistic :label="t('overview.artifacts')" :value="artifactCount(state?.artifacts)" /></n-card>
              <n-card class="metric-card"><n-statistic :label="t('overview.commands')" :value="metrics?.commandRuns?.total || 0" /></n-card>
              <n-card class="metric-card"><n-statistic :label="t('overview.memory')" :value="knowledge?.local?.total || 0" /></n-card>
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
                    <n-empty v-if="knowledgeDocumentGroups.length === 0" :description="t('common.empty')" />
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

          <section v-else-if="activePage === 'documents'" class="page">
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
                <n-empty v-if="documentGroups.length === 0" :description="t('common.empty')" />
                <div class="doc-tree-list">
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
