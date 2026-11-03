// OpenClaw Adapter Tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { OpenClawAdapter } from '../../src/adapters/OpenClawAdapter.js'
import { createAdapter, SUPPORTED_AGENTS } from '../../src/adapters/index.js'
import { Doctor } from '../../src/api/doctor.js'
import { SkillDiscovery } from '../../src/skills/SkillDiscovery.js'
import { rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const TMP = './tmp/test-openclaw'

describe('OpenClawAdapter', () => {
  let adapter: OpenClawAdapter

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    mkdirSync(TMP, { recursive: true })
    adapter = new OpenClawAdapter()
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('agentType is openclaw', () => {
    expect(adapter.agentType).toBe('openclaw')
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

  it('generateKnowledgeDoc produces AGENTS.md content', () => {
    const doc = adapter.generateKnowledgeDoc('my-openclaw-project', ['Go', 'gRPC'])
    expect(doc).toContain('# my-openclaw-project')
    expect(doc).toContain('Go')
    expect(doc).toContain('gRPC')
    expect(doc).toContain('SCALE Engine Integration (OpenClaw)')
    expect(doc).toContain('scale create')
  })

  it('init creates .openclaw/settings.json + AGENTS.md + .scale/ tree', async () => {
    const result = await adapter.init({ projectDir: TMP })
    expect(result.settingsPath).toBe(join(TMP, '.openclaw', 'settings.json'))
    expect(result.knowledgeDocPath).toBe(join(TMP, 'AGENTS.md'))

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

  it('isInstalled detects existing .openclaw directory', async () => {
    expect(adapter.isInstalled()).toBe(false)
    await adapter.init({ projectDir: TMP })
    const sameAdapter = new OpenClawAdapter()
    await sameAdapter.init({ projectDir: TMP })
    expect(sameAdapter.isInstalled()).toBe(true)
  })
})

describe('createAdapter / SUPPORTED_AGENTS — openclaw', () => {
  it('createAdapter returns OpenClawAdapter for "openclaw"', () => {
    const adapter = createAdapter('openclaw')
    expect(adapter.agentType).toBe('openclaw')
  })

  it('SUPPORTED_AGENTS includes openclaw', () => {
    expect(SUPPORTED_AGENTS).toContain('openclaw')
  })
})

describe('SkillDiscovery — openclaw platform', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    mkdirSync(TMP, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('detectPlatform returns openclaw when .openclaw/settings.json exists', async () => {
    const adapter = new OpenClawAdapter()
    await adapter.init({ projectDir: TMP })
    const discovery = new SkillDiscovery(TMP)
    expect(discovery.detectPlatform()).toBe('openclaw')
  })

  it('scanSkills returns empty (openclaw has no skills dir)', () => {
    const discovery = new SkillDiscovery(TMP)
    const result = discovery.scanSkills('openclaw')
    expect(result.platform).toBe('openclaw')
    expect(result.skills).toHaveLength(0)
    expect(result.exists).toBe(false)
  })
})

describe('Doctor — openclaw-aware', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    mkdirSync(TMP, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('reports healthy after scale init --agent openclaw', async () => {
    const adapter = new OpenClawAdapter()
    await adapter.init({ projectDir: TMP })
    const doc = new Doctor(TMP)
    const report = await doc.diagnose()
    expect(report.overall).toBe('healthy')
    // Core checks should all be ok (optional checks like Python/Graphify may be warn)
    expect(report.checks.filter((c) => !c.optional).every((c) => c.status === 'ok')).toBe(true)
  })

  it('Agent settings check identifies openclaw platform', async () => {
    const adapter = new OpenClawAdapter()
    await adapter.init({ projectDir: TMP })
    const doc = new Doctor(TMP)
    const report = await doc.diagnose()
    const settingsCheck = report.checks.find((c) => c.name === 'Agent settings')
    expect(settingsCheck?.status).toBe('ok')
    expect(settingsCheck?.message).toContain('openclaw')
  })

  it('Knowledge doc check finds AGENTS.md', async () => {
    const adapter = new OpenClawAdapter()
    await adapter.init({ projectDir: TMP })
    const doc = new Doctor(TMP)
    const report = await doc.diagnose()
    const kdCheck = report.checks.find((c) => c.name === 'Knowledge doc')
    expect(kdCheck?.status).toBe('ok')
    expect(kdCheck?.message).toContain('AGENTS.md')
  })
})
