import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAiOsAdoption, createAiOsBenchmark, createAiOsDashboard, createAiOsDoctor, createAiOsMigration, createAiOsPlan, createAiOsRun, createAiOsStatus } from '../../src/runtime/AiOsRuntime.js'
import { MemoryBrain } from '../../src/memory/MemoryBrain.js'
import { SCALE_ENGINE_VERSION } from '../../src/version.js'
import { InstinctStore } from '../../src/cortex/InstinctStore.js'
import { defaultMemoryProvidersConfig } from '../../src/memory/MemoryProviders.js'
import { safeRmSync } from '../helpers/fs.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) safeRmSync(dir)
  dirs = []
})

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function makeScaleDir(prefix: string): string {
  const dir = makeDir(prefix)
  writeIsolatedMemoryProviderConfig(dir)
  return dir
}

function writeIsolatedMemoryProviderConfig(scaleDir: string): void {
  mkdirSync(scaleDir, { recursive: true })
  const config = defaultMemoryProvidersConfig()
  config.providers = config.providers.map(provider => ({
    ...provider,
    enabled: provider.kind === 'gbrain',
    homeDir: join(scaleDir, 'test-gbrain-home'),
  }))
  writeFileSync(join(scaleDir, 'memory-providers.json'), JSON.stringify(config, null, 2), 'utf-8')
}

describe('AI OS runtime planner', () => {
  it('builds one explainable plan across governance, context, memory, skills, and ROI', async () => {
    const projectDir = makeDir('scale-ai-os-project-')
    const scaleDir = makeScaleDir('scale-ai-os-scale-')
    const brain = new MemoryBrain({ projectDir, scaleDir })
    try {
      brain.addNode({
        id: 'MEM-AI-OS-1',
        type: 'decision',
        title: 'OAuth callbacks use Redis state',
        summary: 'OAuth callbacks must resolve provider and user context from server-side Redis state.',
        source: 'manual',
        evidencePaths: ['docs/oauth-state.md'],
        confidence: 0.88,
        scope: 'project',
        status: 'active',
      })
    } finally {
      brain.close()
    }
    const savedInstinctId = new InstinctStore(join(scaleDir, 'instincts')).save({
      id: 'instinct-ai-os-runtime',
      trigger: 'oauth callback smoke',
      confidence: 0.9,
      domain: 'security',
      source: 'test',
      scope: 'global',
      action: '## Action\nAlways run the auth callback product smoke before final delivery',
      evidence: ['[2026-06-12] G8: oauth callback smoke'],
      observations: 5,
      createdAt: '2026-06-12T00:00:00.000Z',
      updatedAt: '2026-06-12T00:00:00.000Z',
      appliedCount: 0,
      hitRate: 0,
    })

    const plan = await createAiOsPlan({
      projectDir,
      scaleDir,
      taskId: 'TASK-AI-OS',
      task: 'Fix OAuth callback auth token handling and verify browser flow',
      level: 'L',
      files: ['src/auth/oauth.ts', 'src/ui/callback.tsx'],
      budget: 2400,
    })

    expect(plan.version).toBe(SCALE_ENGINE_VERSION)
    expect(plan.preamble.cortex.instinctCount).toBe(1)
    expect(plan.preamble.cortex.instinctsApplied).toEqual([savedInstinctId])
    expect(plan.preamble.cortex.content).toContain('Always run the auth callback product smoke')
    expect(plan.governance.effectiveMode).toBe('critical')
    expect(plan.context.compiler?.strategy).toBe('relevance-budget-v1')
    expect(plan.memory.providerOrder).toEqual(['gbrain'])
    expect(plan.memory.items).toEqual([])
    expect(plan.memory.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('gbrain skipped'),
    ]))
    expect(plan.skillPlan.executionPlan.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'skill', id: 'security-review', required: true }),
      expect.objectContaining({ kind: 'verification', id: 'browser-run' }),
    ]))
    expect(plan.adaptiveWorkflow.requiredBehaviors).toContain('run security review')
    expect(plan.evaluator.strategy).toBe('evaluator-intelligence-v1')
    expect(plan.evaluator.required).toBe(true)
    expect(plan.evaluator.gates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'security-threat-model', required: true }),
      expect.objectContaining({ id: 'uncertainty-decision-log' }),
    ]))
    expect(plan.toolStrategy.strategy).toBe('tool-strategy-v1')
    expect(plan.toolStrategy.summary.totalSteps).toBe(plan.skillPlan.executionPlan.steps.length)
    expect(plan.toolStrategy.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'skill:security-review',
        retry: expect.objectContaining({ maxAttempts: 1 }),
        fallback: expect.stringContaining('fallback'),
      }),
      expect.objectContaining({
        id: 'verification:browser-run',
        cost: expect.objectContaining({ timeRisk: 'medium' }),
      }),
    ]))
    expect(plan.agentCollaboration.strategy).toBe('agent-collaboration-v1')
    expect(plan.agentCollaboration.mode).toBe('review-escalated')
    expect(plan.agentCollaboration.roles).toEqual(expect.arrayContaining([
      expect.objectContaining({ profileId: 'architect-agent', responsibility: 'orchestrator', required: true }),
      expect.objectContaining({ profileId: 'security-agent', responsibility: 'reviewer', required: true }),
      expect.objectContaining({ profileId: 'frontend-agent', responsibility: 'implementer', required: true }),
      expect.objectContaining({ profileId: 'test-agent', responsibility: 'verifier', required: true }),
      expect.objectContaining({ profileId: 'code-review-agent', responsibility: 'reviewer', required: true }),
    ]))
    expect(plan.agentCollaboration.reviewGates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'security-review', owner: 'security-agent', required: true }),
      expect.objectContaining({ id: 'verification-review', owner: 'test-agent', required: true }),
    ]))
    expect(plan.agentCollaboration.summary.multiAgentRecommended).toBe(true)
    expect(plan.agentCollaboration.budget.reserveTokens).toBeGreaterThanOrEqual(0)
    expect(plan.adaptiveWorkflow.gates).toEqual(expect.arrayContaining([
      'security-threat-model',
      'uncertainty-decision-log',
    ]))
    expect(plan.roi.modules.map(module => module.module)).toEqual(expect.arrayContaining([
      'context-compiler',
      'memory-provider-runtime',
      'skill-routing-engine',
      'progressive-governance',
    ]))
  })

  it('creates a dry-run execution report from the unified plan', async () => {
    const projectDir = makeDir('scale-ai-os-run-project-')
    const scaleDir = makeScaleDir('scale-ai-os-run-scale-')

    const report = await createAiOsRun({
      projectDir,
      scaleDir,
      taskId: 'TASK-AI-OS-RUN',
      task: 'Review auth token handling and verify browser callback flow',
      level: 'L',
      files: ['src/auth/token.ts', 'src/ui/callback.tsx'],
      budget: 2400,
      mode: 'dry-run',
    })

    expect(report.mode).toBe('dry-run')
    expect(report.dryRun).toBe(true)
    expect(report.status).toBe('ready')
    expect(report.plan.task.taskId).toBe('TASK-AI-OS-RUN')
    expect(report.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'runtime-plan', status: 'passed' }),
      expect.objectContaining({ id: 'context-compiler', status: 'passed' }),
      expect.objectContaining({ id: 'memory-provider-recall', status: 'passed' }),
      expect.objectContaining({ id: 'agent-collaboration-plan', kind: 'agent', status: 'passed' }),
      expect.objectContaining({ id: 'agent:security-agent', kind: 'agent', status: 'planned', required: true }),
      expect.objectContaining({ id: 'agent-review:security-review', kind: 'agent', status: 'planned', required: true }),
      expect.objectContaining({ id: 'skill-evidence', status: 'planned' }),
      expect.objectContaining({ id: 'runtime-evidence', status: 'planned' }),
    ]))
    expect(report.steps.some(step => step.kind === 'skill' && step.required)).toBe(true)
    expect(report.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'security-threat-model', kind: 'gate', status: 'planned' }),
      expect.objectContaining({ id: 'uncertainty-decision-log', kind: 'gate', status: 'planned' }),
    ]))
    expect(report.evidence.required).toEqual(expect.arrayContaining([
      'context-compiler',
      'memory-provider-recall',
      'agent-collaboration',
      'skill-routing-engine',
      'runtime-evidence',
      'gate:security-threat-model',
    ]))
    expect(report.agentExecution).toEqual(expect.objectContaining({
      strategy: 'agent-execution-settlement-v1',
      status: 'planned',
      summary: expect.objectContaining({
        totalRoles: expect.any(Number),
        settledRoles: 0,
        settledReviewGates: 0,
      }),
    }))
    expect(report.agentExecution?.evidence.pending).toEqual(expect.arrayContaining([
      'agent:security-agent',
      'agent-review:security-review',
    ]))
    expect(report.failureLearning.candidates).toEqual([])
    expect(report.artifacts.runReport).toContain('TASK-AI-OS-RUN')
    expect(existsSync(report.artifacts.runReport)).toBe(true)
    expect(report.nextActions).toEqual(expect.arrayContaining([
      expect.stringContaining('Execute agent collaboration'),
      expect.stringContaining('Execute required skill'),
    ]))
  })

  it('runs guarded verification commands into runtime evidence', async () => {
    const projectDir = makeDir('scale-ai-os-guarded-project-')
    const scaleDir = makeScaleDir('scale-ai-os-guarded-scale-')

    const report = await createAiOsRun({
      projectDir,
      scaleDir,
      taskId: 'TASK-AI-OS-GUARDED',
      task: 'Verify guarded AI OS execution evidence',
      level: 'M',
      files: ['src/runtime/AiOsRuntime.ts'],
      budget: 2400,
      mode: 'guarded',
      verificationCommands: ['node -e "process.stdout.write(\'ok\')"'],
    })

    expect(report.mode).toBe('guarded')
    expect(report.dryRun).toBe(false)
    expect(report.status).toBe('ready')
    expect(report.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'runtime-evidence', status: 'passed' }),
      expect.objectContaining({ id: 'verify-command:1', status: 'passed', kind: 'evidence' }),
    ]))
    expect(report.agentExecution).toEqual(expect.objectContaining({
      strategy: 'agent-execution-settlement-v1',
      status: 'settled',
      summary: expect.objectContaining({
        settledRoles: expect.any(Number),
        settledReviewGates: expect.any(Number),
        producedEvidence: expect.any(Number),
      }),
    }))
    expect(report.agentExecution?.summary.settledRoles).toBe(report.agentExecution?.summary.totalRoles)
    expect(report.agentExecution?.summary.settledReviewGates).toBe(report.agentExecution?.summary.reviewGates)
    expect(report.agentExecution?.evidence.produced[0]).toMatch(/^RTE-/)
    expect(report.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'agent-collaboration-plan', kind: 'agent', status: 'passed' }),
    ]))
    expect(report.evidence.produced).toContain('runtime-evidence')
    expect(report.evidence.produced).toContain('agent-collaboration')
    expect(report.verification.commands).toEqual([
      expect.objectContaining({ command: 'node -e "process.stdout.write(\'ok\')"', status: 'passed', exitCode: 0 }),
    ])
    expect(report.verification.commands[0].evidenceId).toMatch(/^RTE-/)
    expect(report.failureLearning.candidates).toEqual([])
  }, 120_000)

  it('blocks guarded runs and creates a failure learning candidate when verification fails', async () => {
    const projectDir = makeDir('scale-ai-os-guarded-fail-project-')
    const scaleDir = makeScaleDir('scale-ai-os-guarded-fail-scale-')

    const report = await createAiOsRun({
      projectDir,
      scaleDir,
      taskId: 'TASK-AI-OS-GUARDED-FAIL',
      task: 'Verify guarded AI OS execution failure learning',
      level: 'M',
      files: ['src/runtime/AiOsRuntime.ts'],
      budget: 2400,
      mode: 'guarded',
      verificationCommands: ['node -e "process.exit(7)"'],
    })

    expect(report.status).toBe('blocked')
    expect(report.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'runtime-evidence', status: 'blocked' }),
      expect.objectContaining({ id: 'verify-command:1', status: 'blocked' }),
    ]))
    expect(report.agentExecution).toEqual(expect.objectContaining({
      strategy: 'agent-execution-settlement-v1',
      status: 'blocked',
      summary: expect.objectContaining({
        blockedRoles: expect.any(Number),
        settledRoles: 0,
      }),
    }))
    expect(report.verification.commands[0]).toEqual(expect.objectContaining({ status: 'failed', exitCode: 7 }))
    expect(report.failureLearning.status).toBe('candidate-created')
    expect(report.failureLearning.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'failed-step',
        promotable: false,
      }),
    ]))
  }, 120_000)

  it('summarizes persisted AI OS run reports for dashboard views', async () => {
    const projectDir = makeDir('scale-ai-os-dashboard-project-')
    const scaleDir = makeScaleDir('scale-ai-os-dashboard-scale-')

    await createAiOsRun({
      projectDir,
      scaleDir,
      taskId: 'TASK-AI-OS-DASH-READY',
      task: 'Verify ready dashboard run',
      level: 'M',
      files: ['src/runtime/AiOsRuntime.ts'],
      mode: 'guarded',
      verificationCommands: ['node -v'],
    })
    await createAiOsRun({
      projectDir,
      scaleDir,
      taskId: 'TASK-AI-OS-DASH-BLOCKED',
      task: 'Verify blocked dashboard run',
      level: 'M',
      files: ['src/runtime/AiOsRuntime.ts'],
      mode: 'guarded',
      verificationCommands: ['node definitely-missing-scale-dashboard-file.js'],
    })

    const dashboard = createAiOsDashboard({ projectDir, scaleDir })

    expect(dashboard.summary).toMatchObject({
      totalRuns: 2,
      readyRuns: 1,
      blockedRuns: 1,
      verificationCommands: 2,
      failedVerificationCommands: 1,
      failureLearningCandidates: 1,
    })
    expect(dashboard.health.status).toBe('attention')
    expect(dashboard.latestRuns.map(run => run.taskId)).toEqual([
      'TASK-AI-OS-DASH-BLOCKED',
      'TASK-AI-OS-DASH-READY',
    ])
    expect(dashboard.recommendations).toEqual(expect.arrayContaining([
      expect.stringContaining('Resolve blocked AI OS run'),
    ]))
  }, 120_000)

  it('benchmarks fixed AI OS scenarios with context, memory, skill, and dashboard metrics', async () => {
    const projectDir = makeDir('scale-ai-os-benchmark-project-')
    const scaleDir = makeScaleDir('scale-ai-os-benchmark-scale-')

    await createAiOsRun({
      projectDir,
      scaleDir,
      taskId: 'TASK-AI-OS-BENCH-RUN',
      task: 'Verify benchmark dashboard input',
      level: 'M',
      files: ['src/runtime/AiOsRuntime.ts'],
      mode: 'guarded',
      verificationCommands: ['node -v'],
    })

    const benchmark = await createAiOsBenchmark({ projectDir, scaleDir })

    expect(benchmark.summary.scenarios).toBeGreaterThanOrEqual(3)
    expect(benchmark.summary.totalEstimatedTokens).toBeGreaterThanOrEqual(0)
    expect(benchmark.summary.totalSkillSteps).toBeGreaterThan(0)
    expect(benchmark.summary.totalEvaluatorGates).toBeGreaterThan(0)
    expect(benchmark.summary.totalToolStrategySteps).toBeGreaterThan(0)
    expect(benchmark.summary.totalToolStrategyCostUnits).toBeGreaterThan(0)
    expect(benchmark.summary.totalAgentRoles).toBeGreaterThan(0)
    expect(benchmark.summary.totalAgentReviewerRoles).toBeGreaterThan(0)
    expect(benchmark.summary.totalAgentReviewGates).toBeGreaterThan(0)
    expect(benchmark.summary.multiAgentScenarios).toBeGreaterThan(0)
    expect(benchmark.summary.governanceModes.length).toBeGreaterThan(0)
    expect(benchmark.scenarios).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'docs-governance',
        metrics: expect.objectContaining({
          skillSteps: expect.any(Number),
          memoryItems: expect.any(Number),
          evaluatorGates: expect.any(Number),
          toolStrategySteps: expect.any(Number),
          toolStrategyCostUnits: expect.any(Number),
          agentRoles: expect.any(Number),
          agentReviewerRoles: expect.any(Number),
          agentReviewGates: expect.any(Number),
        }),
      }),
      expect.objectContaining({ id: 'security-code-change' }),
      expect.objectContaining({ id: 'browser-ui-flow' }),
    ]))
    expect(benchmark.dashboard.summary.totalRuns).toBe(1)
    expect(benchmark.artifacts.benchmarkReport).toContain('benchmarks')
    expect(existsSync(benchmark.artifacts.benchmarkReport)).toBe(true)
    expect(benchmark.recommendations).toEqual(expect.arrayContaining([
      expect.stringContaining('Use benchmark deltas'),
    ]))
  }, 120_000)

  it('creates an idempotent AI OS migration report for runtime state directories', () => {
    const projectDir = makeDir('scale-ai-os-migrate-project-')
    const scaleDir = makeScaleDir('scale-ai-os-migrate-scale-')

    const first = createAiOsMigration({ projectDir, scaleDir })
    const second = createAiOsMigration({ projectDir, scaleDir })

    expect(first.status).toBe('migrated')
    expect(first.created).toEqual(expect.arrayContaining([
      expect.stringContaining('ai-os/runs'),
      expect.stringContaining('ai-os/benchmarks'),
    ]))
    expect(first.files.migrationReport).toContain('migration.json')
    expect(existsSync(first.files.migrationReport)).toBe(true)
    expect(second.status).toBe('compatible')
    expect(second.created).toEqual([])
    expect(second.warnings).toEqual([])
  })

  it('doctors AI OS runtime readiness from migration, runs, dashboard, and benchmark evidence', async () => {
    const projectDir = makeDir('scale-ai-os-doctor-project-')
    const scaleDir = makeScaleDir('scale-ai-os-doctor-scale-')

    const beforeMigration = createAiOsDoctor({ projectDir, scaleDir })

    expect(beforeMigration.status).toBe('blocked')
    expect(beforeMigration.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'ai-os-runtime-dirs', status: 'blocked' }),
    ]))
    expect(beforeMigration.nextActions).toEqual(expect.arrayContaining([
      expect.stringContaining('scale ai-os migrate'),
    ]))

    createAiOsMigration({ projectDir, scaleDir })
    await createAiOsRun({
      projectDir,
      scaleDir,
      taskId: 'TASK-AI-OS-DOCTOR',
      task: 'Verify AI OS doctor readiness',
      level: 'M',
      files: ['src/runtime/AiOsRuntime.ts'],
      mode: 'guarded',
      verificationCommands: ['node -v'],
    })
    await createAiOsBenchmark({ projectDir, scaleDir })

    const ready = createAiOsDoctor({ projectDir, scaleDir, benchmarkMaxAgeHours: 24 })

    expect(ready.status).toBe('ready')
    expect(ready.dashboard.health.status).toBe('healthy')
    expect(ready.summary).toMatchObject({
      totalChecks: 4,
      passedChecks: 4,
      warningChecks: 0,
      blockedChecks: 0,
    })
    expect(ready.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'ai-os-runtime-dirs', status: 'passed' }),
      expect.objectContaining({ id: 'ai-os-run-history', status: 'passed' }),
      expect.objectContaining({ id: 'ai-os-dashboard-health', status: 'passed' }),
      expect.objectContaining({ id: 'ai-os-benchmark', status: 'passed' }),
    ]))
    expect(ready.nextActions).toContain('AI OS beta runtime is ready for guarded project tasks.')
  }, 120_000)

  it('adopts AI OS runtime through migrate, first dry-run, benchmark, and doctor phases', async () => {
    const projectDir = makeDir('scale-ai-os-adopt-project-')
    const scaleDir = makeScaleDir('scale-ai-os-adopt-scale-')

    const report = await createAiOsAdoption({
      projectDir,
      scaleDir,
      taskId: 'TASK-AI-OS-ADOPT',
      task: 'Adopt AI OS runtime for a new project',
      level: 'M',
      files: ['src/runtime/AiOsRuntime.ts'],
      budget: 2400,
      lang: 'en',
    })

    expect(report.status).toBe('ready')
    expect(report.phases.map(phase => phase.id)).toEqual([
      'migrate',
      'first-run',
      'benchmark',
      'doctor',
    ])
    expect(report.phases.every(phase => phase.status === 'passed')).toBe(true)
    expect(report.migration.status).toBe('migrated')
    expect(report.run.mode).toBe('dry-run')
    expect(report.benchmark.summary.scenarios).toBeGreaterThanOrEqual(3)
    expect(report.doctor.status).toBe('ready')
    expect(report.artifacts.migrationReport).toContain('migration.json')
    expect(report.artifacts.runReport).toContain('runs')
    expect(report.artifacts.benchmarkReport).toContain('benchmarks')
    expect(existsSync(report.artifacts.adoptionReport)).toBe(true)
    expect(report.nextActions).toContain('AI OS runtime adoption is complete; use `scale ai-os run --mode guarded` for governed work.')
  }, 120_000)

  it('reports AI OS closed-loop status and missing evidence', async () => {
    const projectDir = makeDir('scale-ai-os-status-project-')
    const scaleDir = makeScaleDir('scale-ai-os-status-scale-')

    const empty = createAiOsStatus({ projectDir, scaleDir, lang: 'en' })

    expect(empty.status).toBe('blocked')
    expect(empty.summary).toMatchObject({
      total: 7,
      ready: 0,
      warning: 0,
      blocked: 7,
    })
    expect(empty.checks.map(check => check.id)).toEqual([
      'runtime-dirs',
      'plan-evidence',
      'run-evidence',
      'verification-evidence',
      'dashboard-health',
      'benchmark-evidence',
      'adoption-evidence',
    ])
    expect(empty.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'run-evidence', status: 'blocked' }),
      expect.objectContaining({ id: 'benchmark-evidence', status: 'blocked' }),
    ]))
    expect(empty.nextActions).toEqual(expect.arrayContaining([
      expect.stringContaining('scale ai-os adopt'),
    ]))

    await createAiOsAdoption({
      projectDir,
      scaleDir,
      taskId: 'TASK-AI-OS-STATUS',
      task: 'Adopt AI OS runtime before status check',
      level: 'M',
      files: ['src/runtime/AiOsRuntime.ts'],
      budget: 2400,
      lang: 'en',
    })
    await createAiOsRun({
      projectDir,
      scaleDir,
      taskId: 'TASK-AI-OS-STATUS-GUARDED',
      task: 'Verify status sees guarded evidence',
      level: 'M',
      files: ['src/runtime/AiOsRuntime.ts'],
      mode: 'guarded',
      verificationCommands: ['node -v'],
    })

    const ready = createAiOsStatus({ projectDir, scaleDir, lang: 'en' })

    expect(ready.status).toBe('ready')
    expect(ready.summary.blocked).toBe(0)
    expect(ready.checks.every(check => check.status === 'ready')).toBe(true)
    expect(ready.checks.find(check => check.id === 'verification-evidence')?.evidence).toEqual(expect.arrayContaining([
      expect.stringContaining('TASK-AI-OS-STATUS-GUARDED'),
    ]))
    expect(ready.nextActions).toContain('AI OS closed loop is ready for guarded project work.')
  }, 120_000)

  it('surfaces memory, context, skill, and benchmark intelligence in AI OS status', async () => {
    const projectDir = makeDir('scale-ai-os-status-intel-project-')
    const scaleDir = makeScaleDir('scale-ai-os-status-intel-scale-')
    const brain = new MemoryBrain({ projectDir, scaleDir })
    try {
      brain.addNode({
        id: 'MEM-AI-OS-INTEL',
        type: 'decision',
        title: 'OAuth callbacks use Redis state',
        summary: 'OAuth callbacks must resolve provider and user context from server-side Redis state.',
        source: 'manual',
        evidencePaths: ['docs/oauth-state.md'],
        confidence: 0.91,
        scope: 'project',
        status: 'active',
      })
    } finally {
      brain.close()
    }

    await createAiOsRun({
      projectDir,
      scaleDir,
      taskId: 'TASK-AI-OS-INTEL',
      task: 'Fix OAuth callback auth token handling and verify browser flow',
      level: 'L',
      files: ['src/auth/oauth.ts', 'src/ui/callback.tsx'],
      budget: 2400,
      mode: 'dry-run',
    })
    await createAiOsRun({
      projectDir,
      scaleDir,
      taskId: 'TASK-AI-OS-INTEL-GUARDED',
      task: 'Settle agent collaboration execution after guarded verification',
      level: 'L',
      files: ['src/auth/oauth.ts', 'src/ui/callback.tsx'],
      budget: 2400,
      mode: 'guarded',
      verificationCommands: ['node -v'],
    })
    await createAiOsBenchmark({ projectDir, scaleDir })

    const status = createAiOsStatus({ projectDir, scaleDir, lang: 'en' })

    expect(status.intelligence.signals.map(signal => signal.id)).toEqual([
      'memory-recall',
      'context-savings',
      'skill-routing',
      'evaluator-intelligence',
      'tool-strategy',
      'agent-collaboration',
      'agent-loop-readiness',
      'adaptive-workflow',
      'evolution-shadow',
      'benchmark-intelligence',
    ])
    expect(status.intelligence.summary.totalMemoryItems).toBe(0)
    expect(status.intelligence.summary.skillSteps).toBeGreaterThan(0)
    expect(status.intelligence.summary.selectedProviders).toEqual([])
    expect(status.intelligence.summary.memoryQuality).toEqual(expect.objectContaining({
      score: expect.any(Number),
      evidenceBackedItems: expect.any(Number),
      averageConfidence: expect.any(Number),
      averageRelevance: expect.any(Number),
    }))
    expect(status.intelligence.summary.memoryQuality.score).toBe(0)
    expect(status.intelligence.summary.memoryQuality.evidenceBackedItems).toBe(0)
    expect(status.intelligence.summary.evaluatorQuality.requiredGates).toBeGreaterThan(0)
    expect(status.intelligence.summary.toolStrategyQuality.totalSteps).toBeGreaterThan(0)
    expect(status.intelligence.summary.toolStrategyQuality.fallbackCoverage).toBe(1)
    expect(status.intelligence.summary.agentCollaborationQuality).toEqual(expect.objectContaining({
      totalRoles: expect.any(Number),
      reviewGates: expect.any(Number),
      settledRoles: expect.any(Number),
      settledReviewGates: expect.any(Number),
      settledRuns: expect.any(Number),
      multiAgentRuns: expect.any(Number),
    }))
    expect(status.intelligence.summary.agentCollaborationQuality.totalRoles).toBeGreaterThan(0)
    expect(status.intelligence.summary.agentCollaborationQuality.reviewGates).toBeGreaterThan(0)
    expect(status.intelligence.summary.agentCollaborationQuality.settledRoles).toBeGreaterThan(0)
    expect(status.intelligence.summary.agentCollaborationQuality.settledReviewGates).toBeGreaterThan(0)
    expect(status.intelligence.summary.agentCollaborationQuality.settledRuns).toBeGreaterThan(0)
    expect(status.intelligence.summary.agentLoopQuality).toEqual(expect.objectContaining({
      status: 'ready',
      score: 100,
      readySignals: 6,
    }))
    expect(status.intelligence.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'memory-recall',
        status: 'blocked',
        summary: 'No memory recall evidence found in AI OS runs or benchmarks.',
        evidence: [],
      }),
      expect.objectContaining({
        id: 'skill-routing',
        status: 'ready',
      }),
      expect.objectContaining({
        id: 'evaluator-intelligence',
        status: expect.stringMatching(/ready|warning/),
      }),
      expect.objectContaining({
        id: 'tool-strategy',
        status: 'ready',
      }),
      expect.objectContaining({
        id: 'agent-collaboration',
        status: 'ready',
        evidence: expect.arrayContaining([
          expect.stringContaining('agent:security-agent'),
        ]),
      }),
      expect.objectContaining({
        id: 'agent-loop-readiness',
        status: 'ready',
      }),
      expect.objectContaining({
        id: 'benchmark-intelligence',
        status: 'ready',
      }),
    ]))
    expect(status.intelligence.nextActions).toEqual(expect.arrayContaining([
      expect.stringContaining('Use intelligence signals'),
    ]))
  }, 120_000)

  it('derives evaluator and tool strategy intelligence for older run reports without new fields', async () => {
    const projectDir = makeDir('scale-ai-os-legacy-evaluator-project-')
    const scaleDir = makeScaleDir('scale-ai-os-legacy-evaluator-scale-')

    const run = await createAiOsRun({
      projectDir,
      scaleDir,
      taskId: 'TASK-AI-OS-LEGACY-EVALUATOR',
      task: 'Release auth migration and document rollback uncertainty',
      level: 'CRITICAL',
      files: ['src/auth/token.ts', 'CHANGELOG.md'],
      mode: 'dry-run',
    })
    const persisted = JSON.parse(readFileSync(run.artifacts.runReport, 'utf-8')) as { plan: { evaluator?: unknown; toolStrategy?: unknown; agentCollaboration?: unknown } }
    delete persisted.plan.evaluator
    delete persisted.plan.toolStrategy
    delete persisted.plan.agentCollaboration
    writeFileSync(run.artifacts.runReport, JSON.stringify(persisted, null, 2), 'utf-8')

    const status = createAiOsStatus({ projectDir, scaleDir, lang: 'en' })

    expect(status.intelligence.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'evaluator-intelligence',
        evidence: expect.arrayContaining([
          expect.stringContaining('security-threat-model'),
          expect.stringContaining('release-readiness-review'),
        ]),
      }),
      expect.objectContaining({
        id: 'tool-strategy',
        evidence: expect.arrayContaining([
          expect.stringContaining('skill:security-review'),
        ]),
      }),
      expect.objectContaining({
        id: 'agent-collaboration',
        evidence: expect.arrayContaining([
          expect.stringContaining('agent:security-agent'),
        ]),
      }),
      expect.objectContaining({
        id: 'agent-loop-readiness',
        status: 'warning',
      }),
    ]))
    expect(status.intelligence.summary.evaluatorQuality.requiredGates).toBeGreaterThan(0)
    expect(status.intelligence.summary.toolStrategyQuality.totalSteps).toBeGreaterThan(0)
    expect(status.intelligence.summary.agentCollaborationQuality.totalRoles).toBeGreaterThan(0)
    expect(status.intelligence.summary.agentLoopQuality.status).toBe('warning')
  }, 120_000)

  it('warns when context compilation omits evidence-bearing sections', async () => {
    const projectDir = makeDir('scale-ai-os-context-risk-project-')
    const scaleDir = makeScaleDir('scale-ai-os-context-risk-scale-')
    mkdirSync(join(projectDir, 'docs', 'worklog', 'tasks'), { recursive: true })
    writeFileSync(
      join(projectDir, 'docs', 'worklog', 'tasks', 'oauth-evidence.md'),
      `# OAuth Evidence\n\n${'runtime evidence line\n'.repeat(400)}`,
      'utf-8',
    )

    await createAiOsRun({
      projectDir,
      scaleDir,
      taskId: 'TASK-AI-OS-CONTEXT-RISK',
      task: 'Critical release review must inspect OAuth runtime evidence',
      level: 'CRITICAL',
      files: ['src/auth/oauth.ts'],
      budget: 120,
      mode: 'dry-run',
    })

    const status = createAiOsStatus({ projectDir, scaleDir, lang: 'en' })

    expect(status.intelligence.summary.contextQuality).toEqual(expect.objectContaining({
      omittedSections: expect.any(Number),
      totalOmittedTokens: expect.any(Number),
      evidenceLossWarnings: expect.arrayContaining([
        expect.stringContaining('runtime-evidence'),
      ]),
      compressionRisk: 'high',
    }))
    expect(status.intelligence.summary.evaluatorQuality.requiredGates).toBeGreaterThan(0)
    expect(status.intelligence.summary.contextQuality.omittedSections).toBeGreaterThan(0)
    expect(status.intelligence.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'context-savings',
        status: 'warning',
        recommendations: expect.arrayContaining([
          expect.stringContaining('omitted evidence'),
        ]),
      }),
    ]))
  }, 120_000)

  it('recommends concrete guarded verification commands from the verification matrix', async () => {
    const projectDir = makeDir('scale-ai-os-status-verify-project-')
    const scaleDir = makeScaleDir('scale-ai-os-status-verify-scale-')
    writeFileSync(join(scaleDir, 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: {
        default: {
          commands: {
            build: 'npm run build',
            lint: 'npm run lint',
            test: 'npm test',
          },
          services: ['scale-engine'],
        },
      },
      services: [
        { name: 'scale-engine', path: '.', type: 'node', required: true },
      ],
    }, null, 2), 'utf-8')

    await createAiOsAdoption({
      projectDir,
      scaleDir,
      taskId: 'TASK-AI-OS-STATUS-VERIFY',
      task: 'Adopt AI OS runtime before guarded verification recommendation',
      level: 'M',
      files: ['src/runtime/AiOsRuntime.ts'],
      budget: 2400,
      lang: 'en',
    })

    const status = createAiOsStatus({ projectDir, scaleDir, lang: 'en' })

    expect(status.status).toBe('blocked')
    expect(status.checks.find(check => check.id === 'verification-evidence')?.status).toBe('blocked')
    expect(status.verificationRecommendations).toEqual([
      expect.objectContaining({
        command: 'npm run build',
        source: 'verification-profile',
        profile: 'default',
        service: 'scale-engine',
      }),
      expect.objectContaining({ command: 'npm run lint' }),
      expect.objectContaining({ command: 'npm test' }),
    ])
    expect(status.nextActions).toEqual(expect.arrayContaining([
      'Run `scale ai-os run --mode guarded --verify "npm run build"` to produce governed verification evidence.',
    ]))
  }, 120_000)

  it('routes low-risk docs task to light profile', async () => {
    const projectDir = makeDir('scale-ai-os-light-profile-project-')
    const scaleDir = makeScaleDir('scale-ai-os-light-profile-scale-')

    const plan = await createAiOsPlan({
      projectDir,
      scaleDir,
      taskId: 'TASK-PROFILE-LIGHT',
      task: 'Update README with new usage examples',
      level: 'S',
      files: ['README.md'],
      budget: 60,
    })

    expect(plan.adaptiveWorkflow.profile).toBe('light')
    expect(plan.adaptiveWorkflow.escalationReasons).toEqual([])
  })

  it('routes standard code change to standard profile', async () => {
    const projectDir = makeDir('scale-ai-os-standard-profile-project-')
    const scaleDir = makeScaleDir('scale-ai-os-standard-profile-scale-')

    const plan = await createAiOsPlan({
      projectDir,
      scaleDir,
      taskId: 'TASK-PROFILE-STANDARD',
      task: 'Add pagination to user list query',
      level: 'M',
      files: ['src/db/users.ts'],
      budget: 600,
    })

    expect(plan.adaptiveWorkflow.profile).toBe('standard')
    expect(plan.adaptiveWorkflow.gates.length).toBeGreaterThan(0)
  })

  it('escalates to critical profile for auth/security task with high uncertainty', async () => {
    const projectDir = makeDir('scale-ai-os-critical-profile-project-')
    const scaleDir = makeScaleDir('scale-ai-os-critical-profile-scale-')

    const plan = await createAiOsPlan({
      projectDir,
      scaleDir,
      taskId: 'TASK-PROFILE-CRITICAL',
      task: 'Fix OAuth token refresh race condition causing auth bypass in production',
      level: 'L',
      files: ['src/auth/oauth.ts', 'src/auth/token.ts'],
      budget: 2400,
    })

    expect(['strict', 'critical']).toContain(plan.adaptiveWorkflow.profile)
    expect(plan.adaptiveWorkflow.escalationReasons.length).toBeGreaterThan(0)
    expect(plan.adaptiveWorkflow.gates.length).toBeGreaterThan(0)
  })

  it('includes adaptive-workflow signal in intelligence report', async () => {
    const projectDir = makeDir('scale-ai-os-aw-signal-project-')
    const scaleDir = makeScaleDir('scale-ai-os-aw-signal-scale-')

    const run = await createAiOsRun({
      projectDir,
      scaleDir,
      taskId: 'TASK-PROFILE-SIGNAL',
      task: 'Refactor user service',
      level: 'M',
      files: ['src/services/user.ts'],
      mode: 'dry-run',
    })

    const status = createAiOsStatus({ projectDir, scaleDir, lang: 'en' })
    const awSignal = status.intelligence.signals.find(s => s.id === 'adaptive-workflow')

    expect(awSignal).toBeDefined()
    expect(awSignal!.status).toBe('ready')
    expect(awSignal!.evidence.length).toBeGreaterThan(0)
  }, 120_000)

  it('includes workflowProfile in benchmark scenario metrics', async () => {
    const projectDir = makeDir('scale-ai-os-aw-bench-project-')
    const scaleDir = makeScaleDir('scale-ai-os-aw-bench-scale-')

    await createAiOsRun({
      projectDir,
      scaleDir,
      taskId: 'TASK-PROFILE-BENCH',
      task: 'Add rate limiting to API endpoints',
      level: 'M',
      files: ['src/api/middleware.ts'],
      mode: 'dry-run',
    })
    const benchmark = await createAiOsBenchmark({ projectDir, scaleDir })

    expect(benchmark.summary.workflowProfiles).toBeDefined()
    expect(benchmark.summary.workflowProfiles.length).toBeGreaterThan(0)
    expect(benchmark.scenarios.every(s => s.workflowProfile)).toBe(true)
  }, 120_000)

  it('generates evolution shadow proposals from high-risk governance signals', async () => {
    const projectDir = makeDir('scale-ai-os-evo-shadow-project-')
    const scaleDir = makeScaleDir('scale-ai-os-evo-shadow-scale-')

    const plan = await createAiOsPlan({
      projectDir,
      scaleDir,
      taskId: 'TASK-EVO-SHADOW',
      task: 'Fix OAuth token refresh race condition causing auth bypass in production',
      level: 'L',
      files: ['src/auth/oauth.ts', 'src/auth/token.ts'],
      budget: 2400,
    })

    expect(plan.evolutionShadow).toBeDefined()
    expect(plan.evolutionShadow.strategy).toBe('evolution-shadow-promotion-v1')
    expect(plan.evolutionShadow.proposals.length).toBeGreaterThan(0)
    expect(plan.evolutionShadow.proposals[0].sourceEvidenceIds.length).toBeGreaterThan(0)
    expect(plan.evolutionShadow.summary.shadowRules).toBe(plan.evolutionShadow.proposals.length)
    expect(plan.evolutionShadow.summary.pendingValidation).toBe(plan.evolutionShadow.proposals.length)
  })

  it('produces no evolution shadow proposals for low-risk tasks', async () => {
    const projectDir = makeDir('scale-ai-os-evo-none-project-')
    const scaleDir = makeScaleDir('scale-ai-os-evo-none-scale-')

    const plan = await createAiOsPlan({
      projectDir,
      scaleDir,
      taskId: 'TASK-EVO-NONE',
      task: 'Update README with usage examples',
      level: 'S',
      files: ['README.md'],
      budget: 60,
    })

    expect(plan.evolutionShadow.summary.totalProposals).toBe(0)
    expect(plan.evolutionShadow.summary.pendingValidation).toBe(0)
  })

  it('includes evolution-shadow signal in intelligence report', async () => {
    const projectDir = makeDir('scale-ai-os-evo-signal-project-')
    const scaleDir = makeScaleDir('scale-ai-os-evo-signal-scale-')

    await createAiOsRun({
      projectDir,
      scaleDir,
      taskId: 'TASK-EVO-SIGNAL',
      task: 'Critical release migration requires security threat model',
      level: 'CRITICAL',
      files: ['src/auth/migration.ts'],
      mode: 'dry-run',
    })

    const status = createAiOsStatus({ projectDir, scaleDir, lang: 'en' })
    const evoSignal = status.intelligence.signals.find(s => s.id === 'evolution-shadow')

    expect(evoSignal).toBeDefined()
    expect(evoSignal!.status).toBeDefined()
    expect(evoSignal!.evidence.length).toBeGreaterThan(0)
    expect(status.intelligence.summary.evolutionQuality).toBeDefined()
    expect(status.intelligence.summary.evolutionQuality.proposals).toBeGreaterThanOrEqual(0)
  }, 120_000)

  it('includes evolution proposals in benchmark summary', async () => {
    const projectDir = makeDir('scale-ai-os-evo-bench-project-')
    const scaleDir = makeScaleDir('scale-ai-os-evo-bench-scale-')

    await createAiOsRun({
      projectDir,
      scaleDir,
      taskId: 'TASK-EVO-BENCH',
      task: 'Security audit for auth bypass vulnerability',
      level: 'L',
      files: ['src/auth/session.ts'],
      mode: 'dry-run',
    })
    const benchmark = await createAiOsBenchmark({ projectDir, scaleDir })

    expect(benchmark.summary.totalEvolutionProposals).toBeGreaterThanOrEqual(0)
    expect(benchmark.scenarios.every(s => typeof s.metrics.evolutionProposals === 'number')).toBe(true)
  }, 120_000)
})
