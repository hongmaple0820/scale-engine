// Audio bed planning + mixing (M3). Planning is pure; mixing runs only when
// FFmpeg is present and is skipped with an explicit note otherwise.

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  mixStoryboardAudio,
  planAudioMix,
} from '../../../src/media/render/AudioMixer.js'
import { probeVideo, resolveMediaBin, synthesizeAudio } from '../../../src/media/render/FfmpegAdapter.js'
import { MediaError } from '../../../src/media/errors.js'
import type { AudioTrack, Storyboard } from '../../../src/media/types.js'

const ffmpeg = resolveMediaBin('ffmpeg')
const ffprobe = resolveMediaBin('ffprobe')
const binsReady = Boolean(ffmpeg && ffprobe)

const root = mkdtempSync(join(tmpdir(), 'media-audio-'))
const assets = join(root, 'assets')
mkdirSync(join(assets, 'voice'), { recursive: true })
mkdirSync(join(assets, 'music'), { recursive: true })
// planning only checks existence; real tones are generated per mixing test
for (const name of ['voice/vo.wav', 'music/bed.wav', 'clip.wav']) writeFileSync(join(assets, name), 'RIFF')
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

function board(tracks?: AudioTrack[]): Storyboard {
  return {
    schemaVersion: '0.4',
    canvas: { width: 320, height: 180, fps: 24, background: '#000000' },
    scenes: [{ id: 'only', durationMs: 2000, elements: [{ type: 'rect', x: 0, y: 0, width: 10, height: 10, color: '#ffffff' }] }],
    ...(tracks ? { audioTracks: tracks } : {}),
  }
}

function writeTone(name: string, frequency: number, durationSec: number): string {
  const path = join(assets, name)
  const result = spawnSync(ffmpeg as string, [
    '-y', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=${durationSec}`,
    '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', path,
  ], { encoding: 'utf-8', shell: false, windowsHide: true })
  expect(result.status, result.stderr).toBe(0)
  return path
}

describe('planAudioMix', () => {
  it('maps narration and BGM tracks to inputs with loop/volume/fades', () => {
    const plan = planAudioMix({
      storyboard: board([
        { src: 'voice/vo.wav', kind: 'narration', volume: 0.9, fadeInMs: 150 },
        { src: 'music/bed.wav', kind: 'bgm', volume: 0.3, loop: true, fadeOutMs: 500 },
      ]),
      taskDir: root,
      totalMs: 2000,
    })
    expect(plan.totalSec).toBe(2)
    expect(plan.hasAudio).toBe(true)
    expect(plan.inputs.map(input => input.label)).toEqual(['track:narration', 'track:bgm'])
    expect(plan.inputs[1]).toMatchObject({ volume: 0.3, loop: true, delayMs: 0, fadeOutMs: 500 })
  })

  it('places unmuted clip audio at its scene offset', () => {
    const clip = join(assets, 'clip.wav')
    const plan = planAudioMix({
      storyboard: board(),
      taskDir: root,
      totalMs: 2000,
      clipAudios: [{ path: clip, startMs: 1000 }],
    })
    expect(plan.inputs).toHaveLength(1)
    expect(plan.inputs[0]).toMatchObject({ label: 'clip:0', delayMs: 1000, loop: false })
  })

  it('fails closed when a declared track file is missing', () => {
    try {
      planAudioMix({
        storyboard: board([{ src: 'voice/missing.wav', kind: 'narration' }]),
        taskDir: root,
        totalMs: 2000,
      })
      throw new Error('expected a MediaError')
    } catch (error) {
      expect(error).toBeInstanceOf(MediaError)
      expect((error as MediaError).code).toBe('MEDIA_ASSET_REF_INVALID')
    }
  })
})

describe.skipIf(!binsReady)('mixStoryboardAudio (FFmpeg required)', () => {
  it('mixes narration + looped BGM into one stereo bed spanning the film', () => {
    writeTone('voice-vo.wav', 440, 1.2)
    writeTone('music-bed.wav', 220, 0.6)
    const outPath = join(root, 'mix.wav')
    const result = mixStoryboardAudio({
      ffmpeg: ffmpeg as string,
      storyboard: board([
        { src: 'voice-vo.wav', kind: 'narration', volume: 1, fadeInMs: 100 },
        { src: 'music-bed.wav', kind: 'bgm', volume: 0.3, loop: true, fadeOutMs: 500 },
      ]),
      taskDir: root,
      totalMs: 2000,
      outPath,
    })
    expect(result.plan.inputs).toHaveLength(2)
    const probe = probeVideo(ffprobe as string, outPath)
    expect(probe.audioCodec).toBe('pcm_s16le')
    expect(Math.abs((probe.durationSec ?? 0) - 2)).toBeLessThanOrEqual(0.15)
  }, 60000)

  it('renders silence when no audio is declared', () => {
    const outPath = join(root, 'silence.wav')
    const result = mixStoryboardAudio({
      ffmpeg: ffmpeg as string,
      storyboard: board(),
      taskDir: root,
      totalMs: 1000,
      outPath,
    })
    expect(result.plan.hasAudio).toBe(false)
    const probe = probeVideo(ffprobe as string, outPath)
    expect(probe.audioCodec).toBe('pcm_s16le')
    expect(Math.abs((probe.durationSec ?? 0) - 1)).toBeLessThanOrEqual(0.15)
  }, 60000)

  it('keeps the legacy 440 Hz placeholder available for the pure-image path', () => {
    const outPath = join(root, 'legacy.wav')
    const result = synthesizeAudio({ ffmpeg: ffmpeg as string, durationSec: 1, outPath })
    expect(result.code).toBe(0)
    expect(probeVideo(ffprobe as string, outPath).audioCodec).toBe('pcm_s16le')
  }, 60000)
})

it.skipIf(binsReady)('skips audio mixing tests because FFmpeg/ffprobe are not installed', () => {
  expect(binsReady).toBe(false)
})
