import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JsonLlmClient, isLlmEnabled, parseJsonReply } from '../../src/review/JsonLlmClient.js'
import { JudgePromptStore, LlmJudge } from '../../src/review/LlmJudge.js'

function tmpScaleDir(): string {
  return mkdtempSync(join(tmpdir(), 'scale-judge-'))
}

// A judge that never touches the network (LLM disabled) so every assertion is
// deterministic. Prompt store points at a throwaway dir.
function heuristicJudge(scaleDir: string): LlmJudge {
  return new LlmJudge(new JsonLlmClient(false), new JudgePromptStore(scaleDir))
}

describe('JsonLlmClient', () => {
  const saved = process.env.SCALE_LOCAL_MODEL

  afterEach(() => {
    if (saved === undefined) delete process.env.SCALE_LOCAL_MODEL
    else process.env.SCALE_LOCAL_MODEL = saved
  })

  it('is disabled unless SCALE_LOCAL_MODEL is set', () => {
    delete process.env.SCALE_LOCAL_MODEL
    expect(isLlmEnabled()).toBe(false)
    process.env.SCALE_LOCAL_MODEL = 'qwen-2.5-72b'
    expect(isLlmEnabled()).toBe(true)
  })

  it('throws (so callers fall back) when disabled', async () => {
    await expect(new JsonLlmClient(false).completeJson({ system: 's', user: 'u' })).rejects.toThrow(/disabled/)
  })

  it('parses bare, fenced and embedded JSON replies', () => {
    expect(parseJsonReply<{ a: number }>('{"a":1}')).toEqual({ a: 1 })
    expect(parseJsonReply<{ a: number }>('```json\n{"a":2}\n```')).toEqual({ a: 2 })
    expect(parseJsonReply<{ a: number }>('here you go: {"a":3} done')).toEqual({ a: 3 })
    expect(parseJsonReply('not json at all')).toBeNull()
  })
})

describe('JudgePromptStore', () => {
  it('writes and reloads the bundled default prompt', () => {
    const dir = tmpScaleDir()
    const store = new JudgePromptStore(dir)
    const prompt = store.load()
    expect(prompt.id).toBe('spec-conformance')
    expect(prompt.version).toBe('v1')
    expect(existsSync(join(dir, 'judges', 'spec-conformance.json'))).toBe(true)
    const onDisk = JSON.parse(readFileSync(join(dir, 'judges', 'spec-conformance.json'), 'utf-8'))
    expect(onDisk.system).toContain('judge')
  })
})

describe('LlmJudge heuristic fallback (P1.4)', () => {
  let scaleDir: string
  beforeEach(() => { scaleDir = tmpScaleDir() })

  it('fails when there are critical/high review findings', async () => {
    const verdict = await heuristicJudge(scaleDir).judge({
      outcome: 'add feature',
      verificationSurface: ['tests/foo.test.ts'],
      diffSummary: '# tests/foo.test.ts\n+ it("foo")',
      reviewFindings: { critical: 1, high: 0, medium: 0, low: 0 },
    })
    expect(verdict.decision).toBe('fail')
    expect(verdict.modelUsed).toBe('heuristic')
    expect(verdict.advisory).toBe(true)
    expect(verdict.promptVersion).toBe('spec-conformance.v1')
  })

  it('is uncertain when no verification surface is declared', async () => {
    const verdict = await heuristicJudge(scaleDir).judge({
      verificationSurface: [],
      diffSummary: '# src/a.ts\n+ const x = 1',
      reviewFindings: { critical: 0, high: 0, medium: 0, low: 0 },
    })
    expect(verdict.decision).toBe('uncertain')
  })

  it('is uncertain and lists surfaces with no diff evidence', async () => {
    const verdict = await heuristicJudge(scaleDir).judge({
      verificationSurface: ['npm run benchmark', 'tests/login.test.ts'],
      diffSummary: '# src/login.ts\n+ export function login() {}',
      reviewFindings: { critical: 0, high: 0, medium: 0, low: 0 },
    })
    expect(verdict.decision).toBe('uncertain')
    expect(verdict.unmetSurfaces).toContain('npm run benchmark')
    // "login" token is present in the diff, so that surface is considered met.
    expect(verdict.unmetSurfaces).not.toContain('tests/login.test.ts')
  })

  it('passes when every surface is mentioned and there are no blocking findings', async () => {
    const verdict = await heuristicJudge(scaleDir).judge({
      outcome: 'add login test',
      verificationSurface: ['tests/login.test.ts'],
      diffSummary: '# tests/login.test.ts\n+ it("login works")',
      reviewFindings: { critical: 0, high: 0, medium: 1, low: 2 },
    })
    expect(verdict.decision).toBe('pass')
    expect(verdict.unmetSurfaces).toHaveLength(0)
  })
})
