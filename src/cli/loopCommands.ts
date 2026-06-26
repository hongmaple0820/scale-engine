import { defineCommand } from 'citty'
import { resolve } from 'node:path'
import { PROJECT_DIR, resolveScaleDirForProject } from './engineBootstrap.js'
import {
  createLoopListReport,
  createLoopStatusReport,
  renderLoopList,
  renderLoopRun,
  renderLoopStatus,
  runLoop,
  writeDefaultLoopConfig,
} from '../loops/LoopRegistry.js'

const loopInitCommand = defineCommand({
  meta: { name: 'init', description: 'Write the default hook-first loop configuration to .scale/loops.yaml' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    force: { type: 'boolean', default: false, description: 'Overwrite existing .scale/loops.yaml' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const report = writeDefaultLoopConfig({
      projectDir,
      scaleDir,
      force: args.force === true,
    })
    if (args.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      return
    }
    process.stdout.write(`SCALE Loop config ${report.written ? 'written' : 'already exists'}: ${report.path}\n`)
    for (const warning of report.warnings) process.stdout.write(`warning: ${warning}\n`)
    for (const command of report.nextCommands) process.stdout.write(`next: ${command}\n`)
  },
})

const loopListCommand = defineCommand({
  meta: { name: 'list', description: 'List configured Loop Engineering presets and project loops' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const report = createLoopListReport({ projectDir, scaleDir })
    if (args.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      return
    }
    process.stdout.write(`${renderLoopList(report)}\n`)
  },
})

const loopStatusCommand = defineCommand({
  meta: { name: 'status', description: 'Inspect loop readiness, providers, and safety defaults' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const report = createLoopStatusReport({ projectDir, scaleDir })
    if (args.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      return
    }
    process.stdout.write(`${renderLoopStatus(report)}\n`)
  },
})

const loopRunCommand = defineCommand({
  meta: { name: 'run', description: 'Dry-run a loop event and write loop-run evidence' },
  args: {
    id: { type: 'positional', required: true, description: 'Loop id' },
    event: { type: 'string', description: 'Event type to evaluate' },
    'feishu-chat-id': { type: 'string', description: 'Feishu/Lark chat id (oc_xxx) used to build a dry-run notify command plan' },
    'feishu-user-id': { type: 'string', description: 'Feishu/Lark user id (ou_xxx) used to build a dry-run notify command plan' },
    message: { type: 'string', description: 'Override the default notification text for message-channel dry-runs' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const report = runLoop({
      projectDir,
      scaleDir,
      loopId: String(args.id),
      eventType: optionalString(args.event),
      dryRun: true,
      feishuChatId: optionalString(args['feishu-chat-id']),
      feishuUserId: optionalString(args['feishu-user-id']),
      notificationText: optionalString(args.message),
    })

    if (!report.ok) process.exitCode = 1
    if (args.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      return
    }
    process.stdout.write(`${renderLoopRun(report)}\n`)
  },
})

export const loopCommand = defineCommand({
  meta: { name: 'loop', description: 'Hook-first Loop Engineering registry and dry-run execution' },
  subCommands: {
    init: loopInitCommand,
    list: loopListCommand,
    status: loopStatusCommand,
    run: loopRunCommand,
  },
})

function optionalString(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim()
  return normalized ? normalized : undefined
}
