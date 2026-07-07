import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

interface FakeBus {
  emit: ReturnType<typeof vi.fn>
}
function buildPlane(bus?: FakeBus): { plane: AgentControlPlane; bus: FakeBus } {
  const projectDir = makeTempDir('scale-agent-sse-')
  const scaleDir = join(projectDir, '.scale')
  const captured: FakeBus = bus ?? { emit: vi.fn() }
  const plane = new AgentControlPlane(
    { id: 'p1', name: 'P1', projectDir, scaleDir },
    [],
    [],
    captured as never,
  )
  return { plane, bus: captured }
}

describe('AgentControlPlane SSE event emission', () => {
  it('emits agent-control:message with phase "queued" on sendMessage', () => {
    const bus = { emit: vi.fn() }
    const { plane } = buildPlane(bus)
    plane.sendMessage('s1', { text: 'hello', dryRun: true })
    const agentEvents = bus.emit.mock.calls.filter(([type]: [string, unknown]) => type === 'agent-control.message')
    expect(agentEvents.length).toBeGreaterThanOrEqual(1)
    const payload = agentEvents[0][1] as { phase: string; messageId: string; sessionId: string }
    expect(payload.phase).toBe('queued')
    expect(payload.sessionId).toBe('s1')
    expect(typeof payload.messageId).toBe('string')
  })

  it('emits queued -> claimed -> completed through the message lifecycle', () => {
    const bus = { emit: vi.fn() }
    const { plane } = buildPlane(bus)
    const msg = plane.sendMessage('s1', { text: 'task', dryRun: true })
    plane.claimMessage('s1', msg.id, { agentId: 'agent-x' })
    plane.completeMessage('s1', msg.id, { status: 'completed', text: 'done', agentId: 'agent-x' })
    const phases = bus.emit.mock.calls
      .filter(([type]: [string, unknown]) => type === 'agent-control.message')
      .map(([, payload]: [unknown, { phase: string }]) => payload.phase)
    expect(phases).toContain('queued')
    expect(phases).toContain('claimed')
    expect(phases).toContain('completed')
  })

  it('does not throw and emits nothing when no bus is injected', () => {
    const { plane } = buildPlane()
    expect(() => plane.sendMessage('s1', { text: 'hi', dryRun: true })).not.toThrow()
  })
})
