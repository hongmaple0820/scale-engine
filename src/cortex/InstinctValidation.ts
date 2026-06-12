import { createHash } from 'node:crypto'
import type { Instinct } from './InstinctExtractor.js'

export const INSTINCT_CONFIDENCE_LEVELS = [0.3, 0.5, 0.7, 0.9] as const

export interface InstinctValidationResult {
  ok: boolean
  reasons: string[]
}

const ACTION_VERB = /\b(add|audit|avoid|build|check|collect|compare|document|ensure|escalate|fix|keep|lint|prefer|record|remove|review|run|scan|split|test|update|use|validate|verify)\b/i
const CJK_TEXT = /[\u4e00-\u9fff]/

export function normalizeInstinctTrigger(trigger: string): string {
  return trigger.trim().replace(/\s+/g, ' ')
}

export function deriveScopedInstinctId(
  trigger: string,
  scope: Instinct['scope'] = 'project',
  projectId?: string,
): string {
  const key = [
    scope,
    (projectId ?? '').trim(),
    normalizeInstinctTrigger(trigger),
  ].join(':')
  return `instinct-${createHash('sha256').update(key).digest('hex').slice(0, 10)}`
}

export function validateInstinct(instinct: Instinct): InstinctValidationResult {
  const reasons: string[] = []
  const trigger = normalizeInstinctTrigger(instinct.trigger ?? '')
  const action = (instinct.action ?? '').trim()

  if (!trigger) reasons.push('trigger is required')
  if (!action) {
    reasons.push('action is required')
  } else {
    const actionText = action.replace(/[#*_`>\-\s]/g, '')
    if (actionText.length < 8) reasons.push('action is too short')
    if (!ACTION_VERB.test(action) && !CJK_TEXT.test(action)) {
      reasons.push('action must contain actionable guidance')
    }
  }

  if (!Number.isFinite(instinct.confidence)) {
    reasons.push('confidence must be finite')
  } else {
    if (instinct.confidence < 0 || instinct.confidence > 1) {
      reasons.push('confidence must be between 0 and 1')
    }
    if (!INSTINCT_CONFIDENCE_LEVELS.some(level => Object.is(level, instinct.confidence))) {
      reasons.push('confidence must be one of 0.3, 0.5, 0.7, 0.9')
    }
  }

  if (instinct.scope !== 'project' && instinct.scope !== 'global') {
    reasons.push('scope must be project or global')
  }
  if (instinct.observations < 0) reasons.push('observations must be non-negative')
  if (instinct.appliedCount < 0) reasons.push('appliedCount must be non-negative')
  if (instinct.hitRate < 0 || instinct.hitRate > 1) reasons.push('hitRate must be between 0 and 1')

  return { ok: reasons.length === 0, reasons }
}
