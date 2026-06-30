import { defineCommand } from 'citty'
import { resolve } from 'node:path'
import {
  AgentOsBridgeRegistry,
  AgentOsCapabilityRegistry,
  AgentOsCortexPromotionPipeline,
  AgentOsMultiAgentOrchestrator,
  AgentOsSmartShell,
  AgentOsTaskStore,
  buildAgentOsCapabilityReport,
  type AgentOsBridgeKind,
  type AgentOsCapabilityKind,
  type AgentOsCapabilitySideEffect,
  type AgentOsCapabilityStatus,
  type AgentOsCapabilityTrust,
  type AgentOsCompletionOutcome,
  type AgentOsTaskLevel,
  type AgentOsTaskStatus,
} from '../os/index.js'
import { RuntimeEvidenceLedger, type RuntimeEvidenceStatus } from '../runtime/index.js'
import { evaluateSkillRadar } from '../skills/SkillRadar.js'
import { PROJECT_DIR, resolveScaleDirForProject } from './engineBootstrap.js'

function parseCommaList(value: unknown): string[] {
  const raw = String(value ?? '').trim()
  if (!raw) return []
  return raw.split(',').map(item => item.trim()).filter(Boolean)
}

function normalizeLevel(value: unknown): AgentOsTaskLevel {
  const normalized = String(value ?? 'M').trim().toUpperCase()
  if (normalized === 'S' || normalized === 'M' || normalized === 'L' || normalized === 'CRITICAL') return normalized
  throw new Error(`Invalid task level "${String(value)}"; expected S, M, L, or CRITICAL.`)
}

function normalizeOutcome(value: unknown): AgentOsCompletionOutcome {
  const normalized = String(value ?? 'complete').trim()
  if (normalized === 'complete' || normalized === 'partial' || normalized === 'blocked' || normalized === 'cancelled') return normalized
  throw new Error(`Invalid completion outcome "${String(value)}"; expected complete, partial, blocked, or cancelled.`)
}

function normalizeStatus(value: unknown): AgentOsTaskStatus {
  const normalized = String(value ?? '').trim()
  const statuses: AgentOsTaskStatus[] = ['created', 'planned', 'running', 'waiting_for_approval', 'waiting_for_external_input', 'verifying', 'completed', 'partially_completed', 'blocked', 'cancelled']
  if (statuses.includes(normalized as AgentOsTaskStatus)) return normalized as AgentOsTaskStatus
  throw new Error(`Invalid task status "${String(value)}".`)
}

function normalizeStatusList(value: unknown): AgentOsTaskStatus[] {
  return parseCommaList(value).map(item => normalizeStatus(item))
}

function normalizeLevelList(value: unknown): AgentOsTaskLevel[] {
  return parseCommaList(value).map(item => normalizeLevel(item))
}

function normalizeCapabilityKind(value: unknown): AgentOsCapabilityKind {
  const normalized = String(value ?? 'connector').trim()
  const kinds: AgentOsCapabilityKind[] = ['skill', 'mcp', 'cli', 'provider', 'connector', 'browser', 'desktop']
  if (kinds.includes(normalized as AgentOsCapabilityKind)) return normalized as AgentOsCapabilityKind
  throw new Error(`Invalid capability kind "${String(value)}".`)
}

function normalizeCapabilityTrust(value: unknown): AgentOsCapabilityTrust {
  const normalized = String(value ?? 'review-required').trim()
  const trust: AgentOsCapabilityTrust[] = ['trusted', 'review-required', 'restricted', 'blocked']
  if (trust.includes(normalized as AgentOsCapabilityTrust)) return normalized as AgentOsCapabilityTrust
  throw new Error(`Invalid capability trust "${String(value)}".`)
}

function normalizeCapabilityStatus(value: unknown): AgentOsCapabilityStatus {
  const normalized = String(value ?? 'available').trim()
  const statuses: AgentOsCapabilityStatus[] = ['available', 'missing', 'disabled', 'blocked', 'degraded']
  if (statuses.includes(normalized as AgentOsCapabilityStatus)) return normalized as AgentOsCapabilityStatus
  throw new Error(`Invalid capability status "${String(value)}".`)
}

function normalizeCapabilitySideEffects(value: unknown): AgentOsCapabilitySideEffect[] {
  const allowed: AgentOsCapabilitySideEffect[] = ['read', 'write', 'network', 'process', 'credential', 'destructive']
  return parseCommaList(value).map(item => {
    if (allowed.includes(item as AgentOsCapabilitySideEffect)) return item as AgentOsCapabilitySideEffect
    throw new Error(`Invalid capability side effect "${item}".`)
  })
}

function normalizeBridgeKind(value: unknown): AgentOsBridgeKind {
  const normalized = String(value ?? 'connector').trim()
  const kinds: AgentOsBridgeKind[] = ['dashboard', 'tui', 'desktop', 'im', 'remote-agent', 'connector']
  if (kinds.includes(normalized as AgentOsBridgeKind)) return normalized as AgentOsBridgeKind
  throw new Error(`Invalid bridge kind "${String(value)}".`)
}

function parseJsonObject(value: unknown, name: string): Record<string, unknown> {
  if (value === undefined || value === null || String(value).trim() === '') return {}
  try {
    const parsed = JSON.parse(String(value)) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // handled below
  }
  throw new Error(`${name} must be a JSON object.`)
}

function taskStore(args: Record<string, unknown> = {}): AgentOsTaskStore {
  const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
  return new AgentOsTaskStore({
    projectDir,
    scaleDir: resolveScaleDirForProject(projectDir),
  })
}

function capabilityRegistry(args: Record<string, unknown> = {}): AgentOsCapabilityRegistry {
  const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
  return new AgentOsCapabilityRegistry({
    projectDir,
    scaleDir: resolveScaleDirForProject(projectDir),
  })
}

function bridgeRegistry(args: Record<string, unknown> = {}): AgentOsBridgeRegistry {
  const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
  return new AgentOsBridgeRegistry({
    projectDir,
    scaleDir: resolveScaleDirForProject(projectDir),
  })
}

function smartShell(args: Record<string, unknown> = {}): AgentOsSmartShell {
  const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
  return new AgentOsSmartShell({
    projectDir,
    scaleDir: resolveScaleDirForProject(projectDir),
  })
}

function multiAgentOrchestrator(args: Record<string, unknown> = {}): AgentOsMultiAgentOrchestrator {
  const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
  return new AgentOsMultiAgentOrchestrator({
    projectDir,
    scaleDir: resolveScaleDirForProject(projectDir),
  })
}

function cortexPromotionPipeline(args: Record<string, unknown> = {}): AgentOsCortexPromotionPipeline {
  const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
  return new AgentOsCortexPromotionPipeline({
    projectDir,
    scaleDir: resolveScaleDirForProject(projectDir),
  })
}

function runtimeEvidenceStatusForOutcome(outcome: AgentOsCompletionOutcome): RuntimeEvidenceStatus {
  if (outcome === 'complete' || outcome === 'partial') return 'passed'
  if (outcome === 'blocked') return 'failed'
  return 'skipped'
}

const taskCreate = defineCommand({
  meta: { name: 'create', description: 'Create a durable Agent OS task manifest' },
  args: {
    name: { type: 'positional', required: true, description: 'Task name' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'task-id': { type: 'string', description: 'Optional stable task id' },
    objective: { type: 'string', description: 'Task objective; defaults to name' },
    description: { type: 'string', description: 'Longer task description' },
    level: { type: 'string', default: 'M', description: 'S, M, L, or CRITICAL' },
    files: { type: 'string', description: 'Comma-separated relevant files' },
    services: { type: 'string', description: 'Comma-separated affected services' },
    surfaces: { type: 'string', description: 'Comma-separated surfaces such as cli,dashboard,agent-tool' },
    'metadata-json': { type: 'string', description: 'Additional JSON metadata' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const result = taskStore(args).create({
      taskId: args['task-id'] ? String(args['task-id']) : undefined,
      name: String(args.name),
      objective: args.objective ? String(args.objective) : undefined,
      description: args.description ? String(args.description) : undefined,
      level: normalizeLevel(args.level),
      files: parseCommaList(args.files),
      services: parseCommaList(args.services),
      surfaces: parseCommaList(args.surfaces),
      metadata: parseJsonObject(args['metadata-json'], '--metadata-json'),
    })
    if (args.json) {
      console.log(JSON.stringify(result.task, null, 2))
      return
    }
    console.log(`Agent OS task created: ${result.task.taskId}`)
    console.log(`  Name: ${result.task.name}`)
    console.log(`  Status: ${result.task.status}`)
    console.log(`  Level: ${result.task.level}`)
  },
})

const taskList = defineCommand({
  meta: { name: 'list', description: 'List durable Agent OS tasks' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    status: { type: 'string', description: 'Comma-separated task statuses' },
    level: { type: 'string', description: 'Comma-separated levels' },
    agent: { type: 'string', description: 'Filter by last agent' },
    surface: { type: 'string', description: 'Filter by surface' },
    service: { type: 'string', description: 'Filter by service' },
    file: { type: 'string', description: 'Filter by relevant file' },
    'updated-since': { type: 'string', description: 'ISO timestamp lower bound' },
    limit: { type: 'string', description: 'Maximum tasks to return' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const tasks = taskStore(args).list({
      status: normalizeStatusList(args.status),
      level: normalizeLevelList(args.level),
      agent: args.agent ? String(args.agent) : undefined,
      surface: args.surface ? String(args.surface) : undefined,
      service: args.service ? String(args.service) : undefined,
      file: args.file ? String(args.file) : undefined,
      updatedSince: args['updated-since'] ? String(args['updated-since']) : undefined,
      limit: args.limit ? Number.parseInt(String(args.limit), 10) : undefined,
    })
    if (args.json) {
      console.log(JSON.stringify({ total: tasks.length, tasks }, null, 2))
      return
    }
    console.log(`Agent OS tasks: ${tasks.length}`)
    for (const task of tasks) {
      console.log(`  [${task.status}] ${task.taskId}: ${task.name}`)
    }
  },
})

const taskStatus = defineCommand({
  meta: { name: 'status', description: 'Show Agent OS task state, run, checkpoints, and completion' },
  args: {
    'task-id': { type: 'positional', required: true, description: 'Task id' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const snapshot = taskStore(args).snapshot(String(args['task-id']))
    if (args.json) {
      console.log(JSON.stringify(snapshot, null, 2))
      return
    }
    console.log(`Agent OS task: ${snapshot.task.taskId}`)
    console.log(`  Name: ${snapshot.task.name}`)
    console.log(`  Status: ${snapshot.task.status}`)
    console.log(`  Run: ${snapshot.run?.runId ?? 'none'}`)
    console.log(`  Checkpoints: ${snapshot.checkpoints.length}`)
    console.log(`  Completion: ${snapshot.completion?.outcome ?? 'none'}`)
    if (snapshot.task.latestCheckpointId) console.log(`  Latest checkpoint: ${snapshot.task.latestCheckpointId}`)
  },
})

const taskStart = defineCommand({
  meta: { name: 'start', description: 'Start a durable Agent OS task run' },
  args: {
    'task-id': { type: 'positional', required: true, description: 'Task id' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'run-id': { type: 'string', description: 'Optional stable run id' },
    agent: { type: 'string', description: 'Agent name' },
    provider: { type: 'string', description: 'Model provider' },
    model: { type: 'string', description: 'Model id' },
    'context-pack-id': { type: 'string', description: 'Linked context pack id' },
    'metadata-json': { type: 'string', description: 'Additional JSON metadata' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const result = taskStore(args).start({
      taskId: String(args['task-id']),
      runId: args['run-id'] ? String(args['run-id']) : undefined,
      agent: args.agent ? String(args.agent) : undefined,
      provider: args.provider ? String(args.provider) : undefined,
      model: args.model ? String(args.model) : undefined,
      contextPackId: args['context-pack-id'] ? String(args['context-pack-id']) : undefined,
      metadata: parseJsonObject(args['metadata-json'], '--metadata-json'),
    })
    if (args.json) {
      console.log(JSON.stringify(result.record, null, 2))
      return
    }
    console.log(`Agent OS run started: ${result.record.runId}`)
    console.log(`  Task: ${result.record.taskId}`)
    console.log(`  Status: ${result.record.status}`)
  },
})

const taskCheckpoint = defineCommand({
  meta: { name: 'checkpoint', description: 'Create a resumable Agent OS checkpoint' },
  args: {
    'task-id': { type: 'positional', required: true, description: 'Task id' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'run-id': { type: 'string', description: 'Run id; defaults to current run' },
    summary: { type: 'string', required: true, description: 'Checkpoint summary' },
    completed: { type: 'string', description: 'Comma-separated completed steps' },
    remaining: { type: 'string', description: 'Comma-separated remaining steps' },
    approvals: { type: 'string', description: 'Comma-separated open approval ids' },
    evidence: { type: 'string', description: 'Comma-separated runtime/tool evidence ids' },
    'context-pack-id': { type: 'string', description: 'Linked context pack id' },
    'resume-prompt': { type: 'string', description: 'Explicit resume prompt' },
    'metadata-json': { type: 'string', description: 'Additional JSON metadata' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const result = taskStore(args).checkpoint({
      taskId: String(args['task-id']),
      runId: args['run-id'] ? String(args['run-id']) : undefined,
      summary: String(args.summary),
      completedSteps: parseCommaList(args.completed),
      remainingSteps: parseCommaList(args.remaining),
      openApprovals: parseCommaList(args.approvals),
      evidenceIds: parseCommaList(args.evidence),
      contextPackId: args['context-pack-id'] ? String(args['context-pack-id']) : undefined,
      resumePrompt: args['resume-prompt'] ? String(args['resume-prompt']) : undefined,
      metadata: parseJsonObject(args['metadata-json'], '--metadata-json'),
    })
    if (args.json) {
      console.log(JSON.stringify(result.record, null, 2))
      return
    }
    console.log(`Agent OS checkpoint created: ${result.record.checkpointId}`)
    console.log(`  Task: ${result.record.taskId}`)
    console.log(`  Run: ${result.record.runId}`)
  },
})

const taskResume = defineCommand({
  meta: { name: 'resume', description: 'Resume an Agent OS task from a checkpoint' },
  args: {
    'task-id': { type: 'positional', required: true, description: 'Task id' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'checkpoint-id': { type: 'string', description: 'Checkpoint id; latest checkpoint is used when omitted' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const result = taskStore(args).resume({
      taskId: String(args['task-id']),
      checkpointId: args['checkpoint-id'] ? String(args['checkpoint-id']) : undefined,
    })
    if (args.json) {
      console.log(JSON.stringify({ checkpoint: result.record, task: result.task, resumePrompt: result.record.resumePrompt }, null, 2))
      return
    }
    console.log(`Agent OS task resumed: ${result.task.taskId}`)
    console.log(`  Checkpoint: ${result.record.checkpointId}`)
    console.log('  Resume prompt:')
    console.log(result.record.resumePrompt)
  },
})

const taskComplete = defineCommand({
  meta: { name: 'complete', description: 'Record explicit Agent OS task completion; this is the complete_task contract' },
  args: {
    'task-id': { type: 'positional', required: true, description: 'Task id' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'run-id': { type: 'string', description: 'Run id; defaults to current run' },
    outcome: { type: 'string', default: 'complete', description: 'complete, partial, blocked, or cancelled' },
    summary: { type: 'string', required: true, description: 'Completion summary' },
    evidence: { type: 'string', description: 'Comma-separated evidence ids to link' },
    'changed-files': { type: 'string', description: 'Comma-separated changed files' },
    validation: { type: 'string', description: 'Comma-separated validation commands or checks' },
    'residual-risk': { type: 'string', description: 'Residual risk or unverified scope' },
    'next-actions': { type: 'string', description: 'Comma-separated next actions' },
    'metadata-json': { type: 'string', description: 'Additional JSON metadata' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const outcome = normalizeOutcome(args.outcome)
    const evidenceRecord = new RuntimeEvidenceLedger({ projectDir, scaleDir }).record({
      taskId: String(args['task-id']),
      sessionId: args['run-id'] ? String(args['run-id']) : undefined,
      kind: 'final-report',
      title: 'Agent OS completion signal',
      status: runtimeEvidenceStatusForOutcome(outcome),
      summary: String(args.summary),
      artifacts: parseCommaList(args['changed-files']),
      metadata: {
        outcome,
        residualRisk: args['residual-risk'] ? String(args['residual-risk']) : undefined,
        validation: parseCommaList(args.validation),
      },
    })
    const result = new AgentOsTaskStore({ projectDir, scaleDir }).complete({
      taskId: String(args['task-id']),
      runId: args['run-id'] ? String(args['run-id']) : undefined,
      outcome,
      summary: String(args.summary),
      evidenceIds: [...parseCommaList(args.evidence), evidenceRecord.id],
      changedFiles: parseCommaList(args['changed-files']),
      validation: parseCommaList(args.validation),
      residualRisk: args['residual-risk'] ? String(args['residual-risk']) : undefined,
      nextActions: parseCommaList(args['next-actions']),
      metadata: parseJsonObject(args['metadata-json'], '--metadata-json'),
    })
    if (args.json) {
      console.log(JSON.stringify({ completion: result.record, task: result.task, evidence: evidenceRecord }, null, 2))
      if (outcome === 'blocked') process.exitCode = 1
      return
    }
    console.log(`Agent OS task completion recorded: ${result.record.completionId}`)
    console.log(`  Task: ${result.record.taskId}`)
    console.log(`  Outcome: ${result.record.outcome}`)
    console.log(`  Evidence: ${evidenceRecord.id}`)
    if (outcome === 'blocked') process.exitCode = 1
  },
})

export const taskCommand = defineCommand({
  meta: { name: 'task', description: 'Durable Agent OS task lifecycle, checkpoint, resume, and completion commands' },
  subCommands: {
    create: taskCreate,
    list: taskList,
    status: taskStatus,
    show: taskStatus,
    start: taskStart,
    checkpoint: taskCheckpoint,
    resume: taskResume,
    complete: taskComplete,
  },
})

const bridgeRegister = defineCommand({
  meta: { name: 'register', description: 'Register an Agent OS bridge or connector surface' },
  args: {
    name: { type: 'positional', required: true, description: 'Bridge name' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'bridge-id': { type: 'string', description: 'Stable bridge id' },
    kind: { type: 'string', default: 'connector', description: 'dashboard, tui, desktop, im, remote-agent, or connector' },
    endpoint: { type: 'string', description: 'Bridge endpoint' },
    token: { type: 'string', description: 'Optional caller-supplied bridge token' },
    scopes: { type: 'string', description: 'Comma-separated scopes' },
    capabilities: { type: 'string', description: 'Comma-separated capability ids' },
    'metadata-json': { type: 'string', description: 'Additional JSON metadata' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const result = bridgeRegistry(args).register({
      bridgeId: args['bridge-id'] ? String(args['bridge-id']) : undefined,
      name: String(args.name),
      kind: normalizeBridgeKind(args.kind),
      endpoint: args.endpoint ? String(args.endpoint) : undefined,
      token: args.token ? String(args.token) : undefined,
      scopes: parseCommaList(args.scopes),
      capabilityIds: parseCommaList(args.capabilities),
      metadata: parseJsonObject(args['metadata-json'], '--metadata-json'),
    })
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log(`Agent OS bridge registered: ${result.bridge.bridgeId}`)
    console.log(`  Name: ${result.bridge.name}`)
    console.log(`  Kind: ${result.bridge.kind}`)
    console.log(`  Token: ${result.token}`)
  },
})

const bridgeList = defineCommand({
  meta: { name: 'list', description: 'List Agent OS bridges' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const bridges = bridgeRegistry(args).list()
    if (args.json) {
      console.log(JSON.stringify({ total: bridges.length, bridges }, null, 2))
      return
    }
    console.log(`Agent OS bridges: ${bridges.length}`)
    for (const bridge of bridges) {
      console.log(`  [${bridge.status}] ${bridge.bridgeId}: ${bridge.name} (${bridge.kind})`)
    }
  },
})

const bridgeHeartbeat = defineCommand({
  meta: { name: 'heartbeat', description: 'Record a bridge heartbeat' },
  args: {
    'bridge-id': { type: 'positional', required: true, description: 'Bridge id' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    token: { type: 'string', description: 'Bridge token' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const result = bridgeRegistry(args).heartbeat(String(args['bridge-id']), args.token ? String(args.token) : undefined)
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log(`Agent OS bridge heartbeat: ${result.bridge.bridgeId}`)
    console.log(`  Status: ${result.bridge.status}`)
  },
})

export const bridgeCommand = defineCommand({
  meta: { name: 'bridge', description: 'Agent OS bridge registration, heartbeat, and connector management' },
  subCommands: {
    register: bridgeRegister,
    list: bridgeList,
    heartbeat: bridgeHeartbeat,
  },
})

const shellPlan = defineCommand({
  meta: { name: 'plan', description: 'Classify a shell command before execution' },
  args: {
    command: { type: 'positional', required: true, description: 'Command line to classify' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    cwd: { type: 'string', description: 'Command working directory' },
    'task-id': { type: 'string', description: 'Agent OS task id' },
    'session-id': { type: 'string', description: 'Agent OS session or run id' },
    approved: { type: 'boolean', default: false, description: 'Mark a high-risk command as explicitly approved' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const plan = smartShell(args).plan({
      command: String(args.command),
      cwd: args.cwd ? String(args.cwd) : undefined,
      taskId: args['task-id'] ? String(args['task-id']) : undefined,
      sessionId: args['session-id'] ? String(args['session-id']) : undefined,
      approved: Boolean(args.approved),
    })
    if (args.json) {
      console.log(JSON.stringify(plan, null, 2))
      return
    }
    console.log(`Agent OS shell plan: ${plan.risk}${plan.blocked ? ' (blocked)' : ''}`)
    for (const reason of plan.reasons) console.log(`  Reason: ${reason}`)
    for (const alternative of plan.saferAlternatives) console.log(`  Alternative: ${alternative}`)
  },
})

const shellRun = defineCommand({
  meta: { name: 'run', description: 'Run a governed shell command with command-run evidence' },
  args: {
    command: { type: 'positional', required: true, description: 'Command line to run' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    cwd: { type: 'string', description: 'Command working directory' },
    'task-id': { type: 'string', description: 'Agent OS task id' },
    'session-id': { type: 'string', description: 'Agent OS session or run id' },
    profile: { type: 'string', description: 'Verification profile or caller label' },
    timeout: { type: 'string', description: 'Timeout in milliseconds' },
    approved: { type: 'boolean', default: false, description: 'Explicit approval for high-risk commands' },
    'allow-shell': { type: 'boolean', default: false, description: 'Allow shell execution for trusted local commands' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const execution = await smartShell(args).run({
      command: String(args.command),
      cwd: args.cwd ? String(args.cwd) : undefined,
      taskId: args['task-id'] ? String(args['task-id']) : undefined,
      sessionId: args['session-id'] ? String(args['session-id']) : undefined,
      profile: args.profile ? String(args.profile) : undefined,
      timeoutMs: args.timeout ? Number(args.timeout) : undefined,
      approved: Boolean(args.approved),
      allowShell: Boolean(args['allow-shell']),
    })
    if (execution.status === 'blocked' || execution.status === 'failed') process.exitCode = 1
    if (args.json) {
      console.log(JSON.stringify(execution, null, 2))
      return
    }
    console.log(`Agent OS shell ${execution.status}: ${execution.plan.command}`)
    if (execution.evidence) console.log(`  Evidence: ${execution.evidence.id}`)
    for (const reason of execution.plan.reasons) console.log(`  Reason: ${reason}`)
  },
})

const shellList = defineCommand({
  meta: { name: 'list', description: 'List governed shell execution history' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    limit: { type: 'string', default: '50', description: 'Maximum executions to print' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const executions = smartShell(args).list(Number(args.limit ?? 50))
    if (args.json) {
      console.log(JSON.stringify({ total: executions.length, executions }, null, 2))
      return
    }
    console.log(`Agent OS shell executions: ${executions.length}`)
    for (const execution of executions) {
      console.log(`  [${execution.status}] ${execution.plan.risk}: ${execution.plan.command}`)
    }
  },
})

export const shellCommand = defineCommand({
  meta: { name: 'shell', description: 'Agent OS smart shell planning, execution supervision, and evidence' },
  subCommands: {
    plan: shellPlan,
    run: shellRun,
    list: shellList,
  },
})

const delegationDelegate = defineCommand({
  meta: { name: 'delegate', description: 'Create a persistent Agent OS multi-agent delegation from an AI OS plan' },
  args: {
    task: { type: 'positional', required: true, description: 'Task description' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'task-id': { type: 'string', description: 'Agent OS task id' },
    level: { type: 'string', default: 'M', description: 'S, M, L, or CRITICAL' },
    files: { type: 'string', description: 'Comma-separated files' },
    services: { type: 'string', description: 'Comma-separated services' },
    budget: { type: 'string', description: 'Token budget' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const result = await multiAgentOrchestrator(args).delegate({
      taskId: args['task-id'] ? String(args['task-id']) : undefined,
      task: String(args.task),
      level: normalizeLevel(args.level),
      files: parseCommaList(args.files),
      services: parseCommaList(args.services),
      budget: args.budget ? Number(args.budget) : undefined,
    })
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log(`Agent OS delegation: ${result.delegation.delegationId}`)
    console.log(`  Roles: ${result.delegation.assignments.length}`)
    console.log(`  Review gates: ${result.delegation.reviews.length}`)
  },
})

const delegationReview = defineCommand({
  meta: { name: 'review', description: 'Record an Agent OS delegation role or review-gate decision' },
  args: {
    'delegation-id': { type: 'positional', required: true, description: 'Delegation id' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'profile-id': { type: 'string', description: 'Role profile id to review' },
    'review-id': { type: 'string', description: 'Review gate id to review' },
    status: { type: 'string', default: 'accepted', description: 'accepted or rejected' },
    reason: { type: 'string', description: 'Review reason' },
    reviewer: { type: 'string', description: 'Reviewer id' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const status = String(args.status ?? 'accepted')
    if (status !== 'accepted' && status !== 'rejected') throw new Error('--status must be accepted or rejected')
    const result = multiAgentOrchestrator(args).review({
      delegationId: String(args['delegation-id']),
      profileId: args['profile-id'] ? String(args['profile-id']) : undefined,
      reviewId: args['review-id'] ? String(args['review-id']) : undefined,
      status,
      reason: args.reason ? String(args.reason) : undefined,
      reviewer: args.reviewer ? String(args.reviewer) : undefined,
    })
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log(`Agent OS delegation reviewed: ${result.delegation.delegationId}`)
    console.log(`  Status: ${result.delegation.status}`)
  },
})

const delegationList = defineCommand({
  meta: { name: 'list', description: 'List Agent OS multi-agent delegations' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    limit: { type: 'string', default: '50', description: 'Maximum delegations' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const delegations = multiAgentOrchestrator(args).list(Number(args.limit ?? 50))
    if (args.json) {
      console.log(JSON.stringify({ total: delegations.length, delegations }, null, 2))
      return
    }
    console.log(`Agent OS delegations: ${delegations.length}`)
    for (const delegation of delegations) {
      console.log(`  [${delegation.status}] ${delegation.delegationId}: ${delegation.assignments.length} role(s)`)
    }
  },
})

export const delegationCommand = defineCommand({
  meta: { name: 'delegation', description: 'Agent OS multi-agent delegation planning, assignment, and review' },
  subCommands: {
    delegate: delegationDelegate,
    review: delegationReview,
    list: delegationList,
  },
})

const cortexPromotionPropose = defineCommand({
  meta: { name: 'propose', description: 'Propose a Cortex shadow rule promotion candidate' },
  args: {
    title: { type: 'positional', required: true, description: 'Rule title' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    description: { type: 'string', default: '', description: 'Rule description' },
    pattern: { type: 'string', required: true, description: 'Pattern to watch in shadow mode' },
    rollback: { type: 'string', required: true, description: 'Rollback strategy' },
    source: { type: 'string', default: 'manual', description: 'failure-learning, lesson-extraction, or manual' },
    evidence: { type: 'string', description: 'Comma-separated source evidence ids' },
    enforcement: { type: 'string', default: 'prompt', description: 'prompt or hook' },
    'task-id': { type: 'string', description: 'Agent OS task id' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const result = cortexPromotionPipeline(args).propose({
      title: String(args.title),
      description: String(args.description ?? ''),
      pattern: String(args.pattern),
      rollback: String(args.rollback),
      source: String(args.source ?? 'manual') as 'failure-learning' | 'lesson-extraction' | 'manual',
      sourceEvidenceIds: parseCommaList(args.evidence),
      enforcement: String(args.enforcement ?? 'prompt') === 'hook' ? 'hook' : 'prompt',
      taskId: args['task-id'] ? String(args['task-id']) : undefined,
    })
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log(`Cortex shadow proposal: ${result.proposal.id}`)
  },
})

const cortexPromotionHit = defineCommand({
  meta: { name: 'hit', description: 'Record a Cortex shadow rule hit' },
  args: {
    'proposal-id': { type: 'positional', required: true, description: 'Proposal id' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    evidence: { type: 'string', description: 'Evidence id' },
    'false-positive': { type: 'boolean', default: false, description: 'Record as false positive' },
    'task-id': { type: 'string', description: 'Agent OS task id' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const result = cortexPromotionPipeline(args).recordShadowHit({
      proposalId: String(args['proposal-id']),
      evidenceId: args.evidence ? String(args.evidence) : undefined,
      falsePositive: Boolean(args['false-positive']),
      taskId: args['task-id'] ? String(args['task-id']) : undefined,
    })
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log(`Cortex shadow hit: ${result.proposal.id} (${result.proposal.maturity.shadowHits})`)
  },
})

const cortexPromotionApprove = defineCommand({
  meta: { name: 'approve', description: 'Approve an eligible Cortex shadow rule for blocking enforcement' },
  args: {
    'proposal-id': { type: 'positional', required: true, description: 'Proposal id' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    reviewer: { type: 'string', default: 'agent-os-cortex-reviewer', description: 'Approver id' },
    'task-id': { type: 'string', description: 'Agent OS task id' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const result = cortexPromotionPipeline(args).approve({
      proposalId: String(args['proposal-id']),
      approvedBy: String(args.reviewer ?? 'agent-os-cortex-reviewer'),
      taskId: args['task-id'] ? String(args['task-id']) : undefined,
    })
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log(`Cortex promotion approved: ${result.proposal.id}`)
  },
})

const cortexPromotionList = defineCommand({
  meta: { name: 'list', description: 'List Cortex promotion proposals' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const pipeline = cortexPromotionPipeline(args)
    const proposals = pipeline.list()
    if (args.json) {
      console.log(JSON.stringify({ total: proposals.length, proposals, report: pipeline.evaluate() }, null, 2))
      return
    }
    console.log(`Cortex promotion proposals: ${proposals.length}`)
    for (const proposal of proposals) {
      console.log(`  [${proposal.maturity.stage}] ${proposal.id}: ${proposal.title}`)
    }
  },
})

export const cortexPromotionCommand = defineCommand({
  meta: { name: 'cortex-promotion', description: 'Agent OS Cortex shadow promotion pipeline' },
  subCommands: {
    propose: cortexPromotionPropose,
    hit: cortexPromotionHit,
    approve: cortexPromotionApprove,
    list: cortexPromotionList,
  },
})

const capabilityList = defineCommand({
  meta: { name: 'list', description: 'List Agent OS capability descriptors' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    capabilities: { type: 'string', description: 'Comma-separated capability ids' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const report = buildAgentOsCapabilityReport({
      projectDir,
      scaleDir: resolveScaleDirForProject(projectDir),
      capabilityIds: parseCommaList(args.capabilities),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log('Agent OS capabilities')
    console.log(`  Available: ${report.summary.available}/${report.summary.total}`)
    console.log(`  Missing: ${report.summary.missing}; blocked: ${report.summary.blocked}; approval required: ${report.summary.approvalRequired}`)
    for (const descriptor of report.descriptors) {
      console.log(`  [${descriptor.status}] ${descriptor.id} (${descriptor.kind}) trust=${descriptor.trust}`)
    }
  },
})

const capabilityDoctor = defineCommand({
  meta: { name: 'doctor', description: 'Check Agent OS capability health and policy readiness' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    capabilities: { type: 'string', description: 'Comma-separated capability ids' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const report = buildAgentOsCapabilityReport({
      projectDir,
      scaleDir: resolveScaleDirForProject(projectDir),
      capabilityIds: parseCommaList(args.capabilities),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log('Agent OS capability doctor')
    console.log(`  Status: ${report.ok ? 'ready' : 'attention'}`)
    console.log(`  Available: ${report.summary.available}/${report.summary.total}`)
    for (const descriptor of report.descriptors) {
      console.log(`  [${descriptor.status}] ${descriptor.id}`)
      console.log(`    health: ${descriptor.healthCheck}`)
      console.log(`    evidence: ${descriptor.requiredEvidence.join(', ')}`)
      if (descriptor.missingReason) console.log(`    reason: ${descriptor.missingReason}`)
      if (descriptor.status !== 'available') console.log(`    fallback: ${descriptor.fallback}`)
    }
    if (!report.ok) process.exitCode = 1
  },
})

const capabilityMap = defineCommand({
  meta: { name: 'map', description: 'Map Agent OS capabilities to a task intent using Skill Radar signals' },
  args: {
    task: { type: 'string', required: true, description: 'Task description' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    phase: { type: 'string', description: 'Workflow phase' },
    level: { type: 'string', default: 'M', description: 'Task level' },
    files: { type: 'string', description: 'Comma-separated relevant files' },
    services: { type: 'string', description: 'Comma-separated services' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const radar = evaluateSkillRadar({
      projectDir,
      scaleDir,
      task: String(args.task),
      phase: args.phase ? String(args.phase) : undefined,
      level: String(args.level ?? 'M'),
      files: parseCommaList(args.files),
      services: parseCommaList(args.services),
    })
    const ids = radar.recommendations.map(item => item.id)
    const capabilities = buildAgentOsCapabilityReport({
      projectDir,
      scaleDir,
      capabilityIds: ids.length > 0 ? ids : undefined,
    })
    const report = {
      task: String(args.task),
      ok: radar.ok && capabilities.ok,
      detectedDomains: radar.detectedDomains,
      recommendations: radar.recommendations,
      capabilities,
      fallbacks: radar.fallbacks,
    }
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log('Agent OS capability map')
    console.log(`  Task: ${report.task}`)
    console.log(`  Domains: ${report.detectedDomains.map(domain => `${domain.domain}:${domain.score}`).join(', ') || 'none'}`)
    for (const descriptor of report.capabilities.descriptors) {
      console.log(`  [${descriptor.status}] ${descriptor.id} trust=${descriptor.trust} approval=${descriptor.approvalPolicy}`)
    }
    for (const fallback of report.fallbacks) console.log(`  fallback: ${fallback}`)
    if (!report.ok) process.exitCode = 1
  },
})

const capabilityRegister = defineCommand({
  meta: { name: 'register', description: 'Register a provider, connector, or custom Agent OS capability' },
  args: {
    id: { type: 'positional', required: true, description: 'Capability id' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    kind: { type: 'string', default: 'connector', description: 'skill, mcp, cli, provider, connector, browser, or desktop' },
    'display-name': { type: 'string', description: 'Display name' },
    status: { type: 'string', default: 'available', description: 'available, missing, disabled, blocked, or degraded' },
    trust: { type: 'string', default: 'review-required', description: 'trusted, review-required, restricted, or blocked' },
    'side-effects': { type: 'string', description: 'Comma-separated side effects' },
    evidence: { type: 'string', description: 'Comma-separated required evidence ids' },
    fallback: { type: 'string', description: 'Fallback guidance' },
    'health-check': { type: 'string', description: 'Health check command or URL' },
    source: { type: 'string', description: 'Capability source' },
    'project-refs': { type: 'string', description: 'Comma-separated project references' },
    'required-for': { type: 'string', description: 'Comma-separated requiredFor tags' },
    'recommended-for': { type: 'string', description: 'Comma-separated recommendedFor tags' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const sideEffects = normalizeCapabilitySideEffects(args['side-effects'])
    const descriptor = capabilityRegistry(args).register({
      id: String(args.id),
      kind: normalizeCapabilityKind(args.kind),
      displayName: args['display-name'] ? String(args['display-name']) : undefined,
      status: normalizeCapabilityStatus(args.status),
      trust: normalizeCapabilityTrust(args.trust),
      sideEffects: sideEffects.length > 0 ? sideEffects : undefined,
      requiredEvidence: parseCommaList(args.evidence),
      fallback: args.fallback ? String(args.fallback) : undefined,
      healthCheck: args['health-check'] ? String(args['health-check']) : undefined,
      source: args.source ? String(args.source) : undefined,
      projectRefs: parseCommaList(args['project-refs']),
      requiredFor: parseCommaList(args['required-for']),
      recommendedFor: parseCommaList(args['recommended-for']),
    })
    if (args.json) {
      console.log(JSON.stringify(descriptor, null, 2))
      return
    }
    console.log(`Agent OS capability registered: ${descriptor.id}`)
    console.log(`  Kind: ${descriptor.kind}`)
    console.log(`  Status: ${descriptor.status}`)
    console.log(`  Trust: ${descriptor.trust}`)
  },
})

const capabilityTrust = defineCommand({
  meta: { name: 'trust', description: 'Update trust for a registered Agent OS capability' },
  args: {
    id: { type: 'positional', required: true, description: 'Capability id' },
    trust: { type: 'positional', default: 'trusted', description: 'trusted, review-required, restricted, or blocked' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const descriptor = capabilityRegistry(args).trust(String(args.id), normalizeCapabilityTrust(args.trust))
    if (args.json) {
      console.log(JSON.stringify(descriptor, null, 2))
      return
    }
    console.log(`Agent OS capability trust updated: ${descriptor.id} -> ${descriptor.trust}`)
  },
})

const capabilityDisable = defineCommand({
  meta: { name: 'disable', description: 'Disable a registered Agent OS capability' },
  args: {
    id: { type: 'positional', required: true, description: 'Capability id' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    reason: { type: 'string', description: 'Disable reason' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const descriptor = capabilityRegistry(args).disable(String(args.id), args.reason ? String(args.reason) : undefined)
    if (args.json) {
      console.log(JSON.stringify(descriptor, null, 2))
      return
    }
    console.log(`Agent OS capability disabled: ${descriptor.id}`)
  },
})

export const capabilityCommand = defineCommand({
  meta: { name: 'capability', description: 'Agent OS capability discovery, health, trust, and task mapping' },
  subCommands: {
    list: capabilityList,
    doctor: capabilityDoctor,
    map: capabilityMap,
    register: capabilityRegister,
    trust: capabilityTrust,
    disable: capabilityDisable,
  },
})
