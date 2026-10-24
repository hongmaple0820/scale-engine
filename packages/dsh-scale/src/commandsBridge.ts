// dsh-scale: Commands Bridge (T2.1) — exposes SCALE governance gates as DSH
// slash commands. Commands are user-invoked UI actions; they never enter the
// model (plan §2.7). Only non-daemon commands are allowlisted — long-running
// surfaces (open/dashboard/orch start) stay out because DSH has its own
// scheduling (plan §6 T2.1).

import type { CommandResult, CommandsService } from './dshTypes.js'
import { runScaleCli } from './cliExecutor.js'

export interface ScaleCommandSpec {
  /** DSH slash command name: /^[a-z][a-z0-9_-]*$/ */
  name: string
  description: string
  /** CLI argv after the `scale` binary (allowlisted — raw user input is never appended) */
  args: string[]
  /** timeout override for slow gates */
  timeoutMs?: number
}

/**
 * The T2.1 allowlist (plan §6: candidates from ~90 top-level commands).
 * Deliberately excludes daemons (open, dashboard, orch start) and anything
 * that mutates agent installs from inside a UI command.
 */
export const SCALE_COMMANDS: ScaleCommandSpec[] = [
  { name: 'scale-preflight', description: 'Run SCALE preflight checks for this project', args: ['preflight'] },
  { name: 'scale-gate-quality', description: 'Run the SCALE quality gate chain', args: ['gate', 'quality'], timeoutMs: 300_000 },
  { name: 'scale-verify', description: 'Run SCALE verify with the default profile', args: ['verify', '--profile', 'default'], timeoutMs: 300_000 },
  { name: 'scale-shield-status', description: 'Show Scale Shield hook registration and .scale integrity', args: ['shield', 'status'] },
  { name: 'scale-cortex-metrics', description: 'Show SCALE Cortex governance ROI metrics (30 days)', args: ['cortex', 'metrics', '--days', '30'] },
  { name: 'scale-doctor-env', description: 'Diagnose the SCALE environment', args: ['doctor', 'env'] },
]

/**
 * Register the allowlisted SCALE commands. The handler stays inside the
 * CommandResult contract on every path — a throw would settle as an error
 * result, but not throwing is cheaper and keeps our own message.
 */
export function registerScaleCommands(
  ctx: { commands?: CommandsService },
  config: { projectDir?: string },
): number {
  const commands = ctx.commands
  if (!commands?.register) return 0

  let registered = 0
  for (const spec of SCALE_COMMANDS) {
    try {
      commands.register({
        name: spec.name,
        description: spec.description,
        handler: async (): Promise<CommandResult> => {
          const projectDir = config.projectDir || process.cwd()
          const result = await runScaleCli(spec.args, projectDir, spec.timeoutMs)
          const text = `$ scale ${spec.args.join(' ')}\n${result.output.trim()}`.trim()
          return result.ok
            ? { kind: 'success', text }
            : { kind: 'error', text: `${text}\n(exit ${result.exitCode ?? 'killed'})` }
        },
      })
      registered += 1
    } catch {
      // duplicate name (reload) or registry closed — skip this command, keep the rest
    }
  }
  return registered
}
