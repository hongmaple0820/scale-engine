// dsh-scale client half (T3) — toolview card registration. The client module
// must stay node-free (browser load) and degrade gracefully without React.

import { describe, expect, it } from 'vitest'
import { apply } from '../../packages/dsh-scale/src/client.js'

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
  it('registers a toolview card for every exposed mcp__scale__ tool (25, shell pair excluded)', () => {
    const { ctx, registered } = makeCtx()
    apply(ctx)
    expect(registered).toHaveLength(25)
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
    expect(registered).toHaveLength(25)
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
})
