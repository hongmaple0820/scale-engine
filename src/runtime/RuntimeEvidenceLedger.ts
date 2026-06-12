import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { redactEvidenceText, redactEvidenceValue } from '../tools/ToolEvidenceStore.js'

export type RuntimeEvidenceKind =
  | 'command'
  | 'gate'
  | 'tool'
  | 'skill'
  | 'mcp'
  | 'browser'
  | 'desktop'
  | 'manual'
  | 'final-report'

export type RuntimeEvidenceStatus = 'passed' | 'failed' | 'skipped'

export interface RuntimeEvidenceInput {
  taskId?: string
  sessionId?: string
  kind: RuntimeEvidenceKind
  title: string
  status: RuntimeEvidenceStatus
  command?: string
  exitCode?: number
  summary: string
  artifacts?: string[]
  metadata?: Record<string, unknown>
}

export interface RuntimeEvidenceRecord extends RuntimeEvidenceInput {
  id: string
  createdAt: string
  sequence: number
  redactionApplied: boolean
}

export interface RuntimeEvidenceQuery {
  taskId?: string
  sessionId?: string
  limit?: number
}

export interface RuntimeEvidenceSummary {
  total: number
  passed: number
  failed: number
  resolvedFailed: number
  skipped: number
  expectedRed: number
  ok: boolean
  latestFailure?: RuntimeEvidenceRecord
}

export interface RuntimeEvidenceFailureResolution {
  unresolved: RuntimeEvidenceRecord[]
  resolvedIds: Set<string>
}

export interface RuntimeEvidenceLedgerOptions {
  projectDir?: string
  scaleDir?: string
  now?: () => Date
  createDirs?: boolean
}

export class RuntimeEvidenceLedger {
  private rootDir: string
  private now: () => Date
  private sequence = 0

  constructor(options: RuntimeEvidenceLedgerOptions = {}) {
    const projectDir = resolve(options.projectDir ?? process.cwd())
    const scaleRoot = isAbsolute(options.scaleDir ?? '')
      ? options.scaleDir as string
      : join(projectDir, options.scaleDir ?? '.scale')
    this.rootDir = join(scaleRoot, 'evidence', 'runtime')
    this.now = options.now ?? (() => new Date())
    if (options.createDirs !== false && !existsSync(this.rootDir)) mkdirSync(this.rootDir, { recursive: true })
  }

  record(input: RuntimeEvidenceInput): RuntimeEvidenceRecord {
    const command = input.command ? redactEvidenceText(input.command) : undefined
    const summary = redactEvidenceText(input.summary)
    const metadata = redactEvidenceValue(input.metadata ?? {})
    const artifacts = redactEvidenceValue(input.artifacts ?? [])
    const record: RuntimeEvidenceRecord = {
      ...input,
      id: `RTE-${Date.now()}-${randomUUID().slice(0, 8)}`,
      createdAt: this.now().toISOString(),
      sequence: ++this.sequence,
      command: command?.value,
      summary: summary.value,
      artifacts: artifacts.value as string[],
      metadata: metadata.value as Record<string, unknown>,
      redactionApplied: Boolean(command?.redacted) || summary.redacted || metadata.redacted || artifacts.redacted,
    }

    writeFileSync(join(this.rootDir, `${record.id}.json`), JSON.stringify(record, null, 2), 'utf-8')
    return record
  }

  list(query: RuntimeEvidenceQuery = {}): RuntimeEvidenceRecord[] {
    if (!existsSync(this.rootDir)) return []
    const limit = query.limit ?? 50
    return readdirSync(this.rootDir)
      .filter(file => file.endsWith('.json'))
      .map(file => readRuntimeEvidence(join(this.rootDir, file)))
      .filter((record): record is RuntimeEvidenceRecord => Boolean(record))
      .filter(record => !query.taskId || record.taskId === query.taskId)
      .filter(record => !query.sessionId || record.sessionId === query.sessionId)
      .sort((a, b) => {
        const time = Date.parse(b.createdAt) - Date.parse(a.createdAt)
        if (time !== 0) return time
        return b.sequence - a.sequence
      })
      .slice(0, limit)
  }

  get(id: string): RuntimeEvidenceRecord | null {
    return readRuntimeEvidence(join(this.rootDir, `${id}.json`))
  }

  summary(query: RuntimeEvidenceQuery = {}): RuntimeEvidenceSummary {
    const records = this.list({ ...query, limit: query.limit ?? Number.MAX_SAFE_INTEGER })
    const passed = records.filter(record => record.status === 'passed').length
    const expectedRed = records.filter(isExpectedRedEvidence).length
    const failureResolution = resolveRuntimeEvidenceFailures(records)
    const failedRecords = failureResolution.unresolved
    const failed = failedRecords.length
    const failedCandidates = records.filter(record => record.status === 'failed' && !isExpectedRedEvidence(record)).length
    const skipped = records.filter(record => record.status === 'skipped').length
    return {
      total: records.length,
      passed,
      failed,
      resolvedFailed: failedCandidates - failed,
      skipped,
      expectedRed,
      ok: failed === 0,
      latestFailure: failedRecords[0],
    }
  }
}

function isExpectedRedEvidence(record: RuntimeEvidenceRecord): boolean {
  if (record.status !== 'failed') return false
  const metadata = record.metadata ?? {}
  return metadata.expectedRed === true || metadata.expectedFailure === true
}

export function resolveRuntimeEvidenceFailures(records: RuntimeEvidenceRecord[]): RuntimeEvidenceFailureResolution {
  const passedKeys = new Set<string>()
  const unresolved: RuntimeEvidenceRecord[] = []
  const resolvedIds = new Set<string>()

  for (const record of records) {
    const key = resolutionKey(record)
    if (record.status === 'passed' && key) {
      passedKeys.add(key)
      continue
    }

    if (record.status !== 'failed' || isExpectedRedEvidence(record)) continue
    if (isResolvedEvidence(record) || key && passedKeys.has(key)) {
      resolvedIds.add(record.id)
      continue
    }
    unresolved.push(record)
  }

  return { unresolved, resolvedIds }
}

function isResolvedEvidence(record: RuntimeEvidenceRecord): boolean {
  const metadata = record.metadata ?? {}
  return metadata.resolved === true || metadata.superseded === true || typeof metadata.resolvedBy === 'string'
}

function resolutionKey(record: RuntimeEvidenceRecord): string | null {
  const metadata = record.metadata ?? {}
  const metadataKey = firstString(
    metadata.resolutionKey,
    metadata.stepId,
    metadata.gate,
    metadata.checkId,
    metadata.scenario,
    metadata.phase,
  )
  const itemKey = metadataKey ?? normalizeEvidenceKey(record.command) ?? normalizeEvidenceKey(record.title)
  if (!itemKey) return null
  return [
    record.taskId ?? '',
    record.sessionId ?? '',
    record.kind,
    itemKey,
  ].join('\u001f')
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return undefined
}

function normalizeEvidenceKey(value?: string): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, ' ').toLowerCase()
  return normalized && normalized.length > 0 ? normalized : undefined
}

function readRuntimeEvidence(file: string): RuntimeEvidenceRecord | null {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as RuntimeEvidenceRecord
  } catch {
    return null
  }
}
