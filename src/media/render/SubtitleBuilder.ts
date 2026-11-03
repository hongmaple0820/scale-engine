// Automatic subtitle cues (DSL 0.4 `subtitleOptions.source='auto'`).
//
// The only text source is `scene.narrationText`. Cues are allocated strictly
// sequentially inside each scene, proportional to sentence length, so the
// timeline is monotonic and non-overlapping by construction. Alignment is
// scene-level only: v1 does not attempt phoneme/word alignment with TTS audio
// (documented limitation, plan §5.4).

import { MediaError } from '../errors.js'
import type { Storyboard, SubtitleCue } from '../types.js'

export interface AutoSubtitleOptions {
  /** hard cap from the validator; overflow is an error rather than silent truncation */
  maxCues?: number
  /** a cue shorter than this is merged into the neighbour (avoids 1-char flashes) */
  minCueMs?: number
}

const SENTENCE_BOUNDARY = /[。！？!?；;]+|\n+/
const MAX_SENTENCE_CHARS = 200
const DEFAULT_MAX_CUES = 50
const DEFAULT_MIN_CUE_MS = 200

/** Split narration text into sentences (Chinese/ASCII punctuation, newlines). */
export function splitNarrationSentences(text: string): string[] {
  return text
    .split(SENTENCE_BOUNDARY)
    .map(part => part.trim())
    .filter(part => part.length > 0)
    // a single over-long "sentence" is chunked so a cue never exceeds the
    // validator's per-cue text limit; normal prose is unaffected
    .flatMap(part => {
      if (part.length <= MAX_SENTENCE_CHARS) return [part]
      const chunks: string[] = []
      for (let i = 0; i < part.length; i += MAX_SENTENCE_CHARS) chunks.push(part.slice(i, i + MAX_SENTENCE_CHARS))
      return chunks
    })
}

function allocateCueEnds(lengths: number[], sceneStart: number, sceneDuration: number): number[] {
  const total = lengths.reduce((sum, n) => sum + n, 0)
  const ends: number[] = []
  let cursor = sceneStart
  let consumedWeight = 0
  lengths.forEach((length, index) => {
    consumedWeight += length
    const isLast = index === lengths.length - 1
    const rawEnd = isLast
      ? sceneStart + sceneDuration
      : sceneStart + Math.round((sceneDuration * consumedWeight) / total)
    // never let rounding invert a cue; the final cue absorbs the remainder
    const end = Math.max(cursor + 1, Math.min(sceneStart + sceneDuration, rawEnd))
    ends.push(end)
    cursor = end
  })
  return ends
}

/**
 * Build cues for every scene with narrationText. Scenes without text simply
 * contribute no cues; scene offsets follow the storyboard timeline.
 */
export function buildAutoCues(storyboard: Storyboard, options: AutoSubtitleOptions = {}): SubtitleCue[] {
  const maxCues = options.maxCues ?? DEFAULT_MAX_CUES
  const minCueMs = options.minCueMs ?? DEFAULT_MIN_CUE_MS
  const cues: SubtitleCue[] = []
  let sceneStart = 0

  for (const scene of storyboard.scenes) {
    const text = scene.narrationText?.trim()
    const sentences = text ? splitNarrationSentences(text) : []
    if (sentences.length > 0) {
      const ends = allocateCueEnds(sentences.map(s => s.length), sceneStart, scene.durationMs)
      let start = sceneStart
      sentences.forEach((sentence, index) => {
        const end = ends[index]
        const previous = cues[cues.length - 1]
        // merge a too-short cue into the previous one instead of emitting a flash
        if (previous && end - start < minCueMs) {
          previous.endMs = end
          previous.text = `${previous.text} ${sentence}`
        } else {
          cues.push({ startMs: start, endMs: end, text: sentence })
        }
        start = end
      })
    }
    sceneStart += scene.durationMs
  }

  if (cues.length > maxCues) {
    throw new MediaError(
      'MEDIA_STORYBOARD_INVALID',
      `auto subtitles produced ${cues.length} cues, over the ${maxCues} limit; shorten narration text or split scenes`,
    )
  }
  return cues
}

/** Return a new storyboard with generated cues installed (input never mutated). */
export function withAutoSubtitles(storyboard: Storyboard, options: AutoSubtitleOptions = {}): Storyboard {
  const cues = buildAutoCues(storyboard, options)
  return { ...storyboard, subtitles: cues.length > 0 ? cues : undefined }
}
