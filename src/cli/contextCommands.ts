// SCALE Engine — Context Commands
// Extracted from src/api/cli.ts (lines 441–829)

import { defineCommand } from 'citty'
import { join, resolve } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { FSMContextSnapshot } from '../fsm/FSMAgentBridge.js'
import {
  writeContextGovernanceTemplates,
  analyzeContextGovernance,
  renderContextGrillPrompt,
} from '../workflow/ContextGovernance.js'
import { appendContextGrillArtifact } from '../workflow/TaskArtifactScaffolder.js'
import {
  buildContextPack,
  doctorContextBudget,
  scanContextBudget,
  writeContextBudgetReport,
} from '../context/ContextBudget.js'
import { resolvePromptCachePolicy } from '../routing/PromptCachePolicy.js'
import { ProjectAnatomy } from '../context/ProjectAnatomy.js'
import { WorkflowArtifactWriter } from '../workflow/WorkflowArtifactWriter.js'
import { removeWorkflowOpenTask } from '../workflow/WorkflowOpenTasks.js'
import {
  getEngine,
  SCALE_DIR,
  PROJECT_DIR,
  isTruthyFlag,
  resolveScaleDirForProject,
  ensureDir,
} from './engineBootstrap.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseCommaList(value: unknown): string[] {
  const raw = String(value ?? '').trim()
  if (!raw) return []
  return raw.split(',').map(item => item.trim()).filter(Boolean)
}

function parsePositiveIntArg(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number.parseInt(String(value), 10)
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return parsed
}

/** 读取 stdin 上的 hook payload（Claude Code / ZCode 等 stdin 协议 agent）。 */
function readStdinHookPayload(): Record<string, unknown> | undefined {
  try {
    const raw = readFileSync(0, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // 无 payload 或非 JSON：交给调用方兜底
  }
  return undefined
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return undefined
}

function formatContextSummary(ctx: { artifacts: FSMContextSnapshot[]; recommendations: string[] }): string {
  const lines: string[] = []

  if (ctx.artifacts.length === 0) {
    lines.push('No active artifacts for this session.')
  } else {
    lines.push(`Active artifacts: ${ctx.artifacts.length}`)
    for (const a of ctx.artifacts) {
      const blocked = a.blockingReasons.length > 0 ? ' [BLOCKED]' : ''
      lines.push(`  ${a.artifactId} (${a.artifactType}): ${a.currentStatus}${blocked}`)
    }
  }

  if (ctx.recommendations.length > 0) {
    lines.push('Recommendations:')
    for (const r of ctx.recommendations) {
      lines.push(`  ${r}`)
    }
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Sub-commands
// ---------------------------------------------------------------------------

const contextBuild = defineCommand({
  meta: { name: 'build', description: 'Build context for current task' },
  args: {
    'session-id': { type: 'string', required: true },
    'artifact-id': { type: 'string' },
    role: { type: 'string' },
  },
  async run({ args }) {
    const { ctx } = getEngine()
    const result = await ctx.build({
      sessionId: args['session-id'],
      roleId: args.role,
      currentArtifactId: args['artifact-id'],
    })
    console.log(JSON.stringify(result, null, 2))
  },
})

const contextStatus = defineCommand({
  meta: { name: 'status', description: 'Show session context status' },
  args: {
    'session-id': { type: 'string', required: true },
  },
  async run({ args }) {
    const { ctx, roleGate } = getEngine()
    const status = await ctx.getStatus(args['session-id'], roleGate)
    console.log(JSON.stringify(status, null, 2))
  },
})

const contextInject = defineCommand({
  meta: { name: 'inject', description: 'Inject FSM context for SessionStart hook' },
  args: {
    'session-id': { type: 'string', required: false },
    stdin: { type: 'boolean', default: false, description: 'Read session_id from the hook payload on stdin (Claude Code / ZCode SessionStart hooks)' },
  },
  async run({ args }) {
    // #34：SessionStart hook 的 session_id 在 stdin JSON payload 里，不在环境变量里
    const payload = args.stdin && !process.stdin.isTTY ? readStdinHookPayload() : undefined
    const sessionId = firstNonEmptyString(args['session-id'], payload?.session_id)
    if (!sessionId) {
      process.stderr.write('scale context inject: --session-id is required (or pass --stdin to read it from the hook payload)\n')
      process.exitCode = 1
      return
    }
    const { eventBus, kb, fsmAgentBridge } = getEngine()

    // Get FSM context for all session artifacts
    const fsmContext = await fsmAgentBridge.getSessionContext(sessionId, eventBus)

    // Recall relevant lessons based on artifact types
    const artifactTypes = fsmContext.artifacts.map(a => a.artifactType)
    if (artifactTypes.length > 0) {
      const lessons = await kb.recall({ type: 'lesson', limit: 5 })
      fsmContext.recalledLessons = lessons.map(l => `${l.id}: ${l.title} (${l.tags.join(',')})`)
    }

    // Output formatted context for Agent to read
    const output = {
      sessionId: fsmContext.sessionId,
      generatedAt: fsmContext.generatedAt,
      artifacts: fsmContext.artifacts.map(a => ({
        id: a.artifactId,
        type: a.artifactType,
        status: a.currentStatus,
        allowedActions: a.allowedTransitions,
        blocked: a.blockingReasons.length > 0 ? a.blockingReasons : null,
      })),
      lessons: fsmContext.recalledLessons,
      recommendations: fsmContext.recommendations,
      // Human-readable summary
      summary: formatContextSummary(fsmContext),
    }

    console.log(JSON.stringify(output, null, 2))
  },
})

const contextGlossary = defineCommand({
  meta: { name: 'glossary', description: 'Show project domain glossary (借鉴 mattpocock/skills CONTEXT.md)' },
  args: {
    json: { type: 'boolean', default: false, description: 'JSON output' },
  },
  run({ args }) {
    const glossaryPath = join(SCALE_DIR, 'GLOSSARY.md')
    if (!existsSync(glossaryPath)) {
      if (args.json) console.log(JSON.stringify({ ok: false, message: 'GLOSSARY.md not found in SCALE_DIR. Run scale init to generate it.' }))
      else console.log('GLOSSARY.md not found. Run scale init to generate it.')
      return
    }
    const content = readFileSync(glossaryPath, 'utf-8')
    // Parse terms: **Term**: definition
    const termMatch = /\*\*(\w[^*]+)\*\*\s*:\s*(.+)/g
    const terms: Record<string, string> = {}
    let m: RegExpExecArray | null
    while ((m = termMatch.exec(content)) !== null) {
      terms[m[1].trim()] = m[2].trim().replace(/_Avoid_/, 'Avoid:')
    }
    // Parse relationships
    const relSection = content.split('## Relationships')[1]?.split('## ')[0] ?? ''
    const relationships = relSection.split('\n').filter((l: string) => l.trim().startsWith('- ')).map((l: string) => l.replace(/^- /, '').trim())

    if (args.json) {
      console.log(JSON.stringify({ ok: true, terms, relationships, count: Object.keys(terms).length }))
    } else {
      console.log('=== SCALE Engine Domain Glossary ===\n')
      console.log(`Terms (${Object.keys(terms).length}):\n`)
      for (const [term, def] of Object.entries(terms)) {
        console.log(`  **${term}**: ${def}`)
      }
      if (relationships.length > 0) {
        console.log(`\nRelationships (${relationships.length}):`)
        for (const rel of relationships) {
          console.log(`  - ${rel}`)
        }
      }
    }
  },
})

const contextInit = defineCommand({
  meta: { name: 'init', description: 'Create CONTEXT.md and CONTEXT-MAP.md starter templates' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    name: { type: 'string', description: 'Project display name' },
    force: { type: 'boolean', default: false, description: 'Overwrite existing templates' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const result = writeContextGovernanceTemplates({
      projectDir: resolve(String(args.dir ?? PROJECT_DIR)),
      projectName: args.name ? String(args.name) : undefined,
      force: isTruthyFlag(args.force),
    })
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log('\nSCALE Context Templates')
    for (const file of result.created) console.log(`  [CREATED] ${file}`)
    for (const file of result.skipped) console.log(`  [SKIPPED] ${file}`)
  },
})

const contextGrill = defineCommand({
  meta: { name: 'grill', description: 'Check project context docs and generate request-specific grill questions' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'task-id': { type: 'string', description: 'Task id for workflow state and artifact linkage' },
    task: { type: 'string', required: true, description: 'Task or requirement description' },
    files: { type: 'string', description: 'Comma-separated changed or target files' },
    'artifact-dir': { type: 'string', description: 'Task artifact directory where explore.md should be updated' },
    write: { type: 'boolean', default: false, description: 'Append context grill output to the task explore artifact' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const taskId = String(args['task-id'] ?? `context-${Date.now()}`)
    const changedFiles = parseCommaList(args.files)
    const report = analyzeContextGovernance({
      projectDir,
      request: String(args.task ?? ''),
      changedFiles,
    })
    const artifactPath = isTruthyFlag(args.write)
      ? appendContextGrillArtifact({
          projectDir,
          artifactsDir: args['artifact-dir'] ? String(args['artifact-dir']) : undefined,
          report,
        }) ?? undefined
      : undefined
    if (args['task-id'] || artifactPath) {
      const writer = new WorkflowArtifactWriter(SCALE_DIR)
      const current = writer.readCurrentState()
      const currentOpenTasks = current?.taskId === taskId ? current.openTasks : []
      writer.updateCurrentState({
        taskId,
        phase: 'explore',
        artifactsDir: args['artifact-dir'] ? String(args['artifact-dir']).replace(/\\/g, '/') : undefined,
        exploredFiles: changedFiles,
        fileCount: changedFiles.length,
        mainContradiction: report.findings[0]?.message ?? 'context governance ready',
        openTasks: removeWorkflowOpenTask(currentOpenTasks, 'context-grill'),
      })
    }
    if (args.json) {
      console.log(JSON.stringify({ ...report, artifactPath }, null, 2))
      return
    }
    console.log(renderContextGrillPrompt(report))
    if (artifactPath) console.log(`\nArtifact: ${artifactPath}`)
  },
})

const contextBudget = defineCommand({
  meta: { name: 'budget', description: 'Report Always/on-demand/evidence/archive/generated context token cost' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'max-always': { type: 'string', description: 'Maximum Always-loaded estimated tokens' },
    'max-task': { type: 'string', description: 'Maximum task context estimated tokens' },
    provider: { type: 'string', default: 'generic', description: 'Model provider for prompt cache policy: anthropic, openai, or generic' },
    write: { type: 'boolean', default: false, description: 'Write .scale/context-budget.json' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const report = scanContextBudget({
      projectDir,
      scaleDir,
      maxAlwaysTokens: parsePositiveIntArg(args['max-always'], '--max-always'),
      maxTaskTokens: parsePositiveIntArg(args['max-task'], '--max-task'),
    })
    const promptCache = resolvePromptCachePolicy({
      provider: String(args.provider ?? 'generic'),
      entries: report.entries,
    })
    const path = isTruthyFlag(args.write) ? writeContextBudgetReport(report) : undefined
    if (args.json) {
      console.log(JSON.stringify({ ...report, promptCache, path }, null, 2))
      return
    }
    console.log('SCALE Context Budget')
    console.log(`  Project: ${report.projectDir}`)
    console.log(`  Total: ${report.summary.totalTokens} estimated tokens across ${report.summary.totalFiles} files`)
    console.log(`  Always: ${report.summary.alwaysTokens}/${report.thresholds.maxAlwaysTokens}`)
    for (const [category, summary] of Object.entries(report.summary.byCategory)) {
      console.log(`  ${category}: ${summary.tokens} tokens in ${summary.files} files`)
    }
    console.log(`  Prompt cache provider: ${promptCache.provider}`)
    console.log(`  Prompt cache strategy: ${promptCache.strategy}${promptCache.supported ? '' : ' (usage ledger only)'}`)
    console.log(`  Cache eligible: ${promptCache.cacheEligibleTokens} tokens across ${promptCache.cacheEligiblePaths.length} paths`)
    for (const recommendation of report.recommendations) console.log(`  recommendation: ${recommendation}`)
    if (path) console.log(`  wrote: ${path}`)
  },
})

const contextPack = defineCommand({
  meta: { name: 'pack', description: 'Build a lazy-loaded context pack for a task' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    task: { type: 'string', required: true, description: 'Current task or question' },
    'task-id': { type: 'string', description: 'Task id' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    files: { type: 'string', description: 'Comma-separated files or modules in scope' },
    budget: { type: 'string', description: 'Maximum estimated tokens for the context pack' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const pack = buildContextPack({
      projectDir,
      scaleDir,
      task: String(args.task),
      taskId: args['task-id'] ? String(args['task-id']) : undefined,
      level: String(args.level ?? 'M'),
      files: parseCommaList(args.files),
      budget: parsePositiveIntArg(args.budget, '--budget'),
    })
    if (args.json) {
      console.log(JSON.stringify(pack, null, 2))
      return
    }
    console.log('SCALE Context Pack')
    console.log(`  Task: ${pack.task.task}`)
    console.log(`  Budget: ${pack.totalEstimatedTokens}/${pack.task.budget}`)
    for (const section of pack.sections) {
      console.log(`  [${section.included ? 'IN' : 'OUT'}] ${section.id}: ${section.estimatedTokens} tokens`)
    }
  },
})

const contextDoctor = defineCommand({
  meta: { name: 'doctor', description: 'Check context budget thresholds and generated-artifact loading risk' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'max-always': { type: 'string', description: 'Maximum Always-loaded estimated tokens' },
    'max-task': { type: 'string', description: 'Maximum task context estimated tokens' },
    task: { type: 'string', description: 'Task text for a representative lazy context pack probe' },
    level: { type: 'string', default: 'M', description: 'Task level for the context pack probe' },
    files: { type: 'string', description: 'Comma-separated scoped files for the context pack probe' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const report = doctorContextBudget({
      projectDir,
      scaleDir,
      maxAlwaysTokens: parsePositiveIntArg(args['max-always'], '--max-always'),
      maxTaskTokens: parsePositiveIntArg(args['max-task'], '--max-task'),
      task: args.task ? String(args.task) : undefined,
      level: String(args.level ?? 'M'),
      files: parseCommaList(args.files),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log(`SCALE Context Doctor: ${report.ok ? 'OK' : 'FAILED'}`)
    for (const check of report.checks) {
      console.log(`  [${check.status.toUpperCase()}] ${check.name}: ${check.message}`)
    }
    if (!report.ok) process.exitCode = 1
  },
})

const contextAnatomy = defineCommand({
  meta: { name: 'anatomy', description: 'Scan the project and generate .scale/anatomy.md for file-map context' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'max-files': { type: 'string', description: 'Maximum files to include; defaults to 500' },
    exclude: { type: 'string', description: 'Comma-separated directory names to exclude' },
    write: { type: 'boolean', default: false, description: 'Write .scale/anatomy.md' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const maxFiles = parsePositiveIntArg(args['max-files'], '--max-files')
    const excludePatterns = parseCommaList(args.exclude)
    const anatomy = new ProjectAnatomy()
    const sections = anatomy.scan(projectDir, {
      maxFiles,
      excludePatterns: excludePatterns.length > 0 ? excludePatterns : undefined,
    })
    const content = anatomy.serialize(sections)
    const summary = [...sections.values()].reduce(
      (acc, entries) => {
        acc.files += entries.length
        acc.tokens += entries.reduce((sum, entry) => sum + entry.tokens, 0)
        return acc
      },
      { files: 0, tokens: 0 },
    )
    const outputPath = join(scaleDir, 'anatomy.md')
    if (isTruthyFlag(args.write)) {
      ensureDir(scaleDir)
      writeFileSync(outputPath, content, 'utf-8')
    }
    if (args.json) {
      console.log(JSON.stringify({
        ok: true,
        projectDir,
        outputPath: isTruthyFlag(args.write) ? outputPath : undefined,
        summary,
      }, null, 2))
      return
    }
    console.log('SCALE Project Anatomy')
    console.log(`  Files: ${summary.files}`)
    console.log(`  Estimated tokens: ${summary.tokens}`)
    if (isTruthyFlag(args.write)) console.log(`  Wrote: ${outputPath}`)
  },
})

// ---------------------------------------------------------------------------
// Exported parent command
// ---------------------------------------------------------------------------

export const contextCommand = defineCommand({
  meta: { name: 'context', description: 'Context assembly' },
  subCommands: {
    build: contextBuild,
    status: contextStatus,
    inject: contextInject,
    glossary: contextGlossary,
    init: contextInit,
    grill: contextGrill,
    budget: contextBudget,
    pack: contextPack,
    doctor: contextDoctor,
    anatomy: contextAnatomy,
  },
})
