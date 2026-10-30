// Streamed hashing for media files. Provider outputs and materialized assets
// can be large, so hashing never loads a whole file into memory.

import { createHash } from 'node:crypto'
import { closeSync, openSync, readSync } from 'node:fs'

const CHUNK_BYTES = 1024 * 1024

export function sha256File(path: string): string {
  const hash = createHash('sha256')
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES)
    let read = readSync(fd, buffer, 0, buffer.length, null)
    while (read > 0) {
      hash.update(buffer.subarray(0, read))
      read = readSync(fd, buffer, 0, buffer.length, null)
    }
  } finally {
    closeSync(fd)
  }
  return hash.digest('hex')
}

export function sha256Buffer(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}
