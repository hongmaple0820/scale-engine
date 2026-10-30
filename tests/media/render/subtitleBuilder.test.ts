// Auto subtitles (M3): sentence count, monotonic non-overlapping timeline,
// short-cue merging, and immutability of the input storyboard.

import { describe, expect, it } from 'vitest'
import {
  buildAutoCues,
  splitNarrationSentences,
  withAutoSubtitles,
} from '../../../src/media/render/SubtitleBuilder.js'
import type { Storyboard } from '../../../src/media/types.js'

function board(durations: number[], narration?: string[]): Storyboard {
  return {
    schemaVersion: '0.4',
    canvas: { width: 320, height: 180, fps: 24, background: '#000000' },
    scenes: durations.map((durationMs, index) => ({
      id: `scene-${index}`,
      durationMs,
      elements: [{ type: 'rect', x: 0, y: 0, width: 10, height: 10, color: '#ffffff' }],
      ...(narration?.[index] !== undefined ? { narrationText: narration[index] } : {}),
    })),
  }
}

describe('splitNarrationSentences', () => {
  it('splits on Chinese and ASCII sentence punctuation and newlines', () => {
    expect(splitNarrationSentences('第一句。第二句！第三句？')).toEqual(['第一句', '第二句', '第三句'])
    expect(splitNarrationSentences('Hello! Are you there?')).toEqual(['Hello', 'Are you there'])
    expect(splitNarrationSentences('第一行\n第二行；第三行')).toEqual(['第一行', '第二行', '第三行'])
    expect(splitNarrationSentences('   ')).toEqual([])
  })

  it('chunks an over-long sentence instead of emitting a 200+ char cue', () => {
    const long = '长'.repeat(450)
    const parts = splitNarrationSentences(long)
    expect(parts.length).toBe(3)
    expect(parts.every(part => part.length <= 200)).toBe(true)
  })
})

describe('buildAutoCues', () => {
  it('emits one cue per sentence, proportional and monotonic across scenes', () => {
    const cues = buildAutoCues(board([2000, 2000], ['甲。乙！', '丙？']))
    expect(cues).toHaveLength(3)
    expect(cues.map(cue => cue.text)).toEqual(['甲', '乙', '丙'])
    expect(cues[0].startMs).toBe(0)
    expect(cues[0].endMs).toBe(1000)
    expect(cues[1].startMs).toBe(1000)
    expect(cues[1].endMs).toBe(2000)
    expect(cues[2].startMs).toBe(2000)
    expect(cues[2].endMs).toBe(4000)
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].startMs).toBeGreaterThanOrEqual(cues[i - 1].endMs)
    }
  })

  it('merges cues shorter than the minimum into the previous cue', () => {
    const cues = buildAutoCues(board([300], ['甲。乙。丙。']))
    expect(cues).toHaveLength(1)
    expect(cues[0].text).toContain('甲')
    expect(cues[0].text).toContain('丙')
    expect(cues[0].endMs).toBe(300)
  })

  it('ignores scenes without narration text', () => {
    const cues = buildAutoCues(board([1000, 1000, 1000], [undefined, '只有这句。', undefined]))
    expect(cues).toHaveLength(1)
    expect(cues[0].startMs).toBe(1000)
    expect(cues[0].endMs).toBe(2000)
  })

  it('fails closed when the cue limit is exceeded', () => {
    expect(() => buildAutoCues(board([3000], ['甲。乙。丙。丁。']), { maxCues: 3 })).toThrow(/over the 3 limit/)
  })
})

describe('withAutoSubtitles', () => {
  it('returns a new board and never mutates the input', () => {
    const input = board([1000], ['一句。'])
    const output = withAutoSubtitles(input)
    expect(input.subtitles).toBeUndefined()
    expect(output.subtitles).toHaveLength(1)
    expect(output).not.toBe(input)
  })

  it('leaves subtitles undefined when no scene carries narration', () => {
    const output = withAutoSubtitles(board([1000]))
    expect(output.subtitles).toBeUndefined()
  })
})
