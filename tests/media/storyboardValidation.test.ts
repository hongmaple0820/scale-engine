// Scene DSL v0.1 validator — the security boundary: unknown fields, dynamic
// values, and escaping paths must all be rejected (v3 plan §6).

import { describe, expect, it } from 'vitest'
import { validateStoryboard, storyboardTotalMs, storyboardAssetRefs } from '../../src/media/validation/validateStoryboard.js'
import type { Storyboard } from '../../src/media/types.js'

const valid: Storyboard = {
  schemaVersion: '0.1',
  canvas: { width: 960, height: 540, fps: 24, background: '#0f172a' },
  scenes: [
    {
      id: 'intro',
      durationMs: 1000,
      elements: [
        { type: 'text', content: '标题', fontFamily: 'Microsoft YaHei', fontSize: 48, color: '#f8fafc', x: 'center', y: 240, animation: { type: 'fadeInUp', durationMs: 600 } },
      ],
      transitionOut: { type: 'fade', durationMs: 200 },
    },
    {
      id: 'outro',
      durationMs: 1000,
      elements: [
        { type: 'rect', x: 180, y: 250, width: 600, height: 10, color: '#334155', radius: 5 },
        { type: 'rect', x: 180, y: 250, width: 600, height: 10, color: '#38bdf8aa', radius: 5, animation: { type: 'progressBar', durationMs: 900 } },
      ],
    },
  ],
}

describe('validateStoryboard', () => {
  it('accepts the canonical sample and sums durations', () => {
    const result = validateStoryboard(valid)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    expect(storyboardTotalMs(valid)).toBe(2000)
  })

  it('rejects unknown fields anywhere', () => {
    const sneaky = structuredClone(valid) as unknown as Record<string, unknown>
    sneaky.evildoer = 'x'
    const result = validateStoryboard(sneaky)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('unknown field "evildoer"'))).toBe(true)
  })

  it('rejects unknown element and animation types', () => {
    const bad = structuredClone(valid)
    ;(bad.scenes[0].elements[0] as unknown as Record<string, unknown>).type = 'iframe'
    ;(bad.scenes[1].elements[1].animation as unknown as Record<string, unknown>).type = 'runScript'
    const result = validateStoryboard(bad)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('element type'))).toBe(true)
    expect(result.errors.some(e => e.includes('animation type'))).toBe(true)
  })

  it('enforces fps whitelist and canvas caps', () => {
    const bad = structuredClone(valid)
    bad.canvas.fps = 90
    bad.canvas.width = 7680
    const result = validateStoryboard(bad)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('fps must be one of'))).toBe(true)
    expect(result.errors.some(e => e.includes('width'))).toBe(true)
  })

  it('enforces the total duration cap (120s)', () => {
    const bad = structuredClone(valid)
    for (const scene of bad.scenes) scene.durationMs = 60000
    bad.scenes.push({ id: 'extra', durationMs: 5000, elements: [{ type: 'rect', x: 0, y: 0, width: 10, height: 10, color: '#111111' }] })
    const result = validateStoryboard(bad)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('total duration'))).toBe(true)
  })

  it('rejects non-whitelisted fonts and malformed colors', () => {
    const bad = structuredClone(valid)
    ;(bad.scenes[0].elements[0] as { fontFamily: string }).fontFamily = 'Comic Sans MS'
    ;(bad.scenes[0].elements[0] as { color: string }).color = 'red'
    const result = validateStoryboard(bad)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('fontFamily'))).toBe(true)
    expect(result.errors.some(e => e.includes('color'))).toBe(true)
  })

  it('rejects text longer than the cap', () => {
    const bad = structuredClone(valid)
    ;(bad.scenes[0].elements[0] as { content: string }).content = '长'.repeat(201)
    const result = validateStoryboard(bad)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('200 chars'))).toBe(true)
  })

  it('rejects image refs that escape the task assets directory', () => {
    const bad = structuredClone(valid)
    bad.scenes[1].elements = [
      { type: 'image', src: '../../secrets/keys.png', width: 100, height: 100, x: 0, y: 0 },
    ]
    const result = validateStoryboard(bad)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('inside the task assets directory'))).toBe(true)
  })

  it('rejects image refs with unapproved extensions or absolute paths', () => {
    const bad = structuredClone(valid)
    bad.scenes[1].elements = [
      { type: 'image', src: 'assets/movie.gif', width: 100, height: 100, x: 0, y: 0 },
      { type: 'image', src: 'C:/windows/evil.png', width: 100, height: 100, x: 10, y: 0 },
    ]
    const result = validateStoryboard(bad)
    expect(result.ok).toBe(false)
    expect(result.errors.filter(e => e.includes('extension')).length).toBe(1)
    expect(result.errors.filter(e => e.includes('inside the task assets')).length).toBe(1)
  })

  it('accepts asset:// refs only from schemaVersion 0.3', () => {
    const board = structuredClone(valid) as Storyboard
    board.schemaVersion = '0.3'
    board.scenes[1].elements = [
      { type: 'image', src: 'asset://job-2026-10-29-1a2b3c4d/assets/generated/hero.png', x: 0, y: 0, width: 100, height: 100 },
    ]
    expect(validateStoryboard(board).ok).toBe(true)

    const old = structuredClone(board)
    old.schemaVersion = '0.2'
    const result = validateStoryboard(old)
    expect(result.ok).toBe(false)
    expect(result.errors.some(error => error.includes('require schemaVersion 0.3'))).toBe(true)
  })

  it('rejects malformed asset refs (traversal, absolute, drive, extension)', () => {
    const badRefs = [
      'asset://job-1/assets/../x.png',
      'asset://job-1/assets/a/../../x.png',
      'asset://job-1/assets//etc/x.png',
      'asset://job-1/assets/C:/x.png',
      'asset://job-1/assets/a\\b.png',
      'asset://job-1/assets/a%2Fb.png',
      'asset://job-1/other/x.png',
      'asset://job-1/assets/generated/x.gif',
    ]
    for (const src of badRefs) {
      const board = structuredClone(valid) as Storyboard
      board.schemaVersion = '0.3'
      board.scenes[1].elements = [{ type: 'image', src, x: 0, y: 0, width: 100, height: 100 }]
      const result = validateStoryboard(board)
      expect(result.ok, src).toBe(false)
    }
  })

  it('rejects duplicate scene ids and animations exceeding scene duration', () => {
    const bad = structuredClone(valid)
    bad.scenes[1].id = 'intro'
    ;(bad.scenes[0].elements[0].animation as { durationMs: number }).durationMs = 5000
    const result = validateStoryboard(bad)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('duplicate scene id'))).toBe(true)
    expect(result.errors.some(e => e.includes('animation durationMs'))).toBe(true)
  })

  it('rejects subtitle cues with inverted times', () => {
    const bad = structuredClone(valid)
    bad.subtitles = [{ startMs: 500, endMs: 500, text: 'x' }]
    const result = validateStoryboard(bad)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('startMs < endMs'))).toBe(true)
  })
})

const valid04: Storyboard = {
  schemaVersion: '0.4',
  canvas: { width: 960, height: 540, fps: 24, background: '#0f172a' },
  scenes: [
    {
      id: 'clip',
      durationMs: 2000,
      narrationText: '第一句。第二句！',
      elements: [
        { type: 'video', src: 'generated/clip.mp4', fit: 'cover', trimStartMs: 0, trimEndMs: 4000, muted: true },
        { type: 'text', content: '标题', fontFamily: 'Microsoft YaHei', fontSize: 40, color: '#ffffff', x: 'center', y: 240 },
      ],
    },
    {
      id: 'still',
      durationMs: 2000,
      narrationText: '收尾。',
      elements: [{ type: 'image', src: 'generated/hero.png', x: 0, y: 0, width: 960, height: 540 }],
    },
  ],
  audioTracks: [
    { src: 'voice/voiceover.mp3', kind: 'narration', volume: 1, fadeInMs: 200 },
    { src: 'music/bgm.mp3', kind: 'bgm', volume: 0.3, loop: true, fadeOutMs: 1000 },
  ],
  subtitleOptions: { mode: 'both', source: 'auto' },
}

describe('validateStoryboard — DSL 0.4 (video/audio/subtitles)', () => {
  it('accepts the canonical 0.4 sample', () => {
    const result = validateStoryboard(valid04)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('rejects 0.4-only constructs below 0.4', () => {
    for (const version of ['0.1', '0.2', '0.3']) {
      const board = structuredClone(valid04)
      board.schemaVersion = version
      const result = validateStoryboard(board)
      expect(result.ok, version).toBe(false)
      expect(result.errors.some(e => e.includes('video elements require schemaVersion 0.4'))).toBe(true)
      expect(result.errors.some(e => e.includes('audioTracks require schemaVersion 0.4'))).toBe(true)
      expect(result.errors.some(e => e.includes('subtitleOptions require schemaVersion 0.4'))).toBe(true)
      expect(result.errors.some(e => e.includes('narrationText requires schemaVersion 0.4'))).toBe(true)
    }
  })

  it('rejects invalid trim windows', () => {
    const inverted = structuredClone(valid04)
    ;(inverted.scenes[0].elements[0] as { trimStartMs?: number }).trimStartMs = 5000
    expect(validateStoryboard(inverted).errors.some(e => e.includes('trimStartMs must be < trimEndMs'))).toBe(true)

    const tooLong = structuredClone(valid04)
    ;(tooLong.scenes[0].elements[0] as { trimEndMs?: number }).trimEndMs = 600001
    expect(validateStoryboard(tooLong).errors.some(e => e.includes('clip bound'))).toBe(true)
  })

  it('rejects more than one video per scene and unknown element fields', () => {
    const twoVideos = structuredClone(valid04)
    twoVideos.scenes[0].elements.push({ type: 'video', src: 'generated/clip2.mp4' })
    expect(validateStoryboard(twoVideos).errors.some(e => e.includes('at most 1 video element'))).toBe(true)

    const sneaky = structuredClone(valid04)
    ;(sneaky.scenes[0].elements[0] as unknown as Record<string, unknown>).x = 0
    expect(validateStoryboard(sneaky).errors.some(e => e.includes('unknown field "x"'))).toBe(true)
  })

  it('enforces audio track rules (count, kind, volume, duplicates)', () => {
    const dup = structuredClone(valid04)
    dup.audioTracks = [
      { src: 'a.mp3', kind: 'narration' },
      { src: 'b.mp3', kind: 'narration' },
      { src: 'c.mp3', kind: 'bgm' },
    ]
    const dupResult = validateStoryboard(dup)
    expect(dupResult.errors.some(e => e.includes('more than 2 audio tracks'))).toBe(true)
    expect(dupResult.errors.some(e => e.includes('duplicate "narration" track'))).toBe(true)

    const badKind = structuredClone(valid04)
    ;(badKind.audioTracks as unknown as Array<Record<string, unknown>>)[0].kind = 'sfx'
    expect(validateStoryboard(badKind).errors.some(e => e.includes('kind must be narration | bgm'))).toBe(true)

    const badVolume = structuredClone(valid04)
    ;(badVolume.audioTracks as unknown as Array<Record<string, unknown>>)[0].volume = 1.5
    expect(validateStoryboard(badVolume).errors.some(e => e.includes('volume must be within [0, 1]'))).toBe(true)

    const badExt = structuredClone(valid04)
    ;(badExt.audioTracks as unknown as Array<Record<string, unknown>>)[0].src = 'voice/voiceover.ogg'
    expect(validateStoryboard(badExt).errors.some(e => e.includes('extension must be one of'))).toBe(true)
  })

  it('enforces auto-subtitle narration text and subtitle source rules', () => {
    const missing = structuredClone(valid04)
    delete missing.scenes[1].narrationText
    expect(validateStoryboard(missing).errors.some(e => e.includes('narrationText is required'))).toBe(true)

    const missingButNoNarration = structuredClone(valid04)
    missingButNoNarration.audioTracks = [{ src: 'music/bgm.mp3', kind: 'bgm' }]
    delete missingButNoNarration.scenes[1].narrationText
    expect(validateStoryboard(missingButNoNarration).ok).toBe(true)

    const fileNoSrc = structuredClone(valid04)
    fileNoSrc.subtitleOptions = { mode: 'srt', source: 'file' }
    expect(validateStoryboard(fileNoSrc).errors.some(e => e.includes('src is required'))).toBe(true)

    const autoWithSrc = structuredClone(valid04)
    autoWithSrc.subtitleOptions = { mode: 'burn', source: 'auto', src: 'subs/a.srt' }
    expect(validateStoryboard(autoWithSrc).errors.some(e => e.includes('src is only valid'))).toBe(true)

    const refSrc = structuredClone(valid04)
    refSrc.subtitleOptions = { mode: 'srt', source: 'file', src: 'asset://job-1/assets/a.srt' }
    expect(validateStoryboard(refSrc).errors.some(e => e.includes('asset:// is not supported for subtitles'))).toBe(true)

    const badMode = structuredClone(valid04)
    ;(badMode.subtitleOptions as unknown as Record<string, unknown>).mode = 'karaoke'
    expect(validateStoryboard(badMode).errors.some(e => e.includes('mode must be one of'))).toBe(true)
  })

  it('collects video and audio refs for existence/materialization checks', () => {
    const board = structuredClone(valid04)
    board.scenes[0].elements[0] = { type: 'video', src: 'asset://job-7/assets/generated/clip.mp4' }
    board.audioTracks = [{ src: 'asset://job-8/assets/voice/vo.mp3', kind: 'narration' }]
    board.scenes.forEach(scene => { scene.narrationText = '文本。' })
    expect(validateStoryboard(board).ok).toBe(true)
    expect(storyboardAssetRefs(board)).toEqual([
      'asset://job-7/assets/generated/clip.mp4',
      'generated/hero.png',
      'asset://job-8/assets/voice/vo.mp3',
    ])
  })
})
