// Render orchestrator (v3 plan §7.1, M3 extension).
//
// Legacy path (0.1–0.3, and 0.4 boards with neither video nor audio):
//   validate → prepare → capture → audio(440Hz placeholder) → encode → inspect → commit
// Composed path (any video element or audio track, DSL 0.4):
//   validate → prepare → compose_segments → audio_mix → mux → inspect → commit
//
// Scene durations are authoritative; every stage is bounded, logged to the task
// event log and to evidence, and success is only declared after output
// inspection and asset commit (v3 §4.2 gate).

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { MediaError } from '../errors.js'
import type { AssetProbe, AssetRecord, Storyboard } from '../types.js'
import { storyboardAssetRefs, storyboardTotalMs, validateStoryboard } from '../validation/validateStoryboard.js'
import { collectAssetRefs } from '../assets/refs.js'
import { materializeAssets } from '../assets/materialize.js'
import { EvidenceWriter } from '../evidence/EvidenceWriter.js'
import { appendJobEvent, type MediaWorkspace } from '../jobs/JobStore.js'
import { buildPageHtml, buildSrt } from './SceneRenderer.js'
import { captureFrames } from './FrameCapture.js'
import { withAutoSubtitles } from './SubtitleBuilder.js'
import { composeSegments } from './ClipComposer.js'
import { mixStoryboardAudio } from './AudioMixer.js'
import {
  encodeVideo,
  extractStill,
  hasSubtitleFilter,
  mediaBinVersion,
  muxAudio,
  probeVideo,
  requireMediaBin,
  synthesizeAudio,
} from './FfmpegAdapter.js'

export interface RenderStageInfo {
  stage: string
  ms: number
}

export interface RenderOrchestratorOptions {
  /** present when asset:// refs may need materializing (same-project source lookup) */
  workspace?: MediaWorkspace
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
  /** sidecar deliverables (e.g. `output/subtitles.srt` for srt/both) */
  extras?: AssetRecord[]
  stages: RenderStageInfo[]
  probe: AssetProbe
}

async function stage<T>(
  name: string,
  fn: () => T | Promise<T>,
  hooks: Pick<RenderOrchestratorOptions, 'onStage' | 'isCancelled'>,
  evidence: EvidenceWriter,
  taskDir: string,
): Promise<T> {
  if (hooks.isCancelled?.()) throw new MediaError('MEDIA_JOB_CANCELLED', `cancelled before stage "${name}"`)
  const started = Date.now()
  try {
    const result = await fn()
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
function assertInsideTaskDir(taskDir: string, relativePath: string, label: string): string {
  const base = resolve(taskDir)
  const resolved = resolve(base, relativePath)
  // path.relative (not a string prefix) keeps sibling dirs that share a
  // prefix — job-1 vs job-10 — from being treated as inside.
  const rel = relative(base, resolved)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new MediaError('MEDIA_ASSET_REF_INVALID', `${label} escapes the task directory: ${relativePath}`)
  }
  return resolved
}

function hasVideoElement(board: Storyboard): boolean {
  return board.scenes.some(scene => scene.elements.some(element => element.type === 'video'))
}

export async function renderStoryboard(options: RenderOrchestratorOptions): Promise<RenderOutcome> {
  const { taskDir, taskId, storyboard } = options
  // Re-validate at render time: the board on disk may predate a validator
  // upgrade or have been tampered with after create-time validation.
  const validation = validateStoryboard(storyboard)
  if (!validation.ok) {
    throw new MediaError('MEDIA_STORYBOARD_INVALID', `storyboard failed validation at render time: ${validation.errors.join('; ')}`)
  }
  const evidence = new EvidenceWriter(taskDir, taskId)
  const stages: RenderStageInfo[] = []
  const hooks: RenderOrchestratorOptions = {
    ...options,
    onStage: info => {
      stages.push(info)
      options.onStage?.(info)
    },
  }

  const ffmpeg = await stage('resolve_bins', () => requireMediaBin('ffmpeg', options.ffmpegBin), hooks, evidence, taskDir)
  const ffprobe = await stage('resolve_bins', () => requireMediaBin('ffprobe', options.ffprobeBin), hooks, evidence, taskDir)
  evidence.append('bin_versions', 'ok', { ffmpeg: mediaBinVersion(ffmpeg), ffprobe: mediaBinVersion(ffprobe) })

  // 1) external asset refs → task-local copies. Every later stage uses the
  // rewritten board; the caller's storyboard is never mutated.
  const board = await stage('materialize', () => {
    if (collectAssetRefs(storyboard).length === 0) return storyboard
    if (!options.workspace) {
      throw new MediaError('MEDIA_ASSET_REF_INVALID', 'asset:// references require workspace context')
    }
    return materializeAssets({
      workspace: options.workspace,
      taskDir,
      taskId,
      storyboard,
      evidence,
      isCancelled: options.isCancelled,
    }).storyboard
  }, hooks, evidence, taskDir)

  const totalMs = storyboardTotalMs(board)
  const durationSec = totalMs / 1000
  const framesDir = join(taskDir, 'render', 'frames')
  const renderDir = join(taskDir, 'render')
  const outputPath = join(taskDir, 'output', 'final.mp4')
  const srtPath = join(renderDir, 'subtitles.srt')
  const pageHtmlPath = join(renderDir, 'page.html')

  // 2) materialized asset references must exist and stay inside the task
  await stage('validate_assets', () => {
    for (const ref of storyboardAssetRefs(board)) {
      const resolved = assertInsideTaskDir(taskDir, join('assets', ref), 'media src')
      if (!existsSync(resolved)) {
        throw new MediaError('MEDIA_ASSET_REF_INVALID', `referenced asset missing: ${ref}`)
      }
    }
  }, hooks, evidence, taskDir)

  // 3) trusted page + subtitles. Retries must not inherit a stale SRT.
  const enrichedBoard = await stage('prepare', () => {
    const spec = board.subtitleOptions
    const autoCues = spec !== undefined && (spec.source ?? 'auto') === 'auto' && spec.mode !== 'none'
    const next = autoCues ? withAutoSubtitles(board) : board
    if (existsSync(srtPath)) rmSync(srtPath, { force: true })
    writeFileSync(pageHtmlPath, buildPageHtml(next, { assetsPrefix: join('..', 'assets') }), 'utf-8')

    // Legacy boards (no subtitleOptions) keep the historical behaviour: write
    // cues when present and burn them if the build supports the filter.
    const mode = board.subtitleOptions?.mode ?? 'burn'
    const source = board.subtitleOptions?.source ?? 'auto'
    if (mode !== 'none') {
      if (source === 'file') {
        const src = board.subtitleOptions?.src
        if (!src) throw new MediaError('MEDIA_STORYBOARD_INVALID', 'subtitleOptions.src is required when source is "file"')
        const abs = assertInsideTaskDir(taskDir, join('assets', src), 'subtitle src')
        if (!existsSync(abs)) throw new MediaError('MEDIA_ASSET_REF_INVALID', `subtitle file is missing: ${src}`)
        copyFileSync(abs, srtPath)
      } else {
        const srt = buildSrt(next)
        if (srt) writeFileSync(srtPath, srt, 'utf-8')
      }
    }
    return next
  }, hooks, evidence, taskDir)

  const subtitleMode = enrichedBoard.subtitleOptions?.mode ?? 'burn'
  const wantsBurn = subtitleMode === 'burn' || subtitleMode === 'both'
  const wantsSidecar = subtitleMode === 'srt' || subtitleMode === 'both'
  const composedPath = hasVideoElement(enrichedBoard) || (enrichedBoard.audioTracks?.length ?? 0) > 0

  if (composedPath) {
    // --- composed path (DSL 0.4 video / audio) --------------------------------
    const composed = await stage('compose_segments', () => composeSegments({
      ffmpeg,
      ffprobe,
      taskDir,
      taskId,
      storyboard: enrichedBoard,
      pageHtmlPath,
      isCancelled: options.isCancelled,
      onProgress: (done, total) => appendJobEvent(taskDir, { at: new Date().toISOString(), type: 'segment_progress', data: { done, total } }),
    }), hooks, evidence, taskDir)

    const audioPath = join(renderDir, 'audio.wav')
    await stage('audio_mix', () => {
      const mixed = mixStoryboardAudio({
        ffmpeg,
        storyboard: enrichedBoard,
        taskDir,
        totalMs,
        clipAudios: composed.clipAudios,
        outPath: audioPath,
      })
      evidence.append('audio_mix', 'ok', { inputs: mixed.plan.inputs.map(input => input.label), ms: mixed.ms })
    }, hooks, evidence, taskDir)

    await stage('mux', () => {
      const burn = wantsBurn && existsSync(srtPath) && hasSubtitleFilter(ffmpeg)
      const result = muxAudio({
        ffmpeg,
        videoPath: composed.videoPath,
        audioPath,
        outputPath,
        totalSec: durationSec,
        storyboard: enrichedBoard,
        subtitlePath: burn ? 'subtitles.srt' : undefined,
        workCwd: renderDir,
      })
      if (result.code !== 0) {
        throw new MediaError('MEDIA_ENCODE_FAILED', `ffmpeg mux exited ${result.code}: ${result.stderrTail}`)
      }
      if (!existsSync(outputPath) || statSync(outputPath).size === 0) {
        throw new MediaError('MEDIA_ENCODE_FAILED', 'mux reported success but the output file is missing or empty')
      }
      evidence.append('mux', 'ok', { burnedSubtitles: burn, segments: composed.segmentCount })
    }, hooks, evidence, taskDir)
  } else {
    // --- legacy pure-image path (unchanged 440Hz placeholder) ------------------
    const totalFrames = Math.round((totalMs / 1000) * enrichedBoard.canvas.fps)
    await stage('capture', () => captureFrames({
      pageHtmlPath,
      framesDir,
      width: enrichedBoard.canvas.width,
      height: enrichedBoard.canvas.height,
      fps: enrichedBoard.canvas.fps,
      totalFrames,
      isCancelled: options.isCancelled,
      onProgress: (completed, total) => appendJobEvent(taskDir, { at: new Date().toISOString(), type: 'capture_progress', data: { completed, total } }),
    }), hooks, evidence, taskDir)

    const audioPath = join(renderDir, 'audio.wav')
    await stage('audio', () => {
      const result = synthesizeAudio({ ffmpeg, durationSec, outPath: audioPath })
      if (result.code !== 0) throw new MediaError('MEDIA_RENDER_FAILED', `audio synthesis failed: ${result.stderrTail}`)
    }, hooks, evidence, taskDir)

    await stage('encode', () => {
      const burn = wantsBurn && existsSync(srtPath) && hasSubtitleFilter(ffmpeg)
      const result = encodeVideo({
        ffmpeg,
        framesDir,
        fps: enrichedBoard.canvas.fps,
        audioPath,
        outputPath,
        subtitlePath: burn ? 'subtitles.srt' : undefined,
        workCwd: renderDir,
        storyboard: enrichedBoard,
      })
      if (result.code !== 0) {
        throw new MediaError('MEDIA_ENCODE_FAILED', `ffmpeg exited ${result.code}: ${result.stderrTail}`)
      }
      if (!existsSync(outputPath) || statSync(outputPath).size === 0) {
        throw new MediaError('MEDIA_ENCODE_FAILED', 'ffmpeg reported success but the output file is missing or empty')
      }
      evidence.append('encode', 'ok', { burnedSubtitles: burn })
    }, hooks, evidence, taskDir)
  }

  // 4) output inspection (same contract for both paths)
  const probe = await stage('inspect', () => {
    const inspected = probeVideo(ffprobe, outputPath)
    const expectedWidth = enrichedBoard.canvas.width
    const expectedHeight = enrichedBoard.canvas.height
    if (inspected.videoCodec !== 'h264') throw new MediaError('MEDIA_OUTPUT_INVALID', `unexpected video codec: ${inspected.videoCodec}`)
    if (inspected.width !== expectedWidth || inspected.height !== expectedHeight) {
      throw new MediaError('MEDIA_OUTPUT_INVALID', `output is ${inspected.width}x${inspected.height}, expected ${expectedWidth}x${expectedHeight}`)
    }
    if (inspected.durationSec === undefined || Math.abs(inspected.durationSec - durationSec) > 0.5) {
      throw new MediaError('MEDIA_OUTPUT_INVALID', `output duration ${inspected.durationSec}s deviates from expected ${durationSec}s by more than 0.5s`)
    }
    if (composedPath && inspected.audioCodec !== 'aac') {
      throw new MediaError('MEDIA_OUTPUT_INVALID', `composed output has no AAC audio stream (found ${inspected.audioCodec ?? 'none'})`)
    }
    return inspected
  }, hooks, evidence, taskDir)

  // 5) commit asset record (status flip happens in JobService, after commit)
  const committed = await stage('commit', () => {
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
    const extras: AssetRecord[] = []
    if (wantsSidecar && existsSync(srtPath)) {
      const sidecarPath = join(taskDir, 'output', 'subtitles.srt')
      copyFileSync(srtPath, sidecarPath)
      const sidecar: AssetRecord = {
        id: `asset-${taskId}-subtitles`,
        path: 'output/subtitles.srt',
        kind: 'other',
        bytes: statSync(sidecarPath).size,
        sha256: sha256File(sidecarPath),
      }
      extras.push(sidecar)
      evidence.append('commit_subtitles', 'ok', { path: sidecar.path, bytes: sidecar.bytes })
    }
    evidence.append('commit_asset', 'ok', { path: record.path, bytes: record.bytes, sha256: record.sha256 })
    return { record, extras }
  }, hooks, evidence, taskDir)

  return {
    status: 'succeeded',
    output: committed.record,
    ...(committed.extras.length > 0 ? { extras: committed.extras } : {}),
    stages,
    probe,
  }
}
