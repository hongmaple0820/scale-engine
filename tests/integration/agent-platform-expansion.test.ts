import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Doctor } from '../../src/api/doctor.js'
import {
  AntigravityAdapter,
  ClineAdapter,
  JCodeAdapter,
  KiloCodeAdapter,
  KiroAdapter,
  QoderAdapter,
  SUPPORTED_AGENTS,
  WindsurfAdapter,
  createAdapter,
  type IAgentAdapter,
} from '../../src/adapters/index.js'
import { SkillDiscovery } from '../../src/skills/SkillDiscovery.js'
import type { AgentPlatform } from '../../src/artifact/types.js'
import { safeRmSync } from '../helpers/fs.js'

let TMP: string

interface PlatformCase {
  platform: AgentPlatform
  create: () => IAgentAdapter
  settingsSuffix: string
  knowledgeSuffix: string
  knowledgeNeedle: string
}

const cases: PlatformCase[] = [
  { platform: 'qoder', create: () => new QoderAdapter(), settingsSuffix: '.qoder/settings.json', knowledgeSuffix: '.qoder/rules/SCALE.md', knowledgeNeedle: 'SCALE Engine Integration (Qoder)' },
  { platform: 'jcode', create: () => new JCodeAdapter(), settingsSuffix: '.jcode/settings.json', knowledgeSuffix: 'JCODE.md', knowledgeNeedle: 'SCALE Engine Integration (JCode)' },
  { platform: 'kiro', create: () => new KiroAdapter(), settingsSuffix: '.kiro/settings.json', knowledgeSuffix: '.kiro/rules/SCALE.md', knowledgeNeedle: 'SCALE Engine Integration (Kiro)' },
  { platform: 'windsurf', create: () => new WindsurfAdapter(), settingsSuffix: '.windsurf/settings.json', knowledgeSuffix: '.windsurf/rules.md', knowledgeNeedle: 'SCALE Engine Integration (Windsurf)' },
  { platform: 'cline', create: () => new ClineAdapter(), settingsSuffix: '.cline/settings.json', knowledgeSuffix: '.clinerules/SCALE.md', knowledgeNeedle: 'SCALE Engine Integration (Cline)' },
  { platform: 'kilocode', create: () => new KiloCodeAdapter(), settingsSuffix: '.kilocode/settings.json', knowledgeSuffix: 'AGENTS.md', knowledgeNeedle: 'SCALE Engine Integration (Kilo Code)' },
  { platform: 'antigravity', create: () => new AntigravityAdapter(), settingsSuffix: '.agents/hooks.json', knowledgeSuffix: '.agents/rules/SCALE.md', knowledgeNeedle: 'SCALE Engine Integration (Antigravity)' },
]

describe('expanded agent platform adapters', () => {
  beforeEach(() => {
    TMP = mkdtempSync(join(tmpdir(), 'scale-agent-platform-expansion-'))
  })

  afterEach(() => {
    safeRmSync(TMP)
  })

  it.each(cases)('initializes $platform with settings, knowledge, skills, doctor, and discovery support', async ({ platform, create, settingsSuffix, knowledgeSuffix, knowledgeNeedle }) => {
    const adapter = create()

    expect(adapter.agentType).toBe(platform)
    expect(adapter.getSettingsPath().replace(/\\/g, '/')).toMatch(new RegExp(`${settingsSuffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
    expect(adapter.getKnowledgeDocPath().replace(/\\/g, '/')).toMatch(new RegExp(`${knowledgeSuffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))

    const result = await adapter.init({ projectDir: TMP })
    expect(existsSync(result.settingsPath)).toBe(true)
    expect(existsSync(result.knowledgeDocPath)).toBe(true)
    expect(existsSync(adapter.getSkillsDir())).toBe(true)
    expect(readFileSync(result.knowledgeDocPath, 'utf-8')).toContain(knowledgeNeedle)
    expect(JSON.stringify(JSON.parse(readFileSync(result.settingsPath, 'utf-8')))).toContain('scale ')

    expect(createAdapter(platform).agentType).toBe(platform)
    expect(SUPPORTED_AGENTS).toContain(platform)
    expect(new SkillDiscovery(TMP).detectPlatform()).toBe(platform)

    const report = await new Doctor(TMP).diagnose()
    expect(report.overall).toBe('healthy')
    expect(report.checks.find(check => check.name === 'Agent settings')?.message).toContain(platform)
    expect(report.checks.find(check => check.name === 'Knowledge doc')?.status).toBe('ok')
  })
})
