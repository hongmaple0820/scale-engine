import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { cleanupWorkspaceLifecycle, inspectWorkspaceLifecycle } from '../../src/workflow/WorkspaceLifecycle.js'

let dirs: string[] = []
const GIT_TEST_TIMEOUT = 120_000

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

// tmpdir() may return an 8.3 short path (…\ADMINI~1\…) while the code under
// test reports long paths — string comparisons then fail. homedir() stays
// long-form, so prefer the long temp root on Windows.
function longTmpDir(): string {
  const candidate = join(homedir(), 'AppData', 'Local', 'Temp')
  return process.platform === 'win32' && existsSync(candidate) ? candidate : tmpdir()
}

function makeDir(prefix = 'scale-workspace-'): string {
  // G23 discipline: OS tempdir (long-form), never the repo cwd
  const dir = mkdtempSync(join(longTmpDir(), prefix))
  dirs.push(dir)
  return dir
}

async function git(cwd: string, args: string[]) {
  return execa('git', args, { cwd })
}

async function initRepo(dir: string) {
  await git(dir, ['init'])
  await git(dir, ['config', 'user.email', 'scale@example.test'])
  await git(dir, ['config', 'user.name', 'SCALE Test'])
  writeFileSync(join(dir, 'README.md'), '# test\n', 'utf-8')
  await git(dir, ['add', 'README.md'])
  await git(dir, ['commit', '-m', 'init'])
}

describe('WorkspaceLifecycle', () => {
  it('blocks cleanup when a child repository has uncommitted changes even if the root is clean', async () => {
    const root = makeDir()
    await initRepo(root)
    const child = join(root, 'modules', 'common')
    mkdirSync(child, { recursive: true })
    await initRepo(child)
    writeFileSync(join(root, '.gitmodules'), '[submodule "modules/common"]\n\tpath = modules/common\n\turl = ./modules/common\n', 'utf-8')
    writeFileSync(join(root, '.gitignore'), 'modules/\n', 'utf-8')
    await git(root, ['add', '.gitmodules', '.gitignore'])
    await git(root, ['commit', '-m', 'add submodule metadata'])
    writeFileSync(join(child, 'dirty.txt'), 'dirty\n', 'utf-8')

    const result = await inspectWorkspaceLifecycle({ projectDir: root })

    expect(result.root.clean).toBe(true)
    expect(result.childRepositories).toHaveLength(1)
    expect(result.childRepositories[0]).toMatchObject({
      kind: 'submodule',
      relativePath: 'modules/common',
      clean: false,
    })
    expect(result.finish.canCleanup).toBe(false)
    expect(result.finish.blockers).toContain('Child repository modules/common has uncommitted changes')
  }, GIT_TEST_TIMEOUT)

  it('discovers configured MOE repositories beyond nested auto-discovery depth', async () => {
    const root = makeDir()
    await initRepo(root)
    const child = join(root, 'a', 'b', 'c', 'd', 'e', 'f', 'common')
    mkdirSync(child, { recursive: true })
    await initRepo(child)
    mkdirSync(join(root, '.scale'), { recursive: true })
    writeFileSync(join(root, '.scale', 'workspace.json'), JSON.stringify({
      version: 1,
      topology: 'moe',
      repositories: [
        { name: 'root', path: '.', role: 'root', required: true },
        { name: 'common', path: 'a/b/c/d/e/f/common', role: 'nested-repo', required: true },
      ],
    }, null, 2), 'utf-8')
    writeFileSync(join(root, '.gitignore'), 'a/\n', 'utf-8')
    await git(root, ['add', '.scale/workspace.json', '.gitignore'])
    await git(root, ['commit', '-m', 'add moe topology'])

    const result = await inspectWorkspaceLifecycle({ projectDir: root })

    expect(result.topology.topology).toBe('moe')
    expect(result.childRepositories).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'nested-repo',
        relativePath: 'a/b/c/d/e/f/common',
        clean: true,
      }),
    ]))
  }, GIT_TEST_TIMEOUT)

  it('warns when MOE finish policy requires root pointer review after child repository changes', async () => {
    const root = makeDir()
    await initRepo(root)
    const child = join(root, 'modules', 'common')
    mkdirSync(child, { recursive: true })
    await initRepo(child)
    mkdirSync(join(root, '.scale'), { recursive: true })
    writeFileSync(join(root, '.scale', 'workspace.json'), JSON.stringify({
      version: 1,
      topology: 'moe',
      repositories: [
        { name: 'root', path: '.', role: 'root', required: true },
        { name: 'common', path: 'modules/common', role: 'nested-repo', required: true },
      ],
      finishPolicy: {
        requireCleanRepositories: true,
        requirePushedBranches: true,
        requireRootPointerUpdate: true,
      },
    }, null, 2), 'utf-8')
    writeFileSync(join(root, '.gitignore'), 'modules/\n', 'utf-8')
    await git(root, ['add', '.scale/workspace.json', '.gitignore'])
    await git(root, ['commit', '-m', 'add moe topology'])
    writeFileSync(join(child, 'change.txt'), 'change\n', 'utf-8')
    await git(child, ['add', 'change.txt'])
    await git(child, ['commit', '-m', 'change child'])

    const result = await inspectWorkspaceLifecycle({ projectDir: root })

    expect(result.finish.blockers).toContain('Child repository modules/common has unpushed commits')
    expect(result.finish.warnings).toContain('MOE finish policy requires root pointer or integration metadata review after child repository changes')
  }, GIT_TEST_TIMEOUT)

  it('identifies linked worktrees and marks clean temporary branches as cleanup candidates', async () => {
    const root = makeDir()
    await initRepo(root)
    writeFileSync(join(root, '.gitignore'), '.worktrees/\n', 'utf-8')
    await git(root, ['add', '.gitignore'])
    await git(root, ['commit', '-m', 'ignore worktrees'])
    const worktree = join(root, '.worktrees', 'claude-compassionate-cray-141861')
    await git(root, ['worktree', 'add', worktree, '-b', 'claude/compassionate-cray-141861'])

    const result = await inspectWorkspaceLifecycle({ projectDir: worktree })

    expect(result.root.branch).toBe('claude/compassionate-cray-141861')
    expect(result.root.isLinkedWorktree).toBe(true)
    expect(result.root.isSubmodule).toBe(false)
    expect(result.finish.canCleanup).toBe(true)
    expect(result.finish.nextActions).toContain('Safe to remove linked worktree after branch is pushed, merged, or intentionally discarded')
  }, GIT_TEST_TIMEOUT)

  it('classifies the integration branch and blocks direct governed shipping there', async () => {
    const root = makeDir()
    await initRepo(root)
    await git(root, ['checkout', '-b', 'dev'])

    const result = await inspectWorkspaceLifecycle({ projectDir: root })

    expect(result.branchPolicy).toMatchObject({
      branch: 'dev',
      role: 'integration',
      shipAllowed: false,
    })
    expect(result.branchPolicy.shipBlockers.join('\n')).toContain('Direct ship on integration branch dev is blocked')
    expect(result.finish.blockers).not.toContain('Direct ship on integration branch dev is blocked')
  }, GIT_TEST_TIMEOUT)

  it('blocks linked worktree cleanup when a local feature branch has unpublished commits', async () => {
    const root = makeDir()
    await initRepo(root)
    await git(root, ['branch', 'dev'])
    writeFileSync(join(root, '.gitignore'), '.worktrees/\n', 'utf-8')
    await git(root, ['add', '.gitignore'])
    await git(root, ['commit', '-m', 'ignore worktrees'])
    const worktree = join(root, '.worktrees', 'feature-unpublished')
    await git(root, ['worktree', 'add', worktree, '-b', 'feat/unpublished', 'dev'])
    writeFileSync(join(worktree, 'feature.txt'), 'feature\n', 'utf-8')
    await git(worktree, ['add', 'feature.txt'])
    await git(worktree, ['commit', '-m', 'feat: unpublished work'])

    const result = await inspectWorkspaceLifecycle({ projectDir: worktree })

    expect(result.root.isLinkedWorktree).toBe(true)
    expect(result.branchPolicy).toMatchObject({
      branch: 'feat/unpublished',
      role: 'feature',
      shipAllowed: true,
    })
    expect(result.finish.canCleanup).toBe(false)
    expect(result.finish.blockers.join('\n')).toContain('Local branch feat/unpublished has commits that are not pushed or merged into dev/master')
  }, GIT_TEST_TIMEOUT)

  it('dry-runs linked worktree cleanup without deleting it', async () => {
    const root = makeDir()
    await initRepo(root)
    writeFileSync(join(root, '.gitignore'), '.worktrees/\n', 'utf-8')
    await git(root, ['add', '.gitignore'])
    await git(root, ['commit', '-m', 'ignore worktrees'])
    const worktree = join(root, '.worktrees', 'agent-task')
    await git(root, ['worktree', 'add', worktree, '-b', 'claude/agent-task-0515'])

    const result = await cleanupWorkspaceLifecycle({ projectDir: worktree })

    expect(result.mode).toBe('dry-run')
    expect(result.canApply).toBe(true)
    expect(result.applied).toBe(false)
    expect(result.targetPath).toBe(worktree)
    expect(result.confirmationToken).toBe('claude/agent-task-0515')
    expect(result.commands).toContain(`git worktree remove "${worktree}"`)
    expect(existsSync(worktree)).toBe(true)
  }, GIT_TEST_TIMEOUT)

  it('requires confirmation before applying linked worktree cleanup', async () => {
    const root = makeDir()
    await initRepo(root)
    writeFileSync(join(root, '.gitignore'), '.worktrees/\n', 'utf-8')
    await git(root, ['add', '.gitignore'])
    await git(root, ['commit', '-m', 'ignore worktrees'])
    const worktree = join(root, '.worktrees', 'agent-task')
    await git(root, ['worktree', 'add', worktree, '-b', 'claude/agent-task-apply-0515'])

    const rejected = await cleanupWorkspaceLifecycle({
      projectDir: worktree,
      apply: true,
      confirm: 'wrong-token',
    })

    expect(rejected.applied).toBe(false)
    expect(rejected.canApply).toBe(false)
    expect(rejected.blockers.join('\n')).toContain('confirmation token')
    expect(existsSync(worktree)).toBe(true)

    const applied = await cleanupWorkspaceLifecycle({
      projectDir: worktree,
      apply: true,
      confirm: 'claude/agent-task-apply-0515',
    })

    expect(applied.applied).toBe(true)
    expect(applied.canApply).toBe(true)
    expect(existsSync(worktree)).toBe(false)
  }, GIT_TEST_TIMEOUT)

  it('blocks cleanup for an ordinary checkout', async () => {
    const root = makeDir()
    await initRepo(root)

    const result = await cleanupWorkspaceLifecycle({ projectDir: root })

    expect(result.canApply).toBe(false)
    expect(result.blockers.join('\n')).toContain('not a linked worktree')
  }, GIT_TEST_TIMEOUT)

  it('keeps porcelain leading spaces so unstaged changes are not counted as staged', async () => {
    const root = makeDir()
    await initRepo(root)
    writeFileSync(join(root, 'README.md'), '# changed\n', 'utf-8')

    const result = await inspectWorkspaceLifecycle({ projectDir: root })

    expect(result.root.clean).toBe(false)
    expect(result.root.staged).toBe(0)
    expect(result.root.unstaged).toBe(1)
  }, GIT_TEST_TIMEOUT)
})
