// dsh-scale shieldBridge — the mapping assertions the plan marks as
// mandatory (plan §6 T1.1): without them Shield in DSH silently allows
// everything (R3: pwsh/write/edit never match the Bash/Write/Edit branches).

import { describe, expect, it } from 'vitest'
import { evaluateShield, resolveProjectDir, toShieldInput } from '../../packages/dsh-scale/src/shieldBridge.js'

describe('toShieldInput — DSH tool name mapping', () => {
  it('maps pwsh/write/edit/read to SCALE names', () => {
    expect(toShieldInput({ name: 'pwsh' }, '/proj').tool_name).toBe('Bash')
    expect(toShieldInput({ name: 'write' }, '/proj').tool_name).toBe('Write')
    expect(toShieldInput({ name: 'edit' }, '/proj').tool_name).toBe('Edit')
    expect(toShieldInput({ name: 'read' }, '/proj').tool_name).toBe('Read')
  })

  it('passes unknown tool names through unchanged', () => {
    expect(toShieldInput({ name: 'web_search' }, '/proj').tool_name).toBe('web_search')
  })

  it('unpacks mcp__scale__ prefix; shell_run takes Bash semantics (T0 escape-hatch fallback)', () => {
    const input = toShieldInput(
      { name: 'mcp__scale__shell_run', arguments: { command: 'rm -rf /' } },
      '/proj',
    )
    expect(input.tool_name).toBe('Bash')
    // and it actually blocks through the full decision path
    expect(evaluateShield(input).kind).toBe('deny')
  })

  it('unpacks other mcp__scale__ tools to their raw name', () => {
    expect(toShieldInput({ name: 'mcp__scale__task_create' }, '/proj').tool_name).toBe('task_create')
  })

  it('carries session id and cwd into the shield input', () => {
    const input = toShieldInput({ name: 'pwsh', agent: { id: 'agent-1' } }, '/proj')
    expect(input.session_id).toBe('agent-1')
    expect(input.cwd).toBe('/proj')
    expect(input.tool_input).toEqual({})
  })
})

describe('evaluateShield — decision mapping (plan T1.1 acceptance)', () => {
  it('BLOCK: pwsh recursive force delete → deny with reason', () => {
    // POSIX form — `rm` is a pwsh alias for Remove-Item; the blocklist's
    // /\brm\s+-rf\b/ pattern matches this, while native `Remove-Item` syntax
    // does not (existing Shield gap, noted in the plugin README)
    const decision = evaluateShield({
      session_id: 's',
      cwd: '/proj',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /tmp/x' },
    })
    expect(decision.kind).toBe('deny')
    expect(decision.reason).toBeTruthy()
  })

  it('BLOCK: write to .scale/policy.yaml → deny (protected path)', () => {
    const decision = evaluateShield({
      session_id: 's',
      cwd: '/proj',
      tool_name: 'Write',
      tool_input: { file_path: '.scale/policy.yaml', content: 'x' },
    })
    expect(decision.kind).toBe('deny')
  })

  it('ALLOW: read of a protected path stays read-only allowed', () => {
    const decision = evaluateShield({
      session_id: 's',
      cwd: '/proj',
      tool_name: 'Read',
      tool_input: { file_path: '.scale/policy.yaml' },
    })
    expect(decision.kind).toBe('allow')
  })

  it('ALLOW: harmless shell command passes with no false positive', () => {
    const decision = evaluateShield({
      session_id: 's',
      cwd: '/proj',
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' },
    })
    expect(decision.kind).toBe('allow')
  })

  it('WARN: destructive-adjacent command maps to ask, never silent allow (review gap fix)', () => {
    const decision = evaluateShield({
      session_id: 's',
      cwd: '/proj',
      tool_name: 'Bash',
      tool_input: { command: 'git checkout -- src/' },
    })
    expect(decision.kind).toBe('ask')
    expect(decision.displayReason?.en).toContain('[SCALE SHIELD WARN]')
    expect(decision.displayReason?.zh).toContain('【SCALE 盾警告】')
  })
})

describe('resolveProjectDir — per-execution resolution (R4)', () => {
  it('prefers explicit config projectDir', () => {
    expect(resolveProjectDir({ projectDir: '/cfg' }, { agent: { session: { header: { cwd: '/session' } } } })).toBe('/cfg')
  })

  it('falls back to the session cwd, then process cwd', () => {
    expect(resolveProjectDir({}, { agent: { session: { header: { cwd: '/session' } } } })).toBe('/session')
    expect(resolveProjectDir({}, {})).toBe(process.cwd())
  })
})
