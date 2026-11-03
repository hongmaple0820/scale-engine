// Append-only approval store: `<root>/.scale/state/media/approvals.jsonl`.
// Each decision appends a new record with the same id; the latest line wins.
// Writes take a dedicated cross-process lock so two dashboards cannot both
// approve one request.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { acquireFileSync } from '../../core/FileLock.js'
import { MediaError } from '../errors.js'
import { approvalTtlMinutes } from './policy.js'
import type { ApprovalRecord } from './types.js'

export function approvalFilePath(root: string): string {
  return join(root, '.scale', 'state', 'media', 'approvals.jsonl')
}

function lockRoot(root: string): string {
  return join(root, '.scale', 'state', 'media', 'locks')
}

export function readApprovalRecords(root: string): ApprovalRecord[] {
  const path = approvalFilePath(root)
  if (!existsSync(path)) return []
  const records: ApprovalRecord[] = []
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    try {
      records.push(JSON.parse(line) as ApprovalRecord)
    } catch {
      // malformed line: ignore for reads (never rewrite the audit trail)
    }
  }
  return records
}

/** Latest record per approval id, newest first by requestedAt. */
export function latestApprovals(root: string, projectId?: string): ApprovalRecord[] {
  const latest = new Map<string, ApprovalRecord>()
  for (const record of readApprovalRecords(root)) {
    if (projectId !== undefined && record.projectId !== projectId) continue
    latest.set(record.id, record)
  }
  return [...latest.values()].sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))
}

export function findApproval(root: string, id: string): ApprovalRecord | undefined {
  return latestApprovals(root).find(record => record.id === id)
}

export function appendApprovalRecord(root: string, record: ApprovalRecord): void {
  const path = approvalFilePath(root)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, JSON.stringify(record) + '\n', 'utf-8')
}

export interface RequestApprovalInput {
  root: string
  taskId: string
  projectId: string
  jobType: string
  actionId: string | null
  mode: 'threshold' | 'always'
  estimatedCny: number | null
  thresholdCny?: number
  now?: Date
}

export function requestApprovalRecord(input: RequestApprovalInput): ApprovalRecord {
  const now = input.now ?? new Date()
  const record: ApprovalRecord = {
    id: `apr-${now.toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`,
    taskId: input.taskId,
    projectId: input.projectId,
    jobType: input.jobType,
    actionId: input.actionId,
    status: 'pending',
    mode: input.mode,
    estimatedCny: input.estimatedCny,
    ...(input.thresholdCny === undefined ? {} : { thresholdCny: input.thresholdCny }),
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + approvalTtlMinutes() * 60_000).toISOString(),
  }
  const lock = acquireFileSync('media-approval', lockRoot(input.root), { ttlMs: 10_000, waitMs: 5_000 })
  try {
    appendApprovalRecord(input.root, record)
  } finally {
    lock.release()
  }
  return record
}

export interface DecideApprovalInput {
  root: string
  id: string
  approve: boolean
  decidedBy: string
  reason?: string
  now?: Date
}

export function decideApprovalRecord(input: DecideApprovalInput): ApprovalRecord {
  const lock = acquireFileSync('media-approval', lockRoot(input.root), { ttlMs: 10_000, waitMs: 5_000 })
  try {
    const now = input.now ?? new Date()
    const current = findApproval(input.root, input.id)
    if (!current) throw new MediaError('MEDIA_APPROVAL_INVALID', `approval "${input.id}" does not exist`)
    if (current.status === 'approved' || current.status === 'rejected') {
      throw new MediaError('MEDIA_APPROVAL_INVALID', `approval "${input.id}" is already ${current.status}`)
    }
    if (current.status === 'expired' || Date.parse(current.expiresAt) <= now.getTime()) {
      const expired: ApprovalRecord = {
        ...current,
        status: 'expired',
        decidedAt: now.toISOString(),
        decidedBy: 'system',
        reason: 'approval expired before a decision',
      }
      appendApprovalRecord(input.root, expired)
      throw new MediaError('MEDIA_APPROVAL_EXPIRED', `approval "${input.id}" expired at ${current.expiresAt}`)
    }
    const decided: ApprovalRecord = {
      ...current,
      status: input.approve ? 'approved' : 'rejected',
      decidedAt: now.toISOString(),
      decidedBy: input.decidedBy,
      ...(input.reason ? { reason: input.reason } : {}),
    }
    appendApprovalRecord(input.root, decided)
    return decided
  } finally {
    lock.release()
  }
}

/** Lazily mark overdue pending approvals; returns the records that expired. */
export function sweepExpiredApprovals(root: string, projectId?: string, now: Date = new Date()): ApprovalRecord[] {
  const expired: ApprovalRecord[] = []
  for (const record of latestApprovals(root, projectId)) {
    if (record.status !== 'pending') continue
    if (Date.parse(record.expiresAt) > now.getTime()) continue
    const next: ApprovalRecord = {
      ...record,
      status: 'expired',
      decidedAt: now.toISOString(),
      decidedBy: 'system',
      reason: 'approval expired before a decision',
    }
    const lock = acquireFileSync('media-approval', lockRoot(root), { ttlMs: 10_000, waitMs: 5_000 })
    try {
      appendApprovalRecord(root, next)
    } finally {
      lock.release()
    }
    expired.push(next)
  }
  return expired
}
