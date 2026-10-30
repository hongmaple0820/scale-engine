// `asset://` references (M1): a generated result from a succeeded task in the
// same project can be pulled into another task's storyboard. The grammar is
// fixed and deliberately narrow — no URLs, no percent-encoding, no backslashes:
//
//   asset://<taskId>/assets/<rest>
//
// `<taskId>` is a media task id (same charset as taskDirOf); `<rest>` is a
// forward-slash path *inside* that task's assets/ directory. Everything else
// (empty rest, `..`, absolute paths, drive letters, empty segments) is rejected
// before any filesystem call. Rendering materializes refs into the current
// task; the validator re-checks the same shape at the schema boundary.

import { MediaError } from '../errors.js'
import type { Storyboard } from '../types.js'

export const ASSET_REF_SCHEME = 'asset://'
export const ASSET_REF_MAX_LENGTH = 300
export const ASSET_REST_MAX_LENGTH = 200

const TASK_ID_RE = /^[\w-]{1,80}$/
const REST_RE = /^[\w./-]+$/

export interface AssetRef {
  /** the original `asset://...` string */
  raw: string
  /** source task id (must exist in the same project and be succeeded) */
  taskId: string
  /** path inside the source task's assets/ directory, forward slashes only */
  rest: string
}

/** True when the value is a string with the asset:// scheme (shape is not checked here). */
export function isAssetRef(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(ASSET_REF_SCHEME)
}

function reject(value: unknown, reason: string): never {
  throw new MediaError('MEDIA_ASSET_REF_INVALID', `asset ref ${typeof value === 'string' ? `"${value}"` : String(value)} ${reason}`)
}

/** Parse and fully validate a ref. Throws MEDIA_ASSET_REF_INVALID on any deviation. */
export function parseAssetRef(value: unknown): AssetRef {
  if (typeof value !== 'string') reject(value, 'must be a string')
  if (!value.startsWith(ASSET_REF_SCHEME)) reject(value, `must start with ${ASSET_REF_SCHEME}`)
  if (value.length > ASSET_REF_MAX_LENGTH) reject(value, `exceeds ${ASSET_REF_MAX_LENGTH} chars`)

  const body = value.slice(ASSET_REF_SCHEME.length)
  const slash = body.indexOf('/')
  if (slash <= 0) reject(value, 'must match asset://<taskId>/assets/<path>')
  const taskId = body.slice(0, slash)
  const remainder = body.slice(slash + 1)
  if (!TASK_ID_RE.test(taskId)) reject(value, `has an illegal task id "${taskId}"`)
  if (!remainder.startsWith('assets/')) reject(value, 'must point inside the source task assets/ directory')

  const rest = remainder.slice('assets/'.length)
  if (rest.length === 0) reject(value, 'has an empty asset path')
  if (rest.length > ASSET_REST_MAX_LENGTH) reject(value, `asset path exceeds ${ASSET_REST_MAX_LENGTH} chars`)
  if (!REST_RE.test(rest)) reject(value, 'asset path may only contain letters, digits, "_", "-", ".", "/"')
  if (rest.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
    reject(value, 'asset path must not contain empty, "." or ".." segments')
  }

  return { raw: value, taskId, rest }
}

/** Like parseAssetRef but returns null instead of throwing (validation helpers). */
export function tryParseAssetRef(value: unknown): AssetRef | null {
  try {
    return parseAssetRef(value)
  } catch {
    return null
  }
}

/** Task-relative source path (`assets/<rest>`) — used for output-record lookup. */
export function assetRefTaskPath(ref: AssetRef): string {
  return `assets/${ref.rest}`
}

/** Task-relative materialized path (`assets/external/<taskId>/<rest>`). */
export function assetRefExternalPath(ref: AssetRef): string {
  return `assets/external/${ref.taskId}/${ref.rest}`
}

/**
 * Storyboard `ImageElement.src` value after materialization. `src` values are
 * relative to the task's assets/ directory (the renderer prefixes ../assets),
 * so the on-disk path assets/external/... becomes src external/....
 */
export function assetRefExternalSrc(ref: AssetRef): string {
  return `external/${ref.taskId}/${ref.rest}`
}

/** Build a ref from a task-relative asset path (must start with assets/). */
export function assetRefFrom(taskId: string, taskRelativePath: string): string {
  const normalized = taskRelativePath.split('\\').join('/')
  if (!normalized.startsWith('assets/')) {
    throw new MediaError('MEDIA_ASSET_REF_INVALID', `cannot build an asset ref from "${taskRelativePath}": path must start with assets/`)
  }
  const raw = `${ASSET_REF_SCHEME}${taskId}/${normalized}`
  parseAssetRef(raw)
  return raw
}

export type AssetRefRole = 'image' | 'video' | 'audio'

export interface AssetRefNode {
  ref: AssetRef
  sceneIndex: number
  elementIndex: number
  /** which part of the storyboard declared the ref */
  role: AssetRefRole
  /** audio-track position (only for role='audio') */
  trackIndex?: number
}

/** All asset refs declared by the storyboard, with their positions for reporting. */
export function collectAssetRefs(storyboard: Storyboard): AssetRefNode[] {
  const nodes: AssetRefNode[] = []
  storyboard.scenes.forEach((scene, sceneIndex) => {
    scene.elements.forEach((element, elementIndex) => {
      if ((element.type === 'image' || element.type === 'video') && isAssetRef(element.src)) {
        nodes.push({ ref: parseAssetRef(element.src), sceneIndex, elementIndex, role: element.type })
      }
    })
  })
  ;(storyboard.audioTracks ?? []).forEach((track, trackIndex) => {
    if (isAssetRef(track.src)) {
      nodes.push({ ref: parseAssetRef(track.src), sceneIndex: -1, elementIndex: -1, role: 'audio', trackIndex })
    }
  })
  return nodes
}
