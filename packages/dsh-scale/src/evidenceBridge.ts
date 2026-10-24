// dsh-scale: Evidence Bridge — post-execute evidence recording
// Hooks into tools/post-execute and records into SCALE's RuntimeEvidenceLedger.
//
// Plan §6 T1.3: the ledger's sync record() is writeFileSync — running that on
// every tool call would block the DSH Electron host's event loop. So:
//   - writes go through recordAsync() (fs/promises, added for this bridge)
//   - writes are serialized through a promise chain (order preserved,
//     unbounded concurrency impossible)
//   - default mode 'failures-only': successful tool calls are not persisted
//     until the write-volume impact is measured (plan U8); 'all' records both

import { RuntimeEvidenceLedger } from '@hongmaple0820/scale-engine'

export type EvidenceMode = 'failures-only' | 'all'

export interface ToolEvidenceParams {
  toolName: string
  args: Record<string, unknown>
  result: unknown
  error: boolean
  projectDir: string
  sessionId?: string
  mode?: EvidenceMode
}

// Per-projectDir ledgers — a DSH session may serve multiple workspaces
const ledgers = new Map<string, RuntimeEvidenceLedger | null>()
const ledgerErrors = new Map<string, Error>()

let writeQueue: Promise<void> = Promise.resolve()

/** Await all in-flight evidence writes (tests, graceful shutdown). */
export function pendingEvidenceWrites(): Promise<void> {
  return writeQueue
}

/** Reset module state — plugin unload (ctx.effect disposer) and tests. */
export function resetEvidenceBridge(): void {
  ledgers.clear()
  ledgerErrors.clear()
  writeQueue = Promise.resolve()
}

function getLedger(projectDir: string): RuntimeEvidenceLedger | null {
  if (ledgers.has(projectDir)) return ledgers.get(projectDir) ?? null
  if (ledgerErrors.has(projectDir)) return null

  let ledger: RuntimeEvidenceLedger | null
  try {
    ledger = new RuntimeEvidenceLedger({ projectDir, createDirs: true })
  } catch (err) {
    ledgerErrors.set(projectDir, err instanceof Error ? err : new Error(String(err)))
    ledger = null
  }
  ledgers.set(projectDir, ledger)
  return ledger
}

/**
 * Record a tool execution. Fire-and-forget: enqueues an async write and
 * returns immediately — evidence must never block or fail the tool result.
 */
export function recordToolEvidence(params: ToolEvidenceParams): void {
  const mode = params.mode ?? 'failures-only'
  if (mode === 'failures-only' && !params.error) return

  const ledger = getLedger(params.projectDir)
  if (!ledger) return

  const filePath = typeof params.args?.file_path === 'string' ? params.args.file_path : undefined
  const summary = params.error
    ? `Failed or blocked tool call: ${params.toolName}`
    : `Executed: ${params.toolName}`
  const resultPreview = (() => {
    if (params.result === null || params.result === undefined) return ''
    if (typeof params.result === 'object') {
      try {
        return JSON.stringify(params.result).slice(0, 500)
      } catch {
        return '[unserializable]'
      }
    }
    return String(params.result).slice(0, 500)
  })()

  writeQueue = writeQueue
    .then(() =>
      ledger!.recordAsync({
        sessionId: params.sessionId,
        kind: 'tool',
        title: `DSH: ${params.toolName}`,
        status: params.error ? 'failed' : 'passed',
        command: params.toolName,
        exitCode: params.error ? 2 : 0,
        summary,
        artifacts: filePath ? [filePath] : undefined,
        metadata: {
          args: params.args,
          result: resultPreview,
          source: 'dsh-scale',
          mode,
        },
      }),
    )
    .then(() => undefined)
    .catch(() => {
      // Evidence recording is best-effort; never surface into the tool pipeline
    })
}
