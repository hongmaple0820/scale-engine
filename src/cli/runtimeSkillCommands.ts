// SCALE Engine — Runtime, Memory, Out-of-Scope, and Skill Commands
// Extracted from src/api/cli.ts for modular CLI architecture.

import { defineCommand } from 'citty'
import { dirname, join, resolve } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { getEngine, SCALE_DIR, PROJECT_DIR, isTruthyFlag, resolveScaleDirForProject, ensureDir } from './engineBootstrap.js'
import {
  ModelUsageLedger,
  RuntimeEvidenceLedger,
  SessionLedger,
  buildModelUsageInput,
  doctorRuntimeEvidence,
  evaluateFinalReportReadiness,
  type ModelUsageInput,
  type RuntimeEvidenceKind,
  type RuntimeEvidenceStatus,
  type RuntimeSessionStatus,
} from '../runtime/index.js'
import {
  MemoryFabric,
  MemoryBrain,
  doctorMemoryFabric,
  renderContextPackMarkdown,
  renderMemoryLearningCandidateMarkdown,
  inspectMemoryProviders,
  recallMemoryProviders,
  settleMemoryLearning,
  useMemoryProvider,
  writeMemoryProvidersConfig,
} from '../memory/index.js'
import { OutOfScopeStore } from '../workflow/OutOfScopeStore.js'
import { WorkflowArtifactWriter } from '../workflow/WorkflowArtifactWriter.js'
import { SkillDiscovery } from '../skills/SkillDiscovery.js'
import { inspectRequiredWorkflowSkills, inspectWorkflowSkills } from '../skills/SkillDoctor.js'
import {
  evaluateSkillInstallSafety,
  listSkillRepositoryEntries,
  recommendSkillWorkflow,
  renderSkillRepositoryMarkdown,
} from '../skills/SkillRepository.js'
import {
  evaluateSkillRadar,
  inspectSkillSupplyChain,
  renderSkillRadarMarkdown,
} from '../skills/SkillRadar.js'
import { createSkillPlan, evaluateSkillGate, loadSkillRoutingPolicy, skillPlanMarkdown } from '../skills/routing/index.js'
import { createThirdPartyUpdateReport } from '../workflow/UpgradeManager.js'
import { CerebrumManager } from '../knowledge/CerebrumManager.js'
import { collectSessionPreamble } from '../workflow/SessionPreamble.js'
import type { TaskPayload } from '../artifact/types.js'
import type { TaskArtifactLevel } from '../workflow/TaskArtifactScaffolder.js'

// ============================================================================
// Shared helpers
// ============================================================================

function parseCommaList(value: unknown): string[] {
  const raw = String(value ?? '').trim()
  if (!raw) return []
  return raw.split(',').map(item => item.trim()).filter(Boolean)
}

function parsePositiveIntArg(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number.parseInt(String(value), 10)
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return parsed
}

function parseSinceDays(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number.parseInt(String(value), 10)
  if (Number.isNaN(parsed) || parsed <= 0) return undefined
  return parsed
}

function normalizeTaskArtifactLevel(value: unknown): TaskArtifactLevel {
  const normalized = String(value ?? 'M').trim().toUpperCase()
  if (normalized === 'S' || normalized === 'M' || normalized === 'L' || normalized === 'CRITICAL') {
    return normalized
  }
  throw new Error(`Invalid task level "${String(value)}"; expected S, M, L, or CRITICAL.`)
}

// ============================================================================
// runtime command - session ledger + completion evidence
// ============================================================================

function normalizeRuntimeEvidenceKind(value: unknown): RuntimeEvidenceKind {
  const normalized = String(value ?? 'command').trim()
  const allowed: RuntimeEvidenceKind[] = ['command', 'gate', 'tool', 'skill', 'mcp', 'browser', 'desktop', 'manual', 'final-report']
  if (allowed.includes(normalized as RuntimeEvidenceKind)) return normalized as RuntimeEvidenceKind
  throw new Error(`Invalid runtime evidence kind "${normalized}"; expected ${allowed.join(', ')}.`)
}

function normalizeRuntimeEvidenceStatus(value: unknown): RuntimeEvidenceStatus {
  const normalized = String(value ?? '').trim()
  if (normalized === 'passed' || normalized === 'failed' || normalized === 'skipped') return normalized
  throw new Error(`Invalid runtime evidence status "${normalized}"; expected passed, failed, or skipped.`)
}

function normalizeRuntimeSessionStatus(value: unknown): RuntimeSessionStatus {
  const normalized = String(value ?? 'completed').trim()
  if (normalized === 'active' || normalized === 'completed' || normalized === 'failed' || normalized === 'abandoned') return normalized
  throw new Error(`Invalid runtime session status "${normalized}"; expected active, completed, failed, or abandoned.`)
}

function parseNonNegativeNumberArg(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number.`)
  }
  return parsed
}

function parseJsonArg(value: unknown, name: string): unknown {
  try {
    return JSON.parse(String(value ?? 'null'))
  } catch {
    throw new Error(`${name} must be valid JSON.`)
  }
}

function parseMetadataJson(value: unknown, name = '--metadata-json'): Record<string, string | number | boolean> {
  const parsed = parseJsonArg(value ?? '{}', name)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object.`)
  }
  return parsed as Record<string, string | number | boolean>
}

function hasModelUsageArgs(args: Record<string, unknown>): boolean {
  return [
    'provider',
    'model',
    'usage-json',
    'usage-file',
    'input-tokens',
    'output-tokens',
    'cache-eligible-tokens',
    'cache-creation-input-tokens',
    'cache-read-input-tokens',
    'cached-tokens',
    'estimated-cost-usd',
  ].some(key => args[key] !== undefined && args[key] !== '')
}

function buildModelUsageRecordInput(
  args: Record<string, unknown>,
  defaults: { provider?: string; taskId?: string; sessionId?: string } = {},
): ModelUsageInput {
  const usagePayload = args['usage-file']
    ? parseJsonArg(readFileSync(resolve(PROJECT_DIR, String(args['usage-file'])), 'utf-8'), '--usage-file')
    : args['usage-json']
      ? parseJsonArg(args['usage-json'], '--usage-json')
      : undefined
  const provider = String(args.provider ?? defaults.provider ?? '').trim()
  if (!provider) throw new Error('Model usage recording requires --provider.')
  return buildModelUsageInput({
    provider,
    model: args.model ? String(args.model) : undefined,
    taskId: args['task-id'] ? String(args['task-id']) : defaults.taskId,
    sessionId: args['session-id'] ? String(args['session-id']) : defaults.sessionId,
    inputTokens: parseNonNegativeNumberArg(args['input-tokens'], '--input-tokens'),
    outputTokens: parseNonNegativeNumberArg(args['output-tokens'], '--output-tokens'),
    cacheEligibleTokens: parseNonNegativeNumberArg(args['cache-eligible-tokens'], '--cache-eligible-tokens'),
    cacheCreationInputTokens: parseNonNegativeNumberArg(args['cache-creation-input-tokens'], '--cache-creation-input-tokens'),
    cacheReadInputTokens: parseNonNegativeNumberArg(args['cache-read-input-tokens'], '--cache-read-input-tokens'),
    cachedTokens: parseNonNegativeNumberArg(args['cached-tokens'], '--cached-tokens'),
    estimatedCostUsd: parseNonNegativeNumberArg(args['estimated-cost-usd'], '--estimated-cost-usd'),
    metadata: args['metadata-json'] !== undefined ? parseMetadataJson(args['metadata-json']) : undefined,
    timestamp: args.timestamp ? String(args.timestamp) : undefined,
    usagePayload,
  })
}

const tokenRecord = defineCommand({
  meta: { name: 'record', description: 'Record real model usage from provider usage payloads or explicit token counts' },
  args: {
    provider: { type: 'string', required: true, description: 'Model provider: anthropic, openai, codex, etc.' },
    model: { type: 'string', description: 'Optional model id' },
    'task-id': { type: 'string', description: 'Task id linked to this model usage' },
    'session-id': { type: 'string', description: 'Session id linked to this model usage' },
    'usage-json': { type: 'string', description: 'Raw provider response or usage JSON to normalize into the usage ledger' },
    'usage-file': { type: 'string', description: 'Path to a JSON file containing a raw provider response or usage payload' },
    'input-tokens': { type: 'string', description: 'Explicit input token count; overrides usage JSON when provided' },
    'output-tokens': { type: 'string', description: 'Explicit output token count; overrides usage JSON when provided' },
    'cache-eligible-tokens': { type: 'string', description: 'Explicit cache-eligible token count' },
    'cache-creation-input-tokens': { type: 'string', description: 'Explicit Anthropic cache creation token count' },
    'cache-read-input-tokens': { type: 'string', description: 'Explicit Anthropic cache read token count' },
    'cached-tokens': { type: 'string', description: 'Explicit OpenAI cached token count' },
    'estimated-cost-usd': { type: 'string', description: 'Optional estimated cost in USD' },
    timestamp: { type: 'string', description: 'Optional ISO timestamp' },
    'metadata-json': { type: 'string', default: '{}', description: 'Additional JSON metadata' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const record = new ModelUsageLedger(SCALE_DIR).record(buildModelUsageRecordInput(args))
    if (args.json) {
      console.log(JSON.stringify(record, null, 2))
      return
    }
    console.log(`Model usage recorded: ${record.id}`)
    console.log(`  Provider: ${record.provider}`)
    console.log(`  Model: ${record.model ?? 'unknown'}`)
    console.log(`  Tokens: input ${record.inputTokens}, output ${record.outputTokens}, total ${record.totalTokens}`)
    if (record.cacheSavingsTokens > 0) console.log(`  Cache savings: ${record.cacheSavingsTokens} tokens`)
  },
})

const tokenReport = defineCommand({
  meta: { name: 'report', description: 'Summarize recorded model usage by day, provider, model, and task' },
  args: {
    day: { type: 'string', description: 'Exact UTC day in YYYY-MM-DD format' },
    since: { type: 'string', description: 'ISO timestamp lower bound' },
    until: { type: 'string', description: 'ISO timestamp upper bound' },
    'since-days': { type: 'string', default: '7d', description: 'Relative time window when day/since/until are omitted; use all to disable' },
    provider: { type: 'string', description: 'Filter by provider' },
    model: { type: 'string', description: 'Filter by model id' },
    'task-id': { type: 'string', description: 'Filter by task id' },
    'session-id': { type: 'string', description: 'Filter by session id' },
    limit: { type: 'string', description: 'Maximum recent records to include in the report; defaults to 20' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const limit = parsePositiveIntArg(args.limit, '--limit')
    const sinceDays = args.day || args.since || args.until ? undefined : parseSinceDays(args['since-days']) ?? 7
    const since = args.since
      ? String(args.since)
      : sinceDays
        ? new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString()
        : undefined
    const report = new ModelUsageLedger(SCALE_DIR).report({
      day: args.day ? String(args.day) : undefined,
      since,
      until: args.until ? String(args.until) : undefined,
      provider: args.provider ? String(args.provider) : undefined,
      model: args.model ? String(args.model) : undefined,
      taskId: args['task-id'] ? String(args['task-id']) : undefined,
      sessionId: args['session-id'] ? String(args['session-id']) : undefined,
      limit,
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log('SCALE Usage Report')
    if (report.filters.day) console.log(`  Day: ${report.filters.day}`)
    else if (report.filters.since || report.filters.until) console.log(`  Window: ${report.filters.since ?? '-inf'} -> ${report.filters.until ?? 'now'}`)
    console.log(`  Records: ${report.summary.totalRecords}`)
    console.log(`  Tokens: input ${report.summary.totalInputTokens}, output ${report.summary.totalOutputTokens}, total ${report.summary.totalTokens}`)
    console.log(`  Cache: eligible ${report.summary.cacheEligibleTokens}, create ${report.summary.cacheCreationInputTokens}, read ${report.summary.cacheReadInputTokens}, cached ${report.summary.cachedTokens}, saved ${report.summary.cacheSavingsTokens}`)
    if (report.summary.estimatedCostUsd !== undefined) console.log(`  Estimated cost: $${report.summary.estimatedCostUsd.toFixed(6)}`)
    for (const row of report.byProvider.slice(0, 5)) {
      console.log(`  Provider ${row.key}: ${row.records} record(s), ${row.totalTokens} total tokens, ${row.cacheSavingsTokens} saved`)
    }
    for (const row of report.byModel.slice(0, 5)) {
      console.log(`  Model ${row.key}: ${row.records} record(s), ${row.totalTokens} total tokens`)
    }
    for (const row of report.byTask.slice(0, 5)) {
      console.log(`  Task ${row.key}: ${row.records} record(s), ${row.totalTokens} total tokens`)
    }
    for (const row of report.records.slice(0, 10)) {
      console.log(`  Recent ${row.timestamp}: ${row.provider}/${row.model ?? 'unknown'} task=${row.taskId ?? '-'} total=${row.totalTokens}`)
    }
  },
})

const token = defineCommand({
  meta: { name: 'token', description: 'Record and audit real model token usage' },
  subCommands: { record: tokenRecord, report: tokenReport },
})

const runtimeStart = defineCommand({
  meta: { name: 'start', description: 'Start a runtime session ledger' },
  args: {
    'session-id': { type: 'string', description: 'Session id; generated when omitted' },
    'task-id': { type: 'string', description: 'Task id linked to this session' },
    agent: { type: 'string', description: 'Agent name' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    summary: { type: 'string', description: 'Short session summary' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const ledger = new SessionLedger({ projectDir: PROJECT_DIR, scaleDir: SCALE_DIR })
    const preamble = collectSessionPreamble({ projectDir: PROJECT_DIR, scaleDir: SCALE_DIR })
    const session = ledger.start({
      sessionId: args['session-id'],
      taskId: args['task-id'],
      agent: args.agent,
      level: normalizeTaskArtifactLevel(args.level),
      summary: args.summary,
      metadata: {
        cortex: preamble.cortex,
      },
    })
    if (args.json) {
      console.log(JSON.stringify(session, null, 2))
      return
    }
    console.log(`Runtime session started: ${session.sessionId}`)
    if (session.taskId) console.log(`  Task: ${session.taskId}`)
    if (session.level) console.log(`  Level: ${session.level}`)
    console.log(`  Events: ${ledger.sessionFile(session.sessionId)}`)
  },
})

const runtimeEnd = defineCommand({
  meta: { name: 'end', description: 'End the current or named runtime session' },
  args: {
    'session-id': { type: 'string', description: 'Session id; current session is used when omitted' },
    status: { type: 'string', default: 'completed', description: 'completed, failed, or abandoned' },
    summary: { type: 'string', description: 'Completion summary' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const ledger = new SessionLedger({ projectDir: PROJECT_DIR, scaleDir: SCALE_DIR })
    const sessionId = args['session-id'] ?? ledger.current()?.sessionId
    if (!sessionId) {
      console.error('No runtime session id provided and no current runtime session exists.')
      process.exit(1)
    }
    const session = ledger.end(sessionId, normalizeRuntimeSessionStatus(args.status), args.summary)
    if (args.json) {
      console.log(JSON.stringify(session, null, 2))
      return
    }
    console.log(`Runtime session ended: ${session.sessionId}`)
    console.log(`  Status: ${session.status}`)
  },
})

const runtimeRecord = defineCommand({
  meta: { name: 'record', description: 'Record command, gate, tool, browser, skill, or manual runtime evidence' },
  args: {
    'task-id': { type: 'string', description: 'Task id linked to this evidence' },
    'session-id': { type: 'string', description: 'Session id linked to this evidence' },
    kind: { type: 'string', default: 'command', description: 'command, gate, tool, skill, mcp, browser, desktop, manual, final-report' },
    title: { type: 'string', required: true, description: 'Evidence title' },
    status: { type: 'string', required: true, description: 'passed, failed, or skipped' },
    command: { type: 'string', description: 'Exact command or tool invocation, with secrets redacted by SCALE' },
    'exit-code': { type: 'string', description: 'Exit code when applicable' },
    summary: { type: 'string', required: true, description: 'Short output summary' },
    artifacts: { type: 'string', description: 'Comma-separated artifact paths' },
    provider: { type: 'string', description: 'Optional model provider when attaching model usage: anthropic, openai, codex, etc.' },
    model: { type: 'string', description: 'Optional model id when attaching model usage' },
    'usage-json': { type: 'string', description: 'Raw provider response or usage JSON to normalize into the usage ledger' },
    'usage-file': { type: 'string', description: 'Path to a JSON file containing a raw provider response or usage payload' },
    'input-tokens': { type: 'string', description: 'Explicit input token count; overrides usage JSON when provided' },
    'output-tokens': { type: 'string', description: 'Explicit output token count; overrides usage JSON when provided' },
    'cache-eligible-tokens': { type: 'string', description: 'Explicit cache-eligible token count' },
    'cache-creation-input-tokens': { type: 'string', description: 'Explicit Anthropic cache creation token count' },
    'cache-read-input-tokens': { type: 'string', description: 'Explicit Anthropic cache read token count' },
    'cached-tokens': { type: 'string', description: 'Explicit OpenAI cached token count' },
    'estimated-cost-usd': { type: 'string', description: 'Optional estimated cost in USD' },
    timestamp: { type: 'string', description: 'Optional ISO timestamp for the usage record' },
    'metadata-json': { type: 'string', default: '{}', description: 'Additional JSON metadata' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const current = new SessionLedger({ projectDir: PROJECT_DIR, scaleDir: SCALE_DIR }).current()
    let metadata: Record<string, unknown> = {}
    try {
      metadata = JSON.parse(String(args['metadata-json'] ?? '{}')) as Record<string, unknown>
    } catch {
      console.error('--metadata-json must be valid JSON.')
      process.exit(1)
    }
    const exitCode = args['exit-code'] === undefined || args['exit-code'] === ''
      ? undefined
      : Number.parseInt(String(args['exit-code']), 10)
    if (exitCode !== undefined && Number.isNaN(exitCode)) {
      console.error('--exit-code must be a number.')
      process.exit(1)
    }
    const ledger = new RuntimeEvidenceLedger({ projectDir: PROJECT_DIR, scaleDir: SCALE_DIR })
    const record = ledger.record({
      taskId: args['task-id'] ?? current?.taskId,
      sessionId: args['session-id'] ?? current?.sessionId,
      kind: normalizeRuntimeEvidenceKind(args.kind),
      title: args.title,
      status: normalizeRuntimeEvidenceStatus(args.status),
      command: args.command,
      exitCode,
      summary: args.summary,
      artifacts: parseCommaList(args.artifacts),
      metadata,
    })
    if (record.sessionId) {
      new SessionLedger({ projectDir: PROJECT_DIR, scaleDir: SCALE_DIR }).append(record.sessionId, {
        type: 'evidence.recorded',
        message: `${record.status}: ${record.title}`,
        data: {
          evidenceId: record.id,
          kind: record.kind,
          taskId: record.taskId,
        },
      })
    }
    const usageRecord = hasModelUsageArgs(args)
      ? new ModelUsageLedger(SCALE_DIR).record(buildModelUsageRecordInput(args, {
          taskId: record.taskId,
          sessionId: record.sessionId,
        }))
      : undefined
    if (args.json) {
      console.log(JSON.stringify(usageRecord ? { evidence: record, usage: usageRecord } : record, null, 2))
      return
    }
    console.log(`Runtime evidence recorded: ${record.id}`)
    console.log(`  Status: ${record.status}`)
    console.log(`  Kind: ${record.kind}`)
    if (usageRecord) {
      console.log(`  Model usage: ${usageRecord.provider}/${usageRecord.model ?? 'unknown'} ${usageRecord.totalTokens} total tokens`)
      if (usageRecord.cacheSavingsTokens > 0) console.log(`  Cache savings: ${usageRecord.cacheSavingsTokens} tokens`)
    }
    if (record.redactionApplied) console.log('  Redaction: applied')
  },
})

const runtimeDoctor = defineCommand({
  meta: { name: 'doctor', description: 'Check runtime session and completion evidence' },
  args: {
    'task-id': { type: 'string', description: 'Task id to inspect' },
    'session-id': { type: 'string', description: 'Session id to inspect' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const report = doctorRuntimeEvidence({
      projectDir: PROJECT_DIR,
      scaleDir: SCALE_DIR,
      taskId: args['task-id'],
      sessionId: args['session-id'],
      level: normalizeTaskArtifactLevel(args.level),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (report.blocked) process.exitCode = 1
      return
    }
    console.log('\nSCALE Runtime Doctor')
    console.log(`  Evidence: ${report.evidence.total} total, ${report.evidence.passed} passed, ${report.evidence.failed} failed, ${report.evidence.skipped} skipped`)
    for (const check of report.checks) {
      console.log(`  [${check.status.toUpperCase()}] ${check.name}: ${check.message}`)
      if (check.fix) console.log(`    Fix: ${check.fix}`)
    }
    if (report.blocked) process.exitCode = 1
  },
})

const runtimeFinalCheck = defineCommand({
  meta: { name: 'final-check', description: 'Block final delivery claims without passed runtime evidence' },
  args: {
    'task-id': { type: 'string', description: 'Task id to inspect' },
    'session-id': { type: 'string', description: 'Session id to inspect' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const readiness = evaluateFinalReportReadiness({
      projectDir: PROJECT_DIR,
      scaleDir: SCALE_DIR,
      taskId: args['task-id'],
      sessionId: args['session-id'],
      level: normalizeTaskArtifactLevel(args.level),
    })
    if (args.json) {
      console.log(JSON.stringify(readiness, null, 2))
      if (readiness.blocked) process.exitCode = 1
      return
    }
    console.log('\nSCALE Runtime Final Check')
    console.log(`  Ready: ${readiness.ready}`)
    for (const reason of readiness.reasons) console.log(`  [BLOCKER] ${reason}`)
    if (readiness.blocked) process.exitCode = 1
  },
})

export { token }

export const runtimeCommand = defineCommand({
  meta: { name: 'runtime', description: 'Runtime session ledger and completion evidence governance' },
  subCommands: {
    start: runtimeStart,
    end: runtimeEnd,
    record: runtimeRecord,
    doctor: runtimeDoctor,
    'final-check': runtimeFinalCheck,
  },
})

// ============================================================================
// memory command - runtime evidence + knowledge + graph context packs
// ============================================================================

function parseMemoryBudget(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number.parseInt(String(value), 10)
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error('--budget must be a positive integer.')
  }
  return parsed
}

function normalizeMemorySource(value: unknown): 'evidence' | 'candidate' | 'failure' {
  const normalized = String(value ?? 'evidence').trim().toLowerCase()
  if (normalized === 'evidence' || normalized === 'candidate' || normalized === 'failure') return normalized
  throw new Error('--from must be evidence, candidate, or failure.')
}

function normalizeMemoryNodeType(value: unknown): 'fact' | 'decision' | 'incident' | 'relation' | 'contradiction' | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'fact' || normalized === 'decision' || normalized === 'incident' || normalized === 'relation' || normalized === 'contradiction') return normalized
  throw new Error('--type must be fact, decision, incident, relation, or contradiction.')
}

function normalizeMemoryScope(value: unknown): 'project' | 'workspace' | 'global-candidate' | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'project' || normalized === 'workspace' || normalized === 'global-candidate') return normalized
  throw new Error('--scope must be project, workspace, or global-candidate.')
}

function memoryBrain(): MemoryBrain {
  return new MemoryBrain({ projectDir: PROJECT_DIR, scaleDir: SCALE_DIR })
}

const memoryPack = defineCommand({
  meta: { name: 'pack', description: 'Build a compact context pack from runtime evidence, session events, knowledge, and graph status' },
  args: {
    task: { type: 'string', required: true, description: 'Current task or question' },
    'task-id': { type: 'string', description: 'Task id to scope evidence and session data' },
    'session-id': { type: 'string', description: 'Session id to scope session events' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    files: { type: 'string', description: 'Comma-separated files or modules in scope' },
    budget: { type: 'string', description: 'Maximum estimated tokens for the context pack' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    let budgetTokens: number | undefined
    try {
      budgetTokens = parseMemoryBudget(args.budget)
    } catch (e) {
      console.error((e as Error).message)
      process.exit(1)
    }
    const { kb } = getEngine()
    const pack = await new MemoryFabric({
      projectDir: PROJECT_DIR,
      scaleDir: SCALE_DIR,
      knowledgeBase: kb,
    }).createContextPack({
      task: args.task,
      taskId: args['task-id'],
      sessionId: args['session-id'],
      level: normalizeTaskArtifactLevel(args.level),
      files: parseCommaList(args.files),
      budgetTokens,
    })
    if (args.json) {
      console.log(JSON.stringify(pack, null, 2))
      return
    }
    console.log(renderContextPackMarkdown(pack))
  },
})

const memoryDoctor = defineCommand({
  meta: { name: 'doctor', description: 'Check whether a task context pack is available and within token budget' },
  args: {
    task: { type: 'string', required: true, description: 'Current task or question' },
    'task-id': { type: 'string', description: 'Task id to scope evidence and session data' },
    'session-id': { type: 'string', description: 'Session id to scope session events' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    files: { type: 'string', description: 'Comma-separated files or modules in scope' },
    budget: { type: 'string', description: 'Maximum estimated tokens for the context pack' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    let budgetTokens: number | undefined
    try {
      budgetTokens = parseMemoryBudget(args.budget)
    } catch (e) {
      console.error((e as Error).message)
      process.exit(1)
    }
    const { kb } = getEngine()
    const report = await doctorMemoryFabric({
      projectDir: PROJECT_DIR,
      scaleDir: SCALE_DIR,
      knowledgeBase: kb,
    }, {
      task: args.task,
      taskId: args['task-id'],
      sessionId: args['session-id'],
      level: normalizeTaskArtifactLevel(args.level),
      files: parseCommaList(args.files),
      budgetTokens,
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log('\nSCALE Memory Doctor')
    console.log(`  Budget: ${report.pack.budget.used}/${report.pack.budget.limit} estimated tokens`)
    for (const check of report.checks) {
      console.log(`  [${check.status.toUpperCase()}] ${check.name}: ${check.message}`)
    }
    if (!report.ok) process.exitCode = 1
  },
})

const memoryCerebrum = defineCommand({
  meta: { name: 'cerebrum', description: 'Maintain .scale/cerebrum.md do-not-repeat rules and preferences' },
  args: {
    type: { type: 'string', description: 'Optional entry type: preference or do-not-repeat' },
    pattern: { type: 'string', description: 'Pattern for do-not-repeat entries' },
    description: { type: 'string', description: 'Entry description or preference text' },
    tags: { type: 'string', description: 'Comma-separated tags for preferences' },
    write: { type: 'boolean', default: false, description: 'Write .scale/cerebrum.md' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const { kb } = getEngine()
    const manager = new CerebrumManager(kb)
    const type = args.type ? String(args.type).toLowerCase() : ''
    let created: unknown

    if (type) {
      if (type === 'do-not-repeat' || type === 'do_not_repeat' || type === 'dnr') {
        const pattern = String(args.pattern ?? '').trim()
        const description = String(args.description ?? '').trim()
        if (!pattern || !description) {
          console.error('memory cerebrum --type do-not-repeat requires --pattern and --description.')
          process.exit(1)
          return
        }
        created = await manager.addDoNotRepeat(pattern, description)
      } else if (type === 'preference' || type === 'pref') {
        const description = String(args.description ?? args.pattern ?? '').trim()
        if (!description) {
          console.error('memory cerebrum --type preference requires --description.')
          process.exit(1)
          return
        }
        created = await manager.addPreference(description, parseCommaList(args.tags))
      } else {
        console.error('memory cerebrum --type must be preference or do-not-repeat.')
        process.exit(1)
        return
      }
    }

    const entries = await manager.loadAll()
    const outputPath = join(SCALE_DIR, 'cerebrum.md')
    const shouldWrite = isTruthyFlag(args.write) || Boolean(created)
    if (shouldWrite) {
      ensureDir(SCALE_DIR)
      writeFileSync(outputPath, manager.toMarkdown(), 'utf-8')
    }

    const summary = {
      total: entries.length,
      doNotRepeat: entries.filter(entry => entry.type === 'do_not_repeat').length,
      preferences: entries.filter(entry => entry.type === 'preference').length,
    }
    if (args.json) {
      console.log(JSON.stringify({
        ok: true,
        outputPath: shouldWrite ? outputPath : undefined,
        created,
        summary,
      }, null, 2))
      return
    }
    console.log('SCALE Cerebrum')
    console.log(`  Do-not-repeat: ${summary.doNotRepeat}`)
    console.log(`  Preferences: ${summary.preferences}`)
    if (shouldWrite) console.log(`  Wrote: ${outputPath}`)
  },
})

const memorySettle = defineCommand({
  meta: { name: 'settle', description: 'Settle runtime evidence into a reviewable memory learning candidate' },
  args: {
    task: { type: 'string', required: true, description: 'Current task or question' },
    'task-id': { type: 'string', description: 'Task id to scope evidence and session data' },
    'session-id': { type: 'string', description: 'Session id to scope session events' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    files: { type: 'string', description: 'Comma-separated files or modules in scope' },
    budget: { type: 'string', description: 'Maximum estimated tokens for the context pack' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    let budgetTokens: number | undefined
    try {
      budgetTokens = parseMemoryBudget(args.budget)
    } catch (e) {
      console.error((e as Error).message)
      process.exit(1)
    }
    const { kb } = getEngine()
    const pack = await new MemoryFabric({
      projectDir: PROJECT_DIR,
      scaleDir: SCALE_DIR,
      knowledgeBase: kb,
    }).createContextPack({
      task: args.task,
      taskId: args['task-id'],
      sessionId: args['session-id'],
      level: normalizeTaskArtifactLevel(args.level),
      files: parseCommaList(args.files),
      budgetTokens,
    })
    const settlement = settleMemoryLearning({
      projectDir: PROJECT_DIR,
      scaleDir: SCALE_DIR,
      pack,
    })
    if (args.json) {
      console.log(JSON.stringify(settlement, null, 2))
      return
    }
    console.log(renderMemoryLearningCandidateMarkdown(settlement.candidate))
    console.log(`\nWrote: ${settlement.files.markdown}`)
  },
})

const memoryIngest = defineCommand({
  meta: { name: 'ingest', description: 'Ingest runtime evidence, learning candidates, or failure replays into the project memory brain' },
  args: {
    from: { type: 'string', default: 'evidence', description: 'Source: evidence, candidate, or failure' },
    'task-id': { type: 'string', description: 'Task id to scope runtime evidence' },
    'session-id': { type: 'string', description: 'Session id to scope runtime evidence' },
    'candidate-id': { type: 'string', description: 'Memory learning candidate id' },
    'failure-id': { type: 'string', description: 'Workflow eval failure replay id' },
    type: { type: 'string', description: 'Memory type override: fact/decision/incident/relation/contradiction' },
    scope: { type: 'string', description: 'Memory scope: project/workspace/global-candidate' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    let from: ReturnType<typeof normalizeMemorySource>
    let type: ReturnType<typeof normalizeMemoryNodeType>
    let scope: ReturnType<typeof normalizeMemoryScope>
    try {
      from = normalizeMemorySource(args.from)
      type = normalizeMemoryNodeType(args.type)
      scope = normalizeMemoryScope(args.scope)
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
      return
    }
    const report = memoryBrain().ingest({
      from,
      taskId: args['task-id'],
      sessionId: args['session-id'],
      candidateId: args['candidate-id'],
      failureId: args['failure-id'],
      type,
      scope,
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log('\nSCALE Memory Ingest')
    console.log(`  Source: ${report.source}`)
    console.log(`  Created: ${report.created}`)
    console.log(`  Skipped: ${report.skipped}`)
    for (const node of report.nodes) console.log(`  [${node.status}] ${node.id}: ${node.title}`)
    for (const warning of report.warnings) console.log(`  [WARN] ${warning}`)
    if (!report.ok) process.exitCode = 1
  },
})

const memoryQuery = defineCommand({
  meta: { name: 'query', description: 'Query concise project-scoped long-term memory with evidence references' },
  args: {
    query: { type: 'positional', required: true, description: 'Search query' },
    limit: { type: 'string', default: '8', description: 'Maximum number of memory nodes' },
    status: { type: 'string', description: 'Filter by status: candidate/active/stale/rejected' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const limit = Number.parseInt(String(args.limit ?? '8'), 10)
    const status = args.status ? String(args.status) as 'candidate' | 'active' | 'stale' | 'rejected' : undefined
    const report = memoryBrain().query(String(args.query), {
      limit: Number.isFinite(limit) && limit > 0 ? limit : 8,
      status,
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log('\nSCALE Memory Query')
    console.log(`  Query: ${report.query}`)
    console.log(`  Results: ${report.count}`)
    for (const node of report.nodes) {
      console.log(`  [${node.status}/${node.type}] ${node.id}: ${node.title}`)
      console.log(`    confidence: ${node.confidence}; evidence: ${node.evidencePaths.join(', ') || 'none'}`)
      console.log(`    ${node.summary}`)
    }
  },
})

const memoryContradictions = defineCommand({
  meta: { name: 'contradictions', description: 'Report conflicting project memory instead of silently resolving it' },
  args: {
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const report = memoryBrain().contradictions()
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log('\nSCALE Memory Contradictions')
    console.log(`  Count: ${report.count}`)
    for (const item of report.contradictions) {
      console.log(`  [CONFLICT] ${item.title}`)
      console.log(`    nodes: ${item.nodeIds.join(', ')}`)
      console.log(`    evidence: ${item.evidencePaths.join(', ') || 'none'}`)
    }
    if (!report.ok) process.exitCode = 1
  },
})

const memoryDream = defineCommand({
  meta: { name: 'dream', description: 'Run memory maintenance: duplicates, stale memories, contradictions, and promotion candidates' },
  args: {
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const report = memoryBrain().dream()
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log('\nSCALE Memory Dream')
    console.log(`  Total: ${report.summary.total}`)
    console.log(`  Active: ${report.summary.active}`)
    console.log(`  Candidates: ${report.summary.candidate}`)
    console.log(`  Contradictions: ${report.summary.contradictions}`)
    console.log(`  Duplicate groups: ${report.summary.duplicateGroups}`)
    for (const item of report.promotionCandidates) console.log(`  [PROMOTE?] ${item.id}: ${item.title}`)
    for (const item of report.staleCandidates) console.log(`  [STALE] ${item.id}: ${item.reason}`)
    if (!report.ok) process.exitCode = 1
  },
})

const memoryPromote = defineCommand({
  meta: { name: 'promote', description: 'Promote a memory candidate to active project memory after evidence review' },
  args: {
    id: { type: 'positional', required: true, description: 'Memory node id or learning candidate id' },
    scope: { type: 'string', description: 'Scope override: project/workspace/global-candidate' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    let scope: ReturnType<typeof normalizeMemoryScope>
    try {
      scope = normalizeMemoryScope(args.scope)
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
      return
    }
    const report = memoryBrain().promote(String(args.id), { scope })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log('\nSCALE Memory Promote')
    console.log(`  Status: ${report.ok ? 'promoted' : 'blocked'}`)
    if (report.node) console.log(`  Node: ${report.node.id} (${report.node.status})`)
    for (const warning of report.warnings) console.log(`  [WARN] ${warning}`)
    if (!report.ok) process.exitCode = 1
  },
})

const memoryExport = defineCommand({
  meta: { name: 'export', description: 'Export project memory as JSONL' },
  args: {
    output: { type: 'string', alias: 'o', description: 'Output JSONL file; stdout when omitted' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const jsonl = memoryBrain().exportJsonl()
    if (args.output) {
      const outputPath = resolve(PROJECT_DIR, String(args.output))
      ensureDir(dirname(outputPath))
      writeFileSync(outputPath, jsonl, 'utf-8')
      if (args.json) {
        console.log(JSON.stringify({ ok: true, outputPath, bytes: jsonl.length }, null, 2))
        return
      }
      console.log(`[OK] Memory JSONL exported: ${outputPath}`)
      return
    }
    console.log(jsonl)
  },
})

const memoryImport = defineCommand({
  meta: { name: 'import', description: 'Import project memory from JSONL' },
  args: {
    file: { type: 'positional', required: true, description: 'Input JSONL file' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const filePath = resolve(PROJECT_DIR, String(args.file))
    const report = memoryBrain().importJsonl(filePath)
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log('\nSCALE Memory Import')
    console.log(`  Imported: ${report.imported}`)
    console.log(`  Skipped: ${report.skipped}`)
    for (const warning of report.warnings) console.log(`  [WARN] ${warning}`)
    if (!report.ok) process.exitCode = 1
  },
})

const memoryProviderInit = defineCommand({
  meta: { name: 'init', description: 'Create .scale/memory-providers.json for autonomous memory provider routing' },
  args: {
    force: { type: 'boolean', default: false, description: 'Overwrite existing provider configuration' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const result = writeMemoryProvidersConfig({
      projectDir: PROJECT_DIR,
      scaleDir: SCALE_DIR,
      force: isTruthyFlag(args.force),
    })
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log(`\nSCALE Memory Provider Config: ${result.path}`)
    console.log(`  ${result.written ? 'written' : 'exists'}`)
    console.log(`  Order: ${result.config.routing.defaultOrder.join(' -> ')}`)
  },
})

const memoryProviderStatus = defineCommand({
  meta: { name: 'status', description: 'Inspect memory provider routing, availability, and safety boundaries' },
  args: {
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const report = inspectMemoryProviders({ projectDir: PROJECT_DIR, scaleDir: SCALE_DIR })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log('\nSCALE Memory Providers')
    console.log(`  Config: ${report.configExists ? report.configPath : 'default policy (not written)'}`)
    console.log(`  Mode: ${report.routing.mode}`)
    for (const provider of report.providers) {
      console.log(`  [${provider.available ? 'AVAILABLE' : 'SKIP'}] ${provider.id} (${provider.kind})`)
      console.log(`    safety: ${provider.safetyLevel}; write: ${provider.writeMode}; reason: ${provider.reason}`)
    }
    for (const warning of report.warnings) console.log(`  [WARN] ${warning}`)
  },
})

const memoryProviderRecall = defineCommand({
  meta: { name: 'recall', description: 'Recall relevant memory through provider routing with local fallback' },
  args: {
    query: { type: 'positional', required: true, description: 'Memory query or task context' },
    task: { type: 'string', description: 'Optional task text for provider routing context' },
    files: { type: 'string', description: 'Comma-separated files or modules in scope' },
    provider: { type: 'string', description: 'Force one provider id, such as agentmemory, gbrain, or scale-local' },
    limit: { type: 'string', default: '5', description: 'Maximum results' },
    'include-candidates': { type: 'boolean', default: false, description: 'Allow scale-local candidate memory fallback' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const limit = Number.parseInt(String(args.limit ?? '5'), 10)
    const report = await recallMemoryProviders({
      projectDir: PROJECT_DIR,
      scaleDir: SCALE_DIR,
      query: String(args.query),
      task: args.task ? String(args.task) : undefined,
      files: parseCommaList(args.files),
      provider: args.provider ? String(args.provider) : undefined,
      limit: Number.isFinite(limit) && limit > 0 ? limit : 5,
      includeCandidates: isTruthyFlag(args['include-candidates']),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log('\nSCALE Memory Provider Recall')
    console.log(`  Query: ${report.query}`)
    console.log(`  Providers: ${report.providerOrder.join(' -> ')}`)
    console.log(`  Results: ${report.items.length}`)
    for (const item of report.items) {
      console.log(`  [${item.provider}] ${item.id}: ${item.title}`)
      console.log(`    score: ${item.score}; confidence: ${item.confidence}; evidence: ${item.evidencePaths.join(', ') || 'none'}`)
      console.log(`    ${item.summary}`)
    }
    for (const warning of report.warnings) console.log(`  [WARN] ${warning}`)
  },
})

const memoryProviderUse = defineCommand({
  meta: { name: 'use', description: 'Promote one memory provider to the front of routing and persist the selection' },
  args: {
    provider: { type: 'positional', required: true, description: 'Provider id: gbrain, agentmemory, or scale-local' },
    mode: { type: 'string', description: 'Optional routing mode override: auto, local-only, external-first' },
    endpoint: { type: 'string', description: 'Optional provider endpoint to persist while switching' },
    'write-mode': { type: 'string', description: 'Optional provider write mode: disabled, candidate-only, enabled' },
    'allow-external-write': { type: 'boolean', default: false, description: 'Persist external write allowance when explicitly switching' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const mode = args.mode ? String(args.mode) : undefined
    const writeMode = args['write-mode']
      ? String(args['write-mode']) as 'disabled' | 'candidate-only' | 'enabled'
      : undefined
    const report = useMemoryProvider({
      projectDir: PROJECT_DIR,
      scaleDir: SCALE_DIR,
      provider: String(args.provider),
      mode: mode as 'auto' | 'local-only' | 'external-first' | undefined,
      endpoint: args.endpoint ? String(args.endpoint) : undefined,
      writeMode,
      allowExternalWrite: isTruthyFlag(args['allow-external-write']) ? true : undefined,
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log('\nSCALE Memory Provider Switch')
    console.log(`  Provider: ${report.provider}`)
    console.log(`  Mode: ${report.mode}`)
    console.log(`  Config: ${report.path}`)
    console.log(`  Order: ${report.previousOrder.join(' -> ')} -> ${report.nextOrder.join(' -> ')}`)
    if (report.providerStatus) {
      console.log(`  Status: ${report.providerStatus.available ? 'available' : 'not-ready'} (${report.providerStatus.reason})`)
    }
    for (const warning of report.warnings) console.log(`  [WARN] ${warning}`)
    if (!report.ok) process.exitCode = 1
  },
})

const memoryProvider = defineCommand({
  meta: { name: 'provider', description: 'Manage autonomous memory provider routing for agentmemory, gbrain, and scale-local' },
  subCommands: {
    init: memoryProviderInit,
    status: memoryProviderStatus,
    recall: memoryProviderRecall,
    use: memoryProviderUse,
  },
})

export const memoryCommand = defineCommand({
  meta: { name: 'memory', description: 'Memory Fabric context packs and project-scoped long-term memory' },
  subCommands: {
    pack: memoryPack,
    doctor: memoryDoctor,
    cerebrum: memoryCerebrum,
    settle: memorySettle,
    ingest: memoryIngest,
    query: memoryQuery,
    contradictions: memoryContradictions,
    dream: memoryDream,
    promote: memoryPromote,
    export: memoryExport,
    import: memoryImport,
    provider: memoryProvider,
  },
})

// ============================================================================
// out-of-scope command
// ============================================================================

const outOfScopeAdd = defineCommand({
  meta: { name: 'add', description: 'Record a rejected concept to the out-of-scope knowledge base' },
  args: {
    concept: { type: 'positional', required: true, description: 'kebab-case concept name' },
    title: { type: 'string', required: true, description: 'Human-readable title' },
    reason: { type: 'string', required: true, description: 'Why this was rejected' },
    'tech-context': { type: 'string', description: 'Technical constraints that led to rejection' },
    'prior-requests': { type: 'string', description: 'Comma-separated issue IDs or URLs' },
  },
  run({ args }) {
    ensureDir(SCALE_DIR)
    const store = new OutOfScopeStore(SCALE_DIR)
    const entry = store.add({
      concept: args.concept,
      title: args.title,
      reason: args.reason,
      technicalContext: args['tech-context'],
      priorRequests: args['prior-requests']?.split(',').map(s => s.trim()) ?? [],
    })
    console.log(JSON.stringify({ ok: true, concept: entry.concept, title: entry.title, priorRequests: entry.priorRequests.length }, null, 2))
  },
})

const outOfScopeCheck = defineCommand({
  meta: { name: 'check', description: 'Check if a concept matches any existing out-of-scope entry' },
  args: {
    concept: { type: 'positional', required: true, description: 'Concept name to check' },
    description: { type: 'string', description: 'Optional description for fuzzy matching' },
  },
  run({ args }) {
    ensureDir(SCALE_DIR)
    const store = new OutOfScopeStore(SCALE_DIR)
    const match = store.check(args.concept, args.description)
    if (match) {
      console.log(JSON.stringify({ ok: true, matched: true, concept: match.concept, title: match.title, reason: match.reason, priorRequests: match.priorRequests }, null, 2))
    } else {
      console.log(JSON.stringify({ ok: true, matched: false }, null, 2))
    }
  },
})

const outOfScopeList = defineCommand({
  meta: { name: 'list', description: 'List all out-of-scope entries' },
  run() {
    ensureDir(SCALE_DIR)
    const store = new OutOfScopeStore(SCALE_DIR)
    const entries = store.list()
    console.log(JSON.stringify({ ok: true, total: entries.length, entries: entries.map(e => ({ concept: e.concept, title: e.title, priorRequests: e.priorRequests.length, updatedAt: new Date(e.updatedAt).toISOString() })) }, null, 2))
  },
})

const outOfScopeRemove = defineCommand({
  meta: { name: 'remove', description: 'Remove an out-of-scope entry (concept reconsidered)' },
  args: {
    concept: { type: 'positional', required: true, description: 'Concept name to remove' },
  },
  run({ args }) {
    ensureDir(SCALE_DIR)
    const store = new OutOfScopeStore(SCALE_DIR)
    const removed = store.remove(args.concept)
    console.log(JSON.stringify({ ok: removed, concept: args.concept }, null, 2))
  },
})

export const outOfScopeCommand = defineCommand({
  meta: { name: 'out-of-scope', description: 'Manage out-of-scope knowledge base (rejected concepts with institutional memory)' },
  subCommands: { add: outOfScopeAdd, check: outOfScopeCheck, list: outOfScopeList, remove: outOfScopeRemove },
})

// ============================================================================
// skill command
// ============================================================================

const skillScan = defineCommand({
  meta: { name: 'scan', description: 'Scan for installed skills' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    json: { type: 'boolean', default: false, description: 'Output scan result as JSON' },
  },
  async run({ args }) {
    const discovery = new SkillDiscovery(args.dir)
    const platform = discovery.detectPlatform()
    if (!platform && args.json) {
      console.log(JSON.stringify({
        ok: false,
        platform: null,
        skills: [],
        message: 'No agent platform detected. Run `scale init` first.',
      }, null, 2))
      return
    }

    if (!platform) {
      console.log('\n⚠️  No agent platform detected. Run `scale init` first.')
      return
    }

    const result = discovery.scanSkills(platform)
    if (args.json) {
      console.log(JSON.stringify({
        ok: true,
        platform: result.platform,
        count: result.skills.length,
        skills: result.skills,
      }, null, 2))
      return
    }
    console.log(`\n🔍 Platform: ${result.platform}`)
    console.log(`📦 Skills found: ${result.skills.length}`)

    if (result.skills.length > 0) {
      for (const skill of result.skills) {
        const status = skill.enabled ? '✅' : '❌'
        const desc = skill.description ? ` — ${skill.description}` : ''
        console.log(`  ${status} ${skill.name}${desc}`)
      }
    } else {
      console.log('  No skills found in platform skills directory.')
    }
  },
})

const skillPlanCommand = defineCommand({
  meta: { name: 'plan', description: 'Create or refresh a task skill plan' },
  args: {
    'task-id': { type: 'positional', required: true },
    dir: { type: 'string', description: 'Task artifact directory; defaults to current state artifactsDir' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const { store } = getEngine()
    const task = await store.get(args['task-id'])
    if (!task || task.type !== 'Task') {
      console.error(`Task not found: ${args['task-id']}`)
      process.exit(1)
    }

    const payload = task.payload as TaskPayload
    const level = normalizeTaskArtifactLevel(payload.workflowLevel ?? 'M')
    const policy = loadSkillRoutingPolicy(PROJECT_DIR, SCALE_DIR)
    const plan = createSkillPlan({
      taskId: task.id,
      taskName: task.title,
      description: payload.description,
      level,
      services: payload.servicesTouched ?? [],
      files: payload.filesInvolved ?? [],
      policy,
    })
    const updatedPayload: TaskPayload = {
      ...payload,
      skillIntents: plan.intents.map(intent => intent.domain),
      skillRoutingMode: plan.mode,
      skillPlanRequired: plan.required,
      requiredSkills: plan.requiredSkills,
      recommendedSkills: plan.recommendedSkills,
      requiredSkillArtifacts: plan.requiredArtifacts,
      requiredSkillVerification: plan.requiredVerification,
    }
    await store.update(task.id, { payload: updatedPayload })

    const state = new WorkflowArtifactWriter(SCALE_DIR).readCurrentState()
    const artifactsDir = args.dir ?? (state?.taskId === task.id ? state.artifactsDir : undefined)
    let writtenPath: string | undefined
    if (artifactsDir) {
      const dir = resolve(PROJECT_DIR, artifactsDir)
      ensureDir(dir)
      writtenPath = join(dir, 'skill-plan.md')
      writeFileSync(writtenPath, skillPlanMarkdown(plan), 'utf-8')
    }
    new WorkflowArtifactWriter(SCALE_DIR).updateCurrentState({
      taskId: task.id,
      level,
      phase: 'plan',
      artifactsDir,
      skillIntents: plan.intents.map(intent => intent.domain),
      skillRoutingMode: plan.mode,
      skillPlanRequired: plan.required,
      skillPlanPath: writtenPath,
      requiredSkills: plan.requiredSkills,
      recommendedSkills: plan.recommendedSkills,
      requiredSkillArtifacts: plan.requiredArtifacts,
      requiredSkillVerification: plan.requiredVerification,
    })

    if (args.json) {
      console.log(JSON.stringify({ plan, writtenPath }, null, 2))
      return
    }
    console.log('\nSkill Plan')
    console.log(`  Task: ${task.id}`)
    console.log(`  Intents: ${plan.intents.map(intent => intent.domain).join(', ') || 'none'}`)
    console.log(`  Required skills: ${plan.requiredSkills.join(', ') || 'none'}`)
    console.log(`  Recommended skills: ${plan.recommendedSkills.join(', ') || 'none'}`)
    console.log(`  Required artifacts: ${plan.requiredArtifacts.join(', ') || 'none'}`)
    if (writtenPath) console.log(`  Written: ${writtenPath}`)
  },
})

const skillDoctorCommand = defineCommand({
  meta: { name: 'doctor', description: 'Check workflow skill installation status' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'supply-chain': { type: 'boolean', default: false, description: 'Include supply-chain safety review for known skill sources' },
    json: { type: 'boolean', default: false, description: 'Output skill doctor report as JSON' },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const report = inspectWorkflowSkills({ projectDir })
    const supplyChain = isTruthyFlag(args['supply-chain']) ? inspectSkillSupplyChain({ projectDir }) : undefined
    if (args.json) {
      console.log(JSON.stringify(supplyChain ? { installation: report, supplyChain } : report, null, 2))
      return
    }
    console.log('\nSCALE Skill Doctor')
    console.log(`  Installed: ${report.installed}/${report.total}`)
    for (const skill of report.skills) {
      console.log(`  ${skill.installed ? '[OK]' : '[MISSING]'} ${skill.id}`)
      if (skill.detectedPath) console.log(`    path: ${skill.detectedPath}`)
      if (!skill.installed) console.log(`    install: ${skill.installCommand}`)
    }
    if (supplyChain) {
      console.log('\nSkill Supply Chain')
      console.log(`  Evaluated: ${supplyChain.evaluated}`)
      console.log(`  Blocked: ${supplyChain.blocked}`)
      console.log(`  Warnings: ${supplyChain.warnings}`)
      for (const entry of supplyChain.entries.filter(entry => entry.blocked || entry.findings.length > 0)) {
        console.log(`  [${entry.blocked ? 'BLOCKED' : 'WARN'}] ${entry.id}: ${entry.risk}`)
        for (const finding of entry.findings) console.log(`    - ${finding.rule}: ${finding.message}`)
      }
    }
    if (!report.ok || supplyChain?.ok === false) process.exitCode = 1
  },
})

const skillCheckCommand = defineCommand({
  meta: { name: 'check', description: 'Check required skill evidence artifacts' },
  args: {
    dir: { type: 'string', description: 'Task artifact directory; defaults to current state artifactsDir' },
    level: { type: 'string', description: 'Task level: S, M, L, or CRITICAL; defaults to current state level or M' },
    'require-installed': { type: 'boolean', default: false, description: 'Fail when required workflow skills are not installed locally' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const state = new WorkflowArtifactWriter(SCALE_DIR).readCurrentState()
    const level = normalizeTaskArtifactLevel(args.level ?? state?.level ?? 'M')
    const policy = loadSkillRoutingPolicy(PROJECT_DIR, SCALE_DIR)
    const result = evaluateSkillGate({
      projectDir: PROJECT_DIR,
      artifactsDir: args.dir ?? state?.artifactsDir,
      level,
      requiredArtifacts: state?.requiredSkillArtifacts,
      requiredSkills: state?.requiredSkills,
      mode: state?.skillRoutingMode ?? policy.policy.mode,
      enforceLevels: policy.policy.enforceLevels,
    })
    const skillInstallation = inspectRequiredWorkflowSkills(state?.requiredSkills ?? [], { projectDir: PROJECT_DIR })
    const requireInstalled = isTruthyFlag(args['require-installed'])
    const blocked = result.blocked || (requireInstalled && !skillInstallation.ok)
    const output = {
      ...result,
      complete: result.complete && (!requireInstalled || skillInstallation.ok),
      blocked,
      skillInstallation: {
        ...skillInstallation,
        checked: requireInstalled,
      },
    }

    if (args.json) {
      console.log(JSON.stringify(output, null, 2))
      return
    }
    console.log(`\nSkill Gate: ${output.complete ? 'COMPLETE' : 'INCOMPLETE'}`)
    console.log(`  Mode: ${output.mode}`)
    console.log(`  Required artifacts: ${output.required.join(', ') || 'none'}`)
    console.log(`  Required skills: ${skillInstallation.required.join(', ') || 'none'}`)
    for (const file of output.missing) console.log(`  [MISSING] ${file}`)
    for (const item of output.incomplete) console.log(`  [INCOMPLETE] ${item.file}: ${item.reason}`)
    if (requireInstalled && !skillInstallation.ok) {
      for (const skill of skillInstallation.skills.filter(skill => !skill.installed)) {
        console.log(`  [MISSING_SKILL] ${skill.id}: ${skill.installCommand}`)
      }
      for (const skill of skillInstallation.unknown) console.log(`  [UNKNOWN_SKILL] ${skill}`)
    }
    if (blocked) process.exitCode = 1
  },
})

const skillRepoCommand = defineCommand({
  meta: { name: 'repo', description: 'Show SCALE progressive skill repository guide' },
  args: {
    category: { type: 'string', description: 'Filter by category: ui/browser/desktop/testing/review/docs/agent-cli/role-library/discovery' },
    output: { type: 'string', alias: 'o', description: 'Write markdown guide to file' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    if (args.json) {
      console.log(JSON.stringify(listSkillRepositoryEntries(args.category ? { category: args.category as never } : undefined), null, 2))
      return
    }
    const markdown = renderSkillRepositoryMarkdown()
    if (args.output) {
      const outputPath = resolve(PROJECT_DIR, args.output)
      ensureDir(resolve(outputPath, '..'))
      writeFileSync(outputPath, markdown, 'utf-8')
      console.log(`[OK] Skill 仓库指南已生成: ${outputPath}`)
      return
    }
    console.log(markdown)
  },
})

const skillSafetyCommand = defineCommand({
  meta: { name: 'safety', description: 'Evaluate skill install command and source safety' },
  args: {
    source: { type: 'string', description: 'Skill source URL' },
    command: { type: 'string', description: 'Install command to review' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const report = evaluateSkillInstallSafety({
      sourceUrl: args.source,
      installCommand: args.command,
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log('\nSCALE Skill Safety')
    console.log(`  Risk: ${report.risk}`)
    console.log(`  Blocked: ${report.blocked}`)
    for (const finding of report.findings) {
      console.log(`  [${finding.severity.toUpperCase()}] ${finding.rule}: ${finding.message}`)
    }
    console.log('  Required checks:')
    for (const check of report.requiredChecks) console.log(`  - ${check}`)
    if (report.blocked) process.exitCode = 1
  },
})

const skillRadarCommand = defineCommand({
  meta: { name: 'radar', description: 'Recommend skills, MCP, and CLI capabilities with confidence, safety, and evidence requirements' },
  args: {
    task: { type: 'string', required: true, description: 'Task description' },
    phase: { type: 'string', description: 'Workflow phase' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    files: { type: 'string', description: 'Comma-separated changed or relevant files' },
    services: { type: 'string', description: 'Comma-separated services or modules' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    output: { type: 'string', alias: 'o', description: 'Write markdown report to file' },
    json: { type: 'boolean', default: false, description: 'Output radar report as JSON' },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const report = evaluateSkillRadar({
      projectDir,
      scaleDir,
      task: String(args.task),
      phase: args.phase ? String(args.phase) : undefined,
      level: String(args.level ?? 'M'),
      files: parseCommaList(args.files),
      services: parseCommaList(args.services),
    })

    if (args.output) {
      const outputPath = resolve(projectDir, String(args.output))
      ensureDir(dirname(outputPath))
      writeFileSync(outputPath, renderSkillRadarMarkdown(report), 'utf-8')
    }

    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }

    console.log('\nSCALE Skill Radar')
    console.log(`  Task: ${report.task}`)
    console.log(`  Level: ${report.level}`)
    console.log(`  Domains: ${report.detectedDomains.map(domain => `${domain.domain}:${domain.score}`).join(', ') || 'none'}`)
    console.log(`  Policy: ${report.policyMode}`)
    console.log(`  Tools: ${report.toolSummary.installed}/${report.toolSummary.total} installed`)
    for (const item of report.recommendations.slice(0, 8)) {
      console.log(`  [${item.action}] ${item.id} confidence=${item.confidence.toFixed(2)} safety=${item.safetyLevel}`)
      console.log(`    evidence: ${item.requiredEvidence.join(', ') || 'none'}`)
      if (item.safetyLevel === 'blocked' || item.action === 'suggest-fallback') console.log(`    fallback: ${item.fallback}`)
    }
    if (args.output) console.log(`  Report: ${resolve(projectDir, String(args.output))}`)
    if (!report.ok) process.exitCode = 1
  },
})

const skillRecommendCommand = defineCommand({
  meta: { name: 'recommend', description: 'Recommend a composable skill workflow for a task' },
  args: {
    task: { type: 'string', required: true, description: 'Task description' },
    phase: { type: 'string', description: 'Workflow phase' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const plan = recommendSkillWorkflow({
      description: args.task,
      phase: args.phase,
    })
    if (args.json) {
      console.log(JSON.stringify(plan, null, 2))
      return
    }
    console.log('\nSCALE Skill Recommendation')
    console.log(`  Primary: ${plan.primarySkills.join(', ') || 'none'}`)
    console.log(`  Supporting: ${plan.supportingSkills.join(', ') || 'none'}`)
    console.log(`  Safety required: ${plan.safetyRequired}`)
    console.log(`  Evidence: ${plan.requiredEvidence.join(', ') || 'none'}`)
    for (const reason of plan.rationale) console.log(`  - ${reason}`)
  },
})

const skillOutdatedCommand = defineCommand({
  meta: { name: 'outdated', description: 'List skill update surfaces without installing or upgrading anything' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = createThirdPartyUpdateReport('skill')
    if (args.json) {
      console.log(JSON.stringify({ ...report, projectDir: resolve(String(args.dir ?? PROJECT_DIR)) }, null, 2))
      return
    }
    console.log('\nSCALE Skill Outdated')
    console.log(`  Policy: ${report.policy}`)
    console.log(`  Skills: ${report.summary.total}`)
    console.log(`  Review required: ${report.reviewRequired}`)
    for (const entry of report.entries) {
      console.log(`  [${entry.updatePolicy}] ${entry.id} trust=${entry.trust} latest=${entry.latestVersion}`)
      if (entry.source) console.log(`    source: ${entry.source}`)
      console.log(`    reason: ${entry.reason}`)
    }
  },
})

export const skillCommand = defineCommand({
  meta: { name: 'skill', description: 'Skill discovery and management' },
  subCommands: {
    scan: skillScan,
    doctor: skillDoctorCommand,
    plan: skillPlanCommand,
    check: skillCheckCommand,
    repo: skillRepoCommand,
    safety: skillSafetyCommand,
    radar: skillRadarCommand,
    recommend: skillRecommendCommand,
    outdated: skillOutdatedCommand,
  },
})
