import { defineCommand } from 'citty'
import { join, resolve } from 'node:path'
import { DashboardServer } from '../dashboard/DashboardServer.js'

const DEFAULT_PROJECT_DIR = process.env.SCALE_PROJECT_DIR ?? process.cwd()
const DEFAULT_DASHBOARD_URL = process.env.SCALE_DASHBOARD_URL ?? ''

export const agentControlCommand = defineCommand({
  meta: { name: 'agent-control', description: 'Agent OS control-plane inbox, claim, reply, and status commands' },
  subCommands: {
    status: defineCommand({
      meta: { name: 'status', description: 'Show project-scoped Agent Control sessions and queue status' },
      args: commonArgs(),
      async run({ args }) {
        const report = await agentControlJson(args, '/api/agent-control')
        if (args.json) {
          console.log(JSON.stringify(report, null, 2))
          return
        }
        renderStatus(report)
      },
    }),
    inbox: defineCommand({
      meta: { name: 'inbox', description: 'Poll an agent session inbox and optionally claim the first queued task' },
      args: {
        ...commonArgs(),
        session: { type: 'string', default: 'default', description: 'Agent session id' },
        'include-claimed': { type: 'boolean', default: false, description: 'Include already claimed tasks' },
        'claim-first': { type: 'boolean', default: false, description: 'Claim the first queued task before printing' },
        'agent-id': { type: 'string', default: 'scale-agent', description: 'Agent runtime id used for claiming' },
      },
      async run({ args }) {
        const sessionId = requiredString(args.session, 'session')
        const inbox = await agentControlJson(args, `/api/agent-control/sessions/${encodeURIComponent(sessionId)}/inbox${args['include-claimed'] ? '?includeClaimed=true' : ''}`)
        const messages = Array.isArray((inbox as { messages?: unknown[] }).messages) ? (inbox as { messages: Array<{ id?: string; status?: string }> }).messages : []
        const firstQueued = messages.find(message => message.status === 'queued' && message.id)
        const claimed = args['claim-first'] && firstQueued?.id
          ? await agentControlJson(args, `/api/agent-control/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(firstQueued.id)}/claim`, {
            method: 'POST',
            body: JSON.stringify({ agentId: String(args['agent-id'] ?? 'scale-agent') }),
          })
          : undefined
        const result = claimed ? { ...(inbox as Record<string, unknown>), claimed: (claimed as { message?: unknown }).message } : inbox
        if (args.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }
        renderInbox(result)
      },
    }),
    transcript: defineCommand({
      meta: { name: 'transcript', description: 'Show an agent session conversation transcript and summary card' },
      args: {
        ...commonArgs(),
        session: { type: 'string', default: 'default', description: 'Agent session id' },
        query: { type: 'string', description: 'Optional transcript search text' },
        status: { type: 'string', description: 'Optional message status filter' },
        limit: { type: 'string', default: '200', description: 'Maximum messages to return' },
      },
      async run({ args }) {
        const sessionId = requiredString(args.session, 'session')
        const params = new URLSearchParams()
        if (optionalString(args.query)) params.set('query', String(args.query))
        if (optionalString(args.status)) params.set('status', String(args.status))
        if (optionalString(args.limit)) params.set('limit', String(args.limit))
        const suffix = params.toString() ? `?${params}` : ''
        const result = await agentControlJson(args, `/api/agent-control/sessions/${encodeURIComponent(sessionId)}/transcript${suffix}`)
        if (args.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }
        renderTranscript(result)
      },
    }),
    search: defineCommand({
      meta: { name: 'search', description: 'Search agent-control transcripts across sessions' },
      args: {
        ...commonArgs(),
        query: { type: 'string', description: 'Search text' },
        session: { type: 'string', description: 'Optional agent session id' },
        status: { type: 'string', description: 'Optional message status filter' },
        limit: { type: 'string', default: '50', description: 'Maximum hits to return' },
      },
      async run({ args }) {
        const params = new URLSearchParams()
        if (optionalString(args.query)) params.set('query', String(args.query))
        if (optionalString(args.session)) params.set('sessionId', String(args.session))
        if (optionalString(args.status)) params.set('status', String(args.status))
        if (optionalString(args.limit)) params.set('limit', String(args.limit))
        const result = await agentControlJson(args, `/api/agent-control/transcripts?${params}`)
        if (args.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }
        renderSearch(result)
      },
    }),
    summary: defineCommand({
      meta: { name: 'summary', description: 'Generate and persist an agent session summary card' },
      args: {
        ...commonArgs(),
        session: { type: 'string', default: 'default', description: 'Agent session id' },
      },
      async run({ args }) {
        const sessionId = requiredString(args.session, 'session')
        const result = await agentControlJson(args, `/api/agent-control/sessions/${encodeURIComponent(sessionId)}/summary`, { method: 'POST' })
        if (args.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }
        const summary = (result as { summary?: { markdown?: string } }).summary
        console.log(summary?.markdown ?? JSON.stringify(result, null, 2))
      },
    }),
    claim: defineCommand({
      meta: { name: 'claim', description: 'Claim a specific Agent Control task message' },
      args: {
        ...commonArgs(),
        session: { type: 'string', default: 'default', description: 'Agent session id' },
        message: { type: 'string', description: 'Agent Control message id' },
        'agent-id': { type: 'string', default: 'scale-agent', description: 'Agent runtime id' },
        note: { type: 'string', description: 'Optional claim note' },
      },
      async run({ args }) {
        const sessionId = requiredString(args.session, 'session')
        const messageId = requiredString(args.message, 'message')
        const result = await agentControlJson(args, `/api/agent-control/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}/claim`, {
          method: 'POST',
          body: JSON.stringify({
            agentId: String(args['agent-id'] ?? 'scale-agent'),
            note: optionalString(args.note),
          }),
        })
        printResult(result, Boolean(args.json))
      },
    }),
    send: defineCommand({
      meta: { name: 'send', description: 'Queue a message from operator/dashboard to an agent session' },
      args: {
        ...commonArgs(),
        session: { type: 'string', default: 'default', description: 'Agent session id' },
        text: { type: 'string', description: 'Message text' },
        from: { type: 'string', default: 'cli', description: 'Operator identity' },
        'live-send': { type: 'boolean', default: false, description: 'Allow non-dry-run when the session is live-guarded' },
      },
      async run({ args }) {
        const sessionId = requiredString(args.session, 'session')
        const result = await agentControlJson(args, `/api/agent-control/sessions/${encodeURIComponent(sessionId)}/messages`, {
          method: 'POST',
          body: JSON.stringify({
            text: requiredString(args.text, 'text'),
            from: String(args.from ?? 'cli'),
            dryRun: !args['live-send'],
          }),
        })
        printResult(result, Boolean(args.json))
      },
    }),
    reply: defineCommand({
      meta: { name: 'reply', description: 'Complete a claimed task and optionally post an agent reply' },
      args: {
        ...commonArgs(),
        session: { type: 'string', default: 'default', description: 'Agent session id' },
        message: { type: 'string', description: 'Source operator-to-agent message id' },
        text: { type: 'string', description: 'Reply text' },
        'agent-id': { type: 'string', default: 'scale-agent', description: 'Agent runtime id' },
        status: { type: 'string', default: 'completed', description: 'Task result: completed, failed, or cancelled' },
        evidence: { type: 'string', description: 'Optional evidence file path' },
      },
      async run({ args }) {
        const sessionId = requiredString(args.session, 'session')
        const messageId = requiredString(args.message, 'message')
        const result = await agentControlJson(args, `/api/agent-control/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}/complete`, {
          method: 'POST',
          body: JSON.stringify({
            text: optionalString(args.text),
            agentId: String(args['agent-id'] ?? 'scale-agent'),
            status: String(args.status ?? 'completed'),
            evidencePath: optionalString(args.evidence),
          }),
        })
        printResult(result, Boolean(args.json))
      },
    }),
  },
})

function commonArgs() {
  return {
    dir: { type: 'string', default: DEFAULT_PROJECT_DIR, description: 'Project directory for local mode' },
    url: { type: 'string', default: DEFAULT_DASHBOARD_URL, description: 'Dashboard base URL for remote mode' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  } as const
}

async function agentControlJson(args: Record<string, unknown>, path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await agentControlRequest(args, path, init)
  const payload = await response.json().catch(async () => ({ error: await response.text().catch(() => response.statusText) })) as unknown
  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'error' in payload ? String((payload as { error?: unknown }).error) : response.statusText
    throw new Error(`Agent Control request failed (${response.status}): ${message}`)
  }
  return payload
}

async function agentControlRequest(args: Record<string, unknown>, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json')
  const baseUrl = optionalString(args.url)
  if (baseUrl) {
    return fetch(new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`), { ...init, headers })
  }

  const projectDir = resolve(String(args.dir ?? DEFAULT_PROJECT_DIR))
  const server = new DashboardServer({
    projectDir,
    scaleDir: join(projectDir, '.scale'),
  })
  return server.getApp().request(path, { ...init, headers })
}

function requiredString(value: unknown, name: string): string {
  const normalized = optionalString(value)
  if (!normalized) throw new Error(`--${name} is required.`)
  return normalized
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function printResult(result: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  console.log(JSON.stringify(result, null, 2))
}

function renderStatus(report: unknown): void {
  const typed = report as {
    project?: { name?: string; projectDir?: string }
    summary?: { sessions?: number; queuedMessages?: number; claimedMessages?: number; completedMessages?: number; failedMessages?: number }
    sessions?: Array<{ sessionId: string; name: string; status: string; platformName: string; modelId: string; pendingCount: number }>
  }
  console.log('SCALE Agent Control')
  console.log(`  Project: ${typed.project?.name ?? 'project'} (${typed.project?.projectDir ?? '-'})`)
  console.log(`  Sessions: ${typed.summary?.sessions ?? 0}`)
  console.log(`  Queue: queued=${typed.summary?.queuedMessages ?? 0}, claimed=${typed.summary?.claimedMessages ?? 0}, completed=${typed.summary?.completedMessages ?? 0}, failed=${typed.summary?.failedMessages ?? 0}`)
  for (const session of typed.sessions ?? []) {
    console.log(`  - ${session.sessionId}: ${session.status}, ${session.platformName}/${session.modelId}, pending=${session.pendingCount}`)
  }
}

function renderInbox(result: unknown): void {
  const typed = result as {
    sessionId?: string
    claimed?: { id?: string }
    messages?: Array<{ id: string; status: string; text: string; claimedBy?: string }>
  }
  console.log(`SCALE Agent Inbox: ${typed.sessionId ?? '-'}`)
  if (typed.claimed?.id) console.log(`  Claimed: ${typed.claimed.id}`)
  for (const message of typed.messages ?? []) {
    const owner = message.claimedBy ? ` claimedBy=${message.claimedBy}` : ''
    console.log(`  - ${message.id} [${message.status}]${owner}: ${message.text}`)
  }
}

function renderTranscript(result: unknown): void {
  const typed = result as {
    session?: { sessionId?: string; name?: string; platformName?: string; modelId?: string }
    summary?: { markdown?: string }
    messages?: Array<{ id: string; direction: string; status: string; text: string; from?: string; createdAt?: number }>
  }
  console.log(`SCALE Agent Transcript: ${typed.session?.sessionId ?? '-'} (${typed.session?.name ?? '-'})`)
  console.log(`  Runtime: ${typed.session?.platformName ?? '-'}/${typed.session?.modelId ?? '-'}`)
  if (typed.summary?.markdown) console.log(typed.summary.markdown.trim())
  for (const message of typed.messages ?? []) {
    const time = message.createdAt ? new Date(message.createdAt).toISOString() : '-'
    console.log(`  - ${time} ${message.direction} [${message.status}] ${message.from ?? '-'}: ${message.text}`)
  }
}

function renderSearch(result: unknown): void {
  const typed = result as {
    query?: string
    total?: number
    hits?: Array<{ sessionId: string; sessionName: string; platformName: string; matchPreview: string; message: { id: string; status: string; direction: string } }>
  }
  console.log(`SCALE Agent Transcript Search: "${typed.query ?? ''}" (${typed.total ?? 0})`)
  for (const hit of typed.hits ?? []) {
    console.log(`  - ${hit.sessionId}/${hit.message.id} [${hit.message.status}] ${hit.platformName}: ${hit.matchPreview}`)
  }
}
