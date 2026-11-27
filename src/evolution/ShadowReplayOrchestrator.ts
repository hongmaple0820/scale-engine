import { createHash } from 'node:crypto'
import { closeSync, fstatSync, lstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { ShadowReplayAdapter, ShadowReplayInputs, ShadowReplayPlan, ShadowReplayRunResult } from './ShadowReplayContract.js'
import { executeShadowReplay } from './ShadowReplayContract.js'
import { evaluateShadowReplayProtocol, type ShadowReplayProtocolEvaluation } from './ShadowReplayRunnerProtocol.js'
import { ShadowReplayLedger, type ShadowReplayLedgerRecord, type ShadowReplayProvenance } from './ShadowReplayLedger.js'

const MAX_PROTOCOL_DOCUMENT_BYTES = 1024 * 1024

export interface RunAndRecordShadowReplayInput {
  plan: ShadowReplayPlan
  adapter: ShadowReplayAdapter
  inputs: ShadowReplayInputs
  ledger: ShadowReplayLedger
  provenance: ShadowReplayProvenance
}

export interface RunAndRecordShadowReplayResult {
  result: ShadowReplayRunResult
  record: ShadowReplayLedgerRecord
  evaluation: ShadowReplayProtocolEvaluation | null
}

function readApprovedInput(path: string, expectedDigest: string, label: string): Buffer {
  const absolute = resolve(path)
  const initial = lstatSync(absolute)
  if (initial.isSymbolicLink() || !initial.isFile()) throw new Error(`Shadow Replay ${label} must be a regular non-symlink file`)
  const fd = openSync(absolute, 'r')
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > MAX_PROTOCOL_DOCUMENT_BYTES) {
      throw new Error(`Shadow Replay ${label} must be a regular file no larger than 1 MiB`)
    }
    const bytes = readFileSync(fd)
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
    if (bytes.byteLength !== stat.size || digest !== expectedDigest) {
      throw new Error(`Shadow Replay ${label} digest does not match the approved plan`)
    }
    return bytes
  } finally {
    closeSync(fd)
  }
}

function attestRunnerOutput(result: ShadowReplayRunResult, expected: ShadowReplayProtocolEvaluation): void {
  if (result.status === 'timed-out') return
  const expectedExitCode = expected.passed ? 0 : 10
  if (result.exitCode !== expectedExitCode) {
    throw new Error(`Shadow Replay Runner exit code ${result.exitCode} does not match protocol evaluation ${expectedExitCode}`)
  }
  let actual: unknown
  try {
    actual = JSON.parse(result.stdoutSummary) as unknown
  } catch {
    throw new Error('Shadow Replay Runner stdout is not a single valid protocol v1 JSON result')
  }
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error('Shadow Replay Runner result does not match the host-verified protocol evaluation')
  }
}

/**
 * Execute an already-reviewed Shadow Replay plan, independently evaluate the
 * exact digest-pinned inputs on the host, attest the Runner's data-only result,
 * and durably record the bounded/redacted result plus provenance.
 *
 * The adapter receives private copies of the same bytes that the host validates,
 * preventing a caller from swapping the source files between evaluation and run.
 * This function never mutates production policy, hooks, or Failure Learning state.
 */
export async function runAndRecordShadowReplay(
  input: RunAndRecordShadowReplayInput,
): Promise<RunAndRecordShadowReplayResult> {
  const scenarioBytes = readApprovedInput(input.inputs.scenarioSnapshotPath, input.plan.scenarioSnapshotDigest, 'scenario snapshot')
  const candidateBytes = readApprovedInput(input.inputs.candidateBundlePath, input.plan.candidateBundleDigest, 'candidate bundle')
  const scenarioRaw = new TextDecoder('utf-8', { fatal: true }).decode(scenarioBytes)
  const candidateRaw = new TextDecoder('utf-8', { fatal: true }).decode(candidateBytes)
  const evaluation = evaluateShadowReplayProtocol(input.plan, scenarioRaw, candidateRaw)

  const privateDir = mkdtempSync(join(tmpdir(), 'scale-shadow-replay-approved-'))
  const scenarioPath = join(privateDir, 'scenario.snapshot')
  const candidatePath = join(privateDir, 'candidate.bundle')
  try {
    writeFileSync(scenarioPath, scenarioBytes, { flag: 'wx', mode: 0o400 })
    writeFileSync(candidatePath, candidateBytes, { flag: 'wx', mode: 0o400 })
    const result = await executeShadowReplay(input.plan, input.adapter, {
      scenarioSnapshotPath: scenarioPath,
      candidateBundlePath: candidatePath,
    })
    attestRunnerOutput(result, evaluation)
    const record = input.ledger.record(input.plan, result, input.provenance)
    return { result, record, evaluation: result.status === 'timed-out' ? null : evaluation }
  } finally {
    rmSync(privateDir, { recursive: true, force: true })
  }
}
