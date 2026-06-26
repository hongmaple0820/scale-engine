import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import yaml from 'js-yaml'
import { buildFeishuSendMessageCommand, type FeishuCommandPlan } from '../communication/FeishuChannelProvider.js'

export type LoopRegistrySource = 'default' | 'config'
export type LoopRiskLevel = 'read-only' | 'approval-required' | 'write-capable'

export interface LoopPolicy {
  riskLevel: LoopRiskLevel
  dryRunDefault: boolean
  requiresApproval: boolean
  allowWrite: boolean
  evidenceRequired: boolean
  timeoutSeconds?: number
  debounceSeconds?: number
}

export interface LoopActionDefinition {
  type: string
  provider?: string
  description: string
  command?: string
  target?: string
}

export interface LoopDefinition {
  id: string
  name: string
  description: string
  enabled: boolean
  events: string[]
  policy: LoopPolicy
  actions: LoopActionDefinition[]
}

export interface LoopRegistry {
  projectDir: string
  scaleDir: string
  configPath: string
  configExists: boolean
  source: LoopRegistrySource
  loops: LoopDefinition[]
  warnings: string[]
}

export interface LoopSummary {
  id: string
  name: string
  description: string
  enabled: boolean
  eventTypes: string[]
  riskLevel: LoopRiskLevel
  dryRunDefault: boolean
  requiresApproval: boolean
  allowWrite: boolean
  providers: string[]
  actionTypes: string[]
}

export interface LoopListReport {
  ok: true
  projectDir: string
  scaleDir: string
  configPath: string
  configExists: boolean
  source: LoopRegistrySource
  count: number
  loops: LoopSummary[]
  warnings: string[]
}

export interface LoopStatusReport extends LoopListReport {
  enabledCount: number
  disabledCount: number
  requiredProviders: string[]
  safety: {
    dryRunDefault: boolean
    liveExecutionEnabled: boolean
    destructiveActionsBlocked: boolean
  }
}

export interface LoopInitReport {
  ok: true
  path: string
  existed: boolean
  written: boolean
  loopCount: number
  nextCommands: string[]
  warnings: string[]
}

export interface PlannedLoopAction {
  type: string
  provider?: string
  description: string
  command?: string
  target?: string
  live: boolean
  reason: string
  commandPlan?: FeishuCommandPlan
}

export interface LoopRunReport {
  ok: boolean
  error?: string
  id?: string
  projectDir: string
  scaleDir: string
  loop?: LoopSummary
  loopId: string
  eventType?: string
  dryRun: boolean
  plannedActions: PlannedLoopAction[]
  evidencePath?: string
  warnings: string[]
  createdAt: string
}

export interface LoopRegistryOptions {
  projectDir?: string
  scaleDir?: string
}

export interface LoopInitOptions extends LoopRegistryOptions {
  force?: boolean
}

export interface LoopRunInput extends LoopRegistryOptions {
  loopId: string
  eventType?: string
  dryRun?: boolean
  feishuChatId?: string
  feishuUserId?: string
  notificationText?: string
}

const DEFAULT_LOOP_DEFINITIONS: LoopDefinition[] = [
  {
    id: 'attention.permission-needed',
    name: 'Permission and attention notifier',
    description: 'Notify the user when an agent is waiting for approval, input, or long-task attention.',
    enabled: true,
    events: ['permission-needed', 'waiting-for-user', 'long-task-finished', 'task-failed'],
    policy: {
      riskLevel: 'read-only',
      dryRunDefault: true,
      requiresApproval: false,
      allowWrite: false,
      evidenceRequired: true,
      timeoutSeconds: 30,
      debounceSeconds: 10,
    },
    actions: [
      {
        type: 'notify',
        provider: 'feishu',
        description: 'Send a short project/mobile notification through Feishu/Lark after target confirmation.',
      },
      {
        type: 'notify',
        provider: 'desktop',
        description: 'Emit a local desktop notification for immediate attention.',
      },
    ],
  },
  {
    id: 'context.summary-card',
    name: 'Context summary card',
    description: 'Create a compact work diary before context loss or after a task completes, then stage it as a memory candidate.',
    enabled: true,
    events: ['pre-compact', 'task-finished', 'session-end'],
    policy: {
      riskLevel: 'approval-required',
      dryRunDefault: true,
      requiresApproval: true,
      allowWrite: false,
      evidenceRequired: true,
      timeoutSeconds: 120,
    },
    actions: [
      {
        type: 'summary-card',
        provider: 'scale',
        description: 'Render a concise summary card with decisions, changed files, blockers, and next actions.',
      },
      {
        type: 'memory-candidate',
        provider: 'gbrain',
        description: 'Stage reviewed summary content for external-first memory routing without direct write.',
      },
    ],
  },
  {
    id: 'quality.post-edit-verify',
    name: 'Post-edit quality guard',
    description: 'Run hook-safe governance checks after edits and before stopping so quality loops stay evidence-backed.',
    enabled: true,
    events: ['post-edit', 'post-command', 'before-stop'],
    policy: {
      riskLevel: 'read-only',
      dryRunDefault: true,
      requiresApproval: false,
      allowWrite: false,
      evidenceRequired: true,
      timeoutSeconds: 60,
    },
    actions: [
      {
        type: 'gate-check',
        provider: 'scale',
        command: 'scale gate before-stop --hook-safe',
        description: 'Schedule the hook-safe before-stop gate without initializing the full artifact engine.',
      },
    ],
  },
]

export function loadLoopRegistry(options: LoopRegistryOptions = {}): LoopRegistry {
  const projectDir = resolve(options.projectDir ?? process.env.SCALE_PROJECT_DIR ?? process.cwd())
  const scaleDir = resolveScaleDir(projectDir, options.scaleDir ?? process.env.SCALE_DIR ?? '.scale')
  const configPath = join(scaleDir, 'loops.yaml')
  if (!existsSync(configPath)) {
    return {
      projectDir,
      scaleDir,
      configPath,
      configExists: false,
      source: 'default',
      loops: DEFAULT_LOOP_DEFINITIONS.map(cloneLoop),
      warnings: [],
    }
  }

  const parsed = yaml.load(readFileSync(configPath, 'utf-8'))
  const root = asRecord(parsed)
  const rawLoops = Array.isArray(root?.loops) ? root.loops : []
  const warnings: string[] = []
  if (!root) warnings.push('loops.yaml did not parse to an object; using no configured loops')
  if (root && rawLoops.length === 0) warnings.push('loops.yaml has no loops entries')

  return {
    projectDir,
    scaleDir,
    configPath,
    configExists: true,
    source: 'config',
    loops: rawLoops.map((item, index) => normalizeLoopDefinition(item, index)),
    warnings,
  }
}

export function createLoopListReport(options: LoopRegistryOptions = {}): LoopListReport {
  const registry = loadLoopRegistry(options)
  return {
    ok: true,
    projectDir: registry.projectDir,
    scaleDir: registry.scaleDir,
    configPath: registry.configPath,
    configExists: registry.configExists,
    source: registry.source,
    count: registry.loops.length,
    loops: registry.loops.map(summarizeLoop),
    warnings: registry.warnings,
  }
}

export function writeDefaultLoopConfig(options: LoopInitOptions = {}): LoopInitReport {
  const projectDir = resolve(options.projectDir ?? process.env.SCALE_PROJECT_DIR ?? process.cwd())
  const scaleDir = resolveScaleDir(projectDir, options.scaleDir ?? process.env.SCALE_DIR ?? '.scale')
  const path = join(scaleDir, 'loops.yaml')
  const existed = existsSync(path)
  const warnings: string[] = []
  let written = false

  if (!existed || options.force) {
    if (!existsSync(scaleDir)) mkdirSync(scaleDir, { recursive: true })
    writeFileSync(path, renderDefaultLoopConfig(), 'utf-8')
    written = true
  } else {
    warnings.push('loops.yaml already exists; pass --force to overwrite with defaults')
  }

  return {
    ok: true,
    path,
    existed,
    written,
    loopCount: DEFAULT_LOOP_DEFINITIONS.length,
    nextCommands: [
      'scale loop status --json',
      'scale loop run attention.permission-needed --event permission-needed --json',
    ],
    warnings,
  }
}

export function createLoopStatusReport(options: LoopRegistryOptions = {}): LoopStatusReport {
  const list = createLoopListReport(options)
  const requiredProviders = sortedUnique(list.loops.flatMap(loop => loop.providers))
  return {
    ...list,
    enabledCount: list.loops.filter(loop => loop.enabled).length,
    disabledCount: list.loops.filter(loop => !loop.enabled).length,
    requiredProviders,
    safety: {
      dryRunDefault: list.loops.every(loop => loop.dryRunDefault),
      liveExecutionEnabled: false,
      destructiveActionsBlocked: true,
    },
  }
}

export function runLoop(input: LoopRunInput): LoopRunReport {
  const registry = loadLoopRegistry(input)
  const loop = registry.loops.find(candidate => candidate.id === input.loopId)
  const createdAt = new Date().toISOString()
  const base = {
    projectDir: registry.projectDir,
    scaleDir: registry.scaleDir,
    loopId: input.loopId,
    dryRun: input.dryRun ?? true,
    plannedActions: [],
    warnings: [...registry.warnings],
    createdAt,
  }

  if (!loop) {
    return {
      ...base,
      ok: false,
      error: `Loop ${input.loopId} was not found.`,
    }
  }

  if (!loop.enabled) {
    return {
      ...base,
      ok: false,
      loop: summarizeLoop(loop),
      error: `Loop ${loop.id} is disabled.`,
    }
  }

  const eventType = input.eventType?.trim() || loop.events[0]
  if (!eventType || !loop.events.includes(eventType)) {
    return {
      ...base,
      ok: false,
      loop: summarizeLoop(loop),
      eventType,
      error: `Loop ${loop.id} does not handle event ${eventType || '<empty>'}.`,
    }
  }

  const dryRun = input.dryRun ?? loop.policy.dryRunDefault
  if (!dryRun) {
    return {
      ...base,
      ok: false,
      loop: summarizeLoop(loop),
      eventType,
      dryRun,
      error: 'Live loop execution is not enabled in this MVP. Use dry-run evidence first.',
    }
  }

  const actionPlan = planLoopActions(loop, eventType, input)
  if (actionPlan.error) {
    return {
      ...base,
      ok: false,
      loop: summarizeLoop(loop),
      eventType,
      dryRun,
      warnings: [...base.warnings, ...actionPlan.warnings],
      error: actionPlan.error,
    }
  }

  const plannedActions = actionPlan.actions
  const warnings = [...registry.warnings, ...actionPlan.warnings, 'dry-run only: no live provider call was made']
  const record: LoopRunReport = {
    ok: true,
    id: `LOOP-${Date.now()}-${randomUUID().slice(0, 8)}`,
    projectDir: registry.projectDir,
    scaleDir: registry.scaleDir,
    loop: summarizeLoop(loop),
    loopId: loop.id,
    eventType,
    dryRun,
    plannedActions,
    warnings,
    createdAt,
  }
  record.evidencePath = writeLoopRunEvidence(registry.scaleDir, record)
  return record
}

function planLoopActions(loop: LoopDefinition, eventType: string, input: LoopRunInput): {
  actions: PlannedLoopAction[]
  warnings: string[]
  error?: string
} {
  const warnings: string[] = []
  const actions: PlannedLoopAction[] = []

  for (const action of loop.actions) {
    const planned: PlannedLoopAction = {
      type: action.type,
      provider: action.provider,
      description: action.description,
      command: action.command,
      target: action.target,
      live: false,
      reason: 'dry-run: action was planned but not executed',
    }

    if (action.type === 'notify' && action.provider === 'feishu') {
      const target = resolveFeishuTarget(input)
      if (!target) {
        warnings.push('Feishu target is not configured; pass --feishu-chat-id or --feishu-user-id to build a lark-cli send plan.')
      } else if (target.error) {
        return { actions, warnings, error: target.error }
      } else {
        planned.commandPlan = buildFeishuSendMessageCommand({
          ...target,
          text: input.notificationText?.trim() || defaultNotificationText(loop.id, eventType),
          as: 'bot',
          dryRun: true,
        })
      }
    }

    actions.push(planned)
  }

  return { actions, warnings }
}

function resolveFeishuTarget(input: LoopRunInput): { chatId?: string; userId?: string; error?: string } | null {
  const chatId = input.feishuChatId?.trim()
  const userId = input.feishuUserId?.trim()
  if (chatId && userId) return { error: 'Exactly one of --feishu-chat-id or --feishu-user-id is allowed.' }
  if (chatId) return { chatId }
  if (userId) return { userId }
  return null
}

function defaultNotificationText(loopId: string, eventType: string): string {
  return `SCALE Loop ${loopId} triggered by ${eventType}. Dry-run evidence only; confirm the Feishu target before live delivery.`
}

export function renderLoopList(report: LoopListReport): string {
  const lines = [
    'SCALE Loop Registry',
    `  Source: ${report.source}${report.configExists ? ` (${report.configPath})` : ' (built-in defaults)'}`,
    `  Loops: ${report.count}`,
  ]
  for (const loop of report.loops) {
    lines.push(`  - ${loop.id} [${loop.enabled ? 'enabled' : 'disabled'}] ${loop.eventTypes.join(', ')}`)
    lines.push(`    risk=${loop.riskLevel}; providers=${loop.providers.join(', ') || 'none'}; dryRun=${loop.dryRunDefault}`)
  }
  for (const warning of report.warnings) lines.push(`  warning: ${warning}`)
  return lines.join('\n')
}

export function renderLoopStatus(report: LoopStatusReport): string {
  return [
    renderLoopList(report),
    `  Enabled: ${report.enabledCount}`,
    `  Disabled: ${report.disabledCount}`,
    `  Required providers: ${report.requiredProviders.join(', ') || 'none'}`,
    `  Live execution: ${report.safety.liveExecutionEnabled ? 'enabled' : 'disabled'}`,
    `  Destructive actions: ${report.safety.destructiveActionsBlocked ? 'blocked' : 'allowed'}`,
  ].join('\n')
}

export function renderLoopRun(report: LoopRunReport): string {
  if (!report.ok) return `SCALE Loop Run failed: ${report.error ?? 'unknown error'}`
  const lines = [
    `SCALE Loop Run: ${report.loopId}`,
    `  Event: ${report.eventType ?? 'n/a'}`,
    `  Dry-run: ${report.dryRun}`,
    `  Evidence: ${report.evidencePath ?? 'not written'}`,
  ]
  for (const action of report.plannedActions) {
    const provider = action.provider ? ` via ${action.provider}` : ''
    lines.push(`  - ${action.type}${provider}: ${action.reason}`)
  }
  for (const warning of report.warnings) lines.push(`  warning: ${warning}`)
  return lines.join('\n')
}

function writeLoopRunEvidence(scaleDir: string, record: LoopRunReport): string {
  const dir = join(scaleDir, 'evidence', 'loop-runs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const path = join(dir, `${record.id}.json`)
  writeFileSync(path, JSON.stringify(record, null, 2), 'utf-8')
  return path
}

function renderDefaultLoopConfig(): string {
  return yaml.dump({
    version: 1,
    loops: DEFAULT_LOOP_DEFINITIONS,
  }, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  })
}

function normalizeLoopDefinition(value: unknown, index: number): LoopDefinition {
  const record = asRecord(value)
  if (!record) throw new Error(`loops[${index}] must be an object`)
  const id = nonEmpty(record.id) ?? `loop-${index + 1}`
  const policyRecord = asRecord(record.policy)
  const riskLevel = normalizeRiskLevel(policyRecord?.riskLevel)
  const requiresApproval = booleanValue(policyRecord?.requiresApproval, riskLevel !== 'read-only')
  const loop: LoopDefinition = {
    id,
    name: nonEmpty(record.name) ?? id,
    description: nonEmpty(record.description) ?? 'Project-defined loop.',
    enabled: booleanValue(record.enabled, true),
    events: normalizeEvents(record.events ?? record.event),
    policy: {
      riskLevel,
      dryRunDefault: booleanValue(policyRecord?.dryRunDefault, true),
      requiresApproval,
      allowWrite: booleanValue(policyRecord?.allowWrite, false),
      evidenceRequired: booleanValue(policyRecord?.evidenceRequired, true),
      timeoutSeconds: positiveInt(policyRecord?.timeoutSeconds),
      debounceSeconds: positiveInt(policyRecord?.debounceSeconds),
    },
    actions: normalizeActions(record.actions),
  }
  if (loop.events.length === 0) throw new Error(`Loop ${id} must declare at least one event`)
  if (loop.actions.length === 0) throw new Error(`Loop ${id} must declare at least one action`)
  return loop
}

function normalizeEvents(value: unknown): string[] {
  if (Array.isArray(value)) return sortedUnique(value.map(item => String(item).trim()).filter(Boolean))
  const eventRecord = asRecord(value)
  if (eventRecord) {
    const type = nonEmpty(eventRecord.type)
    return type ? [type] : []
  }
  const single = nonEmpty(value)
  return single ? [single] : []
}

function normalizeActions(value: unknown): LoopActionDefinition[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    const record = asRecord(item)
    if (!record) throw new Error(`actions[${index}] must be an object`)
    const type = nonEmpty(record.type)
    if (!type) throw new Error(`actions[${index}].type is required`)
    return {
      type,
      provider: nonEmpty(record.provider),
      description: nonEmpty(record.description) ?? type,
      command: nonEmpty(record.command),
      target: nonEmpty(record.target),
    }
  })
}

function summarizeLoop(loop: LoopDefinition): LoopSummary {
  return {
    id: loop.id,
    name: loop.name,
    description: loop.description,
    enabled: loop.enabled,
    eventTypes: [...loop.events],
    riskLevel: loop.policy.riskLevel,
    dryRunDefault: loop.policy.dryRunDefault,
    requiresApproval: loop.policy.requiresApproval,
    allowWrite: loop.policy.allowWrite,
    providers: sortedUnique(loop.actions.map(action => action.provider).filter((provider): provider is string => Boolean(provider))),
    actionTypes: sortedUnique(loop.actions.map(action => action.type)),
  }
}

function cloneLoop(loop: LoopDefinition): LoopDefinition {
  return {
    ...loop,
    events: [...loop.events],
    policy: { ...loop.policy },
    actions: loop.actions.map(action => ({ ...action })),
  }
}

function resolveScaleDir(projectDir: string, scaleDir: string): string {
  return isAbsolute(scaleDir) ? scaleDir : resolve(projectDir, scaleDir)
}

function normalizeRiskLevel(value: unknown): LoopRiskLevel {
  const normalized = String(value ?? 'read-only').trim()
  if (normalized === 'read-only' || normalized === 'approval-required' || normalized === 'write-capable') return normalized
  return 'read-only'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function nonEmpty(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim()
  return normalized ? normalized : undefined
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback
  return value === true || value === 'true' || value === '1'
}

function positiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort()
}
