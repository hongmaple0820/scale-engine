import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type {
  ContextPack,
  KnowledgeContextItem,
  RuntimeEvidenceContextItem,
  RuntimeSessionContextItem,
} from './MemoryFabric.js'
import { redactEvidenceText, redactEvidenceValue } from '../tools/ToolEvidenceStore.js'

export type MemoryLearningCandidateStatus = 'candidate'
export type MemoryLearningRecommendedAction =
  | 'review-for-knowledge-base'
  | 'resolve-failures-first'
  | 'record-more-evidence'

export interface MemoryLearningEvidenceSummary {
  id: string
  status: string
  resolved?: boolean
  title: string
  summary: string
  command?: string
  exitCode?: number
}

export interface MemoryLearningSessionSummary {
  id: string
  eventType: string
  phase?: string
  message?: string
}

export interface MemoryLearningCandidate {
  version: '1.0'
  id: string
  status: MemoryLearningCandidateStatus
  generatedAt: string
  title: string
  task: string
  taskId?: string
  sessionId?: string
  level: string
  summary: string
  recommendedAction: MemoryLearningRecommendedAction
  promotable: boolean
  tags: string[]
  evidenceIds: string[]
  sessionEventIds: string[]
  knowledgeIds: string[]
  graphRefs: string[]
  evidenceSummaries: MemoryLearningEvidenceSummary[]
  sessionSummaries: MemoryLearningSessionSummary[]
  warnings: string[]
  contextBudget: {
    used: number
    limit: number
    remaining: number
    overBudget: boolean
  }
  contentRef: string
}

export interface MemoryLearningSettlement {
  candidate: MemoryLearningCandidate
  files: {
    json: string
    markdown: string
  }
}

export interface SettleMemoryLearningOptions {
  projectDir?: string
  scaleDir?: string
  pack: ContextPack
  now?: () => Date
}

export function settleMemoryLearning(options: SettleMemoryLearningOptions): MemoryLearningSettlement {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const scaleRoot = resolveScaleRoot(projectDir, options.scaleDir)
  const now = options.now ?? (() => new Date())
  const generatedAt = now().toISOString()
  const runtimeEvidence = includedItems<RuntimeEvidenceContextItem>(options.pack, 'runtime-evidence')
  const sessionEvents = includedItems<RuntimeSessionContextItem>(options.pack, 'session-event')
  const knowledgeItems = includedItems<KnowledgeContextItem>(options.pack, 'knowledge')
  const graphRefs = options.pack.sections
    .flatMap(section => section.items)
    .filter(item => item.type === 'graph')
    .map(item => item.path)

  const failed = runtimeEvidence.filter(item => item.status === 'failed' && item.resolved !== true)
  const passed = runtimeEvidence.filter(item => item.status === 'passed')
  const warnings = buildWarnings(options.pack, runtimeEvidence, failed)
  const recommendedAction = chooseRecommendedAction(runtimeEvidence, failed, passed)
  const promotable = recommendedAction === 'review-for-knowledge-base'
  const baseId = options.pack.task.taskId ?? options.pack.task.sessionId ?? options.pack.task.task
  const id = `MLC-${safePathSegment(baseId)}`
  const jsonPath = join(scaleRoot, 'memory', 'learning-candidates', `${id}.json`)
  const markdownPath = join(scaleRoot, 'memory', 'learning-candidates', `${id}.md`)
  const contentRef = normalizeProjectPath(projectDir, markdownPath)

  const candidate = sanitizeCandidate({
    version: '1.0',
    id,
    status: 'candidate',
    generatedAt,
    title: `Learning candidate: ${options.pack.task.task}`,
    task: options.pack.task.task,
    taskId: options.pack.task.taskId,
    sessionId: options.pack.task.sessionId,
    level: options.pack.task.level,
    summary: buildSummary(options.pack, runtimeEvidence, failed, passed),
    recommendedAction,
    promotable,
    tags: buildTags(options.pack, runtimeEvidence),
    evidenceIds: runtimeEvidence.map(item => item.id),
    sessionEventIds: sessionEvents.map(item => item.id),
    knowledgeIds: knowledgeItems.map(item => item.id),
    graphRefs,
    evidenceSummaries: runtimeEvidence.map(item => ({
      id: item.id,
      status: item.status,
      resolved: item.resolved,
      title: item.title,
      summary: item.summary,
      command: item.command,
      exitCode: item.exitCode,
    })),
    sessionSummaries: sessionEvents.map(item => ({
      id: item.id,
      eventType: item.eventType,
      phase: item.phase,
      message: item.message,
    })),
    warnings,
    contextBudget: { ...options.pack.budget },
    contentRef,
  })

  ensureDir(join(scaleRoot, 'memory', 'learning-candidates'))
  writeFileSync(jsonPath, JSON.stringify(candidate, null, 2), 'utf-8')
  writeFileSync(markdownPath, renderMemoryLearningCandidateMarkdown(candidate), 'utf-8')
  return {
    candidate,
    files: {
      json: jsonPath,
      markdown: markdownPath,
    },
  }
}

export function renderMemoryLearningCandidateMarkdown(candidate: MemoryLearningCandidate): string {
  const lines = [
    `# ${candidate.title}`,
    '',
    `- Status: ${candidate.status}`,
    `- Task ID: ${candidate.taskId ?? 'n/a'}`,
    `- Session ID: ${candidate.sessionId ?? 'n/a'}`,
    `- Level: ${candidate.level}`,
    `- Recommended action: ${candidate.recommendedAction}`,
    `- Promotable: ${candidate.promotable ? 'yes' : 'no'}`,
    '',
    '## Summary',
    '',
    candidate.summary,
    '',
    '## Runtime Evidence',
    '',
  ]
  for (const evidence of candidate.evidenceSummaries) {
    lines.push(`- [${evidence.status}${evidence.resolved ? '/resolved' : ''}] ${evidence.title} (${evidence.id})`)
    lines.push(`  - Summary: ${evidence.summary}`)
    if (evidence.command) lines.push(`  - Command: \`${evidence.command}\``)
    if (evidence.exitCode !== undefined) lines.push(`  - Exit code: ${evidence.exitCode}`)
  }
  if (candidate.evidenceSummaries.length === 0) lines.push('- none')

  lines.push('', '## Session Events', '')
  for (const event of candidate.sessionSummaries) {
    lines.push(`- ${event.eventType}${event.phase ? `/${event.phase}` : ''}: ${event.message ?? event.id}`)
  }
  if (candidate.sessionSummaries.length === 0) lines.push('- none')

  lines.push('', '## Warnings', '')
  for (const warning of candidate.warnings) lines.push(`- ${warning}`)
  if (candidate.warnings.length === 0) lines.push('- none')
  lines.push('')
  return lines.join('\n')
}

function includedItems<T>(pack: ContextPack, type: string): T[] {
  return pack.sections
    .filter(section => section.included)
    .flatMap(section => section.items)
    .filter(item => item.type === type) as T[]
}

function buildWarnings(
  pack: ContextPack,
  runtimeEvidence: RuntimeEvidenceContextItem[],
  failed: RuntimeEvidenceContextItem[],
): string[] {
  const warnings: string[] = []
  if (failed.length > 0) warnings.push(`${failed.length} failed runtime evidence item(s) must be resolved before promotion.`)
  if (runtimeEvidence.length === 0) warnings.push('No runtime evidence was included; record verification before promoting this candidate.')
  for (const section of pack.omittedSections) {
    warnings.push(`Context section omitted: ${section.title} (${section.reason}).`)
  }
  return warnings
}

function chooseRecommendedAction(
  runtimeEvidence: RuntimeEvidenceContextItem[],
  failed: RuntimeEvidenceContextItem[],
  passed: RuntimeEvidenceContextItem[],
): MemoryLearningRecommendedAction {
  if (failed.length > 0) return 'resolve-failures-first'
  if (runtimeEvidence.length === 0 || passed.length === 0) return 'record-more-evidence'
  return 'review-for-knowledge-base'
}

function buildSummary(
  pack: ContextPack,
  runtimeEvidence: RuntimeEvidenceContextItem[],
  failed: RuntimeEvidenceContextItem[],
  passed: RuntimeEvidenceContextItem[],
): string {
  if (failed.length > 0) {
    return `Task "${pack.task.task}" produced ${failed.length} failed runtime evidence item(s); keep this as a learning candidate but do not promote it yet.`
  }
  if (passed.length > 0) {
    return `Task "${pack.task.task}" has ${passed.length}/${runtimeEvidence.length} passed runtime evidence item(s) and can be reviewed for durable knowledge promotion.`
  }
  return `Task "${pack.task.task}" has no passed runtime evidence yet; use this candidate as a reminder to collect verification before long-term promotion.`
}

function buildTags(pack: ContextPack, runtimeEvidence: RuntimeEvidenceContextItem[]): string[] {
  const tags = new Set<string>([
    'runtime-learning',
    `level-${pack.task.level.toLowerCase()}`,
  ])
  if (runtimeEvidence.some(item => item.status === 'passed')) tags.add('verified-evidence')
  if (runtimeEvidence.some(item => item.status === 'failed' && item.resolved !== true)) tags.add('failed-evidence')
  if (runtimeEvidence.some(item => item.status === 'failed' && item.resolved === true)) tags.add('resolved-failure-evidence')
  return [...tags]
}

function sanitizeCandidate(candidate: MemoryLearningCandidate): MemoryLearningCandidate {
  const redacted = redactEvidenceValue(candidate).value as MemoryLearningCandidate
  return redactCandidateText(redacted)
}

function redactCandidateText(candidate: MemoryLearningCandidate): MemoryLearningCandidate {
  const redact = (value: string | undefined): string | undefined => {
    if (value === undefined) return undefined
    return redactEvidenceText(value).value
  }
  return {
    ...candidate,
    title: redact(candidate.title) ?? candidate.title,
    task: redact(candidate.task) ?? candidate.task,
    summary: redact(candidate.summary) ?? candidate.summary,
    evidenceSummaries: candidate.evidenceSummaries.map(item => ({
      ...item,
      title: redact(item.title) ?? item.title,
      summary: redact(item.summary) ?? item.summary,
      command: redact(item.command),
    })),
    sessionSummaries: candidate.sessionSummaries.map(item => ({
      ...item,
      message: redact(item.message),
    })),
    warnings: candidate.warnings.map(item => redact(item) ?? item),
  }
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function resolveScaleRoot(projectDir: string, scaleDir?: string): string {
  return isAbsolute(scaleDir ?? '') ? scaleDir as string : join(projectDir, scaleDir ?? '.scale')
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || 'memory-learning'
}

function normalizeProjectPath(projectDir: string, filePath: string): string {
  const rel = relative(projectDir, filePath)
  return rel && !rel.startsWith('..') && !isAbsolute(rel)
    ? rel.replace(/\\/g, '/')
    : filePath
}
