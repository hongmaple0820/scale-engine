// mcpStdio shell-tool narrowing (plan §6 T0 item 2): without it a model can
// route dangerous commands through mcp__scale__shell_run, which the T1
// tool-name map does not cover. Filtering must live in this DSH-only wrapper
// so other MCP clients keep the full tool list.

import { describe, expect, it } from 'vitest'
import { filterShellTools, shouldFilterShellTools } from '../../src/api/mcpStdio.js'

describe('shouldFilterShellTools', () => {
  it('filters by default (no env var)', () => {
    expect(shouldFilterShellTools({})).toBe(true)
  })

  it('restores the full surface with SCALE_MCP_EXPOSE_SHELL=1', () => {
    expect(shouldFilterShellTools({ SCALE_MCP_EXPOSE_SHELL: '1' })).toBe(false)
  })
})

describe('filterShellTools', () => {
  const fullList = () => [
    { name: 'scale_create' },
    { name: 'shell_run' },
    { name: 'shell_plan' },
    { name: 'capability_list' },
  ]

  it('removes shell_run and shell_plan from a tools/list result', () => {
    const result = { tools: fullList() }
    const removed = filterShellTools(result, {})
    expect(removed).toBe(2)
    expect(result.tools.map(t => t.name)).toEqual(['scale_create', 'capability_list'])
  })

  it('is a no-op when the escape hatch is set', () => {
    const result = { tools: fullList() }
    expect(filterShellTools(result, { SCALE_MCP_EXPOSE_SHELL: '1' })).toBe(0)
    expect(result.tools).toHaveLength(4)
  })

  it('is a no-op when there is no tools array', () => {
    expect(filterShellTools({}, {})).toBe(0)
  })
})
