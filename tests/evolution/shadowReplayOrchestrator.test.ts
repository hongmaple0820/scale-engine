import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DockerShadowReplayAdapter, type DockerCommandRunner } from '../../src/evolution/ShadowReplayDockerAdapter.js'
import type { ShadowReplayPlan } from '../../src/evolution/ShadowReplayContract.js'
import { ShadowReplayLedger } from '../../src/evolution/ShadowReplayLedger.js'
import { runAndRecordShadowReplay } from '../../src/evolution/ShadowReplayOrchestrator.js'

const IMAGE = `ghcr.io/example/scale-shadow-runner@sha256:${'c'.repeat(64)}`
const dirs: string[] = []
function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'shadow-replay-orchestrator-'))
  dirs.push(dir)
  const scenario = JSON.stringify({
    protocolVersion: 1, kind: 'scale-shadow-replay-scenario', scenarioId: 'orchestrator-test',
    sourceCommitSha: 'a'.repeat(40),
    events: [{ id: 'event-1', tool: 'fs.write', input: 'write /secret/value', expectedDecision: 'block' }],
  })
  const candidate = JSON.stringify({
    protocolVersion: 1, kind: 'scale-shadow-replay-candidate', candidateId: 'IMPROVE-1',
    failureId: 'FAIL-1', defaultDecision: 'allow',
    rules: [{ id: 'block-write', priority: 10, tool: 'fs.write', contains: 'write', decision: 'block' }],
  })
  const scenarioSnapshotPath = join(dir, 'scenario.snapshot')
  const candidateBundlePath = join(dir, 'candidate.bundle')
  writeFileSync(scenarioSnapshotPath, scenario)
  writeFileSync(candidateBundlePath, candidate)
  const plan: ShadowReplayPlan = {
    contractVersion: 1, runId: 'SHADOW-REPLAY-ORCHESTRATOR-1',
    candidateId: 'IMPROVE-1', failureId: 'FAIL-1', sourceCommitSha: 'a'.repeat(40),
    scenarioSnapshotDigest: digest(scenario), candidateBundleDigest: digest(candidate),
    adapterId: 'docker-container', adapterVersion: '1.0.0', sandboxKind: 'container',
    limits: { timeoutMs: 10_000, memoryLimitMb: 512, cpuTimeLimitMs: 10_000 },
    createdAt: '2026-11-27T00:00:00.000Z',
  }
  const provenance = {
    runnerImageRef: IMAGE, recordedBy: 'shadow-replay-orchestrator-test',
    scenarioSnapshotDigest: plan.scenarioSnapshotDigest,
    candidateBundleDigest: plan.candidateBundleDigest,
  }
  const docker: DockerCommandRunner = vi.fn(async args => {
    if (args[0] === 'image') return { exitCode: 0, stdout: JSON.stringify([IMAGE]), stderr: '' }
    if (args[0] === 'create') return { exitCode: 0, stdout: 'abcdef123456', stderr: '' }
    if (args[0] === 'start') return {
      exitCode: 0,
      stdout: JSON.stringify({
        protocolVersion: 1, scenarioId: 'orchestrator-test', candidateId: 'IMPROVE-1',
        failureId: 'FAIL-1', passed: true, eventCount: 1, matchedCount: 1,
        mismatchCount: 0, mismatches: [],
      }),
      stderr: '',
    }
    return { exitCode: 0, stdout: '', stderr: '' }
  })
  return {
    dir, plan, provenance, inputs: { scenarioSnapshotPath, candidateBundlePath },
    adapter: new DockerShadowReplayAdapter({ imageRef: IMAGE, runner: docker }),
  }
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('runAndRecordShadowReplay', () => {
  it('runs the Docker adapter, persists the result and provenance, then reads the same record back', async () => {
    const f = fixture()
    const ledger = new ShadowReplayLedger({ projectDir: f.dir })
    const completed = await runAndRecordShadowReplay({
      plan: f.plan, adapter: f.adapter, inputs: f.inputs, ledger, provenance: f.provenance,
    })
    expect(completed.result).toMatchObject({
      status: 'passed', runId: f.plan.runId, productionPolicyChanged: false, hooksChanged: false,
    })
    expect(completed.result.stdoutSummary).not.toContain('/secret/value')
    expect(completed.record).toMatchObject({
      schemaVersion: 1, runId: f.plan.runId, provenance: f.provenance,
      result: { status: 'passed', exitCode: 0 },
    })
    expect(ledger.get(f.plan.runId)).toEqual(completed.record)
    expect(ledger.list({ candidateId: f.plan.candidateId, failureId: f.plan.failureId })).toEqual([completed.record])
    ledger.close()
  })

  it('persists a valid runner mismatch as failed evidence rather than treating exit 10 as infrastructure failure', async () => {
    const f = fixture()
    const ledger = new ShadowReplayLedger({ projectDir: f.dir })
    const runner: DockerCommandRunner = vi.fn(async args => {
      if (args[0] === 'image') return { exitCode: 0, stdout: JSON.stringify([IMAGE]), stderr: '' }
      if (args[0] === 'create') return { exitCode: 0, stdout: 'abcdef123456', stderr: '' }
      if (args[0] === 'start') return {
        exitCode: 10,
        stdout: JSON.stringify({
          protocolVersion: 1, scenarioId: 'orchestrator-test', candidateId: 'IMPROVE-1',
          failureId: 'FAIL-1', passed: false, eventCount: 1, matchedCount: 1,
          mismatchCount: 1, mismatches: [{ eventId: 'event-1', expectedDecision: 'block', actualDecision: 'allow', matchedRuleId: null }],
        }),
        stderr: '',
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const adapter = new DockerShadowReplayAdapter({ imageRef: IMAGE, runner })
    const completed = await runAndRecordShadowReplay({
      plan: f.plan, adapter, inputs: f.inputs, ledger, provenance: f.provenance,
    })
    expect(completed.result).toMatchObject({ status: 'failed', exitCode: 10 })
    expect(ledger.get(f.plan.runId)?.result).toEqual(completed.result)
    ledger.close()
  })

  it('does not create a ledger record when provenance does not match the reviewed plan', async () => {
    const f = fixture()
    const ledger = new ShadowReplayLedger({ projectDir: f.dir })
    await expect(runAndRecordShadowReplay({
      plan: f.plan, adapter: f.adapter, inputs: f.inputs, ledger,
      provenance: { ...f.provenance, candidateBundleDigest: digest('tampered') },
    })).rejects.toThrow('digest provenance mismatch')
    expect(ledger.list()).toHaveLength(0)
    ledger.close()
  })
})
