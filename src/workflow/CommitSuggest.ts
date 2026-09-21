import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_DIRTY_TREE_ALLOW_PATTERN } from '../shield/PolicyCompiler.js'

export interface CommitSuggestEntry {
  status: string
  path: string
}

export interface CommitSuggestPlan {
  ok: boolean
  projectDir: string
  branch?: string
  entries: CommitSuggestEntry[]
  excluded: CommitSuggestEntry[]
  suggestedType: string
  suggestedMessage: string
  warnings: string[]
}

export interface CommitExecuteResult {
  ok: boolean
  commit?: string
  staged: string[]
  message: string
  warnings: string[]
}

const TYPE_BY_AREA: Array<{ type: string; test: (path: string) => boolean }> = [
  { type: 'test', test: path => /(^|\/)(tests?|__tests__)\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) },
  { type: 'docs', test: path => /\.mdx?$/i.test(path) || /(^|\/)docs\//.test(path) },
  { type: 'chore', test: path => /(^|\/)(\.github\/|scripts?\/|Makefile$|\.gitignore$|\.gitattributes$|\.editorconfig$)|\.(ya?ml|json|toml|ini|cfg)$/i.test(path) },
]

/**
 * Build a commit suggestion from the current worktree state. Read-only: it never
 * touches the index. Allowlisted tool artifacts are excluded from the suggestion.
 */
export function planCommit(projectDir: string, options: { type?: string; message?: string } = {}): CommitSuggestPlan {
  const resolved = resolveProjectDir(projectDir)
  const warnings: string[] = []
  assertRepository(resolved)

  const raw = git(resolved, ['status', '--porcelain', '--branch', '--untracked-files=all'])
  const lines = raw.split(/\r?\n/).filter(line => line.trim().length > 0)
  const branchLine = lines.find(line => line.startsWith('##'))
  const branch = branchLine ? branchLine.replace(/^##\s+/, '').split('...')[0].trim() : undefined

  const allowRe = safeAllowRegex()
  const entries: CommitSuggestEntry[] = []
  const excluded: CommitSuggestEntry[] = []
  for (const line of lines.filter(line => !line.startsWith('##'))) {
    const entry = { status: line.slice(0, 2).trim(), path: line.slice(3).trim() }
    if (allowRe && allowRe.test(entry.path)) excluded.push(entry)
    else entries.push(entry)
  }

  const suggestedType = options.type ?? inferCommitType(entries)
  const suggestedMessage = options.message ?? `${suggestedType}: ${describeEntries(entries)}`

  if (entries.length === 0) {
    warnings.push(excluded.length > 0
      ? 'All local changes are allowlisted tool artifacts; nothing to commit.'
      : 'Worktree is clean; nothing to commit.')
  }
  warnings.push('Run `scale gate-quality` before committing — Shield blocks commits without a passing gate.')

  return {
    ok: entries.length > 0,
    projectDir: resolved,
    branch,
    entries,
    excluded,
    suggestedType,
    suggestedMessage,
    warnings,
  }
}

/**
 * Stage the planned entries and create one commit. Staging is explicit per entry
 * (no `git add -A`) so allowlisted artifacts never slip in.
 */
export function executeCommit(
  projectDir: string,
  plan: CommitSuggestPlan,
  options: { message?: string } = {},
): CommitExecuteResult {
  const resolved = resolveProjectDir(projectDir)
  assertRepository(resolved)
  if (plan.entries.length === 0) {
    return { ok: false, staged: [], message: 'Nothing to commit: no non-allowlisted changes.', warnings: plan.warnings }
  }
  const message = options.message ?? plan.suggestedMessage
  const staged: string[] = []
  for (const entry of plan.entries) {
    const args = entry.status === 'D' || entry.status.includes('D')
      ? ['rm', '--cached', '--ignore-unmatch', '--', entry.path]
      : ['add', '--', entry.path]
    git(resolved, args)
    staged.push(entry.path)
  }
  try {
    const commit = git(resolved, ['commit', '-m', message])
    const hash = /[[\]]([0-9a-f]{7,})/.exec(commit)?.[1]
      ?? git(resolved, ['rev-parse', '--short', 'HEAD']).trim()
    return { ok: true, commit: hash, staged, message, warnings: [] }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      staged,
      message: `Commit failed after staging ${staged.length} file(s); the staged set is left in place for retry.`,
      warnings: [reason.trim().split(/\r?\n/)[0] ?? reason],
    }
  }
}

function inferCommitType(entries: CommitSuggestEntry[]): string {
  if (entries.length === 0) return 'chore'
  const deletions = entries.filter(entry => entry.status.includes('D'))
  if (deletions.length === entries.length) return 'refactor'
  for (const { type, test } of TYPE_BY_AREA) {
    if (entries.every(entry => test(entry.path))) return type
  }
  return 'feat'
}

function describeEntries(entries: CommitSuggestEntry[]): string {
  if (entries.length === 0) return 'no pending changes'
  if (entries.length === 1) return `update ${entries[0].path}`
  const area = dominantArea(entries)
  return `update ${entries.length} files${area ? ` under ${area}` : ''}`
}

function dominantArea(entries: CommitSuggestEntry[]): string | undefined {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    const segments = entry.path.split(/[/\\]/)
    const area = segments.length > 1 ? segments[0] : undefined
    if (area) counts.set(area, (counts.get(area) ?? 0) + 1)
  }
  const [area, count] = [...counts.entries()].sort((left, right) => right[1] - left[1])[0] ?? []
  return count && count > entries.length / 2 ? area : undefined
}

function safeAllowRegex(): RegExp | undefined {
  try {
    return new RegExp(DEFAULT_DIRTY_TREE_ALLOW_PATTERN)
  } catch {
    return undefined
  }
}

function resolveProjectDir(projectDir: string): string {
  const resolved = projectDir ? join(projectDir) : process.cwd()
  if (!existsSync(resolved)) throw new Error(`Project directory does not exist: ${resolved}`)
  return resolved
}

function assertRepository(projectDir: string): void {
  try {
    git(projectDir, ['rev-parse', '--is-inside-work-tree'])
  } catch {
    throw new Error(`Not a git repository: ${projectDir}. Run \`scale git init\` or \`scale install\` first.`)
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 20 * 1024 * 1024 })
}
