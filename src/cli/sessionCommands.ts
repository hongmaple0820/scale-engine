// SCALE Engine — Session Commands
import { readFileSync } from 'node:fs'
import { defineCommand } from 'citty'
import { getEngine } from './engineBootstrap.js'

export const sessionStart = defineCommand({
  meta: { name: 'start', description: 'Start a new session' },
  args: {
    agent: { type: 'string', default: 'claude-code' },
    'session-id': { type: 'string', required: true },
  },
  async run({ args }) {
    const { eventBus } = getEngine()
    eventBus.emit('session.started', {
      agent: args.agent,
      sessionId: args['session-id'],
      startedAt: Date.now(),
    }, { sessionId: args['session-id'] })
    console.log(JSON.stringify({ ok: true, sessionId: args['session-id'], agent: args.agent }))
  },
})

export const sessionEnd = defineCommand({
  meta: { name: 'end', description: 'End current session' },
  args: {
    'session-id': { type: 'string', required: false },
    stdin: { type: 'boolean', default: false, description: 'Read session_id from the hook payload on stdin (Claude Code / ZCode SessionEnd hooks)' },
  },
  async run({ args }) {
    // #34：SessionEnd hook 的 session_id 在 stdin JSON payload 里，不在环境变量里
    const payload = args.stdin && !process.stdin.isTTY ? readStdinHookPayload() : undefined
    const sessionId = firstNonEmptyString(args['session-id'], payload?.session_id)
    if (!sessionId) {
      process.stderr.write('scale session end: --session-id is required (or pass --stdin to read it from the hook payload)\n')
      process.exitCode = 1
      return
    }
    const { eventBus } = getEngine()
    eventBus.emit('session.ended', {
      sessionId,
      endedAt: Date.now(),
    }, { sessionId })
    console.log(JSON.stringify({ ok: true, sessionId }))
  },
})

export const sessionCommand = defineCommand({
  meta: { name: 'session', description: 'Session lifecycle' },
  subCommands: { start: sessionStart, end: sessionEnd },
})

/** 读取 stdin 上的 hook payload（Claude Code / ZCode 等 stdin 协议 agent）。 */
function readStdinHookPayload(): Record<string, unknown> | undefined {
  try {
    const raw = readFileSync(0, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // 无 payload 或非 JSON：交给调用方兜底
  }
  return undefined
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return undefined
}
