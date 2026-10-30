// Approval contracts (M2, ADR-7). Approvals are a media-domain record: the
// job snapshot carries a reference, the append-only JSONL store is the audit
// trail, and ExecutionLedger records requested/resolved events.

export type ApprovalMode = 'off' | 'threshold' | 'always'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'

export interface ApprovalRecord {
  id: string
  taskId: string
  projectId: string
  jobType: string
  actionId: string | null
  status: ApprovalStatus
  mode: 'threshold' | 'always'
  estimatedCny: number | null
  thresholdCny?: number
  requestedAt: string
  expiresAt: string
  decidedAt?: string
  decidedBy?: string
  reason?: string
}

export interface ApprovalDecision {
  required: boolean
  /** only set when required */
  mode?: 'threshold' | 'always'
  thresholdCny?: number
  reason: string
}
