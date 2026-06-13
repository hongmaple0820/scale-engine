import { defineCommand } from 'citty'
import { join } from 'node:path'
import { InstinctStore } from '../cortex/InstinctStore.js'

export const cortexApplyCommand = defineCommand({
  meta: {
    name: 'apply',
    description: 'Record the outcome of applying a Cortex instinct during real work',
  },
  args: {
    instinctId: { type: 'positional', required: true, description: 'Instinct id from cortex inject/runtime metadata' },
    dir: { type: 'string', default: process.cwd(), description: 'Project directory' },
    success: { type: 'boolean', default: false, description: 'Record that the instinct helped the work succeed' },
    failed: { type: 'boolean', default: false, description: 'Record that the instinct was applied but did not help' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = String(args.dir ?? process.cwd())
    const scaleDir = join(projectDir, '.scale')
    const instinctId = String(args.instinctId)
    const success = args.success === true
    const failed = args.failed === true
    const json = args.json === true

    if (success === failed) {
      writeApplyResult(json, {
        recorded: false,
        instinctId,
        error: 'explicit-outcome-required',
        message: 'Pass exactly one of --success or --failed.',
      })
      process.exitCode = 1
      return
    }

    const store = new InstinctStore(join(scaleDir, 'instincts'))
    const before = store.findById(instinctId)
    if (!before) {
      writeApplyResult(json, {
        recorded: false,
        instinctId,
        error: 'instinct-not-found',
      })
      process.exitCode = 1
      return
    }

    store.recordApplication(instinctId, success)
    const after = store.findById(instinctId)
    const audit = store.history(instinctId).slice().reverse()
      .find(entry => entry.op === 'apply' && entry.after?.updatedAt === after?.updatedAt)

    writeApplyResult(json, {
      recorded: Boolean(audit),
      instinctId,
      success,
      auditId: audit?.auditId,
      reason: audit?.reason,
      appliedCount: after?.appliedCount,
      hitRate: after?.hitRate,
    })
    if (!audit) process.exitCode = 1
  },
})

function writeApplyResult(json: boolean, result: Record<string, unknown>): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (result.recorded) {
    process.stdout.write(`Recorded Cortex instinct outcome: ${result.instinctId}\n`)
    process.stdout.write(`  Result: ${result.success ? 'success' : 'failed'}\n`)
    process.stdout.write(`  Audit: ${result.auditId}\n`)
    return
  }
  process.stderr.write(`Failed to record Cortex instinct outcome ${result.instinctId}: ${result.message ?? result.error}\n`)
}
