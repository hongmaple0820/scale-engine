import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../core/logger.js'

export interface CortexGateObservation {
  timestamp: string
  sessionId: string
  gateName: string
  gateStatus: 'PASS' | 'FAIL' | 'WARN'
  errorPattern?: string
  filePaths: string[]
  rootCause?: string
  resolution?: string
  tokensUsed: number
  modelUsed: string
  durationMs?: number
  estimatedCostUsd?: number
}

export function loadGateEvidenceObservations(scaleDir: string): CortexGateObservation[] {
  const evidenceDir = join(scaleDir, 'evidence')
  if (!existsSync(evidenceDir)) return []

  const observations: CortexGateObservation[] = []
  try {
    for (const file of readdirSync(evidenceDir)) {
      if (!/^GATE-.+\.json$/u.test(file)) continue
      try {
        const parsed = JSON.parse(readFileSync(join(evidenceDir, file), 'utf-8'))
        const observation = parseGateEvidenceObservation(parsed, file)
        if (observation) observations.push(observation)
      } catch (err) {
        logger.debug({ err, file }, 'Skipped malformed gate evidence file')
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load gate evidence observations')
  }

  return observations
}

export function parseGateEvidenceObservation(value: unknown, fileName = ''): CortexGateObservation | null {
  if (!isRecord(value)) return null

  const gateName = stringValue(value.gate) ?? gateNameFromId(stringValue(value.id) ?? fileName)
  const timestamp = timestampValue(value.createdAt) ?? timestampFromId(stringValue(value.id) ?? fileName)
  if (!gateName || !timestamp) return null

  const items = Array.isArray(value.evidenceItems)
    ? value.evidenceItems.filter(isRecord)
    : []
  const gateStatus = statusFromEvidence(value)
  const failureItems = items.filter(isFailedEvidenceItem)
  const blockers = stringArray(value.blockers)
  const failureSummary = gateStatus === 'FAIL'
    ? summarize(firstNonEmpty([
      blockers[0],
      evidenceItemSummary(failureItems[0]),
      stringValue(value.evidence),
      stringValue(value.status),
    ]))
    : undefined

  return {
    timestamp,
    sessionId: stringValue(value.id) ?? `${gateName}-${timestamp}`,
    gateName,
    gateStatus,
    errorPattern: failureSummary ? `${gateName}: ${failureSummary}` : undefined,
    filePaths: uniqueStrings(items.map(item => stringValue(item.path)).filter(Boolean)),
    rootCause: failureSummary,
    resolution: failureSummary
      ? `Inspect .scale/evidence/${stringValue(value.id) ?? fileName} and rerun gate ${gateName}.`
      : undefined,
    tokensUsed: tokenCount(value, items),
    modelUsed: 'gate-evidence',
    durationMs: finiteNumber(value.durationMs) ?? sumNumbers(items.map(item => finiteNumber(item.durationMs))),
    estimatedCostUsd: finiteNumber(value.estimatedCostUsd) ?? sumNumbers(items.map(item => finiteNumber(item.estimatedCostUsd))),
  }
}

export function dedupeCortexObservations<T extends {
  timestamp: string
  sessionId?: string
  gateName?: string
  gateStatus?: string
}>(observations: T[]): T[] {
  const seen = new Set<string>()
  const deduped: T[] = []
  for (const observation of observations) {
    const key = [
      observation.sessionId ?? '',
      observation.gateName ?? '',
      observation.gateStatus ?? '',
      observation.timestamp,
    ].join('\u0000')
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(observation)
  }
  return deduped
}

function statusFromEvidence(value: Record<string, unknown>): CortexGateObservation['gateStatus'] {
  if (value.passed === true || stringValue(value.status)?.toUpperCase() === 'PASSED') return 'PASS'
  if (value.passed === false) return 'FAIL'

  const status = stringValue(value.status)?.toUpperCase()
  if (!status) return 'WARN'
  if (status.includes('FAIL') || status.includes('BLOCK')) return 'FAIL'
  if (status.includes('WARN')) return 'WARN'
  return 'WARN'
}

function isFailedEvidenceItem(item: Record<string, unknown>): boolean {
  if (item.passed === false) return true
  const exitCode = finiteNumber(item.exitCode)
  return exitCode !== undefined && exitCode !== 0
}

function evidenceItemSummary(item: Record<string, unknown> | undefined): string | undefined {
  if (!item) return undefined
  const label = stringValue(item.label)
  const detail = stringValue(item.detail)
  if (label && detail) return `${label}: ${detail}`
  return label ?? detail
}

function tokenCount(record: Record<string, unknown>, items: Record<string, unknown>[]): number {
  const itemTotal = sumNumbers(items.map(item =>
    finiteNumber(item.rawEstimatedTokens)
    ?? finiteNumber(item.compressedEstimatedTokens)
    ?? finiteNumber(item.tokensUsed)))
  if (itemTotal !== undefined && itemTotal > 0) return itemTotal
  return finiteNumber(record.rawEstimatedTokens)
    ?? finiteNumber(record.compressedEstimatedTokens)
    ?? finiteNumber(record.tokensUsed)
    ?? 0
}

function sumNumbers(values: Array<number | undefined>): number | undefined {
  let total = 0
  for (const value of values) {
    total += value ?? 0
  }
  return total > 0 ? total : undefined
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
  return Number.isFinite(ts) ? new Date(ts).toISOString() : undefined
}

function timestampFromId(id: string | undefined): string | undefined {
  const match = id?.match(/GATE-[A-Z0-9]+-(\d{10,})/u)
  if (!match) return undefined
  return timestampValue(Number(match[1]))
}

function gateNameFromId(id: string | undefined): string | undefined {
  const match = id?.match(/GATE-([A-Z0-9]+)-/u)
  return match?.[1]
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  return values.find(value => value !== undefined && value.trim().length > 0)
}

function summarize(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized
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
