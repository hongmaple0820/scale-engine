// Ledger adapter (v3 plan M0): media writes structured summaries into the
// existing ExecutionLedger — one event format, no storyboard/provider payloads.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ExecutionLedger } from '../../src/runtime/ExecutionLedger.js'
import { MEDIA_LEDGER_AGENT_ID, mediaSessionId, recordMediaLedgerEvent } from '../../src/media/jobs/ledger.js'
import type { MediaJob } from '../../src/media/types.js'

const root = mkdtempSync(join(tmpdir(), 'media-ledger-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const job: MediaJob = {
  id: 'job-test-1',
  projectId: 'p1',
  type: 'render',
  status: 'created',
  schemaVersion: 1,
  createdAt: '2026-10-29T00:00:00.000Z',
  updatedAt: '2026-10-29T00:00:00.000Z',
  requestedBy: 'test',
  attempt: 1,
  outputs: [],
}

describe('media ledger adapter', () => {
  it('writes domain=media summaries into the shared execution ledger', () => {
    recordMediaLedgerEvent(root, job, {
      type: 'tool.invoked',
      summary: 'media.create render',
      metadata: { actionId: 'media.render_storyboard', deduplicated: false },
    })

    const events = new ExecutionLedger({ projectDir: root }).query({ taskId: job.id })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      agentId: MEDIA_LEDGER_AGENT_ID,
      sessionId: mediaSessionId(job.id),
      taskId: job.id,
      type: 'tool.invoked',
      summary: 'media.create render',
      metadata: {
        domain: 'media',
        projectId: 'p1',
        jobType: 'render',
        status: 'created',
        actionId: 'media.render_storyboard',
        deduplicated: false,
      },
    })
    // No storyboard/provider payload: only the action id may mention it.
    const serialized = JSON.stringify(events[0])
    expect(events[0]).not.toHaveProperty('storyboard')
    expect(serialized).not.toContain('"scenes"')
    expect(serialized).not.toContain('"canvas"')
  })

  it('never fails a job when the ledger cannot be written', () => {
    const notADirectory = join(root, 'not-a-directory')
    writeFileSync(notADirectory, 'x')
    expect(() =>
      recordMediaLedgerEvent(notADirectory, job, { type: 'task.started', summary: 'should not throw' }),
    ).not.toThrow()
  })
})
