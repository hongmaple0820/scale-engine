import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { ExecutionLedger, type ExecutionEvent } from '../runtime/ExecutionLedger.js'

export type AgentOsBridgeKind = 'dashboard' | 'tui' | 'desktop' | 'im' | 'remote-agent' | 'connector'
export type AgentOsBridgeStatus = 'registered' | 'online' | 'stale' | 'revoked'

export interface AgentOsBridgeRegistration {
  version: 1
  bridgeId: string
  name: string
  kind: AgentOsBridgeKind
  status: AgentOsBridgeStatus
  endpoint?: string
  tokenHash: string
  scopes: string[]
  capabilityIds: string[]
  registeredAt: string
  updatedAt: string
  lastHeartbeatAt?: string
  metadata: Record<string, unknown>
}

export interface AgentOsBridgeRegistryState {
  version: 1
  updatedAt: string
  bridges: AgentOsBridgeRegistration[]
}

export interface AgentOsBridgeRegistryOptions {
  projectDir?: string
  scaleDir?: string
  now?: () => Date
  ledger?: ExecutionLedger
}

export interface RegisterAgentOsBridgeInput {
  bridgeId?: string
  name: string
  kind?: AgentOsBridgeKind
  endpoint?: string
  token?: string
  scopes?: string[]
  capabilityIds?: string[]
  metadata?: Record<string, unknown>
}

export interface RegisterAgentOsBridgeResult {
  bridge: AgentOsBridgeRegistration
  token: string
  event: ExecutionEvent
}

export interface AgentOsBridgeHeartbeatResult {
  bridge: AgentOsBridgeRegistration
  event: ExecutionEvent
}

const DEFAULT_SCOPES = ['tasks:read', 'events:read']

export class AgentOsBridgeRegistry {
  private projectDir: string
  private path: string
  private now: () => Date
  private ledger: ExecutionLedger

  constructor(options: AgentOsBridgeRegistryOptions = {}) {
    this.projectDir = resolve(options.projectDir ?? process.cwd())
    const scaleRoot = isAbsolute(options.scaleDir ?? '')
      ? options.scaleDir as string
      : join(this.projectDir, options.scaleDir ?? '.scale')
    this.path = join(scaleRoot, 'bridges.json')
    this.now = options.now ?? (() => new Date())
    this.ledger = options.ledger ?? new ExecutionLedger({
      projectDir: this.projectDir,
      scaleDir: scaleRoot,
      now: this.now,
    })
  }

  register(input: RegisterAgentOsBridgeInput): RegisterAgentOsBridgeResult {
    const state = this.load()
    const now = this.isoNow()
    const token = input.token?.trim() || `scale-bridge-${randomUUID()}`
    const bridgeId = input.bridgeId?.trim() || `BRIDGE-${randomUUID().slice(0, 8)}`
    const bridge: AgentOsBridgeRegistration = {
      version: 1,
      bridgeId,
      name: input.name,
      kind: normalizeBridgeKind(input.kind),
      status: 'registered',
      endpoint: input.endpoint,
      tokenHash: hashToken(token),
      scopes: unique(input.scopes ?? DEFAULT_SCOPES),
      capabilityIds: unique(input.capabilityIds ?? []),
      registeredAt: now,
      updatedAt: now,
      metadata: input.metadata ?? {},
    }
    this.save({
      version: 1,
      updatedAt: now,
      bridges: [
        ...state.bridges.filter(item => item.bridgeId !== bridge.bridgeId),
        bridge,
      ].sort((a, b) => a.bridgeId.localeCompare(b.bridgeId)),
    })
    const event = this.ledger.record({
      agentId: bridge.bridgeId,
      sessionId: bridge.bridgeId,
      type: 'bridge.registered',
      summary: `Registered Agent OS bridge ${bridge.name}`,
      metadata: {
        bridgeId: bridge.bridgeId,
        kind: bridge.kind,
        scopes: bridge.scopes,
        capabilityIds: bridge.capabilityIds,
      },
    })
    return { bridge, token, event }
  }

  heartbeat(bridgeId: string, token?: string): AgentOsBridgeHeartbeatResult {
    const state = this.load()
    const bridge = state.bridges.find(item => item.bridgeId === bridgeId)
    if (!bridge) throw new Error(`Agent OS bridge not found: ${bridgeId}`)
    if (bridge.status === 'revoked') throw new Error(`Agent OS bridge is revoked: ${bridgeId}`)
    if (token && hashToken(token) !== bridge.tokenHash) throw new Error(`Invalid bridge token for ${bridgeId}`)
    const now = this.isoNow()
    const updated: AgentOsBridgeRegistration = {
      ...bridge,
      status: 'online',
      updatedAt: now,
      lastHeartbeatAt: now,
    }
    this.save({
      version: 1,
      updatedAt: now,
      bridges: state.bridges.map(item => item.bridgeId === bridgeId ? updated : item),
    })
    const event = this.ledger.record({
      agentId: bridgeId,
      sessionId: bridgeId,
      type: 'bridge.heartbeat',
      summary: `Heartbeat from Agent OS bridge ${bridge.name}`,
      metadata: {
        bridgeId,
        kind: bridge.kind,
        scopes: bridge.scopes,
      },
    })
    return { bridge: updated, event }
  }

  list(): AgentOsBridgeRegistration[] {
    return this.load().bridges
  }

  load(): AgentOsBridgeRegistryState {
    if (!existsSync(this.path)) {
      return { version: 1, updatedAt: this.isoNow(), bridges: [] }
    }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf-8')) as Partial<AgentOsBridgeRegistryState>
      return {
        version: 1,
        updatedAt: String(parsed.updatedAt ?? this.isoNow()),
        bridges: Array.isArray(parsed.bridges)
          ? parsed.bridges.map(item => normalizeBridge(item))
          : [],
      }
    } catch {
      return { version: 1, updatedAt: this.isoNow(), bridges: [] }
    }
  }

  getPath(): string {
    return this.path
  }

  private save(state: AgentOsBridgeRegistryState): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, `${JSON.stringify(state, null, 2)}\n`, 'utf-8')
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}

export function verifyAgentOsBridgeToken(bridge: AgentOsBridgeRegistration, token: string): boolean {
  return hashToken(token) === bridge.tokenHash
}

function normalizeBridge(raw: Partial<AgentOsBridgeRegistration>): AgentOsBridgeRegistration {
  const now = new Date(0).toISOString()
  return {
    version: 1,
    bridgeId: String(raw.bridgeId ?? 'BRIDGE-UNKNOWN'),
    name: String(raw.name ?? raw.bridgeId ?? 'Bridge'),
    kind: normalizeBridgeKind(raw.kind),
    status: normalizeBridgeStatus(raw.status),
    endpoint: raw.endpoint,
    tokenHash: String(raw.tokenHash ?? ''),
    scopes: unique(raw.scopes ?? DEFAULT_SCOPES),
    capabilityIds: unique(raw.capabilityIds ?? []),
    registeredAt: String(raw.registeredAt ?? now),
    updatedAt: String(raw.updatedAt ?? raw.registeredAt ?? now),
    lastHeartbeatAt: raw.lastHeartbeatAt,
    metadata: isRecord(raw.metadata) ? raw.metadata : {},
  }
}

function normalizeBridgeKind(value: unknown): AgentOsBridgeKind {
  const normalized = String(value ?? 'connector')
  const kinds: AgentOsBridgeKind[] = ['dashboard', 'tui', 'desktop', 'im', 'remote-agent', 'connector']
  return kinds.includes(normalized as AgentOsBridgeKind) ? normalized as AgentOsBridgeKind : 'connector'
}

function normalizeBridgeStatus(value: unknown): AgentOsBridgeStatus {
  const normalized = String(value ?? 'registered')
  const statuses: AgentOsBridgeStatus[] = ['registered', 'online', 'stale', 'revoked']
  return statuses.includes(normalized as AgentOsBridgeStatus) ? normalized as AgentOsBridgeStatus : 'registered'
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function unique(items: string[]): string[] {
  return [...new Set(items.map(item => item.trim()).filter(Boolean))]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
