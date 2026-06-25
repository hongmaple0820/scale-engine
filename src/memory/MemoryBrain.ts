import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { resolvePathWithinRoots } from '../core/pathSafety.js'
import { WorkflowEvalStore, type FailureReplayRecord } from '../eval/WorkflowEval.js'
import { RuntimeEvidenceLedger, type RuntimeEvidenceRecord } from '../runtime/RuntimeEvidenceLedger.js'
import { redactEvidenceText, redactEvidenceValue } from '../tools/ToolEvidenceStore.js'
import type { MemoryLearningCandidate } from './MemoryLearning.js'

export type MemoryNodeType = 'fact' | 'decision' | 'incident' | 'relation' | 'contradiction'
export type MemoryNodeLayer = 'L1-trace' | 'L2-policy' | 'L3-world-model' | 'crystallized'
export type MemoryNodeSource = 'runtime-evidence' | 'task-artifact' | 'docs' | 'git' | 'manual'
export type MemoryNodeScope = 'project' | 'workspace' | 'global-candidate'
export type MemoryNodeStatus = 'candidate' | 'active' | 'stale' | 'rejected'
export type MemoryReviewAction = 'approve' | 'reject' | 'stale' | 'restore'

export interface MemoryNode {
  id: string
  type: MemoryNodeType
  layer: MemoryNodeLayer
  title: string
  summary: string
  entities: string[]
  source: MemoryNodeSource
  evidencePaths: string[]
  confidence: number
  scope: MemoryNodeScope
  status: MemoryNodeStatus
  createdAt: string
  updatedAt: string
  lastVerifiedAt?: string
  metadata?: Record<string, unknown>
}

export interface MemoryBrainOptions {
  projectDir?: string
  scaleDir?: string
  dbPath?: string
  now?: () => Date
}

export interface MemoryIngestOptions {
  from: 'evidence' | 'candidate' | 'failure'
  taskId?: string
  sessionId?: string
  candidateId?: string
  failureId?: string
  type?: MemoryNodeType
  scope?: MemoryNodeScope
}

export interface MemoryIngestReport {
  ok: boolean
  source: MemoryIngestOptions['from']
  created: number
  skipped: number
  nodes: MemoryNode[]
  warnings: string[]
}

export interface MemoryQueryReport {
  query: string
  count: number
  nodes: MemoryNode[]
}

export interface MemoryContradiction {
  id: string
  title: string
  summary: string
  nodeIds: string[]
  entities: string[]
  evidencePaths: string[]
  confidence: number
}

export interface MemoryContradictionReport {
  ok: boolean
  count: number
  contradictions: MemoryContradiction[]
}

export interface MemoryDreamReport {
  ok: boolean
  generatedAt: string
  summary: {
    total: number
    active: number
    candidate: number
    stale: number
    missingEvidence: number
    duplicateGroups: number
    contradictions: number
    byLayer: Record<MemoryNodeLayer, number>
  }
  promotionCandidates: Array<{ id: string; title: string; confidence: number; evidencePaths: string[] }>
  staleCandidates: Array<{ id: string; title: string; reason: string }>
  duplicateGroups: Array<{ fingerprint: string; nodeIds: string[]; title: string }>
  contradictions: MemoryContradiction[]
  suggestedDocs: string[]
}

export interface MemoryPromoteReport {
  ok: boolean
  node?: MemoryNode
  warnings: string[]
}

export interface MemoryReviewReport {
  ok: boolean
  action: MemoryReviewAction
  previousStatus?: MemoryNodeStatus
  node?: MemoryNode
  warnings: string[]
}

export interface MemoryRefineReport {
  ok: boolean
  generatedAt: string
  extracted: {
    L2Policies: number
    L3WorldModels: number
    crystallized: number
  }
  nodes: MemoryNode[]
  warnings: string[]
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memory_nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  layer TEXT NOT NULL DEFAULT 'L1-trace',
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  entities TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL,
  evidence_paths TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL,
  scope TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_verified_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  fingerprint TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_type ON memory_nodes(type);
CREATE INDEX IF NOT EXISTS idx_memory_nodes_status ON memory_nodes(status);
CREATE INDEX IF NOT EXISTS idx_memory_nodes_scope ON memory_nodes(scope);
CREATE INDEX IF NOT EXISTS idx_memory_nodes_fingerprint ON memory_nodes(fingerprint);

CREATE TABLE IF NOT EXISTS memory_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO memory_meta (key, value) VALUES ('schema_version', '2');
`

const ADD_LAYER_COLUMN = `ALTER TABLE memory_nodes ADD COLUMN layer TEXT NOT NULL DEFAULT 'L1-trace'`
const ADD_LAYER_INDEX = `CREATE INDEX IF NOT EXISTS idx_memory_nodes_layer ON memory_nodes(layer)`
const SET_SCHEMA_V2 = `UPDATE memory_meta SET value = '2' WHERE key = 'schema_version'`

export class MemoryBrain {
  private projectDir: string
  private scaleRoot: string
  private dbPath: string
  private db: Database.Database
  private now: () => Date

  constructor(options: MemoryBrainOptions = {}) {
    this.projectDir = resolve(options.projectDir ?? process.cwd())
    this.scaleRoot = resolveScaleRoot(this.projectDir, options.scaleDir)
    this.dbPath = options.dbPath ?? join(this.scaleRoot, 'memory', 'brain.sqlite')
    this.now = options.now ?? (() => new Date())
    mkdirSync(dirname(this.dbPath), { recursive: true })
    this.db = new Database(this.dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('busy_timeout = 5000')
    this.db.exec(SCHEMA)
    this.migrate()
    this.writeManifest()
  }

  private migrate(): void {
    try {
      const row = this.db.prepare("SELECT value FROM memory_meta WHERE key = 'schema_version'").get() as { value: string } | undefined
      const version = row ? Number(row.value) : 2
      if (version < 2) {
        // Add layer column to existing v1 database
        try { this.db.exec(ADD_LAYER_COLUMN) } catch { /* column already exists */ }
        try { this.db.exec(ADD_LAYER_INDEX) } catch { /* index already exists */ }
        try { this.db.exec(SET_SCHEMA_V2) } catch { /* already updated */ }
      }
    } catch {
      // Fresh database, schema already created by SCHEMA constant
    }
  }

  addNode(input: Partial<MemoryNode> & Pick<MemoryNode, 'type' | 'title' | 'summary' | 'source'>): MemoryNode {
    const now = this.now().toISOString()
    const candidate: MemoryNode = sanitizeNode({
      id: input.id ?? `MEM-${Date.now()}-${randomUUID().slice(0, 8)}`,
      type: input.type,
      layer: input.layer ?? 'L1-trace',
      title: input.title,
      summary: input.summary,
      entities: unique(input.entities ?? inferEntities(`${input.title}\n${input.summary}`)),
      source: input.source,
      evidencePaths: unique(input.evidencePaths ?? []),
      confidence: clampConfidence(input.confidence ?? 0.55),
      scope: input.scope ?? 'project',
      status: input.status ?? 'candidate',
      createdAt: input.createdAt ?? now,
      updatedAt: now,
      lastVerifiedAt: input.lastVerifiedAt,
      metadata: input.metadata ?? {},
    })
    assertNode(candidate)
    this.upsert(candidate)
    return candidate
  }

  ingest(options: MemoryIngestOptions): MemoryIngestReport {
    if (options.from === 'candidate') return this.ingestCandidate(options)
    if (options.from === 'failure') return this.ingestFailureReplay(options)
    return this.ingestEvidence(options)
  }

  query(query: string, options: { limit?: number; status?: MemoryNodeStatus; layer?: MemoryNodeLayer } = {}): MemoryQueryReport {
    const terms = tokenize(query)
    const nodes = this.list({ status: options.status, layer: options.layer })
      .map(node => ({ node, score: scoreNode(node, terms) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || b.node.confidence - a.node.confidence)
      .slice(0, options.limit ?? 8)
      .map(item => item.node)
    return {
      query,
      count: nodes.length,
      nodes,
    }
  }

  contradictions(): MemoryContradictionReport {
    const contradictions = detectContradictions(this.list({ status: 'active' }))
    return {
      ok: contradictions.length === 0,
      count: contradictions.length,
      contradictions,
    }
  }

  dream(): MemoryDreamReport {
    const nodes = this.list()
    const duplicateGroups = duplicateGroupsFor(nodes)
    const contradictions = detectContradictions(nodes.filter(node => node.status === 'active' || node.status === 'candidate'))
    const missingEvidence = nodes.filter(node => node.status === 'active' && node.evidencePaths.length === 0)
    const staleCandidates = nodes
      .filter(node => node.status === 'active' && isStale(node))
      .map(node => ({ id: node.id, title: node.title, reason: 'last verification is older than 30 days or missing' }))
    const promotionCandidates = nodes
      .filter(node => node.status === 'candidate' && node.evidencePaths.length > 0 && node.confidence >= 0.7)
      .map(node => ({ id: node.id, title: node.title, confidence: node.confidence, evidencePaths: node.evidencePaths }))

    const byLayer: Record<MemoryNodeLayer, number> = {
      'L1-trace': 0, 'L2-policy': 0, 'L3-world-model': 0, 'crystallized': 0,
    }
    for (const node of nodes) byLayer[node.layer] = (byLayer[node.layer] ?? 0) + 1

    return {
      ok: missingEvidence.length === 0,
      generatedAt: this.now().toISOString(),
      summary: {
        total: nodes.length,
        active: nodes.filter(node => node.status === 'active').length,
        candidate: nodes.filter(node => node.status === 'candidate').length,
        stale: staleCandidates.length,
        missingEvidence: missingEvidence.length,
        duplicateGroups: duplicateGroups.length,
        contradictions: contradictions.length,
        byLayer,
      },
      promotionCandidates,
      staleCandidates,
      duplicateGroups,
      contradictions,
      suggestedDocs: suggestDocs(nodes, contradictions),
    }
  }

  promote(id: string, options: { scope?: MemoryNodeScope } = {}): MemoryPromoteReport {
    let node = this.get(id)
    const warnings: string[] = []
    if (!node) {
      const candidate = this.readLearningCandidate(id)
      if (!candidate) {
        return { ok: false, warnings: [`Memory node or learning candidate not found: ${id}`] }
      }
      const report = this.ingestCandidate({ from: 'candidate', candidateId: id, scope: options.scope })
      node = report.nodes[0]
      warnings.push(...report.warnings)
    }
    if (!node) return { ok: false, warnings: [`Unable to promote: ${id}`] }
    if (node.evidencePaths.length === 0) {
      return { ok: false, node, warnings: [...warnings, 'Active memory requires at least one evidence path.'] }
    }
    const promoted: MemoryNode = {
      ...node,
      status: 'active',
      scope: options.scope ?? node.scope,
      confidence: Math.max(node.confidence, 0.75),
      updatedAt: this.now().toISOString(),
      lastVerifiedAt: this.now().toISOString(),
    }
    assertNode(promoted)
    this.upsert(promoted)
    return { ok: true, node: promoted, warnings }
  }

  review(id: string, action: MemoryReviewAction, options: { reason?: string; actor?: string; scope?: MemoryNodeScope } = {}): MemoryReviewReport {
    const node = this.get(id)
    const previousStatus = node?.status
    if (action === 'approve' || action === 'restore') {
      if (node && action === 'approve' && node.status !== 'candidate') {
        return { ok: false, action, previousStatus, node, warnings: [`Approve requires candidate memory, got ${node.status}.`] }
      }
      if (node && action === 'restore' && !['stale', 'rejected'].includes(node.status)) {
        return { ok: false, action, previousStatus, node, warnings: [`Restore requires stale or rejected memory, got ${node.status}.`] }
      }
      const report = this.promote(id, { scope: options.scope })
      return {
        ok: report.ok,
        action,
        previousStatus,
        node: report.node,
        warnings: report.warnings,
      }
    }

    if (!node) return { ok: false, action, warnings: [`Memory node not found: ${id}`] }
    if (action === 'reject' && node.status !== 'candidate') {
      return { ok: false, action, previousStatus, node, warnings: [`Reject requires candidate memory, got ${node.status}.`] }
    }
    if (action === 'stale' && node.status !== 'active') {
      return { ok: false, action, previousStatus, node, warnings: [`Stale requires active memory, got ${node.status}.`] }
    }

    const now = this.now().toISOString()
    const reviewed: MemoryNode = {
      ...node,
      status: action === 'reject' ? 'rejected' : 'stale',
      updatedAt: now,
      metadata: {
        ...(node.metadata ?? {}),
        lastReview: {
          action,
          actor: options.actor ?? 'system',
          reason: options.reason,
          reviewedAt: now,
          previousStatus: node.status,
        },
      },
    }
    assertNode(reviewed)
    this.upsert(reviewed)
    return { ok: true, action, previousStatus, node: reviewed, warnings: [] }
  }

  exportJsonl(): string {
    return this.list().map(node => JSON.stringify(node)).join('\n') + '\n'
  }

  importJsonl(filePath: string): { ok: boolean; imported: number; skipped: number; warnings: string[] } {
    const warnings: string[] = []
    let imported = 0
    let skipped = 0
    const resolvedPath = resolvePathWithinRoots(filePath, {
      baseDir: this.projectDir,
      allowedRoots: [this.projectDir],
      label: 'Memory import',
    })
    const text = readFileSync(resolvedPath, 'utf-8')
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      try {
        const node = sanitizeNode(JSON.parse(line) as MemoryNode)
        assertNode(node)
        this.upsert(node)
        imported += 1
      } catch (error) {
        skipped += 1
        warnings.push(`Skipped line: ${(error as Error).message}`)
      }
    }
    return { ok: warnings.length === 0, imported, skipped, warnings }
  }

  list(filter: { status?: MemoryNodeStatus; scope?: MemoryNodeScope; layer?: MemoryNodeLayer } = {}): MemoryNode[] {
    let sql = 'SELECT * FROM memory_nodes'
    const where: string[] = []
    const params: Record<string, string> = {}
    if (filter.status) {
      where.push('status = @status')
      params.status = filter.status
    }
    if (filter.scope) {
      where.push('scope = @scope')
      params.scope = filter.scope
    }
    if (filter.layer) {
      where.push('layer = @layer')
      params.layer = filter.layer
    }
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`
    sql += ' ORDER BY updated_at DESC'
    return this.db.prepare(sql).all(params).map(rowToNode)
  }

  get(id: string): MemoryNode | null {
    const row = this.db.prepare('SELECT * FROM memory_nodes WHERE id = ?').get(id)
    return row ? rowToNode(row) : null
  }

  close(): void {
    this.db.close()
  }

  refine(options: { minL1ForL2?: number; minL2ForL3?: number; limit?: number } = {}): MemoryRefineReport {
    const minL1ForL2 = options.minL1ForL2 ?? 3
    const minL2ForL3 = options.minL2ForL3 ?? 3
    const limit = options.limit ?? 20
    const warnings: string[] = []
    const created: MemoryNode[] = []
    const now = this.now().toISOString()

    // L1→L2: Extract policies from active L1 traces that share entities
    const l1Traces = this.list({ status: 'active', layer: 'L1-trace' })
    const l1ByEntity = groupByEntity(l1Traces)
    for (const [entity, traces] of l1ByEntity) {
      if (traces.length < minL1ForL2) continue
      if (created.length >= limit) break
      // Check if L2 policy already exists for this entity
      const existingL2 = this.list({ layer: 'L2-policy' })
        .some(n => n.entities.includes(entity))
      if (existingL2) continue

      const patterns = traces.map(t => t.summary).slice(0, 5)
      const confidence = clampConfidence(Math.min(0.85, 0.5 + traces.length * 0.05))
      const node = this.addNode({
        type: 'decision',
        layer: 'L2-policy',
        title: `Policy: ${entity} pattern (${traces.length} observations)`,
        summary: `Observed pattern across ${traces.length} traces: ${patterns[0]}${patterns.length > 1 ? ` (and ${patterns.length - 1} similar)` : ''}`,
        entities: [entity, ...traces.flatMap(t => t.entities).filter(e => e !== entity).slice(0, 5)],
        source: 'manual',
        evidencePaths: traces.flatMap(t => t.evidencePaths).slice(0, 5),
        confidence,
        scope: 'project',
        status: confidence >= 0.7 ? 'active' : 'candidate',
        metadata: {
          refinedFrom: traces.map(t => t.id),
          layer: 'L2-policy',
          refinedAt: now,
        },
      })
      created.push(node)
    }

    // L2→L3: Extract world models from L2 policies that share entities
    const l2Policies = this.list({ status: 'active', layer: 'L2-policy' })
    const l2ByEntity = groupByEntity(l2Policies)
    for (const [entity, policies] of l2ByEntity) {
      if (policies.length < minL2ForL3) continue
      if (created.length >= limit) break
      const existingL3 = this.list({ layer: 'L3-world-model' })
        .some(n => n.entities.includes(entity))
      if (existingL3) continue

      const policyTitles = policies.map(p => p.title).slice(0, 5)
      const confidence = clampConfidence(Math.min(0.9, 0.6 + policies.length * 0.05))
      const node = this.addNode({
        type: 'fact',
        layer: 'L3-world-model',
        title: `World model: ${entity} (${policies.length} policies)`,
        summary: `Consolidated understanding from ${policies.length} policies: ${policyTitles.join('; ')}`,
        entities: [entity, ...policies.flatMap(p => p.entities).filter(e => e !== entity).slice(0, 8)],
        source: 'manual',
        evidencePaths: policies.flatMap(p => p.evidencePaths).slice(0, 8),
        confidence,
        scope: 'project',
        status: confidence >= 0.75 ? 'active' : 'candidate',
        metadata: {
          refinedFrom: policies.map(p => p.id),
          layer: 'L3-world-model',
          refinedAt: now,
        },
      })
      created.push(node)
    }

    // Crystallize: high-confidence L3 world models with long evidence chains
    const l3Models = this.list({ status: 'active', layer: 'L3-world-model' })
    for (const model of l3Models) {
      if (created.length >= limit) break
      if (model.confidence < 0.85) continue
      const existingCrystal = this.list({ layer: 'crystallized' })
        .some(n => n.entities.some(e => model.entities.includes(e)))
      if (existingCrystal) continue

      const node = this.addNode({
        type: model.type,
        layer: 'crystallized',
        title: `Crystallized: ${model.title}`,
        summary: model.summary,
        entities: model.entities,
        source: model.source,
        evidencePaths: model.evidencePaths,
        confidence: Math.min(0.95, model.confidence + 0.05),
        scope: 'global-candidate',
        status: 'candidate',
        metadata: {
          refinedFrom: [model.id],
          layer: 'crystallized',
          refinedAt: now,
        },
      })
      created.push(node)
    }

    const l2Count = created.filter(n => n.layer === 'L2-policy').length
    const l3Count = created.filter(n => n.layer === 'L3-world-model').length
    const crystalCount = created.filter(n => n.layer === 'crystallized').length

    if (l1Traces.length < minL1ForL2) warnings.push(`Only ${l1Traces.length} active L1 traces (need ${minL1ForL2}+ for L2 extraction)`)
    if (l2Policies.length < minL2ForL3) warnings.push(`Only ${l2Policies.length} active L2 policies (need ${minL2ForL3}+ for L3 extraction)`)

    return {
      ok: created.length > 0,
      generatedAt: now,
      extracted: { L2Policies: l2Count, L3WorldModels: l3Count, crystallized: crystalCount },
      nodes: created,
      warnings,
    }
  }

  private ingestEvidence(options: MemoryIngestOptions): MemoryIngestReport {
    const ledger = new RuntimeEvidenceLedger({
      projectDir: this.projectDir,
      scaleDir: this.scaleRoot,
      createDirs: false,
    })
    const records = ledger.list({ taskId: options.taskId, sessionId: options.sessionId, limit: Number.MAX_SAFE_INTEGER })
    const warnings: string[] = []
    const nodes: MemoryNode[] = []
    let skipped = 0
    for (const record of records) {
      if (record.status === 'skipped') {
        skipped += 1
        continue
      }
      const node = this.addNode(nodeFromEvidence(record, {
        projectDir: this.projectDir,
        scaleRoot: this.scaleRoot,
        type: options.type,
        scope: options.scope,
      }))
      nodes.push(node)
    }
    if (records.length === 0) warnings.push('No runtime evidence matched the requested task/session scope.')
    return {
      ok: nodes.length > 0,
      source: 'evidence',
      created: nodes.length,
      skipped,
      nodes,
      warnings,
    }
  }

  private ingestCandidate(options: MemoryIngestOptions): MemoryIngestReport {
    const candidate = this.readLearningCandidate(options.candidateId)
    if (!candidate) {
      return {
        ok: false,
        source: 'candidate',
        created: 0,
        skipped: 0,
        nodes: [],
        warnings: [`Learning candidate not found: ${options.candidateId ?? '<latest>'}`],
      }
    }
    const node = this.addNode(nodeFromCandidate(candidate, {
      projectDir: this.projectDir,
      scaleRoot: this.scaleRoot,
      type: options.type,
      scope: options.scope,
    }))
    return {
      ok: true,
      source: 'candidate',
      created: 1,
      skipped: 0,
      nodes: [node],
      warnings: candidate.promotable ? [] : ['Learning candidate is not marked promotable; keep it as candidate until more evidence is recorded.'],
    }
  }

  private ingestFailureReplay(options: MemoryIngestOptions): MemoryIngestReport {
    const store = new WorkflowEvalStore({
      projectDir: this.projectDir,
      scaleDir: this.scaleRoot,
    })
    const failures = options.failureId
      ? [store.getFailure(options.failureId)].filter((failure): failure is FailureReplayRecord => Boolean(failure))
      : store.listFailures({ taskId: options.taskId })
    const warnings: string[] = []
    const nodes: MemoryNode[] = []
    let skipped = 0
    for (const failure of failures) {
      if (failure.status === 'closed' || failure.status === 'accepted-risk') {
        skipped += 1
        continue
      }
      const node = this.addNode(nodeFromFailureReplay(failure, {
        projectDir: this.projectDir,
        scaleRoot: this.scaleRoot,
        type: options.type,
        scope: options.scope,
      }))
      nodes.push(node)
    }
    if (failures.length === 0) warnings.push(`Failure replay not found: ${options.failureId ?? options.taskId ?? '<latest>'}`)
    return {
      ok: nodes.length > 0,
      source: 'failure',
      created: nodes.length,
      skipped,
      nodes,
      warnings,
    }
  }

  private readLearningCandidate(candidateId?: string): MemoryLearningCandidate | null {
    const dir = join(this.scaleRoot, 'memory', 'learning-candidates')
    if (!existsSync(dir)) return null
    const file = candidateId
      ? join(dir, `${safePathSegment(candidateId)}.json`)
      : readdirSync(dir)
          .filter(name => name.endsWith('.json'))
          .map(name => join(dir, name))
          .sort()
          .at(-1)
    if (!file || !existsSync(file)) return null
    try {
      return JSON.parse(readFileSync(file, 'utf-8')) as MemoryLearningCandidate
    } catch {
      return null
    }
  }

  private upsert(node: MemoryNode): void {
    const fingerprint = fingerprintFor(node)
    this.db.prepare(`
      INSERT INTO memory_nodes (
        id, type, layer, title, summary, entities, source, evidence_paths, confidence, scope, status,
        created_at, updated_at, last_verified_at, metadata, fingerprint
      ) VALUES (
        @id, @type, @layer, @title, @summary, @entities, @source, @evidencePaths, @confidence, @scope, @status,
        @createdAt, @updatedAt, @lastVerifiedAt, @metadata, @fingerprint
      )
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        layer = excluded.layer,
        title = excluded.title,
        summary = excluded.summary,
        entities = excluded.entities,
        source = excluded.source,
        evidence_paths = excluded.evidence_paths,
        confidence = excluded.confidence,
        scope = excluded.scope,
        status = excluded.status,
        updated_at = excluded.updated_at,
        last_verified_at = excluded.last_verified_at,
        metadata = excluded.metadata,
        fingerprint = excluded.fingerprint
    `).run({
      id: node.id,
      type: node.type,
      layer: node.layer,
      title: node.title,
      summary: node.summary,
      entities: JSON.stringify(node.entities),
      source: node.source,
      evidencePaths: JSON.stringify(node.evidencePaths),
      confidence: node.confidence,
      scope: node.scope,
      status: node.status,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      lastVerifiedAt: node.lastVerifiedAt ?? null,
      metadata: JSON.stringify(node.metadata ?? {}),
      fingerprint,
    })
  }

  private writeManifest(): void {
    const manifestPath = join(this.scaleRoot, 'memory', 'brain-manifest.json')
    mkdirSync(dirname(manifestPath), { recursive: true })
    writeFileSync(manifestPath, JSON.stringify({
      version: '1.0',
      dbPath: normalizeProjectPath(this.projectDir, this.dbPath),
      scope: 'project',
      activeMemoryRequiresEvidence: true,
      generatedAt: this.now().toISOString(),
    }, null, 2), 'utf-8')
  }
}

function nodeFromEvidence(record: RuntimeEvidenceRecord, input: {
  projectDir: string
  scaleRoot: string
  type?: MemoryNodeType
  scope?: MemoryNodeScope
}): Partial<MemoryNode> & Pick<MemoryNode, 'type' | 'title' | 'summary' | 'source'> {
  const evidencePath = normalizeProjectPath(input.projectDir, join(input.scaleRoot, 'evidence', 'runtime', `${record.id}.json`))
  return {
    id: `MEM-${record.id}`,
    type: input.type ?? (record.status === 'failed' ? 'incident' : 'fact'),
    title: record.title,
    summary: record.summary,
    entities: inferEntities(`${record.title}\n${record.summary}\n${record.command ?? ''}`),
    source: 'runtime-evidence',
    evidencePaths: unique([evidencePath, ...(record.artifacts ?? [])]),
    confidence: record.status === 'passed' ? 0.72 : 0.58,
    scope: input.scope ?? 'project',
    status: 'candidate',
    metadata: {
      taskId: record.taskId,
      sessionId: record.sessionId,
      evidenceId: record.id,
      evidenceStatus: record.status,
      command: record.command,
      exitCode: record.exitCode,
    },
  }
}

function nodeFromCandidate(candidate: MemoryLearningCandidate, input: {
  projectDir: string
  scaleRoot: string
  type?: MemoryNodeType
  scope?: MemoryNodeScope
}): Partial<MemoryNode> & Pick<MemoryNode, 'type' | 'title' | 'summary' | 'source'> {
  const candidatePath = normalizeProjectPath(input.projectDir, join(input.scaleRoot, 'memory', 'learning-candidates', `${candidate.id}.json`))
  return {
    id: `MEM-${candidate.id}`,
    type: input.type ?? 'decision',
    title: candidate.title,
    summary: candidate.summary,
    entities: inferEntities(`${candidate.title}\n${candidate.summary}\n${candidate.tags.join(' ')}`),
    source: 'task-artifact',
    evidencePaths: unique([candidatePath, ...candidate.graphRefs, ...candidate.evidenceIds.map(id => join('.scale', 'evidence', 'runtime', `${id}.json`))]),
    confidence: candidate.promotable ? 0.72 : 0.5,
    scope: input.scope ?? 'project',
    status: 'candidate',
    metadata: {
      taskId: candidate.taskId,
      sessionId: candidate.sessionId,
      candidateId: candidate.id,
      recommendedAction: candidate.recommendedAction,
      tags: candidate.tags,
    },
  }
}

function nodeFromFailureReplay(failure: FailureReplayRecord, input: {
  projectDir: string
  scaleRoot: string
  type?: MemoryNodeType
  scope?: MemoryNodeScope
}): Partial<MemoryNode> & Pick<MemoryNode, 'type' | 'title' | 'summary' | 'source'> {
  const failurePath = normalizeProjectPath(input.projectDir, join(input.scaleRoot, 'evals', 'failures', `${safePathSegment(failure.id)}.json`))
  const summary = [
    failure.wrongTurn,
    `Prevention: ${failure.prevention}`,
    `Correction: ${failure.correction}`,
  ].join(' ')
  return {
    id: `MEM-${failure.id}`,
    type: input.type ?? 'incident',
    title: `Failure replay: ${failure.category} in ${failure.caseId}`,
    summary,
    entities: inferEntities(`${failure.category}\n${failure.phase}\n${failure.task}\n${failure.prevention}`),
    source: 'task-artifact',
    evidencePaths: [failurePath],
    confidence: failure.status === 'promoted' ? 0.7 : 0.62,
    scope: input.scope ?? 'project',
    status: 'candidate',
    metadata: {
      taskId: failure.taskId,
      suiteId: failure.suiteId,
      caseId: failure.caseId,
      failureId: failure.id,
      category: failure.category,
      phase: failure.phase,
      failureStatus: failure.status,
      replayCommand: failure.replayCommand,
      redactionApplied: failure.redactionApplied,
    },
  }
}

function detectContradictions(nodes: MemoryNode[]): MemoryContradiction[] {
  const contradictions: MemoryContradiction[] = []
  const pairs = new Set<string>()
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const left = nodes[i]
      const right = nodes[j]
      const shared = left.entities.filter(entity => right.entities.includes(entity))
      if (shared.length === 0) continue
      if (!polaritiesConflict(left, right)) continue
      const key = [left.id, right.id].sort().join(':')
      if (pairs.has(key)) continue
      pairs.add(key)
      contradictions.push({
        id: `CON-${hash(key).slice(0, 10)}`,
        title: `Contradiction around ${shared.slice(0, 3).join(', ')}`,
        summary: `${left.title} conflicts with ${right.title}.`,
        nodeIds: [left.id, right.id],
        entities: shared,
        evidencePaths: unique([...left.evidencePaths, ...right.evidencePaths]),
        confidence: Math.min(0.9, Math.max(left.confidence, right.confidence)),
      })
    }
  }
  return contradictions
}

function polaritiesConflict(left: MemoryNode, right: MemoryNode): boolean {
  const l = polarity(`${left.title}\n${left.summary}`)
  const r = polarity(`${right.title}\n${right.summary}`)
  if (l.enabled && r.disabled) return true
  if (l.disabled && r.enabled) return true
  if (l.exists && r.missing) return true
  if (l.missing && r.exists) return true
  if (l.allowed && r.blocked) return true
  if (l.blocked && r.allowed) return true
  return false
}

function polarity(text: string): Record<string, boolean> {
  const lower = text.toLowerCase()
  return {
    enabled: /\b(enabled|enable|available|works|passed|active|on)\b/.test(lower),
    disabled: /\b(disabled|disable|unavailable|not available|failed|inactive|off)\b/.test(lower),
    exists: /\b(exists|present|configured|found)\b/.test(lower),
    missing: /\b(missing|absent|not configured|not found)\b/.test(lower),
    allowed: /\b(allowed|permitted|safe)\b/.test(lower),
    blocked: /\b(blocked|forbidden|unsafe|denied)\b/.test(lower),
  }
}

function duplicateGroupsFor(nodes: MemoryNode[]): Array<{ fingerprint: string; nodeIds: string[]; title: string }> {
  const groups = new Map<string, MemoryNode[]>()
  for (const node of nodes) {
    const key = fingerprintFor(node)
    groups.set(key, [...(groups.get(key) ?? []), node])
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([fingerprint, group]) => ({
      fingerprint,
      nodeIds: group.map(node => node.id),
      title: group[0].title,
    }))
}

function suggestDocs(nodes: MemoryNode[], contradictions: MemoryContradiction[]): string[] {
  const suggestions = new Set<string>()
  if (nodes.some(node => node.type === 'decision')) suggestions.add('docs/architecture/')
  if (nodes.some(node => node.type === 'incident')) suggestions.add('docs/worklog/metrics.md')
  if (contradictions.length > 0) suggestions.add('docs/workflow/README.md')
  return [...suggestions]
}

function isStale(node: MemoryNode): boolean {
  const date = node.lastVerifiedAt ?? node.updatedAt
  const ageMs = Date.now() - Date.parse(date)
  return Number.isFinite(ageMs) && ageMs > 30 * 24 * 60 * 60 * 1000
}

function scoreNode(node: MemoryNode, terms: string[]): number {
  if (terms.length === 0) return 1
  const haystack = `${node.title}\n${node.summary}\n${node.entities.join(' ')}\n${node.evidencePaths.join(' ')}`.toLowerCase()
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0)
}

function rowToNode(row: unknown): MemoryNode {
  const value = row as Record<string, unknown>
  return {
    id: String(value.id),
    type: value.type as MemoryNodeType,
    layer: (value.layer as MemoryNodeLayer) ?? 'L1-trace',
    title: String(value.title),
    summary: String(value.summary),
    entities: parseJsonArray(value.entities),
    source: value.source as MemoryNodeSource,
    evidencePaths: parseJsonArray(value.evidence_paths),
    confidence: Number(value.confidence),
    scope: value.scope as MemoryNodeScope,
    status: value.status as MemoryNodeStatus,
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at),
    lastVerifiedAt: value.last_verified_at ? String(value.last_verified_at) : undefined,
    metadata: parseJsonObject(value.metadata),
  }
}

function assertNode(node: MemoryNode): void {
  if (node.status === 'active' && node.evidencePaths.length === 0) {
    throw new Error('Active memory requires at least one evidence path.')
  }
  if (node.scope === 'global-candidate' && node.status === 'active') {
    throw new Error('Global candidate memory cannot be activated inside a project brain.')
  }
}

function sanitizeNode(node: MemoryNode): MemoryNode {
  const redacted = redactEvidenceValue(node).value as MemoryNode
  const redact = (value: string) => redactEvidenceText(value).value
  return {
    ...redacted,
    layer: redacted.layer ?? 'L1-trace',
    title: redact(redacted.title),
    summary: redact(redacted.summary),
    entities: unique((redacted.entities ?? []).map(entity => redact(String(entity))).filter(Boolean)),
    evidencePaths: unique((redacted.evidencePaths ?? []).map(path => String(path)).filter(Boolean)),
    confidence: clampConfidence(redacted.confidence),
    metadata: redacted.metadata ?? {},
  }
}

function tokenize(text: string): string[] {
  return unique(text.toLowerCase().split(/[^a-z0-9._/-]+/).filter(term => term.length >= 2))
}

function inferEntities(text: string): string[] {
  const matches = text.match(/[A-Za-z][A-Za-z0-9._/-]{2,}/g) ?? []
  return unique(matches.map(item => item.toLowerCase()).filter(item => !STOP_WORDS.has(item))).slice(0, 12)
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'task', 'tests', 'passed', 'failed', 'summary'])

function fingerprintFor(node: MemoryNode): string {
  return hash(`${node.type}:${node.scope}:${node.title.toLowerCase().replace(/\s+/g, ' ').trim()}`)
}

function hash(value: string): string {
  return createHash('sha1').update(value).digest('hex')
}

function parseJsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value))
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return Math.round(Math.max(0.05, Math.min(0.95, value)) * 100) / 100
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || 'memory-learning'
}

function resolveScaleRoot(projectDir: string, scaleDir?: string): string {
  return isAbsolute(scaleDir ?? '') ? scaleDir as string : join(projectDir, scaleDir ?? '.scale')
}

function normalizeProjectPath(projectDir: string, filePath: string): string {
  const rel = relative(projectDir, filePath)
  return rel && !rel.startsWith('..') && !isAbsolute(rel)
    ? rel.replace(/\\/g, '/')
    : filePath
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function groupByEntity(nodes: MemoryNode[]): Map<string, MemoryNode[]> {
  const groups = new Map<string, MemoryNode[]>()
  for (const node of nodes) {
    for (const entity of node.entities) {
      const existing = groups.get(entity) ?? []
      existing.push(node)
      groups.set(entity, existing)
    }
  }
  // Only return groups with multiple nodes (shared entities)
  for (const [entity, group] of groups) {
    if (group.length < 2) groups.delete(entity)
  }
  return groups
}
