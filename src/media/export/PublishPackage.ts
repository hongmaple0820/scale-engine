// Publish package (M4): the manifest is a plain, self-describing JSON file —
// no platform calls, no credentials. `platformHints` are hints only.

import { join } from 'node:path'
import type { ExportProfileId } from '../types.js'

export const PUBLISH_MANIFEST_VERSION = '1.0'

export interface PublishManifestAsset {
  profile: ExportProfileId
  video: string
  cover: string
  subtitles?: string
}

export interface PublishManifest {
  version: string
  sourceTaskId: string
  createdAt: string
  title: string
  description?: string
  tags?: string[]
  platformHints?: string[]
  assets: PublishManifestAsset[]
}

export interface BuildPublishManifestInput {
  sourceTaskId: string
  title: string
  description?: string
  tags?: string[]
  platformHints?: string[]
  assets: PublishManifestAsset[]
}

export function buildPublishManifest(input: BuildPublishManifestInput): PublishManifest {
  return {
    version: PUBLISH_MANIFEST_VERSION,
    sourceTaskId: input.sourceTaskId,
    createdAt: new Date().toISOString(),
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    ...(input.tags ? { tags: [...input.tags] } : {}),
    ...(input.platformHints ? { platformHints: [...input.platformHints] } : {}),
    assets: input.assets.map(asset => ({ ...asset })),
  }
}

export function publishManifestPath(taskDir: string): string {
  return join(taskDir, 'publish', 'manifest.json')
}

export interface ManifestValidationIssue {
  field: string
  message: string
}

/** Structural check a consumer can run before using the package. */
export function validatePublishManifest(raw: unknown): ManifestValidationIssue[] {
  const issues: ManifestValidationIssue[] = []
  const manifest = raw as Partial<PublishManifest> | null
  if (!manifest || typeof manifest !== 'object') {
    return [{ field: '', message: 'manifest must be a JSON object' }]
  }
  if (manifest.version !== PUBLISH_MANIFEST_VERSION) issues.push({ field: 'version', message: `expected "${PUBLISH_MANIFEST_VERSION}"` })
  if (typeof manifest.sourceTaskId !== 'string' || !/^[\w-]{1,80}$/.test(manifest.sourceTaskId)) {
    issues.push({ field: 'sourceTaskId', message: 'must match /^[\\w-]{1,80}$/' })
  }
  if (typeof manifest.createdAt !== 'string' || Number.isNaN(Date.parse(manifest.createdAt))) {
    issues.push({ field: 'createdAt', message: 'must be an ISO timestamp' })
  }
  if (typeof manifest.title !== 'string' || !manifest.title.trim()) issues.push({ field: 'title', message: 'must be a non-empty string' })
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    issues.push({ field: 'assets', message: 'must be a non-empty array' })
  } else {
    manifest.assets.forEach((asset, index) => {
      const where = `assets[${index}]`
      if (!asset || typeof asset !== 'object') {
        issues.push({ field: where, message: 'must be an object' })
        return
      }
      if (typeof asset.profile !== 'string') issues.push({ field: `${where}.profile`, message: 'must be a string' })
      if (typeof asset.video !== 'string' || !asset.video.endsWith('.mp4')) issues.push({ field: `${where}.video`, message: 'must be an .mp4 path' })
      if (typeof asset.cover !== 'string' || !asset.cover.endsWith('.jpg')) issues.push({ field: `${where}.cover`, message: 'must be a .jpg path' })
      if (asset.subtitles !== undefined && (typeof asset.subtitles !== 'string' || !asset.subtitles.endsWith('.srt'))) {
        issues.push({ field: `${where}.subtitles`, message: 'must be an .srt path' })
      }
    })
  }
  return issues
}
