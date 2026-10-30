// Full pipeline integration (v3 P1 gate): create → run → succeeded, with a
// real (short) render when this machine has Chromium + FFmpeg; skipped
// elsewhere like the skills-audit global test. Runtime target: < 20s.

import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterAll, describe, expect, it } from 'vitest'
import { createJob, runJob, readJobStoryboard } from '../../src/media/jobs/JobService.js'
import { resolveMediaBin, probeVideo } from '../../src/media/render/FfmpegAdapter.js'
import { EvidenceWriter, assetRefFrom, parseAssetRef } from '../../src/media/index.js'
import type { Storyboard } from '../../src/media/types.js'

const nodeRequire = createRequire(import.meta.url)

const root = mkdtempSync(join(tmpdir(), 'media-pipeline-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const storyboard: Storyboard = {
  schemaVersion: '0.1',
  title: 'pipeline smoke',
  canvas: { width: 960, height: 540, fps: 24, background: '#0f172a' },
  output: { videoCodec: 'libx264', pixelFormat: 'yuv420p', audioCodec: 'aac', crf: 26, preset: 'veryfast' },
  scenes: [
    {
      id: 'intro',
      durationMs: 1000,
      elements: [
        { type: 'text', content: '管线冒烟 · 中文', fontFamily: 'Microsoft YaHei', fontSize: 40, color: '#f8fafc', x: 'center', y: 250, animation: { type: 'fadeInUp', durationMs: 500 } },
      ],
      transitionOut: { type: 'fade', durationMs: 150 },
    },
    {
      id: 'outro',
      durationMs: 1000,
      elements: [
        { type: 'rect', x: 180, y: 260, width: 600, height: 10, color: '#334155', radius: 5 },
        { type: 'rect', x: 180, y: 260, width: 600, height: 10, color: '#38bdf8', radius: 5, animation: { type: 'progressBar', durationMs: 850 } },
      ],
    },
  ],
  subtitles: [{ startMs: 100, endMs: 1800, text: '端到端冒烟字幕' }],
}

const binsReady = Boolean(resolveMediaBin('ffmpeg') && resolveMediaBin('ffprobe'))
let playwrightReady = false
try {
  nodeRequire.resolve('playwright')
  playwrightReady = true
} catch {
  // renderer unavailable
}

describe('render pipeline (integration, bins required)', () => {
  it.runIf(binsReady && playwrightReady)('renders the smoke storyboard end to end', async () => {
    const created = createJob({ root, storyboard, idempotencyKey: 'pipeline-smoke' })
    expect(created.deduplicated).toBe(false)

    const job = await runJob({ root, taskId: created.job.id })
    expect(job.status).toBe('succeeded')
    expect(job.outputs).toHaveLength(1)

    const output = job.outputs[0]
    expect(output.path).toBe('output/final.mp4')
    expect(output.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(existsSync(join(root, 'media', 'projects', 'default', 'tasks', created.job.id, 'output', 'final.mp4'))).toBe(true)

    // probe the committed artifact independently
    const ffprobe = resolveMediaBin('ffprobe') as string
    const probed = probeVideo(ffprobe, join(root, 'media', 'projects', 'default', 'tasks', created.job.id, output.path))
    expect(probed.videoCodec).toBe('h264')
    expect(probed.audioCodec).toBe('aac')
    expect(Math.abs((probed.durationSec ?? 0) - 2)).toBeLessThanOrEqual(0.5)

    // frozen storyboard + evidence exist
    expect(readJobStoryboard(root, undefined, created.job.id).canvas.width).toBe(960)
    const evidence = new EvidenceWriter(join(root, 'media', 'projects', 'default', 'tasks', created.job.id), created.job.id).readAll()
    expect(evidence.some(event => event.action === 'commit_asset' && event.result === 'ok')).toBe(true)
    expect(evidence.some(event => event.action === 'bin_versions')).toBe(true)

    // idempotent re-create returns the same (now succeeded) job
    const again = createJob({ root, storyboard, idempotencyKey: 'pipeline-smoke' })
    expect(again.deduplicated).toBe(true)
    expect(again.job.id).toBe(created.job.id)
  }, 120000)

  it.runIf(binsReady && playwrightReady)('materializes an asset:// ref and renders it end to end', async () => {
    const image = createJob({
      root,
      type: 'generate_image',
      imageRequest: { prompt: 'pipeline asset source', size: '1024x1024', providerId: 'mock' },
      idempotencyKey: 'pipeline-asset-image',
    })
    const imageJob = await runJob({ root, taskId: image.job.id })
    expect(imageJob.status).toBe('succeeded')
    const ref = assetRefFrom(imageJob.id, imageJob.outputs[0].path)

    const board: Storyboard = {
      schemaVersion: '0.3',
      title: 'asset ref smoke',
      canvas: { width: 640, height: 360, fps: 24, background: '#0f172a' },
      output: { crf: 30, preset: 'veryfast' },
      scenes: [
        {
          id: 'asset',
          durationMs: 500,
          elements: [{ type: 'image', src: ref, x: 'center', y: 0, width: 640, height: 360 }],
        },
      ],
    }
    const created = createJob({ root, storyboard: board, idempotencyKey: 'pipeline-asset-render' })
    const job = await runJob({ root, taskId: created.job.id })
    expect(job.status).toBe('succeeded')

    const parsed = parseAssetRef(ref)
    expect(existsSync(join(created.taskDir, 'assets', 'external', imageJob.id, parsed.rest))).toBe(true)
    const evidence = new EvidenceWriter(created.taskDir, job.id).readAll()
    expect(evidence.some(event => event.action === 'asset_materialized' && event.result === 'ok')).toBe(true)
    expect(evidence.some(event => event.action === 'commit_asset' && event.result === 'ok')).toBe(true)
  }, 120000)

  it.skipIf(binsReady && playwrightReady)('skips when Chromium/FFmpeg are unavailable (CI-safe)', () => {
    expect(binsReady && playwrightReady).toBe(false)
  })
})
