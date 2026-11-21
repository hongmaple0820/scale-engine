import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(overrides: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'scale-beta-evidence-'))
  roots.push(root)
  const required = [
    'install', 'upgrade-migration', 'ai-os-plan', 'governed-run',
    'dashboard-health', 'benchmark-eval', 'smoke-preflight', 'package-build',
  ]
  const record = {
    schemaVersion: 1,
    qualificationId: 'node-ts-library',
    runId: 'test-run-001',
    status: 'passed',
    source: {
      scaleEngineVersion: '0.58.0',
      scaleEngineCommit: 'a'.repeat(40),
      fixtureRepository: 'https://example.invalid/fixture.git',
      fixtureCommit: 'b'.repeat(40),
    },
    environment: { os: 'ubuntu-24.04', architecture: 'x64', node: '22.12.0', npm: '10.9.0', python: '3.12.0' },
    stages: required.map(id => ({
      id, command: 'scale --help', exitCode: 0,
      startedAt: '2026-11-17T10:00:00.000Z', finishedAt: '2026-11-17T10:00:01.000Z',
      stdoutArtifact: 'logs/stdout.txt', stderrArtifact: null,
      reportArtifacts: [], status: 'passed', notes: [],
    })),
    residualRisks: [],
    review: { reviewer: 'reviewer', reviewedAt: '2026-11-17T11:00:00.000Z', decision: 'approved' },
    ...overrides,
  }
  const file = join(root, 'record.json')
  writeFileSync(file, JSON.stringify(record))
  return file
}

function run(file: string, args: string[] = []) {
  return spawnSync(process.execPath, [
    resolve(process.cwd(), 'scripts/qa/validate-beta-qualification.mjs'),
    file,
    ...args,
  ], { encoding: 'utf8' })
}

describe('beta qualification evidence validator', () => {
  it('accepts a complete, reviewed record', () => {
    const result = run(fixture(), ['--require-passed'])
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).ok).toBe(true)
  })

  it('rejects an overall passed record missing required stages', () => {
    const file = fixture({
      stages: [{ id: 'install', command: 'scale install --dir .', exitCode: 0,
        startedAt: '2026-11-17T10:00:00Z', finishedAt: '2026-11-17T10:00:01Z',
        reportArtifacts: [], status: 'passed', notes: [] }],
    })
    const result = run(file)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('missing required stage')
  })

  it('rejects a passed record with unreviewed evidence', () => {
    const file = fixture({ review: { reviewer: 'reviewer', reviewedAt: '2026-11-17T11:00:00Z', decision: 'pending' } })
    const result = run(file)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must be approved')
  })

  it('rejects short or missing source SHAs', () => {
    const file = fixture({
      source: {
        scaleEngineVersion: '0.58.0',
        scaleEngineCommit: 'abc',
        fixtureRepository: 'https://example.invalid/fixture.git',
        fixtureCommit: 'b'.repeat(40),
      },
    })
    const result = run(file)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('full 40-character Git SHA')
  })

  it('rejects missing stdout and invalid stderr artifact paths', () => {
    const file = fixture({
      stages: fixtureRecordStages().map((stage, index) => index === 0
        ? { ...stage, stdoutArtifact: '', stderrArtifact: 42 }
        : { ...stage, stdoutArtifact: 'logs/stdout.txt', stderrArtifact: null }),
    })
    const result = run(file)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('stdoutArtifact')
    expect(result.stderr).toContain('stderrArtifact')
  })

  it('rejects absolute stderr artifact paths', () => {
    const file = fixture({
      stages: fixtureRecordStages().map((stage, index) => index === 0
        ? { ...stage, stderrArtifact: 'C:\\\\Users\\\\runner\\\\stderr.txt' }
        : stage),
    })
    const result = run(file)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('stderrArtifact')
    expect(result.stderr).toContain('relative artifact path')
  })

  it('rejects absolute and parent-traversal artifact paths', () => {
    const file = fixture({
      stages: fixtureRecordStages().map((stage, index) => index === 0
        ? { ...stage, stdoutArtifact: '../private/output.txt', stderrArtifact: 'C:\\\\Users\\\\runner\\\\stderr.txt' }
        : { ...stage, stdoutArtifact: 'logs/stdout.txt', stderrArtifact: null }),
    })
    const result = run(file)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('relative artifact path')
  })

  it('rejects Windows drive-relative artifact paths', () => {
    const file = fixture({
      stages: fixtureRecordStages().map((stage, index) => index === 0
        ? { ...stage, stdoutArtifact: 'C:logs\\\\stdout.txt' }
        : stage),
    })
    const result = run(file)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('stdoutArtifact')
    expect(result.stderr).toContain('relative artifact path')
  })

  it('rejects dot segments and repeated separators in artifact paths', () => {
    const file = fixture({
      stages: fixtureRecordStages().map((stage, index) => index === 0
        ? { ...stage, stdoutArtifact: 'logs/./stdout.txt', reportArtifacts: ['logs//report.json'] }
        : stage),
    })
    const result = run(file)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('stdoutArtifact')
    expect(result.stderr).toContain('reportArtifacts')
  })

  it('rejects timestamps where a stage finishes before it starts', () => {
    const file = fixture({
      stages: fixtureRecordStages().map((stage, index) => index === 0
        ? { ...stage, startedAt: '2026-11-17T10:00:02Z', finishedAt: '2026-11-17T10:00:01Z' }
        : stage),
    })
    const result = run(file)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must not be earlier than startedAt')
  })

  it('rejects exit-code/status contradictions', () => {
    const stages = fixtureRecordStages()
    stages[0].status = 'passed'
    stages[0].exitCode = 1
    const file = fixture({ stages })
    const result = run(file)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must be 0 for a passed stage')
  })
  it('rejects impossible calendar timestamps', () => {
    const file = fixture({
      stages: fixtureRecordStages().map((stage, index) => index === 0
        ? { ...stage, startedAt: '2026-02-31T10:00:00Z' }
        : stage),
    })
    const result = run(file)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('startedAt')
    expect(result.stderr).toContain('valid ISO-8601 timestamp with timezone')
  })

  it('requires review to follow the recorded qualification stages', () => {
    const file = fixture({
      review: { reviewer: 'reviewer', reviewedAt: '2026-11-17T09:59:59Z', decision: 'approved' },
    })
    const result = run(file)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must not be earlier than the latest stage finishedAt')
  })

  it('rejects malformed residual risk entries', () => {
    const file = fixture({ residualRisks: ['documented risk', 42] })
    const result = run(file)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('residualRisks')
  })

  it('rejects extra positional arguments', () => {
    const file = fixture()
    const result = spawnSync(process.execPath, [
      resolve(process.cwd(), 'scripts/qa/validate-beta-qualification.mjs'),
      file, 'unexpected.json',
    ], { encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Usage:')
  })

})

function fixtureRecordStages() {
  const required = [
    'install', 'upgrade-migration', 'ai-os-plan', 'governed-run',
    'dashboard-health', 'benchmark-eval', 'smoke-preflight', 'package-build',
  ]
  return required.map(id => ({
    id, command: 'scale --help', exitCode: 0,
    startedAt: '2026-11-17T10:00:00.000Z', finishedAt: '2026-11-17T10:00:01.000Z',
    stdoutArtifact: 'logs/stdout.txt', stderrArtifact: null,
    reportArtifacts: [], status: 'passed', notes: [],
  }))
}
