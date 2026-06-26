import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

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

describe('loop CLI', () => {
  it('materializes default loops into project configuration for easy editing', async () => {
    const scaleDir = makeDir('scale-loop-cli-scale-')
    const projectDir = makeDir('scale-loop-cli-project-')

    const init = await runScale(['loop', 'init', '--json'], scaleDir, projectDir)
    expect(init.exitCode).toBe(0)
    const initReport = parseJson<{
      written: boolean
      path: string
      loopCount: number
      nextCommands: string[]
    }>(init.stdout)
    expect(initReport.written).toBe(true)
    expect(initReport.loopCount).toBe(3)
    expect(initReport.nextCommands).toContain('scale loop status --json')
    expect(existsSync(initReport.path)).toBe(true)

    const list = await runScale(['loop', 'list', '--json'], scaleDir, projectDir)
    expect(list.exitCode).toBe(0)
    const listReport = parseJson<{ source: string; configExists: boolean; loops: Array<{ id: string }> }>(list.stdout)
    expect(listReport.source).toBe('config')
    expect(listReport.configExists).toBe(true)
    expect(listReport.loops.map(loop => loop.id)).toEqual([
      'attention.permission-needed',
      'context.summary-card',
      'quality.post-edit-verify',
    ])
  }, 120_000)

  it('lists hook-first default loops with safe provider boundaries', async () => {
    const scaleDir = makeDir('scale-loop-cli-scale-')
    const projectDir = makeDir('scale-loop-cli-project-')

    const list = await runScale(['loop', 'list', '--json'], scaleDir, projectDir)
    expect(list.exitCode).toBe(0)
    const report = parseJson<{
      source: string
      configExists: boolean
      loops: Array<{ id: string; enabled: boolean; eventTypes: string[]; riskLevel: string; providers: string[] }>
    }>(list.stdout)

    expect(report.source).toBe('default')
    expect(report.configExists).toBe(false)
    expect(report.loops.map(loop => loop.id)).toEqual([
      'attention.permission-needed',
      'context.summary-card',
      'quality.post-edit-verify',
    ])
    expect(report.loops.find(loop => loop.id === 'attention.permission-needed')).toMatchObject({
      enabled: true,
      riskLevel: 'read-only',
      providers: expect.arrayContaining(['feishu', 'desktop']),
    })

    const status = await runScale(['loop', 'status', '--json'], scaleDir, projectDir)
    expect(status.exitCode).toBe(0)
    const statusReport = parseJson<{
      enabledCount: number
      disabledCount: number
      requiredProviders: string[]
      safety: { dryRunDefault: boolean; liveExecutionEnabled: boolean; destructiveActionsBlocked: boolean }
    }>(status.stdout)
    expect(statusReport.enabledCount).toBe(3)
    expect(statusReport.disabledCount).toBe(0)
    expect(statusReport.requiredProviders).toEqual(expect.arrayContaining(['feishu', 'desktop', 'gbrain']))
    expect(statusReport.safety).toEqual({
      dryRunDefault: true,
      liveExecutionEnabled: false,
      destructiveActionsBlocked: true,
    })
  }, 120_000)

  it('dry-runs a loop and writes loop-run evidence without calling live providers', async () => {
    const scaleDir = makeDir('scale-loop-cli-scale-')
    const projectDir = makeDir('scale-loop-cli-project-')

    const result = await runScale([
      'loop',
      'run',
      'attention.permission-needed',
      '--event',
      'permission-needed',
      '--json',
    ], scaleDir, projectDir)
    expect(result.exitCode).toBe(0)
    const report = parseJson<{
      ok: boolean
      dryRun: boolean
      loop: { id: string }
      plannedActions: Array<{ type: string; provider?: string; live: boolean }>
      evidencePath: string
      warnings: string[]
    }>(result.stdout)

    expect(report.ok).toBe(true)
    expect(report.dryRun).toBe(true)
    expect(report.loop.id).toBe('attention.permission-needed')
    expect(report.plannedActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'notify', provider: 'feishu', live: false }),
    ]))
    expect(report.warnings).toContain('dry-run only: no live provider call was made')
    expect(existsSync(report.evidencePath)).toBe(true)

    const evidence = parseJson<{ dryRun: boolean; loopId: string; plannedActions: Array<{ live: boolean }> }>(
      readFileSync(report.evidencePath, 'utf-8'),
    )
    expect(evidence.dryRun).toBe(true)
    expect(evidence.loopId).toBe('attention.permission-needed')
    expect(evidence.plannedActions.every(action => action.live === false)).toBe(true)
  }, 120_000)

  it('builds a Feishu CLI dry-run send plan when a notification target is supplied', async () => {
    const scaleDir = makeDir('scale-loop-cli-scale-')
    const projectDir = makeDir('scale-loop-cli-project-')

    const result = await runScale([
      'loop',
      'run',
      'attention.permission-needed',
      '--event',
      'permission-needed',
      '--feishu-chat-id',
      'oc_demo',
      '--json',
    ], scaleDir, projectDir)
    expect(result.exitCode).toBe(0)
    const report = parseJson<{
      plannedActions: Array<{
        type: string
        provider?: string
        commandPlan?: { command: string; args: string[]; requiresConfirmation: boolean }
      }>
      warnings: string[]
    }>(result.stdout)

    const feishuAction = report.plannedActions.find(action => action.provider === 'feishu')
    expect(feishuAction).toMatchObject({
      type: 'notify',
      commandPlan: {
        command: 'lark-cli',
        requiresConfirmation: false,
      },
    })
    expect(feishuAction?.commandPlan?.args).toEqual([
      'im',
      '+messages-send',
      '--as',
      'bot',
      '--chat-id',
      'oc_demo',
      '--text',
      expect.stringContaining('Loop attention.permission-needed triggered by permission-needed'),
      '--dry-run',
    ])
    expect(report.warnings).not.toContain('Feishu target is not configured; pass --feishu-chat-id or --feishu-user-id to build a lark-cli send plan.')
  }, 120_000)

  it('keeps Feishu notify actions target-confirmation gated when no chat or user is supplied', async () => {
    const scaleDir = makeDir('scale-loop-cli-scale-')
    const projectDir = makeDir('scale-loop-cli-project-')

    const result = await runScale([
      'loop',
      'run',
      'attention.permission-needed',
      '--event',
      'permission-needed',
      '--json',
    ], scaleDir, projectDir)
    expect(result.exitCode).toBe(0)
    const report = parseJson<{
      plannedActions: Array<{ provider?: string; commandPlan?: unknown }>
      warnings: string[]
    }>(result.stdout)
    expect(report.plannedActions.find(action => action.provider === 'feishu')?.commandPlan).toBeUndefined()
    expect(report.warnings).toContain('Feishu target is not configured; pass --feishu-chat-id or --feishu-user-id to build a lark-cli send plan.')
  }, 120_000)

  it('loads project loop configuration while keeping disabled write-capable loops inert', async () => {
    const scaleDir = makeDir('scale-loop-cli-scale-')
    const projectDir = makeDir('scale-loop-cli-project-')
    mkdirSync(scaleDir, { recursive: true })
    writeFileSync(join(scaleDir, 'loops.yaml'), [
      'version: 1',
      'loops:',
      '  - id: file.inbox-organizer',
      '    name: File inbox organizer proposal',
      '    description: Propose rename and move operations for newly created files.',
      '    enabled: false',
      '    events:',
      '      - file-created',
      '    policy:',
      '      riskLevel: write-capable',
      '      dryRunDefault: true',
      '      requiresApproval: true',
      '      allowWrite: false',
      '      evidenceRequired: true',
      '    actions:',
      '      - type: propose-file-organization',
      '        provider: skill',
      '        description: Draft file rename and destination suggestions.',
    ].join('\n') + '\n', 'utf-8')

    const list = await runScale(['loop', 'list', '--json'], scaleDir, projectDir)
    expect(list.exitCode).toBe(0)
    const report = parseJson<{
      source: string
      loops: Array<{ id: string; enabled: boolean; riskLevel: string }>
    }>(list.stdout)
    expect(report.source).toBe('config')
    expect(report.loops).toEqual([
      expect.objectContaining({
        id: 'file.inbox-organizer',
        enabled: false,
        riskLevel: 'write-capable',
      }),
    ])

    const run = await runScale(['loop', 'run', 'file.inbox-organizer', '--event', 'file-created', '--json'], scaleDir, projectDir)
    expect(run.exitCode).toBe(1)
    const runReport = parseJson<{ ok: boolean; error: string }>(run.stdout)
    expect(runReport).toMatchObject({
      ok: false,
      error: 'Loop file.inbox-organizer is disabled.',
    })
  }, 120_000)
})
