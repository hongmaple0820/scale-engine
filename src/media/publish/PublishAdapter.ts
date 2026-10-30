// Publish adapter registry (M4): interface only. ADR + plan §M4 forbid any
// platform upload in this milestone — the engine's deliverable is the local
// publish/manifest.json. An adapter can only PREVIEW where a manifest would
// go; nothing here performs network calls, and none are registered today.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  publishManifestPath,
  validatePublishManifest,
  type PublishManifest,
} from '../export/PublishPackage.js'
import { MediaError } from '../errors.js'

export interface PublishAdapter {
  /** registry key; also the value a caller passes for platformHints hints */
  readonly id: string
  /** human-readable name for surfaces */
  readonly title: string
  /**
   * Describe what publishing this manifest to the platform WOULD require.
   * Implementations must not open sockets, spawn processes, or write files.
   */
  describePublish(manifest: PublishManifest): PublishPreview
}

export interface PublishPreview {
  adapterId: string
  /** what the adapter would need (credentials, review, human action) */
  requirements: string[]
  /** true only when the manifest is structurally acceptable for this platform */
  manifestAcceptable: boolean
  /** per-field reasons when not acceptable */
  issues: string[]
}

/**
 * The single built-in entry: a preview-only adapter that accepts any manifest
 * the schema validator accepts. It exists so the registry has one canonical
 * consumer of validatePublishManifest and so tests have a stable fixture.
 */
export const LOCAL_PREVIEW_ADAPTER: PublishAdapter = {
  id: 'local-preview',
  title: 'Local preview (no upload)',
  describePublish(manifest) {
    const issues = validatePublishManifest(manifest).map(issue => `${issue.field}: ${issue.message}`)
    return {
      adapterId: 'local-preview',
      requirements: ['a human operator moves the package out of the workspace'],
      manifestAcceptable: issues.length === 0,
      issues,
    }
  },
}

const ADAPTERS: ReadonlyMap<string, PublishAdapter> = new Map([[LOCAL_PREVIEW_ADAPTER.id, LOCAL_PREVIEW_ADAPTER]])

export function listPublishAdapters(): PublishAdapter[] {
  return [...ADAPTERS.values()]
}

export function getPublishAdapter(id: string): PublishAdapter | undefined {
  return ADAPTERS.get(id)
}

/** Load the manifest a finished export task produced (read-only). */
export function readPublishManifest(taskDir: string): PublishManifest {
  const path = publishManifestPath(taskDir)
  if (!existsSync(path)) {
    throw new MediaError('MEDIA_EXPORT_SOURCE_INVALID', `no publish manifest at ${join('publish', 'manifest.json')}`)
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
  const issues = validatePublishManifest(parsed)
  if (issues.length > 0) {
    throw new MediaError(
      'MEDIA_EXPORT_REQUEST_INVALID',
      `publish manifest invalid:\n- ${issues.map(i => `${i.field}: ${i.message}`).join('\n- ')}`,
    )
  }
  return parsed as PublishManifest
}

/** Preview-only summary; the closest this module comes to "publishing". */
export function previewPublish(adapterId: string, taskDir: string): PublishPreview {
  const adapter = getPublishAdapter(adapterId)
  if (!adapter) {
    throw new MediaError(
      'MEDIA_ACTION_UNKNOWN',
      `unknown publish adapter "${adapterId}"; available: ${[...ADAPTERS.keys()].join(', ')}`,
    )
  }
  return adapter.describePublish(readPublishManifest(taskDir))
}
