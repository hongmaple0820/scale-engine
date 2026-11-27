import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  canonicalizeShadowReplayJson,
  createShadowReplayArtifactManifest,
  verifyShadowReplayArtifactFile,
  verifyShadowReplayArtifactManifest,
  writeShadowReplayArtifact,
} from '../../src/evolution/ShadowReplayArtifact.js'
import type { ShadowReplayLedgerRecord } from '../../src/evolution/ShadowReplayLedger.js'

const dirs: string[] = []
function fixture(): ShadowReplayLedgerRecord {
  const dir = mkdtempSync(join(tmpdir(), 'shadow-replay-artifact-'))
  dirs.push(dir)
  const digest = \`sha256:\${'a'.repeat(64)}\`
  return {
    schemaVersion: 1,
    runId: 'SHADOW-REPLAY-ARTIFACT-1',
    plan: {
      contractVersion: 1, runId: 'SHADOW-REPLAY-ARTIFACT-1', candidateId: 'IMPROVE-1',
      failureId: 'FAIL-1', sourceCommitSha: 'b'.repeat(40),
      scenarioSnapshotDigest: digest, candidateBundleDigest: \`sha256:\${'c'.repeat(64)}\`,
      adapterId: 'docker-container', adapterVersion: '1.0.0', sandboxKind: 'container',
      limits: { timeoutMs: 10000, memoryLimitMb: 512, cpuTimeLimitMs: 10000 },
      createdAt: '2026-11-27T00:00:00.000Z',
    },
    result: {
      contractVersion: 1, runId: 'SHADOW-REPLAY-ARTIFACT-1', candidateId: 'IMPROVE-1',
      failureId: 'FAIL-1', adapterId: 'docker-container', adapterVersion: '1.0.0',
      sandboxKind: 'container', status: 'passed', startedAt: '2026-11-27T00:00:01.000Z',
      completedAt: '2026-11-27T00:00:02.000Z', durationMs: 1000, exitCode: 0,
      stdoutSummary: '{"passed":true}', stderrSummary: '', redactionApplied: false,
      productionPolicyChanged: false, hooksChanged: false,
    },
    provenance: {
      runnerImageRef: \`ghcr.io/example/runner@sha256:\${'d'.repeat(64)}\`,
      recordedBy: 'artifact-test', scenarioSnapshotDigest: digest,
      candidateBundleDigest: \`sha256:\${'c'.repeat(64)}\`,
    },
    recordedAt: '2026-11-27T00:00:02.000Z',
  }
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('Shadow Replay artifact manifest', () => {
  it('canonicalizes object keys deterministically without changing array order', () => {
    expect(canonicalizeShadowReplayJson({ z: 1, a: { y: true, b: null } }))
      .toBe(canonicalizeShadowReplayJson({ a: { b: null, y: true }, z: 1 }))
    expect(canonicalizeShadowReplayJson([2, 1])).not.toBe(canonicalizeShadowReplayJson([1, 2]))
    expect(() => canonicalizeShadowReplayJson({ value: Number.NaN })).toThrow('finite')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => canonicalizeShadowReplayJson(cyclic)).toThrow('cycles')
  })

  it('creates a stable manifest and verifies its record and manifest digests', () => {
    const record = fixture()
    const first = createShadowReplayArtifactManifest(record)
    const second = createShadowReplayArtifactManifest(record)
    expect(first).toEqual(second)
    expect(first.recordDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(first.manifestDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(verifyShadowReplayArtifactManifest(first)).toBe(true)
    expect(verifyShadowReplayArtifactManifest({
      ...first, record: { ...record, result: { ...record.result, status: 'failed' } },
    })).toBe(false)
  })

  it('publishes an artifact file and verifies it from disk', () => {
    const record = fixture()
    const directory = join(dirs[0], 'artifacts')
    const written = writeShadowReplayArtifact({ directory, record })
    expect(verifyShadowReplayArtifactFile(written.path)).toEqual(written.manifest)
    expect(JSON.parse(readFileSync(written.path, 'utf8'))).toEqual(written.manifest)
  })

  it('refuses to overwrite an existing artifact for the same runId', () => {
    const record = fixture()
    const directory = join(dirs[0], 'artifacts')
    const first = writeShadowReplayArtifact({ directory, record })
    expect(() => writeShadowReplayArtifact({ directory, record })).toThrow()
    expect(verifyShadowReplayArtifactFile(first.path)).toEqual(first.manifest)
  })

  it('rejects symlink artifact files and directories', () => {
    const record = fixture()
    const directory = join(dirs[0], 'artifacts')
    const written = writeShadowReplayArtifact({ directory, record })
    const fileLink = join(dirs[0], 'artifact-link.json')
    symlinkSync(written.path, fileLink)
    expect(() => verifyShadowReplayArtifactFile(fileLink)).toThrow('non-symlink')
    const directoryLink = join(dirs[0], 'directory-link')
    symlinkSync(directory, directoryLink)
    expect(() => writeShadowReplayArtifact({ directory: directoryLink, record })).toThrow('non-symlink')
  })

  it('rejects unsafe run identifiers before constructing a path', () => {
    const record = fixture()
    record.runId = '../escape'
    expect(() => createShadowReplayArtifactManifest(record)).toThrow('invalid schema or runId')
  })
})
