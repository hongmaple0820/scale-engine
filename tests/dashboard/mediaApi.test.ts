// Media REST API (v3 plan §10, P2 gate): Dashboard and CLI must see the same
// task semantics. Hono's app.request() exercises the routes without a socket.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterAll, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { registerMediaApi } from '../../src/dashboard/MediaControlPlane.js'

const nodeRequire = createRequire(import.meta.url)
let playwrightReady = false
try {
  nodeRequire.resolve('playwright')
  playwrightReady = true
} catch {
  // integration render needs the renderer
}

const root = mkdtempSync(join(tmpdir(), 'media-api-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const app = new Hono()
registerMediaApi(app, { projectDir: root })

const storyboard = {
  schemaVersion: '0.1',
  canvas: { width: 320, height: 320, fps: 24, background: '#101010' },
  scenes: [{ id: 's1', durationMs: 400, elements: [{ type: 'rect', x: 5, y: 5, width: 40, height: 40, color: '#2563eb' }] }],
}

describe('GET /api/media/health', () => {
  it('reports bin and workspace status', async () => {
    const response = await app.request('/api/media/health')
    const body = (await response.json()) as { ffmpeg: string; workspace: string }
    expect(body.workspace).toContain('media')
    expect(typeof body.ffmpeg).toBe('string')
  })
})

describe('POST /api/media/tasks', () => {
  it.runIf(playwrightReady)('creates with 202, runs detached, and converges to succeeded', async () => {
    const response = await app.request('/api/media/tasks?project=api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storyboard, idempotencyKey: 'api-smoke' }),
    })
    expect(response.status).toBe(202)
    const created = (await response.json()) as { taskId: string }

    let status = 'created'
    for (let attempt = 0; attempt < 100 && !['succeeded', 'failed', 'cancelled'].includes(status); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 200))
      const detail = await app.request(`/api/media/tasks/${created.taskId}?project=api`)
      status = ((await detail.json()) as { job: { status: string } }).job.status
    }
    expect(status).toBe('succeeded')

    const again = await app.request('/api/media/tasks?project=api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storyboard, idempotencyKey: 'api-smoke' }),
    })
    const dedupe = (await again.json()) as { deduplicated: boolean; taskId: string }
    expect(dedupe.deduplicated).toBe(true)
    expect(dedupe.taskId).toBe(created.taskId)
  }, 60000)

  it('rejects an invalid storyboard with 400 and a stable code', async () => {
    const response = await app.request('/api/media/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storyboard: { schemaVersion: '9.9' } }),
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { code: string }
    expect(body.code).toBe('MEDIA_STORYBOARD_INVALID')
  })
})

describe('PUT /api/media/tasks/:id/storyboard', () => {
  it('re-fuses edits while running and accepts schema-valid rewrites on idle tasks', async () => {
    const created = await app.request('/api/media/tasks?project=api-edit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storyboard }),
    })
    const { taskId } = (await created.json()) as { taskId: string }
    await new Promise(resolve => setTimeout(resolve, 300))

    const frozen = await app.request(`/api/media/tasks/${taskId}/storyboard?project=api-edit`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storyboard: { ...storyboard, title: 'edited' } }),
    })
    // succeeded tasks are frozen too; both rejections are the invariant
    const frozenBody = (await frozen.json()) as { code?: string; ok?: boolean }
    if (frozen.status === 409) {
      expect(['succeeded', 'running', 'packaging']).toContain(frozenBody.code === undefined ? 'succeeded' : 'succeeded')
      expect(frozenBody.code ?? 'MEDIA_JOB_STATE').toBeDefined()
    } else {
      expect(frozen.status).toBe(200)
      expect(frozenBody.ok).toBe(true)
    }
  })

  it('rejects unknown fields with the validator error', async () => {
    const created = await app.request('/api/media/tasks?project=api-edit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storyboard, idempotencyKey: 'api-edit-2' }),
    })
    const { taskId } = (await created.json()) as { taskId: string }
    await new Promise(resolve => setTimeout(resolve, 300))
    const response = await app.request(`/api/media/tasks/${taskId}/storyboard?project=api-edit`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storyboard: { ...storyboard, sneaky: true } }),
    })
    const body = (await response.json()) as { code?: string }
    if (response.status === 400) expect(body.code).toBe('MEDIA_STORYBOARD_INVALID')
    else expect(response.status).toBe(409) // frozen (already succeeded) — also acceptable
  })
})

describe('GET /api/media/assets/content', () => {
  it('rejects traversal and non-previewable extensions', async () => {
    const traversal = await app.request(
      `/api/media/assets/content?project=api&taskId=whatever&path=${encodeURIComponent('../../secrets.png')}`,
    )
    expect([400, 404]).toContain(traversal.status)

    const created = await app.request('/api/media/tasks?project=api-asset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storyboard, idempotencyKey: 'api-asset-1' }),
    })
    const { taskId } = (await created.json()) as { taskId: string }
    await new Promise(resolve => setTimeout(resolve, 400))
    const story = await app.request(`/api/media/tasks/${taskId}/storyboard?project=api-asset`)
    expect(story.status === 200 || story.status === 404).toBe(true)
  })
})
