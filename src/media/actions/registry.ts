// Action registry: the single source for "which action exists, when is it
// available, and which tool triggers it". Surfaces derive their enums from
// here; drift tests keep the catalog and MCP tool list aligned.

import { MEDIA_ACTION_MANIFESTS } from './manifests.js'
import type { MediaActionManifest, MediaActionSurface, MediaMilestone } from './types.js'

const MILESTONE_ORDER: readonly MediaMilestone[] = ['M0', 'M2', 'M4']

/**
 * The newest milestone implemented in this checkout. Bump only when the
 * milestone's actions, tools and endpoints all ship together.
 */
export const IMPLEMENTED_MILESTONE: MediaMilestone = 'M4'

export interface ListActionsOptions {
  /** Hide actions declared for a later milestone. */
  availableOnly?: boolean
  surface?: MediaActionSurface
  longRunning?: boolean
}

export function milestoneRank(milestone: MediaMilestone): number {
  const rank = MILESTONE_ORDER.indexOf(milestone)
  return rank === -1 ? Number.POSITIVE_INFINITY : rank
}

export function isActionAvailable(
  action: MediaActionManifest,
  implemented: MediaMilestone = IMPLEMENTED_MILESTONE,
): boolean {
  return milestoneRank(action.availableIn) <= milestoneRank(implemented)
}

export function listActions(options: ListActionsOptions = {}): MediaActionManifest[] {
  return MEDIA_ACTION_MANIFESTS.filter(action => {
    if (options.availableOnly && !isActionAvailable(action)) return false
    if (options.surface && !action.surfaces.includes(options.surface)) return false
    if (options.longRunning !== undefined && action.longRunning !== options.longRunning) return false
    return true
  })
}

export function availableActions(): MediaActionManifest[] {
  return listActions({ availableOnly: true })
}

export function getAction(id: string): MediaActionManifest | undefined {
  return MEDIA_ACTION_MANIFESTS.find(action => action.id === id)
}

/**
 * Resolve the action a tool invocation maps to. `fixedType` disambiguates the
 * actions sharing `media_create_task` (image/render today, video/export later).
 */
export function getActionForTool(toolName: string, fixedType?: string): MediaActionManifest | undefined {
  return MEDIA_ACTION_MANIFESTS.find(action => {
    if (action.invoke.toolName !== toolName) return false
    if (fixedType === undefined) return true
    return action.invoke.fixed?.type === fixedType
  })
}

/** Map a persisted job type (`render`, `generate_image`) back to its action. */
export function actionForJobType(jobType: string): MediaActionManifest | undefined {
  return getActionForTool('media_create_task', jobType)
}

/** Create-task type enum derived from available actions, de-duplicated. */
export function availableCreateTypes(): string[] {
  const types = availableActions()
    .filter(action => action.invoke.toolName === 'media_create_task')
    .map(action => action.invoke.fixed?.type)
    .filter((type): type is string => typeof type === 'string' && type.length > 0)
  return [...new Set(types)]
}

export function catalogIntegrityErrors(): string[] {
  const errors: string[] = []
  const ids = new Set<string>()

  for (const action of MEDIA_ACTION_MANIFESTS) {
    if (!action.id || ids.has(action.id)) {
      errors.push(`duplicate or empty action id "${action.id}"`)
    }
    ids.add(action.id)

    if (!action.title.trim()) errors.push(`action "${action.id}" has an empty title`)
    if (!action.description.trim()) errors.push(`action "${action.id}" has an empty description`)
    if (action.surfaces.length === 0) errors.push(`action "${action.id}" declares no surfaces`)
    if (milestoneRank(action.availableIn) === Number.POSITIVE_INFINITY) {
      errors.push(`action "${action.id}" has unknown milestone "${action.availableIn}"`)
    }
    if (action.approval.mode === 'threshold') {
      const threshold = action.approval.thresholdCny
      if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0) {
        errors.push(`action "${action.id}" uses threshold approval without a non-negative thresholdCny`)
      }
    }
    if (action.paramsSchema.type !== 'object') {
      errors.push(`action "${action.id}" paramsSchema must describe an object`)
    }
    if (!action.invoke.toolName) errors.push(`action "${action.id}" has no invoke.toolName`)
  }

  return errors
}

export function assertCatalogIntegrity(): void {
  const errors = catalogIntegrityErrors()
  if (errors.length > 0) {
    throw new Error(`media action catalog is invalid:\n- ${errors.join('\n- ')}`)
  }
}

/**
 * Drift check between the catalog and an exposed tool list. Control tools are
 * read-only/control wrappers that deliberately have no manifest.
 */
export function catalogCoverageErrors(
  toolNames: readonly string[],
  controlToolNames: readonly string[],
): string[] {
  const errors: string[] = []
  const tools = new Set(toolNames)
  const controls = new Set(controlToolNames)
  const actionTools = new Set(MEDIA_ACTION_MANIFESTS.map(action => action.invoke.toolName))

  for (const tool of actionTools) {
    if (!tools.has(tool)) errors.push(`action tool "${tool}" is not exposed`)
  }
  for (const tool of tools) {
    if (!actionTools.has(tool) && !controls.has(tool)) {
      errors.push(`tool "${tool}" is neither an action trigger nor an allow-listed control tool`)
    }
  }
  for (const tool of controls) {
    if (!tools.has(tool)) errors.push(`allow-listed control tool "${tool}" is not exposed`)
  }
  for (const action of availableActions()) {
    if (!tools.has(action.invoke.toolName)) {
      errors.push(`available action "${action.id}" has no exposed tool`)
    }
  }

  return errors
}

/**
 * Compare a `media_create_task` type enum against available create actions.
 * Declared-but-unavailable types (M2/M4) must never leak into the enum.
 */
export function createTypeEnumErrors(typeEnum: readonly unknown[]): string[] {
  const errors: string[] = []
  const expected = new Set(availableCreateTypes())
  const actual = new Set(typeEnum.filter((value): value is string => typeof value === 'string'))

  for (const type of expected) {
    if (!actual.has(type)) errors.push(`available create type "${type}" is missing from the tool enum`)
  }
  for (const type of actual) {
    if (!expected.has(type)) errors.push(`create type "${type}" has no available action`)
  }

  return errors
}
