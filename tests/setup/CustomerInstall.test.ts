import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { runCustomerInstall } from '../../src/setup/CustomerInstall.js'

describe('customer install', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('installs the core workflow through one customer-facing command path', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-install-'))
    tempDirs.push(projectDir)
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({
      scripts: { build: 'echo build' },
      dependencies: { next: '^15.0.0', react: '^19.0.0' },
    }, null, 2))

    const report = await runCustomerInstall({
      projectDir,
      agent: 'codex',
      profile: 'standard',
      governancePack: 'frontend-app',
      interactive: false,
      skipDeps: true,
      noGit: true,
      lang: 'en',
    })

    expect(report.ok, JSON.stringify(report.verification?.summary ?? report.warnings)).toBe(true)
    expect(report.selection).toMatchObject({
      agent: 'codex',
      profile: 'standard',
      governancePack: 'frontend-app',
      dependencyPacks: [],
      applyDependencies: false,
    })
    expect(existsSync(join(projectDir, '.scale', 'config.yaml'))).toBe(true)
    expect(existsSync(join(projectDir, '.scale', 'thresholds.json'))).toBe(true)
    expect(existsSync(join(projectDir, 'AGENTS.md'))).toBe(true)
    expect(report.steps.map(step => step.status)).toEqual(expect.arrayContaining(['run', 'ok', 'skip']))
    expect(report.nextSteps).toEqual([
      'scale open --dir .',
      'scale smoke --dir .',
      'scale define "your feature" --dir .',
    ])
  })

  it('creates a real initial install commit without staging pre-existing user files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'scale-install-git-e2e-'))
    tempDirs.push(root)
    const projectDir = join(root, 'project')
    const home = join(root, 'home')
    mkdirSync(projectDir)
    mkdirSync(home)
    writeFileSync(join(home, '.gitconfig'), '[user]\n name = SCALE Test\n email = scale@example.test\n')
    writeFileSync(join(projectDir, 'private-user.txt'), 'must stay untracked\n')
    const previous = new Map(['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME'].map(key => [key, process.env[key]]))
    try {
      for (const key of previous.keys()) process.env[key] = home
      const report = await runCustomerInstall({ projectDir, agent: 'codex', profile: 'standard', governancePack: 'standard', interactive: false, skipDeps: true, skipVerify: true, lang: 'en' })
      expect(report.git?.initialized).toBe(true)
      expect(report.git?.committed, report.git?.warnings.join('\n')).toBe(true)
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)))
      const files = execFileSync('git', ['-C', projectDir, 'ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8', env }).split(/\r?\n/)
      expect(files).toContain('AGENTS.md')
      expect(files).toContain('.scale/config.yaml')
      expect(files).not.toContain('private-user.txt')
      expect(existsSync(join(projectDir, '.scale', 'scale.db'))).toBe(false)
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  }, 120_000)

  it('initializes multiple agent adapters and writes the language policy', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-install-multi-agent-'))
    tempDirs.push(projectDir)
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({
      scripts: { build: 'echo build', lint: 'echo lint', test: 'echo test' },
      dependencies: { vue: '^3.5.0' },
    }, null, 2))

    const report = await runCustomerInstall({
      projectDir,
      agent: 'codex,claude-code',
      profile: 'standard',
      governancePack: 'frontend-app',
      interactive: false,
      skipDeps: true,
      noGit: true,
      lang: 'zh',
    })

    expect(report.ok, JSON.stringify(report.verification?.summary ?? report.warnings)).toBe(true)
    expect(report.selection.agents).toEqual(['codex', 'claude-code'])
    expect(existsSync(join(projectDir, '.codex', 'hooks.json'))).toBe(true)
    expect(existsSync(join(projectDir, '.claude', 'settings.json'))).toBe(true)
    expect(readFileSync(join(projectDir, '.scale', 'config.yaml'), 'utf-8')).toContain('locale: zh')
    expect(readFileSync(join(projectDir, '.scale', 'agent-language.md'), 'utf-8')).toContain('Language: zh')
    expect(readFileSync(join(projectDir, 'AGENTS.md'), 'utf-8')).toContain('SCALE Language Policy')
    expect(readFileSync(join(projectDir, 'CLAUDE.md'), 'utf-8')).toContain('SCALE Language Policy')
    expect(report.nextSteps).toContain('scale define "你的功能" --dir .')
  })
})
