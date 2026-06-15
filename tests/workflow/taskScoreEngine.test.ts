import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTaskScoreReport } from '../../src/workflow/TaskScoreEngine.js'
import { EvidenceStore } from '../../src/workflow/EvidenceStore.js'
import type { GateResult } from '../../src/workflow/types.js'

vi.mock('../../src/codegraph/CodeIntelligence.js', () => ({
  inspectCodeIntelligence: vi.fn(({ projectDir, scaleDir }) => ({
    projectDir,
    scaleDir,
    configPath: join(scaleDir, 'code-intelligence.json'),
    configExists: true,
    projectIndexPath: join(projectDir, '.codegraph'),
    projectIndexExists: true,
    providers: [{
      id: 'codegraph',
      type: 'external-cli',
      enabled: true,
      available: true,
      capabilities: ['symbols', 'callers', 'callees', 'impact', 'context', 'summary', 'module-map'],
      reason: 'test fixture provider',
    }],
    fallback: {
      enabled: true,
      tools: ['internal-scan'],
      available: true,
      reason: 'test fixture fallback',
    },
    availableProviderCount: 1,
    recommendations: [],
  })),
}))

vi.mock('../../src/memory/MemoryProviders.js', () => ({
  inspectMemoryProviders: vi.fn(({ projectDir, scaleDir }) => ({
    projectDir,
    scaleDir,
    configPath: join(scaleDir, 'memory-providers.json'),
    configExists: true,
    routing: {
      mode: 'external-first',
      defaultOrder: ['gbrain'],
      allowExternalWrite: false,
      requireEvidence: true,
      maxResultsPerProvider: 5,
    },
    providers: [{
      id: 'gbrain',
      kind: 'gbrain',
      enabled: true,
      priority: 95,
      capabilities: ['semantic-recall', 'graph-recall', 'session-memory', 'mcp'],
      safetyLevel: 'review-required',
      writeMode: 'disabled',
      available: true,
      reason: 'test fixture memory provider',
    }],
    availableProviderCount: 1,
    warnings: [],
  })),
}))

const dirs: string[] = []

function makeProject(): { projectDir: string; scaleDir: string } {
  const projectDir = mkdtempSync(join(tmpdir(), 'scale-score-project-'))
  dirs.push(projectDir)
  const scaleDir = join(projectDir, '.scale')
  mkdirSync(join(projectDir, 'src'), { recursive: true })
  mkdirSync(scaleDir, { recursive: true })
  writeFileSync(join(projectDir, 'src', 'index.ts'), 'export const answer = 42\n', 'utf-8')
  writeFileSync(join(scaleDir, 'engineering-standards.json'), JSON.stringify({ version: 1 }), 'utf-8')
  writeFileSync(join(scaleDir, 'verification.json'), JSON.stringify({
    version: 1,
    defaultProfile: 'default',
    profiles: { default: { commands: {} } },
    policy: {
      engineeringStandardsGate: 'block',
    },
  }), 'utf-8')
  return { projectDir, scaleDir }
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

describe('TaskScoreEngine', () => {
  it('computes a passing deterministic score from gate evidence and changed-file standards', () => {
    const { projectDir, scaleDir } = makeProject()
    const store = new EvidenceStore(scaleDir)
    store.saveGateResult(gateResult('G0', true))
    store.saveGateResult(gateResult('G4', true))
    store.saveGateResult(gateResult('G5', true))

    const report = createTaskScoreReport({
      projectDir,
      scaleDir,
      level: 'M',
      changedFiles: ['src/index.ts'],
    })

    expect(report.totalScore).toBeGreaterThanOrEqual(75)
    expect(report.passed).toBe(true)
    expect(report.dimensions.find(dimension => dimension.id === 'architecture')).toMatchObject({
      status: 'pass',
      score: 20,
    })
    expect(report.references.gateStatus.extensions.find(gate => gate.id === 'engineering-standards')).toMatchObject({
      blocking: true,
    })
  })

  it('blocks score when changed files violate engineering standards', () => {
    const { projectDir, scaleDir } = makeProject()
    writeFileSync(join(projectDir, 'src', 'leaky.ts'), `
export function leaky(token: string) {
  console.log('token', token)
}
`, 'utf-8')
    const store = new EvidenceStore(scaleDir)
    store.saveGateResult(gateResult('G0', true))

    const report = createTaskScoreReport({
      projectDir,
      scaleDir,
      level: 'M',
      changedFiles: ['src/leaky.ts'],
    })

    expect(report.passed).toBe(false)
    expect(report.grade).toBe('blocked')
    expect(report.blockers.some(blocker => blocker.includes('Architecture standards'))).toBe(true)
  })
})

function gateResult(gate: GateResult['gate'], passed: boolean): GateResult {
  return {
    gate,
    status: passed ? 'PASSED' : 'FAILED',
    passed,
    evidence: passed ? 'gate passed' : 'gate failed',
    evidenceItems: [{
      kind: 'command',
      label: `${gate} command`,
      passed,
      detail: passed ? 'ok' : 'failed',
    }],
    blockers: passed ? [] : ['failed'],
    durationMs: 12,
  }
}
