// SCALE Engine — Enhanced Gates (G16-G22)
// Commit Discipline, Doc Hygiene, Runtime Evidence, Code Review, Supply Chain, Context Budget, Session Health

import type { GateResult, GateStage, GateEvidence } from '../types.js'
import type { IGate } from './GateSystem.js'
import { TestIntegrityGate } from './TestIntegrityGate.js'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { execSync } from 'node:child_process'

type RequiredLevel = 'S' | 'M' | 'L' | 'ALWAYS' | 'CRITICAL'

function createEvidence(input: Omit<GateEvidence, 'id'>): GateEvidence {
  return {
    id: `EVID-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...input,
  }
}

function textEvidence(items: GateEvidence[]): string {
  return items.map(item => `${item.label}: ${item.detail}`).join('\n')
}

function gitCommand(cmd: string, cwd?: string): string {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf-8', stdio: 'pipe', cwd: cwd ?? process.cwd() }).trim()
  } catch {
    return ''
  }
}

// ============================================================================
// G16: Commit Discipline — 提交纪律门禁
// ============================================================================
export class CommitDisciplineGate implements IGate {
  stage = 'G16' as GateStage
  name = 'Commit Discipline'
  description = 'Uncommitted changes must be within thresholds; no large files staged'
  requiredLevel: RequiredLevel = 'M'

  private warnThreshold: number
  private blockThreshold: number
  private staleWarnMinutes: number
  private staleBlockMinutes: number
  private maxStagedFileBytes: number

  constructor(options: {
    warnThreshold?: number
    blockThreshold?: number
    staleWarnMinutes?: number
    staleBlockMinutes?: number
    maxStagedFileBytes?: number
  } = {}) {
    this.warnThreshold = options.warnThreshold ?? 10
    this.blockThreshold = options.blockThreshold ?? 25
    this.staleWarnMinutes = options.staleWarnMinutes ?? 60
    this.staleBlockMinutes = options.staleBlockMinutes ?? 180
    this.maxStagedFileBytes = options.maxStagedFileBytes ?? 1_000_000
  }

  async execute(): Promise<GateResult> {
    const blockers: string[] = []
    const evidenceItems: GateEvidence[] = []
    const cwd = process.cwd()

    // Check 1: Uncommitted file count
    const statusOutput = gitCommand('status --porcelain', cwd)
    const uncommittedFiles = statusOutput ? statusOutput.split('\n').filter(l => l.trim()) : []
    const uncommittedCount = uncommittedFiles.length

    const countPassed = uncommittedCount < this.blockThreshold
    if (uncommittedCount >= this.blockThreshold) {
      blockers.push(`Uncommitted files (${uncommittedCount}) >= block threshold (${this.blockThreshold})`)
    }
    evidenceItems.push(createEvidence({
      kind: 'command',
      label: 'Uncommitted file count',
      passed: countPassed,
      detail: `${uncommittedFiles.length} uncommitted file(s) (warn=${this.warnThreshold}, block=${this.blockThreshold})`,
    }))

    // Check 2: Time since last commit
    const lastCommitTime = gitCommand('log -1 --format=%ct', cwd)
    if (lastCommitTime) {
      const elapsed = (Date.now() / 1000) - parseInt(lastCommitTime, 10)
      const elapsedMinutes = Math.floor(elapsed / 60)

      const stalePassed = elapsedMinutes < this.staleBlockMinutes
      if (elapsedMinutes >= this.staleBlockMinutes) {
        blockers.push(`Last commit was ${elapsedMinutes}min ago >= block threshold (${this.staleBlockMinutes}min)`)
      }
      evidenceItems.push(createEvidence({
        kind: 'command',
        label: 'Time since last commit',
        passed: stalePassed,
        detail: `${elapsedMinutes} minutes since last commit (warn=${this.staleWarnMinutes}, block=${this.staleBlockMinutes})`,
      }))
    }

    // Check 3: Large staged files
    const stagedOutput = gitCommand('diff --cached --name-only', cwd)
    const stagedFiles = stagedOutput ? stagedOutput.split('\n').filter(Boolean) : []
    const largeFiles: string[] = []
    for (const file of stagedFiles) {
      try {
        const fullPath = join(cwd, file)
        if (existsSync(fullPath)) {
          const stat = statSync(fullPath)
          if (stat.size > this.maxStagedFileBytes) {
            largeFiles.push(`${file} (${(stat.size / 1024).toFixed(0)}KB)`)
          }
        }
      } catch {
        // Skip files that can't be stat'd
      }
    }

    const largePassed = largeFiles.length === 0
    if (!largePassed) {
      blockers.push(`Large staged files detected: ${largeFiles.join(', ')}`)
    }
    evidenceItems.push(createEvidence({
      kind: 'command',
      label: 'Large staged files',
      passed: largePassed,
      detail: largePassed ? 'No large staged files' : `Large files: ${largeFiles.join(', ')}`,
    }))

    // Check 4: git diff --check (whitespace errors)
    const diffCheck = gitCommand('diff --check', cwd)
    const diffCheckPassed = !diffCheck
    if (!diffCheckPassed) {
      blockers.push('git diff --check found whitespace errors')
    }
    evidenceItems.push(createEvidence({
      kind: 'command',
      label: 'Whitespace check',
      passed: diffCheckPassed,
      detail: diffCheckPassed ? 'No whitespace errors' : `Whitespace errors: ${diffCheck.slice(0, 200)}`,
    }))

    const passed = blockers.length === 0
    return {
      gate: this.stage,
      status: passed ? 'PASSED' : 'FAILED',
      passed,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers,
      durationMs: 0,
    }
  }
}

// ============================================================================
// G17: Documentation Hygiene — 文档卫生门禁
// ============================================================================
export class DocumentationHygieneGate implements IGate {
  stage = 'G17' as GateStage
  name = 'Documentation Hygiene'
  description = 'Changed docs must have valid internal links and up-to-date references'
  requiredLevel: RequiredLevel = 'M'

  async execute(): Promise<GateResult> {
    const blockers: string[] = []
    const evidenceItems: GateEvidence[] = []
    const cwd = process.cwd()

    // Check 1: Find changed markdown files
    const changedMd = gitCommand('diff --name-only HEAD -- "*.md"', cwd)
    const mdFiles = changedMd ? changedMd.split('\n').filter(f => f.endsWith('.md')) : []

    evidenceItems.push(createEvidence({
      kind: 'command',
      label: 'Changed markdown files',
      passed: true,
      detail: mdFiles.length > 0 ? `${mdFiles.length} markdown file(s) changed` : 'No markdown files changed',
    }))

    if (mdFiles.length === 0) {
      return {
        gate: this.stage,
        status: 'PASSED',
        passed: true,
        evidence: textEvidence(evidenceItems),
        evidenceItems,
        blockers: [],
        durationMs: 0,
      }
    }

    // Check 2: Internal link validation for changed files
    const brokenLinks: string[] = []
    for (const file of mdFiles) {
      const fullPath = join(cwd, file)
      if (!existsSync(fullPath)) continue
      try {
        const content = readFileSync(fullPath, 'utf-8')
        const linkPattern = /\[([^\]]*)\]\(([^)]+)\)/g
        let match: RegExpExecArray | null
        while ((match = linkPattern.exec(content)) !== null) {
          const linkTarget = match[2]
          if (linkTarget.startsWith('http') || linkTarget.startsWith('#') || linkTarget.startsWith('mailto:')) continue
          const [linkPath] = linkTarget.split('#')
          if (!linkPath) continue
          const resolvedTarget = join(cwd, require('path').dirname(file), linkPath)
          if (!existsSync(resolvedTarget)) {
            brokenLinks.push(`${file}: [${match[1]}](${linkTarget})`)
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    const linksPassed = brokenLinks.length === 0
    if (!linksPassed) {
      // Broken links block when markdown files are changed
      blockers.push(`${brokenLinks.length} broken link(s): ${brokenLinks.slice(0, 3).join('; ')}${brokenLinks.length > 3 ? ` (+${brokenLinks.length - 3} more)` : ''}`)
      evidenceItems.push(createEvidence({
        kind: 'file',
        label: 'Internal link check',
        passed: false,
        detail: `Broken links: ${brokenLinks.slice(0, 5).join('; ')}${brokenLinks.length > 5 ? ` (+${brokenLinks.length - 5} more)` : ''}`,
      }))
    } else {
      evidenceItems.push(createEvidence({
        kind: 'file',
        label: 'Internal link check',
        passed: true,
        detail: 'All internal links valid',
      }))
    }

    // Check 3: Version reference freshness
    const versionRefs: string[] = []
    for (const file of mdFiles) {
      const fullPath = join(cwd, file)
      if (!existsSync(fullPath)) continue
      try {
        const content = readFileSync(fullPath, 'utf-8')
        const outdatedVersionPattern = /v0\.(3[0-5])\.\d+/g
        let match: RegExpExecArray | null
        while ((match = outdatedVersionPattern.exec(content)) !== null) {
          versionRefs.push(`${file}: references ${match[0]}`)
        }
      } catch {
        // Skip
      }
    }

    evidenceItems.push(createEvidence({
      kind: 'file',
      label: 'Version references',
      passed: versionRefs.length === 0,
      detail: versionRefs.length === 0 ? 'No outdated version references' : `Outdated: ${versionRefs.slice(0, 3).join('; ')}`,
    }))

    const passed = blockers.length === 0
    return {
      gate: this.stage,
      status: passed ? 'PASSED' : 'FAILED',
      passed,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers,
      durationMs: 0,
    }
  }
}

// ============================================================================
// G18: Runtime Evidence — 运行时证据门禁
// ============================================================================
export class RuntimeEvidenceGate implements IGate {
  stage = 'G18' as GateStage
  name = 'Runtime Evidence'
  description = 'Task must have recorded runtime evidence with matching exit codes'
  requiredLevel: RequiredLevel = 'M'

  constructor(private scaleDir: string = '.scale') {}

  async execute(): Promise<GateResult> {
    const blockers: string[] = []
    const evidenceItems: GateEvidence[] = []

    // Check 1: Evidence directory exists
    const evidenceDir = join(this.scaleDir, 'evidence')
    if (!existsSync(evidenceDir)) {
      evidenceItems.push(createEvidence({
        kind: 'file',
        label: 'Evidence directory',
        passed: false,
        detail: 'No .scale/evidence/ directory found',
      }))
      blockers.push('No runtime evidence directory')
      return {
        gate: this.stage,
        status: 'BLOCKED',
        passed: false,
        evidence: textEvidence(evidenceItems),
        evidenceItems,
        blockers,
        durationMs: 0,
      }
    }

    // Check 2: Recent evidence files exist
    const evidenceFiles = readdirSync(evidenceDir).filter(f => f.endsWith('.json')).sort().reverse()
    const recentEvidence = evidenceFiles.slice(0, 10)

    evidenceItems.push(createEvidence({
      kind: 'file',
      label: 'Evidence files',
      passed: recentEvidence.length > 0,
      detail: `${evidenceFiles.length} evidence file(s), ${recentEvidence.length} recent`,
    }))

    // Check 3: Evidence freshness (within 24h)
    let freshEvidence = false
    if (recentEvidence.length > 0) {
      try {
        const latestPath = join(evidenceDir, recentEvidence[0])
        const latest = JSON.parse(readFileSync(latestPath, 'utf-8'))
        const evidenceTime = new Date(latest.timestamp || latest.createdAt || 0).getTime()
        const hoursSince = (Date.now() - evidenceTime) / (1000 * 60 * 60)
        freshEvidence = hoursSince < 24
        evidenceItems.push(createEvidence({
          kind: 'file',
          label: 'Evidence freshness',
          passed: freshEvidence,
          detail: freshEvidence
            ? `Latest evidence ${hoursSince.toFixed(1)}h ago (< 24h)`
            : `Latest evidence ${hoursSince.toFixed(1)}h ago (>= 24h, stale)`,
        }))
      } catch {
        evidenceItems.push(createEvidence({
          kind: 'file',
          label: 'Evidence freshness',
          passed: false,
          detail: 'Could not parse latest evidence file',
        }))
      }
    }

    // Check 4: Passed evidence exists
    let hasPassedEvidence = false
    for (const file of recentEvidence) {
      try {
        const content = JSON.parse(readFileSync(join(evidenceDir, file), 'utf-8'))
        if (content.status === 'passed' || content.exitCode === 0) {
          hasPassedEvidence = true
          break
        }
      } catch {
        continue
      }
    }
    evidenceItems.push(createEvidence({
      kind: 'file',
      label: 'Passed evidence',
      passed: hasPassedEvidence,
      detail: hasPassedEvidence ? 'At least one passed evidence record found' : 'No passed evidence records found',
    }))

    if (!hasPassedEvidence) blockers.push('No passed runtime evidence found')

    const passed = blockers.length === 0
    return {
      gate: this.stage,
      status: passed ? 'PASSED' : 'BLOCKED',
      passed,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers,
      durationMs: 0,
    }
  }
}

// ============================================================================
// G19: Code Review — 代码评审门禁
// ============================================================================
export class CodeReviewGate implements IGate {
  stage = 'G19' as GateStage
  name = 'Code Review'
  description = 'L/CRITICAL tasks require reviewed changes with resolved findings'
  requiredLevel: RequiredLevel = 'L'

  constructor(private scaleDir: string = '.scale') {}

  async execute(): Promise<GateResult> {
    const blockers: string[] = []
    const evidenceItems: GateEvidence[] = []

    // Check 1: Review artifacts exist
    const reviewDir = join(this.scaleDir, 'state')
    let hasReview = false
    let reviewCount = 0
    let unresolvedFindings = 0

    if (existsSync(reviewDir)) {
      const stateFiles = readdirSync(reviewDir).filter(f => f.startsWith('review-') && f.endsWith('.json'))
      reviewCount = stateFiles.length
      hasReview = reviewCount > 0

      for (const file of stateFiles) {
        try {
          const content = JSON.parse(readFileSync(join(reviewDir, file), 'utf-8'))
          const findings = content.findings ?? []
          unresolvedFindings += findings.filter((f: { resolved?: boolean }) => !f.resolved).length
        } catch {
          continue
        }
      }
    }

    evidenceItems.push(createEvidence({
      kind: 'file',
      label: 'Review artifacts',
      passed: hasReview,
      detail: hasReview ? `${reviewCount} review file(s) found` : 'No review artifacts found',
    }))

    if (!hasReview) {
      blockers.push('No code review artifacts found (required for L/CRITICAL)')
    }

    // Check 2: Unresolved findings
    const findingsPassed = unresolvedFindings === 0
    if (!findingsPassed) {
      blockers.push(`${unresolvedFindings} unresolved finding(s) in review`)
    }
    evidenceItems.push(createEvidence({
      kind: 'file',
      label: 'Unresolved findings',
      passed: findingsPassed,
      detail: findingsPassed ? 'No unresolved findings' : `${unresolvedFindings} unresolved finding(s)`,
    }))

    const passed = blockers.length === 0
    return {
      gate: this.stage,
      status: passed ? 'PASSED' : 'BLOCKED',
      passed,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers,
      durationMs: 0,
    }
  }
}

// ============================================================================
// G20: Supply Chain — 供应链安全门禁
// ============================================================================
export class SupplyChainGate implements IGate {
  stage = 'G20' as GateStage
  name = 'Supply Chain'
  description = 'No CRITICAL/HIGH vulnerabilities; lock file must be consistent'
  requiredLevel: RequiredLevel = 'ALWAYS'

  async execute(): Promise<GateResult> {
    const blockers: string[] = []
    const evidenceItems: GateEvidence[] = []
    const cwd = process.cwd()

    // Check 1: npm audit
    const auditOutput = gitCommand('npm audit --json 2>/dev/null || true', cwd)
    let criticalCount = 0
    let highCount = 0
    try {
      const audit = JSON.parse(auditOutput)
      const vulnerabilities = audit.vulnerabilities ?? {}
      for (const [, vuln] of Object.entries(vulnerabilities) as [string, { severity?: string }][]) {
        if (vuln.severity === 'critical') criticalCount++
        if (vuln.severity === 'high') highCount++
      }
    } catch {
      // npm audit not available or not JSON
    }

    const auditPassed = criticalCount === 0 && highCount === 0
    if (!auditPassed) {
      blockers.push(`npm audit: ${criticalCount} critical, ${highCount} high vulnerabilities`)
    }
    evidenceItems.push(createEvidence({
      kind: 'command',
      label: 'npm audit',
      passed: auditPassed,
      detail: auditPassed ? 'No CRITICAL/HIGH vulnerabilities' : `${criticalCount} critical, ${highCount} high`,
    }))

    // Check 2: Lock file consistency
    const hasLockFile = existsSync(join(cwd, 'package-lock.json')) || existsSync(join(cwd, 'pnpm-lock.yaml')) || existsSync(join(cwd, 'bun.lock'))
    evidenceItems.push(createEvidence({
      kind: 'file',
      label: 'Lock file',
      passed: hasLockFile,
      detail: hasLockFile ? 'Lock file present' : 'No lock file found',
    }))

    // Check 3: package.json consistency (no phantom dependencies)
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'))
      const allDeps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      }
      const depCount = Object.keys(allDeps).length
      evidenceItems.push(createEvidence({
        kind: 'file',
        label: 'Dependency count',
        passed: true,
        detail: `${depCount} declared dependencies`,
      }))
    } catch {
      // No package.json
    }

    const passed = blockers.length === 0
    return {
      gate: this.stage,
      status: passed ? 'PASSED' : 'FAILED',
      passed,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers,
      durationMs: 0,
    }
  }
}

// ============================================================================
// G21: Context Budget — 上下文预算门禁
// ============================================================================
export class ContextBudgetGate implements IGate {
  stage = 'G21' as GateStage
  name = 'Context Budget'
  description = 'Task context must be within token budget; no redundant loading'
  requiredLevel: RequiredLevel = 'M'

  constructor(private scaleDir: string = '.scale') {}

  async execute(): Promise<GateResult> {
    const evidenceItems: GateEvidence[] = []

    // Check 1: Context budget configuration
    const budgetPath = join(this.scaleDir, 'context-budget.json')
    const hasBudget = existsSync(budgetPath)
    evidenceItems.push(createEvidence({
      kind: 'file',
      label: 'Context budget config',
      passed: hasBudget,
      detail: hasBudget ? 'Context budget configured' : 'No context budget configuration',
    }))

    // Check 2: Context budget report
    const reportPath = join(this.scaleDir, 'context-budget-report.json')
    const blockers: string[] = []
    if (existsSync(reportPath)) {
      try {
        const report = JSON.parse(readFileSync(reportPath, 'utf-8'))
        const totalTokens = report.summary?.totalTokens ?? 0
        const maxTokens = report.thresholds?.maxAlwaysTokens ?? 10000
        const withinBudget = totalTokens <= maxTokens

        if (!withinBudget) {
          blockers.push(`Token budget exceeded: ${totalTokens}/${maxTokens} (${Math.round(totalTokens / maxTokens * 100)}%)`)
        }

        evidenceItems.push(createEvidence({
          kind: 'file',
          label: 'Token budget',
          passed: withinBudget,
          detail: `${totalTokens} tokens used / ${maxTokens} max`,
        }))
      } catch {
        evidenceItems.push(createEvidence({
          kind: 'file',
          label: 'Token budget',
          passed: false,
          detail: 'Could not parse context budget report',
        }))
      }
    } else {
      evidenceItems.push(createEvidence({
        kind: 'file',
        label: 'Token budget',
        passed: true,
        detail: 'No budget report (advisory only)',
      }))
    }

    const passed = blockers.length === 0
    return {
      gate: this.stage,
      status: passed ? 'PASSED' : 'FAILED',
      passed,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers,
      durationMs: 0,
    }
  }
}

// ============================================================================
// G22: Session Health — 会话健康门禁
// ============================================================================
export class SessionHealthGate implements IGate {
  stage = 'G22' as GateStage
  name = 'Session Health'
  description = 'No leaked worktrees; session state is consistent'
  requiredLevel: RequiredLevel = 'M'

  async execute(): Promise<GateResult> {
    const evidenceItems: GateEvidence[] = []
    const cwd = process.cwd()

    // Check 1: Stale worktrees
    const worktreeLocations = [
      join(cwd, '.claude', 'worktrees'),
      join(cwd, '.scale', 'worktrees'),
      join(cwd, '.codex', 'worktrees'),
    ]
    let staleWorktrees = 0
    for (const dir of worktreeLocations) {
      if (existsSync(dir)) {
        try {
          const entries = readdirSync(dir)
          staleWorktrees += entries.length
        } catch {
          // Skip
        }
      }
    }

    const worktreePassed = staleWorktrees === 0
    evidenceItems.push(createEvidence({
      kind: 'file',
      label: 'Stale worktrees',
      passed: worktreePassed,
      detail: worktreePassed ? 'No stale worktrees' : `${staleWorktrees} worktree(s) found in .claude/worktrees or .scale/worktrees`,
    }))

    // Check 2: Git worktree list
    const gitWorktrees = gitCommand('worktree list --porcelain', cwd)
    const worktreeCount = gitWorktrees ? gitWorktrees.split('\n').filter(l => l.startsWith('worktree ')).length : 0
    evidenceItems.push(createEvidence({
      kind: 'command',
      label: 'Git worktrees',
      passed: worktreeCount <= 3,
      detail: `${worktreeCount} git worktree(s)`,
    }))

    // Check 3: Session state file
    const statePath = join(cwd, '.scale', 'state', 'current.json')
    if (existsSync(statePath)) {
      try {
        const state = JSON.parse(readFileSync(statePath, 'utf-8'))
        const hasOpenTasks = (state.openTasks ?? []).length > 0
        evidenceItems.push(createEvidence({
          kind: 'file',
          label: 'Session state',
          passed: true,
          detail: `Task: ${state.taskId ?? 'none'}, Phase: ${state.phase ?? 'none'}, Open tasks: ${state.openTasks?.length ?? 0}`,
        }))
      } catch {
        evidenceItems.push(createEvidence({
          kind: 'file',
          label: 'Session state',
          passed: false,
          detail: 'Could not parse session state',
        }))
      }
    } else {
      evidenceItems.push(createEvidence({
        kind: 'file',
        label: 'Session state',
        passed: true,
        detail: 'No active session state',
      }))
    }

    // Check 4: .scale directory size
    const scaleDirPath = join(cwd, '.scale')
    if (existsSync(scaleDirPath)) {
      try {
        const { execSync } = require('child_process')
        const sizeOutput = execSync(`du -sk "${scaleDirPath}" 2>/dev/null`, { encoding: 'utf-8', timeout: 5000 }).trim()
        const sizeKB = parseInt(sizeOutput.split('\t')[0], 10) || 0
        const sizeWarn = sizeKB > 102400 // >100MB
        evidenceItems.push(createEvidence({
          kind: 'file',
          label: 'Scale directory size',
          passed: !sizeWarn,
          detail: sizeWarn ? `.scale is ${Math.round(sizeKB / 1024)}MB (>100MB)` : `.scale is ${Math.round(sizeKB / 1024)}MB`,
        }))
      } catch {
        // Skip if du unavailable
      }
    }

    // Check 5: Disk space
    try {
      const { execSync } = require('child_process')
      const dfOutput = execSync('df -k . 2>/dev/null', { encoding: 'utf-8', timeout: 5000 }).trim()
      const lines = dfOutput.split('\n')
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/)
        const availKB = parseInt(parts[3], 10) || 0
        const lowDisk = availKB < 1048576 // <1GB
        evidenceItems.push(createEvidence({
          kind: 'command',
          label: 'Disk space',
          passed: !lowDisk,
          detail: lowDisk ? `Low disk: ${Math.round(availKB / 1024)}MB available` : `${Math.round(availKB / 1024)}MB available`,
        }))
      }
    } catch {
      // Skip if df unavailable
    }

    return {
      gate: this.stage,
      status: 'PASSED',
      passed: true, // Advisory only, never blocks
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers: [],
      durationMs: 0,
    }
  }
}

// ============================================================================
// 注册所有增强门禁
// ============================================================================
export function registerEnhancedGates(
  gateSystem: { registerGate(gate: IGate): void },
  scaleDir: string = '.scale',
): void {
  gateSystem.registerGate(new CommitDisciplineGate())
  gateSystem.registerGate(new DocumentationHygieneGate())
  gateSystem.registerGate(new RuntimeEvidenceGate(scaleDir))
  gateSystem.registerGate(new CodeReviewGate(scaleDir))
  gateSystem.registerGate(new SupplyChainGate())
  gateSystem.registerGate(new ContextBudgetGate(scaleDir))
  gateSystem.registerGate(new SessionHealthGate())
  gateSystem.registerGate(new TestIntegrityGate())
}
