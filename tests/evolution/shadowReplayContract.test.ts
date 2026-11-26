import { describe, expect, it, vi } from 'vitest'
import {
  createShadowReplayPlan,
  executeShadowReplay,
  type ShadowReplayAdapter,
  type ShadowReplayPlan,
} from '../../src/evolution/ShadowReplayContract.js'
import type { FailureImprovementCandidate, FailureReplayRecord } from '../../src/eval/WorkflowEval.js'

const candidate: FailureImprovementCandidate = {
  id: 'IMPROVE-1',
  failureId: 'FAIL-1',
  createdAt: '2026-11-25T00:00:00.000Z',
  category: 'command-failure',
  title: 'Require evidence before completion',
  recommendation: 'Add a verification gate.',
  evidencePath: '.scale/evals/failures/FAIL-1.json',
  status: 'accepted',
  shadowStatus: 'pending',
  reviews: [{
    decision: 'accepted',
    reviewer: 'reviewer@example.test',
    rationale: 'Reproduced and approved for isolated evaluation.',
    reviewedAt: '2026-11-25T00:00:00.000Z',
  }],
}

const failure: FailureReplayRecord = {
  id: 'FAIL-1',
  taskId: 'case-1',
  suiteId: 'suite-1',
  caseId: 'case-1',
  generatedAt: '2026-11-25T00:00:00.000Z',
  category: 'command-failure',
  phase: 'verify',
  task: 'Verify command evidence.',
  wrongTurn: 'Claimed completion without proof.',
  evidence: 'exit code 1',
  correction: 'Run the verification.',
  prevention: 'Require evidence.',
  replayCommand: 'node untrusted-script.js',
  status: 'promoted',
  redactionApplied: false,
}

const digest = `sha256:${'a'.repeat(64)}`
const replayInputs = { scenarioSnapshotPath: '/fixture/scenario.json', candidateBundlePath: '/fixture/candidate.bundle' }

function makePlan(overrides: Partial<Parameters<typeof createShadowReplayPlan>[0]> = {}): ShadowReplayPlan {
  return createShadowReplayPlan({
    candidate,
    sourceFailure: failure,
    sourceCommitSha: 'a'.repeat(40),
    scenarioSnapshotDigest: digest,
    candidateBundleDigest: `sha256:${'b'.repeat(64)}`,
    adapterId: 'test-container',
    adapterVersion: '1.0.0',
    sandboxKind: 'container',
    now: new Date('2026-11-25T00:00:00.000Z'),
    ...overrides,
  })
}

function makeAdapter(overrides: Partial<ShadowReplayAdapter> = {}): ShadowReplayAdapter {
  return {
    id: 'test-container',
    version: '1.0.0',
    capabilities: {
      sandboxKind: 'container',
      networkAccess: false,
      hostCredentials: false,
      sourceReadOnly: true,
      outputIsolated: true,
    },
    execute: vi.fn(async () => ({
      startedAt: '2026-11-25T00:00:01.000Z',
      completedAt: '2026-11-25T00:00:02.000Z',
      exitCode: 0,
      timedOut: false,
      stdout: 'replay-ok',
      stderr: '',
    })),
    ...overrides,
  }
}

describe('Shadow replay contract', () => {
  it('creates a digest-pinned plan only after accepted human review', () => {
    const plan = makePlan()
    expect(plan).toMatchObject({
      contractVersion: 1,
      candidateId: candidate.id,
      failureId: failure.id,
      sourceCommitSha: 'a'.repeat(40),
      scenarioSnapshotDigest: digest,
      candidateBundleDigest: `sha256:${'b'.repeat(64)}`,
      sandboxKind: 'container',
      limits: { timeoutMs: 120_000, memoryLimitMb: 1024, cpuTimeLimitMs: 120_000 },
    })
    expect(plan.runId).toMatch(/^SHADOW-REPLAY-/)
    expect(plan.runId).not.toBe(makePlan().runId)
  })

  it('rejects candidates without accepted status or a recorded accepted review', () => {
    expect(() => makePlan({ candidate: { ...candidate, status: 'candidate' } }))
      .toThrow('Only an accepted improvement candidate')
    expect(() => makePlan({ candidate: { ...candidate, reviews: [] } }))
      .toThrow('recorded accepted human review')
    expect(() => makePlan({ candidate: { ...candidate, reviews: [{ ...candidate.reviews![0], decision: 'rejected' }] } }))
      .toThrow('recorded accepted human review')
  })

  it('rejects mismatched or closed source failure evidence', () => {
    expect(() => makePlan({ sourceFailure: { ...failure, id: 'FAIL-OTHER' } }))
      .toThrow('does not match')
    expect(() => makePlan({ sourceFailure: { ...failure, status: 'closed' } }))
      .toThrow('cannot be replayed')
  })

  it('validates immutable inputs and bounded resource limits', () => {
    expect(() => makePlan({ sourceCommitSha: 'not-a-commit' })).toThrow('Git commit SHA')
    expect(() => makePlan({ scenarioSnapshotDigest: 'sha256:bad' })).toThrow('scenarioSnapshotDigest')
    expect(() => makePlan({ limits: { timeoutMs: 700_000 } })).toThrow('timeoutMs')
  })

  it('fails closed when the adapter cannot attest required isolation capabilities', async () => {
    const adapter = makeAdapter({
      capabilities: {
        sandboxKind: 'container',
        networkAccess: true as false,
        hostCredentials: false,
        sourceReadOnly: true,
        outputIsolated: true,
      },
    })
    await expect(executeShadowReplay(makePlan(), adapter, replayInputs))
      .rejects.toThrow('required isolation capabilities')
    expect(adapter.execute).not.toHaveBeenCalled()
  })

  it('executes through the injected adapter and never changes production policy or hooks', async () => {
    const result = await executeShadowReplay(makePlan(), makeAdapter(), replayInputs)
    expect(result).toMatchObject({
      status: 'passed',
      stdoutSummary: 'replay-ok',
      productionPolicyChanged: false,
      hooksChanged: false,
      sandboxKind: 'container',
    })
  })

  it('records failure and timeout outcomes without promoting production state', async () => {
    const failed = await executeShadowReplay(makePlan(), makeAdapter({
      execute: vi.fn(async () => ({
        startedAt: '2026-11-25T00:00:01.000Z',
        completedAt: '2026-11-25T00:00:02.000Z',
        exitCode: 3,
        timedOut: false,
        stdout: '',
        stderr: 'assertion failed',
      })),
    }), replayInputs)
    expect(failed.status).toBe('failed')
    const timedOut = await executeShadowReplay(makePlan(), makeAdapter({
      execute: vi.fn(async () => ({
        startedAt: '2026-11-25T00:00:01.000Z',
        completedAt: '2026-11-25T00:02:02.000Z',
        exitCode: 1,
        timedOut: true,
        stdout: '',
        stderr: 'timeout',
      })),
    }), replayInputs)
    expect(timedOut.status).toBe('timed-out')
    expect(timedOut.productionPolicyChanged).toBe(false)
  })

  it('rejects invalid timestamps, oversized output, and unexpected timeout overruns', async () => {
    const invalid = makeAdapter({
      execute: vi.fn(async () => ({
        startedAt: 'not-a-date',
        completedAt: '2026-11-25T00:00:02.000Z',
        exitCode: 0,
        timedOut: false,
        stdout: '',
        stderr: '',
      })),
    })
    await expect(executeShadowReplay(makePlan(), invalid, replayInputs)).rejects.toThrow('timestamps')

    const oversized = makeAdapter({
      execute: vi.fn(async () => ({
        startedAt: '2026-11-25T00:00:01.000Z',
        completedAt: '2026-11-25T00:00:02.000Z',
        exitCode: 0,
        timedOut: false,
        stdout: 'x'.repeat(256 * 1024 + 1),
        stderr: '',
      })),
    })
    await expect(executeShadowReplay(makePlan(), oversized, replayInputs)).rejects.toThrow('256 KiB')

    const overrun = makeAdapter({
      execute: vi.fn(async () => ({
        startedAt: '2026-11-25T00:00:01.000Z',
        completedAt: '2026-11-25T00:03:01.000Z',
        exitCode: 0,
        timedOut: false,
        stdout: '',
        stderr: '',
      })),
    })
    await expect(executeShadowReplay(makePlan(), overrun, replayInputs)).rejects.toThrow('exceeded the approved timeout')
  })
})
