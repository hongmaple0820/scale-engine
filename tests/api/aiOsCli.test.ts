import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SCALE_ENGINE_VERSION } from '../../src/version.js'
import { defaultMemoryProvidersConfig } from '../../src/memory/MemoryProviders.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

async function runScale(args: string[], scaleDir: string, projectDir: string) {
  writeTestMemoryProviderConfig(scaleDir)
  return execa('node', ['--import', 'tsx', 'src/api/cli.ts', ...args], {
    env: {
      ...process.env,
      SCALE_DIR: scaleDir,
      SCALE_PROJECT_DIR: projectDir,
      SCALE_LOG_LEVEL: undefined,
    },
    reject: false,
  })
}

function writeTestMemoryProviderConfig(scaleDir: string): void {
  const config = defaultMemoryProvidersConfig()
  config.providers = config.providers.map(provider => ({
    ...provider,
    enabled: provider.kind === 'gbrain',
  }))
  writeFileSync(join(scaleDir, 'memory-providers.json'), JSON.stringify(config, null, 2), 'utf-8')
}

function parseJson<T>(stdout: string): T {
  return JSON.parse(stdout) as T
}

describe('ai-os CLI', () => {
  it('prints a direct agent collaboration plan as JSON', async () => {
    const scaleDir = makeDir('scale-agent-plan-cli-scale-')
    const projectDir = makeDir('scale-agent-plan-cli-project-')

    const result = await runScale([
      'agent',
      'plan',
      '--task-id',
      'TASK-AGENT-PLAN-CLI',
      '--task',
      'Implement Vue dashboard knowledge graph zoom and security reviewed export flow',
      '--level',
      'L',
      '--files',
      'dashboard/web/src/App.vue,src/dashboard/DashboardServer.ts',
      '--budget',
      '3600',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const report = parseJson<{
      task: { taskId: string }
      governance: { effectiveMode: string; workflowProfile: string; evaluatorRisk: string }
      agentCollaboration: {
        strategy: string
        mode: string
        roles: Array<{ profileId: string; responsibility: string; required: boolean }>
        reviewGates: Array<{ id: string; owner: string; required: boolean }>
        budget: { totalTokens: number; assignedTokens: number; reserveTokens: number }
        summary: { totalRoles: number; reviewGateCount: number; multiAgentRecommended: boolean }
      }
    }>(result.stdout)

    expect(report.task.taskId).toBe('TASK-AGENT-PLAN-CLI')
    expect(report.agentCollaboration.strategy).toBe('agent-collaboration-v1')
    expect(report.agentCollaboration.mode).toMatch(/multi-agent|review-escalated/)
    expect(report.agentCollaboration.roles).toEqual(expect.arrayContaining([
      expect.objectContaining({ profileId: 'frontend-agent', required: true }),
      expect.objectContaining({ profileId: 'security-agent', required: true }),
      expect.objectContaining({ profileId: 'test-agent', required: true }),
    ]))
    expect(report.agentCollaboration.reviewGates.length).toBeGreaterThan(0)
    expect(report.agentCollaboration.budget.assignedTokens).toBeGreaterThan(0)
    expect(report.agentCollaboration.summary.multiAgentRecommended).toBe(true)
  }, 120_000)

  it('prints a unified AI OS runtime plan as JSON', async () => {
    const scaleDir = makeDir('scale-ai-os-cli-scale-')
    const projectDir = makeDir('scale-ai-os-cli-project-')

    const result = await runScale([
      'ai-os',
      'plan',
      '--task-id',
      'TASK-AI-OS-CLI',
      '--task',
      'Review auth token and browser callback flow',
      '--level',
      'L',
      '--files',
      'src/auth/token.ts,src/ui/callback.tsx',
      '--budget',
      '2400',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const report = parseJson<{
      version: string
      task: { taskId: string }
      governance: { effectiveMode: string }
      context: { compiler?: { strategy: string } }
      memory: { providerOrder: string[] }
      skillPlan: { executionPlan: { steps: Array<{ kind: string; id: string }> } }
      agentCollaboration: {
        strategy: string
        roles: Array<{ profileId: string; required: boolean }>
        reviewGates: Array<{ id: string; required: boolean }>
        summary: { totalRoles: number; reviewGateCount: number }
      }
      roi: { modules: Array<{ module: string }> }
    }>(result.stdout)
    expect(report.version).toBe(SCALE_ENGINE_VERSION)
    expect(report.task.taskId).toBe('TASK-AI-OS-CLI')
    expect(report.governance.effectiveMode).toBe('critical')
    expect(report.context.compiler?.strategy).toBe('relevance-budget-v1')
    expect(report.memory.providerOrder).toEqual(['gbrain'])
    expect(report.skillPlan.executionPlan.steps.length).toBeGreaterThan(0)
    expect(report.agentCollaboration.strategy).toBe('agent-collaboration-v1')
    expect(report.agentCollaboration.roles).toEqual(expect.arrayContaining([
      expect.objectContaining({ profileId: 'security-agent', required: true }),
      expect.objectContaining({ profileId: 'test-agent', required: true }),
    ]))
    expect(report.agentCollaboration.summary.totalRoles).toBeGreaterThan(0)
    expect(report.agentCollaboration.summary.reviewGateCount).toBeGreaterThan(0)
    expect(report.roi.modules).toEqual(expect.arrayContaining([
      expect.objectContaining({ module: 'context-compiler' }),
      expect.objectContaining({ module: 'skill-routing-engine' }),
    ]))
  }, 120_000)

  it('runs a dry-run AI OS execution loop as JSON', async () => {
    const scaleDir = makeDir('scale-ai-os-run-cli-scale-')
    const projectDir = makeDir('scale-ai-os-run-cli-project-')

    const result = await runScale([
      'ai-os',
      'run',
      '--task-id',
      'TASK-AI-OS-RUN-CLI',
      '--task',
      'Review auth token and browser callback flow',
      '--level',
      'L',
      '--files',
      'src/auth/token.ts,src/ui/callback.tsx',
      '--budget',
      '2400',
      '--dry-run',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const report = parseJson<{
      mode: string
      dryRun: boolean
      status: string
      plan: { task: { taskId: string }; agentCollaboration: { summary: { totalRoles: number } } }
      agentExecution: { status: string; summary: { totalRoles: number; settledRoles: number; settledReviewGates: number }; evidence: { pending: string[] } }
      steps: Array<{ id: string; status: string; kind: string }>
      evidence: { required: string[] }
      artifacts: { runReport: string }
      nextActions: string[]
    }>(result.stdout)
    expect(report.mode).toBe('dry-run')
    expect(report.dryRun).toBe(true)
    expect(report.status).toBe('ready')
    expect(report.plan.task.taskId).toBe('TASK-AI-OS-RUN-CLI')
    expect(report.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'runtime-plan', status: 'passed' }),
      expect.objectContaining({ id: 'agent-collaboration-plan', status: 'passed', kind: 'agent' }),
      expect.objectContaining({ id: 'runtime-evidence', status: 'planned' }),
    ]))
    expect(report.plan.agentCollaboration.summary.totalRoles).toBeGreaterThan(0)
    expect(report.agentExecution.status).toBe('planned')
    expect(report.agentExecution.summary.totalRoles).toBe(report.plan.agentCollaboration.summary.totalRoles)
    expect(report.agentExecution.summary.settledRoles).toBe(0)
    expect(report.agentExecution.summary.settledReviewGates).toBe(0)
    expect(report.agentExecution.evidence.pending.length).toBeGreaterThan(0)
    expect(report.evidence.required).toContain('agent-collaboration')
    expect(report.evidence.required).toContain('skill-routing-engine')
    expect(report.artifacts.runReport).toContain('TASK-AI-OS-RUN-CLI')
    expect(report.nextActions.length).toBeGreaterThan(0)
  }, 120_000)

  it('runs guarded verification commands and records runtime evidence as JSON', async () => {
    const scaleDir = makeDir('scale-ai-os-guarded-cli-scale-')
    const projectDir = makeDir('scale-ai-os-guarded-cli-project-')

    const result = await runScale([
      'ai-os',
      'run',
      '--task-id',
      'TASK-AI-OS-GUARDED-CLI',
      '--task',
      'Verify guarded AI OS CLI execution evidence',
      '--level',
      'M',
      '--files',
      'src/runtime/AiOsRuntime.ts',
      '--budget',
      '2400',
      '--mode',
      'guarded',
      '--verify',
      'node -e "process.stdout.write(\'ok\')"',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const report = parseJson<{
      mode: string
      status: string
      agentExecution: { status: string; summary: { totalRoles: number; settledRoles: number; producedEvidence: number }; evidence: { produced: string[] } }
      verification: { commands: Array<{ status: string; exitCode: number; evidenceId: string }> }
      evidence: { produced: string[] }
      steps: Array<{ id: string; status: string }>
    }>(result.stdout)
    expect(report.mode).toBe('guarded')
    expect(report.status).toBe('ready')
    expect(report.verification.commands).toEqual([
      expect.objectContaining({ status: 'passed', exitCode: 0 }),
    ])
    expect(report.verification.commands[0].evidenceId).toMatch(/^RTE-/)
    expect(report.agentExecution.status).toBe('settled')
    expect(report.agentExecution.summary.settledRoles).toBe(report.agentExecution.summary.totalRoles)
    expect(report.agentExecution.summary.producedEvidence).toBeGreaterThan(0)
    expect(report.agentExecution.evidence.produced[0]).toMatch(/^RTE-/)
    expect(report.evidence.produced).toContain('runtime-evidence')
    expect(report.evidence.produced).toContain('agent-collaboration')
    expect(report.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'verify-command:1', status: 'passed' }),
    ]))
  }, 120_000)

  it('returns a blocked JSON report and non-zero exit code when guarded verification fails', async () => {
    const scaleDir = makeDir('scale-ai-os-guarded-fail-cli-scale-')
    const projectDir = makeDir('scale-ai-os-guarded-fail-cli-project-')

    const result = await runScale([
      'ai-os',
      'run',
      '--task-id',
      'TASK-AI-OS-GUARDED-FAIL-CLI',
      '--task',
      'Verify guarded AI OS CLI failure handling',
      '--level',
      'M',
      '--files',
      'src/runtime/AiOsRuntime.ts',
      '--mode',
      'guarded',
      '--verify',
      'node -e "process.exit(7)"',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(1)
    const report = parseJson<{
      status: string
      agentExecution: { status: string; summary: { blockedRoles: number; settledRoles: number } }
      verification: { commands: Array<{ status: string; exitCode: number }> }
      failureLearning: { status: string; candidates: unknown[] }
    }>(result.stdout)
    expect(report.status).toBe('blocked')
    expect(report.agentExecution.status).toBe('blocked')
    expect(report.agentExecution.summary.blockedRoles).toBeGreaterThan(0)
    expect(report.agentExecution.summary.settledRoles).toBe(0)
    expect(report.verification.commands[0]).toEqual(expect.objectContaining({ status: 'failed', exitCode: 7 }))
    expect(report.failureLearning.status).toBe('candidate-created')
    expect(report.failureLearning.candidates.length).toBeGreaterThan(0)
  }, 120_000)

  it('prints AI OS dashboard summary as JSON', async () => {
    const scaleDir = makeDir('scale-ai-os-dashboard-cli-scale-')
    const projectDir = makeDir('scale-ai-os-dashboard-cli-project-')

    await runScale([
      'ai-os',
      'run',
      '--task-id',
      'TASK-AI-OS-DASH-CLI-READY',
      '--task',
      'Verify ready dashboard CLI run',
      '--level',
      'M',
      '--files',
      'src/runtime/AiOsRuntime.ts',
      '--mode',
      'guarded',
      '--verify',
      'node -v',
      '--json',
    ], scaleDir, projectDir)
    await runScale([
      'ai-os',
      'run',
      '--task-id',
      'TASK-AI-OS-DASH-CLI-BLOCKED',
      '--task',
      'Verify blocked dashboard CLI run',
      '--level',
      'M',
      '--files',
      'src/runtime/AiOsRuntime.ts',
      '--mode',
      'guarded',
      '--verify',
      'node definitely-missing-scale-dashboard-cli-file.js',
      '--json',
    ], scaleDir, projectDir)

    const result = await runScale(['ai-os', 'dashboard', '--json'], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const dashboard = parseJson<{
      summary: {
        totalRuns: number
        readyRuns: number
        blockedRuns: number
        failedVerificationCommands: number
        failureLearningCandidates: number
      }
      health: { status: string }
      latestRuns: Array<{ taskId: string; status: string }>
    }>(result.stdout)
    expect(dashboard.summary).toMatchObject({
      totalRuns: 2,
      readyRuns: 1,
      blockedRuns: 1,
      failedVerificationCommands: 1,
      failureLearningCandidates: 1,
    })
    expect(dashboard.health.status).toBe('attention')
    expect(dashboard.latestRuns[0]).toMatchObject({ taskId: 'TASK-AI-OS-DASH-CLI-BLOCKED', status: 'blocked' })
  }, 120_000)

  it('prints AI OS benchmark metrics as JSON', async () => {
    const scaleDir = makeDir('scale-ai-os-benchmark-cli-scale-')
    const projectDir = makeDir('scale-ai-os-benchmark-cli-project-')

    await runScale([
      'ai-os',
      'run',
      '--task-id',
      'TASK-AI-OS-BENCH-CLI-RUN',
      '--task',
      'Verify benchmark CLI dashboard input',
      '--level',
      'M',
      '--files',
      'src/runtime/AiOsRuntime.ts',
      '--mode',
      'guarded',
      '--verify',
      'node -v',
      '--json',
    ], scaleDir, projectDir)

    const result = await runScale(['ai-os', 'benchmark', '--json'], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const benchmark = parseJson<{
      summary: {
        scenarios: number
        totalEstimatedTokens: number
        totalSkillSteps: number
        totalAgentRoles: number
        totalAgentReviewGates: number
        multiAgentScenarios: number
        governanceModes: string[]
      }
      dashboard: { summary: { totalRuns: number } }
      artifacts: { benchmarkReport: string }
      scenarios: Array<{ id: string; metrics: { skillSteps: number; agentRoles: number; agentReviewGates: number } }>
    }>(result.stdout)
    expect(benchmark.summary.scenarios).toBeGreaterThanOrEqual(3)
    expect(benchmark.summary.totalEstimatedTokens).toBeGreaterThanOrEqual(0)
    expect(benchmark.summary.totalSkillSteps).toBeGreaterThan(0)
    expect(benchmark.summary.totalAgentRoles).toBeGreaterThan(0)
    expect(benchmark.summary.totalAgentReviewGates).toBeGreaterThan(0)
    expect(benchmark.summary.multiAgentScenarios).toBeGreaterThan(0)
    expect(benchmark.summary.governanceModes.length).toBeGreaterThan(0)
    expect(benchmark.dashboard.summary.totalRuns).toBe(1)
    expect(benchmark.artifacts.benchmarkReport).toContain('benchmarks')
    expect(benchmark.scenarios.map(scenario => scenario.id)).toEqual(expect.arrayContaining([
      'docs-governance',
      'security-code-change',
      'browser-ui-flow',
    ]))
  }, 120_000)

  it('prints AI OS migration status as JSON', async () => {
    const scaleDir = makeDir('scale-ai-os-migrate-cli-scale-')
    const projectDir = makeDir('scale-ai-os-migrate-cli-project-')

    const result = await runScale(['ai-os', 'migrate', '--json'], scaleDir, projectDir)
    const second = await runScale(['ai-os', 'migrate', '--json'], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    expect(second.exitCode).toBe(0)
    const firstReport = parseJson<{
      status: string
      created: string[]
      files: { migrationReport: string }
    }>(result.stdout)
    const secondReport = parseJson<{ status: string; created: string[] }>(second.stdout)
    expect(firstReport.status).toBe('migrated')
    expect(firstReport.created).toEqual(expect.arrayContaining([
      expect.stringContaining('ai-os/runs'),
      expect.stringContaining('ai-os/benchmarks'),
    ]))
    expect(firstReport.files.migrationReport).toContain('migration.json')
    expect(secondReport.status).toBe('compatible')
    expect(secondReport.created).toEqual([])
  }, 120_000)

  it('prints AI OS doctor readiness as JSON with bilingual next actions', async () => {
    const scaleDir = makeDir('scale-ai-os-doctor-cli-scale-')
    const projectDir = makeDir('scale-ai-os-doctor-cli-project-')

    const blocked = await runScale(['ai-os', 'doctor', '--json', '--lang', 'zh'], scaleDir, projectDir)

    expect(blocked.exitCode).toBe(1)
    const blockedReport = parseJson<{
      status: string
      nextActions: string[]
    }>(blocked.stdout)
    expect(blockedReport.status).toBe('blocked')
    expect(blockedReport.nextActions).toEqual(expect.arrayContaining([
      expect.stringContaining('scale ai-os migrate'),
    ]))

    await runScale(['ai-os', 'migrate', '--json'], scaleDir, projectDir)
    await runScale([
      'ai-os',
      'run',
      '--task-id',
      'TASK-AI-OS-DOCTOR-CLI',
      '--task',
      'Verify AI OS doctor CLI readiness',
      '--level',
      'M',
      '--files',
      'src/runtime/AiOsRuntime.ts',
      '--mode',
      'guarded',
      '--verify',
      'node -v',
      '--json',
    ], scaleDir, projectDir)
    await runScale(['ai-os', 'benchmark', '--json'], scaleDir, projectDir)

    const ready = await runScale(['ai-os', 'doctor', '--json', '--lang', 'en'], scaleDir, projectDir)

    expect(ready.exitCode).toBe(0)
    const readyReport = parseJson<{
      status: string
      summary: { blockedChecks: number }
      nextActions: string[]
    }>(ready.stdout)
    expect(readyReport.status).toBe('ready')
    expect(readyReport.summary.blockedChecks).toBe(0)
    expect(readyReport.nextActions).toContain('AI OS beta runtime is ready for guarded project tasks.')
  }, 120_000)

  it('prints AI OS adoption report as JSON and prepares a project for guarded use', async () => {
    const scaleDir = makeDir('scale-ai-os-adopt-cli-scale-')
    const projectDir = makeDir('scale-ai-os-adopt-cli-project-')

    const result = await runScale([
      'ai-os',
      'adopt',
      '--task-id',
      'TASK-AI-OS-ADOPT-CLI',
      '--task',
      'Adopt AI OS runtime from the CLI',
      '--level',
      'M',
      '--files',
      'src/runtime/AiOsRuntime.ts',
      '--budget',
      '2400',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const report = parseJson<{
      status: string
      phases: Array<{ id: string; status: string }>
      run: { mode: string }
      doctor: { status: string }
      artifacts: { adoptionReport: string }
      nextActions: string[]
    }>(result.stdout)
    expect(report.status).toBe('ready')
    expect(report.phases.map(phase => phase.id)).toEqual(['migrate', 'first-run', 'benchmark', 'doctor'])
    expect(report.phases.every(phase => phase.status === 'passed')).toBe(true)
    expect(report.run.mode).toBe('dry-run')
    expect(report.doctor.status).toBe('ready')
    expect(report.artifacts.adoptionReport).toContain('adoption.json')
    expect(report.nextActions).toEqual(expect.arrayContaining([
      expect.stringContaining('scale ai-os run --mode guarded'),
    ]))
  }, 120_000)

  it('prints localized AI OS adoption guidance for humans', async () => {
    const zhScaleDir = makeDir('scale-ai-os-adopt-zh-cli-scale-')
    const zhProjectDir = makeDir('scale-ai-os-adopt-zh-cli-project-')
    const enScaleDir = makeDir('scale-ai-os-adopt-en-cli-scale-')
    const enProjectDir = makeDir('scale-ai-os-adopt-en-cli-project-')

    const zh = await runScale([
      'ai-os',
      'adopt',
      '--task-id',
      'TASK-AI-OS-ADOPT-ZH-CLI',
      '--task',
      '接入 AI OS 运行态',
      '--files',
      'src/runtime/AiOsRuntime.ts',
      '--lang',
      'zh',
    ], zhScaleDir, zhProjectDir)

    expect(zh.exitCode).toBe(0)
    expect(zh.stdout).toContain('SCALE AI OS 接入')
    expect(zh.stdout).toContain('状态: ready')
    expect(zh.stdout).toContain('首次运行: ready (dry-run)')
    expect(zh.stdout).toContain('下一步:')
    expect(zh.stdout).toContain('scale ai-os run --mode guarded')

    const en = await runScale([
      'ai-os',
      'adopt',
      '--task-id',
      'TASK-AI-OS-ADOPT-EN-CLI',
      '--task',
      'Adopt AI OS runtime',
      '--files',
      'src/runtime/AiOsRuntime.ts',
      '--lang',
      'en',
    ], enScaleDir, enProjectDir)

    expect(en.exitCode).toBe(0)
    expect(en.stdout).toContain('SCALE AI OS Adoption')
    expect(en.stdout).toContain('Status: ready')
    expect(en.stdout).toContain('First run: ready (dry-run)')
    expect(en.stdout).toContain('next:')
  }, 120_000)

  it('prints AI OS closed-loop status as JSON and localized human guidance', async () => {
    const scaleDir = makeDir('scale-ai-os-status-cli-scale-')
    const projectDir = makeDir('scale-ai-os-status-cli-project-')

    const empty = await runScale(['ai-os', 'status', '--dir', projectDir, '--json', '--lang', 'zh'], scaleDir, projectDir)

    expect(empty.exitCode).toBe(1)
    const emptyReport = parseJson<{
      status: string
      summary: { total: number; blocked: number }
      nextActions: string[]
    }>(empty.stdout)
    expect(emptyReport.status).toBe('blocked')
    expect(emptyReport.summary).toMatchObject({ total: 7, blocked: 7 })
    expect(emptyReport.nextActions).toEqual(expect.arrayContaining([
      expect.stringContaining('scale ai-os adopt'),
    ]))

    await runScale([
      'ai-os',
      'adopt',
      '--task-id',
      'TASK-AI-OS-STATUS-CLI',
      '--task',
      'Adopt AI OS runtime for status CLI',
      '--files',
      'src/runtime/AiOsRuntime.ts',
      '--json',
    ], scaleDir, projectDir)
    await runScale([
      'ai-os',
      'run',
      '--task-id',
      'TASK-AI-OS-STATUS-CLI-GUARDED',
      '--task',
      'Verify status CLI guarded evidence',
      '--files',
      'src/runtime/AiOsRuntime.ts',
      '--mode',
      'guarded',
      '--verify',
      'node -v',
      '--json',
    ], scaleDir, projectDir)

    const readyJson = await runScale(['ai-os', 'status', '--dir', projectDir, '--json', '--lang', 'en'], scaleDir, projectDir)
    expect(readyJson.exitCode).toBe(0)
    const readyReport = parseJson<{
      status: string
      summary: { blocked: number }
      intelligence: {
        signals: Array<{ id: string; status: string }>
        summary: {
          skillSteps: number
          memoryQuality: { score: number }
          contextQuality: { compressionRisk: string }
          evaluatorQuality: { requiredGates: number; averageUncertainty: number }
          toolStrategyQuality: { totalSteps: number; fallbackCoverage: number }
          agentCollaborationQuality: { totalRoles: number; reviewGates: number; settledRoles: number; settledReviewGates: number; settledRuns: number; multiAgentRuns: number }
          agentLoopQuality: { status: string; score: number; readySignals: number }
        }
      }
      nextActions: string[]
    }>(readyJson.stdout)
    expect(readyReport.status).toBe('ready')
    expect(readyReport.summary.blocked).toBe(0)
    expect(readyReport.intelligence.signals.map(signal => signal.id)).toEqual([
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
    expect(readyReport.intelligence.summary.skillSteps).toBeGreaterThan(0)
    expect(readyReport.intelligence.summary.memoryQuality.score).toEqual(expect.any(Number))
    expect(readyReport.intelligence.summary.contextQuality.compressionRisk).toEqual(expect.any(String))
    expect(readyReport.intelligence.summary.evaluatorQuality.requiredGates).toBeGreaterThan(0)
    expect(readyReport.intelligence.summary.toolStrategyQuality.totalSteps).toBeGreaterThan(0)
    expect(readyReport.intelligence.summary.toolStrategyQuality.fallbackCoverage).toBe(1)
    expect(readyReport.intelligence.summary.agentCollaborationQuality.totalRoles).toBeGreaterThan(0)
    expect(readyReport.intelligence.summary.agentCollaborationQuality.reviewGates).toBeGreaterThan(0)
    expect(readyReport.intelligence.summary.agentCollaborationQuality.settledRoles).toBeGreaterThan(0)
    expect(readyReport.intelligence.summary.agentCollaborationQuality.settledReviewGates).toBeGreaterThan(0)
    expect(readyReport.intelligence.summary.agentCollaborationQuality.settledRuns).toBeGreaterThan(0)
    expect(readyReport.intelligence.summary.agentLoopQuality.status).toBe('ready')
    expect(readyReport.intelligence.summary.agentLoopQuality.readySignals).toBe(6)
    expect(readyReport.nextActions).toContain('AI OS closed loop is ready for guarded project work.')

    const readyHuman = await runScale(['ai-os', 'status', '--dir', projectDir, '--lang', 'zh'], scaleDir, projectDir)
    expect(readyHuman.exitCode).toBe(0)
    expect(readyHuman.stdout).toContain('SCALE AI OS 状态')
    expect(readyHuman.stdout).toContain('状态: ready')
    expect(readyHuman.stdout).toContain('Intelligence:')
    expect(readyHuman.stdout).toContain('Context risk:')
    expect(readyHuman.stdout).toContain('Evaluator gates:')
    expect(readyHuman.stdout).toContain('Tool strategy:')
    expect(readyHuman.stdout).toContain('Agent collaboration:')
    expect(readyHuman.stdout).toContain('Agent Loop:')
    expect(readyHuman.stdout).toContain('memory-recall')
    expect(readyHuman.stdout).toContain('skill-routing')
    expect(readyHuman.stdout).toContain('evaluator-intelligence')
    expect(readyHuman.stdout).toContain('tool-strategy')
    expect(readyHuman.stdout).toContain('agent-collaboration')
    expect(readyHuman.stdout).toContain('agent-loop-readiness')
    expect(readyHuman.stdout).toContain('[ready] verification-evidence')
  }, 120_000)

  it('prints concrete verification recommendations in AI OS status output', async () => {
    const scaleDir = makeDir('scale-ai-os-status-recommend-cli-scale-')
    const projectDir = makeDir('scale-ai-os-status-recommend-cli-project-')
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

    await runScale([
      'ai-os',
      'adopt',
      '--task-id',
      'TASK-AI-OS-STATUS-RECOMMEND-CLI',
      '--task',
      'Adopt AI OS runtime for status recommendation CLI',
      '--files',
      'src/runtime/AiOsRuntime.ts',
      '--json',
    ], scaleDir, projectDir)

    const status = await runScale(['ai-os', 'status', '--dir', projectDir, '--lang', 'en'], scaleDir, projectDir)

    expect(status.exitCode).toBe(1)
    expect(status.stdout).toContain('Verification recommendations:')
    expect(status.stdout).toContain('npm run build')
    expect(status.stdout).toContain('npm run lint')
    expect(status.stdout).toContain('npm test')
  }, 120_000)
})
