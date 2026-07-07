import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { AgentControlPlane } from '../../src/dashboard/AgentControlPlane.js'
import { safeRmSync } from '../helpers/fs.js'

const tempRoots: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempRoots.push(dir)
  return dir
}
afterEach(() => {
  for (const root of tempRoots.splice(0)) safeRmSync(root)
})

function buildPlane(): AgentControlPlane {
  const projectDir = makeTempDir('scale-agent-kpi-')
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
      mode: 'live-guarded', autoImportKnowledge: true, localExecutor: false, updatedAt: Date.now(),
    }],
  }), 'utf-8')
  return plane
}

describe('AgentControl successRate KPI', () => {
  it('excludes cancelled messages from failures and computes successRate', () => {
    const plane = buildPlane()
    const completed = plane.sendMessage('s1', { text: 'a', dryRun: false })
    const failed = plane.sendMessage('s1', { text: 'b', dryRun: false })
    const cancelled = plane.sendMessage('s1', { text: 'c', dryRun: false })
    plane.completeMessage('s1', completed.id, { status: 'completed', text: 'ok', agentId: 'x' })
    plane.completeMessage('s1', failed.id, { status: 'failed', text: 'no', agentId: 'x' })
    plane.completeMessage('s1', cancelled.id, { status: 'cancelled', text: 'stop', agentId: 'x' })

    const summary = plane.getReport().summary
    expect(summary.completedMessages).toBe(1)
    expect(summary.failedMessages).toBe(1)
    expect(summary.cancelledMessages).toBe(1)
    expect(summary.successRate).toBeCloseTo(0.5)

    const convo = plane.getTranscript('s1').summary
    expect(convo.failedMessages).toBe(1)
    expect(convo.cancelledMessages).toBe(1)
    expect(convo.successRate).toBeCloseTo(0.5)
  })

  it('returns null successRate when no concluded messages', () => {
    const plane = buildPlane()
    plane.sendMessage('s1', { text: 'a', dryRun: false })
    plane.sendMessage('s1', { text: 'b', dryRun: false })
    expect(plane.getReport().summary.successRate).toBeNull()
  })

  it('computes observability metrics (avgLatencyMs / dryRunRatio / closedLoopCoverage)', () => {
    const plane = buildPlane()
    const liveRun = plane.sendMessage('s1', { text: 'live', dryRun: false })
    const dryRun = plane.sendMessage('s1', { text: 'dry', dryRun: true })
    plane.completeMessage('s1', liveRun.id, { status: 'completed', text: 'ok', agentId: 'x', evidencePath: '.scale/ai-os/runs/r1.json' })
    plane.completeMessage('s1', dryRun.id, { status: 'completed', text: 'ok', agentId: 'x' })

    const summary = plane.getReport().summary
    expect(summary.avgLatencyMs).not.toBeNull()
    expect(summary.avgLatencyMs as number).toBeGreaterThanOrEqual(0)
    expect(summary.dryRunRatio).toBeCloseTo(0.5)
    expect(summary.closedLoopCoverage).toBeCloseTo(0.5)
  })
})
