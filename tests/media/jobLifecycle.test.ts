// Job lifecycle: state machine legality, atomic snapshots, idempotent create,
// cooperative cancel, and crash recovery (interrupted, never faked).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterAll, describe, expect, it } from 'vitest'
import { canTransition, assertTransition, INTERRUPTIBLE_STATUSES } from '../../src/media/jobs/jobStateMachine.js'
import {
  createJob,
  runJob,
  cancelJob,
  recoverJobs,
  listProjectJobs,
} from '../../src/media/jobs/JobService.js'
import { openWorkspace, taskDirOf, readSnapshot } from '../../src/media/jobs/JobStore.js'
import { resolveMediaBin } from '../../src/media/render/FfmpegAdapter.js'
import { MediaError } from '../../src/media/errors.js'
import type { Storyboard } from '../../src/media/types.js'

const root = mkdtempSync(join(tmpdir(), 'media-jobs-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const storyboard: Storyboard = {
  schemaVersion: '0.1',
  canvas: { width: 320, height: 320, fps: 24, background: '#000000' },
  scenes: [{ id: 'only', durationMs: 500, elements: [{ type: 'rect', x: 10, y: 10, width: 50, height: 50, color: '#123456' }] }],
}

describe('job state machine', () => {
  it('allows the happy path and retry edges', () => {
    expect(canTransition('created', 'validated')).toBe(true)
    expect(canTransition('validated', 'running')).toBe(true)
    expect(canTransition('running', 'packaging')).toBe(true)
    expect(canTransition('packaging', 'succeeded')).toBe(true)
    expect(canTransition('failed', 'running')).toBe(true)
    expect(canTransition('interrupted', 'running')).toBe(true)
  })

  it('rejects illegal jumps (and never leaves a terminal state)', () => {
    expect(canTransition('created', 'succeeded')).toBe(false)
    expect(canTransition('validated', 'succeeded')).toBe(false)
    expect(canTransition('succeeded', 'running')).toBe(false)
    expect(canTransition('cancelled', 'running')).toBe(false)
    expect(() => assertTransition('created', 'succeeded')).toThrow(MediaError)
  })

  it('treats running/packaging as interruptible', () => {
    expect(INTERRUPTIBLE_STATUSES).toEqual(['running', 'packaging'])
  })
})

describe('job store + service', () => {
  it('createJob validates before touching disk', () => {
    expect(() =>
      createJob({ root, storyboard: { ...storyboard, schemaVersion: '9.9' } as unknown as Storyboard }),
    ).toThrow(MediaError)
    expect(listProjectJobs(root)).toEqual([])
  })

  it('createJob is idempotent under a key', () => {
    const first = createJob({ root, storyboard, idempotencyKey: 'dedupe-me' })
    const second = createJob({ root, storyboard, idempotencyKey: 'dedupe-me' })
    expect(second.deduplicated).toBe(true)
    expect(second.job.id).toBe(first.job.id)
  })

  it('cancel before run lands in cancelled without a render', () => {
    const created = createJob({ root, storyboard })
    const cancelled = cancelJob(root, undefined, created.job.id)
    expect(cancelled.status).toBe('cancelled')
  })

  it('recovery marks mid-flight snapshots interrupted instead of trusting them', () => {
    const created = createJob({ root, storyboard })
    const workspace = openWorkspace(root)
    const dir = taskDirOf(workspace, created.job.id)
    // simulate a crash mid-render
    const snapshot = JSON.parse(readFileSync(join(dir, 'task.json'), 'utf-8'))
    snapshot.status = 'running'
    snapshot.stage = 'capture'
    writeFileSync(join(dir, 'task.json'), JSON.stringify(snapshot))
    const recovered = recoverJobs(root)
    expect(recovered).toContain(created.job.id)
    expect(readSnapshot(dir).status).toBe('interrupted')
  })

  it('runJob on an interrupted job retries and succeeds (bins permitting)', async () => {
    const created = createJob({ root, storyboard })
    const workspace = openWorkspace(root)
    const dir = taskDirOf(workspace, created.job.id)
    const snapshot = JSON.parse(readFileSync(join(dir, 'task.json'), 'utf-8'))
    snapshot.status = 'running' // crash residue
    writeFileSync(join(dir, 'task.json'), JSON.stringify(snapshot))
    recoverJobs(root)
    const nodeRequire = createRequire(import.meta.url)
    let binsOk = false
    try {
      nodeRequire.resolve('playwright')
      binsOk = Boolean(resolveMediaBin('ffmpeg') && resolveMediaBin('ffprobe'))
    } catch {
      binsOk = false
    }
    if (!binsOk) return // renderer unavailable — the pipeline test covers the full path
    const job = await runJob({ root, taskId: created.job.id })
    expect(job.status).toBe('succeeded')
    expect(job.attempt).toBe(2)
    expect(job.outputs[0].path).toBe('output/final.mp4')
  }, 120000)

  it('rejects unknown task ids', () => {
    expect(() => cancelJob(root, undefined, 'nope')).toThrow(MediaError)
  })
})
