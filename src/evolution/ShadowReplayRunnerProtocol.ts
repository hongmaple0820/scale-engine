import type { ShadowReplayPlan } from './ShadowReplayContract.js'

export type ShadowReplayDecision = 'allow' | 'warn' | 'block'
const MAX_DOCUMENT_BYTES = 1024 * 1024
const MAX_EVENTS = 500
const MAX_RULES = 500
const MAX_EVENT_INPUT_BYTES = 64 * 1024

export interface ShadowReplayScenarioEvent {
  id: string
  tool: string
  input: string
  expectedDecision: ShadowReplayDecision
}
export interface ShadowReplayScenarioSnapshot {
  protocolVersion: 1
  kind: 'scale-shadow-replay-scenario'
  scenarioId: string
  sourceCommitSha: string
  events: ShadowReplayScenarioEvent[]
}
export interface ShadowReplayCandidateRule {
  id: string
  priority: number
  tool: string
  contains: string
  decision: ShadowReplayDecision
}
export interface ShadowReplayCandidateBundle {
  protocolVersion: 1
  kind: 'scale-shadow-replay-candidate'
  candidateId: string
  failureId: string
  defaultDecision: ShadowReplayDecision
  rules: ShadowReplayCandidateRule[]
}
export interface ShadowReplayProtocolMismatch {
  eventId: string
  expectedDecision: ShadowReplayDecision
  actualDecision: ShadowReplayDecision
  matchedRuleId: string | null
}
export interface ShadowReplayProtocolEvaluation {
  protocolVersion: 1
  scenarioId: string
  candidateId: string
  failureId: string
  passed: boolean
  eventCount: number
  matchedRuleCount: number
  mismatchCount: number
  mismatches: ShadowReplayProtocolMismatch[]
}

function fail(message: string): never { throw new Error(`Invalid Shadow Replay protocol: ${message}`) }
function object(value: unknown, label: string, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`)
  const record = value as Record<string, unknown>
  const actual = Object.keys(record)
  const unknown = actual.filter(key => !keys.includes(key))
  const missing = keys.filter(key => !(key in record))
  if (unknown.length) fail(`${label} contains unsupported field(s): ${unknown.join(', ')}`)
  if (missing.length) fail(`${label} is missing field(s): ${missing.join(', ')}`)
  return record
}
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${label} must be a non-empty string of at most ${max} characters`)
  return value
}
function decision(value: unknown, label: string): ShadowReplayDecision {
  if (value !== 'allow' && value !== 'warn' && value !== 'block') fail(`${label} must be allow, warn, or block`)
  return value
}
function parseDocument(raw: string, label: string): unknown {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > MAX_DOCUMENT_BYTES) fail(`${label} exceeds the 1 MiB document limit`)
  try { return JSON.parse(raw) as unknown } catch { return fail(`${label} must be valid JSON`) }
}

export function parseShadowReplayScenario(raw: string): ShadowReplayScenarioSnapshot {
  const root = object(parseDocument(raw, 'scenario snapshot'), 'scenario snapshot', ['protocolVersion', 'kind', 'scenarioId', 'sourceCommitSha', 'events'])
  if (root.protocolVersion !== 1 || root.kind !== 'scale-shadow-replay-scenario') fail('scenario protocolVersion/kind is unsupported')
  const scenarioId = text(root.scenarioId, 'scenarioId', 128)
  const sourceCommitSha = text(root.sourceCommitSha, 'sourceCommitSha', 64)
  if (!/^[a-f0-9]{40,64}$/i.test(sourceCommitSha)) fail('sourceCommitSha must be a Git commit SHA')
  if (!Array.isArray(root.events) || root.events.length < 1 || root.events.length > MAX_EVENTS) fail(`events must contain 1-${MAX_EVENTS} entries`)
  const ids = new Set<string>()
  const events = root.events.map((value, index): ShadowReplayScenarioEvent => {
    const row = object(value, `events[${index}]`, ['id', 'tool', 'input', 'expectedDecision'])
    const id = text(row.id, `events[${index}].id`, 128)
    if (ids.has(id)) fail(`duplicate event id: ${id}`)
    ids.add(id)
    const tool = text(row.tool, `events[${index}].tool`, 64)
    if (!/^[a-z][a-z0-9._-]*$/i.test(tool)) fail(`events[${index}].tool has invalid characters`)
    const input = text(row.input, `events[${index}].input`, MAX_EVENT_INPUT_BYTES)
    if (Buffer.byteLength(input, 'utf8') > MAX_EVENT_INPUT_BYTES) fail(`events[${index}].input exceeds 64 KiB`)
    return { id, tool, input, expectedDecision: decision(row.expectedDecision, `events[${index}].expectedDecision`) }
  })
  return { protocolVersion: 1, kind: 'scale-shadow-replay-scenario', scenarioId, sourceCommitSha, events }
}

export function parseShadowReplayCandidate(raw: string): ShadowReplayCandidateBundle {
  const root = object(parseDocument(raw, 'candidate bundle'), 'candidate bundle', ['protocolVersion', 'kind', 'candidateId', 'failureId', 'defaultDecision', 'rules'])
  if (root.protocolVersion !== 1 || root.kind !== 'scale-shadow-replay-candidate') fail('candidate protocolVersion/kind is unsupported')
  const candidateId = text(root.candidateId, 'candidateId', 128)
  const failureId = text(root.failureId, 'failureId', 128)
  const defaultDecision = decision(root.defaultDecision, 'defaultDecision')
  if (!Array.isArray(root.rules) || root.rules.length > MAX_RULES) fail(`rules must contain 0-${MAX_RULES} entries`)
  const ids = new Set<string>()
  const rules = root.rules.map((value, index): ShadowReplayCandidateRule => {
    const row = object(value, `rules[${index}]`, ['id', 'priority', 'tool', 'contains', 'decision'])
    const id = text(row.id, `rules[${index}].id`, 128)
    if (ids.has(id)) fail(`duplicate rule id: ${id}`)
    ids.add(id)
    if (!Number.isSafeInteger(row.priority) || (row.priority as number) < -1000 || (row.priority as number) > 1000) fail(`rules[${index}].priority must be an integer from -1000 to 1000`)
    const tool = text(row.tool, `rules[${index}].tool`, 64)
    if (tool !== '*' && !/^[a-z][a-z0-9._-]*$/i.test(tool)) fail(`rules[${index}].tool has invalid characters`)
    const contains = text(row.contains, `rules[${index}].contains`, 4096)
    return { id, priority: row.priority as number, tool, contains, decision: decision(row.decision, `rules[${index}].decision`) }
  })
  return { protocolVersion: 1, kind: 'scale-shadow-replay-candidate', candidateId, failureId, defaultDecision, rules }
}

/** Deterministic, data-only policy simulation. No shell, JavaScript, regex, or arbitrary command execution. */
export function evaluateShadowReplayProtocol(
  plan: Pick<ShadowReplayPlan, 'sourceCommitSha' | 'candidateId' | 'failureId'>,
  scenarioRaw: string,
  candidateRaw: string,
): ShadowReplayProtocolEvaluation {
  const scenario = parseShadowReplayScenario(scenarioRaw)
  const candidate = parseShadowReplayCandidate(candidateRaw)
  if (scenario.sourceCommitSha.toLowerCase() !== plan.sourceCommitSha.toLowerCase()) fail('scenario sourceCommitSha does not match the approved plan')
  if (candidate.candidateId !== plan.candidateId || candidate.failureId !== plan.failureId) fail('candidate bundle identity does not match the approved plan')
  const orderedRules = [...candidate.rules].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  let matchedRuleCount = 0
  const mismatches: ShadowReplayProtocolMismatch[] = []
  for (const event of scenario.events) {
    const matched = orderedRules.find(rule => (rule.tool === '*' || rule.tool === event.tool) && event.input.includes(rule.contains))
    if (matched) matchedRuleCount++
    const actualDecision = matched?.decision ?? candidate.defaultDecision
    if (actualDecision !== event.expectedDecision) {
      mismatches.push({ eventId: event.id, expectedDecision: event.expectedDecision, actualDecision, matchedRuleId: matched?.id ?? null })
    }
  }
  return {
    protocolVersion: 1, scenarioId: scenario.scenarioId, candidateId: candidate.candidateId, failureId: candidate.failureId,
    passed: mismatches.length === 0, eventCount: scenario.events.length, matchedRuleCount,
    mismatchCount: mismatches.length, mismatches,
  }
}
