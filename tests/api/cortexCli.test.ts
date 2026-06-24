import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'
import { InstinctStore } from '../../src/cortex/InstinctStore.js'

const dirs: string[] = []
const CLI_ENTRY = join(process.cwd(), 'src/api/cli.ts')
const TSX_LOADER = pathToFileURL(join(process.cwd(), 'node_modules/tsx/dist/loader.mjs')).href
const CLI_TEST_TIMEOUT_MS = 30_000

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

function makeProject(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function writeGateEvidence(scaleDir: string, options: {
  id: string
  gate?: string
  createdAt: number
  passed?: boolean
  blocker?: string
  path?: string
}): void {
  const evidenceDir = join(scaleDir, 'evidence')
  mkdirSync(evidenceDir, { recursive: true })

  const gate = options.gate ?? 'G7'
  const passed = options.passed ?? false
  const blocker = options.blocker ?? 'CRITICAL secret.assignment in src/index.ts:1'
  const path = options.path ?? 'src/index.ts'
  const record = {
    id: options.id,
    gate,
    status: passed ? 'PASSED' : 'FAILED',
    passed,
    evidence: passed ? `${gate} passed` : blocker,
    evidenceItems: [{
      id: `${options.id}-item`,
      kind: 'scan',
      label: passed ? `${gate} scan` : 'Security finding secret.assignment',
      passed,
      path,
      detail: passed ? 'No blockers found' : blocker,
      rawEstimatedTokens: 10,
    }],
    blockers: passed ? [] : [blocker],
    durationMs: 10,
    createdAt: options.createdAt,
  }

  writeFileSync(join(evidenceDir, `${options.id}.json`), JSON.stringify(record, null, 2))
}

async function runScale(args: string[], env: Record<string, string> = {}) {
  return execa('node', ['--import', TSX_LOADER, CLI_ENTRY, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SCALE_LOG_LEVEL: undefined,
      ...env,
    },
    reject: false,
    timeout: 30000,
  })
}

function countInstinctFiles(root: string): number {
  if (!existsSync(root)) return 0
  let count = 0
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      count += countInstinctFiles(path)
    } else if (entry.name.endsWith('.yaml')) {
      count++
    }
  }
  return count
}

function parseLastJson<T>(stdout: string): T {
  const index = stdout.lastIndexOf('\n{')
  const json = index >= 0 ? stdout.slice(index + 1) : stdout
  return JSON.parse(json) as T
}

describe('cortex CLI', () => {
  it('previews accepted candidates with --dry-run without writing instincts', async () => {
    const projectDir = makeProject('scale-cortex-cli-dry-run-')
    const scaleDir = join(projectDir, '.scale')
    const base = Date.UTC(2026, 5, 12, 10, 0)
    for (let i = 0; i < 5; i++) {
      writeGateEvidence(scaleDir, {
        id: `GATE-G7-${base + i}-fail`,
        createdAt: base + i,
      })
    }

    const result = await runScale([
      'cortex',
      'extract',
      '--dir',
      projectDir,
      '--min-confidence',
      '0.7',
      '--dry-run',
      '--json',
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Candidate review: accepted=1, stale=0, needs-review=0')
    expect(result.stdout).toContain('Dry run: no instincts saved')
    expect(countInstinctFiles(join(scaleDir, 'instincts'))).toBe(0)
  }, CLI_TEST_TIMEOUT_MS)

  it('does not save stale candidates when later passing gate evidence exists', async () => {
    const projectDir = makeProject('scale-cortex-cli-stale-')
    const scaleDir = join(projectDir, '.scale')
    const base = Date.UTC(2026, 5, 12, 10, 0)
    for (let i = 0; i < 5; i++) {
      writeGateEvidence(scaleDir, {
        id: `GATE-G7-${base + i}-fail`,
        createdAt: base + i,
      })
    }
    writeGateEvidence(scaleDir, {
      id: `GATE-G7-${base + 10_000}-pass`,
      createdAt: base + 10_000,
      passed: true,
      path: 'src',
    })

    const result = await runScale([
      'cortex',
      'extract',
      '--dir',
      projectDir,
      '--min-confidence',
      '0.7',
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Candidate review: accepted=0, stale=1, needs-review=0')
    expect(result.stdout).toContain('Filtered out: 1 stale/review-only candidate(s)')
    expect(result.stdout).toContain('Saved: 0 instincts')
    expect(countInstinctFiles(join(scaleDir, 'instincts'))).toBe(0)
  }, CLI_TEST_TIMEOUT_MS)

  it('treats stale-filtered candidates as reviewed in cortex verify', async () => {
    const projectDir = makeProject('scale-cortex-cli-verify-stale-')
    const scaleDir = join(projectDir, '.scale')
    const base = Date.UTC(2026, 5, 12, 10, 0)
    for (let i = 0; i < 5; i++) {
      writeGateEvidence(scaleDir, {
        id: `GATE-G7-${base + i}-fail`,
        createdAt: base + i,
      })
    }
    writeGateEvidence(scaleDir, {
      id: `GATE-G7-${base + 10_000}-pass`,
      createdAt: base + 10_000,
      passed: true,
      path: 'src',
    })
    new InstinctStore(join(scaleDir, 'instincts')).save({
      id: 'instinct-verify-stale',
      trigger: 'verify stale candidate handling',
      confidence: 0.9,
      domain: 'governance',
      source: 'test',
      scope: 'global',
      action: '## Action\nKeep stale candidates filtered during Cortex verification',
      evidence: ['[2026-06-13] verify stale candidate handling'],
      observations: 5,
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
      appliedCount: 0,
      hitRate: 0,
    })

    const result = await runScale(['cortex', 'verify', '--dir', projectDir, '--json'], {
      SCALE_LOCAL_MODEL: '',
    })
    const report = JSON.parse(result.stdout) as {
      overall: string
      checks: Array<{ name: string; status: string; detail: string }>
    }
    const candidateReview = report.checks.find(check => check.name === 'Candidate review')
    const reflexion = report.checks.find(check => check.name === 'Reflexion engine')

    expect(result.exitCode).toBe(0)
    expect(report.overall).toBe('PASS')
    expect(candidateReview).toMatchObject({
      status: 'PASS',
      detail: 'accepted=0, stale-filtered=1, needs-review=0',
    })
    expect(reflexion).toMatchObject({
      status: 'PASS',
      detail: 'SCALE_LOCAL_MODEL not set — deterministic heuristic fallback available',
    })
  }, CLI_TEST_TIMEOUT_MS)

  it('fails cortex verify when local reflexion model is required but unavailable', async () => {
    const projectDir = makeProject('scale-cortex-cli-verify-require-model-')
    const result = await runScale(['cortex', 'verify', '--dir', projectDir, '--require-local-model', '--json'], {
      SCALE_LOCAL_MODEL: '',
    })
    const report = JSON.parse(result.stdout) as {
      overall: string
      checks: Array<{ name: string; status: string; detail: string }>
    }
    const reflexion = report.checks.find(check => check.name === 'Reflexion engine')

    expect(result.exitCode).toBe(1)
    expect(report.overall).toBe('FAIL')
    expect(reflexion).toMatchObject({
      status: 'FAIL',
      detail: 'SCALE_LOCAL_MODEL not set and --require-local-model was requested',
    })
  }, CLI_TEST_TIMEOUT_MS)

  it('approves an accepted candidate into the injection store', async () => {
    const projectDir = makeProject('scale-cortex-cli-approve-')
    const scaleDir = join(projectDir, '.scale')
    const base = Date.UTC(2026, 5, 12, 10, 0)
    for (let i = 0; i < 5; i++) {
      writeGateEvidence(scaleDir, {
        id: `GATE-G5-${base + i}-fail`,
        gate: 'G5',
        createdAt: base + i,
        blocker: 'Tests failed: approval candidate',
        path: 'src/foo.ts',
      })
    }

    const extract = await runScale([
      'cortex',
      'extract',
      '--dir',
      projectDir,
      '--min-confidence',
      '0.7',
      '--dry-run',
      '--json',
    ])
    const report = parseLastJson<{ instincts: Array<{ id: string }> }>(extract.stdout)
    const candidateId = report.instincts[0].id

    const approve = await runScale(['cortex', 'approve', candidateId, '--dir', projectDir, '--json'])
    const approveReport = JSON.parse(approve.stdout) as { approved: boolean; candidateId: string; savedId: string }

    expect(approve.exitCode).toBe(0)
    expect(approveReport).toMatchObject({ approved: true, candidateId })
    expect(approveReport.savedId).toMatch(/^instinct-/)
    expect(countInstinctFiles(join(scaleDir, 'instincts'))).toBe(1)

    const inject = await runScale(['cortex', 'inject', '--dir', projectDir, '--json'])
    const injection = JSON.parse(inject.stdout) as { instinctCount: number; metadata: { instinctsApplied: string[] } }
    expect(injection.instinctCount).toBe(1)
    expect(injection.metadata.instinctsApplied).toEqual([approveReport.savedId])

    const audit = await runScale(['cortex', 'audit', '--dir', projectDir, '--json'])
    const auditReport = JSON.parse(audit.stdout) as { entries: Array<{ op: string; id: string }> }
    expect(auditReport.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: 'save', id: approveReport.savedId }),
    ]))
  }, CLI_TEST_TIMEOUT_MS)

  it('records applied instinct outcomes and exposes measured workflow effectiveness', async () => {
    const projectDir = makeProject('scale-cortex-cli-apply-')
    const scaleDir = join(projectDir, '.scale')
    const savedId = new InstinctStore(join(scaleDir, 'instincts')).save({
      id: 'instinct-cli-apply',
      trigger: 'cortex apply cli',
      confidence: 0.9,
      domain: 'governance',
      source: 'test',
      scope: 'global',
      action: '## Action\nRecord Cortex apply outcomes after runtime work',
      evidence: ['[2026-06-13] cortex apply cli'],
      observations: 4,
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
      appliedCount: 0,
      hitRate: 0,
    })

    const missingOutcome = await runScale(['cortex', 'apply', savedId, '--dir', projectDir, '--json'])
    const missingOutcomeReport = JSON.parse(missingOutcome.stdout) as { recorded: boolean; error: string }
    expect(missingOutcome.exitCode).toBe(1)
    expect(missingOutcomeReport).toMatchObject({
      recorded: false,
      error: 'explicit-outcome-required',
    })

    const start = await runScale([
      'runtime',
      'start',
      '--session-id',
      'SESSION-CORTEX-APPLY',
      '--task-id',
      'TASK-CORTEX-APPLY',
      '--json',
    ], {
      SCALE_DIR: scaleDir,
      SCALE_PROJECT_DIR: projectDir,
    })
    const session = JSON.parse(start.stdout) as { metadata?: { cortex?: { instinctsApplied: string[] } } }
    expect(start.exitCode).toBe(0)
    expect(session.metadata?.cortex?.instinctsApplied).toEqual([savedId])

    const apply = await runScale(['cortex', 'apply', savedId, '--dir', projectDir, '--success', '--json'])
    const applyReport = JSON.parse(apply.stdout) as { recorded: boolean; auditId: string; reason: string; hitRate: number }
    expect(apply.exitCode).toBe(0)
    expect(applyReport).toMatchObject({
      recorded: true,
      reason: 'application-succeeded',
    })
    expect(applyReport.auditId).toMatch(/^audit-/)

    const metrics = await runScale(['cortex', 'metrics', '--dir', projectDir, '--json'])
    const metricsReport = JSON.parse(metrics.stdout) as {
      instincts: {
        totalInjected: number
        totalApplied: number
        hitRate: number
        runtimeEvidence: { source: string; injectionEvents: number; successfulApplications: number }
      }
    }
    expect(metricsReport.instincts.runtimeEvidence).toMatchObject({
      source: 'session-and-audit',
      injectionEvents: 1,
      successfulApplications: 1,
    })
    expect(metricsReport.instincts.totalInjected).toBe(1)
    expect(metricsReport.instincts.totalApplied).toBe(1)
    expect(metricsReport.instincts.hitRate).toBe(1)

    const effectiveness = await runScale(['workflow', 'effectiveness', '--dir', projectDir, '--skip-memory-recall', '--json'])
    const effectivenessReport = JSON.parse(effectiveness.stdout) as {
      orchestration: { instinctHitRate: { evidence: string; value: number } }
      summary: { gaps: string[] }
    }
    expect(effectiveness.exitCode).toBe(0)
    expect(effectivenessReport.orchestration.instinctHitRate).toMatchObject({
      evidence: 'measured',
      value: 1,
    })
    expect(effectivenessReport.summary.gaps).not.toContain('Instinct hit rate is not yet measured from applied runtime evidence.')

    const audit = await runScale(['cortex', 'audit', '--dir', projectDir, '--id', savedId, '--json'])
    const auditReport = JSON.parse(audit.stdout) as { entries: Array<{ op: string; reason: string }> }
    expect(auditReport.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: 'apply', reason: 'application-succeeded' }),
    ]))
  }, CLI_TEST_TIMEOUT_MS)

  it('rejects a candidate with audit evidence without writing an instinct', async () => {
    const projectDir = makeProject('scale-cortex-cli-reject-')
    const scaleDir = join(projectDir, '.scale')
    const base = Date.UTC(2026, 5, 12, 10, 0)
    for (let i = 0; i < 5; i++) {
      writeGateEvidence(scaleDir, {
        id: `GATE-G6-${base + i}-fail`,
        gate: 'G6',
        createdAt: base + i,
        blocker: 'Coverage failed: reject candidate',
        path: 'src/coverage.ts',
      })
    }

    const extract = await runScale([
      'cortex',
      'extract',
      '--dir',
      projectDir,
      '--min-confidence',
      '0.7',
      '--dry-run',
      '--json',
    ])
    const report = parseLastJson<{ instincts: Array<{ id: string }> }>(extract.stdout)
    const candidateId = report.instincts[0].id

    const reject = await runScale([
      'cortex',
      'reject',
      candidateId,
      '--dir',
      projectDir,
      '--reason',
      'manual false positive',
      '--json',
    ])
    const rejectReport = JSON.parse(reject.stdout) as { rejected: boolean; candidateId: string; auditId: string }

    expect(reject.exitCode).toBe(0)
    expect(rejectReport).toMatchObject({ rejected: true, candidateId })
    expect(rejectReport.auditId).toMatch(/^audit-/)
    expect(countInstinctFiles(join(scaleDir, 'instincts'))).toBe(0)

    const audit = await runScale(['cortex', 'audit', '--dir', projectDir, '--json'])
    const auditReport = JSON.parse(audit.stdout) as { entries: Array<{ op: string; reason: string; reasons: string[] }> }
    expect(auditReport.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        op: 'reject',
        reason: 'manual false positive',
        reasons: expect.arrayContaining([`candidate-id:${candidateId}`]),
      }),
    ]))
  }, CLI_TEST_TIMEOUT_MS)

  it('blocks stale candidate approval unless explicitly allowed', async () => {
    const projectDir = makeProject('scale-cortex-cli-approve-stale-')
    const scaleDir = join(projectDir, '.scale')
    const base = Date.UTC(2026, 5, 12, 10, 0)
    for (let i = 0; i < 5; i++) {
      writeGateEvidence(scaleDir, {
        id: `GATE-G7-${base + i}-fail`,
        createdAt: base + i,
      })
    }
    writeGateEvidence(scaleDir, {
      id: `GATE-G7-${base + 10_000}-pass`,
      createdAt: base + 10_000,
      passed: true,
      path: 'src',
    })

    const extract = await runScale([
      'cortex',
      'extract',
      '--dir',
      projectDir,
      '--min-confidence',
      '0.7',
      '--dry-run',
      '--json',
    ])
    const report = parseLastJson<{ rejected: Array<{ id: string }> }>(extract.stdout)
    const candidateId = report.rejected[0].id

    const blocked = await runScale(['cortex', 'approve', candidateId, '--dir', projectDir, '--json'])
    const blockedReport = JSON.parse(blocked.stdout) as { approved: boolean; error: string }
    expect(blocked.exitCode).toBe(1)
    expect(blockedReport).toMatchObject({ approved: false, error: 'candidate-not-accepted' })
    expect(countInstinctFiles(join(scaleDir, 'instincts'))).toBe(0)

    const allowed = await runScale(['cortex', 'approve', candidateId, '--dir', projectDir, '--allow-stale', '--json'])
    const allowedReport = JSON.parse(allowed.stdout) as { approved: boolean; savedId: string; status: string }
    expect(allowed.exitCode).toBe(0)
    expect(allowedReport).toMatchObject({ approved: true, status: 'stale' })
    expect(allowedReport.savedId).toMatch(/^instinct-/)
    expect(countInstinctFiles(join(scaleDir, 'instincts'))).toBe(1)
  }, CLI_TEST_TIMEOUT_MS)
})
