// Approval gate (M2, ADR-7): policy (off/always/threshold, unknown cost is
// fail-closed), append-only store semantics (latest wins, expiry, double
// decision), and the JobService integration: create → awaiting_approval →
// decide → created/cancelled, with run blocked until a decision exists.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  appendApprovalRecord,
  createJob,
  decideJobApproval,
  findApproval,
  getJob,
  listProjectApprovals,
  recoverJobs,
  requestApprovalRecord,
  decideApproval,
  decideApprovalRecord,
  readApprovalRecords,
  retryJob,
  runJob,
  MediaError,
} from '../../src/media/index.js'
import { ExecutionLedger } from '../../src/runtime/ExecutionLedger.js'

const root = mkdtempSync(join(tmpdir(), 'media-approvals-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const ENV_KEYS = [
  'MEDIA_APPROVAL_MODE',
  'MEDIA_APPROVAL_THRESHOLD_CNY',
  'MEDIA_APPROVAL_TTL_MINUTES',
  'MEDIA_OPENAI_API_KEY',
] as const

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key]
}

beforeEach(clearEnv)
afterEach(clearEnv)

const THRESHOLD_ACTION = { id: 'media.test', approval: { mode: 'threshold' as const, thresholdCny: 5 } }
const NEVER_ACTION = { id: 'media.free', approval: { mode: 'never' as const } }

describe('approval policy', () => {
  it('off never asks, always always asks', () => {
    process.env.MEDIA_APPROVAL_MODE = 'off'
    expect(decideApproval(THRESHOLD_ACTION, 100).required).toBe(false)
    process.env.MEDIA_APPROVAL_MODE = 'always'
    expect(decideApproval(THRESHOLD_ACTION, 0)).toMatchObject({ required: true, mode: 'always' })
    expect(decideApproval(NEVER_ACTION, 0)).toMatchObject({ required: true, mode: 'always' })
  })

  it('threshold mode: fail-closed on unknown cost, never-mode skips, boundary is inclusive', () => {
    clearEnv()
    expect(decideApproval(THRESHOLD_ACTION, null)).toMatchObject({ required: true, reason: expect.stringContaining('fail-closed') })
    expect(decideApproval(NEVER_ACTION, null).required).toBe(false)
    expect(decideApproval(THRESHOLD_ACTION, 4.99).required).toBe(false)
    expect(decideApproval(THRESHOLD_ACTION, 5).required).toBe(true)
    expect(decideApproval(THRESHOLD_ACTION, 0).required).toBe(false)
  })

  it('honours the env threshold override and ignores invalid values', () => {
    clearEnv()
    process.env.MEDIA_APPROVAL_THRESHOLD_CNY = '0'
    expect(decideApproval(THRESHOLD_ACTION, 0).required).toBe(true)
    process.env.MEDIA_APPROVAL_THRESHOLD_CNY = 'nope'
    // invalid override falls back to the manifest/default threshold, never to 0
    expect(decideApproval(THRESHOLD_ACTION, 4.99).required).toBe(false)
  })

  it('ignores an unknown mode instead of disabling the gate', () => {
    process.env.MEDIA_APPROVAL_MODE = 'yolo'
    expect(decideApproval(THRESHOLD_ACTION, null).required).toBe(true)
  })
})

describe('approval store', () => {
  it('latest record wins and double decisions are refused', () => {
    const requested = requestApprovalRecord({
      root,
      taskId: 'job-test-1',
      projectId: 'store',
      jobType: 'generate_image',
      actionId: 'media.generate_image',
      mode: 'threshold',
      estimatedCny: null,
    })
    expect(findApproval(root, requested.id)?.status).toBe('pending')

    const approved = decideApprovalRecord({ root, id: requested.id, approve: true, decidedBy: 'tester' })
    expect(approved.status).toBe('approved')
    expect(findApproval(root, requested.id)?.status).toBe('approved')
    expect(readApprovalRecords(root).filter(record => record.id === requested.id)).toHaveLength(2)

    expect(() => decideApprovalRecord({ root, id: requested.id, approve: false, decidedBy: 'tester' })).toThrow(MediaError)
  })

  it('refuses decisions for unknown approvals', () => {
    try {
      decideApprovalRecord({ root, id: 'apr-does-not-exist', approve: true, decidedBy: 'tester' })
      throw new Error('expected decideApprovalRecord to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(MediaError)
      expect((error as MediaError).code).toBe('MEDIA_APPROVAL_INVALID')
    }
  })

  it('expires overdue requests on decision and on sweep', () => {
    process.env.MEDIA_APPROVAL_TTL_MINUTES = '1'
    const old = new Date(Date.now() - 10 * 60_000)
    const overdue = requestApprovalRecord({
      root,
      taskId: 'job-test-expired',
      projectId: 'store',
      jobType: 'generate_image',
      actionId: 'media.generate_image',
      mode: 'threshold',
      estimatedCny: null,
      now: old,
    })
    try {
      decideApprovalRecord({ root, id: overdue.id, approve: true, decidedBy: 'tester' })
      throw new Error('expected decideApprovalRecord to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(MediaError)
      expect((error as MediaError).code).toBe('MEDIA_APPROVAL_EXPIRED')
    }
    expect(findApproval(root, overdue.id)?.status).toBe('expired')
  })
})

describe('job service approval flow', () => {
  it('unknown provider cost creates an awaiting_approval job and blocks run', async () => {
    clearEnv()
    const created = createJob({
      root,
      projectId: 'flow',
      type: 'generate_image',
      imageRequest: { prompt: 'needs approval', size: '1024x1024', providerId: 'openai-compatible' },
    })
    expect(created.job.status).toBe('awaiting_approval')
    expect(created.job.approval?.status).toBe('pending')
    expect(created.job.approval?.estimatedCny).toBeNull()

    const pending = listProjectApprovals(root, 'flow')
    expect(pending.some(record => record.id === created.job.approval?.id && record.taskId === created.job.id)).toBe(true)

    await expect(runJob({ root, projectId: 'flow', taskId: created.job.id })).rejects.toThrow(/awaiting approval/)
    expect(getJob(root, 'flow', created.job.id).job.status).toBe('awaiting_approval')
  })

  it('approving flips the job back to created; rejecting cancels it', () => {
    clearEnv()
    const first = createJob({
      root,
      projectId: 'flow',
      type: 'generate_image',
      imageRequest: { prompt: 'approve me', size: '1024x1024', providerId: 'openai-compatible' },
    })
    const approved = decideJobApproval({
      root,
      projectId: 'flow',
      approvalId: first.job.approval?.id ?? '',
      approve: true,
      decidedBy: 'tester',
    })
    expect(approved.approval.status).toBe('approved')
    expect(approved.job?.status).toBe('created')
    expect(approved.job?.approval?.status).toBe('approved')

    // Ledger keeps the approval trail without a second store (ADR-8 / plan §M2).
    const events = new ExecutionLedger({ projectDir: root }).query({ taskId: first.job.id, limit: 50 })
    expect(events.some(event => event.type === 'approval.requested' && event.metadata?.domain === 'media')).toBe(true)
    expect(events.some(event => event.type === 'approval.resolved' && event.metadata?.approvalStatus === 'approved')).toBe(true)

    const second = createJob({
      root,
      projectId: 'flow',
      type: 'generate_image',
      imageRequest: { prompt: 'reject me', size: '1024x1024', providerId: 'openai-compatible' },
    })
    const rejected = decideJobApproval({
      root,
      projectId: 'flow',
      approvalId: second.job.approval?.id ?? '',
      approve: false,
      decidedBy: 'tester',
      reason: 'too expensive',
    })
    expect(rejected.approval.status).toBe('rejected')
    expect(rejected.job?.status).toBe('cancelled')

    // A rejected task is terminal: run is a no-op, never a provider call.
    const afterReject = getJob(root, 'flow', second.job.id).job
    expect(afterReject.status).toBe('cancelled')
  })

  it('approved jobs start for real (they fail on the missing provider key, not on approval)', async () => {
    clearEnv()
    delete process.env.MEDIA_OPENAI_API_KEY
    const created = createJob({
      root,
      projectId: 'flow',
      type: 'generate_image',
      imageRequest: { prompt: 'approved', size: '1024x1024', providerId: 'openai-compatible' },
    })
    decideJobApproval({ root, projectId: 'flow', approvalId: created.job.approval?.id ?? '', approve: true, decidedBy: 'tester' })
    await expect(runJob({ root, projectId: 'flow', taskId: created.job.id })).rejects.toThrow(/MEDIA_OPENAI_API_KEY/)
    expect(getJob(root, 'flow', created.job.id).job.error?.code).toBe('MEDIA_PROVIDER_UNAVAILABLE')
  })

  it('gates a zero-cost action once the threshold is zero, then approves end-to-end', async () => {
    clearEnv()
    process.env.MEDIA_APPROVAL_THRESHOLD_CNY = '0'
    const created = createJob({
      root,
      projectId: 'flow',
      type: 'generate_image',
      imageRequest: { prompt: 'threshold zero', size: '1024x1024', providerId: 'mock' },
    })
    // inclusive boundary: estimate 0 >= threshold 0 asks for a human
    expect(created.job.status).toBe('awaiting_approval')
    expect(created.job.cost?.estimatedCny).toBe(0)

    const decided = decideJobApproval({
      root,
      projectId: 'flow',
      approvalId: created.job.approval?.id ?? '',
      approve: true,
      decidedBy: 'tester',
    })
    expect(decided.job?.status).toBe('created')

    const job = await runJob({ root, projectId: 'flow', taskId: created.job.id })
    expect(job.status).toBe('succeeded')
    expect(job.outputs[0].kind).toBe('image')
  }, 60000)

  it('cancels a parked task once its approval expires (lazy detail sweep)', () => {
    clearEnv()
    const created = createJob({
      root,
      projectId: 'flow',
      type: 'generate_image',
      imageRequest: { prompt: 'expire me', size: '1024x1024', providerId: 'openai-compatible' },
    })
    const pending = findApproval(root, created.job.approval?.id ?? '')
    expect(pending?.status).toBe('pending')
    appendApprovalRecord(root, { ...pending!, expiresAt: new Date(Date.now() - 1000).toISOString() })

    const detail = getJob(root, 'flow', created.job.id).job
    expect(detail.status).toBe('cancelled')
    expect(detail.error?.code).toBe('MEDIA_APPROVAL_EXPIRED')
    expect(findApproval(root, pending!.id)?.status).toBe('expired')
  })

  it('deciding an expired request cancels the job and reports EXPIRED', () => {
    clearEnv()
    const created = createJob({
      root,
      projectId: 'flow',
      type: 'generate_image',
      imageRequest: { prompt: 'decide expired', size: '1024x1024', providerId: 'openai-compatible' },
    })
    const pending = findApproval(root, created.job.approval?.id ?? '')
    appendApprovalRecord(root, { ...pending!, expiresAt: new Date(Date.now() - 1000).toISOString() })

    try {
      decideJobApproval({ root, projectId: 'flow', approvalId: pending!.id, approve: true, decidedBy: 'tester' })
      throw new Error('expected decideJobApproval to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(MediaError)
      expect((error as MediaError).code).toBe('MEDIA_APPROVAL_EXPIRED')
    }
    expect(getJob(root, 'flow', created.job.id).job.status).toBe('cancelled')
  })

  it('retry and recover never bypass a pending approval', async () => {
    clearEnv()
    const created = createJob({
      root,
      projectId: 'flow',
      type: 'generate_image',
      imageRequest: { prompt: 'no bypass', size: '1024x1024', providerId: 'openai-compatible' },
    })
    expect(() => retryJob({ root, projectId: 'flow', taskId: created.job.id })).toThrow(/not retryable/)
    expect(recoverJobs(root, 'flow')).toEqual([])
    await expect(runJob({ root, projectId: 'flow', taskId: created.job.id })).rejects.toThrow(/awaiting approval/)
    expect(getJob(root, 'flow', created.job.id).job.status).toBe('awaiting_approval')
    expect(findApproval(root, created.job.approval?.id ?? '')?.status).toBe('pending')
  })

  it('MEDIA_APPROVAL_MODE=off bypasses the gate; free actions never ask', () => {
    clearEnv()
    const mockFree = createJob({
      root,
      projectId: 'flow',
      type: 'generate_image',
      imageRequest: { prompt: 'free', size: '1024x1024', providerId: 'mock' },
    })
    expect(mockFree.job.status).toBe('created')
    expect(mockFree.job.approval).toBeUndefined()

    process.env.MEDIA_APPROVAL_MODE = 'off'
    const bypassed = createJob({
      root,
      projectId: 'flow',
      type: 'generate_image',
      imageRequest: { prompt: 'bypassed', size: '1024x1024', providerId: 'openai-compatible' },
    })
    expect(bypassed.job.status).toBe('created')
    expect(bypassed.job.approval).toBeUndefined()
  })
})
