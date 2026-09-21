import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { executeCommit, planCommit } from '../../src/workflow/CommitSuggest.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

function makeRepo(prefix: string, files: Record<string, string> = { 'README.md': '# init\n' }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  for (const [path, content] of Object.entries(files)) writeRepoFile(dir, path, content)
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-qm', 'chore: init'], { cwd: dir })
  return dir
}

function writeRepoFile(dir: string, path: string, content: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true })
  writeFileSync(join(dir, path), content, 'utf-8')
}

describe('planCommit', () => {
  it('suggests docs type when only markdown files change', () => {
    const dir = makeRepo('commit-suggest-docs-')
    writeRepoFile(dir, 'docs/guide.md', '# guide')
    const plan = planCommit(dir)
    expect(plan.ok).toBe(true)
    expect(plan.suggestedType).toBe('docs')
    expect(plan.suggestedMessage).toBe('docs: update docs/guide.md')
    expect(plan.entries[0].path).toBe('docs/guide.md')
  })

  it('suggests test type when only test files change', () => {
    const dir = makeRepo('commit-suggest-test-')
    writeRepoFile(dir, 'tests/unit.test.ts', 'it("x", () => {})')
    const plan = planCommit(dir)
    expect(plan.suggestedType).toBe('test')
  })

  it('defaults to feat for source changes and chore for config-only changes', () => {
    const dir = makeRepo('commit-suggest-src-')
    writeRepoFile(dir, 'src/app.ts', 'export const x = 1')
    expect(planCommit(dir).suggestedType).toBe('feat')

    const configDir = makeRepo('commit-suggest-cfg-')
    writeRepoFile(configDir, '.gitignore', 'dist/\n')
    expect(planCommit(configDir).suggestedType).toBe('chore')
  })

  it('excludes allowlisted tool artifacts from the suggestion', () => {
    const dir = makeRepo('commit-suggest-allow-')
    mkdirSync(join(dir, 'output'), { recursive: true })
    writeRepoFile(dir, 'output/report.txt', 'x')
    writeRepoFile(dir, 'src/app.ts', 'export const y = 2')
    const plan = planCommit(dir)
    expect(plan.entries.map(entry => entry.path)).not.toContain('output/report.txt')
    expect(plan.excluded.length).toBe(1)
    expect(plan.suggestedType).toBe('feat')
  })

  it('reports nothing to commit on a clean worktree', () => {
    const dir = makeRepo('commit-suggest-clean-')
    const plan = planCommit(dir)
    expect(plan.ok).toBe(false)
    expect(plan.entries).toEqual([])
    expect(plan.warnings.some(w => w.includes('nothing to commit'))).toBe(true)
  })

  it('throws for a directory that is not a git repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'commit-suggest-norepo-'))
    dirs.push(dir)
    expect(() => planCommit(dir)).toThrow(/Not a git repository/)
  })

  it('honors explicit type and message overrides', () => {
    const dir = makeRepo('commit-suggest-override-')
    writeRepoFile(dir, 'src/app.ts', 'export const z = 3')
    const plan = planCommit(dir, { type: 'fix', message: 'fix: broken thing' })
    expect(plan.suggestedType).toBe('fix')
    expect(plan.suggestedMessage).toBe('fix: broken thing')
  })
})

describe('executeCommit', () => {
  it('stages exactly the planned entries and creates one commit', () => {
    const dir = makeRepo('commit-suggest-exec-')
    writeRepoFile(dir, 'src/app.ts', 'export const a = 1')
    writeRepoFile(dir, 'notes.md', 'note')
    const plan = planCommit(dir)
    const result = executeCommit(dir, plan)
    expect(result.ok).toBe(true)
    expect(result.commit).toMatch(/^[0-9a-f]+$/)
    expect(result.staged).toHaveLength(2)
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf-8' })
    expect(status.trim()).toBe('')
    const log = execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: dir, encoding: 'utf-8' })
    expect(log.trim()).toBe(plan.suggestedMessage)
  })

  it('never stages allowlisted artifacts', () => {
    const dir = makeRepo('commit-suggest-exec-allow-')
    mkdirSync(join(dir, 'output'), { recursive: true })
    writeRepoFile(dir, 'output/keep.txt', 'x')
    writeRepoFile(dir, 'src/app.ts', 'export const b = 1')
    const plan = planCommit(dir)
    const result = executeCommit(dir, plan)
    expect(result.ok).toBe(true)
    expect(result.staged).not.toContain('output/keep.txt')
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf-8' })
    expect(status).toContain('output/')
  })

  it('refuses to commit when there is nothing planned', () => {
    const dir = makeRepo('commit-suggest-exec-empty-')
    const plan = planCommit(dir)
    const result = executeCommit(dir, plan)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Nothing to commit')
  })

  it('supports a message override', () => {
    const dir = makeRepo('commit-suggest-exec-msg-')
    writeRepoFile(dir, 'src/app.ts', 'export const c = 1')
    const plan = planCommit(dir)
    const result = executeCommit(dir, plan, { message: 'fix: exact message' })
    expect(result.ok).toBe(true)
    const log = execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: dir, encoding: 'utf-8' })
    expect(log.trim()).toBe('fix: exact message')
  })
})
