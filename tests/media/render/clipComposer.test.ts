// Segment composer (M3): video scenes are trimmed into uniform segments and
// concatenated by stream copy; scene durations stay authoritative. FFmpeg-only
// suite — when the binaries are missing the whole file skips with an explicit
// note instead of silently passing.

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterAll, describe, expect, it } from 'vitest'
import { composeSegments, type ComposeOptions } from '../../../src/media/render/ClipComposer.js'
import { probeVideo, resolveMediaBin } from '../../../src/media/render/FfmpegAdapter.js'
import { MediaError } from '../../../src/media/errors.js'
import type { Storyboard, VideoElement } from '../../../src/media/types.js'

const nodeRequire = createRequire(import.meta.url)
const ffmpeg = resolveMediaBin('ffmpeg')
const ffprobe = resolveMediaBin('ffprobe')
const binsReady = Boolean(ffmpeg && ffprobe)
let playwrightReady = false
try {
  nodeRequire.resolve('playwright')
  playwrightReady = true
} catch {
  // overlay leg unavailable
}

const root = mkdtempSync(join(tmpdir(), 'media-compose-'))
const assets = join(root, 'assets')
mkdirSync(assets, { recursive: true })
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

function makeClip(name: string, durationSec: number, withAudio = false): string {
  const path = join(assets, name)
  const args = [
    '-y', '-f', 'lavfi', '-i', `testsrc=duration=${durationSec}:size=320x180:rate=24`,
  ]
  if (withAudio) args.push('-f', 'lavfi', '-i', `sine=frequency=330:duration=${durationSec}`)
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p')
  if (withAudio) args.push('-c:a', 'aac', '-shortest')
  args.push(path)
  const result = spawnSync(ffmpeg as string, args, { encoding: 'utf-8', shell: false, windowsHide: true })
  expect(result.status, result.stderr).toBe(0)
  return path
}

function board(videos: VideoElement[], durationMs = 1000): Storyboard {
  return {
    schemaVersion: '0.4',
    canvas: { width: 320, height: 180, fps: 24, background: '#000000' },
    scenes: videos.map((video, index) => ({
      id: `scene-${index}`,
      durationMs,
      elements: [video],
    })),
  }
}

function options(storyboard: Storyboard, taskDir = root): ComposeOptions {
  return {
    ffmpeg: ffmpeg as string,
    ffprobe: ffprobe as string,
    taskDir,
    taskId: 'compose-test',
    storyboard,
    pageHtmlPath: join(taskDir, 'unused.html'),
  }
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise
    throw new Error(`expected a MediaError ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(MediaError)
    expect((error as MediaError).code).toBe(code)
  }
}

describe.skipIf(!binsReady)('composeSegments (FFmpeg required)', () => {
  it('trims video scenes to their durations and concatenates them', async () => {
    makeClip('two-scenes.mp4', 1.5)
    const result = await composeSegments(options(board([
      { type: 'video', src: 'two-scenes.mp4' },
      { type: 'video', src: 'two-scenes.mp4', trimStartMs: 500, trimEndMs: 1500 },
    ])))
    expect(result.segmentCount).toBe(2)
    expect(result.clipAudios).toEqual([])
    const probe = probeVideo(ffprobe as string, result.videoPath)
    expect(probe.videoCodec).toBe('h264')
    expect(probe.width).toBe(320)
    expect(probe.height).toBe(180)
    expect(probe.audioCodec).toBeUndefined()
    expect(Math.abs((probe.durationSec ?? 0) - 2)).toBeLessThanOrEqual(0.25)
  }, 120000)

  it('loops a short trim range until the scene ends', async () => {
    makeClip('short.mp4', 1.5)
    const result = await composeSegments(options(board([
      { type: 'video', src: 'short.mp4', trimEndMs: 600, loop: true },
    ])))
    const probe = probeVideo(ffprobe as string, result.videoPath)
    expect(Math.abs((probe.durationSec ?? 0) - 1)).toBeLessThanOrEqual(0.25)
  }, 120000)

  it('extracts unmuted clip audio onto the film timeline', async () => {
    makeClip('with-sound.mp4', 1.5, true)
    const result = await composeSegments(options(board([
      { type: 'video', src: 'with-sound.mp4', muted: false },
      { type: 'video', src: 'with-sound.mp4', muted: false },
    ])))
    expect(result.clipAudios).toHaveLength(2)
    expect(result.clipAudios.map(clip => clip.startMs)).toEqual([0, 1000])
    for (const clip of result.clipAudios) {
      expect(existsSync(clip.path)).toBe(true)
      expect(probeVideo(ffprobe as string, clip.path).audioCodec).toBe('pcm_s16le')
    }
    // the composed picture track stays silent; audio is mixed separately
    expect(probeVideo(ffprobe as string, result.videoPath).audioCodec).toBeUndefined()
  }, 120000)

  it('rejects a trim window beyond the clip and an unlooped short clip', async () => {
    makeClip('bounds.mp4', 1.5)
    await expectCode(composeSegments(options(board([
      { type: 'video', src: 'bounds.mp4', trimEndMs: 2000 },
    ]))), 'MEDIA_STORYBOARD_INVALID')
    await expectCode(composeSegments(options(board([
      { type: 'video', src: 'bounds.mp4', trimEndMs: 600 },
    ]))), 'MEDIA_STORYBOARD_INVALID')
  }, 120000)

  it('fails closed when a referenced clip is missing', async () => {
    await expectCode(composeSegments(options(board([
      { type: 'video', src: 'missing.mp4' },
    ]))), 'MEDIA_ASSET_REF_INVALID')
  })

  it.runIf(playwrightReady)('composites a video scene\'s text elements as a transparent overlay', async () => {
    makeClip('overlay.mp4', 1.5)
    const taskDir = join(root, 'overlay-task')
    mkdirSync(join(taskDir, 'assets'), { recursive: true })
    copyFileSync(join(assets, 'overlay.mp4'), join(taskDir, 'assets', 'overlay.mp4'))
    const storyboard: Storyboard = {
      schemaVersion: '0.4',
      canvas: { width: 320, height: 180, fps: 24, background: '#000000' },
      scenes: [{
        id: 'host',
        durationMs: 1000,
        elements: [
          { type: 'video', src: 'overlay.mp4' },
          { type: 'text', content: 'OVERLAY', fontFamily: 'Arial', fontSize: 24, color: '#ffffff', x: 'center', y: 70 },
        ],
      }],
    }
    const result = await composeSegments(options(storyboard, taskDir))
    expect(result.segmentCount).toBe(1)
    const overlayPath = join(taskDir, 'render', 'overlays', 'scene-000.png')
    expect(existsSync(overlayPath)).toBe(true)

    // omitBackground screenshots must be RGBA (PNG color type 6) with drawn pixels
    const png = readFileSync(overlayPath)
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR')
    expect(png[25]).toBe(6)
    const raw = spawnSync(ffmpeg as string, ['-v', 'error', '-i', overlayPath, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], {
      encoding: null,
      windowsHide: true,
    })
    expect(raw.status, String(raw.stderr)).toBe(0)
    const pixels = raw.stdout as Buffer
    let opaque = 0
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) opaque++
    expect(opaque).toBeGreaterThan(100)

    const probe = probeVideo(ffprobe as string, result.videoPath)
    expect(Math.abs((probe.durationSec ?? 0) - 1)).toBeLessThanOrEqual(0.25)
  }, 120000)
})

it.skipIf(binsReady)('skips clip composition tests because FFmpeg/ffprobe are not installed', () => {
  expect(binsReady).toBe(false)
})

it.skipIf(!binsReady || playwrightReady)('skips the overlay leg because Playwright/Chromium is unavailable', () => {
  expect(binsReady && playwrightReady).toBe(false)
})
