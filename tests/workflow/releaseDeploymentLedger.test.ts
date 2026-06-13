import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { ReleaseDeploymentLedger } from '../../src/workflow/ReleaseDeploymentLedger.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

describe('ReleaseDeploymentLedger', () => {
  it('records deployment events and summarizes DORA-style metrics', () => {
    const ledger = makeLedger()

    ledger.record({
      service: 'scale-engine',
      environment: 'production',
      status: 'succeeded',
      version: 'v0.49.0',
      commitSha: 'abc123',
      commitTimestamp: '2026-06-11T12:00:00.000Z',
      startedAt: '2026-06-12T11:30:00.000Z',
      completedAt: '2026-06-12T12:00:00.000Z',
      source: 'release',
    })
    ledger.record({
      service: 'scale-engine',
      environment: 'production',
      status: 'failed',
      startedAt: '2026-06-12T18:00:00.000Z',
      completedAt: '2026-06-12T18:10:00.000Z',
      failedAt: '2026-06-12T18:10:00.000Z',
      restoredAt: '2026-06-12T20:10:00.000Z',
      source: 'ci',
    })

    const records = ledger.list({ now: new Date('2026-06-13T00:00:00.000Z'), lookbackDays: 30 })
    const metrics = ledger.summarize({ now: new Date('2026-06-13T00:00:00.000Z'), lookbackDays: 30 })

    expect(records).toHaveLength(2)
    expect(records[0].status).toBe('failed')
    expect(metrics.hasEvidence).toBe(true)
    expect(metrics.totalRecords).toBe(2)
    expect(metrics.deploymentCount).toBe(1)
    expect(metrics.deploymentFrequencyPerDay).toBe(0.033)
    expect(metrics.leadTimeHours).toBe(24)
    expect(metrics.changeFailureRate).toBe(0.5)
    expect(metrics.restoreTimeHours).toBe(2)
    expect(metrics.restoredFailureCount).toBe(1)
    expect(metrics.unrestoredFailureCount).toBe(0)
  })

  it('rejects invalid deployment timelines before writing evidence', () => {
    const ledger = makeLedger()

    expect(() => ledger.record({
      startedAt: '2026-06-12T12:00:00.000Z',
      completedAt: '2026-06-12T11:00:00.000Z',
    })).toThrow('Deployment startedAt must be before or equal to completedAt')
    expect(ledger.list()).toHaveLength(0)
  })

  it('records deployment evidence from a local Git tag', async () => {
    const projectDir = makeDir('scale-deploy-git-tag-')
    await execa('git', ['init'], { cwd: projectDir })
    await execa('git', ['config', 'user.email', 'scale@example.test'], { cwd: projectDir })
    await execa('git', ['config', 'user.name', 'SCALE Test'], { cwd: projectDir })
    writeFileSync(join(projectDir, 'release.txt'), 'release\n', 'utf-8')
    await execa('git', ['add', 'release.txt'], { cwd: projectDir })
    await execa('git', ['commit', '-m', 'release v1.2.3'], {
      cwd: projectDir,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: '2026-06-12T10:00:00.000Z',
        GIT_COMMITTER_DATE: '2026-06-12T10:00:00.000Z',
      },
    })
    await execa('git', ['tag', 'v1.2.3'], { cwd: projectDir })
    const head = (await execa('git', ['rev-parse', 'HEAD'], { cwd: projectDir })).stdout.trim()

    const result = await runScale([
      'workflow',
      'deploy',
      'record',
      '--dir',
      projectDir,
      '--git-tag',
      'v1.2.3',
      '--json',
    ], projectDir)

    expect(result.exitCode).toBe(0)
    const report = JSON.parse(result.stdout) as {
      ok: boolean
      record: {
        version?: string
        commitSha?: string
        commitTimestamp?: string
        completedAt: string
        source: string
        evidencePaths: string[]
        notes?: string
      }
    }
    expect(report.ok).toBe(true)
    expect(report.record).toMatchObject({
      version: 'v1.2.3',
      commitSha: head,
      commitTimestamp: '2026-06-12T10:00:00.000Z',
      completedAt: '2026-06-12T10:00:00.000Z',
      source: 'release',
      evidencePaths: ['git:tag:v1.2.3'],
      notes: 'gitTag=v1.2.3',
    })

    const metrics = new ReleaseDeploymentLedger(join(projectDir, '.scale')).summarize({
      now: new Date('2026-06-13T00:00:00.000Z'),
      lookbackDays: 30,
    })
    expect(metrics.deploymentCount).toBe(1)
    expect(metrics.leadTimeHours).toBe(0)
  }, 120_000)
})

function makeLedger(): ReleaseDeploymentLedger {
  const dir = makeDir('scale-deploy-ledger-')
  return new ReleaseDeploymentLedger(join(dir, '.scale'))
}

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

async function runScale(args: string[], projectDir: string) {
  return execa('node', ['--import', 'tsx', 'src/api/cli.ts', ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SCALE_DIR: '.scale',
      SCALE_PROJECT_DIR: projectDir,
      SCALE_LOG_LEVEL: undefined,
    },
    reject: false,
    timeout: 30000,
  })
}
