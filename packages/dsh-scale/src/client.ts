// dsh-scale client half (T3) — Web (React) client plugin.
//
// Route decision (plan R6/U4, resolved): lightweight React components via the
// client `React` global and `styles.insert` — no JSX transform, no Vue
// mounting bridge, no DSH-internal module imports. Everything renders from
// data already in the conversation (tool call args + results); the client
// never touches the filesystem (plan §6 T3 acceptance).
//
// This module must stay free of node-only imports: it loads in the browser.

/** The 25 MCP tools dsh-scale exposes under mcp__scale__ (27 minus the narrowed shell pair). */
const SCALE_MCP_TOOLS = [
  'scale_create', 'scale_transition', 'scale_list', 'scale_show', 'scale_available_actions',
  'scale_context', 'scale_stats', 'scale_detect_changes', 'scale_review_context',
  'scale_code_intelligence_status', 'task_create', 'task_start', 'task_status',
  'task_checkpoint', 'task_resume', 'complete_task', 'capability_list', 'capability_map',
  'bridge_register', 'bridge_heartbeat', 'delegation_delegate', 'delegation_review',
  'cortex_promotion_propose', 'cortex_promotion_hit', 'cortex_promotion_approve',
] as const

const CSS = `
.dsh-scale-card{border:1px solid var(--dsh-border,#e2e2e2);border-radius:8px;padding:8px 10px;margin:4px 0;font-size:12px;font-family:var(--dsh-mono,ui-monospace,monospace)}
.dsh-scale-card-head{display:flex;gap:6px;align-items:baseline;margin-bottom:4px}
.dsh-scale-card-badge{background:#1f6feb;color:#fff;border-radius:4px;padding:1px 5px;font-size:10px;font-weight:600;letter-spacing:.03em}
.dsh-scale-card-name{font-weight:600}
.dsh-scale-card-args{color:var(--dsh-muted,#666);white-space:pre-wrap;word-break:break-all;max-height:6.5em;overflow:hidden}
.dsh-scale-card-result{margin-top:4px;color:var(--dsh-text,#222);white-space:pre-wrap;word-break:break-all;max-height:10em;overflow:hidden;border-top:1px dashed var(--dsh-border,#ddd);padding-top:4px}
`

/** Defensive React access — the client exposes React (createElement) as a global (plan §2.8). */
function react(): { createElement: (type: string, props: Record<string, unknown> | null, ...children: unknown[]) => unknown } | undefined {
  return (globalThis as { React?: unknown }).React as ReturnType<typeof react>
}

function preview(value: unknown, cap = 600): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.slice(0, cap)
  try {
    return JSON.stringify(value, null, 1).slice(0, cap)
  } catch {
    return '[unserializable]'
  }
}

/** Extract the raw tool name from mcp__scale__<name>. */
function shortName(wireName: string): string {
  return wireName.startsWith('mcp__scale__') ? wireName.slice('mcp__scale__'.length) : wireName
}

/**
 * Toolview card for mcp__scale__* calls. Props are consumed defensively:
 * the exact third-party card payload shape is not part of a stable public
 * contract, so every field is optional and rendering degrades to the name.
 */
function ScaleToolCard(props: Record<string, unknown>): unknown {
  const R = react()
  if (!R) return null

  const wireName = typeof props.tool === 'string' ? props.tool
    : typeof props.name === 'string' ? props.name
      : 'mcp__scale__?'
  const argsText = preview(props.arguments ?? props.args ?? props.input)
  const resultText = preview(props.result ?? props.content ?? props.output)

  const children: unknown[] = [
    R.createElement('span', { className: 'dsh-scale-card-badge' }, 'SCALE'),
    R.createElement('span', { className: 'dsh-scale-card-name' }, shortName(wireName)),
  ]
  if (props.phase === 'preparing' || props.isRunning === true) {
    children.push(R.createElement('span', { className: 'dsh-scale-card-name' }, '· running'))
  }

  const body: unknown[] = [R.createElement('div', { className: 'dsh-scale-card-head' }, ...children)]
  if (argsText) body.push(R.createElement('div', { className: 'dsh-scale-card-args' }, argsText))
  if (resultText) body.push(R.createElement('div', { className: 'dsh-scale-card-result' }, resultText))

  return R.createElement('div', { className: 'dsh-scale-card', 'data-tool': wireName }, ...body)
}

export const inject = ['slots']

export function apply(ctx: {
  slots?: {
    inject?: (slot: string, fn: () => unknown) => void
    register?: (meta: { name: string; key: string }, component: unknown) => unknown
  }
  effect?: (fn: () => (() => void) | void) => void
}): void {
  // Client-scoped CSS, inserted once (styles.insert is a client global).
  const styles = (globalThis as { styles?: { insert: (css: string) => void } }).styles
  try {
    styles?.insert(CSS)
  } catch {
    // styling is best-effort; the card still renders unstyled
  }

  const slots = ctx.slots
  if (!slots?.register) return

  const disposers: Array<() => void> = []
  for (const tool of SCALE_MCP_TOOLS) {
    const wireName = `mcp__scale__${tool}`
    try {
      const registered = slots.register({ name: 'tool.call.toolview', key: wireName }, ScaleToolCard)
      if (typeof registered === 'function') disposers.push(registered as () => void)
      else if (registered && typeof (registered as { dispose?: () => void }).dispose === 'function') {
        disposers.push(() => (registered as { dispose: () => void }).dispose())
      }
    } catch {
      // duplicate key (reload) — skip, keep the rest
    }
  }

  ctx.effect?.(() => () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // best-effort teardown
      }
    }
  })
}
