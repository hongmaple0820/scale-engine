// SCALE Engine — External Skills Integration Tests

import { describe, it, expect, beforeEach } from 'vitest'
import { SkillRegistry } from '../../src/skills/SkillRegistry.js'
import { registerExternalSkills } from '../../src/skills/ExternalSkills.js'
import { EventBus } from '../../src/core/eventBus.js'

describe('External Skills Integration', () => {
  let registry: SkillRegistry
  let eventBus: EventBus

  beforeEach(() => {
    eventBus = new EventBus()
    registry = new SkillRegistry(eventBus)
    registerExternalSkills(registry, eventBus)
  })

  it('should register workflow official and ecosystem skills', () => {
    const all = registry.listAll()
    expect(all.length).toBe(34)
    expect(all.map(skill => skill.id)).toEqual(expect.arrayContaining([
      'impeccable',
      'taste-skill',
      'frontend-design',
      'webapp-testing',
      'liteparse',
      'd2-diagram',
      'opensquilla',
      'code-reviewer',
      'fix',
      'pr-creator',
      'update-docs',
      'find-skills',
      'fullstack-developer',
    ]))
  })

  it('should have graphify installed', () => {
    const skill = registry.get('graphify')
    expect(skill).toBeDefined()
    expect(skill?.installed).toBe(true)
    expect(skill?.domain).toBe('context')
  })

  it('should have awesome-design-md installed', () => {
    const skill = registry.get('awesome-design-md')
    expect(skill).toBeDefined()
    expect(skill?.installed).toBe(true)
    expect(skill?.source).toBe('https://github.com/VoltAgent/awesome-design-md')
  })

  it('should have ui-ux-pro-max installed', () => {
    const skill = registry.get('ui-ux-pro-max')
    expect(skill).toBeDefined()
    expect(skill?.installed).toBe(true)
    expect(skill?.source).toBe('https://github.com/nextlevelbuilder/ui-ux-pro-max-skill')
  })

  it('should have web-access installed', () => {
    const skill = registry.get('web-access')
    expect(skill).toBeDefined()
    expect(skill?.installed).toBe(true)
    expect(skill?.priority).toBe(90)
    expect(skill?.source).toBe('https://github.com/eze-is/web-access')
  })

  it('registers optional browser automation and desktop tool adapters', () => {
    expect(registry.get('agent-browser')).toMatchObject({
      installed: false,
      source: 'https://github.com/vercel-labs/agent-browser',
    })
    expect(registry.get('mcp-chrome-devtools')).toMatchObject({
      installed: false,
      domain: 'verification',
    })
    expect(registry.get('cua')).toMatchObject({
      installed: false,
      source: 'https://github.com/trycua/cua',
    })
  })

  it('registers external agent CLI adapters as explicit optional tools', () => {
    expect(registry.get('codex-cli')).toMatchObject({ installed: false, domain: 'verification' })
    expect(registry.get('gemini-cli')).toMatchObject({ installed: false, domain: 'verification' })
    expect(registry.get('opencode-cli')).toMatchObject({ installed: false, domain: 'verification' })
  })

  it('should have playwright installed', () => {
    const skill = registry.get('playwright')
    expect(skill).toBeDefined()
    expect(skill?.installed).toBe(true)
  })

  it('should have playwright-interactive installed', () => {
    const skill = registry.get('playwright-interactive')
    expect(skill).toBeDefined()
    expect(skill?.domain).toBe('verification')
  })

  it('should have cua not installed by default', () => {
    const skill = registry.get('cua')
    expect(skill).toBeDefined()
    expect(skill?.installed).toBe(false)
    expect(skill?.priority).toBe(90)
  })

  it('should recommend web-access for web-scraping task', () => {
    const recommendations = registry.recommend({
      taskType: 'web-scraping',
      keywords: ['browser', 'login'],
    })
    expect(recommendations.length).toBeGreaterThan(0)
    expect(recommendations[0].skillId).toBe('web-access')
  })

  it('should recommend playwright for e2e-testing task', () => {
    const recommendations = registry.recommend({
      taskType: 'e2e-testing',
      phase: 'verify',
    })
    expect(recommendations.length).toBeGreaterThan(0)
    expect(recommendations.some(r => r.skillId === 'playwright')).toBe(true)
  })

  it('should recommend frontend-design for UI design tasks', () => {
    expect(registry.listAll()[0].id).toBe('impeccable')
    registry.setInstalled('impeccable', true)
    registry.setInstalled('taste-skill', true)

    const recommendations = registry.recommend({
      taskType: 'ui-design',
      phase: 'plan',
      keywords: ['frontend', 'visual', 'responsive'],
    })

    expect(recommendations.some(r => r.skillId === 'impeccable')).toBe(true)
    expect(recommendations.some(r => r.skillId === 'taste-skill')).toBe(true)
    expect(recommendations.some(r => r.skillId === 'frontend-design')).toBe(true)
  })

  it('should recommend document parsing, diagramming, and orchestration ecosystem skills', () => {
    registry.setInstalled('liteparse', true)
    registry.setInstalled('d2-diagram', true)
    registry.setInstalled('opensquilla', true)

    expect(registry.recommend({
      taskType: 'document-parsing',
      keywords: ['pdf', 'ocr'],
    }).some(r => r.skillId === 'liteparse')).toBe(true)

    expect(registry.recommend({
      taskType: 'architecture-diagram',
      phase: 'plan',
      keywords: ['d2', 'diagram'],
    }).some(r => r.skillId === 'd2-diagram')).toBe(true)

    expect(registry.recommend({
      taskType: 'agent-orchestration',
      keywords: ['metaskill', 'routing'],
    }).some(r => r.skillId === 'opensquilla')).toBe(true)
  })

  it('should recommend code-reviewer for review tasks', () => {
    const recommendations = registry.recommend({
      taskType: 'code-review',
      phase: 'verify',
      keywords: ['review', 'critical', 'pull request'],
    })

    expect(recommendations.some(r => r.skillId === 'code-reviewer')).toBe(true)
  })
})
