// SCALE Engine — Ship Pipeline (v0.32.0)
// Full ship closure: sync-base → test → review-diff → bump-version → changelog → commit → push → create-pr
// Inspired by gstack's /ship skill, integrated with scale-engine governance.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync, execSync } from 'node:child_process'
import { runSafeCommand, type SafeCommandResult } from '../tools/SafeCommandRunner.js'
import { parseChangedFiles, shouldReviewFile, type ChangedFile } from './ReviewAnalyzer.js'
import { resolveVerificationTargets } from './VerificationProfile.js'
import { collectSessionPreamble } from './SessionPreamble.js'
import { autoLearnFromRunReport } from '../evolution/SessionLearnings.js'

// ============================================================================
// Types
// ============================================================================

export type ShipStep = 'sync-base' | 'test' | 'review-diff' | 'bump-version' | 'changelog' | 'commit' | 'push' | 'create-pr'

export interface ShipPipelineInput {
  projectDir?: string
  scaleDir?: string
  baseBranch?: string
  remote?: string
  prTitle?: string
  prBody?: string
  skipSteps?: ShipStep[]
  dryRun?: boolean
  versionBump?: 'patch' | 'minor' | 'major'
}

export interface ShipStepResult {
  step: ShipStep
  status: 'passed' | 'skipped' | 'failed' | 'blocked'
  duration: number
  evidence?: string
  error?: string
}

export interface ShipPipelineResult {
  success: boolean
  steps: ShipStepResult[]
  prUrl?: string
  commitSha?: string
  totalDuration: number
  changedFiles: string[]
  warnings: string[]
}

// ============================================================================
// Pipeline
// ============================================================================

export async function runShipPipeline(input: ShipPipelineInput): Promise<ShipPipelineResult> {
  const projectDir = input.projectDir ?? process.cwd()
  const scaleDir = input.scaleDir ?? '.scale'
  const baseBranch = input.baseBranch ?? 'master'
  const remote = input.remote ?? 'origin'
  const skipSteps = new Set(input.skipSteps ?? [])
  const dryRun = input.dryRun ?? false
  const versionBump = input.versionBump ?? 'patch'

  const steps: ShipStepResult[] = []
  const warnings: string[] = []
  const startTime = Date.now()
  let changedFiles: string[] = []

  // Collect preamble
  const preamble = collectSessionPreamble({ projectDir, scaleDir })

  // Execute steps in order
  const allSteps: ShipStep[] = ['sync-base', 'test', 'review-diff', 'bump-version', 'changelog', 'commit', 'push', 'create-pr']

  for (const step of allSteps) {
    if (skipSteps.has(step)) {
      steps.push({ step, status: 'skipped', duration: 0 })
      continue
    }

    const stepStart = Date.now()
    try {
      const result = await executeStep(step, {
        projectDir,
        scaleDir,
        baseBranch,
        remote,
        dryRun,
        versionBump,
        preamble,
        changedFiles,
        prTitle: input.prTitle,
        prBody: input.prBody,
      })

      steps.push({
        step,
        status: result.status,
        duration: Date.now() - stepStart,
        evidence: result.evidence,
        error: result.error,
      })

      if (result.status === 'failed') {
        // Pipeline stops on failure
        break
      }

      if (result.changedFiles) {
        changedFiles = result.changedFiles
      }
    } catch (err) {
      steps.push({
        step,
        status: 'failed',
        duration: Date.now() - stepStart,
        error: err instanceof Error ? err.message : String(err),
      })
      break
    }
  }

  const totalDuration = Date.now() - startTime
  const success = steps.every(s => s.status === 'passed' || s.status === 'skipped')
  const lastStep = steps[steps.length - 1]

  return {
    success,
    steps,
    totalDuration,
    changedFiles,
    warnings,
    commitSha: extractCommitSha(steps),
    prUrl: extractPrUrl(steps),
  }
}

// ============================================================================
// Step Executor
// ============================================================================

interface StepContext {
  projectDir: string
  scaleDir: string
  baseBranch: string
  remote: string
  dryRun: boolean
  versionBump: 'patch' | 'minor' | 'major'
  preamble: ReturnType<typeof collectSessionPreamble>
  changedFiles: string[]
  prTitle?: string
  prBody?: string
}

interface StepOutput {
  status: 'passed' | 'failed' | 'blocked'
  evidence?: string
  error?: string
  changedFiles?: string[]
}

async function executeStep(step: ShipStep, ctx: StepContext): Promise<StepOutput> {
  switch (step) {
    case 'sync-base':
      return executeSyncBase(ctx)
    case 'test':
      return executeTest(ctx)
    case 'review-diff':
      return executeReviewDiff(ctx)
    case 'bump-version':
      return executeBumpVersion(ctx)
    case 'changelog':
      return executeChangelog(ctx)
    case 'commit':
      return executeCommit(ctx)
    case 'push':
      return executePush(ctx)
    case 'create-pr':
      return executeCreatePr(ctx)
  }
}

// ============================================================================
// Step Implementations
// ============================================================================

async function executeSyncBase(ctx: StepContext): Promise<StepOutput> {
  try {
    // Fetch latest
    execSync(`git fetch ${ctx.remote}`, { cwd: ctx.projectDir, encoding: 'utf-8', timeout: 30000 })

    // Check if base branch exists locally
    try {
      execSync(`git rev-parse --verify ${ctx.baseBranch}`, { cwd: ctx.projectDir, encoding: 'utf-8' })
    } catch {
      // Track remote branch
      execSync(`git checkout -b ${ctx.baseBranch} ${ctx.remote}/${ctx.baseBranch}`, { cwd: ctx.projectDir, encoding: 'utf-8' })
    }

    // Get current branch
    const currentBranch = execSync('git branch --show-current', { cwd: ctx.projectDir, encoding: 'utf-8' }).trim()

    if (currentBranch !== ctx.baseBranch) {
      // Merge base into current branch
      try {
        execSync(`git merge ${ctx.remote}/${ctx.baseBranch} --no-edit`, { cwd: ctx.projectDir, encoding: 'utf-8', timeout: 30000 })
      } catch (err) {
        return { status: 'failed', error: `Merge conflict with ${ctx.baseBranch}. Resolve conflicts manually.` }
      }
    }

    return { status: 'passed', evidence: `Synced with ${ctx.remote}/${ctx.baseBranch}` }
  } catch (err) {
    return { status: 'failed', error: `Sync failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

async function executeTest(ctx: StepContext): Promise<StepOutput> {
  try {
    // Resolve test command from verification profile
    const targets = resolveVerificationTargets({ projectDir: ctx.projectDir, scaleDir: ctx.scaleDir })
    const testCommand = targets.targets[0]?.config.test ?? 'npm test'

    if (ctx.dryRun) {
      return { status: 'passed', evidence: `[dry-run] Would run: ${testCommand}` }
    }

    const result = await runSafeCommand(testCommand, { cwd: ctx.projectDir, timeout: 300000 })
    if (result.exitCode !== 0) {
      return { status: 'failed', error: `Tests failed (exit ${result.exitCode}): ${result.stderr.slice(0, 500)}` }
    }

    return { status: 'passed', evidence: `Tests passed: ${testCommand}` }
  } catch (err) {
    return { status: 'failed', error: `Test execution failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

async function executeReviewDiff(ctx: StepContext): Promise<StepOutput> {
  try {
    const diffOutput = execSync(`git diff --name-only ${ctx.remote}/${ctx.baseBranch}`, {
      cwd: ctx.projectDir,
      encoding: 'utf-8',
    })
    const untrackedOutput = execSync('git ls-files --others --exclude-standard', {
      cwd: ctx.projectDir,
      encoding: 'utf-8',
    })

    const changedFiles = [
      ...parseChangedFiles(diffOutput),
      ...parseChangedFiles(untrackedOutput),
    ]
      .filter(f => shouldReviewFile(f.path))
      .map(f => f.path)
    const reviewableFiles = unique(changedFiles)

    if (reviewableFiles.length === 0) {
      return { status: 'passed', evidence: 'No reviewable changes', changedFiles: [] }
    }

    return {
      status: 'passed',
      evidence: `${reviewableFiles.length} file(s) changed: ${reviewableFiles.slice(0, 5).join(', ')}${reviewableFiles.length > 5 ? '...' : ''}`,
      changedFiles: reviewableFiles,
    }
  } catch (err) {
    return { status: 'failed', error: `Diff review failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

async function executeBumpVersion(ctx: StepContext): Promise<StepOutput> {
  const pkgPath = join(ctx.projectDir, 'package.json')
  if (!existsSync(pkgPath)) {
    return { status: 'passed', evidence: 'No package.json found, skipping version bump' }
  }

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string }
    const previousVersion = pkg.version
    if (!previousVersion) {
      return { status: 'passed', evidence: 'No version field in package.json' }
    }

    const [major, minor, patch] = previousVersion.split('.').map(Number)
    let newVersion: string
    switch (ctx.versionBump) {
      case 'major': newVersion = `${major + 1}.0.0`; break
      case 'minor': newVersion = `${major}.${minor + 1}.0`; break
      case 'patch': newVersion = `${major}.${minor}.${patch + 1}`; break
    }

    if (ctx.dryRun) {
      return { status: 'passed', evidence: `[dry-run] Would bump ${previousVersion} -> ${newVersion}` }
    }

    pkg.version = newVersion
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
    const changedFiles = mergeChangedFiles(ctx.changedFiles, ['package.json'])

    // Also update package-lock.json if it exists
    const lockPath = join(ctx.projectDir, 'package-lock.json')
    if (existsSync(lockPath)) {
      const lock = readFileSync(lockPath, 'utf-8')
      writeFileSync(lockPath, lock.replace(`"version": "${previousVersion}"`, `"version": "${newVersion}"`), 'utf-8')
      changedFiles.push('package-lock.json')
    }

    return { status: 'passed', evidence: `Version bumped: ${previousVersion} -> ${newVersion}`, changedFiles: unique(changedFiles) }
  } catch (err) {
    return { status: 'failed', error: `Version bump failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

async function executeChangelog(ctx: StepContext): Promise<StepOutput> {
  const changelogPath = join(ctx.projectDir, 'CHANGELOG.md')
  if (!existsSync(changelogPath)) {
    return { status: 'passed', evidence: 'No CHANGELOG.md found, skipping' }
  }

  try {
    if (ctx.dryRun) {
      return { status: 'passed', evidence: '[dry-run] Would update CHANGELOG.md' }
    }

    const pkgPath = join(ctx.projectDir, 'package.json')
    let version = '0.0.0'
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string }
      version = pkg.version ?? '0.0.0'
    }

    const today = new Date().toISOString().slice(0, 10)
    const changelog = readFileSync(changelogPath, 'utf-8')

    // Get commit messages since last tag
    let commitSummary = ''
    try {
      const lastTag = execSync('git describe --tags --abbrev=0 2>/dev/null || echo ""', { cwd: ctx.projectDir, encoding: 'utf-8' }).trim()
      const range = lastTag ? `${lastTag}..HEAD` : 'HEAD'
      const messages = execSync(`git log ${range} --oneline --no-merges | head -20`, { cwd: ctx.projectDir, encoding: 'utf-8' }).trim()
      if (messages) {
        commitSummary = '\n' + messages.split('\n').map(m => `- ${m.replace(/^[a-f0-9]+ /, '')}`).join('\n')
      }
    } catch {
      // Ignore git log errors
    }

    const newEntry = `## ${version} - ${today}\n\n### Changes${commitSummary}\n\n---\n\n`
    writeFileSync(changelogPath, newEntry + changelog, 'utf-8')

    return { status: 'passed', evidence: `CHANGELOG.md updated for v${version}`, changedFiles: mergeChangedFiles(ctx.changedFiles, ['CHANGELOG.md']) }
  } catch (err) {
    return { status: 'failed', error: `Changelog update failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

async function executeCommit(ctx: StepContext): Promise<StepOutput> {
  try {
    const filesToStage = collectStageableFiles(ctx)
    if (filesToStage.length === 0) {
      return { status: 'passed', evidence: 'No reviewed changes to commit' }
    }

    if (ctx.dryRun) {
      return { status: 'passed', evidence: `[dry-run] Would stage ${filesToStage.length} reviewed file(s): ${formatFileList(filesToStage)}` }
    }

    stageFiles(ctx.projectDir, filesToStage)

    // Check if there are changes to commit
    try {
      execSync('git diff --cached --quiet', { cwd: ctx.projectDir, encoding: 'utf-8' })
      return { status: 'passed', evidence: 'No changes to commit' }
    } catch {
      // There are changes, continue
    }

    // Get version for commit message
    let version = ''
    const pkgPath = join(ctx.projectDir, 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string }
      version = pkg.version ?? ''
    }

    const commitMsg = version ? `chore: release v${version}` : `chore: ship ${new Date().toISOString().slice(0, 10)}`
    execSync(`git commit -m "${commitMsg}"`, { cwd: ctx.projectDir, encoding: 'utf-8' })

    // Get commit SHA
    const sha = execSync('git rev-parse HEAD', { cwd: ctx.projectDir, encoding: 'utf-8' }).trim()

    return { status: 'passed', evidence: `Committed: ${sha.slice(0, 8)} — ${commitMsg}` }
  } catch (err) {
    return { status: 'failed', error: `Commit failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

async function executePush(ctx: StepContext): Promise<StepOutput> {
  try {
    const currentBranch = execSync('git branch --show-current', { cwd: ctx.projectDir, encoding: 'utf-8' }).trim()

    if (ctx.dryRun) {
      return { status: 'passed', evidence: `[dry-run] Would push to ${ctx.remote}/${currentBranch}` }
    }

    execSync(`git push ${ctx.remote} ${currentBranch}`, { cwd: ctx.projectDir, encoding: 'utf-8', timeout: 60000 })

    return { status: 'passed', evidence: `Pushed to ${ctx.remote}/${currentBranch}` }
  } catch (err) {
    return { status: 'failed', error: `Push failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

async function executeCreatePr(ctx: StepContext): Promise<StepOutput> {
  try {
    const currentBranch = execSync('git branch --show-current', { cwd: ctx.projectDir, encoding: 'utf-8' }).trim()

    if (ctx.dryRun) {
      return { status: 'passed', evidence: `[dry-run] Would create PR: ${currentBranch} → ${ctx.baseBranch}` }
    }

    const title = ctx.prTitle ?? `Ship ${currentBranch} → ${ctx.baseBranch}`
    const body = ctx.prBody ?? `Automated PR created by scale ship pipeline.\n\nBranch: ${currentBranch}\nBase: ${ctx.baseBranch}`

    // Try gh CLI first
    try {
      const prUrl = execSync(
        `gh pr create --title "${title}" --body "${body}" --base ${ctx.baseBranch}`,
        { cwd: ctx.projectDir, encoding: 'utf-8', timeout: 30000 },
      ).trim()

      return { status: 'passed', evidence: `PR created: ${prUrl}` }
    } catch {
      // gh not available or failed, output manual instructions
      return {
        status: 'passed',
        evidence: `Push complete. Create PR manually: ${currentBranch} → ${ctx.baseBranch}`,
      }
    }
  } catch (err) {
    return { status: 'failed', error: `PR creation failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function extractCommitSha(steps: ShipStepResult[]): string | undefined {
  const commitStep = steps.find(s => s.step === 'commit' && s.status === 'passed')
  if (!commitStep?.evidence) return undefined
  const match = commitStep.evidence.match(/Committed: ([a-f0-9]+)/)
  return match?.[1]
}

function extractPrUrl(steps: ShipStepResult[]): string | undefined {
  const prStep = steps.find(s => s.step === 'create-pr' && s.status === 'passed')
  if (!prStep?.evidence) return undefined
  const match = prStep.evidence.match(/PR created: (https?:\/\/\S+)/)
  return match?.[1]
}

function collectStageableFiles(ctx: StepContext): string[] {
  const shipGeneratedFiles = ['package.json', 'package-lock.json', 'CHANGELOG.md']
    .filter(path => hasGitChange(ctx.projectDir, path))
  return mergeChangedFiles(ctx.changedFiles, shipGeneratedFiles)
}

function stageFiles(projectDir: string, files: string[]): void {
  execFileSync('git', ['add', '--', ...files], { cwd: projectDir, encoding: 'utf-8' })
}

function hasGitChange(projectDir: string, path: string): boolean {
  try {
    const output = execFileSync('git', ['status', '--porcelain', '--', path], { cwd: projectDir, encoding: 'utf-8' })
    return output.trim().length > 0
  } catch {
    return false
  }
}

function mergeChangedFiles(existing: string[], additional: string[]): string[] {
  return unique([...existing, ...additional].filter(Boolean))
}

function formatFileList(files: string[], limit = 8): string {
  const shown = files.slice(0, limit).join(', ')
  return files.length > limit ? `${shown}, ...` : shown
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

// ============================================================================
// Summary
// ============================================================================

export function summarizeShipPipeline(result: ShipPipelineResult): string {
  const lines: string[] = ['## Ship Pipeline Result\n']

  for (const step of result.steps) {
    const icon = step.status === 'passed' ? '✅' : step.status === 'skipped' ? '⏭️' : step.status === 'blocked' ? '🚫' : '❌'
    lines.push(`${icon} **${step.step}** (${step.duration}ms)`)
    if (step.evidence) lines.push(`   ${step.evidence}`)
    if (step.error) lines.push(`   Error: ${step.error}`)
  }

  lines.push('')
  lines.push(`**Total duration:** ${result.totalDuration}ms`)
  lines.push(`**Changed files:** ${result.changedFiles.length}`)

  if (result.commitSha) lines.push(`**Commit:** ${result.commitSha}`)
  if (result.prUrl) lines.push(`**PR:** ${result.prUrl}`)

  return lines.join('\n')
}
