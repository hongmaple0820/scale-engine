/**
 * Dashboard Server 2.0 — Unified Hono server with Node.js adapter
 * SPA architecture, SSE real-time, ECharts visualization
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/bun'
import { streamSSE } from 'hono/streaming'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
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
import { aggregateGovernanceMetrics, type AggregatedGovernanceMetrics } from './MetricsAggregator.js'
import { logger } from '../core/logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Types ────────────────────────────────────────────────────────────────

export interface DashboardState {
  artifacts: ArtifactTreeNode[]
  evolutionMetrics: EvolutionMetrics | null
  detectorStats: DetectorStatSummary[]
  autoDefectStats: AutoDefectSummary | null
  recentEvents: RecentEvent[]
  timestamp: number
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
  private server: ReturnType<typeof import('@hono/node-server').serve> | null = null

  constructor(options: DashboardOptions = {}) {
    this.app = new Hono()
    this.bus = options.bus ?? null
    this.store = options.store ?? null
    this.fsm = options.fsm ?? null
    this.evaluator = options.evaluator ?? null
    this.detectorTracker = options.detectorTracker ?? null
    this.port = options.port ?? 3210
    this.host = options.host ?? '0.0.0.0'
    this.projectDir = options.projectDir ?? process.cwd()
    this.scaleDir = options.scaleDir ?? join(this.projectDir, '.scale')

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
    // Resolve SPA dir: try dist/spa first, fall back to src/spa
    const distSpa = join(__dirname, 'spa')
    const srcSpa = join(__dirname, '..', '..', 'src', 'dashboard', 'spa')
    const spaDir = existsSync(distSpa) ? distSpa : srcSpa
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
    }

    // Serve SPA static files
    this.app.get('/spa/*', async (c) => {
      const path = c.req.path.replace('/spa/', '') || 'index.html'
      const filePath = join(spaDir, path)
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        return c.notFound()
      }
      const ext = extname(filePath)
      const contentType = mimeTypes[ext] ?? 'application/octet-stream'
      const content = readFileSync(filePath)
      return new Response(content, {
        headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache' },
      })
    })

    // Root redirect to SPA
    this.app.get('/', (c) => c.redirect('/spa/'))

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

  private setupAPI(): void {
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
  }

  // ── Data Collection ──────────────────────────────────────────────────

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

  private listDocuments(): Array<{ name: string; path: string; type: string; size: number }> {
    const docs: Array<{ name: string; path: string; type: string; size: number }> = []
    const scanDir = (dir: string, prefix: string) => {
      if (!existsSync(dir)) return
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name)
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          scanDir(fullPath, relPath)
        } else if (entry.isFile() && /\.(html|md|json)$/.test(entry.name)) {
          const stat = statSync(fullPath)
          docs.push({ name: entry.name, path: relPath, type: extname(entry.name).slice(1), size: stat.size })
        }
      }
    }
    // Scan common doc locations
    scanDir(join(this.scaleDir, 'docs'), '.scale/docs')
    scanDir(join(this.scaleDir, 'artifacts'), '.scale/artifacts')
    scanDir(join(this.projectDir, 'docs'), 'docs')
    return docs
  }

  private serveDocument(docPath: string, c: any): Response {
    // docPath already includes prefix (e.g., 'docs/foo.md' or '.scale/docs/foo.md')
    // Try direct resolution from project root and scale root
    const searchDirs = [
      this.projectDir,
      this.scaleDir,
    ]
    for (const dir of searchDirs) {
      const fullPath = join(dir, docPath)
      if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        const ext = extname(fullPath)
        const contentType = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.json' ? 'application/json' : 'text/plain; charset=utf-8'
        return new Response(readFileSync(fullPath), { headers: { 'Content-Type': contentType } })
      }
    }
    return c.json({ error: 'Document not found' }, 404)
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

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
