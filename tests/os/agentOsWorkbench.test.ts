import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryBrain } from '../../src/memory/MemoryBrain.js'
import { AgentOsBridgeRegistry, AgentOsTaskStore, AgentOsWorkbench } from '../../src/os/index.js'
import { RuntimeEvidenceLedger } from '../../src/runtime/RuntimeEvidenceLedger.js'
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

describe('AgentOsWorkbench', () => {
  it('aggregates task timeline, approvals, capabilities, bridges, evidence, memory, context packs, and git status', () => {
    const projectDir = makeDir('scale-agent-os-workbench-')
    const scaleDir = join(projectDir, '.scale')
    mkdirSync(join(projectDir, 'src'), { recursive: true })
    writeFileSync(join(projectDir, 'src', 'index.ts'), 'export const value = 1\n', 'utf-8')
    execFileSync('git', ['init'], { cwd: projectDir, stdio: 'ignore' })

    const taskStore = new AgentOsTaskStore({
      projectDir,
      scaleDir,
      now: () => new Date('2026-06-28T11:00:00.000Z'),
    })
    taskStore.create({
      taskId: 'TASK-WORKBENCH',
      name: 'Build Agent OS workbench',
      level: 'L',
      files: ['src/os/AgentOsWorkbench.ts'],
      services: ['dashboard'],
      surfaces: ['dashboard', 'agent-tool'],
    })
    taskStore.start({
      taskId: 'TASK-WORKBENCH',
      runId: 'RUN-WORKBENCH',
      agent: 'codex',
      contextPackId: 'CTX-RUN',
    })
    taskStore.checkpoint({
      taskId: 'TASK-WORKBENCH',
      summary: 'Workbench aggregation ready',
      completedSteps: ['store'],
      remainingSteps: ['ui'],
      openApprovals: ['approve external bridge scopes'],
      contextPackId: 'CTX-CHECKPOINT',
    })
    new RuntimeEvidenceLedger({ projectDir, scaleDir }).record({
      taskId: 'TASK-WORKBENCH',
      sessionId: 'RUN-WORKBENCH',
      kind: 'command',
      title: 'Targeted tests',
      status: 'passed',
      command: 'npm run typecheck',
      summary: 'TypeScript passed',
    })
    const bridge = new AgentOsBridgeRegistry({ projectDir, scaleDir })
    bridge.register({
      bridgeId: 'BRIDGE-WORKBENCH',
      name: 'Workbench Bridge',
      kind: 'dashboard',
      token: 'bridge-secret',
      capabilityIds: ['dashboard-workbench'],
    })
    bridge.heartbeat('BRIDGE-WORKBENCH', 'bridge-secret')

    const brain = new MemoryBrain({ projectDir, scaleDir })
    try {
      brain.addNode({
        id: 'MEM-WORKBENCH',
        type: 'decision',
        layer: 'L2-policy',
        title: 'Workbench Needs Evidence',
        summary: 'Agent OS workbench panels must be backed by runtime evidence.',
        source: 'manual',
        evidencePaths: ['src/os/AgentOsWorkbench.ts'],
        confidence: 0.8,
        status: 'candidate',
      })
    } finally {
      brain.close()
    }

    const snapshot = new AgentOsWorkbench({
      projectDir,
      scaleDir,
      projectName: 'Workbench Project',
      now: () => new Date('2026-06-28T11:30:00.000Z'),
    }).snapshot({ taskId: 'TASK-WORKBENCH', limit: 20 })

    expect(snapshot.project.name).toBe('Workbench Project')
    expect(snapshot.focus.taskId).toBe('TASK-WORKBENCH')
    expect(snapshot.tasks.focused?.task.taskId).toBe('TASK-WORKBENCH')
    expect(snapshot.summary.tasks.running).toBe(1)
    expect(snapshot.timeline.map(entry => entry.kind)).toEqual(expect.arrayContaining(['run', 'checkpoint', 'event']))
    expect(snapshot.approvals.open).toContainEqual(expect.objectContaining({
      summary: 'approve external bridge scopes',
      source: 'checkpoint',
    }))
    expect(snapshot.contextPacks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'CTX-RUN', source: 'run' }),
      expect.objectContaining({ id: 'CTX-CHECKPOINT', source: 'checkpoint' }),
    ]))
    expect(snapshot.bridges).toMatchObject({
      total: 1,
      online: 1,
      items: [expect.objectContaining({ bridgeId: 'BRIDGE-WORKBENCH', status: 'online' })],
    })
    expect(snapshot.evidence.summary).toEqual(expect.objectContaining({
      total: 1,
      passed: 1,
      ok: true,
    }))
    expect(snapshot.memory.summary).toEqual(expect.objectContaining({
      candidate: 1,
      contradictions: 0,
    }))
    expect(snapshot.memory.candidates).toEqual([expect.objectContaining({ id: 'MEM-WORKBENCH' })])
    expect(snapshot.git.changedFiles.map(file => file.path)).toContain('src/index.ts')
    expect(snapshot.panels).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'approvals', status: 'attention', count: 1 }),
      expect.objectContaining({ id: 'evidence', status: 'ready', count: 1 }),
      expect.objectContaining({ id: 'git', status: 'attention' }),
    ]))
  })
})
