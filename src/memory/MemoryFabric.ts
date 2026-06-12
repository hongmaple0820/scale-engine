import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { KnowledgeEntry } from '../artifact/types.js'
import type { IKnowledgeBase } from '../knowledge/KnowledgeBase.js'
import {
  resolveRuntimeEvidenceFailures,
  RuntimeEvidenceLedger,
  type RuntimeEvidenceRecord,
} from '../runtime/RuntimeEvidenceLedger.js'
import { SessionLedger, type RuntimeSessionEvent, type RuntimeSessionLevel } from '../runtime/SessionLedger.js'
import { redactEvidenceText } from '../tools/ToolEvidenceStore.js'
import { recallMemoryProviders, type MemoryProviderRecallItem } from './MemoryProviders.js'

export interface MemoryFabricOptions {
  projectDir?: string
  scaleDir?: string
  evidenceLedger?: RuntimeEvidenceLedger
  sessionLedger?: SessionLedger
  knowledgeBase?: Pick<IKnowledgeBase, 'recall' | 'recallByVector'>
}

export interface ContextPackInput {
  task: string
  taskId?: string
  sessionId?: string
  level?: RuntimeSessionLevel
  files?: string[]
  budgetTokens?: number
  knowledgeTopK?: number
}

export interface ContextPackTask {
  task: string
  taskId?: string
  sessionId?: string
  level: RuntimeSessionLevel
  files: string[]
}

export interface ContextPackBudget {
  limit: number
  used: number
  remaining: number
  overBudget: boolean
}

export interface ContextPackSection {
  id: string
  title: string
  priority: number
  estimatedTokens: number
  included: boolean
  reason?: string
  items: ContextPackItem[]
}

export interface ContextPackOmittedSection {
  id: string
  title: string
  reason: string
  estimatedTokens: number
}

export interface ContextPack {
  version: '1.0'
  generatedAt: string
  task: ContextPackTask
  budget: ContextPackBudget
  sections: ContextPackSection[]
  omittedSections: ContextPackOmittedSection[]
}

export type ContextPackItem =
  | RuntimeEvidenceContextItem
  | RuntimeSessionContextItem
  | ProviderMemoryContextItem
  | KnowledgeContextItem
  | GraphContextItem

export interface RuntimeEvidenceContextItem {
  type: 'runtime-evidence'
  id: string
  kind: string
  title: string
  status: string
  resolved?: boolean
  command?: string
  exitCode?: number
  summary: string
  createdAt: string
  artifacts?: string[]
}

export interface RuntimeSessionContextItem {
  type: 'session-event'
  id: string
  eventType: string
  phase?: string
  message?: string
  createdAt: string
}

export interface ProviderMemoryContextItem {
  type: 'provider-memory'
  provider: string
  id: string
  title: string
  summary: string
  confidence: number
  score: number
  evidencePaths: string[]
  sourceUrl?: string
}

export interface KnowledgeContextItem {
  type: 'knowledge'
  id: string
  title: string
  tags: string[]
  contentRef: string
  verified: boolean
  relevance: number
  preview?: string
}

export interface GraphContextItem {
  type: 'graph'
  path: string
  kind: 'graph-report' | 'graph-manifest'
  summary: string
}

interface DraftSection {
  id: string
  title: string
  priority: number
  items: ContextPackItem[]
}

const DEFAULT_BUDGET_TOKENS = 4_000
const DEFAULT_KNOWLEDGE_TOP_K = 5

export class MemoryFabric {
  private projectDir: string
  private scaleRoot: string
  private evidenceLedger: RuntimeEvidenceLedger
  private sessionLedger: SessionLedger
  private knowledgeBase?: Pick<IKnowledgeBase, 'recall' | 'recallByVector'>

  constructor(options: MemoryFabricOptions = {}) {
    this.projectDir = resolve(options.projectDir ?? process.cwd())
    this.scaleRoot = isAbsolute(options.scaleDir ?? '')
      ? options.scaleDir as string
      : join(this.projectDir, options.scaleDir ?? '.scale')
    this.evidenceLedger = options.evidenceLedger ?? new RuntimeEvidenceLedger({
      projectDir: this.projectDir,
      scaleDir: this.scaleRoot,
      createDirs: false,
    })
    this.sessionLedger = options.sessionLedger ?? new SessionLedger({
      projectDir: this.projectDir,
      scaleDir: this.scaleRoot,
      createDirs: false,
    })
    this.knowledgeBase = options.knowledgeBase
  }

  async createContextPack(input: ContextPackInput): Promise<ContextPack> {
    const currentSession = this.sessionLedger.current()
    const task: ContextPackTask = {
      task: input.task,
      taskId: input.taskId ?? currentSession?.taskId,
      sessionId: input.sessionId ?? currentSession?.sessionId,
      level: input.level ?? currentSession?.level ?? 'M',
      files: input.files ?? [],
    }
    const budgetLimit = Math.max(1, Math.floor(input.budgetTokens ?? DEFAULT_BUDGET_TOKENS))
    const baseTokens = estimateTokens(JSON.stringify(task))

    const drafts: DraftSection[] = [
      this.runtimeEvidenceSection(task),
      this.sessionEventsSection(task),
      await this.providerMemorySection(task, input.knowledgeTopK ?? DEFAULT_KNOWLEDGE_TOP_K),
      await this.knowledgeSection(task, input.knowledgeTopK ?? DEFAULT_KNOWLEDGE_TOP_K),
      this.graphSection(),
    ]

    let used = baseTokens
    const sections: ContextPackSection[] = []
    const omittedSections: ContextPackOmittedSection[] = []

    for (const draft of drafts.sort((a, b) => b.priority - a.priority)) {
      const estimatedTokens = estimateTokens(JSON.stringify(draft.items))
      if (draft.items.length === 0) {
        const reason = 'no data available'
        sections.push({ ...draft, estimatedTokens, included: false, reason })
        omittedSections.push({ id: draft.id, title: draft.title, reason, estimatedTokens })
        continue
      }
      if (used + estimatedTokens <= budgetLimit) {
        used += estimatedTokens
        sections.push({ ...draft, estimatedTokens, included: true })
        continue
      }
      const reason = `omitted by token budget (${used + estimatedTokens}/${budgetLimit})`
      sections.push({ ...draft, estimatedTokens, included: false, reason, items: [] })
      omittedSections.push({ id: draft.id, title: draft.title, reason, estimatedTokens })
    }

    const overBudget = used > budgetLimit
    return {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      task,
      budget: {
        limit: budgetLimit,
        used,
        remaining: Math.max(0, budgetLimit - used),
        overBudget,
      },
      sections,
      omittedSections,
    }
  }

  private runtimeEvidenceSection(task: ContextPackTask): DraftSection {
    const records = this.evidenceLedger.list({
      taskId: task.taskId,
      sessionId: task.sessionId,
      limit: 8,
    })
    const resolvedIds = resolveRuntimeEvidenceFailures(records).resolvedIds
    const items = prioritizeEvidence(records, resolvedIds).map(record => toRuntimeEvidenceItem(record, resolvedIds.has(record.id)))
    return {
      id: 'runtime-evidence',
      title: 'Runtime Evidence',
      priority: 100,
      items,
    }
  }

  private sessionEventsSection(task: ContextPackTask): DraftSection {
    const sessionId = task.sessionId
    const events = sessionId ? this.sessionLedger.listEvents(sessionId).slice(-12) : []
    return {
      id: 'session-events',
      title: 'Session Events',
      priority: 80,
      items: events.map(toSessionEventItem),
    }
  }

  private async knowledgeSection(task: ContextPackTask, topK: number): Promise<DraftSection> {
    if (!this.knowledgeBase) {
      return { id: 'knowledge', title: 'Knowledge Recall', priority: 60, items: [] }
    }
    const query = [task.task, task.files.join(' ')].filter(Boolean).join('\n')
    const entries = this.knowledgeBase.recallByVector
      ? await this.knowledgeBase.recallByVector(query, topK)
      : await this.knowledgeBase.recall({ verifiedOnly: true, limit: topK })
    return {
      id: 'knowledge',
      title: 'Knowledge Recall',
      priority: 60,
      items: entries.map(entry => this.toKnowledgeItem(entry)),
    }
  }

  private async providerMemorySection(task: ContextPackTask, topK: number): Promise<DraftSection> {
    const query = [task.task, task.files.join(' ')].filter(Boolean).join('\n')
    const report = await recallMemoryProviders({
      projectDir: this.projectDir,
      scaleDir: this.scaleRoot,
      query,
      task: task.task,
      files: task.files,
      limit: topK,
      includeCandidates: false,
    })
    return {
      id: 'provider-memory',
      title: 'Provider Memory Recall',
      priority: 70,
      items: report.items.map(toProviderMemoryItem),
    }
  }

  private graphSection(): DraftSection {
    const candidates: Array<{ path: string; kind: GraphContextItem['kind'] }> = [
      { path: join(this.projectDir, 'graphify-out', 'graph.json'), kind: 'graph-manifest' },
      { path: join(this.projectDir, 'graphify-out', 'GRAPH_REPORT.md'), kind: 'graph-report' },
      { path: join(this.scaleRoot, 'graph', 'manifest.json'), kind: 'graph-manifest' },
    ]
    const items = candidates
      .filter(candidate => existsSync(candidate.path))
      .map(candidate => ({
        type: 'graph' as const,
        path: normalizeProjectPath(this.projectDir, candidate.path),
        kind: candidate.kind,
        summary: previewFile(candidate.path, 220),
      }))
    return {
      id: 'graph',
      title: 'Project Graph',
      priority: 40,
      items,
    }
  }

  private toKnowledgeItem(entry: KnowledgeEntry): KnowledgeContextItem {
    const contentPath = isAbsolute(entry.contentRef)
      ? entry.contentRef
      : join(this.projectDir, entry.contentRef)
    return {
      type: 'knowledge',
      id: entry.id,
      title: entry.title,
      tags: entry.tags,
      contentRef: entry.contentRef,
      verified: entry.verified,
      relevance: Number(entry.relevance.toFixed(3)),
      preview: safePreviewProjectFile(this.projectDir, contentPath, 240),
    }
  }
}

export interface MemoryDoctorCheck {
  name: string
  status: 'ok' | 'warn' | 'fail'
  message: string
}

export interface MemoryDoctorReport {
  ok: boolean
  checks: MemoryDoctorCheck[]
  pack: ContextPack
}

export async function doctorMemoryFabric(
  options: MemoryFabricOptions,
  input: ContextPackInput,
): Promise<MemoryDoctorReport> {
  const pack = await new MemoryFabric(options).createContextPack(input)
  const checks: MemoryDoctorCheck[] = [
    pack.budget.overBudget
      ? {
          name: 'Context budget',
          status: 'fail',
          message: `Base context uses ${pack.budget.used}/${pack.budget.limit} estimated tokens; raise budget or narrow task scope.`,
        }
      : {
          name: 'Context budget',
          status: 'ok',
          message: `Context pack uses ${pack.budget.used}/${pack.budget.limit} estimated tokens.`,
        },
  ]
  const budgetOmissions = pack.omittedSections.filter(section => section.reason.includes('budget'))
  if (budgetOmissions.length > 0) {
    checks.push({
      name: 'Budget omissions',
      status: 'warn',
      message: `${budgetOmissions.length} lower-priority section(s) omitted by token budget.`,
    })
  }
  const evidence = pack.sections.find(section => section.id === 'runtime-evidence')
  checks.push(evidence?.included
    ? { name: 'Runtime evidence', status: 'ok', message: `${evidence.items.length} evidence item(s) included.` }
    : { name: 'Runtime evidence', status: 'warn', message: evidence?.reason ?? 'No runtime evidence included.' })

  return {
    ok: !checks.some(check => check.status === 'fail'),
    checks,
    pack,
  }
}

export function renderContextPackMarkdown(pack: ContextPack): string {
  const lines = [
    '# SCALE Memory Context Pack',
    '',
    `- Task: ${pack.task.task}`,
    `- Task ID: ${pack.task.taskId ?? 'n/a'}`,
    `- Session ID: ${pack.task.sessionId ?? 'n/a'}`,
    `- Level: ${pack.task.level}`,
    `- Budget: ${pack.budget.used}/${pack.budget.limit} estimated tokens`,
    '',
  ]
  for (const section of pack.sections) {
    lines.push(`## ${section.title}`)
    lines.push(`- Status: ${section.included ? 'included' : 'omitted'}`)
    if (section.reason) lines.push(`- Reason: ${section.reason}`)
    for (const item of section.items) {
      lines.push(`- ${renderItemSummary(item)}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

function prioritizeEvidence(records: RuntimeEvidenceRecord[], resolvedIds: Set<string>): RuntimeEvidenceRecord[] {
  return [...records].sort((a, b) => evidenceStatusRank(b, resolvedIds) - evidenceStatusRank(a, resolvedIds))
}

function evidenceStatusRank(record: RuntimeEvidenceRecord, resolvedIds: Set<string>): number {
  if (record.status === 'failed' && !resolvedIds.has(record.id)) return 3
  if (record.status === 'passed') return 2
  if (record.status === 'failed') return 1.5
  return 1
}

function toRuntimeEvidenceItem(record: RuntimeEvidenceRecord, resolved: boolean): RuntimeEvidenceContextItem {
  return {
    type: 'runtime-evidence',
    id: record.id,
    kind: record.kind,
    title: record.title,
    status: record.status,
    resolved: resolved || undefined,
    command: record.command,
    exitCode: record.exitCode,
    summary: truncate(record.summary, 220),
    createdAt: record.createdAt,
    artifacts: record.artifacts,
  }
}

function toSessionEventItem(event: RuntimeSessionEvent): RuntimeSessionContextItem {
  return {
    type: 'session-event',
    id: event.id,
    eventType: event.type,
    phase: event.phase,
    message: event.message ? truncate(event.message, 220) : undefined,
    createdAt: event.createdAt,
  }
}

function toProviderMemoryItem(item: MemoryProviderRecallItem): ProviderMemoryContextItem {
  return {
    type: 'provider-memory',
    provider: item.provider,
    id: item.id,
    title: item.title,
    summary: item.summary,
    confidence: item.confidence,
    score: item.score,
    evidencePaths: item.evidencePaths,
    sourceUrl: item.sourceUrl,
  }
}

function renderItemSummary(item: ContextPackItem): string {
  if (item.type === 'runtime-evidence') return `[${item.status}] ${item.title}: ${item.summary}`
  if (item.type === 'session-event') return `${item.eventType}${item.phase ? `/${item.phase}` : ''}: ${item.message ?? item.createdAt}`
  if (item.type === 'provider-memory') return `${item.provider}/${item.id}: ${item.title} (${item.confidence.toFixed(2)})`
  if (item.type === 'knowledge') return `${item.title} (${item.tags.join(', ') || 'no tags'})`
  return `${item.kind}: ${item.path}`
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function previewFile(path: string, maxChars: number): string {
  try {
    const preview = truncate(readFileSync(path, 'utf-8').replace(/\s+/g, ' ').trim(), maxChars)
    return redactEvidenceText(preview).value
  } catch {
    return ''
  }
}

function safePreviewProjectFile(projectDir: string, filePath: string, maxChars: number): string | undefined {
  const resolvedProject = resolve(projectDir)
  const resolvedFile = resolve(filePath)
  const rel = relative(resolvedProject, resolvedFile)
  if (rel.startsWith('..') || isAbsolute(rel)) return undefined
  if (!existsSync(resolvedFile)) return undefined
  return previewFile(resolvedFile, maxChars)
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars - 3)}...` : value
}

function normalizeProjectPath(projectDir: string, filePath: string): string {
  const rel = relative(projectDir, filePath)
  return rel && !rel.startsWith('..') ? rel.replace(/\\/g, '/') : filePath
}
