// SCALE Engine — P1-A fresh-context review gate
//
// FreshContextVerifier produces an isolated, advisory verdict. This module is
// the pure decision layer that maps that verdict to a gate outcome, so the
// policy is deterministic and unit-testable independently of the CLI wiring.
//
// Effort-tuned semantics (see docs/EFFORT_TUNED_VERIFICATION.md):
//   off   → advisory only (legacy / low-effort tiers). Never changes `passed`.
//   warn  → surface an unmet verdict as a LOW finding, still non-blocking.
//   block → an `unverified` verdict becomes a CRITICAL finding and fails the
//           review (suitable for L / CRITICAL tasks), which then blocks ship
//           through the existing review-evidence gate.
//
// `uncertain` (no verification surface declared) never blocks — there is
// nothing to independently verify against; that is surfaced separately.

import type { ReviewFinding } from '../workflow/ReviewStore.js'
import type { FreshVerifyVerdict } from './FreshContextVerifier.js'

export type FreshGateMode = 'off' | 'warn' | 'block'

export interface FreshGateInput {
  passed: boolean
  findings: ReviewFinding[]
  verdict?: FreshVerifyVerdict
  gate: FreshGateMode
}

export interface FreshGateResult {
  passed: boolean
  findings: ReviewFinding[]
  /** True only when the gate upgraded the verdict into a blocking failure. */
  enforced: boolean
}

export function normalizeFreshGateMode(value: unknown): FreshGateMode {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'warn') return 'warn'
  if (normalized === 'block') return 'block'
  return 'off'
}

export function applyFreshGate(input: FreshGateInput): FreshGateResult {
  const { verdict, gate } = input
  const findings = [...input.findings]

  if (!verdict || gate === 'off' || verdict.decision !== 'unverified') {
    return { passed: input.passed, findings, enforced: false }
  }

  const detail = verdict.unmetSurfaces.length > 0
    ? `unmet verification surface(s): ${verdict.unmetSurfaces.slice(0, 6).join('; ')}`
    : verdict.rationale

  if (gate === 'warn') {
    findings.push({
      category: 'process',
      severity: 'LOW',
      description: `Fresh-context verifier could not independently confirm the outcome (advisory): ${detail}`,
    })
    return { passed: input.passed, findings, enforced: false }
  }

  // gate === 'block'
  findings.push({
    category: 'process',
    severity: 'CRITICAL',
    description: `Independent clean-context review found unverified work (${verdict.modelUsed}): ${detail}`,
  })
  return { passed: false, findings, enforced: true }
}
