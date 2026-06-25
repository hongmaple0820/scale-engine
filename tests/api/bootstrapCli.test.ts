import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

let dirs: string[] = []
const CLI_ENTRY = join(process.cwd(), 'src/api/cli.ts')
const TSX_LOADER = pathToFileURL(join(process.cwd(), 'node_modules/tsx/dist/loader.mjs')).href
const CLI_TEST_TIMEOUT_MS = 120_000
const UI_BOOTSTRAP_IDS = [
  'web-access',
  'impeccable',
  'taste-skill',
  'awesome-design-md',
  'ui-ux-pro-max',
  'frontend-design',
  'agent-browser',
  'playwright',
  'mcp-chrome-devtools',
]
const UI_POSTCHECK_COMMANDS = [
  'scale tool doctor --tools web-access,impeccable,taste-skill,awesome-design-md,ui-ux-pro-max,frontend-design --json',
  'scale tool doctor --tools agent-browser,playwright,mcp-chrome-devtools --json',
]

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  dirs = []
})

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

async function runScale(args: string[], scaleDir: string, projectDir: string, homeDir: string, cwd = process.cwd()) {
  return execa('node', ['--import', TSX_LOADER, CLI_ENTRY, ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      SCALE_DIR: scaleDir,
      SCALE_PROJECT_DIR: projectDir,
      SCALE_LOG_LEVEL: undefined,
    },
    reject: false,
  })
}

describe('bootstrap CLI', () => {
  it('plans UI dependency bootstrap in a fresh home directory', async () => {
    const scaleDir = makeDir('scale-bootstrap-cli-scale-')
    const projectDir = makeDir('scale-bootstrap-cli-project-')
    const homeDir = makeDir('scale-bootstrap-cli-home-')

    const result = await runScale(['bootstrap', 'deps', '--dir', projectDir, '--pack', 'ui', '--json'], scaleDir, projectDir, homeDir)

    expect(result.exitCode).toBe(0)
    const report = JSON.parse(result.stdout) as {
      apply: boolean
      packIds: string[]
      summary: { total: number; ready: number; manualReview: number; failed: number }
      runtimeChecks: Array<{ id: string; status: string; requiredFor: string[] }>
      postChecks: Array<unknown>
      postCheckSummary: { total: number; passed: number; warned: number; failed: number }
      items: Array<{ id: string; status: string; installCommand?: string }>
      postCheckCommands: string[]
      rollbackHints: string[]
      recommendations: string[]
    }
    expect(report.apply).toBe(false)
    expect(report.packIds).toEqual(['ui'])
    expect(report.summary.total).toBe(UI_BOOTSTRAP_IDS.length)
    expect(report.summary.ready).toBeGreaterThanOrEqual(4)
    expect(report.summary.manualReview).toBe(0)
    expect(report.summary.failed).toBe(0)
    expect(report.runtimeChecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'node', status: 'ok' }),
      expect.objectContaining({ id: 'npx', status: 'ok' }),
    ]))
    expect(report.runtimeChecks.find(check => check.id === 'npx')?.requiredFor).toEqual(expect.arrayContaining(UI_BOOTSTRAP_IDS))
    expect(report.postChecks).toEqual([])
    expect(report.postCheckSummary).toMatchObject({ total: 0, passed: 0, warned: 0, failed: 0 })
    expect(report.items.map(item => item.id)).toEqual(UI_BOOTSTRAP_IDS)
    expect(report.items.every(item => item.status !== 'manual-review' && item.status !== 'failed')).toBe(true)
    expect(report.items.find(item => item.id === 'impeccable')?.installCommand).toContain('npx -y impeccable skills install --yes')
    expect(report.items.find(item => item.id === 'taste-skill')?.installCommand).toContain('LeonxlnX/taste-skill')
    expect(report.items.find(item => item.id === 'web-access')?.installCommand).toContain('web-access')
    expect(report.items.find(item => item.id === 'frontend-design')?.installCommand).toContain('frontend-design')
    expect(report.items.find(item => item.id === 'awesome-design-md')?.installCommand).toContain('install skill adapter')
    expect(report.items.find(item => item.id === 'awesome-design-md')?.installCommand).toContain('VoltAgent/awesome-design-md')
    expect(report.items.find(item => item.id === 'ui-ux-pro-max')?.installCommand).toContain('install skill adapter')
    expect(report.items.find(item => item.id === 'ui-ux-pro-max')?.installCommand).toContain('nextlevelbuilder/ui-ux-pro-max-skill')
    expect(report.postCheckCommands).toEqual(expect.arrayContaining([
      ...UI_POSTCHECK_COMMANDS,
      'scale skill doctor --json',
      'scale doctor',
    ]))
    expect(report.rollbackHints).toEqual(expect.arrayContaining([
      'Skill rollback (impeccable): remove the installed skill directory under ~/.agents/skills/impeccable after review',
      'Skill rollback (awesome-design-md): remove the installed skill directory under ~/.agents/skills/awesome-design-md after review',
    ]))
    expect(report.recommendations).toEqual(expect.arrayContaining([
      'Re-run with --apply to install all ready dependencies in one pass.',
      'Use impeccable as the required deterministic UI anti-pattern gate before visual acceptance.',
      'Use awesome-design-md as the source of DESIGN.md, brand direction, and visual-language selection.',
    ]))
  }, CLI_TEST_TIMEOUT_MS)

  it('renders bootstrap output in Chinese by default and English when requested', async () => {
    const scaleDir = makeDir('scale-bootstrap-cli-scale-')
    const projectDir = makeDir('scale-bootstrap-cli-project-')
    const homeDir = makeDir('scale-bootstrap-cli-home-')

    const zh = await runScale(['bootstrap', 'deps', '--dir', projectDir, '--pack', 'ui'], scaleDir, projectDir, homeDir)
    const en = await runScale(['bootstrap', 'deps', '--dir', projectDir, '--pack', 'ui', '--lang', 'en'], scaleDir, projectDir, homeDir)

    expect(zh.exitCode).toBe(0)
    expect(zh.stdout).toContain('SCALE 依赖安装计划')
    expect(zh.stdout).toContain('执行安装: 否')
    expect(zh.stdout).toContain('运行时依赖:')
    expect(en.exitCode).toBe(0)
    expect(en.stdout).toContain('SCALE Dependency Bootstrap')
    expect(en.stdout).toContain('Apply: false')
    expect(en.stdout).toContain('Runtime dependencies:')
  }, CLI_TEST_TIMEOUT_MS)

  it('provides setup as a user-facing wrapper with default Chinese language', async () => {
    const scaleDir = makeDir('scale-bootstrap-cli-scale-')
    const projectDir = makeDir('scale-bootstrap-cli-project-')
    const homeDir = makeDir('scale-bootstrap-cli-home-')

    const result = await runScale(['setup', '--dir', projectDir, '--pack', 'ui', '--json'], scaleDir, projectDir, homeDir)

    expect(result.exitCode).toBe(0)
    const report = JSON.parse(result.stdout) as {
      lang: string
      applied: boolean
      final: { packIds: string[]; runtimeChecks: Array<{ id: string }>; items: Array<{ id: string }> }
    }
    expect(report.lang).toBe('zh')
    expect(report.applied).toBe(false)
    expect(report.final.packIds).toEqual(['ui'])
    expect(report.final.runtimeChecks.map(check => check.id)).toEqual(expect.arrayContaining(['node', 'npx']))
    expect(report.final.items.map(item => item.id)).toEqual(UI_BOOTSTRAP_IDS)
  }, CLI_TEST_TIMEOUT_MS)

  it('switches gbrain memory provider through setup without hand-editing config', async () => {
    const scaleDir = makeDir('scale-bootstrap-cli-scale-')
    const projectDir = makeDir('scale-bootstrap-cli-project-')
    const homeDir = makeDir('scale-bootstrap-cli-home-')

    const result = await runScale([
      'setup',
      '--dir',
      projectDir,
      '--pack',
      'memory',
      '--memory-provider',
      'gbrain',
      '--json',
    ], scaleDir, projectDir, homeDir)

    expect(result.exitCode).toBe(0)
    const report = JSON.parse(result.stdout) as {
      ok: boolean
      memoryProviderSwitch: {
        provider: string
        mode: string
        previousOrder: string[]
        nextOrder: string[]
      }
      final: { packIds: string[]; runtimeChecks: Array<{ id: string }> }
    }
    expect(report.ok).toBe(true)
    expect(report.memoryProviderSwitch).toMatchObject({
      provider: 'gbrain',
      mode: 'external-first',
    })
    expect(report.memoryProviderSwitch.previousOrder).toEqual(['gbrain'])
    expect(report.memoryProviderSwitch.nextOrder).toEqual(['gbrain'])
    expect(report.final.packIds).toEqual(['memory'])
    expect(report.final.runtimeChecks.map(check => check.id)).toContain('bun')
  }, CLI_TEST_TIMEOUT_MS)

  it('verifies governed setup readiness in one report', async () => {
    const scaleDir = makeDir('scale-bootstrap-cli-scale-')
    const projectDir = makeDir('scale-bootstrap-cli-project-')
    const homeDir = makeDir('scale-bootstrap-cli-home-')

    const result = await runScale(['setup', '--verify', '--dir', projectDir, '--pack', 'ui', '--json'], scaleDir, projectDir, homeDir)

    expect(result.exitCode).toBe(1)
    const report = JSON.parse(result.stdout) as {
      ok: boolean
      packIds: string[]
      dependencyBootstrap: { packIds: string[]; items: Array<{ id: string }> }
      toolCapabilities: { summary: { total: number; missing: number } }
      summary: { blockingIssues: string[] }
      recommendations: string[]
    }
    expect(report.ok).toBe(false)
    expect(report.packIds).toEqual(['ui'])
    expect(report.dependencyBootstrap.packIds).toEqual(['ui'])
    expect(report.dependencyBootstrap.items.map(item => item.id)).toEqual(UI_BOOTSTRAP_IDS)
    expect(report.toolCapabilities.summary.total).toBe(UI_BOOTSTRAP_IDS.length)
    expect(report.toolCapabilities.summary.missing).toBeGreaterThan(0)
    expect(report.summary.blockingIssues).toEqual(expect.arrayContaining([
      expect.stringContaining('Missing governed capabilities:'),
    ]))
    expect(report.recommendations).toEqual(expect.arrayContaining([
      ...UI_POSTCHECK_COMMANDS,
    ]))
  }, CLI_TEST_TIMEOUT_MS)

  it('reports workflow capability planning and bootstrap hint during init', async () => {
    const scaleDir = makeDir('scale-bootstrap-cli-scale-')
    const projectDir = makeDir('scale-bootstrap-cli-project-')
    const homeDir = makeDir('scale-bootstrap-cli-home-')

    const result = await runScale(['init', '--dir', projectDir, '--governance-pack', 'standard', '--json'], scaleDir, projectDir, homeDir)

    expect(result.exitCode).toBe(0)
    const report = JSON.parse(result.stdout) as {
      ok: boolean
      workflowCapabilities: string[]
      capabilitiesEnabled: string[]
      dependencyBootstrapCommand: string
    }
    expect(report.ok).toBe(true)
    expect(report.workflowCapabilities).toEqual(['browser', 'search', 'computer'])
    expect(report.capabilitiesEnabled).toEqual(report.workflowCapabilities)
    expect(report.dependencyBootstrapCommand).toBe('scale setup --pack external-cli --memory-provider gbrain --memory-mode external-first --json')
  }, CLI_TEST_TIMEOUT_MS)

  it('derives bootstrap packs from profile and governance pack hints', async () => {
    const scaleDir = makeDir('scale-bootstrap-cli-scale-')
    const projectDir = makeDir('scale-bootstrap-cli-project-')
    const homeDir = makeDir('scale-bootstrap-cli-home-')

    const result = await runScale(
      ['bootstrap', 'deps', '--dir', projectDir, '--profile', 'advanced', '--governance-pack', 'frontend-app', '--json'],
      scaleDir,
      projectDir,
      homeDir,
    )

    expect(result.exitCode).toBe(0)
    const report = JSON.parse(result.stdout) as {
      packIds: string[]
      items: Array<{ id: string }>
      postCheckCommands: string[]
    }
    expect(report.packIds).toEqual(['external-cli', 'memory', 'knowledge', 'ui'])
    expect(report.items.map(item => item.id)).toEqual(expect.arrayContaining([
      'rtk',
      'gbrain',
      'codegraph',
      'graphify',
      'gitnexus',
      'web-access',
      'impeccable',
      'taste-skill',
      'awesome-design-md',
      'ui-ux-pro-max',
      'frontend-design',
      'agent-browser',
      'playwright',
      'mcp-chrome-devtools',
      'desktop-cua',
      'codex-cli',
      'gemini-cli',
      'opencode-cli',
    ]))
    expect(report.postCheckCommands).toEqual(expect.arrayContaining([
      ...UI_POSTCHECK_COMMANDS,
      'scale memory provider status --json',
      'scale tool doctor --tools codegraph,graphify,gitnexus --json',
      'scale tool doctor --tools rtk,gitnexus,desktop-cua,codex-cli,gemini-cli,opencode-cli --json',
    ]))
  }, CLI_TEST_TIMEOUT_MS)

  it('returns profile bootstrap guidance when switching config profiles', async () => {
    const scaleDir = makeDir('scale-bootstrap-cli-scale-')
    const projectDir = makeDir('scale-bootstrap-cli-project-')
    const homeDir = makeDir('scale-bootstrap-cli-home-')

    const result = await runScale(
      ['config', 'profile', '--set', 'advanced', '--governance-pack', 'frontend-app', '--json'],
      scaleDir,
      projectDir,
      homeDir,
      projectDir,
    )

    expect(result.exitCode).toBe(0)
    const report = JSON.parse(result.stdout) as {
      ok: boolean
      profile: string
      bootstrapPacks: string[]
      dependencyBootstrapCommand: string
      dependencyBootstrapApplyCommand: string
      configPath: string
    }
    expect(report.ok).toBe(true)
    expect(report.profile).toBe('advanced')
    expect(report.bootstrapPacks).toEqual(['external-cli', 'memory', 'knowledge', 'ui'])
    expect(report.dependencyBootstrapCommand).toBe('scale setup --pack external-cli,memory,knowledge,ui --memory-provider gbrain --memory-mode external-first --json')
    expect(report.dependencyBootstrapApplyCommand).toBe('scale setup --pack external-cli,memory,knowledge,ui --memory-provider gbrain --memory-mode external-first --apply --yes')
    expect(report.configPath.replaceAll('\\', '/')).toBe('.scale/config.yaml')
  }, CLI_TEST_TIMEOUT_MS)
})
