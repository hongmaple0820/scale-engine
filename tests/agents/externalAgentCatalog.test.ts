import { describe, expect, it } from 'vitest'
import { createExternalAgentCatalogPlan, getExternalAgentCatalog, listExternalAgentCatalogs, renderExternalAgentCatalogMarkdown } from '../../src/agents/ExternalAgentCatalog.js'
import { PROFESSIONAL_AGENTS } from '../../src/agents/profiles.js'

describe('external agent catalog', () => {
  it('registers agency-agents-zh metadata without changing built-in profiles', () => {
    const catalog = getExternalAgentCatalog('agency-agents-zh')

    expect(catalog).toBeDefined()
    expect(catalog?.claimedAgentCount).toBe(215)
    expect(catalog?.claimedDepartmentCount).toBe(18)
    expect(catalog?.claimedToolCount).toBe(17)
    expect(catalog?.license).toBe('MIT')
    expect(catalog?.departments).toHaveLength(18)
    expect(catalog?.toolSupport).toHaveLength(17)
    expect(PROFESSIONAL_AGENTS).toHaveLength(12)
  })

  it('maps supported tools to local adapters and keeps unsupported tools external-only', () => {
    const catalog = getExternalAgentCatalog('agency-agents-zh')
    const codex = catalog?.toolSupport.find(tool => tool.toolId === 'codex')
    const gemini = catalog?.toolSupport.find(tool => tool.toolId === 'gemini-cli')
    const copilot = catalog?.toolSupport.find(tool => tool.toolId === 'copilot')

    expect(codex).toMatchObject({ status: 'mapped', localAdapter: 'codex' })
    expect(gemini).toMatchObject({ status: 'mapped', localAdapter: 'gemini' })
    expect(copilot).toMatchObject({ status: 'external-only' })
  })

  it('creates an adoption plan with source and execution gates', () => {
    const plan = createExternalAgentCatalogPlan({
      catalogId: 'agency-agents-zh',
      mode: 'convert-to-yaml',
      tools: ['codex', 'copilot'],
      targetDir: '.scale/test-agents',
    })

    expect(plan.version).toBe('external-agent-catalog-plan-v1')
    expect(plan.targetDir).toBe('.scale/test-agents')
    expect(plan.mappedTools.map(tool => tool.toolId)).toEqual(['codex'])
    expect(plan.externalOnlyTools.map(tool => tool.toolId)).toEqual(['copilot'])
    expect(plan.gates).toEqual(expect.arrayContaining([
      'license-attribution-present',
      'source-revision-pinned',
      'adapter-or-acp-bridge-declared',
      'no-default-profile-count-change',
    ]))
    expect(plan.warnings[0]).toContain('copilot')
  })

  it('renders markdown for CLI output', () => {
    const catalog = listExternalAgentCatalogs()[0]
    const markdown = renderExternalAgentCatalogMarkdown(catalog)

    expect(markdown).toContain('Agency Agents Chinese Expert Team')
    expect(markdown).toContain('215 agents')
    expect(markdown).toContain('codex -> codex')
  })
})
