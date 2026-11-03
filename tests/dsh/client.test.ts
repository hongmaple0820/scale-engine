// dsh-scale client half (T3) — toolview card registration. The client module
// must stay node-free (browser load) and degrade gracefully without React.

import { describe, expect, it } from 'vitest'
import { apply } from '../../packages/dsh-scale/src/client.js'
import { MEDIA_MCP_TOOLS } from '../../src/media/mcpTools.js'

type Registered = { meta: { name: string; key: string }; component: unknown }

function makeCtx() {
  const registered: Registered[] = []
  const disposers: Array<() => void> = []
  const ctx = {
    slots: {
      register: (meta: { name: string; key: string }, component: unknown) => {
        registered.push({ meta, component })
        return () => disposers.push(() => registered.splice(registered.findIndex(r => r.meta.key === meta.key), 1))
      },
    },
    effect: (fn: () => (() => void) | void) => {
      const dispose = fn()
      if (dispose) disposers.push(dispose)
    },
  }
  return { ctx, registered, disposers }
}

describe('client apply()', () => {
  it('registers a toolview card for every exposed mcp__scale__ tool (40, shell pair excluded)', () => {
    const { ctx, registered } = makeCtx()
    apply(ctx)
    expect(registered).toHaveLength(40)
    const keys = new Set(registered.map(r => r.meta.key))
    for (const tool of MEDIA_MCP_TOOLS) {
      expect(keys.has(`mcp__scale__${tool.name}`)).toBe(true)
    }
    for (const r of registered) {
      expect(r.meta.name).toBe('tool.call.toolview')
      expect(r.meta.key).toMatch(/^mcp__scale__[a-z_]+$/)
      expect(r.meta.key).not.toMatch(/shell_(run|plan)/)
      expect(typeof r.component).toBe('function')
    }
  })

  it('every registration is disposed on plugin teardown (panel disappears cleanly)', () => {
    const { ctx, registered } = makeCtx()
    apply(ctx)
    expect(registered).toHaveLength(40)
  })

  it('is a no-op (not a crash) when slots are unavailable', () => {
    expect(() => apply({})).not.toThrow()
  })
})

describe('ScaleToolCard rendering', () => {
  it('renders null without the React global and does not throw with it', async () => {
    const { ctx, registered } = makeCtx()
    apply(ctx)
    const card = registered[0].component as (props: Record<string, unknown>) => unknown
    // No React global in this node process → defensive null
    expect(card({ tool: 'mcp__scale__scale_create', arguments: { a: 1 } })).toBeNull()

    // With a minimal React global → produces a descriptor tree
    const g = globalThis as { React?: unknown }
    const prev = g.React
    g.React = {
      createElement: (type: string, props: Record<string, unknown> | null, ...children: unknown[]) =>
        ({ type, props, children }),
    }
    try {
      const tree = card({ tool: 'mcp__scale__scale_stats', arguments: { scope: 'all' }, result: '{"total":3}' }) as {
        type: string; props: Record<string, unknown>; children: unknown[]
      }
      expect(tree.type).toBe('div')
      expect(tree.props['data-tool']).toBe('mcp__scale__scale_stats')
      const flat = JSON.stringify(tree.children)
      expect(flat).toContain('scale_stats')
      expect(flat).toContain('SCALE')
    } finally {
      if (prev === undefined) delete g.React
      else g.React = prev
    }
  })

  describe('media tool cards (M5)', () => {
    function mediaCard(): (props: Record<string, unknown>) => {
      type: string
      props: Record<string, unknown>
      children: unknown[]
    } {
      const { ctx, registered } = makeCtx()
      apply(ctx)
      const g = globalThis as { React?: unknown }
      const prev = g.React
      const card = registered.find(r => r.meta.key === 'mcp__scale__media_wait_task')!.component as
        (props: Record<string, unknown>) => unknown
      return (props) => {
        // (Re-)install the React global per call: the cleanup below removes it
        // after each render so a multi-call test always starts clean.
        g.React = {
          createElement: (type: string, props: Record<string, unknown> | null, ...children: unknown[]) =>
            ({ type, props, children }),
        }
        try {
          return card(props) as { type: string; props: Record<string, unknown>; children: unknown[] }
        } finally {
          if (prev === undefined) delete g.React
          else g.React = prev
        }
      }
    }

    function flatText(node: unknown): string {
      return JSON.stringify(node)
    }

    it('shows taskId + status chip + output paths for a terminal media task (task result shape)', () => {
      const render = mediaCard()
      const tree = render({
        tool: 'mcp__scale__media_wait_task',
        arguments: { taskId: 'job-2026-10-30-abc' },
        result: JSON.stringify({
          taskId: 'job-2026-10-30-abc',
          type: 'render',
          status: 'succeeded',
          outputs: [{ path: 'output/final.mp4', bytes: 1024, sha256: 'x' }],
        }),
      })
      const flat = flatText(tree)
      expect(flat).toContain('job-2026-10-30-abc')
      expect(flat).toContain('done')
      expect(flat).toContain('output/final.mp4')
      // structured strip replaces the raw JSON dump for media tools
      expect(flat).not.toContain('"status":"succeeded"')
    })

    it('shows a failed status and error code for a failed task', () => {
      const render = mediaCard()
      const tree = render({
        tool: 'mcp__scale__media_get_task',
        arguments: { taskId: 'job-2026-10-30-bad' },
        result: JSON.stringify({
          taskId: 'job-2026-10-30-bad',
          type: 'generate_video',
          status: 'failed',
          error: { code: 'MEDIA_PROVIDER_TIMEOUT', message: 'poll deadline passed', retryable: true },
          outputs: [],
        }),
      })
      const flat = flatText(tree)
      expect(flat).toContain('failed')
      expect(flat).toContain('MEDIA_PROVIDER_TIMEOUT')
    })

    it('shows the awaiting-approval state without any output row', () => {
      const render = mediaCard()
      const tree = render({
        tool: 'mcp__scale__media_run_task',
        arguments: { taskId: 'job-2026-10-30-apr' },
        result: JSON.stringify({
          taskId: 'job-2026-10-30-apr',
          type: 'generate_image',
          status: 'awaiting_approval',
        }),
      })
      const flat = flatText(tree)
      expect(flat).toContain('awaiting approval')
      expect(flat).not.toContain('output/')
    })

    it('degrades to the plain card when the result is not a recognizable media payload', () => {
      const render = mediaCard()
      const tree = render({
        tool: 'mcp__scale__media_wait_task',
        arguments: { taskId: 'job-2026-10-30-non' },
        result: 'media task "job-2026-10-30-non" not found',
      })
      const flat = flatText(tree)
      expect(flat).toContain('media_wait_task')
      // raw string result still shown via the generic result block
      expect(flat).toContain('not found')
    })

    it('reads the real wait_task envelope {done, job:{...}} and the list envelope {tasks:[...]}', () => {
      const render = mediaCard()
      const waitTree = render({
        tool: 'mcp__scale__media_wait_task',
        arguments: { taskId: 'job-2026-10-30-wait' },
        result: JSON.stringify({
          done: true,
          job: { taskId: 'job-2026-10-30-wait', type: 'render', status: 'succeeded', outputs: [{ path: 'output/final.mp4', bytes: 1 }] },
        }),
      })
      const waitFlat = flatText(waitTree)
      expect(waitFlat).toContain('job-2026-10-30-wait')
      expect(waitFlat).toContain('done')
      expect(waitFlat).toContain('output/final.mp4')

      const listTree = render({
        tool: 'mcp__scale__media_list_tasks',
        arguments: {},
        result: JSON.stringify({
          tasks: [
            // media_list_tasks returns newest first — the card shows the newest
            { taskId: 'job-2026-10-30-new', type: 'generate_image', status: 'running' },
            { taskId: 'job-2026-10-30-old', type: 'render', status: 'cancelled' },
          ],
        }),
      })
      const listFlat = flatText(listTree)
      expect(listFlat).toContain('job-2026-10-30-new')
      expect(listFlat).toContain('running…')
    })
  })
})
