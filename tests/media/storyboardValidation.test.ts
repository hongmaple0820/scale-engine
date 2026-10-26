// Scene DSL v0.1 validator — the security boundary: unknown fields, dynamic
// values, and escaping paths must all be rejected (v3 plan §6).

import { describe, expect, it } from 'vitest'
import { validateStoryboard, storyboardTotalMs } from '../../src/media/validation/validateStoryboard.js'
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
