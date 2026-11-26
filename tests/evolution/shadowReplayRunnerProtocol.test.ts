import { describe, expect, it } from 'vitest'
import { evaluateShadowReplayProtocol, parseShadowReplayCandidate, parseShadowReplayScenario } from '../../src/evolution/ShadowReplayRunnerProtocol.js'

const sha = 'a'.repeat(40)
const plan = { sourceCommitSha: sha, candidateId: 'candidate-1', failureId: 'failure-1' }
function scenario(events = [{ id: 'event-1', tool: 'file.write', input: 'write secret.txt', expectedDecision: 'block' }]) {
  return JSON.stringify({ protocolVersion: 1, kind: 'scale-shadow-replay-scenario', scenarioId: 'scenario-1', sourceCommitSha: sha, events })
}
function candidate(rules = [{ id: 'rule-1', priority: 10, tool: 'file.write', contains: 'secret', decision: 'block' }]) {
  return JSON.stringify({ protocolVersion: 1, kind: 'scale-shadow-replay-candidate', candidateId: 'candidate-1', failureId: 'failure-1', defaultDecision: 'allow', rules })
}

describe('Shadow Replay runner protocol', () => {
  it('evaluates a matching declarative rule without executing commands', () => {
    expect(evaluateShadowReplayProtocol(plan, scenario(), candidate())).toMatchObject({
      passed: true, eventCount: 1, matchedRuleCount: 1, mismatchCount: 0,
    })
  })

  it('uses deterministic priority ordering and stable rule ID tie-breaks', () => {
    const rules = [
      { id: 'z-rule', priority: 10, tool: '*', contains: 'secret', decision: 'warn' },
      { id: 'a-rule', priority: 10, tool: 'file.write', contains: 'secret', decision: 'block' },
      { id: 'high-rule', priority: 20, tool: '*', contains: 'secret', decision: 'allow' },
    ]
    expect(evaluateShadowReplayProtocol(plan, scenario(), candidate(rules)).mismatches[0]).toMatchObject({
      actualDecision: 'allow', matchedRuleId: 'high-rule',
    })
  })

  it('breaks equal-priority ties by locale-independent rule ID order', () => {
    const rules = [
      { id: 'z-rule', priority: 10, tool: '*', contains: 'secret', decision: 'warn' },
      { id: 'a-rule', priority: 10, tool: 'file.write', contains: 'secret', decision: 'block' },
    ]
    expect(evaluateShadowReplayProtocol(plan, scenario(), candidate(rules))).toMatchObject({ passed: true, matchedRuleCount: 1 })
  })

  it('reports mismatches without echoing sensitive event input', () => {
    const result = evaluateShadowReplayProtocol(plan, scenario(), candidate([]))
    expect(result).toMatchObject({ passed: false, mismatchCount: 1 })
    expect(JSON.stringify(result)).not.toContain('secret.txt')
  })

  it('rejects arbitrary command or script fields instead of ignoring them', () => {
    const unsafe = JSON.parse(scenario()) as Record<string, unknown>
    unsafe.command = 'sh -c whoami'
    expect(() => parseShadowReplayScenario(JSON.stringify(unsafe))).toThrow('unsupported field')
    const unsafeCandidate = JSON.parse(candidate()) as Record<string, unknown>
    unsafeCandidate.script = 'process.exit(1)'
    expect(() => parseShadowReplayCandidate(JSON.stringify(unsafeCandidate))).toThrow('unsupported field')
  })

  it('rejects mismatched plan identity and source commit', () => {
    expect(() => evaluateShadowReplayProtocol({ ...plan, candidateId: 'other' }, scenario(), candidate())).toThrow('identity does not match')
    const wrongSha = scenario().replace(sha, 'b'.repeat(40))
    expect(() => evaluateShadowReplayProtocol(plan, wrongSha, candidate())).toThrow('sourceCommitSha does not match')
  })

  it('rejects duplicate IDs, unknown decisions and invalid rule priorities', () => {
    expect(() => parseShadowReplayScenario(scenario([
      { id: 'same', tool: 'file.write', input: 'a', expectedDecision: 'allow' },
      { id: 'same', tool: 'file.write', input: 'b', expectedDecision: 'block' },
    ]))).toThrow('duplicate event id')
    expect(() => parseShadowReplayCandidate(candidate([
      { id: 'bad', priority: 1001, tool: '*', contains: 'x', decision: 'block' },
    ]))).toThrow('priority')
  })

  it('requires at least one scenario event and bounds document size', () => {
    expect(() => parseShadowReplayScenario(scenario([]))).toThrow('1-500')
    expect(() => parseShadowReplayCandidate(' '.repeat(1024 * 1024 + 1))).toThrow('1 MiB')
  })

  it('rejects invalid JSON and unsupported protocol versions', () => {
    expect(() => parseShadowReplayScenario('{')).toThrow('valid JSON')
    expect(() => parseShadowReplayScenario(JSON.stringify({ ...JSON.parse(scenario()), protocolVersion: 2 }))).toThrow('unsupported')
  })
})
