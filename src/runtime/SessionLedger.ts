import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { redactEvidenceValue } from '../tools/ToolEvidenceStore.js'

export type RuntimeSessionLevel = 'S' | 'M' | 'L' | 'CRITICAL'
export type RuntimeSessionStatus = 'active' | 'completed' | 'failed' | 'abandoned'
export type RuntimeSessionEventType =
  | 'session.started'
  | 'session.ended'
  | 'phase.started'
  | 'phase.completed'
  | 'tool.used'
  | 'evidence.recorded'
  | 'note'

export interface RuntimeSessionStartInput {
  sessionId?: string
  taskId?: string
  agent?: string
  level?: RuntimeSessionLevel
  summary?: string
  metadata?: Record<string, unknown>
}

export interface RuntimeSessionRecord {
  sessionId: string
  taskId?: string
  agent?: string
  level?: RuntimeSessionLevel
  status: RuntimeSessionStatus
  startedAt: string
  updatedAt: string
  endedAt?: string
  summary?: string
  metadata?: Record<string, unknown>
}

export interface RuntimeSessionEventInput {
  type: RuntimeSessionEventType
  phase?: string
  message?: string
  data?: Record<string, unknown>
}

export interface RuntimeSessionEvent extends RuntimeSessionEventInput {
  id: string
  sessionId: string
  createdAt: string
  redactionApplied: boolean
}

export interface RuntimeSessionLedgerOptions {
  projectDir?: string
  scaleDir?: string
  now?: () => Date
  createDirs?: boolean
}

export class SessionLedger {
  private sessionsDir: string
  private currentPath: string
  private now: () => Date

  constructor(options: RuntimeSessionLedgerOptions = {}) {
    const projectDir = resolve(options.projectDir ?? process.cwd())
    const scaleRoot = isAbsolute(options.scaleDir ?? '')
      ? options.scaleDir as string
      : join(projectDir, options.scaleDir ?? '.scale')
    this.sessionsDir = join(scaleRoot, 'events', 'sessions')
    this.currentPath = join(scaleRoot, 'events', 'current-session.json')
    this.now = options.now ?? (() => new Date())
    if (options.createDirs !== false && !existsSync(this.sessionsDir)) mkdirSync(this.sessionsDir, { recursive: true })
  }

  start(input: RuntimeSessionStartInput = {}): RuntimeSessionRecord {
    const now = this.now().toISOString()
    const metadata = redactEvidenceValue(input.metadata ?? {})
    const normalizedMetadata = metadata.value as Record<string, unknown>
    const record: RuntimeSessionRecord = {
      sessionId: input.sessionId ?? `SESSION-${Date.now()}-${randomUUID().slice(0, 8)}`,
      taskId: input.taskId,
      agent: input.agent,
      level: input.level,
      status: 'active',
      startedAt: now,
      updatedAt: now,
      summary: input.summary,
      metadata: Object.keys(normalizedMetadata).length > 0 ? normalizedMetadata : undefined,
    }
    this.writeCurrent(record)
    this.append(record.sessionId, {
      type: 'session.started',
      message: input.summary,
      data: {
        taskId: record.taskId,
        agent: record.agent,
        level: record.level,
        metadata: record.metadata,
      },
    })
    return record
  }

  append(sessionId: string, input: RuntimeSessionEventInput): RuntimeSessionEvent {
    const data = redactEvidenceValue(input.data ?? {})
    const event: RuntimeSessionEvent = {
      ...input,
      id: `EVT-${Date.now()}-${randomUUID().slice(0, 8)}`,
      sessionId,
      createdAt: this.now().toISOString(),
      data: data.value as Record<string, unknown>,
      redactionApplied: data.redacted,
    }
    appendFileSync(this.sessionPath(sessionId), `${JSON.stringify(event)}\n`, 'utf-8')
    return event
  }

  end(sessionId: string, status: RuntimeSessionStatus = 'completed', summary?: string): RuntimeSessionRecord {
    const current = this.current()
    const now = this.now().toISOString()
    const record: RuntimeSessionRecord = {
      ...(current?.sessionId === sessionId ? current : { sessionId, startedAt: now }),
      status,
      updatedAt: now,
      endedAt: now,
      summary: summary ?? current?.summary,
    }
    this.writeCurrent(record)
    this.append(sessionId, {
      type: 'session.ended',
      message: summary,
      data: { status },
    })
    return record
  }

  current(): RuntimeSessionRecord | null {
    try {
      return JSON.parse(readFileSync(this.currentPath, 'utf-8')) as RuntimeSessionRecord
    } catch {
      return null
    }
  }

  listEvents(sessionId: string): RuntimeSessionEvent[] {
    try {
      return readFileSync(this.sessionPath(sessionId), 'utf-8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => JSON.parse(line) as RuntimeSessionEvent)
    } catch {
      return []
    }
  }

  sessionFile(sessionId: string): string {
    return this.sessionPath(sessionId)
  }

  private writeCurrent(record: RuntimeSessionRecord): void {
    writeFileSync(this.currentPath, JSON.stringify(record, null, 2), 'utf-8')
  }

  private sessionPath(sessionId: string): string {
    return join(this.sessionsDir, `${safePathSegment(sessionId)}.jsonl`)
  }
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || 'unknown-session'
}
