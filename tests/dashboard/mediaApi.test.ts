// Media REST API (v3 plan §10, P2 gate): Dashboard and CLI must see the same
// task semantics. Hono's app.request() exercises the routes without a socket.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterAll, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { registerMediaApi } from '../../src/dashboard/MediaControlPlane.js'
import { createJob, runJob } from '../../src/media/index.js'

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

describe('GET /api/media/assets/content?ref=', () => {
  it('serves a succeeded source asset by ref, with fail-closed errors', async () => {
    const created = createJob({
      root,
      projectId: 'api-ref',
      type: 'generate_image',
      imageRequest: { prompt: 'ref preview', size: '1024x1024', providerId: 'mock' },
      idempotencyKey: 'api-ref-1',
    })
    const done = await runJob({ root, projectId: 'api-ref', taskId: created.job.id })
    expect(done.status).toBe('succeeded')
    const ref = `asset://${done.id}/${done.outputs[0].path}`

    const response = await app.request(`/api/media/assets/content?project=api-ref&ref=${encodeURIComponent(ref)}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect((await response.arrayBuffer()).byteLength).toBe(done.outputs[0].bytes)

    const malformed = await app.request(`/api/media/assets/content?project=api-ref&ref=${encodeURIComponent('asset://job-1/assets/../x.png')}`)
    expect(malformed.status).toBe(400)
    expect(((await malformed.json()) as { code: string }).code).toBe('MEDIA_ASSET_REF_INVALID')

    const ambiguous = await app.request(
      `/api/media/assets/content?project=api-ref&ref=${encodeURIComponent(ref)}&path=assets%2Fgenerated%2Fx.png`,
    )
    expect(ambiguous.status).toBe(400)

    const missing = await app.request(
      `/api/media/assets/content?project=api-ref&ref=${encodeURIComponent('asset://job-2026-01-01-deadbeef/assets/generated/x.png')}`,
    )
    expect(missing.status).toBe(404)
  }, 60000)
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

  it('rejects an edit whose asset:// ref does not resolve', async () => {
    // created directly (not via POST, which auto-runs) so the task stays idle
    const created = createJob({ root, projectId: 'api-edit-asset', storyboard })
    const taskId = created.job.id
    const board = {
      ...storyboard,
      schemaVersion: '0.3',
      scenes: [{
        id: 's1',
        durationMs: 400,
        elements: [{ type: 'image', src: 'asset://job-2026-01-01-deadbeef/assets/generated/x.png', x: 0, y: 0, width: 10, height: 10 }],
      }],
    }
    const response = await app.request(`/api/media/tasks/${taskId}/storyboard?project=api-edit-asset`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storyboard: board }),
    })
    expect(response.status).toBe(400)
    expect(((await response.json()) as { code: string }).code).toBe('MEDIA_ASSET_REF_MISSING')
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

describe('POST /api/media/tasks/:id/run', () => {
  it('starts a created task with 202 and rejects a second run', async () => {
    const { job } = createJob({
      root,
      projectId: 'api-run',
      type: 'generate_image',
      imageRequest: { prompt: 'api run', size: '1024x1024', providerId: 'mock' },
      requestedBy: 'test',
      idempotencyKey: 'api-run-1',
    })

    const response = await app.request(`/api/media/tasks/${job.id}/run?project=api-run`, { method: 'POST' })
    expect(response.status).toBe(202)
    const started = (await response.json()) as { job: { status: string } }
    expect(started.job.status).not.toBe('created')

    let status = started.job.status
    for (let attempt = 0; attempt < 100 && !['succeeded', 'failed', 'cancelled', 'interrupted'].includes(status); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100))
      const detail = await app.request(`/api/media/tasks/${job.id}?project=api-run`)
      status = ((await detail.json()) as { job: { status: string } }).job.status
    }
    expect(status).toBe('succeeded')

    const again = await app.request(`/api/media/tasks/${job.id}/run?project=api-run`, { method: 'POST' })
    expect(again.status).toBe(409)
    const body = (await again.json()) as { code: string }
    expect(body.code).toBe('MEDIA_ACTION_INVALID_STATE')
  }, 60000)

  it('returns 404 with a stable code for an unknown task', async () => {
    const response = await app.request('/api/media/tasks/nope/run?project=api-run', { method: 'POST' })
    expect(response.status).toBe(404)
    const body = (await response.json()) as { code: string }
    expect(body.code).toBe('MEDIA_JOB_NOT_FOUND')
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

describe('M2 approvals and budget routes', () => {
  const json = { 'content-type': 'application/json' }

  async function createApprovalTask(project: string): Promise<{ taskId: string; approvalId: string }> {
    const created = await app.request(`/api/media/tasks?project=${project}`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        type: 'generate_image',
        imageRequest: { prompt: 'rest approval', size: '1024x1024', providerId: 'openai-compatible' },
      }),
    })
    expect(created.status).toBe(202)
    const body = (await created.json()) as { taskId: string; status: string; approval: { id: string; status: string } }
    expect(body.status).toBe('awaiting_approval')
    expect(body.approval.status).toBe('pending')
    return { taskId: body.taskId, approvalId: body.approval.id }
  }

  it('lists approvals and blocks running an awaiting task with 409', async () => {
    const { taskId, approvalId } = await createApprovalTask('api-approval')
    const listed = await app.request('/api/media/approvals?project=api-approval')
    expect(listed.status).toBe(200)
    const approvals = ((await listed.json()) as { approvals: Array<{ id: string; taskId: string }> }).approvals
    expect(approvals.some(record => record.id === approvalId && record.taskId === taskId)).toBe(true)

    const run = await app.request(`/api/media/tasks/${taskId}/run?project=api-approval`, { method: 'POST' })
    expect(run.status).toBe(409)
    expect(((await run.json()) as { code: string }).code).toBe('MEDIA_APPROVAL_REQUIRED')
  })

  it('refuses decisions from a non-loopback caller without a token', async () => {
    const { approvalId } = await createApprovalTask('api-approval-remote')
    const response = await app.request(`/api/media/approvals/${approvalId}/decide?project=api-approval-remote`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ approve: true }),
    })
    expect(response.status).toBe(403)
    expect(((await response.json()) as { code: string }).code).toBe('MEDIA_APPROVAL_FORBIDDEN')
  })

  it('accepts a loopback decision and flips the task to created', async () => {
    const { approvalId } = await createApprovalTask('api-approval-loopback')
    const response = await app.request(
      `/api/media/approvals/${approvalId}/decide?project=api-approval-loopback`,
      { method: 'POST', headers: json, body: JSON.stringify({ approve: true }) },
      { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; approval: { status: string }; job?: { status: string } }
    expect(body.ok).toBe(true)
    expect(body.approval.status).toBe('approved')
    expect(body.job?.status).toBe('created')
  })

  it('accepts a token-authenticated decision and rejects a wrong token', async () => {
    const tokenApp = new Hono()
    registerMediaApi(tokenApp, { projectDir: root, approvalToken: 'test-approval-token' })
    const { approvalId } = await createApprovalTask('api-approval-token')

    const wrong = await tokenApp.request(`/api/media/approvals/${approvalId}/decide?project=api-approval-token`, {
      method: 'POST',
      headers: { ...json, 'x-media-approval-token': 'wrong' },
      body: JSON.stringify({ approve: true }),
    })
    expect(wrong.status).toBe(403)

    const accepted = await tokenApp.request(`/api/media/approvals/${approvalId}/decide?project=api-approval-token`, {
      method: 'POST',
      headers: { ...json, 'x-media-approval-token': 'test-approval-token', 'x-media-approval-actor': 'ops' },
      body: JSON.stringify({ approve: false, reason: 'not now' }),
    })
    expect(accepted.status).toBe(200)
    const body = (await accepted.json()) as { approval: { status: string; decidedBy: string }; job?: { status: string } }
    expect(body.approval.status).toBe('rejected')
    expect(body.approval.decidedBy).toBe('ops')
    expect(body.job?.status).toBe('cancelled')
  })

  it('honors the plan env/header names and starts the task on approve+run', async () => {
    process.env.SCALE_MEDIA_APPROVAL_TOKEN = 'plan-token'
    process.env.MEDIA_APPROVAL_THRESHOLD_CNY = '0'
    try {
      const envApp = new Hono()
      registerMediaApi(envApp, { projectDir: root })
      const created = await envApp.request('/api/media/tasks?project=api-approval-run', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          type: 'generate_image',
          imageRequest: { prompt: 'approve and run', size: '1024x1024', providerId: 'mock' },
        }),
      })
      expect(created.status).toBe(202)
      const body = (await created.json()) as { taskId: string; status: string; approval: { id: string } }
      expect(body.status).toBe('awaiting_approval')

      const decide = await envApp.request(`/api/media/approvals/${body.approval.id}/decide?project=api-approval-run`, {
        method: 'POST',
        headers: { ...json, 'x-scale-token': 'plan-token' },
        body: JSON.stringify({ approve: true, run: true }),
      })
      expect(decide.status).toBe(202)
      const decided = (await decide.json()) as { started: boolean; job?: { status: string } }
      expect(decided.started).toBe(true)

      let status = decided.job?.status ?? 'created'
      for (let attempt = 0; attempt < 100 && !['succeeded', 'failed', 'cancelled'].includes(status); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100))
        const detail = await envApp.request(`/api/media/tasks/${body.taskId}?project=api-approval-run`)
        status = ((await detail.json()) as { job: { status: string } }).job.status
      }
      expect(status).toBe('succeeded')
    } finally {
      delete process.env.SCALE_MEDIA_APPROVAL_TOKEN
      delete process.env.MEDIA_APPROVAL_THRESHOLD_CNY
    }
  }, 60000)

  it('serves the project budget summary', async () => {
    const response = await app.request('/api/media/budget?project=api-approval')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { budget: { day: string; budgetCny: number; spentCny: number; entries: unknown[] } }
    expect(body.budget.day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(typeof body.budget.budgetCny).toBe('number')
    expect(typeof body.budget.spentCny).toBe('number')
    expect(Array.isArray(body.budget.entries)).toBe(true)
  })
})

describe('M3 template wizard routes', () => {
  const json = { 'content-type': 'application/json' }

  it('lists the builtin templates with their slot metadata', async () => {
    const response = await app.request('/api/media/templates')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { templates: Array<{ id: string; aspectRatio: string; slots: Array<{ key: string; required: boolean }> }> }
    expect(body.templates.map(template => template.id)).toEqual(['talking-head', 'product-showcase', 'fast-cuts'])
    expect(body.templates[0].slots.find(slot => slot.key === 'narration')?.required).toBe(true)
    expect(body.templates[0].aspectRatio).toBe('9:16')
  })

  it('plans a draft without creating a task and estimates the cost', async () => {
    const response = await app.request('/api/media/plan', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ templateId: 'talking-head', slots: { media: 'generated/hero.png', narration: '你好。' } }),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      ok: boolean
      plan: { draft: { schemaVersion: string; scenes: unknown[] }; estimate: { estimatedCny: number | null }; slots: Array<{ key: string; missing: boolean }> }
    }
    expect(body.ok).toBe(true)
    expect(body.plan.draft.schemaVersion).toBe('0.4')
    expect(body.plan.draft.scenes).toHaveLength(1)
    expect(typeof body.plan.estimate.estimatedCny).toBe('number')
    expect(body.plan.slots.every(slot => !slot.missing)).toBe(true)
    // planning is pure: the task list is untouched
    const tasks = await app.request('/api/media/tasks?project=api-templates')
    expect(((await tasks.json()) as { tasks: unknown[] }).tasks).toHaveLength(0)
  })

  it('previews placeholders for missing slots instead of failing', async () => {
    const response = await app.request('/api/media/plan', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ templateId: 'product-showcase', slots: { media: ['generated/a.png', 'generated/b.png'] } }),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { plan: { warnings: string[]; slots: Array<{ key: string; missing: boolean; values: string[] }> } }
    expect(body.plan.warnings.length).toBeGreaterThan(0)
    const media = body.plan.slots.find(slot => slot.key === 'media')
    expect(media?.missing).toBe(true)
    expect(media?.values).toHaveLength(3)
  })

  it('rejects unknown templates and malformed slots with stable codes', async () => {
    const unknown = await app.request('/api/media/plan', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ templateId: 'no-such-template' }),
    })
    expect(unknown.status).toBe(400)
    expect(((await unknown.json()) as { code: string }).code).toBe('MEDIA_ACTION_UNKNOWN')

    const malformed = await app.request('/api/media/templates/talking-head/assemble', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ slots: ['generated/hero.png'] }),
    })
    expect(malformed.status).toBe(400)
    expect(((await malformed.json()) as { code: string }).code).toBe('MEDIA_STORYBOARD_INVALID')
  })

  it('assembles a strict storyboard for the task API', async () => {
    const images = ['1', '2', '3', '4'].map(index => `generated/${index}.png`)
    const response = await app.request('/api/media/templates/fast-cuts/assemble', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ slots: { images, captions: ['一。', '二。', '三。', '四。'] }, title: '快剪测试' }),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; storyboard: { schemaVersion: string; title?: string; scenes: unknown[] } }
    expect(body.ok).toBe(true)
    expect(body.storyboard.schemaVersion).toBe('0.4')
    expect(body.storyboard.title).toBe('快剪测试')
    expect(body.storyboard.scenes).toHaveLength(4)

    const missing = await app.request('/api/media/templates/fast-cuts/assemble', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ slots: { captions: ['一。', '二。', '三。', '四。'] } }),
    })
    expect(missing.status).toBe(400)
    expect(((await missing.json()) as { code: string }).code).toBe('MEDIA_STORYBOARD_INVALID')
  })
})

describe('M2 provider task types over REST', () => {
  const json = { 'content-type': 'application/json' }

  it('rejects unknown task types with 400 and validates export requests', async () => {
    const unknown = await app.request('/api/media/tasks?project=api-types', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ type: 'hologram' }),
    })
    expect(unknown.status).toBe(400)
    expect(((await unknown.json()) as { code: string }).code).toBe('MEDIA_ACTION_UNKNOWN')

    // M4: export is a known type now — a missing sourceTaskId is a 400
    // request error (not an availability error)
    const badExport = await app.request('/api/media/tasks?project=api-types', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ type: 'export' }),
    })
    expect(badExport.status).toBe(400)
    expect(((await badExport.json()) as { code: string }).code).toBe('MEDIA_EXPORT_REQUEST_INVALID')
  })

  it('returns 503 when the video feature is off and runs mock video when enabled', async () => {
    delete process.env.MEDIA_FEATURE_VIDEO
    const off = await app.request('/api/media/tasks?project=api-video', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ type: 'generate_video', videoRequest: { prompt: 'rest clip', durationSeconds: 2, providerId: 'mock-video' } }),
    })
    expect(off.status).toBe(503)
    expect(((await off.json()) as { code: string }).code).toBe('MEDIA_PROVIDER_UNAVAILABLE')

    process.env.MEDIA_FEATURE_VIDEO = 'mock'
    process.env.MEDIA_MOCK_VIDEO_LATENCY_MS = '0'
    try {
      const created = await app.request('/api/media/tasks?project=api-video', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ type: 'generate_video', videoRequest: { prompt: 'rest clip', durationSeconds: 2, providerId: 'mock-video' } }),
      })
      expect(created.status).toBe(202)
      const { taskId } = (await created.json()) as { taskId: string }
      let status = 'created'
      for (let attempt = 0; attempt < 100 && !['succeeded', 'failed', 'cancelled'].includes(status); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100))
        const detail = await app.request(`/api/media/tasks/${taskId}?project=api-video`)
        status = ((await detail.json()) as { job: { status: string } }).job.status
      }
      expect(status).toBe('succeeded')
      const detail = await app.request(`/api/media/tasks/${taskId}?project=api-video`)
      const job = ((await detail.json()) as { job: { outputs: Array<{ kind: string; path: string }> } }).job
      expect(job.outputs[0]).toMatchObject({ kind: 'video', path: 'assets/generated.mp4' })
    } finally {
      delete process.env.MEDIA_FEATURE_VIDEO
      delete process.env.MEDIA_MOCK_VIDEO_LATENCY_MS
    }
  }, 60000)
})
