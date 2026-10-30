// Batch storyboard expansion (v3 plan §17 P5 "批量分镜"): take a template
// storyboard and stamp out N copies of its scenes, substituting {{n}} (1-based
// batch index) and {{nn}} (zero-padded to the width of `count`) inside text
// content, scene ids, image srcs, and subtitle text. Pure function — the
// result goes through the normal validator before any render. Subtitle times
// shift by each copy's cycle duration so cues stay attached to their scenes.

import type { Storyboard } from '../types.js'
import { MediaError } from '../errors.js'

export interface BatchOptions {
  /** 1-based starting index (default 1) */
  start?: number
}

function substitute(value: string, index: number, padded: string): string {
  return value.split('{{n}}').join(String(index)).split('{{nn}}').join(padded)
}

export function expandStoryboardTemplate(template: Storyboard, count: number, options: BatchOptions = {}): Storyboard {
  if (!Number.isInteger(count) || count < 1 || count > 200) {
    throw new MediaError('MEDIA_STORYBOARD_INVALID', 'batch count must be an integer within [1, 200]')
  }
  const start = options.start ?? 1
  const padWidth = String(start + count - 1).length
  const cycleMs = template.scenes.reduce((sum, scene) => sum + scene.durationMs, 0)

  const scenes: Storyboard['scenes'] = []
  const subtitles: NonNullable<Storyboard['subtitles']> = []
  for (let copy = 0; copy < count; copy++) {
    const index = start + copy
    const padded = String(index).padStart(padWidth, '0')
    const stamped = JSON.parse(JSON.stringify(template.scenes)) as Storyboard['scenes']
    for (const scene of stamped) {
      scene.id = substitute(scene.id, index, padded)
      if (scene.narrationText) scene.narrationText = substitute(scene.narrationText, index, padded)
      for (const element of scene.elements) {
        if (element.type === 'text') element.content = substitute(element.content, index, padded)
        if (element.type === 'image' || element.type === 'video') element.src = substitute(element.src, index, padded)
      }
    }
    scenes.push(...stamped)
    for (const cue of template.subtitles ?? []) {
      subtitles.push({
        startMs: cue.startMs + copy * cycleMs,
        endMs: cue.endMs + copy * cycleMs,
        text: substitute(cue.text, index, padded),
      })
    }
  }

  return {
    ...structuredClone(template),
    title: template.title ? substitute(template.title, start, String(start).padStart(padWidth, '0')) : undefined,
    scenes,
    subtitles: subtitles.length > 0 ? subtitles : undefined,
  }
}
