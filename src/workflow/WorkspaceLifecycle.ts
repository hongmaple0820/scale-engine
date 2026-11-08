import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { execa } from 'execa'
import {
  resolveWorkspaceTopology,
  type ResolvedWorkspaceTopology,
  type WorkspaceBranchPolicy,
  type WorkspaceRepositoryConfig,
} from './WorkspaceTopology.js'

export type WorkspaceRepositoryKind = 'root' | 'submodule' | 'nested-repo'

export interface WorkspaceRepositoryStatus {
  kind: WorkspaceRepositoryKind
  path: string
  relativePath: string
  branch: string | null
  head: string | null
  upstream: string | null
  ahead: number
  behind: number
  gitDir: string | null
  gitCommonDir: string | null
  isLinkedWorktree: boolean
  isSubmodule: boolean
  superproject: string | null
  clean: boolean
  staged: number
  unstaged: number
  untracked: number
}

export interface WorkspaceFinishDecision {
  canCleanup: boolean
  blockers: string[]
  warnings: string[]
  nextActions: string[]
}

export type WorkspaceBranchRole = 'production' | 'integration' | 'feature' | 'release' | 'hotfix' | 'other' | 'detached'

export interface WorkspaceBranchPolicyDecision {
  mode: WorkspaceBranchPolicy['mode']
  branch: string | null
  role: WorkspaceBranchRole
  integrationBranch: string
  productionBranch: string
  protectedBranches: string[]
  featurePrefixes: string[]
  releasePrefixes: string[]
  hotfixPrefixes: string[]
  shipAllowed: boolean
  shipBlockers: string[]
  cleanupBlockers: string[]
  warnings: string[]
  nextActions: string[]
}

export interface WorkspaceLifecycleReport {
  root: WorkspaceRepositoryStatus
  childRepositories: WorkspaceRepositoryStatus[]
  topology: ResolvedWorkspaceTopology
  branchPolicy: WorkspaceBranchPolicyDecision
  finish: WorkspaceFinishDecision
}

export interface WorkspaceLifecycleOptions {
  projectDir?: string
}

export interface WorkspaceCleanupOptions extends WorkspaceLifecycleOptions {
  apply?: boolean
  confirm?: string
}

export interface WorkspaceCleanupResult {
  mode: 'dry-run' | 'apply'
  canApply: boolean
  applied: boolean
  targetPath: string
  confirmationToken: string | null
  blockers: string[]
  warnings: string[]
  commands: string[]
  report: WorkspaceLifecycleReport
}

export async function inspectWorkspaceLifecycle(
  options: WorkspaceLifecycleOptions = {},
): Promise<WorkspaceLifecycleReport> {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const rootTopLevel = await gitRequired(projectDir, ['rev-parse', '--show-toplevel'])
  const root = await inspectRepository(rootTopLevel, rootTopLevel, 'root')
  const topology = resolveWorkspaceTopology({ projectDir: rootTopLevel })
  const childRepositories = await inspectChildRepositories(rootTopLevel, topology)
  const branchPolicy = await inspectBranchPolicy(rootTopLevel, root, topology)
  const finish = decideFinish(root, childRepositories, topology, branchPolicy)

  return { root, childRepositories, topology, branchPolicy, finish }
}

export async function cleanupWorkspaceLifecycle(
  options: WorkspaceCleanupOptions = {},
): Promise<WorkspaceCleanupResult> {
  const report = await inspectWorkspaceLifecycle(options)
  const targetPath = resolve(report.root.path)
  const mode = options.apply ? 'apply' : 'dry-run'
  const confirmationToken = report.root.branch ?? report.root.head
  const blockers = [...report.finish.blockers]
  const warnings = [...report.finish.warnings]

  if (!report.root.isLinkedWorktree) {
    blockers.push('Workspace root is not a linked worktree')
  }
  if (report.root.isSubmodule) {
    blockers.push('Workspace root is a submodule; clean it up from the parent repository workflow')
  }
  if (!report.root.gitCommonDir) {
    blockers.push('Workspace git common directory could not be resolved')
  }
  if (!confirmationToken) {
    blockers.push('Cleanup confirmation token could not be resolved from branch or HEAD')
  }

  const mainRoot = report.root.gitCommonDir ? resolve(dirname(report.root.gitCommonDir)) : null
  if (mainRoot && normalizeAbsolute(mainRoot) === normalizeAbsolute(targetPath)) {
    blockers.push('Refusing to remove the main repository checkout')
  }
  if (mainRoot && !await isRegisteredWorktree(mainRoot, targetPath)) {
    blockers.push('Workspace root is not registered in git worktree list')
  }

  if (mode === 'apply') {
    if (!options.confirm || options.confirm !== confirmationToken) {
      blockers.push(`Cleanup apply requires confirmation token "${confirmationToken ?? '(unknown)'}"; pass --confirm ${confirmationToken ?? '(unknown)'}`)
    }
  }

  const canApply = blockers.length === 0
  const commands = [`git worktree remove "${targetPath}"`]

  if (mode === 'apply' && canApply && mainRoot) {
    await execa('git', ['worktree', 'remove', targetPath], { cwd: mainRoot })
    return {
      mode,
      canApply,
      applied: true,
      targetPath,
      confirmationToken,
      blockers,
      warnings,
      commands,
      report,
    }
  }

  return {
    mode,
    canApply,
    applied: false,
    targetPath,
    confirmationToken,
    blockers,
    warnings,
    commands,
    report,
  }
}

async function inspectRepository(
  repoDir: string,
  rootDir: string,
  kind: WorkspaceRepositoryKind,
  explicitRelativePath?: string,
): Promise<WorkspaceRepositoryStatus> {
  const [branch, head, gitDirRaw, gitCommonDirRaw, superproject, status, upstream] = await Promise.all([
    gitOptional(repoDir, ['branch', '--show-current']),
    gitOptional(repoDir, ['rev-parse', '--short', 'HEAD']),
    gitOptional(repoDir, ['rev-parse', '--git-dir']),
    gitOptional(repoDir, ['rev-parse', '--git-common-dir']),
    gitOptional(repoDir, ['rev-parse', '--show-superproject-working-tree']),
    gitOptional(repoDir, ['status', '--porcelain=v1'], { trim: false }),
    gitOptional(repoDir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
  ])
  const aheadBehind = upstream ? await readAheadBehind(repoDir) : { ahead: 0, behind: 0 }
  const parsedStatus = parsePorcelainStatus(status)
  const gitDir = gitDirRaw ? absolutizeGitPath(repoDir, gitDirRaw) : null
  const gitCommonDir = gitCommonDirRaw ? absolutizeGitPath(repoDir, gitCommonDirRaw) : null
  const isSubmodule = Boolean(superproject)

  return {
    kind,
    path: repoDir,
    relativePath: explicitRelativePath ?? (normalizeRelative(relative(rootDir, repoDir)) || '.'),
    branch: branch || null,
    head: head || null,
    upstream: upstream || null,
    ahead: aheadBehind.ahead,
    behind: aheadBehind.behind,
    gitDir,
    gitCommonDir,
    isLinkedWorktree: Boolean(gitDir && gitCommonDir && gitDir !== gitCommonDir && !isSubmodule),
    isSubmodule,
    superproject: superproject || null,
    clean: parsedStatus.clean,
    staged: parsedStatus.staged,
    unstaged: parsedStatus.unstaged,
    untracked: parsedStatus.untracked,
  }
}

async function inspectChildRepositories(
  rootDir: string,
  topology: ResolvedWorkspaceTopology,
): Promise<WorkspaceRepositoryStatus[]> {
  const submodules = await readGitmodules(rootDir)
  const statuses: WorkspaceRepositoryStatus[] = []
  const seen = new Set<string>()

  for (const repo of topology.repositories) {
    if (repo.path === '.' || repo.role === 'root') continue
    const repoDir = resolve(rootDir, repo.path)
    if (!existsSync(repoDir)) continue
    if (!await isGitRepository(repoDir)) continue
    seen.add(resolve(repoDir))
    statuses.push(await inspectRepository(repoDir, rootDir, kindForConfiguredRepository(repo), normalizeRelative(repo.path)))
  }

  for (const relativePath of submodules) {
    const repoDir = join(rootDir, relativePath)
    if (!existsSync(repoDir)) continue
    if (!await isGitRepository(repoDir)) continue
    seen.add(resolve(repoDir))
    statuses.push(await inspectRepository(repoDir, rootDir, 'submodule', normalizeRelative(relativePath)))
  }

  for (const repoDir of findNestedGitRepositories(rootDir)) {
    const resolved = resolve(repoDir)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    statuses.push(await inspectRepository(repoDir, rootDir, 'nested-repo'))
  }

  return statuses.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

function decideFinish(
  root: WorkspaceRepositoryStatus,
  childRepositories: WorkspaceRepositoryStatus[],
  topology: ResolvedWorkspaceTopology,
  branchPolicy: WorkspaceBranchPolicyDecision,
): WorkspaceFinishDecision {
  const blockers: string[] = []
  const warnings: string[] = []
  const nextActions: string[] = []
  const policy = topology.finishPolicy
  const isMoe = topology.topology === 'moe'

  if (policy.requireCleanRepositories && !root.clean) blockers.push('Root repository has uncommitted changes')
  if (root.upstream && root.ahead > 0) warnings.push(`Root branch ${root.branch ?? '(detached)'} is ${root.ahead} commit(s) ahead of ${root.upstream}`)
  if (!root.upstream && root.branch) warnings.push(`Root branch ${root.branch} has no upstream`)
  blockers.push(...branchPolicy.cleanupBlockers)
  warnings.push(...branchPolicy.warnings)

  for (const child of childRepositories) {
    if (policy.requireCleanRepositories && !child.clean) blockers.push(`Child repository ${child.relativePath} has uncommitted changes`)
    if (policy.requirePushedBranches && child.upstream && child.ahead > 0) blockers.push(`Child repository ${child.relativePath} has unpushed commits`)
    if (policy.requirePushedBranches && isMoe && !child.upstream && child.branch) blockers.push(`Child repository ${child.relativePath} has unpushed commits`)
    if (!child.upstream && child.branch) warnings.push(`Child repository ${child.relativePath} branch ${child.branch} has no upstream`)
  }

  if (policy.requireRootPointerUpdate && childRepositories.some(hasChildIntegrationWork)) {
    warnings.push('MOE finish policy requires root pointer or integration metadata review after child repository changes')
  }

  if (blockers.length === 0) {
    if (root.isLinkedWorktree) {
      nextActions.push('Safe to remove linked worktree after branch is pushed, merged, or intentionally discarded')
    } else {
      nextActions.push('No linked worktree cleanup is required for the root checkout')
    }
  } else {
    nextActions.push('Commit or stash child repository changes before removing the temporary worktree')
    nextActions.push('If child repositories changed, push or review them in their own remotes before root cleanup')
  }
  nextActions.push(...branchPolicy.nextActions)

  return {
    canCleanup: blockers.length === 0 && root.isLinkedWorktree,
    blockers,
    warnings,
    nextActions,
  }
}

async function inspectBranchPolicy(
  rootDir: string,
  root: WorkspaceRepositoryStatus,
  topology: ResolvedWorkspaceTopology,
): Promise<WorkspaceBranchPolicyDecision> {
  const policy = topology.branchPolicy
  const branch = root.branch
  const role = classifyBranch(branch, policy)
  const shipBlockers: string[] = []
  const cleanupBlockers: string[] = []
  const warnings: string[] = []
  const nextActions: string[] = []

  if (!branch) {
    shipBlockers.push('Detached HEAD cannot be shipped; create a named GitLab Flow branch first')
  } else if (role === 'production') {
    shipBlockers.push(`Direct ship on production branch ${branch} is blocked; merge a verified release/hotfix branch and tag from ${policy.productionBranch}`)
  } else if (role === 'integration') {
    shipBlockers.push(`Direct ship on integration branch ${branch} is blocked; create a short feat/*, fix/*, chore/*, docs/*, release/*, or hotfix/* branch`)
  } else if (policy.protectedBranches.includes(branch)) {
    shipBlockers.push(`Direct ship on protected branch ${branch} is blocked by branch policy`)
  } else if (role === 'other') {
    const allowedPrefixes = [
      ...policy.featurePrefixes,
      ...policy.releasePrefixes,
      ...policy.hotfixPrefixes,
    ]
    shipBlockers.push(`Branch ${branch} does not match allowed GitLab Flow prefixes: ${allowedPrefixes.join(', ')}`)
  }

  if (root.isLinkedWorktree && branch) {
    const mergedOrEmpty = await isMergedOrEmptyAgainstPolicyBranches(rootDir, policy)
    if (root.upstream && root.ahead > 0) {
      cleanupBlockers.push(`Local branch ${branch} has ${root.ahead} unpushed commit(s); push, merge, or intentionally discard before worktree cleanup`)
    } else if (!root.upstream && !mergedOrEmpty) {
      cleanupBlockers.push(`Local branch ${branch} has commits that are not pushed or merged into ${policy.integrationBranch}/${policy.productionBranch}`)
    }
  }

  if (role === 'integration') {
    nextActions.push(`Create short branches from ${policy.integrationBranch}; merge reviewed work back to ${policy.integrationBranch}`)
  } else if (role === 'production') {
    nextActions.push(`Keep ${policy.productionBranch} production-only; publish from user-created vX.Y.Z tags on ${policy.productionBranch}`)
  } else if (role === 'feature') {
    nextActions.push(`Merge this branch to ${policy.integrationBranch}, verify there, then delete the branch`)
  } else if (role === 'release') {
    nextActions.push(`Release branch should contain only selected release changes; merge to ${policy.productionBranch}, tag, publish, then sync ${policy.productionBranch} back to ${policy.integrationBranch}`)
  } else if (role === 'hotfix') {
    nextActions.push(`Fix forward on ${policy.integrationBranch} first when possible, cherry-pick to hotfix/${policy.productionBranch}, tag, then sync back`)
  } else if (role === 'other') {
    nextActions.push('Rename the branch to an allowed prefix or update .scale/workspace.json branchPolicy deliberately')
  }

  return {
    mode: policy.mode,
    branch,
    role,
    integrationBranch: policy.integrationBranch,
    productionBranch: policy.productionBranch,
    protectedBranches: policy.protectedBranches,
    featurePrefixes: policy.featurePrefixes,
    releasePrefixes: policy.releasePrefixes,
    hotfixPrefixes: policy.hotfixPrefixes,
    shipAllowed: shipBlockers.length === 0,
    shipBlockers,
    cleanupBlockers,
    warnings,
    nextActions,
  }
}

function classifyBranch(branch: string | null, policy: Required<WorkspaceBranchPolicy>): WorkspaceBranchRole {
  if (!branch) return 'detached'
  if (branch === policy.productionBranch || branch === 'main' && policy.productionBranch === 'master') return 'production'
  if (branch === policy.integrationBranch) return 'integration'
  if (policy.releasePrefixes.some(prefix => branch.startsWith(prefix))) return 'release'
  if (policy.hotfixPrefixes.some(prefix => branch.startsWith(prefix))) return 'hotfix'
  if (policy.featurePrefixes.some(prefix => branch.startsWith(prefix))) return 'feature'
  return 'other'
}

async function isMergedOrEmptyAgainstPolicyBranches(
  repoDir: string,
  policy: Required<WorkspaceBranchPolicy>,
): Promise<boolean> {
  const candidateRefs = [
    policy.integrationBranch,
    `origin/${policy.integrationBranch}`,
    policy.productionBranch,
    `origin/${policy.productionBranch}`,
    'main',
    'origin/main',
  ]
  for (const ref of candidateRefs) {
    if (!await refExists(repoDir, ref)) continue
    if (await isHeadMergedInto(repoDir, ref)) return true
  }
  return false
}

async function refExists(repoDir: string, ref: string): Promise<boolean> {
  const result = await execa('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: repoDir, reject: false })
  return result.exitCode === 0
}

async function isHeadMergedInto(repoDir: string, ref: string): Promise<boolean> {
  const result = await execa('git', ['merge-base', '--is-ancestor', 'HEAD', ref], { cwd: repoDir, reject: false })
  return result.exitCode === 0
}

function kindForConfiguredRepository(repo: WorkspaceRepositoryConfig): WorkspaceRepositoryKind {
  return repo.role === 'submodule' ? 'submodule' : 'nested-repo'
}

function hasChildIntegrationWork(child: WorkspaceRepositoryStatus): boolean {
  return !child.clean || child.ahead > 0 || Boolean(child.branch && !child.upstream)
}

async function readGitmodules(rootDir: string): Promise<string[]> {
  if (!existsSync(join(rootDir, '.gitmodules'))) return []
  const output = await gitOptional(rootDir, ['config', '--file', '.gitmodules', '--get-regexp', 'path'])
  return output
    .split(/\r?\n/)
    .map(line => line.trim().split(/\s+/)[1])
    .filter((path): path is string => Boolean(path))
    .map(normalizeRelative)
}

function findNestedGitRepositories(rootDir: string): string[] {
  const results: string[] = []
  const ignored = new Set(['.git', '.scale', 'node_modules', 'dist', 'coverage', '.worktrees', 'worktrees'])

  function walk(dir: string, depth: number) {
    if (depth > 5) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (ignored.has(entry.name)) continue
      const child = join(dir, entry.name)
      if (existsSync(join(child, '.git'))) {
        results.push(child)
        continue
      }
      walk(child, depth + 1)
    }
  }

  walk(rootDir, 0)
  return results
}

async function isGitRepository(dir: string): Promise<boolean> {
  const result = await execa('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, reject: false })
  return result.exitCode === 0 && result.stdout.trim() === 'true'
}

async function isRegisteredWorktree(mainRoot: string, targetPath: string): Promise<boolean> {
  const result = await execa('git', ['worktree', 'list', '--porcelain'], { cwd: mainRoot, reject: false })
  if (result.exitCode !== 0) return false
  const normalizedTarget = normalizeAbsolute(targetPath)
  return result.stdout
    .split(/\r?\n/)
    .filter(line => line.startsWith('worktree '))
    .some(line => normalizeAbsolute(line.slice('worktree '.length)) === normalizedTarget)
}

async function readAheadBehind(repoDir: string): Promise<{ ahead: number; behind: number }> {
  const output = await gitOptional(repoDir, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'])
  const [behind, ahead] = output.split(/\s+/).map(value => Number.parseInt(value, 10))
  return {
    ahead: Number.isFinite(ahead) ? ahead : 0,
    behind: Number.isFinite(behind) ? behind : 0,
  }
}

function parsePorcelainStatus(output: string): { clean: boolean; staged: number; unstaged: number; untracked: number } {
  let staged = 0
  let unstaged = 0
  let untracked = 0

  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    if (line.startsWith('??')) {
      untracked += 1
      continue
    }
    if (line[0] !== ' ') staged += 1
    if (line[1] !== ' ') unstaged += 1
  }

  return {
    clean: staged === 0 && unstaged === 0 && untracked === 0,
    staged,
    unstaged,
    untracked,
  }
}

async function gitRequired(cwd: string, args: string[]): Promise<string> {
  const result = await execa('git', args, { cwd })
  return result.stdout.trim()
}

async function gitOptional(cwd: string, args: string[], options: { trim?: boolean } = {}): Promise<string> {
  const result = await execa('git', args, { cwd, reject: false })
  if (result.exitCode !== 0) return ''
  return options.trim === false ? result.stdout : result.stdout.trim()
}

function absolutizeGitPath(cwd: string, path: string): string {
  return normalizeAbsolute(isAbsolute(path) ? path : resolve(cwd, path))
}

function normalizeAbsolute(path: string): string {
  const absolute = resolve(path)
  try {
    return realpathSync.native(absolute).replace(/\\/g, '/')
  } catch {
    return absolute.replace(/\\/g, '/')
  }
}

function normalizeRelative(path: string): string {
  return path.replace(/\\/g, '/')
}
