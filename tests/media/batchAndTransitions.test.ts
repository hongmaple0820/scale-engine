// P5 batch storyboard expansion (批量分镜) + DSL v0.2 advanced transitions.

import { describe, expect, it } from 'vitest'
import { expandStoryboardTemplate } from '../../src/media/storyboard/batch.js'
import { validateStoryboard, storyboardTotalMs } from '../../src/media/validation/validateStoryboard.js'
import type { Storyboard } from '../../src/media/types.js'

const template: Storyboard = {
  schemaVersion: '0.2',
  title: '第 {{n}} 课',
  canvas: { width: 960, height: 540, fps: 30, background: '#0f172a' },
  scenes: [
    {
      id: 'lesson-{{nn}}',
      durationMs: 1000,
      elements: [
        { type: 'text', content: '第 {{n}} 讲：知识点 {{nn}}', fontFamily: 'Microsoft YaHei', fontSize: 48, color: '#f8fafc', x: 'center', y: 240, animation: { type: 'fadeInUp', durationMs: 500 } },
      ],
      transitionOut: { type: 'slide', direction: 'left', durationMs: 300 },
    },
  ],
  subtitles: [{ startMs: 100, endMs: 900, text: '第 {{n}} 讲字幕' }],
}

describe('expandStoryboardTemplate (批量分镜)', () => {
  it('stamps N copies with {{n}}/{{nn}} substitution', () => {
    const expanded = expandStoryboardTemplate(template, 3)
    expect(expanded.scenes).toHaveLength(3)
    // {{nn}} pads to the width of the largest index (3 → width 1)
    expect(expanded.scenes.map(scene => scene.id)).toEqual(['lesson-1', 'lesson-2', 'lesson-3'])
    const firstText = expanded.scenes[0].elements[0] as { content: string }
    expect(firstText.content).toBe('第 1 讲：知识点 1')
    const thirdText = expanded.scenes[2].elements[0] as { content: string }
    expect(thirdText.content).toBe('第 3 讲：知识点 3')
    expect(expanded.title).toBe('第 1 课')
    expect(expanded.subtitles).toHaveLength(3)
    // subtitle cycles shift by the template cycle (1000ms)
    expect(expanded.subtitles?.[1]?.startMs).toBe(1100)
  })

  it('honours the start option and padding width', () => {
    const expanded = expandStoryboardTemplate(template, 2, { start: 98 })
    expect(expanded.scenes.map(scene => scene.id)).toEqual(['lesson-98', 'lesson-99'])
  })

  it('pads {{nn}} across a decade boundary', () => {
    const expanded = expandStoryboardTemplate(template, 11)
    expect(expanded.scenes.map(scene => scene.id)).toEqual(['lesson-01', 'lesson-02', 'lesson-03', 'lesson-04', 'lesson-05', 'lesson-06', 'lesson-07', 'lesson-08', 'lesson-09', 'lesson-10', 'lesson-11'])
  })

  it('output passes the v0.2 validator (slide transition included)', () => {
    const expanded = expandStoryboardTemplate(template, 2)
    const result = validateStoryboard(expanded)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    expect(storyboardTotalMs(expanded)).toBe(2000)
  })

  it('rejects out-of-range counts', () => {
    expect(() => expandStoryboardTemplate(template, 0)).toThrow()
    expect(() => expandStoryboardTemplate(template, 201)).toThrow()
  })

  it('does not mutate the template', () => {
    const snapshot = JSON.stringify(template)
    expandStoryboardTemplate(template, 2)
    expect(JSON.stringify(template)).toBe(snapshot)
  })
})

describe('DSL v0.2 advanced transitions', () => {
  it('accepts slide and wipe with directions on 0.2', () => {
    const storyboard: Storyboard = {
      schemaVersion: '0.2',
      canvas: { width: 640, height: 360, fps: 30, background: '#111111' },
      scenes: [
        { id: 'a', durationMs: 800, elements: [{ type: 'rect', x: 0, y: 0, width: 40, height: 40, color: '#2563eb' }], transitionOut: { type: 'slide', direction: 'left', durationMs: 250 } },
        { id: 'b', durationMs: 800, elements: [{ type: 'rect', x: 0, y: 0, width: 40, height: 40, color: '#16a34a' }], transitionOut: { type: 'wipe', direction: 'up', durationMs: 250 } },
      ],
    }
    expect(validateStoryboard(storyboard).ok).toBe(true)
  })

  it('keeps v0.1 storyboards valid but rejects new transition types there', () => {
    const legacy: Storyboard = {
      schemaVersion: '0.1',
      canvas: { width: 640, height: 360, fps: 30, background: '#111111' },
      scenes: [
        { id: 'a', durationMs: 800, elements: [{ type: 'rect', x: 0, y: 0, width: 40, height: 40, color: '#2563eb' }], transitionOut: { type: 'fade', durationMs: 250 } },
      ],
    }
    expect(validateStoryboard(legacy).ok).toBe(true)

    const upgraded = structuredClone(legacy)
    upgraded.scenes[0].transitionOut = { type: 'slide', direction: 'left', durationMs: 250 }
    const result = validateStoryboard(upgraded)
    expect(result.ok).toBe(false)
    expect(result.errors.some(error => error.includes('requires schemaVersion 0.2'))).toBe(true)
  })

  it('requires direction for slide/wipe and rejects direction on fade', () => {
    const base: Storyboard = {
      schemaVersion: '0.2',
      canvas: { width: 640, height: 360, fps: 30, background: '#111111' },
      scenes: [{ id: 'a', durationMs: 800, elements: [{ type: 'rect', x: 0, y: 0, width: 40, height: 40, color: '#2563eb' }] }],
    }
    const noDirection = structuredClone(base)
    noDirection.scenes[0].transitionOut = { type: 'slide', durationMs: 200 }
    expect(validateStoryboard(noDirection).errors.some(e => e.includes('direction'))).toBe(true)

    const fadeWithDirection = structuredClone(base)
    fadeWithDirection.scenes[0].transitionOut = { type: 'fade', direction: 'left', durationMs: 200 }
    expect(validateStoryboard(fadeWithDirection).errors.some(e => e.includes('direction is only valid'))).toBe(true)

    const unknownType = structuredClone(base)
    unknownType.scenes[0].transitionOut = { type: 'spin' as unknown as 'fade', durationMs: 200 }
    expect(validateStoryboard(unknownType).errors.some(e => e.includes('fade | slide | wipe'))).toBe(true)
  })
})
