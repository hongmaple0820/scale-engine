import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import {
  RuntimeEvidenceLedger,
  type RuntimeEvidenceRecord,
} from '../runtime/RuntimeEvidenceLedger.js'

export type AgentLoopReadinessStatus = 'ready' | 'warning' | 'missing'
export type AgentLoopEvidenceLevel = 'measured' | 'partial' | 'missing'

export interface AgentLoopMetric<T = number> {
  value: T | null
  evidence: AgentLoopEvidenceLevel
  source: string
  note?: string
}

export interface AgentLoopReadinessReport {
  status: AgentLoopReadinessStatus
  score: number
  summary: {
    readySignals: number
    warningSignals: number
    missingSignals: number
    evidence: string[]
    recommendations: string[]
  }
  metrics: {
    toolExecutionEvidence: AgentLoopMetric<boolean>
    loopRecoveryRate: AgentLoopMetric
    guardrailCoverage: AgentLoopMetric
    budgetControlEvidence: AgentLoopMetric<boolean>
    handoffOrDelegationEvidence: AgentLoopMetric<boolean>
    terminationEvidence: AgentLoopMetric<boolean>
  }
}

export interface AgentLoopReadinessOptions {
  projectDir?: string
  scaleDir?: string
  lookbackDays?: number
  now?: Date
  runReports?: AgentLoopRunReport[]
  memoryRecallItems?: number
}

export interface AgentLoopRunReport {
  generatedAt?: string
  mode?: string
  status?: string
  dryRun?: boolean
  plan?: {
    task?: {
      taskId?: string
      task?: string
      level?: string
    }
    adaptiveWorkflow?: {
      gates?: string[]
      profile?: string
    }
    evaluator?: {
      gates?: Array<{ id?: string; required?: boolean }>
    }
    toolStrategy?: {
      nodes?: Array<{ id?: string; kind?: string; fallback?: string; evidence?: string[] }>
      summary?: {
        totalSteps?: number
        requiredSteps?: number
        highRiskSteps?: number
        estimatedCostUnits?: number
        fallbackCoveredSteps?: number
      }
    }
    skillPlan?: {
      executionPlan?: {
        steps?: Array<{ id?: string; kind?: string; required?: boolean }>
      }
    }
  }
  steps?: Array<{ id?: string; kind?: string; status?: string; required?: boolean }>
  evidence?: {
    produced?: string[]
    pending?: string[]
  }
  verification?: {
    commands?: Array<{ status?: string; evidenceId?: string }>
    allPassed?: boolean
  }
  artifacts?: {
    runReport?: string
  }
}

interface GateEvidenceLike {
  id?: string
  gate?: string
  status?: string
  passed?: boolean
  evidence?: string
  evidenceItems?: Array<{
    label?: string
    path?: string
    detail?: string
  }>
  blockers?: string[]
  createdAt?: number
}

interface ReviewEvidenceLike {
  id?: string
  reviewMode?: string
  passed?: boolean
  createdAt?: number
}

export function assessAgentLoopReadiness(
  options: AgentLoopReadinessOptions = {},
): AgentLoopReadinessReport {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const scaleDir = resolveScaleDir(projectDir, options.scaleDir ?? '.scale')
  const lookbackDays = normalizeLookbackDays(options.lookbackDays)
  const now = options.now ?? new Date()
  const gateRecords = readGateEvidence(projectDir, scaleDir, lookbackDays, now)
  const reviewRecords = readReviewEvidence(scaleDir, lookbackDays, now)
  const runtimeRecords = new RuntimeEvidenceLedger({ projectDir, scaleDir, createDirs: false })
    .list({ limit: Number.MAX_SAFE_INTEGER })
    .filter(record => withinLookback(record.createdAt, lookbackDays, now))
  const runtimeSummary = summarizeRuntimeRecords(runtimeRecords)
  const runReports = (options.runReports ?? readRunReports(scaleDir))
    .filter(report => withinLookback(report.generatedAt, lookbackDays, now))

  const metrics: AgentLoopReadinessReport['metrics'] = {
    toolExecutionEvidence: buildToolExecutionMetric(runtimeRecords, runReports),
    loopRecoveryRate: buildLoopRecoveryMetric(runtimeSummary, runReports),
    guardrailCoverage: buildGuardrailCoverageMetric(gateRecords, runReports),
    budgetControlEvidence: buildBudgetControlMetric(runReports),
    handoffOrDelegationEvidence: buildDelegationMetric(reviewRecords, runtimeRecords, runReports),
    terminationEvidence: buildTerminationMetric(gateRecords, runtimeRecords, runReports),
  }
  const values = Object.values(metrics)
  const readySignals = values.filter(metric => isReadyMetric(metric)).length
  const missingSignals = values.filter(metric => metric.evidence === 'missing').length
  const warningSignals = values.length - readySignals - missingSignals
  const score = Math.round((readySignals / values.length) * 100)
  const evidence = [
    ...values
      .filter(metric => metric.evidence !== 'missing')
      .map(metric => metric.source),
  ]
  const recommendations = buildRecommendations(metrics)
  return {
    status: readySignals === values.length ? 'ready' : readySignals === 0 ? 'missing' : 'warning',
    score,
    summary: {
      readySignals,
      warningSignals,
      missingSignals,
      evidence: [...new Set(evidence)],
      recommendations,
    },
    metrics,
  }
}

function buildToolExecutionMetric(
  runtimeRecords: RuntimeEvidenceRecord[],
  runReports: AgentLoopRunReport[],
): AgentLoopMetric<boolean> {
  const runtimeToolRecords = runtimeRecords.filter(record =>
    ['command', 'tool', 'skill', 'mcp', 'browser', 'desktop'].includes(record.kind),
  )
  const strategySteps = runReports.reduce((sum, report) => sum + toolStrategyStepCount(report), 0)
  const skillSteps = runReports.reduce((sum, report) => sum + skillStepCount(report), 0)
  const total = runtimeToolRecords.length + strategySteps + skillSteps
  if (total === 0) {
    return missing('No command, tool, skill, MCP, browser, desktop, or AI OS tool-strategy evidence found.', '.scale/evidence/runtime + .scale/ai-os/runs')
  }
  return measured(true, '.scale/evidence/runtime + .scale/ai-os/runs', `${total} tool execution/planning evidence item(s).`)
}

function buildLoopRecoveryMetric(
  runtimeSummary: RuntimeEvidenceSummaryLike,
  runReports: AgentLoopRunReport[],
): AgentLoopMetric {
  const runtimeFailureCandidates = runtimeSummary.failed + runtimeSummary.resolvedFailed
  const failedRunCommands = runReports.reduce((sum, report) => {
    const commands = report.verification?.commands ?? []
    return sum + commands.filter(command => command.status === 'failed').length
  }, 0)
  const blockedRuns = runReports.filter(report => report.status === 'blocked').length
  const candidates = runtimeFailureCandidates + failedRunCommands + blockedRuns
  if (runtimeSummary.total === 0 && runReports.length === 0) {
    return missing('No runtime or AI OS run evidence exists to prove feedback/recovery behavior.', '.scale/evidence/runtime + .scale/ai-os/runs')
  }
  if (candidates === 0) {
    return measured(1, '.scale/evidence/runtime + .scale/ai-os/runs', 'No unresolved runtime or guarded-run failure evidence in the current window.')
  }
  const recovered = runtimeSummary.resolvedFailed
  return measured(roundRatio(recovered, candidates), '.scale/evidence/runtime + .scale/ai-os/runs', `${recovered}/${candidates} failed loop candidate(s) recovered or superseded.`)
}

function buildGuardrailCoverageMetric(
  gateRecords: GateEvidenceLike[],
  runReports: AgentLoopRunReport[],
): AgentLoopMetric {
  const guardrailGates = gateRecords.filter(record => isGuardrailGate(record.gate))
  if (guardrailGates.length > 0) {
    const historicalPassed = guardrailGates.filter(record => isPassedGateEvidence(record)).length
    const latestByGate = latestGateEvidenceByGate(guardrailGates)
    const latestPassed = latestByGate.filter(record => isPassedGateEvidence(record)).length
    return measured(
      roundRatio(latestPassed, latestByGate.length),
      '.scale/evidence',
      `Latest ${latestPassed}/${latestByGate.length} guardrail gate state(s) passed; historical ${historicalPassed}/${guardrailGates.length} record(s) passed.`,
    )
  }

  const aiOsGuardrails = runReports.flatMap(report => [
    ...(report.plan?.adaptiveWorkflow?.gates ?? []),
    ...(report.plan?.evaluator?.gates ?? []).map(gate => gate.id ?? ''),
  ]).filter(gate => isGuardrailGate(gate) || isReasoningGuardrail(gate))
  if (aiOsGuardrails.length > 0) {
    return measured(1, '.scale/ai-os/runs', `${aiOsGuardrails.length} AI OS evaluator/adaptive guardrail reference(s).`)
  }
  return missing('No G7/G11/security/boundary guardrail evidence was found.', '.scale/evidence + .scale/ai-os/runs')
}

function buildBudgetControlMetric(runReports: AgentLoopRunReport[]): AgentLoopMetric<boolean> {
  const boundedRuns = runReports.filter(report => {
    const totalSteps = toolStrategyStepCount(report)
    const cost = report.plan?.toolStrategy?.summary?.estimatedCostUnits
    const fallbackCovered = report.plan?.toolStrategy?.summary?.fallbackCoveredSteps
    return totalSteps > 0 && typeof cost === 'number' && Number.isFinite(cost) && typeof fallbackCovered === 'number'
  })
  if (boundedRuns.length === 0) {
    return missing('No AI OS tool strategy with total step count, estimated cost, and fallback coverage was found.', '.scale/ai-os/runs')
  }
  return measured(true, '.scale/ai-os/runs', `${boundedRuns.length} AI OS run(s) include step, cost, and fallback controls.`)
}

function buildDelegationMetric(
  reviewRecords: ReviewEvidenceLike[],
  runtimeRecords: RuntimeEvidenceRecord[],
  runReports: AgentLoopRunReport[],
): AgentLoopMetric<boolean> {
  const reviewDelegations = reviewRecords.filter(record => record.reviewMode === 'fresh-subagent' || record.reviewMode === 'hybrid')
  const runtimeDelegations = runtimeRecords.filter(record => {
    const haystack = `${record.kind} ${record.title} ${record.summary} ${JSON.stringify(record.metadata ?? {})}`.toLowerCase()
    return haystack.includes('subagent') || haystack.includes('handoff') || haystack.includes('delegat')
  })
  const aiOsDelegations = runReports.reduce((sum, report) => sum + delegatedStepCount(report), 0)
  const total = reviewDelegations.length + runtimeDelegations.length + aiOsDelegations
  if (total === 0) {
    return missing('No fresh-subagent, hybrid review, handoff, or delegated skill evidence found.', '.scale/reviews + .scale/evidence/runtime + .scale/ai-os/runs')
  }
  return measured(true, '.scale/reviews + .scale/evidence/runtime + .scale/ai-os/runs', `${total} delegation/handoff evidence item(s).`)
}

function buildTerminationMetric(
  gateRecords: GateEvidenceLike[],
  runtimeRecords: RuntimeEvidenceRecord[],
  runReports: AgentLoopRunReport[],
): AgentLoopMetric<boolean> {
  const completedRuns = runReports.filter(report =>
    report.status === 'ready' || report.verification?.allPassed === true || (report.evidence?.pending ?? []).length === 0,
  )
  const finalRuntime = runtimeRecords.filter(record => record.kind === 'final-report' && record.status === 'passed')
  const verifyGatePasses = gateRecords.filter(record => {
    const text = `${record.gate ?? ''} ${record.evidence ?? ''}`.toLowerCase()
    return (record.passed || record.status === 'passed') && (
      ['g3', 'g8', 'g11'].includes(String(record.gate ?? '').toLowerCase())
      || text.includes('verify')
      || text.includes('ship')
      || text.includes('status')
    )
  })
  const total = completedRuns.length + finalRuntime.length + verifyGatePasses.length
  if (total === 0) {
    return missing('No completed verify/ship/status or final-report evidence found.', '.scale/evidence + .scale/evidence/runtime + .scale/ai-os/runs')
  }
  return measured(true, '.scale/evidence + .scale/evidence/runtime + .scale/ai-os/runs', `${total} termination evidence item(s).`)
}

interface RuntimeEvidenceSummaryLike {
  total: number
  failed: number
  resolvedFailed: number
}

function summarizeRuntimeRecords(records: RuntimeEvidenceRecord[]): RuntimeEvidenceSummaryLike {
  const passedKeys = new Set<string>()
  const failedCandidates: RuntimeEvidenceRecord[] = []
  let resolvedFailed = 0
  for (const record of records) {
    const key = runtimeResolutionKey(record)
    if (record.status === 'passed' && key) {
      passedKeys.add(key)
      continue
    }
    if (record.status !== 'failed' || isExpectedRedEvidence(record)) continue
    if (isResolvedEvidence(record) || key && passedKeys.has(key)) {
      resolvedFailed += 1
      continue
    }
    failedCandidates.push(record)
  }
  return {
    total: records.length,
    failed: failedCandidates.length,
    resolvedFailed,
  }
}

function readGateEvidence(projectDir: string, scaleDir: string, lookbackDays: number, now: Date): GateEvidenceLike[] {
  const dir = join(scaleDir, 'evidence')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(file => file.endsWith('.json'))
    .map(file => readJson<GateEvidenceLike>(join(dir, file)))
    .filter((record): record is GateEvidenceLike => Boolean(record?.gate))
    .filter(record => withinLookback(record.createdAt, lookbackDays, now))
    .filter(record => !isStaleSecurityFindingRecord(projectDir, record))
}

function readReviewEvidence(scaleDir: string, lookbackDays: number, now: Date): ReviewEvidenceLike[] {
  const dir = join(scaleDir, 'reviews')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(file => file.endsWith('.json'))
    .map(file => readJson<ReviewEvidenceLike>(join(dir, file)))
    .filter((record): record is ReviewEvidenceLike => Boolean(record))
    .filter(record => withinLookback(record.createdAt, lookbackDays, now))
}

function readRunReports(scaleDir: string): AgentLoopRunReport[] {
  const dir = join(scaleDir, 'ai-os', 'runs')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(file => file.endsWith('.json'))
    .map(file => readJson<AgentLoopRunReport>(join(dir, file)))
    .filter((report): report is AgentLoopRunReport => Boolean(report?.plan))
}

function toolStrategyStepCount(report: AgentLoopRunReport): number {
  const fromSummary = report.plan?.toolStrategy?.summary?.totalSteps
  if (typeof fromSummary === 'number' && Number.isFinite(fromSummary)) return fromSummary
  return report.plan?.toolStrategy?.nodes?.length ?? 0
}

function skillStepCount(report: AgentLoopRunReport): number {
  return report.plan?.skillPlan?.executionPlan?.steps?.length ?? 0
}

function delegatedStepCount(report: AgentLoopRunReport): number {
  const skillSteps = report.plan?.skillPlan?.executionPlan?.steps ?? []
  const strategyNodes = report.plan?.toolStrategy?.nodes ?? []
  const runSteps = report.steps ?? []
  return [
    ...skillSteps.map(step => `${step.kind ?? ''} ${step.id ?? ''}`),
    ...strategyNodes.map(step => `${step.kind ?? ''} ${step.id ?? ''}`),
    ...runSteps.map(step => `${step.kind ?? ''} ${step.id ?? ''}`),
  ].filter(value => {
    const normalized = value.toLowerCase()
    return normalized.includes('skill') || normalized.includes('agent') || normalized.includes('mcp') || normalized.includes('delegate')
  }).length
}

function isGuardrailGate(gate: unknown): boolean {
  const normalized = String(gate ?? '').toUpperCase()
  return normalized === 'G7' || normalized === 'G11'
}

function latestGateEvidenceByGate(records: GateEvidenceLike[]): GateEvidenceLike[] {
  const latest = new Map<string, GateEvidenceLike>()
  for (const record of records) {
    const gate = String(record.gate ?? '').toUpperCase()
    const existing = latest.get(gate)
    if (!existing || gateEvidenceTimestamp(record) >= gateEvidenceTimestamp(existing)) {
      latest.set(gate, record)
    }
  }
  return [...latest.values()]
}

function gateEvidenceTimestamp(record: GateEvidenceLike): number {
  return typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : 0
}

function isPassedGateEvidence(record: GateEvidenceLike): boolean {
  return record.passed === true || String(record.status ?? '').toLowerCase() === 'passed'
}

function isReasoningGuardrail(gate: unknown): boolean {
  const normalized = String(gate ?? '').toLowerCase()
  return normalized.includes('security')
    || normalized.includes('boundary')
    || normalized.includes('guardrail')
    || normalized.includes('uncertainty')
    || normalized.includes('release-readiness')
}

function isStaleSecurityFindingRecord(projectDir: string, record: GateEvidenceLike): boolean {
  const findings = (record.evidenceItems ?? []).filter(item =>
    typeof item.label === 'string' &&
    item.label.startsWith('Security finding ') &&
    typeof item.path === 'string' &&
    typeof item.detail === 'string',
  )
  if (findings.length === 0) return false
  return findings.every(item => {
    const path = item.path ?? ''
    const evidence = extractSecurityEvidence(item.detail ?? '')
    if (!evidence) return false
    const filePath = resolve(projectDir, path)
    if (!existsSync(filePath)) return true
    try {
      return !readFileSync(filePath, 'utf-8').includes(evidence)
    } catch {
      return true
    }
  })
}

function extractSecurityEvidence(detail: string): string | null {
  const marker = '; '
  const index = detail.indexOf(marker)
  if (index < 0) return null
  const evidence = detail.slice(index + marker.length).trim()
  return evidence.length > 0 ? evidence : null
}

function buildRecommendations(metrics: AgentLoopReadinessReport['metrics']): string[] {
  const recommendations: string[] = []
  if (metrics.toolExecutionEvidence.evidence === 'missing') {
    recommendations.push('Record command/tool/skill runtime evidence before claiming agent-loop execution ability.')
  }
  if (metrics.loopRecoveryRate.evidence === 'missing') {
    recommendations.push('Run at least one guarded AI OS or runtime-evidence task so loop recovery can be measured.')
  } else if ((metrics.loopRecoveryRate.value ?? 1) < 1) {
    recommendations.push('Resolve failed runtime evidence with matching passed evidence before promotion.')
  }
  if (metrics.guardrailCoverage.evidence === 'missing') {
    recommendations.push('Record G7/G11 or AI OS evaluator guardrail evidence for boundary and security checks.')
  } else if ((metrics.guardrailCoverage.value ?? 1) < 1) {
    recommendations.push('Inspect failed or blocked G7/G11 guardrail evidence and close boundary/security findings before release promotion.')
  }
  if (metrics.budgetControlEvidence.evidence === 'missing') {
    recommendations.push('Use AI OS tool strategy evidence to prove bounded steps, cost, and fallback coverage.')
  }
  if (metrics.handoffOrDelegationEvidence.evidence === 'missing') {
    recommendations.push('Record fresh-subagent, hybrid review, or delegated skill evidence for handoff/delegation coverage.')
  }
  if (metrics.terminationEvidence.evidence === 'missing') {
    recommendations.push('Record verify/ship/status completion evidence so loops have a visible stop condition.')
  }
  return [...new Set(recommendations)]
}

function isReadyMetric(metric: AgentLoopMetric<unknown>): boolean {
  if (metric.evidence === 'missing' || metric.value === null) return false
  if (typeof metric.value === 'boolean') return metric.value
  return Number(metric.value) >= 1
}

function measured<T>(value: T, source: string, note?: string): AgentLoopMetric<T> {
  return { value, evidence: 'measured', source, note }
}

function missing<T = number>(note: string, source: string): AgentLoopMetric<T> {
  return { value: null, evidence: 'missing', source, note }
}

function withinLookback(value: string | number | undefined, days: number, now: Date): boolean {
  if (!value) return false
  const timestamp = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(timestamp)) return false
  return timestamp >= now.getTime() - days * 24 * 60 * 60 * 1000 && timestamp <= now.getTime() + 24 * 60 * 60 * 1000
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

function isExpectedRedEvidence(record: RuntimeEvidenceRecord): boolean {
  const metadata = record.metadata ?? {}
  return metadata.expectedRed === true || metadata.expectedFailure === true
}

function isResolvedEvidence(record: RuntimeEvidenceRecord): boolean {
  const metadata = record.metadata ?? {}
  return metadata.resolved === true || metadata.superseded === true || typeof metadata.resolvedBy === 'string'
}

function runtimeResolutionKey(record: RuntimeEvidenceRecord): string | null {
  const metadata = record.metadata ?? {}
  const metadataKey = firstString(
    metadata.resolutionKey,
    metadata.stepId,
    metadata.gate,
    metadata.checkId,
    metadata.scenario,
    metadata.phase,
  )
  const itemKey = metadataKey ?? normalizeEvidenceKey(record.command) ?? normalizeEvidenceKey(record.title)
  if (!itemKey) return null
  return [
    record.taskId ?? '',
    record.sessionId ?? '',
    record.kind,
    itemKey,
  ].join('\u001f')
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return undefined
}

function normalizeEvidenceKey(value?: string): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, ' ').toLowerCase()
  return normalized && normalized.length > 0 ? normalized : undefined
}

function roundRatio(part: number, total: number): number {
  return total === 0 ? 0 : Number((part / total).toFixed(3))
}
