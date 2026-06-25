import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { governanceTemplateContent, type GovernanceArtifactTemplateName } from './GovernanceTemplates.js'
import type { GateResult } from './types.js'
import { skillPlanMarkdown, type SkillPlan } from '../skills/routing/index.js'
import { renderContextGrillPrompt, type ContextGovernanceReport } from './ContextGovernance.js'
import { renderDiagnosticLoopMarkdown, type DiagnosticLoop, type DiagnosticValidation } from './DiagnosticLoop.js'
import { evaluateTddSlice, renderTddSliceMarkdown, type TddSlice } from './TddLoop.js'

export type TaskArtifactLevel = 'S' | 'M' | 'L' | 'CRITICAL'

export interface TaskArtifactScaffoldOptions {
  projectDir?: string
  taskId: string
  taskName: string
  description: string
  level: TaskArtifactLevel
  services?: string[]
  skillPlan?: SkillPlan
}

export interface TaskArtifactScaffoldResult {
  relativeDir?: string
  dir?: string
  created: string[]
  skipped: string[]
}

export interface VerificationArtifactAppendOptions {
  projectDir?: string
  artifactsDir?: string
  taskId: string
  profile: string
  services: string[]
  gateResults: GateResult[]
  passed: boolean
}

export interface TaskArtifactCheckOptions {
  projectDir?: string
  artifactsDir?: string
  level: TaskArtifactLevel
  skillRequiredArtifacts?: string[]
}

export interface ContextGrillArtifactAppendOptions {
  projectDir?: string
  artifactsDir?: string
  report: ContextGovernanceReport
}

export interface DiagnosticLoopArtifactAppendOptions {
  projectDir?: string
  artifactsDir?: string
  loop: DiagnosticLoop
  validation: DiagnosticValidation
}

export interface TddSliceArtifactAppendOptions {
  projectDir?: string
  artifactsDir?: string
  slice: TddSlice
}

export interface TaskArtifactIncompleteItem {
  file: string
  reason: string
}

export interface TaskArtifactCheckResult {
  complete: boolean
  artifactsDir?: string
  required: string[]
  missing: string[]
  incomplete: TaskArtifactIncompleteItem[]
}

const TASK_ARTIFACTS: GovernanceArtifactTemplateName[] = [
  'explore.md',
  'mini-prd.md',
  'skill-plan.md',
  'plan.md',
  'standards-impact.md',
  'architecture-review.md',
  'runtime.md',
  'reality-check.md',
  'resource-cleanup.md',
  'verification.md',
  'review.md',
  'summary.md',
]

export function scaffoldTaskArtifacts(options: TaskArtifactScaffoldOptions): TaskArtifactScaffoldResult {
  if (options.level === 'S') return { created: [], skipped: [] }

  const projectDir = resolve(options.projectDir ?? process.cwd())
  const relativeDir = join('.planning', 'tasks', `${currentDate()}-${slugify(options.taskName || options.description || options.taskId)}`)
  const dir = uniqueDirectory(projectDir, relativeDir, options.taskId)
  const result: TaskArtifactScaffoldResult = {
    relativeDir: relativePath(projectDir, dir),
    dir,
    created: [],
    skipped: [],
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const artifacts = unique([
    ...TASK_ARTIFACTS,
    ...(options.skillPlan?.requiredArtifacts ?? []),
  ])

  for (const name of artifacts) {
    const target = join(dir, name)
    if (existsSync(target)) {
      result.skipped.push(target)
      continue
    }
    const template = name === 'skill-plan.md' && options.skillPlan
      ? skillPlanMarkdown(options.skillPlan)
      : readTemplate(projectDir, name)
    const content = name === 'skill-plan.md' && options.skillPlan
      ? template
      : injectTaskMetadata(template, options)
    writeFileSync(target, content, 'utf-8')
    result.created.push(target)
  }

  return result
}

export function appendVerificationArtifact(options: VerificationArtifactAppendOptions): string | null {
  if (!options.artifactsDir) return null
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const dir = isAbsolute(options.artifactsDir) ? options.artifactsDir : resolve(projectDir, options.artifactsDir)
  if (!existsSync(dir)) return null
  const target = join(dir, 'verification.md')
  if (!existsSync(target)) {
    writeFileSync(target, injectTaskMetadata(readTemplate(projectDir, 'verification.md'), {
      projectDir,
      taskId: options.taskId,
      taskName: options.taskId,
      description: '',
      level: 'M',
      services: options.services,
    }), 'utf-8')
  }

  appendFileSync(target, verificationRunMarkdown(options), 'utf-8')
  return target
}

export function appendContextGrillArtifact(options: ContextGrillArtifactAppendOptions): string | null {
  return appendTaskArtifactSection({
    projectDir: options.projectDir,
    artifactsDir: options.artifactsDir,
    fileName: 'explore.md',
    title: 'SCALE Context Grill',
    content: renderContextGrillPrompt(options.report),
  })
}

export function appendDiagnosticLoopArtifact(options: DiagnosticLoopArtifactAppendOptions): string | null {
  const validationLines = [
    `Ready: ${options.validation.ready}`,
    ...options.validation.blockers.map(blocker => `Blocker: ${blocker}`),
    ...options.validation.warnings.map(warning => `Warning: ${warning}`),
  ]
  return appendTaskArtifactSection({
    projectDir: options.projectDir,
    artifactsDir: options.artifactsDir,
    fileName: 'plan.md',
    title: 'SCALE Diagnostic Loop',
    content: `${renderDiagnosticLoopMarkdown(options.loop)}\n\n## Validation\n${validationLines.map(line => `- ${line}`).join('\n')}`,
  })
}

export function appendTddSliceArtifact(options: TddSliceArtifactAppendOptions): string | null {
  const evaluation = evaluateTddSlice(options.slice)
  const evaluationLines = [
    `Ready for implementation: ${evaluation.readyForImplementation}`,
    `Ready for completion: ${evaluation.readyForCompletion}`,
    ...evaluation.blockers.map(blocker => `Blocker: ${blocker}`),
    ...evaluation.warnings.map(warning => `Warning: ${warning}`),
  ]
  return appendTaskArtifactSection({
    projectDir: options.projectDir,
    artifactsDir: options.artifactsDir,
    fileName: 'verification.md',
    title: 'SCALE TDD Vertical Slice',
    content: `${renderTddSliceMarkdown(options.slice)}\n\n## Evaluation\n${evaluationLines.map(line => `- ${line}`).join('\n')}`,
  })
}

export function checkTaskArtifactCompleteness(options: TaskArtifactCheckOptions): TaskArtifactCheckResult {
  if (options.level === 'S') {
    return { complete: true, artifactsDir: options.artifactsDir, required: [], missing: [], incomplete: [] }
  }
  if (!options.artifactsDir) {
    const required = requiredArtifactsForLevel(options.level, options.skillRequiredArtifacts)
    return {
      complete: false,
      required,
      missing: required,
      incomplete: [],
    }
  }

  const projectDir = resolve(options.projectDir ?? process.cwd())
  const dir = isAbsolute(options.artifactsDir) ? options.artifactsDir : resolve(projectDir, options.artifactsDir)
  const required = requiredArtifactsForLevel(options.level, options.skillRequiredArtifacts)
  const missing: string[] = []
  const incomplete: TaskArtifactIncompleteItem[] = []

  for (const file of required) {
    const path = join(dir, file)
    if (!existsSync(path)) {
      missing.push(file)
      continue
    }
    const reason = incompleteReason(file, readFileSync(path, 'utf-8'), options.level)
    if (reason) incomplete.push({ file, reason })
  }

  return {
    complete: missing.length === 0 && incomplete.length === 0,
    artifactsDir: dir,
    required,
    missing,
    incomplete,
  }
}

function verificationRunMarkdown(options: VerificationArtifactAppendOptions): string {
  const rows = options.gateResults.flatMap(result =>
    (result.evidenceItems ?? []).map(item => {
      const command = item.command ?? item.label
      const resultText = item.passed ? 'PASS' : 'FAIL'
      const notes = [
        `gate=${result.gate}`,
        item.cwd ? `cwd=${item.cwd}` : '',
        typeof item.exitCode === 'number' ? `exit=${item.exitCode}` : '',
        item.outputHash ? `hash=${item.outputHash}` : '',
      ].filter(Boolean).join('; ')
      return `| ${escapeCell(command)} | ${resultText} | ${escapeCell(notes || item.detail)} |`
    })
  )
  return `
## SCALE Verification Run - ${new Date().toISOString()}

Profile: ${options.profile}
Services: ${options.services.length ? options.services.join(', ') : 'root'}
Final Status: ${options.passed ? 'passed' : 'failed'}

| Command | Result | Notes |
| --- | --- | --- |
${rows.length ? rows.join('\n') : '| no command evidence | FAIL | no evidence items recorded |'}
`
}

function appendTaskArtifactSection(options: {
  projectDir?: string
  artifactsDir?: string
  fileName: string
  title: string
  content: string
}): string | null {
  if (!options.artifactsDir) return null
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const dir = isAbsolute(options.artifactsDir) ? options.artifactsDir : resolve(projectDir, options.artifactsDir)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const target = join(dir, options.fileName)
  if (!existsSync(target)) writeFileSync(target, `# ${options.fileName}\n`, 'utf-8')
  appendFileSync(target, `\n\n## ${options.title} - ${new Date().toISOString()}\n\n${options.content}\n`, 'utf-8')
  return target
}

function readTemplate(projectDir: string, name: string): string {
  const templatePath = join(projectDir, 'docs', 'workflow', 'templates', name)
  if (existsSync(templatePath)) return readFileSync(templatePath, 'utf-8')
  return isGovernanceTemplateName(name)
    ? governanceTemplateContent(name)
    : `# ${name}\n\n## Evidence\n\n\n`
}

function requiredArtifactsForLevel(level: TaskArtifactLevel, skillRequiredArtifacts: string[] = []): string[] {
  if (level === 'S') return []
  const required: string[] = [
    'explore.md',
    'skill-plan.md',
    'plan.md',
    'standards-impact.md',
    'architecture-review.md',
    'runtime.md',
    'reality-check.md',
    'resource-cleanup.md',
    'verification.md',
    'review.md',
    'summary.md',
  ]
  if (level === 'L' || level === 'CRITICAL') required.splice(1, 0, 'mini-prd.md')
  return unique([...required, ...skillRequiredArtifacts])
}

function incompleteReason(file: string, content: string, level: TaskArtifactLevel): string | null {
  if (file === 'verification.md' && /SCALE Verification Run|Final Status:\s*(passed|failed)|\|\s*[^|\s][^|]*\|\s*(PASS|FAIL)/i.test(content)) {
    return null
  }
  if (file === 'reality-check.md') {
    const requiredHeadings = [
      '## Confirmed',
      '## Fact Sources',
      '## Not Verified',
      '## Unsupported Claims',
      '## Stub / Fake / Partial',
      '## Credential-Gated',
      '## Environment-Gated',
      '## User-Visible Risk',
    ]
    const missing = requiredHeadings.filter(heading => !content.includes(heading))
    if (missing.length > 0) return `missing reality sections: ${missing.join(', ')}`
  }
  if (file === 'plan.md' && (level === 'L' || level === 'CRITICAL') && !/human confirmation|review before execution|operator confirmation|执行前确认|人工确认/i.test(content)) {
    return 'L/CRITICAL plan must record human confirmation or review-before-execution requirement'
  }
  if (file === 'standards-impact.md') {
    if (!/scale standards (scan|doctor)|engineering-standards\.json|frameworks\.json|docs\/standards/i.test(content)) {
      return 'standards-impact must cite standards source or standards command evidence'
    }
    if (/## Findings[\s\S]*\|\s*TBD\s*\|/i.test(content)) {
      return 'standards-impact findings table still contains template placeholders'
    }
  }
  if (file === 'architecture-review.md') {
    if (!/codegraph|architecture|frameworks\.json|docs\/architecture|docs\/standards|boundary/i.test(content)) {
      return 'architecture-review must cite architecture source, boundary rule, or codegraph evidence'
    }
    if (/## Decision[\s\S]*Approved\/changes required:/i.test(content)) {
      return 'architecture-review decision still contains template placeholder'
    }
  }

  const substantive = substantiveLines(content)
  const minimumLines = file === 'mini-prd.md'
    ? 3
    : file === 'skill-plan.md'
      ? 1
      : file === 'reality-check.md'
        ? 6
        : 2
  if (substantive.length < minimumLines) {
    return `contains only template placeholders (${substantive.length}/${minimumLines} substantive lines)`
  }
  return null
}

function substantiveLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .filter(line => !line.startsWith('#'))
    .filter(line => !line.startsWith('**Task ID**:'))
    .filter(line => !line.startsWith('**Task**:'))
    .filter(line => !line.startsWith('**Level**:'))
    .filter(line => !line.startsWith('**Services**:'))
    .filter(line => !line.startsWith('**Created**:'))
    .filter(line => !/^tbd$/i.test(line))
    .filter(line => !/^\|/.test(line))
    .filter(line => !/^\|?[\s:-]+\|[\s|:-]*$/.test(line))
    .filter(line => !/^[-*]\s*(\[ \])?\s*(tbd)?$/i.test(line))
    .filter(line => !/^\d+\.\s*(tbd)?$/i.test(line))
    .filter(line => !/^\*Generated by SCALE Engine/i.test(line))
}

function injectTaskMetadata(template: string, options: TaskArtifactScaffoldOptions): string {
  const metadata = [
    `**Task ID**: ${options.taskId}`,
    `**Task**: ${options.taskName}`,
    `**Level**: ${options.level}`,
    `**Services**: ${options.services?.length ? options.services.join(', ') : 'unspecified'}`,
    `**Created**: ${new Date().toISOString()}`,
    '',
  ].join('\n')
  return template.replace(/^(# .+\n)/, `$1\n${metadata}`)
}

function uniqueDirectory(projectDir: string, relativeDir: string, taskId: string): string {
  const preferred = resolve(projectDir, relativeDir)
  if (!existsSync(preferred)) return preferred
  const summary = join(preferred, 'summary.md')
  if (existsSync(summary) && readFileSync(summary, 'utf-8').includes(`**Task ID**: ${taskId}`)) {
    return preferred
  }
  return resolve(projectDir, `${relativeDir}-${slugify(taskId).slice(0, 16)}`)
}

function relativePath(projectDir: string, path: string): string {
  return path.startsWith(projectDir)
    ? path.slice(projectDir.length + 1).replace(/\\/g, '/')
    : path.replace(/\\/g, '/')
}

function currentDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'task'
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function isGovernanceTemplateName(name: string): name is GovernanceArtifactTemplateName {
  return [
    'explore.md',
    'mini-prd.md',
    'skill-plan.md',
    'skill-evidence.md',
    'runtime.md',
    'reality-check.md',
    'resource-cleanup.md',
    'ui-spec.md',
    'visual-review.md',
    'api-contract.md',
    'docs-impact.md',
    'resource-impact.md',
    'standards-impact.md',
    'architecture-review.md',
    'security-review.md',
    'db-change-plan.md',
    'e2e-plan.md',
    'plan.md',
    'verification.md',
    'review.md',
    'summary.md',
  ].includes(name)
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}
