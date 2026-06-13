import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

let dirs: string[] = []
const CLI_ENTRY = join(process.cwd(), 'src/api/cli.ts')
const TSX_LOADER = pathToFileURL(join(process.cwd(), 'node_modules/tsx/dist/loader.mjs')).href

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
  let lastResult: Awaited<ReturnType<typeof execa>>
  for (let attempt = 0; attempt < 2; attempt += 1) {
    lastResult = await execa('node', ['--import', TSX_LOADER, CLI_ENTRY, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SCALE_DIR: scaleDir,
        SCALE_PROJECT_DIR: projectDir,
        SCALE_LOG_LEVEL: undefined,
      },
      reject: false,
      windowsHide: true,
    })
    if (!args.includes('--json') || String(lastResult.stdout ?? '').trim()) return lastResult
  }
  return lastResult!
}

function parseJson<T>(stdout: string, stderr = ''): T {
  const trimmed = stdout.trim()
  if (!trimmed) {
    throw new Error(`Expected JSON stdout but got empty output.${stderr ? ` stderr: ${stderr}` : ''}`)
  }
  return JSON.parse(trimmed) as T
}

function writeFailingSuite(scaleDir: string) {
  const suitesDir = join(scaleDir, 'evals', 'suites')
  mkdirSync(suitesDir, { recursive: true })
  writeFileSync(join(suitesDir, 'failing.json'), JSON.stringify({
    version: '1.0',
    id: 'failing',
    name: 'Failing replay suite',
    cases: [
      {
        id: 'missing-proof',
        type: 'bugfix',
        title: 'Missing verification evidence is preserved',
        task: 'Simulate an agent claim without a passing command.',
        phase: 'verify',
        successCriteria: ['command exits 0'],
        expectedFailureCategory: 'missing-verification-evidence',
        attempts: [
          {
            id: 'attempt-1',
            command: 'node -e "console.error(\'no verification evidence\'); process.exit(1)"',
            expectedExitCode: 0,
          },
        ],
      },
    ],
  }, null, 2), 'utf-8')
}

function writePassingSuite(scaleDir: string) {
  const suitesDir = join(scaleDir, 'evals', 'suites')
  mkdirSync(suitesDir, { recursive: true })
  writeFileSync(join(suitesDir, 'failing.json'), JSON.stringify({
    version: '1.0',
    id: 'failing',
    name: 'Failing replay suite',
    cases: [
      {
        id: 'missing-proof',
        type: 'bugfix',
        title: 'Missing verification evidence is preserved',
        task: 'Simulate an agent claim with runtime evidence.',
        phase: 'verify',
        successCriteria: ['command exits 0'],
        expectedFailureCategory: 'missing-verification-evidence',
        attempts: [
          {
            id: 'attempt-1',
            command: 'node -e "console.log(\'proof-ok\')"',
            expectedExitCode: 0,
            outputEquals: 'proof-ok',
          },
        ],
      },
    ],
  }, null, 2), 'utf-8')
}

describe('workflow eval CLI', () => {
  it('initializes and runs the default workflow baseline suite', async () => {
    const scaleDir = makeDir('scale-eval-cli-scale-')
    const projectDir = makeDir('scale-eval-cli-project-')

    const init = await runScale(['eval', 'init', '--json'], scaleDir, projectDir)
    expect(init.exitCode).toBe(0)
    const initReport = parseJson<{
      written: boolean
      path: string
      suite: { id: string; cases: Array<{ id: string; attempts?: Array<{ command: string; outputEquals?: string }> }> }
    }>(init.stdout, init.stderr)
    expect(initReport.written).toBe(true)
    expect(initReport.path.replace(/\\/g, '/')).toContain('/evals/suites/workflow-baseline.json')
    expect(initReport.suite.cases).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'governance-command-smoke' }),
      expect.objectContaining({ id: 'bugfix-regex-escape' }),
      expect.objectContaining({ id: 'bugfix-concurrent-write' }),
      expect.objectContaining({ id: 'bugfix-encoding-utf8' }),
      expect.objectContaining({ id: 'feature-diff-view' }),
    ]))
    expect(initReport.suite.cases.length).toBeGreaterThan(10)
    const endpointCase = initReport.suite.cases.find(item => item.id === 'feature-api-endpoint')
    expect(endpointCase?.attempts?.[0].command).not.toContain('\\d')
    expect(endpointCase?.attempts?.[0].outputEquals).toBe('valid-id')

    const run = await runScale(['eval', 'run', '--json'], scaleDir, projectDir)
    expect(run.exitCode).toBe(0)
    const runReport = parseJson<{
      run: {
        ok: boolean
        id: string
        suiteId: string
        cases: Array<{ id: string; attempts: Array<{ outputSummary: string }> }>
        metrics: { total: number; passed: number; passAt1Rate: number; failureReplayCount: number }
      }
      runPath: string
    }>(run.stdout, run.stderr)
    expect(runReport.run.ok).toBe(true)
    expect(runReport.run.suiteId).toBe('workflow-baseline')
    expect(runReport.run.metrics.total).toBe(initReport.suite.cases.length)
    expect(runReport.run.metrics.passed).toBe(runReport.run.metrics.total)
    expect(runReport.run.metrics.passAt1Rate).toBe(1)
    expect(runReport.run.metrics.failureReplayCount).toBe(0)
    expect(runReport.run.cases.find(item => item.id === 'feature-api-endpoint')?.attempts[0].outputSummary).toBe('valid-id')
    expect(existsSync(runReport.runPath)).toBe(true)
  }, 120_000)

  it('preserves failure replay records and promotes an improvement candidate', async () => {
    const scaleDir = makeDir('scale-eval-cli-scale-')
    const projectDir = makeDir('scale-eval-cli-project-')
    writeFailingSuite(scaleDir)

    const run = await runScale(['eval', 'run', '--suite', 'failing', '--json'], scaleDir, projectDir)
    expect(run.exitCode).toBe(1)
    const runReport = parseJson<{
      run: {
        ok: boolean
        metrics: { failed: number; failureReplayCount: number }
        failureReplayIds: string[]
      }
      failurePaths: string[]
    }>(run.stdout, run.stderr)
    expect(runReport.run.ok).toBe(false)
    expect(runReport.run.metrics.failed).toBe(1)
    expect(runReport.run.metrics.failureReplayCount).toBe(1)
    expect(runReport.failurePaths.length).toBe(1)
    expect(existsSync(runReport.failurePaths[0])).toBe(true)

    const failures = await runScale(['eval', 'failures', '--task-id', 'missing-proof', '--json'], scaleDir, projectDir)
    expect(failures.exitCode).toBe(0)
    const failuresReport = parseJson<{
      count: number
      failures: Array<{ id: string; status: string; category: string; redactionApplied: boolean }>
    }>(failures.stdout, failures.stderr)
    expect(failuresReport.count).toBe(1)
    expect(failuresReport.failures[0]).toMatchObject({
      status: 'open',
      category: 'missing-verification-evidence',
    })

    const replay = await runScale(['eval', 'replay', failuresReport.failures[0].id, '--json'], scaleDir, projectDir)
    expect(replay.exitCode).toBe(0)
    const replayReport = parseJson<{ count: number; failures: Array<{ replayCommand: string; prevention: string }> }>(replay.stdout, replay.stderr)
    expect(replayReport.count).toBe(1)
    expect(replayReport.failures[0].replayCommand).toContain('process.exit(1)')
    expect(replayReport.failures[0].prevention).toContain('runtime evidence')

    const promote = await runScale(['eval', 'promote-failure', failuresReport.failures[0].id, '--json'], scaleDir, projectDir)
    expect(promote.exitCode).toBe(0)
    const candidate = parseJson<{ failureId: string; status: string; evidencePath: string }>(promote.stdout, promote.stderr)
    expect(candidate.failureId).toBe(failuresReport.failures[0].id)
    expect(candidate.status).toBe('candidate')
    expect(existsSync(candidate.evidencePath)).toBe(true)
  }, 120_000)

  it('closes open failure replay records after a passing rerun of the same case', async () => {
    const scaleDir = makeDir('scale-eval-cli-scale-')
    const projectDir = makeDir('scale-eval-cli-project-')
    writeFailingSuite(scaleDir)

    const failed = await runScale(['eval', 'run', '--suite', 'failing', '--json'], scaleDir, projectDir)
    expect(failed.exitCode).toBe(1)
    const failedReport = parseJson<{
      run: { failureReplayIds: string[] }
    }>(failed.stdout, failed.stderr)
    const failureId = failedReport.run.failureReplayIds[0]
    expect(failureId).toBeTruthy()

    writePassingSuite(scaleDir)
    const passed = await runScale(['eval', 'run', '--suite', 'failing', '--json'], scaleDir, projectDir)
    expect(passed.exitCode).toBe(0)
    const passedReport = parseJson<{
      run: { id: string; ok: boolean; metrics: { failureReplayCount: number } }
      closedFailureIds: string[]
    }>(passed.stdout, passed.stderr)
    expect(passedReport.run.ok).toBe(true)
    expect(passedReport.run.metrics.failureReplayCount).toBe(0)
    expect(passedReport.closedFailureIds).toContain(failureId)

    const failures = await runScale(['eval', 'failures', '--task-id', 'missing-proof', '--json'], scaleDir, projectDir)
    expect(failures.exitCode).toBe(0)
    const failuresReport = parseJson<{
      failures: Array<{ id: string; status: string; closedByEvalRunId?: string }>
    }>(failures.stdout, failures.stderr)
    expect(failuresReport.failures.filter(item => item.status === 'open')).toHaveLength(0)
    expect(failuresReport.failures.find(item => item.id === failureId)).toMatchObject({
      status: 'closed',
      closedByEvalRunId: passedReport.run.id,
    })
  }, 120_000)

  it('accepts UTF-8 BOM suite files generated by Windows tooling', async () => {
    const scaleDir = makeDir('scale-eval-cli-scale-')
    const projectDir = makeDir('scale-eval-cli-project-')
    writeFailingSuite(scaleDir)
    const suitePath = join(scaleDir, 'evals', 'suites', 'failing.json')
    writeFileSync(suitePath, `\uFEFF${readFileSync(suitePath, 'utf-8')}`, 'utf-8')

    const run = await runScale(['eval', 'run', '--suite', 'failing', '--json'], scaleDir, projectDir)
    expect(run.exitCode).toBe(1)
    const runReport = parseJson<{
      run: { ok: boolean; failureReplayIds: string[] }
    }>(run.stdout, run.stderr)
    expect(runReport.run.ok).toBe(false)
    expect(runReport.run.failureReplayIds.length).toBe(1)
  }, 120_000)

  it('compares runs and renders a Markdown eval report', async () => {
    const scaleDir = makeDir('scale-eval-cli-scale-')
    const projectDir = makeDir('scale-eval-cli-project-')

    const first = await runScale(['eval', 'run', '--json'], scaleDir, projectDir)
    const second = await runScale(['eval', 'run', '--json'], scaleDir, projectDir)
    expect(first.exitCode).toBe(0)
    expect(second.exitCode).toBe(0)
    const firstRun = parseJson<{ run: { id: string } }>(first.stdout, first.stderr)
    const secondRun = parseJson<{ run: { id: string } }>(second.stdout, second.stderr)

    const compare = await runScale([
      'eval',
      'compare',
      '--baseline',
      firstRun.run.id,
      '--candidate',
      secondRun.run.id,
      '--json',
    ], scaleDir, projectDir)
    expect(compare.exitCode).toBe(0)
    const comparison = parseJson<{ recommendation: string; delta: { passAt1Rate: number } }>(compare.stdout, compare.stderr)
    expect(comparison.recommendation).toBe('same')
    expect(comparison.delta.passAt1Rate).toBe(0)

    const output = join(projectDir, 'reports', 'eval.md')
    const report = await runScale(['eval', 'report', '--run', secondRun.run.id, '--output', output, '--json'], scaleDir, projectDir)
    expect(report.exitCode).toBe(0)
    const reportJson = parseJson<{ outputPath: string; markdown: string }>(report.stdout, report.stderr)
    expect(reportJson.outputPath).toBe(output)
    expect(reportJson.markdown).toContain('# Workflow Eval Report')
    expect(readFileSync(output, 'utf-8')).toContain('Pass@1')
  }, 120_000)
})
