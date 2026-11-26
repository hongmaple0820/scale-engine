import { randomUUID } from 'node:crypto'
import { redactEvidenceText } from '../tools/ToolEvidenceStore.js'
import type { FailureImprovementCandidate, FailureReplayRecord } from '../eval/WorkflowEval.js'
export const SHADOW_REPLAY_CONTRACT_VERSION = 1
export const SHADOW_REPLAY_MAX_OUTPUT_BYTES = 256 * 1024
export type ShadowReplaySandboxKind = 'container' | 'vm'
export interface ShadowReplayLimits { timeoutMs: number; memoryLimitMb: number; cpuTimeLimitMs: number }
export interface ShadowReplayPlan {
  contractVersion: 1; runId: string; candidateId: string; failureId: string; sourceCommitSha: string
  scenarioSnapshotDigest: string; candidateBundleDigest: string; adapterId: string; adapterVersion: string
  sandboxKind: ShadowReplaySandboxKind; limits: ShadowReplayLimits; createdAt: string
}
export interface ShadowReplayInputs { scenarioSnapshotPath: string; candidateBundlePath: string }
export interface ShadowReplayAdapterCapabilities {
  sandboxKind: ShadowReplaySandboxKind; networkAccess: false; hostCredentials: false; sourceReadOnly: true; outputIsolated: true
}
export interface ShadowReplayAdapterResult { startedAt: string; completedAt: string; exitCode: number; timedOut: boolean; stdout: string; stderr: string }
export interface ShadowReplayAdapter {
  id: string; version: string; capabilities: ShadowReplayAdapterCapabilities
  execute(plan: ShadowReplayPlan, inputs: ShadowReplayInputs): Promise<ShadowReplayAdapterResult>
}
export interface ShadowReplayRunResult {
  contractVersion: 1; runId: string; candidateId: string; failureId: string; adapterId: string; adapterVersion: string
  sandboxKind: ShadowReplaySandboxKind; status: 'passed' | 'failed' | 'timed-out'; startedAt: string; completedAt: string
  durationMs: number; exitCode: number; stdoutSummary: string; stderrSummary: string; redactionApplied: boolean
  productionPolicyChanged: false; hooksChanged: false
}
export interface CreateShadowReplayPlanInput {
  candidate: FailureImprovementCandidate; sourceFailure: FailureReplayRecord; sourceCommitSha: string
  scenarioSnapshotDigest: string; candidateBundleDigest: string; adapterId: string; adapterVersion: string
  sandboxKind: ShadowReplaySandboxKind; limits?: Partial<ShadowReplayLimits>; now?: Date
}
const DEFAULT_LIMITS: ShadowReplayLimits = { timeoutMs: 120_000, memoryLimitMb: 1024, cpuTimeLimitMs: 120_000 }
function requireDigest(value: string, label: string): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be sha256:<64 lowercase hex characters>`)
  return value
}
function validateLimits(limits: ShadowReplayLimits): void {
  if (!Number.isSafeInteger(limits.timeoutMs) || limits.timeoutMs < 1 || limits.timeoutMs > 600_000) throw new Error('Shadow replay timeoutMs must be between 1 and 600000')
  if (!Number.isSafeInteger(limits.memoryLimitMb) || limits.memoryLimitMb < 128 || limits.memoryLimitMb > 16_384) throw new Error('Shadow replay memoryLimitMb must be between 128 and 16384')
  if (!Number.isSafeInteger(limits.cpuTimeLimitMs) || limits.cpuTimeLimitMs < 1 || limits.cpuTimeLimitMs > 600_000) throw new Error('Shadow replay cpuTimeLimitMs must be between 1 and 600000')
}
export function createShadowReplayPlan(input: CreateShadowReplayPlanInput): ShadowReplayPlan {
  const { candidate, sourceFailure } = input
  if (candidate.status !== 'accepted') throw new Error('Only an accepted improvement candidate can be replayed')
  const latestReview = candidate.reviews?.[candidate.reviews.length - 1]
  if (!latestReview || latestReview.decision !== 'accepted') throw new Error('Shadow replay requires a recorded accepted human review')
  if (candidate.failureId !== sourceFailure.id) throw new Error('Source failure does not match the improvement candidate')
  if (sourceFailure.status === 'closed' || sourceFailure.status === 'accepted-risk') throw new Error('Closed or accepted-risk source failures cannot be replayed')
  const sourceCommitSha = input.sourceCommitSha.trim()
  if (!/^[a-f0-9]{40,64}$/i.test(sourceCommitSha)) throw new Error('sourceCommitSha must be a 40-64 character Git commit SHA')
  const adapterId = input.adapterId.trim()
  const adapterVersion = input.adapterVersion.trim()
  if (!adapterId || !adapterVersion) throw new Error('adapterId and adapterVersion are required')
  const limits = { ...DEFAULT_LIMITS, ...input.limits }
  validateLimits(limits)
  return {
    contractVersion: 1, runId: `SHADOW-REPLAY-${randomUUID()}`, candidateId: candidate.id, failureId: sourceFailure.id,
    sourceCommitSha, scenarioSnapshotDigest: requireDigest(input.scenarioSnapshotDigest, 'scenarioSnapshotDigest'),
    candidateBundleDigest: requireDigest(input.candidateBundleDigest, 'candidateBundleDigest'),
    adapterId, adapterVersion, sandboxKind: input.sandboxKind, limits, createdAt: (input.now ?? new Date()).toISOString(),
  }
}
function assertAdapterCapabilities(plan: ShadowReplayPlan, adapter: ShadowReplayAdapter): void {
  if (adapter.id !== plan.adapterId || adapter.version !== plan.adapterVersion) throw new Error('Shadow replay adapter identity does not match the approved plan')
  const c = adapter.capabilities
  if (!c || c.sandboxKind !== plan.sandboxKind || c.networkAccess !== false || c.hostCredentials !== false || c.sourceReadOnly !== true || c.outputIsolated !== true) {
    throw new Error('Shadow replay adapter does not satisfy the required isolation capabilities')
  }
}
function boundedRedactedOutput(value: string, label: string): { value: string; redacted: boolean } {
  if (Buffer.byteLength(value, 'utf8') > SHADOW_REPLAY_MAX_OUTPUT_BYTES) throw new Error(`Shadow replay ${label} exceeds the 256 KiB output limit`)
  return redactEvidenceText(value)
}
export async function executeShadowReplay(plan: ShadowReplayPlan, adapter: ShadowReplayAdapter, inputs: ShadowReplayInputs): Promise<ShadowReplayRunResult> {
  assertAdapterCapabilities(plan, adapter)
  const execution = await adapter.execute(plan, inputs)
  const startedAt = Date.parse(execution.startedAt)
  const completedAt = Date.parse(execution.completedAt)
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) throw new Error('Shadow replay adapter returned invalid execution timestamps')
  if (!Number.isSafeInteger(execution.exitCode)) throw new Error('Shadow replay adapter returned an invalid exit code')
  if (typeof execution.stdout !== 'string' || typeof execution.stderr !== 'string') throw new Error('Shadow replay adapter output must be text')
  const stdout = boundedRedactedOutput(execution.stdout, 'stdout')
  const stderr = boundedRedactedOutput(execution.stderr, 'stderr')
  const durationMs = completedAt - startedAt
  if (durationMs > plan.limits.timeoutMs && !execution.timedOut) throw new Error('Shadow replay adapter exceeded the approved timeout without reporting a timeout')
  return {
    contractVersion: 1, runId: plan.runId, candidateId: plan.candidateId, failureId: plan.failureId,
    adapterId: adapter.id, adapterVersion: adapter.version, sandboxKind: plan.sandboxKind,
    status: execution.timedOut ? 'timed-out' : execution.exitCode === 0 ? 'passed' : 'failed',
    startedAt: execution.startedAt, completedAt: execution.completedAt, durationMs, exitCode: execution.exitCode,
    stdoutSummary: stdout.value, stderrSummary: stderr.value, redactionApplied: stdout.redacted || stderr.redacted,
    productionPolicyChanged: false, hooksChanged: false,
  }
}
