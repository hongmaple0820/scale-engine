// Re-export unified DashboardServer for backward compatibility
export { DashboardServer } from './DashboardServer.js'
export type { DashboardOptions, DashboardState, ArtifactTreeNode, GateSummary, DetectorStatSummary, RecentEvent, AutoDefectSummary, RecentDefect } from './DashboardServer.js'

// Legacy DashboardConfig interface (for old consumers)
export interface DashboardConfig {
  port: number
  host: string
  artifactStore: import('../artifact/store.js').IArtifactStore
  knowledgeBase: import('../knowledge/KnowledgeBase.js').IKnowledgeBase
  eventBus: import('../core/eventBus.js').IEventBus
  agentManager: import('../agents/IAgent.js').IAgentManager
  evolutionStats?: () => import('../evolution/EvolutionEngine.js').EvolutionStats
}

export interface DashboardData {
  artifacts: Array<{ id: string; type: string; status: string; title: string; createdAt: number }>
  sessions: Array<{ id: string; startedAt: number; artifacts: number }>
  knowledge: Array<{ id: string; type: string; title: string; relevance: number }>
  evolution: import('../evolution/EvolutionEngine.js').EvolutionStats
  agents: Array<{ id: string; name: string; dispatchCount: number; successRate: number }>
}
