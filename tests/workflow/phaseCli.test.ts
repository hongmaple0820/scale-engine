import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'

let dirs: string[] = []
let repoFiles: string[] = []
let repoDirs: string[] = []

function makeScaleDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-cli-'))
  dirs.push(dir)
  return dir
}

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-project-'))
  dirs.push(dir)
  return dir
}

async function runScale(args: string[], scaleDir: string, projectDir?: string) {
  return execa('node', ['--import', 'tsx', 'src/api/cli.ts', ...args], {
    env: {
      ...process.env,
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

async function runScaleWithoutProjectEnv(args: string[]) {
  return execa('node', ['--import', 'tsx', 'src/api/cli.ts', ...args], {
    env: {
      ...process.env,
      SCALE_DIR: undefined,
      SCALE_PROJECT_DIR: undefined,
      SCALE_LOG_LEVEL: undefined,
      SCALE_VERIFICATION_BUILD_CMD: undefined,
      SCALE_VERIFICATION_LINT_CMD: undefined,
      SCALE_VERIFICATION_TEST_CMD: undefined,
      SCALE_VERIFICATION_COVERAGE_CMD: undefined,
    },
    reject: false,
  })
}

function parseJson<T = unknown>(stdout: string): T {
  return JSON.parse(stdout) as T
}

function coverageFixtureCommand(coverage = '100.00'): string {
  const text = `All files | 100.00 | 100.00 | 100.00 | 100.00 | ${coverage}`
  const codes = Array.from(text).map(char => char.charCodeAt(0)).join(',')
  return `node -e "process.stdout.write(String.fromCharCode(${codes}))"`
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  for (const file of repoFiles) rmSync(file, { force: true })
  for (const dir of repoDirs) rmSync(dir, { recursive: true, force: true })
  // Clean up test-fixtures/phase-cli directory if created
  rmSync(join('test-fixtures', 'phase-cli'), { recursive: true, force: true })
  dirs = []
  repoFiles = []
  repoDirs = []
})

describe('phase CLI workflow', () => {
  it('prints status on a fresh project without workflow state', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()

    const status = await runScale(['status', '--json'], scaleDir, projectDir)

    expect(status.exitCode).toBe(0)
    const result = parseJson<{ nextCommand: string; workflowState: null }>(status.stdout)
    expect(result.workflowState).toBeNull()
    expect(result.nextCommand).toContain('scale define')
  })

  it('initializes a project-scaffold governance pack and reports clean drift', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()

    const init = await runScale([
      'init',
      '--agent',
      'codex',
      '--dir',
      projectDir,
      '--governance-pack',
      'project-scaffold',
    ], scaleDir, projectDir)

    expect(init.exitCode).toBe(0)
    expect(existsSync(join(projectDir, '.scale', 'governance.lock.json'))).toBe(true)
    expect(existsSync(join(projectDir, 'scripts', 'workflow', 'new-task.sh'))).toBe(true)
    expect(readFileSync(join(projectDir, 'scripts', 'workflow', 'new-task.sh'), 'utf-8')).toContain('@hongmaple0820/scale-engine@latest')

    const diff = await runScale(['governance', 'diff', '--dir', projectDir, '--json'], scaleDir, projectDir)

    expect(diff.exitCode).toBe(0)
    expect(parseJson<{ lockExists: boolean; changed: unknown[]; missing: unknown[] }>(diff.stdout)).toMatchObject({
      lockExists: true,
      changed: [],
      missing: [],
    })
  }, 120_000)

  it('honors --agent when quick init is requested and can emit clean JSON', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()

    const init = await runScale([
      'init',
      '--quick',
      '--agent',
      'codex',
      '--dir',
      projectDir,
      '--governance-pack',
      'project-scaffold',
      '--json',
    ], scaleDir, projectDir)

    expect(init.exitCode).toBe(0)
    const result = parseJson<{ ok: boolean; mode: string; agent: string; created: string[]; nextSteps: string[] }>(init.stdout)
    expect(result).toMatchObject({ ok: true, mode: 'quick-agent', agent: 'codex' })
    expect(result.nextSteps).toEqual(expect.arrayContaining([
      'edit .scale/product-smoke.json and enable a real product-path probe',
      'scale preflight --profile productSmoke --json',
      'scale runtime final-check --level M --json',
    ]))
    expect(existsSync(join(projectDir, '.codex', 'hooks.json'))).toBe(true)
    expect(existsSync(join(projectDir, '.scale', 'governance.lock.json'))).toBe(true)
  }, 120_000)

  it('can initialize governance templates without an agent platform when a governance pack is explicit', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()

    const init = await runScale([
      'init',
      '--dir',
      projectDir,
      '--governance-pack',
      'standard',
      '--json',
    ], scaleDir, projectDir)

    expect(init.exitCode).toBe(0)
    const result = parseJson<{ ok: boolean; mode: string; platform: string | null; created: string[] }>(init.stdout)
    expect(result).toMatchObject({ ok: true, mode: 'governance-only', platform: null })
    expect(existsSync(join(projectDir, '.scale', 'governance.lock.json'))).toBe(true)
    expect(existsSync(join(projectDir, '.scale', 'tools.json'))).toBe(true)
    expect(existsSync(join(projectDir, 'docs', 'workflow', 'README.md'))).toBe(true)
  }, 120_000)

  it('prints workflow list as machine-readable JSON', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()

    const list = await runScale(['workflow', 'list', '--json'], scaleDir, projectDir)

    expect(list.exitCode).toBe(0)
    const result = parseJson<{ ok: boolean; count: number; presets: Array<{ id: string; steps: unknown[] }> }>(list.stdout)
    expect(result.ok).toBe(true)
    expect(result.count).toBeGreaterThan(0)
    expect(result.presets[0].id).toBeTruthy()
  }, 120_000)

  it('prints skill doctor as machine-readable JSON', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()

    const doctor = await runScale(['skill', 'doctor', '--dir', projectDir, '--json'], scaleDir, projectDir)

    expect(doctor.exitCode).toBe(0)
    const result = parseJson<{ total: number; installed: number; missing: number; skills: Array<{ id: string; installCommand: string }> }>(doctor.stdout)
    expect(result.total).toBeGreaterThan(0)
    expect(result.installed + result.missing).toBe(result.total)
    expect(result.skills.map(skill => skill.id)).toEqual(expect.arrayContaining(['frontend-design', 'webapp-testing', 'code-reviewer']))
    expect(result.skills.find(skill => skill.id === 'frontend-design')?.installCommand).toContain('frontend-design')
  }, 120_000)

  it('prints resource asset scan and doctor as machine-readable JSON', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()
    mkdirSync(join(projectDir, 'docs', 'modules', 'auth'), { recursive: true })
    mkdirSync(join(projectDir, 'test-results', 'upload'), { recursive: true })
    writeFileSync(join(projectDir, 'docs', 'modules', 'auth', 'architecture.md'), '# Auth\n', 'utf-8')
    writeFileSync(join(projectDir, 'test-results', 'upload', 'report.json'), '{}\n', 'utf-8')

    const scan = await runScale(['assets', 'scan', '--dir', projectDir, '--json'], scaleDir, projectDir)

    expect(scan.exitCode).toBe(0)
    const result = parseJson<{ summary: { byType: Record<string, number> }; assets: Array<{ path: string; gitPolicy: string }> }>(scan.stdout)
    expect(result.summary.byType['canonical-doc']).toBe(1)
    expect(result.summary.byType['evidence-report']).toBe(1)
    expect(result.assets.find(asset => asset.path === 'test-results/upload/report.json')).toMatchObject({ gitPolicy: 'ignore' })

    const doctor = await runScale(['assets', 'doctor', '--dir', projectDir, '--json'], scaleDir, projectDir)
    expect(doctor.exitCode).toBe(0)
    expect(parseJson<{ ok: boolean }>(doctor.stdout).ok).toBe(true)

    const artifactDir = 'docs/worklog/tasks/2026-05-15-assets'
    const settle = await runScale([
      'assets',
      'settle',
      '--dir',
      projectDir,
      '--task-id',
      'TASK-ASSETS',
      '--artifact-dir',
      artifactDir,
      '--json',
    ], scaleDir, projectDir)
    expect(settle.exitCode).toBe(0)
    const settleResult = parseJson<{ ok: boolean; resourceImpactPath: string }>(settle.stdout)
    expect(settleResult.ok).toBe(true)
    expect(existsSync(settleResult.resourceImpactPath)).toBe(true)
  }, 120_000)

  it('prints engineering standards scan and doctor as machine-readable JSON', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()
    mkdirSync(join(projectDir, 'src', 'business'), { recursive: true })
    writeFileSync(join(projectDir, 'src', 'business', 'leaky.ts'), `
export function leaky(token: string) {
  console.log('token', token)
}
`, 'utf-8')

    const scan = await runScale(['standards', 'scan', '--dir', projectDir, '--json'], scaleDir, projectDir)

    expect(scan.exitCode).toBe(0)
    const scanResult = parseJson<{ summary: { totalFindings: number; blockingFindings: number }; findings: Array<{ ruleId: string }> }>(scan.stdout)
    expect(scanResult.summary.totalFindings).toBeGreaterThan(0)
    expect(scanResult.findings.map(finding => finding.ruleId)).toContain('sensitive-log')

    const doctor = await runScale(['standards', 'doctor', '--dir', projectDir, '--json'], scaleDir, projectDir)
    expect(doctor.exitCode).toBe(1)
    expect(parseJson<{ ok: boolean }>(doctor.stdout).ok).toBe(false)

    const artifactDir = 'docs/worklog/tasks/2026-05-15-standards'
    const settle = await runScale([
      'standards',
      'settle',
      '--dir',
      projectDir,
      '--task-id',
      'TASK-STANDARDS',
      '--artifact-dir',
      artifactDir,
      '--json',
    ], scaleDir, projectDir)
    expect(settle.exitCode).toBe(1)
    const settleResult = parseJson<{ ok: boolean; standardsImpactPath: string }>(settle.stdout)
    expect(settleResult.ok).toBe(false)
    expect(existsSync(settleResult.standardsImpactPath)).toBe(true)
  }, 120_000)

  it('can run standards doctor against explicit changed files only', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()
    mkdirSync(join(projectDir, 'src', 'legacy'), { recursive: true })
    mkdirSync(join(projectDir, 'src', 'feature'), { recursive: true })
    writeFileSync(join(projectDir, 'src', 'legacy', 'old.ts'), 'try { oldWork() } catch (error) {}\n', 'utf-8')
    writeFileSync(join(projectDir, 'src', 'feature', 'new.ts'), 'try { newWork() } catch (error) {}\n', 'utf-8')

    const doctor = await runScale([
      'standards',
      'doctor',
      '--dir',
      projectDir,
      '--changed-files',
      'src/feature/new.ts',
      '--json',
    ], scaleDir, projectDir)

    expect(doctor.exitCode).toBe(1)
    const result = parseJson<{
      scan: { summary: { filesScanned: number } }
      findings: Array<{ path: string; ruleId: string }>
    }>(doctor.stdout)
    expect(result.scan.summary.filesScanned).toBe(1)
    expect(result.findings.some(finding => finding.path === 'src/legacy/old.ts')).toBe(false)
    expect(result.findings.some(finding => finding.path === 'src/feature/new.ts' && finding.ruleId === 'empty-catch')).toBe(true)
  }, 120_000)

  it('can generate a standards baseline and legacy debt classification report', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()
    mkdirSync(join(projectDir, 'src', 'legacy'), { recursive: true })
    writeFileSync(join(projectDir, 'src', 'legacy', 'auth.ts'), `
export function login(token: string) {
  console.log('token', token)
}
`, 'utf-8')
    writeFileSync(join(projectDir, 'src', 'legacy', 'cleanup.ts'), 'try { cleanup() } catch (error) {}\n', 'utf-8')

    const baseline = await runScale([
      'standards',
      'baseline',
      '--dir',
      projectDir,
      '--write',
      '--artifact-dir',
      'docs/worklog/tasks/2026-05-15-standards-baseline',
      '--task-id',
      'TASK-BASELINE',
      '--reason',
      'legacy rollout baseline',
      '--json',
    ], scaleDir, projectDir)

    expect(baseline.exitCode).toBe(0)
    const result = parseJson<{
      wroteBaseline: boolean
      baselinePath: string
      legacyDebtPath: string
      debt: { byRule: Record<string, { total: number }> }
    }>(baseline.stdout)
    expect(result.wroteBaseline).toBe(true)
    expect(result.baselinePath).toBe(join(projectDir, '.scale', 'engineering-standards-baseline.json'))
    expect(result.legacyDebtPath).toBe(join(projectDir, 'docs', 'worklog', 'tasks', '2026-05-15-standards-baseline', 'standards-legacy-debt.md'))
    expect(result.debt.byRule['sensitive-log'].total).toBeGreaterThanOrEqual(1)
    expect(existsSync(result.baselinePath)).toBe(true)
    expect(readFileSync(result.legacyDebtPath, 'utf-8')).toContain('Legacy Debt Classification')

    const doctor = await runScale(['standards', 'doctor', '--dir', projectDir, '--json'], scaleDir, projectDir)
    expect(doctor.exitCode).toBe(0)
    expect(parseJson<{ ok: boolean }>(doctor.stdout).ok).toBe(true)
  }, 120_000)

  it('can include required skill installation status in skill checks', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()
    mkdirSync(join(scaleDir, 'state'), { recursive: true })
    writeFileSync(join(scaleDir, 'state', 'current.json'), JSON.stringify({
      schemaVersion: 1,
      taskId: 'TASK-skill-install',
      level: 'M',
      phase: 'verify',
      exploredFiles: [],
      fileCount: 0,
      mainContradiction: '',
      completedGates: [],
      openTasks: [],
      filesModified: [],
      skillRoutingMode: 'block',
      requiredSkills: ['missing-required-skill'],
      requiredSkillArtifacts: [],
      updatedAt: '2026-05-15T00:00:00.000Z',
    }, null, 2), 'utf-8')

    const check = await runScale(['skill', 'check', '--require-installed', '--json'], scaleDir, projectDir)

    expect(check.exitCode).toBe(0)
    const result = parseJson<{
      complete: boolean
      blocked: boolean
      skillInstallation: { checked: boolean; ok: boolean; missing: string[]; unknown: string[] }
    }>(check.stdout)
    expect(result.complete).toBe(false)
    expect(result.blocked).toBe(true)
    expect(result.skillInstallation).toMatchObject({
      checked: true,
      ok: false,
      missing: ['missing-required-skill'],
      unknown: ['missing-required-skill'],
    })
  }, 120_000)

  it('runs service-aware preflight without requiring a task', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()
    mkdirSync(join(projectDir, 'services', 'api'), { recursive: true })
    mkdirSync(join(projectDir, 'services', 'gateway'), { recursive: true })
    writeFileSync(join(scaleDir, 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: { default: { commands: {} } },
      services: [
        { name: 'api', path: 'services/api', required: true },
        { name: 'gateway', path: 'services/gateway', required: true },
      ],
    }, null, 2), 'utf-8')

    const coverageCommand = coverageFixtureCommand()
    const preflight = await runScale([
      'preflight',
      '--service',
      'all',
      '--preflight-profile',
      'full',
      '--build-cmd',
      'node -v',
      '--lint-cmd',
      'node -v',
      '--test-cmd',
      'node -v',
      '--coverage-cmd',
      coverageCommand,
      '--json',
    ], scaleDir, projectDir)

    expect(preflight.exitCode).toBe(0)
    const result = parseJson<{ passed: boolean; services: string[]; targets: Array<{ service: string; passed: boolean }> }>(preflight.stdout)
    expect(result.passed).toBe(true)
    expect(result.services).toEqual(['api', 'gateway'])
    expect(result.targets.every(target => target.passed)).toBe(true)
  }, 120_000)

  it('honors --dir for init and preflight without SCALE_PROJECT_DIR', async () => {
    const projectDir = makeProjectDir()
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({
      name: 'small-scaffold-app',
      type: 'module',
      scripts: {
        build: 'node -v',
        lint: 'node -v',
        test: 'node -v',
      },
    }, null, 2), 'utf-8')

    const init = await runScaleWithoutProjectEnv([
      'init',
      '--dir',
      projectDir,
      '--governance-pack',
      'project-scaffold',
      '--agent',
      'codex',
      '--json',
    ])
    expect(init.exitCode).toBe(0)

    const preflight = await runScaleWithoutProjectEnv([
      'preflight',
      '--dir',
      projectDir,
      '--service',
      'all',
      '--preflight-profile',
      'quick',
      '--json',
    ])

    expect(preflight.exitCode).toBe(0)
    const result = parseJson<{ passed: boolean; services: string[]; targets: Array<{ service: string; cwd: string; passed: boolean }> }>(preflight.stdout)
    expect(result.passed).toBe(true)
    expect(result.services).toEqual(['small-scaffold-app'])
    expect(result.targets).toEqual([
      expect.objectContaining({
        service: 'small-scaffold-app',
        cwd: projectDir,
        passed: true,
      }),
    ])
  }, 120_000)

  it('passes governance-only preflight when no services or root commands are configured', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()
    writeFileSync(join(scaleDir, 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: { default: { commands: {}, services: [] } },
      services: [],
    }, null, 2), 'utf-8')

    const preflight = await runScale([
      'preflight',
      '--service',
      'all',
      '--json',
    ], scaleDir, projectDir)

    expect(preflight.exitCode).toBe(0)
    const result = parseJson<{ passed: boolean; commandTargetsSkipped: boolean; targets: unknown[]; services: string[] }>(preflight.stdout)
    expect(result.passed).toBe(true)
    expect(result.commandTargetsSkipped).toBe(true)
    expect(result.targets).toEqual([])
    expect(result.services).toEqual([])
  }, 120_000)

  it('blocks preflight when the root git repository has unresolved merge conflicts', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()
    await execa('git', ['init'], { cwd: projectDir })
    await execa('git', ['config', 'user.email', 'scale-test@example.com'], { cwd: projectDir })
    await execa('git', ['config', 'user.name', 'SCALE Test'], { cwd: projectDir })
    writeFileSync(join(projectDir, 'conflict.txt'), 'base\n', 'utf-8')
    await execa('git', ['add', 'conflict.txt'], { cwd: projectDir })
    await execa('git', ['commit', '-m', 'base'], { cwd: projectDir })
    await execa('git', ['checkout', '-b', 'left'], { cwd: projectDir })
    writeFileSync(join(projectDir, 'conflict.txt'), 'left\n', 'utf-8')
    await execa('git', ['commit', '-am', 'left'], { cwd: projectDir })
    await execa('git', ['checkout', '-b', 'right', 'HEAD~1'], { cwd: projectDir })
    writeFileSync(join(projectDir, 'conflict.txt'), 'right\n', 'utf-8')
    await execa('git', ['commit', '-am', 'right'], { cwd: projectDir })
    await execa('git', ['merge', 'left'], { cwd: projectDir, reject: false })

    const preflight = await runScale([
      'preflight',
      '--dir',
      projectDir,
      '--json',
    ], scaleDir, projectDir)

    expect(preflight.exitCode).toBe(1)
    const result = parseJson<{
      passed: boolean
      workspaceSafety: { blocked: boolean; conflicts: string[] }
      engineeringStandards: { checked: boolean }
      targets: unknown[]
    }>(preflight.stdout)
    expect(result.passed).toBe(false)
    expect(result.workspaceSafety).toMatchObject({
      blocked: true,
      conflicts: ['conflict.txt'],
    })
    expect(result.engineeringStandards.checked).toBe(false)
    expect(result.targets).toEqual([])
  }, 120_000)

  it('uses a quick preflight profile by default without requiring coverage', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()

    const preflight = await runScale([
      'preflight',
      '--build-cmd',
      'node -v',
      '--lint-cmd',
      'node -v',
      '--test-cmd',
      'node -v',
      '--json',
    ], scaleDir, projectDir)

    expect(preflight.exitCode).toBe(0)
    const result = parseJson<{ passed: boolean; preflightProfile: string; gates: string[] }>(preflight.stdout)
    expect(result.passed).toBe(true)
    expect(result.preflightProfile).toBe('quick')
    expect(result.gates).toEqual(['G3', 'G0', 'G4', 'G5'])
  }, 120_000)

  it('blocks preflight when engineering standards gate is configured as block', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()
    mkdirSync(join(projectDir, 'src'), { recursive: true })
    writeFileSync(join(projectDir, 'src', 'leaky.ts'), `
export function leaky(token: string) {
  console.log('token', token)
}
`, 'utf-8')
    writeFileSync(join(scaleDir, 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: { default: { commands: {} } },
      policy: {
        engineeringStandardsGate: 'block',
      },
    }, null, 2), 'utf-8')

    const preflight = await runScale([
      'preflight',
      '--build-cmd',
      'node -v',
      '--lint-cmd',
      'node -v',
      '--test-cmd',
      'node -v',
      '--json',
    ], scaleDir, projectDir)

    expect(preflight.exitCode).toBe(1)
    const result = parseJson<{
      passed: boolean
      engineeringStandards: {
        mode: string
        checked: boolean
        blocked: boolean
        ok: boolean
        findings: Array<{ ruleId: string }>
      }
    }>(preflight.stdout)
    expect(result.passed).toBe(false)
    expect(result.engineeringStandards).toMatchObject({
      mode: 'block',
      checked: true,
      blocked: true,
      ok: false,
    })
    expect(result.engineeringStandards.findings.map(finding => finding.ruleId)).toContain('sensitive-log')
  }, 120_000)

  it('scopes preflight engineering standards to changed files inside a Git worktree', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()
    mkdirSync(join(projectDir, 'src'), { recursive: true })
    writeFileSync(join(projectDir, 'src', 'legacy.ts'), `
export function legacy(token: string) {
  console.log('token', token)
}
`, 'utf-8')
    writeFileSync(join(projectDir, 'src', 'safe.ts'), 'export const safe = 1\n', 'utf-8')
    writeFileSync(join(scaleDir, 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: { default: { commands: {} } },
      policy: {
        engineeringStandardsGate: 'block',
      },
    }, null, 2), 'utf-8')
    await execa('git', ['init'], { cwd: projectDir })
    await execa('git', ['config', 'user.email', 'scale-test@example.com'], { cwd: projectDir })
    await execa('git', ['config', 'user.name', 'SCALE Test'], { cwd: projectDir })
    await execa('git', ['add', 'src'], { cwd: projectDir })
    await execa('git', ['commit', '-m', 'legacy baseline'], { cwd: projectDir })
    writeFileSync(join(projectDir, 'src', 'safe.ts'), 'export const safe = 2\n', 'utf-8')

    const preflight = await runScale([
      'preflight',
      '--build-cmd',
      'node -v',
      '--lint-cmd',
      'node -v',
      '--test-cmd',
      'node -v',
      '--json',
    ], scaleDir, projectDir)

    expect(preflight.exitCode).toBe(0)
    const result = parseJson<{
      passed: boolean
      engineeringStandards: {
        blocked: boolean
        changedFiles?: string[]
        findings: Array<{ path: string; ruleId: string }>
        summary?: { filesScanned: number }
      }
    }>(preflight.stdout)
    expect(result.passed).toBe(true)
    expect(result.engineeringStandards.blocked).toBe(false)
    expect(result.engineeringStandards.changedFiles).toContain('src/safe.ts')
    expect(result.engineeringStandards.summary?.filesScanned).toBe(1)
    expect(result.engineeringStandards.findings.some(finding => finding.path === 'src/legacy.ts')).toBe(false)
  }, 120_000)

  it('blocks task verification when engineering standards gate is configured as block', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()
    mkdirSync(join(projectDir, 'src'), { recursive: true })
    writeFileSync(join(projectDir, 'src', 'leaky.ts'), `
export function leaky(token: string) {
  console.log('token', token)
}
`, 'utf-8')
    writeFileSync(join(scaleDir, 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: { default: { commands: {} } },
      policy: {
        engineeringStandardsGate: 'block',
      },
    }, null, 2), 'utf-8')

    const define = await runScale([
      'define',
      'CLI Regression Feature',
      '--description',
      'Implement a deterministic CLI regression workflow with input arguments and output evidence persisted by the CLI. Use TypeScript CLI commands with rollback constraints, quality lint typecheck, and acceptance verification evidence.',
      '--success-criteria',
      'verify evidence is persisted,review evidence is persisted,standards gate blocks sensitive logs',
      '--json',
    ], scaleDir, projectDir)
    expect(define.exitCode).toBe(0)
    const specId = parseJson<{ spec: { id: string } }>(define.stdout).spec.id

    const plan = await runScale(['plan', specId, '--rollback', 'Remove the debug log and rerun standards doctor', '--json'], scaleDir, projectDir)
    expect(plan.exitCode).toBe(0)
    const planId = parseJson<{ plan: { id: string } }>(plan.stdout).plan.id

    const build = await runScale(['build', planId, '--description', 'Standards gate task', '--level', 'M', '--json'], scaleDir, projectDir)
    expect(build.exitCode).toBe(0)
    const buildResult = parseJson<{ task: { id: string }; artifactDir?: string }>(build.stdout)
    if (buildResult.artifactDir) repoDirs.push(join(projectDir, buildResult.artifactDir))

    const coverageCommand = coverageFixtureCommand()
    const verify = await runScale([
      'verify',
      buildResult.task.id,
      '--build-cmd',
      'node -v',
      '--lint-cmd',
      'node -v',
      '--test-cmd',
      'node -v',
      '--coverage-cmd',
      coverageCommand,
      '--json',
    ], scaleDir, projectDir)

    expect(verify.exitCode).toBe(0)
    const verifyResult = parseJson<{
      passed: boolean
      engineeringStandards: {
        mode: string
        blocked: boolean
        ok: boolean
        findings: Array<{ ruleId: string }>
        standardsImpactPath?: string
      }
      metric: { finalGateStatus: string }
    }>(verify.stdout)
    expect(verifyResult.passed).toBe(false)
    expect(verifyResult.engineeringStandards).toMatchObject({
      mode: 'block',
      blocked: true,
      ok: false,
    })
    expect(verifyResult.engineeringStandards.findings.map(finding => finding.ruleId)).toContain('sensitive-log')
    expect(verifyResult.engineeringStandards.standardsImpactPath).toContain('standards-impact.md')
    expect(verifyResult.metric).toMatchObject({ finalGateStatus: 'blocked' })
  }, 120_000)

  it('blocks verify while required workflow open tasks remain', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()

    const define = await runScale([
      'define',
      'CLI Regression Feature',
      '--description',
      'Implement a deterministic CLI regression workflow with input arguments and output evidence persisted by the CLI. Use TypeScript CLI commands with rollback constraints, quality lint typecheck, and acceptance verification evidence.',
      '--success-criteria',
      'premature verify returns passed false,workflowOpenTasks blocked true,blockers list includes scale context grill',
      '--json',
    ], scaleDir, projectDir)
    expect(define.exitCode).toBe(0)
    const specId = parseJson<{ spec: { id: string } }>(define.stdout).spec.id

    const plan = await runScale(['plan', specId, '--rollback', 'Delete generated task artifacts', '--json'], scaleDir, projectDir)
    expect(plan.exitCode).toBe(0)
    const planId = parseJson<{ plan: { id: string } }>(plan.stdout).plan.id

    const build = await runScale(['build', planId, '--description', 'Workflow open task guard', '--level', 'M', '--json'], scaleDir, projectDir)
    expect(build.exitCode).toBe(0)
    const buildResult = parseJson<{ task: { id: string }; artifactDir?: string }>(build.stdout)
    if (buildResult.artifactDir) repoDirs.push(join(projectDir, buildResult.artifactDir))

    const coverageCommand = coverageFixtureCommand()
    const verify = await runScale([
      'verify',
      buildResult.task.id,
      '--build-cmd',
      'node -v',
      '--lint-cmd',
      'node -v',
      '--test-cmd',
      'node -v',
      '--coverage-cmd',
      coverageCommand,
      '--json',
    ], scaleDir, projectDir)

    expect(verify.exitCode).toBe(0)
    const verifyResult = parseJson<{
      passed: boolean
      workflowOpenTasks: { blocked: boolean; blockers: string[] }
      metric: { finalGateStatus: string }
    }>(verify.stdout)
    expect(verifyResult.passed).toBe(false)
    expect(verifyResult.workflowOpenTasks).toMatchObject({
      blocked: true,
    })
    expect(verifyResult.workflowOpenTasks.blockers.join('\n')).toContain('scale context grill')
    expect(verifyResult.metric.finalGateStatus).toBe('blocked')
  }, 120_000)

  it('reports advisory boundary/constraint coverage at verify without affecting passed', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()

    const define = await runScale([
      'define',
      'Boundary Enforcement Feature',
      '--description',
      'Implement a deterministic CLI regression workflow with input arguments and output evidence persisted by the CLI. Use TypeScript CLI commands with rollback constraints, quality lint typecheck, and acceptance verification evidence so executional boundaries are reported.',
      '--success-criteria',
      'verification evidence is persisted,boundary report is advisory',
      '--boundary-files',
      'src/allowed/**',
      '--boundary-forbidden',
      '**/secrets.ts',
      '--constraints',
      'login latency must not regress,no new npm dependencies',
      '--verification-surface',
      'benchmarks/latency.bench.ts',
      '--json',
    ], scaleDir, projectDir)
    expect(define.exitCode).toBe(0)
    const specId = parseJson<{ spec: { id: string } }>(define.stdout).spec.id

    const plan = await runScale(['plan', specId, '--rollback', 'Delete generated artifacts in temporary SCALE_DIR', '--json'], scaleDir, projectDir)
    expect(plan.exitCode).toBe(0)
    const planId = parseJson<{ plan: { id: string } }>(plan.stdout).plan.id

    const build = await runScale(['build', planId, '--description', 'Boundary advisory task', '--level', 'L', '--service', 'api,gateway', '--json'], scaleDir, projectDir)
    expect(build.exitCode).toBe(0)
    const buildResult = parseJson<{ task: { id: string }; artifactDir?: string }>(build.stdout)
    const taskId = buildResult.task.id
    if (buildResult.artifactDir) repoDirs.push(join(projectDir, buildResult.artifactDir))

    // Clear required workflow open tasks (context grill -> diagnose -> tdd) so
    // verify reaches the gates rather than being blocked upstream.
    const context = await runScale([
      'context', 'grill', '--task-id', taskId, '--task', 'Boundary advisory task',
      '--artifact-dir', buildResult.artifactDir!, '--write', '--json',
    ], scaleDir, projectDir)
    expect(context.exitCode).toBe(0)
    const diagnose = await runScale([
      'diagnose', 'plan', '--task-id', taskId, '--symptom', 'Boundary advisory task',
      '--repro', 'node -v', '--expected-failure', 'regression is reproducible', '--verify', 'node -v',
      '--artifact-dir', buildResult.artifactDir!, '--write', '--json',
    ], scaleDir, projectDir)
    expect(diagnose.exitCode).toBe(0)
    const tdd = await runScale([
      'tdd', 'slice', '--task-id', taskId, '--behavior', 'Boundary advisory task',
      '--public-interface', 'scale build', '--failing-test', 'node -v',
      '--test-file', 'tests/workflow/phaseCli.test.ts', '--impl-files', 'src/cli/phaseCommands.ts',
      '--red-exit-code', '1', '--red-summary', 'expected command guidance to advance',
      '--green-exit-code', '0', '--green-summary', 'command guidance advances',
      '--refactor-exit-code', '0', '--refactor-summary', 'command guidance stays green',
      '--artifact-dir', buildResult.artifactDir!, '--write', '--json',
    ], scaleDir, projectDir)
    expect(tdd.exitCode).toBe(0)

    const coverageCommand = coverageFixtureCommand()
    mkdirSync(join(projectDir, 'test-fixtures', 'phase-cli', 'api'), { recursive: true })
    mkdirSync(join(projectDir, 'test-fixtures', 'phase-cli', 'gateway'), { recursive: true })
    writeFileSync(join(scaleDir, 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: { default: { commands: {} } },
      services: [
        { name: 'api', path: 'test-fixtures/phase-cli/api', required: true },
        { name: 'gateway', path: 'test-fixtures/phase-cli/gateway', required: true },
      ],
    }, null, 2), 'utf-8')

    const verify = await runScale([
      'verify',
      taskId,
      '--build-cmd', 'node -v',
      '--lint-cmd', 'node -v',
      '--test-cmd', 'node -v',
      '--coverage-cmd', coverageCommand,
      '--json',
    ], scaleDir, projectDir)

    expect(verify.exitCode).toBe(0)
    const verifyResult = parseJson<{
      passed: boolean
      boundaryEnforcement?: {
        declaredAllowed: number
        declaredForbidden: number
        violations: unknown[]
        advisory: boolean
      }
      constraintCoverage?: {
        declared: number
        covered: number
        uncovered: string[]
        advisory: boolean
      }
    }>(verify.stdout)

    // An uncovered constraint is present, yet verify still passes: advisory
    // checks never flip `passed`.
    expect(verifyResult.passed).toBe(true)

    // Boundaries from the Spec are resolved and enforced at verify (advisory).
    expect(verifyResult.boundaryEnforcement).toMatchObject({
      declaredAllowed: 1,
      declaredForbidden: 1,
      advisory: true,
    })

    // Constraint coverage: "latency" is guarded by the surface item; the
    // dependency constraint has no guarding surface and is flagged.
    expect(verifyResult.constraintCoverage).toMatchObject({
      declared: 2,
      covered: 1,
      uncovered: ['no new npm dependencies'],
      advisory: true,
    })
  }, 120_000)

  it('hard-blocks verify on boundary/constraint violations under an enforced profile (E1)', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()

    const define = await runScale([
      'define',
      'Boundary Enforcement Feature',
      '--description',
      'Implement a deterministic CLI regression workflow with input arguments and output evidence persisted by the CLI. Use TypeScript CLI commands with rollback constraints, quality lint typecheck, and acceptance verification evidence so executional boundaries are enforced.',
      '--success-criteria',
      'verification evidence is persisted,boundary report is enforced',
      '--boundary-files',
      'src/allowed/**',
      '--boundary-forbidden',
      '**/secrets.ts',
      '--constraints',
      'login latency must not regress,no new npm dependencies',
      '--verification-surface',
      'benchmarks/latency.bench.ts',
      '--json',
    ], scaleDir, projectDir)
    expect(define.exitCode).toBe(0)
    const specId = parseJson<{ spec: { id: string } }>(define.stdout).spec.id

    const plan = await runScale(['plan', specId, '--rollback', 'Delete generated artifacts in temporary SCALE_DIR', '--json'], scaleDir, projectDir)
    expect(plan.exitCode).toBe(0)
    const planId = parseJson<{ plan: { id: string } }>(plan.stdout).plan.id

    const build = await runScale(['build', planId, '--description', 'Boundary enforced task', '--level', 'L', '--service', 'api,gateway', '--json'], scaleDir, projectDir)
    expect(build.exitCode).toBe(0)
    const buildResult = parseJson<{ task: { id: string }; artifactDir?: string }>(build.stdout)
    const taskId = buildResult.task.id
    if (buildResult.artifactDir) repoDirs.push(join(projectDir, buildResult.artifactDir))

    const context = await runScale([
      'context', 'grill', '--task-id', taskId, '--task', 'Boundary enforced task',
      '--artifact-dir', buildResult.artifactDir!, '--write', '--json',
    ], scaleDir, projectDir)
    expect(context.exitCode).toBe(0)
    const diagnose = await runScale([
      'diagnose', 'plan', '--task-id', taskId, '--symptom', 'Boundary enforced task',
      '--repro', 'node -v', '--expected-failure', 'regression is reproducible', '--verify', 'node -v',
      '--artifact-dir', buildResult.artifactDir!, '--write', '--json',
    ], scaleDir, projectDir)
    expect(diagnose.exitCode).toBe(0)
    const tdd = await runScale([
      'tdd', 'slice', '--task-id', taskId, '--behavior', 'Boundary enforced task',
      '--public-interface', 'scale build', '--failing-test', 'node -v',
      '--test-file', 'tests/workflow/phaseCli.test.ts', '--impl-files', 'src/cli/phaseCommands.ts',
      '--red-exit-code', '1', '--red-summary', 'expected command guidance to advance',
      '--green-exit-code', '0', '--green-summary', 'command guidance advances',
      '--refactor-exit-code', '0', '--refactor-summary', 'command guidance stays green',
      '--artifact-dir', buildResult.artifactDir!, '--write', '--json',
    ], scaleDir, projectDir)
    expect(tdd.exitCode).toBe(0)

    const coverageCommand = coverageFixtureCommand()
    mkdirSync(join(projectDir, 'test-fixtures', 'phase-cli', 'api'), { recursive: true })
    mkdirSync(join(projectDir, 'test-fixtures', 'phase-cli', 'gateway'), { recursive: true })
    // `ci` is an enforced profile (decision E1); the empty command set falls back
    // to the explicit CLI overrides below, so only the gating behaviour differs.
    writeFileSync(join(scaleDir, 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: { default: { commands: {} }, ci: { commands: {} } },
      services: [
        { name: 'api', path: 'test-fixtures/phase-cli/api', required: true },
        { name: 'gateway', path: 'test-fixtures/phase-cli/gateway', required: true },
      ],
    }, null, 2), 'utf-8')

    const verify = await runScale([
      'verify',
      taskId,
      '--profile', 'ci',
      '--build-cmd', 'node -v',
      '--lint-cmd', 'node -v',
      '--test-cmd', 'node -v',
      '--coverage-cmd', coverageCommand,
      '--json',
    ], scaleDir, projectDir)

    expect(verify.exitCode).toBe(0)
    const verifyResult = parseJson<{
      passed: boolean
      profile: string
      metric: { finalGateStatus: string }
      boundaryEnforcement?: { violations: Array<{ kind: string }>; advisory: boolean }
      constraintCoverage?: { uncovered: string[]; advisory: boolean }
    }>(verify.stdout)

    // This is the exact Spec/ceremony as the advisory case above (which passes
    // with passed=true under `default`); the only change is the enforced `ci`
    // profile. So a flip to passed=false isolates boundary enforcement as the
    // cause: the unguarded "no new npm dependencies" constraint now hard-blocks.
    expect(verifyResult.profile).toBe('ci')
    expect(verifyResult.passed).toBe(false)
    expect(verifyResult.metric.finalGateStatus).toBe('blocked')

    // Both reports are flipped from advisory to blocking under the enforced profile.
    expect(verifyResult.boundaryEnforcement?.advisory).toBe(false)
    expect(verifyResult.constraintCoverage?.advisory).toBe(false)
    expect(verifyResult.constraintCoverage?.uncovered).toContain('no new npm dependencies')
  }, 120_000)

  it('blocks ship before review, then allows review -> ship --no-commit without changing HEAD', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()

    const define = await runScale([
      'define',
      'CLI Regression Feature',
      '--description',
      'Implement a deterministic CLI regression workflow with input arguments and output evidence persisted by the CLI. Use TypeScript CLI commands with rollback constraints, quality lint typecheck, and acceptance verification evidence.',
      '--success-criteria',
      'verify evidence is persisted,review evidence is persisted,ship skip commit does not commit',
      '--json',
    ], scaleDir, projectDir)
    expect(define.exitCode).toBe(0)
    const specId = parseJson<{ spec: { id: string } }>(define.stdout).spec.id

    const plan = await runScale(['plan', specId, '--rollback', 'Delete generated artifacts in temporary SCALE_DIR', '--json'], scaleDir, projectDir)
    expect(plan.exitCode).toBe(0)
    const planId = parseJson<{ plan: { id: string } }>(plan.stdout).plan.id

    const build = await runScale(['build', planId, '--description', 'CLI regression task', '--level', 'L', '--service', 'api,gateway', '--json'], scaleDir, projectDir)
    expect(build.exitCode).toBe(0)
    const buildResult = parseJson<{
      task: { id: string }
      artifactDir?: string
      workflowGuidance: { items: Array<{ id: string; command: string; required: boolean }> }
    }>(build.stdout)
    const taskId = buildResult.task.id
    expect(buildResult.artifactDir).toContain('.planning/tasks/')
    expect(buildResult.workflowGuidance.items.map(item => item.id)).toEqual([
      'context-grill',
      'diagnostic-loop',
      'tdd-slice',
      'verification',
    ])
    expect(buildResult.workflowGuidance.items[0].command).toContain('--write')
    expect(JSON.parse(readFileSync(join(scaleDir, 'state', 'current.json'), 'utf-8'))).toMatchObject({
      taskId,
      openTasks: buildResult.workflowGuidance.items.filter(item => item.required).map(item => item.command),
    })
    const status = await runScale(['status', '--json'], scaleDir, projectDir)
    expect(status.exitCode).toBe(0)
    const statusResult = parseJson<{
      nextCommand: string
      workflowState: { taskId: string; openTasks: string[] }
    }>(status.stdout)
    expect(statusResult.nextCommand).toContain('scale context grill')
    expect(statusResult.workflowState).toMatchObject({
      taskId,
      openTasks: buildResult.workflowGuidance.items.filter(item => item.required).map(item => item.command),
    })
    const context = await runScale([
      'context',
      'grill',
      '--task-id',
      taskId,
      '--task',
      'CLI regression task',
      '--artifact-dir',
      buildResult.artifactDir!,
      '--write',
      '--json',
    ], scaleDir, projectDir)
    expect(context.exitCode).toBe(0)
    expect(parseJson<{ artifactPath?: string }>(context.stdout).artifactPath).toContain(projectDir)
    const afterContextStatus = await runScale(['status', '--json'], scaleDir, projectDir)
    expect(afterContextStatus.exitCode).toBe(0)
    expect(parseJson<{ nextCommand: string }>(afterContextStatus.stdout).nextCommand).toContain('scale diagnose plan')

    const incompleteDiagnose = await runScale([
      'diagnose',
      'plan',
      '--task-id',
      taskId,
      '--symptom',
      'CLI regression task',
      '--artifact-dir',
      buildResult.artifactDir!,
      '--write',
      '--json',
    ], scaleDir, projectDir)
    expect(incompleteDiagnose.exitCode).toBe(0)
    const afterIncompleteDiagnoseStatus = await runScale(['status', '--json'], scaleDir, projectDir)
    expect(afterIncompleteDiagnoseStatus.exitCode).toBe(0)
    const incompleteStatus = parseJson<{ nextCommand: string; workflowState: { openTasks: string[] } }>(afterIncompleteDiagnoseStatus.stdout)
    expect(incompleteStatus.nextCommand).toContain('scale diagnose plan')
    expect(incompleteStatus.workflowState.openTasks.join('\n')).toContain('reproduction command')

    const diagnose = await runScale([
      'diagnose',
      'plan',
      '--task-id',
      taskId,
      '--symptom',
      'CLI regression task',
      '--repro',
      'node -v',
      '--expected-failure',
      'regression is reproducible',
      '--verify',
      'node -v',
      '--artifact-dir',
      buildResult.artifactDir!,
      '--write',
      '--json',
    ], scaleDir, projectDir)
    expect(diagnose.exitCode).toBe(0)
    const afterDiagnoseStatus = await runScale(['status', '--json'], scaleDir, projectDir)
    expect(afterDiagnoseStatus.exitCode).toBe(0)
    expect(parseJson<{ nextCommand: string }>(afterDiagnoseStatus.stdout).nextCommand).toContain('scale tdd slice')

    const tdd = await runScale([
      'tdd',
      'slice',
      '--task-id',
      taskId,
      '--behavior',
      'CLI regression task',
      '--public-interface',
      'scale build',
      '--failing-test',
      'node -v',
      '--test-file',
      'tests/workflow/phaseCli.test.ts',
      '--impl-files',
      'src/cli/phaseCommands.ts',
      '--red-exit-code',
      '1',
      '--red-summary',
      'expected command guidance to advance',
      '--green-exit-code',
      '0',
      '--green-summary',
      'command guidance advances',
      '--refactor-exit-code',
      '0',
      '--refactor-summary',
      'command guidance stays green',
      '--artifact-dir',
      buildResult.artifactDir!,
      '--write',
      '--json',
    ], scaleDir, projectDir)
    expect(tdd.exitCode).toBe(0)
    const afterTddStatus = await runScale(['status', '--json'], scaleDir, projectDir)
    expect(afterTddStatus.exitCode).toBe(0)
    expect(parseJson<{ nextCommand: string }>(afterTddStatus.stdout).nextCommand).toBe(`scale verify ${taskId}`)
    if (buildResult.artifactDir) repoDirs.push(join(projectDir, buildResult.artifactDir))
    const artifactCheck = await runScale(['task-artifacts', 'check', '--dir', buildResult.artifactDir!, '--level', 'L', '--json'], scaleDir, projectDir)
    expect(artifactCheck.exitCode).toBe(1)
    expect(parseJson<{ complete: boolean; incomplete: Array<{ file: string }> }>(artifactCheck.stdout)).toMatchObject({
      complete: false,
    })

    const coverageCommand = coverageFixtureCommand()
    mkdirSync(join(projectDir, 'test-fixtures', 'phase-cli', 'api'), { recursive: true })
    mkdirSync(join(projectDir, 'test-fixtures', 'phase-cli', 'gateway'), { recursive: true })
    writeFileSync(join(scaleDir, 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: { default: { commands: {} } },
      services: [
        { name: 'api', path: 'test-fixtures/phase-cli/api', required: true },
        { name: 'gateway', path: 'test-fixtures/phase-cli/gateway', required: true },
      ],
    }, null, 2), 'utf-8')
    const verify = await runScale([
      'verify',
      taskId,
      '--build-cmd',
      'node -v',
      '--lint-cmd',
      'node -v',
      '--test-cmd',
      'node -v',
      '--coverage-cmd',
      coverageCommand,
      '--json',
    ], scaleDir, projectDir)
    expect(verify.exitCode).toBe(0)
    const verifyResult = parseJson<{ passed: boolean; services: string[]; verificationArtifactPath: string; artifactCheck: { complete: boolean; incomplete: Array<{ file: string }> }; metric: { taskId: string; level: string; services: string[]; firstVerificationPass: boolean; artifactComplete: boolean; finalGateStatus: string } }>(verify.stdout)
    expect(verifyResult.passed).toBe(true)
    expect(verifyResult.services).toEqual(['api', 'gateway'])
    expect(verifyResult.verificationArtifactPath).toContain('verification.md')
    expect(verifyResult.metric).toMatchObject({
      taskId,
      level: 'L',
      services: ['api', 'gateway'],
      firstVerificationPass: true,
      artifactComplete: false,
      finalGateStatus: 'passed',
    })
    expect(verifyResult.artifactCheck.complete).toBe(false)
    expect(verifyResult.artifactCheck.incomplete.map(item => item.file)).toContain('mini-prd.md')
    const afterVerifyStatus = await runScale(['status', '--json'], scaleDir, projectDir)
    expect(afterVerifyStatus.exitCode).toBe(0)
    expect(parseJson<{ nextCommand: string }>(afterVerifyStatus.stdout).nextCommand).toBe(`scale review ${taskId}`)

    const metrics = await runScale(['metrics', 'list', '--json'], scaleDir, projectDir)
    expect(metrics.exitCode).toBe(0)
    const metricsResult = parseJson<{ summary: { total: number; firstPassRate: number }; records: Array<{ taskId: string; level: string }> }>(metrics.stdout)
    expect(metricsResult.summary.total).toBe(1)
    expect(metricsResult.summary.firstPassRate).toBe(1)
    expect(metricsResult.records[0]).toMatchObject({ taskId, level: 'L' })

    const blockedShip = await runScale(['ship', taskId, '--no-commit', '--json'], scaleDir, projectDir)
    expect(blockedShip.exitCode).not.toBe(0)
    expect(blockedShip.stderr).toContain('Task not reviewed with persisted passing evidence')

    const review = await runScale(['review', taskId, '--json'], scaleDir, projectDir)
    expect(review.exitCode).toBe(0)
    const reviewResult = parseJson<{
      passed: boolean
      reviewId: string
      judge: { decision: string; modelUsed: string; promptVersion: string; advisory: boolean }
      reviewMode: string
      freshVerify?: { decision: string }
      karpathy: {
        passed: boolean
        context: { hypothesesListed: boolean; hasExtraFeatures: boolean; changesTraceable: boolean; hasVerifiableGoal: boolean }
        checks: Array<{ principle: string; passed: boolean }>
      }
    }>(review.stdout)
    expect(reviewResult.passed).toBe(true)
    expect(reviewResult.reviewId).toMatch(/^REVIEW-/)
    // P1.4: advisory LLM-as-Judge runs by default (heuristic offline) and is
    // recorded without affecting `passed`.
    expect(reviewResult.judge.modelUsed).toBe('heuristic')
    expect(reviewResult.judge.advisory).toBe(true)
    expect(reviewResult.judge.promptVersion).toBe('spec-conformance.v1')
    expect(['pass', 'fail', 'uncertain']).toContain(reviewResult.judge.decision)
    // P2.2: default mode is ai-self and does NOT run the fresh-context verifier.
    expect(reviewResult.reviewMode).toBe('ai-self')
    expect(reviewResult.freshVerify).toBeUndefined()

    // P2.2: --mode=fresh-subagent runs the advisory fresh-context verifier
    // (heuristic offline) without changing `passed`.
    const freshReview = await runScale(['review', taskId, '--mode', 'fresh-subagent', '--json'], scaleDir, projectDir)
    expect(freshReview.exitCode).toBe(0)
    const freshResult = parseJson<{ passed: boolean; reviewMode: string; freshVerify: { decision: string; modelUsed: string; advisory: boolean } }>(freshReview.stdout)
    expect(freshResult.passed).toBe(true)
    expect(freshResult.reviewMode).toBe('fresh-subagent')
    expect(freshResult.freshVerify.modelUsed).toBe('heuristic')
    expect(freshResult.freshVerify.advisory).toBe(true)
    expect(['verified', 'unverified', 'uncertain']).toContain(freshResult.freshVerify.decision)

    expect(reviewResult.karpathy.passed).toBe(true)
    expect(reviewResult.karpathy.context).toMatchObject({
      hypothesesListed: true,
      hasExtraFeatures: false,
      changesTraceable: true,
      hasVerifiableGoal: true,
    })
    expect(reviewResult.karpathy.checks).toHaveLength(4)

    const headBefore = await execa('git', ['rev-parse', 'HEAD'])
    const ship = await runScale(['ship', taskId, '--no-commit', '--json'], scaleDir, projectDir)
    const headAfter = await execa('git', ['rev-parse', 'HEAD'])

    expect(ship.exitCode).toBe(0)
    const shipResult = parseJson<{ commitHash: string | null; reviewValidation: { ok: boolean }; evidenceValidation: { ok: boolean } }>(ship.stdout)
    expect(shipResult.commitHash).toBeNull()
    expect(shipResult.reviewValidation.ok).toBe(true)
    expect(shipResult.evidenceValidation.ok).toBe(true)
    expect(headAfter.stdout).toBe(headBefore.stdout)
  }, 120_000)

  it('derives Karpathy review context from task scope instead of hardcoded pass values', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()
    await execa('git', ['init'], { cwd: projectDir })
    mkdirSync(join(projectDir, 'src'), { recursive: true })
    writeFileSync(join(projectDir, 'src', 'loose-change.ts'), 'export const loose = true\n', 'utf-8')

    const review = await runScale(['review', '--json'], scaleDir, projectDir)
    expect(review.exitCode).toBe(0)
    const reviewResult = parseJson<{
      passed: boolean
      changedFiles: string[]
      karpathy: {
        passed: boolean
        context: { hypothesesListed: boolean; hasExtraFeatures: boolean; changesTraceable: boolean; hasVerifiableGoal: boolean }
        violations: string[]
      }
    }>(review.stdout)

    expect(reviewResult.passed).toBe(true)
    expect(reviewResult.changedFiles).toContain('src/loose-change.ts')
    expect(reviewResult.karpathy.passed).toBe(false)
    expect(reviewResult.karpathy.context).toMatchObject({
      hypothesesListed: false,
      hasExtraFeatures: false,
      changesTraceable: false,
      hasVerifiableGoal: false,
    })
    expect(reviewResult.karpathy.violations).toEqual(expect.arrayContaining([
      expect.stringContaining('K1'),
      expect.stringContaining('K3'),
      expect.stringContaining('K4'),
    ]))
  }, 120_000)

  it('uses changed files during verify to refresh skill routing evidence requirements', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()
    await execa('git', ['init'], { cwd: projectDir })
    mkdirSync(join(projectDir, 'src', 'components'), { recursive: true })
    writeFileSync(join(projectDir, 'src', 'components', 'Panel.tsx'), 'export const Panel = () => null\n', 'utf-8')

    const define = await runScale([
      'define',
      'Changed File Skill Feature',
      '--description',
      'Implement a deterministic TypeScript CLI workflow today that accepts task input arguments, persists verification evidence output, keeps rollback constraints explicit, and proves that skill routing can inspect changed files during verification.',
      '--success-criteria',
      'verification evidence is persisted,skill routing checks changed files',
      '--json',
    ], scaleDir, projectDir)
    expect(define.exitCode).toBe(0)
    const specId = parseJson<{ spec: { id: string } }>(define.stdout).spec.id

    const plan = await runScale(['plan', specId, '--rollback', 'Delete temporary files', '--json'], scaleDir, projectDir)
    expect(plan.exitCode).toBe(0)
    const planId = parseJson<{ plan: { id: string } }>(plan.stdout).plan.id

    const build = await runScale(['build', planId, '--description', 'Neutral implementation task', '--level', 'M', '--json'], scaleDir, projectDir)
    expect(build.exitCode).toBe(0)
    const buildResult = parseJson<{ task: { id: string }; artifactDir?: string }>(build.stdout)
    if (buildResult.artifactDir) repoDirs.push(join(projectDir, buildResult.artifactDir))

    const coverageCommand = coverageFixtureCommand()
    const verify = await runScale([
      'verify',
      buildResult.task.id,
      '--build-cmd',
      'node -v',
      '--lint-cmd',
      'node -v',
      '--test-cmd',
      'node -v',
      '--coverage-cmd',
      coverageCommand,
      '--json',
    ], scaleDir, projectDir)

    expect(verify.exitCode).toBe(0)
    const verifyResult = parseJson<{ skillGate: { complete: boolean; missing: string[] } }>(verify.stdout)
    expect(verifyResult.skillGate.complete).toBe(false)
    expect(verifyResult.skillGate.missing).toEqual(expect.arrayContaining(['ui-spec.md', 'visual-review.md']))
  }, 120_000)

  it('can block verify and ship when required tool execution evidence is missing', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()
    await execa('git', ['init'], { cwd: projectDir })
    mkdirSync(join(projectDir, '.agents', 'skills', 'awesome-design-md'), { recursive: true })
    mkdirSync(join(projectDir, '.agents', 'skills', 'ui-ux-pro-max'), { recursive: true })
    writeFileSync(join(projectDir, '.agents', 'skills', 'awesome-design-md', 'SKILL.md'), '---\nname: awesome-design-md\n---\n', 'utf-8')
    writeFileSync(join(projectDir, '.agents', 'skills', 'ui-ux-pro-max', 'SKILL.md'), '---\nname: ui-ux-pro-max\n---\n', 'utf-8')
    mkdirSync(join(projectDir, 'src', 'components'), { recursive: true })
    writeFileSync(join(projectDir, 'src', 'components', 'Upload.tsx'), 'export const Upload = () => null\n', 'utf-8')

    const define = await runScale([
      'define',
      'Tool Evidence Feature',
      '--description',
      'Implement a deterministic TypeScript UI workflow that accepts task input arguments, persists verification evidence output, keeps rollback constraints explicit, and requires tool evidence for frontend design work.',
      '--success-criteria',
      'verification evidence is persisted,tool evidence blocks missing design tool use',
      '--goal',
      'Require tool execution evidence before completing M level UI work.',
      '--constraint',
      'The task must not complete when required UI design tools have no passed evidence.',
      '--acceptance',
      'Verify reports toolEvidenceGate.blocked=true and ship exits non-zero with a tool evidence gate message.',
      '--context',
      'The regression fixture has a changed React component and local placeholder skill files.',
      '--risk',
      'Agents may claim UI work is verified without using the configured design skills.',
      '--priority',
      'Block premature completion before release handoff.',
      '--json',
    ], scaleDir, projectDir)
    expect(define.exitCode).toBe(0)
    const specId = parseJson<{ spec: { id: string } }>(define.stdout).spec.id

    const plan = await runScale(['plan', specId, '--rollback', 'Remove UI change and rerun verification', '--json'], scaleDir, projectDir)
    expect(plan.exitCode).toBe(0)
    const planId = parseJson<{ plan: { id: string } }>(plan.stdout).plan.id

    const build = await runScale(['build', planId, '--description', 'Tool evidence UI task', '--level', 'M', '--json'], scaleDir, projectDir)
    expect(build.exitCode).toBe(0)
    const taskId = parseJson<{ task: { id: string }; artifactDir?: string }>(build.stdout).task.id

    const coverageCommand = coverageFixtureCommand()
    const verify = await runScale([
      'verify',
      taskId,
      '--build-cmd',
      'node -v',
      '--lint-cmd',
      'node -v',
      '--test-cmd',
      'node -v',
      '--coverage-cmd',
      coverageCommand,
      '--tool-gate',
      'evidence-required',
      '--json',
    ], scaleDir, projectDir)

    expect(verify.exitCode).toBe(0)
    const verifyResult = parseJson<{
      passed: boolean
      toolEvidenceGate: {
        mode: string
        checked: boolean
        complete: boolean
        blocked: boolean
        missing: Array<{ toolId: string }>
      }
      metric: { finalGateStatus: string }
    }>(verify.stdout)
    expect(verifyResult.passed).toBe(false)
    expect(verifyResult.toolEvidenceGate).toMatchObject({
      mode: 'evidence-required',
      checked: true,
      complete: false,
      blocked: true,
    })
    expect(verifyResult.toolEvidenceGate.missing.map(item => item.toolId)).toEqual(expect.arrayContaining(['awesome-design-md', 'ui-ux-pro-max']))
    expect(verifyResult.metric.finalGateStatus).toBe('blocked')

    const ship = await runScale(['ship', taskId, '--no-commit', '--json'], scaleDir, projectDir)
    expect(ship.exitCode).not.toBe(0)
    expect(ship.stderr).toContain('Task tool evidence gate did not pass')
  }, 120_000)

  it('can hard-block verification and ship when required M/L artifacts are placeholders', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()

    const define = await runScale([
      'define',
      'Artifact Gate Feature',
      '--description',
      'Implement a deterministic TypeScript CLI artifact gate workflow that accepts task input arguments, persists output verification evidence, checks required medium and large task documents for substantive content, enforces rollback risk constraints, keeps lint and typecheck quality standards, verifies acceptance evidence today, blocks task completion when configured to require artifacts, and prevents ship from bypassing an incomplete artifact gate.',
      '--success-criteria',
      'artifact gate blocks incomplete documents,ship cannot bypass artifact gate,verification evidence is still persisted',
      '--json',
    ], scaleDir, projectDir)
    expect(define.exitCode).toBe(0)
    const specId = parseJson<{ spec: { id: string } }>(define.stdout).spec.id

    const plan = await runScale(['plan', specId, '--rollback', 'Delete generated temporary artifacts', '--json'], scaleDir, projectDir)
    expect(plan.exitCode).toBe(0)
    const planId = parseJson<{ plan: { id: string } }>(plan.stdout).plan.id

    const build = await runScale(['build', planId, '--description', 'Artifact gate task', '--level', 'L', '--json'], scaleDir, projectDir)
    expect(build.exitCode).toBe(0)
    const buildResult = parseJson<{ task: { id: string }; artifactDir?: string }>(build.stdout)
    if (buildResult.artifactDir) repoDirs.push(join(projectDir, buildResult.artifactDir))

    const coverageCommand = coverageFixtureCommand()
    const verify = await runScale([
      'verify',
      buildResult.task.id,
      '--build-cmd',
      'node -v',
      '--lint-cmd',
      'node -v',
      '--test-cmd',
      'node -v',
      '--coverage-cmd',
      coverageCommand,
      '--artifact-gate',
      'block',
      '--json',
    ], scaleDir, projectDir)

    expect(verify.exitCode).toBe(0)
    const verifyResult = parseJson<{
      passed: boolean
      artifactGate: { mode: string; applies: boolean; checked: boolean; complete: boolean; blocked: boolean }
      metric: { finalGateStatus: string; artifactComplete: boolean }
    }>(verify.stdout)
    expect(verifyResult.passed).toBe(false)
    expect(verifyResult.artifactGate).toMatchObject({
      mode: 'block',
      applies: true,
      checked: true,
      complete: false,
      blocked: true,
    })
    expect(verifyResult.metric).toMatchObject({
      finalGateStatus: 'blocked',
      artifactComplete: false,
    })

    const ship = await runScale(['ship', buildResult.task.id, '--no-commit', '--json'], scaleDir, projectDir)
    expect(ship.exitCode).not.toBe(0)
    expect(ship.stderr).toContain('Task artifact gate did not pass')
  }, 120_000)

  it('blocks committing unreviewed files instead of staging the whole workspace', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()
    await execa('git', ['init'], { cwd: projectDir })
    writeFileSync(join(projectDir, 'README.md'), 'fixture\n', 'utf-8')
    await execa('git', ['add', 'README.md'], { cwd: projectDir })
    await execa('git', ['-c', 'user.email=scale-test@example.com', '-c', 'user.name=Scale Test', 'commit', '-m', 'test fixture'], { cwd: projectDir })
    await execa('git', ['checkout', '-b', 'feat/scoped-ship-regression'], { cwd: projectDir })
    const define = await runScale([
      'define',
      'Scoped Ship Feature',
      '--description',
      'Implement a TypeScript CLI workflow that accepts task input arguments, persists review evidence output, enforces rollback constraints, includes lint and typecheck quality standards, and verifies with test acceptance evidence so unreviewed files are never included in a release commit today.',
      '--success-criteria',
      'verification evidence is persisted,review evidence is persisted,unreviewed files block ship',
      '--goal',
      'Prevent release commits from including files that were not covered by persisted review evidence.',
      '--constraint',
      'Only files present in passing review records may be staged by ship; unrelated working tree changes must remain untouched.',
      '--acceptance',
      'Ship exits non-zero when a new unreviewed file exists after review and HEAD remains unchanged.',
      '--context',
      'The CLI stores verification evidence and review evidence in a temporary SCALE_DIR during this regression test.',
      '--risk',
      'A broad git add could commit unrelated files from the shared repository workspace.',
      '--priority',
      'Protect commit scope before creating a release commit.',
      '--json',
    ], scaleDir, projectDir)
    expect(define.exitCode).toBe(0)
    const specId = parseJson<{ spec: { id: string } }>(define.stdout).spec.id

    const plan = await runScale(['plan', specId, '--rollback', 'Delete temporary test artifacts', '--json'], scaleDir, projectDir)
    expect(plan.exitCode).toBe(0)
    const planId = parseJson<{ plan: { id: string } }>(plan.stdout).plan.id

    const build = await runScale(['build', planId, '--description', 'Scoped ship task', '--level', 'S', '--json'], scaleDir, projectDir)
    expect(build.exitCode).toBe(0)
    const buildResult = parseJson<{ task: { id: string }; artifactDir?: string }>(build.stdout)
    const taskId = buildResult.task.id
    if (buildResult.artifactDir) repoDirs.push(join(projectDir, buildResult.artifactDir))

    const coverageCommand = coverageFixtureCommand()
    const verify = await runScale([
      'verify',
      taskId,
      '--build-cmd',
      'node -v',
      '--lint-cmd',
      'node -v',
      '--test-cmd',
      'node -v',
      '--coverage-cmd',
      coverageCommand,
      '--json',
    ], scaleDir, projectDir)
    expect(verify.exitCode).toBe(0)
    expect(parseJson<{ passed: boolean }>(verify.stdout).passed).toBe(true)

    // Use a directory that is NOT in .gitignore so git ls-files can detect it
    // tmp/ is ignored by .gitignore, so use test-fixtures/ instead
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const reviewedRel = join('test-fixtures', 'phase-cli', `reviewed-${suffix}.txt`)
    const unreviewedRel = join('test-fixtures', 'phase-cli', `unreviewed-${suffix}.txt`)
    const reviewedPath = join(projectDir, reviewedRel)
    const unreviewedPath = join(projectDir, unreviewedRel)
    // Ensure directory exists
    mkdirSync(join(projectDir, 'test-fixtures', 'phase-cli'), { recursive: true })
    repoFiles.push(reviewedPath, unreviewedPath)
    writeFileSync(reviewedPath, 'reviewed\n', 'utf-8')
    const review = await runScale(['review', taskId, '--json'], scaleDir, projectDir)
    expect(review.exitCode).toBe(0)
    expect(parseJson<{ passed: boolean }>(review.stdout).passed).toBe(true)

    writeFileSync(unreviewedPath, 'unreviewed\n', 'utf-8')
    const headBefore = await execa('git', ['rev-parse', 'HEAD'], { cwd: projectDir })
    const ship = await runScale(['ship', taskId, '--message', 'test: scoped ship regression', '--json'], scaleDir, projectDir)
    const headAfter = await execa('git', ['rev-parse', 'HEAD'], { cwd: projectDir })

    expect(ship.exitCode).not.toBe(0)
    expect(ship.stderr).toContain('Unreviewed working tree changes detected')
    expect(ship.stderr).toContain(unreviewedRel.replace(/\\/g, '/'))
    expect(headAfter.stdout).toBe(headBefore.stdout)
  }, 120_000)

  it('blocks governed commits directly on the integration branch', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()
    await execa('git', ['init'], { cwd: projectDir })
    writeFileSync(join(projectDir, 'README.md'), 'fixture\n', 'utf-8')
    await execa('git', ['add', 'README.md'], { cwd: projectDir })
    await execa('git', ['-c', 'user.email=scale-test@example.com', '-c', 'user.name=Scale Test', 'commit', '-m', 'test fixture'], { cwd: projectDir })
    await execa('git', ['checkout', '-b', 'dev'], { cwd: projectDir })

    const define = await runScale([
      'define',
      'Integration Branch Ship Boundary',
      '--description',
      'Implement a TypeScript CLI workflow that accepts task input arguments, persists review evidence output, enforces rollback constraints, includes lint and typecheck quality standards, and verifies with test acceptance evidence so direct commits on the integration branch cannot bypass merge request review today.',
      '--success-criteria',
      'verification evidence is persisted,review evidence is persisted,direct dev branch ship is blocked',
      '--goal',
      'Prevent governed ship from creating direct commits on the integration branch.',
      '--constraint',
      'GitLab Flow requires short feature, fix, chore, release, or hotfix branches for governed commits.',
      '--acceptance',
      'Ship exits non-zero on dev before staging reviewed files and HEAD remains unchanged.',
      '--context',
      'The regression fixture has a clean repository on the dev branch and one reviewed root documentation change.',
      '--risk',
      'Without this check dev can become a direct-commit dumping ground and release selection becomes unreliable.',
      '--priority',
      'Protect branch lifecycle before creating release-bound commits.',
      '--json',
    ], scaleDir, projectDir)
    expect(define.exitCode).toBe(0)
    const specId = parseJson<{ spec: { id: string } }>(define.stdout).spec.id

    const plan = await runScale(['plan', specId, '--rollback', 'Delete temporary test artifacts', '--json'], scaleDir, projectDir)
    expect(plan.exitCode).toBe(0)
    const planId = parseJson<{ plan: { id: string } }>(plan.stdout).plan.id

    const build = await runScale(['build', planId, '--description', 'Integration branch ship boundary', '--level', 'S', '--json'], scaleDir, projectDir)
    expect(build.exitCode).toBe(0)
    const taskId = parseJson<{ task: { id: string } }>(build.stdout).task.id

    const coverageCommand = coverageFixtureCommand()
    const verify = await runScale([
      'verify',
      taskId,
      '--build-cmd',
      'node -v',
      '--lint-cmd',
      'node -v',
      '--test-cmd',
      'node -v',
      '--coverage-cmd',
      coverageCommand,
      '--json',
    ], scaleDir, projectDir)
    expect(verify.exitCode).toBe(0)

    mkdirSync(join(projectDir, 'docs'), { recursive: true })
    writeFileSync(join(projectDir, 'docs', 'direct-dev.md'), 'reviewed dev branch change\n', 'utf-8')
    const review = await runScale(['review', taskId, '--json'], scaleDir, projectDir)
    expect(review.exitCode).toBe(0)
    expect(parseJson<{ passed: boolean }>(review.stdout).passed).toBe(true)

    const headBefore = await execa('git', ['rev-parse', 'HEAD'], { cwd: projectDir })
    const ship = await runScale(['ship', taskId, '--message', 'test: direct dev branch ship', '--json'], scaleDir, projectDir)
    const headAfter = await execa('git', ['rev-parse', 'HEAD'], { cwd: projectDir })

    expect(ship.exitCode).not.toBe(0)
    expect(ship.stderr).toContain('Workspace boundary check failed')
    expect(ship.stderr).toContain('Direct ship on integration branch dev is blocked')
    expect(headAfter.stdout).toBe(headBefore.stdout)
  }, 120_000)

  it('blocks ship when a configured MOE child repository has uncommitted changes', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()
    await execa('git', ['init'], { cwd: projectDir })
    await execa('git', ['config', 'user.email', 'scale-test@example.com'], { cwd: projectDir })
    await execa('git', ['config', 'user.name', 'Scale Test'], { cwd: projectDir })

    const childDir = join(projectDir, 'modules', 'common')
    mkdirSync(childDir, { recursive: true })
    await execa('git', ['init'], { cwd: childDir })
    await execa('git', ['config', 'user.email', 'scale-test@example.com'], { cwd: childDir })
    await execa('git', ['config', 'user.name', 'Scale Test'], { cwd: childDir })
    writeFileSync(join(childDir, 'README.md'), 'child\n', 'utf-8')
    await execa('git', ['add', 'README.md'], { cwd: childDir })
    await execa('git', ['commit', '-m', 'init child'], { cwd: childDir })

    mkdirSync(join(projectDir, '.scale'), { recursive: true })
    writeFileSync(join(projectDir, '.scale', 'workspace.json'), JSON.stringify({
      version: 1,
      topology: 'moe',
      repositories: [
        { name: 'root', path: '.', role: 'root', required: true },
        { name: 'common', path: 'modules/common', role: 'nested-repo', required: true },
      ],
      finishPolicy: {
        requireCleanRepositories: true,
        requirePushedBranches: false,
        requireRootPointerUpdate: true,
      },
    }, null, 2), 'utf-8')
    writeFileSync(join(projectDir, '.gitignore'), 'modules/\n', 'utf-8')
    writeFileSync(join(projectDir, 'README.md'), 'root\n', 'utf-8')
    await execa('git', ['add', 'README.md', '.gitignore', '.scale/workspace.json'], { cwd: projectDir })
    await execa('git', ['commit', '-m', 'init root'], { cwd: projectDir })
    await execa('git', ['checkout', '-b', 'feat/moe-ship-boundary'], { cwd: projectDir })

    const define = await runScale([
      'define',
      'MOE Ship Boundary',
      '--description',
      'Implement a TypeScript CLI workflow that accepts task input arguments, persists review evidence output, enforces rollback constraints, includes lint and typecheck quality standards, and verifies with test acceptance evidence so unreviewed files are never included in a release commit today.',
      '--success-criteria',
      'verification evidence is persisted,review evidence is persisted,dirty child repository blocks ship',
      '--goal',
      'Prevent release commits from ignoring child repository state in a MOE workspace.',
      '--constraint',
      'Child repository changes must be committed and reviewed in their own repository before the root repository ships.',
      '--acceptance',
      'Ship exits non-zero when a configured child repository has uncommitted changes.',
      '--context',
      'The regression fixture has a clean root repository, a configured MOE workspace file, and one nested child Git repository.',
      '--risk',
      'Without this check an agent can create a root commit while unrelated child repository work remains dirty or gets integrated implicitly.',
      '--priority',
      'Protect commit scope and child repository ownership before creating the release commit.',
      '--json',
    ], scaleDir, projectDir)
    expect(define.exitCode).toBe(0)
    const specId = parseJson<{ spec: { id: string } }>(define.stdout).spec.id

    const plan = await runScale(['plan', specId, '--rollback', 'Discard temporary root and child repository changes', '--json'], scaleDir, projectDir)
    expect(plan.exitCode).toBe(0)
    const planId = parseJson<{ plan: { id: string } }>(plan.stdout).plan.id

    const build = await runScale(['build', planId, '--description', 'MOE child repository boundary check', '--json'], scaleDir, projectDir)
    expect(build.exitCode).toBe(0)
    const taskId = parseJson<{ task: { id: string } }>(build.stdout).task.id

    const coverageCommand = coverageFixtureCommand()
    const verify = await runScale([
      'verify',
      taskId,
      '--build-cmd',
      'node -v',
      '--lint-cmd',
      'node -v',
      '--test-cmd',
      'node -v',
      '--coverage-cmd',
      coverageCommand,
      '--json',
    ], scaleDir, projectDir)
    expect(verify.exitCode).toBe(0)

    mkdirSync(join(projectDir, 'docs'), { recursive: true })
    writeFileSync(join(projectDir, 'docs', 'root-change.md'), 'reviewed root change\n', 'utf-8')
    const review = await runScale(['review', taskId, '--json'], scaleDir, projectDir)
    expect(review.exitCode).toBe(0)
    expect(parseJson<{ passed: boolean }>(review.stdout).passed).toBe(true)

    writeFileSync(join(childDir, 'dirty.txt'), 'dirty child change\n', 'utf-8')
    const headBefore = await execa('git', ['rev-parse', 'HEAD'], { cwd: projectDir })
    const ship = await runScale(['ship', taskId, '--message', 'test: moe ship boundary', '--json'], scaleDir, projectDir)
    const headAfter = await execa('git', ['rev-parse', 'HEAD'], { cwd: projectDir })

    expect(ship.exitCode).not.toBe(0)
    expect(ship.stderr).toContain('Workspace boundary check failed')
    expect(ship.stderr).toContain('Child repository modules/common has uncommitted changes')
    expect(headAfter.stdout).toBe(headBefore.stdout)
  }, 120_000)

  // P0: define --draft / --confirm two-step lifecycle
  it('define --draft stops the Spec at REVIEWING (not FROZEN)', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()

    const define = await runScale([
      'define',
      'Draft Spec Feature',
      '--description',
      'Implement a deterministic CLI regression workflow with input arguments and output evidence persisted by the CLI. Use TypeScript CLI commands with rollback constraints, quality lint typecheck, and acceptance verification evidence.',
      '--success-criteria',
      'spec is created,review evidence is persisted',
      '--draft',
      '--json',
    ], scaleDir, projectDir)

    expect(define.exitCode).toBe(0)
    const result = parseJson<{ spec: { id: string; status: string }; status: string; draft: boolean }>(define.stdout)
    expect(result.draft).toBe(true)
    expect(result.status).toBe('REVIEWING')
    expect(result.spec.status).toBe('REVIEWING')

    // Markdown reflects REVIEWING, not FROZEN
    const specMd = readFileSync(join(scaleDir, 'specs', `${result.spec.id}.md`), 'utf-8')
    expect(specMd).toContain('**Status**: REVIEWING')
  }, 120_000)

  it('define --confirm freezes a draft Spec (REVIEWING -> FROZEN)', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()

    const define = await runScale([
      'define',
      'Confirm Spec Feature',
      '--description',
      'Implement a deterministic CLI regression workflow with input arguments and output evidence persisted by the CLI. Use TypeScript CLI commands with rollback constraints, quality lint typecheck, and acceptance verification evidence.',
      '--success-criteria',
      'spec is created,review evidence is persisted',
      '--draft',
      '--json',
    ], scaleDir, projectDir)
    expect(define.exitCode).toBe(0)
    const specId = parseJson<{ spec: { id: string } }>(define.stdout).spec.id

    const confirm = await runScale(['define', '--confirm', specId, '--json'], scaleDir, projectDir)
    expect(confirm.exitCode).toBe(0)
    const confirmResult = parseJson<{ confirm: boolean; status: string; spec: { status: string } }>(confirm.stdout)
    expect(confirmResult.confirm).toBe(true)
    expect(confirmResult.status).toBe('FROZEN')
    expect(confirmResult.spec.status).toBe('FROZEN')

    const specMd = readFileSync(join(scaleDir, 'specs', `${specId}.md`), 'utf-8')
    expect(specMd).toContain('**Status**: FROZEN')
  }, 120_000)

  it('define persists the six-element contract fields', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()

    const define = await runScale([
      'define',
      'Six Element Spec',
      '--description',
      'Implement a deterministic CLI regression workflow with input arguments and output evidence persisted by the CLI. Use TypeScript CLI commands with rollback constraints, quality lint typecheck, and acceptance verification evidence.',
      '--success-criteria',
      'spec is created',
      '--verification-surface',
      'tests/foo.test.ts,npm run e2e',
      '--constraints',
      'p95 < 200ms,no new dependency',
      '--boundary-files',
      'src/foo/**',
      '--boundary-forbidden',
      'src/billing/**',
      '--iteration-strategy',
      'Run the suite after each milestone before continuing.',
      '--blocked-stop',
      'If sandbox is unreachable, report and wait for credentials.',
      '--json',
    ], scaleDir, projectDir)

    expect(define.exitCode).toBe(0)
    const spec = parseJson<{ spec: { id: string; payload: {
      verificationSurface?: string[]
      constraints?: string[]
      boundaries?: { files: string[]; forbidden: string[] }
      iterationStrategy?: string
      blockedStopCondition?: string
    } } }>(define.stdout).spec
    expect(spec.payload.verificationSurface).toEqual(['tests/foo.test.ts', 'npm run e2e'])
    expect(spec.payload.constraints).toEqual(['p95 < 200ms', 'no new dependency'])
    expect(spec.payload.boundaries).toMatchObject({ files: ['src/foo/**'], forbidden: ['src/billing/**'] })
    expect(spec.payload.iterationStrategy).toContain('after each milestone')
    expect(spec.payload.blockedStopCondition).toContain('sandbox is unreachable')

    const specMd = readFileSync(join(scaleDir, 'specs', `${spec.id}.md`), 'utf-8')
    expect(specMd).toContain('## Verification Surface')
    expect(specMd).toContain('tests/foo.test.ts')
    expect(specMd).toContain('## Boundaries')
    expect(specMd).toContain('## Blocked Stop Condition')
  }, 120_000)

  it('define --confirm on a missing Spec fails cleanly', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()

    const confirm = await runScale(['define', '--confirm', 'SPEC-does-not-exist', '--json'], scaleDir, projectDir)
    expect(confirm.exitCode).not.toBe(0)
    expect(confirm.stderr).toContain('Spec not found')
  }, 120_000)

  it('bare define (no --draft) still auto-freezes for backward compatibility', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()

    const define = await runScale([
      'define',
      'Backward Compatible Spec',
      '--description',
      'Implement a deterministic CLI regression workflow with input arguments and output evidence persisted by the CLI. Use TypeScript CLI commands with rollback constraints, quality lint typecheck, and acceptance verification evidence.',
      '--success-criteria',
      'spec is created,review evidence is persisted',
      '--json',
    ], scaleDir, projectDir)

    expect(define.exitCode).toBe(0)
    const result = parseJson<{ spec: { status: string }; status: string; draft: boolean }>(define.stdout)
    expect(result.draft).toBe(false)
    expect(result.status).toBe('FROZEN')
    expect(result.spec.status).toBe('FROZEN')
  }, 120_000)

  // P0 (Decision C1): verify soft-maps Spec.verificationSurface against evidence (warn, not block).
  it('verify reports verificationSurface coverage and flags unmapped items without blocking', async () => {
    const scaleDir = makeScaleDir()
    const projectDir = makeProjectDir()
    await execa('git', ['init'], { cwd: projectDir })

    const define = await runScale([
      'define',
      'Surface Coverage Feature',
      '--description',
      'Implement a deterministic CLI regression workflow with input arguments and output evidence persisted by the CLI. Use TypeScript CLI commands with rollback constraints, quality lint typecheck, and acceptance verification evidence.',
      '--success-criteria',
      'spec is created,evidence persisted',
      '--verification-surface',
      'tests/foo.test.ts,manual-qa-signoff',
      '--json',
    ], scaleDir, projectDir)
    expect(define.exitCode).toBe(0)
    const specId = parseJson<{ spec: { id: string } }>(define.stdout).spec.id

    const plan = await runScale(['plan', specId, '--rollback', 'revert the commit', '--json'], scaleDir, projectDir)
    expect(plan.exitCode).toBe(0)
    const planId = parseJson<{ plan: { id: string } }>(plan.stdout).plan.id

    const build = await runScale(['build', planId, '--description', 'surface coverage task', '--level', 'S', '--json'], scaleDir, projectDir)
    expect(build.exitCode).toBe(0)
    const taskId = parseJson<{ task: { id: string }; artifactDir?: string }>(build.stdout).task.id

    const verify = await runScale([
      'verify',
      taskId,
      '--build-cmd', 'node -v',
      '--lint-cmd', 'node -v',
      '--test-cmd', 'node -v',
      '--json',
    ], scaleDir, projectDir)
    expect(verify.exitCode).toBe(0)
    const coverage = parseJson<{ verificationSurfaceCoverage?: { declared: number; mapped: number; unmapped: string[] } }>(verify.stdout).verificationSurfaceCoverage
    expect(coverage).toBeDefined()
    expect(coverage?.declared).toBe(2)
    expect(coverage?.unmapped).toContain('manual-qa-signoff')

    // Mapping a surface item via the test command moves it out of "unmapped".
    const verifyMapped = await runScale([
      'verify',
      taskId,
      '--build-cmd', 'node -v',
      '--lint-cmd', 'node -v',
      '--test-cmd', 'npx vitest run tests/foo.test.ts',
      '--json',
    ], scaleDir, projectDir)
    expect(verifyMapped.exitCode).toBe(0)
    const mappedCoverage = parseJson<{ verificationSurfaceCoverage?: { mapped: number; unmapped: string[] } }>(verifyMapped.stdout).verificationSurfaceCoverage
    expect(mappedCoverage?.unmapped).not.toContain('tests/foo.test.ts')
    expect(mappedCoverage?.unmapped).toContain('manual-qa-signoff')
  }, 120_000)
})
