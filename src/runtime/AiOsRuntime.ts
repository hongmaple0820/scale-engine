import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import {
  buildContextPack,
  scanContextBudget,
  type ContextPack as BudgetedContextPack,
} from '../context/ContextBudget.js'
import {
  createGovernanceRoiReport,
  type GovernanceRoiReport,
} from '../governance/GovernanceRoi.js'
import {
  evaluateProgressiveGovernance,
  type GovernanceMode,
  type ProgressiveGovernanceReport,
} from '../governance/ProgressiveGovernance.js'
import type { IKnowledgeBase } from '../knowledge/KnowledgeBase.js'
import {
  MemoryFabric,
  recallMemoryProviders,
  type ContextPack as MemoryContextPack,
  type MemoryProviderRecallItem,
} from '../memory/index.js'
import {
  createSkillPlan,
  loadSkillRoutingPolicy,
  type SkillPlan,
  type SkillTaskLevel,
} from '../skills/routing/index.js'
import { routeAdaptiveWorkflow, type WorkflowProfile } from '../workflow/AdaptiveWorkflowRouter.js'
import { collectGovernanceRoi, type GovernanceRoiSummary } from '../workflow/GovernanceRoi.js'
import {
  proposeShadowRule,
  buildEvolutionShadowReport,
  summarizeEvolutionShadow,
  type EvolutionShadowReport,
  type ShadowRuleProposal,
} from '../workflow/EvolutionShadowPromoter.js'
import { runSafeCommand } from '../tools/SafeCommandRunner.js'
import { SCALE_ENGINE_VERSION } from '../version.js'
import {
  resolveVerificationTargets,
  type VerificationCommandName,
} from '../workflow/VerificationProfile.js'
import { RuntimeEvidenceLedger } from './RuntimeEvidenceLedger.js'
import { loadRelevantLearnings, type LearningEntry } from '../evolution/SessionLearnings.js'
import { collectSessionPreamble, type SessionPreamble } from '../workflow/SessionPreamble.js'
import { assessAgentLoopReadiness, type AgentLoopReadinessReport } from '../workflow/AgentLoopReadiness.js'

export interface AiOsRuntimeInput {
  projectDir?: string
  scaleDir?: string
  taskId?: string
  task: string
  level?: SkillTaskLevel | string
  files?: string[]
  services?: string[]
  budget?: number
  requestedMode?: GovernanceMode
  memoryTopK?: number
  knowledgeBase?: Pick<IKnowledgeBase, 'recall' | 'recallByVector'>
}

export type AiOsRunMode = 'dry-run' | 'guarded'
export type AiOsRunStatus = 'ready' | 'blocked'
export type AiOsRunStepKind = 'plan' | 'context' | 'memory' | 'skill' | 'gate' | 'evidence' | 'learning'
export type AiOsRunStepStatus = 'passed' | 'planned' | 'blocked' | 'skipped'

export interface AiOsRunInput extends AiOsRuntimeInput {
  mode?: AiOsRunMode
  verificationCommands?: string[]
  commandTimeoutMs?: number
  allowShell?: boolean
}

export interface AiOsMemoryRuntimeSummary {
  providerOrder: string[]
  selectedProviders: string[]
  fallbackUsed: boolean
  items: MemoryProviderRecallItem[]
  warnings: string[]
  contextPack: MemoryContextPack
}

export interface AiOsAdaptiveWorkflow {
  strategy: 'risk-adaptive-runtime-v1'
  profile: WorkflowProfile
  escalationReasons: string[]
  mode: GovernanceMode
  requiredBehaviors: string[]
  gates: string[]
  exitCriteria: string[]
}

export type AiOsEvaluatorGateId =
  | 'architecture-critique'
  | 'root-cause-review'
  | 'security-threat-model'
  | 'release-readiness-review'
  | 'uncertainty-decision-log'

export interface AiOsEvaluatorGate {
  id: AiOsEvaluatorGateId
  required: boolean
  reason: string
  evidence: string[]
}

export interface AiOsEvaluatorIntelligence {
  strategy: 'evaluator-intelligence-v1'
  required: boolean
  riskLevel: 'low' | 'medium' | 'high'
  uncertainty: {
    score: number
    threshold: number
    drivers: string[]
  }
  gates: AiOsEvaluatorGate[]
  recommendations: string[]
}

export type AiOsToolStrategyRisk = 'low' | 'medium' | 'high'

export interface AiOsToolStrategyNode {
  id: string
  kind: SkillPlan['executionPlan']['steps'][number]['kind']
  required: boolean
  cost: {
    units: number
    timeRisk: AiOsToolStrategyRisk
    sideEffectRisk: AiOsToolStrategyRisk
  }
  retry: {
    maxAttempts: number
    backoff: 'none' | 'linear' | 'manual-review'
  }
  fallback: string
  evidence: string[]
}

export interface AiOsToolStrategyEdge {
  from: string
  to: string
  reason: string
}

export interface AiOsToolStrategyPlan {
  strategy: 'tool-strategy-v1'
  nodes: AiOsToolStrategyNode[]
  edges: AiOsToolStrategyEdge[]
  summary: {
    totalSteps: number
    requiredSteps: number
    highRiskSteps: number
    estimatedCostUnits: number
    fallbackCoveredSteps: number
  }
  recommendations: string[]
}

export interface AiOsRuntimePlan {
  version: string
  generatedAt: string
  task: {
    taskId?: string
    task: string
    level: SkillTaskLevel
    files: string[]
    services: string[]
  }
  preamble: SessionPreamble
  governance: ProgressiveGovernanceReport
  adaptiveWorkflow: AiOsAdaptiveWorkflow
  evaluator: AiOsEvaluatorIntelligence
  toolStrategy: AiOsToolStrategyPlan
  evolutionShadow: EvolutionShadowReport
  context: BudgetedContextPack
  memory: AiOsMemoryRuntimeSummary
  skillPlan: SkillPlan
  sessionLearnings: LearningEntry[]
  roi: GovernanceRoiReport
  recommendations: string[]
}

export interface AiOsRunStep {
  id: string
  kind: AiOsRunStepKind
  title: string
  status: AiOsRunStepStatus
  required: boolean
  summary: string
  evidence: string[]
  dependsOn?: string[]
}

export interface AiOsRunFailureLearningCandidate {
  id: string
  source: 'failed-step' | 'missing-evidence'
  title: string
  summary: string
  recommendedAction: 'resolve-before-promotion' | 'record-evidence'
  evidenceRefs: string[]
  promotable: boolean
}

export interface AiOsVerificationCommandReport {
  command: string
  status: 'passed' | 'failed'
  exitCode: number
  stdout: string
  stderr: string
  evidenceId: string
}

export interface AiOsRunReport {
  version: string
  generatedAt: string
  mode: AiOsRunMode
  dryRun: boolean
  status: AiOsRunStatus
  plan: AiOsRuntimePlan
  steps: AiOsRunStep[]
  evidence: {
    required: string[]
    produced: string[]
    pending: string[]
  }
  verification: {
    commands: AiOsVerificationCommandReport[]
    allPassed: boolean
  }
  failureLearning: {
    status: 'idle' | 'candidate-created'
    candidates: AiOsRunFailureLearningCandidate[]
  }
  artifacts: {
    runReport: string
  }
  governanceRoi?: GovernanceRoiSummary
  nextActions: string[]
}

export interface AiOsDashboardInput {
  projectDir?: string
  scaleDir?: string
  limit?: number
}

export interface AiOsDashboardRunSummary {
  taskId?: string
  task: string
  mode: AiOsRunMode
  status: AiOsRunStatus
  generatedAt: string
  runReport: string
  verificationCommands: number
  failedVerificationCommands: number
  pendingEvidence: number
  failureLearningCandidates: number
}

export interface AiOsDashboardReport {
  version: string
  generatedAt: string
  runsDir: string
  summary: {
    totalRuns: number
    readyRuns: number
    blockedRuns: number
    dryRunRuns: number
    guardedRuns: number
    verificationCommands: number
    failedVerificationCommands: number
    pendingEvidence: number
    failureLearningCandidates: number
  }
  health: {
    status: 'empty' | 'healthy' | 'attention' | 'blocked'
    score: number
    reasons: string[]
  }
  latestRuns: AiOsDashboardRunSummary[]
  recommendations: string[]
  warnings: string[]
}

export interface AiOsBenchmarkInput {
  projectDir?: string
  scaleDir?: string
  budget?: number
}

export interface AiOsBenchmarkScenarioInput {
  id: string
  task: string
  level: SkillTaskLevel
  files: string[]
  services?: string[]
  budget?: number
}

export interface AiOsBenchmarkScenarioResult {
  id: string
  task: string
  level: SkillTaskLevel
  governanceMode: GovernanceMode
  workflowProfile: WorkflowProfile
  metrics: {
    estimatedTokens: number
    budget: number
    estimatedTokenSavings: number
    memoryItems: number
    selectedProviders: string[]
    skillSteps: number
    requiredSkillSteps: number
    evaluatorGates: number
    toolStrategySteps: number
    toolStrategyCostUnits: number
    evolutionProposals: number
    gates: number
    roiModules: number
  }
}

export interface AiOsBenchmarkReport {
  version: string
  generatedAt: string
  scenarios: AiOsBenchmarkScenarioResult[]
  summary: {
    scenarios: number
    totalEstimatedTokens: number
    totalBudget: number
    totalEstimatedTokenSavings: number
    totalMemoryItems: number
    totalSkillSteps: number
    requiredSkillSteps: number
    totalEvaluatorGates: number
    totalToolStrategySteps: number
    totalToolStrategyCostUnits: number
    totalEvolutionProposals: number
    governanceModes: GovernanceMode[]
    workflowProfiles: WorkflowProfile[]
    averageTokenUtilization: number
  }
  dashboard: AiOsDashboardReport
  artifacts: {
    benchmarkReport: string
  }
  recommendations: string[]
}

export interface AiOsMigrationInput {
  projectDir?: string
  scaleDir?: string
}

export interface AiOsMigrationReport {
  version: string
  generatedAt: string
  status: 'migrated' | 'compatible'
  scaleRoot: string
  created: string[]
  existing: string[]
  files: {
    migrationReport: string
  }
  warnings: string[]
  nextActions: string[]
}

export interface AiOsDoctorInput {
  projectDir?: string
  scaleDir?: string
  benchmarkMaxAgeHours?: number
  lang?: 'zh' | 'en'
}

export type AiOsDoctorStatus = 'ready' | 'warning' | 'blocked'
export type AiOsDoctorCheckStatus = 'passed' | 'warning' | 'blocked'

export interface AiOsDoctorCheck {
  id: string
  title: string
  status: AiOsDoctorCheckStatus
  summary: string
  evidence: string[]
}

export interface AiOsDoctorReport {
  version: string
  generatedAt: string
  status: AiOsDoctorStatus
  projectDir: string
  scaleRoot: string
  dashboard: AiOsDashboardReport
  benchmark: {
    status: 'missing' | 'fresh' | 'stale' | 'invalid'
    reportPath: string
    generatedAt?: string
    ageHours?: number
    scenarios?: number
  }
  checks: AiOsDoctorCheck[]
  summary: {
    totalChecks: number
    passedChecks: number
    warningChecks: number
    blockedChecks: number
  }
  warnings: string[]
  nextActions: string[]
}

export interface AiOsAdoptionInput extends AiOsRuntimeInput {
  benchmarkMaxAgeHours?: number
  lang?: 'zh' | 'en'
}

export type AiOsAdoptionStatus = 'ready' | 'warning' | 'blocked'
export type AiOsAdoptionPhaseStatus = 'passed' | 'warning' | 'blocked'

export interface AiOsAdoptionPhase {
  id: 'migrate' | 'first-run' | 'benchmark' | 'doctor'
  status: AiOsAdoptionPhaseStatus
  summary: string
  evidence: string[]
}

export interface AiOsAdoptionReport {
  version: string
  generatedAt: string
  status: AiOsAdoptionStatus
  projectDir: string
  scaleRoot: string
  phases: AiOsAdoptionPhase[]
  migration: AiOsMigrationReport
  run: AiOsRunReport
  benchmark: AiOsBenchmarkReport
  doctor: AiOsDoctorReport
  artifacts: {
    migrationReport: string
    runReport: string
    benchmarkReport: string
    adoptionReport: string
  }
  warnings: string[]
  nextActions: string[]
}

export interface AiOsStatusInput {
  projectDir?: string
  scaleDir?: string
  benchmarkMaxAgeHours?: number
  lang?: 'zh' | 'en'
}

export type AiOsClosedLoopStatus = 'ready' | 'warning' | 'blocked'
export type AiOsStatusCheckId =
  | 'runtime-dirs'
  | 'plan-evidence'
  | 'run-evidence'
  | 'verification-evidence'
  | 'dashboard-health'
  | 'benchmark-evidence'
  | 'adoption-evidence'

export interface AiOsStatusCheck {
  id: AiOsStatusCheckId
  title: string
  status: AiOsClosedLoopStatus
  summary: string
  evidence: string[]
}

export interface AiOsVerificationRecommendation {
  command: string
  source: 'verification-profile' | 'package-script' | 'fallback'
  reason: string
  profile?: string
  service?: string
}

export interface AiOsStatusReport {
  version: string
  generatedAt: string
  status: AiOsClosedLoopStatus
  projectDir: string
  scaleRoot: string
  checks: AiOsStatusCheck[]
  summary: {
    total: number
    ready: number
    warning: number
    blocked: number
  }
  dashboard: AiOsDashboardReport
  doctor: AiOsDoctorReport
  intelligence: AiOsIntelligenceReport
  verificationRecommendations: AiOsVerificationRecommendation[]
  nextActions: string[]
  warnings: string[]
}

export type AiOsIntelligenceSignalId =
  | 'memory-recall'
  | 'context-savings'
  | 'skill-routing'
  | 'evaluator-intelligence'
  | 'tool-strategy'
  | 'adaptive-workflow'
  | 'evolution-shadow'
  | 'agent-loop-readiness'
  | 'benchmark-intelligence'

export interface AiOsIntelligenceSignal {
  id: AiOsIntelligenceSignalId
  status: AiOsClosedLoopStatus
  summary: string
  evidence: string[]
  recommendations: string[]
}

export interface AiOsIntelligenceReport {
  status: AiOsClosedLoopStatus
  summary: {
    ready: number
    warning: number
    blocked: number
    totalMemoryItems: number
    selectedProviders: string[]
    memoryQuality: AiOsMemoryQualitySummary
    contextQuality: AiOsContextQualitySummary
    evaluatorQuality: AiOsEvaluatorQualitySummary
    toolStrategyQuality: AiOsToolStrategyQualitySummary
    agentLoopQuality: AiOsAgentLoopQualitySummary
    evolutionQuality: AiOsEvolutionQualitySummary
    estimatedTokenSavings: number
    skillSteps: number
  }
  signals: AiOsIntelligenceSignal[]
  nextActions: string[]
}

export interface AiOsMemoryQualitySummary {
  score: number
  evidenceBackedItems: number
  missingEvidenceItems: number
  lowConfidenceItems: number
  averageConfidence: number
  averageRelevance: number
}

export interface AiOsContextQualitySummary {
  omittedSections: number
  totalOmittedTokens: number
  evidenceLossWarnings: string[]
  highestOmittedTokens: number
  compressionRisk: 'low' | 'medium' | 'high'
}

export interface AiOsEvaluatorQualitySummary {
  requiredGates: number
  highRiskPlans: number
  averageUncertainty: number
  gateIds: AiOsEvaluatorGateId[]
}

export interface AiOsToolStrategyQualitySummary {
  totalSteps: number
  requiredSteps: number
  highRiskSteps: number
  estimatedCostUnits: number
  fallbackCoverage: number
}

export interface AiOsAgentLoopQualitySummary {
  status: AgentLoopReadinessReport['status']
  score: number
  readySignals: number
  warningSignals: number
  missingSignals: number
  loopRecoveryRate: number | null
  guardrailCoverage: number | null
  budgetControlled: boolean | null
  terminationEvidence: boolean | null
}

export interface AiOsEvolutionQualitySummary {
  proposals: number
  shadowRules: number
  candidateHooks: number
  approvedBlocking: number
  pendingValidation: number
}

export async function createAiOsPlan(input: AiOsRuntimeInput): Promise<AiOsRuntimePlan> {
  const projectDir = resolve(input.projectDir ?? process.cwd())
  const scaleDir = input.scaleDir ?? '.scale'
  const level = normalizeSkillTaskLevel(input.level)
  const files = input.files ?? []
  const services = input.services ?? []
  const taskId = input.taskId
  const budget = input.budget ?? 8_000

  const preamble = collectSessionPreamble({ projectDir, scaleDir })
  const sessionLearnings = loadRelevantLearnings({ projectDir, scaleDir, task: input.task, limit: 5 })

  const governance = evaluateProgressiveGovernance({
    task: input.task,
    changedFiles: files,
    requestedMode: input.requestedMode,
  })
  const contextBudget = scanContextBudget({ projectDir, scaleDir, maxTaskTokens: budget })
  const context = buildContextPack({
    projectDir,
    scaleDir,
    task: input.task,
    taskId,
    level,
    files,
    budget,
  })
  const memoryRecall = await recallMemoryProviders({
    projectDir,
    scaleDir,
    query: [input.task, files.join(' ')].filter(Boolean).join('\n'),
    task: input.task,
    files,
    limit: input.memoryTopK ?? 5,
  })
  const memoryPack = await new MemoryFabric({
    projectDir,
    scaleDir,
    knowledgeBase: input.knowledgeBase,
  }).createContextPack({
    task: input.task,
    taskId,
    level,
    files,
    budgetTokens: Math.max(1, Math.floor(budget / 2)),
    knowledgeTopK: input.memoryTopK,
  })
  const skillPolicy = loadSkillRoutingPolicy(projectDir, scaleDir)
  const skillPlan = createSkillPlan({
    taskId: taskId ?? `AIOS-${Date.now()}`,
    taskName: input.task,
    description: input.task,
    level,
    files,
    services,
    policy: skillPolicy,
  })
  const evaluator = createEvaluatorIntelligence({
    task: input.task,
    files,
    governance,
    skillPlan,
  })
  const toolStrategy = createToolStrategyPlan(skillPlan)
  const adaptiveWorkflow = createAdaptiveWorkflow(governance, skillPlan, evaluator, toolStrategy)
  const evolutionShadow = createEvolutionShadowProposals(governance, evaluator)
  const roi = createGovernanceRoiReport({
    taskId,
    contextBudget,
    contextPack: context,
    governance,
    memoryRecall,
    skillPlan,
  })

  return {
    version: SCALE_ENGINE_VERSION,
    generatedAt: new Date().toISOString(),
    task: {
      taskId,
      task: input.task,
      level,
      files,
      services,
    },
    preamble,
    governance,
    adaptiveWorkflow,
    evaluator,
    toolStrategy,
    evolutionShadow,
    context,
    memory: {
      providerOrder: memoryRecall.providerOrder,
      selectedProviders: memoryRecall.selectedProviders,
      fallbackUsed: memoryRecall.fallbackUsed,
      items: memoryRecall.items,
      warnings: memoryRecall.warnings,
      contextPack: memoryPack,
    },
    skillPlan,
    sessionLearnings,
    roi,
    recommendations: recommendations({ governance, context, memoryRecall, skillPlan, evaluator, toolStrategy }),
  }
}

export async function createAiOsRun(input: AiOsRunInput): Promise<AiOsRunReport> {
  const projectDir = resolve(input.projectDir ?? process.cwd())
  const scaleDir = input.scaleDir ?? '.scale'
  const mode = input.mode ?? 'dry-run'
  const plan = await createAiOsPlan({ ...input, projectDir, scaleDir })
  const generatedAt = new Date().toISOString()
  const runReportPath = resolveRunReportPath(projectDir, scaleDir, plan.task.taskId ?? `AIOS-RUN-${Date.now()}`)
  const steps = buildRunSteps(plan)
  const verification = await runGuardedVerification({
    projectDir,
    scaleDir,
    plan,
    steps,
    commands: input.verificationCommands ?? [],
    timeout: input.commandTimeoutMs,
    allowShell: input.allowShell,
    enabled: mode === 'guarded',
  })
  const failureCandidates = buildFailureLearningCandidates(plan, steps)
  const evidence = summarizeRunEvidence(steps)
  const status: AiOsRunStatus = steps.some(step => step.status === 'blocked') ? 'blocked' : 'ready'
  const report: AiOsRunReport = {
    version: SCALE_ENGINE_VERSION,
    generatedAt,
    mode,
    dryRun: mode === 'dry-run',
    status,
    plan,
    steps,
    evidence,
    verification,
    failureLearning: {
      status: failureCandidates.length > 0 ? 'candidate-created' : 'idle',
      candidates: failureCandidates,
    },
    artifacts: {
      runReport: runReportPath,
    },
    governanceRoi: collectGovernanceRoi({ projectDir, scaleDir }),
    nextActions: buildRunNextActions(steps, mode),
  }
  writeAiOsRunReport(runReportPath, report)
  return report
}

export function createAiOsDashboard(input: AiOsDashboardInput = {}): AiOsDashboardReport {
  const projectDir = resolve(input.projectDir ?? process.cwd())
  const scaleDir = input.scaleDir ?? '.scale'
  const runsDir = resolveRunsDir(projectDir, scaleDir)
  const warnings: string[] = []
  const reports = readAiOsRunReports(runsDir, warnings)
  const latestRuns = reports
    .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))
    .slice(0, input.limit ?? 10)
    .map(toDashboardRunSummary)
  const summary = {
    totalRuns: reports.length,
    readyRuns: reports.filter(report => report.status === 'ready').length,
    blockedRuns: reports.filter(report => report.status === 'blocked').length,
    dryRunRuns: reports.filter(report => report.mode === 'dry-run').length,
    guardedRuns: reports.filter(report => report.mode === 'guarded').length,
    verificationCommands: reports.reduce((sum, report) => sum + report.verification.commands.length, 0),
    failedVerificationCommands: reports.reduce((sum, report) => sum + report.verification.commands.filter(command => command.status === 'failed').length, 0),
    pendingEvidence: reports.reduce((sum, report) => sum + report.evidence.pending.length, 0),
    failureLearningCandidates: reports.reduce((sum, report) => sum + report.failureLearning.candidates.length, 0),
  }
  const health = summarizeDashboardHealth(summary)
  return {
    version: SCALE_ENGINE_VERSION,
    generatedAt: new Date().toISOString(),
    runsDir,
    summary,
    health,
    latestRuns,
    recommendations: dashboardRecommendations(summary),
    warnings,
  }
}

export async function createAiOsBenchmark(input: AiOsBenchmarkInput = {}): Promise<AiOsBenchmarkReport> {
  const projectDir = resolve(input.projectDir ?? process.cwd())
  const scaleDir = input.scaleDir ?? '.scale'
  const scenarios = defaultBenchmarkScenarios(input.budget)
  const results: AiOsBenchmarkScenarioResult[] = []

  for (const scenario of scenarios) {
    const plan = await createAiOsPlan({
      projectDir,
      scaleDir,
      taskId: `BENCH-${scenario.id}`,
      task: scenario.task,
      level: scenario.level,
      files: scenario.files,
      services: scenario.services,
      budget: scenario.budget,
    })
    results.push({
      id: scenario.id,
      task: scenario.task,
      level: scenario.level,
      governanceMode: plan.governance.effectiveMode,
      workflowProfile: plan.adaptiveWorkflow.profile,
      metrics: {
        estimatedTokens: plan.context.totalEstimatedTokens,
        budget: plan.context.task.budget,
        estimatedTokenSavings: plan.context.compiler?.estimatedTokenSavings ?? 0,
        memoryItems: plan.memory.items.length,
        selectedProviders: plan.memory.selectedProviders,
        skillSteps: plan.skillPlan.executionPlan.steps.length,
        requiredSkillSteps: plan.skillPlan.executionPlan.steps.filter(step => step.required).length,
        evaluatorGates: plan.evaluator.gates.length,
        toolStrategySteps: plan.toolStrategy.summary.totalSteps,
        toolStrategyCostUnits: plan.toolStrategy.summary.estimatedCostUnits,
        evolutionProposals: plan.evolutionShadow.summary.totalProposals,
        gates: plan.adaptiveWorkflow.gates.length,
        roiModules: plan.roi.modules.length,
      },
    })
  }

  const summary = summarizeBenchmark(results)
  const generatedAt = new Date().toISOString()
  const benchmarkReport = resolveBenchmarkReportPath(projectDir, scaleDir)
  const report: AiOsBenchmarkReport = {
    version: SCALE_ENGINE_VERSION,
    generatedAt,
    scenarios: results,
    summary,
    dashboard: createAiOsDashboard({ projectDir, scaleDir }),
    artifacts: {
      benchmarkReport,
    },
    recommendations: benchmarkRecommendations(summary),
  }
  writeAiOsBenchmarkReport(benchmarkReport, report)
  return report
}

export function createAiOsMigration(input: AiOsMigrationInput = {}): AiOsMigrationReport {
  const projectDir = resolve(input.projectDir ?? process.cwd())
  const scaleDir = input.scaleDir ?? '.scale'
  const scaleRoot = isAbsolute(scaleDir) ? scaleDir : join(projectDir, scaleDir)
  const requiredDirs = [
    join(scaleRoot, 'ai-os'),
    join(scaleRoot, 'ai-os', 'runs'),
    join(scaleRoot, 'ai-os', 'benchmarks'),
    join(scaleRoot, 'ai-os', 'migrations'),
  ]
  const created: string[] = []
  const existing: string[] = []
  for (const dir of requiredDirs) {
    if (existsSync(dir)) {
      existing.push(normalizeProjectPath(projectDir, dir))
      continue
    }
    mkdirSync(dir, { recursive: true })
    created.push(normalizeProjectPath(projectDir, dir))
  }
  const migrationReport = join(scaleRoot, 'ai-os', 'migrations', 'migration.json')
  const report: AiOsMigrationReport = {
    version: SCALE_ENGINE_VERSION,
    generatedAt: new Date().toISOString(),
    status: created.length > 0 ? 'migrated' : 'compatible',
    scaleRoot,
    created,
    existing,
    files: {
      migrationReport,
    },
    warnings: [],
    nextActions: created.length > 0
      ? ['Run `scale ai-os run --dry-run --json` to create the first AI OS runtime report.']
      : ['AI OS runtime directories are compatible; continue with run, dashboard, or benchmark commands.'],
  }
  writeFileSync(migrationReport, JSON.stringify(report, null, 2), 'utf-8')
  return report
}

export function createAiOsDoctor(input: AiOsDoctorInput = {}): AiOsDoctorReport {
  const projectDir = resolve(input.projectDir ?? process.cwd())
  const scaleDir = input.scaleDir ?? '.scale'
  const scaleRoot = resolveScaleRoot(projectDir, scaleDir)
  const benchmarkMaxAgeHours = input.benchmarkMaxAgeHours ?? 24
  const lang = input.lang ?? 'en'
  const warnings: string[] = []
  const dashboard = createAiOsDashboard({ projectDir, scaleDir })
  const benchmark = inspectBenchmarkReport(projectDir, scaleDir, benchmarkMaxAgeHours, warnings)
  const requiredDirs = [
    join(scaleRoot, 'ai-os'),
    join(scaleRoot, 'ai-os', 'runs'),
    join(scaleRoot, 'ai-os', 'benchmarks'),
    join(scaleRoot, 'ai-os', 'migrations'),
  ]
  const missingDirs = requiredDirs.filter(dir => !existsSync(dir)).map(dir => normalizeProjectPath(projectDir, dir))
  const checks: AiOsDoctorCheck[] = [
    {
      id: 'ai-os-runtime-dirs',
      title: 'AI OS runtime directories',
      status: missingDirs.length === 0 ? 'passed' : 'blocked',
      summary: missingDirs.length === 0
        ? 'Required AI OS runtime directories exist.'
        : `Missing AI OS runtime directories: ${missingDirs.join(', ')}.`,
      evidence: missingDirs.length === 0 ? requiredDirs.map(dir => normalizeProjectPath(projectDir, dir)) : missingDirs,
    },
    {
      id: 'ai-os-run-history',
      title: 'AI OS run history',
      status: dashboard.summary.totalRuns > 0 ? 'passed' : 'warning',
      summary: dashboard.summary.totalRuns > 0
        ? `${dashboard.summary.totalRuns} run report(s), ${dashboard.summary.guardedRuns} guarded.`
        : 'No AI OS run reports found yet.',
      evidence: dashboard.latestRuns.map(run => run.runReport),
    },
    {
      id: 'ai-os-dashboard-health',
      title: 'AI OS dashboard health',
      status: dashboard.health.status === 'blocked'
        ? 'blocked'
        : dashboard.health.status === 'healthy' ? 'passed' : 'warning',
      summary: `${dashboard.health.status} (${dashboard.health.score}): ${dashboard.health.reasons.join('; ')}`,
      evidence: dashboard.health.reasons,
    },
    {
      id: 'ai-os-benchmark',
      title: 'AI OS benchmark evidence',
      status: benchmark.status === 'fresh' ? 'passed' : benchmark.status === 'invalid' ? 'blocked' : 'warning',
      summary: summarizeBenchmarkDoctor(benchmark),
      evidence: [benchmark.reportPath],
    },
  ]
  const summary = {
    totalChecks: checks.length,
    passedChecks: checks.filter(check => check.status === 'passed').length,
    warningChecks: checks.filter(check => check.status === 'warning').length,
    blockedChecks: checks.filter(check => check.status === 'blocked').length,
  }
  const status: AiOsDoctorStatus = summary.blockedChecks > 0
    ? 'blocked'
    : summary.warningChecks > 0 ? 'warning' : 'ready'

  return {
    version: SCALE_ENGINE_VERSION,
    generatedAt: new Date().toISOString(),
    status,
    projectDir,
    scaleRoot,
    dashboard,
    benchmark,
    checks,
    summary,
    warnings: [...warnings, ...dashboard.warnings],
    nextActions: aiOsDoctorNextActions({ status, checks, dashboard, benchmark, lang }),
  }
}

export async function createAiOsAdoption(input: AiOsAdoptionInput): Promise<AiOsAdoptionReport> {
  const projectDir = resolve(input.projectDir ?? process.cwd())
  const scaleDir = input.scaleDir ?? '.scale'
  const scaleRoot = resolveScaleRoot(projectDir, scaleDir)
  const generatedAt = new Date().toISOString()
  const migration = createAiOsMigration({ projectDir, scaleDir })
  const run = await createAiOsRun({
    ...input,
    projectDir,
    scaleDir,
    taskId: input.taskId ?? `AIOS-ADOPT-${Date.now()}`,
    mode: 'dry-run',
  })
  const benchmark = await createAiOsBenchmark({
    projectDir,
    scaleDir,
    budget: input.budget,
  })
  const doctor = createAiOsDoctor({
    projectDir,
    scaleDir,
    benchmarkMaxAgeHours: input.benchmarkMaxAgeHours,
    lang: input.lang,
  })
  const phases: AiOsAdoptionPhase[] = [
    {
      id: 'migrate',
      status: migration.status === 'migrated' || migration.status === 'compatible' ? 'passed' : 'blocked',
      summary: migration.status === 'migrated'
        ? `Created ${migration.created.length} AI OS runtime path(s).`
        : 'AI OS runtime paths were already compatible.',
      evidence: [migration.files.migrationReport, ...migration.created, ...migration.existing],
    },
    {
      id: 'first-run',
      status: run.status === 'ready' ? 'passed' : 'blocked',
      summary: `Created first ${run.mode} AI OS run report with ${run.steps.length} step(s).`,
      evidence: [run.artifacts.runReport, ...run.evidence.produced],
    },
    {
      id: 'benchmark',
      status: benchmark.summary.scenarios > 0 ? 'passed' : 'blocked',
      summary: `Created AI OS benchmark report with ${benchmark.summary.scenarios} scenario(s).`,
      evidence: [benchmark.artifacts.benchmarkReport],
    },
    {
      id: 'doctor',
      status: doctor.status === 'ready' ? 'passed' : doctor.status === 'warning' ? 'warning' : 'blocked',
      summary: `AI OS doctor status is ${doctor.status}: ${doctor.summary.passedChecks}/${doctor.summary.totalChecks} checks passed.`,
      evidence: doctor.checks.flatMap(check => check.evidence),
    },
  ]
  const status: AiOsAdoptionStatus = phases.some(phase => phase.status === 'blocked')
    ? 'blocked'
    : phases.some(phase => phase.status === 'warning') ? 'warning' : 'ready'
  const adoptionReport = resolveAdoptionReportPath(projectDir, scaleDir)
  const report: AiOsAdoptionReport = {
    version: SCALE_ENGINE_VERSION,
    generatedAt,
    status,
    projectDir,
    scaleRoot,
    phases,
    migration,
    run,
    benchmark,
    doctor,
    artifacts: {
      migrationReport: migration.files.migrationReport,
      runReport: run.artifacts.runReport,
      benchmarkReport: benchmark.artifacts.benchmarkReport,
      adoptionReport,
    },
    warnings: [...migration.warnings, ...doctor.warnings],
    nextActions: aiOsAdoptionNextActions(status, input.lang ?? 'en'),
  }
  writeFileSync(adoptionReport, JSON.stringify(report, null, 2), 'utf-8')
  return report
}

export function createAiOsStatus(input: AiOsStatusInput = {}): AiOsStatusReport {
  const projectDir = resolve(input.projectDir ?? process.cwd())
  const scaleDir = input.scaleDir ?? '.scale'
  const lang = input.lang ?? 'en'
  const scaleRoot = resolveScaleRoot(projectDir, scaleDir)
  const warnings: string[] = []
  const runsDir = resolveRunsDir(projectDir, scaleDir)
  const runReports = readAiOsRunReports(runsDir, warnings)
  const dashboard = createAiOsDashboard({ projectDir, scaleDir })
  const doctor = createAiOsDoctor({
    projectDir,
    scaleDir,
    benchmarkMaxAgeHours: input.benchmarkMaxAgeHours,
    lang,
  })
  const requiredDirs = [
    join(scaleRoot, 'ai-os'),
    join(scaleRoot, 'ai-os', 'runs'),
    join(scaleRoot, 'ai-os', 'benchmarks'),
    join(scaleRoot, 'ai-os', 'migrations'),
  ]
  const missingDirs = requiredDirs.filter(dir => !existsSync(dir)).map(dir => normalizeProjectPath(projectDir, dir))
  const runEvidence = runReports.map(report => report.artifacts.runReport)
  const verificationEvidence = runReports
    .filter(report => report.verification.commands.length > 0)
    .flatMap(report => [report.artifacts.runReport, ...report.verification.commands.map(command => command.evidenceId)])
  const verificationRecommendations = buildVerificationRecommendations(projectDir, scaleDir, lang)
  const benchmarkReport = resolveBenchmarkReportPath(projectDir, scaleDir)
  const adoptionReport = resolveAdoptionReportPath(projectDir, scaleDir)
  const intelligence = buildAiOsIntelligenceReport({
    projectDir,
    scaleDir,
    runReports,
    benchmark: readAiOsBenchmarkReport(benchmarkReport, warnings),
    benchmarkStatus: doctor.benchmark.status,
    benchmarkReport,
    lang,
  })
  const checks: AiOsStatusCheck[] = [
    {
      id: 'runtime-dirs',
      title: 'Runtime directories',
      status: missingDirs.length === 0 ? 'ready' : 'blocked',
      summary: missingDirs.length === 0
        ? 'AI OS runtime directories exist.'
        : `${missingDirs.length} AI OS runtime director${missingDirs.length === 1 ? 'y is' : 'ies are'} missing.`,
      evidence: missingDirs.length === 0 ? requiredDirs.map(dir => normalizeProjectPath(projectDir, dir)) : missingDirs,
    },
    {
      id: 'plan-evidence',
      title: 'Plan evidence',
      status: runReports.length > 0 ? 'ready' : 'blocked',
      summary: runReports.length > 0
        ? `${runReports.length} run report(s) include embedded AI OS plans.`
        : 'No AI OS plan evidence is persisted through a run report.',
      evidence: runEvidence,
    },
    {
      id: 'run-evidence',
      title: 'Run evidence',
      status: runReports.length > 0 ? 'ready' : 'blocked',
      summary: runReports.length > 0
        ? `${runReports.length} AI OS run report(s) found.`
        : 'No AI OS run reports found.',
      evidence: runEvidence,
    },
    {
      id: 'verification-evidence',
      title: 'Verification evidence',
      status: verificationEvidence.length > 0 ? 'ready' : 'blocked',
      summary: verificationEvidence.length > 0
        ? `${verificationEvidence.length} guarded verification evidence reference(s) found.`
        : 'No guarded verification evidence found.',
      evidence: verificationEvidence,
    },
    {
      id: 'dashboard-health',
      title: 'Dashboard health',
      status: dashboard.health.status === 'healthy'
        ? 'ready'
        : dashboard.health.status === 'empty' || dashboard.health.status === 'blocked' ? 'blocked' : 'warning',
      summary: `${dashboard.health.status} (${dashboard.health.score}): ${dashboard.health.reasons.join('; ')}`,
      evidence: [runsDir],
    },
    {
      id: 'benchmark-evidence',
      title: 'Benchmark evidence',
      status: doctor.benchmark.status === 'fresh' ? 'ready' : doctor.benchmark.status === 'stale' ? 'warning' : 'blocked',
      summary: summarizeBenchmarkDoctor(doctor.benchmark),
      evidence: [benchmarkReport],
    },
    {
      id: 'adoption-evidence',
      title: 'Adoption evidence',
      status: existsSync(adoptionReport) ? 'ready' : 'blocked',
      summary: existsSync(adoptionReport)
        ? 'AI OS adoption report exists.'
        : 'No AI OS adoption report found.',
      evidence: [adoptionReport],
    },
  ]
  const summary = {
    total: checks.length,
    ready: checks.filter(check => check.status === 'ready').length,
    warning: checks.filter(check => check.status === 'warning').length,
    blocked: checks.filter(check => check.status === 'blocked').length,
  }
  const status: AiOsClosedLoopStatus = summary.blocked > 0 ? 'blocked' : summary.warning > 0 ? 'warning' : 'ready'
  return {
    version: SCALE_ENGINE_VERSION,
    generatedAt: new Date().toISOString(),
    status,
    projectDir,
    scaleRoot,
    checks,
    summary,
    dashboard,
    doctor,
    intelligence,
    verificationRecommendations,
    nextActions: aiOsStatusNextActions(status, checks, lang, verificationRecommendations),
    warnings: [...warnings, ...doctor.warnings],
  }
}

function buildAiOsIntelligenceReport(input: {
  projectDir: string
  scaleDir: string
  runReports: AiOsRunReport[]
  benchmark?: AiOsBenchmarkReport
  benchmarkStatus: AiOsDoctorReport['benchmark']['status']
  benchmarkReport: string
  lang: 'zh' | 'en'
}): AiOsIntelligenceReport {
  const runMemoryItems = input.runReports.flatMap(report => report.plan.memory.items)
  const benchmarkMemoryItems = input.benchmark?.summary.totalMemoryItems ?? 0
  const runProviders = input.runReports.flatMap(report => report.plan.memory.selectedProviders)
  const benchmarkProviders = input.benchmark?.scenarios.flatMap(scenario => scenario.metrics.selectedProviders) ?? []
  const selectedProviders = [...new Set([...runProviders, ...benchmarkProviders])].sort()
  const runTokenSavings = input.runReports.reduce((sum, report) => sum + (report.plan.context.compiler?.estimatedTokenSavings ?? 0), 0)
  const benchmarkTokenSavings = input.benchmark?.summary.totalEstimatedTokenSavings ?? 0
  const estimatedTokenSavings = runTokenSavings + benchmarkTokenSavings
  const runSkillSteps = input.runReports.reduce((sum, report) => sum + report.plan.skillPlan.executionPlan.steps.length, 0)
  const benchmarkSkillSteps = input.benchmark?.summary.totalSkillSteps ?? 0
  const skillSteps = runSkillSteps + benchmarkSkillSteps
  const totalMemoryItems = runMemoryItems.length + benchmarkMemoryItems
  const memoryQuality = summarizeMemoryQuality(runMemoryItems)
  const contextQuality = summarizeContextQuality(input.runReports)
  const evaluatorQuality = summarizeEvaluatorQuality(input.runReports, input.benchmark)
  const toolStrategyQuality = summarizeToolStrategyQuality(input.runReports, input.benchmark)
  const agentLoop = assessAgentLoopReadiness({
    projectDir: input.projectDir,
    scaleDir: input.scaleDir,
    runReports: input.runReports,
  })
  const agentLoopQuality = summarizeAgentLoopQuality(agentLoop)
  const evolutionQuality = summarizeEvolutionQuality(input.runReports, input.benchmark)
  const contextSignalStatus: AiOsClosedLoopStatus = contextQuality.compressionRisk === 'high'
    ? 'warning'
    : estimatedTokenSavings > 0 ? 'ready' : input.runReports.length > 0 || input.benchmark ? 'warning' : 'blocked'

  const memoryEvidence = [
    ...runMemoryItems.map(item => `${item.provider}:${item.id}`),
    ...(benchmarkMemoryItems > 0 ? [`benchmark:${input.benchmarkReport}:${benchmarkMemoryItems}`] : []),
  ]
  const contextEvidence = [
    ...input.runReports.map(report => `${report.artifacts.runReport}:saved=${report.plan.context.compiler?.estimatedTokenSavings ?? 0}`),
    ...(input.benchmark ? [`${input.benchmarkReport}:saved=${input.benchmark.summary.totalEstimatedTokenSavings}`] : []),
  ]
  const skillEvidence = [
    ...input.runReports.flatMap(report => report.plan.skillPlan.executionPlan.steps.map(step => `${report.artifacts.runReport}:${step.id}`)),
    ...(input.benchmark ? [`${input.benchmarkReport}:steps=${input.benchmark.summary.totalSkillSteps}`] : []),
  ]
  const evaluatorEvidence = [
    ...input.runReports.flatMap(report => resolveRunEvaluator(report).gates.map(gate => `${report.artifacts.runReport}:${gate.id}`)),
    ...(input.benchmark ? [`${input.benchmarkReport}:evaluator-gates=${input.benchmark.summary.totalEvaluatorGates}`] : []),
  ]
  const toolStrategyEvidence = [
    ...input.runReports.flatMap(report => resolveRunToolStrategy(report).nodes.map(node => `${report.artifacts.runReport}:${node.id}`)),
    ...(input.benchmark ? [`${input.benchmarkReport}:tool-strategy=${input.benchmark.summary.totalToolStrategySteps}`] : []),
  ]
  const evolutionEvidence = [
    ...input.runReports.flatMap(report =>
      (report.plan.evolutionShadow?.proposals ?? []).map(p => `${report.artifacts.runReport}:${p.id}:${p.maturity.stage}`),
    ),
    ...(input.benchmark ? [`${input.benchmarkReport}:evolution-proposals=${input.benchmark.summary.totalEvolutionProposals}`] : []),
  ]
  const agentLoopEvidence = agentLoop.summary.evidence.length > 0
    ? agentLoop.summary.evidence
    : [resolveScaleRoot(input.projectDir, input.scaleDir)]
  const benchmarkEvidence = input.benchmark ? [
    `${input.benchmarkReport}:scenarios=${input.benchmark.summary.scenarios}`,
    `${input.benchmarkReport}:memory=${input.benchmark.summary.totalMemoryItems}`,
    `${input.benchmarkReport}:skills=${input.benchmark.summary.totalSkillSteps}`,
    `${input.benchmarkReport}:evaluator-gates=${input.benchmark.summary.totalEvaluatorGates}`,
    `${input.benchmarkReport}:tool-strategy=${input.benchmark.summary.totalToolStrategySteps}`,
  ] : [input.benchmarkReport]

  const signals: AiOsIntelligenceSignal[] = [
    {
      id: 'memory-recall',
      status: totalMemoryItems > 0 ? 'ready' : selectedProviders.length > 0 ? 'warning' : 'blocked',
      summary: totalMemoryItems > 0
        ? `${totalMemoryItems} memory item(s) recalled through ${selectedProviders.join(', ') || 'configured providers'}; quality ${memoryQuality.score}/100.`
        : selectedProviders.length > 0
          ? `Memory providers were selected (${selectedProviders.join(', ')}) but no relevant item was recalled.`
          : 'No memory recall evidence found in AI OS runs or benchmarks.',
      evidence: memoryEvidence,
      recommendations: totalMemoryItems > 0
        ? ['Keep recording memory item ids with every run so later context assembly can explain recall.']
        : ['Run an AI OS task that should match durable project memory before claiming memory intelligence.'],
    },
    {
      id: 'context-savings',
      status: contextSignalStatus,
      summary: estimatedTokenSavings > 0
        ? `${estimatedTokenSavings} estimated token(s) saved by context compilation evidence; compression risk ${contextQuality.compressionRisk}.`
        : 'Context compiler evidence exists but has not shown measurable token savings yet.',
      evidence: contextEvidence,
      recommendations: contextQuality.evidenceLossWarnings.length > 0
        ? ['Review omitted evidence-bearing context before claiming the task has enough context.']
        : estimatedTokenSavings > 0
          ? ['Track savings deltas across releases before publishing token reduction claims.']
        : ['Add larger representative tasks to benchmark context slicing and token savings.'],
    },
    {
      id: 'skill-routing',
      status: skillSteps > 0 ? 'ready' : input.runReports.length > 0 || input.benchmark ? 'warning' : 'blocked',
      summary: skillSteps > 0
        ? `${skillSteps} skill routing step(s) planned across runs and benchmark scenarios.`
        : 'No skill routing step evidence found.',
      evidence: skillEvidence,
      recommendations: skillSteps > 0
        ? ['Use skill routing evidence in reviews to check why a skill, MCP, or CLI path was selected.']
        : ['Create a task with files or services that should trigger required skill routing.'],
    },
    {
      id: 'evaluator-intelligence',
      status: evaluatorQuality.requiredGates > 0
        ? evaluatorQuality.averageUncertainty >= 0.7 ? 'warning' : 'ready'
        : input.runReports.length > 0 || input.benchmark ? 'warning' : 'blocked',
      summary: evaluatorQuality.requiredGates > 0
        ? `${evaluatorQuality.requiredGates} evaluator gate(s) required; average uncertainty ${evaluatorQuality.averageUncertainty}.`
        : 'No evaluator gate evidence found for architecture, root-cause, security, or release reasoning.',
      evidence: evaluatorEvidence,
      recommendations: evaluatorQuality.requiredGates > 0
        ? ['Use evaluator gates to force critique, uncertainty logging, and review evidence before promoting reasoning-heavy work.']
        : ['Run a reasoning-heavy AI OS task so evaluator intelligence can prove critique coverage.'],
    },
    {
      id: 'tool-strategy',
      status: toolStrategyQuality.totalSteps > 0
        ? toolStrategyQuality.fallbackCoverage < 1 ? 'warning' : 'ready'
        : input.runReports.length > 0 || input.benchmark ? 'warning' : 'blocked',
      summary: toolStrategyQuality.totalSteps > 0
        ? `${toolStrategyQuality.totalSteps} tool strategy step(s); ${toolStrategyQuality.highRiskSteps} high-risk; fallback coverage ${toolStrategyQuality.fallbackCoverage}.`
        : 'No tool strategy graph found for skills, artifacts, CLI, MCP, or verification steps.',
      evidence: toolStrategyEvidence,
      recommendations: toolStrategyQuality.totalSteps > 0
        ? ['Use tool strategy evidence to review cost, retry, fallback, and side-effect risk before execution.']
        : ['Create a task that triggers skill routing so the AI OS can build a tool strategy graph.'],
    },
    {
      id: 'agent-loop-readiness',
      status: agentLoop.status === 'ready' ? 'ready' : 'warning',
      summary: `Agent Loop readiness ${agentLoop.status}; ${agentLoop.summary.readySignals}/6 signal(s) ready; score ${agentLoop.score}/100.`,
      evidence: agentLoopEvidence,
      recommendations: agentLoop.summary.recommendations.length > 0
        ? agentLoop.summary.recommendations
        : ['Keep collecting execution, recovery, guardrail, budget, delegation, and termination evidence for every guarded run.'],
    },
    {
      id: 'adaptive-workflow',
      status: input.runReports.some(r => r.plan.adaptiveWorkflow.profile) ? 'ready' : input.runReports.length > 0 || input.benchmark ? 'warning' : 'blocked',
      summary: summarizeAdaptiveWorkflowSignal(input.runReports, input.benchmark),
      evidence: [
        ...input.runReports.map(r => `${r.artifacts.runReport}:profile=${r.plan.adaptiveWorkflow.profile}`),
        ...(input.benchmark ? [`${input.benchmarkReport}:profiles=${input.benchmark.summary.workflowProfiles.join(',')}`] : []),
      ],
      recommendations: input.runReports.some(r => r.plan.adaptiveWorkflow.profile)
        ? ['Use workflow profile distribution to verify that risk signals correctly escalate governance.']
        : ['Run an AI OS task with mixed risk levels to prove adaptive workflow routing.'],
    },
    {
      id: 'evolution-shadow',
      status: evolutionQuality.proposals > 0
        ? evolutionQuality.pendingValidation > 0 ? 'warning' : 'ready'
        : input.runReports.length > 0 || input.benchmark ? 'warning' : 'blocked',
      summary: evolutionQuality.proposals > 0
        ? `${evolutionQuality.proposals} shadow proposal(s); ${evolutionQuality.shadowRules} shadow, ${evolutionQuality.candidateHooks} candidate-hook, ${evolutionQuality.approvedBlocking} approved-blocking.`
        : 'No evolution shadow proposals found. Run tasks with high-risk governance signals or evaluator gates to generate shadow rule candidates.',
      evidence: evolutionEvidence,
      recommendations: evolutionQuality.proposals > 0
        ? ['Review shadow rule proposals and validate before promotion to candidate-hook or approved-blocking.']
        : ['Run a high-risk AI OS task so evolution shadow promotion can propose rules from governance and evaluator signals.'],
    },
    {
      id: 'benchmark-intelligence',
      status: input.benchmark && input.benchmarkStatus === 'fresh'
        ? 'ready'
        : input.benchmark && input.benchmarkStatus === 'stale' ? 'warning' : 'blocked',
      summary: input.benchmark
        ? `${input.benchmark.summary.scenarios} benchmark scenario(s); benchmark status ${input.benchmarkStatus}.`
        : 'No AI OS benchmark report available for intelligence metrics.',
      evidence: benchmarkEvidence,
      recommendations: input.benchmark && input.benchmarkStatus === 'fresh'
        ? ['Use intelligence signals alongside benchmark deltas for release readiness reviews.']
        : ['Run `scale ai-os benchmark --json` to refresh memory/context/skill intelligence metrics.'],
    },
  ]
  const summary = {
    ready: signals.filter(signal => signal.status === 'ready').length,
    warning: signals.filter(signal => signal.status === 'warning').length,
    blocked: signals.filter(signal => signal.status === 'blocked').length,
    totalMemoryItems,
    selectedProviders,
    memoryQuality,
    contextQuality,
    evaluatorQuality,
    toolStrategyQuality,
    agentLoopQuality,
    evolutionQuality,
    estimatedTokenSavings,
    skillSteps,
  }
  const status: AiOsClosedLoopStatus = summary.blocked > 0 ? 'blocked' : summary.warning > 0 ? 'warning' : 'ready'
  const nextActions = aiOsIntelligenceNextActions(status, signals, input.lang)
  return { status, summary, signals, nextActions }
}

function summarizeContextQuality(runReports: AiOsRunReport[]): AiOsContextQualitySummary {
  const omitted = runReports.flatMap(report => report.plan.context.omitted.map(item => {
    const section = report.plan.context.sections.find(candidate => candidate.id === item.id)
    return {
      ...item,
      category: section?.category,
      runReport: report.artifacts.runReport,
      report,
    }
  }))
  const totalOmittedTokens = omitted.reduce((sum, item) => sum + item.estimatedTokens, 0)
  const highestOmittedTokens = omitted.reduce((max, item) => Math.max(max, item.estimatedTokens), 0)
  const evidenceLossWarnings = omitted
    .filter(item => isHighRiskOmittedEvidence(item.report, item))
    .map(item => `${item.id} omitted from ${item.runReport} (${item.estimatedTokens} tokens; ${item.reason}).`)
  const compressionRisk: AiOsContextQualitySummary['compressionRisk'] = evidenceLossWarnings.length > 0
    ? 'high'
    : omitted.length > 0 ? 'medium' : 'low'
  return {
    omittedSections: omitted.length,
    totalOmittedTokens,
    evidenceLossWarnings,
    highestOmittedTokens,
    compressionRisk,
  }
}

function isHighRiskOmittedEvidence(
  report: AiOsRunReport,
  item: AiOsRuntimePlan['context']['omitted'][number] & { category?: string },
): boolean {
  const evidenceBearing = item.category === 'evidence' || item.id.includes('evidence')
  if (!evidenceBearing) return false
  if (hasStructuredEvidenceReplacement(report, item.id)) return false
  if (report.plan.task.level === 'CRITICAL') return true
  return !report.dryRun
}

function hasStructuredEvidenceReplacement(report: AiOsRunReport, omittedId: string): boolean {
  if (report.evidence.produced.includes(omittedId)) return true
  if (omittedId === 'runtime-evidence' && report.verification.allPassed && report.verification.commands.length > 0) {
    return true
  }
  return false
}

function summarizeEvaluatorQuality(
  runReports: AiOsRunReport[],
  benchmark?: AiOsBenchmarkReport,
): AiOsEvaluatorQualitySummary {
  const runEvaluators = runReports.map(resolveRunEvaluator)
  const runGates = runEvaluators.flatMap(evaluator => evaluator.gates)
  const benchmarkGateCount = benchmark?.summary.totalEvaluatorGates ?? 0
  const uncertaintyScores = runEvaluators.map(evaluator => evaluator.uncertainty.score)
  const gateIds = new Set<AiOsEvaluatorGateId>(runGates.map(gate => gate.id))
  if (benchmarkGateCount > 0) gateIds.add('uncertainty-decision-log')
  return {
    requiredGates: runGates.filter(gate => gate.required).length + benchmarkGateCount,
    highRiskPlans: runEvaluators.filter(evaluator => evaluator.riskLevel === 'high').length,
    averageUncertainty: roundMetric(average(uncertaintyScores)),
    gateIds: [...gateIds].sort(),
  }
}

function resolveRunEvaluator(report: AiOsRunReport): AiOsEvaluatorIntelligence {
  const plan = report.plan as AiOsRuntimePlan & { evaluator?: AiOsEvaluatorIntelligence }
  return plan.evaluator ?? createEvaluatorIntelligence({
    task: report.plan.task.task,
    files: report.plan.task.files,
    governance: report.plan.governance,
    skillPlan: report.plan.skillPlan,
  })
}

function summarizeToolStrategyQuality(
  runReports: AiOsRunReport[],
  benchmark?: AiOsBenchmarkReport,
): AiOsToolStrategyQualitySummary {
  const runStrategies = runReports.map(resolveRunToolStrategy)
  const runSummary = runStrategies.reduce((summary, strategy) => ({
    totalSteps: summary.totalSteps + strategy.summary.totalSteps,
    requiredSteps: summary.requiredSteps + strategy.summary.requiredSteps,
    highRiskSteps: summary.highRiskSteps + strategy.summary.highRiskSteps,
    estimatedCostUnits: summary.estimatedCostUnits + strategy.summary.estimatedCostUnits,
    fallbackCoveredSteps: summary.fallbackCoveredSteps + strategy.summary.fallbackCoveredSteps,
  }), {
    totalSteps: 0,
    requiredSteps: 0,
    highRiskSteps: 0,
    estimatedCostUnits: 0,
    fallbackCoveredSteps: 0,
  })
  const benchmarkSteps = benchmark?.summary.totalToolStrategySteps ?? 0
  const benchmarkCost = benchmark?.summary.totalToolStrategyCostUnits ?? 0
  const totalSteps = runSummary.totalSteps + benchmarkSteps
  const fallbackCoveredSteps = runSummary.fallbackCoveredSteps + benchmarkSteps
  return {
    totalSteps,
    requiredSteps: runSummary.requiredSteps,
    highRiskSteps: runSummary.highRiskSteps,
    estimatedCostUnits: runSummary.estimatedCostUnits + benchmarkCost,
    fallbackCoverage: totalSteps > 0 ? roundMetric(fallbackCoveredSteps / totalSteps) : 0,
  }
}

function resolveRunToolStrategy(report: AiOsRunReport): AiOsToolStrategyPlan {
  const plan = report.plan as AiOsRuntimePlan & { toolStrategy?: AiOsToolStrategyPlan }
  return plan.toolStrategy ?? createToolStrategyPlan(report.plan.skillPlan)
}

function summarizeAgentLoopQuality(report: AgentLoopReadinessReport): AiOsAgentLoopQualitySummary {
  return {
    status: report.status,
    score: report.score,
    readySignals: report.summary.readySignals,
    warningSignals: report.summary.warningSignals,
    missingSignals: report.summary.missingSignals,
    loopRecoveryRate: report.metrics.loopRecoveryRate.value,
    guardrailCoverage: report.metrics.guardrailCoverage.value,
    budgetControlled: report.metrics.budgetControlEvidence.value,
    terminationEvidence: report.metrics.terminationEvidence.value,
  }
}

function summarizeEvolutionQuality(
  runReports: AiOsRunReport[],
  benchmark?: AiOsBenchmarkReport,
): AiOsEvolutionQualitySummary {
  const runProposals = runReports.flatMap(r => r.plan.evolutionShadow?.proposals ?? [])
  const benchmarkProposals = benchmark?.summary.totalEvolutionProposals ?? 0
  const allProposals = runProposals
  const stageCount = (stage: string) => allProposals.filter(p => p.maturity.stage === stage).length
  return {
    proposals: allProposals.length + benchmarkProposals,
    shadowRules: stageCount('shadow'),
    candidateHooks: stageCount('candidate-hook'),
    approvedBlocking: stageCount('approved-blocking'),
    pendingValidation: allProposals.filter(p => p.maturity.stage === 'shadow' && p.maturity.shadowHits < 10).length,
  }
}

function resolveRunEvolutionShadow(report: AiOsRunReport): EvolutionShadowReport {
  const plan = report.plan as AiOsRuntimePlan & { evolutionShadow?: EvolutionShadowReport }
  return plan.evolutionShadow ?? buildEvolutionShadowReport([])
}

function summarizeAdaptiveWorkflowSignal(runReports: AiOsRunReport[], benchmark?: AiOsBenchmarkReport): string {
  const profiles = runReports.map(r => r.plan.adaptiveWorkflow.profile)
  const benchmarkProfiles = benchmark?.summary.workflowProfiles ?? []
  const allProfiles = [...profiles, ...benchmarkProfiles]
  if (allProfiles.length === 0) return 'No adaptive workflow profile evidence found.'
  const distribution = new Map<string, number>()
  for (const p of allProfiles) distribution.set(p, (distribution.get(p) ?? 0) + 1)
  const parts = [...distribution.entries()].map(([p, n]) => `${p}=${n}`).join(', ')
  const escalated = runReports.filter(r => r.plan.adaptiveWorkflow.escalationReasons.length > 0).length
  return `${allProfiles.length} run(s) with profile distribution: ${parts}. ${escalated} run(s) had escalation reasons.`
}

function summarizeMemoryQuality(items: MemoryProviderRecallItem[]): AiOsMemoryQualitySummary {
  if (items.length === 0) {
    return {
      score: 0,
      evidenceBackedItems: 0,
      missingEvidenceItems: 0,
      lowConfidenceItems: 0,
      averageConfidence: 0,
      averageRelevance: 0,
    }
  }
  const evidenceBackedItems = items.filter(item => item.evidencePaths.length > 0).length
  const missingEvidenceItems = items.length - evidenceBackedItems
  const lowConfidenceItems = items.filter(item => item.confidence < 0.7).length
  const averageConfidence = average(items.map(item => clampUnit(item.confidence)))
  const averageRelevance = average(items.map(item => clampUnit(item.score)))
  const evidenceRatio = evidenceBackedItems / items.length
  const lowConfidenceRatio = lowConfidenceItems / items.length
  const score = Math.max(0, Math.round((averageConfidence * 40) + (averageRelevance * 30) + (evidenceRatio * 30) - (lowConfidenceRatio * 10)))
  return {
    score,
    evidenceBackedItems,
    missingEvidenceItems,
    lowConfidenceItems,
    averageConfidence: roundMetric(averageConfidence),
    averageRelevance: roundMetric(averageRelevance),
  }
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function roundMetric(value: number): number {
  return Number(value.toFixed(3))
}

function aiOsIntelligenceNextActions(
  status: AiOsClosedLoopStatus,
  signals: AiOsIntelligenceSignal[],
  lang: 'zh' | 'en',
): string[] {
  const actions: string[] = []
  if (signals.some(signal => signal.status === 'ready')) {
    actions.push('Use intelligence signals during release review to prove memory, context, and skill routing gains.')
  }
  if (status === 'ready') return actions
  const blocked = signals.filter(signal => signal.status === 'blocked').map(signal => signal.id)
  if (lang === 'zh') {
    actions.push(`Refresh AI OS intelligence evidence for: ${blocked.join(', ') || 'warning signals'}.`)
    return actions
  }
  actions.push(`Refresh AI OS intelligence evidence for: ${blocked.join(', ') || 'warning signals'}.`)
  return actions
}

function buildRunSteps(plan: AiOsRuntimePlan): AiOsRunStep[] {
  const steps = new Map<string, AiOsRunStep>()
  const upsert = (step: AiOsRunStep) => steps.set(step.id, step)

  upsert({
    id: 'runtime-plan',
    kind: 'plan',
    title: 'Create unified AI OS runtime plan',
    status: 'passed',
    required: true,
    summary: `Governance mode ${plan.governance.effectiveMode}; ${plan.skillPlan.executionPlan.steps.length} skill step(s).`,
    evidence: ['governance', 'context', 'memory', 'skillPlan', 'roi'],
  })
  upsert({
    id: 'context-compiler',
    kind: 'context',
    title: 'Compile task context',
    status: 'passed',
    required: true,
    summary: `${plan.context.totalEstimatedTokens}/${plan.context.task.budget} estimated tokens; saved ${plan.context.compiler?.estimatedTokenSavings ?? 0}.`,
    evidence: ['context.compiler', 'context.includedSections', 'context.omittedSections'],
    dependsOn: ['runtime-plan'],
  })
  upsert({
    id: 'memory-provider-recall',
    kind: 'memory',
    title: 'Recall provider-backed memory',
    status: 'passed',
    required: true,
    summary: `${plan.memory.items.length} recalled item(s); providers ${plan.memory.providerOrder.join(' -> ')}.`,
    evidence: ['memory.providerOrder', 'memory.selectedProviders', 'memory.items'],
    dependsOn: ['runtime-plan'],
  })

  const profile = plan.adaptiveWorkflow.profile
  for (const gate of plan.adaptiveWorkflow.gates) {
    if (steps.has(gate)) continue
    const gateRequired = profile !== 'light'
    upsert({
      id: gate,
      kind: gate === 'runtime-evidence' ? 'evidence' : 'gate',
      title: `Satisfy ${gate} gate`,
      status: 'planned',
      required: gateRequired,
      summary: gateRequired
        ? `Required by ${plan.adaptiveWorkflow.strategy} in ${profile} profile (${plan.adaptiveWorkflow.mode} mode).`
        : `Advisory in ${profile} profile; not blocking completion.`,
      evidence: [`gate.${gate}`],
      dependsOn: ['runtime-plan'],
    })
  }

  for (const skillStep of plan.skillPlan.executionPlan.steps) {
    upsert({
      id: `skill:${skillStep.id}`,
      kind: 'skill',
      title: `${skillStep.kind}: ${skillStep.id}`,
      status: 'planned',
      required: skillStep.required,
      summary: `${skillStep.reason} Fallback: ${skillStep.fallback}.`,
      evidence: [skillStep.evidenceRequired],
      dependsOn: ['skill-evidence'],
    })
  }

  upsert({
    id: 'failure-learning',
    kind: 'learning',
    title: 'Prepare failure learning settlement',
    status: 'planned',
    required: false,
    summary: 'Create lesson or rule candidates only when a gate, verification step, or evidence requirement fails.',
    evidence: ['failureLearning.candidates'],
    dependsOn: ['runtime-evidence'],
  })

  return [...steps.values()]
}

async function runGuardedVerification(options: {
  projectDir: string
  scaleDir: string
  plan: AiOsRuntimePlan
  steps: AiOsRunStep[]
  commands: string[]
  timeout?: number
  allowShell?: boolean
  enabled: boolean
}): Promise<AiOsRunReport['verification']> {
  if (!options.enabled || options.commands.length === 0) {
    return { commands: [], allPassed: options.commands.length === 0 }
  }

  const ledger = new RuntimeEvidenceLedger({
    projectDir: options.projectDir,
    scaleDir: options.scaleDir,
  })
  const reports: AiOsVerificationCommandReport[] = []

  for (const [index, command] of options.commands.entries()) {
    const stepId = `verify-command:${index + 1}`
    let result: { exitCode: number; stdout: string; stderr: string }
    try {
      result = await runSafeCommand(command, {
        cwd: options.projectDir,
        timeout: options.timeout ?? 120_000,
        allowShell: options.allowShell,
      })
    } catch (error) {
      result = {
        exitCode: 1,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
      }
    }
    const passed = result.exitCode === 0
    const evidence = ledger.record({
      taskId: options.plan.task.taskId,
      kind: 'command',
      title: `AI OS verification command ${index + 1}`,
      status: passed ? 'passed' : 'failed',
      command,
      exitCode: result.exitCode,
      summary: passed
        ? `Guarded verification command passed: ${command}`
        : `Guarded verification command failed with exit code ${result.exitCode}: ${command}`,
      metadata: {
        aiOsRun: true,
        stepId,
        stdoutPreview: truncate(result.stdout),
        stderrPreview: truncate(result.stderr),
      },
    })
    reports.push({
      command,
      status: passed ? 'passed' : 'failed',
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      evidenceId: evidence.id,
    })
    options.steps.push({
      id: stepId,
      kind: 'evidence',
      title: `Run verification command ${index + 1}`,
      status: passed ? 'passed' : 'blocked',
      required: true,
      summary: passed
        ? `Command passed and runtime evidence was recorded as ${evidence.id}.`
        : `Command failed and runtime evidence was recorded as ${evidence.id}.`,
      evidence: [evidence.id],
      dependsOn: ['runtime-evidence'],
    })
  }

  const runtimeEvidenceStep = options.steps.find(step => step.id === 'runtime-evidence')
  if (runtimeEvidenceStep) {
    const allPassed = reports.every(report => report.status === 'passed')
    runtimeEvidenceStep.status = allPassed ? 'passed' : 'blocked'
    runtimeEvidenceStep.summary = allPassed
      ? `${reports.length} guarded verification command(s) passed and were recorded as runtime evidence.`
      : `${reports.filter(report => report.status === 'failed').length}/${reports.length} guarded verification command(s) failed.`
    runtimeEvidenceStep.evidence = reports.map(report => report.evidenceId)
  }

  return {
    commands: reports,
    allPassed: reports.every(report => report.status === 'passed'),
  }
}

function summarizeRunEvidence(steps: AiOsRunStep[]): AiOsRunReport['evidence'] {
  const required = new Set<string>()
  const produced = new Set<string>()
  const pending = new Set<string>()
  for (const step of steps) {
    if (step.required) {
      for (const item of evidenceCategory(step)) required.add(item)
    }
    if (step.status === 'passed') {
      for (const item of evidenceCategory(step)) produced.add(item)
    } else if (step.required && step.status === 'planned') {
      for (const item of evidenceCategory(step)) pending.add(item)
    }
  }
  return {
    required: [...required],
    produced: [...produced],
    pending: [...pending],
  }
}

function evidenceCategory(step: AiOsRunStep): string[] {
  if (step.id === 'runtime-plan') return ['ai-os-plan']
  if (step.id === 'context-compiler') return ['context-compiler']
  if (step.id === 'memory-provider-recall') return ['memory-provider-recall']
  if (step.id === 'skill-evidence' || step.kind === 'skill') return ['skill-routing-engine']
  if (step.id === 'runtime-evidence' || step.kind === 'evidence') return ['runtime-evidence']
  if (step.kind === 'gate') return [`gate:${step.id}`]
  return [step.id]
}

function buildFailureLearningCandidates(
  plan: AiOsRuntimePlan,
  steps: AiOsRunStep[],
): AiOsRunFailureLearningCandidate[] {
  const hasBlockedVerification = steps.some(step => step.status === 'blocked' && step.id.startsWith('verify-command:'))
  const failed = steps.filter(step => step.status === 'blocked' && !(hasBlockedVerification && step.id === 'runtime-evidence'))
  return failed.map(step => ({
    id: `AIO-FLC-${safePathSegment(plan.task.taskId ?? step.id)}-${safePathSegment(step.id)}`,
    source: 'failed-step',
    title: `Failure learning candidate: ${step.title}`,
    summary: step.summary,
    recommendedAction: 'resolve-before-promotion',
    evidenceRefs: step.evidence,
    promotable: false,
  }))
}

function buildRunNextActions(steps: AiOsRunStep[], mode: AiOsRunMode): string[] {
  const actions: string[] = []
  for (const step of steps) {
    if (step.status !== 'planned' || !step.required) continue
    if (step.kind === 'skill') actions.push(`Execute required skill step "${step.title}" and attach evidence: ${step.evidence.join(', ')}.`)
    else if (step.kind === 'evidence') actions.push(`Record runtime evidence for "${step.id}" before claiming completion.`)
    else if (step.kind === 'gate') actions.push(`Satisfy gate "${step.id}" before ship.`)
  }
  if (mode === 'dry-run') actions.push('Re-run with guarded execution only after reviewing the dry-run report.')
  return actions
}

function resolveRunReportPath(projectDir: string, scaleDir: string, taskId: string): string {
  return join(resolveRunsDir(projectDir, scaleDir), `${safePathSegment(taskId)}.json`)
}

function writeAiOsRunReport(path: string, report: AiOsRunReport): void {
  const dir = dirname(path)
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(report, null, 2), 'utf-8')
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || 'ai-os-run'
}

function truncate(value: string, max = 1000): string {
  return value.length > max ? `${value.slice(0, max)}...` : value
}

function normalizeProjectPath(projectDir: string, path: string): string {
  const normalizedProject = resolve(projectDir)
  const normalizedPath = resolve(path)
  if (normalizedPath.startsWith(normalizedProject)) {
    return normalizedPath.slice(normalizedProject.length + 1).replace(/\\/g, '/')
  }
  return normalizedPath.replace(/\\/g, '/')
}

function resolveScaleRoot(projectDir: string, scaleDir: string): string {
  return isAbsolute(scaleDir) ? scaleDir : join(projectDir, scaleDir)
}

function resolveRunsDir(projectDir: string, scaleDir: string): string {
  return join(resolveScaleRoot(projectDir, scaleDir), 'ai-os', 'runs')
}

function resolveBenchmarkReportPath(projectDir: string, scaleDir: string): string {
  return join(resolveScaleRoot(projectDir, scaleDir), 'ai-os', 'benchmarks', 'latest.json')
}

function resolveAdoptionReportPath(projectDir: string, scaleDir: string): string {
  return join(resolveScaleRoot(projectDir, scaleDir), 'ai-os', 'adoption.json')
}

function aiOsAdoptionNextActions(status: AiOsAdoptionStatus, lang: 'zh' | 'en'): string[] {
  if (lang === 'zh') {
    if (status === 'ready') return ['AI OS runtime 接入完成；后续真实任务使用 `scale ai-os run --mode guarded`。']
    if (status === 'warning') return ['AI OS runtime 已可用但仍有警告；先运行 `scale ai-os doctor --json --lang zh` 处理剩余项。']
    return ['AI OS runtime 接入被阻断；查看 adoption report 和 `scale ai-os doctor --json --lang zh` 的失败项。']
  }
  if (status === 'ready') return ['AI OS runtime adoption is complete; use `scale ai-os run --mode guarded` for governed work.']
  if (status === 'warning') return ['AI OS runtime is usable with warnings; run `scale ai-os doctor --json --lang en` and resolve remaining items.']
  return ['AI OS runtime adoption is blocked; inspect the adoption report and `scale ai-os doctor --json --lang en` failures.']
}

function aiOsStatusNextActions(
  status: AiOsClosedLoopStatus,
  checks: AiOsStatusCheck[],
  lang: 'zh' | 'en',
  verificationRecommendations: AiOsVerificationRecommendation[],
): string[] {
  const blocked = new Set(checks.filter(check => check.status === 'blocked').map(check => check.id))
  const firstVerificationCommand = verificationRecommendations[0]?.command ?? '<command>'
  if (lang === 'zh') {
    if (status === 'ready') return ['AI OS 闭环已就绪，可使用 `scale ai-os run --mode guarded` 执行受治理任务。']
    if (blocked.has('runtime-dirs') || blocked.has('adoption-evidence')) {
      return ['运行 `scale ai-os adopt --task "接入 AI OS runtime" --lang zh` 生成运行态、首份 dry-run、benchmark 和 doctor 报告。']
    }
    if (blocked.has('verification-evidence')) return ['运行 `scale ai-os run --mode guarded --verify "<command>"` 生成受治理验证证据。']
    if (blocked.has('benchmark-evidence')) return ['运行 `scale ai-os benchmark --json` 生成闭环 benchmark 证据。']
    return ['查看 status checks，补齐 blocked 项后重新运行 `scale ai-os status --lang zh`。']
  }
  if (status === 'ready') return ['AI OS closed loop is ready for guarded project work.']
  if (blocked.has('runtime-dirs') || blocked.has('adoption-evidence')) {
    return ['Run `scale ai-os adopt --task "Adopt AI OS runtime" --lang en` to create runtime state, first dry-run, benchmark, and doctor reports.']
  }
  if (blocked.has('verification-evidence')) return [`Run \`scale ai-os run --mode guarded --verify "${escapeCliDoubleQuoted(firstVerificationCommand)}"\` to produce governed verification evidence.`]
  if (blocked.has('benchmark-evidence')) return ['Run `scale ai-os benchmark --json` to produce closed-loop benchmark evidence.']
  return ['Inspect status checks, resolve blocked items, then rerun `scale ai-os status --lang en`.']
}

const VERIFICATION_COMMAND_ORDER: VerificationCommandName[] = ['build', 'lint', 'test', 'smoke', 'coverage']

function buildVerificationRecommendations(
  projectDir: string,
  scaleDir: string,
  lang: 'zh' | 'en',
): AiOsVerificationRecommendation[] {
  const recommendations: AiOsVerificationRecommendation[] = []
  const seen = new Set<string>()
  const add = (recommendation: AiOsVerificationRecommendation) => {
    const key = `${recommendation.command}\n${recommendation.service ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    recommendations.push(recommendation)
  }

  try {
    const resolved = resolveVerificationTargets({ projectDir, scaleDir, service: 'all' })
    for (const target of resolved.targets) {
      for (const name of VERIFICATION_COMMAND_ORDER) {
        const command = target.config[name]
        if (!command) continue
        add({
          command,
          source: 'verification-profile',
          reason: verificationRecommendationReason(name, lang),
          profile: resolved.profileName,
          service: target.service?.name,
        })
      }
    }
  } catch (error) {
    add({
      command: 'scale verify --profile default',
      source: 'fallback',
      reason: `Verification profile could not be read for recommendations (${error instanceof Error ? error.message : String(error)}). Run the default verification profile before promotion.`,
    })
  }

  if (recommendations.length > 0) return recommendations

  for (const item of packageScriptVerificationCommands(projectDir)) {
    add({
      command: item.command,
      source: 'package-script',
      reason: verificationRecommendationReason(item.name, lang),
    })
  }

  if (recommendations.length > 0) return recommendations

  return [{
    command: 'scale preflight --preflight-profile quick --json',
    source: 'fallback',
    reason: lang === 'zh'
      ? '未找到验证矩阵或 package script，先运行 SCALE 快速预检生成基础验证证据。'
      : 'No verification matrix or package script was found; run SCALE quick preflight as baseline evidence.',
  }]
}

function packageScriptVerificationCommands(projectDir: string): Array<{ name: VerificationCommandName; command: string }> {
  const packageJsonPath = join(projectDir, 'package.json')
  if (!existsSync(packageJsonPath)) return []
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { scripts?: Record<string, string> }
    const scripts = parsed.scripts ?? {}
    const commands: Array<{ name: VerificationCommandName; command: string }> = []
    if (scripts.build) commands.push({ name: 'build', command: 'npm run build' })
    if (scripts.lint) commands.push({ name: 'lint', command: 'npm run lint' })
    if (scripts.test) commands.push({ name: 'test', command: 'npm test' })
    return commands
  } catch {
    return []
  }
}

function verificationRecommendationReason(name: VerificationCommandName, lang: 'zh' | 'en'): string {
  if (lang === 'zh') {
    if (name === 'build') return '构建验证可以证明代码仍可编译并生成发布产物。'
    if (name === 'lint') return 'Lint 验证可以捕获工程规范和静态质量问题。'
    if (name === 'test') return '测试验证可以证明核心行为没有回归。'
    if (name === 'smoke') return '冒烟验证可以证明关键产品路径仍可用。'
    return '覆盖率验证可以补充测试充分性证据。'
  }
  if (name === 'build') return 'Build verification proves the code still compiles and produces releasable artifacts.'
  if (name === 'lint') return 'Lint verification catches engineering-standard and static-quality issues.'
  if (name === 'test') return 'Test verification proves core behavior did not regress.'
  if (name === 'smoke') return 'Smoke verification proves critical product paths still work.'
  return 'Coverage verification adds evidence for test adequacy.'
}

function escapeCliDoubleQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function inspectBenchmarkReport(
  projectDir: string,
  scaleDir: string,
  maxAgeHours: number,
  warnings: string[],
): AiOsDoctorReport['benchmark'] {
  const reportPath = resolveBenchmarkReportPath(projectDir, scaleDir)
  if (!existsSync(reportPath)) return { status: 'missing', reportPath }
  try {
    const parsed = JSON.parse(readFileSync(reportPath, 'utf-8')) as Partial<AiOsBenchmarkReport>
    if (!parsed.generatedAt || !parsed.summary || typeof parsed.summary.scenarios !== 'number') {
      warnings.push(`Invalid AI OS benchmark report: ${reportPath}`)
      return { status: 'invalid', reportPath }
    }
    const generatedAtMs = Date.parse(parsed.generatedAt)
    const ageHours = Number(((Date.now() - generatedAtMs) / 3_600_000).toFixed(2))
    const fileAgeHours = Number(((Date.now() - statSync(reportPath).mtimeMs) / 3_600_000).toFixed(2))
    const effectiveAgeHours = Number.isFinite(ageHours) ? ageHours : fileAgeHours
    return {
      status: effectiveAgeHours <= maxAgeHours ? 'fresh' : 'stale',
      reportPath,
      generatedAt: parsed.generatedAt,
      ageHours: effectiveAgeHours,
      scenarios: parsed.summary.scenarios,
    }
  } catch (error) {
    warnings.push(`Unreadable AI OS benchmark report: ${reportPath} (${error instanceof Error ? error.message : String(error)})`)
    return { status: 'invalid', reportPath }
  }
}

function readAiOsBenchmarkReport(reportPath: string, warnings: string[]): AiOsBenchmarkReport | undefined {
  if (!existsSync(reportPath)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(reportPath, 'utf-8')) as AiOsBenchmarkReport
    if (!parsed || !parsed.summary || !Array.isArray(parsed.scenarios)) {
      warnings.push(`Ignored invalid AI OS benchmark report: ${reportPath}`)
      return undefined
    }
    return parsed
  } catch (error) {
    warnings.push(`Ignored unreadable AI OS benchmark report: ${reportPath} (${error instanceof Error ? error.message : String(error)})`)
    return undefined
  }
}

function summarizeBenchmarkDoctor(benchmark: AiOsDoctorReport['benchmark']): string {
  if (benchmark.status === 'missing') return 'No AI OS benchmark report found.'
  if (benchmark.status === 'invalid') return 'AI OS benchmark report is invalid or unreadable.'
  const age = benchmark.ageHours === undefined ? 'unknown age' : `${benchmark.ageHours}h old`
  return `${benchmark.scenarios ?? 0} benchmark scenario(s); ${age}; status ${benchmark.status}.`
}

function aiOsDoctorNextActions(input: {
  status: AiOsDoctorStatus
  checks: AiOsDoctorCheck[]
  dashboard: AiOsDashboardReport
  benchmark: AiOsDoctorReport['benchmark']
  lang: 'zh' | 'en'
}): string[] {
  if (input.lang === 'zh') return aiOsDoctorNextActionsZh(input)
  return aiOsDoctorNextActionsEn(input)
}

function aiOsDoctorNextActionsEn(input: {
  status: AiOsDoctorStatus
  checks: AiOsDoctorCheck[]
  dashboard: AiOsDashboardReport
  benchmark: AiOsDoctorReport['benchmark']
}): string[] {
  const actions: string[] = []
  if (input.checks.some(check => check.id === 'ai-os-runtime-dirs' && check.status === 'blocked')) {
    actions.push('Run `scale ai-os migrate --json` before using the AI OS beta runtime.')
  }
  if (input.dashboard.summary.totalRuns === 0) {
    actions.push('Run `scale ai-os run --dry-run --json` to create the first AI OS run report.')
  }
  if (input.dashboard.summary.blockedRuns > 0) {
    actions.push('Resolve blocked AI OS runs before claiming the project is ready.')
  }
  if (input.benchmark.status === 'missing' || input.benchmark.status === 'stale') {
    actions.push('Run `scale ai-os benchmark --json` before release or milestone review.')
  }
  if (input.status === 'ready') actions.push('AI OS beta runtime is ready for guarded project tasks.')
  return actions
}

function aiOsDoctorNextActionsZh(input: {
  status: AiOsDoctorStatus
  checks: AiOsDoctorCheck[]
  dashboard: AiOsDashboardReport
  benchmark: AiOsDoctorReport['benchmark']
}): string[] {
  const actions: string[] = []
  if (input.checks.some(check => check.id === 'ai-os-runtime-dirs' && check.status === 'blocked')) {
    actions.push('先运行 `scale ai-os migrate --json`，再接入 AI OS beta runtime。')
  }
  if (input.dashboard.summary.totalRuns === 0) {
    actions.push('运行 `scale ai-os run --dry-run --json` 生成第一份 AI OS 运行报告。')
  }
  if (input.dashboard.summary.blockedRuns > 0) {
    actions.push('先处理 blocked 的 AI OS run，再声明项目运行态就绪。')
  }
  if (input.benchmark.status === 'missing' || input.benchmark.status === 'stale') {
    actions.push('发版或阶段验收前运行 `scale ai-os benchmark --json`。')
  }
  if (input.status === 'ready') actions.push('AI OS beta runtime 已可用于 guarded 项目任务。')
  return actions
}

function writeAiOsBenchmarkReport(path: string, report: AiOsBenchmarkReport): void {
  const dir = dirname(path)
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(report, null, 2), 'utf-8')
}

function readAiOsRunReports(runsDir: string, warnings: string[]): AiOsRunReport[] {
  if (!existsSync(runsDir)) return []
  return readdirSync(runsDir)
    .filter(file => file.endsWith('.json'))
    .flatMap(file => {
      const path = join(runsDir, file)
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf-8')) as AiOsRunReport
        if (!parsed || !parsed.plan || !parsed.evidence || !parsed.verification) {
          warnings.push(`Ignored invalid AI OS run report: ${path}`)
          return []
        }
        return [parsed]
      } catch (error) {
        warnings.push(`Ignored unreadable AI OS run report: ${path} (${error instanceof Error ? error.message : String(error)})`)
        return []
      }
    })
}

function toDashboardRunSummary(report: AiOsRunReport): AiOsDashboardRunSummary {
  return {
    taskId: report.plan.task.taskId,
    task: report.plan.task.task,
    mode: report.mode,
    status: report.status,
    generatedAt: report.generatedAt,
    runReport: report.artifacts.runReport,
    verificationCommands: report.verification.commands.length,
    failedVerificationCommands: report.verification.commands.filter(command => command.status === 'failed').length,
    pendingEvidence: report.evidence.pending.length,
    failureLearningCandidates: report.failureLearning.candidates.length,
  }
}

function summarizeDashboardHealth(summary: AiOsDashboardReport['summary']): AiOsDashboardReport['health'] {
  if (summary.totalRuns === 0) {
    return { status: 'empty', score: 0, reasons: ['No AI OS run reports found.'] }
  }
  const reasons: string[] = []
  if (summary.blockedRuns > 0) reasons.push(`${summary.blockedRuns} blocked AI OS run(s).`)
  if (summary.failedVerificationCommands > 0) reasons.push(`${summary.failedVerificationCommands} failed guarded verification command(s).`)
  if (summary.failureLearningCandidates > 0) reasons.push(`${summary.failureLearningCandidates} failure learning candidate(s) need review.`)
  const score = Math.max(0, Math.round(((summary.readyRuns / summary.totalRuns) * 100) - (summary.failedVerificationCommands * 10) - (summary.failureLearningCandidates * 5)))
  if (summary.blockedRuns === summary.totalRuns) return { status: 'blocked', score, reasons }
  if (reasons.length > 0) return { status: 'attention', score, reasons }
  return { status: 'healthy', score: 100, reasons: ['All AI OS runs are ready.'] }
}

function dashboardRecommendations(summary: AiOsDashboardReport['summary']): string[] {
  const recommendations: string[] = []
  if (summary.totalRuns === 0) {
    recommendations.push('Run `scale ai-os run --dry-run` to create the first AI OS execution report.')
    return recommendations
  }
  if (summary.blockedRuns > 0) recommendations.push('Resolve blocked AI OS run reports before promoting lessons or shipping.')
  if (summary.failedVerificationCommands > 0) recommendations.push('Inspect failed guarded verification runtime evidence and fix the underlying command or code issue.')
  if (summary.failureLearningCandidates > 0) recommendations.push('Review failure learning candidates before turning them into durable rules.')
  if (summary.guardedRuns === 0) recommendations.push('Add guarded verification runs for at least one representative task to validate evidence flow.')
  return recommendations
}

function defaultBenchmarkScenarios(budget = 8_000): AiOsBenchmarkScenarioInput[] {
  return [
    {
      id: 'docs-governance',
      task: 'Update bilingual governance documentation and keep README, docs map, and strategy aligned',
      level: 'M',
      files: ['README.md', 'README.en.md', 'docs/README.md', 'docs/AI_ENGINEERING_OS_POSITIONING.md'],
      services: ['docs'],
      budget,
    },
    {
      id: 'security-code-change',
      task: 'Harden auth token handling and verify runtime evidence for a security-sensitive code change',
      level: 'L',
      files: ['src/auth/token.ts', 'src/runtime/AiOsRuntime.ts', 'tests/runtime/aiOsRuntime.test.ts'],
      services: ['runtime', 'security'],
      budget,
    },
    {
      id: 'browser-ui-flow',
      task: 'Verify a browser callback UI flow with screenshots, runtime evidence, and guarded workflow gates',
      level: 'L',
      files: ['src/ui/callback.tsx', 'tests/api/aiOsCli.test.ts'],
      services: ['ui', 'browser'],
      budget,
    },
  ]
}

function summarizeBenchmark(results: AiOsBenchmarkScenarioResult[]): AiOsBenchmarkReport['summary'] {
  const totalBudget = results.reduce((sum, result) => sum + result.metrics.budget, 0)
  const totalEstimatedTokens = results.reduce((sum, result) => sum + result.metrics.estimatedTokens, 0)
  return {
    scenarios: results.length,
    totalEstimatedTokens,
    totalBudget,
    totalEstimatedTokenSavings: results.reduce((sum, result) => sum + result.metrics.estimatedTokenSavings, 0),
    totalMemoryItems: results.reduce((sum, result) => sum + result.metrics.memoryItems, 0),
    totalSkillSteps: results.reduce((sum, result) => sum + result.metrics.skillSteps, 0),
    requiredSkillSteps: results.reduce((sum, result) => sum + result.metrics.requiredSkillSteps, 0),
    totalEvaluatorGates: results.reduce((sum, result) => sum + result.metrics.evaluatorGates, 0),
    totalToolStrategySteps: results.reduce((sum, result) => sum + result.metrics.toolStrategySteps, 0),
    totalToolStrategyCostUnits: results.reduce((sum, result) => sum + result.metrics.toolStrategyCostUnits, 0),
    totalEvolutionProposals: results.reduce((sum, result) => sum + result.metrics.evolutionProposals, 0),
    governanceModes: [...new Set(results.map(result => result.governanceMode))],
    workflowProfiles: [...new Set(results.map(result => result.workflowProfile))],
    averageTokenUtilization: totalBudget > 0 ? Number((totalEstimatedTokens / totalBudget).toFixed(4)) : 0,
  }
}

function benchmarkRecommendations(summary: AiOsBenchmarkReport['summary']): string[] {
  const recommendations = ['Use benchmark deltas in release notes only after comparing the same scenario set across versions.']
  if (summary.totalSkillSteps === 0) recommendations.push('Skill routing did not produce steps; inspect skill policy detection.')
  if (summary.totalEvaluatorGates === 0) recommendations.push('Evaluator intelligence did not require any critique gate; add reasoning-heavy benchmark scenarios before claiming evaluator coverage.')
  if (summary.totalToolStrategySteps === 0) recommendations.push('Tool strategy did not build a cost/retry/fallback graph; inspect skill execution plan coverage.')
  if (summary.averageTokenUtilization > 0.9) recommendations.push('Context utilization is high; lower budgets or improve relevance filtering before scaling.')
  if (!summary.governanceModes.includes('critical') && !summary.governanceModes.includes('expanded')) {
    recommendations.push('Add at least one high-risk benchmark scenario before claiming adaptive governance coverage.')
  }
  return recommendations
}

function createAdaptiveWorkflow(
  governance: ProgressiveGovernanceReport,
  skillPlan: SkillPlan,
  evaluator: AiOsEvaluatorIntelligence,
  toolStrategy: AiOsToolStrategyPlan,
): AiOsAdaptiveWorkflow {
  const routerResult = routeAdaptiveWorkflow({ governance, evaluator, toolStrategy })
  const gates = new Set<string>()
  gates.add('context-compiler')
  gates.add('memory-provider-recall')
  if (skillPlan.required || skillPlan.executionPlan.steps.length > 0) gates.add('skill-evidence')
  gates.add('runtime-evidence')
  if (routerResult.profile === 'strict' || routerResult.profile === 'critical') gates.add('impact-analysis')
  if (routerResult.profile === 'critical') gates.add('security-review')
  for (const gate of evaluator.gates) gates.add(gate.id)
  for (const override of routerResult.gateOverrides) gates.add(override.gateId)
  const requiredBehaviors = new Set(governance.requiredBehaviors)
  for (const constraint of routerResult.behavioralConstraints) {
    if (constraint.required) requiredBehaviors.add(constraint.description)
  }
  return {
    strategy: 'risk-adaptive-runtime-v1',
    profile: routerResult.profile,
    escalationReasons: routerResult.escalationReasons,
    mode: governance.effectiveMode,
    requiredBehaviors: Array.from(requiredBehaviors),
    gates: Array.from(gates),
    exitCriteria: routerResult.exitCriteria,
  }
}

function createEvaluatorIntelligence(input: {
  task: string
  files: string[]
  governance: ProgressiveGovernanceReport
  skillPlan: SkillPlan
}): AiOsEvaluatorIntelligence {
  const haystack = `${input.task} ${input.files.join(' ')} ${input.governance.signals.map(signal => signal.id).join(' ')}`.toLowerCase()
  const gates: AiOsEvaluatorGate[] = []
  const addGate = (gate: AiOsEvaluatorGate) => {
    if (gates.some(existing => existing.id === gate.id)) return
    gates.push(gate)
  }

  if (/architecture|architectural|design|strategy|boundary|refactor|runtime|platform|framework|架构|方案|设计|边界|平台/.test(haystack)) {
    addGate({
      id: 'architecture-critique',
      required: input.governance.effectiveMode !== 'minimal',
      reason: 'Architecture, runtime, platform, or design decisions need an explicit critique before implementation claims.',
      evidence: matchingEvidence(input.files, /architecture|runtime|framework|docs|readme|src/i),
    })
  }

  if (/root cause|diagnose|debug|failure|incident|postmortem|regression|blocked|根因|排查|故障|事故|回归/.test(haystack)) {
    addGate({
      id: 'root-cause-review',
      required: true,
      reason: 'Failure diagnosis or root-cause work needs an alternate hypothesis check before closing.',
      evidence: matchingEvidence(input.files, /test|runtime|debug|log|src|docs/i),
    })
  }

  if (input.governance.signals.some(signal => signal.id === 'critical-risk-domain' || signal.id === 'critical-file-path')) {
    addGate({
      id: 'security-threat-model',
      required: true,
      reason: 'Critical auth, data, production, or destructive risk requires threat-model review evidence.',
      evidence: input.governance.signals.flatMap(signal => signal.evidence).slice(0, 12),
    })
  }

  if (/release|publish|deploy|migration|rollback|version|changelog|npm|ci|发版|发布|部署|迁移|回滚/.test(haystack)) {
    addGate({
      id: 'release-readiness-review',
      required: true,
      reason: 'Release, deployment, migration, or rollback work needs readiness and rollback evidence.',
      evidence: matchingEvidence(input.files, /package|changelog|release|deploy|migration|workflow|github/i),
    })
  }

  const drivers = evaluatorUncertaintyDrivers(input, gates)
  const uncertaintyScore = evaluatorUncertaintyScore(input, gates, drivers)
  if (gates.length > 0 || uncertaintyScore >= 0.45) {
    addGate({
      id: 'uncertainty-decision-log',
      required: uncertaintyScore >= 0.45 || input.governance.effectiveMode === 'critical',
      reason: 'The agent must record uncertainty, rejected alternatives, and evidence gaps before completion.',
      evidence: drivers,
    })
  }

  const riskLevel: AiOsEvaluatorIntelligence['riskLevel'] = uncertaintyScore >= 0.7
    ? 'high'
    : uncertaintyScore >= 0.4 || gates.some(gate => gate.required) ? 'medium' : 'low'

  return {
    strategy: 'evaluator-intelligence-v1',
    required: gates.some(gate => gate.required),
    riskLevel,
    uncertainty: {
      score: uncertaintyScore,
      threshold: 0.45,
      drivers,
    },
    gates,
    recommendations: evaluatorRecommendations(gates, riskLevel),
  }
}

function createToolStrategyPlan(skillPlan: SkillPlan): AiOsToolStrategyPlan {
  const nodes = skillPlan.executionPlan.steps.map(step => {
    const risks = toolStepRisks(step.id, step.kind)
    return {
      id: `${step.kind}:${step.id}`,
      kind: step.kind,
      required: step.required,
      cost: {
        units: toolStepCostUnits(step.id, step.kind, step.required, risks),
        timeRisk: risks.timeRisk,
        sideEffectRisk: risks.sideEffectRisk,
      },
      retry: toolStepRetry(step.id, step.kind, risks),
      fallback: step.fallback,
      evidence: [step.evidenceRequired],
    }
  })
  const edges = buildToolStrategyEdges(nodes)
  const summary = {
    totalSteps: nodes.length,
    requiredSteps: nodes.filter(node => node.required).length,
    highRiskSteps: nodes.filter(node => node.cost.timeRisk === 'high' || node.cost.sideEffectRisk === 'high').length,
    estimatedCostUnits: nodes.reduce((sum, node) => sum + node.cost.units, 0),
    fallbackCoveredSteps: nodes.filter(node => node.fallback.trim().length > 0).length,
  }
  return {
    strategy: 'tool-strategy-v1',
    nodes,
    edges,
    summary,
    recommendations: toolStrategyRecommendations(summary),
  }
}

function createEvolutionShadowProposals(
  governance: ProgressiveGovernanceReport,
  evaluator: AiOsEvaluatorIntelligence,
): EvolutionShadowReport {
  const proposals: ShadowRuleProposal[] = []

  // Propose shadow rules from governance risk signals (escalated modes)
  for (const signal of governance.signals) {
    if (signal.mode === 'expanded' || signal.mode === 'critical') {
      proposals.push(proposeShadowRule({
        title: `Governance signal: ${signal.id}`,
        description: `Shadow rule from governance signal "${signal.id}" (mode=${signal.mode}). ${signal.reason}`,
        source: 'failure-learning',
        sourceEvidenceIds: signal.evidence.length > 0 ? signal.evidence : [signal.id],
        pattern: signal.id,
        enforcement: signal.mode === 'critical' ? 'hook' : 'prompt',
        rollback: `Remove shadow rule for governance signal "${signal.id}" if false positive rate exceeds threshold.`,
      }))
    }
  }

  // Propose shadow rules from high-risk evaluator gates
  for (const gate of evaluator.gates) {
    if (gate.required && (gate.id === 'security-threat-model' || gate.id === 'root-cause-review')) {
      proposals.push(proposeShadowRule({
        title: `Evaluator gate: ${gate.id}`,
        description: `Shadow rule from required evaluator gate "${gate.id}". ${gate.reason}`,
        source: 'lesson-extraction',
        sourceEvidenceIds: [gate.id],
        pattern: gate.id,
        enforcement: 'prompt',
        rollback: `Remove shadow rule for evaluator gate "${gate.id}" if it does not reduce defect recurrence.`,
      }))
    }
  }

  return buildEvolutionShadowReport(proposals)
}

function toolStepRisks(
  id: string,
  kind: SkillPlan['executionPlan']['steps'][number]['kind'],
): Pick<AiOsToolStrategyNode['cost'], 'timeRisk' | 'sideEffectRisk'> {
  const normalized = id.toLowerCase()
  if (/desktop|cua|deploy|publish|release|migration|rollback|delete|drop|external|cli/.test(normalized)) {
    return { timeRisk: 'high', sideEffectRisk: 'high' }
  }
  if (/browser|e2e|playwright|screenshot|visual|security|threat|audit/.test(normalized)) {
    return { timeRisk: 'medium', sideEffectRisk: kind === 'verification' ? 'medium' : 'low' }
  }
  if (kind === 'artifact') return { timeRisk: 'low', sideEffectRisk: 'low' }
  if (kind === 'verification') return { timeRisk: 'medium', sideEffectRisk: 'medium' }
  return { timeRisk: 'medium', sideEffectRisk: 'low' }
}

function toolStepCostUnits(
  id: string,
  kind: SkillPlan['executionPlan']['steps'][number]['kind'],
  required: boolean,
  risks: Pick<AiOsToolStrategyNode['cost'], 'timeRisk' | 'sideEffectRisk'>,
): number {
  let units = kind === 'artifact' ? 1 : kind === 'verification' ? 2 : 3
  if (required) units += 1
  if (risks.timeRisk === 'medium') units += 1
  if (risks.timeRisk === 'high') units += 2
  if (risks.sideEffectRisk === 'high') units += 2
  if (/browser|e2e|desktop|external|cli|security|audit/i.test(id)) units += 1
  return units
}

function toolStepRetry(
  id: string,
  kind: SkillPlan['executionPlan']['steps'][number]['kind'],
  risks: Pick<AiOsToolStrategyNode['cost'], 'timeRisk' | 'sideEffectRisk'>,
): AiOsToolStrategyNode['retry'] {
  if (risks.sideEffectRisk === 'high') return { maxAttempts: 1, backoff: 'manual-review' }
  if (kind === 'verification') return { maxAttempts: /browser|e2e|playwright|network/i.test(id) ? 2 : 1, backoff: 'linear' }
  if (kind === 'skill') return { maxAttempts: 1, backoff: 'manual-review' }
  return { maxAttempts: 1, backoff: 'none' }
}

function buildToolStrategyEdges(nodes: AiOsToolStrategyNode[]): AiOsToolStrategyEdge[] {
  const edges: AiOsToolStrategyEdge[] = []
  const skillNodes = nodes.filter(node => node.kind === 'skill')
  const artifactNodes = nodes.filter(node => node.kind === 'artifact')
  const verificationNodes = nodes.filter(node => node.kind === 'verification')
  for (const artifact of artifactNodes) {
    for (const skill of skillNodes.filter(node => node.required || artifact.required)) {
      edges.push({ from: skill.id, to: artifact.id, reason: 'Skill execution must leave artifact evidence when both are required or review-relevant.' })
    }
  }
  for (const verification of verificationNodes) {
    for (const artifact of artifactNodes.filter(node => node.required)) {
      edges.push({ from: artifact.id, to: verification.id, reason: 'Required artifacts should exist before verification evidence is accepted.' })
    }
  }
  return edges
}

function toolStrategyRecommendations(summary: AiOsToolStrategyPlan['summary']): string[] {
  if (summary.totalSteps === 0) return ['No tool strategy required; standard verification is enough for this task.']
  const recommendations = ['Execute required tool strategy nodes before claiming task completion.']
  if (summary.highRiskSteps > 0) recommendations.push('High-risk tool steps require manual review or explicit safe-mode evidence before retry.')
  if (summary.fallbackCoveredSteps < summary.totalSteps) recommendations.push('Fill fallback policy gaps before autonomous execution.')
  return recommendations
}

function matchingEvidence(files: string[], pattern: RegExp): string[] {
  return files.filter(file => pattern.test(file)).slice(0, 12)
}

function evaluatorUncertaintyDrivers(
  input: {
    task: string
    files: string[]
    governance: ProgressiveGovernanceReport
    skillPlan: SkillPlan
  },
  gates: AiOsEvaluatorGate[],
): string[] {
  const drivers = new Set<string>()
  if (input.governance.effectiveMode === 'critical') drivers.add('critical-governance-mode')
  if (input.governance.effectiveMode === 'expanded') drivers.add('expanded-governance-mode')
  if (input.files.length >= 6) drivers.add('wide-file-scope')
  if (input.skillPlan.executionPlan.steps.some(step => step.required)) drivers.add('required-skill-evidence')
  for (const gate of gates) drivers.add(gate.id)
  if (/unknown|uncertain|maybe|assume|guess|可能|不确定|假设/.test(input.task.toLowerCase())) drivers.add('explicit-uncertainty-language')
  return [...drivers]
}

function evaluatorUncertaintyScore(
  input: {
    files: string[]
    governance: ProgressiveGovernanceReport
    skillPlan: SkillPlan
  },
  gates: AiOsEvaluatorGate[],
  drivers: string[],
): number {
  let score = 0.15
  if (input.governance.effectiveMode === 'standard') score += 0.1
  if (input.governance.effectiveMode === 'expanded') score += 0.25
  if (input.governance.effectiveMode === 'critical') score += 0.4
  score += Math.min(0.2, input.files.length * 0.025)
  score += Math.min(0.2, gates.filter(gate => gate.required).length * 0.08)
  if (input.skillPlan.executionPlan.steps.some(step => step.required)) score += 0.08
  if (drivers.includes('explicit-uncertainty-language')) score += 0.12
  return roundMetric(clampUnit(score))
}

function evaluatorRecommendations(
  gates: AiOsEvaluatorGate[],
  riskLevel: AiOsEvaluatorIntelligence['riskLevel'],
): string[] {
  if (gates.length === 0) return ['No evaluator gate required; keep lightweight verification evidence for low-risk work.']
  const recommendations = ['Record evaluator evidence before promoting reasoning-heavy implementation or release claims.']
  if (riskLevel === 'high') recommendations.push('Require reviewer sign-off for uncertainty, rejected alternatives, and rollback or mitigation path.')
  if (gates.some(gate => gate.id === 'root-cause-review')) recommendations.push('List competing root-cause hypotheses and why each was accepted or rejected.')
  if (gates.some(gate => gate.id === 'security-threat-model')) recommendations.push('Attach threat model or security-review evidence before guarded completion.')
  return recommendations
}

function recommendations(options: {
  governance: ProgressiveGovernanceReport
  context: BudgetedContextPack
  memoryRecall: Awaited<ReturnType<typeof recallMemoryProviders>>
  skillPlan: SkillPlan
  evaluator: AiOsEvaluatorIntelligence
  toolStrategy: AiOsToolStrategyPlan
}): string[] {
  const output: string[] = []
  if (options.context.compiler?.estimatedTokenSavings) {
    output.push(`Keep context compiler active; estimated savings ${options.context.compiler.estimatedTokenSavings} tokens for this task pack.`)
  }
  if (options.memoryRecall.items.length === 0) {
    output.push('No memory recall result found; continue with local evidence and settle reusable knowledge after verification.')
  }
  if (options.skillPlan.executionPlan.steps.length > 0) {
    output.push(`Follow ${options.skillPlan.executionPlan.steps.length} skill routing step(s) and record evidence before ship.`)
  }
  if (options.governance.effectiveMode === 'critical') {
    output.push('Critical workflow mode requires security review and rollback or disable strategy.')
  }
  if (options.evaluator.required) {
    output.push(`Evaluator intelligence requires ${options.evaluator.gates.length} critique gate(s); record uncertainty and review evidence before promotion.`)
  }
  if (options.toolStrategy.summary.totalSteps > 0) {
    output.push(`Tool strategy planner created ${options.toolStrategy.summary.totalSteps} cost/retry/fallback node(s); execute required nodes with evidence.`)
  }
  return output
}

export async function buildCostRoiEstimate(projectDir?: string): Promise<string> {
  const { CostAnalyzer } = await import('./CostAnalyzer.js')
  const analyzer = new CostAnalyzer()
  const records = analyzer.loadRecords()
  const breakdown = analyzer.analyze(records)
  const suggestions = analyzer.suggestOptimizations(breakdown)

  const lines: string[] = [
    '\n--- ROI Estimate ---',
    `  Governance cost (est.): $${breakdown.total.cost.toFixed(2)}/month`,
    `  Estimated defect prevention value: $${(breakdown.total.cost * 50).toFixed(2)}/month`,
    `  Net estimated ROI: ${((breakdown.total.cost * 50 - breakdown.total.cost) / Math.max(0.01, breakdown.total.cost)).toFixed(0)}x`,
    `  Potential savings: $${suggestions.reduce((s, sug) => s + sug.estimatedMonthlySavings, 0).toFixed(2)}/month`,
  ]
  return lines.join('\n')
}

function normalizeSkillTaskLevel(value: unknown): SkillTaskLevel {
  const normalized = String(value ?? 'M').trim().toUpperCase()
  if (normalized === 'S' || normalized === 'M' || normalized === 'L' || normalized === 'CRITICAL') return normalized
  throw new Error(`Invalid task level "${String(value)}"; expected S, M, L, or CRITICAL.`)
}
