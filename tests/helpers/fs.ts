import { existsSync, renameSync, rmSync } from 'node:fs'

export function safeRmSync(path: string): void {
  if (!existsSync(path)) return
  const attempts = process.platform === 'win32' ? 80 : 8
  const delayMs = process.platform === 'win32' ? 250 : 50
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      rmSync(path, {
        recursive: true,
        force: true,
        maxRetries: 1,
        retryDelay: delayMs,
      })
      return
    } catch (error) {
      lastError = error
      if (!isTransientRmError(error)) throw error
      sleepSync(delayMs)
    }
  }

  if (!existsSync(path)) return
  const quarantinePath = `${path}.delete-pending-${process.pid}-${Date.now()}`
  try {
    renameSync(path, quarantinePath)
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        rmSync(quarantinePath, {
          recursive: true,
          force: true,
          maxRetries: 1,
          retryDelay: delayMs,
        })
        return
      } catch (error) {
        lastError = error
        if (!isTransientRmError(error)) throw error
        sleepSync(delayMs)
      }
    }
  } catch (error) {
    lastError = error
    if (!isTransientRmError(error)) throw error
  }

  if (!isTransientRmError(lastError)) throw lastError
}

function isTransientRmError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: string }).code
  return code === 'EPERM' || code === 'EBUSY' || code === 'ENOTEMPTY'
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}
