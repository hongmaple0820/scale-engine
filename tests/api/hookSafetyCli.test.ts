import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function runScale(args: string[], scaleDir: string, projectDir: string, options?: { input?: string }) {
  return execa('node', ['--import', 'tsx', 'src/api/cli.ts', ...args], {
    env: {
      ...process.env,
      SCALE_DIR: scaleDir,
      SCALE_PROJECT_DIR: projectDir,
      SCALE_LOG_LEVEL: undefined,
    },
    reject: false,
    timeout: 10_000,
    input: options?.input,
  })
}

function readJsonl(file: string): Array<Record<string, unknown>> {
  return readFileSync(file, 'utf-8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line) as Record<string, unknown>)
}

function readRuntimeEvidence(scaleDir: string): Array<Record<string, unknown>> {
  const dir = join(scaleDir, 'evidence', 'runtime')
  return readdirSync(dir)
    .filter(file => file.endsWith('.json'))
    .map(file => JSON.parse(readFileSync(join(dir, file), 'utf-8')) as Record<string, unknown>)
}

describe('hook-safe CLI commands', () => {
  it('runs gate before-stop without initializing the artifact engine', async () => {
    const projectDir = makeDir('scale-hook-safe-project-')
    const scaleDir = join(projectDir, '.scale')

    const result = await runScale(['gate', 'before-stop', '--session-id', 'hook-test', '--hook-safe'], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    expect(existsSync(join(scaleDir, 'scale.db'))).toBe(false)
  })

  it('runs meta-governance without initializing the artifact engine', async () => {
    const projectDir = makeDir('scale-meta-governance-project-')
    const scaleDir = join(projectDir, '.scale')

    const result = await runScale(['meta-governance', '--scale-dir', scaleDir, '--json'], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toHaveLength(7)
    expect(existsSync(join(scaleDir, 'scale.db'))).toBe(false)
  })

  it('prints help for hook-sensitive commands without timing out', async () => {
    const projectDir = makeDir('scale-hook-help-project-')
    const scaleDir = join(projectDir, '.scale')

    const gateHelp = await runScale(['gate', 'before-stop', '--help'], scaleDir, projectDir)
    const metaHelp = await runScale(['meta-governance', '--help'], scaleDir, projectDir)

    expect(gateHelp.exitCode).toBe(0)
    expect(metaHelp.exitCode).toBe(0)
    expect(existsSync(join(scaleDir, 'scale.db'))).toBe(false)
  }, 15_000)

  it('records Bash verification commands as runtime evidence and event bus signals', async () => {
    const projectDir = makeDir('scale-hook-verification-project-')
    const scaleDir = join(projectDir, '.scale')

    const result = await runScale([
      'gate',
      'post-tool',
      'Bash',
      '--session-id',
      'hook-verification',
      '--args-json',
      '{"command":"npm run build"}',
      '--exit-code',
      '0',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const evidence = readRuntimeEvidence(scaleDir)
    expect(evidence).toHaveLength(1)
    expect(evidence[0]).toEqual(expect.objectContaining({
      sessionId: 'hook-verification',
      kind: 'command',
      status: 'passed',
      command: 'npm run build',
      exitCode: 0,
    }))

    const sessionEvents = readJsonl(join(scaleDir, 'events', 'sessions', 'hook-verification.jsonl'))
    expect(sessionEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'evidence.recorded' }),
    ]))

    const eventFiles = readdirSync(join(scaleDir, 'events')).filter(file => file.endsWith('.jsonl'))
    const busEvents = eventFiles.flatMap(file => readJsonl(join(scaleDir, 'events', file)))
    expect(busEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'verification.recorded',
        sessionId: 'hook-verification',
        payload: expect.objectContaining({
          command: 'npm run build',
          status: 'passed',
          exitCode: 0,
        }),
      }),
    ]))
  })

  it('records configured keyword-free verification commands read from stdin (#34/#36)', async () => {
    const projectDir = makeDir('scale-hook-stdin-verification-project-')
    const scaleDir = join(projectDir, '.scale')
    writeFileSync(join(scaleDir, 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: { default: { commands: { smoke: 'powershell -File tools/validate-patterns.ps1' } } },
    }), 'utf-8')

    const result = await runScale([
      'gate',
      'post-tool',
      '--stdin',
    ], scaleDir, projectDir, {
      input: JSON.stringify({
        session_id: 'hook-stdin-verification',
        tool_name: 'PowerShell',
        tool_input: { command: 'powershell -File tools/validate-patterns.ps1' },
        tool_response: 'validation ok',
      }),
    })

    expect(result.exitCode).toBe(0)
    const evidence = readRuntimeEvidence(scaleDir)
    expect(evidence).toHaveLength(1)
    expect(evidence[0]).toEqual(expect.objectContaining({
      sessionId: 'hook-stdin-verification',
      kind: 'command',
      status: 'passed',
      command: 'powershell -File tools/validate-patterns.ps1',
      exitCode: 0,
    }))
  })

  it('reads the session id from the stdin payload for before-stop (#34)', async () => {
    const projectDir = makeDir('scale-hook-before-stop-stdin-project-')
    const scaleDir = join(projectDir, '.scale')

    const result = await runScale([
      'gate',
      'before-stop',
      '--stdin',
      '--hook-safe',
    ], scaleDir, projectDir, {
      input: JSON.stringify({ session_id: 'hook-stop-stdin', stop_hook_active: false }),
    })

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    // --hook-safe 路径不初始化 artifact engine
    expect(existsSync(join(scaleDir, 'scale.db'))).toBe(false)
  })

  it('runs session end with the session id from the stdin payload (#34)', async () => {
    const projectDir = makeDir('scale-hook-session-end-stdin-project-')
    const scaleDir = join(projectDir, '.scale')

    const result = await runScale([
      'session',
      'end',
      '--stdin',
    ], scaleDir, projectDir, {
      input: JSON.stringify({ session_id: 'hook-session-end-stdin', reason: 'clear' }),
    })

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, sessionId: 'hook-session-end-stdin' })
  })

  it('allows enforced before-stop after an edit followed by a recorded verification', async () => {
    const projectDir = makeDir('scale-hook-before-stop-project-')
    const scaleDir = join(projectDir, '.scale')
    const sessionId = 'hook-before-stop'

    const edit = await runScale([
      'gate',
      'post-tool',
      'Edit',
      '--session-id',
      sessionId,
      '--args-json',
      '{"file_path":"src/a.ts"}',
      '--exit-code',
      '0',
    ], scaleDir, projectDir)
    expect(edit.exitCode).toBe(0)

    const verification = await runScale([
      'gate',
      'post-tool',
      'Bash',
      '--session-id',
      sessionId,
      '--args-json',
      '{"command":"npm run build"}',
      '--exit-code',
      '0',
    ], scaleDir, projectDir)
    expect(verification.exitCode).toBe(0)

    const beforeStop = await runScale([
      'gate',
      'before-stop',
      '--session-id',
      sessionId,
      '--enforce',
    ], scaleDir, projectDir)

    expect(beforeStop.exitCode).toBe(0)
    expect(beforeStop.stderr).toBe('')
  }, 20_000)

  it('creates a same-day fallback hook session when the agent omits session id', async () => {
    const projectDir = makeDir('scale-hook-fallback-session-project-')
    const scaleDir = join(projectDir, '.scale')

    const result = await runScale([
      'gate',
      'post-tool',
      'Bash',
      '--args-json',
      '{"command":"npm test"}',
      '--exit-code',
      '0',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const current = JSON.parse(readFileSync(join(scaleDir, 'events', 'current-session.json'), 'utf-8')) as { sessionId: string }
    expect(current.sessionId).toMatch(/^HOOK-\d{4}-\d{2}-\d{2}$/)
    expect(readRuntimeEvidence(scaleDir)[0]).toEqual(expect.objectContaining({
      sessionId: current.sessionId,
      command: 'npm test',
      status: 'passed',
    }))
  })
})
