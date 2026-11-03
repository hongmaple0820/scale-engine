// Storyboard (Scene DSL) validator — the security boundary of the media
// engine (v3 plan §6). Everything not explicitly allowed is rejected:
// unknown fields, non-whitelisted fonts/animations/colors, absolute or
// traversing asset paths, unbounded sizes. The renderer downstream is a
// trusted template that only ever sees validated values.

import type { SceneElement, Storyboard } from '../types.js'
import { ASSET_REF_MAX_LENGTH, isAssetRef, parseAssetRef } from '../assets/refs.js'

export const STORYBOARD_LIMITS = {
  schemaVersion: '0.4',
  acceptedSchemaVersions: ['0.1', '0.2', '0.3', '0.4'],
  maxCanvasWidth: 3840,
  maxCanvasHeight: 2160,
  fpsWhitelist: [24, 25, 30, 50, 60],
  maxDurationPerSceneMs: 60000,
  maxTotalDurationMs: 120000,
  maxScenes: 30,
  maxElementsPerScene: 50,
  maxSubtitles: 50,
  maxTextLength: 200,
  maxSubtitleTextLength: 200,
  maxNarrationTextLength: 500,
  maxImageSrcLength: 200,
  maxVideoSrcLength: 200,
  maxSubtitleSrcLength: 200,
  maxAssetRefLength: ASSET_REF_MAX_LENGTH,
  /** trim windows are bounded by the DSL, not by probing (/ 10 min per clip) */
  maxVideoTrimMs: 600000,
  /** at most one full-canvas video per scene — the scene background */
  maxVideoElementsPerScene: 1,
  maxAudioTracks: 2,
  subtitleModes: ['none', 'burn', 'srt', 'both'],
  subtitleSources: ['auto', 'file'],
  minFontSize: 8,
  maxFontSize: 320,
  fontWhitelist: ['Microsoft YaHei', 'SimHei', 'SimSun', 'KaiTi', 'Segoe UI', 'Arial', 'sans-serif', 'serif', 'monospace'],
  animationTypes: ['fadeIn', 'fadeInUp', 'slideUp', 'progressBar'],
  imageExtensions: ['.png', '.jpg', '.jpeg', '.webp'],
  videoExtensions: ['.mp4', '.mov', '.webm'],
  audioExtensions: ['.mp3', '.wav', '.m4a', '.aac'],
  videoCodecs: ['libx264'],
  pixelFormats: ['yuv420p'],
  audioCodecs: ['aac'],
  presets: ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow'],
} as const

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const ID_RE = /^[\w-]{1,64}$/

function checkColor(value: unknown, at: string, errors: string[]): void {
  if (typeof value !== 'string' || !COLOR_RE.test(value)) errors.push(`${at}: color must be a #RGB/#RRGGBB/#RRGGBBAA hex string`)
}

function checkFinite(value: unknown, at: string, errors: string[]): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${at}: must be a finite number`)
    return false
  }
  return true
}

function rejectUnknown(record: Record<string, unknown>, allowed: readonly string[], at: string, errors: string[]): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) errors.push(`${at}: unknown field "${key}"`)
  }
}

/** Task-relative or asset:// path with a whitelisted extension (shared by video/audio/subtitle file). */
function checkMediaSrc(
  value: unknown,
  at: string,
  extensions: readonly string[],
  maxLength: number,
  schemaVersion: string,
  errors: string[],
  label: string,
): void {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(`${at}: ${label} must be a relative task path or an asset:// reference`)
    return
  }
  if (isAssetRef(value)) {
    if (schemaVersion !== '0.3' && schemaVersion !== '0.4') {
      errors.push(`${at}: asset:// references require schemaVersion 0.3`)
      return
    }
    if (value.length > STORYBOARD_LIMITS.maxAssetRefLength) {
      errors.push(`${at}: asset ref exceeds ${STORYBOARD_LIMITS.maxAssetRefLength} chars`)
      return
    }
    try {
      const ref = parseAssetRef(value)
      if (!extensions.some(ext => ref.rest.toLowerCase().endsWith(ext))) {
        errors.push(`${at}: ${label} extension must be one of ${extensions.join('/')}`)
      }
    } catch (error) {
      errors.push(`${at}: ${error instanceof Error ? error.message : String(error)}`)
    }
    return
  }
  if (value.length > maxLength) {
    errors.push(`${at}: ${label} must be a relative task path (1..${maxLength} chars)`)
    return
  }
  if (value.startsWith('/') || /^[a-zA-Z]:/.test(value) || value.split(/[\\/]/).includes('..')) {
    errors.push(`${at}: ${label} must stay inside the task assets directory`)
  }
  if (!extensions.some(ext => value.toLowerCase().endsWith(ext))) {
    errors.push(`${at}: ${label} extension must be one of ${extensions.join('/')}`)
  }
}

const isV04 = (schemaVersion: string): boolean => schemaVersion === '0.4'

function validateVideoElement(el: Record<string, unknown>, at: string, errors: string[], schemaVersion: string): void {
  if (!isV04(schemaVersion)) {
    errors.push(`${at}: video elements require schemaVersion 0.4`)
  }
  rejectUnknown(el, ['type', 'src', 'fit', 'muted', 'trimStartMs', 'trimEndMs', 'loop'], at, errors)
  checkMediaSrc(el.src, at, STORYBOARD_LIMITS.videoExtensions, STORYBOARD_LIMITS.maxVideoSrcLength, schemaVersion, errors, 'video src')
  if (el.fit !== undefined && el.fit !== 'cover' && el.fit !== 'contain') {
    errors.push(`${at}: fit must be cover | contain`)
  }
  if (el.muted !== undefined && typeof el.muted !== 'boolean') errors.push(`${at}: muted must be a boolean`)
  if (el.loop !== undefined && typeof el.loop !== 'boolean') errors.push(`${at}: loop must be a boolean`)
  const hasStart = el.trimStartMs !== undefined
  const hasEnd = el.trimEndMs !== undefined
  if (hasStart && !(checkFinite(el.trimStartMs, `${at}.trimStartMs`, errors) && Number.isInteger(el.trimStartMs))) {
    errors.push(`${at}: trimStartMs must be a non-negative integer`)
  }
  if (hasEnd && !(checkFinite(el.trimEndMs, `${at}.trimEndMs`, errors) && Number.isInteger(el.trimEndMs))) {
    errors.push(`${at}: trimEndMs must be a non-negative integer`)
  }
  const start = typeof el.trimStartMs === 'number' ? el.trimStartMs : 0
  const end = typeof el.trimEndMs === 'number' ? el.trimEndMs : undefined
  if (start < 0) errors.push(`${at}: trimStartMs must be >= 0`)
  if (end !== undefined) {
    if (end > STORYBOARD_LIMITS.maxVideoTrimMs) {
      errors.push(`${at}: trimEndMs exceeds the ${STORYBOARD_LIMITS.maxVideoTrimMs}ms clip bound`)
    }
    if (end <= start) errors.push(`${at}: trimStartMs must be < trimEndMs`)
  }
}

function validateAudioTrack(track: Record<string, unknown>, at: string, errors: string[], schemaVersion: string): void {
  rejectUnknown(track, ['src', 'kind', 'volume', 'loop', 'fadeInMs', 'fadeOutMs'], at, errors)
  checkMediaSrc(track.src, at, STORYBOARD_LIMITS.audioExtensions, STORYBOARD_LIMITS.maxVideoSrcLength, schemaVersion, errors, 'audio src')
  if (track.kind !== 'narration' && track.kind !== 'bgm') {
    errors.push(`${at}: kind must be narration | bgm`)
  }
  if (track.volume !== undefined) {
    if (checkFinite(track.volume, `${at}.volume`, errors) && ((track.volume as number) < 0 || (track.volume as number) > 1)) {
      errors.push(`${at}: volume must be within [0, 1]`)
    }
  }
  if (track.loop !== undefined && typeof track.loop !== 'boolean') errors.push(`${at}: loop must be a boolean`)
  for (const key of ['fadeInMs', 'fadeOutMs'] as const) {
    const value = track[key]
    if (value !== undefined) {
      if (checkFinite(value, `${at}.${key}`, errors) && (!Number.isInteger(value) || (value as number) < 0)) {
        errors.push(`${at}: ${key} must be a non-negative integer`)
      }
    }
  }
}

function validateSubtitleSpec(spec: Record<string, unknown>, errors: string[], schemaVersion: string): void {
  const at = 'storyboard.subtitleOptions'
  rejectUnknown(spec, ['mode', 'source', 'src'], at, errors)
  if (!STORYBOARD_LIMITS.subtitleModes.includes(spec.mode as never)) {
    errors.push(`${at}: mode must be one of ${STORYBOARD_LIMITS.subtitleModes.join('/')}`)
  }
  if (spec.source !== undefined && !STORYBOARD_LIMITS.subtitleSources.includes(spec.source as never)) {
    errors.push(`${at}: source must be auto | file`)
  }
  const source = spec.source ?? 'auto'
  if (source === 'file') {
    if (typeof spec.src !== 'string' || spec.src.length === 0) {
      errors.push(`${at}: src is required when source is "file"`)
    } else if (isAssetRef(spec.src)) {
      // kept task-local: SRT files are not materialized from other tasks
      errors.push(`${at}: src must be a task-relative path (asset:// is not supported for subtitles)`)
    } else {
      checkMediaSrc(spec.src, `${at}.src`, ['.srt'], STORYBOARD_LIMITS.maxSubtitleSrcLength, schemaVersion, errors, 'subtitle src')
    }
  } else if (spec.src !== undefined) {
    errors.push(`${at}: src is only valid when source is "file"`)
  }
}

function validateElement(el: Record<string, unknown>, at: string, errors: string[], schemaVersion: string): void {
  const type = el.type
  if (type === 'text') {
    rejectUnknown(el, ['type', 'x', 'y', 'content', 'fontFamily', 'fontSize', 'color', 'animation'], at, errors)
    const content = el.content
    if (typeof content !== 'string' || content.length === 0) errors.push(`${at}: text content must be a non-empty string`)
    else if (content.length > STORYBOARD_LIMITS.maxTextLength) errors.push(`${at}: text content exceeds ${STORYBOARD_LIMITS.maxTextLength} chars`)
    if (!STORYBOARD_LIMITS.fontWhitelist.includes(el.fontFamily as never)) errors.push(`${at}: fontFamily "${String(el.fontFamily)}" is not whitelisted`)
    if (checkFinite(el.fontSize, `${at}.fontSize`, errors)) {
      const size = el.fontSize as number
      if (size < STORYBOARD_LIMITS.minFontSize || size > STORYBOARD_LIMITS.maxFontSize) {
        errors.push(`${at}: fontSize out of range [${STORYBOARD_LIMITS.minFontSize}, ${STORYBOARD_LIMITS.maxFontSize}]`)
      }
    }
    checkColor(el.color, `${at}.color`, errors)
    return
  }
  if (type === 'rect') {
    rejectUnknown(el, ['type', 'x', 'y', 'width', 'height', 'color', 'radius', 'animation'], at, errors)
    checkFinite(el.width, `${at}.width`, errors) && (el.width as number) > 0 && (el.width as number) <= 3840
      ? undefined
      : errors.push(`${at}: rect width must be within (0, 3840]`)
    checkFinite(el.height, `${at}.height`, errors) && (el.height as number) > 0 && (el.height as number) <= 2160
      ? undefined
      : errors.push(`${at}: rect height must be within (0, 2160]`)
    checkColor(el.color, `${at}.color`, errors)
    if (el.radius !== undefined && checkFinite(el.radius, `${at}.radius`, errors) && (el.radius as number) < 0) {
      errors.push(`${at}: radius must be >= 0`)
    }
    return
  }
  if (type === 'image') {
    rejectUnknown(el, ['type', 'x', 'y', 'src', 'width', 'height', 'animation'], at, errors)
    const src = el.src
    if (typeof src !== 'string' || src.length === 0) {
      errors.push(`${at}: image src must be a relative task path or an asset:// reference`)
    } else if (isAssetRef(src)) {
      // asset:// refs are a v0.3 feature; the renderer materializes them into
      // this task before prepare, the validator only checks the ref shape.
      if (schemaVersion !== '0.3') errors.push(`${at}: asset:// references require schemaVersion 0.3`)
      if (src.length > STORYBOARD_LIMITS.maxAssetRefLength) {
        errors.push(`${at}: asset ref exceeds ${STORYBOARD_LIMITS.maxAssetRefLength} chars`)
      } else {
        try {
          const ref = parseAssetRef(src)
          if (!STORYBOARD_LIMITS.imageExtensions.some(ext => ref.rest.toLowerCase().endsWith(ext))) {
            errors.push(`${at}: image src extension must be one of ${STORYBOARD_LIMITS.imageExtensions.join('/')}`)
          }
        } catch (error) {
          errors.push(`${at}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    } else if (src.length > STORYBOARD_LIMITS.maxImageSrcLength) {
      errors.push(`${at}: image src must be a relative task path (1..${STORYBOARD_LIMITS.maxImageSrcLength} chars)`)
    } else {
      if (src.startsWith('/') || /^[a-zA-Z]:/.test(src) || src.split(/[\\/]/).includes('..')) {
        errors.push(`${at}: image src must stay inside the task assets directory`)
      }
      if (!STORYBOARD_LIMITS.imageExtensions.some(ext => src.toLowerCase().endsWith(ext))) {
        errors.push(`${at}: image src extension must be one of ${STORYBOARD_LIMITS.imageExtensions.join('/')}`)
      }
    }
    checkFinite(el.width, `${at}.width`, errors) && (el.width as number) > 0 ? undefined : errors.push(`${at}: image width must be > 0`)
    checkFinite(el.height, `${at}.height`, errors) && (el.height as number) > 0 ? undefined : errors.push(`${at}: image height must be > 0`)
    return
  }
  if (type === 'video') {
    validateVideoElement(el, at, errors, schemaVersion)
    return
  }
  errors.push(`${at}: element type must be text | rect | image | video`)
}

function validateAnimation(animation: unknown, at: string, sceneDurationMs: number, errors: string[]): void {
  if (!isPlainObject(animation)) {
    errors.push(`${at}: animation must be an object`)
    return
  }
  rejectUnknown(animation, ['type', 'delayMs', 'durationMs'], at, errors)
  if (!STORYBOARD_LIMITS.animationTypes.includes(animation.type as never)) {
    errors.push(`${at}: animation type "${String(animation.type)}" is not whitelisted`)
  }
  const duration = animation.durationMs
  if (checkFinite(duration, `${at}.durationMs`, errors)) {
    if ((duration as number) < 1 || (duration as number) > sceneDurationMs) {
      errors.push(`${at}: animation durationMs must be within (0, scene duration]`)
    }
  }
  if (animation.delayMs !== undefined && checkFinite(animation.delayMs, `${at}.delayMs`, errors)) {
    if ((animation.delayMs as number) < 0 || (animation.delayMs as number) > sceneDurationMs) {
      errors.push(`${at}: animation delayMs must be within [0, scene duration]`)
    }
  }
}

export function validateStoryboard(input: unknown): ValidationResult {
  const errors: string[] = []
  if (!isPlainObject(input)) {
    return { ok: false, errors: ['storyboard must be a JSON object'] }
  }
  rejectUnknown(input, ['schemaVersion', 'title', 'canvas', 'output', 'scenes', 'subtitles', 'audioTracks', 'subtitleOptions'], 'storyboard', errors)
  const schemaVersion = String(input.schemaVersion)

    if (!STORYBOARD_LIMITS.acceptedSchemaVersions.includes(input.schemaVersion as never)) {
      errors.push(`storyboard: schemaVersion must be one of ${STORYBOARD_LIMITS.acceptedSchemaVersions.join('/')} (got "${String(input.schemaVersion)}")`)
    }
  if (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > 200)) {
    errors.push('storyboard: title must be a string of at most 200 chars')
  }

  // canvas
  if (!isPlainObject(input.canvas)) {
    errors.push('storyboard: canvas must be an object')
  } else {
    rejectUnknown(input.canvas, ['width', 'height', 'fps', 'background'], 'canvas', errors)
    const canvas = input.canvas
    if (checkFinite(canvas.width, 'canvas.width', errors)) {
      const w = canvas.width as number
      if (!Number.isInteger(w) || w < 16 || w > STORYBOARD_LIMITS.maxCanvasWidth || w % 2 !== 0) {
        errors.push(`canvas: width must be an even integer within [16, ${STORYBOARD_LIMITS.maxCanvasWidth}]`)
      }
    }
    if (checkFinite(canvas.height, 'canvas.height', errors)) {
      const h = canvas.height as number
      if (!Number.isInteger(h) || h < 16 || h > STORYBOARD_LIMITS.maxCanvasHeight || h % 2 !== 0) {
        errors.push(`canvas: height must be an even integer within [16, ${STORYBOARD_LIMITS.maxCanvasHeight}]`)
      }
    }
    if (checkFinite(canvas.fps, 'canvas.fps', errors) && !STORYBOARD_LIMITS.fpsWhitelist.includes(canvas.fps as never)) {
      errors.push(`canvas: fps must be one of ${STORYBOARD_LIMITS.fpsWhitelist.join('/')}`)
    }
    checkColor(canvas.background, 'canvas.background', errors)
  }

  // output (optional)
  if (input.output !== undefined) {
    if (!isPlainObject(input.output)) {
      errors.push('storyboard: output must be an object')
    } else {
      rejectUnknown(input.output, ['videoCodec', 'pixelFormat', 'audioCodec', 'crf', 'preset'], 'output', errors)
      const out = input.output
      if (out.videoCodec !== undefined && !STORYBOARD_LIMITS.videoCodecs.includes(out.videoCodec as never)) {
        errors.push(`output: videoCodec must be one of ${STORYBOARD_LIMITS.videoCodecs.join('/')}`)
      }
      if (out.pixelFormat !== undefined && !STORYBOARD_LIMITS.pixelFormats.includes(out.pixelFormat as never)) {
        errors.push(`output: pixelFormat must be one of ${STORYBOARD_LIMITS.pixelFormats.join('/')}`)
      }
      if (out.audioCodec !== undefined && !STORYBOARD_LIMITS.audioCodecs.includes(out.audioCodec as never)) {
        errors.push(`output: audioCodec must be one of ${STORYBOARD_LIMITS.audioCodecs.join('/')}`)
      }
      if (out.crf !== undefined && checkFinite(out.crf, 'output.crf', errors)) {
        const crf = out.crf as number
        if (!Number.isInteger(crf) || crf < 0 || crf > 51) errors.push('output: crf must be an integer within [0, 51]')
      }
      if (out.preset !== undefined && !STORYBOARD_LIMITS.presets.includes(out.preset as never)) {
        errors.push(`output: preset must be one of ${STORYBOARD_LIMITS.presets.join('/')}`)
      }
    }
  }

  // audio tracks (v0.4, optional): at most one narration and one bgm
  let hasNarrationTrack = false
  if (input.audioTracks !== undefined) {
    if (!isV04(schemaVersion)) {
      errors.push('storyboard: audioTracks require schemaVersion 0.4')
    } else if (!Array.isArray(input.audioTracks)) {
      errors.push('storyboard: audioTracks must be an array')
    } else {
      if (input.audioTracks.length > STORYBOARD_LIMITS.maxAudioTracks) {
        errors.push(`storyboard: more than ${STORYBOARD_LIMITS.maxAudioTracks} audio tracks`)
      }
      const kinds = new Set<string>()
      input.audioTracks.forEach((rawTrack, index) => {
        const at = `storyboard.audioTracks[${index}]`
        if (!isPlainObject(rawTrack)) {
          errors.push(`${at}: track must be an object`)
          return
        }
        validateAudioTrack(rawTrack, at, errors, schemaVersion)
        const kind = String(rawTrack.kind)
        if (kinds.has(kind)) errors.push(`${at}: duplicate "${kind}" track — at most one per kind`)
        kinds.add(kind)
      })
      hasNarrationTrack = kinds.has('narration')
    }
  }

  // subtitle options (v0.4, optional)
  let autoSubtitles = false
  if (input.subtitleOptions !== undefined) {
    if (!isV04(schemaVersion)) {
      errors.push('storyboard: subtitleOptions require schemaVersion 0.4')
    } else if (!isPlainObject(input.subtitleOptions)) {
      errors.push('storyboard: subtitleOptions must be an object')
    } else {
      validateSubtitleSpec(input.subtitleOptions, errors, schemaVersion)
      autoSubtitles = (input.subtitleOptions.source ?? 'auto') === 'auto' && input.subtitleOptions.mode !== 'none'
    }
  }

  // scenes
  if (!Array.isArray(input.scenes) || input.scenes.length === 0) {
    errors.push('storyboard: scenes must be a non-empty array')
  } else {
    if (input.scenes.length > STORYBOARD_LIMITS.maxScenes) {
      errors.push(`storyboard: more than ${STORYBOARD_LIMITS.maxScenes} scenes`)
    }
    let totalMs = 0
    const ids = new Set<string>()
    input.scenes.forEach((rawScene, index) => {
      const at = `scenes[${index}]`
      if (!isPlainObject(rawScene)) {
        errors.push(`${at}: scene must be an object`)
        return
      }
      rejectUnknown(rawScene, ['id', 'durationMs', 'elements', 'transitionOut', 'narrationText'], at, errors)
      if (rawScene.narrationText !== undefined) {
        if (!isV04(schemaVersion)) {
          errors.push(`${at}: narrationText requires schemaVersion 0.4`)
        } else if (
          typeof rawScene.narrationText !== 'string' ||
          rawScene.narrationText.length === 0 ||
          rawScene.narrationText.length > STORYBOARD_LIMITS.maxNarrationTextLength
        ) {
          errors.push(`${at}: narrationText must be 1..${STORYBOARD_LIMITS.maxNarrationTextLength} chars`)
        }
      }
      if (autoSubtitles && hasNarrationTrack && rawScene.narrationText === undefined) {
        errors.push(`${at}: narrationText is required when a narration track and auto subtitles are used`)
      }
      if (typeof rawScene.id !== 'string' || !ID_RE.test(rawScene.id)) {
        errors.push(`${at}: id must match ${ID_RE}`)
      } else if (ids.has(rawScene.id)) {
        errors.push(`${at}: duplicate scene id "${rawScene.id}"`)
      } else {
        ids.add(rawScene.id)
      }
      if (checkFinite(rawScene.durationMs, `${at}.durationMs`, errors)) {
        const duration = rawScene.durationMs as number
        if (!Number.isInteger(duration) || duration < 100 || duration > STORYBOARD_LIMITS.maxDurationPerSceneMs) {
          errors.push(`${at}: durationMs must be an integer within [100, ${STORYBOARD_LIMITS.maxDurationPerSceneMs}]`)
        }
        totalMs += duration
      }
      if (!Array.isArray(rawScene.elements) || rawScene.elements.length === 0) {
        errors.push(`${at}: elements must be a non-empty array`)
      } else {
        if (rawScene.elements.length > STORYBOARD_LIMITS.maxElementsPerScene) {
          errors.push(`${at}: more than ${STORYBOARD_LIMITS.maxElementsPerScene} elements`)
        }
        const sceneDuration = typeof rawScene.durationMs === 'number' ? rawScene.durationMs : 0
        let videoElements = 0
        rawScene.elements.forEach((rawElement, elementIndex) => {
          const elementAt = `${at}.elements[${elementIndex}]`
          if (!isPlainObject(rawElement)) {
            errors.push(`${elementAt}: element must be an object`)
            return
          }
          if (rawElement.type === 'video') {
            // full-canvas clip: no x/y/animation — validate the video specific shape only
            videoElements += 1
            if (videoElements > STORYBOARD_LIMITS.maxVideoElementsPerScene) {
              errors.push(`${at}: at most ${STORYBOARD_LIMITS.maxVideoElementsPerScene} video element per scene`)
            }
            validateElement(rawElement, elementAt, errors, schemaVersion)
            return
          }
          const x = rawElement.x
          if (x !== 'center' && !checkFinite(x, `${elementAt}.x`, errors)) return
          if (!checkFinite(rawElement.y, `${elementAt}.y`, errors)) return
          if (typeof x === 'number' && (x < 0 || x > 3840)) errors.push(`${elementAt}: x out of canvas range`)
          if (typeof rawElement.y === 'number' && (rawElement.y < 0 || (rawElement.y as number) > 2160)) {
            errors.push(`${elementAt}: y out of canvas range`)
          }
          if (rawElement.animation !== undefined) validateAnimation(rawElement.animation, `${elementAt}.animation`, sceneDuration, errors)
          validateElement(rawElement, elementAt, errors, schemaVersion)
        })
      }
      if (rawScene.transitionOut !== undefined) {
        const transition = rawScene.transitionOut
        if (!isPlainObject(transition)) {
          errors.push(`${at}.transitionOut: must be an object`)
        } else {
          rejectUnknown(transition, ['type', 'direction', 'durationMs'], `${at}.transitionOut`, errors)
          const transitionType = transition.type
          if (transitionType !== 'fade' && transitionType !== 'slide' && transitionType !== 'wipe') {
            errors.push(`${at}.transitionOut: type must be fade | slide | wipe`)
          }
          const needsDirection = transitionType === 'slide' || transitionType === 'wipe'
          const isV01 = input.schemaVersion === '0.1'
          if (needsDirection && isV01) {
            errors.push(`${at}.transitionOut: type "${String(transitionType)}" requires schemaVersion 0.2`)
          }
          if (needsDirection) {
            const direction = transition.direction
            if (typeof direction !== 'string' || !['left', 'right', 'up', 'down'].includes(direction)) {
              errors.push(`${at}.transitionOut: type "${String(transitionType)}" requires direction left|right|up|down`)
            }
          } else if (transition.direction !== undefined) {
            errors.push(`${at}.transitionOut: direction is only valid for slide/wipe`)
          }
          if (checkFinite(transition.durationMs, `${at}.transitionOut.durationMs`, errors)) {
            const d = transition.durationMs as number
            if (d < 0 || d > (typeof rawScene.durationMs === 'number' ? rawScene.durationMs : 0)) {
              errors.push(`${at}.transitionOut: durationMs must be within [0, scene duration]`)
            }
          }
        }
      }
    })
    if (totalMs > STORYBOARD_LIMITS.maxTotalDurationMs) {
      errors.push(`storyboard: total duration ${totalMs}ms exceeds ${STORYBOARD_LIMITS.maxTotalDurationMs}ms`)
    }
  }

  // subtitles (optional)
  if (input.subtitles !== undefined) {
    if (!Array.isArray(input.subtitles)) {
      errors.push('storyboard: subtitles must be an array')
    } else {
      if (input.subtitles.length > STORYBOARD_LIMITS.maxSubtitles) {
        errors.push(`storyboard: more than ${STORYBOARD_LIMITS.maxSubtitles} subtitle cues`)
      }
      input.subtitles.forEach((rawCue, index) => {
        const at = `subtitles[${index}]`
        if (!isPlainObject(rawCue)) {
          errors.push(`${at}: cue must be an object`)
          return
        }
        rejectUnknown(rawCue, ['startMs', 'endMs', 'text'], at, errors)
        if (checkFinite(rawCue.startMs, `${at}.startMs`, errors) && checkFinite(rawCue.endMs, `${at}.endMs`, errors)) {
          if ((rawCue.startMs as number) < 0 || (rawCue.endMs as number) <= (rawCue.startMs as number)) {
            errors.push(`${at}: cue times must satisfy 0 <= startMs < endMs`)
          }
        }
        const text = rawCue.text
        if (typeof text !== 'string' || text.length === 0 || text.length > STORYBOARD_LIMITS.maxSubtitleTextLength) {
          errors.push(`${at}: cue text must be 1..${STORYBOARD_LIMITS.maxSubtitleTextLength} chars`)
        }
      })
    }
  }

  return { ok: errors.length === 0, errors }
}

/** Total timeline length of a validated storyboard. */
export function storyboardTotalMs(storyboard: Storyboard): number {
  return storyboard.scenes.reduce((sum, scene) => sum + scene.durationMs, 0)
}

/** Media references (task-relative to assets/) declared by the storyboard. */
export function storyboardAssetRefs(storyboard: Storyboard): string[] {
  const refs: string[] = []
  for (const scene of storyboard.scenes) {
    for (const element of scene.elements as SceneElement[]) {
      if (element.type === 'image' || element.type === 'video') refs.push(element.src)
    }
  }
  for (const track of storyboard.audioTracks ?? []) refs.push(track.src)
  return refs
}
