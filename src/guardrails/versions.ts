/**
 * Explicit version identifiers for high-risk Guardrails policy behavior.
 *
 * Bump a detector version whenever its decision semantics or fixture contract
 * changes. Bump the policy version when shared decision/report semantics change.
 */
export const GUARDRAILS_POLICY_VERSION = 1

export const GUARDRAILS_DETECTOR_VERSIONS = Object.freeze({
  'dangerous-command': '1.2.0',
  'secret-leak': '1.0.0',
  'premature-done': '1.0.0',
} as const)

export type VersionedGuardrailsDetector = keyof typeof GUARDRAILS_DETECTOR_VERSIONS

export function guardrailsVersionReport(): {
  policyVersion: number
  detectors: Record<VersionedGuardrailsDetector, string>
} {
  return {
    policyVersion: GUARDRAILS_POLICY_VERSION,
    detectors: { ...GUARDRAILS_DETECTOR_VERSIONS },
  }
}
