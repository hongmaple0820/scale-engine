// Action catalog contract (v3 plan §5.1): one manifest per action, milestone
// gating, MCP tool/type drift, and fail-closed cost estimation.

import { describe, expect, it } from 'vitest'
import { IMPLEMENTED_CREATE_TYPES, MEDIA_MCP_TOOLS } from '../../../src/media/mcpTools.js'
import { MEDIA_ACTION_MANIFESTS } from '../../../src/media/actions/manifests.js'
import {
  actionForJobType,
  assertCatalogIntegrity,
  availableActions,
  availableCreateTypes,
  catalogCoverageErrors,
  catalogIntegrityErrors,
  createTypeEnumErrors,
  getAction,
  getActionForTool,
  listActions,
} from '../../../src/media/actions/registry.js'
import { estimateCost } from '../../../src/media/actions/estimate.js'
import { MEDIA_PRICE_TABLE, isPriceStale, priceAgeDays, resolvePrice } from '../../../src/media/actions/pricing.js'
import { MediaError } from '../../../src/media/errors.js'

const ACTION_IDS = [
  'media.generate_image',
  'media.render_storyboard',
  'media.generate_video',
  'media.generate_speech',
  'media.export',
  'media.publish_prepare',
]

// Deliberately explicit: a new media tool that is neither an action trigger
// nor listed here must fail the drift test instead of silently passing.
const CONTROL_TOOLS = [
  'media_list_providers',
  'media_list_approvals',
  'media_validate_storyboard',
  'media_run_task',
  'media_wait_task',
  'media_estimate_cost',
  'media_render_storyboard',
  'media_generate_image',
  'media_get_task',
  'media_list_tasks',
  'media_cancel_task',
  'media_retry_task',
  'media_recover_tasks',
  'media_get_evidence',
]

function createTypeEnum(): unknown[] {
  const tool = MEDIA_MCP_TOOLS.find(candidate => candidate.name === 'media_create_task')
  if (!tool) throw new Error('media_create_task tool is missing')
  const properties = tool.inputSchema.properties as Record<string, { enum?: unknown[] }> | undefined
  return properties?.type?.enum ?? []
}

describe('media action catalog', () => {
  it('declares six unique, well-formed actions', () => {
    expect(MEDIA_ACTION_MANIFESTS.map(action => action.id)).toEqual(ACTION_IDS)
    expect(new Set(MEDIA_ACTION_MANIFESTS.map(action => action.id)).size).toBe(ACTION_IDS.length)
    expect(catalogIntegrityErrors()).toEqual([])
    expect(() => assertCatalogIntegrity()).not.toThrow()
  })

  it('exposes M0+M2+M4 actions', () => {
    expect(availableActions().map(action => action.id)).toEqual([
      'media.generate_image',
      'media.render_storyboard',
      'media.generate_video',
      'media.generate_speech',
      'media.export',
      'media.publish_prepare',
    ])
    expect(listActions()).toHaveLength(6)
    expect(getAction('media.generate_video')?.availableIn).toBe('M2')
    expect(getAction('media.generate_speech')?.availableIn).toBe('M2')
    expect(getAction('media.export')?.availableIn).toBe('M4')
    expect(getAction('media.export')?.invoke.fixed?.type).toBe('export')
    expect(getAction('media.publish_prepare')?.availableIn).toBe('M4')
    expect(getAction('media.publish_prepare')?.invoke.fixed?.type).toBe('export')
    // publish_prepare must stay threshold-gated (cost is always 0, but the
    // gate documents that publish metadata is a deliberate, reviewable act)
    expect(getAction('media.publish_prepare')?.approval.mode).toBe('threshold')
    expect(getAction('media.export')?.approval.mode).toBe('never')
  })

  it('keeps every media tool claimed by the catalog or an explicit control allow-list', () => {
    const toolNames = MEDIA_MCP_TOOLS.map(tool => tool.name)
    expect(new Set(toolNames)).toEqual(new Set([...CONTROL_TOOLS, 'media_create_task']))
    expect(catalogCoverageErrors(toolNames, CONTROL_TOOLS)).toEqual([])
  })

  it('flags catalog/tool drift in both directions', () => {
    const missingTools = catalogCoverageErrors(['media_create_task'], CONTROL_TOOLS)
    expect(missingTools.length).toBeGreaterThan(0)
    expect(missingTools.some(message => message.includes('is not exposed'))).toBe(true)

    const rogueTool = catalogCoverageErrors([...CONTROL_TOOLS, 'media_create_task', 'media_rogue'], CONTROL_TOOLS)
    expect(rogueTool).toEqual(['tool "media_rogue" is neither an action trigger nor an allow-listed control tool'])

    const ghostControl = catalogCoverageErrors([...CONTROL_TOOLS, 'media_create_task'], [...CONTROL_TOOLS, 'media_ghost'])
    expect(ghostControl).toEqual(['allow-listed control tool "media_ghost" is not exposed'])

    expect(createTypeEnumErrors(['render'])).toEqual([
      'available create type "generate_image" is missing from the tool enum',
      'available create type "generate_video" is missing from the tool enum',
      'available create type "generate_speech" is missing from the tool enum',
      'available create type "export" is missing from the tool enum',
    ])
    expect(createTypeEnumErrors(['render', 'generate_image', 'generate_video', 'generate_speech', 'export'])).toEqual([])
    // An enum value with no catalog entry stays an error in every milestone.
    expect(createTypeEnumErrors(['render', 'generate_image', 'generate_video', 'generate_speech', 'export', 'hologram'])).toEqual([
      'create type "hologram" has no available action',
    ])
  })

  it('derives the create-task type enum from available actions only', () => {
    const enumValues = createTypeEnum()
    expect(createTypeEnumErrors(enumValues)).toEqual([])
    // Display order is part of the contract (clients may pick the first value).
    expect(enumValues).toEqual(['render', 'generate_image', 'generate_video', 'generate_speech', 'export'])
    expect(new Set(availableCreateTypes())).toEqual(new Set(['generate_image', 'render', 'generate_video', 'generate_speech', 'export']))
    // Bumping IMPLEMENTED_MILESTONE without wiring JobService must fail here.
    expect(new Set(availableCreateTypes())).toEqual(new Set(IMPLEMENTED_CREATE_TYPES))
  })

  it('maps job types and tool invocations back to actions', () => {
    expect(actionForJobType('render')?.id).toBe('media.render_storyboard')
    expect(actionForJobType('generate_image')?.id).toBe('media.generate_image')
    expect(getActionForTool('media_create_task', 'generate_video')?.id).toBe('media.generate_video')
    // both export actions share the job type; the first fixed-type match wins
    // (JobService does not yet distinguish publish-carrying requests)
    expect(actionForJobType('export')?.id).toBe('media.export')
    expect(getActionForTool('media_create_task', 'export')?.id).toBe('media.export')
    expect(getActionForTool('media_create_task', 'nope')).toBeUndefined()
  })
})

describe('media pricing + estimation', () => {
  it('prices local and mock work at 0 and keeps provider prices fail-closed', () => {
    expect(resolvePrice('local:render')?.unitPriceCny).toBe(0)
    expect(resolvePrice('mock:image')?.unitPriceCny).toBe(0)
    expect(resolvePrice('openai-compatible:image')?.unitPriceCny).toBeNull()
    expect(resolvePrice('unknown:key')).toBeUndefined()
    for (const entry of Object.values(MEDIA_PRICE_TABLE)) {
      expect(entry.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(entry.owner.length).toBeGreaterThan(0)
    }
  })

  it('marks only old (or unparseable) prices stale', () => {
    const entry = resolvePrice('local:render')
    if (!entry) throw new Error('local:render price missing')
    const now = new Date('2026-10-29T12:00:00Z')
    expect(priceAgeDays(entry, now)).toBe(0)
    expect(isPriceStale(entry, now)).toBe(false)
    expect(isPriceStale(entry, new Date('2027-03-01T00:00:00Z'))).toBe(true)
    expect(isPriceStale({ ...entry, updatedAt: 'not-a-date' }, now)).toBe(true)
  })

  it('estimates local renders in minutes without validating the storyboard', () => {
    const estimate = estimateCost('media.render_storyboard', {
      storyboard: {
        schemaVersion: '0.1',
        canvas: { width: 320, height: 320, fps: 24, background: '#000' },
        scenes: [{ id: 's1', durationMs: 30_000, elements: [] }],
      },
    })
    expect(estimate.estimatedCny).toBe(0)
    expect(estimate.breakdown[0]).toMatchObject({
      pricingKey: 'local:render',
      unit: 'render_minute',
      quantity: 0.5,
      unitPriceCny: 0,
      subtotalCny: 0,
    })
  })

  it('fails closed when the quantity cannot be derived', () => {
    const invalid = estimateCost('media.render_storyboard', { storyboard: { broken: true } })
    expect(invalid.estimatedCny).toBeNull()
    expect(invalid.breakdown[0].quantity).toBeNull()
    expect(invalid.reason).toContain('storyboard')

    const missing = estimateCost('media.render_storyboard', {})
    expect(missing.estimatedCny).toBeNull()
    expect(missing.reason).toContain('storyboard')

    const nonNumeric = estimateCost('media.render_storyboard', {
      storyboard: { scenes: [{ id: 's1', durationMs: '30s', elements: [] }] },
    })
    expect(nonNumeric.estimatedCny).toBeNull()
    expect(nonNumeric.reason).toContain('storyboard')
  })

  it('prices mock images at 0 and unconfirmed providers at null', () => {
    const mock = estimateCost('media.generate_image', { providerId: 'mock', prompt: 'x' })
    expect(mock.estimatedCny).toBe(0)
    expect(mock.breakdown[0].pricingKey).toBe('mock:image')
    // One image per request: stray count fields must not invent billable units.
    expect(estimateCost('media.generate_image', { providerId: 'mock', prompt: 'x', count: 100 }).breakdown[0].quantity).toBe(1)

    const real = estimateCost('media.generate_image', { providerId: 'openai-compatible', prompt: 'x' })
    expect(real.estimatedCny).toBeNull()
    expect(real.breakdown[0].unitPriceCny).toBeNull()
    expect(real.reason).toContain('openai-compatible:image')
  })

  it('treats stale provider prices as unconfirmed', () => {
    const stale = (): { unit: 'render_minute'; unitPriceCny: number; updatedAt: string; owner: string } => ({
      unit: 'render_minute',
      unitPriceCny: 2,
      updatedAt: '2020-01-01',
      owner: 'test',
    })
    const estimate = estimateCost(
      'media.render_storyboard',
      { storyboard: { scenes: [{ id: 's1', durationMs: 60_000, elements: [] }] } },
      stale,
    )
    expect(estimate.estimatedCny).toBeNull()
    expect(estimate.reason).toContain('stale')
  })

  it('rejects unknown actions; M4 actions now estimate (always 0, fail-closed)', () => {
    expect(() => estimateCost('media.nope')).toThrow(MediaError)
    // M4 actions became available with IMPLEMENTED_MILESTONE = 'M4'
    const exportEstimate = estimateCost('media.export', { exportRequest: { sourceTaskId: 't' } })
    expect(exportEstimate.estimatedCny).toBe(0)
    expect(exportEstimate.breakdown[0].pricingKey).toBe('local:export')
    const publishEstimate = estimateCost('media.publish_prepare', { exportRequest: { sourceTaskId: 't' } })
    expect(publishEstimate.estimatedCny).toBe(0)
    expect(() => estimateCost('media.hologram')).toThrow(/unknown media action/)
  })
})
