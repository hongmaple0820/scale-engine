import { defineCommand } from 'citty'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { ShadowReplayLedger, type ShadowReplayLedgerRecord } from '../evolution/ShadowReplayLedger.js'

function ledgerPath(value: unknown): string {
  return resolve(typeof value === 'string' && value.trim() ? value : '.scale/evolution/shadow-replays.sqlite')
}

function printRecord(record: ShadowReplayLedgerRecord): void {
  console.log(`Run: ${record.runId}`)
  console.log(`Status: ${record.result.status}`)
  console.log(`Candidate: ${record.plan.candidateId}`)
  console.log(`Failure: ${record.plan.failureId}`)
  console.log(`Adapter: ${record.plan.adapterId}@${record.plan.adapterVersion}`)
  console.log(`Sandbox: ${record.plan.sandboxKind}`)
  console.log(`Source commit: ${record.plan.sourceCommitSha}`)
  console.log(`Recorded: ${record.recordedAt}`)
  console.log(`Runner image: ${record.provenance.runnerImageRef ?? '(not recorded)'}`)
  console.log(`Production policy changed: ${record.result.productionPolicyChanged}`)
  console.log(`Hooks changed: ${record.result.hooksChanged}`)
  if (record.result.stdoutSummary) console.log(`stdout:\\n${record.result.stdoutSummary}`)
  if (record.result.stderrSummary) console.log(`stderr:\\n${record.result.stderrSummary}`)
}

const list = defineCommand({
  meta: { name: 'list', description: 'List persisted Shadow Replay records (read-only)' },
  args: {
    'candidate-id': { type: 'string', description: 'Filter by candidate ID' },
    'failure-id': { type: 'string', description: 'Filter by failure ID' },
    limit: { type: 'string', default: '100', description: 'Maximum records to return (1-10000)' },
    db: { type: 'string', description: 'Ledger SQLite path' },
    json: { type: 'boolean', default: false, description: 'Output JSON' },
  },
  run({ args }) {
    const path = ledgerPath(args.db)
    if (!existsSync(path)) {
      if (args.json) console.log(JSON.stringify({ records: [], ledgerPath: path }))
      else console.log(`No Shadow Replay ledger found at ${path}`)
      return
    }
    const limit = Number(args.limit)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      console.error('--limit must be an integer between 1 and 10000')
      process.exitCode = 1
      return
    }
    const ledger = new ShadowReplayLedger({ dbPath: path, readonly: true })
    try {
      const records = ledger.list({ candidateId: args['candidate-id'] as string | undefined, failureId: args['failure-id'] as string | undefined, limit })
      if (args.json) console.log(JSON.stringify({ records, ledgerPath: path }, null, 2))
      else if (!records.length) console.log('No Shadow Replay records found.')
      else for (const record of records) printRecord(record)
    } catch (error) {
      console.error((error as Error).message)
      process.exitCode = 1
    } finally { ledger.close() }
  },
})

const show = defineCommand({
  meta: { name: 'show', description: 'Show one Shadow Replay record (read-only)' },
  args: {
    'run-id': { type: 'positional', required: true, description: 'Shadow Replay run ID' },
    db: { type: 'string', description: 'Ledger SQLite path' },
    json: { type: 'boolean', default: false, description: 'Output JSON' },
  },
  run({ args }) {
    const path = ledgerPath(args.db)
    if (!existsSync(path)) {
      console.error(`Shadow Replay ledger not found: ${path}`)
      process.exitCode = 1
      return
    }
    const ledger = new ShadowReplayLedger({ dbPath: path, readonly: true })
    try {
      const record = ledger.get(args['run-id'] as string)
      if (!record) {
        console.error(`Shadow Replay run not found: ${args['run-id']}`)
        process.exitCode = 1
        return
      }
      if (args.json) console.log(JSON.stringify(record, null, 2))
      else printRecord(record)
    } catch (error) {
      console.error((error as Error).message)
      process.exitCode = 1
    } finally { ledger.close() }
  },
})

export const shadowReplayCommand = defineCommand({
  meta: { name: 'shadow-replay', description: 'Inspect isolated Shadow Replay evidence (read-only)' },
  subCommands: { list, show },
})
