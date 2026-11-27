import type { ShadowReplayAdapter, ShadowReplayInputs, ShadowReplayPlan, ShadowReplayRunResult } from './ShadowReplayContract.js'
import { executeShadowReplay } from './ShadowReplayContract.js'
import { ShadowReplayLedger, type ShadowReplayLedgerRecord, type ShadowReplayProvenance } from './ShadowReplayLedger.js'

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
}

/**
 * Execute an already-reviewed Shadow Replay plan and durably record its bounded,
 * redacted result plus provenance. This function never mutates production policy,
 * hooks, or Failure Learning lifecycle state.
 *
 * Adapter/protocol errors fail closed and are not converted into a successful
 * ledger record. Callers should surface those errors as orchestration failures.
 */
export async function runAndRecordShadowReplay(
  input: RunAndRecordShadowReplayInput,
): Promise<RunAndRecordShadowReplayResult> {
  const result = await executeShadowReplay(input.plan, input.adapter, input.inputs)
  const record = input.ledger.record(input.plan, result, input.provenance)
  return { result, record }
}
