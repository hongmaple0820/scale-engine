// SCALE Engine — Ship Pipeline Tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { execFileSync, execSync } from 'node:child_process'
import {
  runShipPipeline,
  summarizeShipPipeline,
  type ShipPipelineInput,
  type ShipPipelineResult,
  type ShipStep,
} from '../../src/workflow/ShipPipeline.js'

// Mock external dependencies
vi.mock('node:child_process', () => ({
  execSync: vi.fn((cmd: string) => {
    if (cmd.includes('git branch --show-current')) return 'feature-branch\n'
    if (cmd.includes('git rev-parse --verify')) return 'abc123\n'
    if (cmd.includes('git fetch')) return ''
    if (cmd.includes('git merge')) return ''
    if (cmd.includes('git diff --name-only')) return 'src/foo.ts\nsrc/bar.ts\n'
    if (cmd.includes('git ls-files --others')) return 'src/new-file.ts\nnotes.tmp\n'
    if (cmd.includes('git describe --tags')) return 'v0.31.0\n'
    if (cmd.includes('git log')) return 'abc123 feat: add feature\ndef456 fix: bug fix\n'
    if (cmd.includes('git diff --cached --quiet')) throw new Error('has changes')
    if (cmd.includes('git commit')) return ''
    if (cmd.includes('git rev-parse HEAD')) return 'abc1234567890\n'
    if (cmd.includes('git push')) return ''
    if (cmd.includes('gh pr create')) return 'https://github.com/org/repo/pull/42\n'
    return ''
  }),
  execFileSync: vi.fn((cmd: string, args: string[]) => {
    if (cmd === 'git' && args[0] === 'status') {
      const path = args[args.length - 1]
      if (path === 'package.json' || path === 'CHANGELOG.md') return ` M ${path}\n`
      return ''
    }
    if (cmd === 'git' && args[0] === 'add') return ''
    return ''
  }),
}))

vi.mock('../../src/tools/SafeCommandRunner.js', () => ({
  runSafeCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'All tests passed', stderr: '' }),
}))

vi.mock('../../src/workflow/VerificationProfile.js', () => ({
  resolveVerificationTargets: vi.fn().mockReturnValue({
    targets: [{ config: { test: 'npm test' } }],
  }),
}))

vi.mock('../../src/workflow/ReviewAnalyzer.js', () => ({
  parseChangedFiles: vi.fn((output: string) =>
    output.split('\n').filter(Boolean).map(path => ({ path, status: 'modified' })),
  ),
  shouldReviewFile: vi.fn((path: string) => path.endsWith('.ts')),
}))

vi.mock('../../src/workflow/SessionPreamble.js', () => ({
  collectSessionPreamble: vi.fn().mockReturnValue({
    sessionId: 'test1234',
    timestamp: '2026-05-21T10:00:00Z',
    gitBranch: 'feature-branch',
    gitRoot: '/project',
    projectSlug: 'test-project',
    scaleVersion: '0.32.0',
    activeRunCount: 0,
    learningCount: 0,
    verificationProfile: 'default',
    governanceMode: 'standard',
    warnings: [],
  }),
}))

vi.mock('../../src/evolution/SessionLearnings.js', () => ({
  autoLearnFromRunReport: vi.fn().mockReturnValue([]),
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    existsSync: vi.fn((path: string) => {
      if (path.endsWith('package.json')) return true
      if (path.endsWith('package-lock.json')) return false
      if (path.endsWith('CHANGELOG.md')) return true
      return false
    }),
    readFileSync: vi.fn((path: string) => {
      if (path.endsWith('package.json')) return JSON.stringify({ name: 'test', version: '0.31.0' })
      if (path.endsWith('CHANGELOG.md')) return '# Changelog\n\nOld entry\n'
      return ''
    }),
    writeFileSync: vi.fn(),
  }
})

describe('runShipPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('executes all steps in dry-run mode', async () => {
    const result = await runShipPipeline({ dryRun: true })
    expect(result.success).toBe(true)
    expect(result.steps.length).toBe(8)
    expect(result.steps.every(s => s.status === 'passed' || s.status === 'skipped')).toBe(true)
  })

  it('skips specified steps', async () => {
    const result = await runShipPipeline({
      dryRun: true,
      skipSteps: ['sync-base', 'push', 'create-pr'],
    })
    expect(result.success).toBe(true)
    const skipped = result.steps.filter(s => s.status === 'skipped')
    expect(skipped.length).toBe(3)
    expect(skipped.map(s => s.step)).toEqual(['sync-base', 'push', 'create-pr'])
  })

  it('stops on step failure', async () => {
    const { runSafeCommand } = await import('../../src/tools/SafeCommandRunner.js')
    vi.mocked(runSafeCommand).mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'FAIL' } as any)

    const result = await runShipPipeline({ skipSteps: ['sync-base'] })
    expect(result.success).toBe(false)
    const testStep = result.steps.find(s => s.step === 'test')
    expect(testStep?.status).toBe('failed')
    // Steps after 'test' should not have run
    const stepNames = result.steps.map(s => s.step)
    expect(stepNames).not.toContain('review-diff')
  })

  it('tracks changed files from review-diff', async () => {
    const result = await runShipPipeline({ dryRun: true })
    expect(result.changedFiles.length).toBeGreaterThan(0)
    expect(result.changedFiles).toContain('src/foo.ts')
    expect(result.changedFiles).toContain('src/new-file.ts')
    expect(result.changedFiles).not.toContain('notes.tmp')
  })

  it('records total duration', async () => {
    const result = await runShipPipeline({ dryRun: true })
    expect(result.totalDuration).toBeGreaterThanOrEqual(0)
  })

  it('respects custom baseBranch and remote', async () => {
    const result = await runShipPipeline({
      dryRun: true,
      baseBranch: 'main',
      remote: 'upstream',
    })
    expect(result.success).toBe(true)
  })

  it('respects versionBump option', async () => {
    const result = await runShipPipeline({
      dryRun: true,
      versionBump: 'minor',
    })
    expect(result.success).toBe(true)
  })

  it('stages only reviewed and ship-generated files', async () => {
    const result = await runShipPipeline({
      skipSteps: ['sync-base', 'push', 'create-pr'],
    })

    expect(result.success).toBe(true)
    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
      'git',
      ['add', '--', 'src/foo.ts', 'src/bar.ts', 'src/new-file.ts', 'package.json', 'CHANGELOG.md'],
      expect.objectContaining({ encoding: 'utf-8' }),
    )
    expect(vi.mocked(execSync)).not.toHaveBeenCalledWith(
      'git add -A',
      expect.anything(),
    )
  })
})

describe('summarizeShipPipeline', () => {
  it('formats passed steps with checkmarks', () => {
    const result: ShipPipelineResult = {
      success: true,
      steps: [
        { step: 'sync-base', status: 'passed', duration: 100, evidence: 'Synced' },
        { step: 'test', status: 'passed', duration: 500, evidence: 'Tests passed' },
      ],
      totalDuration: 600,
      changedFiles: [],
      warnings: [],
    }

    const summary = summarizeShipPipeline(result)
    expect(summary).toContain('✅')
    expect(summary).toContain('sync-base')
    expect(summary).toContain('test')
    expect(summary).toContain('600ms')
  })

  it('formats failed steps with X mark', () => {
    const result: ShipPipelineResult = {
      success: false,
      steps: [
        { step: 'test', status: 'failed', duration: 200, error: 'Tests failed' },
      ],
      totalDuration: 200,
      changedFiles: [],
      warnings: [],
    }

    const summary = summarizeShipPipeline(result)
    expect(summary).toContain('❌')
    expect(summary).toContain('Tests failed')
  })

  it('formats skipped steps with skip icon', () => {
    const result: ShipPipelineResult = {
      success: true,
      steps: [
        { step: 'changelog', status: 'skipped', duration: 0 },
      ],
      totalDuration: 0,
      changedFiles: [],
      warnings: [],
    }

    const summary = summarizeShipPipeline(result)
    expect(summary).toContain('⏭️')
  })

  it('includes commit SHA and PR URL when available', () => {
    const result: ShipPipelineResult = {
      success: true,
      steps: [
        { step: 'commit', status: 'passed', duration: 10, evidence: 'Committed: abc12345 — chore: release v0.32.0' },
        { step: 'create-pr', status: 'passed', duration: 10, evidence: 'PR created: https://github.com/org/repo/pull/42' },
      ],
      totalDuration: 20,
      changedFiles: ['src/foo.ts'],
      warnings: [],
      commitSha: 'abc12345',
      prUrl: 'https://github.com/org/repo/pull/42',
    }

    const summary = summarizeShipPipeline(result)
    expect(summary).toContain('abc12345')
    expect(summary).toContain('https://github.com/org/repo/pull/42')
    expect(summary).toContain('**Changed files:** 1')
  })
})
