// Audio bed composition for DSL 0.4 (M3): narration + BGM + unmuted clip audio
// are mixed into one stereo WAV spanning the film timeline. Planning is pure
// (paths + filter parameters only) so it can be unit tested without ffmpeg; the
// actual mixing is a single ffmpeg invocation in FfmpegAdapter.
//
// The legacy 0.2/0.3 image path never calls this module — it keeps the 440 Hz
// placeholder so pure-image renders stay byte-compatible with M2.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MediaError } from '../errors.js'
import type { Storyboard } from '../types.js'
import { mixAudio, type AudioInput } from './FfmpegAdapter.js'

/** One unmuted video clip's audio, placed at the scene's timeline offset. */
export interface ClipAudioRef {
  /** absolute task-local path to the extracted WAV */
  path: string
  startMs: number
  /** 0–1, default 1 */
  volume?: number
}

export interface PlannedAudioInput extends AudioInput {
  /** stable label for evidence (`track:narration`, `clip:2`, …) */
  label: string
}

export interface AudioMixPlan {
  inputs: PlannedAudioInput[]
  totalSec: number
  /** false → the caller must render silence (ensureSilentAudio) */
  hasAudio: boolean
}

/** Assets are addressed relative to `<taskDir>/assets` in every DSL path. */
export function resolveAssetPath(taskDir: string, src: string): string {
  return join(taskDir, 'assets', src.split('\\').join('/'))
}

export interface PlanAudioMixOptions {
  storyboard: Storyboard
  taskDir: string
  totalMs: number
  clipAudios?: ClipAudioRef[]
}

export function planAudioMix(options: PlanAudioMixOptions): AudioMixPlan {
  const totalSec = options.totalMs / 1000
  if (!(totalSec > 0)) {
    throw new MediaError('MEDIA_STORYBOARD_INVALID', 'audio mixing requires a positive film duration')
  }
  const inputs: PlannedAudioInput[] = []

  for (const track of options.storyboard.audioTracks ?? []) {
    const path = resolveAssetPath(options.taskDir, track.src)
    if (!existsSync(path)) {
      throw new MediaError('MEDIA_ASSET_REF_INVALID', `audio track "${track.kind}" is missing: ${track.src}`)
    }
    inputs.push({
      label: `track:${track.kind}`,
      path,
      volume: track.volume ?? 1,
      loop: track.loop === true,
      delayMs: 0,
      ...(track.fadeInMs ? { fadeInMs: track.fadeInMs } : {}),
      ...(track.fadeOutMs ? { fadeOutMs: track.fadeOutMs } : {}),
    })
  }

  ;(options.clipAudios ?? []).forEach((clip, index) => {
    if (!existsSync(clip.path)) {
      throw new MediaError('MEDIA_RENDER_FAILED', `extracted clip audio is missing: ${clip.path}`)
    }
    inputs.push({
      label: `clip:${index}`,
      path: clip.path,
      volume: clip.volume ?? 1,
      loop: false,
      delayMs: Math.max(0, Math.round(clip.startMs)),
    })
  })

  return { inputs, totalSec, hasAudio: inputs.length > 0 }
}

export interface MixStoryboardAudioOptions extends PlanAudioMixOptions {
  ffmpeg: string
  outPath: string
}

export interface MixStoryboardAudioResult {
  plan: AudioMixPlan
  ms: number
}

/** Plan + mix in one call. A board with no audio still yields a silent bed. */
export function mixStoryboardAudio(options: MixStoryboardAudioOptions): MixStoryboardAudioResult {
  const plan = planAudioMix(options)
  const result = mixAudio({ ffmpeg: options.ffmpeg, inputs: plan.inputs, totalSec: plan.totalSec, outPath: options.outPath })
  if (result.code !== 0) {
    throw new MediaError('MEDIA_RENDER_FAILED', `audio mix failed: ${result.stderrTail}`)
  }
  if (!existsSync(options.outPath)) {
    throw new MediaError('MEDIA_RENDER_FAILED', 'audio mix reported success but produced no file')
  }
  return { plan, ms: result.ms }
}
