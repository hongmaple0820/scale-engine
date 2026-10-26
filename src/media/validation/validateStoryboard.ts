// Storyboard (Scene DSL) validator — the security boundary of the media
// engine (v3 plan §6). Everything not explicitly allowed is rejected:
// unknown fields, non-whitelisted fonts/animations/colors, absolute or
// traversing asset paths, unbounded sizes. The renderer downstream is a
// trusted template that only ever sees validated values.

import type { SceneElement, Storyboard } from '../types.js'

export const STORYBOARD_LIMITS = {
  schemaVersion: '0.2',
  acceptedSchemaVersions: ['0.1', '0.2'],
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
  minFontSize: 8,
  maxFontSize: 320,
  fontWhitelist: ['Microsoft YaHei', 'SimHei', 'SimSun', 'KaiTi', 'Segoe UI', 'Arial', 'sans-serif', 'serif', 'monospace'],
  animationTypes: ['fadeIn', 'fadeInUp', 'slideUp', 'progressBar'],
  imageExtensions: ['.png', '.jpg', '.jpeg', '.webp'],
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

function validateElement(el: Record<string, unknown>, at: string, errors: string[]): void {
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
    if (typeof src !== 'string' || src.length === 0 || src.length > 200) {
      errors.push(`${at}: image src must be a relative task path (1..200 chars)`)
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
  errors.push(`${at}: element type must be text | rect | image`)
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
  rejectUnknown(input, ['schemaVersion', 'title', 'canvas', 'output', 'scenes', 'subtitles'], 'storyboard', errors)

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
      rejectUnknown(rawScene, ['id', 'durationMs', 'elements', 'transitionOut'], at, errors)
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
        rawScene.elements.forEach((rawElement, elementIndex) => {
          const elementAt = `${at}.elements[${elementIndex}]`
          if (!isPlainObject(rawElement)) {
            errors.push(`${elementAt}: element must be an object`)
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
          validateElement(rawElement, elementAt, errors)
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

/** Asset references (task-relative) declared by image elements. */
export function storyboardAssetRefs(storyboard: Storyboard): string[] {
  const refs: string[] = []
  for (const scene of storyboard.scenes) {
    for (const element of scene.elements as SceneElement[]) {
      if (element.type === 'image') refs.push(element.src)
    }
  }
  return refs
}
