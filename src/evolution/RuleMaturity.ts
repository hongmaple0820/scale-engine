export type RuleMaturityStage = 'shadow' | 'candidate-hook' | 'approved-blocking'

export interface ShadowEvidenceArtifact {
  evidenceId: string
  /** Normalized project-relative path using forward slashes. */
  path: string
  sizeBytes: number
  recordedAt: number
  falsePositive: boolean
}

export interface RuleMaturityRecord {
  ruleId: string
  stage: RuleMaturityStage
  shadowHits: number
  defectEvidenceIds: string[]
  falsePositiveCount: number
  rollback: string
  evidenceIds: string[]
  /** Absent on legacy records written before evidence provenance was persisted. */
  evidenceManifestVersion?: 1
  evidenceArtifacts?: ShadowEvidenceArtifact[]
  approvedBy?: string
  approvedAt?: number
  createdAt: number
  updatedAt: number
}

export interface CreateShadowRuleMaturityInput {
  ruleId: string
  rollback: string
  defectEvidenceIds?: string[]
  now?: number
}

export interface RecordShadowHitInput {
  evidenceId?: string
  evidenceArtifact?: ShadowEvidenceArtifact
  falsePositive?: boolean
  now?: number
}

export interface RulePromotionThresholds {
  minShadowHits?: number
  minDefectEvidence?: number
  maxFalsePositiveRate?: number
}

export interface RulePromotionDecision {
  eligible: boolean
  nextStage: RuleMaturityStage
  blockers: string[]
}

const DEFAULT_THRESHOLDS: Required<RulePromotionThresholds> = {
  minShadowHits: 10,
  minDefectEvidence: 1,
  maxFalsePositiveRate: 0.2,
}

export function createShadowRuleMaturity(input: CreateShadowRuleMaturityInput): RuleMaturityRecord {
  const now = input.now ?? Date.now()
  return {
    ruleId: input.ruleId,
    stage: 'shadow',
    shadowHits: 0,
    defectEvidenceIds: unique(input.defectEvidenceIds ?? []),
    falsePositiveCount: 0,
    rollback: input.rollback,
    evidenceIds: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function recordShadowHit(record: RuleMaturityRecord, input: RecordShadowHitInput = {}): RuleMaturityRecord {
  return {
    ...record,
    shadowHits: record.shadowHits + 1,
    falsePositiveCount: record.falsePositiveCount + (input.falsePositive ? 1 : 0),
    evidenceIds: unique([
      ...record.evidenceIds,
      ...(input.evidenceId ? [input.evidenceId] : []),
    ]),
    ...(input.evidenceArtifact ? {
      evidenceManifestVersion: 1 as const,
      evidenceArtifacts: [...(record.evidenceArtifacts ?? []), input.evidenceArtifact],
    } : {}),
    updatedAt: input.now ?? Date.now(),
  }
}

export function evaluateRulePromotion(
  record: RuleMaturityRecord,
  thresholds: RulePromotionThresholds = {},
): RulePromotionDecision {
  const resolved = { ...DEFAULT_THRESHOLDS, ...thresholds }
  const blockers: string[] = []

  if (record.shadowHits < resolved.minShadowHits) {
    blockers.push(`shadow hits ${record.shadowHits}/${resolved.minShadowHits}`)
  }
  if (record.defectEvidenceIds.length < resolved.minDefectEvidence) {
    blockers.push(`defect evidence ${record.defectEvidenceIds.length}/${resolved.minDefectEvidence}`)
  }
  if (!record.rollback.trim()) {
    blockers.push('rollback method is required')
  }

  const falsePositiveRate = record.shadowHits === 0 ? 0 : record.falsePositiveCount / record.shadowHits
  if (falsePositiveRate > resolved.maxFalsePositiveRate) {
    blockers.push(`false positive rate ${falsePositiveRate.toFixed(2)} exceeds ${resolved.maxFalsePositiveRate}`)
  }

  return {
    eligible: blockers.length === 0,
    nextStage: blockers.length === 0 ? 'candidate-hook' : record.stage,
    blockers,
  }
}

export function approveRuleMaturity(record: RuleMaturityRecord, approvedBy: string, now = Date.now()): RuleMaturityRecord {
  const decision = evaluateRulePromotion(record)
  if (!decision.eligible) {
    throw new Error(`Rule ${record.ruleId} is not eligible for blocking approval: ${decision.blockers.join('; ')}`)
  }

  return {
    ...record,
    stage: 'approved-blocking',
    approvedBy,
    approvedAt: now,
    updatedAt: now,
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
