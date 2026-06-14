import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { GovernanceMetricsCalculator, type GovernanceMetrics } from '../cortex/GovernanceMetrics.js'
import { InstinctStore } from '../cortex/InstinctStore.js'
import { WorkflowEvalStore, type FailureReplayCategory, type FailureReplayRecord, type WorkflowEvalRun } from '../eval/WorkflowEval.js'
import {
  inspectMemoryProviders,
  type MemoryProviderRecallReport,
  type MemoryProviderStatusReport,
} from '../memory/MemoryProviders.js'
import { inspectWorkflowSkills, type SkillDoctorReport } from '../skills/SkillDoctor.js'
import { assessAgentLoopReadiness, type AgentLoopReadinessReport } from './AgentLoopReadiness.js'
import { ReleaseDeploymentLedger, type DoraDeploymentMetrics } from './ReleaseDeploymentLedger.js'
import { TaskMetricsStore, type TaskMetricSummary } from './TaskMetricsStore.js'
import { buildWorkflowEffectivenessSummary, scoreWorkflowEffectivenessReport } from './WorkflowEffectivenessScoring.js'
export { renderWorkflowEffectivenessReport } from './WorkflowEffectivenessRenderer.js'

export type EffectivenessEvidenceLevel = 'measured' | 'partial' | 'missing'
export type WorkflowEffectivenessGrade = 'A' | 'B' | 'C' | 'D' | 'unknown'

export interface EffectivenessMetric<T = number> {
  value: T | null
  evidence: EffectivenessEvidenceLevel
  source: string
  note?: string
}

export interface WorkflowEffectivenessReport {
  ok: boolean
  grade: WorkflowEffectivenessGrade
  score: number | null
  generatedAt: string
  projectDir: string
  scaleDir: string
  lookbackDays: number
  summary: {
    measuredSignals: number
    missingSignals: number
    strengths: string[]
    gaps: string[]
    recommendations: string[]
  }
  delivery: {
    firstPassVerificationRate: EffectivenessMetric
    averageFixIterations: EffectivenessMetric
    evalPassAt1Rate: EffectivenessMetric
    evalPassAt3Rate: EffectivenessMetric
    deploymentFrequency: EffectivenessMetric
    leadTimeForChanges: EffectivenessMetric
  }
  stability: {
    gatePassRate: EffectivenessMetric
    gateFailRate: EffectivenessMetric
    changeFailureProxy: EffectivenessMetric
    restoreTime: EffectivenessMetric
    openFailureReplays: EffectivenessMetric
  }
  hallucination: {
    evalHallucinatedFactFailures: EffectivenessMetric
    humanCorrectionRate: EffectivenessMetric
    evidenceBackedGateRuns: EffectivenessMetric
  }
  longTask: {
    trackedTasks: EffectivenessMetric
    artifactCompletenessRate: EffectivenessMetric
    residualRiskClarityRate: EffectivenessMetric
    reworkRate: EffectivenessMetric
  }
  memory: {
    availableProviders: EffectivenessMetric
    defaultExternalProviderAvailable: EffectivenessMetric<boolean>
    providerReadinessRate: EffectivenessMetric
    fallbackRisk: EffectivenessMetric<boolean>
    providerRecallHitRate: EffectivenessMetric
    providerRecallItems: EffectivenessMetric
    providerContextSavings: EffectivenessMetric
  }
  skills: {
    installedWorkflowSkills: EffectivenessMetric
    requiredMissingSkills: EffectivenessMetric<string[]>
    recommendedMissingSkills: EffectivenessMetric<string[]>
  }
  orchestration: {
    instinctHitRate: EffectivenessMetric
    autoFixSuccessRate: EffectivenessMetric
    gateEscapeProxy: EffectivenessMetric
  }
  agentLoop: AgentLoopReadinessReport['metrics'] & {
    status: AgentLoopReadinessReport['status']
    score: number
  }
  latestEvalRun?: {
    id: string
    suiteId: string
    generatedAt: string
    ok: boolean
  }
}

export interface WorkflowEffectivenessOptions {
  projectDir?: string
  scaleDir?: string
  lookbackDays?: number
  now?: Date
  deps?: {
    governanceMetrics?: GovernanceMetrics
    memoryProviders?: MemoryProviderStatusReport
    memoryRecall?: MemoryProviderRecallReport | null
    skillDoctor?: SkillDoctorReport
  }
}

export function createWorkflowEffectivenessReport(
  options: WorkflowEffectivenessOptions = {},
): WorkflowEffectivenessReport {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const scaleDir = resolveScaleDir(projectDir, options.scaleDir ?? '.scale')
  const lookbackDays = normalizeLookbackDays(options.lookbackDays)
  const generatedAt = (options.now ?? new Date()).toISOString()

  const taskStore = new TaskMetricsStore(scaleDir)
  const taskRecords = taskStore.list().filter(record => withinLookback(record.date, lookbackDays, options.now))
  const taskSummary = summarizeTaskRecords(taskRecords, taskStore.summarize())
  const evalStore = new WorkflowEvalStore({ projectDir, scaleDir })
  const latestEval = latestWorkflowEvalRun(evalStore.runsDir)
  const failures = evalStore.listFailures({ sinceDays: lookbackDays })
  const hasFailureReplayEvidence = existsSync(evalStore.failuresDir)
  const openFailures = failures.filter(failure => failure.status === 'open')
  const governance = options.deps?.governanceMetrics
    ?? new GovernanceMetricsCalculator(scaleDir).compute(new InstinctStore(join(scaleDir, 'instincts')).loadAll(), lookbackDays)
  const memoryProviders = options.deps?.memoryProviders
    ?? inspectMemoryProviders({ projectDir, scaleDir })
  const skillDoctor = options.deps?.skillDoctor
    ?? inspectWorkflowSkills({ projectDir })
  const deploymentMetrics = new ReleaseDeploymentLedger(scaleDir).summarize({ lookbackDays, now: options.now })
  const agentLoop = assessAgentLoopReadiness({
    projectDir,
    scaleDir,
    lookbackDays,
    now: options.now,
    memoryRecallItems: options.deps?.memoryRecall?.items.length,
  })

  const report: WorkflowEffectivenessReport = {
    ok: false,
    grade: 'unknown',
    score: null,
    generatedAt,
    projectDir,
    scaleDir,
    lookbackDays,
    summary: {
      measuredSignals: 0,
      missingSignals: 0,
      strengths: [],
      gaps: [],
      recommendations: [],
    },
    delivery: buildDeliveryMetrics(taskSummary, latestEval, deploymentMetrics),
    stability: buildStabilityMetrics(governance, latestEval, openFailures.length, hasFailureReplayEvidence, deploymentMetrics),
    hallucination: buildHallucinationMetrics(latestEval, failures, governance, hasFailureReplayEvidence),
    longTask: buildLongTaskMetrics(taskRecords.length, taskSummary),
    memory: buildMemoryMetrics(memoryProviders, options.deps?.memoryRecall ?? null),
    skills: buildSkillMetrics(skillDoctor),
    orchestration: buildOrchestrationMetrics(governance, latestEval, openFailures.length),
    agentLoop: {
      ...agentLoop.metrics,
      status: agentLoop.status,
      score: agentLoop.score,
    },
    latestEvalRun: latestEval ? {
      id: latestEval.id,
      suiteId: latestEval.suiteId,
      generatedAt: latestEval.generatedAt,
      ok: latestEval.ok,
    } : undefined,
  }

  const scored = scoreWorkflowEffectivenessReport(report)
  report.score = scored.score
  report.grade = scored.grade
  report.summary = buildWorkflowEffectivenessSummary(report)
  report.ok = scored.score !== null && scored.score >= 70 && report.summary.missingSignals <= 4
  return report
}

function buildDeliveryMetrics(
  taskSummary: TaskMetricSummary,
  latestEval: WorkflowEvalRun | null,
  deploymentMetrics: DoraDeploymentMetrics,
): WorkflowEffectivenessReport['delivery'] {
  const hasDeploymentEvidence = deploymentMetrics.hasEvidence
  return {
    firstPassVerificationRate: measuredIf(taskSummary.total > 0, taskSummary.firstPassRate, '.scale/metrics/tasks.jsonl'),
    averageFixIterations: measuredIf(taskSummary.total > 0, round(taskSummary.averageFixIterations), '.scale/metrics/tasks.jsonl'),
    evalPassAt1Rate: measuredIf(Boolean(latestEval), latestEval?.metrics.passAt1Rate ?? 0, '.scale/evals/runs/*.json'),
    evalPassAt3Rate: measuredIf(Boolean(latestEval), latestEval?.metrics.passAt3Rate ?? 0, '.scale/evals/runs/*.json'),
    deploymentFrequency: hasDeploymentEvidence
      ? measured(deploymentMetrics.deploymentFrequencyPerDay, deploymentMetrics.source, 'successful deployments per day')
      : missing('No deployment event ledger is wired to workflow metrics yet.', 'release/deploy evidence'),
    leadTimeForChanges: buildLeadTimeMetric(deploymentMetrics),
  }
}

function buildLeadTimeMetric(deploymentMetrics: DoraDeploymentMetrics): EffectivenessMetric {
  if (!deploymentMetrics.hasEvidence) {
    return missing('No commit-to-release timestamp pair is wired to workflow metrics yet.', 'git/release evidence')
  }
  if (deploymentMetrics.leadTimeHours !== null) {
    return measured(deploymentMetrics.leadTimeHours, deploymentMetrics.source, 'average commit-to-deploy lead time in hours')
  }
  return missing('Deployment ledger exists, but no commitTimestamp/completedAt pairs were recorded.', deploymentMetrics.source)
}

function buildStabilityMetrics(
  governance: GovernanceMetrics,
  latestEval: WorkflowEvalRun | null,
  openFailureReplayCount: number,
  hasFailureReplayEvidence: boolean,
  deploymentMetrics: DoraDeploymentMetrics,
): WorkflowEffectivenessReport['stability'] {
  const hasGateRuns = governance.gates.totalRuns > 0
  const evalChangeFailureProxy = latestEval
    ? latestEval.metrics.failed / Math.max(latestEval.metrics.total, 1)
    : null
  const changeFailureProxy = deploymentMetrics.changeFailureRate !== null
    ? measured(deploymentMetrics.changeFailureRate, deploymentMetrics.source, 'failed or rolled-back deployments divided by all deployment records')
    : measuredIf(evalChangeFailureProxy !== null, evalChangeFailureProxy ?? 0, '.scale/evals/runs/*.json')
  const restoreTime = buildRestoreTimeMetric(deploymentMetrics)
  return {
    gatePassRate: measuredIf(hasGateRuns, governance.gates.passRate, '.scale/observations + gate evidence'),
    gateFailRate: measuredIf(hasGateRuns, governance.gates.failRate, '.scale/observations + gate evidence'),
    changeFailureProxy,
    restoreTime,
    openFailureReplays: measuredIf(hasFailureReplayEvidence, openFailureReplayCount, '.scale/evals/failures/*.json'),
  }
}

function buildRestoreTimeMetric(deploymentMetrics: DoraDeploymentMetrics): EffectivenessMetric {
  if (!deploymentMetrics.hasEvidence) {
    return missing('No failed-deployment recovery timestamp is wired to workflow metrics yet.', 'incident/recovery evidence')
  }
  if (deploymentMetrics.failedDeploymentCount === 0) {
    return measured(0, deploymentMetrics.source, 'no failed deployment record in period')
  }
  if (deploymentMetrics.restoreTimeHours !== null) {
    return measured(deploymentMetrics.restoreTimeHours, deploymentMetrics.source, 'average failed-deployment recovery time in hours')
  }
  return partial<number>(null, deploymentMetrics.source, 'Failed deployment records exist, but restoredAt is missing.')
}

function buildHallucinationMetrics(
  latestEval: WorkflowEvalRun | null,
  failures: FailureReplayRecord[],
  governance: GovernanceMetrics,
  hasFailureReplayEvidence: boolean,
): WorkflowEffectivenessReport['hallucination'] {
  const hallucinatedFacts = countFailureCategory(failures, 'hallucinated-project-fact')
  const humanCorrections = latestEval?.metrics.humanCorrections ?? null
  const totalEvalCases = latestEval?.metrics.total ?? 0
  return {
    evalHallucinatedFactFailures: measuredIf(hasFailureReplayEvidence, hallucinatedFacts, '.scale/evals/failures/*.json'),
    humanCorrectionRate: measuredIf(
      Boolean(latestEval) && totalEvalCases > 0,
      humanCorrections === null ? 0 : humanCorrections / totalEvalCases,
      '.scale/evals/runs/*.json',
    ),
    evidenceBackedGateRuns: measuredIf(governance.gates.totalRuns > 0, governance.gates.totalRuns, '.scale/observations + gate evidence'),
  }
}

function buildLongTaskMetrics(
  trackedTasks: number,
  taskSummary: TaskMetricSummary,
): WorkflowEffectivenessReport['longTask'] {
  return {
    trackedTasks: measured(trackedTasks, '.scale/metrics/tasks.jsonl'),
    artifactCompletenessRate: measuredIf(trackedTasks > 0, taskSummary.artifactCompletenessRate, '.scale/metrics/tasks.jsonl'),
    residualRiskClarityRate: measuredIf(trackedTasks > 0, taskSummary.residualRiskClarityRate, '.scale/metrics/tasks.jsonl'),
    reworkRate: measuredIf(
      trackedTasks > 0,
      1 - taskSummary.firstPassRate,
      '.scale/metrics/tasks.jsonl',
    ),
  }
}

function buildMemoryMetrics(
  memoryProviders: MemoryProviderStatusReport,
  memoryRecall?: MemoryProviderRecallReport | null,
): WorkflowEffectivenessReport['memory'] {
  const providers = memoryProviders.providers.filter(provider => provider.enabled)
  const available = providers.filter(provider => provider.available)
  const gbrainProvider = memoryProviders.routing.defaultOrder
    .map(id => memoryProviders.providers.find(provider => provider.id === id))
    .find(provider => provider?.id === 'gbrain')
  const gbrainAvailable = Boolean(gbrainProvider?.available)
  const recallMetrics = buildMemoryRecallMetrics(memoryRecall)
  return {
    availableProviders: measured(memoryProviders.availableProviderCount, '.scale/memory-providers.json + provider doctor'),
    defaultExternalProviderAvailable: measured(gbrainAvailable, '.scale/memory-providers.json + provider doctor'),
    providerReadinessRate: measuredIf(providers.length > 0, available.length / providers.length, '.scale/memory-providers.json + provider doctor'),
    fallbackRisk: measuredIf(providers.length > 0, !gbrainAvailable, '.scale/memory-providers.json + provider doctor'),
    providerRecallHitRate: recallMetrics.hitRate,
    providerRecallItems: recallMetrics.items,
    providerContextSavings: recallMetrics.contextSavings,
  }
}

function buildMemoryRecallMetrics(memoryRecall?: MemoryProviderRecallReport | null): {
  hitRate: EffectivenessMetric
  items: EffectivenessMetric
  contextSavings: EffectivenessMetric
} {
  const source = 'scale memory provider recall'
  if (!memoryRecall) {
    return {
      hitRate: missing('No provider recall probe was recorded; provider availability does not prove useful knowledge retrieval.', source),
      items: missing('No provider recall probe was recorded.', source),
      contextSavings: missing('No provider recall probe was recorded.', source),
    }
  }

  const availableIds = new Set(
    memoryRecall.providerStatuses
      .filter(provider => provider.enabled && provider.available)
      .map(provider => provider.id),
  )
  const eligibleIds = memoryRecall.providerOrder.filter(id => availableIds.has(id))
  const selectedEligibleIds = new Set(memoryRecall.selectedProviders.filter(id => availableIds.has(id)))
  const note = memoryRecallNote(memoryRecall)
  const hitRate = eligibleIds.length > 0
    ? measured(round(selectedEligibleIds.size / eligibleIds.length), source, note)
    : missing('Recall probe ran, but no available memory provider was eligible.', source)

  return {
    hitRate,
    items: measured(memoryRecall.items.length, source, note),
    contextSavings: measured(memoryRecall.contextSavings.reduction, source, note),
  }
}

function memoryRecallNote(memoryRecall: MemoryProviderRecallReport): string {
  const warnings = memoryRecall.warnings.length > 0
    ? `; warnings=${memoryRecall.warnings.slice(0, 2).join('; ')}`
    : ''
  return [
    `query="${memoryRecall.query}"`,
    `selected=${memoryRecall.selectedProviders.join(',') || 'none'}`,
    `items=${memoryRecall.items.length}`,
  ].join('; ') + warnings
}

function buildSkillMetrics(skillDoctor: SkillDoctorReport): WorkflowEffectivenessReport['skills'] {
  return {
    installedWorkflowSkills: measuredIf(skillDoctor.total > 0, skillDoctor.installed / skillDoctor.total, 'workflow skill catalog'),
    requiredMissingSkills: measuredIf(skillDoctor.total > 0, skillDoctor.missingByReadiness.required, 'workflow skill catalog'),
    recommendedMissingSkills: measuredIf(skillDoctor.total > 0, skillDoctor.missingByReadiness.recommended, 'workflow skill catalog'),
  }
}

function buildOrchestrationMetrics(
  governance: GovernanceMetrics,
  latestEval: WorkflowEvalRun | null,
  openFailureReplayCount: number,
): WorkflowEffectivenessReport['orchestration'] {
  const evalFailures = latestEval?.metrics.failureReplayCount ?? 0
  const gateRuns = governance.gates.totalRuns
  return {
    instinctHitRate: buildInstinctHitRateMetric(governance),
    autoFixSuccessRate: measuredIf(governance.autoFix.totalAttempts > 0, governance.autoFix.successRate, '.scale/observations + .scale/events'),
    gateEscapeProxy: measuredIf(
      Boolean(latestEval) || gateRuns > 0 || openFailureReplayCount > 0,
      (evalFailures + openFailureReplayCount) / Math.max(gateRuns + evalFailures + openFailureReplayCount, 1),
      '.scale/evals + gate evidence',
    ),
  }
}

function buildInstinctHitRateMetric(governance: GovernanceMetrics): EffectivenessMetric {
  const runtimeEvidence = governance.instincts.runtimeEvidence
  if (
    runtimeEvidence?.source === 'session-and-audit' ||
    runtimeEvidence?.source === 'session' ||
    runtimeEvidence?.source === 'audit'
  ) {
    return measured(
      governance.instincts.hitRate,
      runtimeEvidence.source === 'session-and-audit'
        ? '.scale/events/sessions + .scale/instincts/.audit.jsonl'
        : runtimeEvidence.source === 'session'
          ? '.scale/events/sessions'
          : '.scale/instincts/.audit.jsonl',
      `${runtimeEvidence.successfulApplications}/${Math.max(runtimeEvidence.injectionEvents, runtimeEvidence.applicationEvents)} applied instinct outcomes`,
    )
  }
  if (runtimeEvidence?.source === 'legacy' || (!runtimeEvidence && governance.instincts.totalInjected > 0)) {
    return partial(
      governance.instincts.hitRate,
      '.scale/instincts',
      'Only legacy instinct counters are available; no runtime session injection evidence was found.',
    )
  }
  return missing('No runtime session injection or applied-instinct audit evidence found.', '.scale/events/sessions + .scale/instincts/.audit.jsonl')
}

function latestWorkflowEvalRun(runsDir: string): WorkflowEvalRun | null {
  if (!existsSync(runsDir)) return null
  const runs = readdirSync(runsDir)
    .filter(file => file.endsWith('.json'))
    .map(file => readJson<WorkflowEvalRun>(join(runsDir, file)))
    .filter((run): run is WorkflowEvalRun => Boolean(run?.metrics && run.generatedAt))
    .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))
  return runs[0] ?? null
}

function summarizeTaskRecords(records: ReturnType<TaskMetricsStore['list']>, fallback: TaskMetricSummary): TaskMetricSummary {
  if (records.length === 0) return { total: 0, firstPassRate: 0, averageFixIterations: 0, artifactCompletenessRate: 0, residualRiskClarityRate: 0 }
  if (records.length === fallback.total) return fallback
  return {
    total: records.length,
    firstPassRate: ratio(records.filter(record => record.firstVerificationPass).length, records.length),
    averageFixIterations: records.reduce((sum, record) => sum + record.fixIterations, 0) / records.length,
    artifactCompletenessRate: ratio(records.filter(record => record.artifactComplete).length, records.length),
    residualRiskClarityRate: ratio(records.filter(record => record.residualRisk.trim().length > 0).length, records.length),
  }
}

function measured<T>(value: T, source: string, note?: string): EffectivenessMetric<T> {
  return { value, evidence: 'measured', source, note }
}

function partial<T>(value: T | null, source: string, note?: string): EffectivenessMetric<T> {
  return { value, evidence: 'partial', source, note }
}

function measuredIf<T>(condition: boolean, value: T, source: string, note?: string): EffectivenessMetric<T> {
  return condition ? measured(value, source, note) : missing(note ?? 'No evidence found for this signal.', source)
}

function missing<T = number>(note: string, source: string): EffectivenessMetric<T> {
  return { value: null, evidence: 'missing', source, note }
}

function countFailureCategory(failures: FailureReplayRecord[], category: FailureReplayCategory): number {
  return failures.filter(failure => failure.category === category).length
}

function withinLookback(date: string, days: number, now?: Date): boolean {
  const timestamp = Date.parse(date)
  if (!Number.isFinite(timestamp)) return false
  const end = now?.getTime() ?? Date.now()
  return timestamp >= end - days * 24 * 60 * 60 * 1000 && timestamp <= end + 24 * 60 * 60 * 1000
}

function resolveScaleDir(projectDir: string, scaleDir: string): string {
  return isAbsolute(scaleDir) ? scaleDir : resolve(projectDir, scaleDir)
}

function normalizeLookbackDays(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? 30), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 30
  return Math.min(parsed, 365)
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return null
  }
}

function ratio(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 1000) / 1000
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
