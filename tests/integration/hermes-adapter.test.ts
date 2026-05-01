// Hermes Adapter Tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { HermesAdapter } from '../../src/adapters/HermesAdapter.js'
import { createAdapter, SUPPORTED_AGENTS } from '../../src/adapters/index.js'
import { Doctor } from '../../src/api/doctor.js'
import { SkillDiscovery } from '../../src/skills/SkillDiscovery.js'
import { rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const TMP = './tmp/test-hermes'

describe('HermesAdapter', () => {
  let adapter: HermesAdapter

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    adapter = new HermesAdapter()
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('agentType is hermes', () => {
    expect(adapter.agentType).toBe('hermes')
  })

  it('generateSettings produces pre-exec/post-exec/before-stop hooks', () => {
    const settings = adapter.generateSettings()
    expect(settings.hooks).toBeDefined()
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
    const settings = adapter.generateSettings()
    expect(settings.permissions!.allow).toContain('scale:*')
  })

  it('mergeSettings adds SCALE hooks without overwriting existing', () => {
    const existing = {
      hooks: {
        'pre-exec': [{ matcher: '', command: 'my-custom-check' }],
      },
      permissions: { allow: ['custom:*'] },
    }
    const merged = adapter.mergeSettings(existing)
    expect(merged.hooks!['pre-exec'].some((e) => e.command === 'my-custom-check')).toBe(true)
    expect(merged.hooks!['pre-exec'].some((e) => e.command.includes('scale '))).toBe(true)
    expect(merged.hooks!['before-stop']).toBeDefined()
    expect(merged.permissions!.allow).toContain('custom:*')
    expect(merged.permissions!.allow).toContain('scale:*')
  })

  it('generateKnowledgeDoc produces .hermes.md content', () => {
    const doc = adapter.generateKnowledgeDoc('my-hermes-project', ['Rust', 'WASM'])
    expect(doc).toContain('# my-hermes-project')
    expect(doc).toContain('Rust')
    expect(doc).toContain('WASM')
    expect(doc).toContain('SCALE Engine Integration (Hermes)')
    expect(doc).toContain('scale create')
  })

  it('init creates .hermes/settings.json + .hermes.md + .scale/ tree', async () => {
    const result = await adapter.init({ projectDir: TMP })
    expect(result.settingsPath).toBe(join(TMP, '.hermes', 'settings.json'))
    expect(result.knowledgeDocPath).toBe(join(TMP, '.hermes.md'))

    expect(existsSync(result.settingsPath)).toBe(true)
    expect(existsSync(result.knowledgeDocPath)).toBe(true)
    expect(existsSync(join(result.scaleDir, 'events'))).toBe(true)
    expect(existsSync(join(result.scaleDir, 'artifacts'))).toBe(true)
    expect(existsSync(join(result.scaleDir, 'rules'))).toBe(true)
    expect(existsSync(join(result.scaleDir, 'hooks'))).toBe(true)
    expect(existsSync(join(result.scaleDir, 'checkpoints'))).toBe(true)
    expect(existsSync(join(result.scaleDir, '.gitignore'))).toBe(true)

    const settings = JSON.parse(readFileSync(result.settingsPath, 'utf-8'))
    expect(settings.hooks['pre-exec']).toBeDefined()
    expect(settings.hooks['before-stop']).toBeDefined()
  })

  it('init is idempotent — second call merges, does not overwrite', async () => {
    await adapter.init({ projectDir: TMP })
    const result2 = await adapter.init({ projectDir: TMP })
    expect(result2.skipped.length).toBeGreaterThan(0)
    const settings = JSON.parse(readFileSync(result2.settingsPath, 'utf-8'))
    expect(settings.hooks['pre-exec']).toBeDefined()
  })

  it('isInstalled detects existing .hermes directory', async () => {
    expect(adapter.isInstalled()).toBe(false)
    await adapter.init({ projectDir: TMP })
    const sameAdapter = new HermesAdapter()
    await sameAdapter.init({ projectDir: TMP })
    expect(sameAdapter.isInstalled()).toBe(true)
  })
})

describe('createAdapter / SUPPORTED_AGENTS — hermes', () => {
  it('createAdapter returns HermesAdapter for "hermes"', () => {
    const adapter = createAdapter('hermes')
    expect(adapter.agentType).toBe('hermes')
  })

  it('SUPPORTED_AGENTS includes hermes', () => {
    expect(SUPPORTED_AGENTS).toContain('hermes')
  })
})

describe('SkillDiscovery — hermes platform', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('detectPlatform returns hermes when .hermes/settings.json exists', async () => {
    const adapter = new HermesAdapter()
    await adapter.init({ projectDir: TMP })
    const discovery = new SkillDiscovery(TMP)
    expect(discovery.detectPlatform()).toBe('hermes')
  })

  it('scanSkills returns empty (hermes has no skills dir)', () => {
    const discovery = new SkillDiscovery(TMP)
    const result = discovery.scanSkills('hermes')
    expect(result.platform).toBe('hermes')
    expect(result.skills).toHaveLength(0)
    expect(result.exists).toBe(false)
  })
})

describe('Doctor — hermes-aware', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('reports healthy after scale init --agent hermes', async () => {
    const adapter = new HermesAdapter()
    await adapter.init({ projectDir: TMP })
    const doc = new Doctor(TMP)
    const report = await doc.diagnose()
    expect(report.overall).toBe('healthy')
    expect(report.checks.every((c) => c.status === 'ok')).toBe(true)
  })

  it('Agent settings check identifies hermes platform', async () => {
    const adapter = new HermesAdapter()
    await adapter.init({ projectDir: TMP })
    const doc = new Doctor(TMP)
    const report = await doc.diagnose()
    const settingsCheck = report.checks.find((c) => c.name === 'Agent settings')
    expect(settingsCheck?.status).toBe('ok')
    expect(settingsCheck?.message).toContain('hermes')
  })

  it('Knowledge doc check finds .hermes.md', async () => {
    const adapter = new HermesAdapter()
    await adapter.init({ projectDir: TMP })
    const doc = new Doctor(TMP)
    const report = await doc.diagnose()
    const kdCheck = report.checks.find((c) => c.name === 'Knowledge doc')
    expect(kdCheck?.status).toBe('ok')
    expect(kdCheck?.message).toContain('.hermes.md')
  })
})
