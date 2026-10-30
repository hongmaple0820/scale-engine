// Pure template builders (M3). No filesystem access, no job creation: the
// wizard calls `/plan` for a preview, generates the missing assets through the
// public task API, then calls `/assemble` with the resulting refs and creates a
// normal render task. Every returned board has passed the DSL validator.

import { MediaError } from '../errors.js'
import type { MediaJobCost, SceneElement, Storyboard } from '../types.js'
import { validateStoryboard } from '../validation/validateStoryboard.js'
import { estimateMediaJobCost } from '../cost/MediaCostAdapter.js'
import { BUILTIN_TEMPLATES, getBuiltinTemplate } from './builtin.js'
import type {
  AssembleOptions,
  MediaTemplateId,
  PlannedSlot,
  TemplateDefinition,
  TemplatePlan,
  TemplateSlot,
  TemplateSlotValues,
} from './types.js'

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm']
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp']
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac']

/** Total-duration guard shared by templates (DSL cap is 120s). */
const TEMPLATE_TOTAL_BUDGET_MS = 115000

function extensionOf(src: string): string {
  const normalized = src.toLowerCase()
  const slash = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  const dot = normalized.lastIndexOf('.')
  return dot > slash ? normalized.slice(dot) : ''
}

export const isVideoSrc = (src: string): boolean => VIDEO_EXTENSIONS.includes(extensionOf(src))
const isImageSrc = (src: string): boolean => IMAGE_EXTENSIONS.includes(extensionOf(src))
const isAudioSrc = (src: string): boolean => AUDIO_EXTENSIONS.includes(extensionOf(src))

function fail(message: string): never {
  throw new MediaError('MEDIA_STORYBOARD_INVALID', message)
}

function slotLimit(slot: TemplateSlot): { min: number; max: number } {
  if (slot.multiple) {
    return { min: slot.minItems ?? (slot.required ? 1 : 0), max: slot.maxItems ?? 50 }
  }
  return { min: slot.required ? 1 : 0, max: 1 }
}

function readValues(slot: TemplateSlot, raw: unknown): string[] {
  if (raw === undefined || raw === null) return []
  if (typeof raw === 'string') return raw.trim() ? [raw.trim()] : []
  if (Array.isArray(raw)) {
    if (!raw.every(value => typeof value === 'string')) {
      fail(`slot "${slot.key}" must contain only strings`)
    }
    return raw.map(value => (value as string).trim()).filter(Boolean)
  }
  fail(`slot "${slot.key}" must be a string or an array of strings`)
}

function checkKind(slot: TemplateSlot, values: string[]): void {
  for (const value of values) {
    if (slot.kind === 'audio' && !isAudioSrc(value)) {
      fail(`slot "${slot.key}" expects an audio file (${AUDIO_EXTENSIONS.join('/')}): ${value}`)
    }
    if (slot.kind === 'image' && !isImageSrc(value)) {
      fail(`slot "${slot.key}" expects an image file (${IMAGE_EXTENSIONS.join('/')}): ${value}`)
    }
    if (slot.kind === 'media' && !isImageSrc(value) && !isVideoSrc(value)) {
      fail(`slot "${slot.key}" expects an image or video file: ${value}`)
    }
    if ((slot.kind === 'text' || slot.kind === 'narration') && slot.maxChars !== undefined && [...value].length > slot.maxChars) {
      fail(`slot "${slot.key}" exceeds ${slot.maxChars} characters`)
    }
  }
}

function placeholderFor(slot: TemplateSlot, index: number): string {
  switch (slot.kind) {
    case 'image':
    case 'media':
      return `generated/template-placeholder-${index + 1}.png`
    case 'audio':
      return `generated/template-placeholder-${index + 1}.mp3`
    case 'narration':
      return '示例旁白文本。'
    case 'text':
      return slot.key === 'captions' ? '示例字幕。' : '示例标题'
  }
}

interface NormalizedSlots {
  values: Map<string, string[]>
  missing: Set<string>
}

/**
 * Normalize caller values. `plan` fills required media/text slots with
 * structural placeholders so a preview board always validates; `assemble` is
 * strict and rejects missing/under-filled required slots.
 */
function normalizeSlots(definition: TemplateDefinition, input: TemplateSlotValues, mode: 'plan' | 'assemble'): NormalizedSlots {
  const values = new Map<string, string[]>()
  const missing = new Set<string>()
  for (const slot of definition.slots) {
    const supplied = readValues(slot, input[slot.key])
    const { min, max } = slotLimit(slot)
    checkKind(slot, supplied)
    if (supplied.length > max) {
      fail(`slot "${slot.key}" accepts at most ${max} value(s), got ${supplied.length}`)
    }
    if (supplied.length < min) {
      if (mode === 'assemble') {
        fail(`slot "${slot.key}" requires at least ${min} value(s)`)
      }
      missing.add(slot.key)
      const filled = [...supplied]
      for (let index = filled.length; index < min; index++) {
        filled.push(placeholderFor(slot, index))
      }
      values.set(slot.key, filled)
      continue
    }
    values.set(slot.key, supplied)
  }
  return { values, missing }
}

const listOf = (slots: NormalizedSlots, key: string): string[] => slots.values.get(key) ?? []
const firstOf = (slots: NormalizedSlots, key: string): string | undefined => listOf(slots, key)[0]

/** Rough TTS length model: 800ms lead-in + 180ms per character, clamped. */
export function narrationDurationMs(text: string): number {
  const chars = [...text].length
  return Math.max(2000, Math.min(30000, 800 + chars * 180))
}

function mediaElement(src: string, canvas: TemplateDefinition['canvas']): SceneElement {
  if (isVideoSrc(src)) {
    return { type: 'video', src, fit: 'cover', muted: true, loop: true }
  }
  return { type: 'image', src, x: 0, y: 0, width: canvas.width, height: canvas.height }
}

function textElement(content: string, canvas: TemplateDefinition['canvas']): SceneElement {
  return {
    type: 'text',
    content,
    fontFamily: 'Microsoft YaHei',
    fontSize: Math.round(canvas.width / 16),
    color: '#f8fafc',
    x: 'center',
    y: Math.round(canvas.height * 0.08),
    animation: { type: 'fadeInUp', durationMs: 600 },
  }
}

function buildTalkingHead(definition: TemplateDefinition, slots: NormalizedSlots, options: AssembleOptions): Storyboard {
  const media = firstOf(slots, 'media') ?? fail('slot "media" is required')
  const narration = firstOf(slots, 'narration') ?? fail('slot "narration" is required')
  const title = firstOf(slots, 'title')
  const voiceover = firstOf(slots, 'voiceover')

  const elements: SceneElement[] = [mediaElement(media, definition.canvas)]
  if (title) elements.push(textElement(title, definition.canvas))

  return {
    schemaVersion: '0.4',
    title: options.title ?? '口播讲解',
    canvas: definition.canvas,
    scenes: [
      {
        id: 'main',
        durationMs: narrationDurationMs(narration),
        narrationText: narration,
        elements,
      },
    ],
    ...(voiceover ? { audioTracks: [{ src: voiceover, kind: 'narration', volume: 1 }] } : {}),
    subtitleOptions: { mode: 'both', source: 'auto' },
  }
}

function buildProductShowcase(definition: TemplateDefinition, slots: NormalizedSlots, options: AssembleOptions): Storyboard {
  const media = listOf(slots, 'media')
  if (media.length === 0) fail('slot "media" requires at least 3 values')
  const headline = firstOf(slots, 'headline')
  const bgm = firstOf(slots, 'bgm')

  const scenes = media.map((src, index) => {
    const elements: SceneElement[] = [mediaElement(src, definition.canvas)]
    if (index === 0 && headline) elements.push(textElement(headline, definition.canvas))
    return { id: `shot-${index + 1}`, durationMs: 3000, elements }
  })

  return {
    schemaVersion: '0.4',
    title: options.title ?? '产品展示',
    canvas: definition.canvas,
    scenes,
    ...(bgm
      ? { audioTracks: [{ src: bgm, kind: 'bgm', volume: 0.35, loop: true, fadeInMs: 400, fadeOutMs: 1000 }] }
      : {}),
    subtitleOptions: { mode: 'none' },
  }
}

function buildFastCuts(definition: TemplateDefinition, slots: NormalizedSlots, options: AssembleOptions): Storyboard {
  const images = listOf(slots, 'images')
  if (images.length === 0) fail('slot "images" requires at least 4 values')
  const captions = listOf(slots, 'captions')
  const voiceover = firstOf(slots, 'voiceover')
  if (captions.length > images.length) {
    fail(`slot "captions" has ${captions.length} values but only ${images.length} images`)
  }
  if (voiceover && captions.length < images.length) {
    fail('a voiceover track requires one caption per image so auto subtitles cover every scene')
  }

  const perSceneBudget = Math.max(2000, Math.floor(TEMPLATE_TOTAL_BUDGET_MS / images.length))
  const scenes = images.map((src, index) => {
    const caption = captions[index]
    return {
      id: `cut-${index + 1}`,
      durationMs: caption ? Math.min(narrationDurationMs(caption), perSceneBudget) : 1500,
      ...(caption ? { narrationText: caption } : {}),
      elements: [mediaElement(src, definition.canvas)],
    }
  })
  const usesSubtitles = captions.length > 0 || Boolean(voiceover)

  return {
    schemaVersion: '0.4',
    title: options.title ?? '图文快剪',
    canvas: definition.canvas,
    scenes,
    ...(voiceover ? { audioTracks: [{ src: voiceover, kind: 'narration', volume: 1 }] } : {}),
    subtitleOptions: usesSubtitles ? { mode: 'both', source: 'auto' } : { mode: 'none' },
  }
}

const BUILDERS: Record<MediaTemplateId, (definition: TemplateDefinition, slots: NormalizedSlots, options: AssembleOptions) => Storyboard> = {
  'talking-head': buildTalkingHead,
  'product-showcase': buildProductShowcase,
  'fast-cuts': buildFastCuts,
}

function assertValid(board: Storyboard): void {
  const result = validateStoryboard(board)
  if (!result.ok) {
    fail(`template produced an invalid storyboard:\n- ${result.errors.join('\n- ')}`)
  }
}

export function requireTemplate(id: string): TemplateDefinition {
  const definition = getBuiltinTemplate(id)
  if (!definition) {
    throw new MediaError('MEDIA_ACTION_UNKNOWN', `unknown media template "${id}"; available: ${BUILTIN_TEMPLATES.map(t => t.id).join(', ')}`)
  }
  return definition
}

/** Strict assembly: all required slots must be present. Pure. */
export function assembleTemplate(templateId: string, input: TemplateSlotValues = {}, options: AssembleOptions = {}): Storyboard {
  const definition = requireTemplate(templateId)
  const slots = normalizeSlots(definition, input, 'assemble')
  const board = BUILDERS[definition.id](definition, slots, options)
  assertValid(board)
  return board
}

/** Preview: missing required slots become placeholders; nothing is persisted. Pure. */
export function planTemplate(templateId: string, input: TemplateSlotValues = {}): TemplatePlan {
  const definition = requireTemplate(templateId)
  const slots = normalizeSlots(definition, input, 'plan')
  const draft = BUILDERS[definition.id](definition, slots, {})
  assertValid(draft)

  const plannedSlots: PlannedSlot[] = definition.slots.map(slot => {
    const { min, max } = slotLimit(slot)
    return {
      ...slot,
      values: listOf(slots, slot.key),
      missing: slots.missing.has(slot.key),
      minItems: min,
      maxItems: max,
    }
  })
  const estimate: MediaJobCost = estimateMediaJobCost('media.render_storyboard', { storyboard: draft })
  const warnings = plannedSlots
    .filter(slot => slot.missing)
    .map(slot => `slot "${slot.key}" is missing; the draft uses placeholder values`)
  return {
    templateId: definition.id,
    templateName: definition.name,
    aspectRatio: definition.aspectRatio,
    canvas: definition.canvas,
    draft,
    slots: plannedSlots,
    estimate,
    warnings,
  }
}

export function listTemplates(): ReadonlyArray<TemplateDefinition> {
  return BUILTIN_TEMPLATES
}
