// SCALE Engine — Gate Inline Commands (Hook 入口)
import { defineCommand } from 'citty'
import { RuntimeEvidenceLedger, SessionLedger } from '../runtime/index.js'
import { getEngine, PROJECT_DIR, resolveScaleDirForProject } from './engineBootstrap.js'

export const gatePreTool = defineCommand({
  meta: { name: 'pre-tool', description: 'Pre-tool gate check' },
  args: {
    tool: { type: 'positional', required: true },
    'args-json': { type: 'string', default: '{}' },
    'session-id': { type: 'string' },
  },
  async run({ args }) {
    const { gateway } = getEngine()
    const sessionId = resolveHookSessionId(args['session-id'])
    const toolArgs = parseToolArgs(args['args-json'])
    const decision = await gateway.preTool({
      sessionId,
      tool: args.tool,
      args: toolArgs,
    })
    if (!decision.allow) {
      process.stderr.write(decision.reason ?? 'Blocked by SCALE guardrail')
      if (decision.suggestion) process.stderr.write(`\nSuggestion: ${decision.suggestion}`)
      process.exit(2)
    }
  },
})

export const gatePostTool = defineCommand({
  meta: { name: 'post-tool', description: 'Post-tool event recording' },
  args: {
    tool: { type: 'positional', required: true },
    'args-json': { type: 'string', default: '{}' },
    'output-json': { type: 'string', default: '' },
    'exit-code': { type: 'string', default: '0' },
    'session-id': { type: 'string' },
    command: { type: 'string', description: 'Fallback command text when the hook cannot pass args-json' },
  },
  async run({ args }) {
    const { gateway, eventBus } = getEngine()
    const sessionId = resolveHookSessionId(args['session-id'])
    const toolArgs = parseToolArgs(args['args-json'])
    const fallbackCommand = typeof args.command === 'string' && args.command.trim().length > 0
      ? args.command.trim()
      : undefined
    if (!toolArgs.command && fallbackCommand) toolArgs.command = fallbackCommand
    const exitCode = parseExitCode(args['exit-code'])
    await gateway.postTool({
      sessionId,
      tool: args.tool,
      args: toolArgs,
      exitCode,
      output: args['output-json'],
    })
    const command = commandFromToolArgs(toolArgs)
    if (args.tool === 'Bash' && command && isVerificationCommand(command)) {
      const scaleDir = resolveScaleDirForProject(PROJECT_DIR)
      const status = exitCode === 0 ? 'passed' : 'failed'
      const evidence = new RuntimeEvidenceLedger({ projectDir: PROJECT_DIR, scaleDir }).record({
        sessionId,
        kind: 'command',
        title: `Hook verification command: ${command}`,
        status,
        command,
        exitCode,
        summary: status === 'passed'
          ? `Verification command passed through scale gate post-tool: ${command}`
          : `Verification command failed through scale gate post-tool with exit code ${exitCode}: ${command}`,
        metadata: {
          source: 'scale-gate-post-tool',
          hook: true,
          validation: true,
          tool: args.tool,
        },
      })
      new SessionLedger({ projectDir: PROJECT_DIR, scaleDir }).append(sessionId, {
        type: 'evidence.recorded',
        message: `Verification evidence recorded: ${command}`,
        data: {
          evidenceId: evidence.id,
          command,
          status,
          exitCode,
        },
      })
      eventBus.emit('verification.recorded', {
        evidenceId: evidence.id,
        command,
        status,
        exitCode,
      }, { sessionId })
    }
  },
})

export const gateBeforeStop = defineCommand({
  meta: { name: 'before-stop', description: 'Before-stop hook check. Defaults to a non-blocking hook-safe path; pass --enforce for full gateway enforcement.' },
  args: {
    'session-id': { type: 'string' },
    'hook-safe': { type: 'boolean', default: false, description: 'Document that this invocation is running inside an agent Stop hook' },
    enforce: { type: 'boolean', default: false, description: 'Run the full gateway before-stop detector path' },
  },
  async run({ args }) {
    if (!args.enforce) {
      if (process.env.SCALE_GATE_VERBOSE === '1') {
        process.stderr.write('[scale] before-stop hook-safe pass; run with --enforce for full gateway checks\n')
      }
      return
    }
    const sessionId = resolveHookSessionId(args['session-id'])
    const { gateway } = getEngine()
    const decision = await gateway.beforeStop({ sessionId })
    if (!decision.allow) {
      process.stderr.write(decision.reason ?? 'Cannot stop yet')
      if (decision.suggestion) process.stderr.write(`\nSuggestion: ${decision.suggestion}`)
      process.exit(2)
    }
  },
})

function parseToolArgs(value: unknown): Record<string, unknown> {
  for (const candidate of [
    value,
    process.env.TOOL_INPUT_JSON,
    process.env.ARGS,
  ]) {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) continue
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      // Try the next hook-provided source.
    }
  }
  return {}
}

function parseExitCode(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? '0'), 10)
  return Number.isNaN(parsed) ? 1 : parsed
}

function resolveHookSessionId(value: unknown): string {
  const explicit = firstUsableSessionId(value, process.env.CLAUDE_SESSION_ID, process.env.SESSION_ID)
  if (explicit) return explicit

  const scaleDir = resolveScaleDirForProject(PROJECT_DIR)
  const ledger = new SessionLedger({ projectDir: PROJECT_DIR, scaleDir })
  const current = ledger.current()
  const today = new Date().toISOString().slice(0, 10)
  if (current?.status === 'active' && current.startedAt?.startsWith(today)) return current.sessionId

  const fallback = `HOOK-${today}`
  ledger.start({
    sessionId: fallback,
    agent: 'scale-hook',
    summary: 'SCALE hook fallback session for missing agent session id',
    metadata: {
      reason: 'missing-session-id',
      currentSessionWasStale: Boolean(current && !current.startedAt?.startsWith(today)),
    },
  })
  return fallback
}

function firstUsableSessionId(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const normalized = value.trim()
    if (!normalized || /^\$[A-Z_]+$/.test(normalized)) continue
    return normalized
  }
  return undefined
}

function commandFromToolArgs(args: Record<string, unknown>): string | undefined {
  for (const key of ['command', 'cmd', 'script']) {
    const value = args[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return undefined
}

function isVerificationCommand(command: string): boolean {
  return /\b(test|lint|build|typecheck|tsc|vitest|jest|playwright|preflight|verify)\b/i.test(command)
}

export const gateCommand = defineCommand({
  meta: { name: 'gate', description: 'Guardrail gate commands' },
  subCommands: { 'pre-tool': gatePreTool, 'post-tool': gatePostTool, 'before-stop': gateBeforeStop },
})
