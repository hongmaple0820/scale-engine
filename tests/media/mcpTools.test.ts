// media_* MCP tools (v3 plan §11): same JobService business layer, task-id
// only surface, no raw FFmpeg/path tools.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { MEDIA_MCP_TOOLS, handleMediaToolCall } from '../../src/media/mcpTools.js'

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

  it('returns structured errors instead of throwing', async () => {
    const result = (await handleMediaToolCall('media_get_task', { taskId: 'does-not-exist' }, { root })) as { error?: { code: string } }
    expect(result.error?.code).toBe('MEDIA_JOB_NOT_FOUND')
  })
})
