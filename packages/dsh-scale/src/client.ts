// dsh-scale client half (T3) — Web (React) client plugin.
//
// Route decision (plan R6/U4, resolved): lightweight React components via the
// client `React` global and `styles.insert` — no JSX transform, no Vue
// mounting bridge, no DSH-internal module imports. Everything renders from
// data already in the conversation (tool call args + results); the client
// never touches the filesystem (plan §6 T3 acceptance).
//
// This module must stay free of node-only imports: it loads in the browser.

/**
 * The 40 MCP tools dsh-scale exposes under mcp__scale__: 25 core tools
 * (27 minus the narrowed shell pair) plus all 15 media tools. Keep this list
 * aligned with src/media/mcpTools.ts — the media count is asserted in tests.
 */
const SCALE_MCP_TOOLS = [
  'scale_create', 'scale_transition', 'scale_list', 'scale_show', 'scale_available_actions',
  'scale_context', 'scale_stats', 'scale_detect_changes', 'scale_review_context',
  'scale_code_intelligence_status', 'task_create', 'task_start', 'task_status',
  'task_checkpoint', 'task_resume', 'complete_task', 'capability_list', 'capability_map',
  'bridge_register', 'bridge_heartbeat', 'delegation_delegate', 'delegation_review',
  'cortex_promotion_propose', 'cortex_promotion_hit', 'cortex_promotion_approve',
  'media_list_providers', 'media_validate_storyboard', 'media_create_task',
  'media_run_task', 'media_wait_task', 'media_estimate_cost',
  'media_render_storyboard', 'media_generate_image', 'media_get_task',
  'media_list_tasks', 'media_cancel_task', 'media_retry_task',
  'media_recover_tasks', 'media_get_evidence', 'media_list_approvals',
] as const

const CSS = `
.dsh-scale-card{border:1px solid var(--dsh-border,#e2e2e2);border-radius:8px;padding:8px 10px;margin:4px 0;font-size:12px;font-family:var(--dsh-mono,ui-monospace,monospace)}
.dsh-scale-card-head{display:flex;gap:6px;align-items:baseline;margin-bottom:4px}
.dsh-scale-card-badge{background:#1f6feb;color:#fff;border-radius:4px;padding:1px 5px;font-size:10px;font-weight:600;letter-spacing:.03em}
.dsh-scale-card-badge-media{background:#8250df}
.dsh-scale-card-name{font-weight:600}
.dsh-scale-card-status{border-radius:4px;padding:1px 5px;font-size:10px;font-weight:600}
.dsh-scale-card-status-running{background:#fff8c5;color:#5b4b00}
.dsh-scale-card-status-succeeded{background:#dafbe1;color:#116329}
.dsh-scale-card-status-failed{background:#ffebe9;color:#82071e}
.dsh-scale-card-status-cancelled{background:#eff1f3;color:#57606a}
.dsh-scale-card-args{color:var(--dsh-muted,#666);white-space:pre-wrap;word-break:break-all;max-height:6.5em;overflow:hidden}
.dsh-scale-card-result{margin-top:4px;color:var(--dsh-text,#222);white-space:pre-wrap;word-break:break-all;max-height:10em;overflow:hidden;border-top:1px dashed var(--dsh-border,#ddd);padding-top:4px}
.dsh-scale-card-media{margin-top:4px;border-top:1px dashed var(--dsh-border,#ddd);padding-top:4px}
.dsh-scale-card-media-row{display:flex;gap:6px;align-items:baseline}
.dsh-scale-card-media-path{color:var(--dsh-text,#222);word-break:break-all}
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

/** Media tool names whose cards get the structured status/output view (plan M5). */
const MEDIA_TOOLS = new Set([
  'media_create_task', 'media_run_task', 'media_wait_task', 'media_get_task',
  'media_list_tasks', 'media_cancel_task', 'media_retry_task', 'media_recover_tasks',
  'media_estimate_cost', 'media_generate_image', 'media_render_storyboard',
  'media_list_providers', 'media_list_approvals',
])

/** Media job statuses → CSS modifier (anything else renders without a chip). */
const STATUS_CLASS: Record<string, string> = {
  running: 'dsh-scale-card-status-running',
  packaging: 'dsh-scale-card-status-running',
  created: 'dsh-scale-card-status-running',
  validated: 'dsh-scale-card-status-running',
  succeeded: 'dsh-scale-card-status-succeeded',
  failed: 'dsh-scale-card-status-failed',
  failed_validation: 'dsh-scale-card-status-failed',
  interrupted: 'dsh-scale-card-status-failed',
  cancelled: 'dsh-scale-card-status-cancelled',
  awaiting_approval: 'dsh-scale-card-status-cancelled',
}

const MEDIA_STATUS_LABEL: Record<string, string> = {
  created: 'created',
  validated: 'validated',
  awaiting_approval: 'awaiting approval',
  running: 'running…',
  packaging: 'packaging…',
  succeeded: 'done',
  failed: 'failed',
  failed_validation: 'invalid input',
  interrupted: 'interrupted',
  cancelled: 'cancelled',
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** Tool results arrive as JSON strings — parse defensively, keep raw on failure. */
function parseResult(value: unknown): Record<string, unknown> | undefined {
  const direct = asRecord(value)
  if (direct) return direct
  if (typeof value !== 'string') return undefined
  try {
    return asRecord(JSON.parse(value))
  } catch {
    return undefined
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

interface MediaCardInfo {
  taskId?: string
  status?: string
  jobType?: string
  error?: string
  outputs: string[]
}

/**
 * Pull taskId/status/outputs out of a media tool's args + result. Accepted
 * shapes (all real handleMediaToolCall payloads, plus the raw snapshot):
 *   flat summary   — {taskId,type,status,outputs[]} (create/get/cancel/retry/run)
 *   wait envelope  — {done, job:{...}}              (wait_task)
 *   list envelope  — {tasks:[...]}                  (list_tasks: latest wins)
 *   raw snapshot   — {id,type,status,...}
 */
function mediaInfo(tool: string, props: Record<string, unknown>): MediaCardInfo {
  const args = asRecord(props.arguments ?? props.args ?? props.input)
  const result = parseResult(props.result ?? props.content ?? props.output)
  const candidates: Array<Record<string, unknown> | undefined> = [
    asRecord(result?.task),
    asRecord(result?.job),
    ...collectTasks(result),
    result,
  ]
  const payload = candidates.find(entry => entry && (entry.taskId || entry.id || entry.status)) as
    | Record<string, unknown>
    | undefined
  const info: MediaCardInfo = { outputs: [] }

  info.taskId = asString(payload?.taskId) ?? asString(payload?.id) ?? asString(args?.taskId)
  info.status = asString(payload?.status)
  info.jobType = asString(payload?.type)
  if (payload?.error && typeof payload.error === 'object' && !Array.isArray(payload.error)) {
    const err = payload.error as Record<string, unknown>
    info.error = asString(err.code) ?? asString(err.message)
  }
  const outputs = payload?.outputs
  if (Array.isArray(outputs)) {
    for (const output of outputs) {
      const record = asRecord(output)
      const path = asString(record?.path)
      if (path) info.outputs.push(path)
    }
  }
  if (!info.taskId && !info.status && info.outputs.length === 0) return info
  return info
}

function collectTasks(result: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
  const tasks = result?.tasks
  if (!Array.isArray(tasks) || tasks.length === 0) return []
  const records = tasks.filter((entry): entry is Record<string, unknown> => Boolean(asRecord(entry)))
  // A list payload shows the LATEST task: `media_list_tasks` returns newest
  // first, so the first record wins. Reordering here keeps mediaInfo's
  // first-match `find` semantics.
  return [records[0]]
}

/**
 * Toolview card for mcp__scale__* calls. Props are consumed defensively:
 * the exact third-party card payload shape is not part of a stable public
 * contract, so every field is optional and rendering degrades to the name.
 * Media tools additionally get a structured strip: taskId + status + output
 * paths (plan M5: 卡片显示 taskId + 状态 + 产物路径；不阻塞对话).
 */
function ScaleToolCard(props: Record<string, unknown>): unknown {
  const R = react()
  if (!R) return null

  const wireName = typeof props.tool === 'string' ? props.tool
    : typeof props.name === 'string' ? props.name
      : 'mcp__scale__?'
  const tool = shortName(wireName)
  const isMedia = MEDIA_TOOLS.has(tool)
  const argsText = preview(props.arguments ?? props.args ?? props.input)
  const resultText = isMedia ? '' : preview(props.result ?? props.content ?? props.output)

  const children: unknown[] = [
    R.createElement('span', { className: isMedia ? 'dsh-scale-card-badge dsh-scale-card-badge-media' : 'dsh-scale-card-badge' }, 'SCALE'),
    R.createElement('span', { className: 'dsh-scale-card-name' }, tool),
  ]
  if (props.phase === 'preparing' || props.isRunning === true) {
    children.push(R.createElement('span', { className: 'dsh-scale-card-name' }, '· running'))
  }

  const body: unknown[] = [R.createElement('div', { className: 'dsh-scale-card-head' }, ...children)]
  if (argsText) body.push(R.createElement('div', { className: 'dsh-scale-card-args' }, argsText))

  if (isMedia) {
    const info = mediaInfo(tool, props)
    const mediaRows: unknown[] = []
    if (info.taskId) {
      mediaRows.push(R.createElement('div', { className: 'dsh-scale-card-media-row' },
        R.createElement('span', { className: 'dsh-scale-card-name' }, info.taskId)))
    }
    if (info.status) {
      const statusClass = STATUS_CLASS[info.status] ?? 'dsh-scale-card-status'
      const label = MEDIA_STATUS_LABEL[info.status] ?? info.status
      mediaRows.push(R.createElement('span', { className: `dsh-scale-card-status ${statusClass}` }, label))
    }
    if (info.jobType) mediaRows.push(R.createElement('span', { className: 'dsh-scale-card-args' }, info.jobType))
    if (mediaRows.length > 0) {
      body.push(R.createElement('div', { className: 'dsh-scale-card-media' }, ...mediaRows))
    }
    if (info.outputs.length > 0) {
      body.push(R.createElement('div', { className: 'dsh-scale-card-media' },
        ...info.outputs.map(path =>
          R.createElement('div', { className: 'dsh-scale-card-media-row' },
            R.createElement('span', { className: 'dsh-scale-card-media-path' }, path)))))
    }
    if (info.error) {
      body.push(R.createElement('div', { className: 'dsh-scale-card-result' }, info.error))
    }
    // Unparseable result (error text, unexpected shape) — surface it raw so a
    // failure is never swallowed by the structured strip.
    const rawResult = preview(props.result ?? props.content ?? props.output)
    if (!parseResult(props.result ?? props.content ?? props.output) && rawResult) {
      body.push(R.createElement('div', { className: 'dsh-scale-card-result' }, rawResult))
    }
  } else {
    if (resultText) body.push(R.createElement('div', { className: 'dsh-scale-card-result' }, resultText))
  }

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
