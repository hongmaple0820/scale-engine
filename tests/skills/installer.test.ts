// SCALE Engine - Skill Installer Tests

import { describe, it, expect, beforeEach } from 'vitest'
import { SkillRegistry } from '../../src/skills/SkillRegistry.js'
import { SkillInstaller } from '../../src/skills/SkillInstaller.js'
import { registerExternalSkills } from '../../src/skills/ExternalSkills.js'
import { EventBus } from '../../src/core/eventBus.js'

describe('SkillInstaller', () => {
  let registry: SkillRegistry
  let installer: SkillInstaller
  let eventBus: EventBus

  beforeEach(() => {
    eventBus = new EventBus()
    registry = new SkillRegistry(eventBus)
    registerExternalSkills(registry, eventBus)
    installer = new SkillInstaller(registry, eventBus)
  })

  it('should detect uninstalled optional skills', async () => {
    const pending = await installer.checkAndPrompt()
    expect(pending).toHaveLength(20)
    expect(pending.map(c => c.skillId)).toEqual(expect.arrayContaining([
      'impeccable',
      'taste-skill',
      'liteparse',
      'd2-diagram',
      'opensquilla',
      'agent-browser',
      'mcp-chrome-devtools',
      'codex-cli',
      'gemini-cli',
      'opencode-cli',
      'cua',
      'fireworks-tech-graph',
      'qiushi-skill',
      'pua',
      'nuwa-skill',
      'agency-agents-zh',
    ]))
  })

  it('should have correct install method for cua', async () => {
    const pending = await installer.checkAndPrompt()
    const cuaConfig = pending.find(c => c.skillId === 'cua')
    expect(cuaConfig).toBeDefined()
    expect(cuaConfig?.method).toBe('pip-install')
    expect(cuaConfig?.command).toBe('scale setup --pack external-cli --apply --yes')
  })

  it('should have git-clone for fireworks-tech-graph', async () => {
    const pending = await installer.checkAndPrompt()
    const config = pending.find(c => c.skillId === 'fireworks-tech-graph')
    expect(config).toBeDefined()
    expect(config?.method).toBe('git-clone')
    expect(config?.sourceUrl).toContain('github.com')
  })

  it('should keep tool adapters as manual installs', async () => {
    const pending = await installer.checkAndPrompt()
    for (const skillId of ['agent-browser', 'mcp-chrome-devtools', 'codex-cli', 'gemini-cli', 'opencode-cli']) {
      const config = pending.find(c => c.skillId === skillId)
      expect(config).toBeDefined()
      expect(config?.method).toBe('manual')
      expect(config?.sourceUrl).toContain('github.com')
    }
  })

  it('should expose safe install configs for the integrated ecosystem skills', async () => {
    const pending = await installer.checkAndPrompt()
    expect(pending.find(c => c.skillId === 'impeccable')).toMatchObject({
      method: 'npm-install',
      sourceUrl: 'https://github.com/pbakaus/impeccable',
      command: 'npx -y impeccable skills install --yes',
    })
    expect(pending.find(c => c.skillId === 'taste-skill')).toMatchObject({
      method: 'npm-install',
      sourceUrl: 'https://github.com/LeonxlnX/taste-skill',
    })
    expect(pending.find(c => c.skillId === 'liteparse')).toMatchObject({
      method: 'npm-install',
      sourceUrl: 'https://github.com/run-llama/llamaparse-agent-skills',
    })
    expect(pending.find(c => c.skillId === 'opensquilla')).toMatchObject({
      method: 'npm-install',
      sourceUrl: 'https://github.com/opensquilla/opensquilla',
    })
  })

  it('keeps D2 as a manual install instead of pipe-to-shell', async () => {
    const pending = await installer.checkAndPrompt()
    const config = pending.find(c => c.skillId === 'd2-diagram')
    expect(config).toMatchObject({
      method: 'manual',
      sourceUrl: 'https://github.com/terrastruct/d2',
    })
    expect(config?.command).not.toMatch(/\|\s*(bash|sh|iex|Invoke-Expression)/i)
  })

  it('should emit install-prompt event', async () => {
    let eventEmitted = false
    eventBus.on('skills.install-prompt', () => { eventEmitted = true })
    await installer.checkAndPrompt()
    await new Promise(r => setTimeout(r, 50)) // Wait for async dispatch
    expect(eventEmitted).toBe(true)
  })

  it('should return install configs with sourceUrl', async () => {
    const pending = await installer.checkAndPrompt()
    for (const config of pending) {
      expect(config.sourceUrl).toBeDefined()
      expect(config.sourceUrl.length).toBeGreaterThan(0)
    }
  })

  it('should have verification for cua', async () => {
    const pending = await installer.checkAndPrompt()
    const cuaConfig = pending.find(c => c.skillId === 'cua')
    expect(cuaConfig?.verification).toBeDefined()
    expect(cuaConfig?.verification).toContain('python')
  })
})
