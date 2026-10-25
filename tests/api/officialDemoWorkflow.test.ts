import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  dirs = []
})

function makeDir(prefix: string): string {
  // G23 discipline: temp dirs live under the managed .scale/tmp/ root (needs
  // repo locality — tsc resolves vitest types by walking up to the repo's
  // node_modules; OS tmpdir would break that). 72h TTL self-heals stragglers.
  const root = join(process.cwd(), '.scale', 'tmp')
  mkdirSync(root, { recursive: true })
  const dir = mkdtempSync(join(root, prefix))
  dirs.push(dir)
  return dir
}

function copyOfficialDemo(targetDir: string): void {
  cpSync(resolve('examples/demo-projects/agent-governance-demo'), targetDir, {
    recursive: true,
    filter: source => !source.includes('node_modules'),
  })
}

async function runScale(args: string[], scaleDir: string, projectDir: string) {
  return execa('node', ['--import', 'tsx', 'src/api/cli.ts', ...args], {
    env: {
      ...buildDemoEnv(),
      SCALE_DIR: scaleDir,
      SCALE_PROJECT_DIR: projectDir,
      SCALE_LOG_LEVEL: undefined,
      SCALE_VERIFICATION_BUILD_CMD: undefined,
      SCALE_VERIFICATION_LINT_CMD: undefined,
      SCALE_VERIFICATION_TEST_CMD: undefined,
      SCALE_VERIFICATION_COVERAGE_CMD: undefined,
    },
    reject: false,
  })
}

function buildDemoEnv(): NodeJS.ProcessEnv {
  const rootBin = join(process.cwd(), 'node_modules', '.bin')
  return {
    ...process.env,
    PATH: [rootBin, process.env.PATH ?? ''].filter(Boolean).join(delimiter),
  }
}

function expectExitZero(result: { exitCode: number | null; stdout: string; stderr: string }): void {
  expect(result.exitCode, [result.stdout, result.stderr].filter(Boolean).join('\n')).toBe(0)
}

describe('official agent governance demo workflow', () => {
  it('runs the documented governance loop through runtime evidence, memory settlement, and HTML artifact checks', async () => {
    const projectDir = makeDir('scale-official-demo-project-')
    const scaleDir = makeDir('scale-official-demo-state-')
    const taskId = '2026-05-18-oauth-state'
    copyOfficialDemo(projectDir)

    const businessTest = await execa('npm', ['test'], {
      cwd: projectDir,
      env: buildDemoEnv(),
      reject: false,
    })
    expectExitZero(businessTest)

    const init = await runScale(['init', '--dir', projectDir, '--governance-pack', 'node-library', '--json'], scaleDir, projectDir)
    expectExitZero(init)

    const preflight = await runScale(['preflight', '--dir', projectDir, '--preflight-profile', 'quick', '--json'], scaleDir, projectDir)
    expectExitZero(preflight)

    await expect(runScale(['context', 'init', '--name', 'Agent Governance Demo'], scaleDir, projectDir)).resolves.toMatchObject({ exitCode: 0 })
    await expect(runScale(['runtime', 'start', '--session-id', taskId, '--task-id', taskId, '--level', 'M', '--agent', 'codex', '--json'], scaleDir, projectDir)).resolves.toMatchObject({ exitCode: 0 })
    await expect(runScale(['context', 'grill', '--task-id', taskId, '--task', '加固 OAuth state 校验', '--json'], scaleDir, projectDir)).resolves.toMatchObject({ exitCode: 0 })
    await expect(runScale(['diagnose', 'plan', '--task-id', taskId, '--symptom', 'OAuth callback 在 state 过期或不匹配时行为不明确', '--json'], scaleDir, projectDir)).resolves.toMatchObject({ exitCode: 0 })
    await expect(runScale([
      'tdd',
      'slice',
      '--task-id',
      taskId,
      '--behavior',
      '拒绝过期、已消费或不匹配的 OAuth state',
      '--public-interface',
      'verifyOAuthState(record, providedState, now)',
      '--failing-test',
      'expired, consumed, mismatched state should return ok=false',
      '--test-file',
      'tests/oauth-state.test.ts',
      '--impl-files',
      'src/oauth-state.ts',
      '--json',
    ], scaleDir, projectDir)).resolves.toMatchObject({ exitCode: 0 })

    await expect(runScale([
      'runtime',
      'record',
      '--title',
      'demo business tests',
      '--kind',
      'command',
      '--status',
      'passed',
      '--command',
      'npx vitest run tests/oauth-state.test.ts',
      '--exit-code',
      '0',
      '--summary',
      'official demo OAuth state tests passed',
      '--json',
    ], scaleDir, projectDir)).resolves.toMatchObject({ exitCode: 0 })

    await expect(runScale(['runtime', 'final-check', '--task-id', taskId, '--session-id', taskId, '--level', 'M', '--json'], scaleDir, projectDir)).resolves.toMatchObject({ exitCode: 0 })

    const pack = await runScale(['memory', 'pack', '--task-id', taskId, '--session-id', taskId, '--task', '加固 OAuth state 校验', '--level', 'M', '--budget', '4000', '--json'], scaleDir, projectDir)
    expect(pack.exitCode).toBe(0)
    expect(pack.stdout).toContain('runtime-evidence')

    const settle = await runScale(['memory', 'settle', '--task-id', taskId, '--session-id', taskId, '--task', '加固 OAuth state 校验', '--level', 'M', '--json'], scaleDir, projectDir)
    expect(settle.exitCode).toBe(0)
    const settlement = JSON.parse(settle.stdout) as { candidate: { recommendedAction: string }; files: { markdown: string } }
    expect(settlement.candidate.recommendedAction).toBe('review-for-knowledge-base')
    expect(readFileSync(settlement.files.markdown, 'utf-8')).toContain('demo business tests')

    const render = await runScale(['artifact', 'render', '--dir', projectDir, '--task-id', taskId, '--type', 'status-report', '--json'], scaleDir, projectDir)
    expect(render.exitCode).toBe(0)
    const rendered = JSON.parse(render.stdout) as { outputPath: string }
    expect(existsSync(rendered.outputPath)).toBe(true)

    const doctor = await runScale(['artifact', 'doctor', '--dir', projectDir, '--task-id', taskId, '--json'], scaleDir, projectDir)
    expect(doctor.exitCode).toBe(0)
  }, 180_000)
})
