import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
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

async function runScale(args: string[], scaleDir: string, projectDir?: string) {
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

describe('upgrade CLI', () => {
  it('runs the default upgrade wizard without requiring check/plan/apply subcommands', async () => {
    const scaleDir = makeDir('scale-upgrade-wizard-cli-')
    const projectDir = makeDir('scale-upgrade-wizard-project-')
    const init = await runScale(['init', '--dir', projectDir, '--governance-pack', 'project-scaffold', '--json'], scaleDir, projectDir)
    expect(init.exitCode).toBe(0)

    const wizard = await runScale(['upgrade', '--dir', projectDir, '--json'], scaleDir, projectDir)
    expect(wizard.exitCode).toBe(0)
    const report = parseJson<{
      ok: boolean
      htmlPath?: string
      plan: { applyMode: string; steps: unknown[] }
    }>(wizard.stdout)
    expect(report.ok).toBe(true)
    expect(report.htmlPath).toContain('upgrade-plan.html')
    expect(report.plan.applyMode).toBe('safe')
    expect(report.plan.steps.length).toBeGreaterThan(0)
  }, 45000)

  it('prints machine-readable upgrade check and plan reports', async () => {
    const scaleDir = makeDir('scale-upgrade-cli-')
    const projectDir = makeDir('scale-upgrade-project-')
    const init = await runScale(['init', '--dir', projectDir, '--governance-pack', 'project-scaffold', '--json'], scaleDir, projectDir)
    expect(init.exitCode).toBe(0)

    const check = await runScale(['upgrade', 'check', '--dir', projectDir, '--json'], scaleDir, projectDir)
    expect(check.exitCode).toBe(0)
    expect(parseJson<{ status: string; thirdParty: { policy: string } }>(check.stdout)).toMatchObject({
      status: 'clean',
      thirdParty: { policy: 'default-install' },
    })

    const plan = await runScale(['upgrade', 'plan', '--dir', projectDir, '--json'], scaleDir, projectDir)
    expect(plan.exitCode).toBe(0)
    expect(parseJson<{ applyMode: string; steps: unknown[] }>(plan.stdout)).toMatchObject({
      applyMode: 'safe',
    })
  }, 45000)

  it('includes AI OS runtime readiness in upgrade check and plan reports', async () => {
    const scaleDir = makeDir('scale-upgrade-aios-cli-')
    const projectDir = makeDir('scale-upgrade-aios-project-')
    const init = await runScale(['init', '--dir', projectDir, '--governance-pack', 'project-scaffold', '--json'], scaleDir, projectDir)
    expect(init.exitCode).toBe(0)

    const check = await runScale(['upgrade', 'check', '--dir', projectDir, '--json'], scaleDir, projectDir)
    expect(check.exitCode).toBe(0)
    const checkReport = parseJson<{
      aiOsRuntime: {
        status: string
        summary: { blockedChecks: number }
        nextActions: string[]
      }
      recommendedCommands: string[]
    }>(check.stdout)
    expect(checkReport.aiOsRuntime.status).toBe('blocked')
    expect(checkReport.aiOsRuntime.summary.blockedChecks).toBeGreaterThan(0)
    expect(checkReport.aiOsRuntime.nextActions).toEqual(expect.arrayContaining([
      expect.stringContaining('scale ai-os migrate'),
    ]))
    expect(checkReport.recommendedCommands).toContain('scale ai-os adopt --dir . --task "Adopt AI OS runtime" --json')
    expect(checkReport.recommendedCommands).toContain('scale ai-os doctor --dir . --json')

    const plan = await runScale(['upgrade', 'plan', '--dir', projectDir, '--json'], scaleDir, projectDir)
    expect(plan.exitCode).toBe(0)
    const planReport = parseJson<{
      steps: Array<{ action: string; command?: string }>
    }>(plan.stdout)
    expect(planReport.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'adopt-ai-os-runtime', command: 'scale ai-os adopt --dir . --task "Adopt AI OS runtime" --json' }),
      expect.objectContaining({ action: 'migrate-ai-os-runtime', command: 'scale ai-os migrate --dir . --json' }),
      expect.objectContaining({ action: 'check-ai-os-runtime', command: 'scale ai-os doctor --dir . --json' }),
    ]))
  }, 45000)

  it('prints Chinese upgrade guidance by default and English guidance on request', async () => {
    const scaleDir = makeDir('scale-upgrade-cli-')
    const projectDir = makeDir('scale-upgrade-project-')
    const init = await runScale(['init', '--dir', projectDir, '--governance-pack', 'project-scaffold', '--json'], scaleDir, projectDir)
    expect(init.exitCode).toBe(0)

    const zh = await runScale(['upgrade', 'check', '--dir', projectDir], scaleDir, projectDir)
    expect(zh.exitCode).toBe(0)
    expect(zh.stdout).toContain('SCALE 升级检查')
    expect(zh.stdout).toContain('AI OS Runtime:')
    expect(zh.stdout).toContain('下一步')
    expect(zh.stdout).toContain('scale ai-os adopt --dir . --task "接入 AI OS runtime" --lang zh')
    expect(zh.stdout).not.toContain('Adopt AI OS runtime" --json')

    const en = await runScale(['upgrade', 'check', '--dir', projectDir, '--lang', 'en'], scaleDir, projectDir)
    expect(en.exitCode).toBe(0)
    expect(en.stdout).toContain('SCALE Upgrade Check')
    expect(en.stdout).toContain('Next')
    expect(en.stdout).toContain('scale ai-os adopt --dir . --task "Adopt AI OS runtime" --lang en')
  }, 45000)

  it('localizes human upgrade plan AI OS adoption commands', async () => {
    const scaleDir = makeDir('scale-upgrade-plan-locale-cli-')
    const projectDir = makeDir('scale-upgrade-plan-locale-project-')
    const init = await runScale(['init', '--dir', projectDir, '--governance-pack', 'project-scaffold', '--json'], scaleDir, projectDir)
    expect(init.exitCode).toBe(0)

    const zh = await runScale(['upgrade', 'plan', '--dir', projectDir, '--lang', 'zh'], scaleDir, projectDir)
    expect(zh.exitCode).toBe(0)
    expect(zh.stdout).toContain('SCALE 升级计划')
    expect(zh.stdout).toContain('scale ai-os adopt --dir . --task "接入 AI OS runtime" --lang zh')
    expect(zh.stdout).not.toContain('Adopt AI OS runtime" --json')

    const en = await runScale(['upgrade', 'plan', '--dir', projectDir, '--lang', 'en'], scaleDir, projectDir)
    expect(en.exitCode).toBe(0)
    expect(en.stdout).toContain('SCALE Upgrade Plan')
    expect(en.stdout).toContain('scale ai-os adopt --dir . --task "Adopt AI OS runtime" --lang en')
  }, 45000)

  it('safe-applies missing generated files and can roll them back', async () => {
    const scaleDir = makeDir('scale-upgrade-cli-')
    const projectDir = makeDir('scale-upgrade-project-')
    const missingPath = join(projectDir, 'docs', 'workflow', 'templates', 'summary.md')
    const init = await runScale(['init', '--dir', projectDir, '--governance-pack', 'project-scaffold', '--json'], scaleDir, projectDir)
    expect(init.exitCode).toBe(0)
    rmSync(missingPath)

    const apply = await runScale(['upgrade', 'apply', '--dir', projectDir, '--confirm', '--json'], scaleDir, projectDir)
    expect(apply.exitCode).toBe(0)
    expect(parseJson<{ ok: boolean; applied: boolean; changedFiles: string[] }>(apply.stdout)).toMatchObject({
      ok: true,
      applied: true,
      changedFiles: expect.arrayContaining(['docs/workflow/templates/summary.md']),
    })
    expect(existsSync(missingPath)).toBe(true)

    const rollback = await runScale(['upgrade', 'rollback', '--dir', projectDir, '--json'], scaleDir, projectDir)
    expect(rollback.exitCode).toBe(0)
    expect(parseJson<{ ok: boolean; restoredFiles: string[] }>(rollback.stdout)).toMatchObject({
      ok: true,
      restoredFiles: expect.arrayContaining(['docs/workflow/templates/summary.md']),
    })
    expect(existsSync(missingPath)).toBe(false)
  }, 45000)

  it('prints third-party tool and skill update surfaces without installing anything', async () => {
    const scaleDir = makeDir('scale-upgrade-cli-')
    const projectDir = makeDir('scale-upgrade-project-')
    const init = await runScale(['init', '--dir', projectDir, '--governance-pack', 'standard', '--json'], scaleDir, projectDir)
    expect(init.exitCode).toBe(0)

    const tools = await runScale(['tools', 'outdated', '--dir', projectDir, '--json'], scaleDir, projectDir)
    expect(tools.exitCode).toBe(0)
    expect(parseJson<{ policy: string; entries: Array<{ category: string; updatePolicy: string }> }>(tools.stdout)).toMatchObject({
      policy: 'default-install',
    })

    const skills = await runScale(['skill', 'outdated', '--dir', projectDir, '--json'], scaleDir, projectDir)
    expect(skills.exitCode).toBe(0)
    expect(parseJson<{ policy: string; entries: Array<{ category: string; updatePolicy: string }> }>(skills.stdout)).toMatchObject({
      policy: 'default-install',
    })
  }, 45000)
})
