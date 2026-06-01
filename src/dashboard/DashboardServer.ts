/**
 * Dashboard Server — Web-based visualization for SCALE Engine state
 * Part of P2-2: Web Dashboard for real-time monitoring
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/bun'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EventBus } from '../core/eventBus.js'
import type { Gate } from '../artifact/types.js'
import type { IArtifactStore } from '../artifact/store.js'
import type { IFSM } from '../artifact/fsm.js'
import type { IEvolutionEvaluator, EvolutionMetrics } from '../evolution/EvolutionEvaluator.js'
import type { DetectorStatisticsTracker } from '../guardrails/DetectorEnhanced.js'
import { dumpCodeGraphData, type TopologyGraph } from '../codegraph/CodeIntelligence.js'
import { classifyLayers } from '../topology/LayerClassifier.js'
import { mapDomains } from '../topology/DomainMapper.js'
import { generateTour } from '../topology/TourGenerator.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Dashboard state interface
export interface DashboardState {
  artifacts: ArtifactTreeNode[]
  evolutionMetrics: EvolutionMetrics | null
  detectorStats: DetectorStatSummary[]
  autoDefectStats: AutoDefectSummary | null
  recentEvents: RecentEvent[]
  timestamp: number
}

// AutoDefect statistics summary
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

// Artifact tree node for visualization
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

/**
 * DashboardServer — Hono-based web server for dashboard
 */
export class DashboardServer {
  private app: Hono
  private bus: EventBus
  private store: IArtifactStore | null = null
  private fsm: IFSM | null = null
  private evaluator: IEvolutionEvaluator | null = null
  private detectorTracker: DetectorStatisticsTracker | null = null
  private port: number
  private projectDir: string

  constructor(
    bus: EventBus,
    options: {
      port?: number
      store?: IArtifactStore
      fsm?: IFSM
      evaluator?: IEvolutionEvaluator
      detectorTracker?: DetectorStatisticsTracker
      projectDir?: string
    } = {}
  ) {
    this.app = new Hono()
    this.bus = bus
    this.store = options.store ?? null
    this.fsm = options.fsm ?? null
    this.evaluator = options.evaluator ?? null
    this.detectorTracker = options.detectorTracker ?? null
    this.port = options.port ?? 3000
    this.projectDir = options.projectDir ?? process.cwd()

    this.setupRoutes()
  }

  private setupRoutes(): void {
    // CORS for cross-origin requests
    this.app.use('*', cors())

    // Static files for frontend
    this.app.use('/static/*', serveStatic({ root: './src/dashboard/static' }))

    // Health check
    this.app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }))

    // Main dashboard state
    this.app.get('/api/state', async (c) => {
      const state = await this.getDashboardState()
      return c.json(state)
    })

    // Artifact tree
    this.app.get('/api/artifacts', async (c) => {
      const tree = await this.getArtifactTree()
      return c.json(tree)
    })

    // Evolution metrics
    this.app.get('/api/evolution', async (c) => {
      const metrics = await this.getEvolutionMetrics()
      return c.json(metrics)
    })

    // Detector stats
    this.app.get('/api/detectors', async (c) => {
      const stats = this.getDetectorStats()
      return c.json(stats)
    })

    // Recent events
    this.app.get('/api/events', async (c) => {
      const limit = parseInt(c.req.query('limit') ?? '50')
      const events = await this.getRecentEvents(limit)
      return c.json(events)
    })

    // AutoDefect statistics
    this.app.get('/api/auto-defects', async (c) => {
      const stats = await this.getAutoDefectStats()
      return c.json(stats)
    })

    // ── Topology ──────────────────────────────────────────────────────

    // Topology graph view
    this.app.get('/topology', (c) => c.html(this.getTopologyHtml()))

    // Topology data API
    this.app.get('/api/topology', (c) => {
      const graph = this.getTopology()
      return c.json(graph)
    })

    // Guided tour API
    this.app.get('/api/topology/tour', (c) => {
      const tour = generateTour(this.getTopology())
      return c.json(tour)
    })

    // ── Write Operations ──────────────────────────────────────────────

    // Artifact transition
    this.app.post('/api/artifacts/:id/transition', async (c) => {
      if (!this.fsm || !this.store) {
        return c.json({ error: 'FSM or store not available' }, 503)
      }
      const id = c.req.param('id')
      const body = await c.req.json<{ action: string; reason?: string }>()
      if (!body.action) {
        return c.json({ error: 'Missing required field: action' }, 400)
      }

      try {
        const artifact = await this.store.get(id)
        if (!artifact) return c.json({ error: `Artifact not found: ${id}` }, 404)

        // Check available actions first
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

        if (!result.success) {
          return c.json({
            error: 'Transition blocked by guards',
            blockedBy: result.blockedBy,
          }, 422)
        }

        return c.json({
          success: true,
          artifact: result.artifact,
          effectsExecuted: result.effectsExecuted,
        })
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
      }
    })

    // Get available transitions for an artifact
    this.app.get('/api/artifacts/:id/actions', async (c) => {
      if (!this.fsm) return c.json({ error: 'FSM not available' }, 503)
      const id = c.req.param('id')
      try {
        const actions = await this.fsm.availableActions(id)
        return c.json({ id, actions })
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
      }
    })

    // Lesson approve (PROPOSED → APPROVED)
    this.app.post('/api/lessons/:id/approve', async (c) => {
      if (!this.fsm || !this.store) {
        return c.json({ error: 'FSM or store not available' }, 503)
      }
      const id = c.req.param('id')
      try {
        const artifact = await this.store.get(id)
        if (!artifact || artifact.type !== 'Lesson') {
          return c.json({ error: `Lesson not found: ${id}` }, 404)
        }
        if (artifact.status !== 'PROPOSED') {
          return c.json({ error: `Lesson is "${artifact.status}", can only approve from PROPOSED` }, 400)
        }
        const body: { reason?: string } = await c.req.json<{ reason?: string }>().catch(() => ({}))
        const result = await this.fsm.transition(id, 'review', {
          actor: { kind: 'system', component: 'dashboard' },
          reason: body.reason ?? 'Approved via dashboard',
        })
        if (!result.success) {
          return c.json({ error: 'Transition blocked', blockedBy: result.blockedBy }, 422)
        }
        return c.json({ success: true, artifact: result.artifact })
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
      }
    })

    // Lesson reject (PROPOSED → REJECTED)
    this.app.post('/api/lessons/:id/reject', async (c) => {
      if (!this.fsm || !this.store) {
        return c.json({ error: 'FSM or store not available' }, 503)
      }
      const id = c.req.param('id')
      try {
        const artifact = await this.store.get(id)
        if (!artifact || artifact.type !== 'Lesson') {
          return c.json({ error: `Lesson not found: ${id}` }, 404)
        }
        if (artifact.status !== 'PROPOSED') {
          return c.json({ error: `Lesson is "${artifact.status}", can only reject from PROPOSED` }, 400)
        }
        const body: { reason?: string } = await c.req.json<{ reason?: string }>().catch(() => ({}))
        const result = await this.fsm.transition(id, 'reject', {
          actor: { kind: 'system', component: 'dashboard' },
          reason: body.reason ?? 'Rejected via dashboard',
        })
        if (!result.success) {
          return c.json({ error: 'Transition blocked', blockedBy: result.blockedBy }, 422)
        }
        return c.json({ success: true, artifact: result.artifact })
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
      }
    })

    // Index page - serve static HTML
    this.app.get('/', (c) => c.html(this.getIndexHtml()))
  }

  async getDashboardState(): Promise<DashboardState> {
    const [artifacts, evolutionMetrics, detectorStats, autoDefectStats, recentEvents] = await Promise.all([
      this.getArtifactTree(),
      this.getEvolutionMetrics(),
      Promise.resolve(this.getDetectorStats()),
      this.getAutoDefectStats(),
      this.getRecentEvents(20),
    ])

    return {
      artifacts,
      evolutionMetrics,
      detectorStats,
      autoDefectStats,
      recentEvents,
      timestamp: Date.now(),
    }
  }

  async getArtifactTree(): Promise<ArtifactTreeNode[]> {
    if (!this.store) return []

    const artifacts = await this.store.query({})
    const nodes: ArtifactTreeNode[] = []

    // Build parent-child relationships
    const byId = new Map<string, ArtifactTreeNode>()
    for (const a of artifacts) {
      const node: ArtifactTreeNode = {
        id: a.id,
        type: a.type,
        title: a.title,
        status: a.status,
        version: a.version,
        children: [],
        gates: a.gates?.map((g: Gate) => ({ name: g.name, required: g.required, passed: g.passed })),
      }
      byId.set(a.id, node)
    }

    // Connect children to parents
    for (const a of artifacts) {
      if (a.parents && a.parents.length > 0) {
        for (const parentId of a.parents) {
          const parent = byId.get(parentId)
          if (parent) {
            const child = byId.get(a.id)
            if (child) parent.children.push(child)
          }
        }
      }
    }

    // Root nodes have no parents
    for (const a of artifacts) {
      if (!a.parents || a.parents.length === 0) {
        const node = byId.get(a.id)
        if (node) nodes.push(node)
      }
    }

    return nodes
  }

  async getEvolutionMetrics(): Promise<EvolutionMetrics | null> {
    if (!this.evaluator) return null
    return await this.evaluator.evaluate()
  }

  getDetectorStats(): DetectorStatSummary[] {
    if (!this.detectorTracker) return []

    const allStats = this.detectorTracker.getAllStats()
    return allStats.map(s => ({
      name: s.detectorName,
      totalTriggers: s.totalTriggers,
      bySeverity: s.bySeverity,
      lastTrigger: s.recentTriggers.length > 0 ? s.recentTriggers[s.recentTriggers.length - 1]?.triggeredAt : undefined,
    }))
  }

  async getAutoDefectStats(): Promise<AutoDefectSummary | null> {
    if (!this.store) return null

    // Query all Defect artifacts
    const defects = await this.store.query({ type: 'Defect' })

    const autoCreated = defects.filter(d => {
      const payload = d.payload as Record<string, unknown>
      return payload.autoCreated === true
    })

    // Count by rootCauseCategory
    const byRootCause: Record<string, number> = {}
    const bySeverity: Record<string, number> = {}

    for (const d of autoCreated) {
      const payload = d.payload as Record<string, unknown>
      const rootCause = payload.rootCauseCategory as string ?? 'unknown'
      const severity = payload.severity as string ?? 'unknown'

      byRootCause[rootCause] = (byRootCause[rootCause] ?? 0) + 1
      bySeverity[severity] = (bySeverity[severity] ?? 0) + 1
    }

    // Recent defects (last 10)
    const recentDefects: RecentDefect[] = autoCreated
      .slice(-10)
      .reverse()
      .map(d => {
        const payload = d.payload as Record<string, unknown>
        return {
          id: d.id,
          title: d.title,
          rootCause: payload.rootCauseCategory as string ?? 'unknown',
          severity: payload.severity as string ?? 'unknown',
          detector: payload.detector as string ?? 'unknown',
          createdAt: d.createdAt ?? (payload.timestamp as number ?? 0),
        }
      })

    return {
      totalDefects: defects.length,
      autoCreatedCount: autoCreated.length,
      byRootCause,
      bySeverity,
      recentDefects,
    }
  }

  async getRecentEvents(limit: number): Promise<RecentEvent[]> {
    // Get recent events from EventBus via query
    const events = await this.bus.query({ limit })
    return events.map(e => ({
      type: e.type,
      timestamp: e.timestamp,
      artifactId: e.artifactId,
      data: e.payload as Record<string, unknown>,
    }))
  }

  start(): void {
    console.log(`Dashboard server starting on port ${this.port}`)
    // @ts-expect-error Bun runtime API - types not available in npm package
    Bun.serve({
      port: this.port,
      fetch: this.app.fetch,
    })
  }

  stop(): void {
    // Bun server stops automatically when process exits
    console.log('Dashboard server stopped')
  }

  getTopology(): TopologyGraph {
    const raw = dumpCodeGraphData({ projectDir: this.projectDir })
    return classifyLayers(raw)
  }

  private getTopologyHtml(): string {
    const htmlPath = join(__dirname, 'views', 'topology.html')
    return readFileSync(htmlPath, 'utf-8')
  }

  private getIndexHtml(): string {
    const htmlPath = join(__dirname, 'index.html')
    return readFileSync(htmlPath, 'utf-8')
  }
}
