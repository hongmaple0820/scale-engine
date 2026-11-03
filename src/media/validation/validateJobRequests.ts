// Job request validation (M2): video and speech are validated at the system
// boundary before a task dir exists. Unknown fields never reach providers;
// first-frame paths must be task-local `assets/...` paths, never URLs or
// absolute paths.

import { MediaError } from '../errors.js'
import type { ExportJobRequest, PublishMetadata, SpeechJobRequest, VideoJobRequest } from '../types.js'
import { EXPORT_PROFILE_IDS, isExportProfileId } from '../export/profiles.js'

const PROVIDER_ID_RE = /^[\w-]{1,64}$/
const VOICE_RE = /^[\w-]{1,60}$/
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp']
export const VIDEO_ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const
export const VIDEO_RESOLUTIONS = ['480p', '720p', '1080p'] as const
export const VIDEO_MAX_DURATION_SECONDS = 60
export const VIDEO_DEFAULT_POLL_TIMEOUT_SECONDS = 1800
export const VIDEO_MIN_POLL_TIMEOUT_SECONDS = 10
export const VIDEO_MAX_POLL_TIMEOUT_SECONDS = 3600

function providerIdOf(value: unknown, errors: string[]): string {
  if (typeof value !== 'string' || !PROVIDER_ID_RE.test(value.trim())) {
    errors.push('providerId is required and must match /^[\\w-]{1,64}$/')
    return ''
  }
  return value.trim()
}

function optionalModel(value: unknown, errors: string[]): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > 100) {
    errors.push('model must be a non-empty string of at most 100 chars')
    return undefined
  }
  return value.trim()
}

function validFirstFramePath(value: string): boolean {
  if (!value.startsWith('assets/') || value.length > 240) return false
  if (!/^[\w./-]+$/.test(value) || value.includes('..') || value.includes('//')) return false
  const lower = value.toLowerCase()
  return IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext))
}

export function validateVideoRequest(raw: unknown): VideoJobRequest {
  const request = (raw ?? {}) as Partial<VideoJobRequest>
  const errors: string[] = []
  const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : ''
  if (!prompt) errors.push('prompt must be a non-empty string')
  else if (prompt.length > 4000) errors.push('prompt exceeds 4000 chars')

  const duration = request.durationSeconds
  if (
    typeof duration !== 'number' ||
    !Number.isInteger(duration) ||
    duration < 1 ||
    duration > VIDEO_MAX_DURATION_SECONDS
  ) {
    errors.push(`durationSeconds must be an integer between 1 and ${VIDEO_MAX_DURATION_SECONDS}`)
  }

  const aspectRatio = request.aspectRatio ?? '16:9'
  if (!(VIDEO_ASPECT_RATIOS as readonly string[]).includes(aspectRatio)) {
    errors.push(`aspectRatio must be one of ${VIDEO_ASPECT_RATIOS.join(', ')}`)
  }
  const resolution = request.resolution ?? '720p'
  if (!(VIDEO_RESOLUTIONS as readonly string[]).includes(resolution)) {
    errors.push(`resolution must be one of ${VIDEO_RESOLUTIONS.join(', ')}`)
  }

  const providerId = providerIdOf(request.providerId, errors)
  const model = optionalModel(request.model, errors)

  let pollTimeoutSeconds = request.pollTimeoutSeconds ?? VIDEO_DEFAULT_POLL_TIMEOUT_SECONDS
  if (
    typeof pollTimeoutSeconds !== 'number' ||
    !Number.isInteger(pollTimeoutSeconds) ||
    pollTimeoutSeconds < VIDEO_MIN_POLL_TIMEOUT_SECONDS ||
    pollTimeoutSeconds > VIDEO_MAX_POLL_TIMEOUT_SECONDS
  ) {
    errors.push(`pollTimeoutSeconds must be an integer between ${VIDEO_MIN_POLL_TIMEOUT_SECONDS} and ${VIDEO_MAX_POLL_TIMEOUT_SECONDS}`)
    pollTimeoutSeconds = VIDEO_DEFAULT_POLL_TIMEOUT_SECONDS
  }

  let firstFrameAssetPath: string | undefined
  if (request.firstFrameAssetPath !== undefined) {
    if (typeof request.firstFrameAssetPath !== 'string' || !validFirstFramePath(request.firstFrameAssetPath)) {
      errors.push('firstFrameAssetPath must be a task-local assets/ image path (.png/.jpg/.jpeg/.webp) without traversal')
    } else {
      firstFrameAssetPath = request.firstFrameAssetPath
    }
  }

  if (errors.length > 0) throw new MediaError('MEDIA_VIDEO_REQUEST_INVALID', errors.join('; '))
  return {
    prompt,
    durationSeconds: duration as number,
    aspectRatio,
    resolution,
    providerId,
    ...(model ? { model } : {}),
    ...(firstFrameAssetPath ? { firstFrameAssetPath } : {}),
    pollTimeoutSeconds,
  }
}

export function validateSpeechRequest(raw: unknown): SpeechJobRequest {
  const request = (raw ?? {}) as Partial<SpeechJobRequest>
  const errors: string[] = []
  const text = typeof request.text === 'string' ? request.text.trim() : ''
  if (!text) errors.push('text must be a non-empty string')
  else if (text.length > 4000) errors.push('text exceeds 4000 chars')

  const providerId = providerIdOf(request.providerId, errors)
  const model = optionalModel(request.model, errors)

  const voice = request.voice ?? 'alloy'
  if (typeof voice !== 'string' || !VOICE_RE.test(voice)) {
    errors.push('voice must match /^[\\w-]{1,60}$/')
  }
  const format = request.format ?? 'mp3'
  if (format !== 'mp3' && format !== 'wav') errors.push('format must be "mp3" or "wav"')

  if (errors.length > 0) throw new MediaError('MEDIA_SPEECH_REQUEST_INVALID', errors.join('; '))
  return {
    text,
    providerId,
    voice: typeof voice === 'string' && VOICE_RE.test(voice) ? voice : 'alloy',
    format: format === 'wav' ? 'wav' : 'mp3',
    ...(model ? { model } : {}),
  }
}

export function validateExportRequest(raw: unknown): ExportJobRequest {
  const request = (raw ?? {}) as Partial<ExportJobRequest>
  const errors: string[] = []

  const sourceTaskId = typeof request.sourceTaskId === 'string' ? request.sourceTaskId.trim() : ''
  if (!/^[\w-]{1,80}$/.test(sourceTaskId)) {
    errors.push('sourceTaskId must match /^[\w-]{1,80}$/')
  }

  let profiles = request.profiles
  if (profiles === undefined) {
    profiles = [...EXPORT_PROFILE_IDS]
  } else if (!Array.isArray(profiles) || profiles.length === 0 || profiles.length > EXPORT_PROFILE_IDS.length) {
    errors.push(`profiles must be a non-empty array of at most ${EXPORT_PROFILE_IDS.length} ids`)
    profiles = []
  } else if (!profiles.every(isExportProfileId)) {
    errors.push(`profiles must only contain ${EXPORT_PROFILE_IDS.join(', ')}`)
    profiles = []
  } else if (new Set(profiles).size !== profiles.length) {
    errors.push('profiles must not repeat the same profile twice')
    profiles = []
  }

  let coverAtSec = request.coverAtSec
  if (coverAtSec !== undefined) {
    if (typeof coverAtSec !== 'number' || !Number.isFinite(coverAtSec) || coverAtSec < 0 || coverAtSec > 3600) {
      errors.push('coverAtSec must be a number between 0 and 3600')
      coverAtSec = undefined
    }
  }

  const subtitles = request.subtitles ?? 'srt'
  if (subtitles !== 'none' && subtitles !== 'srt' && subtitles !== 'burn') {
    errors.push('subtitles must be "none", "srt" or "burn"')
  }

  let publish: PublishMetadata | undefined
  if (request.publish !== undefined) {
    const meta = (request.publish ?? {}) as Partial<PublishMetadata>
    const title = typeof meta.title === 'string' ? meta.title.trim() : ''
    if (!title) errors.push('publish.title must be a non-empty string')
    else if (title.length > 120) errors.push('publish.title exceeds 120 chars')
    const description = typeof meta.description === 'string' ? meta.description.trim() : undefined
    if (description !== undefined && description.length > 2000) errors.push('publish.description exceeds 2000 chars')
    const tags = Array.isArray(meta.tags) && meta.tags.every(tag => typeof tag === 'string' && /^[\w一-龥 -]{1,30}$/.test(tag)) ? meta.tags.slice(0, 10) : undefined
    if (meta.tags !== undefined && tags === undefined) errors.push('publish.tags must be an array of at most 30-char strings')
    const platformHints = Array.isArray(meta.platformHints) && meta.platformHints.every(hint => typeof hint === 'string' && /^[\w-]{1,30}$/.test(hint))
      ? meta.platformHints.slice(0, 10)
      : undefined
    if (meta.platformHints !== undefined && platformHints === undefined) errors.push('publish.platformHints must be an array of at most 30-char ids')
    if (title) {
      publish = {
        title,
        ...(description ? { description } : {}),
        ...(tags ? { tags } : {}),
        ...(platformHints ? { platformHints } : {}),
      }
    }
  }

  if (errors.length > 0) throw new MediaError('MEDIA_EXPORT_REQUEST_INVALID', errors.join('; '))
  return {
    sourceTaskId,
    ...(profiles && profiles.length > 0 ? { profiles } : {}),
    ...(coverAtSec !== undefined ? { coverAtSec } : {}),
    ...(subtitles !== 'srt' ? { subtitles } : {}),
    ...(publish ? { publish } : {}),
  }
}
