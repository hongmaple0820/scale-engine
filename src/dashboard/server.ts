// SCALE Engine — Dashboard Server

import type { IArtifactStore } from '../artifact/store.js'
import type { IKnowledgeBase } from '../knowledge/KnowledgeBase.js'
import type { IEventBus } from '../core/eventBus.js'
import type { IAgentManager } from '../agents/IAgent.js'
import type { EvolutionStats } from '../evolution/EvolutionEngine.js'
import { logger } from '../core/logger.js'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dumpCodeGraphData } from '../codegraph/CodeIntelligence.js'
import { classifyLayers } from '../topology/LayerClassifier.js'
import { generateTour } from '../topology/TourGenerator.js'

export interface DashboardConfig {
  port: number
  host: string
  artifactStore: IArtifactStore
  knowledgeBase: IKnowledgeBase
  eventBus: IEventBus
  agentManager: IAgentManager
  evolutionStats?: () => EvolutionStats
}

export interface DashboardData {
  artifacts: Array<{ id: string; type: string; status: string; title: string; createdAt: number }>
  sessions: Array<{ id: string; startedAt: number; artifacts: number }>
  knowledge: Array<{ id: string; type: string; title: string; relevance: number }>
  evolution: EvolutionStats
  agents: Array<{ id: string; name: string; dispatchCount: number; successRate: number }>
}

export class DashboardServer {
  private server: ReturnType<typeof createServer> | null = null
  private viewsDir: string

  constructor(private config: DashboardConfig) {
    this.viewsDir = join(import.meta.dirname ?? __dirname, 'views')
  }

  start(): void {
    this.server = createServer(async (req, res) => {
      try { await this.handleRequest(req, res) }
      catch (error) { logger.error({ error }, 'Dashboard error'); res.statusCode = 500; res.end('Error') }
    })
    this.server.listen(this.config.port, this.config.host, () => {
      logger.info({ port: this.config.port }, 'Dashboard started')
    })
  }

  stop(): void { if (this.server) { this.server.close(); this.server = null } }

  private async handleRequest(req: any, res: any): Promise<void> {
    const url = req.url ?? '/'
    if (url.startsWith('/api/')) { await this.handleApi(url, res); return }
    const viewMap: Record<string, string> = {
      '/': 'artifact-flow.html', '/artifacts': 'artifact-flow.html',
      '/sessions': 'session-timeline.html', '/knowledge': 'knowledge-graph.html',
      '/evolution': 'evolution-metrics.html', '/agents': 'agent-stats.html',
      '/topology': 'topology.html',
    }
    const viewFile = viewMap[url] ?? 'artifact-flow.html'
    try {
      const content = await readFile(join(this.viewsDir, viewFile), 'utf-8')
      res.setHeader('Content-Type', 'text/html'); res.end(content)
    } catch (error) { logger.warn({ error, viewFile }, 'View file not found'); res.statusCode = 404; res.end('Not found') }
  }

  private async handleApi(url: string, res: any): Promise<void> {
    res.setHeader('Content-Type', 'application/json')
    const data = await this.collectData()
    if (url === '/api/artifacts') res.end(JSON.stringify(data.artifacts))
    else if (url === '/api/sessions') res.end(JSON.stringify(data.sessions))
    else if (url === '/api/knowledge') res.end(JSON.stringify(data.knowledge))
    else if (url === '/api/evolution') res.end(JSON.stringify(data.evolution))
    else if (url === '/api/agents') res.end(JSON.stringify(data.agents))
    else if (url === '/api/all') res.end(JSON.stringify(data))
    else if (url === '/api/topology') {
      const graph = classifyLayers(dumpCodeGraphData({ projectDir: process.cwd() }))
      res.end(JSON.stringify(graph))
    }
    else if (url === '/api/topology/tour') {
      const graph = classifyLayers(dumpCodeGraphData({ projectDir: process.cwd() }))
      const tour = generateTour(graph)
      res.end(JSON.stringify(tour))
    }
    else { res.statusCode = 404; res.end(JSON.stringify({ error: 'Not found' })) }
  }

  private async collectData(): Promise<DashboardData> {
    const artifacts = await this.config.artifactStore.query({})
    const artifactData = artifacts.map(a => ({ id: a.id, type: a.type, status: a.status, title: a.title, createdAt: a.createdAt }))
    const knowledge = await this.config.knowledgeBase.recall({})
    const knowledgeData = knowledge.map(k => ({ id: k.id, type: k.type, title: k.title, relevance: k.relevance }))
    const evolution = this.config.evolutionStats?.() ?? { lessonsExtracted: 0, rulesProposed: 0, shadowRules: 0, rulesApproved: 0, hooksGenerated: 0 }
    const agents = this.config.agentManager.listAll().map(d => ({ id: d.id, name: d.name, dispatchCount: 0, successRate: 1.0 }))
    return { artifacts: artifactData, sessions: [], knowledge: knowledgeData, evolution, agents }
  }
}
