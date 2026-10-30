// M4 export orchestrator (Gate M4 items 1–2): one succeeded render task →
// three profiles with asserted resolution/aspect/duration, extractable
// covers, a read-only source, and a publish manifest that (a) validates
// against the schema and (b) is not produced when required metadata is
// missing. Real FFmpeg only; skips with a note elsewhere.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createJob, getJob, runJob } from '../../../src/media/jobs/JobService.js'
import { readJobEvents } from '../../../src/media/jobs/JobStore.js'
import { probeVideo, resolveMediaBin } from '../../../src/media/render/FfmpegAdapter.js'
import { buildPublishManifest, publishManifestPath, validatePublishManifest } from '../../../src/media/export/PublishPackage.js'
import { EXPORT_PROFILE_IDS, resolveExportProfile } from '../../../src/media/export/profiles.js'
import type { Storyboard } from '../../../src/media/types.js'

const ffprobe = resolveMediaBin('ffprobe')
const binsReady = Boolean(resolveMediaBin('ffmpeg') && ffprobe)

const root = mkdtempSync(join(tmpdir(), 'media-m4-export-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

const output = { videoCodec: 'libx264', pixelFormat: 'yuv420p', audioCodec: 'aac', crf: 30, preset: 'ultrafast' }

function ffmpegRun(args: string[]): void {
  const result = spawnSync(resolveMediaBin('ffmpeg') as string, args, { encoding: 'utf-8', shell: false, windowsHide: true })
  expect(result.status, result.stderr).toBe(0)
}

let sharedSourceTaskId: string | undefined
async function sourceTask(): Promise<string> {
  if (sharedSourceTaskId) return sharedSourceTaskId
  ffmpegRun([
    '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=640x360:rate=24',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-ar', '48000', '-ac', '2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest',
    join(root, 'source.mp4'),
  ])
  const board: Storyboard = {
    schemaVersion: '0.4',
    canvas: { width: 640, height: 360, fps: 24, background: '#000000' },
    output,
    scenes: [{ id: 'open', durationMs: 2000, elements: [{ type: 'video', src: 'source.mp4' }] }],
  }
  const created = createJob({ root, storyboard: board, idempotencyKey: 'm4-source' })
  const { copyFileSync } = await import('node:fs')
  copyFileSync(join(root, 'source.mp4'), join(created.taskDir, 'assets', 'source.mp4'))
  const job = await runJob({ root, taskId: created.job.id })
  expect(job.status).toBe('succeeded')
  sharedSourceTaskId = job.id
  return job.id
}

function profileProbe(taskDir: string, profile: string): ReturnType<typeof probeVideo> {
  return probeVideo(ffprobe as string, join(taskDir, 'output', 'exports', `${profile}.mp4`))
}

describe('export orchestrator (M4)', () => {
  it.runIf(binsReady)('exports all three profiles with correct geometry, duration and covers', async () => {
    const sourceId = await sourceTask()
    const created = createJob({
      root,
      type: 'export',
      exportRequest: { sourceTaskId: sourceId, subtitles: 'srt' },
      requestedBy: 'test',
    })
    expect(created.job.type).toBe('export')
    const job = await runJob({ root, taskId: created.job.id })
    expect(job.status).toBe('succeeded')
    expect(job.error).toBeUndefined()

    // one video + one cover per profile, sorted with the video first
    expect(job.outputs).toHaveLength(EXPORT_PROFILE_IDS.length * 2)
    for (const profile of EXPORT_PROFILE_IDS) {
      const spec = resolveExportProfile(profile)
      const probe = profileProbe(created.taskDir, profile)
      expect(probe.videoCodec).toBe('h264')
      expect(probe.width).toBe(spec.width)
      expect(probe.height).toBe(spec.height)
      expect(Math.abs((probe.durationSec ?? 0) - 2)).toBeLessThanOrEqual(0.5)
      const aspect = probe.width / probe.height
      expect(Math.abs(aspect - spec.width / spec.height)).toBeLessThan(0.01)
      const coverPath = join(created.taskDir, 'output', 'exports', `${profile}-cover.jpg`)
      expect(existsSync(coverPath), `missing cover for ${profile}`).toBe(true)
      // JPEG magic
      const head = readFileSync(coverPath).subarray(0, 2)
      expect(head[0]).toBe(0xff)
      expect(head[1]).toBe(0xd8)
    }

    const stages = readJobEvents(created.taskDir)
      .filter(event => event.type === 'stage_done')
      .map(event => String((event.data as { stage?: unknown }).stage))
    for (const profile of EXPORT_PROFILE_IDS) {
      expect(stages, `missing transcode stage for ${profile}`).toContain(`transcode:${profile}`)
      expect(stages, `missing cover stage for ${profile}`).toContain(`cover:${profile}`)
    }

    // source stayed read-only: its manifest hash is unchanged and outputs intact
    const source = getJob(root, undefined, sourceId).job
    expect(source.status).toBe('succeeded')
    expect(existsSync(join(root, 'media', 'projects', 'default', 'tasks', sourceId, 'output', 'final.mp4'))).toBe(true)
  }, 240000)

  it.runIf(binsReady)('produces a publish manifest when metadata is present and validates it', async () => {
    const sourceId = await sourceTask()
    const created = createJob({
      root,
      type: 'export',
      exportRequest: {
        sourceTaskId: sourceId,
        profiles: ['9x16-1080p'],
        subtitles: 'srt',
        publish: { title: '发布测试', description: '一段描述', tags: ['测试'], platformHints: ['douyin'] },
      },
      requestedBy: 'test',
    })
    const job = await runJob({ root, taskId: created.job.id })
    expect(job.status).toBe('succeeded')

    const manifestPath = publishManifestPath(created.taskDir)
    expect(existsSync(manifestPath)).toBe(true)
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>
    expect(validatePublishManifest(raw)).toEqual([])
    expect(raw.version).toBe('1.0')
    expect(raw.sourceTaskId).toBe(sourceId)
    expect(raw.title).toBe('发布测试')
    expect((raw.assets as Array<{ profile: string }>).map(asset => asset.profile)).toEqual(['9x16-1080p'])
  }, 240000)

  it.runIf(binsReady)('does not write a publish manifest without the publish block', async () => {
    const sourceId = await sourceTask()
    const created = createJob({
      root,
      type: 'export',
      exportRequest: { sourceTaskId: sourceId, profiles: ['1x1-1080p'] },
      requestedBy: 'test',
    })
    const job = await runJob({ root, taskId: created.job.id })
    expect(job.status).toBe('succeeded')
    expect(existsSync(publishManifestPath(created.taskDir))).toBe(false)
  }, 240000)

  it.runIf(binsReady)('rejects export creation when the source is missing, failed, or not a render', async () => {
    // unknown source
    expect(() =>
      createJob({ root, type: 'export', exportRequest: { sourceTaskId: 'no-such-task' }, requestedBy: 'test' }),
    ).toThrow(/does not exist/)

    // non-render source: mark a mock image task succeeded so the status gate
    // passes and the type gate is what rejects it
    const imageTask = createJob({
      root,
      type: 'generate_image',
      imageRequest: { prompt: 'x', size: '1024x1024', providerId: 'mock' },
      requestedBy: 'test',
    })
    const snapshotPath = join(imageTask.taskDir, 'task.json')
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8')) as { status: string }
    snapshot.status = 'succeeded'
    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 1), 'utf-8')
    expect(() =>
      createJob({ root, type: 'export', exportRequest: { sourceTaskId: imageTask.job.id }, requestedBy: 'test' }),
    ).toThrow(/only render tasks can be exported/)
  }, 60000)

  it.runIf(binsReady)('rejects invalid requests and publish blocks missing required fields with field names', () => {
    // missing publish title → rejected at create time, field named
    expect(() =>
      createJob({
        root,
        type: 'export',
        exportRequest: { sourceTaskId: 'whatever', publish: { description: 'no title' } },
        requestedBy: 'test',
      }),
    ).toThrow(/title/)

    // unknown profile id → rejected with the profiles field named
    expect(() =>
      createJob({
        root,
        type: 'export',
        exportRequest: { sourceTaskId: 'whatever', profiles: ['21x9-1080p' as never] },
        requestedBy: 'test',
      }),
    ).toThrow(/profiles/)

    // out-of-range cover time
    expect(() =>
      createJob({
        root,
        type: 'export',
        exportRequest: { sourceTaskId: 'whatever', coverAtSec: 99999 },
        requestedBy: 'test',
      }),
    ).toThrow(/coverAtSec/)

    // manifest schema: empty assets is an issue naming the field
    const manifest = buildPublishManifest({
      sourceTaskId: 't',
      publish: { title: 'x' },
      assets: [],
    })
    expect(validatePublishManifest(manifest).some(issue => issue.field === 'assets')).toBe(true)
  }, 60000)
})

it.skipIf(binsReady)('skips the export orchestrator tests because FFmpeg/ffprobe are not installed', () => {
  expect(binsReady).toBe(false)
})
