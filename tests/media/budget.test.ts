// Daily media budget (M2): estimate → reserve → settle with idempotent
// reservations, lazy expiry, and the JobService wiring. Spend never exceeds
// today's budget because the reserve happens before any provider call.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  budgetEntries,
  budgetSummary,
  createJob,
  getJob,
  projectBudgetSummary,
  reserveBudget,
  runJob,
  settleBudget,
  MediaError,
} from '../../src/media/index.js'
import { ModelUsageLedger } from '../../src/runtime/ModelUsageLedger.js'

const root = mkdtempSync(join(tmpdir(), 'media-budget-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const ENV_KEYS = [
  'MEDIA_DAILY_BUDGET_CNY',
  'MEDIA_BUDGET_RESERVATION_TTL_MINUTES',
  'MEDIA_FEATURE_SPEECH',
  'MEDIA_APPROVAL_MODE',
  'MEDIA_APPROVAL_THRESHOLD_CNY',
] as const

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key]
}

beforeEach(clearEnv)
afterEach(clearEnv)

/** Midday UTC today: stable day bucket regardless of the host timezone. */
function middayUtc(offsetMinutes = 0): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, offsetMinutes))
}

describe('budget ledger', () => {
  // Each case gets its own root: entries are day-scoped, and a shared file
  // would leak another case's reservations into this one's budget.
  let ledgerRoot = ''
  beforeEach(() => {
    ledgerRoot = mkdtempSync(join(tmpdir(), 'media-budget-ledger-'))
  })
  afterEach(() => {
    rmSync(ledgerRoot, { recursive: true, force: true })
  })

  it('reserves, refuses over-budget work, and settles at the actual amount', () => {
    process.env.MEDIA_DAILY_BUDGET_CNY = '5'
    const at = middayUtc()
    const first = reserveBudget({ root: ledgerRoot, taskId: 'job-budget-1', projectId: 'budget', estimatedCny: 3, now: at })
    expect(first.status).toBe('reserved')
    expect(budgetSummary(ledgerRoot, at).spentCny).toBe(3)

    expect(() => reserveBudget({ root: ledgerRoot, taskId: 'job-budget-2', projectId: 'budget', estimatedCny: 3, now: at })).toThrow(
      MediaError,
    )
    expect(budgetSummary(ledgerRoot, at).spentCny).toBe(3)

    // Settling at a lower actual frees the difference for the next reserve.
    settleBudget({ root: ledgerRoot, taskId: 'job-budget-1', actualCny: 2, now: at })
    expect(budgetSummary(ledgerRoot, at).spentCny).toBe(2)
    expect(reserveBudget({ root: ledgerRoot, taskId: 'job-budget-2', projectId: 'budget', estimatedCny: 3, now: at }).status).toBe('reserved')
    expect(budgetSummary(ledgerRoot, at).spentCny).toBe(5)
  })

  it('is idempotent per task: a retried run reuses its active reservation', () => {
    const at = middayUtc()
    const first = reserveBudget({ root: ledgerRoot, taskId: 'job-budget-idem', projectId: 'budget', estimatedCny: 2, now: at })
    const second = reserveBudget({ root: ledgerRoot, taskId: 'job-budget-idem', projectId: 'budget', estimatedCny: 2, now: at })
    expect(second.createdAt).toBe(first.createdAt)
    expect(budgetEntries(ledgerRoot).filter(entry => entry.taskId === 'job-budget-idem' && entry.status === 'reserved')).toHaveLength(1)
  })

  it('never invents spend for unknown estimates (reserve 0, settle keeps it unknown)', () => {
    process.env.MEDIA_DAILY_BUDGET_CNY = '0'
    const at = middayUtc()
    const entry = reserveBudget({ root: ledgerRoot, taskId: 'job-budget-unknown', projectId: 'budget', estimatedCny: null, now: at })
    expect(entry.reservedCny).toBe(0)
    const settled = settleBudget({ root: ledgerRoot, taskId: 'job-budget-unknown', actualCny: null, now: at })
    expect(settled?.status).toBe('settled')
    expect(settled?.actualCny).toBeUndefined()
    expect(budgetSummary(ledgerRoot, at).spentCny).toBe(0)
  })

  it('reclaims expired reservations lazily', () => {
    process.env.MEDIA_DAILY_BUDGET_CNY = '5'
    process.env.MEDIA_BUDGET_RESERVATION_TTL_MINUTES = '1'
    const earlier = middayUtc(-30)
    reserveBudget({ root: ledgerRoot, taskId: 'job-budget-stale', projectId: 'budget', estimatedCny: 4, now: earlier })
    expect(budgetSummary(ledgerRoot, earlier).spentCny).toBe(4)

    const now = middayUtc()
    expect(budgetSummary(ledgerRoot, now).spentCny).toBe(0)
    // The stale reservation is marked expired by the next mutation.
    reserveBudget({ root: ledgerRoot, taskId: 'job-budget-fresh', projectId: 'budget', estimatedCny: 4, now })
    const stale = budgetEntries(ledgerRoot).find(entry => entry.taskId === 'job-budget-stale')
    expect(stale?.status).toBe('expired')
    expect(budgetSummary(ledgerRoot, now).spentCny).toBe(4)
  })
})

describe('budget wiring in JobService', () => {
  it('reserves, settles and records the media cost in the unified ledger', async () => {
    clearEnv()
    process.env.MEDIA_FEATURE_SPEECH = 'mock'
    const created = createJob({
      root,
      projectId: 'wiring',
      type: 'generate_speech',
      speechRequest: { text: 'budget wiring', providerId: 'mock-speech', voice: 'alloy', format: 'wav' },
    })
    expect(created.job.cost?.estimatedCny).toBe(0)
    const job = await runJob({ root, projectId: 'wiring', taskId: created.job.id })
    expect(job.status).toBe('succeeded')

    const entry = budgetEntries(root).find(candidate => candidate.taskId === created.job.id)
    expect(entry).toMatchObject({ status: 'settled', actualCny: 0, reservedCny: 0 })
    expect(projectBudgetSummary(root, 'wiring').entries.some(candidate => candidate.taskId === created.job.id)).toBe(true)

    // ADR-8: media cost lands in the one usage ledger under metadata.domain=media.
    const ledger = new ModelUsageLedger(join(root, '.scale'))
    const records = ledger.list({ taskId: created.job.id })
    const media = records.find(record => record.metadata?.domain === 'media')
    expect(media).toBeDefined()
    expect(media?.metadata?.costCny).toBe(0)
    expect(media?.metadata?.jobType).toBe('generate_speech')
    expect(media?.metadata?.costStatus).toBe('actual')
  })
})
