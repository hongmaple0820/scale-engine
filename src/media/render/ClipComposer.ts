// Segment composer for DSL 0.4 video/audio storyboards (M3).
//
// Strategy (plan §M3):
//   image scene  → Playwright captures that scene's frame window only
//   video scene  → ffmpeg trims/fits the clip, optionally composites a static
//                  transparent overlay PNG, and never screenshots the clip
//   all segments → identical encoder parameters, then concat demuxer -c copy
//
// Scene durations stay authoritative: each segment is hard-cut to its scene
// duration so independently rounded frame counts cannot drift the film length.

import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { MediaError, type MediaErrorCode } from '../errors.js'
import type { AssetProbe, Storyboard, StoryboardScene, VideoElement } from '../types.js'
import type { ClipAudioRef } from './AudioMixer.js'
import {
  concatSegments,
  encodeSegment,
  extractClipAudio,
  normalizeClip,
  overlayPng,
  probeVideo,
} from './FfmpegAdapter.js'
import { captureFrames } from './FrameCapture.js'
import { renderSceneOverlay } from './OverlayRenderer.js'

/** Probed container durations can disagree with trim bounds by a few ms. */
const TRIM_TOLERANCE_MS = 50

export interface ComposeOptions {
  ffmpeg: string
  ffprobe: string
  taskDir: string
  taskId: string
  storyboard: Storyboard
  /** trusted page covering the whole storyboard (image scenes capture a window) */
  pageHtmlPath: string
  isCancelled?: () => boolean
  /** (segments done, total segments) */
  onProgress?: (done: number, total: number) => void
}

export interface ComposeResult {
  /** absolute path to the concatenated, silent video */
  videoPath: string
  segmentCount: number
  /** unmuted clip audio to place on the film timeline */
  clipAudios: ClipAudioRef[]
  ms: number
}

function videoElementOf(scene: StoryboardScene): VideoElement | undefined {
  return scene.elements.find((element): element is VideoElement => element.type === 'video')
}

function assetPathOf(taskDir: string, src: string, label: string): string {
  const assetsDir = resolve(join(taskDir, 'assets'))
  const resolved = resolve(assetsDir, src.split('\\').join('/'))
  const rel = relative(assetsDir, resolved)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new MediaError('MEDIA_ASSET_REF_INVALID', `${label} escapes the task assets directory: ${src}`)
  }
  if (!existsSync(resolved)) {
    throw new MediaError('MEDIA_ASSET_REF_INVALID', `${label} is missing: ${src}`)
  }
  return resolved
}

function runOrThrow(result: { code: number | null; stderrTail: string }, code: MediaErrorCode, label: string): void {
  if (result.code !== 0) {
    throw new MediaError(code, `${label}: ${result.stderrTail}`)
  }
}

function fileHasBytes(path: string): boolean {
  return existsSync(path) && statSync(path).size > 0
}

export async function composeSegments(options: ComposeOptions): Promise<ComposeResult> {
  const started = Date.now()
  const { storyboard } = options
  const fps = storyboard.canvas.fps
  const { width, height, background } = storyboard.canvas
  const segmentsDir = join(options.taskDir, 'render', 'segments')
  rmSync(segmentsDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  mkdirSync(segmentsDir, { recursive: true })

  const probes = new Map<string, AssetProbe>()
  const probeClip = (path: string): AssetProbe => {
    const cached = probes.get(path)
    if (cached) return cached
    const probe = probeVideo(options.ffprobe, path)
    if (probe.durationSec === undefined || !(probe.durationSec > 0)) {
      throw new MediaError('MEDIA_PROBE_FAILED', `could not determine the clip duration: ${path}`)
    }
    probes.set(path, probe)
    return probe
  }

  const segmentNames: string[] = []
  const clipAudios: ClipAudioRef[] = []
  let cursorMs = 0

  for (let sceneIndex = 0; sceneIndex < storyboard.scenes.length; sceneIndex++) {
    if (options.isCancelled?.()) throw new MediaError('MEDIA_JOB_CANCELLED', 'cancelled while composing segments', { retryable: false })
    const scene = storyboard.scenes[sceneIndex]
    const pad = String(sceneIndex).padStart(3, '0')
    const segmentName = `seg-${pad}.mp4`
    const segmentPath = join(segmentsDir, segmentName)
    const durationSec = scene.durationMs / 1000
    const video = videoElementOf(scene)

    if (video) {
      const input = assetPathOf(options.taskDir, video.src, `video src in scene "${scene.id}"`)
      const probe = probeClip(input)
      const trimStartMs = video.trimStartMs ?? 0
      const trimEndMs = video.trimEndMs ?? Math.floor((probe.durationSec ?? 0) * 1000)
      const clipMs = (probe.durationSec ?? 0) * 1000
      if (trimEndMs > clipMs + TRIM_TOLERANCE_MS) {
        throw new MediaError(
          'MEDIA_STORYBOARD_INVALID',
          `scene "${scene.id}": trimEndMs ${trimEndMs} exceeds the clip duration ${Math.round(clipMs)}ms`,
        )
      }
      const availableMs = trimEndMs - trimStartMs
      if (availableMs <= 0) {
        throw new MediaError('MEDIA_STORYBOARD_INVALID', `scene "${scene.id}": the trim window is empty`)
      }
      const loop = video.loop === true
      if (availableMs < scene.durationMs && !loop) {
        throw new MediaError(
          'MEDIA_STORYBOARD_INVALID',
          `scene "${scene.id}": the trimmed clip is ${availableMs}ms, shorter than the scene (${scene.durationMs}ms); set loop or shorten the scene`,
        )
      }
      const fit = video.fit ?? 'cover'
      const basePath = join(segmentsDir, `seg-${pad}.base.mp4`)
      const common = { ffmpeg: options.ffmpeg, outputPath: basePath, width, height, fps, fit, background, storyboard }
      if (availableMs < scene.durationMs) {
        // loop the *trimmed range*: first cut the range, then loop that file
        const trimPath = join(segmentsDir, `seg-${pad}.trim.mp4`)
        runOrThrow(
          normalizeClip({ ...common, input, outputPath: trimPath, durationSec: availableMs / 1000, trimStartMs, loop: false }),
          'MEDIA_RENDER_FAILED',
          `trimming clip for scene "${scene.id}"`,
        )
        runOrThrow(
          normalizeClip({ ...common, input: trimPath, durationSec, trimStartMs: 0, loop: true }),
          'MEDIA_RENDER_FAILED',
          `looping clip for scene "${scene.id}"`,
        )
      } else {
        runOrThrow(
          normalizeClip({ ...common, input, durationSec, trimStartMs, loop: false }),
          'MEDIA_RENDER_FAILED',
          `normalizing clip for scene "${scene.id}"`,
        )
      }
      if (!fileHasBytes(basePath)) {
        throw new MediaError('MEDIA_RENDER_FAILED', `clip segment for scene "${scene.id}" is missing or empty`)
      }

      if (video.muted === false) {
        const audioPath = join(segmentsDir, `seg-${pad}-audio.wav`)
        const audioSource = availableMs < scene.durationMs ? join(segmentsDir, `seg-${pad}.trim.mp4`) : input
        runOrThrow(
          extractClipAudio({
            ffmpeg: options.ffmpeg,
            input: audioSource,
            outputPath: audioPath,
            trimStartMs: availableMs < scene.durationMs ? 0 : trimStartMs,
            durationSec,
            volume: 1,
            loop: availableMs < scene.durationMs,
          }),
          'MEDIA_RENDER_FAILED',
          `extracting clip audio for scene "${scene.id}"`,
        )
        clipAudios.push({ path: audioPath, startMs: cursorMs })
      }

      const overlay = await renderSceneOverlay({
        taskDir: options.taskDir,
        storyboard,
        scene,
        sceneIndex,
      })
      if (overlay) {
        runOrThrow(
          overlayPng({ ffmpeg: options.ffmpeg, input: basePath, overlay: overlay.overlayPath, outputPath: segmentPath, durationSec, storyboard }),
          'MEDIA_RENDER_FAILED',
          `compositing overlay for scene "${scene.id}"`,
        )
        rmSync(basePath, { force: true })
      } else {
        // no overlay: the normalized clip is already the final segment
        renameSync(basePath, segmentPath)
      }
    } else {
      const framesDir = join(segmentsDir, `seg-${pad}-frames`)
      const totalFrames = Math.max(1, Math.round((scene.durationMs * fps) / 1000))
      await captureFrames({
        pageHtmlPath: options.pageHtmlPath,
        framesDir,
        width,
        height,
        fps,
        totalFrames,
        // absolute storyboard time: the page picks the active scene itself
        timeOffsetMs: cursorMs,
        isCancelled: options.isCancelled,
      })
      runOrThrow(
        encodeSegment({ ffmpeg: options.ffmpeg, framesDir, fps, outputPath: segmentPath, durationSec, workCwd: segmentsDir, storyboard }),
        'MEDIA_ENCODE_FAILED',
        `encoding segment for scene "${scene.id}"`,
      )
      rmSync(framesDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }

    if (!fileHasBytes(segmentPath)) {
      throw new MediaError('MEDIA_ENCODE_FAILED', `segment for scene "${scene.id}" is missing or empty`)
    }
    segmentNames.push(segmentName)
    cursorMs += scene.durationMs
    options.onProgress?.(sceneIndex + 1, storyboard.scenes.length)
  }

  if (segmentNames.length === 0) {
    throw new MediaError('MEDIA_STORYBOARD_INVALID', 'storyboard has no scenes to compose')
  }

  const listPath = join(segmentsDir, 'list.txt')
  writeFileSync(listPath, segmentNames.map(name => `file '${name}'`).join('\n') + '\n', 'utf-8')
  const videoPath = resolve(join(options.taskDir, 'render', 'composed.mp4'))
  runOrThrow(
    concatSegments({ ffmpeg: options.ffmpeg, listPath: 'list.txt', outputPath: videoPath, cwd: segmentsDir }),
    'MEDIA_ENCODE_FAILED',
    'concatenating segments',
  )
  if (!fileHasBytes(videoPath)) {
    throw new MediaError('MEDIA_ENCODE_FAILED', 'concatenated video is missing or empty')
  }

  return { videoPath, segmentCount: segmentNames.length, clipAudios, ms: Date.now() - started }
}
