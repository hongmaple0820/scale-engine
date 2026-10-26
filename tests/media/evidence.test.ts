// Evidence writer: append-only JSONL, secret-ish keys redacted, full read-back.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { EvidenceWriter, redact } from '../../src/media/evidence/EvidenceWriter.js'

const dir = mkdtempSync(join(tmpdir(), 'media-evidence-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('redact', () => {
  it('masks secret-ish keys wherever they nest', () => {
    const masked = redact({
      args: ['ffmpeg', '-i', 'in.png'],
      env: { API_KEY: 'x', PATH: 'y' },
      nested: { cookie: 'abc', safe: 1 },
    })
    const encoded = JSON.stringify(masked)
    expect(encoded).not.toContain('x')
    expect(encoded).toContain('[redacted]')
    expect(encoded).toContain('in.png')
  })
})

describe('EvidenceWriter', () => {
  it('appends events and reads them back in order', () => {
    const writer = new EvidenceWriter(dir, 'task-evidence-test')
    writer.append('stage:capture', 'ok', { ms: 123 })
    writer.append('stage:encode', 'error', { ms: 5, error: 'boom' })
    const events = writer.readAll()
    expect(events).toHaveLength(2)
    expect(events[0].action).toBe('stage:capture')
    expect(events[0].result).toBe('ok')
    expect(events[1].result).toBe('error')
    expect(events[1].taskId).toBe('task-evidence-test')
    expect(events[0].eventId).not.toBe(events[1].eventId)
  })
})
