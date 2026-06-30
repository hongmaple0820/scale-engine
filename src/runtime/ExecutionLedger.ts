// SCALE Engine — Cross-Agent Execution Ledger (v0.34.0)
// Unified execution timeline across all agents and sessions

import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

export type ExecutionEventType =
  | 'agent.started'
  | 'agent.ended'
  | 'task.created'
  | 'task.started'
  | 'task.checkpointed'
  | 'task.resumed'
  | 'task.completed'
  | 'task.blocked'
  | 'task.cancelled'
  | 'approval.requested'
  | 'approval.resolved'
  | 'bridge.registered'
  | 'bridge.heartbeat'
  | 'shell.planned'
  | 'shell.executed'
  | 'agent.delegated'
  | 'agent.reviewed'
  | 'cortex.promotion'
  | 'tool.invoked'
  | 'gate.checked'
  | 'evidence.recorded'
  | 'policy.violation'
  | 'mcp.health-check'

export interface ExecutionEvent {
  id: string
  ts: string
  agentId: string
  sessionId: string
  taskId?: string
  type: ExecutionEventType
  summary: string
  metadata?: Record<string, unknown>
  duration?: number
}

export interface ExecutionQuery {
  agentId?: string
  sessionId?: string
  taskId?: string
  type?: ExecutionEventType
  since?: string
  limit?: number
}

export interface ExecutionSummary {
  totalEvents: number
  agents: string[]
  sessions: string[]
  taskCount: number
  violationCount: number
  timeline: ExecutionEvent[]
}

export interface ExecutionLedgerOptions {
  projectDir?: string
  scaleDir?: string
  now?: () => Date
  createDirs?: boolean
}

export class ExecutionLedger {
  private ledgerPath: string
  private ledgerDir: string
  private now: () => Date

  constructor(options: ExecutionLedgerOptions = {}) {
    const projectDir = resolve(options.projectDir ?? process.cwd())
    const scaleRoot = isAbsolute(options.scaleDir ?? '')
      ? options.scaleDir as string
      : join(projectDir, options.scaleDir ?? '.scale')
    this.ledgerDir = join(scaleRoot, 'ledger')
    this.ledgerPath = join(this.ledgerDir, 'events.jsonl')
    this.now = options.now ?? (() => new Date())
    if (options.createDirs !== false && !existsSync(this.ledgerDir)) {
      mkdirSync(this.ledgerDir, { recursive: true })
    }
  }

  record(event: Omit<ExecutionEvent, 'id' | 'ts'>): ExecutionEvent {
    const fullEvent: ExecutionEvent = {
      ...event,
      id: `EXEC-${Date.now()}-${randomUUID().slice(0, 8)}`,
      ts: this.now().toISOString(),
    }
    appendFileSync(this.ledgerPath, `${JSON.stringify(fullEvent)}\n`, 'utf-8')
    return fullEvent
  }

  query(q: ExecutionQuery = {}): ExecutionEvent[] {
    const events = this.readAll()
    return events
      .filter(e => !q.agentId || e.agentId === q.agentId)
      .filter(e => !q.sessionId || e.sessionId === q.sessionId)
      .filter(e => !q.taskId || e.taskId === q.taskId)
      .filter(e => !q.type || e.type === q.type)
      .filter(e => !q.since || e.ts >= q.since)
      .slice(-(q.limit ?? 1000))
  }

  summarize(q: ExecutionQuery = {}): ExecutionSummary {
    const timeline = this.query({ ...q, limit: undefined })
    const agents = [...new Set(timeline.map(e => e.agentId))]
    const sessions = [...new Set(timeline.map(e => e.sessionId))]
    const tasks = new Set(timeline.filter(e => e.taskId).map(e => e.taskId))
    const violations = timeline.filter(e => e.type === 'policy.violation')

    return {
      totalEvents: timeline.length,
      agents,
      sessions,
      taskCount: tasks.size,
      violationCount: violations.length,
      timeline: timeline.slice(-(q.limit ?? 50)),
    }
  }

  exportJsonl(q: ExecutionQuery = {}): string {
    return this.query(q).map(e => JSON.stringify(e)).join('\n')
  }

  getLedgerPath(): string {
    return this.ledgerPath
  }

  private readAll(): ExecutionEvent[] {
    try {
      return readFileSync(this.ledgerPath, 'utf-8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => JSON.parse(line) as ExecutionEvent)
    } catch {
      return []
    }
  }
}
