import type {
  EffectivenessMetric,
  WorkflowEffectivenessGrade,
  WorkflowEffectivenessReport,
} from './WorkflowEffectiveness.js'

const SCORE_WEIGHTS = {
  delivery: 25,
  stability: 25,
  memory: 15,
  skills: 15,
  hallucination: 10,
  orchestration: 10,
}

export function scoreWorkflowEffectivenessReport(
  report: WorkflowEffectivenessReport,
): { score: number | null; grade: WorkflowEffectivenessGrade } {
  const sections = [
    scoreAverage([
      report.delivery.firstPassVerificationRate,
      report.delivery.evalPassAt1Rate,
      doraDeploymentFrequencyMetric(report.delivery.deploymentFrequency),
      doraLeadTimeMetric(report.delivery.leadTimeForChanges),
      invertMetric(report.delivery.averageFixIterations, 3),
    ], SCORE_WEIGHTS.delivery),
    scoreAverage([
      report.stability.gatePassRate,
      invertMetric(report.stability.changeFailureProxy, 1),
      doraRestoreTimeMetric(report.stability.restoreTime),
      invertMetric(report.stability.openFailureReplays, 5),
    ], SCORE_WEIGHTS.stability),
    scoreAverage([
      report.memory.providerReadinessRate,
      booleanMetric(report.memory.defaultExternalProviderAvailable),
      invertBooleanMetric(report.memory.fallbackRisk),
      report.memory.providerRecallHitRate,
    ], SCORE_WEIGHTS.memory),
    scoreAverage([
      report.skills.installedWorkflowSkills,
      emptyListMetric(report.skills.requiredMissingSkills),
      emptyListMetric(report.skills.recommendedMissingSkills),
    ], SCORE_WEIGHTS.skills),
    scoreAverage([
      invertMetric(report.hallucination.evalHallucinatedFactFailures, 3),
      invertMetric(report.hallucination.humanCorrectionRate, 1),
    ], SCORE_WEIGHTS.hallucination),
    scoreAverage([
      report.orchestration.instinctHitRate,
      report.orchestration.autoFixSuccessRate,
      invertMetric(report.orchestration.gateEscapeProxy, 1),
    ], SCORE_WEIGHTS.orchestration),
  ].filter((value): value is number => value !== null)

  if (sections.length === 0) return { score: null, grade: 'unknown' }
  const score = Math.round(sections.reduce((sum, value) => sum + value, 0))
  return { score, grade: gradeForScore(score) }
}

export function buildWorkflowEffectivenessSummary(
  report: WorkflowEffectivenessReport,
): WorkflowEffectivenessReport['summary'] {
  const metrics = collectMetrics(report)
  const measuredSignals = metrics.filter(metric => metric.evidence !== 'missing').length
  const missingSignals = metrics.filter(metric => metric.evidence === 'missing').length
  const strengths: string[] = []
  const gaps: string[] = []
  const recommendations: string[] = []

  if ((report.stability.gatePassRate.value ?? 0) >= 0.8) strengths.push('Gate evidence shows a strong pass rate.')
  if ((report.memory.availableProviders.value ?? 0) >= 2) strengths.push('Multiple memory providers are available.')
  if ((report.memory.providerRecallItems.value ?? 0) > 0) strengths.push('Memory recall returned provider-backed context.')
  if ((report.skills.requiredMissingSkills.value ?? []).length === 0) strengths.push('Required workflow skills are installed.')
  if ((report.delivery.evalPassAt1Rate.value ?? 0) >= 0.8) strengths.push('Workflow eval Pass@1 is strong.')
  if (report.agentLoop.status === 'ready') strengths.push('Agent Loop readiness has evidence for execution, recovery, guardrails, budget, delegation, and termination.')

  if (report.delivery.deploymentFrequency.evidence === 'missing') {
    gaps.push('DORA deployment frequency is not measured.')
    recommendations.push('Record release/deploy events so deployment frequency and lead time become measured signals.')
  }
  if (report.delivery.leadTimeForChanges.evidence === 'missing') {
    gaps.push('DORA lead time for changes is not measured.')
    recommendations.push('Record commit timestamp and deploy completion timestamp for release events.')
  }
  if (report.stability.restoreTime.evidence === 'missing') {
    gaps.push('DORA recovery time is not measured.')
    recommendations.push('Add failed-release recovery timestamps or incident close evidence.')
  }
  if (report.stability.restoreTime.evidence === 'partial') {
    gaps.push('DORA recovery time has failed deployments without restoredAt evidence.')
    recommendations.push('Close failed deployment records with restoredAt once recovery is verified.')
  }
  if ((report.memory.defaultExternalProviderAvailable.value ?? false) === false) {
    gaps.push('Default external memory provider is not available.')
    recommendations.push('Keep gbrain project-local health checked in setup and preflight.')
  }
  if (report.memory.providerRecallHitRate.evidence === 'missing') {
    gaps.push('Memory recall quality is not measured.')
    recommendations.push('Run workflow effectiveness with provider recall enabled so memory availability is checked against real retrieved context.')
  } else if ((report.memory.availableProviders.value ?? 0) > 0 && (report.memory.providerRecallItems.value ?? 0) === 0) {
    gaps.push('Memory providers are available, but recall probe returned no provider-backed items.')
    recommendations.push('Seed or rehearse gbrain with reviewed workflow lessons, then keep provider rehearsal in the verification path.')
  }
  const recommendedMissing = report.skills.recommendedMissingSkills.value ?? []
  if (recommendedMissing.length > 0) {
    gaps.push(`Recommended workflow skills missing: ${recommendedMissing.join(', ')}.`)
    recommendations.push('Install or explicitly waive recommended workflow skills for the repo profile.')
  }
  if (report.orchestration.instinctHitRate.evidence === 'missing') {
    gaps.push('Instinct hit rate is not yet measured from applied runtime evidence.')
    recommendations.push('Record applied instinct evidence during verify/ship so Cortex learning has an outcome metric.')
  }
  if (report.orchestration.instinctHitRate.evidence === 'partial') {
    gaps.push('Instinct hit rate only has legacy counters, not runtime session evidence.')
    recommendations.push('Start runtime sessions with Cortex metadata and record applied instinct outcomes to prove learning effectiveness.')
  }
  if (report.agentLoop.status !== 'ready') {
    gaps.push(`Agent Loop readiness is ${report.agentLoop.status}.`)
    recommendations.push(...agentLoopRecommendations(report))
  }

  return {
    measuredSignals,
    missingSignals,
    strengths,
    gaps,
    recommendations: [...new Set(recommendations)],
  }
}

function scoreAverage(metrics: EffectivenessMetric[], weight: number): number | null {
  const values = metrics
    .filter(metric => metric.evidence !== 'missing' && metric.value !== null)
    .map(metric => clamp(Number(metric.value), 0, 1))
  if (values.length === 0) return null
  return (values.reduce((sum, value) => sum + value, 0) / values.length) * weight
}

function collectMetrics(report: WorkflowEffectivenessReport): EffectivenessMetric[] {
  return [
    ...Object.values(report.delivery),
    ...Object.values(report.stability),
    ...Object.values(report.hallucination),
    ...Object.values(report.longTask),
    ...Object.values(report.memory),
    ...Object.values(report.skills),
    ...Object.values(report.orchestration),
    report.agentLoop.toolExecutionEvidence,
    report.agentLoop.loopRecoveryRate,
    report.agentLoop.guardrailCoverage,
    report.agentLoop.budgetControlEvidence,
    report.agentLoop.handoffOrDelegationEvidence,
    report.agentLoop.terminationEvidence,
  ] as EffectivenessMetric[]
}

function agentLoopRecommendations(report: WorkflowEffectivenessReport): string[] {
  const recommendations: string[] = []
  if (report.agentLoop.toolExecutionEvidence.evidence === 'missing') {
    recommendations.push('Record command/tool/skill runtime evidence before claiming agent-loop execution ability.')
  }
  if (report.agentLoop.loopRecoveryRate.evidence === 'missing') {
    recommendations.push('Run at least one guarded AI OS or runtime-evidence task so loop recovery can be measured.')
  }
  if (report.agentLoop.guardrailCoverage.evidence === 'missing') {
    recommendations.push('Record G7/G11 or AI OS evaluator guardrail evidence for boundary and security checks.')
  } else if ((report.agentLoop.guardrailCoverage.value ?? 1) < 1) {
    recommendations.push('Inspect failed or blocked G7/G11 guardrail evidence and close boundary/security findings before release promotion.')
  }
  if (report.agentLoop.budgetControlEvidence.evidence === 'missing') {
    recommendations.push('Use AI OS tool strategy evidence to prove bounded steps, cost, and fallback coverage.')
  }
  if (report.agentLoop.handoffOrDelegationEvidence.evidence === 'missing') {
    recommendations.push('Record fresh-subagent, hybrid review, or delegated skill evidence for handoff/delegation coverage.')
  }
  if (report.agentLoop.terminationEvidence.evidence === 'missing') {
    recommendations.push('Record verify/ship/status completion evidence so loops have a visible stop condition.')
  }
  return recommendations
}

function invertMetric(metric: EffectivenessMetric, max: number): EffectivenessMetric {
  if (metric.evidence === 'missing' || metric.value === null) return metric
  return { ...metric, value: 1 - clamp(Number(metric.value) / max, 0, 1) }
}

function booleanMetric(metric: EffectivenessMetric<boolean>): EffectivenessMetric {
  if (metric.evidence === 'missing' || metric.value === null) {
    return { ...metric, value: null }
  }
  return { ...metric, value: metric.value ? 1 : 0 }
}

function invertBooleanMetric(metric: EffectivenessMetric<boolean>): EffectivenessMetric {
  if (metric.evidence === 'missing' || metric.value === null) {
    return { ...metric, value: null }
  }
  return { ...metric, value: metric.value ? 0 : 1 }
}

function emptyListMetric(metric: EffectivenessMetric<string[]>): EffectivenessMetric {
  if (metric.evidence === 'missing' || metric.value === null) {
    return { ...metric, value: null }
  }
  return { ...metric, value: metric.value.length === 0 ? 1 : 0 }
}

function doraDeploymentFrequencyMetric(metric: EffectivenessMetric): EffectivenessMetric {
  if (metric.evidence === 'missing' || metric.value === null) return metric
  const value = Number(metric.value)
  if (value >= 1) return { ...metric, value: 1 }
  if (value >= 1 / 7) return { ...metric, value: 0.8 }
  if (value >= 1 / 30) return { ...metric, value: 0.6 }
  if (value > 0) return { ...metric, value: 0.35 }
  return { ...metric, value: 0 }
}

function doraLeadTimeMetric(metric: EffectivenessMetric): EffectivenessMetric {
  return doraDurationMetric(metric, 'lead')
}

function doraRestoreTimeMetric(metric: EffectivenessMetric): EffectivenessMetric {
  return doraDurationMetric(metric, 'restore')
}

function doraDurationMetric(metric: EffectivenessMetric, kind: 'lead' | 'restore'): EffectivenessMetric {
  if (metric.evidence === 'missing' || metric.value === null) return metric
  const hours = Number(metric.value)
  if (hours <= 1) return { ...metric, value: 1 }
  if (hours <= 24) return { ...metric, value: 0.8 }
  if (hours <= 168) return { ...metric, value: 0.6 }
  if (hours <= 720) return { ...metric, value: 0.35 }
  return { ...metric, value: kind === 'restore' ? 0 : 0.15 }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function gradeForScore(score: number): WorkflowEffectivenessGrade {
  if (score >= 85) return 'A'
  if (score >= 70) return 'B'
  if (score >= 55) return 'C'
  return 'D'
}
