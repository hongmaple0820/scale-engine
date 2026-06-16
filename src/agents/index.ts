// SCALE Engine — Agent System
// 旧 Agent 系统 + 新 Multi-Agent 协作系统共存

// ===== 旧 Agent 系统（单个 Agent 管理）=====
export type {
  IAgentManager,
  IAgent,
  AgentDefinition,
  AgentTaskContext,
  AgentResult,
  AgentCapability,
} from './IAgent.js'

export { AGENT_MANAGER_TOKEN } from './IAgent.js'
export { AgentManager, initializeAgentManager } from './AgentManager.js'

export { PLANNER_AGENT } from './definitions/planner.js'
export { RESEARCHER_AGENT } from './definitions/researcher.js'
export { IMPLEMENTER_AGENT } from './definitions/implementer.js'
export { REVIEWER_AGENT } from './definitions/reviewer.js'
export { TESTER_AGENT } from './definitions/tester.js'
export { SECURITY_AGENT } from './definitions/security.js'
export { DEBUGGER_AGENT } from './definitions/debugger.js'
export { DOC_WRITER_AGENT } from './definitions/doc-writer.js'

import { PLANNER_AGENT } from './definitions/planner.js'
import { RESEARCHER_AGENT } from './definitions/researcher.js'
import { IMPLEMENTER_AGENT } from './definitions/implementer.js'
import { REVIEWER_AGENT } from './definitions/reviewer.js'
import { TESTER_AGENT } from './definitions/tester.js'
import { SECURITY_AGENT } from './definitions/security.js'
import { DEBUGGER_AGENT } from './definitions/debugger.js'
import { DOC_WRITER_AGENT } from './definitions/doc-writer.js'

import type { AgentDefinition } from './IAgent.js'

export const ALL_AGENTS: AgentDefinition[] = [
  PLANNER_AGENT,
  RESEARCHER_AGENT,
  IMPLEMENTER_AGENT,
  REVIEWER_AGENT,
  TESTER_AGENT,
  SECURITY_AGENT,
  DEBUGGER_AGENT,
  DOC_WRITER_AGENT,
]

import type { AgentManager } from './AgentManager.js'

export function registerAllAgents(manager: AgentManager): void {
  for (const def of ALL_AGENTS) manager.register(def)
}

// ===== 新 Multi-Agent 协作系统（团队协作）=====
export * from './types.js'
export * from './profiles.js'
export { AgentRegistry, DEFAULT_REGISTRY, type IAgentRegistry } from './AgentRegistry.js'
export { AgentPool, type IAgentPool } from './AgentPool.js'
export { AgentDispatcher, type IAgentDispatcher } from './AgentDispatcher.js'
export { AgentChannel, type IAgentChannel } from './AgentChannel.js'
export { AgentCoordinator, type IAgentCoordinator } from './AgentCoordinator.js'
export { AgentSourceLoader, type IAgentSourceLoader, type YAMLAgentDefinition, defaultAgentSourceLoader, loadAgentsFromDirectory, loadAgentFromFile, exportProfileToYAML } from './AgentSourceLoader.js'
export * from './AcpCollaboration.js'
export * from './ExternalAgentCatalog.js'
