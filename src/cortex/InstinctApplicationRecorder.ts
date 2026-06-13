import { isAbsolute, join, resolve } from 'node:path'
import { InstinctStore } from './InstinctStore.js'
import {
  SessionLedger,
  type RuntimeSessionEvent,
  type RuntimeSessionRecord,
} from '../runtime/SessionLedger.js'

export type RuntimeInstinctApplicationPhase = 'verify' | 'ship'

export interface RuntimeInstinctApplicationSkip {
  id: string
  reason: 'already-recorded' | 'instinct-not-found' | 'record-failed'
  detail?: string
}

export interface RuntimeInstinctApplicationReport {
  checked: boolean
  phase: RuntimeInstinctApplicationPhase
  success: boolean
  sessionId?: string
  instinctIds: string[]
  recorded: string[]
  skipped: RuntimeInstinctApplicationSkip[]
  reason?: 'no-runtime-session' | 'no-cortex-instincts'
}

export interface RuntimeInstinctApplicationRecorderOptions {
  projectDir?: string
  scaleDir?: string
  phase: RuntimeInstinctApplicationPhase
  success: boolean
  sessionId?: string
  store?: InstinctStore
  ledger?: SessionLedger
}

export function recordRuntimeInstinctApplications(
  options: RuntimeInstinctApplicationRecorderOptions,
): RuntimeInstinctApplicationReport {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const scaleDir = resolveScaleRoot(projectDir, options.scaleDir)
  const phase = options.phase
  const success = options.success
  const ledger = options.ledger ?? new SessionLedger({ projectDir, scaleDir })
  const session = resolveSession(ledger, options.sessionId)

  if (!session) {
    return {
      checked: false,
      phase,
      success,
      instinctIds: [],
      recorded: [],
      skipped: [],
      reason: 'no-runtime-session',
    }
  }

  const events = ledger.listEvents(session.sessionId)
  const instinctIds = unique([
    ...extractInstinctIdsFromMetadata(session.metadata),
    ...extractInstinctIdsFromSessionStartedEvents(events),
  ])

  if (instinctIds.length === 0) {
    return {
      checked: true,
      phase,
      success,
      sessionId: session.sessionId,
      instinctIds,
      recorded: [],
      skipped: [],
      reason: 'no-cortex-instincts',
    }
  }

  const store = options.store ?? new InstinctStore(join(scaleDir, 'instincts'))
  const recorded: string[] = []
  const skipped: RuntimeInstinctApplicationSkip[] = []

  for (const id of instinctIds) {
    if (hasRecordedOutcome(events, id, phase, success)) {
      skipped.push({ id, reason: 'already-recorded' })
      continue
    }

    if (!store.findById(id)) {
      skipped.push({ id, reason: 'instinct-not-found' })
      continue
    }

    try {
      store.recordApplication(id, success)
      ledger.append(session.sessionId, {
        type: 'note',
        phase,
        message: `Cortex instinct ${success ? 'succeeded' : 'failed'} during ${phase}`,
        data: {
          cortex: {
            instinctApplication: {
              instinctId: id,
              phase,
              success,
            },
          },
        },
      })
      recorded.push(id)
    } catch (error) {
      skipped.push({
        id,
        reason: 'record-failed',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    checked: true,
    phase,
    success,
    sessionId: session.sessionId,
    instinctIds,
    recorded,
    skipped,
  }
}

function resolveScaleRoot(projectDir: string, scaleDir?: string): string {
  const raw = scaleDir ?? '.scale'
  return isAbsolute(raw) ? raw : join(projectDir, raw)
}

function resolveSession(
  ledger: SessionLedger,
  sessionId?: string,
): RuntimeSessionRecord | null {
  const current = ledger.current()
  if (!sessionId) return current
  if (current?.sessionId === sessionId) return current
  const events = ledger.listEvents(sessionId)
  const started = events.find(event => event.type === 'session.started')
  if (!started) return null
  const data = isRecord(started.data) ? started.data : {}
  return {
    sessionId,
    status: 'active',
    startedAt: started.createdAt,
    updatedAt: started.createdAt,
    taskId: typeof data.taskId === 'string' ? data.taskId : undefined,
    agent: typeof data.agent === 'string' ? data.agent : undefined,
    metadata: isRecord(data.metadata) ? data.metadata : undefined,
  }
}

function extractInstinctIdsFromSessionStartedEvents(events: RuntimeSessionEvent[]): string[] {
  return events
    .filter(event => event.type === 'session.started')
    .flatMap(event => {
      const data = isRecord(event.data) ? event.data : {}
      return extractInstinctIdsFromMetadata(isRecord(data.metadata) ? data.metadata : undefined)
    })
}

function extractInstinctIdsFromMetadata(metadata: unknown): string[] {
  if (!isRecord(metadata)) return []
  const cortex = isRecord(metadata.cortex) ? metadata.cortex : {}
  const instinctsApplied = Array.isArray(cortex.instinctsApplied) ? cortex.instinctsApplied : []
  return instinctsApplied
    .map(id => typeof id === 'string' ? id.trim() : '')
    .filter(Boolean)
}

function hasRecordedOutcome(
  events: RuntimeSessionEvent[],
  instinctId: string,
  phase: RuntimeInstinctApplicationPhase,
  success: boolean,
): boolean {
  return events.some(event => {
    const data = isRecord(event.data) ? event.data : {}
    const cortex = isRecord(data.cortex) ? data.cortex : {}
    const application = isRecord(cortex.instinctApplication) ? cortex.instinctApplication : {}
    return application.instinctId === instinctId &&
      application.phase === phase &&
      application.success === success
  })
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
