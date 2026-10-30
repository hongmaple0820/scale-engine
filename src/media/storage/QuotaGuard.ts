// Project storage preflight (M2): refuse new provider-backed work before it
// spends money or writes bytes when the project is over quota or the disk is
// nearly full. Both limits are env-tunable; invalid values fall back to the
// documented defaults.

import { existsSync, statfsSync } from 'node:fs'
import { dirSizeBytes, type MediaWorkspace } from '../jobs/JobStore.js'
import { MediaError } from '../errors.js'

const DEFAULT_PROJECT_QUOTA_MB = 2048
const DEFAULT_MIN_FREE_MB = 1024

function mbEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return fallback
  return value
}

export function projectQuotaBytes(): number {
  return mbEnv('MEDIA_PROJECT_QUOTA_MB', DEFAULT_PROJECT_QUOTA_MB) * 1024 * 1024
}

export function minFreeBytes(): number {
  return mbEnv('MEDIA_MIN_FREE_MB', DEFAULT_MIN_FREE_MB) * 1024 * 1024
}

/** Free bytes on the workspace volume; undefined when the platform cannot tell. */
export function freeBytesOf(path: string): number | undefined {
  try {
    const stats = statfsSync(path)
    return Number(stats.bavail) * Number(stats.bsize)
  } catch {
    return undefined
  }
}

export function assertStorageAvailable(workspace: MediaWorkspace): void {
  const used = existsSync(workspace.projectDir) ? dirSizeBytes(workspace.projectDir) : 0
  const quota = projectQuotaBytes()
  if (quota > 0 && used >= quota) {
    throw new MediaError(
      'MEDIA_QUOTA_EXCEEDED',
      `project "${workspace.projectId}" uses ${(used / 1024 / 1024).toFixed(1)} MB, over the ${(quota / 1024 / 1024).toFixed(0)} MB quota`,
    )
  }
  const free = freeBytesOf(workspace.projectDir)
  if (free === undefined) return // platform without statfs: quota still applies
  const minimum = minFreeBytes()
  if (minimum > 0 && free < minimum) {
    throw new MediaError(
      'MEDIA_DISK_LOW',
      `only ${(free / 1024 / 1024).toFixed(0)} MB free; media work needs at least ${(minimum / 1024 / 1024).toFixed(0)} MB`,
    )
  }
}
