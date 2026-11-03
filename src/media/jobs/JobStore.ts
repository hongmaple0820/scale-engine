// Job persistence (v3 plan §4/§5): the filesystem is the asset source of
// truth; task state is a JSON snapshot (atomic tmp+rename) plus an
// append-only JSONL event log. A snapshot found in a mid-flight status on
// load is *not* trusted as success — recovery marks it interrupted.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import type { JobEvent, MediaJob, MediaJobStatus } from '../types.js'
import { MediaError } from '../errors.js'
import { INTERRUPTIBLE_STATUSES } from './jobStateMachine.js'

export interface MediaWorkspace {
  root: string
  projectId: string
  projectDir: string
  tasksDir: string
}

export function openWorkspace(root: string, projectId = 'default'): MediaWorkspace {
  if (!root || !root.trim()) throw new MediaError('MEDIA_WORKSPACE_ERROR', 'workspace root is required')
  // absolute from here on — FFmpeg runs with cwd=render/ and would otherwise
  // resolve frames/subtitles against the wrong base
  const resolvedRoot = resolve(root)
  const projectDir = join(resolvedRoot, 'media', 'projects', projectId)
  const tasksDir = join(projectDir, 'tasks')
  return { root: resolvedRoot, projectId, projectDir, tasksDir }
}

export function taskDirOf(workspace: MediaWorkspace, taskId: string): string {
  if (!/^[\w-]{1,80}$/.test(taskId)) throw new MediaError('MEDIA_WORKSPACE_ERROR', `illegal task id "${taskId}"`)
  return join(workspace.tasksDir, taskId)
}

export function createTaskDir(workspace: MediaWorkspace, taskId: string): string {
  const dir = taskDirOf(workspace, taskId)
  if (existsSync(dir)) throw new MediaError('MEDIA_WORKSPACE_ERROR', `task dir already exists: ${taskId}`)
  for (const sub of ['', 'assets', 'output', 'evidence', 'render']) {
    mkdirSync(join(dir, sub), { recursive: true })
  }
  return dir
}

export function writeSnapshot(taskDir: string, job: MediaJob): void {
  job.updatedAt = new Date().toISOString()
  const finalPath = join(taskDir, 'task.json')
  const tmpPath = join(taskDir, `task.json.${randomUUID().slice(0, 8)}.tmp`)
  writeFileSync(tmpPath, JSON.stringify(job, null, 1), 'utf-8')
  renameSync(tmpPath, finalPath)
}

export function readSnapshot(taskDir: string): MediaJob {
  const path = join(taskDir, 'task.json')
  if (!existsSync(path)) throw new MediaError('MEDIA_JOB_NOT_FOUND', `no task.json in ${taskDir}`)
  return JSON.parse(readFileSync(path, 'utf-8')) as MediaJob
}

export function appendJobEvent(taskDir: string, event: JobEvent): void {
  writeFileSync(join(taskDir, 'events.jsonl'), JSON.stringify(event) + '\n', { flag: 'a', encoding: 'utf-8' })
}

export function readJobEvents(taskDir: string): JobEvent[] {
  const path = join(taskDir, 'events.jsonl')
  if (!existsSync(path)) return []
  return (readFileSync(path, 'utf-8'))
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as JobEvent)
}

export function listTaskDirs(workspace: MediaWorkspace): string[] {
  if (!existsSync(workspace.tasksDir)) return []
  return readdirSync(workspace.tasksDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
}

export function listJobs(workspace: MediaWorkspace): MediaJob[] {
  return listTaskDirs(workspace)
    .map(name => {
      try {
        return readSnapshot(taskDirOf(workspace, name))
      } catch {
        return undefined
      }
    })
    .filter((job): job is MediaJob => job !== undefined)
}

export function findJobByIdempotencyKey(workspace: MediaWorkspace, key: string): MediaJob | undefined {
  return listJobs(workspace).find(job => job.idempotencyKey === key)
}

export function findJob(workspace: MediaWorkspace, taskId: string): { dir: string; job: MediaJob } {
  const dir = taskDirOf(workspace, taskId)
  if (!existsSync(dir)) throw new MediaError('MEDIA_JOB_NOT_FOUND', `task "${taskId}" not found in project "${workspace.projectId}"`)
  return { dir, job: readSnapshot(dir) }
}

/**
 * Crash recovery: any snapshot left in a mid-flight status is marked
 * `interrupted` — never silently rewritten to success/failure (v3 §4.3).
 * Returns the recovered task ids.
 */
export function recoverInterruptedJobs(workspace: MediaWorkspace): string[] {
  const recovered: string[] = []
  for (const name of listTaskDirs(workspace)) {
    const dir = taskDirOf(workspace, name)
    let job: MediaJob
    try {
      job = readSnapshot(dir)
    } catch {
      continue // unreadable snapshot — leave for manual inspection, do not delete
    }
    if (INTERRUPTIBLE_STATUSES.includes(job.status)) {
      const fromStatus = job.status
      const handle = job.provider
      const handleDeadline = handle?.deadlineAt ? Date.parse(handle.deadlineAt) : Number.NaN
      // Plan M2: a video handle whose provider deadline already passed can
      // never complete by polling — settle it as provider_timeout instead of
      // resuming a doomed poll.
      if (job.type === 'generate_video' && handle && Number.isFinite(handleDeadline) && handleDeadline <= Date.now()) {
        job.status = 'failed'
        job.error = {
          code: 'MEDIA_PROVIDER_TIMEOUT',
          message: `video provider handle expired at ${handle.deadlineAt}`,
          retryable: false,
        }
        job.finishedAt = new Date().toISOString()
        writeSnapshot(dir, job)
        appendJobEvent(dir, {
          at: new Date().toISOString(),
          type: 'provider_handle_expired',
          data: { providerJobId: handle.jobId, deadlineAt: handle.deadlineAt, fromStatus },
        })
        recovered.push(job.id)
        continue
      }
      job.status = 'interrupted'
      job.error = { code: 'MEDIA_JOB_INTERRUPTED', message: 'process exited mid-render; inspect render/ and retry', retryable: true }
      writeSnapshot(dir, job)
      appendJobEvent(dir, { at: new Date().toISOString(), type: 'recovered_interrupted', data: { fromStatus } })
      recovered.push(job.id)
    }
  }
  return recovered
}

export function dirSizeBytes(dir: string): number {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) total += dirSizeBytes(path)
    else total += statSync(path).size
  }
  return total
}

export function removeDirSafe(dir: string): void {
  const resolved = dir
  if (dirname(resolved) === resolved) return // never rm root
  rmSync(resolved, { recursive: true, force: true })
}

export type { MediaJobStatus }
