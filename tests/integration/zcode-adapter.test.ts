// ZCode Adapter Tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ZCodeAdapter } from '../../src/adapters/ZCodeAdapter.js'
import { createAdapter, SUPPORTED_AGENTS } from '../../src/adapters/index.js'
import { Doctor } from '../../src/api/doctor.js'
import { SkillDiscovery } from '../../src/skills/SkillDiscovery.js'
import { rmSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const TMP = './tmp/test-zcode'

describe('ZCodeAdapter', () => {
  let adapter: ZCodeAdapter

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    adapter = new ZCodeAdapter()
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('agentType is zcode', () => {
    expect(adapter.agentType).toBe('zcode')
  })

  it('paths follow the ZCode workspace layout', async () => {
    await adapter.init({ projectDir: TMP })
    expect(adapter.getSettingsPath()).toBe(join(TMP, '.zcode', 'config.json'))
    expect(adapter.getKnowledgeDocPath()).toBe(join(TMP, 'AGENTS.md'))
    expect(adapter.getSkillsDir()).toBe(join(TMP, '.zcode', 'skills'))
  })

  it('generateSettings produces the ZCode nested events schema with enabled: true', () => {
    const settings = adapter.generateSettings() as unknown as ReturnType<ZCodeAdapter['buildZCodeSettings']>
    expect(settings.hooks.enabled).toBe(true)
    for (const event of ['SessionStart', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'PostToolUseFailure', 'Stop']) {
      expect(settings.hooks.events[event]).toBeDefined()
    }
    for (const groups of Object.values(settings.hooks.events)) {
      for (const group of groups) {
        expect(typeof group.matcher).toBe('string')
        for (const hook of group.hooks) {
          expect(hook.type).toBe('command')
          expect(hook.command).toMatch(/^scale /)
        }
      }
    }
  })

  it('generateSettings includes scale:* permission', () => {
    expect(adapter.generateSettings().permissions!.allow).toContain('scale:*')
  })

  it('mergeSettings preserves custom event groups + permissions, and forces enabled: true', () => {
    const existing = {
      hooks: {
        enabled: false,
        events: {
          PreToolUse: [{ matcher: '^Bash$', hooks: [{ type: 'command', command: 'my-custom' }] }],
        },
      },
      permissions: { allow: ['custom:*'] },
    }
    const merged = adapter.mergeSettings(existing) as unknown as ReturnType<ZCodeAdapter['buildZCodeSettings']>
    expect(merged.hooks.enabled).toBe(true)
    const bashGroups = merged.hooks.events.PreToolUse.filter((g) => g.matcher === '^Bash$')
    expect(bashGroups.some((g) => g.hooks.some((h) => h.command === 'my-custom'))).toBe(true)
    expect(bashGroups.some((g) => g.hooks.some((h) => h.command.includes('scale gate')))).toBe(true)
    expect(merged.permissions!.allow).toContain('custom:*')
    expect(merged.permissions!.allow).toContain('scale:*')
  })

  it('mergeSettings preserves unrelated config keys (mcp.servers)', () => {
    const existing = {
      mcpServers: { files: { command: 'mcp-server-files' } },
      hooks: { enabled: true, events: {} },
    }
    const merged = adapter.mergeSettings(existing) as unknown as typeof existing
    expect(merged.mcpServers).toEqual(existing.mcpServers)
  })

  it('mergeSettings is idempotent for SCALE hooks', () => {
    const first = adapter.mergeSettings({} as never)
    const second = adapter.mergeSettings(first)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('generateKnowledgeDoc contains the SCALE section', () => {
    const doc = adapter.generateKnowledgeDoc('zc-proj', ['TypeScript'])
    expect(doc).toContain('# zc-proj')
    expect(doc).toContain('TypeScript')
    expect(doc).toContain('SCALE Engine Integration (ZCode)')
  })

  it('mergeKnowledgeDocContent preserves user content and is idempotent', () => {
    const section = adapter.generateKnowledgeDoc('zc-proj')
    const existing = '# My Project\n\nUser rules here.\n'
    const once = adapter.mergeKnowledgeDocContent(existing, section)
    expect(once).toContain('User rules here.')
    expect(once).toContain('<!-- SCALE:BEGIN -->')
    expect(once).toContain('<!-- SCALE:END -->')
    const twice = adapter.mergeKnowledgeDocContent(once, section)
    expect(twice).toBe(once)
  })

  it('init creates .zcode/config.json + AGENTS.md + .scale/ tree', async () => {
    const result = await adapter.init({ projectDir: TMP })
    expect(result.settingsPath).toBe(join(TMP, '.zcode', 'config.json'))
    expect(result.knowledgeDocPath).toBe(join(TMP, 'AGENTS.md'))
    expect(existsSync(result.settingsPath)).toBe(true)
    expect(existsSync(result.knowledgeDocPath)).toBe(true)
    expect(existsSync(join(result.scaleDir, 'events'))).toBe(true)
    const settings = JSON.parse(readFileSync(result.settingsPath, 'utf-8'))
    expect(settings.hooks.enabled).toBe(true)
    expect(settings.hooks.events.Stop).toBeDefined()
  })

  it('init merges into an existing config.json without losing unrelated keys', async () => {
    const configPath = join(TMP, '.zcode', 'config.json')
    mkdirSync(join(TMP, '.zcode'), { recursive: true })
    writeFileSync(configPath, JSON.stringify({
      mcpServers: { files: { command: 'mcp-server-files' } },
      hooks: { enabled: false, events: {} },
    }, null, 2))
    await adapter.init({ projectDir: TMP })
    const settings = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(settings.mcpServers).toEqual({ files: { command: 'mcp-server-files' } })
    expect(settings.hooks.enabled).toBe(true)
    expect(settings.hooks.events.PreToolUse).toBeDefined()
  })

  it('init appends the SCALE section to an existing AGENTS.md and preserves content', async () => {
    writeFileSync(join(TMP, 'AGENTS.md'), '# My Project\n\nUser rules here.\n')
    await adapter.init({ projectDir: TMP })
    const doc = readFileSync(join(TMP, 'AGENTS.md'), 'utf-8')
    expect(doc).toContain('# My Project')
    expect(doc).toContain('User rules here.')
    expect(doc).toContain('<!-- SCALE:BEGIN -->')
  })

  it('init is idempotent', async () => {
    await adapter.init({ projectDir: TMP })
    const before = readFileSync(join(TMP, 'AGENTS.md'), 'utf-8')
    const result2 = await adapter.init({ projectDir: TMP })
    expect(result2.skipped.length).toBeGreaterThan(0)
    expect(readFileSync(join(TMP, 'AGENTS.md'), 'utf-8')).toBe(before)
  })

  it('isInstalled detects existing .zcode/config.json', async () => {
    await adapter.init({ projectDir: TMP })
    expect(adapter.isInstalled()).toBe(true)
    rmSync(join(TMP, '.zcode'), { recursive: true, force: true })
    expect(adapter.isInstalled()).toBe(false)
  })
})

describe('createAdapter / SUPPORTED_AGENTS — zcode', () => {
  it('createAdapter returns ZCodeAdapter for "zcode"', () => {
    expect(createAdapter('zcode').agentType).toBe('zcode')
  })
  it('SUPPORTED_AGENTS includes zcode', () => {
    expect(SUPPORTED_AGENTS).toContain('zcode')
  })
})

describe('ZCode — Doctor + SkillDiscovery', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
  })
  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('SkillDiscovery.detectPlatform returns zcode when .zcode/config.json exists', async () => {
    const adapter = new ZCodeAdapter()
    await adapter.init({ projectDir: TMP })
    expect(new SkillDiscovery(TMP).detectPlatform()).toBe('zcode')
  })

  it('Doctor reports healthy after scale init --agent zcode', async () => {
    const adapter = new ZCodeAdapter()
    await adapter.init({ projectDir: TMP })
    const report = await new Doctor(TMP).diagnose()
    expect(report.overall).toBe('healthy')
    expect(report.checks.find((c) => c.name === 'Agent settings')?.message).toContain('zcode')
    expect(report.checks.find((c) => c.name === 'Knowledge doc')?.message).toContain('AGENTS.md')
  })
})
