// Cross-process file lock — mkdir atomicity, TTL steal, sync API.
//
// Why sync: InstinctStore.save() is a synchronous read-modify-write called
// from sync contexts (cortex extract, tests); an async lock would break the
// API. Contention is rare (governance writes are low-frequency), so bounded
// spinning with Atomics.wait backoff is acceptable — Atomics.wait on the main
// thread is permitted in Node and sleeps without burning CPU.
//
// Protocol (spike docs/plans/2026-10-25-scale-concurrency-spike.md §3):
//   acquire  = mkdir(lockDir)               — atomic: exactly one winner
//   metadata = { pid, at } written inside   — crash residue is detectable
//   steal    = rename to unique name, rm    — rename is the atomic claim, so
//                                             two stealers cannot both win
//   release  = rmSync(lockDir)              — a racing stealer's rename then
//                                             fails and falls back to retry

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface FileLockOptions {
  /** a lock whose holder looks dead after this long may be stolen (default 10s) */
  ttlMs?: number
  /** total time to wait before throwing (default 15s) */
  waitMs?: number
  /** sleep between attempts (default 25ms) */
  retryDelayMs?: number
}

export class FileLockTimeoutError extends Error {
  constructor(key: string, waitedMs: number) {
    super(`file lock "${key}" not acquired after ${waitedMs}ms`)
    this.name = 'FileLockTimeoutError'
  }
}

const sharedSleeper = new Int32Array(new SharedArrayBuffer(4))

function sleepSync(ms: number): void {
  Atomics.wait(sharedSleeper, 0, 0, ms)
}

function lockDir(lockRoot: string, key: string): string {
  const safeKey = createHash('sha256').update(key).digest('hex').slice(0, 16)
  return join(lockRoot, `${safeKey}.lock`)
}

function isStale(dir: string, ttlMs: number, now: number): boolean {
  try {
    const meta = JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf-8')) as { at?: number }
    const at = typeof meta.at === 'number' ? meta.at : 0
    return now - at > ttlMs
  } catch {
    // unreadable/missing metadata — fall back to nothing (never steal blind)
    return false
  }
}

export interface SyncFileLock {
  release(): void
}

/**
 * Acquire an exclusive cross-process lock on `key`, waiting up to waitMs.
 * Throws FileLockTimeoutError when the holder never releases and the lock
 * is not stale. Always pair with release() (try/finally).
 */
export function acquireFileSync(key: string, lockRoot: string, options: FileLockOptions = {}): SyncFileLock {
  const ttlMs = options.ttlMs ?? 10_000
  const waitMs = options.waitMs ?? 15_000
  const retryDelayMs = options.retryDelayMs ?? 25
  const dir = lockDir(lockRoot, key)
  const started = Date.now()

  for (;;) {
    try {
      mkdirSync(dir, { recursive: false })
      try {
        writeFileSync(join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, at: Date.now() }), 'utf-8')
      } catch {
        // metadata is advisory (TTL only) — lock still valid without it
      }
      let released = false
      return {
        release() {
          if (released) return
          released = true
          try { rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort; TTL cleans up */ }
        },
      }
    } catch (error) {
      const exists = (error as NodeJS.ErrnoException).code === 'EEXIST'
      if (!exists) {
        // real failure creating the lock (permissions, missing parent) — retry
        // after creating the parent once; surface if it persists
        try { mkdirSync(lockRoot, { recursive: true }) } catch { /* handled by retry/timeout */ }
      } else if (isStale(dir, ttlMs, Date.now())) {
        // atomic steal: only one racer's rename succeeds
        const stealName = `${dir}.stale-${process.pid}-${randomUUID().slice(0, 8)}`
        try {
          renameSync(dir, stealName)
          rmSync(stealName, { recursive: true, force: true })
          continue // immediately retry the mkdir
        } catch {
          // someone else stole it first — plain retry
        }
      }
      if (Date.now() - started >= waitMs) throw new FileLockTimeoutError(key, Date.now() - started)
      sleepSync(retryDelayMs)
    }
  }
}

/** Run fn() while holding the lock; always releases. */
export function withFileLockSync<T>(key: string, lockRoot: string, fn: () => T, options?: FileLockOptions): T {
  const lock = acquireFileSync(key, lockRoot, options)
  try {
    return fn()
  } finally {
    lock.release()
  }
}
