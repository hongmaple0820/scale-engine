// Asset index (M4): a read-only scanner over media/projects/<project>/tasks/*
// that classifies what is inside each task dir and produces GC candidates.
// Classification mirrors ScaleSurface semantics (tmp/state vs protected
// products) but lives here so the media plane keeps its own vocabulary; the
// gc module consumes it and still refuses anything not on the allow-list.

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { listTaskDirs, readSnapshot, type MediaWorkspace } from '../jobs/JobStore.js'
import type { ExportProfileId, MediaJob, MediaJobStatus } from '../types.js'

/** Directories inside a task dir that are regenerable intermediates. */
export const INTERMEDIATE_DIRS = ['render'] as const

/** Paths inside a task dir that GC must never propose. */
export const PROTECTED_PATHS = ['task.json', 'events.jsonl', 'evidence', 'output', 'assets'] as const

export type TaskCategory = 'protected' | 'intermediate' | 'orphan-external'

export interface AssetIndexEntry {
  taskId: string
  status: MediaJobStatus
  type: MediaJob['type']
  category: TaskCategory
  /** task-relative path with forward slashes */
  path: string
  /** absolute path on disk */
  absPath: string
  bytes: number
  /** mtime in ms — the age gate filters on this */
  modifiedAt: number
}

export interface AssetIndexSummary {
  taskId: string
  status: MediaJobStatus
  intermediatesBytes: number
  orphanExternalBytes: number
  protectedBytes: number
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function dirSize(path: string): number {
  let total = 0
  let entries: string[]
  try {
    entries = readdirSync(path)
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = join(path, entry)
    if (isDirectory(full)) total += dirSize(full)
    else {
      try {
        total += statSync(full).size
      } catch {
        // raced delete — count as 0
      }
    }
  }
  return total
}

/**
 * GC candidate detection, in two categories:
 * - `intermediate`: the task's render/ working dir (frames, per-segment
 *   encodes, mixed audio) — always regenerable from the storyboard.
 * - `orphan-external`: assets/external/<sourceTaskId>/ copies left behind
 *   when their source task no longer exists in this project.
 *
 * Everything else (task.json, events.jsonl, evidence/, output/, assets/)
 * is protected by construction and never becomes a candidate.
 */
export function collectGcCandidates(workspace: MediaWorkspace): AssetIndexEntry[] {
  const candidates: AssetIndexEntry[] = []
  for (const name of listTaskDirs(workspace)) {
    const taskDir = join(workspace.tasksDir, name)
    let job: MediaJob
    try {
      job = readSnapshot(taskDir)
    } catch {
      continue // unreadable snapshot — never delete anything from it
    }
    const taskId = job.id
    const renderDir = join(taskDir, 'render')
    if (isDirectory(renderDir)) {
      candidates.push({
        taskId,
        status: job.status,
        type: job.type,
        category: 'intermediate',
        path: 'render',
        absPath: renderDir,
        bytes: dirSize(renderDir),
        modifiedAt: statSync(renderDir).mtimeMs,
      })
    }
    const externalDir = join(taskDir, 'assets', 'external')
    if (isDirectory(externalDir)) {
      for (const sourceId of readdirSync(externalDir)) {
        const sourceDir = join(externalDir, sourceId)
        if (!isDirectory(sourceDir)) continue
        if (sourceTaskExists(workspace, sourceId)) continue
        candidates.push({
          taskId,
          status: job.status,
          type: job.type,
          category: 'orphan-external',
          path: `assets/external/${sourceId}`,
          absPath: sourceDir,
          bytes: dirSize(sourceDir),
          modifiedAt: statSync(sourceDir).mtimeMs,
        })
      }
    }
  }
  return candidates
}

function sourceTaskExists(workspace: MediaWorkspace, taskId: string): boolean {
  const dir = join(workspace.tasksDir, taskId)
  return existsSync(join(dir, 'task.json'))
}

/** Per-task byte totals, for dashboards and `media gc` summaries. */
export function summarizeAssets(workspace: MediaWorkspace): AssetIndexSummary[] {
  const summaries: AssetIndexSummary[] = []
  for (const name of listTaskDirs(workspace)) {
    const taskDir = join(workspace.tasksDir, name)
    let job: MediaJob
    try {
      job = readSnapshot(taskDir)
    } catch {
      continue
    }
    const intermediatesBytes = isDirectory(join(taskDir, 'render')) ? dirSize(join(taskDir, 'render')) : 0
    const externalDir = join(taskDir, 'assets', 'external')
    let orphanExternalBytes = 0
    if (isDirectory(externalDir)) {
      for (const sourceId of readdirSync(externalDir)) {
        const sourceDir = join(externalDir, sourceId)
        if (isDirectory(sourceDir) && !sourceTaskExists(workspace, sourceId)) {
          orphanExternalBytes += dirSize(sourceDir)
        }
      }
    }
    let protectedBytes = 0
    for (const name of ['assets', 'output', 'evidence']) {
      const dir = join(taskDir, name)
      if (isDirectory(dir)) protectedBytes += dirSize(dir)
    }
    for (const file of ['task.json', 'events.jsonl']) {
      try {
        protectedBytes += statSync(join(taskDir, file)).size
      } catch {
        // absent — fine
      }
    }
    summaries.push({
      taskId: job.id,
      status: job.status,
      intermediatesBytes,
      orphanExternalBytes,
      protectedBytes,
    })
  }
  return summaries
}

/** Unused today but exported for template renderers that enumerate profiles. */
export type GcProfileHint = ExportProfileId
