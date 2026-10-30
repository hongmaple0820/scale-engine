// M3 composed pipeline (target gate): a 0.4 board with a video scene, a
// narration track and auto subtitles renders through compose_segments →
// audio_mix → mux and ships the SRT sidecar. Pure-image 0.4 boards must keep
// taking the legacy capture/encode path (and never touch the composer).
// Real FFmpeg/Chromium only; the whole file skips with a note elsewhere.

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterAll, describe, expect, it } from 'vitest'
import { createJob, getJob, runJob } from '../../../src/media/jobs/JobService.js'
import { readJobEvents } from '../../../src/media/jobs/JobStore.js'
import { probeVideo, resolveMediaBin } from '../../../src/media/render/FfmpegAdapter.js'
import type { Storyboard } from '../../../src/media/types.js'

const nodeRequire = createRequire(import.meta.url)
const ffprobe = resolveMediaBin('ffprobe')
const binsReady = Boolean(resolveMediaBin('ffmpeg') && ffprobe)
let playwrightReady = false
try {
  nodeRequire.resolve('playwright')
  playwrightReady = true
} catch {
  // legacy-path test cannot run without Chromium
}

const root = mkdtempSync(join(tmpdir(), 'media-m3-pipeline-'))
const fixtures = join(root, 'fixtures')
mkdirSync(fixtures, { recursive: true })
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

const output = { videoCodec: 'libx264', pixelFormat: 'yuv420p', audioCodec: 'aac', crf: 30, preset: 'ultrafast' }

function ffmpegRun(args: string[]): void {
  const result = spawnSync(resolveMediaBin('ffmpeg') as string, args, { encoding: 'utf-8', shell: false, windowsHide: true })
  expect(result.status, result.stderr).toBe(0)
}

function makeClip(durationSec: number): string {
  const path = join(fixtures, `clip-${durationSec}.mp4`)
  ffmpegRun([
    '-y', '-f', 'lavfi', '-i', `testsrc=duration=${durationSec}:size=320x180:rate=24`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path,
  ])
  return path
}

function makeTone(durationSec: number): string {
  const path = join(fixtures, `voice-${durationSec}.wav`)
  ffmpegRun([
    '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${durationSec}`,
    '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', path,
  ])
  return path
}

function stageNames(events: ReturnType<typeof readJobEvents>): string[] {
  return events
    .filter(event => event.type === 'stage_done')
    .map(event => String((event.data as { stage?: unknown }).stage))
}

const composedBoard: Storyboard = {
  schemaVersion: '0.4',
  canvas: { width: 320, height: 180, fps: 24, background: '#000000' },
  output,
  scenes: [
    { id: 'open', durationMs: 1000, narrationText: '第一句。第二句！', elements: [{ type: 'video', src: 'clip.mp4' }] },
    { id: 'close', durationMs: 1000, narrationText: '结束。', elements: [{ type: 'video', src: 'clip.mp4', trimStartMs: 400, trimEndMs: 1400 }] },
  ],
  audioTracks: [{ src: 'voice.wav', kind: 'narration' }],
  subtitleOptions: { mode: 'both', source: 'auto' },
}

describe('composed render pipeline (M3)', () => {
  it.runIf(binsReady)('renders video + narration + auto subtitles and ships the SRT sidecar', async () => {
    const clip = makeClip(1.5)
    const voice = makeTone(0.8)
    const created = createJob({ root, storyboard: composedBoard, idempotencyKey: 'm3-composed' })
    copyFileSync(clip, join(created.taskDir, 'assets', 'clip.mp4'))
    copyFileSync(voice, join(created.taskDir, 'assets', 'voice.wav'))

    const job = await runJob({ root, taskId: created.job.id })
    expect(job.status).toBe('succeeded')
    expect(job.error).toBeUndefined()
    expect(job.outputs).toHaveLength(2)
    expect(job.outputs?.[0].path).toBe('output/final.mp4')
    expect(job.outputs?.[1]).toMatchObject({ path: 'output/subtitles.srt', kind: 'other' })

    const finalPath = join(created.taskDir, 'output', 'final.mp4')
    const probe = probeVideo(ffprobe as string, finalPath)
    expect(probe.videoCodec).toBe('h264')
    expect(probe.audioCodec).toBe('aac')
    expect(probe.width).toBe(320)
    expect(probe.height).toBe(180)
    expect(Math.abs((probe.durationSec ?? 0) - 2)).toBeLessThanOrEqual(0.5)

    const srt = readFileSync(join(created.taskDir, 'output', 'subtitles.srt'), 'utf-8')
    expect(srt).toContain('第一句')
    expect(srt).toContain('结束')
    expect(srt).toMatch(/00:00:0[01],\d{3} --> /)

    const events = readJobEvents(created.taskDir)
    const stages = stageNames(events)
    for (const expected of ['compose_segments', 'audio_mix', 'mux', 'inspect', 'commit']) {
      expect(stages, `missing stage ${expected}`).toContain(expected)
    }
    expect(stages).not.toContain('capture')
    expect(stages).not.toContain('encode')
    expect(events.filter(event => event.type === 'segment_progress')).toHaveLength(2)
  }, 180000)

  it.runIf(binsReady)('fails the job when a clip is shorter than its scene and not looped', async () => {
    const clip = makeClip(1)
    const board: Storyboard = {
      schemaVersion: '0.4',
      canvas: { width: 320, height: 180, fps: 24, background: '#000000' },
      output,
      scenes: [
        { id: 'too-long', durationMs: 2000, elements: [{ type: 'video', src: 'clip.mp4' }] },
      ],
    }
    const created = createJob({ root, storyboard: board, idempotencyKey: 'm3-too-short' })
    copyFileSync(clip, join(created.taskDir, 'assets', 'clip.mp4'))

    await expect(runJob({ root, taskId: created.job.id })).rejects.toThrow(/shorter than the scene/)
    const failed = getJob(root, undefined, created.job.id).job
    expect(failed.status).toBe('failed')
    expect(failed.error?.code).toBe('MEDIA_STORYBOARD_INVALID')
    expect(failed.outputs ?? []).toEqual([])
    const failedStages = readJobEvents(created.taskDir)
      .filter(event => event.type === 'stage_failed')
      .map(event => String((event.data as { stage?: unknown }).stage))
    expect(failedStages).toContain('compose_segments')
  }, 180000)

  it.runIf(binsReady && playwrightReady)('keeps pure-image 0.4 boards on the legacy capture/encode path', async () => {
    const board: Storyboard = {
      schemaVersion: '0.4',
      canvas: { width: 320, height: 180, fps: 24, background: '#0b1220' },
      output,
      scenes: [
        {
          id: 'only',
          durationMs: 1500,
          narrationText: '纯图字幕。',
          elements: [{ type: 'rect', x: 40, y: 60, width: 240, height: 60, color: '#38bdf8' }],
        },
      ],
      subtitleOptions: { mode: 'srt', source: 'auto' },
    }
    const created = createJob({ root, storyboard: board, idempotencyKey: 'm3-legacy' })
    const job = await runJob({ root, taskId: created.job.id })
    expect(job.status).toBe('succeeded')
    expect(job.outputs?.map(record => record.path)).toEqual(['output/final.mp4', 'output/subtitles.srt'])
    expect(existsSync(join(created.taskDir, 'output', 'subtitles.srt'))).toBe(true)

    const stages = stageNames(readJobEvents(created.taskDir))
    for (const expected of ['capture', 'audio', 'encode']) expect(stages, `missing stage ${expected}`).toContain(expected)
    expect(stages).not.toContain('compose_segments')
    expect(stages).not.toContain('mux')
  }, 180000)
})

it.skipIf(binsReady)('skips the composed pipeline tests because FFmpeg/ffprobe are not installed', () => {
  expect(binsReady).toBe(false)
})

it.skipIf(binsReady && playwrightReady)('skips the legacy-path test because Chromium is unavailable', () => {
  expect(binsReady && playwrightReady).toBe(false)
})
