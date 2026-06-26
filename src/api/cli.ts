#!/usr/bin/env node
// SCALE Engine — CLI 入口 (W6 完整实现)
// 所有 Hook 调用入口: session/gate/create/list/transition/context

import { defineCommand, runMain } from 'citty'
import { createInterface } from 'node:readline'
import { EventBus } from '../core/eventBus.js'
import { SQLiteArtifactStore } from '../artifact/sqliteStore.js'
import { FSM } from '../artifact/fsm.js'
import { registerAllFSMs } from '../artifact/fsmDefinitions.js'
import type { TaskPayload } from '../artifact/types.js'
import { Gateway } from '../guardrails/Gateway.js'
import { BruteRetryDetector, PrematureDoneDetector, BlameShiftDetector } from '../guardrails/detectors.js'
import { DangerousCommandDetector, SecretLeakDetector, RoleGateDetector, ScopeCreepDetector } from '../guardrails/advancedDetectors.js'
import { auditDependencies } from '../guardrails/DependencyAuditor.js'
import { GraphifyKnowledgeBase } from '../knowledge/GraphifyKnowledgeBase.js'
import { ContextBuilder } from '../context/ContextBuilder.js'
import { scanContextBudget } from '../context/ContextBudget.js'
import { CerebrumManager } from '../knowledge/CerebrumManager.js'
import {
  impactCodeGraph,
  queryCodeGraph,
} from '../codegraph/CodeIntelligence.js'
import { FSMAgentBridge } from '../fsm/FSMAgentBridge.js'
import { CapabilityRegistry } from '../capabilities/CapabilityRegistry.js'
import { SkillRegistry } from '../skills/SkillRegistry.js'
import { registerCoreSkills } from '../skills/coreSkills.js'
import { registerExternalSkills } from '../skills/ExternalSkills.js'
import { createSkillPlan, evaluateSkillGate, loadSkillRoutingPolicy, skillPlanMarkdown } from '../skills/routing/index.js'
import { createAdapter, SUPPORTED_AGENTS } from '../adapters/index.js'
import { LessonExtractor, RuleProposer, HookGenerator, EvolutionEngine } from '../evolution/EvolutionEngine.js'
import { Doctor } from './doctor.js'
import { inspectBetterSqlite3Runtime, inspectEnvironment, renderEnvironmentDoctor } from '../env/EnvironmentDoctor.js'
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
import { EvidenceStore, type GateEvidenceRecord } from '../workflow/EvidenceStore.js'
import { OutOfScopeStore } from '../workflow/OutOfScopeStore.js'
import { ReviewStore } from '../workflow/ReviewStore.js'
import { WorkflowEngine } from '../workflow/WorkflowEngine.js'
import {
  loadVerificationMatrix,
  resolveVerificationTargets,
  type ResolvedVerificationTargets,
  type VerificationEngineeringStandardsGateMode,
  type VerificationPolicy,
} from '../workflow/VerificationProfile.js'
import { evaluateEcosystemReadinessGate } from '../workflow/EcosystemReadinessGate.js'
import { CORE_GATE_CATALOG, META_GATE_CATALOG, preflightGateStages } from '../workflow/GateCatalog.js'
import { gatesCommand } from '../cli/gateStatusCommands.js'
import { scoreCommand } from '../cli/scoreCommands.js'
import { promptCommand } from '../cli/promptCommands.js'
import { quickstartCommand } from '../cli/quickstartCommands.js'
import { onboardCommand } from '../cli/onboardCommands.js'
import { tuiCommand } from '../cli/tuiCommands.js'
import { qaCommand } from '../cli/qaCommands.js'
import { autofixCommand } from '../cli/autofixCommands.js'
import { costReportCommand, costOptimizeCommand } from '../cli/costCommands.js'
import { reviewCommand as crossReviewCommand } from '../review/reviewCommands.js'
import { shieldCommand } from '../cli/shieldCommands.js'
import { orchCommand } from '../cli/orchCommands.js'
import { cortexCommand } from '../cli/cortexCommands.js'
import { sessionCommand } from '../cli/sessionCommands.js'
import { gateCommand } from '../cli/gateInlineCommands.js'
import { metaGovernanceCommand } from '../cli/metaGovernanceCommands.js'
import { createCommand, listCommand, showCommand, suggestCommand, createPRDCommand } from '../cli/artifactCrudCommands.js'
import { transitionCommand, verifyTaskCommand, roleCommand } from '../cli/transitionCommands.js'
import { diagnoseCommand, huntCommand } from '../cli/diagnoseHuntCommands.js'
import { dependencyCommand, tddCommand, statsCommand, metricsCommand } from '../cli/dependencyTddCommands.js'
import { contextCommand } from '../cli/contextCommands.js'
import { codegraphCommand } from '../cli/codegraphCommands.js'
import { evalCommand } from '../cli/evalCommands.js'
import { evolveCommand, doctorCommand } from '../cli/evolveDoctorCommands.js'
import { workflowCommand, evidenceCommand } from '../cli/workflowEvidenceCommands.js'
import { loopCommand } from '../cli/loopCommands.js'
import { initCommand, bootstrapCommand, setupCommand, configCommand } from '../cli/initConfigCommands.js'
import { upgradeCommand, assetsCommand, standardsCommand, artifactCommand } from '../cli/upgradeAssetsCommands.js'
import { runtimeCommand, memoryCommand, outOfScopeCommand, skillCommand, token as tokenCommand } from '../cli/runtimeSkillCommands.js'
import { toolCommand, agentCommand, teamCommand } from '../cli/toolAgentCommands.js'
import { productCommand } from '../cli/productCommands.js'
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
  createUpgradeRecommendReport,
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
const GATE_BLOCKING_BY_STAGE = new Map<GateStage, boolean>(
  [...CORE_GATE_CATALOG, ...META_GATE_CATALOG]
    .filter(gate => gate.stage)
    .map(gate => [gate.stage!, gate.blocking] as const),
)

function isBlockingGateStage(stage: GateStage): boolean {
  return GATE_BLOCKING_BY_STAGE.get(stage) ?? true
}

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

type PreflightProfile = 'quick' | 'full' | 'ci' | 'fast-lane'

function normalizePreflightProfile(value: unknown): PreflightProfile {
  const normalized = String(value ?? 'quick').trim().toLowerCase()
  if (normalized === 'fast-lane' || normalized === 'fastlane') return 'fast-lane'
  if (normalized === 'full' || normalized === 'ci') return normalized
  return 'quick'
}

function gatesForPreflightProfile(profile: PreflightProfile): GateStage[] {
  return preflightGateStages(profile)
}

interface PreflightVerificationProfileResolution {
  profile?: string
  warnings: string[]
}

function resolvePreflightVerificationProfile(
  projectDir: string,
  scaleDir: string,
  requestedProfile: unknown,
  preflightProfile: PreflightProfile,
): PreflightVerificationProfileResolution {
  const warnings: string[] = []
  const matrix = loadVerificationMatrix(projectDir, scaleDir)
  const profiles = matrix?.profiles ?? {}
  const explicitProfile = typeof requestedProfile === 'string' && requestedProfile.trim()
    ? requestedProfile.trim()
    : undefined
  if (explicitProfile) {
    const explicitCandidate = resolveVerificationProfileCandidate(profiles, explicitProfile) ?? explicitProfile
    const matchingPreflightProfile = resolveVerificationProfileCandidate(
      profiles,
      preflightVerificationProfileCandidates(preflightProfile),
    )
    if (
      preflightProfile === 'fast-lane' &&
      matrix?.defaultProfile &&
      explicitProfile === matrix.defaultProfile &&
      matchingPreflightProfile &&
      matchingPreflightProfile !== explicitCandidate
    ) {
      warnings.push(`fast-lane preflight selected verification profile "${matchingPreflightProfile}" instead of default profile "${explicitProfile}" to avoid running the default full test command.`)
      return { profile: matchingPreflightProfile, warnings }
    }
    return { profile: explicitCandidate, warnings }
  }

  for (const candidate of preflightVerificationProfileCandidates(preflightProfile)) {
    if (profiles[candidate]) return { profile: candidate, warnings }
  }
  return { profile: undefined, warnings }
}

function preflightVerificationProfileCandidates(profile: PreflightProfile): string[] {
  if (profile === 'fast-lane') return ['fast-lane', 'fastLane', 'fastlane']
  return [profile]
}

function resolveVerificationProfileCandidate(
  profiles: Record<string, unknown>,
  requested: string | string[],
): string | undefined {
  const candidates = Array.isArray(requested) ? requested : [requested]
  for (const candidate of candidates) {
    if (profiles[candidate]) return candidate
  }
  return undefined
}

function latestBlockingEvidenceFailure(records: GateEvidenceRecord[]): GateEvidenceRecord | undefined {
  const latestByGate = new Map<GateStage, GateEvidenceRecord>()
  for (const record of records) {
    if (!isBlockingGateStage(record.gate)) continue
    if (!latestByGate.has(record.gate)) latestByGate.set(record.gate, record)
  }
  return Array.from(latestByGate.values()).find(record => !record.passed)
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

function parsePositiveIntArg(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number.parseInt(String(value), 10)
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return parsed
}

function parseSinceDays(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number.parseInt(String(value), 10)
  if (Number.isNaN(parsed) || parsed <= 0) return undefined
  return parsed
}

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
    'preflight-profile': { type: 'string', default: 'quick', description: 'Gate intensity profile (quick/fast-lane/full/ci); fast-lane for S-level tasks (build+TDD+lint+tests only)' },
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
    const verificationProfile = resolvePreflightVerificationProfile(projectDir, scaleDir, args.profile, preflightProfile)
    const resolved = resolveVerificationTargets({
      projectDir,
      scaleDir,
      profile: verificationProfile.profile,
      service: args.service,
    })
    resolved.warnings.push(...verificationProfile.warnings)
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
    const ecosystemReadiness = await evaluateEcosystemReadinessGate({
      policy: resolved.policy,
      projectDir,
      scaleDir,
      checked: preflightProfile === 'ci',
      skipReason: `ecosystem readiness is only checked by the ci preflight profile; current profile is ${preflightProfile}`,
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
      if (ecosystemReadiness.checked) {
        const status = ecosystemReadiness.blocked ? 'BLOCKED' : ecosystemReadiness.ok ? 'OK' : 'WARN'
        console.log(`  Ecosystem readiness: ${status} (${ecosystemReadiness.mode})`)
        console.log(`  Ecosystem tools: ${ecosystemReadiness.summary.installedTools}/${ecosystemReadiness.summary.totalTools}`)
        console.log(`  Ecosystem skills: ${ecosystemReadiness.summary.installedWorkflowSkills}/${ecosystemReadiness.summary.totalWorkflowSkills}`)
      } else {
        console.log('  Ecosystem readiness: skipped')
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
      !engineeringStandards.blocked &&
      !ecosystemReadiness.blocked
    const result = {
      phase: 'PREFLIGHT',
      profile: resolved.profileName,
      preflightProfile,
      gates: gateStages,
      services: targetResults.map(target => target.service).filter(Boolean),
      warnings: resolved.warnings,
      policy: resolved.policy,
      workspaceSafety,
      engineeringStandards,
      ecosystemReadiness,
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
    let store: ReturnType<typeof getEngine>['store']
    try {
      store = getEngine().store
    } catch (error) {
      const runtime = inspectBetterSqlite3Runtime({
        nativeModuleProbe: () => ({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      })
      const result = {
        artifacts: {
          latestSpec: null,
          latestPlan: null,
          latestTask: null,
        },
        recentEvidence: [],
        recentReviews: [],
        workflowState: null,
        blockers: [`Artifact store unavailable: ${runtime.reason}`],
        nextCommand: runtime.installHint ?? 'scale doctor',
        runtime: {
          artifactStore: {
            status: runtime.status,
            reason: runtime.reason,
            fix: runtime.installHint,
          },
        },
      }
      if (args.json) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        console.log('\nSCALE Status')
        console.log('  Status: DEGRADED')
        console.log(`  Artifact store: ${runtime.reason}`)
        if (runtime.installHint) console.log(`  Fix: ${runtime.installHint}`)
        console.log(`\nNext: ${result.nextCommand}`)
      }
      process.exitCode = 1
      return
    }
    const evidenceStore = new EvidenceStore(SCALE_DIR)
    const reviewStore = new ReviewStore(SCALE_DIR)
    const [specs, plans, tasks] = await Promise.all([
      store.query({ type: 'Spec', limit: 1 }),
      store.query({ type: 'Plan', limit: 1 }),
      store.query({ type: 'Task', limit: 1 }),
    ])
    const latestEvidence = evidenceStore.listGateResults(5)
    const latestEvidenceForBlockers = evidenceStore.listGateResults(50)
    const latestReviews = reviewStore.listReviews(5)
    const latestTask = tasks[0]
    const taskPayload = latestTask?.payload as TaskPayload | undefined
    const workflowState = new WorkflowArtifactWriter(SCALE_DIR).readCurrentState()
    const currentOpenTasks = workflowState?.openTasks ?? []
    const nextOpenTask = nextWorkflowOpenTask(currentOpenTasks)

    const blockers: string[] = []
    const latestBlockingEvidence = latestBlockingEvidenceFailure(latestEvidenceForBlockers)
    const latestReviewForTask = latestTask
      ? reviewStore.listReviews(50).find(record => record.taskId === latestTask.id)
      : undefined
    if (latestBlockingEvidence) blockers.push(`${latestBlockingEvidence.gate}: ${latestBlockingEvidence.blockers.join('; ') || latestBlockingEvidence.status}`)
    if (latestReviewForTask && !latestReviewForTask.passed) {
      blockers.push(`Review ${latestReviewForTask.id}: ${latestReviewForTask.summary.critical} critical, ${latestReviewForTask.summary.high} high`)
    }
    if (latestTask && (!taskPayload?.verificationEvidenceIds || taskPayload.verificationEvidenceIds.length === 0)) {
      blockers.push(`Task ${latestTask.id} has no persisted verification evidence`)
    }
    if (latestTask?.status === 'COMPLETED' && (!taskPayload?.reviewEvidenceIds || taskPayload.reviewEvidenceIds.length === 0)) {
      blockers.push(`Task ${latestTask.id} has no persisted review evidence`)
    }

    const nextCommand = (() => {
      const taskShipped = taskPayload?.shipPassed === true ||
        Boolean(taskPayload?.shipCommitHash || taskPayload?.shipDeploymentRecordId)
      if (nextOpenTask?.kind === 'command') return nextOpenTask.value
      if (nextOpenTask?.kind === 'blocker') return `Resolve workflow blocker: ${nextOpenTask.value}`
      if (!specs[0]) return 'scale define "<feature>" --description "<what to build>"'
      if (!plans[0]) return `scale plan ${specs[0].id}`
      if (!latestTask) return `scale build ${plans[0].id}`
      if (!taskPayload?.verificationEvidenceIds?.length) return `scale verify ${latestTask.id}`
      if (latestTask.status !== 'COMPLETED') return `scale verify ${latestTask.id}`
      if (!taskPayload.reviewEvidenceIds?.length || taskPayload.reviewPassed !== true) return `scale review ${latestTask.id}`
      if (!taskShipped) return `scale ship ${latestTask.id}`
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
          shipPassed: taskPayload?.shipPassed,
          shippedAt: taskPayload?.shippedAt,
          shipMode: taskPayload?.shipMode,
          shipCommitHash: taskPayload?.shipCommitHash,
          shipDeploymentRecordId: taskPayload?.shipDeploymentRecordId,
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
    console.log(`  Agent collaboration: ${plan.agentCollaboration.mode}; ${plan.agentCollaboration.summary.totalRoles} role(s), ${plan.agentCollaboration.summary.reviewGateCount} review gate(s), reserve ${plan.agentCollaboration.budget.reserveTokens} tokens`)
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
    console.log(`  Agent collaboration: ${report.plan.agentCollaboration.mode}; ${report.plan.agentCollaboration.summary.totalRoles} role(s), ${report.plan.agentCollaboration.summary.handoffCount} handoff(s), ${report.plan.agentCollaboration.summary.reviewGateCount} review gate(s)`)
    if (report.agentExecution) {
      console.log(`  Agent execution: ${report.agentExecution.status}; ${report.agentExecution.summary.settledRoles}/${report.agentExecution.summary.totalRoles} role(s) settled, ${report.agentExecution.summary.settledReviewGates}/${report.agentExecution.summary.reviewGates} review gate(s) settled`)
    }
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
    console.log(`  Agent roles: ${benchmark.summary.totalAgentRoles}; review gates ${benchmark.summary.totalAgentReviewGates}; multi-agent scenarios ${benchmark.summary.multiAgentScenarios}`)
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
      console.log(`  Agent collaboration: ${report.intelligence.summary.agentCollaborationQuality.totalRoles} role(s), ${report.intelligence.summary.agentCollaborationQuality.settledRoles} settled, ${report.intelligence.summary.agentCollaborationQuality.reviewGates} review gate(s), ${report.intelligence.summary.agentCollaborationQuality.settledRuns} settled guarded run(s)`)
      console.log(`  Agent Loop: ${report.intelligence.summary.agentLoopQuality.status}; ${report.intelligence.summary.agentLoopQuality.readySignals}/6 ready, score ${report.intelligence.summary.agentLoopQuality.score}/100`)
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
      console.log(`  Agent collaboration: ${report.intelligence.summary.agentCollaborationQuality.totalRoles} role(s), ${report.intelligence.summary.agentCollaborationQuality.settledRoles} settled, ${report.intelligence.summary.agentCollaborationQuality.reviewGates} review gate(s), ${report.intelligence.summary.agentCollaborationQuality.settledRuns} settled guarded run(s)`)
      console.log(`  Agent Loop: ${report.intelligence.summary.agentLoopQuality.status}; ${report.intelligence.summary.agentLoopQuality.readySignals}/6 ready, score ${report.intelligence.summary.agentLoopQuality.score}/100`)
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
// Governance commands
// ============================================================================

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

// ============================================================================
// CLI helper functions
// ============================================================================

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

function normalizeLangArg(value: unknown): 'zh' | 'en' {
  return normalizeLanguage(value ?? process.env.SCALE_LANG)
}

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
    init: initCommand,
    setup: setupCommand,
    bootstrap: bootstrapCommand,
    doctor: doctorCommand,
    session: sessionCommand,
    gate: gateCommand,
    gates: gatesCommand,
    'meta-governance': metaGovernanceCommand,
    create: createCommand,
    list: listCommand,
    show: showCommand,
    suggest: suggestCommand,
    transition: transitionCommand,
    verifyTask: verifyTaskCommand,
    role: roleCommand,
    context: contextCommand,
    evolve: evolveCommand,
    stats: statsCommand,
    preflight,
    upgrade: upgradeCommand,
    governance,
    prompt: promptCommand,
    score: scoreCommand,
    'ai-os': aiOs,
    codegraph: codegraphCommand,
    eval: evalCommand,
    artifact: artifactCommand,
    assets: assetsCommand,
    standards: standardsCommand,
    metrics: metricsCommand,
    'task-artifacts': taskArtifacts,
    workspace,
    status,
    workflow: workflowCommand,
    loop: loopCommand,
    evidence: evidenceCommand,
    runtime: runtimeCommand,
    token: tokenCommand,
    memory: memoryCommand,
    diagnose: diagnoseCommand,
    hunt: huntCommand,
    dependency: dependencyCommand,
    tdd: tddCommand,
    tool: toolCommand,
    tools: toolCommand,
    skill: skillCommand,
    skills: skillCommand,
    agent: agentCommand,
    team: teamCommand,
    product: productCommand,
    products: productCommand,
    'create-prd': createPRDCommand,
    'out-of-scope': outOfScopeCommand,
    config: configCommand,
    quickstart: quickstartCommand,
    onboard: onboardCommand,
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
