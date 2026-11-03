// Template wizard contracts (M3). A template is metadata plus a pure builder:
// `/plan` never persists, `/assemble` returns a validated 0.4 storyboard that
// the normal render endpoint consumes. No server-side hidden pipeline.

import type { MediaJobCost, Storyboard } from '../types.js'

export type MediaTemplateId = 'talking-head' | 'product-showcase' | 'fast-cuts'

export type TemplateSlotKind = 'media' | 'image' | 'text' | 'narration' | 'audio'

export interface TemplateSlot {
  key: string
  label: string
  kind: TemplateSlotKind
  required: boolean
  /** repeatable slot (media list / captions); values keep their order */
  multiple?: boolean
  minItems?: number
  maxItems?: number
  /** single-line text limit (narration uses the DSL's 500-char cap) */
  maxChars?: number
  description: string
}

export interface TemplateDefinition {
  id: MediaTemplateId
  name: string
  description: string
  aspectRatio: '16:9' | '9:16' | '1:1'
  canvas: { width: number; height: number; fps: number; background: string }
  slots: TemplateSlot[]
  schemaVersion: '0.4'
}

/** Caller-supplied slot values; each value may be a single string or a list. */
export type TemplateSlotValues = Record<string, unknown>

export interface PlannedSlot extends TemplateSlot {
  /** normalized values actually used (placeholders included when missing) */
  values: string[]
  /** required input was absent and a structural placeholder was used */
  missing: boolean
  minItems: number
  maxItems: number
}

export interface TemplatePlan {
  templateId: MediaTemplateId
  templateName: string
  aspectRatio: TemplateDefinition['aspectRatio']
  canvas: TemplateDefinition['canvas']
  /** structurally valid preview board (placeholders where slots are missing) */
  draft: Storyboard
  slots: PlannedSlot[]
  estimate: MediaJobCost
  warnings: string[]
}

export interface AssembleOptions {
  title?: string
}
