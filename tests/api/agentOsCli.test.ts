import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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

async function runScale(args: string[], scaleDir: string, projectDir: string) {
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

function parseJson<T>(stdout: string): T {
  return JSON.parse(stdout) as T
}

describe('Agent OS CLI', () => {
  it('runs durable task lifecycle commands and records explicit completion evidence', async () => {
    const projectDir = makeDir('scale-agent-os-cli-project-')
    const scaleDir = join(projectDir, '.scale')

    const created = await runScale([
      'task',
      'create',
      'Agent OS lifecycle',
      '--task-id',
      'TASK-CLI-OS',
      '--level',
      'L',
      '--files',
      'src/os/AgentOsTaskStore.ts',
      '--json',
    ], scaleDir, projectDir)
    expect(created.exitCode).toBe(0)
    expect(parseJson<{ taskId: string; status: string }>(created.stdout)).toMatchObject({
      taskId: 'TASK-CLI-OS',
      status: 'created',
    })

    const started = await runScale([
      'task',
      'start',
      'TASK-CLI-OS',
      '--run-id',
      'RUN-CLI-OS',
      '--agent',
      'codex',
      '--json',
    ], scaleDir, projectDir)
    expect(started.exitCode).toBe(0)
    expect(parseJson<{ runId: string; status: string }>(started.stdout)).toMatchObject({
      runId: 'RUN-CLI-OS',
      status: 'running',
    })

    const checkpoint = await runScale([
      'task',
      'checkpoint',
      'TASK-CLI-OS',
      '--summary',
      'kernel done',
      '--completed',
      'kernel',
      '--remaining',
      'cli,tests',
      '--json',
    ], scaleDir, projectDir)
    expect(checkpoint.exitCode).toBe(0)
    const checkpointJson = parseJson<{ checkpointId: string; resumePrompt: string }>(checkpoint.stdout)
    expect(checkpointJson.checkpointId).toMatch(/^CKP-/)
    expect(checkpointJson.resumePrompt).toContain('TASK-CLI-OS')

    const resumed = await runScale(['task', 'resume', 'TASK-CLI-OS', '--json'], scaleDir, projectDir)
    expect(resumed.exitCode).toBe(0)
    expect(parseJson<{ checkpoint: { checkpointId: string }; task: { status: string } }>(resumed.stdout)).toMatchObject({
      checkpoint: { checkpointId: checkpointJson.checkpointId },
      task: { status: 'running' },
    })

    const completed = await runScale([
      'task',
      'complete',
      'TASK-CLI-OS',
      '--run-id',
      'RUN-CLI-OS',
      '--summary',
      'explicit completion signal recorded',
      '--validation',
      'npm run typecheck',
      '--changed-files',
      'src/os/AgentOsTaskStore.ts',
      '--json',
    ], scaleDir, projectDir)
    expect(completed.exitCode).toBe(0)
    const completion = parseJson<{
      completion: { outcome: string; evidenceIds: string[] }
      task: { status: string }
      evidence: { id: string; kind: string; status: string }
    }>(completed.stdout)
    expect(completion.task.status).toBe('completed')
    expect(completion.completion.outcome).toBe('complete')
    expect(completion.completion.evidenceIds).toContain(completion.evidence.id)
    expect(completion.evidence).toMatchObject({ kind: 'final-report', status: 'passed' })

    const status = await runScale(['task', 'status', 'TASK-CLI-OS', '--json'], scaleDir, projectDir)
    expect(status.exitCode).toBe(0)
    const statusJson = parseJson<{ task: { status: string }; run: { status: string }; completion: { summary: string }; timeline: Array<{ kind: string; correlationId: string }> }>(status.stdout)
    expect(statusJson).toMatchObject({
      task: { status: 'completed' },
      run: { status: 'completed' },
      completion: { summary: 'explicit completion signal recorded' },
    })
    expect(statusJson.timeline.map(entry => entry.kind)).toEqual(expect.arrayContaining(['run', 'checkpoint', 'completion', 'event']))
    expect(existsSync(join(scaleDir, 'tasks', 'TASK-CLI-OS', 'task.json'))).toBe(true)
    expect(readFileSync(join(scaleDir, 'ledger', 'events.jsonl'), 'utf-8')).toContain('"task.completed"')
  }, 120_000)

  it('filters durable task lists by status, level, agent, surface, service, and file', async () => {
    const projectDir = makeDir('scale-agent-os-filter-project-')
    const scaleDir = join(projectDir, '.scale')

    await runScale([
      'task', 'create', 'CLI filter task',
      '--task-id', 'TASK-FILTER-CLI',
      '--level', 'M',
      '--files', 'src/api/cli.ts',
      '--services', 'cli',
      '--surfaces', 'cli',
      '--json',
    ], scaleDir, projectDir)
    await runScale(['task', 'start', 'TASK-FILTER-CLI', '--run-id', 'RUN-FILTER-CLI', '--agent', 'codex', '--json'], scaleDir, projectDir)
    await runScale([
      'task', 'create', 'Dashboard filter task',
      '--task-id', 'TASK-FILTER-DASH',
      '--level', 'L',
      '--files', 'src/dashboard/DashboardServer.ts',
      '--services', 'dashboard',
      '--surfaces', 'dashboard',
      '--json',
    ], scaleDir, projectDir)

    const running = await runScale(['task', 'list', '--status', 'running', '--json'], scaleDir, projectDir)
    expect(parseJson<{ tasks: Array<{ taskId: string }> }>(running.stdout).tasks.map(task => task.taskId)).toEqual(['TASK-FILTER-CLI'])

    const dashboard = await runScale([
      'task', 'list',
      '--level', 'L',
      '--service', 'dashboard',
      '--surface', 'dashboard',
      '--file', 'src/dashboard/DashboardServer.ts',
      '--json',
    ], scaleDir, projectDir)
    expect(parseJson<{ tasks: Array<{ taskId: string }> }>(dashboard.stdout).tasks.map(task => task.taskId)).toEqual(['TASK-FILTER-DASH'])

    const agent = await runScale(['task', 'list', '--agent', 'codex', '--json'], scaleDir, projectDir)
    expect(parseJson<{ tasks: Array<{ taskId: string }> }>(agent.stdout).tasks.map(task => task.taskId)).toEqual(['TASK-FILTER-CLI'])
  }, 120_000)

  it('prints capability descriptors with policy, approval, evidence, and parity metadata', async () => {
    const projectDir = makeDir('scale-agent-os-cap-project-')
    const scaleDir = join(projectDir, '.scale')
    mkdirSync(join(projectDir, '.agents', 'skills', 'frontend-design'), { recursive: true })
    writeFileSync(join(projectDir, '.agents', 'skills', 'frontend-design', 'SKILL.md'), '---\nname: frontend-design\n---\n', 'utf-8')

    const result = await runScale([
      'capability',
      'list',
      '--capabilities',
      'frontend-design',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const report = parseJson<{
      ok: boolean
      summary: { available: number; total: number }
      descriptors: Array<{ id: string; status: string; trust: string; requiredEvidence: string[]; operations: Array<{ id: string }> }>
      parity: Array<{ agentTool: string }>
    }>(result.stdout)
    expect(report.ok).toBe(true)
    expect(report.summary).toMatchObject({ available: 1, total: 1 })
    expect(report.descriptors[0]).toMatchObject({
      id: 'frontend-design',
      status: 'available',
      trust: 'trusted',
      requiredEvidence: ['skill-loaded', 'task-artifact', 'verification-note'],
    })
    expect(report.descriptors[0].operations.map(operation => operation.id)).toEqual(['inspect', 'read_skill'])
    expect(report.parity.map(item => item.agentTool)).toContain('capability_list')
  }, 120_000)

  it('registers, trusts, and disables project-scoped Agent OS capabilities', async () => {
    const projectDir = makeDir('scale-agent-os-cap-reg-project-')
    const scaleDir = join(projectDir, '.scale')

    const registered = await runScale([
      'capability',
      'register',
      'im-bridge',
      '--kind',
      'connector',
      '--display-name',
      'IM Bridge',
      '--trust',
      'restricted',
      '--side-effects',
      'read,write,network',
      '--evidence',
      'bridge-registration,heartbeat',
      '--project-refs',
      'cc-connect',
      '--required-for',
      'remote-session',
      '--json',
    ], scaleDir, projectDir)
    expect(registered.exitCode).toBe(0)
    expect(parseJson<{ id: string; kind: string; trust: string; projectRefs: string[] }>(registered.stdout)).toMatchObject({
      id: 'im-bridge',
      kind: 'connector',
      trust: 'restricted',
      projectRefs: ['cc-connect'],
    })

    const trusted = await runScale(['capability', 'trust', 'im-bridge', 'trusted', '--json'], scaleDir, projectDir)
    expect(trusted.exitCode).toBe(0)
    expect(parseJson<{ trust: string; policyEnabled: boolean }>(trusted.stdout)).toMatchObject({
      trust: 'trusted',
      policyEnabled: true,
    })

    const disabled = await runScale(['capability', 'disable', 'im-bridge', '--reason', 'bridge token rotated', '--json'], scaleDir, projectDir)
    expect(disabled.exitCode).toBe(0)
    expect(parseJson<{ status: string; policyEnabled: boolean; missingReason: string }>(disabled.stdout)).toMatchObject({
      status: 'disabled',
      policyEnabled: false,
      missingReason: 'bridge token rotated',
    })

    const list = await runScale(['capability', 'list', '--capabilities', 'im-bridge', '--json'], scaleDir, projectDir)
    expect(list.exitCode).toBe(0)
    const report = parseJson<{ descriptors: Array<{ id: string; status: string; source: string }> }>(list.stdout)
    expect(report.descriptors).toEqual([
      expect.objectContaining({
        id: 'im-bridge',
        status: 'disabled',
        source: 'project capability registry',
      }),
    ])
  }, 120_000)

  it('registers and heartbeats Agent OS bridges from the CLI', async () => {
    const projectDir = makeDir('scale-agent-os-bridge-cli-project-')
    const scaleDir = join(projectDir, '.scale')

    const registered = await runScale([
      'bridge',
      'register',
      'IM Bridge',
      '--bridge-id',
      'BRIDGE-CLI-IM',
      '--kind',
      'im',
      '--endpoint',
      'https://example.test/bridge',
      '--token',
      'secret-token',
      '--scopes',
      'tasks:read,events:read,tasks:write',
      '--capabilities',
      'im-bridge',
      '--metadata-json',
      '{"projectRef":"cc-connect"}',
      '--json',
    ], scaleDir, projectDir)
    expect(registered.exitCode).toBe(0)
    const registration = parseJson<{
      bridge: { bridgeId: string; kind: string; status: string; tokenHash: string; scopes: string[]; capabilityIds: string[] }
      token: string
    }>(registered.stdout)
    expect(registration.token).toBe('secret-token')
    expect(registration.bridge).toMatchObject({
      bridgeId: 'BRIDGE-CLI-IM',
      kind: 'im',
      status: 'registered',
      scopes: ['tasks:read', 'events:read', 'tasks:write'],
      capabilityIds: ['im-bridge'],
    })
    expect(registration.bridge.tokenHash).not.toContain('secret-token')

    const heartbeat = await runScale([
      'bridge',
      'heartbeat',
      'BRIDGE-CLI-IM',
      '--token',
      'secret-token',
      '--json',
    ], scaleDir, projectDir)
    expect(heartbeat.exitCode).toBe(0)
    expect(parseJson<{ bridge: { status: string; bridgeId: string } }>(heartbeat.stdout).bridge).toMatchObject({
      bridgeId: 'BRIDGE-CLI-IM',
      status: 'online',
    })

    const list = await runScale(['bridge', 'list', '--json'], scaleDir, projectDir)
    expect(list.exitCode).toBe(0)
    expect(parseJson<{ total: number; bridges: Array<{ bridgeId: string; status: string }> }>(list.stdout)).toMatchObject({
      total: 1,
      bridges: [expect.objectContaining({ bridgeId: 'BRIDGE-CLI-IM', status: 'online' })],
    })
    expect(readFileSync(join(scaleDir, 'ledger', 'events.jsonl'), 'utf-8')).toContain('"bridge.heartbeat"')
  }, 120_000)

  it('plans, runs, and blocks governed Agent OS shell commands from the CLI', async () => {
    const projectDir = makeDir('scale-agent-os-shell-cli-project-')
    const scaleDir = join(projectDir, '.scale')

    const plan = await runScale(['shell', 'plan', 'git reset --hard HEAD', '--task-id', 'TASK-SHELL-CLI', '--json'], scaleDir, projectDir)
    expect(plan.exitCode).toBe(0)
    expect(parseJson<{ risk: string; blocked: boolean; requiresApproval: boolean }>(plan.stdout)).toMatchObject({
      risk: 'destructive',
      blocked: true,
      requiresApproval: true,
    })

    const passed = await runScale([
      'shell',
      'run',
      'node -e "process.stdout.write(\'ok\')"',
      '--task-id',
      'TASK-SHELL-CLI',
      '--session-id',
      'RUN-SHELL-CLI',
      '--profile',
      'cli',
      '--json',
    ], scaleDir, projectDir)
    expect(passed.exitCode).toBe(0)
    expect(parseJson<{ status: string; evidence: { status: string; taskId: string } }>(passed.stdout)).toMatchObject({
      status: 'passed',
      evidence: { status: 'passed', taskId: 'TASK-SHELL-CLI' },
    })

    const blocked = await runScale(['shell', 'run', 'git reset --hard HEAD', '--task-id', 'TASK-SHELL-CLI', '--json'], scaleDir, projectDir)
    expect(blocked.exitCode).toBe(1)
    expect(parseJson<{ status: string; plan: { risk: string; blocked: boolean } }>(blocked.stdout)).toMatchObject({
      status: 'blocked',
      plan: { risk: 'destructive', blocked: true },
    })

    const history = await runScale(['shell', 'list', '--json'], scaleDir, projectDir)
    expect(history.exitCode).toBe(0)
    expect(parseJson<{ total: number; executions: Array<{ status: string }> }>(history.stdout).executions.map(item => item.status)).toEqual(['blocked', 'passed'])
    expect(readFileSync(join(scaleDir, 'ledger', 'events.jsonl'), 'utf-8')).toContain('"shell.planned"')
  }, 120_000)

  it('delegates multi-agent work and records Cortex promotion proposals from the CLI', async () => {
    const projectDir = makeDir('scale-agent-os-v2-cli-project-')
    const scaleDir = join(projectDir, '.scale')

    const delegated = await runScale([
      'delegation',
      'delegate',
      'Implement dashboard API security tests and release verification',
      '--task-id',
      'TASK-V2-CLI',
      '--level',
      'L',
      '--files',
      'src/dashboard/DashboardServer.ts,tests/dashboard/dashboardServer.test.ts',
      '--services',
      'dashboard,api',
      '--budget',
      '4000',
      '--json',
    ], scaleDir, projectDir)
    expect(delegated.exitCode).toBe(0)
    const delegation = parseJson<{
      delegation: {
        delegationId: string
        status: string
        assignments: Array<{ profileId: string }>
        reviews: unknown[]
      }
    }>(delegated.stdout).delegation
    expect(delegation.status).toBe('delegated')
    expect(delegation.assignments.length).toBeGreaterThan(0)
    expect(delegation.reviews.length).toBeGreaterThan(0)

    const reviewed = await runScale([
      'delegation',
      'review',
      delegation.delegationId,
      '--profile-id',
      delegation.assignments[0]!.profileId,
      '--status',
      'accepted',
      '--reason',
      'role output verified',
      '--json',
    ], scaleDir, projectDir)
    expect(reviewed.exitCode).toBe(0)
    expect(parseJson<{ delegation: { status: string } }>(reviewed.stdout).delegation.status).toBe('accepted')

    const proposed = await runScale([
      'cortex-promotion',
      'propose',
      'Require validation before completion',
      '--description',
      'Completion claims must include command or review evidence.',
      '--pattern',
      'complete without validation',
      '--rollback',
      'Disable hook and keep prompt reminder',
      '--source',
      'failure-learning',
      '--evidence',
      'RTE-FAILED-VALIDATION',
      '--enforcement',
      'hook',
      '--task-id',
      'TASK-V2-CLI',
      '--json',
    ], scaleDir, projectDir)
    expect(proposed.exitCode).toBe(0)
    expect(parseJson<{ proposal: { maturity: { stage: string } }; report: { summary: { shadowRules: number } } }>(proposed.stdout)).toMatchObject({
      proposal: { maturity: { stage: 'shadow' } },
      report: { summary: { shadowRules: 1 } },
    })

    const listed = await runScale(['cortex-promotion', 'list', '--json'], scaleDir, projectDir)
    expect(listed.exitCode).toBe(0)
    expect(parseJson<{ total: number }>(listed.stdout).total).toBe(1)
    const ledger = readFileSync(join(scaleDir, 'ledger', 'events.jsonl'), 'utf-8')
    expect(ledger).toContain('"agent.delegated"')
    expect(ledger).toContain('"agent.reviewed"')
    expect(ledger).toContain('"cortex.promotion"')
  }, 120_000)

  it('maps desktop automation recommendations to governed capability descriptors', async () => {
    const projectDir = makeDir('scale-agent-os-cap-map-project-')
    const scaleDir = join(projectDir, '.scale')

    const result = await runScale([
      'capability',
      'map',
      '--task',
      'Use CUA to inspect a WPS desktop workflow',
      '--json',
    ], scaleDir, projectDir)

    expect([1, 4294967295]).toContain(result.exitCode)
    const report = parseJson<{
      ok: boolean
      recommendations: Array<{ id: string }>
      capabilities: { descriptors: Array<{ id: string; kind: string; status: string; trust: string; policyEnabled: boolean }> }
    }>(result.stdout)
    expect(report.ok).toBe(false)
    expect(report.recommendations.map(item => item.id)).toContain('cua')
    expect(report.capabilities.descriptors).toContainEqual(expect.objectContaining({
      id: 'desktop-cua',
      kind: 'desktop',
      status: 'blocked',
      trust: 'blocked',
      policyEnabled: false,
    }))
  }, 120_000)
})
