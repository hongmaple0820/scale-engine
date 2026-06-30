import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { ExecutionLedger, type ExecutionEvent } from '../runtime/ExecutionLedger.js'

export type AgentOsTaskLevel = 'S' | 'M' | 'L' | 'CRITICAL'

export type AgentOsTaskStatus =
  | 'created'
  | 'planned'
  | 'running'
  | 'waiting_for_approval'
  | 'waiting_for_external_input'
  | 'verifying'
  | 'completed'
  | 'partially_completed'
  | 'blocked'
  | 'cancelled'

export type AgentOsRunStatus = 'planned' | 'running' | 'completed' | 'blocked' | 'cancelled'
export type AgentOsCompletionOutcome = 'complete' | 'partial' | 'blocked' | 'cancelled'

export interface AgentOsTaskManifest {
  version: 1
  schemaVersion: 'agent-os-task-v1.1'
  taskId: string
  correlationId: string
  name: string
  objective: string
  description?: string
  level: AgentOsTaskLevel
  status: AgentOsTaskStatus
  projectDir: string
  createdAt: string
  updatedAt: string
  files: string[]
  services: string[]
  surfaces: string[]
  currentRunId?: string
  latestCheckpointId?: string
  completionId?: string
  evidenceIds: string[]
  metadata: Record<string, unknown>
}

export interface AgentOsRunManifest {
  version: 1
  schemaVersion: 'agent-os-run-v1.1'
  runId: string
  taskId: string
  correlationId: string
  status: AgentOsRunStatus
  agent?: string
  provider?: string
  model?: string
  contextPackId?: string
  startedAt: string
  updatedAt: string
  completedAt?: string
  evidenceIds: string[]
  checkpointIds: string[]
  metadata: Record<string, unknown>
}

export interface AgentOsCheckpoint {
  version: 1
  schemaVersion: 'agent-os-checkpoint-v1.1'
  checkpointId: string
  taskId: string
  runId: string
  correlationId: string
  createdAt: string
  summary: string
  state: AgentOsTaskStatus
  completedSteps: string[]
  remainingSteps: string[]
  openApprovals: string[]
  evidenceIds: string[]
  contextPackId?: string
  resumePrompt: string
  metadata: Record<string, unknown>
}

export interface AgentOsCompletionRecord {
  version: 1
  schemaVersion: 'agent-os-completion-v1.1'
  completionId: string
  taskId: string
  runId?: string
  correlationId: string
  completedAt: string
  outcome: AgentOsCompletionOutcome
  summary: string
  evidenceIds: string[]
  changedFiles: string[]
  validation: string[]
  residualRisk?: string
  nextActions: string[]
  metadata: Record<string, unknown>
}

export interface AgentOsTaskStoreOptions {
  projectDir?: string
  scaleDir?: string
  now?: () => Date
  createDirs?: boolean
  ledger?: ExecutionLedger
}

export interface CreateAgentOsTaskInput {
  taskId?: string
  name: string
  objective?: string
  description?: string
  level?: AgentOsTaskLevel
  files?: string[]
  services?: string[]
  surfaces?: string[]
  metadata?: Record<string, unknown>
}

export interface StartAgentOsTaskInput {
  taskId: string
  runId?: string
  agent?: string
  provider?: string
  model?: string
  contextPackId?: string
  metadata?: Record<string, unknown>
}

export interface CreateAgentOsCheckpointInput {
  taskId: string
  runId?: string
  summary: string
  completedSteps?: string[]
  remainingSteps?: string[]
  openApprovals?: string[]
  evidenceIds?: string[]
  contextPackId?: string
  resumePrompt?: string
  metadata?: Record<string, unknown>
}

export interface CompleteAgentOsTaskInput {
  taskId: string
  runId?: string
  outcome?: AgentOsCompletionOutcome
  summary: string
  evidenceIds?: string[]
  changedFiles?: string[]
  validation?: string[]
  residualRisk?: string
  nextActions?: string[]
  metadata?: Record<string, unknown>
}

export interface ResumeAgentOsTaskInput {
  taskId: string
  checkpointId?: string
}

export interface AgentOsTaskSnapshot {
  task: AgentOsTaskManifest
  run?: AgentOsRunManifest
  checkpoints: AgentOsCheckpoint[]
  completion?: AgentOsCompletionRecord
  timeline: AgentOsTimelineEntry[]
}

export interface AgentOsTaskMutationResult<T> {
  record: T
  task: AgentOsTaskManifest
  event?: ExecutionEvent
}

export interface ListAgentOsTasksFilter {
  status?: AgentOsTaskStatus | AgentOsTaskStatus[]
  level?: AgentOsTaskLevel | AgentOsTaskLevel[]
  agent?: string
  surface?: string
  service?: string
  file?: string
  updatedSince?: string
  limit?: number
}

export type AgentOsTimelineEntryKind = 'event' | 'run' | 'checkpoint' | 'completion'

export interface AgentOsTimelineEntry {
  id: string
  taskId: string
  correlationId: string
  kind: AgentOsTimelineEntryKind
  type: string
  at: string
  summary: string
  status?: string
  sourceId?: string
  metadata: Record<string, unknown>
}

const DEFAULT_AGENT_ID = 'scale-agent-os'
const DEFAULT_SESSION_ID = 'agent-os'

export class AgentOsTaskStore {
  private projectDir: string
  private scaleRoot: string
  private tasksRoot: string
  private now: () => Date
  private ledger: ExecutionLedger

  constructor(options: AgentOsTaskStoreOptions = {}) {
    this.projectDir = resolve(options.projectDir ?? process.cwd())
    this.scaleRoot = isAbsolute(options.scaleDir ?? '')
      ? options.scaleDir as string
      : join(this.projectDir, options.scaleDir ?? '.scale')
    this.tasksRoot = join(this.scaleRoot, 'tasks')
    this.now = options.now ?? (() => new Date())
    this.ledger = options.ledger ?? new ExecutionLedger({
      projectDir: this.projectDir,
      scaleDir: this.scaleRoot,
      now: this.now,
      createDirs: options.createDirs,
    })
    if (options.createDirs !== false) mkdirSync(this.tasksRoot, { recursive: true })
  }

  create(input: CreateAgentOsTaskInput): AgentOsTaskMutationResult<AgentOsTaskManifest> {
    const taskId = input.taskId?.trim() || createId('TASK')
    const now = this.isoNow()
    const task: AgentOsTaskManifest = {
      version: 1,
      schemaVersion: 'agent-os-task-v1.1',
      taskId,
      correlationId: createCorrelationId(taskId),
      name: input.name,
      objective: input.objective?.trim() || input.name,
      description: input.description,
      level: input.level ?? 'M',
      status: 'created',
      projectDir: this.projectDir,
      createdAt: now,
      updatedAt: now,
      files: unique(input.files ?? []),
      services: unique(input.services ?? []),
      surfaces: unique(input.surfaces ?? ['cli', 'agent-tool']),
      evidenceIds: [],
      metadata: input.metadata ?? {},
    }
    this.ensureTaskDirs(taskId)
    this.writeTask(task)
    const event = this.recordEvent({
      agentId: DEFAULT_AGENT_ID,
      sessionId: DEFAULT_SESSION_ID,
      taskId,
      type: 'task.created',
      summary: `Created Agent OS task ${task.name}`,
      metadata: { correlationId: task.correlationId, level: task.level, files: task.files, services: task.services },
    })
    return { record: task, task, event }
  }

  get(taskId: string): AgentOsTaskManifest | null {
    const raw = readJson<Partial<AgentOsTaskManifest>>(this.taskFile(taskId))
    return raw ? normalizeTask(raw, this.projectDir) : null
  }

  list(filter: ListAgentOsTasksFilter = {}): AgentOsTaskManifest[] {
    if (!existsSync(this.tasksRoot)) return []
    const tasks = readdirSync(this.tasksRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => this.get(entry.name))
      .filter((task): task is AgentOsTaskManifest => Boolean(task))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    return applyTaskFilter(tasks, filter)
  }

  snapshot(taskId: string): AgentOsTaskSnapshot {
    const task = this.requireTask(taskId)
    return {
      task,
      run: task.currentRunId ? this.getRun(taskId, task.currentRunId) ?? undefined : undefined,
      checkpoints: this.listCheckpoints(taskId),
      completion: task.completionId ? this.getCompletion(taskId, task.completionId) ?? undefined : undefined,
      timeline: this.timeline(taskId),
    }
  }

  timeline(taskId: string): AgentOsTimelineEntry[] {
    const task = this.requireTask(taskId)
    const runs = this.listRuns(task.taskId).map(run => ({
      id: run.runId,
      taskId: task.taskId,
      correlationId: run.correlationId,
      kind: 'run' as const,
      type: `run.${run.status}`,
      at: run.startedAt,
      summary: `Run ${run.runId} ${run.status}`,
      status: run.status,
      sourceId: run.runId,
      metadata: {
        agent: run.agent,
        provider: run.provider,
        model: run.model,
        evidenceIds: run.evidenceIds,
      },
    }))
    const checkpoints = this.listCheckpoints(task.taskId).map(checkpoint => ({
      id: checkpoint.checkpointId,
      taskId: task.taskId,
      correlationId: checkpoint.correlationId,
      kind: 'checkpoint' as const,
      type: 'task.checkpointed',
      at: checkpoint.createdAt,
      summary: checkpoint.summary,
      status: checkpoint.state,
      sourceId: checkpoint.checkpointId,
      metadata: {
        runId: checkpoint.runId,
        completedSteps: checkpoint.completedSteps,
        remainingSteps: checkpoint.remainingSteps,
        openApprovals: checkpoint.openApprovals,
        evidenceIds: checkpoint.evidenceIds,
      },
    }))
    const completions = this.listCompletions(task.taskId).map(completion => ({
      id: completion.completionId,
      taskId: task.taskId,
      correlationId: completion.correlationId,
      kind: 'completion' as const,
      type: `task.${completion.outcome}`,
      at: completion.completedAt,
      summary: completion.summary,
      status: completion.outcome,
      sourceId: completion.completionId,
      metadata: {
        runId: completion.runId,
        evidenceIds: completion.evidenceIds,
        changedFiles: completion.changedFiles,
        validation: completion.validation,
        residualRisk: completion.residualRisk,
      },
    }))
    const events = this.ledger.query({ taskId: task.taskId }).map(event => ({
      id: event.id,
      taskId: task.taskId,
      correlationId: String(event.metadata?.correlationId ?? task.correlationId),
      kind: 'event' as const,
      type: event.type,
      at: event.ts,
      summary: event.summary,
      sourceId: event.id,
      metadata: event.metadata ?? {},
    }))
    return [...runs, ...checkpoints, ...completions, ...events]
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id))
  }

  start(input: StartAgentOsTaskInput): AgentOsTaskMutationResult<AgentOsRunManifest> {
    const task = this.requireTask(input.taskId)
    const now = this.isoNow()
    const run: AgentOsRunManifest = {
      version: 1,
      schemaVersion: 'agent-os-run-v1.1',
      runId: input.runId?.trim() || createId('RUN'),
      taskId: task.taskId,
      correlationId: task.correlationId,
      status: 'running',
      agent: input.agent,
      provider: input.provider,
      model: input.model,
      contextPackId: input.contextPackId,
      startedAt: now,
      updatedAt: now,
      evidenceIds: [],
      checkpointIds: [],
      metadata: input.metadata ?? {},
    }
    this.writeRun(run)
    const updated = this.updateTask(task.taskId, {
      status: 'running',
      currentRunId: run.runId,
      metadata: {
        ...task.metadata,
        lastAgent: input.agent,
        lastProvider: input.provider,
        lastModel: input.model,
      },
    })
    const event = this.recordEvent({
      agentId: input.agent ?? DEFAULT_AGENT_ID,
      sessionId: run.runId,
      taskId: task.taskId,
      type: 'task.started',
      summary: `Started Agent OS task run ${run.runId}`,
      metadata: { correlationId: task.correlationId, runId: run.runId, provider: input.provider, model: input.model, contextPackId: input.contextPackId },
    })
    return { record: run, task: updated, event }
  }

  checkpoint(input: CreateAgentOsCheckpointInput): AgentOsTaskMutationResult<AgentOsCheckpoint> {
    const task = this.requireTask(input.taskId)
    const runId = input.runId ?? task.currentRunId
    if (!runId) throw new Error(`Task ${task.taskId} has no active run. Start it before checkpointing.`)
    const run = this.requireRun(task.taskId, runId)
    const checkpoint: AgentOsCheckpoint = {
      version: 1,
      schemaVersion: 'agent-os-checkpoint-v1.1',
      checkpointId: createId('CKP'),
      taskId: task.taskId,
      runId,
      correlationId: task.correlationId,
      createdAt: this.isoNow(),
      summary: input.summary,
      state: task.status,
      completedSteps: unique(input.completedSteps ?? []),
      remainingSteps: unique(input.remainingSteps ?? []),
      openApprovals: unique(input.openApprovals ?? []),
      evidenceIds: unique(input.evidenceIds ?? []),
      contextPackId: input.contextPackId ?? run.contextPackId,
      resumePrompt: input.resumePrompt ?? defaultResumePrompt(task, input.summary, input.remainingSteps ?? []),
      metadata: input.metadata ?? {},
    }
    this.writeCheckpoint(checkpoint)
    const updatedRun = this.updateRun({
      ...run,
      updatedAt: this.isoNow(),
      checkpointIds: unique([...run.checkpointIds, checkpoint.checkpointId]),
      evidenceIds: unique([...run.evidenceIds, ...checkpoint.evidenceIds]),
    })
    const updatedTask = this.updateTask(task.taskId, {
      latestCheckpointId: checkpoint.checkpointId,
      evidenceIds: unique([...task.evidenceIds, ...checkpoint.evidenceIds]),
    })
    const event = this.recordEvent({
      agentId: String(updatedRun.agent ?? DEFAULT_AGENT_ID),
      sessionId: runId,
      taskId: task.taskId,
      type: 'task.checkpointed',
      summary: `Checkpointed Agent OS task ${task.taskId}`,
      metadata: {
        checkpointId: checkpoint.checkpointId,
        correlationId: task.correlationId,
        completedSteps: checkpoint.completedSteps,
        remainingSteps: checkpoint.remainingSteps,
      },
    })
    return { record: checkpoint, task: updatedTask, event }
  }

  resume(input: ResumeAgentOsTaskInput): AgentOsTaskMutationResult<AgentOsCheckpoint> {
    const task = this.requireTask(input.taskId)
    const checkpoint = input.checkpointId
      ? this.requireCheckpoint(task.taskId, input.checkpointId)
      : this.latestCheckpoint(task.taskId)
    if (!checkpoint) throw new Error(`Task ${task.taskId} has no checkpoint to resume.`)
    const run = this.requireRun(task.taskId, checkpoint.runId)
    this.updateRun({
      ...run,
      status: 'running',
      updatedAt: this.isoNow(),
    })
    const updatedTask = this.updateTask(task.taskId, {
      status: 'running',
      currentRunId: checkpoint.runId,
      latestCheckpointId: checkpoint.checkpointId,
    })
    const event = this.recordEvent({
      agentId: String(run.agent ?? DEFAULT_AGENT_ID),
      sessionId: checkpoint.runId,
      taskId: task.taskId,
      type: 'task.resumed',
      summary: `Resumed Agent OS task ${task.taskId} from ${checkpoint.checkpointId}`,
      metadata: { correlationId: task.correlationId, checkpointId: checkpoint.checkpointId, resumePrompt: checkpoint.resumePrompt },
    })
    return { record: checkpoint, task: updatedTask, event }
  }

  complete(input: CompleteAgentOsTaskInput): AgentOsTaskMutationResult<AgentOsCompletionRecord> {
    const task = this.requireTask(input.taskId)
    const runId = input.runId ?? task.currentRunId
    const outcome = input.outcome ?? 'complete'
    const validation = unique(input.validation ?? [])
    if ((outcome === 'complete' || outcome === 'partial') && validation.length === 0) {
      throw new Error(`Task ${task.taskId} cannot be marked ${outcome} without validation evidence.`)
    }
    const status = statusFromOutcome(outcome)
    const completion: AgentOsCompletionRecord = {
      version: 1,
      schemaVersion: 'agent-os-completion-v1.1',
      completionId: createId('DONE'),
      taskId: task.taskId,
      runId,
      correlationId: task.correlationId,
      completedAt: this.isoNow(),
      outcome,
      summary: input.summary,
      evidenceIds: unique(input.evidenceIds ?? []),
      changedFiles: unique(input.changedFiles ?? []),
      validation,
      residualRisk: input.residualRisk,
      nextActions: unique(input.nextActions ?? []),
      metadata: input.metadata ?? {},
    }
    this.writeCompletion(completion)
    if (runId) {
      const run = this.requireRun(task.taskId, runId)
      this.updateRun({
        ...run,
        status: runStatusFromOutcome(outcome),
        completedAt: completion.completedAt,
        updatedAt: completion.completedAt,
        evidenceIds: unique([...run.evidenceIds, ...completion.evidenceIds]),
      })
    }
    const updatedTask = this.updateTask(task.taskId, {
      status,
      completionId: completion.completionId,
      evidenceIds: unique([...task.evidenceIds, ...completion.evidenceIds]),
    })
    const event = this.recordEvent({
      agentId: DEFAULT_AGENT_ID,
      sessionId: runId ?? DEFAULT_SESSION_ID,
      taskId: task.taskId,
      type: outcome === 'blocked' ? 'task.blocked' : 'task.completed',
      summary: completion.summary,
      metadata: {
        completionId: completion.completionId,
        correlationId: task.correlationId,
        outcome,
        changedFiles: completion.changedFiles,
        validation: completion.validation,
        residualRisk: completion.residualRisk,
      },
    })
    return { record: completion, task: updatedTask, event }
  }

  getRun(taskId: string, runId: string): AgentOsRunManifest | null {
    const raw = readJson<Partial<AgentOsRunManifest>>(this.runFile(taskId, runId))
    return raw ? normalizeRun(raw, this.requireTask(taskId)) : null
  }

  listRuns(taskId: string): AgentOsRunManifest[] {
    const dir = this.runsDir(taskId)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter(file => file.endsWith('.json'))
      .map(file => readJson<Partial<AgentOsRunManifest>>(join(dir, file)))
      .filter((run): run is Partial<AgentOsRunManifest> => Boolean(run))
      .map(run => normalizeRun(run, this.requireTask(taskId)))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  }

  listCheckpoints(taskId: string): AgentOsCheckpoint[] {
    const dir = this.checkpointsDir(taskId)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter(file => file.endsWith('.json'))
      .map(file => readJson<Partial<AgentOsCheckpoint>>(join(dir, file)))
      .filter((checkpoint): checkpoint is Partial<AgentOsCheckpoint> => Boolean(checkpoint))
      .map(checkpoint => normalizeCheckpoint(checkpoint, this.requireTask(taskId)))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  }

  getCompletion(taskId: string, completionId: string): AgentOsCompletionRecord | null {
    const raw = readJson<Partial<AgentOsCompletionRecord>>(this.completionFile(taskId, completionId))
    return raw ? normalizeCompletion(raw, this.requireTask(taskId)) : null
  }

  listCompletions(taskId: string): AgentOsCompletionRecord[] {
    const dir = this.completionsDir(taskId)
    if (!existsSync(dir)) return []
    const task = this.requireTask(taskId)
    return readdirSync(dir)
      .filter(file => file.endsWith('.json'))
      .map(file => readJson<Partial<AgentOsCompletionRecord>>(join(dir, file)))
      .filter((completion): completion is Partial<AgentOsCompletionRecord> => Boolean(completion))
      .map(completion => normalizeCompletion(completion, task))
      .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
  }

  private updateTask(taskId: string, patch: Partial<Omit<AgentOsTaskManifest, 'taskId' | 'createdAt' | 'version'>>): AgentOsTaskManifest {
    const current = this.requireTask(taskId)
    const updated: AgentOsTaskManifest = {
      ...current,
      ...patch,
      updatedAt: this.isoNow(),
    }
    this.writeTask(updated)
    return updated
  }

  private updateRun(run: AgentOsRunManifest): AgentOsRunManifest {
    this.writeRun(run)
    return run
  }

  private requireTask(taskId: string): AgentOsTaskManifest {
    const task = this.get(taskId)
    if (!task) throw new Error(`Agent OS task not found: ${taskId}`)
    return task
  }

  private requireRun(taskId: string, runId: string): AgentOsRunManifest {
    const run = this.getRun(taskId, runId)
    if (!run) throw new Error(`Agent OS run not found: ${runId}`)
    return run
  }

  private requireCheckpoint(taskId: string, checkpointId: string): AgentOsCheckpoint {
    const checkpoint = readJson<AgentOsCheckpoint>(this.checkpointFile(taskId, checkpointId))
    if (!checkpoint) throw new Error(`Agent OS checkpoint not found: ${checkpointId}`)
    return checkpoint
  }

  private latestCheckpoint(taskId: string): AgentOsCheckpoint | undefined {
    return this.listCheckpoints(taskId)[0]
  }

  private writeTask(task: AgentOsTaskManifest): void {
    this.ensureTaskDirs(task.taskId)
    writeJson(this.taskFile(task.taskId), task)
  }

  private writeRun(run: AgentOsRunManifest): void {
    this.ensureTaskDirs(run.taskId)
    writeJson(this.runFile(run.taskId, run.runId), run)
  }

  private writeCheckpoint(checkpoint: AgentOsCheckpoint): void {
    this.ensureTaskDirs(checkpoint.taskId)
    writeJson(this.checkpointFile(checkpoint.taskId, checkpoint.checkpointId), checkpoint)
  }

  private writeCompletion(completion: AgentOsCompletionRecord): void {
    this.ensureTaskDirs(completion.taskId)
    writeJson(this.completionFile(completion.taskId, completion.completionId), completion)
  }

  private ensureTaskDirs(taskId: string): void {
    mkdirSync(this.taskDir(taskId), { recursive: true })
    mkdirSync(this.runsDir(taskId), { recursive: true })
    mkdirSync(this.checkpointsDir(taskId), { recursive: true })
    mkdirSync(this.completionsDir(taskId), { recursive: true })
  }

  private recordEvent(event: Omit<ExecutionEvent, 'id' | 'ts'>): ExecutionEvent {
    return this.ledger.record(event)
  }

  private taskDir(taskId: string): string {
    return join(this.tasksRoot, safeId(taskId))
  }

  private taskFile(taskId: string): string {
    return join(this.taskDir(taskId), 'task.json')
  }

  private runsDir(taskId: string): string {
    return join(this.taskDir(taskId), 'runs')
  }

  private runFile(taskId: string, runId: string): string {
    return join(this.runsDir(taskId), `${safeId(runId)}.json`)
  }

  private checkpointsDir(taskId: string): string {
    return join(this.taskDir(taskId), 'checkpoints')
  }

  private checkpointFile(taskId: string, checkpointId: string): string {
    return join(this.checkpointsDir(taskId), `${safeId(checkpointId)}.json`)
  }

  private completionsDir(taskId: string): string {
    return join(this.taskDir(taskId), 'completions')
  }

  private completionFile(taskId: string, completionId: string): string {
    return join(this.completionsDir(taskId), `${safeId(completionId)}.json`)
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`
}

function createCorrelationId(taskId: string): string {
  return `CORR-${safeId(taskId)}-${randomUUID().slice(0, 8)}`
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function unique(items: string[]): string[] {
  return [...new Set(items.map(item => item.trim()).filter(Boolean))]
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return null
  }
}

function normalizeTask(raw: Partial<AgentOsTaskManifest>, projectDir: string): AgentOsTaskManifest {
  const taskId = String(raw.taskId ?? 'TASK-UNKNOWN')
  const now = new Date(0).toISOString()
  return {
    version: 1,
    schemaVersion: 'agent-os-task-v1.1',
    taskId,
    correlationId: raw.correlationId ?? createCorrelationId(taskId),
    name: String(raw.name ?? taskId),
    objective: String(raw.objective ?? raw.name ?? taskId),
    description: raw.description,
    level: normalizeLevel(raw.level),
    status: normalizeStatus(raw.status),
    projectDir: String(raw.projectDir ?? projectDir),
    createdAt: String(raw.createdAt ?? now),
    updatedAt: String(raw.updatedAt ?? raw.createdAt ?? now),
    files: unique(raw.files ?? []),
    services: unique(raw.services ?? []),
    surfaces: unique(raw.surfaces ?? ['cli', 'agent-tool']),
    currentRunId: raw.currentRunId,
    latestCheckpointId: raw.latestCheckpointId,
    completionId: raw.completionId,
    evidenceIds: unique(raw.evidenceIds ?? []),
    metadata: isRecord(raw.metadata) ? raw.metadata : {},
  }
}

function normalizeRun(raw: Partial<AgentOsRunManifest>, task: AgentOsTaskManifest): AgentOsRunManifest {
  const now = task.createdAt
  return {
    version: 1,
    schemaVersion: 'agent-os-run-v1.1',
    runId: String(raw.runId ?? 'RUN-UNKNOWN'),
    taskId: task.taskId,
    correlationId: raw.correlationId ?? task.correlationId,
    status: normalizeRunStatus(raw.status),
    agent: raw.agent,
    provider: raw.provider,
    model: raw.model,
    contextPackId: raw.contextPackId,
    startedAt: String(raw.startedAt ?? now),
    updatedAt: String(raw.updatedAt ?? raw.startedAt ?? now),
    completedAt: raw.completedAt,
    evidenceIds: unique(raw.evidenceIds ?? []),
    checkpointIds: unique(raw.checkpointIds ?? []),
    metadata: isRecord(raw.metadata) ? raw.metadata : {},
  }
}

function normalizeCheckpoint(raw: Partial<AgentOsCheckpoint>, task: AgentOsTaskManifest): AgentOsCheckpoint {
  return {
    version: 1,
    schemaVersion: 'agent-os-checkpoint-v1.1',
    checkpointId: String(raw.checkpointId ?? 'CKP-UNKNOWN'),
    taskId: task.taskId,
    runId: String(raw.runId ?? task.currentRunId ?? 'RUN-UNKNOWN'),
    correlationId: raw.correlationId ?? task.correlationId,
    createdAt: String(raw.createdAt ?? task.updatedAt),
    summary: String(raw.summary ?? 'Checkpoint'),
    state: normalizeStatus(raw.state),
    completedSteps: unique(raw.completedSteps ?? []),
    remainingSteps: unique(raw.remainingSteps ?? []),
    openApprovals: unique(raw.openApprovals ?? []),
    evidenceIds: unique(raw.evidenceIds ?? []),
    contextPackId: raw.contextPackId,
    resumePrompt: String(raw.resumePrompt ?? defaultResumePrompt(task, String(raw.summary ?? 'Checkpoint'), raw.remainingSteps ?? [])),
    metadata: isRecord(raw.metadata) ? raw.metadata : {},
  }
}

function normalizeCompletion(raw: Partial<AgentOsCompletionRecord>, task: AgentOsTaskManifest): AgentOsCompletionRecord {
  return {
    version: 1,
    schemaVersion: 'agent-os-completion-v1.1',
    completionId: String(raw.completionId ?? 'DONE-UNKNOWN'),
    taskId: task.taskId,
    runId: raw.runId,
    correlationId: raw.correlationId ?? task.correlationId,
    completedAt: String(raw.completedAt ?? task.updatedAt),
    outcome: normalizeOutcome(raw.outcome),
    summary: String(raw.summary ?? 'Completion'),
    evidenceIds: unique(raw.evidenceIds ?? []),
    changedFiles: unique(raw.changedFiles ?? []),
    validation: unique(raw.validation ?? []),
    residualRisk: raw.residualRisk,
    nextActions: unique(raw.nextActions ?? []),
    metadata: isRecord(raw.metadata) ? raw.metadata : {},
  }
}

function applyTaskFilter(tasks: AgentOsTaskManifest[], filter: ListAgentOsTasksFilter): AgentOsTaskManifest[] {
  const statuses = arrayFilter(filter.status)
  const levels = arrayFilter(filter.level)
  const agent = filter.agent?.trim()
  const updatedSince = filter.updatedSince ? Date.parse(filter.updatedSince) : NaN
  return tasks
    .filter(task => statuses.length === 0 || statuses.includes(task.status))
    .filter(task => levels.length === 0 || levels.includes(task.level))
    .filter(task => !agent || task.metadata.lastAgent === agent)
    .filter(task => !filter.surface || task.surfaces.includes(filter.surface))
    .filter(task => !filter.service || task.services.includes(filter.service))
    .filter(task => !filter.file || task.files.includes(filter.file))
    .filter(task => !Number.isFinite(updatedSince) || Date.parse(task.updatedAt) >= updatedSince)
    .slice(0, filter.limit && filter.limit > 0 ? filter.limit : undefined)
}

function arrayFilter<T extends string>(value: T | T[] | undefined): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function normalizeLevel(value: unknown): AgentOsTaskLevel {
  const normalized = String(value ?? 'M').toUpperCase()
  if (normalized === 'S' || normalized === 'M' || normalized === 'L' || normalized === 'CRITICAL') return normalized
  return 'M'
}

function normalizeStatus(value: unknown): AgentOsTaskStatus {
  const normalized = String(value ?? 'created')
  const statuses: AgentOsTaskStatus[] = ['created', 'planned', 'running', 'waiting_for_approval', 'waiting_for_external_input', 'verifying', 'completed', 'partially_completed', 'blocked', 'cancelled']
  return statuses.includes(normalized as AgentOsTaskStatus) ? normalized as AgentOsTaskStatus : 'created'
}

function normalizeRunStatus(value: unknown): AgentOsRunStatus {
  const normalized = String(value ?? 'planned')
  const statuses: AgentOsRunStatus[] = ['planned', 'running', 'completed', 'blocked', 'cancelled']
  return statuses.includes(normalized as AgentOsRunStatus) ? normalized as AgentOsRunStatus : 'planned'
}

function normalizeOutcome(value: unknown): AgentOsCompletionOutcome {
  const normalized = String(value ?? 'complete')
  const outcomes: AgentOsCompletionOutcome[] = ['complete', 'partial', 'blocked', 'cancelled']
  return outcomes.includes(normalized as AgentOsCompletionOutcome) ? normalized as AgentOsCompletionOutcome : 'complete'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function defaultResumePrompt(task: AgentOsTaskManifest, summary: string, remainingSteps: string[]): string {
  const steps = remainingSteps.length > 0
    ? remainingSteps.map(step => `- ${step}`).join('\n')
    : '- inspect the latest task state and continue from the checkpoint'
  return [
    `Resume Agent OS task ${task.taskId}: ${task.name}`,
    '',
    `Checkpoint summary: ${summary}`,
    '',
    'Remaining steps:',
    steps,
    '',
    'Use task status, evidence, and changed files before continuing. Call complete_task when finished.',
  ].join('\n')
}

function statusFromOutcome(outcome: AgentOsCompletionOutcome): AgentOsTaskStatus {
  if (outcome === 'complete') return 'completed'
  if (outcome === 'partial') return 'partially_completed'
  if (outcome === 'cancelled') return 'cancelled'
  return 'blocked'
}

function runStatusFromOutcome(outcome: AgentOsCompletionOutcome): AgentOsRunStatus {
  if (outcome === 'complete' || outcome === 'partial') return 'completed'
  if (outcome === 'cancelled') return 'cancelled'
  return 'blocked'
}
