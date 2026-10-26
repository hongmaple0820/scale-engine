// Render orchestrator (v3 plan §7.1): validate → prepare → capture → audio →
// encode → inspect → commit. Every stage is bounded, logged to the task event
// log and to evidence; success is only declared after output inspection and
// asset commit (v3 §4.2 gate). Cancellation is cooperative between stages.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MediaError } from '../errors.js'
import type { AssetProbe, AssetRecord, Storyboard } from '../types.js'
import { storyboardAssetRefs, storyboardTotalMs } from '../validation/validateStoryboard.js'
import { EvidenceWriter } from '../evidence/EvidenceWriter.js'
import { appendJobEvent } from '../jobs/JobStore.js'
import { buildPageHtml, buildSrt } from './SceneRenderer.js'
import { captureFrames } from './FrameCapture.js'
import {
  encodeVideo,
  extractStill,
  hasSubtitleFilter,
  mediaBinVersion,
  probeVideo,
  requireMediaBin,
  synthesizeAudio,
} from './FfmpegAdapter.js'

export interface RenderStageInfo {
  stage: string
  ms: number
}

export interface RenderOrchestratorOptions {
  taskDir: string
  taskId: string
  storyboard: Storyboard
  requestedBy: string
  ffmpegBin?: string
  ffprobeBin?: string
  /** between-stage cancel check */
  isCancelled?: () => boolean
  onStage?: (info: RenderStageInfo) => void
}

export interface RenderOutcome {
  status: 'succeeded'
  output: AssetRecord
  stages: RenderStageInfo[]
  probe: AssetProbe
}

function stage<T>(name: string, fn: () => T, hooks: Pick<RenderOrchestratorOptions, 'onStage' | 'isCancelled'>, evidence: EvidenceWriter, taskDir: string): T {
  if (hooks.isCancelled?.()) throw new MediaError('MEDIA_JOB_CANCELLED', `cancelled before stage "${name}"`)
  const started = Date.now()
  try {
    const result = fn()
    const info = { stage: name, ms: Date.now() - started }
    hooks.onStage?.(info)
    appendJobEvent(taskDir, { at: new Date().toISOString(), type: 'stage_done', data: info })
    evidence.append(`stage:${name}`, 'ok', { ms: info.ms })
    return result
  } catch (error) {
    const ms = Date.now() - started
    appendJobEvent(taskDir, { at: new Date().toISOString(), type: 'stage_failed', data: { stage: name, ms } })
    evidence.append(`stage:${name}`, 'error', { ms, error: error instanceof Error ? error.message : String(error) })
    throw error
  }
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Task-relative paths must resolve inside the task dir (v3 §5.2 SafePath). */
function assertInsideTaskDir(taskDir: string, relative: string, label: string): string {
  const resolved = join(taskDir, relative)
  const normalized = resolved.split(/[\\/]+/).join('\\')
  const base = taskDir.split(/[\\/]+/).join('\\')
  if (!normalized.toLowerCase().startsWith(base.toLowerCase())) {
    throw new MediaError('MEDIA_ASSET_REF_INVALID', `${label} escapes the task directory: ${relative}`)
  }
  return resolved
}

export async function renderStoryboard(options: RenderOrchestratorOptions): Promise<RenderOutcome> {
  const { taskDir, taskId, storyboard } = options
  const evidence = new EvidenceWriter(taskDir, taskId)
  const stages: RenderStageInfo[] = []

  const ffmpeg = stage('resolve_bins', () => requireMediaBin('ffmpeg', options.ffmpegBin), options, evidence, taskDir)
  const ffprobe = stage('resolve_bins', () => requireMediaBin('ffprobe', options.ffprobeBin), options, evidence, taskDir)
  evidence.append('bin_versions', 'ok', { ffmpeg: mediaBinVersion(ffmpeg), ffprobe: mediaBinVersion(ffprobe) })

  const totalMs = storyboardTotalMs(storyboard)
  const durationSec = totalMs / 1000
  const framesDir = join(taskDir, 'render', 'frames')
  const outputPath = join(taskDir, 'output', 'final.mp4')

  // 1) asset references must exist and stay inside the task
  stage('validate_assets', () => {
    for (const ref of storyboardAssetRefs(storyboard)) {
      const resolved = assertInsideTaskDir(taskDir, join('assets', ref), 'image src')
      if (!existsSync(resolved)) {
        throw new MediaError('MEDIA_ASSET_REF_INVALID', `referenced asset missing: ${ref}`)
      }
    }
  }, options, evidence, taskDir)

  // 2) trusted page + optional subtitles
  stage('prepare', () => {
    const renderDir = join(taskDir, 'render')
    writeFileSync(join(renderDir, 'page.html'), buildPageHtml(storyboard, { assetsPrefix: join('..', 'assets') }), 'utf-8')
    const srt = buildSrt(storyboard)
    if (srt) writeFileSync(join(renderDir, 'subtitles.srt'), srt, 'utf-8')
  }, options, evidence, taskDir)

  // 3) deterministic frame capture
  const totalFrames = Math.round((totalMs / 1000) * storyboard.canvas.fps)
  const capture = await stage('capture', () => {
    return captureFrames({
      pageHtmlPath: join(taskDir, 'render', 'page.html'),
      framesDir,
      width: storyboard.canvas.width,
      height: storyboard.canvas.height,
      fps: storyboard.canvas.fps,
      totalFrames,
      isCancelled: options.isCancelled,
      onProgress: (completed, total) => appendJobEvent(taskDir, { at: new Date().toISOString(), type: 'capture_progress', data: { completed, total } }),
    })
  }, options, evidence, taskDir)
  stages.push({ stage: 'capture', ms: capture.captureMs })

  // 4) audio bed
  const audioPath = join(taskDir, 'render', 'audio.wav')
  stage('audio', () => {
    const result = synthesizeAudio({ ffmpeg, durationSec, outPath: audioPath })
    if (result.code !== 0) throw new MediaError('MEDIA_RENDER_FAILED', `audio synthesis failed: ${result.stderrTail}`)
  }, options, evidence, taskDir)

  // 5) encode (+ burned subtitles when the build supports it)
  const srtPath = join(taskDir, 'render', 'subtitles.srt')
  stage('encode', () => {
    const burn = existsSync(srtPath) && hasSubtitleFilter(ffmpeg)
    const result = encodeVideo({
      ffmpeg,
      framesDir,
      fps: storyboard.canvas.fps,
      audioPath,
      outputPath,
      subtitlePath: burn ? 'subtitles.srt' : undefined,
      workCwd: join(taskDir, 'render'),
      storyboard,
    })
    if (result.code !== 0) {
      throw new MediaError('MEDIA_ENCODE_FAILED', `ffmpeg exited ${result.code}: ${result.stderrTail}`)
    }
    if (!existsSync(outputPath) || statSync(outputPath).size === 0) {
      throw new MediaError('MEDIA_ENCODE_FAILED', 'ffmpeg reported success but the output file is missing or empty')
    }
    evidence.append('encode', 'ok', { ms: undefined, burnedSubtitles: burn })
  }, options, evidence, taskDir)

  // 6) output inspection
  const probe = stage('inspect', () => {
    const inspected = probeVideo(ffprobe, outputPath)
    const expectedWidth = storyboard.canvas.width
    const expectedHeight = storyboard.canvas.height
    if (inspected.videoCodec !== 'h264') throw new MediaError('MEDIA_OUTPUT_INVALID', `unexpected video codec: ${inspected.videoCodec}`)
    if (inspected.width !== expectedWidth || inspected.height !== expectedHeight) {
      throw new MediaError('MEDIA_OUTPUT_INVALID', `output is ${inspected.width}x${inspected.height}, expected ${expectedWidth}x${expectedHeight}`)
    }
    if (inspected.durationSec === undefined || Math.abs(inspected.durationSec - durationSec) > 0.5) {
      throw new MediaError('MEDIA_OUTPUT_INVALID', `output duration ${inspected.durationSec}s deviates from expected ${durationSec}s by more than 0.5s`)
    }
    return inspected
  }, options, evidence, taskDir)

  // 7) commit asset record (status flip happens in JobService, after commit)
  const output = stage('commit', () => {
    const record: AssetRecord = {
      id: `asset-${taskId}-final`,
      path: 'output/final.mp4',
      kind: 'video',
      bytes: statSync(outputPath).size,
      sha256: sha256File(outputPath),
      probe,
    }
    // human-viewable stills for review (best effort, never fatal)
    for (const atSec of [durationSec * 0.25, durationSec * 0.75]) {
      const still = extractStill({ ffmpeg, input: outputPath, atSec, outPath: join(taskDir, 'output', `still-${atSec.toFixed(2)}s.png`) })
      if (still.code !== 0) evidence.append('still_extract', 'error', { atSec })
    }
    evidence.append('commit_asset', 'ok', { path: record.path, bytes: record.bytes, sha256: record.sha256 })
    return record
  }, options, evidence, taskDir)

  return { status: 'succeeded', output, stages, probe }
}
