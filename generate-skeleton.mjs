#!/usr/bin/env node
// One-shot file generator. Run: node generate-skeleton.mjs
// Creates all remaining SCALE Engine code skeleton files.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

const ROOT = 'F:/project/work/maple-cart-mall/3d-car-mall/scale-engine'

const FILES = {
  // -------------------------------------------------------------------
  // package.json + tsconfig
  // -------------------------------------------------------------------
  'package.json': JSON.stringify({
    name: 'scale-engine',
    version: '0.1.0-alpha',
    description: 'AI engineering scaffold engine: artifacts, FSM, guardrails, knowledge, evolution',
    type: 'module',
    bin: { scale: './dist/api/cli.js' },
    main: './dist/index.js',
    types: './dist/index.d.ts',
    files: ['dist'],
    scripts: {
      build: 'tsc',
      dev: 'bun --watch src/api/cli.ts',
      test: 'vitest',
      typecheck: 'tsc --noEmit',
      lint: 'eslint src/**/*.ts',
      mcp: 'node dist/api/mcp.js',
      serve: 'node dist/api/http.js',
    },
    dependencies: {
      'better-sqlite3': '^11.0.0',
      'drizzle-orm': '^0.32.0',
      'hono': '^4.5.0',
      'citty': '^0.1.6',
      'pino': '^9.3.0',
      'pino-pretty': '^11.2.0',
      'zod': '^3.23.0',
      'execa': '^9.3.0',
      '@modelcontextprotocol/sdk': '^1.0.0',
      'chokidar': '^3.6.0',
      'js-yaml': '^4.1.0',
    },
    devDependencies: {
      typescript: '^5.5.0',
      vitest: '^2.0.0',
      '@types/node': '^20.14.0',
      '@types/better-sqlite3': '^7.6.0',
      '@types/js-yaml': '^4.0.9',
      eslint: '^9.0.0',
    },
    engines: { node: '>=20.0.0' },
  }, null, 2) + '\n',

  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      resolveJsonModule: true,
      declaration: true,
      sourceMap: true,
      outDir: './dist',
      rootDir: './src',
      forceConsistentCasingInFileNames: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      noFallthroughCasesInSwitch: true,
      isolatedModules: true,
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist', 'tests'],
  }, null, 2) + '\n',

  // -------------------------------------------------------------------
  // Core: Logger + Container + EventBus
  // -------------------------------------------------------------------
  'src/core/logger.ts': `// SCALE Engine — Logger
import pino from 'pino'

export const logger = pino({
  level: process.env.SCALE_LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l' },
        },
})

export type Logger = typeof logger
`,

  'src/core/container.ts': `// SCALE Engine — Dependency Injection
// 极简 DI：避免循环依赖，方便测试时替换实现

export type Token<T> = symbol & { __type__?: T }

export function createToken<T>(name: string): Token<T> {
  return Symbol(name) as Token<T>
}

export class Container {
  private instances = new Map<symbol, unknown>()
  private factories = new Map<symbol, () => unknown>()

  register<T>(token: Token<T>, factory: () => T): void {
    this.factories.set(token, factory)
  }

  registerInstance<T>(token: Token<T>, instance: T): void {
    this.instances.set(token, instance)
  }

  resolve<T>(token: Token<T>): T {
    if (this.instances.has(token)) return this.instances.get(token) as T
    const factory = this.factories.get(token)
    if (!factory) throw new Error(\`No registration for token: \${token.toString()}\`)
    const instance = factory() as T
    this.instances.set(token, instance)
    return instance
  }

  has(token: symbol): boolean {
    return this.instances.has(token) || this.factories.has(token)
  }

  reset(): void {
    this.instances.clear()
  }
}

export const container = new Container()
`,

  'src/core/eventBus.ts': `// SCALE Engine — Event Bus
// 系统的"神经系统"。所有模块通过它解耦。
// 内存 pub/sub + JSONL 持久化 + 重放能力。
// 设计参考：docs/03-CORE-MODULES.md §3.1

import type { Event, EventType, EventId, Actor, ArtifactId, SessionId, Timestamp } from '../artifact/types.js'
import { logger } from './logger.js'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export type EventHandler<T = unknown> = (event: Event<T>) => void | Promise<void>
export interface Subscription { unsubscribe(): void }

export interface EmitOptions {
  sessionId?: SessionId
  actor?: Actor
  artifactId?: ArtifactId
  causedBy?: EventId
  correlationId?: string
}

export interface ReplayFilter {
  fromTimestamp?: Timestamp
  toTimestamp?: Timestamp
  types?: EventType[]
  sessionId?: SessionId
  artifactId?: ArtifactId
}

export interface QueryFilter extends ReplayFilter {
  limit?: number
  filter?: (event: Event) => boolean
}

export type EventMiddleware = (event: Event) => Event | null

export interface IEventBus {
  on<T = unknown>(type: EventType | '*', handler: EventHandler<T>): Subscription
  once<T = unknown>(type: EventType, handler: EventHandler<T>): void
  emit<T = unknown>(type: EventType, payload: T, opts?: EmitOptions): Event<T>
  emitAsync<T = unknown>(type: EventType, payload: T, opts?: EmitOptions): Promise<Event<T>>
  use(middleware: EventMiddleware): void
  replay(filter: ReplayFilter, handler: EventHandler): Promise<void>
  query(filter: QueryFilter): Promise<Event[]>
  flush(): Promise<void>
}

export class EventBus implements IEventBus {
  private handlers = new Map<EventType | '*', Set<EventHandler>>()
  private middlewares: EventMiddleware[] = []
  private memoryRing: Event[] = []
  private maxRingSize = 1000
  private seq = 0
  private eventsDir: string

  constructor(opts: { eventsDir?: string } = {}) {
    this.eventsDir = opts.eventsDir ?? '.scale/events'
    if (!existsSync(this.eventsDir)) mkdirSync(this.eventsDir, { recursive: true })
  }

  on<T>(type: EventType | '*', handler: EventHandler<T>): Subscription {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    const handlers = this.handlers.get(type)!
    handlers.add(handler as EventHandler)
    return { unsubscribe: () => { handlers.delete(handler as EventHandler); if (handlers.size === 0) this.handlers.delete(type) } }
  }

  once<T>(type: EventType, handler: EventHandler<T>): void {
    const sub = this.on<T>(type, (e) => { sub.unsubscribe(); handler(e) })
  }

  use(mw: EventMiddleware): void { this.middlewares.push(mw) }

  emit<T>(type: EventType, payload: T, opts: EmitOptions = {}): Event<T> {
    const event: Event<T> = Object.freeze({
      id: this.generateId(),
      type, timestamp: Date.now(),
      sessionId: opts.sessionId ?? 'system',
      actor: opts.actor ?? { kind: 'system', component: 'EventBus' },
      artifactId: opts.artifactId, payload,
      causedBy: opts.causedBy, correlationId: opts.correlationId,
    })
    let processed: Event<T> | null = event
    for (const mw of this.middlewares) {
      processed = mw(processed) as Event<T> | null
      if (!processed) return event
    }
    this.persist(processed); this.pushToRing(processed); this.dispatchAsync(processed)
    return processed
  }

  async emitAsync<T>(type: EventType, payload: T, opts?: EmitOptions): Promise<Event<T>> {
    const event = this.emit(type, payload, opts)
    await this.dispatchSync(event)
    return event
  }

  async replay(filter: ReplayFilter, handler: EventHandler): Promise<void> {
    for (const file of this.getEventFiles(filter)) {
      const lines = readFileSync(file, 'utf-8').split('\\n').filter(Boolean)
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as Event
          if (this.matchesFilter(event, filter)) await handler(event)
        } catch (e) { logger.warn({ file, error: (e as Error).message }, 'Failed to parse event') }
      }
    }
  }

  async query(filter: QueryFilter): Promise<Event[]> {
    const results: Event[] = []
    const limit = filter.limit ?? 1000
    for (let i = this.memoryRing.length - 1; i >= 0; i--) {
      const event = this.memoryRing[i]
      if (this.matchesFilter(event, filter) && (!filter.filter || filter.filter(event))) {
        results.push(event); if (results.length >= limit) return results
      }
    }
    if (results.length < limit) {
      await this.replay(filter, (event) => {
        if (results.length >= limit) return
        if (!filter.filter || filter.filter(event)) {
          if (!results.find((r) => r.id === event.id)) results.push(event)
        }
      })
    }
    return results.slice(0, limit)
  }

  async flush(): Promise<void> { /* sync append */ }

  private generateId(): EventId {
    this.seq = (this.seq + 1) % 100000
    return \`EVT-\${Date.now()}-\${this.seq.toString().padStart(5, '0')}\`
  }

  private persist(event: Event): void {
    const date = new Date(event.timestamp).toISOString().slice(0, 10)
    const file = join(this.eventsDir, \`\${date}.jsonl\`)
    try { appendFileSync(file, JSON.stringify(event) + '\\n', 'utf-8') }
    catch (e) { logger.error({ event: event.id, error: (e as Error).message }, 'Failed to persist event') }
  }

  private pushToRing(event: Event): void {
    this.memoryRing.push(event)
    if (this.memoryRing.length > this.maxRingSize) this.memoryRing.shift()
  }

  private dispatchAsync(event: Event): void { setImmediate(() => this.dispatchSync(event)) }

  private async dispatchSync(event: Event): Promise<void> {
    const handlers = [...(this.handlers.get(event.type) ?? []), ...(this.handlers.get('*') ?? [])]
    for (const handler of handlers) {
      try { await handler(event) }
      catch (e) { logger.error({ event: event.id, type: event.type, error: (e as Error).message }, 'Event handler threw') }
    }
  }

  private getEventFiles(filter: ReplayFilter): string[] {
    if (!existsSync(this.eventsDir)) return []
    const all = readdirSync(this.eventsDir).filter((f) => f.endsWith('.jsonl')).sort()
    if (!filter.fromTimestamp && !filter.toTimestamp) return all.map((f) => join(this.eventsDir, f))
    return all.filter((f) => {
      const date = f.replace('.jsonl', '')
      const fileStart = new Date(date).getTime()
      const fileEnd = fileStart + 24 * 60 * 60 * 1000
      if (filter.fromTimestamp && fileEnd < filter.fromTimestamp) return false
      if (filter.toTimestamp && fileStart > filter.toTimestamp) return false
      return true
    }).map((f) => join(this.eventsDir, f))
  }

  private matchesFilter(event: Event, filter: ReplayFilter): boolean {
    if (filter.fromTimestamp && event.timestamp < filter.fromTimestamp) return false
    if (filter.toTimestamp && event.timestamp > filter.toTimestamp) return false
    if (filter.types && !filter.types.includes(event.type)) return false
    if (filter.sessionId && event.sessionId !== filter.sessionId) return false
    if (filter.artifactId && event.artifactId !== filter.artifactId) return false
    return true
  }
}
`,

  // -------------------------------------------------------------------
  // Artifact Store (W3 完整 SQLite 实现，此处先内存版骨架)
  // -------------------------------------------------------------------
  'src/artifact/store.ts': `// SCALE Engine — Artifact Store (内存版骨架, W3 升级 SQLite)
// 设计参考：docs/03-CORE-MODULES.md §3.2

import type { Artifact, ArtifactType, Gate, ArtifactId } from './types.js'
import { ArtifactNotFoundError } from './types.js'
import type { IEventBus } from '../core/eventBus.js'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

export interface CreateArtifactInput {
  type: ArtifactType
  title: string
  payload: unknown
  parents?: ArtifactId[]
  tags?: string[]
  labels?: Record<string, string>
  createdBy?: import('./types.js').Actor
  initialStatus?: string
  contentBody?: string
}

export interface ArtifactFilter {
  type?: ArtifactType | ArtifactType[]
  status?: string | string[]
  tags?: string[]
  parentId?: ArtifactId
  limit?: number
}

export interface IArtifactStore {
  create(input: CreateArtifactInput): Promise<Artifact>
  get(id: ArtifactId): Promise<Artifact | null>
  update(id: ArtifactId, updates: Partial<Artifact>): Promise<Artifact>
  delete(id: ArtifactId): Promise<void>
  query(filter: ArtifactFilter): Promise<Artifact[]>
  findChildren(parentId: ArtifactId, type?: ArtifactType): Promise<Artifact[]>
  findParents(childId: ArtifactId): Promise<Artifact[]>
  setGate(artifactId: ArtifactId, gate: Gate): Promise<void>
}

export class InMemoryArtifactStore implements IArtifactStore {
  private artifacts = new Map<ArtifactId, Artifact>()
  private artifactsDir: string
  private seq = 0

  constructor(private eventBus: IEventBus, opts: { artifactsDir?: string } = {}) {
    this.artifactsDir = opts.artifactsDir ?? '.scale/artifacts'
    if (!existsSync(this.artifactsDir)) mkdirSync(this.artifactsDir, { recursive: true })
  }

  async create(input: CreateArtifactInput): Promise<Artifact> {
    const id = this.generateId(input.type)
    const contentRef = this.contentPath(input.type, id)
    if (input.contentBody) {
      mkdirSync(dirname(contentRef), { recursive: true })
      writeFileSync(contentRef, input.contentBody, 'utf-8')
    }
    const artifact: Artifact = {
      id, type: input.type, version: 1,
      status: input.initialStatus ?? 'DRAFT',
      statusHistory: [],
      parents: input.parents ?? [],
      children: [],
      title: input.title,
      contentRef,
      payload: input.payload,
      gates: [],
      createdBy: input.createdBy ?? { kind: 'system', component: 'CLI' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: input.tags ?? [],
      labels: input.labels ?? {},
    }
    this.artifacts.set(id, artifact)

    // 更新父 artifacts 的 children
    for (const parentId of artifact.parents) {
      const parent = this.artifacts.get(parentId)
      if (parent) parent.children.push(id)
    }

    this.eventBus.emit('artifact.created', { id, type: input.type, title: input.title }, { artifactId: id, actor: artifact.createdBy })
    return artifact
  }

  async get(id: ArtifactId): Promise<Artifact | null> {
    return this.artifacts.get(id) ?? null
  }

  async update(id: ArtifactId, updates: Partial<Artifact>): Promise<Artifact> {
    const existing = this.artifacts.get(id)
    if (!existing) throw new ArtifactNotFoundError(id)
    const updated: Artifact = { ...existing, ...updates, version: existing.version + 1, updatedAt: Date.now() }
    this.artifacts.set(id, updated)
    this.eventBus.emit('artifact.updated', { id, fields: Object.keys(updates) }, { artifactId: id })
    return updated
  }

  async delete(id: ArtifactId): Promise<void> {
    if (!this.artifacts.has(id)) throw new ArtifactNotFoundError(id)
    this.artifacts.delete(id)
    this.eventBus.emit('artifact.deleted', { id }, { artifactId: id })
  }

  async query(filter: ArtifactFilter): Promise<Artifact[]> {
    let result = Array.from(this.artifacts.values())
    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type]
      result = result.filter((a) => types.includes(a.type))
    }
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status]
      result = result.filter((a) => statuses.includes(a.status))
    }
    if (filter.tags) {
      result = result.filter((a) => filter.tags!.every((t) => a.tags.includes(t)))
    }
    if (filter.parentId) {
      result = result.filter((a) => a.parents.includes(filter.parentId!))
    }
    if (filter.limit) result = result.slice(0, filter.limit)
    return result
  }

  async findChildren(parentId: ArtifactId, type?: ArtifactType): Promise<Artifact[]> {
    return this.query({ parentId, type })
  }

  async findParents(childId: ArtifactId): Promise<Artifact[]> {
    const child = this.artifacts.get(childId)
    if (!child) return []
    return child.parents.map((id) => this.artifacts.get(id)).filter(Boolean) as Artifact[]
  }

  async setGate(artifactId: ArtifactId, gate: Gate): Promise<void> {
    const artifact = this.artifacts.get(artifactId)
    if (!artifact) throw new ArtifactNotFoundError(artifactId)
    const idx = artifact.gates.findIndex((g) => g.name === gate.name)
    if (idx >= 0) artifact.gates[idx] = gate
    else artifact.gates.push(gate)
    this.eventBus.emit('artifact.gate_checked', { artifactId, gate }, { artifactId })
  }

  // ===== 内部 =====
  private generateId(type: ArtifactType): ArtifactId {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    this.seq = (this.seq + 1) % 10000
    return \`\${type.toUpperCase()}-\${date}-\${this.seq.toString().padStart(4, '0')}\`
  }

  private contentPath(type: ArtifactType, id: ArtifactId): string {
    return join(this.artifactsDir, type.toLowerCase(), \`\${id}.md\`)
  }
}
`,

  // -------------------------------------------------------------------
  // TaskEngine 骨架
  // -------------------------------------------------------------------
  'src/tasks/TaskEngine.ts': `// SCALE Engine — Task Engine (W4 完整实现)
// 长时任务 + Checkpoint + Resume
// 设计参考：docs/03-CORE-MODULES.md §3.3

import type { ArtifactId } from '../artifact/types.js'
import type { IArtifactStore } from '../artifact/store.js'
import type { IFSM } from '../artifact/fsm.js'
import type { IEventBus } from '../core/eventBus.js'
import { logger } from '../core/logger.js'
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export interface Checkpoint {
  id: string
  taskId: ArtifactId
  timestamp: number
  state: Record<string, unknown>
  description?: string
  canResume: boolean
}

export interface ITaskEngine {
  schedule(taskId: ArtifactId): Promise<void>
  execute(taskId: ArtifactId): Promise<void>
  pause(taskId: ArtifactId, reason: string): Promise<void>
  resume(taskId: ArtifactId): Promise<void>
  cancel(taskId: ArtifactId, reason: string): Promise<void>
  checkpoint(taskId: ArtifactId, label?: string): Promise<Checkpoint>
  restoreFromCheckpoint(taskId: ArtifactId, checkpointId?: string): Promise<void>
}

export class TaskEngine implements ITaskEngine {
  private runtimes = new Map<ArtifactId, { context: Record<string, unknown> }>()
  private checkpointsDir: string

  constructor(
    private store: IArtifactStore,
    private fsm: IFSM,
    private eventBus: IEventBus,
    opts: { checkpointsDir?: string } = {}
  ) {
    this.checkpointsDir = opts.checkpointsDir ?? '.scale/checkpoints'
    if (!existsSync(this.checkpointsDir)) mkdirSync(this.checkpointsDir, { recursive: true })
  }

  async schedule(taskId: ArtifactId): Promise<void> {
    await this.fsm.transition(taskId, 'schedule', { actor: { kind: 'system', component: 'TaskEngine' } })
    this.eventBus.emit('task.scheduled', { taskId }, { artifactId: taskId })
  }

  async execute(taskId: ArtifactId): Promise<void> {
    // W4 实现：步骤循环、子代理派发、漂移检测
    logger.info({ taskId }, 'TaskEngine.execute (skeleton)')
    this.eventBus.emit('task.started', { taskId }, { artifactId: taskId })
    // ... 完整实现见 W4 ...
  }

  async pause(taskId: ArtifactId, reason: string): Promise<void> {
    await this.checkpoint(taskId, 'auto-pause')
    await this.fsm.transition(taskId, 'pause', { actor: { kind: 'system', component: 'TaskEngine' }, reason })
    this.eventBus.emit('task.paused', { taskId, reason }, { artifactId: taskId })
  }

  async resume(taskId: ArtifactId): Promise<void> {
    await this.restoreFromCheckpoint(taskId)
    await this.fsm.transition(taskId, 'resume', { actor: { kind: 'system', component: 'TaskEngine' } })
    this.eventBus.emit('task.resumed', { taskId }, { artifactId: taskId })
  }

  async cancel(taskId: ArtifactId, reason: string): Promise<void> {
    await this.fsm.transition(taskId, 'cancel', { actor: { kind: 'system', component: 'TaskEngine' }, reason })
  }

  async checkpoint(taskId: ArtifactId, label?: string): Promise<Checkpoint> {
    const runtime = this.runtimes.get(taskId) ?? { context: {} }
    const checkpoint: Checkpoint = {
      id: \`CKP-\${Date.now()}\`,
      taskId,
      timestamp: Date.now(),
      state: { context: runtime.context },
      description: label,
      canResume: true,
    }
    const dir = join(this.checkpointsDir, taskId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, \`\${checkpoint.id}.json\`), JSON.stringify(checkpoint, null, 2))
    this.eventBus.emit('task.checkpointed', { taskId, checkpointId: checkpoint.id }, { artifactId: taskId })
    return checkpoint
  }

  async restoreFromCheckpoint(taskId: ArtifactId, checkpointId?: string): Promise<void> {
    const dir = join(this.checkpointsDir, taskId)
    if (!existsSync(dir)) throw new Error(\`No checkpoints for task \${taskId}\`)
    const cpId = checkpointId ?? readdirSync(dir).filter((f) => f.endsWith('.json')).sort().pop()
    if (!cpId) throw new Error(\`No checkpoints found for task \${taskId}\`)
    const data = JSON.parse(readFileSync(join(dir, cpId), 'utf-8')) as Checkpoint
    this.runtimes.set(taskId, { context: data.state.context as Record<string, unknown> })
    this.eventBus.emit('task.restored', { taskId, checkpointId: data.id }, { artifactId: taskId })
  }
}
`,

  // -------------------------------------------------------------------
  // KnowledgeBase 骨架
  // -------------------------------------------------------------------
  'src/knowledge/KnowledgeBase.ts': `// SCALE Engine — Knowledge Base (W7 完整实现)
// 设计参考：docs/03-CORE-MODULES.md §3.4

import type { KnowledgeEntry, KnowledgeQuery } from '../artifact/types.js'
import type { IEventBus } from '../core/eventBus.js'
import { logger } from '../core/logger.js'

export interface IKnowledgeBase {
  add(entry: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'accessCount' | 'relevance'>): Promise<KnowledgeEntry>
  recall(query: KnowledgeQuery): Promise<KnowledgeEntry[]>
  recallByVector(text: string, topK: number): Promise<KnowledgeEntry[]>
  markHelpful(id: string, sessionId: string): Promise<void>
  markUseless(id: string, sessionId: string): Promise<void>
  verify(id: string, verifiedBy: string): Promise<void>
  decay(): Promise<void>
}

export class KnowledgeBase implements IKnowledgeBase {
  private entries = new Map<string, KnowledgeEntry>()
  private seq = 0

  constructor(private eventBus: IEventBus) {}

  async add(input: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'accessCount' | 'relevance'>): Promise<KnowledgeEntry> {
    const entry: KnowledgeEntry = {
      ...input,
      id: this.generateId(),
      createdAt: Date.now(),
      accessCount: 0,
      relevance: 0.5,
    }
    this.entries.set(entry.id, entry)
    this.eventBus.emit('lesson.proposed', { lessonId: entry.id }, { artifactId: input.sourceArtifact })
    return entry
  }

  async recall(query: KnowledgeQuery): Promise<KnowledgeEntry[]> {
    let results = Array.from(this.entries.values())
    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type]
      results = results.filter((e) => types.includes(e.type))
    }
    if (query.tags) results = results.filter((e) => query.tags!.every((t) => e.tags.includes(t)))
    if (query.minRelevance) results = results.filter((e) => e.relevance >= query.minRelevance!)
    if (query.verifiedOnly) results = results.filter((e) => e.verified)
    results.sort((a, b) => b.relevance - a.relevance)
    return results.slice(0, query.limit ?? 10)
  }

  async recallByVector(text: string, topK: number): Promise<KnowledgeEntry[]> {
    // W7 实现：Qdrant 集成
    logger.debug({ text, topK }, 'recallByVector (skeleton, falling back to recall)')
    return this.recall({ verifiedOnly: true, limit: topK })
  }

  async markHelpful(id: string, sessionId: string): Promise<void> {
    const entry = this.entries.get(id)
    if (entry) {
      entry.relevance = Math.min(1, entry.relevance + 0.05)
      entry.accessCount += 1
      entry.lastAccessed = Date.now()
      this.eventBus.emit('lesson.helpful', { lessonId: id }, { sessionId })
    }
  }

  async markUseless(id: string, sessionId: string): Promise<void> {
    const entry = this.entries.get(id)
    if (entry) {
      entry.relevance = Math.max(0.05, entry.relevance - 0.1)
      this.eventBus.emit('lesson.useless', { lessonId: id }, { sessionId })
    }
  }

  async verify(id: string, verifiedBy: string): Promise<void> {
    const entry = this.entries.get(id)
    if (entry) {
      entry.verified = true
      entry.verifiedBy = verifiedBy
      entry.verifiedAt = Date.now()
      this.eventBus.emit('lesson.approved', { lessonId: id, verifiedBy })
    }
  }

  async decay(): Promise<void> {
    const DAY = 24 * 60 * 60 * 1000
    for (const entry of this.entries.values()) {
      const days = entry.lastAccessed ? (Date.now() - entry.lastAccessed) / DAY : 90
      const recency = Math.exp(-days / 30)
      entry.relevance = Math.max(0.05, entry.relevance * 0.95 + recency * 0.05)
    }
  }

  private generateId(): string {
    this.seq = (this.seq + 1) % 10000
    return \`KB-\${Date.now()}-\${this.seq.toString().padStart(4, '0')}\`
  }
}
`,

  // -------------------------------------------------------------------
  // BehaviorTracker 骨架
  // -------------------------------------------------------------------
  'src/evolution/BehaviorTracker.ts': `// SCALE Engine — Behavior Tracker (W10 完整实现)
// 订阅事件流，统计指标，发现模式
// 设计参考：docs/03-CORE-MODULES.md §3.7

import type { IEventBus } from '../core/eventBus.js'
import { logger } from '../core/logger.js'

export interface SessionMetrics {
  sessionId: string
  duration: number
  toolCalls: number
  toolFailures: number
  bruteRetryCount: number
  blameShiftCount: number
  prematureDoneCount: number
  artifactsCreated: number
  rolesUsed: string[]
  modelsUsed: Record<string, number>
}

export interface IBehaviorTracker {
  start(): void
  stop(): void
  getSessionMetrics(sessionId: string): Promise<SessionMetrics>
  detectPatterns(): Promise<unknown[]>
}

export class BehaviorTracker implements IBehaviorTracker {
  private subs: Array<{ unsubscribe(): void }> = []
  private metrics = new Map<string, SessionMetrics>()

  constructor(private eventBus: IEventBus) {}

  start(): void {
    this.subs.push(
      this.eventBus.on('tool.called', (e) => this.onToolCalled(e.sessionId, e.payload)),
      this.eventBus.on('tool.failed', (e) => this.onToolFailed(e.sessionId)),
      this.eventBus.on('behavior.brute_retry', (e) => this.onBruteRetry(e.sessionId)),
      this.eventBus.on('behavior.blame_shift', (e) => this.onBlameShift(e.sessionId)),
      this.eventBus.on('behavior.premature_done', (e) => this.onPrematureDone(e.sessionId)),
      this.eventBus.on('artifact.created', (e) => this.onArtifactCreated(e.sessionId)),
      this.eventBus.on('role.activated', (e) => this.onRoleActivated(e.sessionId, (e.payload as { role: string }).role)),
    )
    logger.info('BehaviorTracker started')
  }

  stop(): void {
    for (const sub of this.subs) sub.unsubscribe()
    this.subs = []
  }

  async getSessionMetrics(sessionId: string): Promise<SessionMetrics> {
    return this.metrics.get(sessionId) ?? this.createEmptyMetrics(sessionId)
  }

  async detectPatterns(): Promise<unknown[]> {
    // W10 实现
    return []
  }

  private getOrCreate(sessionId: string): SessionMetrics {
    if (!this.metrics.has(sessionId)) this.metrics.set(sessionId, this.createEmptyMetrics(sessionId))
    return this.metrics.get(sessionId)!
  }

  private createEmptyMetrics(sessionId: string): SessionMetrics {
    return {
      sessionId, duration: 0, toolCalls: 0, toolFailures: 0,
      bruteRetryCount: 0, blameShiftCount: 0, prematureDoneCount: 0,
      artifactsCreated: 0, rolesUsed: [], modelsUsed: {},
    }
  }

  private onToolCalled(sessionId: string, _payload: unknown): void { this.getOrCreate(sessionId).toolCalls += 1 }
  private onToolFailed(sessionId: string): void { this.getOrCreate(sessionId).toolFailures += 1 }
  private onBruteRetry(sessionId: string): void { this.getOrCreate(sessionId).bruteRetryCount += 1 }
  private onBlameShift(sessionId: string): void { this.getOrCreate(sessionId).blameShiftCount += 1 }
  private onPrematureDone(sessionId: string): void { this.getOrCreate(sessionId).prematureDoneCount += 1 }
  private onArtifactCreated(sessionId: string): void { this.getOrCreate(sessionId).artifactsCreated += 1 }
  private onRoleActivated(sessionId: string, role: string): void {
    const m = this.getOrCreate(sessionId)
    if (!m.rolesUsed.includes(role)) m.rolesUsed.push(role)
  }
}
`,

  // -------------------------------------------------------------------
  // Guardrails Gateway 骨架
  // -------------------------------------------------------------------
  'src/guardrails/Gateway.ts': `// SCALE Engine — Guardrails Gateway (W5 完整实现)
// Hook 网关 + 5 种懒惰检测器 + Role 权限
// 设计参考：docs/03-CORE-MODULES.md §3.5

import type { ToolUseInput, ToolResultInput, StopInput, GateDecision, DetectorResult } from '../artifact/types.js'
import type { IEventBus } from '../core/eventBus.js'
import { logger } from '../core/logger.js'

export interface IDetector {
  name: string
  check(input: ToolUseInput | ToolResultInput | StopInput, context: DetectorContext): Promise<DetectorResult>
}

export interface DetectorContext {
  eventBus: IEventBus
  cache: Map<string, unknown>
}

export interface IGateway {
  preTool(input: ToolUseInput): Promise<GateDecision>
  postTool(input: ToolResultInput): Promise<void>
  beforeStop(input: StopInput): Promise<GateDecision>
  registerDetector(detector: IDetector, hook: 'preTool' | 'postTool' | 'beforeStop'): void
}

export class Gateway implements IGateway {
  private cache = new Map<string, unknown>()
  private detectors = {
    preTool: [] as IDetector[],
    postTool: [] as IDetector[],
    beforeStop: [] as IDetector[],
  }

  constructor(private eventBus: IEventBus) {}

  registerDetector(detector: IDetector, hook: 'preTool' | 'postTool' | 'beforeStop'): void {
    this.detectors[hook].push(detector)
    logger.debug({ name: detector.name, hook }, 'Detector registered')
  }

  async preTool(input: ToolUseInput): Promise<GateDecision> {
    for (const det of this.detectors.preTool) {
      const result = await det.check(input, { eventBus: this.eventBus, cache: this.cache })
      if (result.triggered) {
        if (result.severity === 'deny' || result.severity === 'block') {
          this.eventBus.emit('tool.blocked', { tool: input.tool, detector: det.name, reason: result.reason }, { sessionId: input.sessionId })
          return { allow: false, reason: result.reason, suggestion: result.suggestion }
        }
        if (result.severity === 'warn') {
          return { allow: true, reason: result.reason, injectContext: [result.reason ?? ''] }
        }
      }
    }
    this.eventBus.emit('tool.called', { tool: input.tool, args: input.args }, { sessionId: input.sessionId })
    return { allow: true }
  }

  async postTool(input: ToolResultInput): Promise<void> {
    if (input.exitCode === 0) {
      this.eventBus.emit('tool.completed', { tool: input.tool, args: input.args, output: input.output }, { sessionId: input.sessionId })
    } else {
      this.eventBus.emit('tool.failed', { tool: input.tool, args: input.args, exitCode: input.exitCode, output: input.output }, { sessionId: input.sessionId })
    }
    for (const det of this.detectors.postTool) {
      await det.check(input, { eventBus: this.eventBus, cache: this.cache })
    }
  }

  async beforeStop(input: StopInput): Promise<GateDecision> {
    for (const det of this.detectors.beforeStop) {
      const result = await det.check(input, { eventBus: this.eventBus, cache: this.cache })
      if (result.triggered && (result.severity === 'deny' || result.severity === 'block')) {
        return { allow: false, reason: result.reason, suggestion: result.suggestion }
      }
    }
    return { allow: true }
  }
}
`,

  // -------------------------------------------------------------------
  // 5 个 Detectors
  // -------------------------------------------------------------------
  'src/guardrails/detectors.ts': `// SCALE Engine — 5 种懒惰检测器
// 设计参考：docs/03-CORE-MODULES.md §3.5

import type { IDetector, DetectorContext } from './Gateway.js'
import type { ToolUseInput, ToolResultInput, StopInput, DetectorResult } from '../artifact/types.js'
import { createHash } from 'node:crypto'

const hashArgs = (args: unknown): string =>
  createHash('md5').update(JSON.stringify(args)).digest('hex').slice(0, 8)

// 1. 暴力重试检测
export class BruteRetryDetector implements IDetector {
  name = 'brute-retry'
  private windowMs = 3 * 60 * 1000
  private threshold = 3

  async check(input: ToolUseInput, ctx: DetectorContext): Promise<DetectorResult> {
    const key = \`\${input.sessionId}:\${input.tool}:\${hashArgs(input.args)}\`
    const history = (ctx.cache.get(key) as number[] | undefined) ?? []
    const recent = history.filter((t) => Date.now() - t < this.windowMs)
    recent.push(Date.now())
    ctx.cache.set(key, recent)
    if (recent.length >= this.threshold) {
      ctx.eventBus.emit('behavior.brute_retry', { tool: input.tool, count: recent.length }, { sessionId: input.sessionId })
      return {
        triggered: true,
        severity: 'block',
        reason: \`检测到「暴力重试」：\${input.tool} 在 \${this.windowMs / 60000} 分钟内已运行 \${recent.length} 次。请换策略，并说明你这次的新假设是什么。\`,
      }
    }
    return { triggered: false }
  }
}

// 2. 工具闲置检测
export class IdleToolDetector implements IDetector {
  name = 'idle-tool'

  async check(input: ToolUseInput, ctx: DetectorContext): Promise<DetectorResult> {
    if (!['Edit', 'Write', 'MultiEdit'].includes(input.tool)) return { triggered: false }
    const recent = await ctx.eventBus.query({
      sessionId: input.sessionId,
      types: ['tool.failed', 'tool.completed'],
      limit: 10,
    })
    const failureIdx = recent.findIndex((e) => e.type === 'tool.failed')
    if (failureIdx < 0) return { triggered: false }
    const after = recent.slice(0, failureIdx)
    const investigation = ['Read', 'Grep', 'WebSearch', 'Bash']
    const hasInv = after.some((e) => investigation.includes((e.payload as { tool: string }).tool))
    if (!hasInv) {
      ctx.eventBus.emit('behavior.idle_tool', { tool: input.tool }, { sessionId: input.sessionId })
      return {
        triggered: true,
        severity: 'warn',
        reason: '检测到「工具闲置」：上次工具失败后未读任何文件/日志就直接改代码。请先 Read 相关文件或 Bash 看错误日志。',
        suggestion: 'Read failing test output OR Grep for similar patterns',
      }
    }
    return { triggered: false }
  }
}

// 3. 忙碌假象（来回反复修改同一文件）
export class BusyLoopDetector implements IDetector {
  name = 'busy-loop'

  async check(input: ToolUseInput, ctx: DetectorContext): Promise<DetectorResult> {
    if (input.tool !== 'Edit') return { triggered: false }
    const file = (input.args as { file_path?: string }).file_path
    if (!file) return { triggered: false }
    const edits = await ctx.eventBus.query({
      sessionId: input.sessionId,
      types: ['tool.completed'],
      filter: (e) => {
        const p = e.payload as { tool: string; args: { file_path?: string } }
        return p.tool === 'Edit' && p.args.file_path === file
      },
      limit: 5,
    })
    if (edits.length < 4) return { triggered: false }
    const seen = new Set<string>()
    let cycle = false
    for (const e of edits) {
      const p = e.payload as { args: { old_string?: string; new_string?: string } }
      const oldH = createHash('md5').update(p.args.old_string ?? '').digest('hex').slice(0, 8)
      const newH = createHash('md5').update(p.args.new_string ?? '').digest('hex').slice(0, 8)
      if (seen.has(\`\${newH}:\${oldH}\`)) { cycle = true; break }
      seen.add(\`\${oldH}:\${newH}\`)
    }
    if (cycle) {
      ctx.eventBus.emit('behavior.busy_loop', { file }, { sessionId: input.sessionId })
      return {
        triggered: true,
        severity: 'block',
        reason: \`检测到「忙碌假象」：你在 \${file} 反复来回修改。停下来——这次修改是否产生新信息？没有 = 换思路。\`,
      }
    }
    return { triggered: false }
  }
}

// 4. 声称完成但未验证
export class PrematureDoneDetector implements IDetector {
  name = 'premature-done'

  async check(input: StopInput, ctx: DetectorContext): Promise<DetectorResult> {
    const edits = await ctx.eventBus.query({
      sessionId: input.sessionId,
      types: ['tool.completed'],
      filter: (e) => ['Edit', 'Write', 'MultiEdit'].includes((e.payload as { tool: string }).tool),
    })
    if (edits.length === 0) return { triggered: false }
    const verifications = await ctx.eventBus.query({
      sessionId: input.sessionId,
      types: ['tool.completed'],
      filter: (e) => {
        const p = e.payload as { tool: string; args: { command?: string } }
        return p.tool === 'Bash' && /test|lint|build|typecheck/i.test(p.args.command ?? '')
      },
    })
    if (verifications.length === 0) {
      ctx.eventBus.emit('behavior.premature_done', { reason: 'no_verification' }, { sessionId: input.sessionId })
      return {
        triggered: true,
        severity: 'block',
        reason: '检测到「声称完成但未验证」：本会话修改了代码，但未运行任何 test/lint/build。请先运行验证命令。',
        suggestion: 'pnpm test  (or your project test command)',
      }
    }
    const lastVerify = verifications[0]
    const lastEdit = edits[0]
    if (lastVerify.timestamp < lastEdit.timestamp) {
      return {
        triggered: true,
        severity: 'block',
        reason: '修改了代码但最后一次验证是修改之前运行的。请重新运行验证。',
      }
    }
    return { triggered: false }
  }
}

// 5. 甩锅检测
export class BlameShiftDetector implements IDetector {
  name = 'blame-shift'
  private patterns = [
    /可能是环境问题/i,
    /建议你?手动/i,
    /maybe (an?|the) (environment|version|setup)/i,
    /not sure why/i,
    /unable to (determine|figure out|resolve)/i,
  ]

  async check(input: ToolResultInput, ctx: DetectorContext): Promise<DetectorResult> {
    const text = input.output ?? ''
    if (!this.patterns.some((p) => p.test(text))) return { triggered: false }
    const verifications = await ctx.eventBus.query({
      sessionId: input.sessionId,
      types: ['tool.completed'],
      filter: (e) => (e.payload as { tool: string }).tool === 'Bash',
      limit: 5,
    })
    if (verifications.length < 2) {
      ctx.eventBus.emit('behavior.blame_shift', { sessionId: input.sessionId }, { sessionId: input.sessionId })
      return {
        triggered: true,
        severity: 'warn',
        reason: '检测到「甩锅」迹象：你说"可能是环境问题"但未做足够验证。至少：\\n1. 验证版本 2. 验证依赖 3. 重现问题。\\n证据齐了再下结论。',
      }
    }
    return { triggered: false }
  }
}
`,

  // -------------------------------------------------------------------
  // Roles 定义
  // -------------------------------------------------------------------
  'src/guardrails/roles.ts': `// SCALE Engine — Role 定义
// 设计参考：docs/03-CORE-MODULES.md §3.5 "Role 权限网关"

import type { RoleDefinition } from '../artifact/types.js'

export const ROLES: Record<string, RoleDefinition> = {
  Explorer: {
    name: 'Explorer',
    canCreateArtifacts: ['Insight'],
    canReadArtifacts: ['Need', 'Spec', 'Insight'],
    allowedTools: ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'],
    deniedTools: ['Edit', 'Write', 'Bash'],
    requiresUpstream: [],
  },
  SpecWriter: {
    name: 'SpecWriter',
    canCreateArtifacts: ['Spec'],
    canModifyArtifacts: [{ type: 'Spec', statuses: ['DRAFT', 'REVIEWING'] }],
    allowedTools: ['Read', 'Write', 'WebSearch'],
    requiresUpstream: [{ type: 'Need' }],
  },
  Planner: {
    name: 'Planner',
    canCreateArtifacts: ['Plan', 'TestPlan', 'Task'],
    allowedTools: ['Read', 'Grep', 'WebSearch', 'Write'],
    requiresUpstream: [{ type: 'Spec', status: 'FROZEN' }],
  },
  Implementer: {
    name: 'Implementer',
    canCreateArtifacts: ['Change'],
    allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', 'MultiEdit'],
    requiresUpstream: [{ type: 'Task', status: 'READY' }],
    mustRunAfterEdit: ['lint', 'typecheck'],
  },
  Verifier: {
    name: 'Verifier',
    canCreateArtifacts: ['Evidence', 'Defect'],
    allowedTools: ['Read', 'Bash', 'Grep'],
    deniedTools: ['Edit', 'Write'],
  },
  Releaser: {
    name: 'Releaser',
    canCreateArtifacts: ['Release'],
    allowedTools: ['Read', 'Bash'],
    requiresUpstream: [
      { type: 'Defect', allMatch: 'CLOSED' },
      { type: 'Evidence', allMatch: 'PASS' },
    ],
  },
}

export function getRole(name: string): RoleDefinition | undefined {
  return ROLES[name]
}

export function listRoles(): string[] {
  return Object.keys(ROLES)
}
`,

  // -------------------------------------------------------------------
  // ContextBuilder 骨架
  // -------------------------------------------------------------------
  'src/context/ContextBuilder.ts': `// SCALE Engine — Context Builder (W6 完整实现)
// 分层上下文加载 + Token 预算
// 设计参考：docs/03-CORE-MODULES.md §3.6

import type { ArtifactId, SessionId } from '../artifact/types.js'
import type { IArtifactStore } from '../artifact/store.js'
import type { IKnowledgeBase } from '../knowledge/KnowledgeBase.js'
import type { IEventBus } from '../core/eventBus.js'

export interface ContextLayer {
  name: string
  content: string
  priority: number
  estimatedTokens: number
}

export interface BuiltContext {
  system: string
  metadata: { totalTokens: number; layers: string[] }
}

export interface IContextBuilder {
  build(opts: { roleId?: string; currentArtifactId?: ArtifactId; sessionId: SessionId }): Promise<BuiltContext>
}

export class ContextBuilder implements IContextBuilder {
  private budget = { total: 200_000, reserved: 30_000 }

  constructor(
    private store: IArtifactStore,
    private kb: IKnowledgeBase,
    private eventBus: IEventBus
  ) {}

  async build(opts: { roleId?: string; currentArtifactId?: ArtifactId; sessionId: SessionId }): Promise<BuiltContext> {
    const layers: ContextLayer[] = []
    layers.push({ name: 'system_rules', content: '## SCALE Core Rules\\n...', priority: 1, estimatedTokens: 3000 })

    if (opts.roleId) {
      layers.push({ name: 'role_prompt', content: \`## Active Role: \${opts.roleId}\\n...\`, priority: 2, estimatedTokens: 1500 })
    }

    if (opts.currentArtifactId) {
      const artifact = await this.store.get(opts.currentArtifactId)
      if (artifact) {
        layers.push({ name: 'current_artifact', content: \`## \${artifact.title}\\n\${JSON.stringify(artifact.payload, null, 2)}\`, priority: 3, estimatedTokens: 5000 })
      }
    }

    // P5: 召回 lessons (W7 集成)
    if (opts.currentArtifactId) {
      const artifact = await this.store.get(opts.currentArtifactId)
      if (artifact) {
        const lessons = await this.kb.recallByVector(artifact.title, 3)
        if (lessons.length > 0) {
          const content = '## 相关历史经验\\n' + lessons.map((l) => \`- \${l.title}\`).join('\\n')
          layers.push({ name: 'recalled_lessons', content, priority: 5, estimatedTokens: 1500 })
        }
      }
    }

    const available = this.budget.total - this.budget.reserved
    const selected: ContextLayer[] = []
    let used = 0
    for (const layer of layers.sort((a, b) => a.priority - b.priority)) {
      if (used + layer.estimatedTokens > available) break
      selected.push(layer)
      used += layer.estimatedTokens
    }

    this.eventBus.emit('context.built', { layers: selected.map((l) => l.name), totalTokens: used }, { sessionId: opts.sessionId })

    return {
      system: selected.map((l) => l.content).join('\\n\\n---\\n\\n'),
      metadata: { totalTokens: used, layers: selected.map((l) => l.name) },
    }
  }
}
`,

  // -------------------------------------------------------------------
  // CLI 入口
  // -------------------------------------------------------------------
  'src/api/cli.ts': `#!/usr/bin/env node
// SCALE Engine — CLI 入口 (W8 完整实现)

import { defineCommand, runMain } from 'citty'
import { EventBus } from '../core/eventBus.js'
import { InMemoryArtifactStore } from '../artifact/store.js'
import { FSM, SpecFSM } from '../artifact/fsm.js'
import { Gateway } from '../guardrails/Gateway.js'
import { BruteRetryDetector, IdleToolDetector, BusyLoopDetector, PrematureDoneDetector, BlameShiftDetector } from '../guardrails/detectors.js'

// === 引擎初始化 (单例) ===
const eventBus = new EventBus()
const store = new InMemoryArtifactStore(eventBus)
const fsm = new FSM(store, eventBus)
fsm.register(SpecFSM)
const gateway = new Gateway(eventBus)
gateway.registerDetector(new BruteRetryDetector(), 'preTool')
gateway.registerDetector(new IdleToolDetector(), 'preTool')
gateway.registerDetector(new BusyLoopDetector(), 'preTool')
gateway.registerDetector(new PrematureDoneDetector(), 'beforeStop')
gateway.registerDetector(new BlameShiftDetector(), 'postTool')

// === 命令定义 ===
const create = defineCommand({
  meta: { name: 'create', description: 'Create an artifact' },
  args: {
    type: { type: 'positional', required: true },
    title: { type: 'positional', required: true },
    parent: { type: 'string' },
  },
  async run({ args }) {
    const artifact = await store.create({
      type: args.type as never,
      title: args.title,
      payload: {},
      parents: args.parent ? [args.parent] : [],
    })
    console.log(JSON.stringify(artifact, null, 2))
  },
})

const list = defineCommand({
  meta: { name: 'list' },
  args: { type: { type: 'string' }, status: { type: 'string' } },
  async run({ args }) {
    const items = await store.query({ type: args.type as never, status: args.status })
    console.log(JSON.stringify(items, null, 2))
  },
})

const transition = defineCommand({
  meta: { name: 'transition' },
  args: {
    id: { type: 'positional', required: true },
    to: { type: 'string', required: true },
    reason: { type: 'string' },
  },
  async run({ args }) {
    const result = await fsm.transition(args.id, args.to, {
      actor: { kind: 'human', userId: 'cli' },
      reason: args.reason,
    })
    console.log(JSON.stringify(result, null, 2))
  },
})

const gatePreTool = defineCommand({
  meta: { name: 'pre-tool' },
  args: {
    tool: { type: 'positional', required: true },
    'args-json': { type: 'string', default: '{}' },
    'session-id': { type: 'string', required: true },
  },
  async run({ args }) {
    const decision = await gateway.preTool({
      sessionId: args['session-id'],
      tool: args.tool,
      args: JSON.parse(args['args-json']),
    })
    console.log(JSON.stringify(decision))
    if (!decision.allow) process.exit(2)
  },
})

const gateBeforeStop = defineCommand({
  meta: { name: 'before-stop' },
  args: { 'session-id': { type: 'string', required: true } },
  async run({ args }) {
    const decision = await gateway.beforeStop({ sessionId: args['session-id'] })
    console.log(JSON.stringify(decision))
    if (!decision.allow) process.exit(2)
  },
})

const gate = defineCommand({
  meta: { name: 'gate' },
  subCommands: { 'pre-tool': gatePreTool, 'before-stop': gateBeforeStop },
})

const main = defineCommand({
  meta: { name: 'scale', version: '0.1.0', description: 'SCALE Engine CLI' },
  subCommands: { create, list, transition, gate },
})

runMain(main)
`,

  // -------------------------------------------------------------------
  // index.ts (包入口)
  // -------------------------------------------------------------------
  'src/index.ts': `// SCALE Engine — Public API
export * from './artifact/types.js'
export { FSM, SpecFSM } from './artifact/fsm.js'
export { InMemoryArtifactStore } from './artifact/store.js'
export type { IArtifactStore } from './artifact/store.js'
export { EventBus } from './core/eventBus.js'
export type { IEventBus } from './core/eventBus.js'
export { Container, container, createToken } from './core/container.js'
export { logger } from './core/logger.js'
export { TaskEngine } from './tasks/TaskEngine.js'
export { KnowledgeBase } from './knowledge/KnowledgeBase.js'
export { BehaviorTracker } from './evolution/BehaviorTracker.js'
export { Gateway } from './guardrails/Gateway.js'
export { ROLES, getRole, listRoles } from './guardrails/roles.js'
export { ContextBuilder } from './context/ContextBuilder.js'
export {
  BruteRetryDetector, IdleToolDetector, BusyLoopDetector,
  PrematureDoneDetector, BlameShiftDetector,
} from './guardrails/detectors.js'
`,

  // -------------------------------------------------------------------
  // 集成示例
  // -------------------------------------------------------------------
  'examples/claude-code/settings.json': JSON.stringify({
    hooks: {
      SessionStart: [
        { matcher: '', hooks: [{ type: 'command', command: 'scale context inject --stdin' }] },
      ],
      PreToolUse: [
        { matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: 'scale gate pre-tool --stdin', timeout: 10 }] },
        { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: 'scale gate pre-tool Edit --stdin', timeout: 10 }] },
      ],
      PostToolUse: [
        { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: 'scale gate post-tool Edit --stdin', timeout: 10 }] },
        { matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: 'scale gate post-tool Bash --stdin', timeout: 10 }] },
      ],
      PostToolUseFailure: [
        { matcher: '', hooks: [{ type: 'command', command: 'scale gate post-tool --stdin --exit-code 1', timeout: 10 }] },
      ],
      Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'scale gate before-stop --stdin --hook-safe', timeout: 10 }] }],
      SessionEnd: [{ matcher: '', hooks: [{ type: 'command', command: 'scale session end --stdin' }] }],
    },
    permissions: {
      allow: ['Bash(scale:*)'],
    },
  }, null, 2) + '\n',

  'examples/claude-code/CLAUDE.md': `# SCALE Engine 治理规则（自动生成）

本项目由 SCALE Engine 治理。AI 行为受以下约束：

1. **Role 必须激活**：执行任务前先 \`scale role activate <role>\`
2. **Artifact 必须有上游**：创建 Plan 前 Spec 必须 FROZEN
3. **声称完成前必须验证**：修代码后必须跑 test/lint
4. **不准甩锅**：说"环境问题"前必须有 ≥2 个验证证据

## 可用 Roles
- Explorer / SpecWriter / Planner / Implementer / Verifier / Releaser

## 关键命令
- \`scale create <type> <title>\` - 创建 Artifact
- \`scale transition <id> --to <action>\` - 状态迁移
- \`scale role activate <name>\` - 切换 Role
- \`scale lesson recall "查询"\` - 召回历史经验
`,

  'examples/codex-cli/hooks.json': JSON.stringify({
    session_start: [{ command: 'scale session start --agent codex --session-id $CODEX_SESSION_ID' }],
    pre_tool_use: [{ command: 'scale gate pre-tool $CODEX_TOOL_NAME --args-json $CODEX_TOOL_INPUT --session-id $CODEX_SESSION_ID' }],
    post_tool_use: [{ command: 'scale gate post-tool $CODEX_TOOL_NAME --output-json $CODEX_TOOL_OUTPUT --exit-code $CODEX_TOOL_EXIT --session-id $CODEX_SESSION_ID' }],
    session_end: [{ command: 'scale session end --session-id $CODEX_SESSION_ID' }],
  }, null, 2) + '\n',

  // -------------------------------------------------------------------
  // .gitignore + LICENSE
  // -------------------------------------------------------------------
  '.gitignore': `node_modules/
dist/
*.log
.scale/scale.db*
.scale/events/
.scale/checkpoints/
.scale/vectors/
!.scale/artifacts/
!.scale/rules/enforced/
!.scale/config.yaml
.env
.env.local
`,

  'LICENSE': `MIT License

Copyright (c) 2026 SCALE Engine Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
`,
}

// ===== Run =====
let created = 0
let skipped = 0
for (const [relpath, content] of Object.entries(FILES)) {
  const fullpath = `${ROOT}/${relpath}`
  mkdirSync(dirname(fullpath), { recursive: true })
  if (existsSync(fullpath)) {
    const existing = require('node:fs').readFileSync(fullpath, 'utf-8')
    if (existing.length > 0) {
      console.log(`SKIP  ${relpath} (exists, ${existing.length} bytes)`)
      skipped++
      continue
    }
  }
  writeFileSync(fullpath, content, 'utf-8')
  console.log(`WRITE ${relpath} (${content.length} bytes)`)
  created++
}

console.log(`\nDone. Created ${created}, skipped ${skipped}.`)

