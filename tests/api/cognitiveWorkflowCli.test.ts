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

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || 'evidence'
}

describe('cognitive workflow CLI', () => {
  it('prints context grill checks as JSON', async () => {
    const scaleDir = makeDir('scale-cognitive-cli-scale-')
    const projectDir = makeDir('scale-cognitive-cli-project-')
    mkdirSync(join(projectDir, 'docs', 'modules', 'upload'), { recursive: true })
    writeFileSync(join(projectDir, 'CONTEXT.md'), [
      '# CONTEXT.md',
      '',
      '| Term | Definition | Examples | Aliases | Source |',
      '|------|------------|----------|---------|--------|',
      '| Tenant | Data boundary | tenant_id | org | product |',
    ].join('\n'), 'utf-8')

    const result = await runScale([
      'context',
      'grill',
      '--dir',
      projectDir,
      '--task',
      'Add tenant-aware upload authorization',
      '--files',
      'src/upload/handler.ts',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const report = parseJson<{ ok: boolean; findings: Array<{ code: string }>; questions: Array<{ topic: string }> }>(result.stdout)
    expect(report.ok).toBe(false)
    expect(report.findings.map(finding => finding.code)).toContain('missing-context-map')
    expect(report.questions.map(question => question.topic)).toContain('risk-and-rollback')
  }, 120_000)

  it('writes context grill output into the task explore artifact and workflow state', async () => {
    const scaleDir = makeDir('scale-cognitive-cli-scale-')
    const projectDir = makeDir('scale-cognitive-cli-project-')
    const artifactDir = join('docs', 'worklog', 'tasks', '2026-05-18-context')
    mkdirSync(join(projectDir, artifactDir), { recursive: true })
    writeFileSync(join(projectDir, artifactDir, 'explore.md'), '# Explore\n', 'utf-8')

    const result = await runScale([
      'context',
      'grill',
      '--dir',
      projectDir,
      '--task-id',
      'TASK-CONTEXT',
      '--task',
      'Add tenant-aware upload authorization',
      '--files',
      'src/upload/handler.ts',
      '--artifact-dir',
      artifactDir,
      '--write',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const output = parseJson<{ artifactPath?: string }>(result.stdout)
    expect(output.artifactPath).toBe(join(projectDir, artifactDir, 'explore.md'))
    expect(readFileSync(join(projectDir, artifactDir, 'explore.md'), 'utf-8')).toContain('SCALE Context Grill')
    expect(JSON.parse(readFileSync(join(scaleDir, 'state', 'current.json'), 'utf-8'))).toMatchObject({
      taskId: 'TASK-CONTEXT',
      phase: 'explore',
      artifactsDir: artifactDir.replace(/\\/g, '/'),
      exploredFiles: ['src/upload/handler.ts'],
    })
  }, 120_000)

  it('prints diagnosis readiness as JSON', async () => {
    const scaleDir = makeDir('scale-cognitive-cli-scale-')
    const projectDir = makeDir('scale-cognitive-cli-project-')

    const result = await runScale([
      'diagnose',
      'plan',
      '--task-id',
      'BUG-CLI',
      '--symptom',
      'Gateway returns 404 for upload route',
      '--repro',
      'npm test -- upload-route.test.ts',
      '--expected-failure',
      'registered route should match the request path',
      '--verify',
      'npm test -- upload-route.test.ts,npm run lint',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const output = parseJson<{ validation: { ready: boolean }; loop: { hypotheses: unknown[] } }>(result.stdout)
    expect(output.validation.ready).toBe(true)
    expect(output.loop.hypotheses.length).toBeGreaterThanOrEqual(3)
  }, 120_000)

  it('writes diagnosis output into the task plan artifact and workflow state', async () => {
    const scaleDir = makeDir('scale-cognitive-cli-scale-')
    const projectDir = makeDir('scale-cognitive-cli-project-')
    const artifactDir = join('docs', 'worklog', 'tasks', '2026-05-18-diagnose')
    mkdirSync(join(projectDir, artifactDir), { recursive: true })
    writeFileSync(join(projectDir, artifactDir, 'plan.md'), '# Plan\n', 'utf-8')

    const result = await runScale([
      'diagnose',
      'plan',
      '--task-id',
      'BUG-ARTIFACT',
      '--symptom',
      'Gateway returns 404 for upload route',
      '--repro',
      'npm test -- upload-route.test.ts',
      '--expected-failure',
      'registered route should match the request path',
      '--verify',
      'npm test -- upload-route.test.ts,npm run lint',
      '--files',
      'src/upload/routes.ts',
      '--artifact-dir',
      artifactDir,
      '--write',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const output = parseJson<{ artifactPath?: string }>(result.stdout)
    expect(output.artifactPath).toBe(join(projectDir, artifactDir, 'plan.md'))
    expect(readFileSync(join(projectDir, artifactDir, 'plan.md'), 'utf-8')).toContain('SCALE Diagnostic Loop')
    expect(JSON.parse(readFileSync(join(scaleDir, 'state', 'current.json'), 'utf-8'))).toMatchObject({
      taskId: 'BUG-ARTIFACT',
      phase: 'plan',
      artifactsDir: artifactDir.replace(/\\/g, '/'),
      filesModified: ['src/upload/routes.ts'],
    })
  }, 120_000)

  it('prints TDD vertical slice readiness as JSON', async () => {
    const scaleDir = makeDir('scale-cognitive-cli-scale-')
    const projectDir = makeDir('scale-cognitive-cli-project-')

    const result = await runScale([
      'tdd',
      'slice',
      '--task-id',
      'TDD-CLI',
      '--behavior',
      'Mask access tokens in logs',
      '--public-interface',
      'logger.info',
      '--failing-test',
      'npm test -- logger.masking.test.ts',
      '--test-file',
      'tests/logger.masking.test.ts',
      '--impl-files',
      'src/logger.ts',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const output = parseJson<{ evaluation: { readyForImplementation: boolean; blockers: string[] } }>(result.stdout)
    expect(output.evaluation.readyForImplementation).toBe(false)
    expect(output.evaluation.blockers.join('\n')).toContain('RED evidence')
  }, 120_000)

  it('writes TDD slice output into verification artifact and durable TDD state', async () => {
    const scaleDir = makeDir('scale-cognitive-cli-scale-')
    const projectDir = makeDir('scale-cognitive-cli-project-')
    const artifactDir = join('docs', 'worklog', 'tasks', '2026-05-18-tdd')
    mkdirSync(join(projectDir, artifactDir), { recursive: true })
    writeFileSync(join(projectDir, artifactDir, 'verification.md'), '# Verification\n', 'utf-8')

    const result = await runScale([
      'tdd',
      'slice',
      '--task-id',
      'TDD-ARTIFACT',
      '--behavior',
      'Mask access tokens in logs',
      '--public-interface',
      'logger.info',
      '--failing-test',
      'npm test -- logger.masking.test.ts',
      '--test-file',
      'tests/logger.masking.test.ts',
      '--impl-files',
      'src/logger.ts',
      '--red-exit-code',
      '1',
      '--red-summary',
      'expected masked token, received raw token',
      '--green-exit-code',
      '0',
      '--green-summary',
      'masking test passed',
      '--refactor-exit-code',
      '0',
      '--refactor-summary',
      'masking test stayed green after cleanup',
      '--artifact-dir',
      artifactDir,
      '--write',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const output = parseJson<{ artifactPath?: string; tddStatePath?: string; evaluation: { readyForCompletion: boolean } }>(result.stdout)
    expect(output.evaluation.readyForCompletion).toBe(true)
    expect(output.artifactPath).toBe(join(projectDir, artifactDir, 'verification.md'))
    expect(readFileSync(join(projectDir, artifactDir, 'verification.md'), 'utf-8')).toContain('SCALE TDD Vertical Slice')
    expect(output.tddStatePath).toBe(join(scaleDir, 'state', 'tdd-TDD-ARTIFACT.json'))
    expect(existsSync(join(scaleDir, 'state', 'tdd-TDD-ARTIFACT.json'))).toBe(true)
  }, 120_000)

  it('keeps TDD state output inside the state directory when task-id contains traversal tokens', async () => {
    const scaleDir = makeDir('scale-cognitive-cli-scale-')
    const projectDir = makeDir('scale-cognitive-cli-project-')
    const taskId = '../../../../TDD-ESCAPE'

    const result = await runScale([
      'tdd',
      'slice',
      '--task-id',
      taskId,
      '--behavior',
      'Mask access tokens in logs',
      '--public-interface',
      'logger.info',
      '--failing-test',
      'npm test -- logger.masking.test.ts',
      '--test-file',
      'tests/logger.masking.test.ts',
      '--impl-files',
      'src/logger.ts',
      '--red-exit-code',
      '1',
      '--red-summary',
      'expected masked token, received raw token',
      '--green-exit-code',
      '0',
      '--green-summary',
      'masking test passed',
      '--refactor-exit-code',
      '0',
      '--refactor-summary',
      'masking test stayed green after cleanup',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const output = parseJson<{ tddStatePath?: string }>(result.stdout)
    expect(output.tddStatePath).toBe(join(scaleDir, 'state', `tdd-${safePathSegment(taskId)}.json`))
    expect(existsSync(output.tddStatePath!)).toBe(true)
    expect(existsSync(join(scaleDir, 'state', `tdd-${taskId}.json`))).toBe(false)
  }, 120_000)
})
