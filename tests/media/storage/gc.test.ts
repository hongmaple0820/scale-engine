// M4 storage GC (Gate M4 items 5–6): dry-run is the default and deletes
// nothing; --apply only removes render/ intermediates and orphan
// assets/external/ copies; products, task records and evidence stay intact.
// The deletable-path allow-list is re-asserted even against a poisoned plan.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { createJob, runJob } from '../../../src/media/jobs/JobService.js'
import { openWorkspace } from '../../../src/media/jobs/JobStore.js'
import { planGc, applyGc, runGc } from '../../../src/media/storage/gc.js'
import { collectGcCandidates, summarizeAssets } from '../../../src/media/storage/AssetIndex.js'
import type { Storyboard } from '../../../src/media/types.js'

const root = mkdtempSync(join(tmpdir(), 'media-m4-gc-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

const savedEnv: Array<[string, string | undefined]> = [
  ['MEDIA_GC_MIN_AGE_DAYS', process.env.MEDIA_GC_MIN_AGE_DAYS],
  ['MEDIA_KEEP_FRAMES', process.env.MEDIA_KEEP_FRAMES],
]
afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

const board: Storyboard = {
  schemaVersion: '0.4',
  canvas: { width: 320, height: 180, fps: 24, background: '#0b1220' },
  output: { videoCodec: 'libx264', pixelFormat: 'yuv420p', audioCodec: 'aac', crf: 30, preset: 'ultrafast' },
  scenes: [{ id: 'open', durationMs: 800, narrationText: '一句。', elements: [{ type: 'rect', x: 40, y: 60, width: 240, height: 60, color: '#38bdf8' }] }],
}

/** A succeeded render with render/ intermediates + an external copy whose source is gone. */
async function makeFinishedTask(key: string): Promise<string> {
  process.env.MEDIA_GC_MIN_AGE_DAYS = '0'
  const created = createJob({ root, storyboard: board, idempotencyKey: `gc-${key}` })
  // foreign orphan: an external copy with no source task
  const orphan = join(created.taskDir, 'assets', 'external', 'job-1970-01-01-deadbeef')
  mkdirSync(orphan, { recursive: true })
  writeFileSync(join(orphan, 'img.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(created.taskDir, 'render', 'intermediate.bin'), Buffer.alloc(1024))
  writeFileSync(join(created.taskDir, 'output', 'final.mp4'), Buffer.from([0x00, 0x00, 0x00]))
  writeFileSync(join(created.taskDir, 'evidence', 'keep.txt'), 'evidence')
  return created.job.id
}

function taskPaths(taskId: string): { task: string; render: string; orphan: string; output: string; evidence: string } {
  const task = join(root, 'media', 'projects', 'default', 'tasks', taskId)
  return {
    task,
    render: join(task, 'render'),
    orphan: join(task, 'assets', 'external', 'job-1970-01-01-deadbeef'),
    output: join(task, 'output', 'final.mp4'),
    evidence: join(task, 'evidence', 'keep.txt'),
  }
}

describe('storage GC (M4)', () => {
  it('dry-run default: plan lists candidates and deletes nothing', async () => {
    const taskId = await makeFinishedTask('dry')
    const paths = taskPaths(taskId)
    process.env.MEDIA_GC_MIN_AGE_DAYS = '0'
    const workspace = openWorkspace(root, 'default')
    const plan = runGc(workspace)
    expect(plan.dryRun).toBe(true)
    expect(plan.removed).toBe(0)
    const ids = plan.candidates.map(candidate => candidate.taskId)
    expect(ids).toContain(taskId)
    const mine = plan.candidates.filter(candidate => candidate.taskId === taskId)
    const categories = mine.map(candidate => candidate.category).sort()
    expect(categories).toEqual(['intermediate', 'orphan-external'])
    // nothing was touched
    expect(existsSync(paths.render)).toBe(true)
    expect(existsSync(paths.orphan)).toBe(true)
    expect(existsSync(paths.output)).toBe(true)
  }, 60000)

  it('age gate: fresh intermediates are not candidates', async () => {
    const taskId = await makeFinishedTask('age')
    delete process.env.MEDIA_GC_MIN_AGE_DAYS // default 14 days
    const workspace = openWorkspace(root, 'default')
    const plan = planGc(workspace)
    expect(plan.minAgeDays).toBe(14)
    // this task was created milliseconds ago — none of its paths may appear
    const mine = plan.candidates.filter(candidate => candidate.taskId === taskId)
    expect(mine).toEqual([])
    // and nothing in the plan may be younger than the gate
    expect(plan.candidates.every(candidate => candidate.ageDays >= plan.minAgeDays)).toBe(true)
  }, 60000)

  it('MEDIA_KEEP_FRAMES=1 hides intermediates but keeps orphan copies', async () => {
    const taskId = await makeFinishedTask('keep')
    process.env.MEDIA_GC_MIN_AGE_DAYS = '0'
    process.env.MEDIA_KEEP_FRAMES = '1'
    const workspace = openWorkspace(root, 'default')
    const plan = planGc(workspace)
    const mine = plan.candidates.filter(candidate => candidate.taskId === taskId)
    expect(mine.map(candidate => candidate.category)).toEqual(['orphan-external'])
  }, 60000)

  it('--apply removes intermediates + orphans only; products, records, evidence survive', async () => {
    const taskId = await makeFinishedTask('apply')
    const paths = taskPaths(taskId)
    process.env.MEDIA_GC_MIN_AGE_DAYS = '0'
    const workspace = openWorkspace(root, 'default')
    const plan = runGc(workspace, { apply: true })
    expect(plan.dryRun).toBe(false)
    expect(plan.removed).toBeGreaterThanOrEqual(2)
    expect(existsSync(paths.render)).toBe(false)
    expect(existsSync(paths.orphan)).toBe(false)
    // everything protected stays
    expect(existsSync(paths.output)).toBe(true)
    expect(existsSync(paths.evidence)).toBe(true)
    expect(existsSync(join(paths.task, 'task.json'))).toBe(true)
    expect(existsSync(join(paths.task, 'events.jsonl'))).toBe(true)
    expect(existsSync(join(paths.task, 'assets'))).toBe(true)
  }, 60000)

  it('apply refuses a poisoned plan pointing outside a task dir', async () => {
    const workspace = openWorkspace(root, 'default')
    const plan = planGc(workspace, { minAgeDays: 0 })
    const poisoned = {
      ...plan,
      candidates: [
        {
          taskId: 'x',
          category: 'intermediate' as const,
          path: 'escape',
          absPath: join(root, 'media', 'projects', 'default'),
          bytes: 0,
          ageDays: 99,
        },
      ],
    }
    expect(() => applyGc(workspace, poisoned)).toThrow(/refusing/)
    expect(existsSync(join(root, 'media', 'projects', 'default', 'tasks'))).toBe(true)
  }, 60000)

  it('apply refuses to double-apply the same plan', async () => {
    const workspace = openWorkspace(root, 'default')
    const plan = planGc(workspace, { minAgeDays: 0 })
    const applied = applyGc(workspace, plan)
    expect(() => applyGc(workspace, applied)).toThrow(/already applied/)
  }, 60000)

  it('the index separates candidates from protected bytes per task', async () => {
    const taskId = await makeFinishedTask('summary')
    process.env.MEDIA_GC_MIN_AGE_DAYS = '0'
    const workspace = openWorkspace(root, 'default')
    const summary = summarizeAssets(workspace).find(entry => entry.taskId === taskId)
    expect(summary).toBeDefined()
    expect(summary?.intermediatesBytes).toBeGreaterThan(0)
    expect(summary?.orphanExternalBytes).toBeGreaterThan(0)
    expect(summary?.protectedBytes).toBeGreaterThan(0)
    const candidates = collectGcCandidates(workspace).filter(candidate => candidate.taskId === taskId)
    expect(candidates.every(candidate => candidate.category === 'intermediate' || candidate.category === 'orphan-external')).toBe(true)
  }, 60000)

  it('unrendered export tasks keep their products out of the candidate set', async () => {
    // simulate a succeeded render by patching the snapshot; export create-time
    // validation only reads task.json, and GC classification must see the
    // export task's outputs as protected regardless
    process.env.MEDIA_GC_MIN_AGE_DAYS = '0'
    const source = createJob({ root, storyboard: board, idempotencyKey: 'gc-export-source' })
    writeFileSync(join(source.taskDir, 'output', 'final.mp4'), Buffer.from([0x00]))
    const snapshotPath = join(source.taskDir, 'task.json')
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8')) as { status: string }
    snapshot.status = 'succeeded'
    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 1), 'utf-8')
    const exported = createJob({
      root,
      type: 'export',
      exportRequest: { sourceTaskId: source.job.id, profiles: ['1x1-1080p'] },
      requestedBy: 'test',
    })
    // create only — nothing ran, but even after a run the export outputs live
    // in output/ and must stay protected
    const workspace = openWorkspace(root, 'default')
    const plan = planGc(workspace)
    const candidatesForExport = plan.candidates.filter(candidate => candidate.taskId === exported.job.id)
    expect(candidatesForExport.every(candidate => candidate.path === 'render')).toBe(true)
  }, 60000)
})
