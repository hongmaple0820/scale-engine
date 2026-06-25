// SCALE Engine — Gate Inline Commands (Hook 入口)
import { defineCommand } from 'citty'
import { getEngine } from './engineBootstrap.js'

export const gatePreTool = defineCommand({
  meta: { name: 'pre-tool', description: 'Pre-tool gate check' },
  args: {
    tool: { type: 'positional', required: true },
    'args-json': { type: 'string', default: '{}' },
    'session-id': { type: 'string', required: true },
  },
  async run({ args }) {
    const { gateway } = getEngine()
    let toolArgs: Record<string, unknown> = {}
    try { toolArgs = JSON.parse(args['args-json']) } catch { /* empty */ }
    const decision = await gateway.preTool({
      sessionId: args['session-id'],
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
    'session-id': { type: 'string', required: true },
  },
  async run({ args }) {
    const { gateway } = getEngine()
    let toolArgs: Record<string, unknown> = {}
    try { toolArgs = JSON.parse(args['args-json']) } catch { /* empty */ }
    await gateway.postTool({
      sessionId: args['session-id'],
      tool: args.tool,
      args: toolArgs,
      exitCode: parseInt(args['exit-code'], 10),
      output: args['output-json'],
    })
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
    const sessionId = String(args['session-id'] ?? process.env.CLAUDE_SESSION_ID ?? process.env.SESSION_ID ?? '').trim()
    if (!args.enforce) {
      if (process.env.SCALE_GATE_VERBOSE === '1') {
        process.stderr.write('[scale] before-stop hook-safe pass; run with --enforce for full gateway checks\n')
      }
      return
    }
    if (!sessionId) {
      process.stderr.write('Missing --session-id for enforced before-stop gate')
      process.exit(2)
    }
    const { gateway } = getEngine()
    const decision = await gateway.beforeStop({ sessionId })
    if (!decision.allow) {
      process.stderr.write(decision.reason ?? 'Cannot stop yet')
      if (decision.suggestion) process.stderr.write(`\nSuggestion: ${decision.suggestion}`)
      process.exit(2)
    }
  },
})

export const gateCommand = defineCommand({
  meta: { name: 'gate', description: 'Guardrail gate commands' },
  subCommands: { 'pre-tool': gatePreTool, 'post-tool': gatePostTool, 'before-stop': gateBeforeStop },
})
