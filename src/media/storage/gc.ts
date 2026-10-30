// Storage GC (M4): deletes ONLY what AssetIndex classified as regenerable —
// render/ intermediates and orphan assets/external/ copies. Task records
// (task.json, events.jsonl), evidence/ and output/ products are structurally
// out of scope; they never appear in the candidate set, and the apply pass
// re-checks the allow-list before touching a path. Default is dry-run: the
// caller must pass apply=true, and an age gate bounds recency damage.

import { rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  collectGcCandidates,
  PROTECTED_PATHS,
  type AssetIndexEntry,
} from './AssetIndex.js'
import { classifyMediaPath } from '../../surface/ScaleSurface.js'
import type { MediaWorkspace } from '../jobs/JobStore.js'
import { MediaError } from '../errors.js'

const DEFAULT_MIN_AGE_DAYS = 14

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) return fallback
  return value
}

/** Candidate paths younger than this are never proposed (MEDIA_GC_MIN_AGE_DAYS, default 14). */
export function gcMinAgeDays(): number {
  return intEnv('MEDIA_GC_MIN_AGE_DAYS', DEFAULT_MIN_AGE_DAYS)
}

/**
 * Overrides the candidate set downward: keeping render/ intermediates for
 * debugging (MEDIA_KEEP_FRAMES=1). Only ever shrinks the set.
 */
export function keepIntermediates(): boolean {
  return process.env.MEDIA_KEEP_FRAMES?.trim() === '1'
}

export interface GcPlanEntry {
  taskId: string
  category: AssetIndexEntry['category']
  path: string
  absPath: string
  bytes: number
  ageDays: number
}

export interface GcPlan {
  /** true when this plan was produced in dry-run (no deletes happened) */
  dryRun: boolean
  minAgeDays: number
  candidates: GcPlanEntry[]
  /** what --apply actually removed */
  removed: number
  freedBytes: number
  /** ScaleSurface trace: which registry concepts this plan inherited */
  scopeNote: string
}

const GC_SCOPE_NOTE =
  'scope=render/ intermediates + orphan assets/external/ copies; task.json/events.jsonl/evidence/output/assets never cleaned (ScaleSurface: state/evidence protected, tmp/cache cleanable)'

/** Build the deletion plan. `now` injects the clock for tests. */
export function planGc(
  workspace: MediaWorkspace,
  options: { now?: number; minAgeDays?: number } = {},
): GcPlan {
  const now = options.now ?? Date.now()
  const minAgeDays = options.minAgeDays ?? gcMinAgeDays()
  const candidates: GcPlanEntry[] = []
  for (const entry of collectGcCandidates(workspace)) {
    if (entry.category === 'intermediate' && keepIntermediates()) continue
    const ageDays = Math.max(0, (now - entry.modifiedAt) / (24 * 60 * 60 * 1000))
    if (ageDays < minAgeDays) continue
    candidates.push({
      taskId: entry.taskId,
      category: entry.category,
      path: entry.path,
      absPath: entry.absPath,
      bytes: entry.bytes,
      ageDays: Math.round(ageDays * 10) / 10,
    })
  }
  return {
    dryRun: true,
    minAgeDays,
    candidates,
    removed: 0,
    freedBytes: 0,
    scopeNote: GC_SCOPE_NOTE,
  }
}

/**
 * The only function in the media plane that deletes bytes. Everything it may
 * remove came out of `planGc`, and the allow-list is re-asserted per path so
 * a candidate-list bug cannot turn into a wrong deletion.
 */
export function applyGc(
  workspace: MediaWorkspace,
  plan: GcPlan,
  options: { maxRetries?: number } = {},
): GcPlan {
  if (!plan.dryRun) {
    throw new MediaError('MEDIA_WORKSPACE_ERROR', 'refusing to apply a plan that was already applied')
  }
  const maxRetries = options.maxRetries ?? 3
  let removed = 0
  let freedBytes = 0
  for (const entry of plan.candidates) {
    assertDeletable(entry.absPath, workspace)
    try {
      rmSync(entry.absPath, { recursive: true, force: true, maxRetries, retryDelay: 100 })
      removed += 1
      freedBytes += entry.bytes
    } catch {
      // Windows file locks: leave the entry for the next sweep
    }
  }
  return {
    ...plan,
    dryRun: false,
    removed,
    freedBytes,
  }
}

/**
 * Allow-list re-check: the ScaleSurface classification is the deletion rule
 * (ADR-8 — media never invents its own), narrowed here to the two GC
 * categories: task-relative render/ (tmp) and orphan assets/external/<id>/.
 */
function assertDeletable(absPath: string, workspace: MediaWorkspace): void {
  const rel = absPath.startsWith(workspace.tasksDir)
    ? absPath.slice(workspace.tasksDir.length).replace(/\\/g, '/').replace(/^\//, '')
    : undefined
  if (rel === undefined || !rel.includes('/')) {
    throw new MediaError('MEDIA_WORKSPACE_ERROR', `refusing to clean outside a task dir: ${absPath}`)
  }
  const withinTask = rel.slice(rel.indexOf('/') + 1)
  const top = withinTask.split('/')[0]
  if (top === 'render') {
    // ScaleSurface classifies render/ intermediates as tmp — the only
    // cleanable kind below the task level
    if (classifyMediaPath(`media/projects/p/tasks/t/${withinTask}`) === 'tmp') return
  }
  if (top === 'assets' && /^assets\/external\/[\w-]+$/.test(withinTask)) return
  void PROTECTED_PATHS // documented pairing; see PROTECTED_PATHS for the inverse set
  throw new MediaError('MEDIA_WORKSPACE_ERROR', `refusing to clean protected path ${withinTask}`)
}

/** One-shot helper for the CLI: plan (and optionally apply), then report. */
export function runGc(
  workspace: MediaWorkspace,
  options: { apply?: boolean; now?: number; minAgeDays?: number } = {},
): GcPlan {
  const plan = planGc(workspace, options)
  if (!options.apply) return plan
  return applyGc(workspace, plan)
}

/** Where a GC report should be filed, mirroring the ScaleSurface state bucket. */
export function gcReportPath(projectDir: string): string {
  return join(projectDir, 'gc-report.json')
}
