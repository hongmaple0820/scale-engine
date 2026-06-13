import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../core/logger.js'

export interface CortexAutoFixObservation {
  timestamp: string
  sessionId: string
  gateName: string
  gateStatus: 'PASS' | 'FAIL'
  durationMs?: number
  tokensUsed: number
  estimatedCostUsd: number
}

export function loadAutoFixEventObservations(scaleDir: string): CortexAutoFixObservation[] {
  const eventsDir = join(scaleDir, 'events')
  if (!existsSync(eventsDir)) return []

  const observations: CortexAutoFixObservation[] = []
  try {
    for (const file of readdirSync(eventsDir)) {
      if (!file.endsWith('.jsonl')) continue
      const lines = readFileSync(join(eventsDir, file), 'utf-8').split('\n').filter(Boolean)
      for (const [index, line] of lines.entries()) {
        try {
          const observation = parseAutoFixEventObservation(JSON.parse(line))
          if (observation) observations.push(observation)
        } catch (err) {
          logger.debug({ err, file, lineNumber: index + 1 }, 'Skipped malformed auto-fix event line')
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load auto-fix event observations')
  }

  return observations
}

export function parseAutoFixEventObservation(value: unknown): CortexAutoFixObservation | null {
  if (!isRecord(value) || value.type !== 'autofix.attempt') return null
  const payload = isRecord(value.payload) ? value.payload : null
  if (!payload) return null

  const timestamp = timestampValue(value.timestamp)
  const category = stringValue(payload.category) ?? 'unknown'
  if (!timestamp) return null

  return {
    timestamp,
    sessionId: stringValue(value.sessionId) ?? stringValue(value.id) ?? `auto-fix-${timestamp}`,
    gateName: `auto-fix:${category}`,
    gateStatus: payload.success === true ? 'PASS' : 'FAIL',
    durationMs: finiteNumber(payload.durationMs),
    tokensUsed: 0,
    estimatedCostUsd: 0,
  }
}

function timestampValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const ts = new Date(value).getTime()
    return Number.isFinite(ts) ? new Date(ts).toISOString() : undefined
  }
  const numeric = finiteNumber(value)
  if (numeric === undefined) return undefined
  const ms = numeric < 10_000_000_000 ? numeric * 1000 : numeric
  const ts = new Date(ms).getTime()
  return Number.isFinite(ts) ? new Date(ms).toISOString() : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
