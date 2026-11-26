import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ShadowReplayPlan, ShadowReplayRunResult } from '../../src/evolution/ShadowReplayContract.js'
import { ShadowReplayLedger } from '../../src/evolution/ShadowReplayLedger.js'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (path: string) => {
  prepare(sql: string): { run(...args: unknown[]): unknown }
  close(): void
}

const dirs: string[] = []
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'shadow-replay-ledger-'))
  dirs.push(dir)
  const plan: ShadowReplayPlan = {
    contractVersion: 1, runId: 'SHADOW-REPLAY-001', candidateId: 'CAND-1', failureId: 'FAIL-1',
    sourceCommitSha: 'a'.repeat(40), scenarioSnapshotDigest: `sha256:${'b'.repeat(64)}`,
    candidateBundleDigest: `sha256:${'c'.repeat(64)}`, adapterId: 'docker-container', adapterVersion: '1.0.0',
    sandboxKind: 'container', limits: { timeoutMs: 1000, memoryLimitMb: 512, cpuTimeLimitMs: 1000 },
    createdAt: '2026-11-26T00:00:00.000Z',
  }
  const result: ShadowReplayRunResult = {
    contractVersion: 1, runId: plan.runId, candidateId: plan.candidateId, failureId: plan.failureId,
    adapterId: plan.adapterId, adapterVersion: plan.adapterVersion, sandboxKind: 'container', status: 'passed',
    startedAt: '2026-11-26T00:00:01.000Z', completedAt: '2026-11-26T00:00:02.000Z', durationMs: 1000,
    exitCode: 0, stdoutSummary: 'ok', stderrSummary: '', redactionApplied: false,
    productionPolicyChanged: false, hooksChanged: false,
  }
  const provenance = {
    runnerImageRef: `ghcr.io/example/runner@sha256:${'d'.repeat(64)}`,
    recordedBy: 'test-suite',
    scenarioSnapshotDigest: plan.scenarioSnapshotDigest,
    candidateBundleDigest: plan.candidateBundleDigest,
  }
  return { dir, plan, result, provenance }
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('ShadowReplayLedger', () => {
  it('persists a replay record and can read it after reopening the database', () => {
    const f = fixture()
    const ledger = new ShadowReplayLedger({ projectDir: f.dir, now: () => new Date('2026-11-26T01:00:00.000Z') })
    const saved = ledger.record(f.plan, f.result, f.provenance)
    expect(saved.runId).toBe(f.plan.runId)
    expect(ledger.get(f.plan.runId)).toEqual(saved)
    ledger.close()

    const reopened = new ShadowReplayLedger({ projectDir: f.dir })
    expect(reopened.get(f.plan.runId)).toEqual(saved)
    expect(reopened.list({ candidateId: 'CAND-1' })).toHaveLength(1)
    reopened.close()
  })

  it('supports read-only inspection without creating or mutating the ledger', () => {
    const f = fixture()
    const writer = new ShadowReplayLedger({ projectDir: f.dir })
    const saved = writer.record(f.plan, f.result, f.provenance)
    const dbPath = writer.getDatabasePath()
    writer.close()

    const reader = new ShadowReplayLedger({ dbPath, readonly: true })
    expect(reader.get(f.plan.runId)).toEqual(saved)
    expect(reader.list()).toHaveLength(1)
    expect(() => reader.record(f.plan, f.result, f.provenance)).toThrow()
    reader.close()
  })

  it('does not create a missing ledger when opened read-only', () => {
    const f = fixture()
    const missing = join(f.dir, 'missing.sqlite')
    expect(() => new ShadowReplayLedger({ dbPath: missing, readonly: true })).toThrow('ledger not found')
  })

  it('rejects duplicate run IDs instead of overwriting prior evidence', () => {
    const f = fixture()
    const ledger = new ShadowReplayLedger({ projectDir: f.dir })
    ledger.record(f.plan, f.result, f.provenance)
    expect(() => ledger.record(f.plan, f.result, f.provenance)).toThrow()
    expect(ledger.list()).toHaveLength(1)
    ledger.close()
  })

  it('rejects plan/result identity and digest provenance mismatches', () => {
    const f = fixture()
    const ledger = new ShadowReplayLedger({ projectDir: f.dir })
    expect(() => ledger.record(f.plan, { ...f.result, failureId: 'OTHER' }, f.provenance)).toThrow('identity mismatch')
    expect(() => ledger.record(f.plan, f.result, { ...f.provenance, scenarioSnapshotDigest: 'sha256:bad' })).toThrow('digest provenance mismatch')
    ledger.close()
  })

  it('requires a digest-pinned image for Docker-backed records', () => {
    const f = fixture()
    const ledger = new ShadowReplayLedger({ projectDir: f.dir })
    expect(() => ledger.record(f.plan, f.result, { ...f.provenance, runnerImageRef: 'latest' })).toThrow('digest-pinned runnerImageRef')
    ledger.close()
  })

  it('uses database triggers to reject update and delete operations', () => {
    const f = fixture()
    const ledger = new ShadowReplayLedger({ projectDir: f.dir })
    ledger.record(f.plan, f.result, f.provenance)
    const db = new Database(ledger.getDatabasePath())
    expect(() => db.prepare('UPDATE shadow_replay_runs SET payload_json = ? WHERE run_id = ?').run('{}', f.plan.runId)).toThrow('immutable')
    expect(() => db.prepare('DELETE FROM shadow_replay_runs WHERE run_id = ?').run(f.plan.runId)).toThrow('immutable')
    db.close()
    expect(ledger.get(f.plan.runId)?.result.status).toBe('passed')
    ledger.close()
  })

  it('bounds list limits', () => {
    const f = fixture()
    const ledger = new ShadowReplayLedger({ projectDir: f.dir })
    expect(() => ledger.list({ limit: 0 })).toThrow('between 1 and 10000')
    ledger.close()
  })
})
