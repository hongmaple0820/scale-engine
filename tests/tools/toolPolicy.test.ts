import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOOL_POLICY,
  requiredToolsForDomains,
  resolveToolPolicy,
  toolPolicyTemplate,
} from '../../src/tools/ToolPolicy.js'

describe('ToolPolicy', () => {
  it('defaults to evidence-required mode and maps domains to required tools', () => {
    const policy = resolveToolPolicy(null)

    expect(policy.mode).toBe('evidence-required')
    expect(policy.tools['web-access']).toMatchObject({
      enabled: true,
      requiredFor: ['webResearch'],
    })
    const required = requiredToolsForDomains(policy, ['webResearch', 'ui']).map(tool => tool.id)
    expect(required).toEqual(expect.arrayContaining([
      'web-access',
      'impeccable',
    ]))
    expect(requiredToolsForDomains(policy, ['ui']).map(tool => tool.id)).toEqual(['impeccable'])
    expect(policy.tools['taste-skill'].recommendedFor).toContain('ui')
    expect(policy.tools['awesome-design-md'].recommendedFor).toContain('ui')
    expect(policy.tools['ui-ux-pro-max'].recommendedFor).toContain('ui')
    expect(policy.tools['desktop-cua']).toMatchObject({
      enabled: true,
      destructiveActions: 'confirm',
    })
    expect(policy.tools['codex-cli'].enabled).toBe(true)
    expect(policy.tools['gemini-cli'].enabled).toBe(true)
    expect(policy.tools['opencode-cli'].enabled).toBe(true)
  })

  it('merges project policy overrides without losing default tool contracts', () => {
    const policy = resolveToolPolicy({
      version: 1,
      mode: 'block',
      tools: {
        'agent-browser': {
          enabled: false,
          requiredFor: ['browserAutomation'],
          destructiveActions: 'block',
        },
      },
    })

    expect(policy.mode).toBe('block')
    expect(policy.tools['web-access']).toEqual(DEFAULT_TOOL_POLICY.tools['web-access'])
    expect(policy.tools['agent-browser']).toMatchObject({
      enabled: false,
      requiredFor: ['browserAutomation'],
      destructiveActions: 'block',
    })
  })

  it('renders a stable starter tools.json template', () => {
    const parsed = JSON.parse(toolPolicyTemplate('advisory')) as { mode: string; tools: Record<string, unknown> }

    expect(parsed.mode).toBe('advisory')
    expect(parsed.tools).toHaveProperty('web-access')
    expect(parsed.tools).toHaveProperty('agent-browser')
    expect(parsed.tools).toHaveProperty('desktop-cua')
  })
})
