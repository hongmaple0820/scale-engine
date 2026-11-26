import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import type BetterSqlite3 from 'better-sqlite3'
import type { ShadowReplayPlan, ShadowReplayRunResult } from './ShadowReplayContract.js'

const require = createRequire(import.meta.url)
type DatabaseConstructor = typeof BetterSqlite3
function loadDatabase(): DatabaseConstructor {
  const loaded = require('better-sqlite3') as DatabaseConstructor | { default?: DatabaseConstructor }
  return 'default' in loaded && loaded.default ? loaded.default : loaded as DatabaseConstructor
}

export interface ShadowReplayProvenance {
  runnerImageRef?: string
  recordedBy: string
  scenarioSnapshotDigest: string
  candidateBundleDigest: string
}

export interface ShadowReplayLedgerRecord {
  schemaVersion: 1
  runId: string
  plan: ShadowReplayPlan
  result: ShadowReplayRunResult
  provenance: ShadowReplayProvenance
  recordedAt: string
}

export interface ShadowReplayLedgerOptions {
  projectDir?: string
  dbPath?: string
  now?: () => Date
  /** Open an existing ledger without creating directories, schema, or write access. */
  readonly?: boolean
}

export interface ShadowReplayLedgerQuery {
  candidateId?: string
  failureId?: string
  limit?: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS shadow_replay_runs (
  run_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  failure_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shadow_replay_candidate ON shadow_replay_runs(candidate_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_shadow_replay_failure ON shadow_replay_runs(failure_id, recorded_at);
CREATE TRIGGER IF NOT EXISTS shadow_replay_runs_no_update
BEFORE UPDATE ON shadow_replay_runs
BEGIN SELECT RAISE(ABORT, 'Shadow Replay ledger records are immutable'); END;
CREATE TRIGGER IF NOT EXISTS shadow_replay_runs_no_delete
BEFORE DELETE ON shadow_replay_runs
BEGIN SELECT RAISE(ABORT, 'Shadow Replay ledger records are immutable'); END;
`

export class ShadowReplayLedger {
  private readonly db: BetterSqlite3.Database
  private readonly dbPath: string
  private readonly now: () => Date

  constructor(options: ShadowReplayLedgerOptions = {}) {
    const projectDir = resolve(options.projectDir ?? process.cwd())
    this.dbPath = resolve(options.dbPath ?? join(projectDir, '.scale', 'evolution', 'shadow-replays.sqlite'))
    const Database = loadDatabase()
    if (options.readonly) {
      if (!existsSync(this.dbPath)) throw new Error(`Shadow Replay ledger not found: ${this.dbPath}`)
      this.db = new Database(this.dbPath, { readonly: true, fileMustExist: true })
      this.db.pragma('busy_timeout = 5000')
    } else {
      const dir = dirname(this.dbPath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      this.db = new Database(this.dbPath)
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('busy_timeout = 5000')
      this.db.exec(SCHEMA)
    }
    this.now = options.now ?? (() => new Date())
  }

  record(plan: ShadowReplayPlan, result: ShadowReplayRunResult, provenance: ShadowReplayProvenance): ShadowReplayLedgerRecord {
    if (plan.runId !== result.runId || plan.candidateId !== result.candidateId || plan.failureId !== result.failureId) {
      throw new Error('Shadow Replay ledger plan/result identity mismatch')
    }
    if (plan.adapterId !== result.adapterId || plan.adapterVersion !== result.adapterVersion || plan.sandboxKind !== result.sandboxKind) {
      throw new Error('Shadow Replay ledger adapter provenance mismatch')
    }
    if (result.productionPolicyChanged !== false || result.hooksChanged !== false) {
      throw new Error('Shadow Replay ledger refuses results that claim production policy or hook changes')
    }
    if (provenance.scenarioSnapshotDigest !== plan.scenarioSnapshotDigest
      || provenance.candidateBundleDigest !== plan.candidateBundleDigest) {
      throw new Error('Shadow Replay ledger input digest provenance mismatch')
    }
    if (plan.adapterId === 'docker-container'
      && (!provenance.runnerImageRef || !/^.+@sha256:[a-f0-9]{64}$/.test(provenance.runnerImageRef))) {
      throw new Error('Docker Shadow Replay ledger records require a digest-pinned runnerImageRef')
    }
    const recordedAt = this.now().toISOString()
    const record: ShadowReplayLedgerRecord = {
      schemaVersion: 1,
      runId: plan.runId,
      plan,
      result,
      provenance: { ...provenance, recordedBy: provenance.recordedBy.trim() },
      recordedAt,
    }
    if (!record.provenance.recordedBy) throw new Error('Shadow Replay ledger recordedBy is required')
    this.db.prepare(`
      INSERT INTO shadow_replay_runs (run_id, candidate_id, failure_id, recorded_at, payload_json)
      VALUES (@runId, @candidateId, @failureId, @recordedAt, @payload)
    `).run({
      runId: record.runId,
      candidateId: plan.candidateId,
      failureId: plan.failureId,
      recordedAt,
      payload: JSON.stringify(record),
    })
    return record
  }

  get(runId: string): ShadowReplayLedgerRecord | null {
    const row = this.db.prepare('SELECT payload_json FROM shadow_replay_runs WHERE run_id = ?').get(runId) as { payload_json: string } | undefined
    return row ? JSON.parse(row.payload_json) as ShadowReplayLedgerRecord : null
  }

  list(query: ShadowReplayLedgerQuery = {}): ShadowReplayLedgerRecord[] {
    const limit = query.limit ?? 100
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) throw new Error('Shadow Replay ledger limit must be between 1 and 10000')
    const rows = this.db.prepare(`
      SELECT payload_json FROM shadow_replay_runs
      WHERE (@candidateId IS NULL OR candidate_id = @candidateId)
        AND (@failureId IS NULL OR failure_id = @failureId)
      ORDER BY recorded_at DESC, run_id DESC
      LIMIT @limit
    `).all({
      candidateId: query.candidateId ?? null,
      failureId: query.failureId ?? null,
      limit,
    }) as Array<{ payload_json: string }>
    return rows.map(row => JSON.parse(row.payload_json) as ShadowReplayLedgerRecord)
  }

  getDatabasePath(): string {
    return this.dbPath
  }

  close(): void {
    this.db.close()
  }
}
