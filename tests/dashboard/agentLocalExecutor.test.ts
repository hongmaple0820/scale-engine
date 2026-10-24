import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { AgentControlPlane } from '../../src/dashboard/AgentControlPlane.js'
import type { AiOsRunReport } from '../../src/runtime/AiOsRuntime.js'
import { safeRmSync } from '../helpers/fs.js'

vi.mock('../../src/runtime/AiOsRuntime.js', () => ({
  createAiOsRun: vi.fn(async (input: { task?: string }): Promise<AiOsRunReport> => mockRunReport(input.task ?? 'task')),
}))

function mockRunReport(task: string): AiOsRunReport {
  return {
    version: '1', generatedAt: '', mode: 'guarded', dryRun: false, status: 'ready',
    plan: { task: { task } } as never,
    steps: [{ id: 's1', kind: 'plan', title: 'Plan', status: 'passed', required: true, summary: '', evidence: [] }] as never,
    agentExecution: { summary: { totalRoles: 2, settledRoles: 2, reviewGates: 1, settledReviewGates: 1 } } as never,
    evidence: { produced: ['e1'], pending: [] } as never,
    verification: { commands: [], allPassed: true } as never,
    failureLearning: { status: 'idle', candidates: [] } as never,
    artifacts: { runReport: '/tmp/aios-run.json' },
    nextActions: ['run status'],
  } as unknown as AiOsRunReport
}

const tempRoots: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempRoots.push(dir)
  return dir
}
afterEach(() => {
  for (const root of tempRoots.splice(0)) safeRmSync(root)
})

function buildPlane(localExecutor: boolean): AgentControlPlane {
  const projectDir = makeTempDir('scale-agent-local-')
  const scaleDir = join(projectDir, '.scale')
  const plane = new AgentControlPlane(
    { id: 'p1', name: 'Test', projectDir, scaleDir },
    [{ id: 'codex', name: 'Codex', status: 'ready' }],
    [],
  )
  const configPath = join(scaleDir, 'agents', 'control-plane.json')
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, JSON.stringify({
    version: 1,
    sessions: [{
      version: 1, sessionId: 's1', name: 'S1', platformId: 'codex', modelId: 'balanced',
      channelProvider: 'dashboard', channelRouteId: 'dashboard-local', commandPrefix: '/scale',
      mode: 'live-guarded', autoImportKnowledge: true, localExecutor, updatedAt: Date.now(),
    }],
  }), 'utf-8')
  return plane
}

describe('AgentControl local executor', () => {
  it('runs a real-run message end-to-end and posts a synthesized reply', async () => {
    const plane = buildPlane(true)
    const record = plane.sendMessage('s1', { text: 'do the thing', dryRun: false, from: 'dashboard' })
    expect(record.status).toBe('queued')
    expect(record.dryRun).toBe(false)

    const final = await plane.executeLocallyIfEnabled('s1', record.id)
    expect(final).not.toBeNull()
    expect(final!.status).toBe('completed')
    expect(final!.claimedBy).toBe('local-executor')
    expect(final!.evidencePath).toBe('/tmp/aios-run.json')

    const messages = plane.getTranscript('s1').messages
    const reply = messages.find(m => m.direction === 'agent-to-operator')
    expect(reply).toBeDefined()
    expect(reply!.text).toContain('[local-executor]')
    expect(reply!.text).toContain('报告：/tmp/aios-run.json')
  })

  it('does not execute when localExecutor is disabled', async () => {
    const plane = buildPlane(false)
    const record = plane.sendMessage('s1', { text: 'do the thing', dryRun: false })
    const final = await plane.executeLocallyIfEnabled('s1', record.id)
    expect(final).toBeNull()
    expect(plane.getTranscript('s1').messages.every(m => m.status === 'queued')).toBe(true)
  })

  it('marks failed when the run report is blocked', async () => {
    const { createAiOsRun } = await import('../../src/runtime/AiOsRuntime.js')
    ;(createAiOsRun as unknown as { mockImplementation: (fn: unknown) => void }).mockImplementation(async () => ({
      version: '1', generatedAt: '', mode: 'guarded', dryRun: false, status: 'blocked',
      plan: { task: { task: 'x' } } as never,
      steps: [] as never, agentExecution: undefined,
      evidence: { produced: [], pending: ['p'] } as never,
      verification: { commands: [], allPassed: false } as never,
      failureLearning: { status: 'idle', candidates: [] } as never,
      artifacts: { runReport: '/tmp/blocked.json' },
      nextActions: [],
    } as unknown as AiOsRunReport))
    const plane = buildPlane(true)
    const record = plane.sendMessage('s1', { text: 'x', dryRun: false })
    const final = await plane.executeLocallyIfEnabled('s1', record.id)
    expect(final).not.toBeNull()
    expect(final!.status).toBe('failed')
  })

  it('yields (no double execution) when the message is already claimed by another agent', async () => {
    const plane = buildPlane(true)
    const record = plane.sendMessage('s1', { text: 'x', dryRun: false })
    plane.claimMessage('s1', record.id, { agentId: 'runtime-X' })
    const final = await plane.executeLocallyIfEnabled('s1', record.id)
    expect(final).toBeNull()
    const stored = plane.getTranscript('s1').messages.find(m => m.id === record.id)
    expect(stored!.claimedBy).toBe('runtime-X')
    expect(stored!.status).toBe('claimed')
  })
})

describe('AgentControl enableLocalExecution (one-click gate)', () => {
  // 前面用例设置的 blocked mockImplementation 会跨用例泄漏，这里重置为默认 ready 报告
  beforeEach(async () => {
    const { createAiOsRun } = await import('../../src/runtime/AiOsRuntime.js')
    ;(createAiOsRun as unknown as { mockImplementation: (fn: unknown) => void }).mockImplementation(
      async (input: { task?: string }) => mockRunReport(input.task ?? 'task'),
    )
  })

  function buildDefaultPlane(): AgentControlPlane {
    const projectDir = makeTempDir('scale-agent-enable-')
    const scaleDir = join(projectDir, '.scale')
    const plane = new AgentControlPlane(
      { id: 'p1', name: 'Test', projectDir, scaleDir },
      [{ id: 'codex', name: 'Codex', status: 'ready' }],
      [],
    )
    const configPath = join(scaleDir, 'agents', 'control-plane.json')
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, JSON.stringify({
      version: 1,
      sessions: [{
        version: 1, sessionId: 's1', name: 'Ops Session', platformId: 'codex', modelId: 'balanced',
        channelProvider: 'dashboard', channelRouteId: 'dashboard-local', commandPrefix: '/scale',
        mode: 'dry-run', autoImportKnowledge: true, updatedAt: Date.now(),
      }],
    }), 'utf-8')
    return plane
  }

  it('flips a dry-run session to live-guarded + localExecutor and preserves other fields', () => {
    const plane = buildDefaultPlane()
    const session = plane.enableLocalExecution('s1')
    expect(session.mode).toBe('live-guarded')
    expect(session.localExecutor).toBe(true)
    expect(session.name).toBe('Ops Session')
    expect(session.commandPrefix).toBe('/scale')
    expect(plane.isLocalExecutorEnabled('s1')).toBe(true)
  })

  it('persists the gate so a later live message executes end-to-end with a reply', async () => {
    const plane = buildDefaultPlane()
    plane.enableLocalExecution('s1')
    const record = plane.sendMessage('s1', { text: 'do the thing', dryRun: false, from: 'dashboard' })
    expect(record.dryRun).toBe(false)
    const final = await plane.executeLocallyIfEnabled('s1', record.id)
    expect(final).not.toBeNull()
    expect(final!.status).toBe('completed')
    const reply = plane.getTranscript('s1').messages.find(m => m.direction === 'agent-to-operator')
    expect(reply).toBeDefined()
    expect(reply!.text).toContain('[local-executor]')
  })

  it('still treats a message as dry-run when the caller does not explicitly opt out', () => {
    const plane = buildDefaultPlane()
    plane.enableLocalExecution('s1')
    const record = plane.sendMessage('s1', { text: 'x' })
    expect(record.dryRun).toBe(true)
  })
})
