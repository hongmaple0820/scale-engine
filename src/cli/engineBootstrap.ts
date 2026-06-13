// SCALE Engine — CLI Engine Bootstrap (shared singleton)
// All command modules import getEngine() from here instead of creating their own instances.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { EventBus } from '../core/eventBus.js'
import { SQLiteArtifactStore } from '../artifact/sqliteStore.js'
import { FSM } from '../artifact/fsm.js'
import { registerAllFSMs } from '../artifact/fsmDefinitions.js'
import { Gateway } from '../guardrails/Gateway.js'
import { BruteRetryDetector, PrematureDoneDetector, BlameShiftDetector } from '../guardrails/detectors.js'
import { DangerousCommandDetector, SecretLeakDetector, RoleGateDetector, ScopeCreepDetector } from '../guardrails/advancedDetectors.js'
import { GraphifyKnowledgeBase } from '../knowledge/GraphifyKnowledgeBase.js'
import { ContextBuilder } from '../context/ContextBuilder.js'
import { FSMAgentBridge } from '../fsm/FSMAgentBridge.js'
import { CapabilityRegistry } from '../capabilities/CapabilityRegistry.js'
import { SkillRegistry } from '../skills/SkillRegistry.js'
import { registerCoreSkills } from '../skills/coreSkills.js'
import { registerExternalSkills } from '../skills/ExternalSkills.js'
import { WorkflowEngine } from '../workflow/WorkflowEngine.js'
import { generateConfigForProfile } from '../config/profiles.js'
import { WorkflowArtifactWriter } from '../workflow/WorkflowArtifactWriter.js'
import type { GateStage } from '../workflow/types.js'
import type { GovernanceMode } from '../workflow/GovernanceTemplates.js'
import type { TddCommandEvidence } from '../workflow/TddLoop.js'

export const SCALE_DIR = process.env.SCALE_DIR ?? '.scale'
export const PROJECT_DIR = process.env.SCALE_PROJECT_DIR ?? process.cwd()
export const DB_PATH = join(SCALE_DIR, 'scale.db')

export function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function isTruthyFlag(value: unknown): boolean {
  return value === true || value === '' || value === 'true' || value === '1'
}

export function governanceModeFromScenario(scenario: string): GovernanceMode {
  if (scenario === 'critical') return 'critical'
  if (scenario === 'sandbox') return 'minimal'
  return 'standard'
}

export function profileFromScenario(scenario: string): string {
  if (scenario === 'sandbox') return 'minimal'
  if (scenario === 'critical') return 'advanced'
  return 'standard'
}

export function writeConfigYaml(projectDir: string, profileId: string, projectName: string, agents: string[]): string {
  const configPath = join(projectDir, '.scale', 'config.yaml')
  const content = generateConfigForProfile(profileId, { name: projectName, agents })
  writeFileSync(configPath, content, 'utf-8')
  return configPath
}

export function commandEvidence(command: string, exitCode: unknown, summary: unknown): TddCommandEvidence | undefined {
  if (exitCode === undefined || exitCode === null || exitCode === '') return undefined
  const parsed = Number.parseInt(String(exitCode), 10)
  if (Number.isNaN(parsed)) return undefined
  return {
    command,
    exitCode: parsed,
    outputSummary: summary ? String(summary) : `Command exited ${parsed}`,
  }
}

export type PreflightProfile = 'quick' | 'full' | 'ci' | 'fast-lane'

export function normalizePreflightProfile(value: unknown): PreflightProfile {
  const normalized = String(value ?? 'quick').trim().toLowerCase()
  if (normalized === 'fast-lane' || normalized === 'fastlane') return 'fast-lane'
  if (normalized === 'full' || normalized === 'ci') return normalized
  return 'quick'
}

export function gatesForPreflightProfile(profile: PreflightProfile): GateStage[] {
  const { preflightGateStages } = require('../workflow/GateCatalog.js')
  return preflightGateStages(profile)
}

export function resolveScaleDirForProject(projectDir: string): string {
  return isAbsolute(SCALE_DIR) ? SCALE_DIR : join(projectDir, SCALE_DIR)
}

// Engine singleton
interface Engine {
  eventBus: EventBus
  store: SQLiteArtifactStore
  fsm: FSM
  gateway: Gateway
  roleGate: RoleGateDetector
  kb: GraphifyKnowledgeBase
  ctx: ContextBuilder
  fsmAgentBridge: FSMAgentBridge
  workflowEngine: WorkflowEngine
}

let _engine: Engine | null = null

export function getEngine(): Engine {
  if (!_engine) _engine = createEngine()
  return _engine
}

function createEngine(): Engine {
  ensureDir(SCALE_DIR)
  const eventBus = new EventBus({ eventsDir: join(SCALE_DIR, 'events') })
  const store = new SQLiteArtifactStore(eventBus, {
    dbPath: DB_PATH,
    artifactsDir: join(SCALE_DIR, 'artifacts'),
  })
  const fsm = new FSM(store, eventBus)
  registerAllFSMs(fsm)

  const gateway = new Gateway(eventBus)
  const roleGate = new RoleGateDetector()

  gateway.registerDetector(new DangerousCommandDetector(), 'preTool')
  gateway.registerDetector(new SecretLeakDetector(), 'preTool')
  gateway.registerDetector(roleGate, 'preTool')
  gateway.registerDetector(new BruteRetryDetector(), 'preTool')
  gateway.registerDetector(new ScopeCreepDetector(), 'preTool')
  gateway.registerDetector(new PrematureDoneDetector(), 'beforeStop')
  gateway.registerDetector(new BlameShiftDetector(), 'postTool')

  const kb = new GraphifyKnowledgeBase(eventBus, { projectDir: PROJECT_DIR, scaleDir: SCALE_DIR })
  const ctx = new ContextBuilder(store, kb, eventBus)
  const fsmAgentBridge = new FSMAgentBridge(fsm, store)
  const capabilityRegistry = new CapabilityRegistry(eventBus)
  const skillRegistry = new SkillRegistry(eventBus)
  registerCoreSkills(skillRegistry)
  registerExternalSkills(skillRegistry, eventBus)
  const workflowEngine = new WorkflowEngine({
    eventBus,
    capabilityRegistry,
    skillRegistry,
    scaleDir: SCALE_DIR,
  })

  return { eventBus, store, fsm, gateway, roleGate, kb, ctx, fsmAgentBridge, workflowEngine }
}

export function createVerificationWorkflowEngine(scaleDir: string): WorkflowEngine {
  ensureDir(scaleDir)
  const eventBus = new EventBus({ eventsDir: join(scaleDir, 'events') })
  const capabilityRegistry = new CapabilityRegistry(eventBus)
  const skillRegistry = new SkillRegistry(eventBus)
  registerCoreSkills(skillRegistry)
  registerExternalSkills(skillRegistry, eventBus)
  return new WorkflowEngine({
    eventBus,
    capabilityRegistry,
    skillRegistry,
    scaleDir,
  })
}
