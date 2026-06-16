import { describe, expect, it } from 'vitest'
import { createAcpCollaborationPlan, renderAcpCollaborationPlanMarkdown } from '../../src/agents/AcpCollaboration.js'

describe('ACP collaboration planning', () => {
  it('creates ACP-first bridges for candidate platforms', () => {
    const plan = createAcpCollaborationPlan({
      task: 'coordinate implementation and verification',
      platforms: ['codex', 'claude-code', 'gemini-cli'],
    })

    expect(plan.version).toBe('acp-collaboration-plan-v1')
    expect(plan.strategy).toBe('acp-first-with-adapter-fallback')
    expect(plan.bridges).toHaveLength(3)
    expect(plan.bridges.map(bridge => bridge.executionMode)).toEqual([
      'acp-subprocess',
      'acp-subprocess',
      'acp-subprocess',
    ])
    expect(plan.bridges[2]).toMatchObject({ platform: 'gemini', transport: 'stdio-json-rpc' })
  })

  it('falls back to local adapters or manual bridge warnings', () => {
    const plan = createAcpCollaborationPlan({
      task: 'coordinate product module generation',
      platforms: ['cursor', 'opencode', 'copilot'],
    })

    expect(plan.bridges[0]).toMatchObject({ platform: 'cursor', acpStatus: 'adapter-only', executionMode: 'scale-adapter' })
    expect(plan.bridges[1]).toMatchObject({ platform: 'opencode', acpStatus: 'adapter-only' })
    expect(plan.bridges[2]).toMatchObject({ requestedPlatform: 'copilot', acpStatus: 'external-only', executionMode: 'manual-bridge' })
    expect(plan.warnings[0]).toContain('copilot')
  })

  it('renders a human-readable plan', () => {
    const markdown = renderAcpCollaborationPlanMarkdown(createAcpCollaborationPlan({
      task: 'run a multi-agent review',
      platforms: ['codex'],
    }))

    expect(markdown).toContain('# ACP Collaboration Plan')
    expect(markdown).toContain('verification-evidence-attached')
    expect(markdown).toContain('codex')
  })
})
