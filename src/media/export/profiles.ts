// Export profiles (M4): fixed canvas targets and cover timing. Profiles are
// declarative and closed — an unknown id is a validation error, never a guess.

import type { ExportProfileId } from '../types.js'

export interface ExportProfile {
  id: ExportProfileId
  width: number
  height: number
  /** aspect hint for the manifest */
  aspect: '16:9' | '9:16' | '1:1'
  fileBase: string
}

export const EXPORT_PROFILES: Readonly<Record<ExportProfileId, ExportProfile>> = Object.freeze({
  '16x9-1080p': { id: '16x9-1080p', width: 1920, height: 1080, aspect: '16:9', fileBase: '16x9-1080p' },
  '9x16-1080p': { id: '9x16-1080p', width: 1080, height: 1920, aspect: '9:16', fileBase: '9x16-1080p' },
  '1x1-1080p': { id: '1x1-1080p', width: 1080, height: 1080, aspect: '1:1', fileBase: '1x1-1080p' },
})

export const EXPORT_PROFILE_IDS: readonly ExportProfileId[] = ['16x9-1080p', '9x16-1080p', '1x1-1080p']

export function isExportProfileId(value: unknown): value is ExportProfileId {
  return typeof value === 'string' && (EXPORT_PROFILE_IDS as readonly string[]).includes(value)
}

export function resolveExportProfile(id: ExportProfileId): ExportProfile {
  return EXPORT_PROFILES[id]
}
