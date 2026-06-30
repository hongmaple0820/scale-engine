// SCALE Engine — Commit Discipline (v0.38.0)
// Prevents agents from accumulating uncommitted changes. Monitors git state,
// enforces thresholds, suggests logical commit groupings, tracks commit cadence.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const SILENT_GIT_STDIO: ['ignore', 'pipe', 'ignore'] = ['ignore', 'pipe', 'ignore']
const parsedGitInspectTimeoutMs = Number.parseInt(process.env.SCALE_GIT_INSPECT_TIMEOUT_MS ?? '', 10)
const GIT_INSPECT_TIMEOUT_MS = Number.isFinite(parsedGitInspectTimeoutMs) && parsedGitInspectTimeoutMs > 0
  ? parsedGitInspectTimeoutMs
  : 15_000

// ============================================================================
// Types
// ============================================================================

export type ViolationType = 'too-many-files' | 'too-long-since-commit' | 'task-switch-without-commit'
export type ViolationSeverity = 'warn' | 'block'

export interface CommitDisciplineConfig {
  maxUncommittedFiles: number       // warn threshold (default 10)
  maxUncommittedFilesBlock: number  // block threshold (default 25)
  maxMinutesWithoutCommit: number   // warn threshold (default 30)
  maxMinutesBlock: number           // block threshold (default 60)
  warnOnTaskSwitch: boolean         // default true
  projectDir?: string
  scaleDir?: string
}

export interface CommitViolation {
  type: ViolationType
  severity: ViolationSeverity
  message: string
  count?: number
  threshold?: number
}

export interface CommitDisciplineStatus {
  uncommittedFiles: number
  stagedFiles: number
  unstagedFiles: number
  untrackedFiles: number
  minutesSinceLastCommit: number
  commitsThisSession: number
  avgFilesPerCommit: number
  violations: CommitViolation[]
  recommendations: string[]
}

export interface FileGroup {
  name: string
  files: string[]
  suggestedMessage: string
}

export interface CommitRecord {
  id: string
  sha: string
  timestamp: string
  fileCount: number
  message: string
  files: string[]
}

export interface TaskSwitchResult {
  allowed: boolean
  violations: CommitViolation[]
  uncommittedCount: number
  suggestion: string
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_CONFIG: CommitDisciplineConfig = {
  maxUncommittedFiles: 10,
  maxUncommittedFilesBlock: 25,
  maxMinutesWithoutCommit: 30,
  maxMinutesBlock: 60,
  warnOnTaskSwitch: true,
}

// Group name rules: path prefix → group name
const GROUP_RULES: Array<{ test: (f: string) => boolean; name: string; commitPrefix: string }> = [
  { test: f => /^src\/workflow\//.test(f), name: 'workflow', commitPrefix: 'feat(workflow)' },
  { test: f => /^src\/memory\//.test(f), name: 'memory', commitPrefix: 'feat(memory)' },
  { test: f => /^src\/runtime\//.test(f), name: 'runtime', commitPrefix: 'feat(runtime)' },
  { test: f => /^src\/governance\//.test(f), name: 'governance', commitPrefix: 'feat(governance)' },
  { test: f => /^src\/tools\//.test(f), name: 'tools', commitPrefix: 'feat(tools)' },
  { test: f => /^src\/skills\//.test(f), name: 'skills', commitPrefix: 'feat(skills)' },
  { test: f => /^src\//.test(f), name: 'src-other', commitPrefix: 'feat' },
  { test: f => /^tests\/workflow\//.test(f), name: 'tests-workflow', commitPrefix: 'test(workflow)' },
  { test: f => /^tests\//.test(f), name: 'tests', commitPrefix: 'test' },
  { test: f => /^docs\//.test(f), name: 'docs', commitPrefix: 'docs' },
  { test: f => /\.md$/.test(f) && !f.includes('/'), name: 'docs-root', commitPrefix: 'docs' },
  { test: f => /^package(-lock)?\.json$/.test(f), name: 'deps', commitPrefix: 'chore(deps)' },
  { test: f => /^\.(eslint|prettier|gitignore|npmrc)/.test(f), name: 'config', commitPrefix: 'chore(config)' },
]

// ============================================================================
// CommitDiscipline
// ============================================================================

export class CommitDiscipline {
  private config: CommitDisciplineConfig
  private records: CommitRecord[] = []
  private statePath: string
  private stateDir: string
  private now: () => Date

  constructor(config?: Partial<CommitDisciplineConfig>, now?: () => Date) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.now = now ?? (() => new Date())

    const projectDir = this.config.projectDir ?? process.cwd()
    const scaleRoot = this.config.scaleDir ?? '.scale'
    this.stateDir = join(projectDir, scaleRoot, 'commit-discipline')
    this.statePath = join(this.stateDir, 'records.json')

    this.loadState()
  }

  // --------------------------------------------------------------------------
  // Core API
  // --------------------------------------------------------------------------

  check(): CommitDisciplineStatus {
    const gitState = this.inspectGit()
    const minutes = this.minutesSinceLastCommit()
    const violations: CommitViolation[] = []
    const recommendations: string[] = []

    // File count violations
    const total = gitState.staged + gitState.unstaged + gitState.untracked
    if (total >= this.config.maxUncommittedFilesBlock) {
      violations.push({
        type: 'too-many-files',
        severity: 'block',
        message: `${total} uncommitted files exceeds block threshold (${this.config.maxUncommittedFilesBlock}). Commit or stash before continuing.`,
        count: total,
        threshold: this.config.maxUncommittedFilesBlock,
      })
      recommendations.push(`Split into logical commits by module. Use 'suggestGroups()' for grouping.`)
    } else if (total >= this.config.maxUncommittedFiles) {
      violations.push({
        type: 'too-many-files',
        severity: 'warn',
        message: `${total} uncommitted files exceeds warning threshold (${this.config.maxUncommittedFiles}). Consider committing soon.`,
        count: total,
        threshold: this.config.maxUncommittedFiles,
      })
      recommendations.push(`${total} files accumulating — commit before adding more changes.`)
    }

    // Time violations
    if (minutes >= this.config.maxMinutesBlock) {
      violations.push({
        type: 'too-long-since-commit',
        severity: 'block',
        message: `${Math.round(minutes)} minutes since last commit exceeds block threshold (${this.config.maxMinutesBlock} min). Commit now.`,
        count: Math.round(minutes),
        threshold: this.config.maxMinutesBlock,
      })
    } else if (minutes >= this.config.maxMinutesWithoutCommit) {
      violations.push({
        type: 'too-long-since-commit',
        severity: 'warn',
        message: `${Math.round(minutes)} minutes since last commit exceeds warning threshold (${this.config.maxMinutesWithoutCommit} min).`,
        count: Math.round(minutes),
        threshold: this.config.maxMinutesWithoutCommit,
      })
    }

    // General recommendations
    if (gitState.staged > 0 && gitState.unstaged > 0) {
      recommendations.push('You have both staged and unstaged changes. Consider committing staged changes first.')
    }
    if (gitState.untracked > 5) {
      recommendations.push(`${gitState.untracked} untracked files. Add new files intentionally with 'git add <file>'.`)
    }

    const totalCommitted = this.records.reduce((s, r) => s + r.fileCount, 0)
    const avgFiles = this.records.length > 0 ? Math.round(totalCommitted / this.records.length) : 0

    return {
      uncommittedFiles: total,
      stagedFiles: gitState.staged,
      unstagedFiles: gitState.unstaged,
      untrackedFiles: gitState.untracked,
      minutesSinceLastCommit: Math.round(minutes),
      commitsThisSession: this.records.length,
      avgFilesPerCommit: avgFiles,
      violations,
      recommendations,
    }
  }

  suggestGroups(taskDescription?: string): FileGroup[] {
    const files = this.getUncommittedFiles()
    if (files.length === 0) return []

    const groupMap = new Map<string, string[]>()

    for (const file of files) {
      let matched = false
      for (const rule of GROUP_RULES) {
        if (rule.test(file)) {
          const group = groupMap.get(rule.name) ?? []
          group.push(file)
          groupMap.set(rule.name, group)
          matched = true
          break
        }
      }
      if (!matched) {
        const group = groupMap.get('misc') ?? []
        group.push(file)
        groupMap.set('misc', group)
      }
    }

    const groups: FileGroup[] = []
    for (const [name, groupFiles] of groupMap) {
      const rule = GROUP_RULES.find(r => r.name === name)
      const prefix = rule?.commitPrefix ?? 'chore'
      const desc = taskDescription ?? 'update'
      groups.push({
        name,
        files: groupFiles,
        suggestedMessage: `${prefix}: ${desc}`,
      })
    }

    return groups
  }

  recordCommit(sha: string, message: string, files: string[]): CommitRecord {
    const record: CommitRecord = {
      id: `COMMIT-${Date.now()}-${randomUUID().slice(0, 8)}`,
      sha,
      timestamp: this.now().toISOString(),
      fileCount: files.length,
      message,
      files,
    }
    this.records.push(record)
    this.saveState()
    return record
  }

  enforceBeforeTaskSwitch(taskDescription?: string): TaskSwitchResult {
    const status = this.check()
    const violations: CommitViolation[] = []

    if (status.uncommittedFiles > 0 && this.config.warnOnTaskSwitch) {
      const severity: ViolationSeverity = status.uncommittedFiles >= this.config.maxUncommittedFilesBlock ? 'block' : 'warn'
      violations.push({
        type: 'task-switch-without-commit',
        severity,
        message: `Switching tasks with ${status.uncommittedFiles} uncommitted files. Commit current work first.`,
        count: status.uncommittedFiles,
      })
    }

    const allowed = !violations.some(v => v.severity === 'block')
    const groups = this.suggestGroups(taskDescription)

    return {
      allowed,
      violations: [...status.violations, ...violations],
      uncommittedCount: status.uncommittedFiles,
      suggestion: groups.length > 0
        ? `Suggested commit groups: ${groups.map(g => `${g.name} (${g.files.length} files)`).join(', ')}`
        : 'No uncommitted files.',
    }
  }

  summarize(): string {
    const status = this.check()
    const lines: string[] = [
      '## Commit Discipline Status',
      '',
      `**Uncommitted Files:** ${status.uncommittedFiles} (staged: ${status.stagedFiles}, unstaged: ${status.unstagedFiles}, untracked: ${status.untrackedFiles})`,
      `**Time Since Last Commit:** ${status.minutesSinceLastCommit} min`,
      `**Commits This Session:** ${status.commitsThisSession}`,
      `**Avg Files Per Commit:** ${status.avgFilesPerCommit}`,
      '',
    ]

    if (status.violations.length > 0) {
      lines.push('### Violations')
      for (const v of status.violations) {
        const icon = v.severity === 'block' ? '[BLOCK]' : '[WARN]'
        lines.push(`- ${icon} ${v.message}`)
      }
      lines.push('')
    }

    if (status.recommendations.length > 0) {
      lines.push('### Recommendations')
      for (const r of status.recommendations) lines.push(`- ${r}`)
      lines.push('')
    }

    const groups = this.suggestGroups()
    if (groups.length > 1) {
      lines.push('### Suggested Commit Groups')
      for (const g of groups) {
        lines.push(`- **${g.name}** (${g.files.length} files): \`${g.suggestedMessage}\``)
        for (const f of g.files) lines.push(`  - ${f}`)
      }
      lines.push('')
    }

    if (status.violations.length === 0 && status.uncommittedFiles === 0) {
      lines.push('No issues detected. Working tree is clean.')
    }

    return lines.join('\n')
  }

  getRecords(): CommitRecord[] {
    return [...this.records]
  }

  // --------------------------------------------------------------------------
  // Git Inspection
  // --------------------------------------------------------------------------

  private inspectGit(): { staged: number; unstaged: number; untracked: number } {
    try {
      const projectDir = this.config.projectDir ?? process.cwd()

      const staged = execSync('git diff --cached --name-only', {
        cwd: projectDir, encoding: 'utf-8', timeout: GIT_INSPECT_TIMEOUT_MS, stdio: SILENT_GIT_STDIO,
      }).trim().split('\n').filter(Boolean).length

      const unstaged = execSync('git diff --name-only', {
        cwd: projectDir, encoding: 'utf-8', timeout: GIT_INSPECT_TIMEOUT_MS, stdio: SILENT_GIT_STDIO,
      }).trim().split('\n').filter(Boolean).length

      const untracked = execSync('git ls-files --others --exclude-standard', {
        cwd: projectDir, encoding: 'utf-8', timeout: GIT_INSPECT_TIMEOUT_MS, stdio: SILENT_GIT_STDIO,
      }).trim().split('\n').filter(Boolean).length

      return { staged, unstaged, untracked }
    } catch {
      return { staged: 0, unstaged: 0, untracked: 0 }
    }
  }

  private getUncommittedFiles(): string[] {
    try {
      const projectDir = this.config.projectDir ?? process.cwd()

      const staged = execSync('git diff --cached --name-only', {
        cwd: projectDir, encoding: 'utf-8', timeout: GIT_INSPECT_TIMEOUT_MS, stdio: SILENT_GIT_STDIO,
      }).trim().split('\n').filter(Boolean)

      const unstaged = execSync('git diff --name-only', {
        cwd: projectDir, encoding: 'utf-8', timeout: GIT_INSPECT_TIMEOUT_MS, stdio: SILENT_GIT_STDIO,
      }).trim().split('\n').filter(Boolean)

      const untracked = execSync('git ls-files --others --exclude-standard', {
        cwd: projectDir, encoding: 'utf-8', timeout: GIT_INSPECT_TIMEOUT_MS, stdio: SILENT_GIT_STDIO,
      }).trim().split('\n').filter(Boolean)

      return [...new Set([...staged, ...unstaged, ...untracked])]
    } catch {
      return []
    }
  }

  private minutesSinceLastCommit(): number {
    try {
      const projectDir = this.config.projectDir ?? process.cwd()
      const ts = execSync('git log -1 --format=%ct', {
        cwd: projectDir, encoding: 'utf-8', timeout: GIT_INSPECT_TIMEOUT_MS, stdio: SILENT_GIT_STDIO,
      }).trim()
      const lastCommitEpoch = parseInt(ts, 10) * 1000
      return (this.now().getTime() - lastCommitEpoch) / 60000
    } catch {
      return 0
    }
  }

  // --------------------------------------------------------------------------
  // State Persistence
  // --------------------------------------------------------------------------

  private loadState(): void {
    if (!existsSync(this.statePath)) return
    try {
      const raw = JSON.parse(readFileSync(this.statePath, 'utf-8'))
      if (Array.isArray(raw.records)) this.records = raw.records
    } catch { /* ignore corrupt state */ }
  }

  private saveState(): void {
    if (!existsSync(this.stateDir)) mkdirSync(this.stateDir, { recursive: true })
    writeFileSync(this.statePath, JSON.stringify({ records: this.records }, null, 2), 'utf-8')
  }
}

// ============================================================================
// Summary Formatter (standalone)
// ============================================================================

export function summarizeCommitDiscipline(status: CommitDisciplineStatus): string {
  const lines: string[] = [
    '## Commit Discipline',
    '',
    `**Uncommitted:** ${status.uncommittedFiles} files (staged: ${status.stagedFiles}, unstaged: ${status.unstagedFiles}, untracked: ${status.untrackedFiles})`,
    `**Last Commit:** ${status.minutesSinceLastCommit} min ago`,
    `**Session Commits:** ${status.commitsThisSession} (avg ${status.avgFilesPerCommit} files/commit)`,
  ]

  if (status.violations.length > 0) {
    lines.push('', '### Violations')
    for (const v of status.violations) {
      lines.push(`- ${v.severity === 'block' ? '[BLOCK]' : '[WARN]'} ${v.message}`)
    }
  }

  if (status.recommendations.length > 0) {
    lines.push('', '### Recommendations')
    for (const r of status.recommendations) lines.push(`- ${r}`)
  }

  return lines.join('\n')
}
