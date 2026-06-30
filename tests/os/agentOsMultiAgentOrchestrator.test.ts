import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentOsMultiAgentOrchestrator } from '../../src/os/index.js'
import { safeRmSync } from '../helpers/fs.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) safeRmSync(dir)
})

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

describe('AgentOsMultiAgentOrchestrator', () => {
  it('delegates AI OS collaboration plans into persistent Agent OS assignments and review evidence', async () => {
    const projectDir = makeDir('scale-agent-os-delegation-')
    const scaleDir = join(projectDir, '.scale')
    const orchestrator = new AgentOsMultiAgentOrchestrator({ projectDir, scaleDir })

    const delegated = await orchestrator.delegate({
      taskId: 'TASK-DELEGATION',
      task: 'Implement dashboard API security tests and release verification',
      level: 'L',
      files: ['src/dashboard/DashboardServer.ts', 'tests/dashboard/dashboardServer.test.ts'],
      services: ['dashboard', 'api'],
      budget: 4000,
    })

    expect(delegated.delegation).toEqual(expect.objectContaining({
      taskId: 'TASK-DELEGATION',
      status: 'delegated',
    }))
    expect(delegated.delegation.agentCollaboration.strategy).toBe('agent-collaboration-v1')
    expect(delegated.delegation.assignments.length).toBeGreaterThan(0)
    expect(delegated.delegation.reviews.length).toBeGreaterThan(0)
    expect(delegated.event.type).toBe('agent.delegated')
    expect(existsSync(join(scaleDir, 'agents', 'assignments.json'))).toBe(true)

    const firstRole = delegated.delegation.assignments[0]!
    const reviewed = orchestrator.review({
      delegationId: delegated.delegation.delegationId,
      profileId: firstRole.profileId,
      status: 'accepted',
      reason: 'role output verified',
      reviewer: 'test-reviewer',
    })

    expect(reviewed.delegation.status).toBe('accepted')
    expect(reviewed.delegation.assignments).toContainEqual(expect.objectContaining({
      profileId: firstRole.profileId,
      status: 'accepted',
      reviewReason: 'role output verified',
    }))
    expect(reviewed.event.type).toBe('agent.reviewed')
    expect(orchestrator.list()).toEqual([expect.objectContaining({ delegationId: delegated.delegation.delegationId })])
    const ledger = readFileSync(join(scaleDir, 'ledger', 'events.jsonl'), 'utf-8')
    expect(ledger).toContain('"agent.delegated"')
    expect(ledger).toContain('"agent.reviewed"')
  }, 120_000)
})
