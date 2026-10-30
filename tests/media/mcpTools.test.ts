// media_* MCP tools (v3 plan §11): same JobService business layer, task-id
// only surface, no raw FFmpeg/path tools.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { MEDIA_MCP_TOOLS, handleMediaToolCall } from '../../src/media/mcpTools.js'
import { ExecutionLedger } from '../../src/runtime/ExecutionLedger.js'

const root = mkdtempSync(join(tmpdir(), 'media-mcp-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const storyboard = {
  schemaVersion: '0.1',
  canvas: { width: 320, height: 320, fps: 24, background: '#101010' },
  scenes: [{ id: 's1', durationMs: 500, elements: [{ type: 'rect', x: 5, y: 5, width: 40, height: 40, color: '#2563eb' }] }],
}

describe('media mcp tools', () => {
  it('exposes the v3 §11.1 minimal set (no arbitrary path/ffmpeg/code tools)', () => {
    const names = MEDIA_MCP_TOOLS.map(tool => tool.name)
    expect(names).toContain('media_validate_storyboard')
    expect(names).toContain('media_render_storyboard')
    expect(names).toContain('media_generate_image')
    expect(names).toContain('media_get_evidence')
    for (const tool of MEDIA_MCP_TOOLS) {
      const schema = JSON.stringify(tool.inputSchema)
      expect(schema.includes('path')).toBe(false)
      expect(schema.includes('ffmpeg')).toBe(false)
    }
  })

  it('validates storyboards without rendering', async () => {
    const bad = (await handleMediaToolCall('media_validate_storyboard', { storyboard: { schemaVersion: '9.9' } })) as { ok: boolean }
    expect(bad.ok).toBe(false)
    const good = (await handleMediaToolCall('media_validate_storyboard', { storyboard })) as { ok: boolean }
    expect(good.ok).toBe(true)
  })

  it('create → get → cancel lifecycle over mcp semantics', async () => {
    const created = (await handleMediaToolCall('media_create_task', {
      type: 'generate_image',
      imageRequest: { prompt: 'mcp mock', size: '1024x1024', providerId: 'mock' },
      project: 'mcp',
      idempotencyKey: 'mcp-img-1',
    }, { root })) as { taskId: string; status: string }
    expect(created.status).toBe('created')

    const fetched = (await handleMediaToolCall('media_get_task', { taskId: created.taskId, project: 'mcp' }, { root })) as { taskId: string }
    expect(fetched.taskId).toBe(created.taskId)

    const listed = (await handleMediaToolCall('media_list_tasks', { project: 'mcp' }, { root })) as { tasks: unknown[] }
    expect(listed.tasks).toHaveLength(1)

    const cancelled = (await handleMediaToolCall('media_cancel_task', { taskId: created.taskId, project: 'mcp' }, { root })) as { status: string }
    expect(cancelled.status).toBe('cancelled')

    const ledger = new ExecutionLedger({ projectDir: root }).query({ taskId: created.taskId, limit: 50 })
    expect(ledger.some(event => event.type === 'task.cancelled' && event.metadata?.domain === 'media')).toBe(true)
  })

  it('generate_image via mcp runs against the mock provider and returns evidence', async () => {
    const result = (await handleMediaToolCall('media_generate_image', {
      prompt: 'mcp mock e2e',
      size: '1024x1024',
      providerId: 'mock',
      project: 'mcp',
      idempotencyKey: 'mcp-img-2',
    }, { root })) as { taskId: string; status: string; outputs: Array<{ path: string }> }
    expect(result.status).toBe('succeeded')
    expect(result.outputs[0].path).toMatch(/^assets\/generated\/.+\.png$/)

    const evidence = (await handleMediaToolCall('media_get_evidence', { taskId: result.taskId, project: 'mcp' }, { root })) as {
      evidence: Array<{ action: string; result: string }>
    }
    expect(evidence.evidence.some(event => event.action === 'commit_asset' && event.result === 'ok')).toBe(true)
    expect(evidence.evidence.some(event => event.action === 'provider_usage')).toBe(true)
  }, 60000)

  it('media_wait_task observes without ever starting a created task', async () => {
    const created = (await handleMediaToolCall('media_create_task', {
      type: 'generate_image',
      imageRequest: { prompt: 'wait only', size: '1024x1024', providerId: 'mock' },
      project: 'async-wait',
      idempotencyKey: 'mcp-wait-1',
    }, { root })) as { taskId: string; status: string }
    expect(created.status).toBe('created')

    const waited = (await handleMediaToolCall('media_wait_task', {
      taskId: created.taskId,
      project: 'async-wait',
      maxSeconds: 1,
    }, { root })) as { done: boolean; job: { status: string } }
    expect(waited.done).toBe(false)
    expect(waited.job.status).toBe('created')

    const fetched = (await handleMediaToolCall('media_get_task', {
      taskId: created.taskId,
      project: 'async-wait',
    }, { root })) as { status: string }
    expect(fetched.status).toBe('created')
  }, 60000)

  it('runs create → run → wait without blocking the create call', async () => {
    const created = (await handleMediaToolCall('media_create_task', {
      type: 'generate_image',
      imageRequest: { prompt: 'async mock', size: '1024x1024', providerId: 'mock' },
      project: 'async',
      idempotencyKey: 'mcp-async-1',
    }, { root })) as { taskId: string; status: string }
    expect(created.status).toBe('created')

    const started = (await handleMediaToolCall('media_run_task', {
      taskId: created.taskId,
      project: 'async',
    }, { root })) as { started: boolean; status: string }
    expect(started.started).toBe(true)
    expect(started.status).not.toBe('created')

    const waited = (await handleMediaToolCall('media_wait_task', {
      taskId: created.taskId,
      project: 'async',
      maxSeconds: 30,
    }, { root })) as { done: boolean; job: { status: string; outputs: Array<{ path: string }> } }
    expect(waited.done).toBe(true)
    expect(waited.job.status).toBe('succeeded')
    expect(waited.job.outputs[0].path).toMatch(/^assets\/generated\/.+\.png$/)

    const events = new ExecutionLedger({ projectDir: root }).query({ taskId: created.taskId, limit: 100 })
    expect(events.some(event => event.metadata?.domain === 'media' && event.type === 'tool.invoked')).toBe(true)
    expect(events.some(event => event.type === 'task.started')).toBe(true)
    expect(events.some(event => event.type === 'evidence.recorded' && event.metadata?.outcome === 'succeeded')).toBe(true)
  }, 60000)

  it('rejects running a task twice and never leaks M4 types into M2', async () => {
    const created = (await handleMediaToolCall('media_create_task', {
      type: 'generate_image',
      imageRequest: { prompt: 'twice', size: '1024x1024', providerId: 'mock' },
      project: 'async',
      idempotencyKey: 'mcp-async-2',
    }, { root })) as { taskId: string }

    await handleMediaToolCall('media_run_task', { taskId: created.taskId, project: 'async' }, { root })
    await handleMediaToolCall('media_wait_task', { taskId: created.taskId, project: 'async', maxSeconds: 30 }, { root })

    const again = (await handleMediaToolCall('media_run_task', {
      taskId: created.taskId,
      project: 'async',
    }, { root })) as { error?: { code: string } }
    expect(again.error?.code).toBe('MEDIA_ACTION_INVALID_STATE')

    const exportTask = (await handleMediaToolCall('media_create_task', {
      type: 'export',
      project: 'async',
    }, { root })) as { error?: { code: string } }
    // M4 is implemented now: a missing sourceTaskId is a request error, not
    // an availability error
    expect(exportTask.error?.code).toBe('MEDIA_EXPORT_REQUEST_INVALID')
  }, 60000)

  it('estimates costs and reports unavailable actions as structured errors', async () => {
    const render = (await handleMediaToolCall('media_estimate_cost', {
      actionId: 'media.render_storyboard',
      params: { storyboard },
    }, { root })) as { estimatedCny: number | null; breakdown: Array<{ pricingKey: string }> }
    expect(render.estimatedCny).toBe(0)
    expect(render.breakdown[0].pricingKey).toBe('local:render')

    const image = (await handleMediaToolCall('media_estimate_cost', {
      actionId: 'media.generate_image',
      params: { providerId: 'mock', prompt: 'x' },
    }, { root })) as { estimatedCny: number | null }
    expect(image.estimatedCny).toBe(0)

    const exportEstimate = (await handleMediaToolCall('media_estimate_cost', {
      actionId: 'media.export',
      params: { exportRequest: { sourceTaskId: 't' } },
    }, { root })) as { estimatedCny: number | null }
    // M4 available: local export is priced 0
    expect(exportEstimate.estimatedCny).toBe(0)

    const unknown = (await handleMediaToolCall('media_estimate_cost', {
      actionId: 'media.hologram',
      params: {},
    }, { root })) as { error?: { code: string } }
    expect(unknown.error?.code).toBe('MEDIA_ACTION_UNKNOWN')
  })

  it('rejects unresolved asset:// refs at create time', async () => {
    const board = {
      schemaVersion: '0.3',
      canvas: { width: 320, height: 320, fps: 24, background: '#101010' },
      scenes: [{
        id: 's1',
        durationMs: 500,
        elements: [{ type: 'image', src: 'asset://job-2026-01-01-deadbeef/assets/generated/x.png', x: 0, y: 0, width: 10, height: 10 }],
      }],
    }
    const result = (await handleMediaToolCall('media_create_task', {
      type: 'render',
      storyboard: board,
      project: 'mcp',
      idempotencyKey: 'mcp-asset-missing',
    }, { root })) as { error?: { code: string } }
    expect(result.error?.code).toBe('MEDIA_ASSET_REF_MISSING')
  })

  it('runs the async video chain end-to-end when MEDIA_FEATURE_VIDEO=mock', async () => {
    process.env.MEDIA_FEATURE_VIDEO = 'mock'
    process.env.MEDIA_MOCK_VIDEO_LATENCY_MS = '0'
    try {
      const created = (await handleMediaToolCall('media_create_task', {
        type: 'generate_video',
        videoRequest: { prompt: 'mcp video', durationSeconds: 2, providerId: 'mock-video' },
        project: 'mcp-video',
        idempotencyKey: 'mcp-video-1',
      }, { root })) as { taskId: string; status: string }
      expect(created.status).toBe('created')

      const started = (await handleMediaToolCall('media_run_task', {
        taskId: created.taskId,
        project: 'mcp-video',
      }, { root })) as { started: boolean }
      expect(started.started).toBe(true)

      const waited = (await handleMediaToolCall('media_wait_task', {
        taskId: created.taskId,
        project: 'mcp-video',
        maxSeconds: 30,
      }, { root })) as { done: boolean; job: { status: string; outputs: Array<{ kind: string; path: string }> } }
      expect(waited.done).toBe(true)
      expect(waited.job.status).toBe('succeeded')
      expect(waited.job.outputs[0]).toMatchObject({ kind: 'video', path: 'assets/generated.mp4' })

      const evidence = (await handleMediaToolCall('media_get_evidence', {
        taskId: created.taskId,
        project: 'mcp-video',
      }, { root })) as { evidence: Array<{ action: string }> }
      const actions = evidence.evidence.map(event => event.action)
      expect(actions).toContain('video_submitted')
      expect(actions).toContain('video_completed')
    } finally {
      delete process.env.MEDIA_FEATURE_VIDEO
      delete process.env.MEDIA_MOCK_VIDEO_LATENCY_MS
    }
  }, 60000)

  it('surfaces an awaiting approval and refuses to run it over MCP', async () => {
    delete process.env.MEDIA_APPROVAL_MODE
    const created = (await handleMediaToolCall('media_create_task', {
      type: 'generate_image',
      imageRequest: { prompt: 'mcp approval', size: '1024x1024', providerId: 'openai-compatible' },
      project: 'mcp-approval',
      idempotencyKey: 'mcp-approval-1',
    }, { root })) as { taskId: string; status: string; approval?: { id: string; status: string } }
    expect(created.status).toBe('awaiting_approval')
    expect(created.approval?.status).toBe('pending')

    const listed = (await handleMediaToolCall('media_list_approvals', {
      project: 'mcp-approval',
    }, { root })) as { approvals: Array<{ id: string; taskId: string }> }
    expect(listed.approvals.some(record => record.taskId === created.taskId && record.id === created.approval?.id)).toBe(true)

    const run = (await handleMediaToolCall('media_run_task', {
      taskId: created.taskId,
      project: 'mcp-approval',
    }, { root })) as { error?: { code: string } }
    expect(run.error?.code).toBe('MEDIA_APPROVAL_REQUIRED')
  }, 60000)

  it('returns structured errors instead of throwing', async () => {
    const result = (await handleMediaToolCall('media_get_task', { taskId: 'does-not-exist' }, { root })) as { error?: { code: string } }
    expect(result.error?.code).toBe('MEDIA_JOB_NOT_FOUND')
  })
})
