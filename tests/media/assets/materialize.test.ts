// Asset materialization (M1): copies are idempotent, the storyboard rewrite is
// immutable, evidence maps ref → copy, and every failure mode is fail-closed.

import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  EvidenceWriter,
  assertAssetRefsAvailable,
  assetRefFrom,
  createJob,
  materializeAssets,
  openWorkspace,
  parseAssetRef,
  runJob,
  type MaterializeOptions,
} from '../../../src/media/index.js'
import type { Storyboard } from '../../../src/media/types.js'

const root = mkdtempSync(join(tmpdir(), 'media-materialize-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
    return undefined
  } catch (error) {
    return (error as { code?: string }).code
  }
}

function boardWith(src: string): Storyboard {
  return {
    schemaVersion: '0.3',
    canvas: { width: 320, height: 320, fps: 24, background: '#101010' },
    scenes: [
      {
        id: 's1',
        durationMs: 500,
        elements: [{ type: 'image', src, x: 'center', y: 0, width: 320, height: 320 }],
      },
    ],
  }
}

interface SucceededImage {
  taskId: string
  ref: string
  taskDir: string
  outputPath: string
  bytes: number
}

async function succeededImage(project: string, key: string): Promise<SucceededImage> {
  const created = createJob({
    root,
    projectId: project,
    type: 'generate_image',
    imageRequest: { prompt: `materialize source ${key}`, size: '1024x1024', providerId: 'mock' },
    idempotencyKey: key,
  })
  const done = await runJob({ root, projectId: project, taskId: created.job.id })
  expect(done.status).toBe('succeeded')
  const output = done.outputs[0]
  return {
    taskId: done.id,
    ref: assetRefFrom(done.id, output.path),
    taskDir: created.taskDir,
    outputPath: join(created.taskDir, output.path),
    bytes: output.bytes,
  }
}

let source: SucceededImage
beforeAll(async () => {
  source = await succeededImage('m1', 'm1-source')
}, 60000)

function materialize(project: string, taskId: string, taskDir: string, storyboard: Storyboard, evidence?: EvidenceWriter) {
  const options: MaterializeOptions = { workspace: openWorkspace(root, project), taskDir, taskId, storyboard, evidence }
  return materializeAssets(options)
}

describe('materializeAssets', () => {
  it('copies, rewrites immutably and records mapping evidence', () => {
    const board = boardWith(source.ref)
    const render = createJob({ root, projectId: 'm1', storyboard: board, idempotencyKey: 'm1-render-1' })
    const evidence = new EvidenceWriter(render.taskDir, render.job.id)

    const result = materialize('m1', render.job.id, render.taskDir, board, evidence)
    const parsed = parseAssetRef(source.ref)
    const destPath = `assets/external/${source.taskId}/${parsed.rest}`
    const dest = join(render.taskDir, destPath)

    expect(existsSync(dest)).toBe(true)
    expect(readFileSync(dest)).toEqual(readFileSync(source.outputPath))
    expect(result.assets).toHaveLength(1)
    expect(result.assets[0]).toMatchObject({
      ref: source.ref,
      sourceTaskId: source.taskId,
      destPath,
      src: `external/${source.taskId}/${parsed.rest}`,
      bytes: source.bytes,
      skipped: false,
    })
    expect(result.storyboard.scenes[0].elements[0]).toMatchObject({
      type: 'image',
      src: `external/${source.taskId}/${parsed.rest}`,
    })
    // the caller's board is never mutated
    expect((board.scenes[0].elements[0] as { src: string }).src).toBe(source.ref)

    const events = evidence.readAll()
    const materialized = events.filter(event => event.action === 'asset_materialized')
    expect(materialized).toHaveLength(1)
    expect(materialized[0].result).toBe('ok')
    expect(materialized[0].data).toMatchObject({ ref: source.ref, destPath, sourceTaskId: source.taskId, bytes: source.bytes, skipped: false })
    expect(JSON.stringify(events)).not.toContain(root) // no absolute paths in evidence
  }, 30000)

  it('is idempotent: a second run reuses the identical copy', () => {
    const board = boardWith(source.ref)
    const render = createJob({ root, projectId: 'm1', storyboard: board, idempotencyKey: 'm1-render-2' })
    const evidence = new EvidenceWriter(render.taskDir, render.job.id)

    const first = materialize('m1', render.job.id, render.taskDir, board, evidence)
    const second = materialize('m1', render.job.id, render.taskDir, board, evidence)
    expect(first.assets[0].skipped).toBe(false)
    expect(second.assets[0].skipped).toBe(true)
    expect(second.assets[0].destPath).toBe(first.assets[0].destPath)
    expect(second.assets[0].sourceSha256).toBe(first.assets[0].sourceSha256)

    const materialized = evidence.readAll().filter(event => event.action === 'asset_materialized')
    expect(materialized).toHaveLength(2)
    expect(materialized[1].data?.skipped).toBe(true)
  }, 30000)

  it('materializes a ref used twice only once', () => {
    const board = boardWith(source.ref)
    board.scenes[0].elements.push({ type: 'image', src: source.ref, x: 0, y: 0, width: 10, height: 10 })
    const render = createJob({ root, projectId: 'm1', storyboard: board, idempotencyKey: 'm1-render-3' })
    const evidence = new EvidenceWriter(render.taskDir, render.job.id)

    const result = materialize('m1', render.job.id, render.taskDir, board, evidence)
    expect(result.assets).toHaveLength(1)
    expect(result.storyboard.scenes[0].elements.every(element => element.type !== 'image' || !String(element.src).startsWith('asset://'))).toBe(true)
    expect(evidence.readAll().filter(event => event.action === 'asset_materialized')).toHaveLength(1)
  }, 30000)

  it('rejects a missing source task at create time', () => {
    const board = boardWith('asset://job-2026-01-01-deadbeef/assets/generated/nope.png')
    expect(codeOf(() => createJob({ root, projectId: 'm1', storyboard: board }))).toBe('MEDIA_ASSET_REF_MISSING')
  })

  it('rejects a source task that has not succeeded', () => {
    const pending = createJob({
      root,
      projectId: 'm1',
      type: 'generate_image',
      imageRequest: { prompt: 'not run yet', size: '1024x1024', providerId: 'mock' },
      idempotencyKey: 'm1-pending',
    })
    const board = boardWith(assetRefFrom(pending.job.id, 'assets/generated/later.png'))
    expect(codeOf(() => createJob({ root, projectId: 'm1', storyboard: board }))).toBe('MEDIA_ASSET_REF_MISSING')
  })

  it('rejects refs that cross project boundaries', () => {
    const board = boardWith(source.ref)
    expect(codeOf(() => createJob({ root, projectId: 'm1-other', storyboard: board }))).toBe('MEDIA_ASSET_REF_MISSING')
  })

  it('rejects a source file whose hash no longer matches the output record', async () => {
    const tampered = await succeededImage('m1-corrupt', 'm1-corrupt-source')
    const board = boardWith(tampered.ref)
    const render = createJob({ root, projectId: 'm1-corrupt', storyboard: board, idempotencyKey: 'm1-corrupt-render' })
    appendFileSync(tampered.outputPath, Buffer.from([0]))
    expect(codeOf(() => materialize('m1-corrupt', render.job.id, render.taskDir, board))).toBe('MEDIA_ASSET_REF_CORRUPT')
  }, 60000)

  it('refuses to overwrite a materialized copy with a different hash', async () => {
    const local = await succeededImage('m1-dest', 'm1-dest-source')
    const board = boardWith(local.ref)
    const render = createJob({ root, projectId: 'm1-dest', storyboard: board, idempotencyKey: 'm1-dest-render' })
    const first = materialize('m1-dest', render.job.id, render.taskDir, board)
    appendFileSync(join(render.taskDir, first.assets[0].destPath), Buffer.from([0]))
    expect(codeOf(() => materialize('m1-dest', render.job.id, render.taskDir, board))).toBe('MEDIA_ASSET_REF_CORRUPT')
  }, 60000)

  it('lets an idempotent replay win even after the source task is gone', async () => {
    const local = await succeededImage('m1-dedupe', 'm1-dedupe-source')
    const board = boardWith(local.ref)
    const first = createJob({ root, projectId: 'm1-dedupe', storyboard: board, idempotencyKey: 'm1-dedupe-render' })
    rmSync(local.taskDir, { recursive: true, force: true })

    const again = createJob({ root, projectId: 'm1-dedupe', storyboard: board, idempotencyKey: 'm1-dedupe-render' })
    expect(again.deduplicated).toBe(true)
    expect(again.job.id).toBe(first.job.id)
  }, 60000)

  it('assertAssetRefsAvailable validates without copying', () => {
    const board = boardWith(source.ref)
    const render = createJob({ root, projectId: 'm1', storyboard: board, idempotencyKey: 'm1-render-4' })
    assertAssetRefsAvailable(openWorkspace(root, 'm1'), board)
    expect(existsSync(join(render.taskDir, 'assets', 'external'))).toBe(false)
  }, 30000)
})
