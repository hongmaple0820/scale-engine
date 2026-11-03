// Deterministic cost estimation from the static price table (v3 plan §6.1).
// Estimation never validates the request and never guesses: unknown provider
// prices produce a null estimate with every priced line still visible.

import { MediaError } from '../errors.js'
import type { Storyboard } from '../types.js'
import { storyboardTotalMs } from '../validation/validateStoryboard.js'
import { isPriceStale, resolvePrice, type MediaPriceEntry } from './pricing.js'
import { getAction, isActionAvailable } from './registry.js'
import type { MediaActionManifest, MediaCostUnit } from './types.js'

export interface CostEstimateLine {
  item: string
  pricingKey: string
  unit: MediaCostUnit
  /** null when the params cannot yield a deterministic quantity (fail closed). */
  quantity: number | null
  unitPriceCny: number | null
  subtotalCny: number | null
  pricingUpdatedAt?: string
}

export interface CostEstimate {
  actionId: string
  estimatedCny: number | null
  breakdown: CostEstimateLine[]
  reason?: string
}

interface PricedQuantity {
  quantity: number | null
  pricingKey: string
  /** Why the quantity is null — surfaced in CostEstimate.reason. */
  reason?: string
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function storyboardMinutes(storyboard: Record<string, unknown> | undefined): PricedQuantity['quantity'] {
  if (!storyboard) return null
  try {
    const minutes = round(storyboardTotalMs(storyboard as unknown as Storyboard) / 60_000)
    return Number.isFinite(minutes) && minutes >= 0 ? minutes : null
  } catch {
    return null
  }
}

function pricedQuantity(action: MediaActionManifest, params: Record<string, unknown>): PricedQuantity {
  switch (action.id) {
    case 'media.generate_image': {
      const request = asRecord(params.imageRequest) ?? params
      const providerId = typeof request.providerId === 'string' ? request.providerId.trim() : ''
      return {
        // The job contract is one image per request; extra count fields are
        // ignored rather than inventing billable units.
        quantity: 1,
        pricingKey: providerId ? `${providerId}:image` : (action.cost.pricingKey ?? 'image.default'),
      }
    }
    case 'media.render_storyboard': {
      const quantity = storyboardMinutes(asRecord(params.storyboard))
      return {
        quantity,
        pricingKey: action.cost.pricingKey ?? 'local:render',
        ...(quantity === null ? { reason: 'params.storyboard is missing or structurally invalid' } : {}),
      }
    }
    case 'media.generate_video': {
      const request = asRecord(params.videoRequest) ?? params
      const providerId = typeof request.providerId === 'string' ? request.providerId.trim() : ''
      const quantity = nonNegativeNumber(request.durationSeconds)
      return {
        quantity,
        pricingKey: providerId ? `${providerId}:video` : (action.cost.pricingKey ?? 'video.default'),
        ...(quantity === null ? { reason: 'params.durationSeconds must be a non-negative number' } : {}),
      }
    }
    case 'media.generate_speech': {
      const request = asRecord(params.speechRequest) ?? params
      const providerId = typeof request.providerId === 'string' ? request.providerId.trim() : ''
      const quantity = typeof request.text === 'string' ? [...request.text].length : null
      return {
        quantity,
        pricingKey: providerId ? `${providerId}:speech` : (action.cost.pricingKey ?? 'speech.default'),
        ...(quantity === null ? { reason: 'params.text must be a string' } : {}),
      }
    }
    case 'media.export':
    case 'media.publish_prepare':
      return { quantity: 1, pricingKey: action.cost.pricingKey ?? 'local:export' }
    default:
      return { quantity: 1, pricingKey: action.cost.pricingKey ?? '' }
  }
}

interface BuiltLine {
  line: CostEstimateLine
  reason?: string
}

function buildLine(
  action: MediaActionManifest,
  params: Record<string, unknown>,
  priceOf: (key: string) => MediaPriceEntry | undefined,
): BuiltLine {
  const { quantity, pricingKey, reason } = pricedQuantity(action, params)
  const price = priceOf(pricingKey) ?? priceOf(action.cost.pricingKey ?? '')
  const unitPriceCny = price?.unitPriceCny ?? null
  const isStale = price !== undefined && unitPriceCny !== null && unitPriceCny > 0 && isPriceStale(price)
  const priced = unitPriceCny !== null && quantity !== null && !isStale
  const subtotalCny = priced && unitPriceCny !== null && quantity !== null ? round(unitPriceCny * quantity) : null

  return {
    line: {
      item: action.id,
      pricingKey,
      unit: action.cost.unit,
      quantity,
      unitPriceCny,
      subtotalCny,
      ...(price ? { pricingUpdatedAt: price.updatedAt } : {}),
    },
    reason: isStale
      ? `pricing for "${pricingKey}" is stale (last updated ${price?.updatedAt ?? 'unknown'})`
      : reason,
  }
}

export function estimateCost(
  actionId: string,
  params: Record<string, unknown> = {},
  /** Test seam; production always reads the static table. */
  priceOf: (key: string) => MediaPriceEntry | undefined = resolvePrice,
): CostEstimate {
  const action = getAction(actionId)
  if (!action) {
    throw new MediaError('MEDIA_ACTION_UNKNOWN', `unknown media action "${actionId}"`)
  }
  if (!isActionAvailable(action)) {
    throw new MediaError(
      'MEDIA_ACTION_UNAVAILABLE',
      `action "${actionId}" is declared for ${action.availableIn} and is not available yet`,
    )
  }

  const { line, reason: quantityReason } = buildLine(action, params, priceOf)
  const reasons = [
    quantityReason,
    line.unitPriceCny === null ? `pricing for "${line.pricingKey}" is not confirmed` : undefined,
  ].filter((item): item is string => typeof item === 'string')

  return {
    actionId,
    estimatedCny: line.subtotalCny,
    breakdown: [line],
    ...(reasons.length > 0 ? { reason: reasons.join('; ') } : {}),
  }
}
