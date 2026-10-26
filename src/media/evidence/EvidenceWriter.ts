// Evidence writer (v3 plan §14): one JSONL per task under evidence/.
// Only explicitly provided fields are recorded — never environment, secrets,
// or raw provider payloads. Binary/argv fields go through redact().

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { EvidenceEvent } from '../types.js'

const SECRETISH_KEYS = /(token|secret|password|cookie|authorization|api[-_]?key)/i

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        SECRETISH_KEYS.test(key) ? '[redacted]' : redact(entry),
      ]),
    )
  }
  return value
}

export class EvidenceWriter {
  private readonly path: string

  constructor(taskDir: string, private readonly taskId: string) {
    const dir = join(taskDir, 'evidence')
    mkdirSync(dir, { recursive: true })
    this.path = join(dir, 'events.jsonl')
  }

  append(action: string, result: 'ok' | 'error', data?: Record<string, unknown>): EvidenceEvent {
    const event: EvidenceEvent = {
      eventId: randomUUID(),
      at: new Date().toISOString(),
      taskId: this.taskId,
      actor: 'scale-media',
      action,
      result,
      data: data === undefined ? undefined : (redact(data) as Record<string, unknown>),
    }
    writeFileSync(this.path, JSON.stringify(event) + '\n', { flag: 'a', encoding: 'utf-8' })
    return event
  }

  readAll(): EvidenceEvent[] {
    if (!existsSync(this.path)) return []
    return readFileSync(this.path, 'utf-8').split('\n').filter(Boolean).map(line => JSON.parse(line) as EvidenceEvent)
  }
}
