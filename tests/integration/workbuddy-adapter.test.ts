// WorkBuddy Adapter Tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WorkBuddyAdapter } from '../../src/adapters/WorkBuddyAdapter.js'
import { createAdapter, SUPPORTED_AGENTS } from '../../src/adapters/index.js'
import { Doctor } from '../../src/api/doctor.js'
import { SkillDiscovery } from '../../src/skills/SkillDiscovery.js'
import { rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const TMP = './tmp/test-workbuddy'

describe('WorkBuddyAdapter', () => {
  let adapter: WorkBuddyAdapter

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    adapter = new WorkBuddyAdapter()
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('agentType is workbuddy', () => {
    expect(adapter.agentType).toBe('workbuddy')
  })

  it('generateSettings produces pre-exec/post-exec/before-stop hooks', () => {
    const settings = adapter.generateSettings()
    expect(settings.hooks!['pre-exec']).toHaveLength(2)
    expect(settings.hooks!['post-exec']).toHaveLength(2)
    expect(settings.hooks!['before-stop']).toHaveLength(1)
    for (const entries of Object.values(settings.hooks!)) {
      for (const entry of entries) {
        expect(entry.command).toMatch(/^scale /)
      }
    }
  })

  it('generateSettings includes scale:* permission', () => {
    expect(adapter.generateSettings().permissions!.allow).toContain('scale:*')
  })

  it('mergeSettings preserves existing custom hooks + permissions', () => {
    const existing = {
      hooks: { 'pre-exec': [{ matcher: '', command: 'my-custom' }] },
      permissions: { allow: ['custom:*'] },
    }
    const merged = adapter.mergeSettings(existing)
    expect(merged.hooks!['pre-exec'].some((e) => e.command === 'my-custom')).toBe(true)
    expect(merged.hooks!['pre-exec'].some((e) => e.command.includes('scale '))).toBe(true)
    expect(merged.permissions!.allow).toContain('custom:*')
    expect(merged.permissions!.allow).toContain('scale:*')
  })

  it('generateKnowledgeDoc produces WORKBUDDY.md content', () => {
    const doc = adapter.generateKnowledgeDoc('wb-proj', ['Java'])
    expect(doc).toContain('# wb-proj')
    expect(doc).toContain('Java')
    expect(doc).toContain('SCALE Engine Integration (WorkBuddy)')
  })

  it('init creates .workbuddy/settings.json + WORKBUDDY.md + .scale/ tree', async () => {
    const result = await adapter.init({ projectDir: TMP })
    expect(result.settingsPath).toBe(join(TMP, '.workbuddy', 'settings.json'))
    expect(result.knowledgeDocPath).toBe(join(TMP, 'WORKBUDDY.md'))
    expect(existsSync(result.settingsPath)).toBe(true)
    expect(existsSync(result.knowledgeDocPath)).toBe(true)
    expect(existsSync(join(result.scaleDir, 'events'))).toBe(true)
    const settings = JSON.parse(readFileSync(result.settingsPath, 'utf-8'))
    expect(settings.hooks['before-stop']).toBeDefined()
  })

  it('init is idempotent', async () => {
    await adapter.init({ projectDir: TMP })
    const result2 = await adapter.init({ projectDir: TMP })
    expect(result2.skipped.length).toBeGreaterThan(0)
  })

  it('isInstalled detects existing .workbuddy directory', async () => {
    await adapter.init({ projectDir: TMP })
    expect(adapter.isInstalled()).toBe(true)
    rmSync(join(TMP, '.workbuddy'), { recursive: true, force: true })
    expect(adapter.isInstalled()).toBe(false)
  })
})

describe('createAdapter / SUPPORTED_AGENTS — workbuddy', () => {
  it('createAdapter returns WorkBuddyAdapter for "workbuddy"', () => {
    expect(createAdapter('workbuddy').agentType).toBe('workbuddy')
  })
  it('SUPPORTED_AGENTS includes workbuddy', () => {
    expect(SUPPORTED_AGENTS).toContain('workbuddy')
  })
})

describe('WorkBuddy — Doctor + SkillDiscovery', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
  })
  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('SkillDiscovery.detectPlatform returns workbuddy when .workbuddy/settings.json exists', async () => {
    const adapter = new WorkBuddyAdapter()
    await adapter.init({ projectDir: TMP })
    expect(new SkillDiscovery(TMP).detectPlatform()).toBe('workbuddy')
  })

  it('Doctor reports healthy after scale init --agent workbuddy', async () => {
    const adapter = new WorkBuddyAdapter()
    await adapter.init({ projectDir: TMP })
    const report = await new Doctor(TMP).diagnose()
    expect(report.overall).toBe('healthy')
    expect(report.checks.find((c) => c.name === 'Agent settings')?.message).toContain('workbuddy')
    expect(report.checks.find((c) => c.name === 'Knowledge doc')?.message).toContain('WORKBUDDY.md')
  })
})
