import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { TOOL_CAPABILITY_CATALOG, type ToolCapabilityCategory } from '../tools/ToolCapabilityRegistry.js'
import { createAiOsDoctor, type AiOsDoctorReport } from '../runtime/AiOsRuntime.js'
import { SCALE_ENGINE_VERSION } from '../version.js'
import { computeGovernanceDrift, readGovernanceLock, type GovernanceDriftReport } from './GovernanceLock.js'
import { listGovernanceTemplatePacks, resolveGovernanceTemplatePack, type GovernancePackId } from './GovernanceTemplatePacks.js'
import { writeGovernanceTemplates } from './GovernanceTemplates.js'

export type UpgradeStatus = 'missing-lock' | 'clean' | 'updates-available' | 'local-changes'
export type UpgradeApplyMode = 'safe' | 'manual-review'
export type UpgradeRisk = 'low' | 'medium' | 'high'
export type ThirdPartyTrust = 'trusted' | 'community' | 'high-risk'
export type ThirdPartyInstallPolicy = 'default-install'
export type ThirdPartyUpdatePolicy = ThirdPartyInstallPolicy

export interface UpgradeManagerOptions {
  projectDir?: string
  scaleDir?: string
  targetScaleVersion?: string
}

export interface UpgradeApplyOptions extends UpgradeManagerOptions {
  confirm?: boolean
  autoBackup?: boolean
}

export interface UpgradeRecommendReport {
  version: 1
  projectDir: string
  riskScore: number
  riskLevel: 'low' | 'medium' | 'high'
  summary: string
  steps: UpgradePlanStep[]
  blockers: UpgradePlanBlocker[]
  applyMode: UpgradeApplyMode
  recommendation: 'safe-to-apply' | 'review-first' | 'blocked'
  autoCommands: string[]
  plan: UpgradePlanReport
}

export interface UpgradeCheckReport {
  version: 1
  projectDir: string
  status: UpgradeStatus
  scaleEngine: {
    currentVersion: string | null
    latestVersion: string
    upToDate: boolean
  }
  governanceLock: {
    exists: boolean
    path: string
  }
  governancePack: {
    id: GovernancePackId | null
    currentVersion: number | null
    latestVersion: number | null
    upToDate: boolean
  }
  generatedFiles: {
    total: number
    clean: number
    changed: number
    missing: number
  }
  drift: GovernanceDriftReport
  thirdParty: ThirdPartyUpdateReport
  aiOsRuntime: AiOsDoctorReport
  recommendedCommands: string[]
}

export interface ThirdPartyUpdateReport {
  version: 1
  policy: ThirdPartyInstallPolicy
  summary: {
    total: number
    trusted: number
    community: number
    highRisk: number
    reviewRequired: number
    blocked: number
  }
  reviewRequired: number
  entries: ThirdPartyUpdateEntry[]
}

export interface ThirdPartyUpdateEntry {
  id: string
  name: string
  category: ToolCapabilityCategory
  source?: string
  trust: ThirdPartyTrust
  updatePolicy: ThirdPartyUpdatePolicy
  installPolicy: ThirdPartyInstallPolicy
  latestVersion: 'unknown'
  reason: string
}

export interface UpgradePlanReport {
  version: 1
  projectDir: string
  status: UpgradeStatus
  applyMode: UpgradeApplyMode
  blockers: UpgradePlanBlocker[]
  steps: UpgradePlanStep[]
  check: UpgradeCheckReport
  recommendedCommands: string[]
}

export interface UpgradePlanBlocker {
  code: 'missing-governance-lock' | 'local-generated-file-changed'
  path?: string
  message: string
}

export interface UpgradePlanStep {
  action:
    | 'initialize-governance-lock'
    | 'upgrade-scale-engine'
    | 'upgrade-governance-pack'
    | 'refresh-managed-generated-files'
    | 'restore-missing-generated-file'
    | 'review-local-change'
    | 'setup-third-party-capabilities'
    | 'adopt-ai-os-runtime'
    | 'migrate-ai-os-runtime'
    | 'check-ai-os-runtime'
    | 'run-preflight'
    | 'deprecation-warning'
  path?: string
  risk: UpgradeRisk
  reason: string
  command?: string
}

export interface DeprecationWarning {
  feature: string
  deprecatedSince: string
  removedIn: string
  replacement: string
  message: string
}

export const DEPRECATION_REGISTRY: DeprecationWarning[] = [
  {
    feature: 'scale context inject',
    deprecatedSince: '0.42.0',
    removedIn: '0.43.0',
    replacement: 'scale cortex inject',
    message: 'The standalone "scale context inject" command is deprecated. Use "scale cortex inject" instead.',
  },
  {
    feature: 'scale doctor',
    deprecatedSince: '0.42.0',
    removedIn: '0.43.0',
    replacement: 'scale verify',
    message: 'The standalone "scale doctor" command is deprecated. Use "scale verify" for comprehensive health checks.',
  },
  {
    feature: 'Legacy hook exit protocol (0/1)',
    deprecatedSince: '0.42.0',
    removedIn: '0.44.0',
    replacement: 'Shield exit protocol (0=allow, 2=block)',
    message: 'Hooks using exit code 1 for blocking should migrate to exit code 2 per the Shield protocol.',
  },
  {
    feature: '.scale/state/ flat artifacts',
    deprecatedSince: '0.42.0',
    removedIn: '0.44.0',
    replacement: 'Engine-specific state directories (.scale/shield/, .scale/orchestrator/, .scale/cortex/)',
    message: 'The flat .scale/state/ directory is being replaced by engine-specific state directories.',
  },
]

export interface UpgradeBackupManifest {
  version: 1
  id: string
  createdAt: string
  projectDir: string
  files: UpgradeBackupEntry[]
}

export interface UpgradeBackupEntry {
  path: string
  existed: boolean
  backupPath?: string
}

export interface UpgradeApplyReport {
  version: 1
  projectDir: string
  ok: boolean
  applied: boolean
  reason: string
  changedFiles: string[]
  backup?: {
    id: string
    dir: string
    manifestPath: string
  }
  gitBackup?: {
    branch: string
    ok: boolean
    error?: string
  }
  plan: UpgradePlanReport
}

export interface UpgradeRollbackReport {
  version: 1
  projectDir: string
  ok: boolean
  applied: boolean
  reason: string
  backup?: {
    id: string
    dir: string
    manifestPath: string
  }
  restoredFiles: string[]
}

export function createUpgradeCheckReport(options: UpgradeManagerOptions = {}): UpgradeCheckReport {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const lock = readGovernanceLock(projectDir)
  const drift = computeGovernanceDrift(projectDir)
  const latestScaleVersion = normalizeTargetVersion(options.targetScaleVersion)
  const scaleDir = options.scaleDir ?? join(projectDir, '.scale')
  const pack = lock ? resolveGovernanceTemplatePack(lock.pack) : null
  const scaleUpToDate = Boolean(lock && lock.scaleVersion === latestScaleVersion)
  const packUpToDate = Boolean(lock && pack && lock.packVersion === pack.version)
  const generatedTotal = drift.clean.length + drift.changed.length + drift.missing.length
  const thirdParty = createThirdPartyUpdateReport()
  const aiOsRuntime = createAiOsDoctor({ projectDir, scaleDir })
  const status = resolveUpgradeStatus({
    hasLock: Boolean(lock),
    hasLocalChanges: drift.changed.length > 0,
    hasMissingFiles: drift.missing.length > 0,
    scaleUpToDate,
    packUpToDate,
  })

  return {
    version: 1,
    projectDir,
    status,
    scaleEngine: {
      currentVersion: lock?.scaleVersion ?? null,
      latestVersion: latestScaleVersion,
      upToDate: scaleUpToDate,
    },
    governanceLock: {
      exists: Boolean(lock),
      path: join(projectDir, '.scale', 'governance.lock.json'),
    },
    governancePack: {
      id: lock?.pack ?? null,
      currentVersion: lock?.packVersion ?? null,
      latestVersion: pack?.version ?? null,
      upToDate: packUpToDate,
    },
    generatedFiles: {
      total: generatedTotal,
      clean: drift.clean.length,
      changed: drift.changed.length,
      missing: drift.missing.length,
    },
    drift,
    thirdParty,
    aiOsRuntime,
    recommendedCommands: [
      'scale upgrade plan --dir .',
      'scale ai-os adopt --dir . --task "Adopt AI OS runtime" --json',
      'scale ai-os doctor --dir . --json',
      'scale tools outdated --dir .',
      'scale skill outdated --dir .',
      'scale preflight --preflight-profile quick',
    ],
  }
}

export function createUpgradePlanReport(options: UpgradeManagerOptions = {}): UpgradePlanReport {
  const check = createUpgradeCheckReport(options)
  const blockers: UpgradePlanBlocker[] = []
  const steps: UpgradePlanStep[] = []

  // Add deprecation warnings for old versions
  const deprecations = getApplicableDeprecations(check.scaleEngine.currentVersion)
  for (const dep of deprecations) {
    steps.push({
      action: 'deprecation-warning',
      risk: dep.removedIn <= normalizeTargetVersion(options.targetScaleVersion) ? 'high' : 'medium',
      reason: `${dep.message} Deprecated since ${dep.deprecatedSince}, removed in ${dep.removedIn}. Replacement: ${dep.replacement}`,
    })
  }

  if (!check.governanceLock.exists) {
    blockers.push({
      code: 'missing-governance-lock',
      message: 'No governance lock exists; SCALE cannot determine which generated files are safe to upgrade.',
    })
    steps.push({
      action: 'initialize-governance-lock',
      risk: 'medium',
      reason: 'Create a lock before upgrading generated governance assets.',
      command: 'scale init --governance-pack standard',
    })
  }

  if (!check.scaleEngine.upToDate && check.scaleEngine.currentVersion) {
    steps.push({
      action: 'upgrade-scale-engine',
      risk: 'low',
      reason: `SCALE Engine changed from ${check.scaleEngine.currentVersion} to ${check.scaleEngine.latestVersion}.`,
      command: 'npm install -g @hongmaple0820/scale-engine',
    })
  }

  if (!check.governancePack.upToDate && check.governancePack.id) {
    steps.push({
      action: 'upgrade-governance-pack',
      risk: 'medium',
      reason: `Governance pack ${check.governancePack.id} changed from v${check.governancePack.currentVersion} to v${check.governancePack.latestVersion}.`,
      command: `scale upgrade apply --dir . --confirm`,
    })
    if (check.drift.clean.length > 0) {
      steps.push({
        action: 'refresh-managed-generated-files',
        risk: 'medium',
        reason: `${check.drift.clean.length} clean managed governance files can be refreshed automatically; local edits still block automatic apply.`,
        command: `scale upgrade apply --dir . --confirm`,
      })
    }
  }

  for (const entry of check.drift.missing) {
    steps.push({
      action: 'restore-missing-generated-file',
      path: entry.path,
      risk: 'low',
      reason: 'The file is tracked by the governance lock but is missing locally.',
    })
  }

  for (const entry of check.drift.changed) {
    blockers.push({
      code: 'local-generated-file-changed',
      path: entry.path,
      message: 'Generated governance file has local edits and needs a three-way/manual review before upgrade.',
    })
    steps.push({
      action: 'review-local-change',
      path: entry.path,
      risk: 'medium',
      reason: 'Local edits must be preserved or intentionally replaced.',
    })
  }

  if (check.thirdParty.entries.length > 0) {
    steps.push({
      action: 'setup-third-party-capabilities',
      risk: check.thirdParty.summary.highRisk > 0 ? 'medium' : 'low',
      reason: 'Default setup provisions governed third-party capabilities; execution remains evidence-required and destructive actions stay policy-bound.',
      command: 'scale setup --dir . --pack full --apply --yes --json',
    })
  }

  if (check.aiOsRuntime.status !== 'ready') {
    steps.push({
      action: 'adopt-ai-os-runtime',
      risk: check.aiOsRuntime.status === 'blocked' ? 'medium' : 'low',
      reason: 'Run the guided AI OS adoption path to create runtime directories, the first dry-run, benchmark, and doctor report.',
      command: 'scale ai-os adopt --dir . --task "Adopt AI OS runtime" --json',
    })
    if (check.aiOsRuntime.checks.some(check => check.id === 'ai-os-runtime-dirs' && check.status === 'blocked')) {
      steps.push({
        action: 'migrate-ai-os-runtime',
        risk: 'low',
        reason: 'AI OS runtime directories are missing; create them before adopting the beta runtime.',
        command: 'scale ai-os migrate --dir . --json',
      })
    }
    steps.push({
      action: 'check-ai-os-runtime',
      risk: check.aiOsRuntime.status === 'blocked' ? 'medium' : 'low',
      reason: 'AI OS runtime readiness should be checked before relying on AI OS beta orchestration.',
      command: 'scale ai-os doctor --dir . --json',
    })
  }

  steps.push({
    action: 'run-preflight',
    risk: 'low',
    reason: 'Validate the project after any accepted upgrade.',
    command: 'scale preflight --preflight-profile quick',
  })

  return {
    version: 1,
    projectDir: check.projectDir,
    status: check.status,
    applyMode: blockers.length === 0 ? 'safe' : 'manual-review',
    blockers,
    steps,
    check,
    recommendedCommands: [
      'scale upgrade check --dir .',
      'scale upgrade plan --dir . --html',
      'scale preflight --preflight-profile quick',
    ],
  }
}

const RISK_SCORES: Record<UpgradeRisk, number> = { low: 1, medium: 3, high: 5 }

export function createUpgradeRecommendReport(options: UpgradeManagerOptions = {}): UpgradeRecommendReport {
  const plan = createUpgradePlanReport(options)

  // Compute aggregate risk score
  let riskScore = 0
  for (const step of plan.steps) {
    riskScore += RISK_SCORES[step.risk] ?? 1
  }
  // Blockers add extra weight
  riskScore += plan.blockers.length * 5

  const riskLevel: UpgradeRisk = riskScore >= 10 ? 'high' : riskScore >= 4 ? 'medium' : 'low'
  const recommendation = plan.blockers.length > 0 ? 'blocked' : plan.applyMode === 'safe' ? 'safe-to-apply' : 'review-first'

  const summaryParts: string[] = []
  summaryParts.push(`${plan.steps.length} step(s), risk score ${riskScore}`)
  if (plan.blockers.length > 0) summaryParts.push(`${plan.blockers.length} blocker(s)`)
  if (plan.check.scaleEngine.upToDate) summaryParts.push('SCALE Engine up to date')
  if (plan.check.governancePack.upToDate) summaryParts.push('governance pack up to date')

  const autoCommands: string[] = []
  if (recommendation === 'safe-to-apply') {
    autoCommands.push('scale upgrade apply --dir . --confirm --auto-backup')
    autoCommands.push('scale preflight --preflight-profile quick')
  } else if (recommendation === 'review-first') {
    autoCommands.push('scale upgrade plan --dir . --html')
    autoCommands.push('# Review the HTML plan, then:')
    autoCommands.push('scale upgrade apply --dir . --confirm --auto-backup')
  } else {
    autoCommands.push('# Resolve blockers before applying:')
    for (const blocker of plan.blockers) {
      autoCommands.push(`#   [${blocker.code}] ${blocker.message}`)
    }
    autoCommands.push('scale upgrade plan --dir . --html')
  }

  return {
    version: 1,
    projectDir: plan.projectDir,
    riskScore,
    riskLevel,
    summary: summaryParts.join('; '),
    steps: plan.steps,
    blockers: plan.blockers,
    applyMode: plan.applyMode,
    recommendation,
    autoCommands,
    plan,
  }
}

export function createGitBackup(projectDir: string): { branch: string; ok: boolean; error?: string } {
  const { execSync } = require('child_process')
  const branch = `scale-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`
  try {
    // Check if we're in a git repo
    execSync('git rev-parse --is-inside-work-tree', { cwd: projectDir, stdio: 'pipe' })
    // Check for uncommitted changes
    const status = execSync('git status --porcelain', { cwd: projectDir, encoding: 'utf-8' }).trim()
    if (status) {
      // Stash uncommitted changes
      execSync('git stash push -m "scale-upgrade-auto-backup"', { cwd: projectDir, stdio: 'pipe' })
    }
    // Create backup branch from current HEAD
    execSync(`git branch "${branch}"`, { cwd: projectDir, stdio: 'pipe' })
    if (status) {
      // Restore stash
      execSync('git stash pop', { cwd: projectDir, stdio: 'pipe' })
    }
    return { branch, ok: true }
  } catch (err: any) {
    return { branch, ok: false, error: err.message ?? String(err) }
  }
}

export function applyUpgradePlan(options: UpgradeApplyOptions = {}): UpgradeApplyReport {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const plan = createUpgradePlanReport(options)
  if (!options.confirm) {
    return upgradeApplyResult(projectDir, plan, false, false, 'Review scale upgrade plan first, then rerun with --confirm.', [])
  }
  if (plan.applyMode !== 'safe') {
    return upgradeApplyResult(projectDir, plan, false, false, 'Upgrade requires manual review because generated files have local changes or the lock is missing.', [])
  }
  if (!plan.check.governanceLock.exists || !plan.check.governancePack.id) {
    return upgradeApplyResult(projectDir, plan, false, false, 'Cannot apply without a governance lock and pack id.', [])
  }
  const missingFiles = plan.check.drift.missing.map(entry => entry.path)
  const managedRefreshFiles = !plan.check.governancePack.upToDate
    ? plan.check.drift.clean.map(entry => entry.path)
    : []
  const shouldRefreshLock = !plan.check.scaleEngine.upToDate || !plan.check.governancePack.upToDate || missingFiles.length > 0
  if (!shouldRefreshLock) {
    return upgradeApplyResult(projectDir, plan, true, false, 'No safe upgrade changes were needed.', [])
  }

  // Git branch backup (if requested)
  let gitBackup: { branch: string; ok: boolean; error?: string } | undefined
  if (options.autoBackup) {
    gitBackup = createGitBackup(projectDir)
  }

  const backup = createUpgradeBackup(projectDir, uniqueStrings([...missingFiles, ...managedRefreshFiles, '.scale/governance.lock.json']))
  const result = writeGovernanceTemplates(projectDir, {
    pack: plan.check.governancePack.id,
    overwriteManaged: !plan.check.governancePack.upToDate,
  })
  const createdFiles = result.created
    .map(path => normalizeProjectRelativePath(projectDir, path))
    .filter((path): path is string => Boolean(path))
  const updatedFiles = result.updated
    .map(path => normalizeProjectRelativePath(projectDir, path))
    .filter((path): path is string => Boolean(path))
  mergeCreatedFilesIntoBackup(backup.manifestPath, createdFiles)

  const changedFiles = uniqueStrings([
    ...missingFiles.filter(path => existsSync(join(projectDir, path))),
    ...createdFiles,
    ...updatedFiles,
    '.scale/governance.lock.json',
  ])

  return {
    version: 1,
    projectDir,
    ok: true,
    applied: changedFiles.length > 0,
    reason: changedFiles.length > 0 ? 'Safe upgrade changes were applied.' : 'No safe upgrade changes were needed.',
    changedFiles,
    backup,
    gitBackup,
    plan: createUpgradePlanReport(options),
  }
}

export function rollbackLatestUpgrade(options: UpgradeManagerOptions = {}): UpgradeRollbackReport {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const backup = latestUpgradeBackup(projectDir)
  if (!backup) {
    return {
      version: 1,
      projectDir,
      ok: false,
      applied: false,
      reason: 'No SCALE-managed upgrade backup was found.',
      restoredFiles: [],
    }
  }

  const manifest = JSON.parse(readFileSync(backup.manifestPath, 'utf-8')) as UpgradeBackupManifest
  const restoredFiles: string[] = []
  for (const entry of manifest.files) {
    const target = join(projectDir, entry.path)
    if (entry.existed && entry.backupPath) {
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(join(backup.dir, entry.backupPath), target)
    } else {
      rmSync(target, { force: true, recursive: true })
    }
    restoredFiles.push(entry.path)
  }

  return {
    version: 1,
    projectDir,
    ok: true,
    applied: true,
    reason: 'Latest SCALE-managed upgrade backup was rolled back.',
    backup,
    restoredFiles: uniqueStrings(restoredFiles),
  }
}

export function createThirdPartyUpdateReport(category?: ToolCapabilityCategory | ToolCapabilityCategory[]): ThirdPartyUpdateReport {
  const selectedCategories = Array.isArray(category) ? new Set(category) : category ? new Set([category]) : undefined
  const entries = TOOL_CAPABILITY_CATALOG
    .filter(tool => !selectedCategories || selectedCategories.has(tool.category))
    .map(tool => {
      const trust = classifyThirdPartyTrust(tool.category, tool.source)
      const updatePolicy = 'default-install' as const
      return {
        id: tool.id,
        name: tool.name,
        category: tool.category,
        source: tool.source,
        trust,
        updatePolicy,
        installPolicy: 'default-install' as const,
        latestVersion: 'unknown' as const,
        reason: updateReason(tool.category, trust),
      }
    })
  const trusted = entries.filter(entry => entry.trust === 'trusted').length
  const community = entries.filter(entry => entry.trust === 'community').length
  const highRisk = entries.filter(entry => entry.trust === 'high-risk').length
  const blocked = 0
  const reviewRequired = 0
  return {
    version: 1,
    policy: 'default-install',
    summary: {
      total: entries.length,
      trusted,
      community,
      highRisk,
      reviewRequired,
      blocked,
    },
    reviewRequired,
    entries,
  }
}

function upgradeApplyResult(
  projectDir: string,
  plan: UpgradePlanReport,
  ok: boolean,
  applied: boolean,
  reason: string,
  changedFiles: string[],
): UpgradeApplyReport {
  return {
    version: 1,
    projectDir,
    ok,
    applied,
    reason,
    changedFiles,
    plan,
  }
}

function createUpgradeBackup(projectDir: string, relativePaths: string[]): { id: string; dir: string; manifestPath: string } {
  const id = `upgrade-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const dir = join(projectDir, '.scale', 'backups', id)
  const filesDir = join(dir, 'files')
  mkdirSync(filesDir, { recursive: true })
  const manifest: UpgradeBackupManifest = {
    version: 1,
    id,
    createdAt: new Date().toISOString(),
    projectDir,
    files: uniqueStrings(relativePaths).map(path => {
      const target = join(projectDir, path)
      if (!existsSync(target)) return { path, existed: false }
      const backupPath = join('files', path.replace(/^[\\/]+/, '').replace(/\\/g, '/'))
      const backupTarget = join(dir, backupPath)
      mkdirSync(dirname(backupTarget), { recursive: true })
      copyFileSync(target, backupTarget)
      return { path, existed: true, backupPath }
    }),
  }
  const manifestPath = join(dir, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8')
  return { id, dir, manifestPath }
}

function mergeCreatedFilesIntoBackup(manifestPath: string, createdFiles: string[]): void {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as UpgradeBackupManifest
  const existing = new Set(manifest.files.map(file => file.path))
  for (const path of createdFiles) {
    if (!existing.has(path)) {
      manifest.files.push({ path, existed: false })
      existing.add(path)
    }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8')
}

function latestUpgradeBackup(projectDir: string): { id: string; dir: string; manifestPath: string } | null {
  const backupsDir = join(projectDir, '.scale', 'backups')
  if (!existsSync(backupsDir)) return null
  const candidates = readdirSync(backupsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('upgrade-'))
    .map(entry => ({
      id: entry.name,
      dir: join(backupsDir, entry.name),
      manifestPath: join(backupsDir, entry.name, 'manifest.json'),
    }))
    .filter(entry => existsSync(entry.manifestPath))
    .sort((a, b) => a.id.localeCompare(b.id))
  return candidates.at(-1) ?? null
}

function normalizeProjectRelativePath(projectDir: string, path: string): string | null {
  const normalizedProject = resolve(projectDir).replace(/\\/g, '/')
  const normalizedPath = resolve(path).replace(/\\/g, '/')
  if (!normalizedPath.startsWith(`${normalizedProject}/`)) return null
  return normalizedPath.slice(normalizedProject.length + 1)
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)]
}

export type UpgradePlanHtmlLanguage = 'zh' | 'en'

export function writeUpgradePlanHtml(report: UpgradePlanReport, outputPath?: string, lang: UpgradePlanHtmlLanguage = 'zh'): string {
  const target = outputPath ?? join(report.projectDir, '.scale', 'reports', 'upgrade-plan.html')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, renderUpgradePlanHtml(report, lang), 'utf-8')
  return target
}

export function listAvailableGovernancePackVersions(): Array<{ id: GovernancePackId; version: number }> {
  return listGovernanceTemplatePacks().map(pack => ({ id: pack.id, version: pack.version }))
}

function resolveUpgradeStatus(input: {
  hasLock: boolean
  hasLocalChanges: boolean
  hasMissingFiles: boolean
  scaleUpToDate: boolean
  packUpToDate: boolean
}): UpgradeStatus {
  if (!input.hasLock) return 'missing-lock'
  if (input.hasLocalChanges) return 'local-changes'
  if (input.hasMissingFiles || !input.scaleUpToDate || !input.packUpToDate) return 'updates-available'
  return 'clean'
}

function normalizeTargetVersion(version: string | undefined): string {
  if (!version || version === 'latest') return SCALE_ENGINE_VERSION
  return version
}

function classifyThirdPartyTrust(category: ToolCapabilityCategory, source: string | undefined): ThirdPartyTrust {
  if (category === 'desktop') return 'high-risk'
  if (!source) return 'community'
  if (
    source.includes('anthropics/') ||
    source.includes('playwright.dev') ||
    source.includes('openai/') ||
    source.includes('google-gemini/') ||
    source.includes('vercel-labs/')
  ) return 'trusted'
  return 'community'
}

function updateReason(category: ToolCapabilityCategory, trust: ThirdPartyTrust): string {
  if (trust === 'high-risk') return 'Default setup provisions high-privilege desktop automation; execution remains evidence-required and destructive actions stay policy-bound.'
  if (trust === 'community') return 'Default setup provisions this community capability and records tool-doctor evidence before use.'
  if (category === 'mcp') return 'Default setup provisions MCP capability when package manager and runtime prerequisites are available.'
  return 'Default setup provisions this trusted capability and keeps version evidence visible.'
}

function renderUpgradePlanHtml(report: UpgradePlanReport, lang: UpgradePlanHtmlLanguage): string {
  const zh = lang === 'zh'
  const labels = zh
    ? {
        title: 'SCALE 工作流升级计划',
        project: '项目',
        status: '状态',
        applyMode: '应用模式',
        blockers: '阻塞项',
        noBlockers: '未发现阻塞项。',
        steps: '步骤',
        action: '动作',
        path: '路径',
        risk: '风险',
        reason: '原因',
        command: '命令',
        thirdPartyPolicy: '第三方能力策略',
        policy: '策略',
        reviewRequired: '需要人工审查',
      }
    : {
        title: 'SCALE Upgrade Plan',
        project: 'Project',
        status: 'Status',
        applyMode: 'Apply mode',
        blockers: 'Blockers',
        noBlockers: 'No blockers detected.',
        steps: 'Steps',
        action: 'Action',
        path: 'Path',
        risk: 'Risk',
        reason: 'Reason',
        command: 'Command',
        thirdPartyPolicy: 'Third-party Policy',
        policy: 'Policy',
        reviewRequired: 'Review required',
      }
  const rows = report.steps.map(step => `
      <tr>
        <td>${escapeHtml(step.action)}</td>
        <td>${escapeHtml(step.path ?? '')}</td>
        <td>${escapeHtml(step.risk)}</td>
        <td>${escapeHtml(localizedUpgradeStepReason(step, lang))}</td>
        <td><code>${escapeHtml(step.command ?? '')}</code></td>
      </tr>`).join('')
  const blockers = report.blockers.length
    ? report.blockers.map(blocker => `<li><strong>${escapeHtml(blocker.code)}</strong> ${escapeHtml(blocker.path ?? '')} ${escapeHtml(localizedUpgradeBlockerMessage(blocker, lang))}</li>`).join('')
    : `<li>${labels.noBlockers}</li>`
  return `<!doctype html>
<html lang="${zh ? 'zh-CN' : 'en'}">
<head>
  <meta charset="utf-8" />
  <title>${labels.title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #1f2937; }
    h1 { margin-bottom: 8px; }
    table { border-collapse: collapse; width: 100%; margin-top: 16px; }
    th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; }
    code { white-space: pre-wrap; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #eef2ff; }
  </style>
</head>
<body>
  <h1>${labels.title}</h1>
  <p>${labels.project}: <code>${escapeHtml(report.projectDir)}</code></p>
  <p>${labels.status}: <span class="badge">${escapeHtml(report.status)}</span> ${labels.applyMode}: <span class="badge">${escapeHtml(report.applyMode)}</span></p>
  <h2>${labels.blockers}</h2>
  <ul>${blockers}</ul>
  <h2>${labels.steps}</h2>
  <table>
    <thead><tr><th>${labels.action}</th><th>${labels.path}</th><th>${labels.risk}</th><th>${labels.reason}</th><th>${labels.command}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <h2>${labels.thirdPartyPolicy}</h2>
  <p>${labels.policy}: ${escapeHtml(report.check.thirdParty.policy)}. ${labels.reviewRequired}: ${report.check.thirdParty.reviewRequired}.</p>
</body>
</html>
`
}

function localizedUpgradeBlockerMessage(blocker: UpgradePlanBlocker, lang: UpgradePlanHtmlLanguage): string {
  if (lang !== 'zh') return blocker.message
  switch (blocker.code) {
    case 'missing-governance-lock':
      return '缺少治理锁文件，无法判断哪些生成文件可以安全升级。'
    case 'local-generated-file-changed':
      return '受管生成文件已有本地改动，需要三方对比或人工审阅后再升级。'
  }
}

function localizedUpgradeStepReason(step: UpgradePlanStep, lang: UpgradePlanHtmlLanguage): string {
  if (lang !== 'zh') return step.reason
  switch (step.action) {
    case 'initialize-governance-lock':
      return '先创建治理锁文件，后续才能安全升级生成的治理资产。'
    case 'upgrade-scale-engine':
      return step.reason.replace('SCALE Engine changed from', 'SCALE Engine 版本变化：').replace(' to ', ' -> ')
    case 'upgrade-governance-pack':
      return step.reason.replace('Governance pack', '治理包').replace('changed from', '版本变化：').replace(' to ', ' -> ')
    case 'refresh-managed-generated-files':
      return step.reason.replace('clean managed governance files can be refreshed automatically; local edits still block automatic apply.', '个干净受管治理文件可自动刷新；已有本地改动的文件仍会阻止自动应用。')
    case 'restore-missing-generated-file':
      return '该文件由治理锁管理，但当前本地缺失，可从当前治理包恢复。'
    case 'review-local-change':
      return '需要保留、合并或明确替换本地改动，不能自动覆盖。'
    case 'setup-third-party-capabilities':
      return step.reason.replace('Default setup provisions governed third-party capabilities; execution remains evidence-required and destructive actions stay policy-bound.', '默认安装受管第三方能力；执行仍需证据并受破坏性动作策略约束。')
    case 'adopt-ai-os-runtime':
      return '运行 AI OS 一键接入路径，生成运行态目录、首份 dry-run、benchmark 和 doctor 报告。'
    case 'migrate-ai-os-runtime':
      return 'Create missing AI OS runtime directories before adopting the beta runtime.'
    case 'check-ai-os-runtime':
      return 'Check AI OS runtime readiness before relying on beta orchestration.'
    case 'run-preflight':
      return '完成已接受的升级后，运行项目级预检。'
  }
  return step.reason
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function getApplicableDeprecations(currentVersion: string | null): DeprecationWarning[] {
  if (!currentVersion) return DEPRECATION_REGISTRY
  return DEPRECATION_REGISTRY.filter(dep => compareVersions(currentVersion, dep.deprecatedSince) < 0)
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na !== nb) return na - nb
  }
  return 0
}
