// dsh-scale: SCALE Engine governance plugin for DSH
// -------------------------------------------
// Components:
//   shieldBridge   — tools/pre-execute waterfall (block→deny, warn→ask)
//   cortexBridge   — systemPrompt.context instinct injection
//   evidenceBridge — tools/post-execute evidence recording (async, failures-first)
//
// Plan §6 T1: "all three bridges in one apply() with ctx.effect cleanup"

import Schema from 'schemastery'
import type { CordisContext } from './dshTypes.js'
import { resolveProjectDir, toShieldInput, evaluateShield } from './shieldBridge.js'
import { buildCortexContext } from './cortexBridge.js'
import {
  recordToolEvidence,
  resetEvidenceBridge,
  pendingEvidenceWrites,
  type EvidenceMode,
} from './evidenceBridge.js'
import { registerScaleCommands } from './commandsBridge.js'
import { createScaleSkillProvider } from './skillsBridge.js'

// --- Config schema ---
export interface ScalePluginConfig {
  projectDir?: string
  enableShield?: boolean
  enableCortex?: boolean
  enableEvidence?: boolean
  enableCommands?: boolean
  enableSkills?: boolean
  /** 'failures-only' (default): record failed/blocked calls only (plan U8); 'all': record every call. */
  evidenceMode?: EvidenceMode
}

// Cordis validates this export during plugin load (schemastery Schema — a
// plain object fails with "Cannot read properties of undefined (reading 'validate')")
export const Config = Schema.object({
  projectDir: Schema.string().default(''),
  enableShield: Schema.boolean().default(true),
  enableCortex: Schema.boolean().default(true),
  enableEvidence: Schema.boolean().default(true),
  enableCommands: Schema.boolean().default(true),
  enableSkills: Schema.boolean().default(true),
  evidenceMode: Schema.union(['failures-only', 'all']).default('failures-only'),
})

export const name = 'dsh-scale'

// Required services (plan §2.3 / tutorial pitfall 2): accessing a ctx service
// without declaring it here throws at apply() time.
export const inject = ['tools', 'systemPrompt', 'commands', 'skills']

interface ToolExecShape {
  name?: string
  arguments?: Record<string, unknown>
  agent?: { id?: string; session?: { header?: { cwd?: string } } }
}

/**
 * tools/post-execute argument normalizer. The exact event arity was only
 * runtime-verified for pre-execute (plan §5.6); handle both the documented
 * (exec, result, next) shape and the single wrapped-object shape.
 */
function normalizePostExecute(args: unknown[]): { exec: ToolExecShape; isError: boolean; result: unknown } | null {
  const first = args[0]
  if (args.length >= 2 && first !== null && typeof first === 'object' && 'name' in first) {
    const result = args[1] as { isError?: boolean } | null
    return {
      exec: first as ToolExecShape,
      isError: Boolean(result && typeof result === 'object' && 'isError' in result && result.isError),
      result,
    }
  }
  if (first !== null && typeof first === 'object' && 'execution' in first) {
    const wrapped = first as { execution?: ToolExecShape; error?: unknown; result?: unknown }
    return { exec: wrapped.execution ?? {}, isError: Boolean(wrapped.error), result: wrapped.result }
  }
  return null
}

// Required by Cordis: the one hook DSH calls for every plugin
export function apply(ctx: CordisContext, config: Partial<ScalePluginConfig> = {}) {
  const effective = {
    enableShield: true,
    enableCortex: true,
    enableEvidence: true,
    enableCommands: true,
    enableSkills: true,
    evidenceMode: 'failures-only' as EvidenceMode,
    ...config,
  }

  // =========================================================
  // Shield: tools/pre-execute waterfall (T1.1)
  // =========================================================
  if (effective.enableShield) {
    ctx.on('tools/pre-execute', async (...args: unknown[]) => {
      const exec = args[0] as ToolExecShape
      const next = args[args.length - 1] as () => Promise<{ kind: string }>
      // MUST call next() — waterfall: if a prior hook already denied, skip
      const decision = await next()
      if (decision && decision.kind !== 'allow') return decision

      const projectDir = resolveProjectDir(effective, exec)
      const input = toShieldInput(
        { name: exec.name ?? 'unknown', arguments: exec.arguments, agent: exec.agent },
        projectDir,
      )
      return evaluateShield(input)
    })
  }

  // =========================================================
  // Cortex: system prompt instinct injection (T1.2)
  // =========================================================
  if (effective.enableCortex) {
    const projectDir = effective.projectDir || process.cwd()
    const entry = buildCortexContext(projectDir)

    // Single registration; DSH assembles the context into every model turn
    if (entry && ctx.systemPrompt?.context) {
      try {
        ctx.systemPrompt.context(entry.id, entry.content, { order: entry.order })
      } catch {
        // context registration is best-effort; Shield/Evidence stay up
      }
    }
  }

  // =========================================================
  // Evidence: tools/post-execute recording (T1.3)
  // =========================================================
  if (effective.enableEvidence) {
    const fallbackProjectDir = effective.projectDir || process.cwd()

    ctx.on('tools/post-execute', async (...args: unknown[]) => {
      // waterfall: forward first (must not short-circuit the chain), then observe
      const next = args[args.length - 1] as (() => Promise<unknown>) | undefined
      const decision = typeof next === 'function' ? await next() : undefined

      const normalized = normalizePostExecute(args)
      if (normalized) {
        const projectDir = resolveProjectDir(effective, normalized.exec) || fallbackProjectDir
        recordToolEvidence({
          toolName: normalized.exec.name ?? 'unknown',
          args: normalized.exec.arguments ?? {},
          result: normalized.result,
          error: normalized.isError,
          projectDir,
          sessionId: normalized.exec.agent?.id,
          mode: effective.evidenceMode,
        })
      }
      return decision
    })
  }

  // =========================================================
  // Commands: governance gates as slash commands (T2.1)
  // =========================================================
  if (effective.enableCommands) {
    const registered = registerScaleCommands(ctx, effective)
    if (registered > 0) {
      process.stderr.write(`[dsh-scale] registered ${registered} slash commands (scale-*)\n`)
    }
  }

  // =========================================================
  // Skills: .scale/skills phase workflows into the DSH registry (T2.2)
  // =========================================================
  if (effective.enableSkills) {
    const projectDirFor = () => effective.projectDir || process.cwd()
    try {
      ctx.skills?.registerProvider?.(() => createScaleSkillProvider(projectDirFor))
    } catch {
      // duplicate provider name (reload) — keep the first registration
    }
  }

  // =========================================================
  // Cleanup (plan §2.3 — dispose everything explicitly registered here;
  // ctx.on listeners are tracked by Cordis itself)
  // =========================================================
  ctx.effect(() => {
    return () => {
      // Drain in-flight evidence writes, then reset bridge state so a later
      // reload starts clean. Multiple async disposers have no ordering
      // guarantee (plan §2.3) — this plugin has exactly one.
      void pendingEvidenceWrites().finally(() => resetEvidenceBridge())
    }
  })

  // =========================================================
  // Self-test driver (§5.6 pattern — zero API cost, verifiable).
  // OPT-IN: SCALE_DSH_SELFTEST=1 — never drive probe tool calls in
  // production sessions.
  // =========================================================
  if (process.env.SCALE_DSH_SELFTEST === '1') {
    // §2.12 fatal rule: any throw from a timer callback disposes the whole
    // DSH app — the self-test driver must be exception-safe by contract.
    setTimeout(async () => {
      try {
        const tools = ctx.tools
        if (!tools?.execute) {
          process.stderr.write('[dsh-scale selftest] ctx.tools.execute unavailable; skipping\n')
          return
        }

        process.stderr.write('[dsh-scale selftest] apply() running; shieldBridge loaded\n\n')

        // --- BLOCK: pwsh with recursive force delete (POSIX form — `rm` is a
        // pwsh alias for Remove-Item; the blocklist matches /\brm\s+-rf\b/) ---
        process.stderr.write('[selftest] driving BLOCK\n')
        const blockRes = await tools.execute({ name: 'pwsh', arguments: { command: 'rm -rf /tmp/x' }, signal: new AbortController().signal })
        process.stderr.write(`[selftest]      RESULT isError=${blockRes.isError}\n`)
        process.stderr.write(`[selftest]      CONTENT ${JSON.stringify(blockRes.content)}\n`)

        // --- BLOCK PROTECTED PATH: write to .scale/policy.yaml ---
        process.stderr.write('[selftest] driving PROTECT\n')
        const protRes = await tools.execute({ name: 'write', arguments: { file_path: '.scale/policy.yaml', content: 'test' }, signal: new AbortController().signal })
        process.stderr.write(`[selftest]      RESULT isError=${protRes.isError}\n`)
        process.stderr.write(`[selftest]      CONTENT ${JSON.stringify(protRes.content)}\n`)

        // --- ALLOW: harmless pwsh call (no false positives) ---
        // `read` is agent-scoped in dsh-base and invisible to a contextless
        // boot-time probe ("unknown tool"); pwsh is globally registered.
        process.stderr.write('[selftest] driving ALLOW (pwsh Get-Location)\n')
        const allowRes = await tools.execute({ name: 'pwsh', arguments: { command: 'Get-Location' }, signal: new AbortController().signal })
        process.stderr.write(`[selftest]      RESULT isError=${allowRes.isError}\n`)
        process.stderr.write(`[selftest]      CONTENT ${JSON.stringify(allowRes.content).slice(0, 300)}\n`)

        // Drain evidence writes so blocked calls land before process exit
        await pendingEvidenceWrites()
      } catch (err) {
        process.stderr.write(
          `[dsh-scale selftest] FAILED: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
        )
      }
    }, 500)
  }
}
