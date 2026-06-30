import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentOsTaskStore } from '../../src/os/AgentOsTaskStore.js'
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

describe('AgentOsTaskStore', () => {
  it('persists task, run, checkpoint, resume, and explicit completion records', () => {
    const projectDir = makeDir('scale-agent-os-project-')
    const scaleDir = join(projectDir, '.scale')
    const store = new AgentOsTaskStore({ projectDir, scaleDir })

    const created = store.create({
      taskId: 'TASK-OS',
      name: 'Implement Agent OS task kernel',
      level: 'L',
      files: ['src/os/AgentOsTaskStore.ts'],
      services: ['runtime'],
    })
    expect(created.task).toMatchObject({
      taskId: 'TASK-OS',
      status: 'created',
      level: 'L',
      schemaVersion: 'agent-os-task-v1.1',
    })
    expect(created.task.correlationId).toMatch(/^CORR-TASK-OS-/)

    const run = store.start({
      taskId: 'TASK-OS',
      runId: 'RUN-OS',
      agent: 'codex',
      provider: 'openai',
      model: 'gpt-5',
    })
    expect(run.record).toMatchObject({
      runId: 'RUN-OS',
      status: 'running',
      agent: 'codex',
    })
    expect(run.record.correlationId).toBe(created.task.correlationId)

    const checkpoint = store.checkpoint({
      taskId: 'TASK-OS',
      summary: 'contract implemented',
      completedSteps: ['contract'],
      remainingSteps: ['cli', 'tests'],
      evidenceIds: ['RTE-1'],
    })
    expect(checkpoint.record.resumePrompt).toContain('Resume Agent OS task TASK-OS')
    expect(checkpoint.record.remainingSteps).toEqual(['cli', 'tests'])
    expect(checkpoint.record.correlationId).toBe(created.task.correlationId)

    const resumed = store.resume({ taskId: 'TASK-OS' })
    expect(resumed.record.checkpointId).toBe(checkpoint.record.checkpointId)
    expect(resumed.task.status).toBe('running')

    const completed = store.complete({
      taskId: 'TASK-OS',
      outcome: 'partial',
      summary: 'kernel slice landed',
      evidenceIds: ['RTE-1', 'RTE-2'],
      changedFiles: ['src/os/AgentOsTaskStore.ts'],
      validation: ['vitest agentOsTaskStore'],
      residualRisk: 'bridge API pending',
      nextActions: ['wire dashboard'],
    })
    expect(completed.task.status).toBe('partially_completed')
    expect(completed.record).toMatchObject({
      outcome: 'partial',
      evidenceIds: ['RTE-1', 'RTE-2'],
      changedFiles: ['src/os/AgentOsTaskStore.ts'],
    })

    const snapshot = store.snapshot('TASK-OS')
    expect(snapshot.run?.status).toBe('completed')
    expect(snapshot.checkpoints).toHaveLength(1)
    expect(snapshot.completion?.residualRisk).toBe('bridge API pending')
    expect(snapshot.timeline.map(entry => entry.kind)).toEqual(expect.arrayContaining(['event', 'run', 'checkpoint', 'completion']))
    expect(snapshot.timeline.every(entry => entry.correlationId === created.task.correlationId)).toBe(true)
    expect(existsSync(join(scaleDir, 'tasks', 'TASK-OS', 'task.json'))).toBe(true)

    const ledger = readFileSync(join(scaleDir, 'ledger', 'events.jsonl'), 'utf-8')
    expect(ledger).toContain('"task.created"')
    expect(ledger).toContain('"task.checkpointed"')
    expect(ledger).toContain('"task.completed"')
  })

  it('records blocked completion as a first-class task state', () => {
    const projectDir = makeDir('scale-agent-os-project-')
    const store = new AgentOsTaskStore({ projectDir, scaleDir: join(projectDir, '.scale') })

    store.create({ taskId: 'TASK-BLOCKED', name: 'Blocked task' })
    store.start({ taskId: 'TASK-BLOCKED', runId: 'RUN-BLOCKED' })
    const blocked = store.complete({
      taskId: 'TASK-BLOCKED',
      outcome: 'blocked',
      summary: 'missing external credential',
      nextActions: ['provide credential through approved secret channel'],
    })

    expect(blocked.task.status).toBe('blocked')
    expect(store.snapshot('TASK-BLOCKED').run?.status).toBe('blocked')
    expect(blocked.record.nextActions).toEqual(['provide credential through approved secret channel'])
  })

  it('filters tasks by state, level, agent, surface, service, and file', () => {
    const projectDir = makeDir('scale-agent-os-project-')
    const store = new AgentOsTaskStore({ projectDir, scaleDir: join(projectDir, '.scale') })

    store.create({
      taskId: 'TASK-CLI',
      name: 'CLI work',
      level: 'M',
      files: ['src/api/cli.ts'],
      services: ['cli'],
      surfaces: ['cli'],
    })
    store.start({ taskId: 'TASK-CLI', runId: 'RUN-CLI', agent: 'codex' })
    store.create({
      taskId: 'TASK-DASH',
      name: 'Dashboard work',
      level: 'L',
      files: ['src/dashboard/DashboardServer.ts'],
      services: ['dashboard'],
      surfaces: ['dashboard'],
    })

    expect(store.list({ status: 'running' }).map(task => task.taskId)).toEqual(['TASK-CLI'])
    expect(store.list({ level: 'L' }).map(task => task.taskId)).toEqual(['TASK-DASH'])
    expect(store.list({ agent: 'codex' }).map(task => task.taskId)).toEqual(['TASK-CLI'])
    expect(store.list({ surface: 'dashboard' }).map(task => task.taskId)).toEqual(['TASK-DASH'])
    expect(store.list({ service: 'cli' }).map(task => task.taskId)).toEqual(['TASK-CLI'])
    expect(store.list({ file: 'src/api/cli.ts' }).map(task => task.taskId)).toEqual(['TASK-CLI'])
  })

  it('requires validation before marking complete or partial outcomes', () => {
    const projectDir = makeDir('scale-agent-os-project-')
    const store = new AgentOsTaskStore({ projectDir, scaleDir: join(projectDir, '.scale') })

    store.create({ taskId: 'TASK-VALIDATION', name: 'Validation task' })
    store.start({ taskId: 'TASK-VALIDATION', runId: 'RUN-VALIDATION' })

    expect(() => store.complete({
      taskId: 'TASK-VALIDATION',
      outcome: 'complete',
      summary: 'done without proof',
    })).toThrow(/without validation evidence/)
  })
})
