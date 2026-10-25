// Shield rule-source convergence — the generated hook script must embed the
// exact rule set from ProtectedPaths (the 31-vs-18 divergence was a governance
// debt: hook mode silently blocked fewer/different commands than function mode).

import { describe, expect, it } from 'vitest'
import { PolicyCompiler, DEFAULT_POLICY } from '../../src/shield/PolicyCompiler.js'
import {
  checkCommand,
  checkToolInput,
  checkWarnHits,
  getCommandRules,
  serializeCommandRules,
} from '../../src/shield/ProtectedPaths.js'

function generatedPreToolScript(): string {
  const compiler = new PolicyCompiler()
  const method = (compiler as unknown as {
    generateCombinedPreToolScript?: (policy: unknown) => string
  }).generateCombinedPreToolScript
  if (typeof method !== 'function') {
    throw new Error('generateCombinedPreToolScript not found — update this test to the current compiler entrypoint')
  }
  return method.call(compiler, DEFAULT_POLICY)
}

describe('rule-source convergence (hook script ↔ ProtectedPaths)', () => {
  it('every source rule is embedded verbatim (reason + severity + pattern)', () => {
    const script = generatedPreToolScript()
    for (const rule of serializeCommandRules()) {
      expect(script).toContain(JSON.stringify(rule.re).slice(1, -1))
      expect(script).toContain(rule.reason)
      expect(script).toContain(rule.severity)
    }
  })

  it('no divergent hardcoded rules remain in the template (count equality)', () => {
    const script = generatedPreToolScript()
    const embedded = (script.match(/"severity":"block"/g) ?? []).length
    const sourceBlock = getCommandRules().filter(r => r.severity === 'block').length
    expect(embedded).toBe(sourceBlock)
    const embeddedWarn = (script.match(/"severity":"warn"/g) ?? []).length
    const sourceWarn = getCommandRules().filter(r => r.severity === 'warn').length
    expect(embeddedWarn).toBe(sourceWarn)
  })

  it('the dead BLOCKED_COMMANDS hint array is gone', () => {
    expect(generatedPreToolScript()).not.toContain('const BLOCKED_COMMANDS')
  })
})

describe('PowerShell/cmd native recursive deletes (DSH-verified blind spot)', () => {
  it('Remove-Item -Recurse -Force blocks in both orders', () => {
    expect(checkToolInput({ session_id: 's', cwd: '/p', tool_name: 'Bash', tool_input: { command: 'Remove-Item -Recurse -Force C:/tmp/x' } }).decision).toBe('block')
    expect(checkToolInput({ session_id: 's', cwd: '/p', tool_name: 'Bash', tool_input: { command: 'Remove-Item -Force -Recurse C:/tmp/x' } }).decision).toBe('block')
  })

  it('Remove-Item -Recurse without -Force warns (not silent, not blocked)', () => {
    const hits = checkCommand('Remove-Item -Recurse C:/tmp/x')
    expect(hits.some(h => h.severity === 'warn')).toBe(true)
    expect(checkWarnHits('Remove-Item -Recurse C:/tmp/x').length).toBeGreaterThan(0)
    expect(checkToolInput({ session_id: 's', cwd: '/p', tool_name: 'Bash', tool_input: { command: 'Remove-Item -Recurse C:/tmp/x' } }).decision).toBe('allow')
  })

  it('cmd rd /s and del /s /q block', () => {
    expect(checkToolInput({ session_id: 's', cwd: '/p', tool_name: 'Bash', tool_input: { command: 'rd /s /q build' } }).decision).toBe('block')
    expect(checkToolInput({ session_id: 's', cwd: '/p', tool_name: 'Bash', tool_input: { command: 'del /s /q *.tmp' } }).decision).toBe('block')
  })

  it('plain Remove-Item of a single file stays allowed (no false positive)', () => {
    expect(checkToolInput({ session_id: 's', cwd: '/p', tool_name: 'Bash', tool_input: { command: 'Remove-Item notes.txt' } }).decision).toBe('allow')
  })
})
