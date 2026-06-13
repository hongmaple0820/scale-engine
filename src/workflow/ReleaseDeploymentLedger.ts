import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type DeploymentStatus = 'succeeded' | 'failed' | 'rolled-back'

export interface DeploymentRecord {
  id: string
  service: string
  environment: string
  status: DeploymentStatus
  version?: string
  commitSha?: string
  commitTimestamp?: string
  startedAt: string
  completedAt: string
  failedAt?: string
  restoredAt?: string
  source: 'manual' | 'ci' | 'release' | 'ship'
  evidencePaths: string[]
  notes?: string
}

export interface DeploymentRecordInput {
  service?: string
  environment?: string
  status?: DeploymentStatus
  version?: string
  commitSha?: string
  commitTimestamp?: string
  startedAt?: string
  completedAt?: string
  failedAt?: string
  restoredAt?: string
  source?: DeploymentRecord['source']
  evidencePaths?: string[]
  notes?: string
}

export interface DeploymentListQuery {
  lookbackDays?: number
  now?: Date
  service?: string
  environment?: string
}

export interface DoraDeploymentMetrics {
  hasEvidence: boolean
  source: string
  deploymentCount: number
  deploymentFrequencyPerDay: number
  leadTimeHours: number | null
  changeFailureRate: number | null
  restoreTimeHours: number | null
  totalRecords: number
  failedDeploymentCount: number
  restoredFailureCount: number
  unrestoredFailureCount: number
  period: { start: string; end: string }
}

export class ReleaseDeploymentLedger {
  readonly releaseDir: string
  readonly recordsPath: string

  constructor(scaleDir = process.env.SCALE_DIR ?? '.scale') {
    this.releaseDir = join(scaleDir, 'release')
    this.recordsPath = join(this.releaseDir, 'deployments.jsonl')
  }

  record(input: DeploymentRecordInput = {}): DeploymentRecord {
    const completedAt = normalizeTimestamp(input.completedAt ?? new Date().toISOString(), 'completedAt')
    const startedAt = normalizeTimestamp(input.startedAt ?? completedAt, 'startedAt')
    const failedAt = optionalTimestamp(input.failedAt, 'failedAt')
    const restoredAt = optionalTimestamp(input.restoredAt, 'restoredAt')
    const commitTimestamp = optionalTimestamp(input.commitTimestamp, 'commitTimestamp')
    const record: DeploymentRecord = {
      id: `DEPLOY-${Date.now()}-${randomUUID().slice(0, 8)}`,
      service: nonEmpty(input.service) ?? 'scale-engine',
      environment: nonEmpty(input.environment) ?? 'production',
      status: input.status ?? 'succeeded',
      version: nonEmpty(input.version),
      commitSha: nonEmpty(input.commitSha),
      commitTimestamp,
      startedAt,
      completedAt,
      failedAt,
      restoredAt,
      source: input.source ?? 'manual',
      evidencePaths: input.evidencePaths ?? [],
      notes: nonEmpty(input.notes),
    }
    validateRecord(record)
    if (!existsSync(this.releaseDir)) mkdirSync(this.releaseDir, { recursive: true })
    appendFileSync(this.recordsPath, `${JSON.stringify(record)}\n`, 'utf-8')
    return record
  }

  list(query: DeploymentListQuery = {}): DeploymentRecord[] {
    if (!existsSync(this.recordsPath)) return []
    const records = readFileSync(this.recordsPath, 'utf-8')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => parseRecord(line))
      .filter((record): record is DeploymentRecord => Boolean(record))
    return filterRecords(records, query)
      .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
  }

  summarize(query: DeploymentListQuery = {}): DoraDeploymentMetrics {
    const now = query.now ?? new Date()
    const lookbackDays = normalizeLookbackDays(query.lookbackDays)
    const records = this.list({ ...query, lookbackDays, now })
    const deploymentCount = records.filter(record => record.status === 'succeeded').length
    const failedRecords = records.filter(record => deploymentFailed(record))
    const restoredRecords = failedRecords.filter(record => record.restoredAt)
    const leadTimes = records
      .map(record => hoursBetween(record.commitTimestamp, record.completedAt))
      .filter((value): value is number => value !== null)
    const restoreTimes = restoredRecords
      .map(record => hoursBetween(record.failedAt ?? record.completedAt, record.restoredAt))
      .filter((value): value is number => value !== null)
    const periodEnd = now.toISOString()
    const periodStart = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000).toISOString()

    return {
      hasEvidence: existsSync(this.recordsPath),
      source: this.recordsPath,
      deploymentCount,
      deploymentFrequencyPerDay: round(deploymentCount / lookbackDays),
      leadTimeHours: averageOrNull(leadTimes),
      changeFailureRate: records.length > 0 ? round(failedRecords.length / records.length) : null,
      restoreTimeHours: failedRecords.length === 0 ? 0 : averageOrNull(restoreTimes),
      totalRecords: records.length,
      failedDeploymentCount: failedRecords.length,
      restoredFailureCount: restoredRecords.length,
      unrestoredFailureCount: failedRecords.length - restoredRecords.length,
      period: { start: periodStart, end: periodEnd },
    }
  }
}

function filterRecords(records: DeploymentRecord[], query: DeploymentListQuery): DeploymentRecord[] {
  const now = query.now ?? new Date()
  const lookbackDays = normalizeLookbackDays(query.lookbackDays)
  const start = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000
  const end = now.getTime() + 24 * 60 * 60 * 1000
  return records
    .filter(record => !query.service || record.service === query.service)
    .filter(record => !query.environment || record.environment === query.environment)
    .filter(record => {
      const completed = Date.parse(record.completedAt)
      return Number.isFinite(completed) && completed >= start && completed <= end
    })
}

function validateRecord(record: DeploymentRecord): void {
  if (!['succeeded', 'failed', 'rolled-back'].includes(record.status)) {
    throw new Error(`Invalid deployment status: ${record.status}`)
  }
  if (Date.parse(record.startedAt) > Date.parse(record.completedAt)) {
    throw new Error('Deployment startedAt must be before or equal to completedAt')
  }
  if (record.restoredAt && Date.parse(record.restoredAt) < Date.parse(record.failedAt ?? record.completedAt)) {
    throw new Error('Deployment restoredAt must be after failedAt or completedAt')
  }
}

function deploymentFailed(record: DeploymentRecord): boolean {
  return record.status === 'failed' || record.status === 'rolled-back' || Boolean(record.failedAt || record.restoredAt)
}

function parseRecord(line: string): DeploymentRecord | null {
  try {
    const record = JSON.parse(line) as DeploymentRecord
    if (!record.id || !record.completedAt || !record.startedAt) return null
    return record
  } catch {
    return null
  }
}

function normalizeTimestamp(value: string, field: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid ${field}: ${value}`)
  return new Date(timestamp).toISOString()
}

function optionalTimestamp(value: string | undefined, field: string): string | undefined {
  return value ? normalizeTimestamp(value, field) : undefined
}

function hoursBetween(start: string | undefined, end: string | undefined): number | null {
  if (!start || !end) return null
  const startMs = Date.parse(start)
  const endMs = Date.parse(end)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null
  return round((endMs - startMs) / (60 * 60 * 1000))
}

function averageOrNull(values: number[]): number | null {
  if (values.length === 0) return null
  return round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function normalizeLookbackDays(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? 30), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 30
  return Math.min(parsed, 365)
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
