import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../core/logger.js'
import type { InstinctAuditEntry } from './InstinctStore.js'

export type InstinctRuntimeEvidenceSource = 'session-and-audit' | 'session' | 'audit' | 'legacy' | 'none'

export interface InstinctRuntimeEvidenceSummary {
  source: InstinctRuntimeEvidenceSource
  injectionEvents: number
  applicationEvents: number
  successfulApplications: number
}

export interface InstinctRuntimeEvidence {
  injectionEventsById: Map<string, number>
  applicationEventsById: Map<string, number>
  successfulApplicationsById: Map<string, number>
  summary: InstinctRuntimeEvidenceSummary
}

export function loadInstinctRuntimeEvidence(
  scaleDir: string,
  lookbackDays: number,
  now: Date = new Date(),
): InstinctRuntimeEvidence {
  const injectionEventsById = loadInstinctInjectionEvents(scaleDir, lookbackDays, now)
  const applicationEventsById = new Map<string, number>()
  const successfulApplicationsById = new Map<string, number>()

  for (const entry of loadInstinctAuditEntries(scaleDir, lookbackDays, now)) {
    if (entry.op !== 'apply') continue
    applicationEventsById.set(entry.id, (applicationEventsById.get(entry.id) ?? 0) + 1)
    if (entry.reason === 'application-succeeded') {
      successfulApplicationsById.set(entry.id, (successfulApplicationsById.get(entry.id) ?? 0) + 1)
    }
  }

  const injectionEvents = sumMapValues(injectionEventsById)
  const applicationEvents = sumMapValues(applicationEventsById)
  const successfulApplications = sumMapValues(successfulApplicationsById)
  const source: InstinctRuntimeEvidenceSource = injectionEvents > 0 && applicationEvents > 0
    ? 'session-and-audit'
    : injectionEvents > 0
      ? 'session'
      : applicationEvents > 0
        ? 'audit'
        : 'none'

  return {
    injectionEventsById,
    applicationEventsById,
    successfulApplicationsById,
    summary: {
      source,
      injectionEvents,
      applicationEvents,
      successfulApplications,
    },
  }
}

function loadInstinctInjectionEvents(scaleDir: string, lookbackDays: number, now: Date): Map<string, number> {
  const result = new Map<string, number>()
  const sessionsDir = join(scaleDir, 'events', 'sessions')
  if (!existsSync(sessionsDir)) return result

  const start = now.getTime() - lookbackDays * 86400000
  const end = now.getTime()
  try {
    for (const file of readdirSync(sessionsDir)) {
      if (!file.endsWith('.jsonl')) continue
      const lines = readFileSync(join(sessionsDir, file), 'utf-8').split('\n').filter(Boolean)
      for (const [index, line] of lines.entries()) {
        try {
          const event = JSON.parse(line) as unknown
          if (!isRecord(event) || event.type !== 'session.started') continue
          const ts = typeof event.createdAt === 'string' ? Date.parse(event.createdAt) : NaN
          if (!Number.isFinite(ts) || ts < start || ts > end) continue
          for (const id of extractInstinctIds(event)) {
            result.set(id, (result.get(id) ?? 0) + 1)
          }
        } catch (err) {
          logger.debug({ err, file, lineNumber: index + 1 }, 'Skipped malformed session event line')
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load runtime session instinct evidence')
  }
  return result
}

function loadInstinctAuditEntries(scaleDir: string, lookbackDays: number, now: Date): InstinctAuditEntry[] {
  const auditPath = join(scaleDir, 'instincts', '.audit.jsonl')
  if (!existsSync(auditPath)) return []

  const start = now.getTime() - lookbackDays * 86400000
  const end = now.getTime()
  try {
    return readFileSync(auditPath, 'utf-8')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        try { return JSON.parse(line) as InstinctAuditEntry } catch (err) {
          logger.debug({ err, lineNumber: index + 1 }, 'Skipped malformed instinct audit line')
          return null
        }
      })
      .filter((entry): entry is InstinctAuditEntry => Boolean(entry))
      .filter(entry => {
        const ts = Date.parse(entry.ts)
        return Number.isFinite(ts) && ts >= start && ts <= end
      })
  } catch (err) {
    logger.warn({ err }, 'Failed to load instinct audit evidence')
    return []
  }
}

function extractInstinctIds(event: Record<string, unknown>): string[] {
  const data = isRecord(event.data) ? event.data : {}
  const metadata = isRecord(data.metadata) ? data.metadata : {}
  const cortex = isRecord(metadata.cortex) ? metadata.cortex : {}
  const instinctsApplied = Array.isArray(cortex.instinctsApplied) ? cortex.instinctsApplied : []
  return instinctsApplied.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
}

function sumMapValues(map: Map<string, number>): number {
  let sum = 0
  for (const value of map.values()) sum += value
  return sum
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
