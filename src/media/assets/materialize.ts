// Asset materialization (M1): before rendering, every `asset://` reference is
// copied from its (succeeded, same-project) source task into
// `<taskDir>/assets/external/<sourceTaskId>/<rest>`, and the storyboard is
// returned as a new immutable value whose image src values point at the copy
// (`external/<sourceTaskId>/<rest>` — src is relative to assets/).
//
// Idempotent: an existing copy with the same sha256 is reused; an existing copy
// with a different hash is corruption (never silently overwritten). Each
// materialized ref produces an `asset_materialized` evidence event so the
// mapping from ref to copy is auditable.

import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { MediaError } from '../errors.js'
import { sha256File } from './hash.js'
import type { AssetRecord, MediaJob, Storyboard } from '../types.js'
import type { MediaWorkspace } from '../jobs/JobStore.js'
import { findJob } from '../jobs/JobStore.js'
import type { EvidenceWriter } from '../evidence/EvidenceWriter.js'
import {
  assetRefExternalPath,
  assetRefExternalSrc,
  assetRefTaskPath,
  collectAssetRefs,
  isAssetRef,
  parseAssetRef,
  type AssetRef,
} from './refs.js'

export interface MaterializeOptions {
  workspace: MediaWorkspace
  taskDir: string
  taskId: string
  storyboard: Storyboard
  evidence?: EvidenceWriter
  /** checked between refs so a long materialize pass can be cancelled */
  isCancelled?: () => boolean
}

export interface MaterializedAsset {
  /** original asset:// reference */
  ref: string
  sourceTaskId: string
  sourceSha256: string
  /** task-relative destination path (assets/external/<sourceTaskId>/<rest>) */
  destPath: string
  /** storyboard src after rewrite (external/<sourceTaskId>/<rest>) */
  src: string
  bytes: number
  /** true when an identical copy already existed (retry/idempotency) */
  skipped: boolean
}

export interface MaterializeResult {
  storyboard: Storyboard
  assets: MaterializedAsset[]
}

interface SourceAsset {
  job: MediaJob
  /** assets/<rest> */
  taskPath: string
  absPath: string
  /** job output record, when the path is a committed output */
  record?: AssetRecord
  /** sha256 from the task's asset manifest (covers materialized copies) */
  manifestSha256?: string
}

const ASSET_MANIFEST_FILE = '.asset-manifest.json'

interface AssetManifestEntry {
  path: string
  sha256: string
  bytes: number
  kind: 'image' | 'video' | 'audio' | 'other'
  source: 'generated' | 'materialized'
  sourceTaskId?: string
  recordedAt: string
}

interface AssetManifest {
  schemaVersion: 1
  assets: Record<string, AssetManifestEntry>
}

function manifestPath(taskDir: string): string {
  return join(taskDir, 'assets', ASSET_MANIFEST_FILE)
}

function readAssetManifest(taskDir: string): AssetManifest {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath(taskDir), 'utf-8')) as Partial<AssetManifest>
    return {
      schemaVersion: 1,
      assets: parsed.assets && typeof parsed.assets === 'object' ? (parsed.assets as AssetManifest['assets']) : {},
    }
  } catch {
    return { schemaVersion: 1, assets: {} }
  }
}

function writeAssetManifest(taskDir: string, manifest: AssetManifest): void {
  const path = manifestPath(taskDir)
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${randomUUID().slice(0, 8)}.tmp`
  writeFileSync(tmp, JSON.stringify(manifest, null, 1), 'utf-8')
  renameSync(tmp, path)
}

function kindForRest(rest: string): AssetManifestEntry['kind'] {
  const ext = rest.toLowerCase().slice(rest.lastIndexOf('.'))
  if (['.mp4', '.mov', '.webm'].includes(ext)) return 'video'
  if (['.mp3', '.wav', '.m4a', '.aac'].includes(ext)) return 'audio'
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return 'image'
  return 'other'
}

function recordMaterializedAsset(
  taskDir: string,
  entry: Pick<AssetManifestEntry, 'path' | 'sha256' | 'bytes' | 'sourceTaskId' | 'kind'>,
): void {
  const manifest = readAssetManifest(taskDir)
  const existing = manifest.assets[entry.path]
  if (existing && existing.sha256 !== entry.sha256) {
    throw new MediaError(
      'MEDIA_ASSET_REF_CORRUPT',
      `asset manifest for "${entry.path}" records a different sha256; refusing to overwrite the baseline`,
    )
  }
  if (existing) return
  manifest.assets[entry.path] = {
    ...entry,
    source: 'materialized',
    recordedAt: new Date().toISOString(),
  }
  writeAssetManifest(taskDir, manifest)
}

const DEFAULT_MAX_ASSET_MB = 256
const DEFAULT_MAX_TASK_ASSETS_MB = 1024

function mbEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return value
}

function maxAssetBytes(): number {
  return mbEnv('MEDIA_ASSET_MAX_MB', DEFAULT_MAX_ASSET_MB) * 1024 * 1024
}

function maxTaskAssetBytes(): number {
  return mbEnv('MEDIA_TASK_ASSETS_MAX_MB', DEFAULT_MAX_TASK_ASSETS_MB) * 1024 * 1024
}

/**
 * Copy to a sibling temp file, verify, then rename — a crash mid-copy leaves
 * only a temp file, never a poisoned destination that would read as CORRUPT
 * forever. Stale temps from an earlier crash are removed first.
 */
function atomicCopy(sourceAbs: string, destAbs: string, expectedSha256: string, label: string): void {
  const dir = dirname(destAbs)
  const base = basename(destAbs)
  mkdirSync(dir, { recursive: true })
  try {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(`${base}.tmp-`)) rmSync(join(dir, name), { force: true })
    }
  } catch {
    // listing is best-effort; a stale temp does not affect the rename below
  }
  const tmp = join(dir, `${base}.tmp-${randomUUID().slice(0, 8)}`)
  try {
    copyFileSync(sourceAbs, tmp)
    const copiedSha256 = sha256File(tmp)
    if (copiedSha256 !== expectedSha256) {
      throw new MediaError('MEDIA_ASSET_REF_CORRUPT', `copy verification failed for "${label}"`)
    }
    renameSync(tmp, destAbs)
  } catch (error) {
    try { rmSync(tmp, { force: true }) } catch { /* temp only */ }
    throw error
  }
}

/**
 * Resolve `base/candidate` and require it to stay inside base. Uses
 * path.relative rather than a string prefix so sibling task dirs that share a
 * prefix (job-1 vs job-10) cannot slip through.
 */
function containedPath(base: string, candidate: string, label: string): string {
  const resolvedBase = resolve(base)
  const resolved = resolve(candidate)
  const rel = relative(resolvedBase, resolved)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new MediaError('MEDIA_ASSET_REF_INVALID', `${label} escapes its directory`)
  }
  return resolved
}

/** Source task must exist in the same project, be succeeded, and hold the file. */
function resolveSourceAsset(workspace: MediaWorkspace, ref: AssetRef): SourceAsset {
  let found: { dir: string; job: MediaJob }
  try {
    found = findJob(workspace, ref.taskId)
  } catch (error) {
    if (error instanceof MediaError && error.code === 'MEDIA_JOB_NOT_FOUND') {
      throw new MediaError(
        'MEDIA_ASSET_REF_MISSING',
        `asset ref "${ref.raw}" points at task "${ref.taskId}", which does not exist in project "${workspace.projectId}"`,
      )
    }
    throw error
  }
  if (found.job.status !== 'succeeded') {
    throw new MediaError(
      'MEDIA_ASSET_REF_MISSING',
      `asset ref "${ref.raw}" points at task "${ref.taskId}" in status "${found.job.status}"; only succeeded tasks can be referenced`,
    )
  }

  const assetsDir = join(found.dir, 'assets')
  const absPath = containedPath(assetsDir, join(assetsDir, ref.rest), `asset ref "${ref.raw}"`)
  if (!existsSync(absPath) || !statSync(absPath).isFile()) {
    throw new MediaError('MEDIA_ASSET_REF_MISSING', `asset ref "${ref.raw}" points at a missing file`)
  }

  const taskPath = assetRefTaskPath(ref)
  const record = found.job.outputs.find(output => output.path.split('\\').join('/') === taskPath)
  // Materialized copies (assets/external/**) have no job output record; the
  // source task's manifest, written when the copy was made, is their baseline.
  const manifestSha256 = readAssetManifest(found.dir).assets[taskPath]?.sha256
  return { job: found.job, taskPath, absPath, record, manifestSha256 }
}

/**
 * Create-time check (M1 rule 5): syntax was already validated; here we confirm
 * each ref resolves to a succeeded source task in this project and its file
 * exists. No copying and no hashing happen at create time.
 */
export function assertAssetRefsAvailable(workspace: MediaWorkspace, storyboard: Storyboard): void {
  for (const node of collectAssetRefs(storyboard)) {
    resolveSourceAsset(workspace, node.ref)
  }
}

function materializeOne(options: MaterializeOptions, ref: AssetRef, usedBytes: number): MaterializedAsset {
  const source = resolveSourceAsset(options.workspace, ref)
  const sourceSize = statSync(source.absPath).size
  const assetLimit = maxAssetBytes()
  if (sourceSize > assetLimit) {
    throw new MediaError(
      'MEDIA_QUOTA_EXCEEDED',
      `asset "${ref.raw}" is ${(sourceSize / 1024 / 1024).toFixed(1)} MB, over the ${(assetLimit / 1024 / 1024).toFixed(0)} MB per-asset limit (MEDIA_ASSET_MAX_MB)`,
    )
  }

  const sourceSha256 = sha256File(source.absPath)
  const baseline = source.record?.sha256 ?? source.manifestSha256
  if (baseline !== undefined && baseline !== sourceSha256) {
    throw new MediaError(
      'MEDIA_ASSET_REF_CORRUPT',
      `source asset "${ref.raw}" does not match its recorded sha256 (recorded ${baseline.slice(0, 12)}…, actual ${sourceSha256.slice(0, 12)}…)`,
    )
  }
  // Neither a job output record nor a manifest entry: the file predates asset
  // manifests. Accepted (there is nothing to verify against) and baselined below.

  const destPath = assetRefExternalPath(ref)
  const destAbs = containedPath(options.taskDir, join(options.taskDir, destPath), `materialized path for "${ref.raw}"`)
  const destManifest = readAssetManifest(options.taskDir)
  const recordedDestSha = destManifest.assets[destPath]?.sha256
  if (recordedDestSha !== undefined && recordedDestSha !== sourceSha256) {
    throw new MediaError(
      'MEDIA_ASSET_REF_CORRUPT',
      `asset manifest for "${destPath}" records a different sha256; refusing to overwrite the baseline`,
    )
  }

  let skipped = false
  if (existsSync(destAbs)) {
    if (!statSync(destAbs).isFile()) {
      throw new MediaError('MEDIA_ASSET_REF_CORRUPT', `materialized destination for "${ref.raw}" is not a file`)
    }
    const existingSha256 = sha256File(destAbs)
    if (existingSha256 !== sourceSha256) {
      throw new MediaError(
        'MEDIA_ASSET_REF_CORRUPT',
        `materialized copy for "${ref.raw}" already exists with a different sha256; refusing to overwrite`,
      )
    }
    skipped = true
  } else {
    const taskLimit = maxTaskAssetBytes()
    if (usedBytes + sourceSize > taskLimit) {
      throw new MediaError(
        'MEDIA_QUOTA_EXCEEDED',
        `materializing "${ref.raw}" would exceed the ${(taskLimit / 1024 / 1024).toFixed(0)} MB per-task asset budget (MEDIA_TASK_ASSETS_MAX_MB)`,
      )
    }
    atomicCopy(source.absPath, destAbs, sourceSha256, ref.raw)
  }

  const bytes = statSync(destAbs).size
  const asset: MaterializedAsset = {
    ref: ref.raw,
    sourceTaskId: ref.taskId,
    sourceSha256,
    destPath,
    src: assetRefExternalSrc(ref),
    bytes,
    skipped,
  }
  recordMaterializedAsset(options.taskDir, {
    path: destPath,
    sha256: sourceSha256,
    bytes,
    sourceTaskId: ref.taskId,
    kind: kindForRest(ref.rest),
  })
  options.evidence?.append('asset_materialized', 'ok', {
    ref: asset.ref,
    sourceTaskId: asset.sourceTaskId,
    sourceSha256: asset.sourceSha256,
    destPath: asset.destPath,
    bytes: asset.bytes,
    skipped: asset.skipped,
  })
  return asset
}

/**
 * Copy every external ref into this task and return a new storyboard whose
 * image src values point at the copies. With no refs the input is returned
 * unchanged (no copy, no rewrite).
 */
export function materializeAssets(options: MaterializeOptions): MaterializeResult {
  const nodes = collectAssetRefs(options.storyboard)
  if (nodes.length === 0) return { storyboard: options.storyboard, assets: [] }
  // Defence in depth: the validator already gates refs to 0.3, but a board on
  // disk from before the upgrade (or a tampered file) must not get ref
  // semantics under old versions.
  if (options.storyboard.schemaVersion !== '0.3' && options.storyboard.schemaVersion !== '0.4') {
    throw new MediaError('MEDIA_ASSET_REF_INVALID', 'asset:// references require schemaVersion 0.3')
  }

  const byRef = new Map<string, MaterializedAsset>()
  const byDestination = new Map<string, MaterializedAsset>()
  let usedBytes = 0
  for (const node of nodes) {
    // NTFS is case-insensitive: `HERO.PNG` and `hero.png` are the same file, so
    // dedupe on the destination identity there. POSIX keeps raw-ref semantics.
    const destination = assetRefExternalPath(node.ref)
    const key = process.platform === 'win32' ? destination.toLowerCase() : node.ref.raw
    const existing = byDestination.get(key)
    if (existing) {
      byRef.set(node.ref.raw, existing)
      continue
    }
    if (options.isCancelled?.()) {
      throw new MediaError('MEDIA_JOB_CANCELLED', 'cancelled during asset materialization')
    }
    const asset = materializeOne(options, node.ref, usedBytes)
    if (!asset.skipped) usedBytes += asset.bytes
    byDestination.set(key, asset)
    byRef.set(node.ref.raw, asset)
  }

  const scenes = options.storyboard.scenes.map(scene => ({
    ...scene,
    elements: scene.elements.map(element => {
      if ((element.type !== 'image' && element.type !== 'video') || !isAssetRef(element.src)) return element
      const rewritten = byRef.get(element.src)?.src
      if (!rewritten) {
        // collectAssetRefs parsed every ref above, so this is a programming error
        throw new MediaError('MEDIA_ASSET_REF_INVALID', `asset ref was not materialized: ${parseAssetRef(element.src).raw}`)
      }
      return { ...element, src: rewritten }
    }),
  }))

  const audioTracks = options.storyboard.audioTracks?.map(track => {
    if (!isAssetRef(track.src)) return track
    const rewritten = byRef.get(track.src)?.src
    if (!rewritten) {
      throw new MediaError('MEDIA_ASSET_REF_INVALID', `asset ref was not materialized: ${parseAssetRef(track.src).raw}`)
    }
    return { ...track, src: rewritten }
  })

  return {
    storyboard: {
      ...options.storyboard,
      scenes,
      ...(audioTracks ? { audioTracks } : {}),
    },
    assets: [...byDestination.values()],
  }
}
