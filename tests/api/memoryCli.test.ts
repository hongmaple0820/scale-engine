import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

describe('memory CLI', () => {
  it('creates and inspects autonomous memory provider routing policy', async () => {
    const scaleDir = makeDir('scale-memory-cli-scale-')
    const projectDir = makeDir('scale-memory-cli-project-')

    const init = await runScale(['memory', 'provider', 'init', '--json'], scaleDir, projectDir)
    expect(init.exitCode).toBe(0)
    const initReport = parseJson<{ written: boolean; path: string; config: { routing: { defaultOrder: string[] } } }>(init.stdout)
    expect(initReport.written).toBe(true)
    expect(initReport.config.routing.defaultOrder).toEqual(['gbrain'])
    expect(existsSync(initReport.path)).toBe(true)

    const status = await runScale(['memory', 'provider', 'status', '--json'], scaleDir, projectDir)
    expect(status.exitCode).toBe(0)
    const statusReport = parseJson<{
      configExists: boolean
      providers: Array<{ id: string; available: boolean; safetyLevel: string; writeMode: string }>
      warnings: string[]
    }>(status.stdout)
    expect(statusReport.configExists).toBe(true)
    expect(statusReport.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'gbrain', safetyLevel: 'review-required', writeMode: 'disabled' }),
    ]))
    expect(statusReport.providers.map(provider => provider.id)).toEqual(['gbrain'])
    expect(statusReport.warnings).toEqual([])
  }, 120_000)

  it('keeps gbrain as the only switchable memory provider', async () => {
    const scaleDir = makeDir('scale-memory-cli-scale-')
    const projectDir = makeDir('scale-memory-cli-project-')

    const init = await runScale(['memory', 'provider', 'init', '--json'], scaleDir, projectDir)
    expect(init.exitCode).toBe(0)

    const switched = await runScale(['memory', 'provider', 'use', 'gbrain', '--json'], scaleDir, projectDir)
    expect(switched.exitCode).toBe(0)
    const switchedReport = parseJson<{
      ok: boolean
      provider: string
      mode: string
      previousOrder: string[]
      nextOrder: string[]
    }>(switched.stdout)
    expect(switchedReport).toMatchObject({
      ok: true,
      provider: 'gbrain',
      mode: 'external-first',
    })
    expect(switchedReport.previousOrder).toEqual(['gbrain'])
    expect(switchedReport.nextOrder).toEqual(['gbrain'])

    const status = await runScale(['memory', 'provider', 'status', '--json'], scaleDir, projectDir)
    expect(status.exitCode).toBe(0)
    const statusReport = parseJson<{ routing: { mode: string; defaultOrder: string[] } }>(status.stdout)
    expect(statusReport.routing.mode).toBe('external-first')
    expect(statusReport.routing.defaultOrder).toEqual(['gbrain'])
  }, 120_000)

  it('renders a memory context pack for a scoped task', async () => {
    const scaleDir = makeDir('scale-memory-cli-scale-')
    const projectDir = makeDir('scale-memory-cli-project-')

    await runScale([
      'runtime',
      'start',
      '--session-id',
      'SESSION-MEM',
      '--task-id',
      'TASK-MEM',
      '--level',
      'M',
      '--summary',
      'Memory context pack',
    ], scaleDir, projectDir)
    await runScale([
      'runtime',
      'record',
      '--title',
      'unit tests',
      '--status',
      'passed',
      '--exit-code',
      '0',
      '--summary',
      'memory tests passed',
    ], scaleDir, projectDir)

    const result = await runScale([
      'memory',
      'pack',
      '--task-id',
      'TASK-MEM',
      '--session-id',
      'SESSION-MEM',
      '--task',
      'Build a memory context pack',
      '--level',
      'M',
      '--budget',
      '2000',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const pack = parseJson<{ task: { taskId: string }; sections: Array<{ id: string; included: boolean }> }>(result.stdout)
    expect(pack.task.taskId).toBe('TASK-MEM')
    expect(pack.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'runtime-evidence', included: true }),
      expect.objectContaining({ id: 'session-events', included: true }),
      expect.objectContaining({ id: 'provider-memory', included: false }),
    ]))
  }, 120_000)

  it('fails provider recall closed when gbrain is not configured', async () => {
    const scaleDir = makeDir('scale-memory-cli-scale-')
    const projectDir = makeDir('scale-memory-cli-project-')
    const memoryFile = join(projectDir, 'memory.jsonl')
    writeFileSync(memoryFile, JSON.stringify({
      id: 'MEM-provider-oauth',
      type: 'decision',
      title: 'OAuth callback uses Redis state',
      summary: 'OAuth callback state must be resolved server-side from Redis before provider binding continues.',
      entities: ['oauth', 'redis', 'callback'],
      source: 'manual',
      evidencePaths: ['docs/oauth-state-evidence.md'],
      confidence: 0.86,
      scope: 'project',
      status: 'active',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
      lastVerifiedAt: '2026-05-20T00:00:00.000Z',
      metadata: {},
    }) + '\n', 'utf-8')

    const imported = await runScale(['memory', 'import', memoryFile, '--json'], scaleDir, projectDir)
    expect(imported.exitCode).toBe(0)

    const recall = await runScale([
      'memory',
      'provider',
      'recall',
      'OAuth Redis callback state',
      '--json',
    ], scaleDir, projectDir)
    expect(recall.exitCode).toBe(0)
    const recallReport = parseJson<{
      ok: boolean
      selectedProviders: string[]
      fallbackUsed: boolean
      items: Array<{ provider: string; id: string; title: string }>
      warnings: string[]
    }>(recall.stdout)
    expect(recallReport.ok).toBe(false)
    expect(recallReport.selectedProviders).toEqual([])
    expect(recallReport.fallbackUsed).toBe(false)
    expect(recallReport.items).toEqual([])
    expect(recallReport.warnings).toContainEqual(expect.stringContaining('gbrain skipped'))

    const packResult = await runScale([
      'memory',
      'pack',
      '--task',
      'Fix OAuth callback state lookup',
      '--budget',
      '4000',
      '--json',
    ], scaleDir, projectDir)
    expect(packResult.exitCode).toBe(0)
    const pack = parseJson<{ sections: Array<{ id: string; included: boolean; items: Array<{ type: string; provider?: string; id?: string }> }> }>(packResult.stdout)
    const providerMemory = pack.sections.find(section => section.id === 'provider-memory')
    expect(providerMemory).toMatchObject({ included: false })
    expect(providerMemory?.items).toEqual([])
  }, 120_000)

  it('fails memory doctor when a context pack would exceed its budget', async () => {
    const scaleDir = makeDir('scale-memory-cli-scale-')
    const projectDir = makeDir('scale-memory-cli-project-')

    const result = await runScale([
      'memory',
      'doctor',
      '--task',
      'Review a very large cross module architecture change with many known risks and long context',
      '--level',
      'L',
      '--budget',
      '10',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(1)
    const report = parseJson<{ ok: boolean; checks: Array<{ name: string; status: string }> }>(result.stdout)
    expect(report.ok).toBe(false)
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Context budget', status: 'fail' }),
    ]))
  }, 120_000)

  it('settles a memory learning candidate from runtime evidence', async () => {
    const scaleDir = makeDir('scale-memory-cli-scale-')
    const projectDir = makeDir('scale-memory-cli-project-')

    await runScale([
      'runtime',
      'start',
      '--session-id',
      'SESSION-SETTLE',
      '--task-id',
      'TASK-SETTLE',
      '--level',
      'M',
      '--summary',
      'Memory settlement',
    ], scaleDir, projectDir)
    await runScale([
      'runtime',
      'record',
      '--title',
      'unit tests',
      '--status',
      'passed',
      '--exit-code',
      '0',
      '--summary',
      'memory settle tests passed',
    ], scaleDir, projectDir)

    const result = await runScale([
      'memory',
      'settle',
      '--task-id',
      'TASK-SETTLE',
      '--session-id',
      'SESSION-SETTLE',
      '--task',
      'Settle runtime evidence into learning',
      '--level',
      'M',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const output = parseJson<{
      candidate: { status: string; recommendedAction: string; promotable: boolean; evidenceIds: string[] }
      files: { json: string; markdown: string }
    }>(result.stdout)
    expect(output.candidate).toMatchObject({
      status: 'candidate',
      recommendedAction: 'review-for-knowledge-base',
      promotable: true,
    })
    expect(output.candidate.evidenceIds.length).toBeGreaterThan(0)
    expect(existsSync(output.files.json)).toBe(true)
    expect(existsSync(output.files.markdown)).toBe(true)
  }, 120_000)
})
