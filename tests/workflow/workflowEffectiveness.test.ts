import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GovernanceMetrics } from '../../src/cortex/GovernanceMetrics.js'
import type { Instinct } from '../../src/cortex/InstinctExtractor.js'
import { InstinctStore } from '../../src/cortex/InstinctStore.js'
import type { FailureReplayRecord, WorkflowEvalRun } from '../../src/eval/WorkflowEval.js'
import type { MemoryProviderRecallReport, MemoryProviderStatusReport } from '../../src/memory/MemoryProviders.js'
import type { SkillDoctorReport } from '../../src/skills/SkillDoctor.js'
import { RuntimeEvidenceLedger } from '../../src/runtime/RuntimeEvidenceLedger.js'
import {
  createWorkflowEffectivenessReport,
  renderWorkflowEffectivenessReport,
} from '../../src/workflow/WorkflowEffectiveness.js'
import { ReleaseDeploymentLedger } from '../../src/workflow/ReleaseDeploymentLedger.js'
import type { TaskMetricRecord } from '../../src/workflow/TaskMetricsStore.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

describe('WorkflowEffectiveness', () => {
  it('marks unproven signals as missing instead of inflating readiness', () => {
    const projectDir = makeProject()
    const report = createWorkflowEffectivenessReport({
      projectDir,
      now: new Date('2026-06-13T00:00:00.000Z'),
      deps: {
        governanceMetrics: emptyGovernanceMetrics(),
        memoryProviders: memoryReport(projectDir, []),
        skillDoctor: skillReport({ total: 0, installed: 0 }),
      },
    })

    expect(report.ok).toBe(false)
    expect(report.summary.missingSignals).toBeGreaterThan(8)
    expect(report.delivery.deploymentFrequency.evidence).toBe('missing')
    expect(report.stability.gatePassRate.evidence).toBe('missing')
    expect(report.hallucination.evalHallucinatedFactFailures.evidence).toBe('missing')
    expect(report.skills.requiredMissingSkills.evidence).toBe('missing')
    expect(report.agentLoop.status).toBe('missing')
    expect(report.agentLoop.toolExecutionEvidence.evidence).toBe('missing')
  })

  it('aggregates gate, eval, task, memory, and skill evidence into a scored report', () => {
    const projectDir = makeProject()
    const scaleDir = join(projectDir, '.scale')
    writeTaskMetric(scaleDir, {
      date: '2026-06-12',
      taskId: 'TASK-1',
      taskName: 'workflow effectiveness',
      level: 'L',
      services: ['scale-engine'],
      filesChanged: 5,
      firstVerificationPass: true,
      fixIterations: 0,
      reworkNeeded: false,
      artifactComplete: true,
      residualRisk: 'DORA deployment metrics still missing',
      finalGateStatus: 'passed',
    })
    writeEvalRun(scaleDir, {
      id: 'EVAL-1',
      suiteId: 'workflow-baseline',
      generatedAt: '2026-06-12T10:00:00.000Z',
      projectDir,
      ok: false,
      failureReplayIds: ['FAIL-1'],
      metrics: {
        total: 2,
        passed: 1,
        failed: 1,
        passAt1: 1,
        passAt3: 2,
        passAt1Rate: 0.5,
        passAt3Rate: 1,
        averageFixIterations: 0.5,
        totalToolCalls: 4,
        estimatedTokens: 1200,
        humanCorrections: 1,
        failureReplayCount: 1,
      },
      cases: [],
    })
    writeFailure(scaleDir, {
      id: 'FAIL-1',
      taskId: 'TASK-1',
      suiteId: 'workflow-baseline',
      caseId: 'case-1',
      generatedAt: new Date().toISOString(),
      category: 'hallucinated-project-fact',
      phase: 'verify',
      task: 'prove hallucination failure tracking',
      wrongTurn: 'claimed project fact without evidence',
      evidence: 'eval failure',
      correction: 'require evidence path',
      prevention: 'run workflow effectiveness',
      status: 'open',
      redactionApplied: false,
    })

    const report = createWorkflowEffectivenessReport({
      projectDir,
      now: new Date('2026-06-13T00:00:00.000Z'),
      deps: {
        governanceMetrics: governanceMetricsWithRuns(),
        memoryProviders: memoryReport(projectDir, ['gbrain']),
        memoryRecall: memoryRecallReport(projectDir, {
          selectedProviders: ['gbrain'],
          itemCount: 1,
        }),
        skillDoctor: skillReport({
          total: 3,
          installed: 2,
          missingRecommended: ['pr-creator'],
        }),
      },
    })

    expect(report.latestEvalRun?.id).toBe('EVAL-1')
    expect(report.delivery.firstPassVerificationRate.value).toBe(1)
    expect(report.delivery.evalPassAt1Rate.value).toBe(0.5)
    expect(report.stability.gatePassRate.value).toBe(0.9)
    expect(report.hallucination.evalHallucinatedFactFailures.value).toBe(1)
    expect(report.memory.availableProviders.value).toBe(1)
    expect(report.memory.defaultExternalProviderAvailable.value).toBe(true)
    expect(report.memory.providerRecallHitRate.value).toBe(1)
    expect(report.memory.providerRecallItems.value).toBe(1)
    expect(report.skills.recommendedMissingSkills.value).toEqual(['pr-creator'])
    expect(report.summary.gaps).toEqual(expect.arrayContaining([
      'DORA deployment frequency is not measured.',
      'DORA recovery time is not measured.',
      'Recommended workflow skills missing: pr-creator.',
    ]))
    expect(report.score).toEqual(expect.any(Number))

    const rendered = renderWorkflowEffectivenessReport(report)
    expect(rendered).toContain('SCALE Workflow Effectiveness Report')
    expect(rendered).toContain('Eval Pass@1: 50.0%')
    expect(rendered).toContain('Provider recall items: 1')
    expect(rendered).toContain('Missing recommended skills: pr-creator')
    expect(rendered).toContain('Agent Loop')
  })

  it('reports Agent Loop readiness from runtime recovery, guardrails, budget, delegation, and termination without changing the weighted score', () => {
    const projectDir = makeProject()
    const scaleDir = join(projectDir, '.scale')
    const deps = {
      governanceMetrics: governanceMetricsWithRuns(),
      memoryProviders: memoryReport(projectDir, ['gbrain']),
      memoryRecall: memoryRecallReport(projectDir, {
        selectedProviders: ['gbrain'],
        itemCount: 1,
      }),
      skillDoctor: skillReport({ total: 3, installed: 3 }),
    }
    const before = createWorkflowEffectivenessReport({
      projectDir,
      now: new Date('2026-06-13T00:00:00.000Z'),
      deps,
    })
    const ledger = new RuntimeEvidenceLedger({
      projectDir,
      now: (() => {
        const times = [
          '2026-06-12T00:00:00.000Z',
          '2026-06-12T00:01:00.000Z',
        ]
        return () => new Date(times.shift() ?? '2026-06-12T00:02:00.000Z')
      })(),
    })
    ledger.record({
      taskId: 'TASK-LOOP',
      sessionId: 'SESSION-LOOP',
      kind: 'command',
      title: 'verify command',
      status: 'failed',
      exitCode: 1,
      summary: 'first verification failed',
      metadata: { stepId: 'verify-command:1' },
    })
    ledger.record({
      taskId: 'TASK-LOOP',
      sessionId: 'SESSION-LOOP',
      kind: 'command',
      title: 'verify command',
      status: 'passed',
      exitCode: 0,
      summary: 'verification passed after fix',
      metadata: { stepId: 'verify-command:1' },
    })
    writeGateEvidence(scaleDir, {
      id: 'GATE-G7-READY',
      gate: 'G7',
      status: 'passed',
      passed: true,
      evidence: 'boundary guardrail passed',
      blockers: [],
      createdAt: Date.parse('2026-06-12T00:03:00.000Z'),
    })
    writeReview(scaleDir, {
      id: 'REVIEW-FRESH',
      reviewMode: 'fresh-subagent',
      passed: true,
      createdAt: Date.parse('2026-06-12T00:04:00.000Z'),
    })
    writeAiOsRun(scaleDir)

    const after = createWorkflowEffectivenessReport({
      projectDir,
      now: new Date('2026-06-13T00:00:00.000Z'),
      deps,
    })

    expect(after.score).toBe(before.score)
    expect(after.agentLoop.status).toBe('ready')
    expect(after.agentLoop.loopRecoveryRate.value).toBe(1)
    expect(after.agentLoop.guardrailCoverage.value).toBe(1)
    expect(after.agentLoop.budgetControlEvidence.value).toBe(true)
    expect(after.agentLoop.handoffOrDelegationEvidence.value).toBe(true)
    expect(after.agentLoop.terminationEvidence.value).toBe(true)
    expect(after.summary.gaps).not.toContain('Agent Loop readiness is warning.')
  })

  it('ignores stale security gate evidence when the flagged source snippet no longer exists', () => {
    const projectDir = makeProject()
    const scaleDir = join(projectDir, '.scale')
    mkdirSync(join(projectDir, 'src'), { recursive: true })
    writeFileSync(join(projectDir, 'src', 'index.ts'), 'export const value = process.env.SAFE_VALUE ?? "fallback"\n', 'utf-8')
    writeGateEvidence(scaleDir, {
      id: 'GATE-G7-STALE',
      gate: 'G7',
      status: 'FAILED',
      passed: false,
      evidence: 'stale security failure',
      evidenceItems: [{
        label: 'Security finding secret.assignment',
        path: 'src/index.ts',
        detail: 'CRITICAL line 1: Hardcoded credential or token assignment; const apiKey = "abc123456789"',
      }],
      blockers: ['CRITICAL secret.assignment in src/index.ts:1'],
      createdAt: Date.parse('2026-06-12T00:03:00.000Z'),
    })
    writeAiOsRun(scaleDir)

    const report = createWorkflowEffectivenessReport({
      projectDir,
      now: new Date('2026-06-13T00:00:00.000Z'),
      deps: {
        governanceMetrics: governanceMetricsWithRuns(),
        memoryProviders: memoryReport(projectDir, ['gbrain']),
        memoryRecall: memoryRecallReport(projectDir, {
          selectedProviders: ['gbrain'],
          itemCount: 1,
        }),
        skillDoctor: skillReport({ total: 3, installed: 3 }),
      },
    })

    expect(report.agentLoop.guardrailCoverage.value).toBe(1)
    expect(report.agentLoop.guardrailCoverage.note).toContain('AI OS evaluator/adaptive guardrail')
  })

  it('uses the latest non-stale guardrail state while preserving historical pass rate', () => {
    const projectDir = makeProject()
    const scaleDir = join(projectDir, '.scale')
    writeGateEvidence(scaleDir, {
      id: 'GATE-G7-OLD-FAILED',
      gate: 'G7',
      status: 'failed',
      passed: false,
      evidence: 'guardrail failed before remediation',
      blockers: ['boundary finding'],
      createdAt: Date.parse('2026-06-11T00:03:00.000Z'),
    })
    writeGateEvidence(scaleDir, {
      id: 'GATE-G7-LATEST-PASSED',
      gate: 'G7',
      status: 'passed',
      passed: true,
      evidence: 'boundary guardrail passed after remediation',
      blockers: [],
      createdAt: Date.parse('2026-06-12T00:03:00.000Z'),
    })

    const report = createWorkflowEffectivenessReport({
      projectDir,
      now: new Date('2026-06-13T00:00:00.000Z'),
      deps: {
        governanceMetrics: governanceMetricsWithRuns(),
        memoryProviders: memoryReport(projectDir, ['gbrain']),
        memoryRecall: memoryRecallReport(projectDir, {
          selectedProviders: ['gbrain'],
          itemCount: 1,
        }),
        skillDoctor: skillReport({ total: 3, installed: 3 }),
      },
    })

    expect(report.agentLoop.guardrailCoverage.value).toBe(1)
    expect(report.agentLoop.guardrailCoverage.note).toContain('Latest 1/1 guardrail gate state(s) passed')
    expect(report.agentLoop.guardrailCoverage.note).toContain('historical 1/2 record(s) passed')
  })

  it('flags available memory providers when the recall probe returns no context', () => {
    const projectDir = makeProject()
    const report = createWorkflowEffectivenessReport({
      projectDir,
      now: new Date('2026-06-13T00:00:00.000Z'),
      deps: {
        governanceMetrics: governanceMetricsWithRuns(),
        memoryProviders: memoryReport(projectDir, ['gbrain']),
        memoryRecall: memoryRecallReport(projectDir, {
          selectedProviders: [],
          itemCount: 0,
        }),
        skillDoctor: skillReport({ total: 3, installed: 3 }),
      },
    })

    expect(report.memory.defaultExternalProviderAvailable.value).toBe(true)
    expect(report.memory.providerRecallHitRate.value).toBe(0)
    expect(report.memory.providerRecallItems.value).toBe(0)
    expect(report.summary.gaps).toContain('Memory providers are available, but recall probe returned no provider-backed items.')
    expect(report.summary.recommendations).toContain('Seed or rehearse gbrain with reviewed workflow lessons, then keep provider rehearsal in the verification path.')
  })

  it('uses deployment ledger evidence for DORA delivery and recovery metrics', () => {
    const projectDir = makeProject()
    const scaleDir = join(projectDir, '.scale')
    const ledger = new ReleaseDeploymentLedger(scaleDir)
    ledger.record({
      status: 'succeeded',
      version: 'v0.49.0',
      commitSha: 'abc123',
      commitTimestamp: '2026-06-11T12:00:00.000Z',
      startedAt: '2026-06-12T11:30:00.000Z',
      completedAt: '2026-06-12T12:00:00.000Z',
      source: 'release',
    })
    ledger.record({
      status: 'rolled-back',
      startedAt: '2026-06-12T18:00:00.000Z',
      completedAt: '2026-06-12T18:05:00.000Z',
      failedAt: '2026-06-12T18:05:00.000Z',
      restoredAt: '2026-06-12T19:05:00.000Z',
      source: 'ci',
    })

    const report = createWorkflowEffectivenessReport({
      projectDir,
      now: new Date('2026-06-13T00:00:00.000Z'),
      deps: {
        governanceMetrics: governanceMetricsWithRuns(),
        memoryProviders: memoryReport(projectDir, ['gbrain']),
        memoryRecall: memoryRecallReport(projectDir, {
          selectedProviders: ['gbrain'],
          itemCount: 1,
        }),
        skillDoctor: skillReport({ total: 3, installed: 3 }),
      },
    })

    expect(report.delivery.deploymentFrequency.evidence).toBe('measured')
    expect(report.delivery.deploymentFrequency.value).toBe(0.033)
    expect(report.delivery.leadTimeForChanges.value).toBe(24)
    expect(report.stability.changeFailureProxy.value).toBe(0.5)
    expect(report.stability.restoreTime.value).toBe(1)
    expect(report.summary.gaps).not.toContain('DORA deployment frequency is not measured.')
    expect(report.summary.gaps).not.toContain('DORA lead time for changes is not measured.')
    expect(report.summary.gaps).not.toContain('DORA recovery time is not measured.')
  })

  it('uses runtime Cortex session and application audit evidence for instinct hit rate', () => {
    const projectDir = makeProject()
    const scaleDir = join(projectDir, '.scale')
    const store = new InstinctStore(join(scaleDir, 'instincts'))
    const succeededId = store.save(makeInstinct({
      id: 'instinct-effectiveness-success',
      trigger: 'effectiveness success',
      confidence: 0.9,
    }))
    const failedId = store.save(makeInstinct({
      id: 'instinct-effectiveness-failed',
      trigger: 'effectiveness failed',
      confidence: 0.7,
    }))

    writeRuntimeCortexSession(scaleDir, [succeededId, failedId])
    store.recordApplication(succeededId, true)
    store.recordApplication(failedId, false)

    const report = createWorkflowEffectivenessReport({
      projectDir,
      deps: {
        memoryProviders: memoryReport(projectDir, ['gbrain']),
        memoryRecall: memoryRecallReport(projectDir, {
          selectedProviders: ['gbrain'],
          itemCount: 1,
        }),
        skillDoctor: skillReport({ total: 3, installed: 3 }),
      },
    })

    expect(report.orchestration.instinctHitRate.evidence).toBe('measured')
    expect(report.orchestration.instinctHitRate.value).toBe(0.5)
    expect(report.orchestration.instinctHitRate.source).toBe('.scale/events/sessions + .scale/instincts/.audit.jsonl')
    expect(report.summary.gaps).not.toContain('Instinct hit rate is not yet measured from applied runtime evidence.')
    expect(report.summary.gaps).not.toContain('Instinct hit rate only has legacy counters, not runtime session evidence.')
  })
})

function makeProject(): string {
  const projectDir = mkdtempSync(join(tmpdir(), 'scale-effectiveness-'))
  dirs.push(projectDir)
  mkdirSync(join(projectDir, '.scale'), { recursive: true })
  return projectDir
}

function writeTaskMetric(scaleDir: string, record: TaskMetricRecord): void {
  const dir = join(scaleDir, 'metrics')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'tasks.jsonl'), `${JSON.stringify(record)}\n`, 'utf-8')
}

function writeEvalRun(scaleDir: string, run: WorkflowEvalRun): void {
  const dir = join(scaleDir, 'evals', 'runs')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${run.id}.json`), JSON.stringify(run, null, 2), 'utf-8')
}

function writeFailure(scaleDir: string, record: FailureReplayRecord): void {
  const dir = join(scaleDir, 'evals', 'failures')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${record.id}.json`), JSON.stringify(record, null, 2), 'utf-8')
}

function writeGateEvidence(scaleDir: string, record: {
  id: string
  gate: string
  status: string
  passed: boolean
  evidence: string
  evidenceItems?: Array<{ label: string; path: string; detail: string }>
  blockers: string[]
  createdAt: number
}): void {
  const dir = join(scaleDir, 'evidence')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${record.id}.json`), JSON.stringify(record, null, 2), 'utf-8')
}

function writeReview(scaleDir: string, record: {
  id: string
  reviewMode: string
  passed: boolean
  createdAt: number
}): void {
  const dir = join(scaleDir, 'reviews')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${record.id}.json`), JSON.stringify(record, null, 2), 'utf-8')
}

function writeAiOsRun(scaleDir: string): void {
  const dir = join(scaleDir, 'ai-os', 'runs')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'TASK-LOOP.json'), JSON.stringify({
    generatedAt: '2026-06-12T00:05:00.000Z',
    mode: 'guarded',
    status: 'ready',
    dryRun: false,
    plan: {
      task: {
        taskId: 'TASK-LOOP',
        task: 'Verify Agent Loop readiness evidence',
        level: 'M',
      },
      adaptiveWorkflow: {
        profile: 'standard',
        gates: ['G7'],
      },
      evaluator: {
        gates: [{ id: 'security-threat-model', required: true }],
      },
      toolStrategy: {
        nodes: [{ id: 'skill:code-review', kind: 'skill', fallback: 'manual review', evidence: ['skillPlan'] }],
        summary: {
          totalSteps: 1,
          requiredSteps: 1,
          highRiskSteps: 0,
          estimatedCostUnits: 1,
          fallbackCoveredSteps: 1,
        },
      },
      skillPlan: {
        executionPlan: {
          steps: [{ id: 'code-review', kind: 'skill', required: true }],
        },
      },
    },
    steps: [{ id: 'verify-command:1', kind: 'evidence', status: 'passed', required: true }],
    evidence: {
      produced: ['verify-command:1'],
      pending: [],
    },
    verification: {
      commands: [{ status: 'passed', evidenceId: 'RTE-LOOP' }],
      allPassed: true,
    },
    artifacts: {
      runReport: join(dir, 'TASK-LOOP.json'),
    },
  }, null, 2), 'utf-8')
}

function writeRuntimeCortexSession(scaleDir: string, instinctIds: string[]): void {
  const dir = join(scaleDir, 'events', 'sessions')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SESSION-CORTEX.jsonl'), `${JSON.stringify({
    type: 'session.started',
    sessionId: 'SESSION-CORTEX',
    createdAt: new Date().toISOString(),
    data: {
      metadata: {
        cortex: {
          instinctsApplied: instinctIds,
        },
      },
    },
  })}\n`, 'utf-8')
}

function makeInstinct(overrides: Partial<Instinct>): Instinct {
  return {
    id: 'instinct-effectiveness',
    trigger: 'effectiveness',
    confidence: 0.9,
    domain: 'governance',
    source: 'test',
    scope: 'global' as const,
    action: '## Action\nUse runtime evidence before claiming Cortex learning effectiveness',
    evidence: ['[2026-06-13] workflow effectiveness'],
    observations: 4,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    appliedCount: 0,
    hitRate: 0,
    ...overrides,
  }
}

function emptyGovernanceMetrics(): GovernanceMetrics {
  return {
    gates: { totalRuns: 0, passRate: 0, failRate: 0, avgDurationMs: 0, byGate: {} },
    instincts: { totalExtracted: 0, totalInjected: 0, totalApplied: 0, hitRate: 0, byConfidence: {} },
    cost: { totalTokens: 0, totalCost: 0, avgTokensPerGate: 0, estimatedSavingsFromCaching: 0, estimatedSavingsFromInstincts: 0 },
    autoFix: { totalAttempts: 0, successRate: 0, avgAttemptsPerFix: 0, totalTimeSavedMinutes: 0 },
    trends: { passRateDelta: 0, costDelta: 0, instinctHitRateDelta: 0 },
    period: { start: '2026-05-14', end: '2026-06-13' },
  }
}

function governanceMetricsWithRuns(): GovernanceMetrics {
  return {
    gates: {
      totalRuns: 10,
      passRate: 0.9,
      failRate: 0.1,
      avgDurationMs: 1200,
      byGate: { G3: { runs: 10, passed: 9, avgTokens: 0 } },
    },
    instincts: {
      totalExtracted: 4,
      totalInjected: 4,
      totalApplied: 3,
      hitRate: 0.75,
      byConfidence: {},
    },
    cost: { totalTokens: 2000, totalCost: 0.2, avgTokensPerGate: 200, estimatedSavingsFromCaching: 0.1, estimatedSavingsFromInstincts: 0.05 },
    autoFix: { totalAttempts: 2, successRate: 0.5, avgAttemptsPerFix: 1.5, totalTimeSavedMinutes: 20 },
    trends: { passRateDelta: 0.1, costDelta: -0.02, instinctHitRateDelta: 0.05 },
    period: { start: '2026-05-14', end: '2026-06-13' },
  }
}

function memoryReport(projectDir: string, availableIds: string[]): MemoryProviderStatusReport {
  const providers: MemoryProviderStatusReport['providers'] = [
    {
      id: 'gbrain',
      kind: 'gbrain',
      enabled: true,
      available: availableIds.includes('gbrain'),
      selectedByDefault: true,
      priority: 95,
      capabilities: ['semantic-recall', 'graph-recall', 'session-memory'],
      safetyLevel: 'review-required',
      writeMode: 'disabled',
      reason: 'test provider',
    },
  ]
  return {
    projectDir,
    scaleDir: join(projectDir, '.scale'),
    configPath: join(projectDir, '.scale', 'memory-providers.json'),
    configExists: true,
    routing: {
      mode: 'external-first',
      defaultOrder: ['gbrain'],
      allowExternalWrite: false,
      requireEvidence: true,
      maxResultsPerProvider: 5,
    },
    providers,
    availableProviderCount: providers.filter(provider => provider.available).length,
    warnings: [],
  }
}

function memoryRecallReport(projectDir: string, input: {
  selectedProviders: string[]
  itemCount: number
}): MemoryProviderRecallReport {
  return {
    ok: input.itemCount > 0,
    projectDir,
    generatedAt: '2026-06-13T00:00:00.000Z',
    query: 'workflow effectiveness',
    providerOrder: ['gbrain'],
    selectedProviders: input.selectedProviders,
    fallbackUsed: false,
    items: Array.from({ length: input.itemCount }, (_, index) => ({
      provider: input.selectedProviders[0] ?? 'gbrain',
      id: `MEM-${index + 1}`,
      title: `Workflow lesson ${index + 1}`,
      summary: 'Use provider-backed recall evidence before claiming memory quality.',
      confidence: 0.9,
      score: 0.9,
      evidencePaths: ['docs/MEMORY_FABRIC.md'],
    })),
    providerStatuses: memoryReport(projectDir, ['gbrain']).providers,
    contextSavings: {
      naiveContextTokens: 1000,
      recalledTokens: input.itemCount > 0 ? 100 : 0,
      reduction: input.itemCount > 0 ? 10 : 1,
    },
    warnings: [],
  }
}

function skillReport(input: {
  total: number
  installed: number
  missingRequired?: string[]
  missingRecommended?: string[]
  missingOptional?: string[]
}): SkillDoctorReport {
  const missingRequired = input.missingRequired ?? []
  const missingRecommended = input.missingRecommended ?? []
  const missingOptional = input.missingOptional ?? []
  const missing = input.total - input.installed
  return {
    ok: missing === 0,
    total: input.total,
    installed: input.installed,
    missing,
    waived: 0,
    sourceRoots: {
      primaryRoot: '.scale/skills',
      fallbackRoots: ['skills'],
      globalRoots: ['~/.agents/skills'],
    },
    missingByReadiness: {
      required: missingRequired,
      recommended: missingRecommended,
      optional: missingOptional,
    },
    installedByReadiness: {
      required: [],
      recommended: [],
      optional: [],
    },
    waivedByReadiness: {
      required: [],
      recommended: [],
      optional: [],
    },
    skills: [],
  }
}
