import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentOsSmartShell } from '../../src/os/index.js'
import { CommandRunLedger } from '../../src/tools/CommandRunLedger.js'
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

describe('AgentOsSmartShell', () => {
  it('classifies and blocks destructive commands without executing them', async () => {
    const projectDir = makeDir('scale-agent-os-shell-block-')
    const scaleDir = join(projectDir, '.scale')
    const shell = new AgentOsSmartShell({ projectDir, scaleDir })

    const plan = shell.plan({ command: 'git reset --hard HEAD', taskId: 'TASK-SHELL' })
    expect(plan).toEqual(expect.objectContaining({
      risk: 'destructive',
      blocked: true,
      requiresApproval: true,
    }))
    expect(plan.reasons).toContain('hard git reset can discard work')

    const execution = await shell.run({ command: 'git reset --hard HEAD', taskId: 'TASK-SHELL' })
    expect(execution.status).toBe('blocked')
    expect(execution.evidence).toBeUndefined()
    expect(shell.list()).toEqual([expect.objectContaining({ status: 'blocked' })])
    expect(readFileSync(join(scaleDir, 'ledger', 'events.jsonl'), 'utf-8')).toContain('"shell.executed"')
  })

  it('runs safe commands and records compressed command evidence', async () => {
    const projectDir = makeDir('scale-agent-os-shell-run-')
    const scaleDir = join(projectDir, '.scale')
    const shell = new AgentOsSmartShell({ projectDir, scaleDir })

    const execution = await shell.run({
      command: 'node -e "process.stdout.write(\'ok\')"',
      taskId: 'TASK-SHELL',
      sessionId: 'RUN-SHELL',
      profile: 'unit',
      timeoutMs: 10_000,
    })

    expect(execution.status).toBe('passed')
    expect(execution.result).toEqual(expect.objectContaining({ exitCode: 0, stdout: 'ok' }))
    expect(execution.evidence).toEqual(expect.objectContaining({
      taskId: 'TASK-SHELL',
      sessionId: 'RUN-SHELL',
      source: 'agent-os-smart-shell',
      status: 'passed',
    }))
    expect(new CommandRunLedger({ projectDir, scaleDir }).list('TASK-SHELL')).toEqual([
      expect.objectContaining({ command: 'node -e "process.stdout.write(\'ok\')"', status: 'passed' }),
    ])
    expect(existsSync(join(scaleDir, 'shell', 'runs.json'))).toBe(true)
  })
})
