/**
 * SCALE Engine — SQLite Artifact Store (W3)
 *
 * 替代 InMemoryArtifactStore，提供持久化存储。
 * 设计参考：docs/02-DATA-MODEL.md §四、docs/03-CORE-MODULES.md §3.2
 *
 * 特性：
 * - SQLite WAL 模式（读写并发安全）
 * - JSON 序列化 payload/gates/statusHistory/parents/children/tags/labels
 * - 事件自动落入 events 表
 * - 完整 CRUD + query + findChildren + findParents
 */

import { createRequire } from 'node:module'
import type BetterSqlite3 from 'better-sqlite3'
import type { Artifact, ArtifactType, Gate, ArtifactId, Actor, StatusChange } from './types.js'
import { ArtifactNotFoundError } from './types.js'
import type { IEventBus } from '../core/eventBus.js'
import type { IArtifactStore, CreateArtifactInput, ArtifactFilter } from './store.js'
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
type BetterSqlite3Constructor = typeof BetterSqlite3

function loadBetterSqlite3(): BetterSqlite3Constructor {
  const loaded = require('better-sqlite3') as BetterSqlite3Constructor | { default?: BetterSqlite3Constructor }
  return 'default' in loaded && loaded.default ? loaded.default : loaded as BetterSqlite3Constructor
}

// ============================================================================
// Schema DDL
// ============================================================================

const SCHEMA_DDL = `
-- Artifacts 主表
CREATE TABLE IF NOT EXISTS artifacts (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'DRAFT',
  status_history TEXT NOT NULL DEFAULT '[]',   -- JSON array of StatusChange
  parents       TEXT NOT NULL DEFAULT '[]',    -- JSON array of ArtifactId
  children      TEXT NOT NULL DEFAULT '[]',    -- JSON array of ArtifactId
  supersedes    TEXT,
  title         TEXT NOT NULL,
  content_ref   TEXT NOT NULL DEFAULT '',
  payload       TEXT NOT NULL DEFAULT '{}',    -- JSON
  gates         TEXT NOT NULL DEFAULT '[]',    -- JSON array of Gate
  created_by    TEXT NOT NULL DEFAULT '{}',    -- JSON Actor
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  closed_at     INTEGER,
  tags          TEXT NOT NULL DEFAULT '[]',    -- JSON array
  labels        TEXT NOT NULL DEFAULT '{}'     -- JSON object
);

CREATE INDEX IF NOT EXISTS idx_artifacts_type ON artifacts(type);
CREATE INDEX IF NOT EXISTS idx_artifacts_status ON artifacts(status);
CREATE INDEX IF NOT EXISTS idx_artifacts_created_at ON artifacts(created_at);

-- Events 表（事件溯源的持久化副本）
CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  timestamp    INTEGER NOT NULL,
  session_id   TEXT,
  artifact_id  TEXT,
  actor        TEXT DEFAULT '{}',
  payload      TEXT NOT NULL DEFAULT '{}',
  metadata     TEXT DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_artifact_id ON events(artifact_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);

-- Artifact 关系边表（加速 parent/child 查询）
CREATE TABLE IF NOT EXISTS artifact_edges (
  parent_id TEXT NOT NULL,
  child_id  TEXT NOT NULL,
  PRIMARY KEY (parent_id, child_id)
);

CREATE INDEX IF NOT EXISTS idx_edges_parent ON artifact_edges(parent_id);
CREATE INDEX IF NOT EXISTS idx_edges_child ON artifact_edges(child_id);

-- 元信息表
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 初始化 schema version
INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');
`

// ============================================================================
// SQLiteArtifactStore
// ============================================================================

export class SQLiteArtifactStore implements IArtifactStore {
  private db: BetterSqlite3.Database
  private seq = 0
  private artifactsDir: string

  // Prepared statements (性能优化)
  private stmtInsert!: BetterSqlite3.Statement
  private stmtGet!: BetterSqlite3.Statement
  private stmtUpdate!: BetterSqlite3.Statement
  private stmtDelete!: BetterSqlite3.Statement
  private stmtInsertEdge!: BetterSqlite3.Statement
  private stmtDeleteEdges!: BetterSqlite3.Statement
  private stmtFindChildren!: BetterSqlite3.Statement
  private stmtFindParents!: BetterSqlite3.Statement
  private stmtInsertEvent!: BetterSqlite3.Statement

  constructor(
    private eventBus: IEventBus,
    opts: { dbPath?: string; artifactsDir?: string } = {}
  ) {
    const dbPath = opts.dbPath ?? '.scale/scale.db'
    this.artifactsDir = opts.artifactsDir ?? '.scale/artifacts'

    // 确保目录存在
    mkdirSync(dirname(dbPath), { recursive: true })
    if (!existsSync(this.artifactsDir)) mkdirSync(this.artifactsDir, { recursive: true })

    // 创建 DB
    const Database = loadBetterSqlite3()
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('busy_timeout = 5000')

    // 初始化 schema
    this.db.exec(SCHEMA_DDL)

    // 准备 statements
    this.prepareStatements()

    // 恢复 seq
    const maxRow = this.db.prepare(`SELECT id FROM artifacts ORDER BY created_at DESC LIMIT 1`).get() as { id: string } | undefined
    if (maxRow) {
      const parts = maxRow.id.split('-')
      this.seq = parseInt(parts[parts.length - 1], 10) || 0
    }

    // 订阅 EventBus 事件 → 自动写入 events 表
    this.eventBus.on('*', (event) => {
      try {
        this.stmtInsertEvent.run(
          event.id,
          event.type,
          event.timestamp,
          event.sessionId ?? null,
          event.artifactId ?? null,
          JSON.stringify(event.actor ?? {}),
          JSON.stringify(event.payload ?? {}),
          JSON.stringify({}),
        )
      } catch {
        // 容忍写入失败（避免循环依赖阻塞）
      }
    })
  }

  private prepareStatements(): void {
    this.stmtInsert = this.db.prepare(`
      INSERT INTO artifacts (id, type, version, status, status_history, parents, children, supersedes,
        title, content_ref, payload, gates, created_by, created_at, updated_at, closed_at, tags, labels)
      VALUES (@id, @type, @version, @status, @statusHistory, @parents, @children, @supersedes,
        @title, @contentRef, @payload, @gates, @createdBy, @createdAt, @updatedAt, @closedAt, @tags, @labels)
    `)

    this.stmtGet = this.db.prepare(`SELECT * FROM artifacts WHERE id = ?`)

    this.stmtUpdate = this.db.prepare(`
      UPDATE artifacts SET
        version = @version, status = @status, status_history = @statusHistory,
        parents = @parents, children = @children, supersedes = @supersedes,
        title = @title, content_ref = @contentRef, payload = @payload,
        gates = @gates, updated_at = @updatedAt, closed_at = @closedAt,
        tags = @tags, labels = @labels
      WHERE id = @id
    `)

    this.stmtDelete = this.db.prepare(`DELETE FROM artifacts WHERE id = ?`)
    this.stmtInsertEdge = this.db.prepare(`INSERT OR IGNORE INTO artifact_edges (parent_id, child_id) VALUES (?, ?)`)
    this.stmtDeleteEdges = this.db.prepare(`DELETE FROM artifact_edges WHERE child_id = ?`)

    this.stmtFindChildren = this.db.prepare(`
      SELECT a.* FROM artifacts a
      INNER JOIN artifact_edges e ON a.id = e.child_id
      WHERE e.parent_id = ?
    `)

    this.stmtFindParents = this.db.prepare(`
      SELECT a.* FROM artifacts a
      INNER JOIN artifact_edges e ON a.id = e.parent_id
      WHERE e.child_id = ?
    `)

    this.stmtInsertEvent = this.db.prepare(`
      INSERT OR IGNORE INTO events (id, type, timestamp, session_id, artifact_id, actor, payload, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
  }

  // ===== CRUD =====

  async create(input: CreateArtifactInput): Promise<Artifact> {
    const id = this.generateId(input.type)
    const contentRef = this.contentPath(input.type, id)

    if (input.contentBody) {
      mkdirSync(dirname(contentRef), { recursive: true })
      writeFileSync(contentRef, input.contentBody, 'utf-8')
    }

    const artifact: Artifact = {
      id,
      type: input.type,
      version: 1,
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

    const insertAll = this.db.transaction(() => {
      this.stmtInsert.run(this.toRow(artifact))

      // 写入边表
      for (const parentId of artifact.parents) {
        this.stmtInsertEdge.run(parentId, id)
        // 更新父的 children 字段
        const parentRow = this.stmtGet.get(parentId) as RawRow | undefined
        if (parentRow) {
          const parentChildren: string[] = JSON.parse(parentRow.children)
          if (!parentChildren.includes(id)) {
            parentChildren.push(id)
            this.db.prepare(`UPDATE artifacts SET children = ? WHERE id = ?`).run(JSON.stringify(parentChildren), parentId)
          }
        }
      }
    })

    insertAll()

    this.eventBus.emit('artifact.created', { id, type: input.type, title: input.title }, { artifactId: id, actor: artifact.createdBy })
    return artifact
  }

  async get(id: ArtifactId): Promise<Artifact | null> {
    const row = this.stmtGet.get(id) as RawRow | undefined
    return row ? this.fromRow(row) : null
  }

  async update(id: ArtifactId, updates: Partial<Artifact>): Promise<Artifact> {
    const existing = await this.get(id)
    if (!existing) throw new ArtifactNotFoundError(id)

    const updated: Artifact = {
      ...existing,
      ...updates,
      id, // 不允许改 id
      type: existing.type, // 不允许改 type
      version: existing.version + 1,
      updatedAt: Date.now(),
    }

    this.stmtUpdate.run(this.toRow(updated))
    this.eventBus.emit('artifact.updated', { id, fields: Object.keys(updates) }, { artifactId: id })
    return updated
  }

  async delete(id: ArtifactId): Promise<void> {
    const existing = await this.get(id)
    if (!existing) throw new ArtifactNotFoundError(id)

    const deleteAll = this.db.transaction(() => {
      this.stmtDeleteEdges.run(id)
      this.stmtDelete.run(id)
    })
    deleteAll()

    this.eventBus.emit('artifact.deleted', { id }, { artifactId: id })
  }

  async query(filter: ArtifactFilter): Promise<Artifact[]> {
    const conditions: string[] = ['1=1']
    const params: unknown[] = []

    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type]
      conditions.push(`type IN (${types.map(() => '?').join(',')})`)
      params.push(...types)
    }

    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status]
      conditions.push(`status IN (${statuses.map(() => '?').join(',')})`)
      params.push(...statuses)
    }

    if (filter.tags && filter.tags.length > 0) {
      // JSON 包含检查：每个 tag 都必须在 tags JSON 数组中
      for (const tag of filter.tags) {
        conditions.push(`tags LIKE ?`)
        params.push(`%"${tag}"%`)
      }
    }

    if (filter.parentId) {
      conditions.push(`id IN (SELECT child_id FROM artifact_edges WHERE parent_id = ?)`)
      params.push(filter.parentId)
    }

    let sql = `SELECT * FROM artifacts WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`
    if (filter.limit) {
      sql += ` LIMIT ?`
      params.push(filter.limit)
    }

    const rows = this.db.prepare(sql).all(...params) as RawRow[]
    return rows.map((r) => this.fromRow(r))
  }

  async findChildren(parentId: ArtifactId, type?: ArtifactType): Promise<Artifact[]> {
    if (type) {
      const rows = this.db.prepare(`
        SELECT a.* FROM artifacts a
        INNER JOIN artifact_edges e ON a.id = e.child_id
        WHERE e.parent_id = ? AND a.type = ?
      `).all(parentId, type) as RawRow[]
      return rows.map((r) => this.fromRow(r))
    }
    const rows = this.stmtFindChildren.all(parentId) as RawRow[]
    return rows.map((r) => this.fromRow(r))
  }

  async findParents(childId: ArtifactId): Promise<Artifact[]> {
    const rows = this.stmtFindParents.all(childId) as RawRow[]
    return rows.map((r) => this.fromRow(r))
  }

  async setGate(artifactId: ArtifactId, gate: Gate): Promise<void> {
    const artifact = await this.get(artifactId)
    if (!artifact) throw new ArtifactNotFoundError(artifactId)

    const idx = artifact.gates.findIndex((g) => g.name === gate.name)
    if (idx >= 0) artifact.gates[idx] = gate
    else artifact.gates.push(gate)

    this.db.prepare(`UPDATE artifacts SET gates = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(artifact.gates), Date.now(), artifactId)

    this.eventBus.emit('artifact.gate_checked', { artifactId, gate }, { artifactId })
  }

  // ===== 额外方法 =====

  /** 查询事件（从 events 表） */
  queryEvents(opts: { artifactId?: string; type?: string; limit?: number } = {}): unknown[] {
    const conditions: string[] = ['1=1']
    const params: unknown[] = []

    if (opts.artifactId) {
      conditions.push('artifact_id = ?')
      params.push(opts.artifactId)
    }
    if (opts.type) {
      conditions.push('type = ?')
      params.push(opts.type)
    }

    let sql = `SELECT * FROM events WHERE ${conditions.join(' AND ')} ORDER BY timestamp DESC`
    if (opts.limit) {
      sql += ` LIMIT ?`
      params.push(opts.limit)
    }

    return this.db.prepare(sql).all(...params)
  }

  /** 获取统计信息 */
  stats(): { artifactCount: number; eventCount: number; byType: Record<string, number> } {
    const artifactCount = (this.db.prepare('SELECT COUNT(*) as c FROM artifacts').get() as { c: number }).c
    const eventCount = (this.db.prepare('SELECT COUNT(*) as c FROM events').get() as { c: number }).c
    const rows = this.db.prepare('SELECT type, COUNT(*) as c FROM artifacts GROUP BY type').all() as { type: string; c: number }[]
    const byType: Record<string, number> = {}
    for (const r of rows) byType[r.type] = r.c
    return { artifactCount, eventCount, byType }
  }

  /** 关闭数据库连接 */
  close(): void {
    this.db.close()
  }

  // ===== 内部 =====

  private generateId(type: ArtifactType): ArtifactId {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    this.seq = (this.seq + 1) % 10000
    return `${type.toUpperCase()}-${date}-${this.seq.toString().padStart(4, '0')}`
  }

  private contentPath(type: ArtifactType, id: ArtifactId): string {
    return join(this.artifactsDir, type.toLowerCase(), `${id}.md`)
  }

  private toRow(a: Artifact): Record<string, unknown> {
    return {
      id: a.id,
      type: a.type,
      version: a.version,
      status: a.status,
      statusHistory: JSON.stringify(a.statusHistory),
      parents: JSON.stringify(a.parents),
      children: JSON.stringify(a.children),
      supersedes: a.supersedes ?? null,
      title: a.title,
      contentRef: a.contentRef,
      payload: JSON.stringify(a.payload),
      gates: JSON.stringify(a.gates),
      createdBy: JSON.stringify(a.createdBy),
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      closedAt: a.closedAt ?? null,
      tags: JSON.stringify(a.tags),
      labels: JSON.stringify(a.labels),
    }
  }

  private fromRow(row: RawRow): Artifact {
    return {
      id: row.id,
      type: row.type as ArtifactType,
      version: row.version,
      status: row.status,
      statusHistory: JSON.parse(row.status_history) as StatusChange[],
      parents: JSON.parse(row.parents) as ArtifactId[],
      children: JSON.parse(row.children) as ArtifactId[],
      supersedes: row.supersedes ?? undefined,
      title: row.title,
      contentRef: row.content_ref,
      payload: JSON.parse(row.payload),
      gates: JSON.parse(row.gates) as Gate[],
      createdBy: JSON.parse(row.created_by) as Actor,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at ?? undefined,
      tags: JSON.parse(row.tags) as string[],
      labels: JSON.parse(row.labels) as Record<string, string>,
    }
  }
}

// ===== 数据库行的原始类型 =====
interface RawRow {
  id: string
  type: string
  version: number
  status: string
  status_history: string
  parents: string
  children: string
  supersedes: string | null
  title: string
  content_ref: string
  payload: string
  gates: string
  created_by: string
  created_at: number
  updated_at: number
  closed_at: number | null
  tags: string
  labels: string
}

