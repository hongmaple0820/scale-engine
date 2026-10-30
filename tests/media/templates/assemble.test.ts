// Template wizard (M3): plan is a pure preview, assemble is strict, and every
// produced board passes the DSL validator.

import { describe, expect, it } from 'vitest'
import {
  assembleTemplate,
  listTemplates,
  narrationDurationMs,
  planTemplate,
} from '../../../src/media/templates/assemble.js'
import { validateStoryboard } from '../../../src/media/validation/validateStoryboard.js'
import { MediaError } from '../../../src/media/errors.js'

const image = (name: string): string => `generated/${name}.png`
const video = (name: string): string => `generated/${name}.mp4`
const audio = (name: string): string => `voice/${name}.mp3`

describe('template catalog', () => {
  it('ships the three M3 templates with their aspect ratios', () => {
    const ids = listTemplates().map(template => template.id)
    expect(ids).toEqual(['talking-head', 'product-showcase', 'fast-cuts'])
    expect(listTemplates().map(template => template.aspectRatio)).toEqual(['9:16', '16:9', '1:1'])
  })

  it('rejects an unknown template id', () => {
    expect(() => assembleTemplate('no-such-template')).toThrow(MediaError)
    try {
      planTemplate('no-such-template')
    } catch (error) {
      expect((error as MediaError).code).toBe('MEDIA_ACTION_UNKNOWN')
    }
  })
})

describe('planTemplate', () => {
  it('returns a valid draft with placeholders and an estimate when slots are empty', () => {
    const plan = planTemplate('talking-head')
    expect(plan.draft.schemaVersion).toBe('0.4')
    expect(validateStoryboard(plan.draft).ok).toBe(true)
    expect(plan.slots.find(slot => slot.key === 'media')?.missing).toBe(true)
    expect(plan.slots.find(slot => slot.key === 'narration')?.missing).toBe(true)
    expect(plan.warnings.length).toBeGreaterThanOrEqual(2)
    expect(plan.estimate.pricingKey).toBeTruthy()
    expect(plan.estimate.quantity ?? 0).toBeGreaterThan(0)
  })

  it('marks filled slots as present and uses the supplied values', () => {
    const plan = planTemplate('talking-head', {
      media: image('hero'),
      narration: '你好，世界。',
      title: '测试标题',
    })
    expect(plan.slots.every(slot => !slot.missing)).toBe(true)
    const scene = plan.draft.scenes[0]
    expect(scene.narrationText).toBe('你好，世界。')
    expect(scene.durationMs).toBe(narrationDurationMs('你好，世界。'))
    expect(scene.elements.some(element => element.type === 'image')).toBe(true)
    expect(plan.estimate.quantity ?? 0).toBeCloseTo(scene.durationMs / 60000, 2)
  })

  it('pads an under-filled multiple slot with placeholders', () => {
    const plan = planTemplate('product-showcase', { media: [image('a'), image('b')] })
    const slot = plan.slots.find(entry => entry.key === 'media')
    expect(slot?.values).toHaveLength(3)
    expect(slot?.missing).toBe(true)
    expect(plan.draft.scenes).toHaveLength(3)
  })

  it('is pure: repeated calls do not share mutable state', () => {
    const first = planTemplate('fast-cuts', { images: [image('1'), image('2'), image('3'), image('4')] })
    const second = planTemplate('fast-cuts', { images: [image('1'), image('2'), image('3'), image('4')] })
    expect(first.draft).not.toBe(second.draft)
    expect(JSON.stringify(first.draft)).toBe(JSON.stringify(second.draft))
  })
})

describe('assembleTemplate — talking-head', () => {
  it('builds a 9:16 board with narration, audio and auto subtitles', () => {
    const board = assembleTemplate('talking-head', {
      media: video('host'),
      narration: '第一句。第二句！',
      title: '口播',
      voiceover: audio('line'),
    })
    expect(board.canvas).toMatchObject({ width: 1080, height: 1920, fps: 30 })
    expect(board.scenes).toHaveLength(1)
    expect(board.scenes[0].elements[0]).toMatchObject({ type: 'video', src: video('host'), loop: true })
    expect(board.audioTracks).toEqual([{ src: audio('line'), kind: 'narration', volume: 1 }])
    expect(board.subtitleOptions).toEqual({ mode: 'both', source: 'auto' })
    expect(validateStoryboard(board).ok).toBe(true)
  })

  it('accepts an image background and rejects missing required slots', () => {
    const board = assembleTemplate('talking-head', { media: image('host'), narration: '文本。' })
    expect(board.scenes[0].elements[0]).toMatchObject({ type: 'image', src: image('host') })
    expect(() => assembleTemplate('talking-head', { narration: '文本。' })).toThrow(/slot "media" requires/)
    expect(() => assembleTemplate('talking-head', { media: image('host') })).toThrow(/slot "narration" requires/)
  })

  it('rejects a non-audio voiceover and a non-media background', () => {
    expect(() => assembleTemplate('talking-head', { media: image('host'), narration: '文本。', voiceover: 'voice/notes.txt' }))
      .toThrow(/expects an audio file/)
    expect(() => assembleTemplate('talking-head', { media: 'slides/deck.pdf', narration: '文本。' }))
      .toThrow(/expects an image or video/)
  })
})

describe('assembleTemplate — product-showcase', () => {
  it('builds one scene per media item with BGM and a first-scene headline', () => {
    const board = assembleTemplate('product-showcase', {
      media: [image('one'), video('two'), image('three')],
      headline: '新品发布',
      bgm: audio('bed'),
    })
    expect(board.canvas).toMatchObject({ width: 1920, height: 1080, fps: 30 })
    expect(board.scenes).toHaveLength(3)
    expect(board.scenes[0].elements.some(element => element.type === 'text' && element.content === '新品发布')).toBe(true)
    expect(board.scenes[1].elements.some(element => element.type === 'text')).toBe(false)
    expect(board.scenes[1].elements[0]).toMatchObject({ type: 'video', loop: true })
    expect(board.audioTracks?.[0]).toMatchObject({ kind: 'bgm', loop: true, volume: 0.35 })
    expect(board.subtitleOptions).toEqual({ mode: 'none' })
    expect(validateStoryboard(board).ok).toBe(true)
  })

  it('enforces the 3–6 media range', () => {
    expect(() => assembleTemplate('product-showcase', { media: [image('a'), image('b')] }))
      .toThrow(/requires at least 3/)
    expect(() => assembleTemplate('product-showcase', {
      media: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(index => image(index)),
    })).toThrow(/accepts at most 6/)
  })
})

describe('assembleTemplate — fast-cuts', () => {
  const images = ['1', '2', '3', '4'].map(index => image(index))

  it('builds a square board with per-image captions and narration audio', () => {
    const board = assembleTemplate('fast-cuts', {
      images,
      captions: ['第一张。', '第二张。', '第三张。', '第四张。'],
      voiceover: audio('cuts'),
    })
    expect(board.canvas).toMatchObject({ width: 1080, height: 1080, fps: 30 })
    expect(board.scenes).toHaveLength(4)
    expect(board.scenes[3].narrationText).toBe('第四张。')
    expect(board.audioTracks?.[0]).toMatchObject({ kind: 'narration' })
    expect(board.subtitleOptions).toEqual({ mode: 'both', source: 'auto' })
    expect(validateStoryboard(board).ok).toBe(true)
  })

  it('requires one caption per image when a voiceover track is present', () => {
    expect(() => assembleTemplate('fast-cuts', {
      images,
      captions: ['第一张。', '第二张。'],
      voiceover: audio('cuts'),
    })).toThrow(/one caption per image/)
  })

  it('rejects more captions than images and video in the image slot', () => {
    expect(() => assembleTemplate('fast-cuts', {
      images,
      captions: ['1。', '2。', '3。', '4。', '5。'],
    })).toThrow(/only 4 images/)
    expect(() => assembleTemplate('fast-cuts', {
      images: [...images.slice(0, 3), video('clip')],
    })).toThrow(/expects an image file/)
  })

  it('keeps total duration within the DSL budget when captions are long', () => {
    const long = '长'.repeat(200)
    const board = assembleTemplate('fast-cuts', { images, captions: [long, long, long, long] })
    const total = board.scenes.reduce((sum, scene) => sum + scene.durationMs, 0)
    expect(total).toBeLessThanOrEqual(120000)
    expect(validateStoryboard(board).ok).toBe(true)
  })
})
