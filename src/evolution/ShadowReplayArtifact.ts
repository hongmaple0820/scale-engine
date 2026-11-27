import { createHash } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { ShadowReplayLedgerRecord } from './ShadowReplayLedger.js'

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export interface ShadowReplayArtifactManifestV1 {
  schemaVersion: 1
  kind: 'scale-shadow-replay-artifact'
  runId: string
  recordedAt: string
  record: ShadowReplayLedgerRecord
  recordDigest: string
  inputDigests: {
    scenarioSnapshotDigest: string
    candidateBundleDigest: string
  }
  runnerImageRef: string | null
  manifestDigest: string
}

export interface WriteShadowReplayArtifactOptions {
  directory: string
  record: ShadowReplayLedgerRecord
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`
}

/**
 * Serialize JSON-safe data deterministically. Object keys use code-unit order;
 * non-JSON values, custom prototypes and cycles are rejected rather than coerced.
 */
export function canonicalizeShadowReplayJson(value: unknown): string {
  const ancestors = new Set<object>()
  const visit = (current: unknown): string => {
    if (current === null) return 'null'
    if (typeof current === 'string' || typeof current === 'boolean') return JSON.stringify(current)
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new Error('Shadow Replay artifact JSON numbers must be finite')
      return JSON.stringify(current)
    }
    if (Array.isArray(current)) {
      if (ancestors.has(current)) throw new Error('Shadow Replay artifact JSON must not contain cycles')
      ancestors.add(current)
      const encoded = `[${current.map(item => {
        if (item === undefined) throw new Error('Shadow Replay artifact JSON must not contain undefined values')
        return visit(item)
      }).join(',')}]`
      ancestors.delete(current)
      return encoded
    }
    if (typeof current === 'object') {
      const object = current as Record<string, unknown>
      const prototype = Object.getPrototypeOf(object)
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error('Shadow Replay artifact JSON must contain only plain objects')
      }
      if (ancestors.has(object)) throw new Error('Shadow Replay artifact JSON must not contain cycles')
      ancestors.add(object)
      const keys = Object.keys(object).sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
      const encoded = `{${keys.map(key => {
        if (object[key] === undefined) throw new Error('Shadow Replay artifact JSON must not contain undefined values')
        return `${JSON.stringify(key)}:${visit(object[key])}`
      }).join(',')}}`
      ancestors.delete(object)
      return encoded
    }
    throw new Error('Shadow Replay artifact JSON contains a non-JSON value')
  }
  return visit(value)
}

function validateRecord(record: ShadowReplayLedgerRecord): void {
  if (!record || record.schemaVersion !== 1 || !RUN_ID_PATTERN.test(record.runId)) {
    throw new Error('Shadow Replay artifact record has an invalid schema or runId')
  }
  if (record.runId !== record.plan.runId || record.runId !== record.result.runId) {
    throw new Error('Shadow Replay artifact record identity mismatch')
  }
  if (!DIGEST_PATTERN.test(record.plan.scenarioSnapshotDigest)
    || !DIGEST_PATTERN.test(record.plan.candidateBundleDigest)
    || record.provenance.scenarioSnapshotDigest !== record.plan.scenarioSnapshotDigest
    || record.provenance.candidateBundleDigest !== record.plan.candidateBundleDigest) {
    throw new Error('Shadow Replay artifact record input digest provenance mismatch')
  }
  if (record.plan.adapterId === 'docker-container'
    && (!record.provenance.runnerImageRef || !/^.+@sha256:[a-f0-9]{64}$/.test(record.provenance.runnerImageRef))) {
    throw new Error('Shadow Replay artifact Docker image reference must be digest-pinned')
  }
  if (!Number.isFinite(Date.parse(record.recordedAt))) {
    throw new Error('Shadow Replay artifact record recordedAt is invalid')
  }
}

function unsignedManifest(record: ShadowReplayLedgerRecord): Omit<ShadowReplayArtifactManifestV1, 'manifestDigest'> {
  validateRecord(record)
  const recordDigest = sha256(canonicalizeShadowReplayJson(record))
  return {
    schemaVersion: 1,
    kind: 'scale-shadow-replay-artifact',
    runId: record.runId,
    recordedAt: record.recordedAt,
    record,
    recordDigest,
    inputDigests: {
      scenarioSnapshotDigest: record.plan.scenarioSnapshotDigest,
      candidateBundleDigest: record.plan.candidateBundleDigest,
    },
    runnerImageRef: record.provenance.runnerImageRef ?? null,
  }
}

export function createShadowReplayArtifactManifest(record: ShadowReplayLedgerRecord): ShadowReplayArtifactManifestV1 {
  const unsigned = unsignedManifest(record)
  return { ...unsigned, manifestDigest: sha256(canonicalizeShadowReplayJson(unsigned)) }
}

/** Recompute all content digests and cross-check manifest/record identity. */
export function verifyShadowReplayArtifactManifest(value: unknown): value is ShadowReplayArtifactManifestV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const manifest = value as ShadowReplayArtifactManifestV1
  try {
    if (manifest.schemaVersion !== 1 || manifest.kind !== 'scale-shadow-replay-artifact'
      || !RUN_ID_PATTERN.test(manifest.runId) || !DIGEST_PATTERN.test(manifest.recordDigest)
      || !DIGEST_PATTERN.test(manifest.manifestDigest)) return false
    if (manifest.runId !== manifest.record?.runId || manifest.recordedAt !== manifest.record?.recordedAt) return false
    const expected = createShadowReplayArtifactManifest(manifest.record)
    return canonicalizeShadowReplayJson(manifest) === canonicalizeShadowReplayJson(expected)
  } catch {
    return false
  }
}

/**
 * Write a manifest with exclusive publication semantics. A hard-link publish
 * makes the final name appear atomically and fails if it already exists.
 * This is integrity metadata, not a digital signature or authenticity proof.
 */
export function writeShadowReplayArtifact(options: WriteShadowReplayArtifactOptions): {
  path: string
  manifest: ShadowReplayArtifactManifestV1
} {
  const directory = resolve(options.directory)
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 })
  const directoryStat = lstatSync(directory)
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new Error('Shadow Replay artifact directory must be a regular non-symlink directory')
  }
  const manifest = createShadowReplayArtifactManifest(options.record)
  const target = join(directory, `${manifest.runId}.shadow-replay.json`)
  const temporary = join(directory, `.${manifest.runId}.${process.pid}.${createHash('sha256').update(String(Date.now()) + Math.random()).digest('hex').slice(0, 12)}.tmp`)
  let fd: number | undefined
  try {
    fd = openSync(temporary, 'wx', 0o600)
    writeFileSync(fd, `${canonicalizeShadowReplayJson(manifest)}\n`, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    linkSync(temporary, target)
    unlinkSync(temporary)
    return { path: target, manifest }
  } catch (error) {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(temporary) } catch { /* best-effort cleanup */ }
    throw error
  }
}

/** Read and verify a manifest without trusting its filename or embedded digests. */
export function verifyShadowReplayArtifactFile(path: string): ShadowReplayArtifactManifestV1 {
  const absolute = resolve(path)
  const stat = lstatSync(absolute)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Shadow Replay artifact must be a regular non-symlink file')
  const raw = (awaitlessReadFile(absolute)).toString('utf8')
  let parsed: unknown
  try { parsed = JSON.parse(raw) as unknown } catch { throw new Error('Shadow Replay artifact is not valid JSON') }
  if (!verifyShadowReplayArtifactManifest(parsed)) throw new Error('Shadow Replay artifact integrity verification failed')
  if (basename(absolute) !== `${(parsed as ShadowReplayArtifactManifestV1).runId}.shadow-replay.json`) {
    throw new Error('Shadow Replay artifact filename does not match its runId')
  }
  return parsed as ShadowReplayArtifactManifestV1
}

function awaitlessReadFile(path: string): Buffer {
  const fd = openSync(path, 'r')
  try { return readFileSync(fd) } finally { closeSync(fd) }
}

