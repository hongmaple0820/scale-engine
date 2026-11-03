// Daily media budget with estimate → reserve → settle (M2). One JSON file per
// workspace root; every mutation takes its own cross-process lock. A reserved
// entry counts against today's budget until it settles or expires; crashed
// reservations are reclaimed lazily by the next reserve/settle call.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { acquireFileSync } from '../../core/FileLock.js'
import { MediaError } from '../errors.js'
import { budgetReservationTtlMinutes, dailyBudgetCny } from '../approvals/policy.js'

export type BudgetEntryStatus = 'reserved' | 'settled' | 'expired'

export interface BudgetEntry {
  taskId: string
  projectId: string
  day: string
  /** null when the estimate is unconfirmed — reserved at 0, gated by approval */
  estimatedCny: number | null
  reservedCny: number
  actualCny?: number
  status: BudgetEntryStatus
  createdAt: string
  updatedAt: string
  expiresAt: string
}

interface BudgetFile {
  schemaVersion: 1
  entries: BudgetEntry[]
}

export function budgetFilePath(root: string): string {
  return join(root, '.scale', 'state', 'media', 'budget.json')
}

function lockRoot(root: string): string {
  return join(root, '.scale', 'state', 'media', 'locks')
}

function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function readBudget(root: string): BudgetFile {
  const path = budgetFilePath(root)
  if (!existsSync(path)) return { schemaVersion: 1, entries: [] }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<BudgetFile>
    return { schemaVersion: 1, entries: Array.isArray(parsed.entries) ? parsed.entries : [] }
  } catch {
    return { schemaVersion: 1, entries: [] }
  }
}

function writeBudget(root: string, file: BudgetFile): void {
  const path = budgetFilePath(root)
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${randomUUID().slice(0, 8)}.tmp`
  writeFileSync(tmp, JSON.stringify(file, null, 1), 'utf-8')
  renameSync(tmp, path)
}

function withBudgetLock<T>(root: string, fn: () => T): T {
  const lock = acquireFileSync('media-budget', lockRoot(root), { ttlMs: 10_000, waitMs: 5_000 })
  try {
    return fn()
  } finally {
    lock.release()
  }
}

function reclaimExpired(file: BudgetFile, now: Date): void {
  for (const entry of file.entries) {
    if (entry.status !== 'reserved') continue
    if (Date.parse(entry.expiresAt) > now.getTime()) continue
    entry.status = 'expired'
    entry.updatedAt = now.toISOString()
  }
}

/** Spend for `day`: settled actuals plus still-active reservations. */
export function spendForDay(file: BudgetFile, day: string, now: Date = new Date()): number {
  let total = 0
  for (const entry of file.entries) {
    if (entry.day !== day) continue
    if (entry.status === 'settled') total += entry.actualCny ?? entry.estimatedCny ?? 0
    else if (entry.status === 'reserved' && Date.parse(entry.expiresAt) > now.getTime()) total += entry.reservedCny
  }
  return total
}

export interface ReserveBudgetInput {
  root: string
  taskId: string
  projectId: string
  estimatedCny: number | null
  now?: Date
}

/**
 * Reserve the estimate for a task. Unknown estimates reserve 0 (approval is
 * the gate for those). Throws MEDIA_BUDGET_EXCEEDED before anything is spent.
 */
export function reserveBudget(input: ReserveBudgetInput): BudgetEntry {
  const now = input.now ?? new Date()
  return withBudgetLock(input.root, () => {
    const file = readBudget(input.root)
    reclaimExpired(file, now)
    // Idempotent per task: a retried run (or a reattach after a crash) reuses
    // its active reservation instead of reserving the same estimate twice.
    const active = [...file.entries].reverse().find(entry => entry.taskId === input.taskId && entry.status === 'reserved')
    if (active) return active
    const day = dayOf(now)
    const budget = dailyBudgetCny()
    const reserved = input.estimatedCny === null ? 0 : Math.max(0, input.estimatedCny)
    const spent = spendForDay(file, day, now)
    if (reserved > 0 && spent + reserved > budget) {
      throw new MediaError(
        'MEDIA_BUDGET_EXCEEDED',
        `daily media budget exceeded: spent ${spent.toFixed(2)} + reserve ${reserved.toFixed(2)} > ${budget.toFixed(2)} CNY (${day})`,
      )
    }
    const entry: BudgetEntry = {
      taskId: input.taskId,
      projectId: input.projectId,
      day,
      estimatedCny: input.estimatedCny,
      reservedCny: reserved,
      status: 'reserved',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + budgetReservationTtlMinutes() * 60_000).toISOString(),
    }
    file.entries.push(entry)
    writeBudget(input.root, file)
    return entry
  })
}

export interface SettleBudgetInput {
  root: string
  taskId: string
  /** actual provider cost; null/undefined keeps the estimate (never invents spend) */
  actualCny?: number | null
  now?: Date
}

export function settleBudget(input: SettleBudgetInput): BudgetEntry | undefined {
  const now = input.now ?? new Date()
  return withBudgetLock(input.root, () => {
    const file = readBudget(input.root)
    reclaimExpired(file, now)
    const entry = [...file.entries].reverse().find(candidate => candidate.taskId === input.taskId)
    if (!entry || entry.status !== 'reserved') return entry
    entry.status = 'settled'
    // Never invent spend: an unknown estimate with nothing reserved stays
    // unknown (actualCny unset) instead of being recorded as a 0 spent.
    const resolvedActual =
      typeof input.actualCny === 'number' && Number.isFinite(input.actualCny) && input.actualCny >= 0
        ? input.actualCny
        : entry.estimatedCny ?? (entry.reservedCny > 0 ? entry.reservedCny : undefined)
    if (resolvedActual !== undefined) entry.actualCny = resolvedActual
    entry.updatedAt = now.toISOString()
    writeBudget(input.root, file)
    return entry
  })
}

export function budgetEntries(root: string): BudgetEntry[] {
  return readBudget(root).entries
}

export function budgetSummary(root: string, now: Date = new Date()): { day: string; budgetCny: number; spentCny: number; entries: BudgetEntry[] } {
  const day = dayOf(now)
  const file = readBudget(root)
  return { day, budgetCny: dailyBudgetCny(), spentCny: spendForDay(file, day, now), entries: file.entries }
}
