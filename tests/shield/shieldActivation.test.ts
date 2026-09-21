import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it } from 'vitest'
import { activateShield, renderPolicyYaml, shieldArtifactDirs } from '../../src/shield/ShieldActivation.js'
import { PolicyCompiler } from '../../src/shield/PolicyCompiler.js'

const root = mkdtempSync(join(tmpdir(), 'scale-shield-activation-'))
let counter = 0

afterAll(() => rmSync(root, { recursive: true, force: true }))

function makeProject(withSettings: boolean, agent = 'claude-code'): string {
  const dir = join(root, String(++counter))
  mkdirSync(join(dir, '.scale'), { recursive: true })
  if (withSettings) {
    const settingsDir = join(dir, '.claude')
    mkdirSync(settingsDir, { recursive: true })
    writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify({ hooks: {} }, null, 2), 'utf-8')
  }
  return dir
}

describe('activateShield', () => {
  it('compiles hooks and registers PreToolUse and Stop in the agent settings', () => {
    const dir = makeProject(true)
    const report = activateShield(dir)

    expect(report.ok).toBe(true)
    expect(report.hooks.length).toBeGreaterThan(0)
    expect(report.hooks.every(hook => existsSync(hook))).toBe(true)
    expect(report.registered).toEqual([join(dir, '.claude', 'settings.json')])

    const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8'))
    expect(settings.hooks.PreToolUse.some((entry: { command: string }) => entry.command.includes('shield-pre-tool.js'))).toBe(true)
    expect(settings.hooks.Stop.some((entry: { command: string }) => entry.command.includes('shield-require-clean-worktree.js'))).toBe(true)
  })

  it('writes an editable policy file that round-trips back into the same rules', () => {
    const dir = makeProject(true)
    const report = activateShield(dir)

    expect(report.policyPath).toBe(join(dir, '.scale', 'policy.yaml'))
    expect(existsSync(report.policyPath as string)).toBe(true)

    const loaded = new PolicyCompiler().loadPolicy(dir)
    expect(loaded.rules.map(rule => rule.id)).toContain('require-clean-worktree')
    expect(loaded.rules.map(rule => rule.id)).toContain('block-dangerous-commands')
    expect(loaded.settings?.blockMode).toBe('strict')
  })

  it('keeps an existing policy file untouched', () => {
    const dir = makeProject(true)
    const policyPath = join(dir, '.scale', 'policy.yaml')
    const custom = 'version: 1\nrules: []\nsettings:\n  blockMode: warn\n'
    writeFileSync(policyPath, custom, 'utf-8')

    const report = activateShield(dir)
    expect(report.policyPath).toBeUndefined()
    expect(readFileSync(policyPath, 'utf-8')).toBe(custom)
  })

  it('compiles hooks but warns when no agent settings file exists yet', () => {
    const dir = makeProject(false)
    const report = activateShield(dir)

    expect(report.ok).toBe(true)
    expect(report.hooks.length).toBeGreaterThan(0)
    expect(report.registered).toEqual([])
    expect(report.warnings.some(warning => warning.includes('No agent settings file'))).toBe(true)
  })

  it('does not duplicate hook registrations when run twice', () => {
    const dir = makeProject(true)
    activateShield(dir)
    activateShield(dir)

    const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8'))
    const stopEntries = settings.hooks.Stop.filter((entry: { command: string }) => entry.command.includes('shield-require-clean-worktree.js'))
    const preToolEntries = settings.hooks.PreToolUse.filter((entry: { command: string }) => entry.command.includes('shield-pre-tool.js'))
    expect(stopEntries).toHaveLength(1)
    expect(preToolEntries).toHaveLength(1)
  })

  it('exposes the artifact directories used for install-time commit scoping', () => {
    const dir = makeProject(true)
    const dirs = shieldArtifactDirs(dir)
    expect(dirs).toContain(join(dir, '.claude', 'hooks'))
  })

  it('renders a policy template carrying the tool-artifact allowlist', () => {
    const yaml = renderPolicyYaml()
    expect(yaml).toContain('require-clean-worktree')
    expect(yaml).toContain('dirty_tree')
    expect(yaml).toContain('output/')
  })
})
