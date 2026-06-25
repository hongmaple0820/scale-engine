import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeGovernanceTemplates } from '../../src/workflow/GovernanceTemplates.js'
import {
  applyUpgradePlan,
  createUpgradeCheckReport,
  createUpgradePlanReport,
  rollbackLatestUpgrade,
} from '../../src/workflow/UpgradeManager.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-upgrade-'))
  dirs.push(dir)
  return dir
}

function setLockedPackVersion(projectDir: string, packVersion: number): void {
  const lockPath = join(projectDir, '.scale', 'governance.lock.json')
  const lock = JSON.parse(readFileSync(lockPath, 'utf-8')) as { packVersion: number }
  lock.packVersion = packVersion
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf-8')
}

describe('UpgradeManager', () => {
  it('reports a clean project as safe with default-installed third-party capabilities', () => {
    const projectDir = makeDir()
    writeGovernanceTemplates(projectDir, { mode: 'standard', pack: 'project-scaffold' })

    const report = createUpgradeCheckReport({ projectDir })

    expect(report.status).toBe('clean')
    expect(report.governanceLock.exists).toBe(true)
    expect(report.governancePack).toMatchObject({
      id: 'project-scaffold',
      currentVersion: 2,
      latestVersion: 2,
      upToDate: true,
    })
    expect(report.generatedFiles.changed).toBe(0)
    expect(report.generatedFiles.missing).toBe(0)
    expect(report.thirdParty.policy).toBe('default-install')
    expect(report.thirdParty.reviewRequired).toBe(0)
    expect(report.thirdParty.summary.blocked).toBe(0)
    expect(report.recommendedCommands).toContain('scale upgrade plan --dir .')
  })

  it('blocks safe apply when generated files have local changes', () => {
    const projectDir = makeDir()
    writeGovernanceTemplates(projectDir, { mode: 'standard', pack: 'project-scaffold' })
    writeFileSync(join(projectDir, 'docs', 'workflow', 'README.md'), '# Local workflow rules\n', 'utf-8')

    const plan = createUpgradePlanReport({ projectDir })

    expect(plan.applyMode).toBe('manual-review')
    expect(plan.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'local-generated-file-changed',
        path: 'docs/workflow/README.md',
      }),
    ]))
    expect(plan.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'review-local-change',
        path: 'docs/workflow/README.md',
      }),
    ]))
  })

  it('plans to recreate missing generated files without overwriting local changes', () => {
    const projectDir = makeDir()
    writeGovernanceTemplates(projectDir, { mode: 'standard', pack: 'project-scaffold' })
    rmSync(join(projectDir, 'docs', 'workflow', 'templates', 'summary.md'))

    const plan = createUpgradePlanReport({ projectDir })

    expect(plan.applyMode).toBe('safe')
    expect(plan.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'restore-missing-generated-file',
        path: 'docs/workflow/templates/summary.md',
      }),
    ]))
    expect(readFileSync(join(projectDir, '.scale', 'governance.lock.json'), 'utf-8')).toContain('"project-scaffold"')
  })

  it('safe-applies missing generated files and writes a rollback point', () => {
    const projectDir = makeDir()
    const missingPath = join(projectDir, 'docs', 'workflow', 'templates', 'summary.md')
    writeGovernanceTemplates(projectDir, { mode: 'standard', pack: 'project-scaffold' })
    rmSync(missingPath)

    const report = applyUpgradePlan({ projectDir, confirm: true })

    expect(report.ok).toBe(true)
    expect(report.applied).toBe(true)
    expect(existsSync(missingPath)).toBe(true)
    expect(report.changedFiles).toContain('docs/workflow/templates/summary.md')
    expect(report.changedFiles).toContain('.scale/governance.lock.json')
    expect(report.backup?.manifestPath).toBeTruthy()
    expect(existsSync(report.backup!.manifestPath)).toBe(true)
  })

  it('safe-applies clean managed generated files when the governance pack version changes', () => {
    const projectDir = makeDir()
    writeGovernanceTemplates(projectDir, { mode: 'standard', pack: 'project-scaffold' })
    setLockedPackVersion(projectDir, 1)

    const plan = createUpgradePlanReport({ projectDir })
    expect(plan.applyMode).toBe('safe')
    expect(plan.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'upgrade-governance-pack' }),
      expect.objectContaining({ action: 'refresh-managed-generated-files' }),
    ]))

    const report = applyUpgradePlan({ projectDir, confirm: true })

    expect(report.ok).toBe(true)
    expect(report.applied).toBe(true)
    expect(report.changedFiles).toContain('docs/workflow/README.md')
    expect(report.changedFiles).toContain('.scale/governance.lock.json')
    const lock = JSON.parse(readFileSync(join(projectDir, '.scale', 'governance.lock.json'), 'utf-8')) as { packVersion: number }
    expect(lock.packVersion).toBe(2)
  })

  it('refuses safe apply when generated files have local changes', () => {
    const projectDir = makeDir()
    writeGovernanceTemplates(projectDir, { mode: 'standard', pack: 'project-scaffold' })
    writeFileSync(join(projectDir, 'docs', 'workflow', 'README.md'), '# Local workflow rules\n', 'utf-8')

    const report = applyUpgradePlan({ projectDir, confirm: true })

    expect(report.ok).toBe(false)
    expect(report.applied).toBe(false)
    expect(report.reason).toContain('manual review')
  })

  it('rolls back the latest safe apply by restoring previous file state', () => {
    const projectDir = makeDir()
    const missingPath = join(projectDir, 'docs', 'workflow', 'templates', 'summary.md')
    writeGovernanceTemplates(projectDir, { mode: 'standard', pack: 'project-scaffold' })
    rmSync(missingPath)
    const applied = applyUpgradePlan({ projectDir, confirm: true })
    expect(applied.ok).toBe(true)
    expect(existsSync(missingPath)).toBe(true)

    const rollback = rollbackLatestUpgrade({ projectDir })

    expect(rollback.ok).toBe(true)
    expect(rollback.restoredFiles).toContain('docs/workflow/templates/summary.md')
    expect(existsSync(missingPath)).toBe(false)
  })
})
