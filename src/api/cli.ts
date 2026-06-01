#!/usr/bin/env node
// SCALE Engine — CLI 入口 (W6 完整实现)
// 所有 Hook 调用入口: session/gate/create/list/transition/context

import { defineCommand, runMain } from 'citty'
import { createInterface } from 'node:readline'
import { EventBus } from '../core/eventBus.js'
import { SQLiteArtifactStore } from '../artifact/sqliteStore.js'
import { FSM } from '../artifact/fsm.js'
import { registerAllFSMs, INITIAL_STATES } from '../artifact/fsmDefinitions.js'
import type { TaskPayload } from '../artifact/types.js'
import { Gateway } from '../guardrails/Gateway.js'
import { BruteRetryDetector, PrematureDoneDetector, BlameShiftDetector } from '../guardrails/detectors.js'
import { DangerousCommandDetector, SecretLeakDetector, RoleGateDetector, ScopeCreepDetector, BUILT_IN_ROLES } from '../guardrails/advancedDetectors.js'
import { auditDependencies } from '../guardrails/DependencyAuditor.js'
import { GraphifyKnowledgeBase } from '../knowledge/GraphifyKnowledgeBase.js'
import { ContextBuilder } from '../context/ContextBuilder.js'
import { ProjectAnatomy } from '../context/ProjectAnatomy.js'
import {
  buildContextPack,
  doctorContextBudget,
  scanContextBudget,
  writeContextBudgetReport,
} from '../context/ContextBudget.js'
import { resolvePromptCachePolicy } from '../routing/PromptCachePolicy.js'
import { CerebrumManager } from '../knowledge/CerebrumManager.js'
import {
  buildCodeGraphContext,
  createCodeGraphRoiReport,
  dumpCodeGraphData,
  impactCodeGraph,
  inspectCodeIntelligence,
  queryCodeGraph,
  writeCodeIntelligenceConfig,
} from '../codegraph/CodeIntelligence.js'
import {
  WorkflowEvalStore,
  compareWorkflowEvalRuns,
  renderWorkflowEvalReport,
  runWorkflowEvalSuite,
} from '../eval/WorkflowEval.js'
import { FSMAgentBridge, type FSMContextSnapshot } from '../fsm/FSMAgentBridge.js'
import { CapabilityRegistry } from '../capabilities/CapabilityRegistry.js'
import { SkillRegistry } from '../skills/SkillRegistry.js'
import { registerCoreSkills } from '../skills/coreSkills.js'
import { registerExternalSkills } from '../skills/ExternalSkills.js'
import { createSkillPlan, evaluateSkillGate, loadSkillRoutingPolicy, skillPlanMarkdown } from '../skills/routing/index.js'
import { createAdapter, SUPPORTED_AGENTS } from '../adapters/index.js'
import { LessonExtractor, RuleProposer, HookGenerator, EvolutionEngine } from '../evolution/EvolutionEngine.js'
import { Doctor } from './doctor.js'
import { inspectEnvironment, renderEnvironmentDoctor } from '../env/EnvironmentDoctor.js'
import { quickStart, detectPlatform, governanceNextSteps } from './quickstart.js'
import { bootstrapDependencies } from '../bootstrap/DependencyBootstrap.js'
import { renderDependencyBootstrapReport } from '../bootstrap/DependencyBootstrapRenderer.js'
import { runSetupWizard } from '../setup/SetupWizard.js'
import { verifySetup } from '../setup/SetupVerification.js'
import { normalizeLanguage, resolveCliLanguage } from '../i18n/Language.js'
import { SkillDiscovery } from '../skills/SkillDiscovery.js'
import { inspectRequiredWorkflowSkills, inspectWorkflowSkills } from '../skills/SkillDoctor.js'
import {
  evaluateSkillInstallSafety,
  listSkillRepositoryEntries,
  recommendSkillWorkflow,
  renderSkillRepositoryMarkdown,
} from '../skills/SkillRepository.js'
import {
  evaluateSkillRadar,
  inspectSkillSupplyChain,
  renderSkillRadarMarkdown,
} from '../skills/SkillRadar.js'
import { listLeadershipPresets, renderLeadershipPresetsMarkdown } from '../agents/LeadershipPresets.js'
import { listWorkflowPresets, getPresetsByScenario } from '../workflows/presets.js'
import { EvidenceStore } from '../workflow/EvidenceStore.js'
import { OutOfScopeStore } from '../workflow/OutOfScopeStore.js'
import { ReviewStore } from '../workflow/ReviewStore.js'
import { WorkflowEngine } from '../workflow/WorkflowEngine.js'
import {
  resolveVerificationTargets,
  type ResolvedVerificationTargets,
  type VerificationEngineeringStandardsGateMode,
  type VerificationPolicy,
} from '../workflow/VerificationProfile.js'
import { preflightGateStages } from '../workflow/GateCatalog.js'
import { gatesCommand } from '../cli/gateStatusCommands.js'
import { scoreCommand } from '../cli/scoreCommands.js'
import { promptCommand } from '../cli/promptCommands.js'
import { quickstartCommand } from '../cli/quickstartCommands.js'
import { tuiCommand } from '../cli/tuiCommands.js'
import { qaCommand } from '../cli/qaCommands.js'
import { autofixCommand } from '../cli/autofixCommands.js'
import { costReportCommand, costOptimizeCommand } from '../cli/costCommands.js'
import { reviewCommand as crossReviewCommand } from '../review/reviewCommands.js'
import { shieldCommand } from '../cli/shieldCommands.js'
import { orchCommand } from '../cli/orchCommands.js'
import { cortexCommand } from '../cli/cortexCommands.js'
import { writeGovernanceTemplates, type GovernanceMode } from '../workflow/GovernanceTemplates.js'
import {
  getBootstrapPlanForProfile,
  getProfile as getConfigProfile,
  generateConfigForProfile,
  listProfiles as listConfigProfiles,
} from '../config/profiles.js'
import { computeGovernanceDrift } from '../workflow/GovernanceLock.js'
import {
  applyUpgradePlan,
  createThirdPartyUpdateReport,
  createUpgradeCheckReport,
  createUpgradePlanReport,
  rollbackLatestUpgrade,
  writeUpgradePlanHtml,
} from '../workflow/UpgradeManager.js'
import { createGovernanceRoiReport } from '../governance/GovernanceRoi.js'
import { evaluateProgressiveGovernance, normalizeGovernanceMode } from '../governance/ProgressiveGovernance.js'
import {
  baselineEngineeringStandards,
  doctorEngineeringStandards,
  scanEngineeringStandards,
  settleEngineeringStandards,
  type EngineeringStandardFinding,
  type EngineeringStandardsSummary,
} from '../workflow/EngineeringStandards.js'
import { doctorResourceAssets, scanResourceAssets, settleResourceAssets } from '../workflow/ResourceGovernance.js'
import {
  analyzeContextGovernance,
  renderContextGrillPrompt,
  writeContextGovernanceTemplates,
} from '../workflow/ContextGovernance.js'
import {
  createDiagnosticLoop,
  renderDiagnosticLoopMarkdown,
  validateDiagnosticLoop,
} from '../workflow/DiagnosticLoop.js'
import { BackgroundHunter, HuntFindingStore } from '../workflow/autonomous/BackgroundHunter.js'
import {
  createTddSlice,
  evaluateTddSlice,
  renderTddSliceMarkdown,
  type TddCommandEvidence,
} from '../workflow/TddLoop.js'
import { nextWorkflowOpenTask, removeWorkflowOpenTask, toolEvidenceRunCompletesOpenTask } from '../workflow/WorkflowOpenTasks.js'
import { TaskMetricsStore } from '../workflow/TaskMetricsStore.js'
import {
  appendContextGrillArtifact,
  appendDiagnosticLoopArtifact,
  appendTddSliceArtifact,
  checkTaskArtifactCompleteness,
  type TaskArtifactLevel,
} from '../workflow/TaskArtifactScaffolder.js'
import { WorkflowArtifactWriter } from '../workflow/WorkflowArtifactWriter.js'
import { inspectToolCapabilities } from '../tools/ToolCapabilityRegistry.js'
import { evaluateToolEvidenceGate } from '../tools/ToolEvidenceGate.js'
import { ToolEvidenceStore } from '../tools/ToolEvidenceStore.js'
import { ToolOrchestrator } from '../tools/ToolOrchestrator.js'
import { loadToolPolicy, toolPolicyTemplate, type ResolvedToolPolicy, type ToolOrchestrationMode } from '../tools/ToolPolicy.js'
import { runSafeCommand } from '../tools/SafeCommandRunner.js'
import {
  doctorHtmlArtifacts,
  renderHtmlArtifact,
  resolveHtmlArtifactForOpen,
  settleHtmlArtifacts,
} from '../output/HTMLArtifactLayer.js'
import { renderGovernanceDashboard } from '../output/GovernanceDashboard.js'
import {
  cleanupWorkspaceLifecycle,
  inspectWorkspaceLifecycle,
  type WorkspaceCleanupResult,
  type WorkspaceLifecycleReport,
} from '../workflow/WorkspaceLifecycle.js'
import { inspectWorkspaceSafety } from '../workflow/WorkspaceSafety.js'
import {
  ModelUsageLedger,
  RuntimeEvidenceLedger,
  SessionLedger,
  buildModelUsageInput,
  createAiOsAdoption,
  createAiOsBenchmark,
  createAiOsDashboard,
  createAiOsDoctor,
  createAiOsMigration,
  createAiOsPlan,
  createAiOsRun,
  createAiOsStatus,
  doctorRuntimeEvidence,
  evaluateFinalReportReadiness,
  type ModelUsageInput,
  type RuntimeEvidenceKind,
  type RuntimeEvidenceStatus,
  type RuntimeSessionStatus,
} from '../runtime/index.js'
import {
  MemoryFabric,
  MemoryBrain,
  doctorMemoryFabric,
  renderContextPackMarkdown,
  renderMemoryLearningCandidateMarkdown,
  inspectMemoryProviders,
  recallMemoryProviders,
  settleMemoryLearning,
  useMemoryProvider,
  writeMemoryProvidersConfig,
} from '../memory/index.js'
import {
  resolveWorkspaceTopology,
  workspaceTopologyPath,
  workspaceTopologyTemplate,
  type WorkspaceTopologyKind,
} from '../workflow/WorkspaceTopology.js'
import type { GateResult, GateStage } from '../workflow/types.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { SCALE_ENGINE_VERSION } from '../version.js'

// ============================================================================
// Engine bootstrap (单例 + lazy init)
// ============================================================================

const SCALE_DIR = process.env.SCALE_DIR ?? '.scale'
const PROJECT_DIR = process.env.SCALE_PROJECT_DIR ?? process.cwd()
const DB_PATH = join(SCALE_DIR, 'scale.db')

function governanceModeFromScenario(scenario: string): GovernanceMode {
  if (scenario === 'critical') return 'critical'
  if (scenario === 'sandbox') return 'minimal'
  return 'standard'
}

function profileFromScenario(scenario: string): string {
  if (scenario === 'sandbox') return 'minimal'
  if (scenario === 'critical') return 'advanced'
  return 'standard'
}

function writeConfigYaml(projectDir: string, profileId: string, projectName: string, agents: string[]): string {
  const configPath = join(projectDir, '.scale', 'config.yaml')
  const content = generateConfigForProfile(profileId, { name: projectName, agents })
  writeFileSync(configPath, content, 'utf-8')
  return configPath
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === '' || value === 'true' || value === '1'
}

function commandEvidence(command: string, exitCode: unknown, summary: unknown): TddCommandEvidence | undefined {
  if (exitCode === undefined || exitCode === null || exitCode === '') return undefined
  const parsed = Number.parseInt(String(exitCode), 10)
  if (Number.isNaN(parsed)) return undefined
  return {
    command,
    exitCode: parsed,
    outputSummary: summary ? String(summary) : `Command exited ${parsed}`,
  }
}

type PreflightProfile = 'quick' | 'full' | 'ci'

function normalizePreflightProfile(value: unknown): PreflightProfile {
  const normalized = String(value ?? 'quick').trim().toLowerCase()
  if (normalized === 'full' || normalized === 'ci') return normalized
  return 'quick'
}

function gatesForPreflightProfile(profile: PreflightProfile): GateStage[] {
  return preflightGateStages(profile)
}

function shouldSkipPreflightCommandTargets(
  resolved: ResolvedVerificationTargets,
  args: Record<string, unknown>,
): boolean {
  if (!resolved.matrix) return false
  const requestedService = String(args.service ?? '').trim()
  if (requestedService && requestedService !== 'all') return false

  const hasCommandOverrides = [
    args['build-cmd'],
    args['lint-cmd'],
    args['test-cmd'],
    args['coverage-cmd'],
  ].some(value => typeof value === 'string' && value.trim().length > 0)
  if (hasCommandOverrides) return false

  const profile = resolved.matrix.profiles?.[resolved.profileName]
  const hasProfileCommands = Object.values(profile?.commands ?? {})
    .some(value => typeof value === 'string' && value.trim().length > 0)
  const hasServices = (resolved.matrix.services ?? []).length > 0
  return !hasServices && !hasProfileCommands
}

interface EngineeringStandardsGateStatus {
  mode: VerificationEngineeringStandardsGateMode
  checked: boolean
  blocked: boolean
  ok: boolean
  findings: EngineeringStandardFinding[]
  summary?: EngineeringStandardsSummary
  standardsImpactPath?: string
  changedFiles?: string[]
}

function evaluateEngineeringStandardsGate(options: {
  policy: VerificationPolicy
  projectDir?: string
  scaleDir?: string
  taskId?: string
  artifactsDir?: string
  settle?: boolean
  changedFiles?: string[]
}): EngineeringStandardsGateStatus {
  const mode = normalizeEngineeringStandardsGateMode(options.policy.engineeringStandardsGate)
  if (mode === 'off') {
    return {
      mode,
      checked: false,
      blocked: false,
      ok: true,
      findings: [],
    }
  }

  const settlement = options.settle && options.artifactsDir
    ? settleEngineeringStandards({
        projectDir: options.projectDir ?? PROJECT_DIR,
        scaleDir: options.scaleDir ?? SCALE_DIR,
        taskId: options.taskId,
        artifactsDir: options.artifactsDir,
        changedFiles: options.changedFiles,
      })
    : undefined
  const doctor = settlement?.doctor ?? doctorEngineeringStandards({
    projectDir: options.projectDir ?? PROJECT_DIR,
    scaleDir: options.scaleDir ?? SCALE_DIR,
    changedFiles: options.changedFiles,
  })

  return {
    mode,
    checked: true,
    blocked: mode === 'block' && !doctor.ok,
    ok: doctor.ok,
    findings: doctor.findings,
    summary: doctor.scan.summary,
    standardsImpactPath: settlement?.standardsImpactPath,
    changedFiles: options.changedFiles,
  }
}

function skippedEngineeringStandardsGate(reason: string, policy: VerificationPolicy): EngineeringStandardsGateStatus {
  void reason
  return {
    mode: normalizeEngineeringStandardsGateMode(policy.engineeringStandardsGate),
    checked: false,
    blocked: false,
    ok: true,
    findings: [],
  }
}

function normalizeEngineeringStandardsGateMode(value: unknown): VerificationEngineeringStandardsGateMode {
  return value === 'off' || value === 'block' ? value : 'warn'
}

let _engine: ReturnType<typeof createEngine> | null = null

function getEngine() {
  if (!_engine) _engine = createEngine()
  return _engine
}

function createEngine() {
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

  // Register all detectors (9 total)
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

function resolveScaleDirForProject(projectDir: string): string {
  return isAbsolute(SCALE_DIR) ? SCALE_DIR : join(projectDir, SCALE_DIR)
}

function createVerificationWorkflowEngine(scaleDir: string): WorkflowEngine {
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

// ============================================================================
// session commands
// ============================================================================

const sessionStart = defineCommand({
  meta: { name: 'start', description: 'Start a new session' },
  args: {
    agent: { type: 'string', default: 'claude-code' },
    'session-id': { type: 'string', required: true },
  },
  async run({ args }) {
    const { eventBus } = getEngine()
    eventBus.emit('session.started', {
      agent: args.agent,
      sessionId: args['session-id'],
      startedAt: Date.now(),
    }, { sessionId: args['session-id'] })
    console.log(JSON.stringify({ ok: true, sessionId: args['session-id'], agent: args.agent }))
  },
})

const sessionEnd = defineCommand({
  meta: { name: 'end', description: 'End current session' },
  args: {
    'session-id': { type: 'string', required: true },
  },
  async run({ args }) {
    const { eventBus } = getEngine()
    eventBus.emit('session.ended', {
      sessionId: args['session-id'],
      endedAt: Date.now(),
    }, { sessionId: args['session-id'] })
    console.log(JSON.stringify({ ok: true, sessionId: args['session-id'] }))
  },
})

const session = defineCommand({
  meta: { name: 'session', description: 'Session lifecycle' },
  subCommands: { start: sessionStart, end: sessionEnd },
})

// ============================================================================
// gate commands (Hook 入口)
// ============================================================================

const gatePreTool = defineCommand({
  meta: { name: 'pre-tool', description: 'Pre-tool gate check' },
  args: {
    tool: { type: 'positional', required: true },
    'args-json': { type: 'string', default: '{}' },
    'session-id': { type: 'string', required: true },
  },
  async run({ args }) {
    const { gateway } = getEngine()
    let toolArgs: Record<string, unknown> = {}
    try { toolArgs = JSON.parse(args['args-json']) } catch { /* empty */ }
    const decision = await gateway.preTool({
      sessionId: args['session-id'],
      tool: args.tool,
      args: toolArgs,
    })
    if (!decision.allow) {
      // 输出到 stderr 让 AI 看到原因
      process.stderr.write(decision.reason ?? 'Blocked by SCALE guardrail')
      if (decision.suggestion) process.stderr.write(`\nSuggestion: ${decision.suggestion}`)
      process.exit(2)
    }
    // 静默通过（不输出 → 不消耗 token）
  },
})

const gatePostTool = defineCommand({
  meta: { name: 'post-tool', description: 'Post-tool event recording' },
  args: {
    tool: { type: 'positional', required: true },
    'args-json': { type: 'string', default: '{}' },
    'output-json': { type: 'string', default: '' },
    'exit-code': { type: 'string', default: '0' },
    'session-id': { type: 'string', required: true },
  },
  async run({ args }) {
    const { gateway } = getEngine()
    let toolArgs: Record<string, unknown> = {}
    try { toolArgs = JSON.parse(args['args-json']) } catch { /* empty */ }
    await gateway.postTool({
      sessionId: args['session-id'],
      tool: args.tool,
      args: toolArgs,
      exitCode: parseInt(args['exit-code'], 10),
      output: args['output-json'],
    })
    // 静默（不消耗 token）
  },
})

const gateBeforeStop = defineCommand({
  meta: { name: 'before-stop', description: 'Before-stop gate check' },
  args: { 'session-id': { type: 'string', required: true } },
  async run({ args }) {
    const { gateway } = getEngine()
    const decision = await gateway.beforeStop({ sessionId: args['session-id'] })
    if (!decision.allow) {
      process.stderr.write(decision.reason ?? 'Cannot stop yet')
      if (decision.suggestion) process.stderr.write(`\nSuggestion: ${decision.suggestion}`)
      process.exit(2)
    }
  },
})

const gate = defineCommand({
  meta: { name: 'gate', description: 'Guardrail gate commands' },
  subCommands: { 'pre-tool': gatePreTool, 'post-tool': gatePostTool, 'before-stop': gateBeforeStop },
})

// ============================================================================
// meta-governance — 元治理门禁 (G9-G15)
// ============================================================================

const metaGovernance = defineCommand({
  meta: { name: 'meta-governance', description: 'Run meta-governance gates (G9-G15) — check if governance capabilities are actually used' },
  args: {
    'scale-dir': { type: 'string', default: '.scale' },
    json: { type: 'boolean', default: false, description: 'Output as JSON' },
  },
  async run({ args }) {
    const { eventBus } = getEngine()
    const { GateSystem } = await import('../workflow/gates/GateSystem.js')
    const gateSystem = new GateSystem(eventBus)
    const results = await gateSystem.executeMetaGovernance(args['scale-dir'])

    if (args.json) {
      console.log(JSON.stringify(results, null, 2))
      return
    }

    const stageNames: Record<string, string> = {
      G9: 'Knowledge Utilization',
      G10: 'Evolution Effectiveness',
      G11: 'Guardrail Effectiveness',
      G12: 'Workflow Thoroughness',
      G13: 'Multi-Agent Coordination',
      G14: 'Skill Utilization',
      G15: 'Self-Improvement',
    }

    let allPassed = true
    for (const result of results) {
      const icon = result.passed ? '✅' : '❌'
      const name = stageNames[result.gate] ?? result.gate
      console.log(`${icon} ${result.gate} ${name}`)
      if (result.evidence) {
        for (const line of result.evidence.split('\n')) {
          console.log(`   ${line}`)
        }
      }
      if (!result.passed) {
        allPassed = false
        for (const blocker of result.blockers) {
          console.log(`   ⛔ ${blocker}`)
        }
      }
      console.log()
    }

    if (!allPassed) {
      console.log('❌ Meta-governance check FAILED — some capabilities are not being effectively used')
      process.exit(1)
    } else {
      console.log('✅ All meta-governance gates passed')
    }
  },
})

// ============================================================================
// artifact CRUD
// ============================================================================

const create = defineCommand({
  meta: { name: 'create', description: 'Create an artifact' },
  args: {
    type: { type: 'positional', required: true },
    title: { type: 'positional', required: true },
    parent: { type: 'string' },
    payload: { type: 'string', default: '{}' },
  },
  async run({ args }) {
    const { store } = getEngine()
    let payload: Record<string, unknown> = {}
    try { payload = JSON.parse(args.payload) } catch { /* empty */ }
    const artifact = await store.create({
      type: args.type as never,
      title: args.title,
      payload,
      parents: args.parent ? [args.parent] : [],
      initialStatus: INITIAL_STATES[args.type as keyof typeof INITIAL_STATES] ?? 'DRAFT',
      createdBy: { kind: 'human', userId: process.env.USER ?? 'cli' },
    })
    console.log(JSON.stringify(artifact, null, 2))
  },
})

const list = defineCommand({
  meta: { name: 'list', description: 'List artifacts' },
  args: { type: { type: 'string' }, status: { type: 'string' }, limit: { type: 'string', default: '20' } },
  async run({ args }) {
    const { store } = getEngine()
    const items = await store.query({
      type: args.type as never,
      status: args.status,
      limit: parseInt(args.limit, 10),
    })
    console.log(JSON.stringify(items, null, 2))
  },
})

const show = defineCommand({
  meta: { name: 'show', description: 'Show artifact details' },
  args: { id: { type: 'positional', required: true } },
  async run({ args }) {
    const { store } = getEngine()
    const artifact = await store.get(args.id)
    if (!artifact) {
      console.error(`Artifact not found: ${args.id}`)
      process.exit(1)
    }
    console.log(JSON.stringify(artifact, null, 2))
  },
})

// ============================================================================
// suggest command — 降低用户认知负担
// ============================================================================

const suggest = defineCommand({
  meta: { name: 'suggest', description: 'Show available actions for an artifact' },
  args: {
    id: { type: 'positional', required: true },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const { store, fsm } = getEngine()
    const artifact = await store.get(args.id)
    if (!artifact) {
      console.error(`Artifact not found: ${args.id}`)
      process.exit(1)
    }

    const def = fsm.getDefinition(artifact.type)
    if (!def) {
      console.error(`No FSM registered for type: ${artifact.type}`)
      process.exit(1)
    }

    // 获取当前状态可用的 transitions
    const availableTxs = def.transitions.filter((t) => t.from === artifact.status)

    // 对每个 action 检查 guards
    const suggestions = await Promise.all(
      availableTxs.map(async (tx) => {
        const guardCheck = await fsm.canTransition(args.id, tx.action)
        return {
          action: tx.action,
          to: tx.to,
          guards: (tx.guards ?? []).map((g) => g.name),
          guardMessages: (tx.guards ?? []).map((g) => g.errorMessage),
          canExecute: guardCheck.allowed,
          blockedBy: guardCheck.blockedBy,
        }
      })
    )

    if (args.json) {
      console.log(JSON.stringify({
        id: artifact.id,
        type: artifact.type,
        currentStatus: artifact.status,
        isTerminal: def.terminal.includes(artifact.status as never),
        suggestions,
      }, null, 2))
    } else {
      // 人类友好的输出
      console.log(`\n📊 ${artifact.id} (${artifact.type})`)
      console.log(`   Current status: ${artifact.status}`)
      if (def.terminal.includes(artifact.status as never)) {
        console.log(`   ⚠️  Terminal state — no further transitions available`)
      }
      console.log('')
      console.log('Available actions:')
      console.log('──────────────────────────────────────────────────')

      if (suggestions.length === 0) {
        console.log('  No actions available from this state.')
      } else {
        for (const s of suggestions) {
          const status = s.canExecute ? '✅' : '❌'
          console.log(`  ${status} ${s.action} → ${s.to}`)
          if (s.guards.length > 0) {
            for (const g of s.guardMessages) {
              console.log(`      Guard: ${g}`)
            }
          }
          if (s.blockedBy && s.blockedBy.length > 0) {
            for (const b of s.blockedBy) {
              console.log(`      ❌ ${b.message}`)
            }
          }
        }
      }
      console.log('──────────────────────────────────────────────────')
      console.log('\nUsage: scale transition <id> <action> --reason "..."')
    }
  },
})

// ============================================================================
// create-prd command — 自动创建 Spec+Plan+Tasks 层级
// ============================================================================

const createPRD = defineCommand({
  meta: { name: 'create-prd', description: 'Create PRD hierarchy (Spec → Plan → Tasks)' },
  args: {
    title: { type: 'positional', required: true },
    specs: { type: 'string', description: 'Spec description' },
    plans: { type: 'string', description: 'Plan design' },
    tasks: { type: 'string', description: 'Task list (comma-separated)' },
    'session-id': { type: 'string', required: false },
  },
  async run({ args }) {
    const { store } = getEngine()

    // 1. 创建 Spec
    const spec = await store.create({
      type: 'Spec',
      title: args.title,
      payload: { description: args.specs ?? '', ambiguityScore: 0.3 },
      initialStatus: 'DRAFT',
      createdBy: { kind: 'human', userId: process.env.USER ?? 'cli' },
    })

    // 2. 创建 Plan
    const plan = await store.create({
      type: 'Plan',
      title: `${args.title} - Implementation Plan`,
      payload: { design: args.plans ?? '' },
      parents: [spec.id],
      initialStatus: 'DRAFT',
      createdBy: { kind: 'human', userId: process.env.USER ?? 'cli' },
    })

    // 3. 批量创建 Tasks
    const taskList = (args.tasks ?? '').split(',').map((t) => t.trim()).filter((t) => t.length > 0)
    const tasks: Array<{ id: string; title: string }> = []

    for (const taskTitle of taskList) {
      const task = await store.create({
        type: 'Task',
        title: taskTitle,
        payload: { description: taskTitle, filesInvolved: [], dependsOn: [], requiredRole: 'implementer', requiredCapabilities: [] },
        parents: [plan.id],
        initialStatus: 'TODO',
        createdBy: { kind: 'human', userId: process.env.USER ?? 'cli' },
      })
      tasks.push({ id: task.id, title: task.title })
    }

    // 输出层级树
    console.log('\n✅ PRD hierarchy created:')
    console.log(`\nSpec: ${spec.id} (DRAFT)`)
    console.log(`  └─ Plan: ${plan.id} (DRAFT)`)
    for (const task of tasks) {
      console.log(`      └─ Task: ${task.id} (TODO) - ${task.title}`)
    }
    console.log('\nNext steps:')
    console.log('  1. scale transition spec submit')
    console.log('  2. scale transition spec review')
    console.log('  3. scale transition spec approve (requires ambiguity ≤ 0.2)')
    console.log('  4. scale transition plan approve')
    console.log('  5. scale transition task-* ready (for each task)')
  },
})

// ============================================================================
// FSM transition
// ============================================================================

const transition = defineCommand({
  meta: { name: 'transition', description: 'Transition artifact state' },
  args: {
    id: { type: 'positional', required: true },
    action: { type: 'positional', required: true },
    reason: { type: 'string' },
  },
  async run({ args }) {
    const { fsm } = getEngine()
    const result = await fsm.transition(args.id, args.action, {
      actor: { kind: 'human', userId: process.env.USER ?? 'cli' },
      reason: args.reason,
    })
    console.log(JSON.stringify(result, null, 2))
    if (!result.success) process.exit(1)
  },
})

// ============================================================================
// verify-task command — 代码质量验证（防止虚假完成）
// ============================================================================

const verifyTask = defineCommand({
  meta: { name: 'verify-task', description: 'Verify task code quality (build/lint/test)' },
  args: {
    id: { type: 'positional', required: true },
    'build-cmd': { type: 'string', default: 'npm run build', description: 'Build command' },
    'lint-cmd': { type: 'string', default: 'npm run lint', description: 'Lint command' },
    'test-cmd': { type: 'string', default: 'npm test', description: 'Test command' },
    'skip-build': { type: 'boolean', default: false, description: 'Skip build check' },
    'skip-lint': { type: 'boolean', default: false, description: 'Skip lint check' },
    'skip-test': { type: 'boolean', default: false, description: 'Skip test check' },
    json: { type: 'boolean', default: false, description: 'Output as JSON' },
  },
  async run({ args }) {
    const { store, eventBus } = getEngine()
    const artifact = await store.get(args.id)
    if (!artifact || artifact.type !== 'Task') {
      console.error(`Task not found: ${args.id}`)
      process.exit(1)
    }

    const results = {
      buildStatus: 'pending' as 'pending' | 'success' | 'failed',
      buildExitCode: undefined as number | undefined,
      lintStatus: 'pending' as 'pending' | 'success' | 'failed',
      testPassed: undefined as boolean | undefined,
      testCoverage: undefined as number | undefined,
    }

    // Helper: run command and capture exit code
    const runCmd = async (cmd: string): Promise<{ exitCode: number; output: string }> => {
      try {
        const result = await runSafeCommand(cmd)
        return { exitCode: result.exitCode, output: [result.stdout, result.stderr].filter(Boolean).join('\n') }
      } catch (error) {
        return { exitCode: 1, output: error instanceof Error ? error.message : String(error) }
      }
    }

    // Run build
    if (!args['skip-build']) {
      if (!args.json) console.log('\n🔨 Running build...')
      const build = await runCmd(args['build-cmd'])
      results.buildStatus = build.exitCode === 0 ? 'success' : 'failed'
      results.buildExitCode = build.exitCode
      if (!args.json) {
        if (build.exitCode === 0) {
          console.log('   ✅ Build passed')
        } else {
          console.log('   ❌ Build failed (exit code:', build.exitCode, ')')
          console.log('   Output:', build.output.slice(0, 500))
        }
      }
    }

    // Run lint
    if (!args['skip-lint']) {
      if (!args.json) console.log('\n🔍 Running lint...')
      const lint = await runCmd(args['lint-cmd'])
      results.lintStatus = lint.exitCode === 0 ? 'success' : 'failed'
      if (!args.json) {
        if (lint.exitCode === 0) {
          console.log('   ✅ Lint passed')
        } else {
          console.log('   ❌ Lint failed (exit code:', lint.exitCode, ')')
          console.log('   Output:', lint.output.slice(0, 500))
        }
      }
    }

    // Run tests
    if (!args['skip-test']) {
      if (!args.json) console.log('\n🧪 Running tests...')
      const test = await runCmd(args['test-cmd'])
      results.testPassed = test.exitCode === 0
      // Try to extract coverage from output (Jest format)
      const coverageMatch = test.output.match(/All files[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|\s*(\d+\.?\d*)/)
      if (coverageMatch) results.testCoverage = parseFloat(coverageMatch[1])
      if (!args.json) {
        if (test.exitCode === 0) {
          console.log('   ✅ Tests passed')
          if (results.testCoverage) console.log('   Coverage:', results.testCoverage, '%')
        } else {
          console.log('   ❌ Tests failed (exit code:', test.exitCode, ')')
          console.log('   Output:', test.output.slice(0, 500))
        }
      }
    }

    // Update Task payload
    const currentPayload = artifact.payload as Record<string, unknown>
    const updated = await store.update(args.id, {
      payload: { ...currentPayload, ...results },
    })

    // Emit event
    eventBus.emit('artifact.updated', {
      artifactId: args.id,
      changes: { payload: results },
      reason: 'verify-task',
    }, { sessionId: 'cli' })

    // Output
    if (args.json) {
      console.log(JSON.stringify({ taskId: args.id, results, artifact: updated }, null, 2))
    } else {
      console.log('\n📊 Verification results:')
      console.log('──────────────────────────────────────────────────')
      console.log(`  Build:  ${results.buildStatus === 'success' ? '✅' : results.buildStatus === 'failed' ? '❌' : '⏭️'} ${results.buildStatus}`)
      if (results.buildExitCode !== undefined) console.log(`          Exit code: ${results.buildExitCode}`)
      console.log(`  Lint:   ${results.lintStatus === 'success' ? '✅' : results.lintStatus === 'failed' ? '❌' : '⏭️'} ${results.lintStatus}`)
      console.log(`  Tests:  ${results.testPassed === true ? '✅' : results.testPassed === false ? '❌' : '⏭️'} ${results.testPassed === undefined ? 'skipped' : results.testPassed ? 'passed' : 'failed'}`)
      if (results.testCoverage !== undefined) console.log(`          Coverage: ${results.testCoverage}%`)
      console.log('──────────────────────────────────────────────────')

      const allPassed = (results.buildStatus === 'success' || args['skip-build'])
        && (results.lintStatus === 'success' || args['skip-lint'])
        && (results.testPassed === true || args['skip-test'])

      if (allPassed) {
        console.log('\n✅ All checks passed! Task can now be completed.')
        console.log(`\nNext: scale transition ${args.id} complete --reason "Verified"`)
      } else {
        console.log('\n❌ Some checks failed. Fix issues before completing task.')
        process.exit(1)
      }
    }
  },
})

// ============================================================================
// role management
// ============================================================================

const roleActivate = defineCommand({
  meta: { name: 'activate', description: 'Activate a role' },
  args: { role: { type: 'positional', required: true } },
  async run({ args }) {
    const { roleGate, eventBus } = getEngine()
    const roleDef = BUILT_IN_ROLES[args.role]
    if (!roleDef) {
      console.error(`Unknown role: ${args.role}. Available: ${Object.keys(BUILT_IN_ROLES).join(', ')}`)
      process.exit(1)
    }
    roleGate.setRole(roleDef)
    eventBus.emit('role.activated', { roleId: args.role })
    console.log(JSON.stringify({ ok: true, role: roleDef }))
  },
})

const roleShow = defineCommand({
  meta: { name: 'show', description: 'Show current role' },
  args: {},
  async run() {
    const { roleGate } = getEngine()
    console.log(JSON.stringify(roleGate.getRole(), null, 2))
  },
})

const role = defineCommand({
  meta: { name: 'role', description: 'Role management' },
  subCommands: { activate: roleActivate, show: roleShow },
})

// ============================================================================
// context
// ============================================================================

const contextBuild = defineCommand({
  meta: { name: 'build', description: 'Build context for current task' },
  args: {
    'session-id': { type: 'string', required: true },
    'artifact-id': { type: 'string' },
    role: { type: 'string' },
  },
  async run({ args }) {
    const { ctx } = getEngine()
    const result = await ctx.build({
      sessionId: args['session-id'],
      roleId: args.role,
      currentArtifactId: args['artifact-id'],
    })
    console.log(JSON.stringify(result, null, 2))
  },
})

const contextStatus = defineCommand({
  meta: { name: 'status', description: 'Show session context status' },
  args: {
    'session-id': { type: 'string', required: true },
  },
  async run({ args }) {
    const { ctx, roleGate } = getEngine()
    const status = await ctx.getStatus(args['session-id'], roleGate)
    console.log(JSON.stringify(status, null, 2))
  },
})

const contextInject = defineCommand({
  meta: { name: 'inject', description: 'Inject FSM context for SessionStart hook' },
  args: {
    'session-id': { type: 'string', required: true },
  },
  async run({ args }) {
    const { eventBus, kb, fsmAgentBridge } = getEngine()

    // Get FSM context for all session artifacts
    const fsmContext = await fsmAgentBridge.getSessionContext(args['session-id'], eventBus)

    // Recall relevant lessons based on artifact types
    const artifactTypes = fsmContext.artifacts.map(a => a.artifactType)
    if (artifactTypes.length > 0) {
      const lessons = await kb.recall({ type: 'lesson', limit: 5 })
      fsmContext.recalledLessons = lessons.map(l => `${l.id}: ${l.title} (${l.tags.join(',')})`)
    }

    // Output formatted context for Agent to read
    const output = {
      sessionId: fsmContext.sessionId,
      generatedAt: fsmContext.generatedAt,
      artifacts: fsmContext.artifacts.map(a => ({
        id: a.artifactId,
        type: a.artifactType,
        status: a.currentStatus,
        allowedActions: a.allowedTransitions,
        blocked: a.blockingReasons.length > 0 ? a.blockingReasons : null,
      })),
      lessons: fsmContext.recalledLessons,
      recommendations: fsmContext.recommendations,
      // Human-readable summary
      summary: formatContextSummary(fsmContext),
    }

    console.log(JSON.stringify(output, null, 2))
  },
})

function formatContextSummary(ctx: { artifacts: FSMContextSnapshot[]; recommendations: string[] }): string {
  const lines: string[] = []

  if (ctx.artifacts.length === 0) {
    lines.push('No active artifacts for this session.')
  } else {
    lines.push(`Active artifacts: ${ctx.artifacts.length}`)
    for (const a of ctx.artifacts) {
      const blocked = a.blockingReasons.length > 0 ? ' [BLOCKED]' : ''
      lines.push(`  ${a.artifactId} (${a.artifactType}): ${a.currentStatus}${blocked}`)
    }
  }

  if (ctx.recommendations.length > 0) {
    lines.push('Recommendations:')
    for (const r of ctx.recommendations) {
      lines.push(`  ${r}`)
    }
  }

  return lines.join('\n')
}

const contextGlossary = defineCommand({
  meta: { name: 'glossary', description: 'Show project domain glossary (借鉴 mattpocock/skills CONTEXT.md)' },
  args: {
    json: { type: 'boolean', default: false, description: 'JSON output' },
  },
  run({ args }) {
    const glossaryPath = join(SCALE_DIR, 'GLOSSARY.md')
    if (!existsSync(glossaryPath)) {
      if (args.json) console.log(JSON.stringify({ ok: false, message: 'GLOSSARY.md not found in SCALE_DIR. Run scale init to generate it.' }))
      else console.log('GLOSSARY.md not found. Run scale init to generate it.')
      return
    }
    const content = readFileSync(glossaryPath, 'utf-8')
    // Parse terms: **Term**: definition
    const termMatch = /\*\*(\w[^*]+)\*\*\s*:\s*(.+)/g
    const terms: Record<string, string> = {}
    let m: RegExpExecArray | null
    while ((m = termMatch.exec(content)) !== null) {
      terms[m[1].trim()] = m[2].trim().replace(/_Avoid_/, 'Avoid:')
    }
    // Parse relationships
    const relSection = content.split('## Relationships')[1]?.split('## ')[0] ?? ''
    const relationships = relSection.split('\n').filter((l: string) => l.trim().startsWith('- ')).map((l: string) => l.replace(/^- /, '').trim())

    if (args.json) {
      console.log(JSON.stringify({ ok: true, terms, relationships, count: Object.keys(terms).length }))
    } else {
      console.log('=== SCALE Engine Domain Glossary ===\n')
      console.log(`Terms (${Object.keys(terms).length}):\n`)
      for (const [term, def] of Object.entries(terms)) {
        console.log(`  **${term}**: ${def}`)
      }
      if (relationships.length > 0) {
        console.log(`\nRelationships (${relationships.length}):`)
        for (const rel of relationships) {
          console.log(`  - ${rel}`)
        }
      }
    }
  },
})

const contextInit = defineCommand({
  meta: { name: 'init', description: 'Create CONTEXT.md and CONTEXT-MAP.md starter templates' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    name: { type: 'string', description: 'Project display name' },
    force: { type: 'boolean', default: false, description: 'Overwrite existing templates' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const result = writeContextGovernanceTemplates({
      projectDir: resolve(String(args.dir ?? PROJECT_DIR)),
      projectName: args.name ? String(args.name) : undefined,
      force: isTruthyFlag(args.force),
    })
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log('\nSCALE Context Templates')
    for (const file of result.created) console.log(`  [CREATED] ${file}`)
    for (const file of result.skipped) console.log(`  [SKIPPED] ${file}`)
  },
})

const contextGrill = defineCommand({
  meta: { name: 'grill', description: 'Check project context docs and generate request-specific grill questions' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'task-id': { type: 'string', description: 'Task id for workflow state and artifact linkage' },
    task: { type: 'string', required: true, description: 'Task or requirement description' },
    files: { type: 'string', description: 'Comma-separated changed or target files' },
    'artifact-dir': { type: 'string', description: 'Task artifact directory where explore.md should be updated' },
    write: { type: 'boolean', default: false, description: 'Append context grill output to the task explore artifact' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const taskId = String(args['task-id'] ?? `context-${Date.now()}`)
    const changedFiles = parseCommaList(args.files)
    const report = analyzeContextGovernance({
      projectDir,
      request: String(args.task ?? ''),
      changedFiles,
    })
    const artifactPath = isTruthyFlag(args.write)
      ? appendContextGrillArtifact({
          projectDir,
          artifactsDir: args['artifact-dir'] ? String(args['artifact-dir']) : undefined,
          report,
        }) ?? undefined
      : undefined
    if (args['task-id'] || artifactPath) {
      const writer = new WorkflowArtifactWriter(SCALE_DIR)
      const current = writer.readCurrentState()
      const currentOpenTasks = current?.taskId === taskId ? current.openTasks : []
      writer.updateCurrentState({
        taskId,
        phase: 'explore',
        artifactsDir: args['artifact-dir'] ? String(args['artifact-dir']).replace(/\\/g, '/') : undefined,
        exploredFiles: changedFiles,
        fileCount: changedFiles.length,
        mainContradiction: report.findings[0]?.message ?? 'context governance ready',
        openTasks: removeWorkflowOpenTask(currentOpenTasks, 'context-grill'),
      })
    }
    if (args.json) {
      console.log(JSON.stringify({ ...report, artifactPath }, null, 2))
      return
    }
    console.log(renderContextGrillPrompt(report))
    if (artifactPath) console.log(`\nArtifact: ${artifactPath}`)
  },
})

function parsePositiveIntArg(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number.parseInt(String(value), 10)
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return parsed
}

const contextBudget = defineCommand({
  meta: { name: 'budget', description: 'Report Always/on-demand/evidence/archive/generated context token cost' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'max-always': { type: 'string', description: 'Maximum Always-loaded estimated tokens' },
    'max-task': { type: 'string', description: 'Maximum task context estimated tokens' },
    provider: { type: 'string', default: 'generic', description: 'Model provider for prompt cache policy: anthropic, openai, or generic' },
    write: { type: 'boolean', default: false, description: 'Write .scale/context-budget.json' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const report = scanContextBudget({
      projectDir,
      scaleDir,
      maxAlwaysTokens: parsePositiveIntArg(args['max-always'], '--max-always'),
      maxTaskTokens: parsePositiveIntArg(args['max-task'], '--max-task'),
    })
    const promptCache = resolvePromptCachePolicy({
      provider: String(args.provider ?? 'generic'),
      entries: report.entries,
    })
    const path = isTruthyFlag(args.write) ? writeContextBudgetReport(report) : undefined
    if (args.json) {
      console.log(JSON.stringify({ ...report, promptCache, path }, null, 2))
      return
    }
    console.log('SCALE Context Budget')
    console.log(`  Project: ${report.projectDir}`)
    console.log(`  Total: ${report.summary.totalTokens} estimated tokens across ${report.summary.totalFiles} files`)
    console.log(`  Always: ${report.summary.alwaysTokens}/${report.thresholds.maxAlwaysTokens}`)
    for (const [category, summary] of Object.entries(report.summary.byCategory)) {
      console.log(`  ${category}: ${summary.tokens} tokens in ${summary.files} files`)
    }
    console.log(`  Prompt cache provider: ${promptCache.provider}`)
    console.log(`  Prompt cache strategy: ${promptCache.strategy}${promptCache.supported ? '' : ' (usage ledger only)'}`)
    console.log(`  Cache eligible: ${promptCache.cacheEligibleTokens} tokens across ${promptCache.cacheEligiblePaths.length} paths`)
    for (const recommendation of report.recommendations) console.log(`  recommendation: ${recommendation}`)
    if (path) console.log(`  wrote: ${path}`)
  },
})

const contextPack = defineCommand({
  meta: { name: 'pack', description: 'Build a lazy-loaded context pack for a task' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    task: { type: 'string', required: true, description: 'Current task or question' },
    'task-id': { type: 'string', description: 'Task id' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    files: { type: 'string', description: 'Comma-separated files or modules in scope' },
    budget: { type: 'string', description: 'Maximum estimated tokens for the context pack' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const pack = buildContextPack({
      projectDir,
      scaleDir,
      task: String(args.task),
      taskId: args['task-id'] ? String(args['task-id']) : undefined,
      level: String(args.level ?? 'M'),
      files: parseCommaList(args.files),
      budget: parsePositiveIntArg(args.budget, '--budget'),
    })
    if (args.json) {
      console.log(JSON.stringify(pack, null, 2))
      return
    }
    console.log('SCALE Context Pack')
    console.log(`  Task: ${pack.task.task}`)
    console.log(`  Budget: ${pack.totalEstimatedTokens}/${pack.task.budget}`)
    for (const section of pack.sections) {
      console.log(`  [${section.included ? 'IN' : 'OUT'}] ${section.id}: ${section.estimatedTokens} tokens`)
    }
  },
})

const contextDoctor = defineCommand({
  meta: { name: 'doctor', description: 'Check context budget thresholds and generated-artifact loading risk' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'max-always': { type: 'string', description: 'Maximum Always-loaded estimated tokens' },
    'max-task': { type: 'string', description: 'Maximum task context estimated tokens' },
    task: { type: 'string', description: 'Task text for a representative lazy context pack probe' },
    level: { type: 'string', default: 'M', description: 'Task level for the context pack probe' },
    files: { type: 'string', description: 'Comma-separated scoped files for the context pack probe' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const report = doctorContextBudget({
      projectDir,
      scaleDir,
      maxAlwaysTokens: parsePositiveIntArg(args['max-always'], '--max-always'),
      maxTaskTokens: parsePositiveIntArg(args['max-task'], '--max-task'),
      task: args.task ? String(args.task) : undefined,
      level: String(args.level ?? 'M'),
      files: parseCommaList(args.files),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log(`SCALE Context Doctor: ${report.ok ? 'OK' : 'FAILED'}`)
    for (const check of report.checks) {
      console.log(`  [${check.status.toUpperCase()}] ${check.name}: ${check.message}`)
    }
    if (!report.ok) process.exitCode = 1
  },
})

const contextAnatomy = defineCommand({
  meta: { name: 'anatomy', description: 'Scan the project and generate .scale/anatomy.md for file-map context' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'max-files': { type: 'string', description: 'Maximum files to include; defaults to 500' },
    exclude: { type: 'string', description: 'Comma-separated directory names to exclude' },
    write: { type: 'boolean', default: false, description: 'Write .scale/anatomy.md' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const maxFiles = parsePositiveIntArg(args['max-files'], '--max-files')
    const excludePatterns = parseCommaList(args.exclude)
    const anatomy = new ProjectAnatomy()
    const sections = anatomy.scan(projectDir, {
      maxFiles,
      excludePatterns: excludePatterns.length > 0 ? excludePatterns : undefined,
    })
    const content = anatomy.serialize(sections)
    const summary = [...sections.values()].reduce(
      (acc, entries) => {
        acc.files += entries.length
        acc.tokens += entries.reduce((sum, entry) => sum + entry.tokens, 0)
        return acc
      },
      { files: 0, tokens: 0 },
    )
    const outputPath = join(scaleDir, 'anatomy.md')
    if (isTruthyFlag(args.write)) {
      ensureDir(scaleDir)
      writeFileSync(outputPath, content, 'utf-8')
    }
    if (args.json) {
      console.log(JSON.stringify({
        ok: true,
        projectDir,
        outputPath: isTruthyFlag(args.write) ? outputPath : undefined,
        summary,
      }, null, 2))
      return
    }
    console.log('SCALE Project Anatomy')
    console.log(`  Files: ${summary.files}`)
    console.log(`  Estimated tokens: ${summary.tokens}`)
    if (isTruthyFlag(args.write)) console.log(`  Wrote: ${outputPath}`)
  },
})


const context = defineCommand({
  meta: { name: 'context', description: 'Context assembly' },
  subCommands: { build: contextBuild, status: contextStatus, inject: contextInject, glossary: contextGlossary, init: contextInit, grill: contextGrill, budget: contextBudget, pack: contextPack, doctor: contextDoctor, anatomy: contextAnatomy },
})

// ============================================================================
// codegraph command - Adapter-first code intelligence
// ============================================================================

const codegraphStatus = defineCommand({
  meta: { name: 'status', description: 'Inspect CodeGraph, Graphify, and fallback code intelligence providers' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const report = inspectCodeIntelligence({
      projectDir,
      scaleDir,
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log('SCALE Code Intelligence Status')
    console.log(`  Config: ${report.configPath} (${report.configExists ? 'found' : 'default'})`)
    console.log(`  Project index: ${report.projectIndexExists ? report.projectIndexPath : `${report.projectIndexPath} (not initialized)`}`)
    for (const provider of report.providers) {
      console.log(`  [${provider.available ? 'AVAILABLE' : 'UNAVAILABLE'}] ${provider.id} (${provider.type}): ${provider.reason}`)
      if (provider.source) console.log(`    source: ${provider.source}`)
      if (!provider.available && provider.installHint) console.log(`    install: ${provider.installHint}`)
      if (provider.available && provider.projectInitHint && provider.id === 'codegraph' && !report.projectIndexExists) {
        console.log(`    init: ${provider.projectInitHint}`)
      }
      if (provider.serveCommand) console.log(`    mcp: ${provider.serveCommand}`)
    }
    console.log(`  Fallback: ${report.fallback.available ? 'available' : 'disabled'} (${report.fallback.tools.join(', ')})`)
    for (const recommendation of report.recommendations) console.log(`  recommendation: ${recommendation}`)
  },
})

const codegraphInit = defineCommand({
  meta: { name: 'init', description: 'Create .scale/code-intelligence.json provider configuration' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    force: { type: 'boolean', default: false, description: 'Overwrite existing configuration' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const result = writeCodeIntelligenceConfig({
      projectDir,
      scaleDir,
      force: isTruthyFlag(args.force),
    })
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log(`SCALE Code Intelligence Config: ${result.written ? 'written' : 'exists'}`)
    console.log(`  ${result.path}`)
  },
})

const codegraphQuery = defineCommand({
  meta: { name: 'query', description: 'Query code intelligence providers, with explicit fallback when graph data is unavailable' },
  args: {
    query: { type: 'positional', required: true, description: 'Symbol, function, class, route, or text query' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const report = queryCodeGraph({
      projectDir,
      scaleDir,
      query: String(args.query),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    printCodeGraphReport(report)
  },
})

const codegraphImpact = defineCommand({
  meta: { name: 'impact', description: 'Find likely impacted files for a symbol' },
  args: {
    symbol: { type: 'string', required: true, description: 'Symbol to analyze' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const report = impactCodeGraph({
      projectDir,
      scaleDir,
      symbol: String(args.symbol),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    printCodeGraphReport(report)
  },
})

const codegraphContext = defineCommand({
  meta: { name: 'context', description: 'Build a budgeted file context recommendation from code intelligence' },
  args: {
    symbol: { type: 'string', required: true, description: 'Symbol to analyze' },
    budget: { type: 'string', description: 'Maximum estimated tokens for recommended files' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const report = buildCodeGraphContext({
      projectDir,
      scaleDir,
      symbol: String(args.symbol),
      budget: parsePositiveIntArg(args.budget, '--budget'),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    printCodeGraphReport(report)
    console.log(`  Context budget: ${report.totalEstimatedTokens}/${report.budget}`)
    for (const file of report.contextFiles) {
      console.log(`  [${file.included ? 'IN' : 'OUT'}] ${file.path}: ${file.estimatedTokens} tokens`)
    }
  },
})

const codegraphRoi = defineCommand({
  meta: { name: 'roi', description: 'Estimate exploration ROI from code intelligence or fallback query results' },
  args: {
    query: { type: 'string', description: 'Text query' },
    symbol: { type: 'string', description: 'Symbol to analyze' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    if (!args.query && !args.symbol) throw new Error('Provide --query or --symbol.')
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const report = createCodeGraphRoiReport({
      projectDir,
      scaleDir,
      query: args.query ? String(args.query) : undefined,
      symbol: args.symbol ? String(args.symbol) : undefined,
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log('SCALE Code Intelligence ROI')
    console.log(`  Query: ${report.query}`)
    console.log(`  Provider: ${report.provider ?? 'fallback'}`)
    console.log(`  Fallback: ${report.fallbackUsed}`)
    console.log(`  Graph hits: ${report.metrics.graphHits}`)
    console.log(`  Reads saved: ${report.metrics.fileReadsSaved}`)
    console.log(`  Recommendation: ${report.recommendation}`)
  },
})

function printCodeGraphReport(report: {
  mode: string
  query: string
  provider?: string
  fallbackUsed: boolean
  confidence: number
  files: string[]
  hits: Array<{ file: string; line?: number; symbol?: string; reason: string }>
  roi: { fileReadsSaved: number; toolCallsSaved: number }
  warnings: string[]
}) {
  console.log('SCALE Code Intelligence')
  console.log(`  Mode: ${report.mode}`)
  console.log(`  Query: ${report.query}`)
  console.log(`  Provider: ${report.provider ?? 'fallback'}`)
  console.log(`  Fallback used: ${report.fallbackUsed}`)
  console.log(`  Confidence: ${report.confidence}`)
  console.log(`  Files: ${report.files.length}`)
  console.log(`  Estimated reads saved: ${report.roi.fileReadsSaved}`)
  for (const hit of report.hits.slice(0, 12)) {
    const line = hit.line ? `:${hit.line}` : ''
    const symbol = hit.symbol ? ` ${hit.symbol}` : ''
    console.log(`  - ${hit.file}${line}${symbol} (${hit.reason})`)
  }
  for (const warning of report.warnings) console.log(`  warning: ${warning}`)
}

const codegraphDump = defineCommand({
  meta: { name: 'dump', description: 'Dump full topology graph (nodes + edges) for visualization' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    out: { type: 'string', description: 'Output file path (default: stdout as JSON)' },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const graph = dumpCodeGraphData({ projectDir, scaleDir })
    const json = JSON.stringify(graph, null, 2)
    const outPath = args.out ? resolve(String(args.out)) : undefined
    if (outPath) {
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, json, 'utf-8')
      console.log(`Topology written to ${outPath} (${graph.nodes.length} nodes, ${graph.edges.length} edges)`)
    } else {
      console.log(json)
    }
  },
})

const codegraph = defineCommand({
  meta: { name: 'codegraph', description: 'Adapter-first code intelligence and exploration ROI' },
  subCommands: { status: codegraphStatus, init: codegraphInit, query: codegraphQuery, impact: codegraphImpact, context: codegraphContext, roi: codegraphRoi, dump: codegraphDump },
})

// ============================================================================
// eval command - Workflow eval baseline and failure replay
// ============================================================================

const evalInit = defineCommand({
  meta: { name: 'init', description: 'Create a lightweight workflow eval suite under .scale/evals' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    suite: { type: 'string', default: 'workflow-baseline', description: 'Suite id' },
    force: { type: 'boolean', default: false, description: 'Overwrite the existing suite file' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const store = new WorkflowEvalStore({
      projectDir,
      scaleDir,
    })
    const result = store.initSuite(String(args.suite ?? 'workflow-baseline'), isTruthyFlag(args.force))
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log(`SCALE Workflow Eval Suite: ${result.written ? 'written' : 'exists'}`)
    console.log(`  Suite: ${result.suite.id}`)
    console.log(`  Path: ${result.path}`)
    console.log(`  Cases: ${result.suite.cases.length}`)
  },
})

const evalRun = defineCommand({
  meta: { name: 'run', description: 'Run a workflow eval suite and preserve failure replay artifacts' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    suite: { type: 'string', default: 'workflow-baseline', description: 'Suite id or JSON path' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const result = await runWorkflowEvalSuite({
      projectDir,
      scaleDir,
      suite: String(args.suite ?? 'workflow-baseline'),
    })
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      if (!result.run.ok) process.exitCode = 1
      return
    }
    console.log(`SCALE Workflow Eval: ${result.run.ok ? 'PASS' : 'FAIL'}`)
    console.log(`  Run: ${result.run.id}`)
    console.log(`  Suite: ${result.run.suiteId}`)
    console.log(`  Pass@1: ${(result.run.metrics.passAt1Rate * 100).toFixed(1)}%`)
    console.log(`  Pass@3: ${(result.run.metrics.passAt3Rate * 100).toFixed(1)}%`)
    console.log(`  Tool calls: ${result.run.metrics.totalToolCalls}`)
    console.log(`  Estimated tokens: ${result.run.metrics.estimatedTokens}`)
    console.log(`  Failures: ${result.run.metrics.failureReplayCount}`)
    console.log(`  Run path: ${result.runPath}`)
    for (const failurePath of result.failurePaths) console.log(`  Failure replay: ${failurePath}`)
    if (!result.run.ok) process.exitCode = 1
  },
})

const evalCompare = defineCommand({
  meta: { name: 'compare', description: 'Compare two workflow eval runs by pass rate, iterations, tool calls, and token estimate' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    baseline: { type: 'string', required: true, description: 'Baseline run id or JSON path' },
    candidate: { type: 'string', required: true, description: 'Candidate run id or JSON path' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const comparison = compareWorkflowEvalRuns({
      projectDir,
      scaleDir,
      baseline: String(args.baseline),
      candidate: String(args.candidate),
    })
    if (args.json) {
      console.log(JSON.stringify(comparison, null, 2))
      return
    }
    console.log(`SCALE Workflow Eval Compare: ${comparison.recommendation}`)
    console.log(`  Baseline: ${comparison.baseline.id}`)
    console.log(`  Candidate: ${comparison.candidate.id}`)
    console.log(`  Delta Pass@1: ${(comparison.delta.passAt1Rate * 100).toFixed(1)}%`)
    console.log(`  Delta Pass@3: ${(comparison.delta.passAt3Rate * 100).toFixed(1)}%`)
    console.log(`  Delta fix iterations: ${comparison.delta.averageFixIterations.toFixed(2)}`)
    console.log(`  Delta tool calls: ${comparison.delta.totalToolCalls}`)
    console.log(`  Delta estimated tokens: ${comparison.delta.estimatedTokens}`)
    console.log(`  Delta human corrections: ${comparison.delta.humanCorrections}`)
  },
})

const evalReport = defineCommand({
  meta: { name: 'report', description: 'Render a Markdown workflow eval report from a saved run' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    run: { type: 'string', required: true, description: 'Run id or JSON path' },
    output: { type: 'string', alias: 'o', description: 'Write report to a Markdown file' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const store = new WorkflowEvalStore({ projectDir, scaleDir })
    const run = store.loadRun(String(args.run))
    const markdown = renderWorkflowEvalReport(run)
    const outputPath = args.output ? resolve(projectDir, String(args.output)) : undefined
    if (outputPath) {
      mkdirSync(dirname(outputPath), { recursive: true })
      writeFileSync(outputPath, markdown, 'utf-8')
    }
    if (args.json) {
      console.log(JSON.stringify({ runId: run.id, outputPath, markdown }, null, 2))
      return
    }
    if (outputPath) console.log(`Workflow eval report written: ${outputPath}`)
    else console.log(markdown)
  },
})

const evalFailures = defineCommand({
  meta: { name: 'failures', description: 'List failure replay records for workflow improvement' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'task-id': { type: 'string', description: 'Filter by task/case id' },
    since: { type: 'string', default: '30d', description: 'Window such as 30d; use all for no date filter' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const store = new WorkflowEvalStore({
      projectDir,
      scaleDir,
    })
    const failures = store.listFailures({
      taskId: args['task-id'] ? String(args['task-id']) : undefined,
      sinceDays: parseSinceDays(args.since),
    })
    if (args.json) {
      console.log(JSON.stringify({ count: failures.length, failures }, null, 2))
      return
    }
    console.log(`SCALE Failure Replays: ${failures.length}`)
    for (const failure of failures) {
      console.log(`  [${failure.status}] ${failure.id} ${failure.category} task=${failure.taskId}`)
      console.log(`    prevention: ${failure.prevention}`)
    }
  },
})

const evalReplay = defineCommand({
  meta: { name: 'replay', description: 'Show failure replay records by failure id or task id' },
  args: {
    id: { type: 'positional', description: 'Failure replay id' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'task-id': { type: 'string', description: 'Task/case id to replay' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const store = new WorkflowEvalStore({
      projectDir,
      scaleDir,
    })
    const failures = args.id
      ? [store.getFailure(String(args.id))].filter(Boolean)
      : store.listFailures({ taskId: args['task-id'] ? String(args['task-id']) : undefined })
    if (args.json) {
      console.log(JSON.stringify({ count: failures.length, failures }, null, 2))
      if (failures.length === 0) process.exitCode = 1
      return
    }
    if (failures.length === 0) {
      console.log('No failure replay records found.')
      process.exitCode = 1
      return
    }
    for (const failure of failures) {
      if (!failure) continue
      console.log(`Failure Replay: ${failure.id}`)
      console.log(`  Task: ${failure.task}`)
      console.log(`  Category: ${failure.category}`)
      console.log(`  Phase: ${failure.phase}`)
      console.log(`  Wrong turn: ${failure.wrongTurn}`)
      console.log(`  Evidence: ${failure.evidence}`)
      console.log(`  Correction: ${failure.correction}`)
      console.log(`  Prevention: ${failure.prevention}`)
      if (failure.replayCommand) console.log(`  Replay command: ${failure.replayCommand}`)
    }
  },
})

const evalPromoteFailure = defineCommand({
  meta: { name: 'promote-failure', description: 'Promote a failure replay into a workflow improvement candidate' },
  args: {
    id: { type: 'positional', required: true, description: 'Failure replay id' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const store = new WorkflowEvalStore({
      projectDir,
      scaleDir,
    })
    const candidate = store.promoteFailure(String(args.id))
    if (args.json) {
      console.log(JSON.stringify(candidate, null, 2))
      return
    }
    console.log(`Workflow improvement candidate: ${candidate.id}`)
    console.log(`  Failure: ${candidate.failureId}`)
    console.log(`  Category: ${candidate.category}`)
    console.log(`  Recommendation: ${candidate.recommendation}`)
  },
})

function parseSinceDays(value: unknown): number | undefined {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text || text === 'all') return undefined
  const match = text.match(/^(\d+)(d|day|days)?$/)
  if (!match) return undefined
  const days = Number.parseInt(match[1], 10)
  return Number.isFinite(days) && days > 0 ? days : undefined
}

const evalCommand = defineCommand({
  meta: { name: 'eval', description: 'Workflow eval harness, pass@k metrics, and failure replay' },
  subCommands: {
    init: evalInit,
    run: evalRun,
    compare: evalCompare,
    report: evalReport,
    failures: evalFailures,
    replay: evalReplay,
    'promote-failure': evalPromoteFailure,
  },
})

// ============================================================================
// diagnose command - evidence-first debugging loop
// ============================================================================

const diagnosePlanCommand = defineCommand({
  meta: { name: 'plan', description: 'Create a reproducible diagnostic loop before fixing a bug' },
  args: {
    'task-id': { type: 'string', required: true },
    symptom: { type: 'string', required: true },
    repro: { type: 'string', description: 'Command that reproduces the current failure' },
    'expected-failure': { type: 'string', description: 'Expected failing behavior or assertion' },
    files: { type: 'string', description: 'Comma-separated changed or suspicious files' },
    verify: { type: 'string', description: 'Comma-separated verification commands after the fix' },
    'artifact-dir': { type: 'string', description: 'Task artifact directory where plan.md should be updated' },
    write: { type: 'boolean', default: false, description: 'Append diagnostic loop output to the task plan artifact' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const changedFiles = parseCommaList(args.files)
    const loop = createDiagnosticLoop({
      taskId: String(args['task-id']),
      symptom: String(args.symptom),
      reproductionCommand: args.repro ? String(args.repro) : undefined,
      expectedFailure: args['expected-failure'] ? String(args['expected-failure']) : undefined,
      changedFiles,
      verificationCommands: parseCommaList(args.verify),
    })
    const validation = validateDiagnosticLoop(loop)
    const artifactPath = isTruthyFlag(args.write)
      ? appendDiagnosticLoopArtifact({
          projectDir: PROJECT_DIR,
          artifactsDir: args['artifact-dir'] ? String(args['artifact-dir']) : undefined,
          loop,
          validation,
        }) ?? undefined
      : undefined
    if (artifactPath || args['artifact-dir']) {
      const writer = new WorkflowArtifactWriter(SCALE_DIR)
      const current = writer.readCurrentState()
      const currentOpenTasks = current?.taskId === loop.taskId ? current.openTasks : []
      writer.updateCurrentState({
        taskId: loop.taskId,
        phase: 'plan',
        artifactsDir: args['artifact-dir'] ? String(args['artifact-dir']).replace(/\\/g, '/') : undefined,
        filesModified: changedFiles,
        openTasks: validation.ready
          ? removeWorkflowOpenTask(currentOpenTasks.filter(task => task.trim().startsWith('scale ')), 'diagnostic-loop')
          : uniqueStrings([
              ...currentOpenTasks,
              ...validation.blockers,
            ]),
      })
    }
    if (args.json) {
      console.log(JSON.stringify({ loop, validation, artifactPath }, null, 2))
      return
    }
    console.log(renderDiagnosticLoopMarkdown(loop))
    if (!validation.ready) {
      console.log('\nBlockers:')
      for (const blocker of validation.blockers) console.log(`  - ${blocker}`)
    }
    if (artifactPath) console.log(`\nArtifact: ${artifactPath}`)
  },
})

const diagnose = defineCommand({
  meta: { name: 'diagnose', description: 'Evidence-first debugging workflows' },
  subCommands: { plan: diagnosePlanCommand },
})

// ============================================================================
// hunt command - readonly proactive governance scan
// ============================================================================

function createBackgroundHunter(args: { dir?: string }): BackgroundHunter {
  return new BackgroundHunter({ projectDir: args.dir ? String(args.dir) : PROJECT_DIR })
}

const huntScanCommand = defineCommand({
  meta: { name: 'scan', description: 'Run a readonly proactive governance scan' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    changed: { type: 'boolean', default: false, description: 'Scan changed Git files only' },
    'changed-files': { type: 'string', description: 'Comma or newline separated file list to scan' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const report = createBackgroundHunter(args).scan({
      changedFiles: resolveChangedFilesArg(args),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    printHuntReport(report)
  },
})

const huntReportCommand = defineCommand({
  meta: { name: 'report', description: 'Print open and ignored hunt findings' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    changed: { type: 'boolean', default: false, description: 'Scan changed Git files only' },
    'changed-files': { type: 'string', description: 'Comma or newline separated file list to scan' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const report = createBackgroundHunter(args).scan({
      changedFiles: resolveChangedFilesArg(args),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    printHuntReport(report)
  },
})

const huntDiagnoseCommand = defineCommand({
  meta: { name: 'diagnose', description: 'Create a diagnostic loop from a hunt finding' },
  args: {
    id: { type: 'positional', required: true, description: 'Hunt finding id' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    changed: { type: 'boolean', default: false, description: 'Scan changed Git files only' },
    'changed-files': { type: 'string', description: 'Comma or newline separated file list to scan' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const report = createBackgroundHunter(args).scan({
      changedFiles: resolveChangedFilesArg(args),
    })
    const finding = report.findings.find(item => item.id === String(args.id))
    if (!finding) {
      console.error(`Hunt finding not found: ${String(args.id)}`)
      process.exitCode = 1
      return
    }
    const loop = createDiagnosticLoop(finding.diagnosticInput)
    const validation = validateDiagnosticLoop(loop)
    if (args.json) {
      console.log(JSON.stringify({ finding, loop, validation }, null, 2))
      return
    }
    console.log(renderDiagnosticLoopMarkdown(loop))
    if (!validation.ready) {
      console.log('\nBlockers:')
      for (const blocker of validation.blockers) console.log(`  - ${blocker}`)
    }
  },
})

const huntIgnoreCommand = defineCommand({
  meta: { name: 'ignore', description: 'Ignore a stable hunt finding fingerprint' },
  args: {
    id: { type: 'positional', required: true, description: 'Hunt finding id' },
    reason: { type: 'string', description: 'Why this finding is accepted or deferred' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    changed: { type: 'boolean', default: false, description: 'Scan changed Git files only' },
    'changed-files': { type: 'string', description: 'Comma or newline separated file list to scan' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = args.dir ? String(args.dir) : PROJECT_DIR
    const report = new BackgroundHunter({ projectDir }).scan({
      changedFiles: resolveChangedFilesArg(args),
    })
    const finding = report.findings.find(item => item.id === String(args.id))
    if (!finding) {
      console.error(`Hunt finding not found: ${String(args.id)}`)
      process.exitCode = 1
      return
    }
    const ignored = new HuntFindingStore({ projectDir }).ignore({
      id: finding.id,
      fingerprint: finding.fingerprint,
      reason: args.reason ? String(args.reason) : undefined,
      ignoredAt: new Date().toISOString(),
    })
    if (args.json) {
      console.log(JSON.stringify({ ignored }, null, 2))
      return
    }
    console.log(`Ignored hunt finding: ${ignored.id}`)
    if (ignored.reason) console.log(`  Reason: ${ignored.reason}`)
  },
})

const hunt = defineCommand({
  meta: { name: 'hunt', description: 'Readonly proactive governance scans' },
  subCommands: {
    scan: huntScanCommand,
    report: huntReportCommand,
    diagnose: huntDiagnoseCommand,
    ignore: huntIgnoreCommand,
  },
})

function printHuntReport(report: ReturnType<BackgroundHunter['scan']>): void {
  console.log('SCALE Hunt Report')
  console.log(`  Project: ${report.projectDir}`)
  console.log(`  Open findings: ${report.summary.open}`)
  console.log(`  Ignored findings: ${report.summary.ignored}`)
  console.log(`  Blocking findings: ${report.summary.blocking}`)
  for (const finding of report.findings.slice(0, 20)) {
    const line = finding.line ? `:${finding.line}` : ''
    const status = finding.status === 'ignored' ? 'IGNORED' : finding.severity.toUpperCase()
    console.log(`  [${status}] ${finding.id} ${finding.ruleId} ${finding.path ?? 'project'}${line}: ${finding.message}`)
  }
  if (report.findings.length > 20) console.log(`  ... ${report.findings.length - 20} more finding(s)`)
}

// ============================================================================
// dependency command - supply-chain security audit
// ============================================================================

const dependencyAuditCommand = defineCommand({
  meta: { name: 'audit', description: 'Audit lockfile-scoped dependency supply-chain risk' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    mode: { type: 'string', description: 'Audit mode: compatibility, strict, or offline' },
    'changed-packages': { type: 'string', description: 'Comma-separated package names to audit instead of direct dependencies' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const mode = args.mode === 'compatibility' || args.mode === 'strict' || args.mode === 'offline'
      ? args.mode
      : undefined
    const report = auditDependencies({
      projectDir: args.dir ? String(args.dir) : PROJECT_DIR,
      mode,
      changedPackages: parseCommaList(args['changed-packages']),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(`SCALE Dependency Audit: ${report.ok ? 'OK' : 'FAILED'}`)
      console.log(`  Packages audited: ${report.summary.packagesAudited}`)
      console.log(`  Findings: ${report.summary.totalFindings}`)
      console.log(`  Mode: ${report.mode}`)
      for (const finding of report.findings.slice(0, 20)) {
        console.log(`  [${finding.severity}] ${finding.ruleId} ${finding.packageName}${finding.version ? `@${finding.version}` : ''}: ${finding.message}`)
      }
      if (report.findings.length > 20) console.log(`  ... ${report.findings.length - 20} more finding(s)`)
    }
    if (!report.ok) process.exitCode = 1
  },
})

const dependency = defineCommand({
  meta: { name: 'dependency', description: 'Supply-chain dependency governance' },
  subCommands: { audit: dependencyAuditCommand },
})

// ============================================================================
// tdd command - vertical slice RED/GREEN/REFACTOR loop
// ============================================================================

const tddSliceCommand = defineCommand({
  meta: { name: 'slice', description: 'Create and evaluate a TDD vertical slice' },
  args: {
    'task-id': { type: 'string', required: true },
    behavior: { type: 'string', required: true },
    'public-interface': { type: 'string', required: true },
    'failing-test': { type: 'string', required: true },
    'test-file': { type: 'string', required: true },
    'impl-files': { type: 'string', required: true },
    'red-exit-code': { type: 'string', description: 'Exit code from the RED command' },
    'red-summary': { type: 'string', description: 'Short RED output summary' },
    'green-exit-code': { type: 'string', description: 'Exit code from the GREEN command' },
    'green-summary': { type: 'string', description: 'Short GREEN output summary' },
    'refactor-exit-code': { type: 'string', description: 'Exit code from the REFACTOR command' },
    'refactor-summary': { type: 'string', description: 'Short REFACTOR output summary' },
    'artifact-dir': { type: 'string', description: 'Task artifact directory where verification.md should be updated' },
    write: { type: 'boolean', default: false, description: 'Append TDD slice output to the task verification artifact' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const failingTest = String(args['failing-test'])
    const slice = createTddSlice({
      taskId: String(args['task-id']),
      behavior: String(args.behavior),
      publicInterface: String(args['public-interface']),
      failingTestCommand: failingTest,
      testFile: String(args['test-file']),
      implementationFiles: parseCommaList(args['impl-files']),
      redEvidence: commandEvidence(failingTest, args['red-exit-code'], args['red-summary']),
      greenEvidence: commandEvidence(failingTest, args['green-exit-code'], args['green-summary']),
      refactorEvidence: commandEvidence(failingTest, args['refactor-exit-code'], args['refactor-summary']),
    })
    const evaluation = evaluateTddSlice(slice)
    const artifactPath = isTruthyFlag(args.write)
      ? appendTddSliceArtifact({
          projectDir: PROJECT_DIR,
          artifactsDir: args['artifact-dir'] ? String(args['artifact-dir']) : undefined,
          slice,
        }) ?? undefined
      : undefined
    let tddStatePath: string | undefined
    if (slice.redEvidence && slice.greenEvidence && slice.refactorEvidence) {
      const writer = new WorkflowArtifactWriter(SCALE_DIR)
      writer.writeTDDEvidence({
        timestamp: new Date().toISOString(),
        taskId: slice.taskId,
        red: slice.redEvidence.exitCode !== 0,
        green: slice.greenEvidence.exitCode === 0,
        refactor: slice.refactorEvidence.exitCode === 0,
        testFirst: slice.redEvidence.exitCode !== 0,
        testFile: slice.testFile,
        implFile: slice.implementationFiles[0] ?? '',
      })
      writer.updateCurrentState({
        taskId: slice.taskId,
        phase: 'verify',
        artifactsDir: args['artifact-dir'] ? String(args['artifact-dir']).replace(/\\/g, '/') : undefined,
        filesModified: slice.implementationFiles,
        openTasks: removeWorkflowOpenTask(writer.readCurrentState()?.openTasks, 'tdd-slice'),
      })
      tddStatePath = join(writer.getStateDir(), `tdd-${slice.taskId}.json`)
    }
    if (args.json) {
      console.log(JSON.stringify({ slice, evaluation, artifactPath, tddStatePath }, null, 2))
      return
    }
    console.log(renderTddSliceMarkdown(slice))
    if (evaluation.blockers.length > 0) {
      console.log('\nBlockers:')
      for (const blocker of evaluation.blockers) console.log(`  - ${blocker}`)
    }
    if (artifactPath) console.log(`\nArtifact: ${artifactPath}`)
    if (tddStatePath) console.log(`TDD state: ${tddStatePath}`)
  },
})

const tdd = defineCommand({
  meta: { name: 'tdd', description: 'TDD vertical slice workflows' },
  subCommands: { slice: tddSliceCommand },
})

// ============================================================================
// stats
// ============================================================================

const stats = defineCommand({
  meta: { name: 'stats', description: 'Show engine stats' },
  args: {},
  async run() {
    const { store, eventBus } = getEngine()
    const s = store.stats()
    const events = await eventBus.query({ limit: 1000 })
    console.log(JSON.stringify({ ...s, eventCount: events.length }, null, 2))
  },
})

const metricsList = defineCommand({
  meta: { name: 'list', description: 'List M/L task workflow metrics' },
  args: {
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const store = new TaskMetricsStore(SCALE_DIR)
    const records = store.list()
    const summary = store.summarize()
    if (args.json) {
      console.log(JSON.stringify({ summary, records }, null, 2))
      return
    }
    console.log('\nWorkflow Metrics')
    console.log(`  Total tasks: ${summary.total}`)
    console.log(`  First-pass verification rate: ${(summary.firstPassRate * 100).toFixed(1)}%`)
    console.log(`  Average fix iterations: ${summary.averageFixIterations.toFixed(2)}`)
    console.log(`  Artifact completeness: ${(summary.artifactCompletenessRate * 100).toFixed(1)}%`)
    for (const record of records.slice(-10)) {
      console.log(`  - ${record.date} ${record.level} ${record.taskName}: ${record.finalGateStatus}`)
    }
  },
})

const metrics = defineCommand({
  meta: { name: 'metrics', description: 'Inspect workflow task metrics' },
  subCommands: { list: metricsList },
})

function normalizeTaskArtifactLevel(value: unknown): TaskArtifactLevel {
  const normalized = String(value ?? 'M').trim().toUpperCase()
  if (normalized === 'S' || normalized === 'M' || normalized === 'L' || normalized === 'CRITICAL') {
    return normalized
  }
  throw new Error(`Invalid task level "${String(value)}"; expected S, M, L, or CRITICAL.`)
}

const taskArtifactsCheck = defineCommand({
  meta: { name: 'check', description: 'Check task artifact completeness' },
  args: {
    dir: { type: 'string', description: 'Task artifact directory; defaults to .scale/state/current.json artifactsDir' },
    level: { type: 'string', description: 'Task level: S, M, L, or CRITICAL; defaults to current state level or M' },
    'warn-only': { type: 'boolean', default: false, description: 'Return zero even when artifacts are incomplete' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const state = new WorkflowArtifactWriter(SCALE_DIR).readCurrentState()
    let level: TaskArtifactLevel
    try {
      level = normalizeTaskArtifactLevel(args.level ?? state?.level ?? 'M')
    } catch (e) {
      console.error((e as Error).message)
      process.exit(1)
    }
    const result = checkTaskArtifactCompleteness({
      projectDir: PROJECT_DIR,
      artifactsDir: args.dir ?? state?.artifactsDir,
      level,
      skillRequiredArtifacts: state?.requiredSkillArtifacts,
    })

    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(`\nTask Artifacts: ${result.complete ? 'COMPLETE' : 'INCOMPLETE'}`)
      if (result.artifactsDir) console.log(`  Directory: ${result.artifactsDir}`)
      console.log(`  Required: ${result.required.join(', ') || 'none'}`)
      for (const file of result.missing) console.log(`  [MISSING] ${file}`)
      for (const item of result.incomplete) console.log(`  [INCOMPLETE] ${item.file}: ${item.reason}`)
    }

    if (!result.complete && !args['warn-only']) process.exitCode = 1
  },
})

const taskArtifacts = defineCommand({
  meta: { name: 'task-artifacts', description: 'Inspect task artifact completeness' },
  subCommands: { check: taskArtifactsCheck },
})

function printWorkspaceLifecycle(report: WorkspaceLifecycleReport): void {
  console.log('\nSCALE Workspace Lifecycle')
  console.log(`  Topology: ${report.topology.topology}${report.topology.configured ? '' : ' (default)'}`)
  console.log(`  Root: ${report.root.path}`)
  console.log(`  Branch: ${report.root.branch ?? '(detached)'}`)
  console.log(`  Linked worktree: ${report.root.isLinkedWorktree ? 'yes' : 'no'}`)
  console.log(`  Root status: ${report.root.clean ? 'clean' : 'dirty'}`)
  console.log(`  Branch policy: ${report.branchPolicy.mode} role=${report.branchPolicy.role} ship=${report.branchPolicy.shipAllowed ? 'allowed' : 'blocked'}`)
  console.log(`    Integration: ${report.branchPolicy.integrationBranch}`)
  console.log(`    Production: ${report.branchPolicy.productionBranch}`)
  if (!report.root.clean) {
    console.log(`    staged=${report.root.staged} unstaged=${report.root.unstaged} untracked=${report.root.untracked}`)
  }
  for (const blocker of report.branchPolicy.shipBlockers) console.log(`  [SHIP BLOCKER] ${blocker}`)

  if (report.childRepositories.length) {
    console.log('\n  Child repositories:')
    for (const child of report.childRepositories) {
      console.log(`    ${child.clean ? '[CLEAN]' : '[DIRTY]'} ${child.relativePath} (${child.kind}) branch=${child.branch ?? '(detached)'}`)
      if (!child.clean) console.log(`      staged=${child.staged} unstaged=${child.unstaged} untracked=${child.untracked}`)
    }
  } else {
    console.log('\n  Child repositories: none')
  }

  console.log(`\n  Cleanup candidate: ${report.finish.canCleanup ? 'yes' : 'no'}`)
  for (const blocker of report.finish.blockers) console.log(`  [BLOCKER] ${blocker}`)
  for (const warning of report.finish.warnings) console.log(`  [WARN] ${warning}`)
  for (const action of report.finish.nextActions) console.log(`  [NEXT] ${action}`)
}

function compactList(values: string[], limit = 5): string {
  if (values.length <= limit) return values.join(', ')
  return `${values.slice(0, limit).join(', ')} (+${values.length - limit} more)`
}

function printWorkspaceSummary(report: WorkspaceLifecycleReport): void {
  const dirtyChildren = report.childRepositories
    .filter(child => !child.clean)
    .map(child => child.relativePath)
  const unpushedChildren = report.childRepositories
    .filter(child => child.ahead > 0 || (report.topology.finishPolicy.requirePushedBranches && report.topology.topology === 'moe' && !child.upstream && Boolean(child.branch)))
    .map(child => child.relativePath)
  const noUpstreamChildren = report.childRepositories
    .filter(child => !child.upstream && Boolean(child.branch))
    .map(child => child.relativePath)
  const rootStatus = report.root.clean
    ? 'clean'
    : `dirty (staged=${report.root.staged}, unstaged=${report.root.unstaged}, untracked=${report.root.untracked})`
  const status = report.finish.blockers.length > 0 ? 'BLOCKED' : 'READY'

  console.log('\nSCALE Workspace Summary')
  console.log(`  Status: ${status}`)
  console.log(`  Topology: ${report.topology.topology}${report.topology.configured ? '' : ' (default)'}`)
  console.log(`  Root: ${rootStatus}`)
  console.log(`  Branch: ${report.root.branch ?? '(detached)'} (${report.branchPolicy.role}, ship ${report.branchPolicy.shipAllowed ? 'allowed' : 'blocked'})`)
  console.log(`  Children: ${report.childRepositories.length} total, ${dirtyChildren.length} dirty, ${unpushedChildren.length} unpushed, ${noUpstreamChildren.length} no upstream`)

  if (dirtyChildren.length > 0) console.log(`  Dirty child repositories: ${compactList(dirtyChildren)}`)
  if (unpushedChildren.length > 0) console.log(`  Unpushed child repositories: ${compactList(unpushedChildren)}`)

  if (report.finish.blockers.length > 0) {
    console.log('\n  Blockers:')
    for (const blocker of report.finish.blockers.slice(0, 8)) console.log(`    - ${blocker}`)
    if (report.finish.blockers.length > 8) console.log(`    - ... ${report.finish.blockers.length - 8} more blocker(s)`)
  }

  if (report.finish.warnings.length > 0) {
    console.log(`\n  Warnings: ${report.finish.warnings.length} warning(s); run scale workspace finish --json for details`)
  }

  console.log('\n  Next:')
  const nextActions = report.finish.blockers.length > 0
    ? report.finish.nextActions
    : ['Proceed with scale ship <task-id> or cleanup when the branch policy is satisfied']
  for (const action of nextActions.slice(0, 3)) console.log(`    - ${action}`)
  console.log('    - Run scale workspace finish --json for full details')
}

function printWorkspaceTopology(topology: ReturnType<typeof resolveWorkspaceTopology>, written?: string | null): void {
  console.log('\nSCALE Workspace Topology')
  console.log(`  Topology: ${topology.topology}${topology.configured ? '' : ' (default)'}`)
  console.log(`  Config: ${topology.configPath}`)
  if (written) console.log(`  Written: ${written}`)
  console.log('\n  Repositories:')
  for (const repo of topology.repositories) {
    console.log(`    - ${repo.name}: ${repo.path} (${repo.role}) required=${repo.required !== false ? 'yes' : 'no'}`)
  }
  for (const warning of topology.warnings) console.log(`  [WARN] ${warning}`)
}

function printWorkspaceCleanup(result: WorkspaceCleanupResult): void {
  printWorkspaceLifecycle(result.report)
  console.log('\n  Cleanup plan:')
  console.log(`    Mode: ${result.mode}`)
  console.log(`    Target: ${result.targetPath}`)
  console.log(`    Can apply: ${result.canApply ? 'yes' : 'no'}`)
  console.log(`    Applied: ${result.applied ? 'yes' : 'no'}`)
  console.log(`    Confirmation token: ${result.confirmationToken ?? '(unavailable)'}`)
  for (const command of result.commands) console.log(`    Command: ${command}`)
  for (const blocker of result.blockers) console.log(`  [BLOCKER] ${blocker}`)
  for (const warning of result.warnings) console.log(`  [WARN] ${warning}`)
}

const workspaceStatus = defineCommand({
  meta: { name: 'status', description: 'Inspect root worktree and child repository lifecycle state' },
  args: {
    dir: { type: 'string', description: 'Repository or worktree directory; defaults to current project directory' },
    summary: { type: 'boolean', default: false, description: 'Print concise human summary instead of the full repository listing' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const report = await inspectWorkspaceLifecycle({ projectDir: args.dir ?? PROJECT_DIR })

    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else if (isTruthyFlag(args.summary)) {
      printWorkspaceSummary(report)
    } else {
      printWorkspaceLifecycle(report)
    }

    if (report.finish.blockers.length > 0) process.exitCode = 1
  },
})

const workspaceMap = defineCommand({
  meta: { name: 'map', description: 'Resolve or write explicit workspace topology for single, monorepo, polyrepo, submodule, or MOE projects' },
  args: {
    dir: { type: 'string', description: 'Project directory; defaults to current project directory' },
    topology: { type: 'string', default: 'moe', description: 'Starter topology for --write (single/monorepo/polyrepo/submodule-workspace/moe)' },
    write: { type: 'boolean', default: false, description: 'Create .scale/workspace.json when it does not exist' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(args.dir ?? PROJECT_DIR)
    const target = workspaceTopologyPath(projectDir)
    let written: string | null = null

    if (isTruthyFlag(args.write) && !existsSync(target)) {
      ensureDir(join(projectDir, '.scale'))
      writeFileSync(target, workspaceTopologyTemplate({
        topology: normalizeWorkspaceTopologyKind(args.topology),
      }), 'utf-8')
      written = target
    }

    const topology = resolveWorkspaceTopology({ projectDir })
    const result = { ...topology, written }

    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      printWorkspaceTopology(topology, written)
    }
  },
})

const workspaceFinish = defineCommand({
  meta: { name: 'finish', description: 'Check whether a temporary worktree can be safely finished or cleaned up' },
  args: {
    dir: { type: 'string', description: 'Repository or worktree directory; defaults to current project directory' },
    summary: { type: 'boolean', default: false, description: 'Print concise human summary instead of the full repository listing' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const report = await inspectWorkspaceLifecycle({ projectDir: args.dir ?? PROJECT_DIR })
    const result = {
      root: report.root,
      childRepositories: report.childRepositories,
      topology: report.topology,
      branchPolicy: report.branchPolicy,
      finish: report.finish,
    }

    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
    } else if (isTruthyFlag(args.summary)) {
      printWorkspaceSummary(report)
    } else {
      printWorkspaceLifecycle(report)
    }

    if (report.finish.blockers.length > 0) process.exitCode = 1
  },
})

const workspaceCleanup = defineCommand({
  meta: { name: 'cleanup', description: 'Dry-run or apply safe removal of a linked temporary worktree' },
  args: {
    dir: { type: 'string', description: 'Linked worktree directory; defaults to current project directory' },
    'dry-run': { type: 'boolean', default: false, description: 'Preview cleanup; this is the default unless --apply is set' },
    apply: { type: 'boolean', default: false, description: 'Actually run git worktree remove after safety checks' },
    confirm: { type: 'string', description: 'Required confirmation token for --apply, usually the worktree branch name' },
    summary: { type: 'boolean', default: false, description: 'Print concise human summary before the cleanup plan' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const result = await cleanupWorkspaceLifecycle({
      projectDir: args.dir ?? PROJECT_DIR,
      apply: isTruthyFlag(args.apply),
      confirm: args.confirm,
    })

    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
    } else if (isTruthyFlag(args.summary)) {
      printWorkspaceSummary(result.report)
      console.log('\n  Cleanup:')
      console.log(`    Mode: ${result.mode}`)
      console.log(`    Can apply: ${result.canApply ? 'yes' : 'no'}`)
      console.log(`    Applied: ${result.applied ? 'yes' : 'no'}`)
      console.log(`    Confirmation token: ${result.confirmationToken ?? '(unavailable)'}`)
    } else {
      printWorkspaceCleanup(result)
    }

    if (!result.canApply || (isTruthyFlag(args.apply) && !result.applied)) process.exitCode = 1
  },
})

const workspace = defineCommand({
  meta: { name: 'workspace', description: 'Inspect worktree, branch, and child repository lifecycle safety' },
  subCommands: {
    map: workspaceMap,
    status: workspaceStatus,
    finish: workspaceFinish,
    cleanup: workspaceCleanup,
  },
})

function normalizeWorkspaceTopologyKind(value: unknown): WorkspaceTopologyKind {
  const normalized = String(value ?? 'moe').trim()
  if (
    normalized === 'single'
    || normalized === 'monorepo'
    || normalized === 'polyrepo'
    || normalized === 'submodule-workspace'
    || normalized === 'moe'
  ) {
    return normalized
  }
  return 'moe'
}

const preflight = defineCommand({
  meta: { name: 'preflight', description: 'Run service-aware verification without a task artifact' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'build-cmd': { type: 'string', description: 'Override build command' },
    'lint-cmd': { type: 'string', description: 'Override lint command' },
    'test-cmd': { type: 'string', description: 'Override test command' },
    'coverage-cmd': { type: 'string', description: 'Override coverage command' },
    profile: { type: 'string', description: 'Verification profile from .scale/verification.json' },
    'preflight-profile': { type: 'string', default: 'quick', description: 'Gate intensity profile (quick/full/ci); quick skips coverage and security' },
    service: { type: 'string', description: 'Service name from .scale/verification.json; use all for required services' },
    'tdd-evidence': { type: 'string', description: 'Path to JSON TDD evidence with red/green/refactor/testFirst=true' },
    'tdd-strict': { type: 'boolean', default: false, description: 'Require TDD evidence before other gates' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const workflowEngine = createVerificationWorkflowEngine(scaleDir)
    const preflightProfile = normalizePreflightProfile(args['preflight-profile'])
    const resolved = resolveVerificationTargets({
      projectDir,
      scaleDir,
      profile: args.profile,
      service: args.service,
    })
    let gateStages = gatesForPreflightProfile(preflightProfile)
    if (resolved.targets.some(target => target.config.smoke)) {
      gateStages = ['G8']
    }
    const commandTargetsSkipped = shouldSkipPreflightCommandTargets(resolved, args)
    if (commandTargetsSkipped) {
      resolved.warnings.push('No verification services or profile commands configured; command gates skipped for this governance-only project.')
    }
    const workspaceSafety = inspectWorkspaceSafety(projectDir)
    const engineeringStandardsChangedFiles = readGitChangedFilesForStandards(projectDir)
    const engineeringStandards = workspaceSafety.blocked
      ? skippedEngineeringStandardsGate('Workspace has unresolved git conflicts; resolve them before standards scanning.', resolved.policy)
      : evaluateEngineeringStandardsGate({
          policy: resolved.policy,
          projectDir,
          scaleDir,
          changedFiles: engineeringStandardsChangedFiles,
        })

    const targetResults: Array<{
      service?: string
      cwd: string
      gates: GateResult[]
      passed: boolean
    }> = []

    if (!args.json) {
      console.log('\nSCALE Preflight')
      for (const warning of resolved.warnings) console.log(`  [WARN] ${warning}`)
      console.log(`  Profile: ${resolved.profileName}`)
      console.log(`  Preflight profile: ${preflightProfile}`)
      console.log(`  Gates: ${gateStages.join(', ')}`)
      if (workspaceSafety.blocked) {
        console.log(`  Workspace safety: BLOCKED - ${workspaceSafety.message}`)
      }
      if (engineeringStandards.checked) {
        const status = engineeringStandards.blocked ? 'BLOCKED' : engineeringStandards.ok ? 'OK' : 'WARN'
        console.log(`  Engineering standards: ${status} (${engineeringStandards.mode})`)
        if (engineeringStandards.changedFiles) {
          console.log(`  Engineering standards scope: changed files (${engineeringStandards.changedFiles.length})`)
        }
      } else {
        console.log('  Engineering standards: skipped')
      }
    }

    for (const target of commandTargetsSkipped || workspaceSafety.blocked ? [] : resolved.targets) {
      if (!args.json) {
        const label = target.service ? `${target.service.name} (${target.service.path})` : 'root'
        console.log(`\n  Target: ${label}`)
      }
      const gates = await workflowEngine.verify({
        cwd: target.config.cwd,
        build: args['build-cmd'] ?? target.config.build,
        lint: args['lint-cmd'] ?? target.config.lint,
        test: args['test-cmd'] ?? target.config.test,
        coverage: args['coverage-cmd'] ?? target.config.coverage,
        smoke: target.config.smoke,
        runtimeEvidence: {
          projectDir,
          scaleDir,
          profile: resolved.profileName,
        },
        tddEvidence: args['tdd-evidence'],
        tddStrict: isTruthyFlag(args['tdd-strict']),
        gates: gateStages,
      })
      const passed = gates.every(gate => gate.passed)
      targetResults.push({
        service: target.service?.name,
        cwd: target.config.cwd ?? projectDir,
        gates,
        passed,
      })

      if (!args.json) {
        for (const gate of gates) {
          console.log(`    ${gate.passed ? '[PASS]' : '[FAIL]'} ${gate.gate}: ${gate.evidence.slice(0, 80)}`)
          for (const blocker of gate.blockers) console.log(`      [BLOCKER] ${blocker.slice(0, 120)}`)
        }
      }
    }

    const passed = (targetResults.length === 0 || targetResults.every(target => target.passed)) &&
      !workspaceSafety.blocked &&
      !engineeringStandards.blocked
    const result = {
      phase: 'PREFLIGHT',
      profile: resolved.profileName,
      preflightProfile,
      gates: gateStages,
      services: targetResults.map(target => target.service).filter(Boolean),
      policy: resolved.policy,
      workspaceSafety,
      engineeringStandards,
      targets: targetResults,
      commandTargetsSkipped,
      passed,
    }

    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(`\nPREFLIGHT: ${passed ? 'PASSED' : 'FAILED'}\n`)
    }
    if (!passed) process.exitCode = 1
  },
})

const status = defineCommand({
  meta: { name: 'status', description: 'Show current SCALE workflow status' },
  args: {
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const { store } = getEngine()
    const evidenceStore = new EvidenceStore(SCALE_DIR)
    const reviewStore = new ReviewStore(SCALE_DIR)
    const [specs, plans, tasks, releases] = await Promise.all([
      store.query({ type: 'Spec', limit: 1 }),
      store.query({ type: 'Plan', limit: 1 }),
      store.query({ type: 'Task', limit: 1 }),
      store.query({ type: 'Release', limit: 1 }),
    ])
    const latestEvidence = evidenceStore.listGateResults(5)
    const latestReviews = reviewStore.listReviews(5)
    const latestTask = tasks[0]
    const taskPayload = latestTask?.payload as { verificationEvidenceIds?: string[]; reviewEvidenceIds?: string[]; reviewPassed?: boolean; reviewedAt?: number; verifiedAt?: number; testPassed?: boolean; lintStatus?: string; testCoverage?: number } | undefined
    const workflowState = new WorkflowArtifactWriter(SCALE_DIR).readCurrentState()
    const currentOpenTasks = workflowState?.openTasks ?? []
    const nextOpenTask = nextWorkflowOpenTask(currentOpenTasks)

    const blockers: string[] = []
    const latestBlockingEvidence = latestEvidence.find(record => !record.passed)
    const latestBlockingReview = latestReviews.find(record => !record.passed)
    if (latestBlockingEvidence) blockers.push(`${latestBlockingEvidence.gate}: ${latestBlockingEvidence.blockers.join('; ') || latestBlockingEvidence.status}`)
    if (latestBlockingReview) blockers.push(`Review ${latestBlockingReview.id}: ${latestBlockingReview.summary.critical} critical, ${latestBlockingReview.summary.high} high`)
    if (latestTask && (!taskPayload?.verificationEvidenceIds || taskPayload.verificationEvidenceIds.length === 0)) {
      blockers.push(`Task ${latestTask.id} has no persisted verification evidence`)
    }
    if (latestTask?.status === 'COMPLETED' && (!taskPayload?.reviewEvidenceIds || taskPayload.reviewEvidenceIds.length === 0)) {
      blockers.push(`Task ${latestTask.id} has no persisted review evidence`)
    }

    const nextCommand = (() => {
      if (nextOpenTask?.kind === 'command') return nextOpenTask.value
      if (nextOpenTask?.kind === 'blocker') return `Resolve workflow blocker: ${nextOpenTask.value}`
      if (!specs[0]) return 'scale define "<feature>" --description "<what to build>"'
      if (!plans[0]) return `scale plan ${specs[0].id}`
      if (!latestTask) return `scale build ${plans[0].id}`
      if (!taskPayload?.verificationEvidenceIds?.length) return `scale verify ${latestTask.id}`
      if (latestTask.status !== 'COMPLETED') return `scale verify ${latestTask.id}`
      if (!taskPayload.reviewEvidenceIds?.length || taskPayload.reviewPassed !== true) return `scale review ${latestTask.id}`
      if (!releases[0]) return `scale ship ${latestTask.id}`
      return 'scale evidence list'
    })()

    const result = {
      artifacts: {
        latestSpec: specs[0] ? { id: specs[0].id, status: specs[0].status, title: specs[0].title } : null,
        latestPlan: plans[0] ? { id: plans[0].id, status: plans[0].status, title: plans[0].title } : null,
        latestTask: latestTask ? {
          id: latestTask.id,
          status: latestTask.status,
          title: latestTask.title,
          lintStatus: taskPayload?.lintStatus,
          testPassed: taskPayload?.testPassed,
          testCoverage: taskPayload?.testCoverage,
          evidenceIds: taskPayload?.verificationEvidenceIds ?? [],
          reviewPassed: taskPayload?.reviewPassed,
          reviewEvidenceIds: taskPayload?.reviewEvidenceIds ?? [],
        } : null,
      },
      recentEvidence: latestEvidence.map(record => ({
        id: record.id,
        gate: record.gate,
        status: record.status,
        passed: record.passed,
        blockers: record.blockers,
        createdAt: record.createdAt,
      })),
      recentReviews: latestReviews.map(record => ({
        id: record.id,
        taskId: record.taskId,
        passed: record.passed,
        summary: record.summary,
        createdAt: record.createdAt,
      })),
      workflowState: workflowState ? {
        taskId: workflowState.taskId,
        level: workflowState.level,
        phase: workflowState.phase,
        artifactsDir: workflowState.artifactsDir,
        openTasks: workflowState.openTasks ?? [],
        skillIntents: workflowState.skillIntents,
      } : null,
      blockers,
      nextCommand,
    }

    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }

    console.log('\nSCALE Status')
    console.log('Artifacts:')
    console.log(`  Spec: ${result.artifacts.latestSpec ? `${result.artifacts.latestSpec.id} (${result.artifacts.latestSpec.status})` : 'none'}`)
    console.log(`  Plan: ${result.artifacts.latestPlan ? `${result.artifacts.latestPlan.id} (${result.artifacts.latestPlan.status})` : 'none'}`)
    console.log(`  Task: ${result.artifacts.latestTask ? `${result.artifacts.latestTask.id} (${result.artifacts.latestTask.status})` : 'none'}`)

    if (result.artifacts.latestTask?.evidenceIds.length) {
      console.log(`  Task evidence: ${result.artifacts.latestTask.evidenceIds.join(', ')}`)
    }

    console.log('\nRecent Evidence:')
    if (result.recentEvidence.length === 0) {
      console.log('  none')
    } else {
      for (const record of result.recentEvidence) {
        console.log(`  ${record.id} ${record.gate} ${record.passed ? 'PASS' : record.status}`)
      }
    }

    if (blockers.length > 0) {
      console.log('\nBlockers:')
      for (const blocker of blockers) console.log(`  - ${blocker}`)
    }

    if ((result.workflowState?.openTasks.length ?? 0) > 0) {
      console.log('\nOpen Tasks:')
      for (const task of result.workflowState!.openTasks) console.log(`  - ${task}`)
    }

    console.log(`\nNext: ${nextCommand}`)
  },
})

// ============================================================================
// init command
// ============================================================================

const init = defineCommand({
  meta: { name: 'init', description: 'Initialize SCALE Engine governance in current project (one-click bootstrap, not third-party auto-install)' },
  args: {
    agent: { type: 'string', default: '', description: `Agent type (${SUPPORTED_AGENTS.join('/')}) - auto-detected if not specified` },
    dir: { type: 'string', default: '.', description: 'Project directory' },
    json: { type: 'boolean', default: false, description: 'Output initialization result as JSON' },
    scenario: { type: 'string', default: 'standard', description: 'Scenario mode (sandbox/standard/critical)' },
    'governance-pack': {
      type: 'string',
      default: 'standard',
      description: 'Governance template pack (standard/project-scaffold/scale-engine-repo/moe-workspace/resource-governance/go-service-matrix/node-library/frontend-app)',
    },
    quick: { type: 'boolean', default: false, description: 'Quick start with auto-detection' },
    interactive: { type: 'boolean', default: false, description: 'Interactive configuration mode with prompts' },
    profile: { type: 'string', default: '', description: 'Configuration profile (minimal/standard/advanced). Auto-mapped from scenario if not specified' },
    'coverage-threshold': { type: 'string', default: '80', description: 'Coverage threshold (default 80%)' },
    'retry-threshold': { type: 'string', default: '3', description: 'Brute retry threshold (default 3)' },
    'block-severity': { type: 'string', default: 'CRITICAL', description: 'Block severity level (CRITICAL/HIGH/MEDIUM)' },
  },
  async run({ args }) {
    // Interactive configuration mode
    if (args.interactive) {
      console.log('\n🔧 SCALE Engine Interactive Configuration\n')
      console.log('=' .repeat(50))

      // Step 1: Detect and suggest agent platform
      const detection = detectPlatform(args.dir)
      console.log('\n📋 Step 1: Agent Platform Selection')
      console.log(`   Detected suggestions: ${detection.suggestions.join(', ') || 'none'}`)

      const agentType = args.agent || detection.suggestions[0] || 'claude-code'
      console.log(`   Using: ${agentType}`)

      // Step 2: Scenario mode
      console.log('\n📋 Step 2: Scenario Mode')
      console.log('   sandbox    - No quality gates (POC/prototype)')
      console.log('   standard   - Default quality gates')
      console.log('   critical   - Hardened gates + manual approval')

      const scenarioMode = args.scenario as 'sandbox' | 'standard' | 'critical'
      console.log(`   Using: ${scenarioMode}`)

      // Step 3: Quality Gate Thresholds (quantified)
      console.log('\n📋 Step 3: Quality Gate Thresholds')
      const coverageThreshold = parseInt(args['coverage-threshold'], 10) || 80
      const retryThreshold = parseInt(args['retry-threshold'], 10) || 3
      const blockSeverity = args['block-severity'] || 'CRITICAL'

      console.log(`   Coverage threshold:   ${coverageThreshold}%`)
      console.log(`   Retry threshold:      ${retryThreshold} (brute retry block)`)
      console.log(`   Block severity:       ${blockSeverity}`)

      // Step 4: Write thresholds to .scale/thresholds.json
      const thresholdsPath = join(args.dir, '.scale', 'thresholds.json')
      ensureDir(join(args.dir, '.scale'))
      writeFileSync(thresholdsPath, JSON.stringify({
        coverage: { minimum: coverageThreshold, unit: 'percent' },
        retry: { bruteMaximum: retryThreshold, unit: 'count' },
        severity: { blockLevel: blockSeverity },
        gates: {
          G3_build: { required: scenarioMode !== 'sandbox', exitCode: 0 },
          G4_lint: { required: scenarioMode !== 'sandbox', exitCode: 0 },
          G5_tests: { required: scenarioMode !== 'sandbox', allPass: true },
          G6_coverage: { required: scenarioMode !== 'sandbox', minimum: coverageThreshold },
          G7_security: { required: scenarioMode === 'critical', noCritical: true },
        },
      }, null, 2))

      console.log(`\n   ✓ Thresholds written to: ${thresholdsPath}`)

      // Initialize with adapter
      const adapter = createAdapter(agentType)
      const result = await adapter.init({
        projectDir: args.dir,
        agentType: agentType as never,
        scenarioMode,
        thresholdsPath,
      })
      const projectName = args.dir.split(/[/\\]/).pop() || 'Project'
      const governance = writeGovernanceTemplates(args.dir, {
        mode: governanceModeFromScenario(scenarioMode),
        projectName,
        pack: args['governance-pack'],
      })
      result.created.push(...governance.created)
      result.skipped.push(...governance.skipped)

      // Generate config.yaml from profile
      const profileId = args.profile || profileFromScenario(scenarioMode)
      const configPath = writeConfigYaml(args.dir, profileId, projectName, [agentType])
      result.created.push(configPath)

      console.log(`\n✅ SCALE Engine initialized for ${agentType} (interactive mode, profile: ${profileId})`)
      console.log(`\n📁 Created:`)
      for (const f of result.created) console.log(`   + ${f}`)
      if (result.skipped.length > 0) {
        console.log(`\n⏭️  Skipped (already exist):`)
        for (const f of result.skipped) console.log(`   - ${f}`)
      }

      console.log(`\n🔧 Configuration Summary:`)
      console.log(`   Settings:      ${result.settingsPath}`)
      console.log(`   Knowledge:     ${result.knowledgeDocPath}`)
      console.log(`   Thresholds:    ${thresholdsPath}`)
      console.log(`   Config:        ${configPath}`)
      console.log(`   Data dir:      ${result.scaleDir}`)
      console.log(`   Scenario:      ${scenarioMode}`)
      console.log(`   Profile:       ${profileId}`)

      console.log(`\n📋 Next steps:`)
      for (const step of governanceNextSteps({
        profileId,
        governancePack: String(args['governance-pack']),
      })) console.log(`   → ${step}`)
      return
    }

    // One-click quick start mode
    if (!args.agent) {
      const profileId = args.profile || profileFromScenario(args.scenario)
      const qsResult = await quickStart(args.dir, {
        governancePack: args['governance-pack'],
        profileId,
      })

      // Generate config.yaml from profile
      if (qsResult.success) {
        const projectName = args.dir.split(/[/\\]/).pop() || 'Project'
        const detectedAgent = qsResult.platform ? [qsResult.platform] : []
        const configPath = writeConfigYaml(args.dir, profileId, projectName, detectedAgent)
        qsResult.created.push(configPath)
      }

      if (args.json) {
        const detection = qsResult.success ? undefined : detectPlatform(args.dir)
        console.log(JSON.stringify({
          ok: qsResult.success,
          mode: qsResult.success && !qsResult.platform ? 'governance-only' : 'quick',
          platform: qsResult.platform,
          created: qsResult.created,
          skipped: qsResult.skipped,
          constraintsApplied: qsResult.constraintsApplied,
          workflowCapabilities: qsResult.workflowCapabilities,
          capabilitiesEnabled: qsResult.capabilitiesEnabled,
          knowledgeGraph: qsResult.knowledgeGraph,
          dependencyBootstrapCommand: qsResult.dependencyBootstrapCommand,
          nextSteps: qsResult.nextSteps,
          suggestions: detection?.suggestions ?? [],
        }, null, 2))
        return
      }
      if (qsResult.success) {
        if (!qsResult.platform) console.log(`\nSCALE governance templates initialized`)
        else
        console.log(`\n✅ SCALE Engine Quick Start completed for ${qsResult.platform}`)
        console.log(`\n📁 Created (${qsResult.created.length}):`)
        for (const f of qsResult.created) console.log(`   + ${f}`)
        if (qsResult.skipped.length > 0) {
          console.log(`\n⏭️  Skipped (${qsResult.skipped.length}):`)
          for (const f of qsResult.skipped) console.log(`   - ${f}`)
        }
        console.log(`\n🔒 Physical constraints applied: ${qsResult.constraintsApplied}`)
        console.log(`\n🧭 Workflow capability plan: ${qsResult.workflowCapabilities.join(', ')}`)
        console.log(`\n🧰 Dependency bootstrap: ${qsResult.dependencyBootstrapCommand}`)
        console.log(`\n📋 Next steps:`)
        for (const step of qsResult.nextSteps) console.log(`   → ${step}`)
      } else {
        console.log(`\n⚠️  No agent platform detected`)
        const detection = detectPlatform(args.dir)
        console.log(`\n📋 Suggested platforms: ${detection.suggestions.join(', ')}`)
        console.log(`\n→ Run: scale init --agent <platform>`)
      }
      return
    }

    // Manual agent specification mode
    const adapter = createAdapter(args.agent)
    const result = await adapter.init({ projectDir: args.dir, agentType: args.agent as never, scenarioMode: args.scenario as 'sandbox' | 'standard' | 'critical' })
    const projectName = args.dir.split(/[/\\]/).pop() || 'Project'
    const governance = writeGovernanceTemplates(args.dir, {
      mode: governanceModeFromScenario(args.scenario),
      projectName,
      pack: args['governance-pack'],
    })
    result.created.push(...governance.created)
    result.skipped.push(...governance.skipped)

    // Generate config.yaml from profile
    const profileId = args.profile || profileFromScenario(args.scenario)
    const configPath = writeConfigYaml(args.dir, profileId, projectName, [args.agent])
    result.created.push(configPath)

    if (args.json) {
      console.log(JSON.stringify({
        ok: true,
        mode: args.quick ? 'quick-agent' : 'manual',
        agent: args.agent,
        scenario: args.scenario,
        profile: profileId,
        governancePack: args['governance-pack'],
        settingsPath: result.settingsPath,
        knowledgeDocPath: result.knowledgeDocPath,
        configPath,
        scaleDir: result.scaleDir,
        created: result.created,
        skipped: result.skipped,
        nextSteps: governanceNextSteps({
          profileId,
          governancePack: String(args['governance-pack']),
        }),
      }, null, 2))
      return
    }
    console.log(`\n✅ SCALE Engine initialized for ${args.agent} (scenario: ${args.scenario}, profile: ${profileId})`)
    console.log(`\n📁 Created:`)
    for (const f of result.created) console.log(`   + ${f}`)
    if (result.skipped.length > 0) {
      console.log(`\n⏭️  Skipped (already exist):`)
      for (const f of result.skipped) console.log(`   - ${f}`)
    }
    console.log(`\n🔧 Settings: ${result.settingsPath}`)
    console.log(`\n📖 Knowledge: ${result.knowledgeDocPath}`)
    console.log(`\n📄 Config:    ${configPath}`)
    console.log(`\n📂 Data dir:  ${result.scaleDir}`)
    console.log(`\n📋 Next steps:`)
    for (const step of governanceNextSteps({
      profileId,
      governancePack: String(args['governance-pack']),
    })) console.log(`   → ${step}`)
  },
})

const bootstrapDepsCommand = defineCommand({
  meta: { name: 'deps', description: 'Plan or install third-party skills, CLI dependencies, and project post-configuration' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    pack: { type: 'string', default: '', description: 'Comma-separated packs: ui,memory,knowledge,external-cli,full. Defaults to full unless --profile is supplied.' },
    profile: { type: 'string', description: 'Resolve recommended packs from profile: minimal, standard, advanced' },
    'governance-pack': { type: 'string', description: 'Optional governance pack hint, for example frontend-app -> ui' },
    include: { type: 'string', description: 'Additional dependency ids to include explicitly' },
    apply: { type: 'boolean', default: false, description: 'Run install commands for ready dependencies' },
    lang: { type: 'string', description: 'Output language zh/en. Defaults to zh, then SCALE_LANG, then .scale/config.yaml locale.' },
    json: { type: 'boolean', default: false, description: 'Output bootstrap plan as JSON' },
  },
  async run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const lang = resolveCliLanguage({ lang: args.lang, projectDir, scaleDir: SCALE_DIR })
    const explicitPacks = parseCommaList(args.pack)
    const recommendedPacks = args.profile
      ? getBootstrapPlanForProfile(
        String(args.profile),
        args['governance-pack'] ? String(args['governance-pack']) : undefined,
      ).packs
      : []
    const report = await bootstrapDependencies({
      projectDir,
      scaleDir: SCALE_DIR,
      packIds: explicitPacks.length > 0 ? uniqueStrings([...recommendedPacks, ...explicitPacks]) : recommendedPacks,
      includeIds: parseCommaList(args.include),
      apply: isTruthyFlag(args.apply),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (isTruthyFlag(args.apply) && !report.ok) process.exitCode = 1
      return
    }
    console.log(renderDependencyBootstrapReport(report, lang))
    if (report.apply && !report.ok) process.exitCode = 1
  },
})

const bootstrap = defineCommand({
  meta: { name: 'bootstrap', description: 'Bootstrap third-party workflow dependencies with explicit install intent' },
  subCommands: { deps: bootstrapDepsCommand },
})

const setup = defineCommand({
  meta: { name: 'setup', description: 'Interactive SCALE setup for third-party skills, CLIs, memory, and knowledge providers' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    pack: { type: 'string', default: '', description: 'Comma-separated packs: ui,memory,knowledge,external-cli,full. Defaults to full unless --profile is supplied.' },
    profile: { type: 'string', description: 'Resolve recommended packs from profile: minimal, standard, advanced' },
    'governance-pack': { type: 'string', description: 'Optional governance pack hint, for example frontend-app -> ui' },
    include: { type: 'string', description: 'Additional dependency ids to include explicitly' },
    apply: { type: 'boolean', default: false, description: 'Run install commands for ready dependencies' },
    yes: { type: 'boolean', default: false, description: 'Confirm installation without prompting' },
    verify: { type: 'boolean', default: false, description: 'Verify governed setup and dependency readiness instead of running the setup wizard' },
    interactive: { type: 'boolean', default: true, description: 'Prompt before installation when dependencies are ready' },
    lang: { type: 'string', description: 'Output language zh/en. Defaults to zh, then SCALE_LANG, then .scale/config.yaml locale.' },
    'memory-provider': { type: 'string', description: 'Switch memory provider during setup: gbrain, agentmemory, or scale-local' },
    'memory-mode': { type: 'string', description: 'Memory routing mode: auto, local-only, external-first' },
    'memory-endpoint': { type: 'string', description: 'Optional endpoint to persist for the selected memory provider' },
    'memory-write-mode': { type: 'string', description: 'Memory write mode: disabled, candidate-only, enabled' },
    'allow-external-write': { type: 'boolean', default: false, description: 'Explicitly allow external memory writes in provider routing' },
    json: { type: 'boolean', default: false, description: 'Output setup report as JSON' },
  },
  async run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const lang = resolveCliLanguage({ lang: args.lang, projectDir, scaleDir: SCALE_DIR })
    const { explicitPacks, recommendedPacks } = resolveSetupPacks(args)
    if (isTruthyFlag(args.verify)) {
      const verification = await verifySetup({
        projectDir,
        scaleDir: SCALE_DIR,
        packIds: explicitPacks.length > 0 ? uniqueStrings([...recommendedPacks, ...explicitPacks]) : recommendedPacks,
        includeIds: parseCommaList(args.include),
      })
      if (args.json) {
        console.log(JSON.stringify(verification, null, 2))
      } else {
        renderSetupVerifyReport(verification, lang)
      }
      if (!verification.ok) process.exitCode = 1
      return
    }
    const report = await runSetupWizard({
      projectDir,
      scaleDir: SCALE_DIR,
      packIds: explicitPacks.length > 0 ? uniqueStrings([...recommendedPacks, ...explicitPacks]) : recommendedPacks,
      includeIds: parseCommaList(args.include),
      promptPacks: explicitPacks.length === 0 && recommendedPacks.length === 0 && !args.include,
      apply: isTruthyFlag(args.apply),
      yes: isTruthyFlag(args.yes),
      interactive: isTruthyFlag(args.interactive) && !isTruthyFlag(args.json),
      lang,
      memoryProvider: args['memory-provider'] ? String(args['memory-provider']) : undefined,
      memoryMode: normalizeMemoryModeArg(args['memory-mode']),
      memoryEndpoint: args['memory-endpoint'] ? String(args['memory-endpoint']) : undefined,
      memoryWriteMode: normalizeMemoryWriteModeArg(args['memory-write-mode']),
      allowExternalWrite: isTruthyFlag(args['allow-external-write']) ? true : undefined,
      promptLanguage: isTruthyFlag(args.interactive) && !args.lang,
    })
    if (!args.json) {
      console.log(lang === 'zh' ? '\nSCALE 交互式安装' : '\nSCALE Interactive Setup')
      console.log(lang === 'zh'
        ? `  已执行安装: ${report.applied ? '是' : '否'}`
        : `  Applied: ${report.applied}`)
      if (report.memoryProviderSwitch) {
        const switched = report.memoryProviderSwitch!
        console.log(lang === 'zh' ? '  记忆供应商:' : '  Memory provider:')
        console.log(`    provider=${switched.provider}; mode=${switched.mode}; config=${switched.path}`)
        console.log(`    order=${switched.previousOrder.join(' -> ')} => ${switched.nextOrder.join(' -> ')}`)
        if (switched.providerStatus) {
          console.log(`    status=${switched.providerStatus!.available ? 'available' : 'not-ready'}; reason=${switched.providerStatus!.reason}`)
        }
        for (const warning of switched.warnings) console.log(lang === 'zh' ? `    [警告] ${warning}` : `    [WARN] ${warning}`)
      }
      console.log(renderDependencyBootstrapReport(report.final, lang))
      if (!report.ok) process.exitCode = 1
      return
    }
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
  },
})

// config command — Configuration profile management
// ============================================================================

function resolveSetupPacks(args: Record<string, unknown>): { explicitPacks: string[]; recommendedPacks: string[] } {
  const explicitPacks = parseCommaList(args.pack)
  const recommendedPacks = args.profile
    ? getBootstrapPlanForProfile(
      String(args.profile),
      args['governance-pack'] ? String(args['governance-pack']) : undefined,
    ).packs
    : []
  return { explicitPacks, recommendedPacks }
}

function renderSetupVerifyReport(report: Awaited<ReturnType<typeof verifySetup>>, lang: 'zh' | 'en'): void {
  if (lang === 'zh') {
    console.log('\nSCALE 安装验收')
    console.log(`  项目: ${report.projectDir}`)
    console.log(`  依赖包: ${report.packIds.join(', ') || 'full'}`)
    console.log(`  结论: ${report.ok ? '通过' : '未通过'}`)
    console.log(`  阻塞项: ${report.summary.blockingIssues.length}`)
    console.log(`  受管能力: ${report.summary.installedTools}/${report.summary.totalTools}`)
    console.log(`  记忆供应商: ${report.summary.availableMemoryProviders}`)
    console.log(`  代码图谱供应商: ${report.summary.availableCodeProviders}`)
    if (report.summary.blockingIssues.length > 0) {
      console.log('  阻塞详情:')
      for (const issue of report.summary.blockingIssues) console.log(`    - ${issue}`)
    }
    if (report.warnings.length > 0) {
      console.log(`  警告${report.warnings.length > 12 ? ` (显示前 12 条，共 ${report.warnings.length} 条)` : ''}:`)
      for (const warning of report.warnings.slice(0, 12)) console.log(`    - ${warning}`)
    }
    if (report.recommendations.length > 0) {
      console.log('  下一步:')
      for (const command of report.recommendations.slice(0, 12)) console.log(`    ${command}`)
    }
    return
  }

  console.log('\nSCALE Setup Verification')
  console.log(`  Project: ${report.projectDir}`)
  console.log(`  Packs: ${report.packIds.join(', ') || 'full'}`)
  console.log(`  Result: ${report.ok ? 'passed' : 'failed'}`)
  console.log(`  Blocking issues: ${report.summary.blockingIssues.length}`)
  console.log(`  Governed capabilities: ${report.summary.installedTools}/${report.summary.totalTools}`)
  console.log(`  Memory providers: ${report.summary.availableMemoryProviders}`)
  console.log(`  Code providers: ${report.summary.availableCodeProviders}`)
  if (report.summary.blockingIssues.length > 0) {
    console.log('  Blockers:')
    for (const issue of report.summary.blockingIssues) console.log(`    - ${issue}`)
  }
  if (report.warnings.length > 0) {
    console.log(`  Warnings${report.warnings.length > 12 ? ` (showing first 12 of ${report.warnings.length})` : ''}:`)
    for (const warning of report.warnings.slice(0, 12)) console.log(`    - ${warning}`)
  }
  if (report.recommendations.length > 0) {
    console.log('  Next:')
    for (const command of report.recommendations.slice(0, 12)) console.log(`    ${command}`)
  }
}

const configProfile = defineCommand({
  meta: { name: 'profile', description: 'View or switch configuration profile' },
  args: {
    set: { type: 'string', default: '', description: 'Switch to profile (minimal/standard/advanced)' },
    'governance-pack': { type: 'string', description: 'Optional governance pack hint for bootstrap suggestions, for example frontend-app' },
    list: { type: 'boolean', default: false, description: 'List all available profiles' },
    json: { type: 'boolean', default: false, description: 'Output as JSON' },
  },
  async run({ args }) {
    if (args.list) {
      const profiles = listConfigProfiles()
      if (args.json) {
        console.log(JSON.stringify(profiles, null, 2))
        return
      }
      console.log('\nAvailable profiles:\n')
      for (const p of profiles) {
        console.log(`  ${p.id.padEnd(12)} ${p.name} — ${p.description}`)
      }
      console.log(`\nUse: scale config profile --set <id>`)
      return
    }

    if (args.set) {
      const profile = getConfigProfile(args.set)
      if (profile.id !== args.set) {
        console.log(`\n⚠️  Profile "${args.set}" not found. Available: minimal, standard, advanced`)
        return
      }
      const bootstrapPlan = getBootstrapPlanForProfile(profile.id, args['governance-pack'] ? String(args['governance-pack']) : undefined)
      // Update config.yaml
      const configPath = join('.scale', 'config.yaml')
      const projectName = process.cwd().split(/[/\\]/).pop() || 'Project'
      const content = generateConfigForProfile(args.set, { name: projectName })
      ensureDir('.scale')
      writeFileSync(configPath, content, 'utf-8')
      if (args.json) {
        console.log(JSON.stringify({
          ok: true,
          profile: profile.id,
          name: profile.name,
          description: profile.description,
          sections: profile.sections,
          bootstrapPacks: bootstrapPlan.packs,
          dependencyBootstrapCommand: bootstrapPlan.inspectCommand,
          dependencyBootstrapApplyCommand: bootstrapPlan.applyCommand,
          configPath,
        }, null, 2))
        return
      }
      console.log(`\n✅ Profile switched to: ${profile.name}`)
      console.log(`   ${profile.description}`)
      console.log(`\n📄 Config updated: ${configPath}`)
      return
    }

    // Show current profile
    const configPath = join('.scale', 'config.yaml')
    if (!existsSync(configPath)) {
      console.log('\n⚠️  No config.yaml found. Run: scale init')
      return
    }
    const content = readFileSync(configPath, 'utf-8')
    const match = content.match(/^profile:\s*(.+)$/m)
    const currentProfile = match?.[1]?.trim() || 'standard'
    const profile = getConfigProfile(currentProfile)
    const bootstrapPlan = getBootstrapPlanForProfile(profile.id, args['governance-pack'] ? String(args['governance-pack']) : undefined)

    if (args.json) {
      console.log(JSON.stringify({
        profile: profile.id,
        name: profile.name,
        description: profile.description,
        sections: profile.sections,
        bootstrapPacks: bootstrapPlan.packs,
        dependencyBootstrapCommand: bootstrapPlan.inspectCommand,
        dependencyBootstrapApplyCommand: bootstrapPlan.applyCommand,
      }, null, 2))
      return
    }
    console.log(`\nCurrent profile: ${profile.name} (${profile.id})`)
    console.log(`  ${profile.description}`)
    console.log(`\nSections: ${profile.sections.join(', ')}`)
    console.log(`Bootstrap packs: ${bootstrapPlan.packs.join(', ')}`)
    console.log(`Dependency bootstrap: ${bootstrapPlan.inspectCommand}`)
    console.log(`\nUse: scale config profile --set <id> to switch`)
  },
})

const config = defineCommand({
  meta: { name: 'config', description: 'Configuration management' },
  subCommands: { profile: configProfile },
})

const governanceDiff = defineCommand({
  meta: { name: 'diff', description: 'Check generated governance files for drift' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = computeGovernanceDrift(args.dir)
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    if (!report.lockExists) {
      console.log('No governance lock found. Run: scale init --governance-pack <pack>')
      return
    }
    if (report.missing.length === 0 && report.changed.length === 0) {
      console.log('Governance generated files are clean.')
      return
    }
    for (const item of report.missing) console.log(`missing: ${item.path}`)
    for (const item of report.changed) console.log(`changed: ${item.path}`)
  },
})

const governanceModeCommand = defineCommand({
  meta: { name: 'mode', description: 'Evaluate progressive governance mode from task text and changed files' },
  args: {
    task: { type: 'string', description: 'Task or requirement description' },
    files: { type: 'string', description: 'Comma-separated changed or target files' },
    'requested-mode': { type: 'string', description: 'Requested governance mode: minimal, standard, expanded, or critical' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const report = evaluateProgressiveGovernance({
      task: args.task ? String(args.task) : undefined,
      changedFiles: parseCommaList(args.files),
      requestedMode: normalizeGovernanceMode(args['requested-mode']),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log('SCALE Progressive Governance')
    console.log(`  Recommended: ${report.recommendedMode}`)
    console.log(`  Effective: ${report.effectiveMode}`)
    if (report.escalated) console.log(`  Escalated from requested mode: ${report.requestedMode}`)
    for (const signal of report.signals) {
      console.log(`  [${signal.mode}] ${signal.id}: ${signal.reason}`)
    }
    for (const behavior of report.requiredBehaviors) {
      console.log(`  behavior: ${behavior}`)
    }
  },
})

const governanceRoiCommand = defineCommand({
  meta: { name: 'roi', description: 'Report benefit and overhead signals for active governance modules' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'task-id': { type: 'string', description: 'Task id' },
    task: { type: 'string', description: 'Task or requirement description' },
    files: { type: 'string', description: 'Comma-separated changed or target files' },
    'requested-mode': { type: 'string', description: 'Requested governance mode' },
    'code-query': { type: 'string', description: 'Optional code intelligence query to include in ROI' },
    symbol: { type: 'string', description: 'Optional symbol impact query to include in ROI' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const governanceReport = evaluateProgressiveGovernance({
      task: args.task ? String(args.task) : undefined,
      changedFiles: parseCommaList(args.files),
      requestedMode: normalizeGovernanceMode(args['requested-mode']),
    })
    const contextBudget = scanContextBudget({ projectDir, scaleDir })
    const codeIntelligence = args.symbol
      ? impactCodeGraph({ projectDir, scaleDir, symbol: String(args.symbol) })
      : args['code-query']
        ? queryCodeGraph({ projectDir, scaleDir, query: String(args['code-query']) })
        : undefined
    const report = createGovernanceRoiReport({
      taskId: args['task-id'] ? String(args['task-id']) : undefined,
      contextBudget,
      governance: governanceReport,
      codeIntelligence,
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log('SCALE Governance ROI')
    console.log(`  Recommendation: ${report.summary.recommendation}`)
    for (const module of report.modules) {
      console.log(`  [${module.evidenceLevel}] ${module.module}`)
      console.log(`    benefit: ${module.benefit}`)
      console.log(`    overhead: ${module.overhead}`)
      console.log(`    recommendation: ${module.recommendation}`)
    }
  },
})

const governance = defineCommand({
  meta: { name: 'governance', description: 'Governance template pack tools' },
  subCommands: { diff: governanceDiff, mode: governanceModeCommand, roi: governanceRoiCommand },
})

const aiOsPlanCommand = defineCommand({
  meta: { name: 'plan', description: 'Create a unified AI OS runtime plan for governance, context, memory, skills, and ROI' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'task-id': { type: 'string', description: 'Task id' },
    task: { type: 'string', required: true, description: 'Task or requirement description' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    files: { type: 'string', description: 'Comma-separated changed or target files' },
    services: { type: 'string', description: 'Comma-separated affected services' },
    budget: { type: 'string', description: 'Maximum estimated tokens for the context compiler' },
    'requested-mode': { type: 'string', description: 'Requested governance mode: minimal, standard, expanded, or critical' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const plan = await createAiOsPlan({
      projectDir,
      scaleDir,
      taskId: args['task-id'] ? String(args['task-id']) : undefined,
      task: String(args.task),
      level: normalizeTaskArtifactLevel(args.level),
      files: parseCommaList(args.files),
      services: parseCommaList(args.services),
      budget: parsePositiveIntArg(args.budget, '--budget'),
      requestedMode: normalizeGovernanceMode(args['requested-mode']),
    })
    if (args.json) {
      console.log(JSON.stringify(plan, null, 2))
      return
    }
    console.log('SCALE AI OS Runtime Plan')
    console.log(`  Version: ${plan.version}`)
    console.log(`  Task: ${plan.task.taskId ?? 'n/a'} ${plan.task.task}`)
    console.log(`  Governance: ${plan.governance.effectiveMode}`)
    console.log(`  Context: ${plan.context.totalEstimatedTokens}/${plan.context.task.budget} tokens; saved ${plan.context.compiler?.estimatedTokenSavings ?? 0}`)
    console.log(`  Memory: ${plan.memory.items.length} item(s); providers ${plan.memory.providerOrder.join(' -> ')}`)
    console.log(`  Skill steps: ${plan.skillPlan.executionPlan.steps.length}`)
    console.log(`  ROI: ${plan.roi.summary.recommendation}`)
    for (const recommendation of plan.recommendations) console.log(`  recommendation: ${recommendation}`)
  },
})

const aiOsRunCommand = defineCommand({
  meta: { name: 'run', description: 'Run the AI OS beta loop in dry-run or guarded mode and write an execution report' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'task-id': { type: 'string', description: 'Task id' },
    task: { type: 'string', required: true, description: 'Task or requirement description' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    files: { type: 'string', description: 'Comma-separated changed or target files' },
    services: { type: 'string', description: 'Comma-separated affected services' },
    budget: { type: 'string', description: 'Maximum estimated tokens for the context compiler' },
    'requested-mode': { type: 'string', description: 'Requested governance mode: minimal, standard, expanded, or critical' },
    verify: { type: 'string', description: 'Comma-separated guarded verification commands to run without shell by default' },
    timeout: { type: 'string', description: 'Verification command timeout in milliseconds' },
    mode: { type: 'string', description: 'Run mode: dry-run or guarded' },
    'dry-run': { type: 'boolean', default: false, description: 'Force dry-run mode without executing external commands' },
    'allow-shell': { type: 'boolean', default: false, description: 'Allow shell execution for trusted local guarded runs' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const report = await createAiOsRun({
      projectDir,
      scaleDir,
      taskId: args['task-id'] ? String(args['task-id']) : undefined,
      task: String(args.task),
      level: normalizeTaskArtifactLevel(args.level),
      files: parseCommaList(args.files),
      services: parseCommaList(args.services),
      budget: parsePositiveIntArg(args.budget, '--budget'),
      requestedMode: normalizeGovernanceMode(args['requested-mode']),
      mode: normalizeAiOsRunMode(args.mode, Boolean(args['dry-run'])),
      verificationCommands: parseCommaList(args.verify),
      commandTimeoutMs: parsePositiveIntArg(args.timeout, '--timeout'),
      allowShell: Boolean(args['allow-shell']),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (report.status === 'blocked') process.exitCode = 1
      return
    }
    console.log('SCALE AI OS Runtime Run')
    console.log(`  Version: ${report.version}`)
    console.log(`  Mode: ${report.mode}`)
    console.log(`  Status: ${report.status}`)
    console.log(`  Task: ${report.plan.task.taskId ?? 'n/a'} ${report.plan.task.task}`)
    console.log(`  Steps: ${report.steps.filter(step => step.status === 'passed').length} passed, ${report.steps.filter(step => step.status === 'planned').length} planned, ${report.steps.filter(step => step.status === 'blocked').length} blocked`)
    console.log(`  Verification: ${report.verification.commands.filter(command => command.status === 'passed').length}/${report.verification.commands.length} passed`)
    console.log(`  Evidence: ${report.evidence.produced.length} produced, ${report.evidence.pending.length} pending`)
    console.log(`  Report: ${report.artifacts.runReport}`)
    for (const action of report.nextActions.slice(0, 6)) console.log(`  next: ${action}`)
    if (report.status === 'blocked') process.exitCode = 1
  },
})

const aiOsDashboardCommand = defineCommand({
  meta: { name: 'dashboard', description: 'Summarize AI OS runtime run reports and verification health' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    limit: { type: 'string', description: 'Maximum latest run rows to include' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const dashboard = createAiOsDashboard({
      projectDir,
      scaleDir,
      limit: parsePositiveIntArg(args.limit, '--limit'),
    })
    if (args.json) {
      console.log(JSON.stringify(dashboard, null, 2))
      return
    }
    console.log('SCALE AI OS Dashboard')
    console.log(`  Health: ${dashboard.health.status} (${dashboard.health.score})`)
    console.log(`  Runs: ${dashboard.summary.totalRuns} total, ${dashboard.summary.readyRuns} ready, ${dashboard.summary.blockedRuns} blocked`)
    console.log(`  Verification: ${dashboard.summary.verificationCommands} command(s), ${dashboard.summary.failedVerificationCommands} failed`)
    console.log(`  Failure learning: ${dashboard.summary.failureLearningCandidates} candidate(s)`)
    for (const run of dashboard.latestRuns) {
      console.log(`  [${run.status}] ${run.taskId ?? 'n/a'} ${run.task}`)
    }
    for (const recommendation of dashboard.recommendations) console.log(`  recommendation: ${recommendation}`)
    for (const warning of dashboard.warnings) console.log(`  warning: ${warning}`)
  },
})

const aiOsBenchmarkCommand = defineCommand({
  meta: { name: 'benchmark', description: 'Run fixed AI OS beta benchmark scenarios for context, memory, skill, governance, and dashboard metrics' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    budget: { type: 'string', description: 'Scenario context budget' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const benchmark = await createAiOsBenchmark({
      projectDir,
      scaleDir,
      budget: parsePositiveIntArg(args.budget, '--budget'),
    })
    if (args.json) {
      console.log(JSON.stringify(benchmark, null, 2))
      return
    }
    console.log('SCALE AI OS Benchmark')
    console.log(`  Scenarios: ${benchmark.summary.scenarios}`)
    console.log(`  Tokens: ${benchmark.summary.totalEstimatedTokens}/${benchmark.summary.totalBudget}; saved ${benchmark.summary.totalEstimatedTokenSavings}`)
    console.log(`  Memory items: ${benchmark.summary.totalMemoryItems}`)
    console.log(`  Skill steps: ${benchmark.summary.totalSkillSteps} (${benchmark.summary.requiredSkillSteps} required)`)
    console.log(`  Governance modes: ${benchmark.summary.governanceModes.join(', ') || 'none'}`)
    console.log(`  Dashboard health: ${benchmark.dashboard.health.status}`)
    for (const scenario of benchmark.scenarios) {
      console.log(`  [${scenario.governanceMode}] ${scenario.id}: tokens=${scenario.metrics.estimatedTokens}, skills=${scenario.metrics.skillSteps}, memory=${scenario.metrics.memoryItems}`)
    }
    for (const recommendation of benchmark.recommendations) console.log(`  recommendation: ${recommendation}`)
  },
})

const aiOsMigrateCommand = defineCommand({
  meta: { name: 'migrate', description: 'Create or verify AI OS runtime state directories for this project' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const report = createAiOsMigration({ projectDir, scaleDir })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log('SCALE AI OS Migration')
    console.log(`  Status: ${report.status}`)
    console.log(`  Created: ${report.created.length}`)
    console.log(`  Existing: ${report.existing.length}`)
    console.log(`  Report: ${report.files.migrationReport}`)
    for (const action of report.nextActions) console.log(`  next: ${action}`)
    for (const warning of report.warnings) console.log(`  warning: ${warning}`)
  },
})

const aiOsDoctorCommand = defineCommand({
  meta: { name: 'doctor', description: 'Check AI OS beta runtime readiness, dashboard health, and benchmark freshness' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    lang: { type: 'string', default: 'en', description: 'Output language zh/en' },
    'benchmark-max-age-hours': { type: 'string', description: 'Maximum accepted benchmark report age in hours' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const report = createAiOsDoctor({
      projectDir,
      scaleDir,
      lang: normalizeLangArg(args.lang),
      benchmarkMaxAgeHours: parsePositiveIntArg(args['benchmark-max-age-hours'], '--benchmark-max-age-hours'),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (report.status === 'blocked') process.exitCode = 1
      return
    }
    console.log('SCALE AI OS Doctor')
    console.log(`  Status: ${report.status}`)
    console.log(`  Checks: ${report.summary.passedChecks} passed, ${report.summary.warningChecks} warning, ${report.summary.blockedChecks} blocked`)
    console.log(`  Dashboard: ${report.dashboard.health.status} (${report.dashboard.health.score})`)
    console.log(`  Benchmark: ${report.benchmark.status}`)
    for (const check of report.checks) console.log(`  [${check.status}] ${check.id}: ${check.summary}`)
    for (const action of report.nextActions) console.log(`  next: ${action}`)
    for (const warning of report.warnings) console.log(`  warning: ${warning}`)
    if (report.status === 'blocked') process.exitCode = 1
  },
})

const aiOsAdoptCommand = defineCommand({
  meta: { name: 'adopt', description: 'Prepare a project for AI OS runtime use by running migrate, first dry-run, benchmark, and doctor' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'task-id': { type: 'string', description: 'Task id for the first adoption dry-run report' },
    task: { type: 'string', required: true, description: 'Task or adoption scenario description' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    files: { type: 'string', description: 'Comma-separated changed or target files' },
    services: { type: 'string', description: 'Comma-separated affected services' },
    budget: { type: 'string', description: 'Maximum estimated tokens for the adoption plan and benchmark' },
    'requested-mode': { type: 'string', description: 'Requested governance mode: minimal, standard, expanded, or critical' },
    lang: { type: 'string', default: 'en', description: 'Output language zh/en' },
    'benchmark-max-age-hours': { type: 'string', description: 'Maximum accepted benchmark report age in hours' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const lang = normalizeLangArg(args.lang)
    const report = await createAiOsAdoption({
      projectDir,
      scaleDir,
      taskId: args['task-id'] ? String(args['task-id']) : undefined,
      task: String(args.task),
      level: normalizeTaskArtifactLevel(args.level),
      files: parseCommaList(args.files),
      services: parseCommaList(args.services),
      budget: parsePositiveIntArg(args.budget, '--budget'),
      requestedMode: normalizeGovernanceMode(args['requested-mode']),
      lang,
      benchmarkMaxAgeHours: parsePositiveIntArg(args['benchmark-max-age-hours'], '--benchmark-max-age-hours'),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (report.status === 'blocked') process.exitCode = 1
      return
    }
    if (lang === 'zh') {
      console.log('SCALE AI OS 接入')
      console.log(`  状态: ${report.status}`)
      console.log(`  迁移: ${report.migration.status}`)
      console.log(`  首次运行: ${report.run.status} (${report.run.mode})`)
      console.log(`  基准: ${report.benchmark.summary.scenarios} 个场景`)
      console.log(`  Doctor: ${report.doctor.status}`)
      console.log(`  报告: ${report.artifacts.adoptionReport}`)
      for (const phase of report.phases) console.log(`  [${phase.status}] ${phase.id}: ${phase.summary}`)
      for (const action of report.nextActions) console.log(`  下一步: ${action}`)
      for (const warning of report.warnings) console.log(`  警告: ${warning}`)
    } else {
      console.log('SCALE AI OS Adoption')
      console.log(`  Status: ${report.status}`)
      console.log(`  Migration: ${report.migration.status}`)
      console.log(`  First run: ${report.run.status} (${report.run.mode})`)
      console.log(`  Benchmark: ${report.benchmark.summary.scenarios} scenario(s)`)
      console.log(`  Doctor: ${report.doctor.status}`)
      console.log(`  Report: ${report.artifacts.adoptionReport}`)
      for (const phase of report.phases) console.log(`  [${phase.status}] ${phase.id}: ${phase.summary}`)
      for (const action of report.nextActions) console.log(`  next: ${action}`)
      for (const warning of report.warnings) console.log(`  warning: ${warning}`)
    }
    if (report.status === 'blocked') process.exitCode = 1
  },
})

const aiOsStatusCommand = defineCommand({
  meta: { name: 'status', description: 'Show AI OS closed-loop readiness across runtime, run, verification, dashboard, benchmark, and adoption evidence' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    lang: { type: 'string', default: 'en', description: 'Output language zh/en' },
    'benchmark-max-age-hours': { type: 'string', description: 'Maximum accepted benchmark report age in hours' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const lang = normalizeLangArg(args.lang)
    const report = createAiOsStatus({
      projectDir,
      scaleDir,
      benchmarkMaxAgeHours: parsePositiveIntArg(args['benchmark-max-age-hours'], '--benchmark-max-age-hours'),
      lang,
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (report.status === 'blocked') process.exitCode = 1
      return
    }
    if (lang === 'zh') {
      console.log('SCALE AI OS 状态')
      console.log(`  状态: ${report.status}`)
      console.log(`  检查: ${report.summary.ready} ready, ${report.summary.warning} warning, ${report.summary.blocked} blocked`)
      console.log(`  Dashboard: ${report.dashboard.health.status} (${report.dashboard.health.score})`)
      console.log(`  Doctor: ${report.doctor.status}`)
      console.log(`  Intelligence: ${report.intelligence.status} (${report.intelligence.summary.ready} ready, ${report.intelligence.summary.warning} warning, ${report.intelligence.summary.blocked} blocked)`)
      console.log(`  Context risk: ${report.intelligence.summary.contextQuality.compressionRisk}; omitted ${report.intelligence.summary.contextQuality.omittedSections} section(s), evidence warnings ${report.intelligence.summary.contextQuality.evidenceLossWarnings.length}`)
      console.log(`  Evaluator gates: ${report.intelligence.summary.evaluatorQuality.requiredGates}; uncertainty ${report.intelligence.summary.evaluatorQuality.averageUncertainty}`)
      console.log(`  Tool strategy: ${report.intelligence.summary.toolStrategyQuality.totalSteps} step(s), cost ${report.intelligence.summary.toolStrategyQuality.estimatedCostUnits}, fallback ${report.intelligence.summary.toolStrategyQuality.fallbackCoverage}`)
      for (const signal of report.intelligence.signals) console.log(`  [${signal.status}] ${signal.id}: ${signal.summary}`)
      for (const check of report.checks) console.log(`  [${check.status}] ${check.id}: ${check.summary}`)
      if (report.verificationRecommendations.length > 0) {
        console.log('  验证建议:')
        for (const recommendation of report.verificationRecommendations) {
          console.log(`    - ${recommendation.command} (${recommendation.source})`)
        }
      }
      for (const action of report.nextActions) console.log(`  下一步: ${action}`)
      for (const warning of report.warnings) console.log(`  警告: ${warning}`)
    } else {
      console.log('SCALE AI OS Status')
      console.log(`  Status: ${report.status}`)
      console.log(`  Checks: ${report.summary.ready} ready, ${report.summary.warning} warning, ${report.summary.blocked} blocked`)
      console.log(`  Dashboard: ${report.dashboard.health.status} (${report.dashboard.health.score})`)
      console.log(`  Doctor: ${report.doctor.status}`)
      console.log(`  Intelligence: ${report.intelligence.status} (${report.intelligence.summary.ready} ready, ${report.intelligence.summary.warning} warning, ${report.intelligence.summary.blocked} blocked)`)
      console.log(`  Context risk: ${report.intelligence.summary.contextQuality.compressionRisk}; omitted ${report.intelligence.summary.contextQuality.omittedSections} section(s), evidence warnings ${report.intelligence.summary.contextQuality.evidenceLossWarnings.length}`)
      console.log(`  Evaluator gates: ${report.intelligence.summary.evaluatorQuality.requiredGates}; uncertainty ${report.intelligence.summary.evaluatorQuality.averageUncertainty}`)
      console.log(`  Tool strategy: ${report.intelligence.summary.toolStrategyQuality.totalSteps} step(s), cost ${report.intelligence.summary.toolStrategyQuality.estimatedCostUnits}, fallback ${report.intelligence.summary.toolStrategyQuality.fallbackCoverage}`)
      for (const signal of report.intelligence.signals) console.log(`  [${signal.status}] ${signal.id}: ${signal.summary}`)
      for (const check of report.checks) console.log(`  [${check.status}] ${check.id}: ${check.summary}`)
      if (report.verificationRecommendations.length > 0) {
        console.log('  Verification recommendations:')
        for (const recommendation of report.verificationRecommendations) {
          console.log(`    - ${recommendation.command} (${recommendation.source})`)
        }
      }
      for (const action of report.nextActions) console.log(`  next: ${action}`)
      for (const warning of report.warnings) console.log(`  warning: ${warning}`)
    }
    if (report.status === 'blocked') process.exitCode = 1
  },
})

const aiOs = defineCommand({
  meta: { name: 'ai-os', description: 'AI Engineering OS runtime planning and governance orchestration' },
  subCommands: {
    adopt: aiOsAdoptCommand,
    status: aiOsStatusCommand,
    plan: aiOsPlanCommand,
    run: aiOsRunCommand,
    dashboard: aiOsDashboardCommand,
    benchmark: aiOsBenchmarkCommand,
    migrate: aiOsMigrateCommand,
    doctor: aiOsDoctorCommand,
  },
})

// ============================================================================
// upgrade command - Safe workflow/template/capability update planning
// ============================================================================

const upgradeCheck = defineCommand({
  meta: { name: 'check', description: '检查 SCALE 工作流、治理包和第三方能力更新状态 / Check SCALE workflow, governance pack, and third-party capability update status' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: '项目目录 / Project directory' },
    'target-version': { type: 'string', description: '目标 SCALE Engine 版本，默认使用当前 CLI 版本 / Target SCALE Engine version' },
    lang: { type: 'string', default: 'zh', description: '输出语言 zh/en / Output language' },
    json: { type: 'boolean', default: false, description: '输出 JSON / Print JSON output' },
  },
  run({ args }) {
    const lang = normalizeLangArg(args.lang)
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const report = createUpgradeCheckReport({
      projectDir,
      scaleDir: resolveScaleDirForProject(projectDir),
      targetScaleVersion: args['target-version'] ? String(args['target-version']) : undefined,
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    if (lang === 'zh') {
      console.log('SCALE 升级检查')
      console.log(`  项目: ${report.projectDir}`)
      console.log(`  状态: ${report.status}`)
      console.log(`  SCALE Engine: ${report.scaleEngine.currentVersion ?? '无'} -> ${report.scaleEngine.latestVersion}`)
      console.log(`  治理包: ${report.governancePack.id ?? '无'} v${report.governancePack.currentVersion ?? '无'} -> v${report.governancePack.latestVersion ?? '无'}`)
      console.log(`  受管生成文件: ${report.generatedFiles.clean} 个干净, ${report.generatedFiles.changed} 个本地改动, ${report.generatedFiles.missing} 个缺失`)
      console.log(`  第三方能力策略: ${report.thirdParty.policy}; 需要人工审查: ${report.thirdParty.reviewRequired}`)
      console.log(`  AI OS Runtime: ${report.aiOsRuntime.status}`)
      console.log('  下一步:')
    } else {
      console.log('SCALE Upgrade Check')
      console.log(`  Project: ${report.projectDir}`)
      console.log(`  Status: ${report.status}`)
      console.log(`  SCALE Engine: ${report.scaleEngine.currentVersion ?? 'none'} -> ${report.scaleEngine.latestVersion}`)
      console.log(`  Governance pack: ${report.governancePack.id ?? 'none'} v${report.governancePack.currentVersion ?? 'none'} -> v${report.governancePack.latestVersion ?? 'none'}`)
      console.log(`  Generated files: ${report.generatedFiles.clean} clean, ${report.generatedFiles.changed} changed, ${report.generatedFiles.missing} missing`)
      console.log(`  Third-party policy: ${report.thirdParty.policy}; review required: ${report.thirdParty.reviewRequired}`)
      console.log(`  AI OS Runtime: ${report.aiOsRuntime.status}`)
      console.log('  Next:')
    }
    for (const command of report.recommendedCommands) console.log(`    ${formatUpgradeCommand(command, lang)}`)
  },
})

const upgradePlan = defineCommand({
  meta: { name: 'plan', description: '生成非破坏性的 SCALE 升级计划 / Create a non-destructive SCALE upgrade plan' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: '项目目录 / Project directory' },
    'target-version': { type: 'string', description: '目标 SCALE Engine 版本，默认使用当前 CLI 版本 / Target SCALE Engine version' },
    html: { type: 'boolean', default: false, description: '写入 .scale/reports/upgrade-plan.html / Write HTML plan' },
    lang: { type: 'string', default: 'zh', description: '输出语言 zh/en / Output language' },
    json: { type: 'boolean', default: false, description: '输出 JSON / Print JSON output' },
  },
  run({ args }) {
    const lang = normalizeLangArg(args.lang)
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const report = createUpgradePlanReport({
      projectDir,
      scaleDir: resolveScaleDirForProject(projectDir),
      targetScaleVersion: args['target-version'] ? String(args['target-version']) : undefined,
    })
    const htmlPath = args.html ? writeUpgradePlanHtml(report, undefined, lang) : undefined
    if (args.json) {
      console.log(JSON.stringify({ ...report, htmlPath }, null, 2))
      return
    }
    if (lang === 'zh') {
      console.log('SCALE 升级计划')
      console.log(`  项目: ${report.projectDir}`)
      console.log(`  状态: ${report.status}`)
      console.log(`  应用模式: ${report.applyMode}`)
    } else {
      console.log('SCALE Upgrade Plan')
      console.log(`  Project: ${report.projectDir}`)
      console.log(`  Status: ${report.status}`)
      console.log(`  Apply mode: ${report.applyMode}`)
    }
    if (report.blockers.length > 0) {
      console.log(lang === 'zh' ? '  阻塞项:' : '  Blockers:')
      for (const blocker of report.blockers) console.log(`    [${blocker.code}] ${blocker.path ?? ''} ${formatUpgradeBlockerMessage(blocker.code, blocker.message, lang)}`)
    }
    console.log(lang === 'zh' ? '  步骤:' : '  Steps:')
    for (const step of report.steps) {
      const path = step.path ? ` ${step.path}` : ''
      const command = step.command ? ` -> ${formatUpgradeCommand(step.command, lang)}` : ''
      console.log(`    [${step.risk}] ${step.action}${path}: ${formatUpgradeStepReason(step.action, step.reason, lang)}${command}`)
    }
    if (htmlPath) console.log(`  HTML: ${htmlPath}`)
  },
})

const upgradeApply = defineCommand({
  meta: { name: 'apply', description: '按已审阅计划安全应用升级 / Guarded entrypoint for applying an upgrade plan' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: '项目目录 / Project directory' },
    confirm: { type: 'boolean', default: false, description: '确认当前升级计划已经审阅 / Confirm the current plan was reviewed' },
    lang: { type: 'string', default: 'zh', description: '输出语言 zh/en / Output language' },
    json: { type: 'boolean', default: false, description: '输出 JSON / Print JSON output' },
  },
  run({ args }) {
    const lang = normalizeLangArg(args.lang)
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const result = applyUpgradePlan({
      projectDir,
      scaleDir: resolveScaleDirForProject(projectDir),
      confirm: isTruthyFlag(args.confirm),
    })
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      if (!result.ok) process.exitCode = 1
      return
    }
    console.log(lang === 'zh' ? 'SCALE 应用升级' : 'SCALE Upgrade Apply')
    console.log(lang === 'zh' ? `  已应用: ${result.applied}` : `  Applied: ${result.applied}`)
    console.log(lang === 'zh' ? `  原因: ${formatUpgradeApplyReason(result.reason, lang)}` : `  Reason: ${result.reason}`)
    console.log(lang === 'zh' ? `  应用模式: ${result.plan.applyMode}` : `  Apply mode: ${result.plan.applyMode}`)
    if (result.backup) console.log(lang === 'zh' ? `  备份: ${result.backup.manifestPath}` : `  Backup: ${result.backup.manifestPath}`)
    for (const path of result.changedFiles) console.log(lang === 'zh' ? `  已变更: ${path}` : `  changed: ${path}`)
    if (!result.ok) process.exitCode = 1
  },
})

const upgradeRollback = defineCommand({
  meta: { name: 'rollback', description: '回滚最近一次 SCALE 托管升级 / Roll back the latest SCALE-managed upgrade' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: '项目目录 / Project directory' },
    lang: { type: 'string', default: 'zh', description: '输出语言 zh/en / Output language' },
    json: { type: 'boolean', default: false, description: '输出 JSON / Print JSON output' },
  },
  run({ args }) {
    const lang = normalizeLangArg(args.lang)
    const result = rollbackLatestUpgrade({ projectDir: args.dir })
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      if (!result.ok) process.exitCode = 1
      return
    }
    console.log(lang === 'zh' ? 'SCALE 升级回滚' : 'SCALE Upgrade Rollback')
    console.log(lang === 'zh' ? `  已回滚: ${result.applied}` : `  Applied: ${result.applied}`)
    console.log(lang === 'zh' ? `  原因: ${formatUpgradeApplyReason(result.reason, lang)}` : `  Reason: ${result.reason}`)
    if (result.backup) console.log(lang === 'zh' ? `  备份: ${result.backup.manifestPath}` : `  Backup: ${result.backup.manifestPath}`)
    for (const path of result.restoredFiles) console.log(lang === 'zh' ? `  已恢复: ${path}` : `  restored: ${path}`)
    if (!result.ok) process.exitCode = 1
  },
})

const upgrade = defineCommand({
  meta: { name: 'upgrade', description: 'SCALE 工作流、模板、skills、MCP、CLI 工具的安全升级向导 / Safe update wizard for workflow assets' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: '项目目录 / Project directory' },
    'target-version': { type: 'string', description: '目标 SCALE Engine 版本，默认使用当前 CLI 版本 / Target SCALE Engine version' },
    apply: { type: 'boolean', default: false, description: '直接应用安全升级计划 / Apply safe upgrade plan' },
    yes: { type: 'boolean', default: false, description: '非交互确认 / Confirm without prompting' },
    html: { type: 'boolean', default: true, description: '写入 HTML 升级计划 / Write HTML plan' },
    interactive: { type: 'boolean', default: true, description: '启用升级向导交互 / Enable upgrade wizard prompts' },
    lang: { type: 'string', default: 'zh', description: '输出语言 zh/en / Output language' },
    json: { type: 'boolean', default: false, description: '输出 JSON / Print JSON output' },
  },
  subCommands: { check: upgradeCheck, plan: upgradePlan, apply: upgradeApply, rollback: upgradeRollback },
  async run({ args }) {
    if (isUpgradeSubcommandInvocation(process.argv)) return
    const lang = normalizeLangArg(args.lang)
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const targetScaleVersion = args['target-version'] ? String(args['target-version']) : undefined
    const plan = createUpgradePlanReport({ projectDir, scaleDir, targetScaleVersion })
    const htmlPath = args.html ? writeUpgradePlanHtml(plan, undefined, lang) : undefined
    const canApply = plan.applyMode === 'safe' && plan.blockers.length === 0
    const interactive = isTruthyFlag(args.interactive) && !args.json && Boolean(process.stdin.isTTY) && !isTruthyFlag(args.yes)
    let apply = isTruthyFlag(args.apply) || isTruthyFlag(args.yes)
    let cancelled = false

    if (interactive && canApply && !apply) {
      const answer = await askUpgradeWizardQuestion(lang === 'zh'
        ? '发现可安全应用的升级计划。现在应用吗？1=仅生成计划 2=应用 3=取消，默认 1: '
        : 'Safe upgrade plan found. Apply now? 1=plan only 2=apply 3=cancel, default 1: ')
      const normalized = answer.trim().toLowerCase()
      apply = normalized === '2' || normalized === 'apply' || normalized === 'yes' || normalized === 'y'
      cancelled = normalized === '3' || normalized === 'cancel' || normalized === 'c'
    }

    const applyResult = apply && !cancelled
      ? applyUpgradePlan({ projectDir, scaleDir, confirm: true })
      : undefined
    const ok = !cancelled && (!applyResult || applyResult.ok)
    const report = { ok, cancelled, htmlPath, plan, applyResult }

    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!ok) process.exitCode = 1
      return
    }

    renderUpgradeWizardReport(report, lang)
    if (!ok) process.exitCode = 1
  },
})

async function askUpgradeWizardQuestion(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await new Promise(resolve => rl.question(question, resolve))
  } finally {
    rl.close()
  }
}

function isUpgradeSubcommandInvocation(argv: string[]): boolean {
  const upgradeIndex = argv.findIndex((value, index) => index > 1 && value === 'upgrade')
  if (upgradeIndex < 0) return false
  const positional = argv.slice(upgradeIndex + 1).find(value => !value.startsWith('-') && !value.includes('='))
  return positional === 'check' || positional === 'plan' || positional === 'apply' || positional === 'rollback'
}

function renderUpgradeWizardReport(report: {
  ok: boolean
  cancelled: boolean
  htmlPath?: string
  plan: ReturnType<typeof createUpgradePlanReport>
  applyResult?: ReturnType<typeof applyUpgradePlan>
}, lang: 'zh' | 'en'): void {
  const plan = report.plan
  if (lang === 'zh') {
    console.log('\nSCALE 升级向导')
    console.log(`  项目: ${plan.projectDir}`)
    console.log(`  状态: ${plan.status}`)
    console.log(`  应用模式: ${plan.applyMode}`)
    console.log(`  阻塞项: ${plan.blockers.length}`)
    console.log(`  步骤数: ${plan.steps.length}`)
    if (report.htmlPath) console.log(`  HTML 计划: ${report.htmlPath}`)
    if (report.cancelled) console.log('  结果: 已取消')
    else if (report.applyResult) {
      console.log(`  结果: ${report.applyResult.applied ? '已应用' : '未应用'}`)
      console.log(`  原因: ${formatUpgradeApplyReason(report.applyResult.reason, lang)}`)
      for (const path of report.applyResult.changedFiles) console.log(`  已变更: ${path}`)
    } else {
      console.log('  结果: 已生成计划，未应用变更')
    }
    console.log('  下一步:')
    for (const command of plan.check.recommendedCommands.slice(0, 5)) console.log(`    ${formatUpgradeCommand(command, lang)}`)
    if (plan.blockers.length > 0) console.log('    先解决阻塞项后再执行 scale upgrade apply --confirm')
    return
  }

  console.log('\nSCALE Upgrade Wizard')
  console.log(`  Project: ${plan.projectDir}`)
  console.log(`  Status: ${plan.status}`)
  console.log(`  Apply mode: ${plan.applyMode}`)
  console.log(`  Blockers: ${plan.blockers.length}`)
  console.log(`  Steps: ${plan.steps.length}`)
  if (report.htmlPath) console.log(`  HTML plan: ${report.htmlPath}`)
  if (report.cancelled) console.log('  Result: cancelled')
  else if (report.applyResult) {
    console.log(`  Result: ${report.applyResult.applied ? 'applied' : 'not applied'}`)
    console.log(`  Reason: ${report.applyResult.reason}`)
    for (const path of report.applyResult.changedFiles) console.log(`  changed: ${path}`)
  } else {
    console.log('  Result: plan generated; no changes applied')
  }
  console.log('  Next:')
  for (const command of plan.check.recommendedCommands.slice(0, 5)) console.log(`    ${formatUpgradeCommand(command, lang)}`)
  if (plan.blockers.length > 0) console.log('    Resolve blockers before running scale upgrade apply --confirm')
}

function formatUpgradeBlockerMessage(code: string, fallback: string, lang: 'zh' | 'en'): string {
  if (lang !== 'zh') return fallback
  if (code === 'missing-governance-lock') return '缺少治理锁文件，无法判断哪些生成文件可以安全升级。'
  if (code === 'local-generated-file-changed') return '受管生成文件已有本地改动，需要三方对比或人工审阅后再升级。'
  return fallback
}

function formatUpgradeStepReason(action: string, fallback: string, lang: 'zh' | 'en'): string {
  if (lang !== 'zh') return fallback
  switch (action) {
    case 'initialize-governance-lock':
      return '先创建治理锁文件，后续才能安全升级生成的治理资产。'
    case 'upgrade-scale-engine':
      return fallback.replace('SCALE Engine changed from', 'SCALE Engine 版本变化：').replace(' to ', ' -> ')
    case 'upgrade-governance-pack':
      return fallback.replace('Governance pack', '治理包').replace('changed from', '版本变化：').replace(' to ', ' -> ')
    case 'refresh-managed-generated-files':
      return fallback.replace('clean managed governance files can be refreshed automatically; local edits still block automatic apply.', '个干净受管治理文件可自动刷新；已有本地改动的文件仍会阻止自动应用。')
    case 'restore-missing-generated-file':
      return '该文件由治理锁管理，但当前本地缺失，可从当前治理包恢复。'
    case 'review-local-change':
      return '需要保留、合并或明确替换本地改动，不能自动覆盖。'
    case 'review-third-party-capability':
      return fallback
        .replace('updates require manual-review; SCALE never auto-installs third-party capabilities.', '更新需要人工审阅；SCALE 不会自动安装第三方能力。')
        .replace('updates require blocked; SCALE never auto-installs third-party capabilities.', '更新默认阻断；SCALE 不会自动安装第三方能力。')
    case 'adopt-ai-os-runtime':
      return '运行 AI OS 一键接入路径，生成运行态目录、首份 dry-run、benchmark 和 doctor 报告。'
    case 'migrate-ai-os-runtime':
      return 'AI OS 运行态目录缺失；接入 beta runtime 前先创建目录结构。'
    case 'check-ai-os-runtime':
      return '依赖 AI OS beta 编排前，先复核运行态就绪状态。'
    case 'run-preflight':
      return '完成已接受的升级后，运行项目级预检。'
    default:
      return fallback
  }
}

function formatUpgradeCommand(command: string, lang: 'zh' | 'en'): string {
  if (command === 'scale ai-os adopt --dir . --task "Adopt AI OS runtime" --json') {
    return lang === 'zh'
      ? 'scale ai-os adopt --dir . --task "接入 AI OS runtime" --lang zh'
      : 'scale ai-os adopt --dir . --task "Adopt AI OS runtime" --lang en'
  }
  if (command === 'scale ai-os doctor --dir . --json') {
    return lang === 'zh' ? 'scale ai-os doctor --dir . --lang zh' : 'scale ai-os doctor --dir . --lang en'
  }
  if (command === 'scale ai-os migrate --dir . --json') {
    return 'scale ai-os migrate --dir .'
  }
  return command
}

function formatUpgradeApplyReason(reason: string, lang: 'zh' | 'en'): string {
  if (lang !== 'zh') return reason
  switch (reason) {
    case 'Review scale upgrade plan first, then rerun with --confirm.':
      return '请先审阅 SCALE 升级计划，再使用 --confirm 重新运行。'
    case 'Upgrade requires manual review because generated files have local changes or the lock is missing.':
      return '生成文件存在本地改动或缺少锁文件，本次升级需要人工审阅。'
    case 'Cannot apply without a governance lock and pack id.':
      return '缺少治理锁文件或治理包 ID，无法应用升级。'
    case 'No safe upgrade changes were needed.':
      return '没有需要应用的安全升级变更。'
    case 'Safe upgrade changes were applied.':
      return '已应用安全升级变更。'
    case 'No SCALE-managed upgrade backup was found.':
      return '未找到 SCALE 管理的升级备份。'
    case 'Latest SCALE-managed upgrade backup was rolled back.':
      return '已回滚最近一次 SCALE 管理的升级备份。'
    default:
      return reason
  }
}

// ============================================================================
// assets command - Resource lifecycle governance
// ============================================================================

const assetsScan = defineCommand({
  meta: { name: 'scan', description: 'Classify project docs, reports, media, scripts, and temporary outputs' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = scanResourceAssets({ projectDir: args.dir })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log('SCALE Asset Scan')
    console.log(`  Project: ${report.projectDir}`)
    console.log(`  Total resources: ${report.summary.total}`)
    console.log(`  Tracked forbidden: ${report.summary.trackedForbidden}`)
    console.log(`  Large tracked: ${report.summary.largeTracked}`)
    console.log(`  Expired: ${report.summary.expired}`)
    console.log('\nBy type:')
    for (const [type, count] of Object.entries(report.summary.byType)) {
      if (count > 0) console.log(`  ${type}: ${count}`)
    }
  },
})

const assetsDoctor = defineCommand({
  meta: { name: 'doctor', description: 'Find resource lifecycle and Git policy problems' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = doctorResourceAssets({ projectDir: args.dir })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log(`SCALE Asset Doctor: ${report.ok ? 'OK' : 'FAILED'}`)
    if (report.findings.length === 0) {
      console.log('  No resource lifecycle findings.')
      return
    }
    for (const finding of report.findings) {
      const path = finding.path ? ` ${finding.path}` : ''
      console.log(`  [${finding.severity.toUpperCase()}] ${finding.code}${path}: ${finding.message}`)
      if (finding.fix) console.log(`    fix: ${finding.fix}`)
    }
    if (!report.ok) process.exitCode = 1
  },
})

const assetsSettle = defineCommand({
  meta: { name: 'settle', description: 'Record resource lifecycle settlement evidence for a task' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    'task-id': { type: 'string', description: 'Task id for the settlement record' },
    'artifact-dir': { type: 'string', description: 'Task artifact directory where resource-impact.md should be updated' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = settleResourceAssets({
      projectDir: args.dir,
      taskId: args['task-id'],
      artifactsDir: args['artifact-dir'],
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(`SCALE Asset Settlement: ${report.ok ? 'OK' : 'FAILED'}`)
      if (report.resourceImpactPath) console.log(`  Resource impact: ${report.resourceImpactPath}`)
      if (report.doctor.findings.length > 0) {
        for (const finding of report.doctor.findings) {
          const path = finding.path ? ` ${finding.path}` : ''
          console.log(`  [${finding.severity.toUpperCase()}] ${finding.code}${path}: ${finding.message}`)
        }
      }
    }
    if (!report.ok) process.exitCode = 1
  },
})

const assets = defineCommand({
  meta: { name: 'assets', description: 'Resource lifecycle governance for generated and maintained project assets' },
  subCommands: { scan: assetsScan, doctor: assetsDoctor, settle: assetsSettle },
})

// ============================================================================
// standards command - Engineering standards governance
// ============================================================================

function resolveChangedFilesArg(args: { dir?: string; changed?: boolean; 'changed-files'?: string }): string[] | undefined {
  const explicit = splitChangedFiles(args['changed-files'])
  if (explicit.length > 0) return explicit
  if (!args.changed) return undefined
  return readGitChangedFiles(args.dir ?? '.')
}

function splitChangedFiles(value?: string): string[] {
  if (!value) return []
  return value
    .split(/[\n,]/)
    .map(item => item.trim())
    .filter(Boolean)
}

function readGitChangedFiles(projectDir: string): string[] {
  const tracked = readGitPathList(projectDir, ['diff', '--name-only', '--diff-filter=ACMRTUXB', 'HEAD', '--'])
  const untracked = readGitPathList(projectDir, ['ls-files', '--others', '--exclude-standard'])
  return Array.from(new Set([...tracked, ...untracked]))
}

function readGitChangedFilesForStandards(projectDir: string): string[] | undefined {
  try {
    execFileSync('git', ['-C', projectDir, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return undefined
  }
  return readGitChangedFiles(projectDir)
}

function readGitPathList(projectDir: string, args: string[]): string[] {
  try {
    return execFileSync('git', ['-C', projectDir, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split(/\r?\n/)
      .map(item => item.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

const standardsScan = defineCommand({
  meta: { name: 'scan', description: 'Scan source files for engineering standard violations' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    changed: { type: 'boolean', default: false, description: 'Scan changed Git files only' },
    'changed-files': { type: 'string', description: 'Comma or newline separated file list to scan' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = scanEngineeringStandards({ projectDir: args.dir, changedFiles: resolveChangedFilesArg(args) })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log('SCALE Standards Scan')
    console.log(`  Project: ${report.projectDir}`)
    console.log(`  Files scanned: ${report.summary.filesScanned}`)
    console.log(`  Findings: ${report.summary.totalFindings}`)
    console.log(`  Blocking findings: ${report.summary.blockingFindings}`)
    for (const finding of report.findings.slice(0, 20)) {
      const line = finding.line ? `:${finding.line}` : ''
      console.log(`  [${finding.severity.toUpperCase()}] ${finding.ruleId} ${finding.path}${line}: ${finding.message}`)
    }
    if (report.findings.length > 20) console.log(`  ... ${report.findings.length - 20} more finding(s)`)
  },
})

const standardsDoctor = defineCommand({
  meta: { name: 'doctor', description: 'Find blocking engineering standards problems' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    changed: { type: 'boolean', default: false, description: 'Scan changed Git files only' },
    'changed-files': { type: 'string', description: 'Comma or newline separated file list to scan' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = doctorEngineeringStandards({ projectDir: args.dir, changedFiles: resolveChangedFilesArg(args) })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log(`SCALE Standards Doctor: ${report.ok ? 'OK' : 'FAILED'}`)
    if (report.findings.length === 0) {
      console.log('  No engineering standards findings.')
      return
    }
    for (const finding of report.findings) {
      const line = finding.line ? `:${finding.line}` : ''
      console.log(`  [${finding.severity.toUpperCase()}] ${finding.ruleId} ${finding.path}${line}: ${finding.message}`)
      if (finding.fix) console.log(`    fix: ${finding.fix}`)
    }
    if (!report.ok) process.exitCode = 1
  },
})

const standardsSettle = defineCommand({
  meta: { name: 'settle', description: 'Record engineering standards settlement evidence for a task' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    'task-id': { type: 'string', description: 'Task id for the settlement record' },
    'artifact-dir': { type: 'string', description: 'Task artifact directory where standards-impact.md should be updated' },
    changed: { type: 'boolean', default: false, description: 'Scan changed Git files only' },
    'changed-files': { type: 'string', description: 'Comma or newline separated file list to scan' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = settleEngineeringStandards({
      projectDir: args.dir,
      taskId: args['task-id'],
      artifactsDir: args['artifact-dir'],
      changedFiles: resolveChangedFilesArg(args),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(`SCALE Standards Settlement: ${report.ok ? 'OK' : 'FAILED'}`)
      if (report.standardsImpactPath) console.log(`  Standards impact: ${report.standardsImpactPath}`)
      for (const finding of report.doctor.findings) {
        const line = finding.line ? `:${finding.line}` : ''
        console.log(`  [${finding.severity.toUpperCase()}] ${finding.ruleId} ${finding.path}${line}: ${finding.message}`)
      }
    }
    if (!report.ok) process.exitCode = 1
  },
})

const standardsBaseline = defineCommand({
  meta: { name: 'baseline', description: 'Generate a legacy standards baseline and classification report' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    write: { type: 'boolean', default: false, description: 'Write .scale/engineering-standards-baseline.json' },
    'task-id': { type: 'string', description: 'Task id for the legacy debt report' },
    'artifact-dir': { type: 'string', description: 'Directory where standards-legacy-debt.md should be written' },
    reason: { type: 'string', default: 'legacy standards debt accepted for staged remediation', description: 'Reason recorded on generated baseline entries' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = baselineEngineeringStandards({
      projectDir: args.dir,
      writeBaseline: args.write,
      taskId: args['task-id'],
      artifactsDir: args['artifact-dir'],
      reason: args.reason,
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log(`Standards baseline: ${report.wroteBaseline ? 'written' : 'dry-run'}`)
    console.log(`  Baseline entries: ${report.baselineEntries.length}`)
    console.log(`  Blocking findings: ${report.debt.blockingFindings}`)
    console.log(`  Baseline path: ${report.baselinePath}`)
    if (report.legacyDebtPath) console.log(`  Legacy debt report: ${report.legacyDebtPath}`)
    if (!report.wroteBaseline) console.log('  Re-run with --write to update .scale/engineering-standards-baseline.json.')
  },
})

const standards = defineCommand({
  meta: { name: 'standards', description: 'Engineering standards governance for logs, security, architecture, database, and code quality' },
  subCommands: { scan: standardsScan, doctor: standardsDoctor, settle: standardsSettle, baseline: standardsBaseline },
})

// ============================================================================
// artifact command - Derived HTML artifacts for human review
// ============================================================================

const artifactRender = defineCommand({
  meta: { name: 'render', description: 'Render a task Markdown source set into a governed HTML artifact' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    'task-id': { type: 'string', description: 'Task id under docs/worklog/tasks' },
    'artifact-dir': { type: 'string', description: 'Task artifact directory override' },
    type: { type: 'string', default: 'release-report', description: 'HTML artifact type' },
    source: { type: 'string', description: 'Comma or newline separated source Markdown files relative to the task directory' },
    theme: { type: 'string', default: 'auto', description: 'Theme mode: dark/light/auto' },
    lang: { type: 'string', default: 'zh', description: 'HTML language: zh/en' },
    title: { type: 'string', description: 'HTML document title override' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const result = renderHtmlArtifact({
      projectDir: args.dir,
      taskId: args['task-id'],
      artifactDir: args['artifact-dir'],
      type: String(args.type ?? 'release-report'),
      sourcePaths: splitChangedFiles(typeof args.source === 'string' ? args.source : undefined),
      theme: normalizeThemeArg(args.theme),
      lang: normalizeLangArg(args.lang),
      title: typeof args.title === 'string' ? args.title : undefined,
    })
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log('SCALE HTML Artifact Render')
    console.log(`  Type: ${result.type}`)
    console.log(`  HTML: ${result.outputPath}`)
    console.log(`  Index: ${result.indexPath}`)
    console.log(`  Manifest: ${result.manifestPath}`)
    if (result.missingSources.length > 0) {
      console.log(`  Missing sources: ${result.missingSources.join(', ')}`)
    }
  },
})

const artifactDoctor = defineCommand({
  meta: { name: 'doctor', description: 'Check HTML artifacts for traceability, stale sources, remote assets, and secret-like content' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    'task-id': { type: 'string', description: 'Task id under docs/worklog/tasks' },
    'artifact-dir': { type: 'string', description: 'Task artifact directory override' },
    type: { type: 'string', description: 'Optional HTML artifact type to check' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = doctorHtmlArtifacts({
      projectDir: args.dir,
      taskId: args['task-id'],
      artifactDir: args['artifact-dir'],
      type: typeof args.type === 'string' ? args.type : undefined,
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log(`SCALE HTML Artifact Doctor: ${report.ok ? 'OK' : 'FAILED'}`)
    console.log(`  Manifest: ${report.manifestPath}`)
    console.log(`  Artifacts: ${report.artifacts.length}`)
    if (report.findings.length === 0) {
      console.log('  No HTML artifact findings.')
    } else {
      for (const finding of report.findings) {
        const path = finding.path ? ` ${finding.path}` : ''
        console.log(`  [${finding.severity.toUpperCase()}] ${finding.code}${path}: ${finding.message}`)
        if (finding.fix) console.log(`    fix: ${finding.fix}`)
      }
    }
    if (!report.ok) process.exitCode = 1
  },
})

const artifactSettle = defineCommand({
  meta: { name: 'settle', description: 'Record HTML artifact settlement evidence for a task' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    'task-id': { type: 'string', description: 'Task id under docs/worklog/tasks' },
    'artifact-dir': { type: 'string', description: 'Task artifact directory override' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = settleHtmlArtifacts({
      projectDir: args.dir,
      taskId: args['task-id'],
      artifactDir: args['artifact-dir'],
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log(`SCALE HTML Artifact Settlement: ${report.ok ? 'OK' : 'FAILED'}`)
    console.log(`  HTML impact: ${report.htmlImpactPath}`)
    for (const finding of report.doctor.findings) {
      const path = finding.path ? ` ${finding.path}` : ''
      console.log(`  [${finding.severity.toUpperCase()}] ${finding.code}${path}: ${finding.message}`)
    }
    if (!report.ok) process.exitCode = 1
  },
})

const artifactOpen = defineCommand({
  meta: { name: 'open', description: 'Open or print the local file URL for a rendered HTML artifact' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    'task-id': { type: 'string', description: 'Task id under docs/worklog/tasks' },
    'artifact-dir': { type: 'string', description: 'Task artifact directory override' },
    type: { type: 'string', description: 'Optional HTML artifact type to open' },
    'print-only': { type: 'boolean', default: false, description: 'Only print the file URL without launching a browser' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const path = resolveHtmlArtifactForOpen({
      projectDir: args.dir,
      taskId: args['task-id'],
      artifactDir: args['artifact-dir'],
      type: typeof args.type === 'string' ? args.type : undefined,
    })
    const url = pathToFileURL(path).toString()
    const exists = existsSync(path)
    if (!args['print-only'] && exists) launchLocalFile(path)
    const output = { ok: exists, path, url, launched: Boolean(!args['print-only'] && exists) }
    if (args.json) {
      console.log(JSON.stringify(output, null, 2))
      if (!exists) process.exitCode = 1
      return
    }
    if (!exists) {
      console.log(`HTML artifact not found: ${path}`)
      process.exitCode = 1
      return
    }
    console.log(url)
  },
})

const artifactDashboard = defineCommand({
  meta: { name: 'dashboard', description: 'Render a governance HTML dashboard from runtime, eval, memory, resource, and artifact evidence' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    'task-id': { type: 'string', description: 'Optional task id to scope runtime/eval evidence and task HTML artifacts' },
    output: { type: 'string', alias: 'o', description: 'Output HTML path; defaults to .scale/reports/governance-dashboard.html' },
    theme: { type: 'string', default: 'auto', description: 'Theme mode: dark/light/auto' },
    lang: { type: 'string', default: 'zh', description: 'HTML language: zh/en' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const report = renderGovernanceDashboard({
      projectDir,
      scaleDir,
      taskId: typeof args['task-id'] === 'string' ? args['task-id'] : undefined,
      output: typeof args.output === 'string' ? args.output : undefined,
      theme: normalizeThemeArg(args.theme),
      lang: normalizeLangArg(args.lang),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log(`SCALE Governance Dashboard: ${report.ok ? 'OK' : 'ATTENTION'}`)
    console.log(`  HTML: ${report.outputPath}`)
    console.log(`  Manifest: ${report.manifestPath}`)
    for (const finding of report.findings) {
      console.log(`  [${finding.severity.toUpperCase()}] ${finding.code}: ${finding.message}`)
    }
    if (!report.ok) process.exitCode = 1
  },
})

const artifact = defineCommand({
  meta: { name: 'artifact', description: 'Derived HTML artifact rendering and safety checks' },
  subCommands: { render: artifactRender, doctor: artifactDoctor, settle: artifactSettle, open: artifactOpen, dashboard: artifactDashboard },
})

function normalizeThemeArg(value: unknown): 'dark' | 'light' | 'auto' {
  const normalized = String(value ?? 'auto').trim().toLowerCase()
  if (normalized === 'dark' || normalized === 'light' || normalized === 'auto') return normalized
  return 'auto'
}

function normalizeLangArg(value: unknown): 'zh' | 'en' {
  return normalizeLanguage(value ?? process.env.SCALE_LANG)
}

function normalizeMemoryModeArg(value: unknown): 'auto' | 'local-only' | 'external-first' | undefined {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'auto' || normalized === 'local-only' || normalized === 'external-first') return normalized
  return undefined
}

function normalizeMemoryWriteModeArg(value: unknown): 'disabled' | 'candidate-only' | 'enabled' | undefined {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'disabled' || normalized === 'candidate-only' || normalized === 'enabled') return normalized
  return undefined
}

function launchLocalFile(path: string): void {
  try {
    if (process.platform === 'win32') {
      execFileSync('cmd', ['/c', 'start', '', path], { stdio: 'ignore' })
    } else if (process.platform === 'darwin') {
      execFileSync('open', [path], { stdio: 'ignore' })
    } else {
      execFileSync('xdg-open', [path], { stdio: 'ignore' })
    }
  } catch {
    // Opening is convenience-only; artifact doctor/render remains the source of truth.
  }
}

// ============================================================================
// evolve command
// ============================================================================

const evolve = defineCommand({
  meta: { name: 'evolve', description: 'Run evolution cycle (Defect→Lesson→Rule→Hook)' },
  args: {},
  async run() {
    const { store, kb, eventBus } = getEngine()
    const extractor = new LessonExtractor(store, kb, eventBus)
    const proposer = new RuleProposer(kb, eventBus)
    const generator = new HookGenerator(eventBus)
    const engine = new EvolutionEngine(extractor, proposer, generator, eventBus, SCALE_DIR)
    const stats = await engine.runCycle()
    console.log(JSON.stringify(stats, null, 2))
  },
})

// ============================================================================
// doctor command
// ============================================================================

function runEnvironmentDoctor(json: unknown) {
  const report = inspectEnvironment()
  if (json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(renderEnvironmentDoctor(report))
  }
  process.exitCode = report.ok ? 0 : 1
}

const doctor = defineCommand({
  meta: { name: 'doctor', description: 'Diagnose SCALE Engine health' },
  args: {
    scope: { type: 'positional', required: false, description: 'Optional diagnostic scope: env' },
    dir: { type: 'string', default: '.', description: 'Project directory' },
    json: { type: 'boolean', default: false, description: 'Output as JSON' },
  },
  async run({ args }) {
    const scope = String(args.scope ?? '').trim().toLowerCase()
    if (scope === 'env' || scope === 'environment') {
      runEnvironmentDoctor(args.json)
      return
    }
    if (scope) {
      console.error(`Unknown doctor scope: ${scope}. Supported scope: env.`)
      process.exitCode = 1
      return
    }
    const doc = new Doctor(args.dir)
    const report = await doc.diagnose()
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(doc.formatReport(report))
    }
    process.exitCode = report.overall === 'broken' ? 1 : 0
  },
})

// ============================================================================
// workflow command — 列出/查看工作流预设
// ============================================================================

const workflowList = defineCommand({
  meta: { name: 'list', description: 'List all workflow presets' },
  args: {
    scenario: { type: 'string', description: 'Filter by scenario mode (sandbox/standard/critical)' },
    json: { type: 'boolean', default: false, description: 'Output workflow presets as JSON' },
  },
  async run({ args }) {
    const presets = args.scenario
      ? getPresetsByScenario(args.scenario as 'sandbox' | 'standard' | 'critical')
      : listWorkflowPresets()

    if (args.json) {
      console.log(JSON.stringify({
        ok: true,
        scenario: args.scenario ?? null,
        count: presets.length,
        presets: presets.map(preset => ({
          id: preset.id,
          name: preset.name,
          nameZh: preset.nameZh,
          description: preset.description,
          scenarioMode: preset.scenarioMode,
          requiredArtifacts: preset.requiredArtifacts,
          steps: preset.steps,
        })),
      }, null, 2))
      return
    }

    if (presets.length === 0) {
      console.log('No workflow presets found.')
      return
    }

    console.log('\n📋 SCALE Engine Workflow Presets')
    console.log('═══════════════════════════════════════════════════════')

    for (const preset of presets) {
      const modeEmoji = { sandbox: '🏖️', standard: '⚙️', critical: '🔒' }[preset.scenarioMode]
      const mandatorySteps = preset.steps.filter((s) => s.isMandatory).length
      const totalSteps = preset.steps.length

      console.log(`\n  ${preset.nameZh} (${preset.id})`)
      console.log(`  ${preset.description}`)
      console.log(`  Mode: ${modeEmoji} ${preset.scenarioMode} · Steps: ${mandatorySteps}/${totalSteps} mandatory`)

      if (preset.requiredArtifacts.length > 0) {
        console.log(`  Requires: ${preset.requiredArtifacts.map((a) => `${a.type}${a.status ? `(${a.status})` : ''}`).join(', ')}`)
      }

      // Show step summary
      for (const step of preset.steps) {
        const marker = step.isMandatory ? '●' : '○'
        const gate = step.verificationGate ? ` ⊓ ${step.verificationGate}` : ''
        console.log(`    ${marker} ${step.stepId}: ${step.action}${gate}`)
      }
    }

    console.log('\n═══════════════════════════════════════════════════════')
    console.log('\nUsage: scale workflow show <preset-id>')
  },
})

const workflow = defineCommand({
  meta: { name: 'workflow', description: 'Workflow preset management' },
  subCommands: { list: workflowList },
})

const evidenceList = defineCommand({
  meta: { name: 'list', description: 'List persisted gate evidence records' },
  args: {
    limit: { type: 'string', default: '20', description: 'Maximum number of records' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const store = new EvidenceStore(SCALE_DIR)
    const records = store.listGateResults(parseInt(args.limit, 10) || 20)
    if (args.json) {
      console.log(JSON.stringify(records, null, 2))
      return
    }
    if (records.length === 0) {
      console.log('No evidence records found.')
      return
    }
    console.log('\nSCALE Evidence Records')
    for (const record of records) {
      const status = record.passed ? 'PASS' : record.status
      const blockers = record.blockers.length > 0 ? ` blockers=${record.blockers.length}` : ''
      console.log(`  ${record.id}  ${record.gate}  ${status}  ${new Date(record.createdAt).toISOString()}${blockers}`)
    }
    console.log('\nUsage: scale evidence show <id>')
  },
})

const evidenceShow = defineCommand({
  meta: { name: 'show', description: 'Show a persisted gate evidence record' },
  args: {
    id: { type: 'positional', required: true },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const store = new EvidenceStore(SCALE_DIR)
    const record = store.getGateResult(args.id)
    if (!record) {
      console.error(`Evidence record not found: ${args.id}`)
      process.exit(1)
    }
    if (args.json) {
      console.log(JSON.stringify(record, null, 2))
      return
    }
    console.log(`\nEvidence: ${record.id}`)
    console.log(`Gate: ${record.gate}`)
    console.log(`Status: ${record.status}`)
    console.log(`Passed: ${record.passed}`)
    console.log(`Created: ${new Date(record.createdAt).toISOString()}`)
    console.log(`Duration: ${record.durationMs}ms`)
    if (record.blockers.length > 0) {
      console.log('\nBlockers:')
      for (const blocker of record.blockers) console.log(`  - ${blocker}`)
    }
    console.log('\nEvidence Items:')
    for (const item of record.evidenceItems) {
      const status = item.passed ? 'PASS' : 'FAIL'
      const target = item.command ?? item.path ?? ''
      console.log(`  - [${status}] ${item.label}${target ? ` (${target})` : ''}`)
      console.log(`    ${item.detail}`)
    }
  },
})

const evidence = defineCommand({
  meta: { name: 'evidence', description: 'Persisted gate evidence inspection' },
  subCommands: { list: evidenceList, show: evidenceShow },
})

// ============================================================================
// runtime command - session ledger + completion evidence
// ============================================================================

function normalizeRuntimeEvidenceKind(value: unknown): RuntimeEvidenceKind {
  const normalized = String(value ?? 'command').trim()
  const allowed: RuntimeEvidenceKind[] = ['command', 'gate', 'tool', 'skill', 'mcp', 'browser', 'desktop', 'manual', 'final-report']
  if (allowed.includes(normalized as RuntimeEvidenceKind)) return normalized as RuntimeEvidenceKind
  throw new Error(`Invalid runtime evidence kind "${normalized}"; expected ${allowed.join(', ')}.`)
}

function normalizeRuntimeEvidenceStatus(value: unknown): RuntimeEvidenceStatus {
  const normalized = String(value ?? '').trim()
  if (normalized === 'passed' || normalized === 'failed' || normalized === 'skipped') return normalized
  throw new Error(`Invalid runtime evidence status "${normalized}"; expected passed, failed, or skipped.`)
}

function normalizeRuntimeSessionStatus(value: unknown): RuntimeSessionStatus {
  const normalized = String(value ?? 'completed').trim()
  if (normalized === 'active' || normalized === 'completed' || normalized === 'failed' || normalized === 'abandoned') return normalized
  throw new Error(`Invalid runtime session status "${normalized}"; expected active, completed, failed, or abandoned.`)
}

function parseNonNegativeNumberArg(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number.`)
  }
  return parsed
}

function parseJsonArg(value: unknown, name: string): unknown {
  try {
    return JSON.parse(String(value ?? 'null'))
  } catch {
    throw new Error(`${name} must be valid JSON.`)
  }
}

function parseMetadataJson(value: unknown, name = '--metadata-json'): Record<string, string | number | boolean> {
  const parsed = parseJsonArg(value ?? '{}', name)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object.`)
  }
  return parsed as Record<string, string | number | boolean>
}

function hasModelUsageArgs(args: Record<string, unknown>): boolean {
  return [
    'provider',
    'model',
    'usage-json',
    'usage-file',
    'input-tokens',
    'output-tokens',
    'cache-eligible-tokens',
    'cache-creation-input-tokens',
    'cache-read-input-tokens',
    'cached-tokens',
    'estimated-cost-usd',
  ].some(key => args[key] !== undefined && args[key] !== '')
}

function buildModelUsageRecordInput(
  args: Record<string, unknown>,
  defaults: { provider?: string; taskId?: string; sessionId?: string } = {},
): ModelUsageInput {
  const usagePayload = args['usage-file']
    ? parseJsonArg(readFileSync(resolve(PROJECT_DIR, String(args['usage-file'])), 'utf-8'), '--usage-file')
    : args['usage-json']
      ? parseJsonArg(args['usage-json'], '--usage-json')
      : undefined
  const provider = String(args.provider ?? defaults.provider ?? '').trim()
  if (!provider) throw new Error('Model usage recording requires --provider.')
  return buildModelUsageInput({
    provider,
    model: args.model ? String(args.model) : undefined,
    taskId: args['task-id'] ? String(args['task-id']) : defaults.taskId,
    sessionId: args['session-id'] ? String(args['session-id']) : defaults.sessionId,
    inputTokens: parseNonNegativeNumberArg(args['input-tokens'], '--input-tokens'),
    outputTokens: parseNonNegativeNumberArg(args['output-tokens'], '--output-tokens'),
    cacheEligibleTokens: parseNonNegativeNumberArg(args['cache-eligible-tokens'], '--cache-eligible-tokens'),
    cacheCreationInputTokens: parseNonNegativeNumberArg(args['cache-creation-input-tokens'], '--cache-creation-input-tokens'),
    cacheReadInputTokens: parseNonNegativeNumberArg(args['cache-read-input-tokens'], '--cache-read-input-tokens'),
    cachedTokens: parseNonNegativeNumberArg(args['cached-tokens'], '--cached-tokens'),
    estimatedCostUsd: parseNonNegativeNumberArg(args['estimated-cost-usd'], '--estimated-cost-usd'),
    metadata: args['metadata-json'] !== undefined ? parseMetadataJson(args['metadata-json']) : undefined,
    timestamp: args.timestamp ? String(args.timestamp) : undefined,
    usagePayload,
  })
}

const tokenRecord = defineCommand({
  meta: { name: 'record', description: 'Record real model usage from provider usage payloads or explicit token counts' },
  args: {
    provider: { type: 'string', required: true, description: 'Model provider: anthropic, openai, codex, etc.' },
    model: { type: 'string', description: 'Optional model id' },
    'task-id': { type: 'string', description: 'Task id linked to this model usage' },
    'session-id': { type: 'string', description: 'Session id linked to this model usage' },
    'usage-json': { type: 'string', description: 'Raw provider response or usage JSON to normalize into the usage ledger' },
    'usage-file': { type: 'string', description: 'Path to a JSON file containing a raw provider response or usage payload' },
    'input-tokens': { type: 'string', description: 'Explicit input token count; overrides usage JSON when provided' },
    'output-tokens': { type: 'string', description: 'Explicit output token count; overrides usage JSON when provided' },
    'cache-eligible-tokens': { type: 'string', description: 'Explicit cache-eligible token count' },
    'cache-creation-input-tokens': { type: 'string', description: 'Explicit Anthropic cache creation token count' },
    'cache-read-input-tokens': { type: 'string', description: 'Explicit Anthropic cache read token count' },
    'cached-tokens': { type: 'string', description: 'Explicit OpenAI cached token count' },
    'estimated-cost-usd': { type: 'string', description: 'Optional estimated cost in USD' },
    timestamp: { type: 'string', description: 'Optional ISO timestamp' },
    'metadata-json': { type: 'string', default: '{}', description: 'Additional JSON metadata' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const record = new ModelUsageLedger(SCALE_DIR).record(buildModelUsageRecordInput(args))
    if (args.json) {
      console.log(JSON.stringify(record, null, 2))
      return
    }
    console.log(`Model usage recorded: ${record.id}`)
    console.log(`  Provider: ${record.provider}`)
    console.log(`  Model: ${record.model ?? 'unknown'}`)
    console.log(`  Tokens: input ${record.inputTokens}, output ${record.outputTokens}, total ${record.totalTokens}`)
    if (record.cacheSavingsTokens > 0) console.log(`  Cache savings: ${record.cacheSavingsTokens} tokens`)
  },
})

const tokenReport = defineCommand({
  meta: { name: 'report', description: 'Summarize recorded model usage by day, provider, model, and task' },
  args: {
    day: { type: 'string', description: 'Exact UTC day in YYYY-MM-DD format' },
    since: { type: 'string', description: 'ISO timestamp lower bound' },
    until: { type: 'string', description: 'ISO timestamp upper bound' },
    'since-days': { type: 'string', default: '7d', description: 'Relative time window when day/since/until are omitted; use all to disable' },
    provider: { type: 'string', description: 'Filter by provider' },
    model: { type: 'string', description: 'Filter by model id' },
    'task-id': { type: 'string', description: 'Filter by task id' },
    'session-id': { type: 'string', description: 'Filter by session id' },
    limit: { type: 'string', description: 'Maximum recent records to include in the report; defaults to 20' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const limit = parsePositiveIntArg(args.limit, '--limit')
    const sinceDays = args.day || args.since || args.until ? undefined : parseSinceDays(args['since-days']) ?? 7
    const since = args.since
      ? String(args.since)
      : sinceDays
        ? new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString()
        : undefined
    const report = new ModelUsageLedger(SCALE_DIR).report({
      day: args.day ? String(args.day) : undefined,
      since,
      until: args.until ? String(args.until) : undefined,
      provider: args.provider ? String(args.provider) : undefined,
      model: args.model ? String(args.model) : undefined,
      taskId: args['task-id'] ? String(args['task-id']) : undefined,
      sessionId: args['session-id'] ? String(args['session-id']) : undefined,
      limit,
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log('SCALE Token Report')
    if (report.filters.day) console.log(`  Day: ${report.filters.day}`)
    else if (report.filters.since || report.filters.until) console.log(`  Window: ${report.filters.since ?? '-inf'} -> ${report.filters.until ?? 'now'}`)
    console.log(`  Records: ${report.summary.totalRecords}`)
    console.log(`  Tokens: input ${report.summary.totalInputTokens}, output ${report.summary.totalOutputTokens}, total ${report.summary.totalTokens}`)
    console.log(`  Cache: eligible ${report.summary.cacheEligibleTokens}, create ${report.summary.cacheCreationInputTokens}, read ${report.summary.cacheReadInputTokens}, cached ${report.summary.cachedTokens}, saved ${report.summary.cacheSavingsTokens}`)
    if (report.summary.estimatedCostUsd !== undefined) console.log(`  Estimated cost: $${report.summary.estimatedCostUsd.toFixed(6)}`)
    for (const row of report.byProvider.slice(0, 5)) {
      console.log(`  Provider ${row.key}: ${row.records} record(s), ${row.totalTokens} total tokens, ${row.cacheSavingsTokens} saved`)
    }
    for (const row of report.byModel.slice(0, 5)) {
      console.log(`  Model ${row.key}: ${row.records} record(s), ${row.totalTokens} total tokens`)
    }
    for (const row of report.byTask.slice(0, 5)) {
      console.log(`  Task ${row.key}: ${row.records} record(s), ${row.totalTokens} total tokens`)
    }
    for (const row of report.records.slice(0, 10)) {
      console.log(`  Recent ${row.timestamp}: ${row.provider}/${row.model ?? 'unknown'} task=${row.taskId ?? '-'} total=${row.totalTokens}`)
    }
  },
})

const token = defineCommand({
  meta: { name: 'token', description: 'Record and audit real model token usage' },
  subCommands: { record: tokenRecord, report: tokenReport },
})

const runtimeStart = defineCommand({
  meta: { name: 'start', description: 'Start a runtime session ledger' },
  args: {
    'session-id': { type: 'string', description: 'Session id; generated when omitted' },
    'task-id': { type: 'string', description: 'Task id linked to this session' },
    agent: { type: 'string', description: 'Agent name' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    summary: { type: 'string', description: 'Short session summary' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const ledger = new SessionLedger({ projectDir: PROJECT_DIR, scaleDir: SCALE_DIR })
    const session = ledger.start({
      sessionId: args['session-id'],
      taskId: args['task-id'],
      agent: args.agent,
      level: normalizeTaskArtifactLevel(args.level),
      summary: args.summary,
    })
    if (args.json) {
      console.log(JSON.stringify(session, null, 2))
      return
    }
    console.log(`Runtime session started: ${session.sessionId}`)
    if (session.taskId) console.log(`  Task: ${session.taskId}`)
    if (session.level) console.log(`  Level: ${session.level}`)
    console.log(`  Events: ${ledger.sessionFile(session.sessionId)}`)
  },
})

const runtimeEnd = defineCommand({
  meta: { name: 'end', description: 'End the current or named runtime session' },
  args: {
    'session-id': { type: 'string', description: 'Session id; current session is used when omitted' },
    status: { type: 'string', default: 'completed', description: 'completed, failed, or abandoned' },
    summary: { type: 'string', description: 'Completion summary' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const ledger = new SessionLedger({ projectDir: PROJECT_DIR, scaleDir: SCALE_DIR })
    const sessionId = args['session-id'] ?? ledger.current()?.sessionId
    if (!sessionId) {
      console.error('No runtime session id provided and no current runtime session exists.')
      process.exit(1)
    }
    const session = ledger.end(sessionId, normalizeRuntimeSessionStatus(args.status), args.summary)
    if (args.json) {
      console.log(JSON.stringify(session, null, 2))
      return
    }
    console.log(`Runtime session ended: ${session.sessionId}`)
    console.log(`  Status: ${session.status}`)
  },
})

const runtimeRecord = defineCommand({
  meta: { name: 'record', description: 'Record command, gate, tool, browser, skill, or manual runtime evidence' },
  args: {
    'task-id': { type: 'string', description: 'Task id linked to this evidence' },
    'session-id': { type: 'string', description: 'Session id linked to this evidence' },
    kind: { type: 'string', default: 'command', description: 'command, gate, tool, skill, mcp, browser, desktop, manual, final-report' },
    title: { type: 'string', required: true, description: 'Evidence title' },
    status: { type: 'string', required: true, description: 'passed, failed, or skipped' },
    command: { type: 'string', description: 'Exact command or tool invocation, with secrets redacted by SCALE' },
    'exit-code': { type: 'string', description: 'Exit code when applicable' },
    summary: { type: 'string', required: true, description: 'Short output summary' },
    artifacts: { type: 'string', description: 'Comma-separated artifact paths' },
    provider: { type: 'string', description: 'Optional model provider when attaching model usage: anthropic, openai, codex, etc.' },
    model: { type: 'string', description: 'Optional model id when attaching model usage' },
    'usage-json': { type: 'string', description: 'Raw provider response or usage JSON to normalize into the usage ledger' },
    'usage-file': { type: 'string', description: 'Path to a JSON file containing a raw provider response or usage payload' },
    'input-tokens': { type: 'string', description: 'Explicit input token count; overrides usage JSON when provided' },
    'output-tokens': { type: 'string', description: 'Explicit output token count; overrides usage JSON when provided' },
    'cache-eligible-tokens': { type: 'string', description: 'Explicit cache-eligible token count' },
    'cache-creation-input-tokens': { type: 'string', description: 'Explicit Anthropic cache creation token count' },
    'cache-read-input-tokens': { type: 'string', description: 'Explicit Anthropic cache read token count' },
    'cached-tokens': { type: 'string', description: 'Explicit OpenAI cached token count' },
    'estimated-cost-usd': { type: 'string', description: 'Optional estimated cost in USD' },
    timestamp: { type: 'string', description: 'Optional ISO timestamp for the usage record' },
    'metadata-json': { type: 'string', default: '{}', description: 'Additional JSON metadata' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const current = new SessionLedger({ projectDir: PROJECT_DIR, scaleDir: SCALE_DIR }).current()
    let metadata: Record<string, unknown> = {}
    try {
      metadata = JSON.parse(String(args['metadata-json'] ?? '{}')) as Record<string, unknown>
    } catch {
      console.error('--metadata-json must be valid JSON.')
      process.exit(1)
    }
    const exitCode = args['exit-code'] === undefined || args['exit-code'] === ''
      ? undefined
      : Number.parseInt(String(args['exit-code']), 10)
    if (exitCode !== undefined && Number.isNaN(exitCode)) {
      console.error('--exit-code must be a number.')
      process.exit(1)
    }
    const ledger = new RuntimeEvidenceLedger({ projectDir: PROJECT_DIR, scaleDir: SCALE_DIR })
    const record = ledger.record({
      taskId: args['task-id'] ?? current?.taskId,
      sessionId: args['session-id'] ?? current?.sessionId,
      kind: normalizeRuntimeEvidenceKind(args.kind),
      title: args.title,
      status: normalizeRuntimeEvidenceStatus(args.status),
      command: args.command,
      exitCode,
      summary: args.summary,
      artifacts: parseCommaList(args.artifacts),
      metadata,
    })
    if (record.sessionId) {
      new SessionLedger({ projectDir: PROJECT_DIR, scaleDir: SCALE_DIR }).append(record.sessionId, {
        type: 'evidence.recorded',
        message: `${record.status}: ${record.title}`,
        data: {
          evidenceId: record.id,
          kind: record.kind,
          taskId: record.taskId,
        },
      })
    }
    const usageRecord = hasModelUsageArgs(args)
      ? new ModelUsageLedger(SCALE_DIR).record(buildModelUsageRecordInput(args, {
          taskId: record.taskId,
          sessionId: record.sessionId,
        }))
      : undefined
    if (args.json) {
      console.log(JSON.stringify(usageRecord ? { evidence: record, usage: usageRecord } : record, null, 2))
      return
    }
    console.log(`Runtime evidence recorded: ${record.id}`)
    console.log(`  Status: ${record.status}`)
    console.log(`  Kind: ${record.kind}`)
    if (usageRecord) {
      console.log(`  Model usage: ${usageRecord.provider}/${usageRecord.model ?? 'unknown'} ${usageRecord.totalTokens} total tokens`)
      if (usageRecord.cacheSavingsTokens > 0) console.log(`  Cache savings: ${usageRecord.cacheSavingsTokens} tokens`)
    }
    if (record.redactionApplied) console.log('  Redaction: applied')
  },
})

const runtimeDoctor = defineCommand({
  meta: { name: 'doctor', description: 'Check runtime session and completion evidence' },
  args: {
    'task-id': { type: 'string', description: 'Task id to inspect' },
    'session-id': { type: 'string', description: 'Session id to inspect' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const report = doctorRuntimeEvidence({
      projectDir: PROJECT_DIR,
      scaleDir: SCALE_DIR,
      taskId: args['task-id'],
      sessionId: args['session-id'],
      level: normalizeTaskArtifactLevel(args.level),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (report.blocked) process.exitCode = 1
      return
    }
    console.log('\nSCALE Runtime Doctor')
    console.log(`  Evidence: ${report.evidence.total} total, ${report.evidence.passed} passed, ${report.evidence.failed} failed, ${report.evidence.skipped} skipped`)
    for (const check of report.checks) {
      console.log(`  [${check.status.toUpperCase()}] ${check.name}: ${check.message}`)
      if (check.fix) console.log(`    Fix: ${check.fix}`)
    }
    if (report.blocked) process.exitCode = 1
  },
})

const runtimeFinalCheck = defineCommand({
  meta: { name: 'final-check', description: 'Block final delivery claims without passed runtime evidence' },
  args: {
    'task-id': { type: 'string', description: 'Task id to inspect' },
    'session-id': { type: 'string', description: 'Session id to inspect' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const readiness = evaluateFinalReportReadiness({
      projectDir: PROJECT_DIR,
      scaleDir: SCALE_DIR,
      taskId: args['task-id'],
      sessionId: args['session-id'],
      level: normalizeTaskArtifactLevel(args.level),
    })
    if (args.json) {
      console.log(JSON.stringify(readiness, null, 2))
      if (readiness.blocked) process.exitCode = 1
      return
    }
    console.log('\nSCALE Runtime Final Check')
    console.log(`  Ready: ${readiness.ready}`)
    for (const reason of readiness.reasons) console.log(`  [BLOCKER] ${reason}`)
    if (readiness.blocked) process.exitCode = 1
  },
})

const runtime = defineCommand({
  meta: { name: 'runtime', description: 'Runtime session ledger and completion evidence governance' },
  subCommands: {
    start: runtimeStart,
    end: runtimeEnd,
    record: runtimeRecord,
    doctor: runtimeDoctor,
    'final-check': runtimeFinalCheck,
  },
})

// ============================================================================
// memory command - runtime evidence + knowledge + graph context packs
// ============================================================================

function parseMemoryBudget(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number.parseInt(String(value), 10)
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error('--budget must be a positive integer.')
  }
  return parsed
}

function normalizeMemorySource(value: unknown): 'evidence' | 'candidate' | 'failure' {
  const normalized = String(value ?? 'evidence').trim().toLowerCase()
  if (normalized === 'evidence' || normalized === 'candidate' || normalized === 'failure') return normalized
  throw new Error('--from must be evidence, candidate, or failure.')
}

function normalizeMemoryNodeType(value: unknown): 'fact' | 'decision' | 'incident' | 'relation' | 'contradiction' | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'fact' || normalized === 'decision' || normalized === 'incident' || normalized === 'relation' || normalized === 'contradiction') return normalized
  throw new Error('--type must be fact, decision, incident, relation, or contradiction.')
}

function normalizeMemoryScope(value: unknown): 'project' | 'workspace' | 'global-candidate' | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'project' || normalized === 'workspace' || normalized === 'global-candidate') return normalized
  throw new Error('--scope must be project, workspace, or global-candidate.')
}

function memoryBrain(): MemoryBrain {
  return new MemoryBrain({ projectDir: PROJECT_DIR, scaleDir: SCALE_DIR })
}

const memoryPack = defineCommand({
  meta: { name: 'pack', description: 'Build a compact context pack from runtime evidence, session events, knowledge, and graph status' },
  args: {
    task: { type: 'string', required: true, description: 'Current task or question' },
    'task-id': { type: 'string', description: 'Task id to scope evidence and session data' },
    'session-id': { type: 'string', description: 'Session id to scope session events' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    files: { type: 'string', description: 'Comma-separated files or modules in scope' },
    budget: { type: 'string', description: 'Maximum estimated tokens for the context pack' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    let budgetTokens: number | undefined
    try {
      budgetTokens = parseMemoryBudget(args.budget)
    } catch (e) {
      console.error((e as Error).message)
      process.exit(1)
    }
    const { kb } = getEngine()
    const pack = await new MemoryFabric({
      projectDir: PROJECT_DIR,
      scaleDir: SCALE_DIR,
      knowledgeBase: kb,
    }).createContextPack({
      task: args.task,
      taskId: args['task-id'],
      sessionId: args['session-id'],
      level: normalizeTaskArtifactLevel(args.level),
      files: parseCommaList(args.files),
      budgetTokens,
    })
    if (args.json) {
      console.log(JSON.stringify(pack, null, 2))
      return
    }
    console.log(renderContextPackMarkdown(pack))
  },
})

const memoryDoctor = defineCommand({
  meta: { name: 'doctor', description: 'Check whether a task context pack is available and within token budget' },
  args: {
    task: { type: 'string', required: true, description: 'Current task or question' },
    'task-id': { type: 'string', description: 'Task id to scope evidence and session data' },
    'session-id': { type: 'string', description: 'Session id to scope session events' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    files: { type: 'string', description: 'Comma-separated files or modules in scope' },
    budget: { type: 'string', description: 'Maximum estimated tokens for the context pack' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    let budgetTokens: number | undefined
    try {
      budgetTokens = parseMemoryBudget(args.budget)
    } catch (e) {
      console.error((e as Error).message)
      process.exit(1)
    }
    const { kb } = getEngine()
    const report = await doctorMemoryFabric({
      projectDir: PROJECT_DIR,
      scaleDir: SCALE_DIR,
      knowledgeBase: kb,
    }, {
      task: args.task,
      taskId: args['task-id'],
      sessionId: args['session-id'],
      level: normalizeTaskArtifactLevel(args.level),
      files: parseCommaList(args.files),
      budgetTokens,
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log('\nSCALE Memory Doctor')
    console.log(`  Budget: ${report.pack.budget.used}/${report.pack.budget.limit} estimated tokens`)
    for (const check of report.checks) {
      console.log(`  [${check.status.toUpperCase()}] ${check.name}: ${check.message}`)
    }
    if (!report.ok) process.exitCode = 1
  },
})

const memoryCerebrum = defineCommand({
  meta: { name: 'cerebrum', description: 'Maintain .scale/cerebrum.md do-not-repeat rules and preferences' },
  args: {
    type: { type: 'string', description: 'Optional entry type: preference or do-not-repeat' },
    pattern: { type: 'string', description: 'Pattern for do-not-repeat entries' },
    description: { type: 'string', description: 'Entry description or preference text' },
    tags: { type: 'string', description: 'Comma-separated tags for preferences' },
    write: { type: 'boolean', default: false, description: 'Write .scale/cerebrum.md' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const { kb } = getEngine()
    const manager = new CerebrumManager(kb)
    const type = args.type ? String(args.type).toLowerCase() : ''
    let created: unknown

    if (type) {
      if (type === 'do-not-repeat' || type === 'do_not_repeat' || type === 'dnr') {
        const pattern = String(args.pattern ?? '').trim()
        const description = String(args.description ?? '').trim()
        if (!pattern || !description) {
          console.error('memory cerebrum --type do-not-repeat requires --pattern and --description.')
          process.exit(1)
          return
        }
        created = await manager.addDoNotRepeat(pattern, description)
      } else if (type === 'preference' || type === 'pref') {
        const description = String(args.description ?? args.pattern ?? '').trim()
        if (!description) {
          console.error('memory cerebrum --type preference requires --description.')
          process.exit(1)
          return
        }
        created = await manager.addPreference(description, parseCommaList(args.tags))
      } else {
        console.error('memory cerebrum --type must be preference or do-not-repeat.')
        process.exit(1)
        return
      }
    }

    const entries = await manager.loadAll()
    const outputPath = join(SCALE_DIR, 'cerebrum.md')
    const shouldWrite = isTruthyFlag(args.write) || Boolean(created)
    if (shouldWrite) {
      ensureDir(SCALE_DIR)
      writeFileSync(outputPath, manager.toMarkdown(), 'utf-8')
    }

    const summary = {
      total: entries.length,
      doNotRepeat: entries.filter(entry => entry.type === 'do_not_repeat').length,
      preferences: entries.filter(entry => entry.type === 'preference').length,
    }
    if (args.json) {
      console.log(JSON.stringify({
        ok: true,
        outputPath: shouldWrite ? outputPath : undefined,
        created,
        summary,
      }, null, 2))
      return
    }
    console.log('SCALE Cerebrum')
    console.log(`  Do-not-repeat: ${summary.doNotRepeat}`)
    console.log(`  Preferences: ${summary.preferences}`)
    if (shouldWrite) console.log(`  Wrote: ${outputPath}`)
  },
})

const memorySettle = defineCommand({
  meta: { name: 'settle', description: 'Settle runtime evidence into a reviewable memory learning candidate' },
  args: {
    task: { type: 'string', required: true, description: 'Current task or question' },
    'task-id': { type: 'string', description: 'Task id to scope evidence and session data' },
    'session-id': { type: 'string', description: 'Session id to scope session events' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    files: { type: 'string', description: 'Comma-separated files or modules in scope' },
    budget: { type: 'string', description: 'Maximum estimated tokens for the context pack' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    let budgetTokens: number | undefined
    try {
      budgetTokens = parseMemoryBudget(args.budget)
    } catch (e) {
      console.error((e as Error).message)
      process.exit(1)
    }
    const { kb } = getEngine()
    const pack = await new MemoryFabric({
      projectDir: PROJECT_DIR,
      scaleDir: SCALE_DIR,
      knowledgeBase: kb,
    }).createContextPack({
      task: args.task,
      taskId: args['task-id'],
      sessionId: args['session-id'],
      level: normalizeTaskArtifactLevel(args.level),
      files: parseCommaList(args.files),
      budgetTokens,
    })
    const settlement = settleMemoryLearning({
      projectDir: PROJECT_DIR,
      scaleDir: SCALE_DIR,
      pack,
    })
    if (args.json) {
      console.log(JSON.stringify(settlement, null, 2))
      return
    }
    console.log(renderMemoryLearningCandidateMarkdown(settlement.candidate))
    console.log(`\nWrote: ${settlement.files.markdown}`)
  },
})

const memoryIngest = defineCommand({
  meta: { name: 'ingest', description: 'Ingest runtime evidence, learning candidates, or failure replays into the project memory brain' },
  args: {
    from: { type: 'string', default: 'evidence', description: 'Source: evidence, candidate, or failure' },
    'task-id': { type: 'string', description: 'Task id to scope runtime evidence' },
    'session-id': { type: 'string', description: 'Session id to scope runtime evidence' },
    'candidate-id': { type: 'string', description: 'Memory learning candidate id' },
    'failure-id': { type: 'string', description: 'Workflow eval failure replay id' },
    type: { type: 'string', description: 'Memory type override: fact/decision/incident/relation/contradiction' },
    scope: { type: 'string', description: 'Memory scope: project/workspace/global-candidate' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    let from: ReturnType<typeof normalizeMemorySource>
    let type: ReturnType<typeof normalizeMemoryNodeType>
    let scope: ReturnType<typeof normalizeMemoryScope>
    try {
      from = normalizeMemorySource(args.from)
      type = normalizeMemoryNodeType(args.type)
      scope = normalizeMemoryScope(args.scope)
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
      return
    }
    const report = memoryBrain().ingest({
      from,
      taskId: args['task-id'],
      sessionId: args['session-id'],
      candidateId: args['candidate-id'],
      failureId: args['failure-id'],
      type,
      scope,
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log('\nSCALE Memory Ingest')
    console.log(`  Source: ${report.source}`)
    console.log(`  Created: ${report.created}`)
    console.log(`  Skipped: ${report.skipped}`)
    for (const node of report.nodes) console.log(`  [${node.status}] ${node.id}: ${node.title}`)
    for (const warning of report.warnings) console.log(`  [WARN] ${warning}`)
    if (!report.ok) process.exitCode = 1
  },
})

const memoryQuery = defineCommand({
  meta: { name: 'query', description: 'Query concise project-scoped long-term memory with evidence references' },
  args: {
    query: { type: 'positional', required: true, description: 'Search query' },
    limit: { type: 'string', default: '8', description: 'Maximum number of memory nodes' },
    status: { type: 'string', description: 'Filter by status: candidate/active/stale/rejected' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const limit = Number.parseInt(String(args.limit ?? '8'), 10)
    const status = args.status ? String(args.status) as 'candidate' | 'active' | 'stale' | 'rejected' : undefined
    const report = memoryBrain().query(String(args.query), {
      limit: Number.isFinite(limit) && limit > 0 ? limit : 8,
      status,
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log('\nSCALE Memory Query')
    console.log(`  Query: ${report.query}`)
    console.log(`  Results: ${report.count}`)
    for (const node of report.nodes) {
      console.log(`  [${node.status}/${node.type}] ${node.id}: ${node.title}`)
      console.log(`    confidence: ${node.confidence}; evidence: ${node.evidencePaths.join(', ') || 'none'}`)
      console.log(`    ${node.summary}`)
    }
  },
})

const memoryContradictions = defineCommand({
  meta: { name: 'contradictions', description: 'Report conflicting project memory instead of silently resolving it' },
  args: {
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const report = memoryBrain().contradictions()
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log('\nSCALE Memory Contradictions')
    console.log(`  Count: ${report.count}`)
    for (const item of report.contradictions) {
      console.log(`  [CONFLICT] ${item.title}`)
      console.log(`    nodes: ${item.nodeIds.join(', ')}`)
      console.log(`    evidence: ${item.evidencePaths.join(', ') || 'none'}`)
    }
    if (!report.ok) process.exitCode = 1
  },
})

const memoryDream = defineCommand({
  meta: { name: 'dream', description: 'Run memory maintenance: duplicates, stale memories, contradictions, and promotion candidates' },
  args: {
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const report = memoryBrain().dream()
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log('\nSCALE Memory Dream')
    console.log(`  Total: ${report.summary.total}`)
    console.log(`  Active: ${report.summary.active}`)
    console.log(`  Candidates: ${report.summary.candidate}`)
    console.log(`  Contradictions: ${report.summary.contradictions}`)
    console.log(`  Duplicate groups: ${report.summary.duplicateGroups}`)
    for (const item of report.promotionCandidates) console.log(`  [PROMOTE?] ${item.id}: ${item.title}`)
    for (const item of report.staleCandidates) console.log(`  [STALE] ${item.id}: ${item.reason}`)
    if (!report.ok) process.exitCode = 1
  },
})

const memoryPromote = defineCommand({
  meta: { name: 'promote', description: 'Promote a memory candidate to active project memory after evidence review' },
  args: {
    id: { type: 'positional', required: true, description: 'Memory node id or learning candidate id' },
    scope: { type: 'string', description: 'Scope override: project/workspace/global-candidate' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    let scope: ReturnType<typeof normalizeMemoryScope>
    try {
      scope = normalizeMemoryScope(args.scope)
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
      return
    }
    const report = memoryBrain().promote(String(args.id), { scope })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log('\nSCALE Memory Promote')
    console.log(`  Status: ${report.ok ? 'promoted' : 'blocked'}`)
    if (report.node) console.log(`  Node: ${report.node.id} (${report.node.status})`)
    for (const warning of report.warnings) console.log(`  [WARN] ${warning}`)
    if (!report.ok) process.exitCode = 1
  },
})

const memoryExport = defineCommand({
  meta: { name: 'export', description: 'Export project memory as JSONL' },
  args: {
    output: { type: 'string', alias: 'o', description: 'Output JSONL file; stdout when omitted' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const jsonl = memoryBrain().exportJsonl()
    if (args.output) {
      const outputPath = resolve(PROJECT_DIR, String(args.output))
      ensureDir(dirname(outputPath))
      writeFileSync(outputPath, jsonl, 'utf-8')
      if (args.json) {
        console.log(JSON.stringify({ ok: true, outputPath, bytes: jsonl.length }, null, 2))
        return
      }
      console.log(`[OK] Memory JSONL exported: ${outputPath}`)
      return
    }
    console.log(jsonl)
  },
})

const memoryImport = defineCommand({
  meta: { name: 'import', description: 'Import project memory from JSONL' },
  args: {
    file: { type: 'positional', required: true, description: 'Input JSONL file' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const filePath = resolve(PROJECT_DIR, String(args.file))
    const report = memoryBrain().importJsonl(filePath)
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log('\nSCALE Memory Import')
    console.log(`  Imported: ${report.imported}`)
    console.log(`  Skipped: ${report.skipped}`)
    for (const warning of report.warnings) console.log(`  [WARN] ${warning}`)
    if (!report.ok) process.exitCode = 1
  },
})

const memoryProviderInit = defineCommand({
  meta: { name: 'init', description: 'Create .scale/memory-providers.json for autonomous memory provider routing' },
  args: {
    force: { type: 'boolean', default: false, description: 'Overwrite existing provider configuration' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const result = writeMemoryProvidersConfig({
      projectDir: PROJECT_DIR,
      scaleDir: SCALE_DIR,
      force: isTruthyFlag(args.force),
    })
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log(`\nSCALE Memory Provider Config: ${result.path}`)
    console.log(`  ${result.written ? 'written' : 'exists'}`)
    console.log(`  Order: ${result.config.routing.defaultOrder.join(' -> ')}`)
  },
})

const memoryProviderStatus = defineCommand({
  meta: { name: 'status', description: 'Inspect memory provider routing, availability, and safety boundaries' },
  args: {
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const report = inspectMemoryProviders({ projectDir: PROJECT_DIR, scaleDir: SCALE_DIR })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log('\nSCALE Memory Providers')
    console.log(`  Config: ${report.configExists ? report.configPath : 'default policy (not written)'}`)
    console.log(`  Mode: ${report.routing.mode}`)
    for (const provider of report.providers) {
      console.log(`  [${provider.available ? 'AVAILABLE' : 'SKIP'}] ${provider.id} (${provider.kind})`)
      console.log(`    safety: ${provider.safetyLevel}; write: ${provider.writeMode}; reason: ${provider.reason}`)
    }
    for (const warning of report.warnings) console.log(`  [WARN] ${warning}`)
  },
})

const memoryProviderRecall = defineCommand({
  meta: { name: 'recall', description: 'Recall relevant memory through provider routing with local fallback' },
  args: {
    query: { type: 'positional', required: true, description: 'Memory query or task context' },
    task: { type: 'string', description: 'Optional task text for provider routing context' },
    files: { type: 'string', description: 'Comma-separated files or modules in scope' },
    provider: { type: 'string', description: 'Force one provider id, such as agentmemory, gbrain, or scale-local' },
    limit: { type: 'string', default: '5', description: 'Maximum results' },
    'include-candidates': { type: 'boolean', default: false, description: 'Allow scale-local candidate memory fallback' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const limit = Number.parseInt(String(args.limit ?? '5'), 10)
    const report = await recallMemoryProviders({
      projectDir: PROJECT_DIR,
      scaleDir: SCALE_DIR,
      query: String(args.query),
      task: args.task ? String(args.task) : undefined,
      files: parseCommaList(args.files),
      provider: args.provider ? String(args.provider) : undefined,
      limit: Number.isFinite(limit) && limit > 0 ? limit : 5,
      includeCandidates: isTruthyFlag(args['include-candidates']),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log('\nSCALE Memory Provider Recall')
    console.log(`  Query: ${report.query}`)
    console.log(`  Providers: ${report.providerOrder.join(' -> ')}`)
    console.log(`  Results: ${report.items.length}`)
    for (const item of report.items) {
      console.log(`  [${item.provider}] ${item.id}: ${item.title}`)
      console.log(`    score: ${item.score}; confidence: ${item.confidence}; evidence: ${item.evidencePaths.join(', ') || 'none'}`)
      console.log(`    ${item.summary}`)
    }
    for (const warning of report.warnings) console.log(`  [WARN] ${warning}`)
  },
})

const memoryProviderUse = defineCommand({
  meta: { name: 'use', description: 'Promote one memory provider to the front of routing and persist the selection' },
  args: {
    provider: { type: 'positional', required: true, description: 'Provider id: gbrain, agentmemory, or scale-local' },
    mode: { type: 'string', description: 'Optional routing mode override: auto, local-only, external-first' },
    endpoint: { type: 'string', description: 'Optional provider endpoint to persist while switching' },
    'write-mode': { type: 'string', description: 'Optional provider write mode: disabled, candidate-only, enabled' },
    'allow-external-write': { type: 'boolean', default: false, description: 'Persist external write allowance when explicitly switching' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const mode = args.mode ? String(args.mode) : undefined
    const writeMode = args['write-mode']
      ? String(args['write-mode']) as 'disabled' | 'candidate-only' | 'enabled'
      : undefined
    const report = useMemoryProvider({
      projectDir: PROJECT_DIR,
      scaleDir: SCALE_DIR,
      provider: String(args.provider),
      mode: mode as 'auto' | 'local-only' | 'external-first' | undefined,
      endpoint: args.endpoint ? String(args.endpoint) : undefined,
      writeMode,
      allowExternalWrite: isTruthyFlag(args['allow-external-write']) ? true : undefined,
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log('\nSCALE Memory Provider Switch')
    console.log(`  Provider: ${report.provider}`)
    console.log(`  Mode: ${report.mode}`)
    console.log(`  Config: ${report.path}`)
    console.log(`  Order: ${report.previousOrder.join(' -> ')} -> ${report.nextOrder.join(' -> ')}`)
    if (report.providerStatus) {
      console.log(`  Status: ${report.providerStatus.available ? 'available' : 'not-ready'} (${report.providerStatus.reason})`)
    }
    for (const warning of report.warnings) console.log(`  [WARN] ${warning}`)
    if (!report.ok) process.exitCode = 1
  },
})

const memoryProvider = defineCommand({
  meta: { name: 'provider', description: 'Manage autonomous memory provider routing for agentmemory, gbrain, and scale-local' },
  subCommands: {
    init: memoryProviderInit,
    status: memoryProviderStatus,
    recall: memoryProviderRecall,
    use: memoryProviderUse,
  },
})

const memory = defineCommand({
  meta: { name: 'memory', description: 'Memory Fabric context packs and project-scoped long-term memory' },
  subCommands: {
    pack: memoryPack,
    doctor: memoryDoctor,
    cerebrum: memoryCerebrum,
    settle: memorySettle,
    ingest: memoryIngest,
    query: memoryQuery,
    contradictions: memoryContradictions,
    dream: memoryDream,
    promote: memoryPromote,
    export: memoryExport,
    import: memoryImport,
    provider: memoryProvider,
  },
})

// ============================================================================
// out-of-scope command — 借鉴 mattpocock/skills 的 .out-of-scope/ 设计
// ============================================================================

const outOfScopeAdd = defineCommand({
  meta: { name: 'add', description: 'Record a rejected concept to the out-of-scope knowledge base' },
  args: {
    concept: { type: 'positional', required: true, description: 'kebab-case concept name' },
    title: { type: 'string', required: true, description: 'Human-readable title' },
    reason: { type: 'string', required: true, description: 'Why this was rejected' },
    'tech-context': { type: 'string', description: 'Technical constraints that led to rejection' },
    'prior-requests': { type: 'string', description: 'Comma-separated issue IDs or URLs' },
  },
  run({ args }) {
    ensureDir(SCALE_DIR)
    const store = new OutOfScopeStore(SCALE_DIR)
    const entry = store.add({
      concept: args.concept,
      title: args.title,
      reason: args.reason,
      technicalContext: args['tech-context'],
      priorRequests: args['prior-requests']?.split(',').map(s => s.trim()) ?? [],
    })
    console.log(JSON.stringify({ ok: true, concept: entry.concept, title: entry.title, priorRequests: entry.priorRequests.length }, null, 2))
  },
})

const outOfScopeCheck = defineCommand({
  meta: { name: 'check', description: 'Check if a concept matches any existing out-of-scope entry' },
  args: {
    concept: { type: 'positional', required: true, description: 'Concept name to check' },
    description: { type: 'string', description: 'Optional description for fuzzy matching' },
  },
  run({ args }) {
    ensureDir(SCALE_DIR)
    const store = new OutOfScopeStore(SCALE_DIR)
    const match = store.check(args.concept, args.description)
    if (match) {
      console.log(JSON.stringify({ ok: true, matched: true, concept: match.concept, title: match.title, reason: match.reason, priorRequests: match.priorRequests }, null, 2))
    } else {
      console.log(JSON.stringify({ ok: true, matched: false }, null, 2))
    }
  },
})

const outOfScopeList = defineCommand({
  meta: { name: 'list', description: 'List all out-of-scope entries' },
  run() {
    ensureDir(SCALE_DIR)
    const store = new OutOfScopeStore(SCALE_DIR)
    const entries = store.list()
    console.log(JSON.stringify({ ok: true, total: entries.length, entries: entries.map(e => ({ concept: e.concept, title: e.title, priorRequests: e.priorRequests.length, updatedAt: new Date(e.updatedAt).toISOString() })) }, null, 2))
  },
})

const outOfScopeRemove = defineCommand({
  meta: { name: 'remove', description: 'Remove an out-of-scope entry (concept reconsidered)' },
  args: {
    concept: { type: 'positional', required: true, description: 'Concept name to remove' },
  },
  run({ args }) {
    ensureDir(SCALE_DIR)
    const store = new OutOfScopeStore(SCALE_DIR)
    const removed = store.remove(args.concept)
    console.log(JSON.stringify({ ok: removed, concept: args.concept }, null, 2))
  },
})

const outOfScope = defineCommand({
  meta: { name: 'out-of-scope', description: 'Manage out-of-scope knowledge base (rejected concepts with institutional memory)' },
  subCommands: { add: outOfScopeAdd, check: outOfScopeCheck, list: outOfScopeList, remove: outOfScopeRemove },
})

// ============================================================================
// skill command — 技能发现
// ============================================================================

const skillScan = defineCommand({
  meta: { name: 'scan', description: 'Scan for installed skills' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    json: { type: 'boolean', default: false, description: 'Output scan result as JSON' },
  },
  async run({ args }) {
    const discovery = new SkillDiscovery(args.dir)
    const platform = discovery.detectPlatform()
    if (!platform && args.json) {
      console.log(JSON.stringify({
        ok: false,
        platform: null,
        skills: [],
        message: 'No agent platform detected. Run `scale init` first.',
      }, null, 2))
      return
    }

    if (!platform) {
      console.log('\n⚠️  No agent platform detected. Run `scale init` first.')
      return
    }

    const result = discovery.scanSkills(platform)
    if (args.json) {
      console.log(JSON.stringify({
        ok: true,
        platform: result.platform,
        count: result.skills.length,
        skills: result.skills,
      }, null, 2))
      return
    }
    console.log(`\n🔍 Platform: ${result.platform}`)
    console.log(`📦 Skills found: ${result.skills.length}`)

    if (result.skills.length > 0) {
      for (const skill of result.skills) {
        const status = skill.enabled ? '✅' : '❌'
        const desc = skill.description ? ` — ${skill.description}` : ''
        console.log(`  ${status} ${skill.name}${desc}`)
      }
    } else {
      console.log('  No skills found in platform skills directory.')
    }
  },
})

const skillPlanCommand = defineCommand({
  meta: { name: 'plan', description: 'Create or refresh a task skill plan' },
  args: {
    'task-id': { type: 'positional', required: true },
    dir: { type: 'string', description: 'Task artifact directory; defaults to current state artifactsDir' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const { store } = getEngine()
    const task = await store.get(args['task-id'])
    if (!task || task.type !== 'Task') {
      console.error(`Task not found: ${args['task-id']}`)
      process.exit(1)
    }

    const payload = task.payload as TaskPayload
    const level = normalizeTaskArtifactLevel(payload.workflowLevel ?? 'M')
    const policy = loadSkillRoutingPolicy(PROJECT_DIR, SCALE_DIR)
    const plan = createSkillPlan({
      taskId: task.id,
      taskName: task.title,
      description: payload.description,
      level,
      services: payload.servicesTouched ?? [],
      files: payload.filesInvolved ?? [],
      policy,
    })
    const updatedPayload: TaskPayload = {
      ...payload,
      skillIntents: plan.intents.map(intent => intent.domain),
      skillRoutingMode: plan.mode,
      skillPlanRequired: plan.required,
      requiredSkills: plan.requiredSkills,
      recommendedSkills: plan.recommendedSkills,
      requiredSkillArtifacts: plan.requiredArtifacts,
      requiredSkillVerification: plan.requiredVerification,
    }
    await store.update(task.id, { payload: updatedPayload })

    const state = new WorkflowArtifactWriter(SCALE_DIR).readCurrentState()
    const artifactsDir = args.dir ?? (state?.taskId === task.id ? state.artifactsDir : undefined)
    let writtenPath: string | undefined
    if (artifactsDir) {
      const dir = resolve(PROJECT_DIR, artifactsDir)
      ensureDir(dir)
      writtenPath = join(dir, 'skill-plan.md')
      writeFileSync(writtenPath, skillPlanMarkdown(plan), 'utf-8')
    }
    new WorkflowArtifactWriter(SCALE_DIR).updateCurrentState({
      taskId: task.id,
      level,
      phase: 'plan',
      artifactsDir,
      skillIntents: plan.intents.map(intent => intent.domain),
      skillRoutingMode: plan.mode,
      skillPlanRequired: plan.required,
      skillPlanPath: writtenPath,
      requiredSkills: plan.requiredSkills,
      recommendedSkills: plan.recommendedSkills,
      requiredSkillArtifacts: plan.requiredArtifacts,
      requiredSkillVerification: plan.requiredVerification,
    })

    if (args.json) {
      console.log(JSON.stringify({ plan, writtenPath }, null, 2))
      return
    }
    console.log('\nSkill Plan')
    console.log(`  Task: ${task.id}`)
    console.log(`  Intents: ${plan.intents.map(intent => intent.domain).join(', ') || 'none'}`)
    console.log(`  Required skills: ${plan.requiredSkills.join(', ') || 'none'}`)
    console.log(`  Recommended skills: ${plan.recommendedSkills.join(', ') || 'none'}`)
    console.log(`  Required artifacts: ${plan.requiredArtifacts.join(', ') || 'none'}`)
    if (writtenPath) console.log(`  Written: ${writtenPath}`)
  },
})

const skillDoctorCommand = defineCommand({
  meta: { name: 'doctor', description: 'Check workflow skill installation status' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'supply-chain': { type: 'boolean', default: false, description: 'Include supply-chain safety review for known skill sources' },
    json: { type: 'boolean', default: false, description: 'Output skill doctor report as JSON' },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const report = inspectWorkflowSkills({ projectDir })
    const supplyChain = isTruthyFlag(args['supply-chain']) ? inspectSkillSupplyChain({ projectDir }) : undefined
    if (args.json) {
      console.log(JSON.stringify(supplyChain ? { installation: report, supplyChain } : report, null, 2))
      return
    }
    console.log('\nSCALE Skill Doctor')
    console.log(`  Installed: ${report.installed}/${report.total}`)
    for (const skill of report.skills) {
      console.log(`  ${skill.installed ? '[OK]' : '[MISSING]'} ${skill.id}`)
      if (skill.detectedPath) console.log(`    path: ${skill.detectedPath}`)
      if (!skill.installed) console.log(`    install: ${skill.installCommand}`)
    }
    if (supplyChain) {
      console.log('\nSkill Supply Chain')
      console.log(`  Evaluated: ${supplyChain.evaluated}`)
      console.log(`  Blocked: ${supplyChain.blocked}`)
      console.log(`  Warnings: ${supplyChain.warnings}`)
      for (const entry of supplyChain.entries.filter(entry => entry.blocked || entry.findings.length > 0)) {
        console.log(`  [${entry.blocked ? 'BLOCKED' : 'WARN'}] ${entry.id}: ${entry.risk}`)
        for (const finding of entry.findings) console.log(`    - ${finding.rule}: ${finding.message}`)
      }
    }
    if (!report.ok || supplyChain?.ok === false) process.exitCode = 1
  },
})

const skillCheckCommand = defineCommand({
  meta: { name: 'check', description: 'Check required skill evidence artifacts' },
  args: {
    dir: { type: 'string', description: 'Task artifact directory; defaults to current state artifactsDir' },
    level: { type: 'string', description: 'Task level: S, M, L, or CRITICAL; defaults to current state level or M' },
    'require-installed': { type: 'boolean', default: false, description: 'Fail when required workflow skills are not installed locally' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const state = new WorkflowArtifactWriter(SCALE_DIR).readCurrentState()
    const level = normalizeTaskArtifactLevel(args.level ?? state?.level ?? 'M')
    const policy = loadSkillRoutingPolicy(PROJECT_DIR, SCALE_DIR)
    const result = evaluateSkillGate({
      projectDir: PROJECT_DIR,
      artifactsDir: args.dir ?? state?.artifactsDir,
      level,
      requiredArtifacts: state?.requiredSkillArtifacts,
      requiredSkills: state?.requiredSkills,
      mode: state?.skillRoutingMode ?? policy.policy.mode,
      enforceLevels: policy.policy.enforceLevels,
    })
    const skillInstallation = inspectRequiredWorkflowSkills(state?.requiredSkills ?? [], { projectDir: PROJECT_DIR })
    const requireInstalled = isTruthyFlag(args['require-installed'])
    const blocked = result.blocked || (requireInstalled && !skillInstallation.ok)
    const output = {
      ...result,
      complete: result.complete && (!requireInstalled || skillInstallation.ok),
      blocked,
      skillInstallation: {
        ...skillInstallation,
        checked: requireInstalled,
      },
    }

    if (args.json) {
      console.log(JSON.stringify(output, null, 2))
      return
    }
    console.log(`\nSkill Gate: ${output.complete ? 'COMPLETE' : 'INCOMPLETE'}`)
    console.log(`  Mode: ${output.mode}`)
    console.log(`  Required artifacts: ${output.required.join(', ') || 'none'}`)
    console.log(`  Required skills: ${skillInstallation.required.join(', ') || 'none'}`)
    for (const file of output.missing) console.log(`  [MISSING] ${file}`)
    for (const item of output.incomplete) console.log(`  [INCOMPLETE] ${item.file}: ${item.reason}`)
    if (requireInstalled && !skillInstallation.ok) {
      for (const skill of skillInstallation.skills.filter(skill => !skill.installed)) {
        console.log(`  [MISSING_SKILL] ${skill.id}: ${skill.installCommand}`)
      }
      for (const skill of skillInstallation.unknown) console.log(`  [UNKNOWN_SKILL] ${skill}`)
    }
    if (blocked) process.exitCode = 1
  },
})

const skillRepoCommand = defineCommand({
  meta: { name: 'repo', description: 'Show SCALE progressive skill repository guide' },
  args: {
    category: { type: 'string', description: 'Filter by category: ui/browser/desktop/testing/review/docs/agent-cli/role-library/discovery' },
    output: { type: 'string', alias: 'o', description: 'Write markdown guide to file' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    if (args.json) {
      console.log(JSON.stringify(listSkillRepositoryEntries(args.category ? { category: args.category as never } : undefined), null, 2))
      return
    }
    const markdown = renderSkillRepositoryMarkdown()
    if (args.output) {
      const outputPath = resolve(PROJECT_DIR, args.output)
      ensureDir(resolve(outputPath, '..'))
      writeFileSync(outputPath, markdown, 'utf-8')
      console.log(`[OK] Skill 仓库指南已生成: ${outputPath}`)
      return
    }
    console.log(markdown)
  },
})

const skillSafetyCommand = defineCommand({
  meta: { name: 'safety', description: 'Evaluate skill install command and source safety' },
  args: {
    source: { type: 'string', description: 'Skill source URL' },
    command: { type: 'string', description: 'Install command to review' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const report = evaluateSkillInstallSafety({
      sourceUrl: args.source,
      installCommand: args.command,
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log('\nSCALE Skill Safety')
    console.log(`  Risk: ${report.risk}`)
    console.log(`  Blocked: ${report.blocked}`)
    for (const finding of report.findings) {
      console.log(`  [${finding.severity.toUpperCase()}] ${finding.rule}: ${finding.message}`)
    }
    console.log('  Required checks:')
    for (const check of report.requiredChecks) console.log(`  - ${check}`)
    if (report.blocked) process.exitCode = 1
  },
})

const skillRadarCommand = defineCommand({
  meta: { name: 'radar', description: 'Recommend skills, MCP, and CLI capabilities with confidence, safety, and evidence requirements' },
  args: {
    task: { type: 'string', required: true, description: 'Task description' },
    phase: { type: 'string', description: 'Workflow phase' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    files: { type: 'string', description: 'Comma-separated changed or relevant files' },
    services: { type: 'string', description: 'Comma-separated services or modules' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    output: { type: 'string', alias: 'o', description: 'Write markdown report to file' },
    json: { type: 'boolean', default: false, description: 'Output radar report as JSON' },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const report = evaluateSkillRadar({
      projectDir,
      scaleDir,
      task: String(args.task),
      phase: args.phase ? String(args.phase) : undefined,
      level: String(args.level ?? 'M'),
      files: parseCommaList(args.files),
      services: parseCommaList(args.services),
    })

    if (args.output) {
      const outputPath = resolve(projectDir, String(args.output))
      ensureDir(dirname(outputPath))
      writeFileSync(outputPath, renderSkillRadarMarkdown(report), 'utf-8')
    }

    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }

    console.log('\nSCALE Skill Radar')
    console.log(`  Task: ${report.task}`)
    console.log(`  Level: ${report.level}`)
    console.log(`  Domains: ${report.detectedDomains.map(domain => `${domain.domain}:${domain.score}`).join(', ') || 'none'}`)
    console.log(`  Policy: ${report.policyMode}`)
    console.log(`  Tools: ${report.toolSummary.installed}/${report.toolSummary.total} installed`)
    for (const item of report.recommendations.slice(0, 8)) {
      console.log(`  [${item.action}] ${item.id} confidence=${item.confidence.toFixed(2)} safety=${item.safetyLevel}`)
      console.log(`    evidence: ${item.requiredEvidence.join(', ') || 'none'}`)
      if (item.safetyLevel === 'blocked' || item.action === 'suggest-fallback') console.log(`    fallback: ${item.fallback}`)
    }
    if (args.output) console.log(`  Report: ${resolve(projectDir, String(args.output))}`)
    if (!report.ok) process.exitCode = 1
  },
})

const skillRecommendCommand = defineCommand({
  meta: { name: 'recommend', description: 'Recommend a composable skill workflow for a task' },
  args: {
    task: { type: 'string', required: true, description: 'Task description' },
    phase: { type: 'string', description: 'Workflow phase' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const plan = recommendSkillWorkflow({
      description: args.task,
      phase: args.phase,
    })
    if (args.json) {
      console.log(JSON.stringify(plan, null, 2))
      return
    }
    console.log('\nSCALE Skill Recommendation')
    console.log(`  Primary: ${plan.primarySkills.join(', ') || 'none'}`)
    console.log(`  Supporting: ${plan.supportingSkills.join(', ') || 'none'}`)
    console.log(`  Safety required: ${plan.safetyRequired}`)
    console.log(`  Evidence: ${plan.requiredEvidence.join(', ') || 'none'}`)
    for (const reason of plan.rationale) console.log(`  - ${reason}`)
  },
})

const skillOutdatedCommand = defineCommand({
  meta: { name: 'outdated', description: 'List skill update surfaces without installing or upgrading anything' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = createThirdPartyUpdateReport('skill')
    if (args.json) {
      console.log(JSON.stringify({ ...report, projectDir: resolve(String(args.dir ?? PROJECT_DIR)) }, null, 2))
      return
    }
    console.log('\nSCALE Skill Outdated')
    console.log(`  Policy: ${report.policy}`)
    console.log(`  Skills: ${report.summary.total}`)
    console.log(`  Review required: ${report.reviewRequired}`)
    for (const entry of report.entries) {
      console.log(`  [${entry.updatePolicy}] ${entry.id} trust=${entry.trust} latest=${entry.latestVersion}`)
      if (entry.source) console.log(`    source: ${entry.source}`)
      console.log(`    reason: ${entry.reason}`)
    }
  },
})

const skill = defineCommand({
  meta: { name: 'skill', description: 'Skill discovery and management' },
  subCommands: {
    scan: skillScan,
    doctor: skillDoctorCommand,
    plan: skillPlanCommand,
    check: skillCheckCommand,
    repo: skillRepoCommand,
    safety: skillSafetyCommand,
    radar: skillRadarCommand,
    recommend: skillRecommendCommand,
    outdated: skillOutdatedCommand,
  },
})

// ============================================================================
// tool command - Skills/MCP/CLI orchestration governance
// ============================================================================

function normalizeToolMode(value: unknown): ToolOrchestrationMode {
  const normalized = String(value ?? 'evidence-required')
  if (normalized === 'off' || normalized === 'advisory' || normalized === 'evidence-required' || normalized === 'block') return normalized
  return 'evidence-required'
}

function parseToolIds(value: unknown): string[] | undefined {
  const raw = String(value ?? '').trim()
  if (!raw) return undefined
  return raw.split(',').map(item => item.trim()).filter(Boolean)
}

function parseCommaList(value: unknown): string[] {
  return parseToolIds(value) ?? []
}

function normalizeAiOsRunMode(value: unknown, forceDryRun = false): 'dry-run' | 'guarded' {
  if (forceDryRun) return 'dry-run'
  const normalized = String(value ?? 'dry-run').trim().toLowerCase()
  if (normalized === 'dry-run' || normalized === 'guarded') return normalized
  throw new Error(`Invalid AI OS run mode "${String(value)}"; expected dry-run or guarded.`)
}

function createToolExecutionPlanFromArgs(args: Record<string, unknown>) {
  const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
  const level = normalizeTaskArtifactLevel(args.level ?? 'M')
  const skillPolicy = loadSkillRoutingPolicy(projectDir, SCALE_DIR)
  const skillPlan = createSkillPlan({
    taskId: String(args['task-id'] ?? `TOOL-${Date.now()}`),
    taskName: String(args.task ?? 'Tool orchestration task'),
    description: String(args.task ?? ''),
    level,
    files: parseCommaList(args.files),
    services: parseCommaList(args.services),
    policy: skillPolicy,
  })
  const toolPolicy = loadToolPolicy(projectDir, SCALE_DIR)
  const toolIds = uniqueStrings([
    ...skillPlan.requiredSkills,
    ...skillPlan.recommendedSkills,
    ...Object.keys(toolPolicy.tools).filter(toolId => {
      const config = toolPolicy.tools[toolId]
      const domains = new Set(skillPlan.intents.map(intent => intent.domain))
      return config.enabled && (
        config.requiredFor.some(domain => domains.has(domain)) ||
        (config.recommendedFor ?? []).some(domain => domains.has(domain))
      )
    }),
  ])
  const capabilityReport = inspectToolCapabilities({
    projectDir,
    toolIds,
  })
  const orchestrator = new ToolOrchestrator({
    projectDir,
    policy: toolPolicy,
    capabilityReport,
    evidenceStore: new ToolEvidenceStore({ projectDir, scaleDir: SCALE_DIR }),
  })
  return {
    projectDir,
    skillPlan,
    orchestrator,
    plan: orchestrator.plan({ skillPlan }),
    capabilityReport,
  }
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)]
}

const toolPolicyCommand = defineCommand({
  meta: { name: 'policy', description: 'Show resolved tool orchestration policy' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    mode: { type: 'string', description: 'Render a starter policy mode instead of reading .scale/tools.json' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const policy: ResolvedToolPolicy = args.mode
      ? JSON.parse(toolPolicyTemplate(normalizeToolMode(args.mode))) as ResolvedToolPolicy
      : loadToolPolicy(args.dir, SCALE_DIR)
    if (args.json) {
      console.log(JSON.stringify(policy, null, 2))
      return
    }
    console.log('\nSCALE Tool Policy')
    console.log(`  Mode: ${policy.mode}`)
    console.log(`  Tools: ${Object.keys(policy.tools).length}`)
    for (const [id, config] of Object.entries(policy.tools)) {
      const state = config.enabled ? '[ON]' : '[OFF]'
      console.log(`  ${state} ${id}: requiredFor=${config.requiredFor.join(',') || 'none'}`)
    }
  },
})

const toolDoctorCommand = defineCommand({
  meta: { name: 'doctor', description: 'Check skill, MCP, and CLI tool availability' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    tools: { type: 'string', description: 'Comma-separated tool ids to check' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const report = inspectToolCapabilities({
      projectDir: args.dir,
      toolIds: parseToolIds(args.tools),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log('\nSCALE Tool Doctor')
      console.log(`  Installed: ${report.summary.installed}/${report.summary.total}`)
      for (const entry of report.tools) {
        console.log(`  ${entry.installed ? '[OK]' : '[MISSING]'} ${entry.id}`)
        if (entry.detectedPath) console.log(`    path: ${entry.detectedPath}`)
        if (entry.version) console.log(`    version: ${entry.version}`)
        if (entry.missingReason) console.log(`    reason: ${entry.missingReason}`)
        if (!entry.installed && entry.installHint) console.log(`    install: ${entry.installHint}`)
      }
    }
    if (!report.ok) process.exitCode = 1
  },
})

const toolPlanCommand = defineCommand({
  meta: { name: 'plan', description: 'Create a tool execution plan from task intent' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    'task-id': { type: 'string', required: true, description: 'Task id for evidence linkage' },
    task: { type: 'string', required: true, description: 'Task description' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    files: { type: 'string', description: 'Comma-separated changed or target files' },
    services: { type: 'string', description: 'Comma-separated affected services' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const result = createToolExecutionPlanFromArgs(args)
    if (args.json) {
      console.log(JSON.stringify(result.plan, null, 2))
      return
    }
    console.log('\nSCALE Tool Plan')
    console.log(`  Task: ${result.plan.taskId}`)
    console.log(`  Mode: ${result.plan.mode}`)
    console.log(`  Steps: ${result.plan.steps.length}`)
    for (const step of result.plan.steps) {
      console.log(`  ${step.status === 'ready' ? '[READY]' : '[MISSING]'} ${step.toolId} (${step.adapter}) required=${step.required}`)
    }
    for (const blocker of result.plan.blockers) console.log(`  [BLOCKER] ${blocker}`)
    for (const warning of result.plan.warnings) console.log(`  [WARN] ${warning}`)
  },
})

const toolRunCommand = defineCommand({
  meta: { name: 'run', description: 'Run or dry-run a tool execution plan and write tool evidence' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    'task-id': { type: 'string', required: true, description: 'Task id for evidence linkage' },
    task: { type: 'string', required: true, description: 'Task description' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    files: { type: 'string', description: 'Comma-separated changed or target files' },
    services: { type: 'string', description: 'Comma-separated affected services' },
    'dry-run': { type: 'boolean', default: false, description: 'Plan and record skipped evidence without executing tools' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const result = createToolExecutionPlanFromArgs(args)
    const report = await result.orchestrator.run(result.plan, {
      dryRun: isTruthyFlag(args['dry-run']),
    })
    if (toolEvidenceRunCompletesOpenTask(report)) {
      const writer = new WorkflowArtifactWriter(SCALE_DIR)
      const current = writer.readCurrentState()
      if (current?.taskId === report.taskId) {
        writer.updateCurrentState({
          taskId: report.taskId,
          openTasks: removeWorkflowOpenTask(current.openTasks, 'tool-evidence'),
        })
      }
    }
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log('\nSCALE Tool Run')
      console.log(`  Task: ${report.taskId}`)
      console.log(`  Dry-run: ${report.dryRun}`)
      console.log(`  Evidence: ${report.evidence.length}`)
      for (const record of report.evidence) {
        console.log(`  [${record.status.toUpperCase()}] ${record.tool} -> ${record.id}`)
      }
      for (const blocker of report.blockers) console.log(`  [BLOCKER] ${blocker}`)
      for (const warning of report.warnings) console.log(`  [WARN] ${warning}`)
    }
    if (!report.ok) process.exitCode = 1
  },
})

const toolEvidenceCommand = defineCommand({
  meta: { name: 'evidence', description: 'Check required tool execution evidence for a task' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    'task-id': { type: 'string', required: true, description: 'Task id for evidence linkage' },
    task: { type: 'string', required: true, description: 'Task description' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    files: { type: 'string', description: 'Comma-separated changed or target files' },
    services: { type: 'string', description: 'Comma-separated affected services' },
    mode: { type: 'string', description: 'Override tool gate mode: off, advisory, evidence-required, or block' },
    'allow-skipped': { type: 'boolean', default: false, description: 'Allow skipped/manual fallback evidence to satisfy required tools' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const result = createToolExecutionPlanFromArgs(args)
    const gate = evaluateToolEvidenceGate({
      projectDir: result.projectDir,
      level: normalizeTaskArtifactLevel(args.level ?? 'M'),
      plan: result.plan,
      evidenceStore: new ToolEvidenceStore({ projectDir: result.projectDir, scaleDir: SCALE_DIR }),
      mode: args.mode ? normalizeToolMode(args.mode) : result.plan.mode,
      allowSkipped: isTruthyFlag(args['allow-skipped']),
    })
    if (args.json) {
      console.log(JSON.stringify(gate, null, 2))
    } else {
      console.log('\nSCALE Tool Evidence Gate')
      console.log(`  Task: ${gate.taskId ?? args['task-id']}`)
      console.log(`  Mode: ${gate.mode}`)
      console.log(`  Complete: ${gate.complete}`)
      console.log(`  Required tools: ${gate.requiredTools.join(', ') || 'none'}`)
      for (const item of gate.missing) console.log(`  [MISSING] ${item.toolId}: ${item.reason}`)
      for (const item of gate.failed) console.log(`  [FAILED] ${item.toolId}: ${item.reason}`)
      for (const item of gate.skipped) console.log(`  [SKIPPED] ${item.toolId}: ${item.reason}`)
      for (const item of gate.passed) console.log(`  [PASS] ${item.toolId}: ${item.evidenceId ?? 'evidence'}`)
      for (const warning of gate.warnings) console.log(`  [WARN] ${warning}`)
    }
    if (gate.blocked) process.exitCode = 1
  },
})

const toolOutdatedCommand = defineCommand({
  meta: { name: 'outdated', description: 'List MCP, browser, desktop, and external CLI update surfaces without installing anything' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = createThirdPartyUpdateReport(['cli', 'mcp', 'browser', 'desktop'])
    if (args.json) {
      console.log(JSON.stringify({ ...report, projectDir: resolve(String(args.dir ?? PROJECT_DIR)) }, null, 2))
      return
    }
    console.log('\nSCALE Tool Outdated')
    console.log(`  Policy: ${report.policy}`)
    console.log(`  Tools: ${report.summary.total}`)
    console.log(`  Review required: ${report.reviewRequired}`)
    console.log(`  Blocked: ${report.summary.blocked}`)
    for (const entry of report.entries) {
      console.log(`  [${entry.updatePolicy}] ${entry.id} category=${entry.category} trust=${entry.trust} latest=${entry.latestVersion}`)
      if (entry.source) console.log(`    source: ${entry.source}`)
      console.log(`    reason: ${entry.reason}`)
    }
  },
})

const tool = defineCommand({
  meta: { name: 'tool', description: 'Skills, MCP, browser, desktop, and external CLI governance' },
  subCommands: { policy: toolPolicyCommand, doctor: toolDoctorCommand, plan: toolPlanCommand, run: toolRunCommand, evidence: toolEvidenceCommand, outdated: toolOutdatedCommand },
})

// ============================================================================
// agent commands — Multi-Agent 协作系统 (Phase 9)
// ============================================================================

import { AgentPool } from '../agents/AgentPool.js'
import { PROFESSIONAL_AGENTS, getProfile, listProfiles } from '../agents/profiles.js'

const agentPool = new AgentPool()

const agentSpawn = defineCommand({
  meta: { name: 'spawn', description: 'Spawn a new agent instance' },
  args: {
    profile: { type: 'positional', required: true, description: 'Agent profile ID (e.g., frontend-agent)' },
  },
  async run({ args }) {
    const profile = getProfile(args.profile)
    if (!profile) {
      console.error(`Profile not found: ${args.profile}`)
      console.log(`Available profiles: ${listProfiles().join(', ')}`)
      process.exit(1)
    }
    const agent = agentPool.spawn(args.profile)
    console.log(JSON.stringify({ ok: true, agentId: agent.id, profile: agent.profile.name, status: agent.status }, null, 2))
  },
})

const agentList = defineCommand({
  meta: { name: 'list', description: 'List all agent instances' },
  args: {},
  async run() {
    const agents = agentPool.listAll()
    if (agents.length === 0) {
      console.log('No agent instances spawned.')
      return
    }
    console.log(`\n🤖 Agent Instances (${agents.length})`)
    console.log('──────────────────────────────────────────────')
    for (const a of agents) {
      const statusEmoji = { idle: '💤', running: '🔄', blocked: '🚫', completed: '✅', failed: '❌', recycled: '♻️' }[a.status]
      console.log(`  ${statusEmoji} ${a.id} (${a.profile.name})`)
      if (a.assignedTask) console.log(`     Task: ${a.assignedTask}`)
    }
  },
})

const agentProfiles = defineCommand({
  meta: { name: 'profiles', description: 'List available agent profiles' },
  args: {},
  async run() {
    console.log(`\n📋 Agent Profiles (${PROFESSIONAL_AGENTS.length})`)
    console.log('──────────────────────────────────────────────')
    for (const p of PROFESSIONAL_AGENTS) {
      const modelEmoji = { fast: '⚡', balanced: '⚖️', powerful: '🧠' }[p.preferredModel]
      console.log(`  ${modelEmoji} ${p.id} — ${p.name}`)
      console.log(`     Role: ${p.inheritsRole} · Domain: ${p.domain}`)
      console.log(`     Capabilities: ${p.capabilities.slice(0, 3).join(', ')}...`)
    }
  },
})

const agentLeaders = defineCommand({
  meta: { name: 'leaders', description: 'List SCALE leader presets such as CEO and CTO' },
  args: {
    output: { type: 'string', alias: 'o', description: 'Write markdown guide to file' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const presets = listLeadershipPresets()
    if (args.json) {
      console.log(JSON.stringify(presets, null, 2))
      return
    }
    const markdown = renderLeadershipPresetsMarkdown()
    if (args.output) {
      const outputPath = resolve(PROJECT_DIR, args.output)
      ensureDir(resolve(outputPath, '..'))
      writeFileSync(outputPath, markdown, 'utf-8')
      console.log(`[OK] 领导者角色指南已生成: ${outputPath}`)
      return
    }
    console.log(markdown)
  },
})

const agent = defineCommand({
  meta: { name: 'agent', description: 'Multi-Agent system management' },
  subCommands: { spawn: agentSpawn, list: agentList, profiles: agentProfiles, leaders: agentLeaders },
})

// ============================================================================
// team commands — 团队协作 (Phase 9)
// ============================================================================

const teamCreate = defineCommand({
  meta: { name: 'create', description: 'Create an agent team for a task' },
  args: {
    profiles: { type: 'string', required: true, description: 'Comma-separated profile IDs' },
    task: { type: 'string', description: 'Task description' },
  },
  async run({ args }) {
    const profileIds = args.profiles.split(',').map(p => p.trim())
    const agents = []
    for (const profileId of profileIds) {
      const profile = getProfile(profileId)
      if (!profile) {
        console.error(`Profile not found: ${profileId}`)
        process.exit(1)
      }
      agents.push(agentPool.spawn(profileId))
    }
    const teamId = `TEAM-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    console.log(JSON.stringify({
      ok: true,
      teamId,
      agents: agents.map(a => ({ id: a.id, profile: a.profile.name })),
      leader: agents[0].profile.name,
      description: args.task,
    }, null, 2))
  },
})

const teamStatus = defineCommand({
  meta: { name: 'status', description: 'Show team status' },
  args: {
    team: { type: 'positional', required: true, description: 'Team ID' },
  },
  async run({ args }) {
    // Simplified: show all agents in pool
    const agents = agentPool.listAll()
    const running = agents.filter(a => a.status === 'running').length
    const completed = agents.filter(a => a.status === 'completed').length
    console.log(JSON.stringify({
      teamId: args.team,
      total: agents.length,
      running,
      completed,
      failed: agents.filter(a => a.status === 'failed').length,
      agents: agents.map(a => ({ id: a.id, status: a.status })),
    }, null, 2))
  },
})

const team = defineCommand({
  meta: { name: 'team', description: 'Agent team orchestration' },
  subCommands: { create: teamCreate, status: teamStatus },
})

// ============================================================================
// Main
// ============================================================================

// ============================================================================
// Phase-Aligned Commands (v0.10.1) - agent-skills style
// ============================================================================

import * as phaseCommands from '../cli/phaseCommands.js'
import { runCommand } from '../cli/runCommand.js'
import * as liteCommands from '../cli/liteCommands.js'
import * as vibeCommands from '../cli/vibeCommands.js'

const main = defineCommand({
  meta: { name: 'scale', version: SCALE_ENGINE_VERSION, description: `SCALE Engine v${SCALE_ENGINE_VERSION} CLI - hardened phase workflow gates, governance templates, platform adapters, skill routing, and verification automation` },
  subCommands: {
    // Lite Mode (agent-skills style interactive entry)
    lite: liteCommands.liteCommand,

    // Vibe Templates (one-click prompt workflow)
    vibe: vibeCommands.vibeCommand,
    'vibe-next': vibeCommands.vibeNextCommand,
    'vibe-index': vibeCommands.vibeIndexCommand,

    // Phase-Aligned Commands (agent-skills style)
    define: phaseCommands.phaseDefine,
    plan: phaseCommands.phasePlan,
    build: phaseCommands.phaseBuild,
    verify: phaseCommands.phaseVerify,
    review: phaseCommands.phaseReview,
    ship: phaseCommands.phaseShip,
    run: runCommand,

    // Original commands (preserved)
    init,
    setup,
    bootstrap,
    doctor,
    session,
    gate,
    gates: gatesCommand,
    'meta-governance': metaGovernance,
    create,
    list,
    show,
    suggest,
    transition,
    verifyTask,
    role,
    context,
    evolve,
    stats,
    preflight,
    upgrade,
    governance,
    prompt: promptCommand,
    score: scoreCommand,
    'ai-os': aiOs,
    codegraph,
    eval: evalCommand,
    artifact,
    assets,
    standards,
    metrics,
    'task-artifacts': taskArtifacts,
    workspace,
    status,
    workflow,
    evidence,
    runtime,
    token,
    memory,
    diagnose,
    hunt,
    dependency,
    tdd,
    tool,
    tools: tool,
    skill,
    skills: skill,
    agent,
    team,
    'create-prd': createPRD,
    'out-of-scope': outOfScope,
    config,
    quickstart: quickstartCommand,
    tui: tuiCommand,
    qa: qaCommand,
    'auto-fix': autofixCommand,
    'cost-report': costReportCommand,
    'cost-optimize': costOptimizeCommand,
    'cross-review': crossReviewCommand,
    shield: shieldCommand,
    orch: orchCommand,
    cortex: cortexCommand,
  },
})

normalizeUpgradeRootOptionValues(process.argv)
runMain(main)

function normalizeUpgradeRootOptionValues(argv: string[]): void {
  const upgradeIndex = argv.findIndex((value, index) => index > 1 && value === 'upgrade')
  if (upgradeIndex < 0) return
  for (let index = upgradeIndex + 1; index < argv.length - 1; index += 1) {
    if (!['--dir', '--target-version', '--lang'].includes(argv[index])) continue
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) continue
    argv.splice(index, 2, `${argv[index]}=${value}`)
  }
}
