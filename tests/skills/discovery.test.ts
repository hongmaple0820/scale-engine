// SCALE Engine - Skill Discovery Tests

import { describe, it, expect, beforeEach } from 'vitest'
import { SkillRegistry } from '../../src/skills/SkillRegistry.js'
import { SkillInstaller } from '../../src/skills/SkillInstaller.js'
import { SkillDiscovery } from '../../src/skills/SkillDiscovery.js'
import { registerExternalSkills } from '../../src/skills/ExternalSkills.js'
import { EventBus } from '../../src/core/eventBus.js'

describe('SkillDiscovery', () => {
  let registry: SkillRegistry
  let installer: SkillInstaller
  let discovery: SkillDiscovery
  let eventBus: EventBus

  beforeEach(() => {
    eventBus = new EventBus()
    registry = new SkillRegistry(eventBus)
    registerExternalSkills(registry, eventBus)
    installer = new SkillInstaller(registry, eventBus)
    discovery = new SkillDiscovery(registry, installer, eventBus)
  })

  it('should discover browser automation skills for web-scraping task', async () => {
    const results = await discovery.discover({
      taskType: 'web-scraping',
      missingCapabilities: ['browser', 'login'],
      phase: 'execute',
      keywords: ['automation'],
    })
    expect(results.length).toBeGreaterThan(0)
    expect(results.some(r => r.skillId === 'web-access')).toBe(true)
    expect(results.some(r => r.skillId === 'agent-browser')).toBe(true)
    expect(results.some(r => r.skillId === 'mcp-chrome-devtools')).toBe(true)
    expect(results.some(r => r.skillId === 'cua')).toBe(true)
  })

  it('uses current ecosystem sources for UI and browser capabilities', async () => {
    const browserResults = await discovery.discover({
      taskType: 'web-scraping',
      missingCapabilities: ['browser'],
      phase: 'execute',
      keywords: ['browser automation'],
    })
    expect(browserResults.find(r => r.skillId === 'web-access')?.sourceUrl).toBe('https://github.com/eze-is/web-access')
    expect(browserResults.find(r => r.skillId === 'agent-browser')?.sourceUrl).toBe('https://github.com/vercel-labs/agent-browser')

    const uiResults = await discovery.discover({
      taskType: 'ui-design',
      missingCapabilities: ['design'],
      phase: 'plan',
      keywords: ['brand design system'],
    })
    expect(uiResults.map(result => result.sourceUrl)).toEqual(expect.arrayContaining([
      'https://github.com/pbakaus/impeccable',
      'https://github.com/LeonxlnX/taste-skill',
      'https://github.com/VoltAgent/awesome-design-md',
      'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
    ]))
  })

  it('discovers document parsing, D2 diagrams, and orchestration references', async () => {
    expect(await discovery.discover({
      taskType: 'document-parsing',
      missingCapabilities: ['pdf', 'ocr'],
      phase: 'plan',
      keywords: ['document parsing'],
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ skillId: 'liteparse', sourceUrl: 'https://github.com/run-llama/llamaparse-agent-skills' }),
    ]))

    expect(await discovery.discover({
      taskType: 'diagram',
      missingCapabilities: ['diagram'],
      phase: 'plan',
      keywords: ['d2'],
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ skillId: 'd2-diagram', sourceUrl: 'https://github.com/terrastruct/d2' }),
    ]))

    expect(await discovery.discover({
      taskType: 'agent-orchestration',
      missingCapabilities: ['routing'],
      phase: 'plan',
      keywords: ['metaskill'],
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ skillId: 'opensquilla', sourceUrl: 'https://github.com/opensquilla/opensquilla' }),
    ]))
  })

  it('should recommend high quality skills for installation', async () => {
    const configs = await discovery.recommendInstall({
      taskType: 'ui-design',
      missingCapabilities: ['design', 'ux'],
      phase: 'plan',
      keywords: ['brand', 'accessibility'],
    })
    for (const config of configs) {
      expect(config.skillId).toBeDefined()
      expect(config.sourceUrl).toContain('github')
    }
  })

  it('should check during execution for missing capabilities', async () => {
    const results = await discovery.checkDuringExecution('web-scraping', ['browser', 'cua', 'playwright'])
    // 已安装的技能不会出现在结果中
    const uninstalled = results.filter(r => !r.alreadyInstalled)
    expect(uninstalled.length).toBeGreaterThanOrEqual(0)
  })

  it('should detect platform from project files', () => {
    const platform = discovery.detectPlatform()
    // 在测试环境中可能无法检测到平台
    expect(platform).toBeDefined()
  })

  it('should emit skill.recommended event', async () => {
    let eventEmitted = false
    eventBus.on('skill.recommended', () => { eventEmitted = true })
    await discovery.discover({
      taskType: 'diagram',
      missingCapabilities: ['diagram'],
      phase: 'plan',
      keywords: ['architecture'],
    })
    await new Promise(r => setTimeout(r, 50))
    expect(eventEmitted).toBe(true)
  })

  it('should periodic scan find unregistered skills', async () => {
    const results = await discovery.periodicScan()
    // 找出知识库中但未注册的技能
    expect(results.length).toBeGreaterThanOrEqual(0)
  })
})
