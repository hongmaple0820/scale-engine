// Tests for CommitDiscipline — commit discipline monitoring, file grouping, enforcement

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { CommitDiscipline, summarizeCommitDiscipline } from '../../src/workflow/CommitDiscipline.js'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'
import { safeRmSync } from '../helpers/fs.js'

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'commit-discipline-'))
}

function initGitRepo(dir: string, backdateMinutes?: number): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' })
  writeFileSync(join(dir, '.gitkeep'), '')
  execSync('git add .', { cwd: dir, stdio: 'pipe' })
  if (backdateMinutes) {
    execSync('git commit -m "init"', {
      cwd: dir,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: '2026-01-01T10:00:00+00:00',
        GIT_COMMITTER_DATE: '2026-01-01T10:00:00+00:00',
      },
    })
  } else {
    execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' })
  }
}

describe('CommitDiscipline', () => {
  let dir: string

  beforeEach(() => {
    dir = makeTempDir()
    initGitRepo(dir)
  })

  afterEach(() => {
    safeRmSync(dir)
  })

  describe('check', () => {
    it('returns clean status when no uncommitted files', () => {
      const cd = new CommitDiscipline({ projectDir: dir })
      const status = cd.check()
      expect(status.uncommittedFiles).toBe(0)
      expect(status.stagedFiles).toBe(0)
      expect(status.unstagedFiles).toBe(0)
      expect(status.untrackedFiles).toBe(0)
      expect(status.violations).toHaveLength(0)
    })

    it('warns when uncommitted files exceed threshold', () => {
      // Create 12 untracked files (threshold default = 10)
      for (let i = 0; i < 12; i++) {
        writeFileSync(join(dir, `file-${i}.ts`), `// file ${i}`)
      }

      const cd = new CommitDiscipline({ projectDir: dir })
      const status = cd.check()
      expect(status.uncommittedFiles).toBe(12)
      expect(status.untrackedFiles).toBe(12)
      expect(status.violations.length).toBeGreaterThan(0)
      expect(status.violations[0].type).toBe('too-many-files')
      expect(status.violations[0].severity).toBe('warn')
    })

    it('blocks when uncommitted files exceed block threshold', () => {
      // Create 30 untracked files (block threshold = 25)
      for (let i = 0; i < 30; i++) {
        writeFileSync(join(dir, `file-${i}.ts`), `// file ${i}`)
      }

      const cd = new CommitDiscipline({ projectDir: dir })
      const status = cd.check()
      const blockViolation = status.violations.find(v => v.severity === 'block')
      expect(blockViolation).toBeDefined()
      expect(blockViolation?.type).toBe('too-many-files')
    })

    it('warns when too long since last commit', () => {
      // Create a repo with a commit backdated 45 minutes
      const backDir = makeTempDir()
      initGitRepo(backDir, 45)
      try {
        const now = new Date('2026-01-01T10:45:00Z') // 45 min after 10:00
        const cd = new CommitDiscipline({ projectDir: backDir }, () => now)
        const status = cd.check()
        expect(status.minutesSinceLastCommit).toBe(45)
        const timeViolation = status.violations.find(v => v.type === 'too-long-since-commit')
        expect(timeViolation).toBeDefined()
        expect(timeViolation?.severity).toBe('warn')
      } finally {
        safeRmSync(backDir)
      }
    })

    it('blocks when way too long since last commit', () => {
      // Create a repo with a commit backdated 90 minutes
      const backDir = makeTempDir()
      initGitRepo(backDir, 90)
      try {
        const now = new Date('2026-01-01T11:30:00Z') // 90 min after 10:00
        const cd = new CommitDiscipline({ projectDir: backDir }, () => now)
        const status = cd.check()
        const timeViolation = status.violations.find(v => v.type === 'too-long-since-commit')
        expect(timeViolation?.severity).toBe('block')
      } finally {
        safeRmSync(backDir)
      }
    })

    it('detects staged and unstaged separately', () => {
      // Create a file and stage it
      writeFileSync(join(dir, 'staged.ts'), 'staged content')
      execSync('git add staged.ts', { cwd: dir, stdio: 'pipe' })

      // Create an unstaged modification to an existing file
      writeFileSync(join(dir, '.gitkeep'), 'modified')

      const cd = new CommitDiscipline({ projectDir: dir })
      const status = cd.check()
      expect(status.stagedFiles).toBe(1)
      expect(status.unstagedFiles).toBe(1)
    })
  })

  describe('suggestGroups', () => {
    it('groups files by directory', () => {
      mkdirSync(join(dir, 'src', 'workflow'), { recursive: true })
      mkdirSync(join(dir, 'tests', 'workflow'), { recursive: true })
      writeFileSync(join(dir, 'src', 'workflow', 'a.ts'), '')
      writeFileSync(join(dir, 'src', 'workflow', 'b.ts'), '')
      writeFileSync(join(dir, 'tests', 'workflow', 'a.test.ts'), '')

      const cd = new CommitDiscipline({ projectDir: dir })
      const groups = cd.suggestGroups()
      expect(groups.length).toBe(2)

      const workflowGroup = groups.find(g => g.name === 'workflow')
      expect(workflowGroup).toBeDefined()
      expect(workflowGroup?.files).toHaveLength(2)

      const testGroup = groups.find(g => g.name === 'tests-workflow')
      expect(testGroup).toBeDefined()
      expect(testGroup?.files).toHaveLength(1)
    })

    it('groups root markdown files as docs-root', () => {
      writeFileSync(join(dir, 'README.md'), '# Test')
      writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog')

      const cd = new CommitDiscipline({ projectDir: dir })
      const groups = cd.suggestGroups()
      const docsGroup = groups.find(g => g.name === 'docs-root')
      expect(docsGroup).toBeDefined()
      expect(docsGroup?.files).toHaveLength(2)
    })

    it('groups package files as deps', () => {
      writeFileSync(join(dir, 'package.json'), '{}')

      const cd = new CommitDiscipline({ projectDir: dir })
      const groups = cd.suggestGroups()
      const depsGroup = groups.find(g => g.name === 'deps')
      expect(depsGroup).toBeDefined()
      expect(depsGroup?.suggestedMessage).toContain('chore(deps)')
    })

    it('uses task description in suggested message', () => {
      mkdirSync(join(dir, 'src', 'workflow'), { recursive: true })
      writeFileSync(join(dir, 'src', 'workflow', 'x.ts'), '')

      const cd = new CommitDiscipline({ projectDir: dir })
      const groups = cd.suggestGroups('add commit discipline')
      expect(groups[0].suggestedMessage).toContain('add commit discipline')
    })

    it('returns empty for clean repo', () => {
      const cd = new CommitDiscipline({ projectDir: dir })
      const groups = cd.suggestGroups()
      expect(groups).toHaveLength(0)
    })

    it('puts unknown paths in misc group', () => {
      writeFileSync(join(dir, 'Makefile'), 'all:')

      const cd = new CommitDiscipline({ projectDir: dir })
      const groups = cd.suggestGroups()
      const miscGroup = groups.find(g => g.name === 'misc')
      expect(miscGroup).toBeDefined()
    })
  })

  describe('recordCommit', () => {
    it('records a commit and tracks it', () => {
      const cd = new CommitDiscipline({ projectDir: dir })
      const record = cd.recordCommit('abc123', 'feat: test', ['a.ts', 'b.ts'])
      expect(record.sha).toBe('abc123')
      expect(record.fileCount).toBe(2)

      const records = cd.getRecords()
      expect(records).toHaveLength(1)
    })

    it('computes avgFilesPerCommit correctly', () => {
      const cd = new CommitDiscipline({ projectDir: dir })
      cd.recordCommit('a', 'first', ['1.ts', '2.ts', '3.ts'])
      cd.recordCommit('b', 'second', ['4.ts'])

      const status = cd.check()
      expect(status.commitsThisSession).toBe(2)
      expect(status.avgFilesPerCommit).toBe(2) // (3+1)/2 = 2
    })
  })

  describe('enforceBeforeTaskSwitch', () => {
    it('allows switch when working tree is clean', () => {
      const cd = new CommitDiscipline({ projectDir: dir })
      const result = cd.enforceBeforeTaskSwitch()
      expect(result.allowed).toBe(true)
      expect(result.uncommittedCount).toBe(0)
    })

    it('warns on switch with uncommitted files', () => {
      writeFileSync(join(dir, 'wip.ts'), 'work in progress')

      const cd = new CommitDiscipline({ projectDir: dir })
      const result = cd.enforceBeforeTaskSwitch('next task')
      expect(result.allowed).toBe(true) // warn, not block
      expect(result.uncommittedCount).toBe(1)
      expect(result.violations.length).toBeGreaterThan(0)
      expect(result.violations.some(v => v.type === 'task-switch-without-commit')).toBe(true)
    })

    it('blocks on switch with too many uncommitted files', () => {
      for (let i = 0; i < 30; i++) {
        writeFileSync(join(dir, `f-${i}.ts`), '')
      }

      const cd = new CommitDiscipline({ projectDir: dir })
      const result = cd.enforceBeforeTaskSwitch()
      expect(result.allowed).toBe(false)
      expect(result.violations.some(v => v.severity === 'block')).toBe(true)
    })
  })

  describe('summarize', () => {
    it('produces readable report for clean repo', () => {
      const cd = new CommitDiscipline({ projectDir: dir })
      const report = cd.summarize()
      expect(report).toContain('Commit Discipline Status')
      expect(report).toContain('No issues detected')
    })

    it('includes violations in report', () => {
      for (let i = 0; i < 15; i++) {
        writeFileSync(join(dir, `f-${i}.ts`), '')
      }

      const cd = new CommitDiscipline({ projectDir: dir })
      const report = cd.summarize()
      expect(report).toContain('[WARN]')
    })

    it('includes suggested groups when multiple groups exist', () => {
      mkdirSync(join(dir, 'src', 'workflow'), { recursive: true })
      writeFileSync(join(dir, 'src', 'workflow', 'a.ts'), '')
      writeFileSync(join(dir, 'README.md'), '')

      const cd = new CommitDiscipline({ projectDir: dir })
      const report = cd.summarize()
      expect(report).toContain('Suggested Commit Groups')
    })
  })

  describe('summarizeCommitDiscipline (standalone)', () => {
    it('formats status correctly', () => {
      const text = summarizeCommitDiscipline({
        uncommittedFiles: 5,
        stagedFiles: 2,
        unstagedFiles: 2,
        untrackedFiles: 1,
        minutesSinceLastCommit: 15,
        commitsThisSession: 3,
        avgFilesPerCommit: 4,
        violations: [],
        recommendations: ['Consider committing soon.'],
      })
      expect(text).toContain('Commit Discipline')
      expect(text).toContain('5 files')
      expect(text).toContain('15 min ago')
      expect(text).toContain('Consider committing')
    })
  })

  describe('config overrides', () => {
    it('respects custom thresholds', () => {
      for (let i = 0; i < 5; i++) {
        writeFileSync(join(dir, `f-${i}.ts`), '')
      }

      // Custom low threshold: warn at 3
      const cd = new CommitDiscipline({ projectDir: dir, maxUncommittedFiles: 3 })
      const status = cd.check()
      expect(status.violations.length).toBeGreaterThan(0)
      expect(status.violations[0].threshold).toBe(3)
    })

    it('can disable task switch warnings', () => {
      writeFileSync(join(dir, 'wip.ts'), '')

      const cd = new CommitDiscipline({ projectDir: dir, warnOnTaskSwitch: false })
      const result = cd.enforceBeforeTaskSwitch()
      // No task-switch violation, only file count if applicable
      expect(result.violations.filter(v => v.type === 'task-switch-without-commit')).toHaveLength(0)
    })
  })

  describe('graceful degradation', () => {
    it('handles non-git directory gracefully', () => {
      const nonGitDir = makeTempDir()
      try {
        const cd = new CommitDiscipline({ projectDir: nonGitDir })
        const status = cd.check()
        expect(status.uncommittedFiles).toBe(0)
        expect(status.violations).toHaveLength(0)
      } finally {
        safeRmSync(nonGitDir)
      }
    })
  })
})
