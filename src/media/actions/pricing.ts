// Static price table skeleton (v3 plan §5.4 / §10). M0 ships local and mock
// prices (0); provider prices stay `null` until the M2 spike confirms them.
// A null price is fail-closed: estimation returns null instead of guessing.

import type { MediaCostUnit } from './types.js'

export const PRICING_MAX_AGE_DAYS = 90

export interface MediaPriceEntry {
  unit: MediaCostUnit
  /** CNY per unit; null means the provider price is not confirmed yet. */
  unitPriceCny: number | null
  /** ISO date (YYYY-MM-DD) of the last human review. */
  updatedAt: string
  /** Who owns refreshing this price. */
  owner: string
  note?: string
}

export const MEDIA_PRICE_TABLE: Readonly<Record<string, MediaPriceEntry>> = Object.freeze({
  'local:render': {
    unit: 'render_minute',
    unitPriceCny: 0,
    updatedAt: '2026-10-29',
    owner: 'scale-engine',
    note: 'Local FFmpeg pipeline; compute is not billed.',
  },
  'local:export': {
    unit: 'export',
    unitPriceCny: 0,
    updatedAt: '2026-10-29',
    owner: 'scale-engine',
    note: 'Local packaging; compute is not billed.',
  },
  'mock:image': {
    unit: 'image',
    unitPriceCny: 0,
    updatedAt: '2026-10-29',
    owner: 'scale-engine',
    note: 'Deterministic test provider.',
  },
  'mock-video:video': {
    unit: 'video_second',
    unitPriceCny: 0,
    updatedAt: '2026-10-29',
    owner: 'scale-engine',
    note: 'Deterministic test provider; synthetic bytes, no network.',
  },
  'mock-speech:speech': {
    unit: 'speech_char',
    unitPriceCny: 0,
    updatedAt: '2026-10-29',
    owner: 'scale-engine',
    note: 'Deterministic test provider; silent/synthetic audio, no network.',
  },
  'openai-compatible:image': {
    unit: 'image',
    unitPriceCny: null,
    updatedAt: '2026-10-29',
    owner: 'scale-engine',
    note: 'Provider price depends on the configured model; confirm in M2.',
  },
  'seedance:video': {
    unit: 'video_second',
    unitPriceCny: null,
    updatedAt: '2026-10-29',
    owner: 'scale-engine',
    note: 'Confirm against the provider price sheet in M2 S0.',
  },
  'openai-compatible:speech': {
    unit: 'speech_char',
    unitPriceCny: null,
    updatedAt: '2026-10-29',
    owner: 'scale-engine',
    note: 'Confirm against the provider price sheet in M2.',
  },
  'openai-speech:speech': {
    unit: 'speech_char',
    unitPriceCny: null,
    updatedAt: '2026-10-29',
    owner: 'scale-engine',
    note: 'OpenAI-compatible speech adapter; price depends on the configured model — unconfirmed.',
  },
  'image.default': {
    unit: 'image',
    unitPriceCny: null,
    updatedAt: '2026-10-29',
    owner: 'scale-engine',
    note: 'Fallback when a request does not name a provider.',
  },
  'video.default': {
    unit: 'video_second',
    unitPriceCny: null,
    updatedAt: '2026-10-29',
    owner: 'scale-engine',
    note: 'Fallback when a request does not name a provider.',
  },
  'speech.default': {
    unit: 'speech_char',
    unitPriceCny: null,
    updatedAt: '2026-10-29',
    owner: 'scale-engine',
    note: 'Fallback when a request does not name a provider.',
  },
})

export function resolvePrice(pricingKey: string | null | undefined): MediaPriceEntry | undefined {
  if (!pricingKey) return undefined
  return MEDIA_PRICE_TABLE[pricingKey]
}

export function priceAgeDays(entry: MediaPriceEntry, now: Date = new Date()): number | null {
  const updated = Date.parse(`${entry.updatedAt}T00:00:00Z`)
  if (!Number.isFinite(updated)) return null
  return Math.floor((now.getTime() - updated) / 86_400_000)
}

/** Missing/invalid dates are treated as stale, not fresh. */
export function isPriceStale(entry: MediaPriceEntry, now: Date = new Date()): boolean {
  const age = priceAgeDays(entry, now)
  return age === null || age > PRICING_MAX_AGE_DAYS
}
