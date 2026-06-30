import { execFileSync } from 'node:child_process'
import { isAbsolute, join, resolve } from 'node:path'
import { AgentOsBridgeRegistry, type AgentOsBridgeRegistration } from './AgentOsBridgeRegistry.js'
import { AgentOsCortexPromotionPipeline } from './AgentOsCortexPromotionPipeline.js'
import { AgentOsMultiAgentOrchestrator, type AgentOsDelegationRecord } from './AgentOsMultiAgentOrchestrator.js'
import { AgentOsSmartShell, type AgentOsShellExecution } from './AgentOsSmartShell.js'
import {
  AgentOsTaskStore,
  type AgentOsTaskManifest,
  type AgentOsTaskSnapshot,
  type AgentOsTaskStatus,
  type AgentOsTimelineEntry,
} from './AgentOsTaskStore.js'
import {
  buildAgentOsCapabilityReport,
  type AgentOsCapabilityReport,
} from './CapabilityDescriptors.js'
import { ExecutionLedger, type ExecutionEvent } from '../runtime/ExecutionLedger.js'
import {
  RuntimeEvidenceLedger,
  type RuntimeEvidenceRecord,
  type RuntimeEvidenceSummary,
} from '../runtime/RuntimeEvidenceLedger.js'
import { MemoryBrain, type MemoryContradiction, type MemoryNode } from '../memory/MemoryBrain.js'

export interface AgentOsWorkbenchOptions {
  projectDir?: string
  scaleDir?: string
  projectName?: string
  now?: () => Date
}

export interface AgentOsWorkbenchInput {
  taskId?: string
  limit?: number
}

export interface AgentOsWorkbenchSnapshot {
  version: 1
  generatedAt: string
  project: {
    name?: string
    projectDir: string
    scaleDir: string
  }
  focus: {
    taskId?: string
  }
  summary: AgentOsWorkbenchSummary
  tasks: {
    total: number
    items: AgentOsTaskManifest[]
    focused?: AgentOsTaskSnapshot
  }
  timeline: AgentOsTimelineEntry[]
  capabilities: AgentOsCapabilityReport
  bridges: {
    total: number
    online: number
    stale: number
    registered: number
    revoked: number
    items: AgentOsBridgeRegistration[]
  }
  approvals: AgentOsWorkbenchApprovals
  evidence: {
    summary: RuntimeEvidenceSummary
    records: RuntimeEvidenceRecord[]
  }
  memory: {
    summary: {
      total: number
      active: number
      candidate: number
      stale: number
      rejected: number
      contradictions: number
    }
    contradictions: MemoryContradiction[]
    candidates: MemoryNode[]
  }
  contextPacks: AgentOsWorkbenchContextPack[]
  git: AgentOsWorkbenchGitStatus
  shell: {
    total: number
    blocked: number
    failed: number
    executions: AgentOsShellExecution[]
  }
  delegations: {
    total: number
    delegated: number
    reviewed: number
    items: AgentOsDelegationRecord[]
  }
  cortexPromotions: {
    total: number
    shadow: number
    candidateHook: number
    approvedBlocking: number
    report: ReturnType<AgentOsCortexPromotionPipeline['evaluate']>
  }
  panels: AgentOsWorkbenchPanel[]
  events: ExecutionEvent[]
}

export interface AgentOsWorkbenchSummary {
  tasks: Record<AgentOsTaskStatus, number> & { total: number }
  capabilities: {
    available: number
    total: number
    blocked: number
    approvalRequired: number
  }
  bridges: {
    total: number
    online: number
  }
  evidence: {
    total: number
    passed: number
    failed: number
    skipped: number
    ok: boolean
  }
  memory: {
    active: number
    candidate: number
    contradictions: number
  }
  git: {
    changedFiles: number
  }
  shell: {
    total: number
    blocked: number
    failed: number
  }
  delegations: {
    total: number
    delegated: number
    reviewed: number
  }
  cortexPromotions: {
    total: number
    approvedBlocking: number
  }
}

export interface AgentOsWorkbenchApproval {
  id: string
  taskId?: string
  runId?: string
  checkpointId?: string
  summary: string
  source: 'checkpoint' | 'event'
  createdAt: string
  metadata: Record<string, unknown>
}

export interface AgentOsWorkbenchApprovals {
  open: AgentOsWorkbenchApproval[]
  events: ExecutionEvent[]
}

export interface AgentOsWorkbenchContextPack {
  id: string
  taskId: string
  runId?: string
  checkpointId?: string
  source: 'run' | 'checkpoint'
}

export interface AgentOsWorkbenchGitFile {
  path: string
  indexStatus: string
  worktreeStatus: string
  raw: string
}

export interface AgentOsWorkbenchGitStatus {
  ok: boolean
  changedFiles: AgentOsWorkbenchGitFile[]
  warnings: string[]
}

export interface AgentOsWorkbenchPanel {
  id: string
  title: string
  status: 'ready' | 'attention' | 'empty'
  count: number
  action?: string
}

const TASK_STATUSES: AgentOsTaskStatus[] = [
  'created',
  'planned',
  'running',
  'waiting_for_approval',
  'waiting_for_external_input',
  'verifying',
  'completed',
  'partially_completed',
  'blocked',
  'cancelled',
]

export class AgentOsWorkbench {
  private projectDir: string
  private scaleDir: string
  private projectName?: string
  private now: () => Date

  constructor(options: AgentOsWorkbenchOptions = {}) {
    this.projectDir = resolve(options.projectDir ?? process.cwd())
    this.scaleDir = isAbsolute(options.scaleDir ?? '')
      ? options.scaleDir as string
      : join(this.projectDir, options.scaleDir ?? '.scale')
    this.projectName = options.projectName
    this.now = options.now ?? (() => new Date())
  }

  snapshot(input: AgentOsWorkbenchInput = {}): AgentOsWorkbenchSnapshot {
    const limit = input.limit ?? 25
    const taskStore = new AgentOsTaskStore({
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
      now: this.now,
    })
    const allTasks = taskStore.list()
    const focused = input.taskId ? taskStore.snapshot(input.taskId) : undefined
    const tasks = input.taskId && focused
      ? uniqueTasks([focused.task, ...allTasks]).slice(0, limit)
      : allTasks.slice(0, limit)
    const timeline = focused?.timeline ?? allTasks
      .slice(0, Math.max(1, Math.min(10, limit)))
      .flatMap(task => {
        try {
          return taskStore.timeline(task.taskId)
        } catch {
          return []
        }
      })
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, limit)

    const capabilities = buildAgentOsCapabilityReport({
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
    })
    const bridges = new AgentOsBridgeRegistry({
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
      now: this.now,
    }).list()
    const executionLedger = new ExecutionLedger({
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
      now: this.now,
    })
    const events = executionLedger.query({
      taskId: input.taskId,
      limit,
    })
    const evidenceLedger = new RuntimeEvidenceLedger({
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
      now: this.now,
    })
    const evidence = evidenceLedger.list({ taskId: input.taskId, limit })
    const evidenceSummary = evidenceLedger.summary({ taskId: input.taskId })
    const memory = this.readMemory()
    const approvals = buildApprovals(focused, events)
    const contextPacks = buildContextPacks(focused)
    const git = readGitStatus(this.projectDir)
    const shellExecutions = new AgentOsSmartShell({
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
      now: this.now,
    }).list(limit)
    const delegations = new AgentOsMultiAgentOrchestrator({
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
      now: this.now,
    }).list(limit)
    const cortexPipeline = new AgentOsCortexPromotionPipeline({
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
      now: this.now,
    })
    const cortexReport = cortexPipeline.evaluate()
    const taskSummary = summarizeTasks(allTasks)
    const bridgeSummary = summarizeBridges(bridges)
    const shellSummary = summarizeShell(shellExecutions)
    const delegationSummary = summarizeDelegations(delegations)

    const summary: AgentOsWorkbenchSummary = {
      tasks: taskSummary,
      capabilities: {
        available: capabilities.summary.available,
        total: capabilities.summary.total,
        blocked: capabilities.summary.blocked,
        approvalRequired: capabilities.summary.approvalRequired,
      },
      bridges: {
        total: bridgeSummary.total,
        online: bridgeSummary.online,
      },
      evidence: {
        total: evidenceSummary.total,
        passed: evidenceSummary.passed,
        failed: evidenceSummary.failed,
        skipped: evidenceSummary.skipped,
        ok: evidenceSummary.ok,
      },
      memory: {
        active: memory.summary.active,
        candidate: memory.summary.candidate,
        contradictions: memory.summary.contradictions,
      },
      git: {
        changedFiles: git.changedFiles.length,
      },
      shell: shellSummary,
      delegations: delegationSummary,
      cortexPromotions: {
        total: cortexReport.summary.totalProposals,
        approvedBlocking: cortexReport.summary.approvedBlocking,
      },
    }

    return {
      version: 1,
      generatedAt: this.now().toISOString(),
      project: {
        name: this.projectName,
        projectDir: this.projectDir,
        scaleDir: this.scaleDir,
      },
      focus: { taskId: input.taskId },
      summary,
      tasks: {
        total: allTasks.length,
        items: tasks,
        focused,
      },
      timeline,
      capabilities,
      bridges: {
        ...bridgeSummary,
        items: bridges,
      },
      approvals,
      evidence: {
        summary: evidenceSummary,
        records: evidence,
      },
      memory,
      contextPacks,
      git,
      shell: {
        ...shellSummary,
        executions: shellExecutions,
      },
      delegations: {
        ...delegationSummary,
        items: delegations,
      },
      cortexPromotions: {
        total: cortexReport.summary.totalProposals,
        shadow: cortexReport.summary.shadowRules,
        candidateHook: cortexReport.summary.candidateHooks,
        approvedBlocking: cortexReport.summary.approvedBlocking,
        report: cortexReport,
      },
      panels: buildPanels(summary, approvals, contextPacks),
      events,
    }
  }

  private readMemory(): AgentOsWorkbenchSnapshot['memory'] {
    const brain = new MemoryBrain({
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
      now: this.now,
    })
    try {
      const nodes = brain.list()
      const contradictions = brain.contradictions().contradictions
      return {
        summary: {
          total: nodes.length,
          active: nodes.filter(node => node.status === 'active').length,
          candidate: nodes.filter(node => node.status === 'candidate').length,
          stale: nodes.filter(node => node.status === 'stale').length,
          rejected: nodes.filter(node => node.status === 'rejected').length,
          contradictions: contradictions.length,
        },
        contradictions,
        candidates: nodes.filter(node => node.status === 'candidate').slice(0, 10),
      }
    } finally {
      brain.close()
    }
  }
}

function summarizeTasks(tasks: AgentOsTaskManifest[]): AgentOsWorkbenchSummary['tasks'] {
  const summary = Object.fromEntries(TASK_STATUSES.map(status => [status, 0])) as AgentOsWorkbenchSummary['tasks']
  summary.total = tasks.length
  for (const task of tasks) summary[task.status] += 1
  return summary
}

function summarizeBridges(bridges: AgentOsBridgeRegistration[]): AgentOsWorkbenchSnapshot['bridges'] {
  return {
    total: bridges.length,
    online: bridges.filter(bridge => bridge.status === 'online').length,
    stale: bridges.filter(bridge => bridge.status === 'stale').length,
    registered: bridges.filter(bridge => bridge.status === 'registered').length,
    revoked: bridges.filter(bridge => bridge.status === 'revoked').length,
    items: bridges,
  }
}

function buildApprovals(focused: AgentOsTaskSnapshot | undefined, events: ExecutionEvent[]): AgentOsWorkbenchApprovals {
  const checkpointApprovals = focused?.checkpoints.flatMap(checkpoint => checkpoint.openApprovals.map(approval => ({
    id: `${checkpoint.checkpointId}:${approval}`,
    taskId: checkpoint.taskId,
    runId: checkpoint.runId,
    checkpointId: checkpoint.checkpointId,
    summary: approval,
    source: 'checkpoint' as const,
    createdAt: checkpoint.createdAt,
    metadata: { contextPackId: checkpoint.contextPackId },
  }))) ?? []
  const approvalEvents = events.filter(event => event.type === 'approval.requested' || event.type === 'approval.resolved')
  const openEventApprovals = approvalEvents
    .filter(event => event.type === 'approval.requested')
    .map(event => ({
      id: event.id,
      taskId: event.taskId,
      runId: firstString(event.metadata?.runId),
      checkpointId: firstString(event.metadata?.checkpointId),
      summary: event.summary,
      source: 'event' as const,
      createdAt: event.ts,
      metadata: event.metadata ?? {},
    }))
  return {
    open: [...checkpointApprovals, ...openEventApprovals],
    events: approvalEvents,
  }
}

function buildContextPacks(focused: AgentOsTaskSnapshot | undefined): AgentOsWorkbenchContextPack[] {
  if (!focused) return []
  const packs: AgentOsWorkbenchContextPack[] = []
  if (focused.run?.contextPackId) {
    packs.push({
      id: focused.run.contextPackId,
      taskId: focused.task.taskId,
      runId: focused.run.runId,
      source: 'run',
    })
  }
  for (const checkpoint of focused.checkpoints) {
    if (!checkpoint.contextPackId) continue
    packs.push({
      id: checkpoint.contextPackId,
      taskId: checkpoint.taskId,
      runId: checkpoint.runId,
      checkpointId: checkpoint.checkpointId,
      source: 'checkpoint',
    })
  }
  return uniqueContextPacks(packs)
}

function buildPanels(
  summary: AgentOsWorkbenchSummary,
  approvals: AgentOsWorkbenchApprovals,
  contextPacks: AgentOsWorkbenchContextPack[],
): AgentOsWorkbenchPanel[] {
  return [
    {
      id: 'tasks',
      title: 'Tasks',
      status: summary.tasks.total > 0 ? 'ready' : 'empty',
      count: summary.tasks.total,
      action: summary.tasks.total > 0 ? undefined : 'Create an Agent OS task before opening the workbench.',
    },
    {
      id: 'approvals',
      title: 'Approvals',
      status: approvals.open.length > 0 ? 'attention' : 'ready',
      count: approvals.open.length,
    },
    {
      id: 'capabilities',
      title: 'Capabilities',
      status: summary.capabilities.blocked > 0 || summary.capabilities.approvalRequired > 0 ? 'attention' : 'ready',
      count: summary.capabilities.total,
    },
    {
      id: 'bridges',
      title: 'Bridges',
      status: summary.bridges.total > 0 ? 'ready' : 'empty',
      count: summary.bridges.total,
    },
    {
      id: 'evidence',
      title: 'Evidence',
      status: summary.evidence.failed > 0 ? 'attention' : summary.evidence.total > 0 ? 'ready' : 'empty',
      count: summary.evidence.total,
    },
    {
      id: 'memory',
      title: 'Memory',
      status: summary.memory.contradictions > 0 ? 'attention' : summary.memory.active + summary.memory.candidate > 0 ? 'ready' : 'empty',
      count: summary.memory.active + summary.memory.candidate,
    },
    {
      id: 'context-packs',
      title: 'Context Packs',
      status: contextPacks.length > 0 ? 'ready' : 'empty',
      count: contextPacks.length,
    },
    {
      id: 'git',
      title: 'Git Workspace',
      status: summary.git.changedFiles > 0 ? 'attention' : 'ready',
      count: summary.git.changedFiles,
    },
    {
      id: 'shell',
      title: 'Smart Shell',
      status: summary.shell.failed > 0 || summary.shell.blocked > 0 ? 'attention' : summary.shell.total > 0 ? 'ready' : 'empty',
      count: summary.shell.total,
    },
    {
      id: 'delegations',
      title: 'Delegations',
      status: summary.delegations.total > 0 ? 'ready' : 'empty',
      count: summary.delegations.total,
    },
    {
      id: 'cortex-promotions',
      title: 'Cortex Promotions',
      status: summary.cortexPromotions.total > summary.cortexPromotions.approvedBlocking ? 'attention' : summary.cortexPromotions.total > 0 ? 'ready' : 'empty',
      count: summary.cortexPromotions.total,
    },
  ]
}

function summarizeShell(executions: AgentOsShellExecution[]): AgentOsWorkbenchSummary['shell'] {
  return {
    total: executions.length,
    blocked: executions.filter(item => item.status === 'blocked').length,
    failed: executions.filter(item => item.status === 'failed').length,
  }
}

function summarizeDelegations(delegations: AgentOsDelegationRecord[]): AgentOsWorkbenchSummary['delegations'] {
  return {
    total: delegations.length,
    delegated: delegations.filter(item => item.status === 'delegated').length,
    reviewed: delegations.filter(item => item.status === 'accepted' || item.status === 'rejected').length,
  }
}

function readGitStatus(projectDir: string): AgentOsWorkbenchGitStatus {
  try {
    const output = execFileSync('git', ['-C', projectDir, 'status', '--short', '--untracked-files=all'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return {
      ok: true,
      changedFiles: output
        .split(/\r?\n/)
        .filter(Boolean)
        .map(parseGitStatusLine),
      warnings: [],
    }
  } catch (error) {
    return {
      ok: false,
      changedFiles: [],
      warnings: [error instanceof Error ? error.message : String(error)],
    }
  }
}

function parseGitStatusLine(line: string): AgentOsWorkbenchGitFile {
  return {
    raw: line,
    indexStatus: line.slice(0, 1).trim(),
    worktreeStatus: line.slice(1, 2).trim(),
    path: line.slice(3).replace(/^.* -> /, ''),
  }
}

function uniqueTasks(tasks: AgentOsTaskManifest[]): AgentOsTaskManifest[] {
  const seen = new Set<string>()
  const unique: AgentOsTaskManifest[] = []
  for (const task of tasks) {
    if (seen.has(task.taskId)) continue
    seen.add(task.taskId)
    unique.push(task)
  }
  return unique
}

function uniqueContextPacks(packs: AgentOsWorkbenchContextPack[]): AgentOsWorkbenchContextPack[] {
  const seen = new Set<string>()
  const unique: AgentOsWorkbenchContextPack[] = []
  for (const pack of packs) {
    const key = [pack.id, pack.taskId, pack.runId, pack.checkpointId].join('\u001f')
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(pack)
  }
  return unique
}

function firstString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
