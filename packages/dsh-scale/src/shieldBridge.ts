// dsh-scale: Shield Bridge — tool interception adapter
// Maps DSH tool names → SCALE ShieldInput, calls checkToolInput,
// and maps block/warn → deny/ask.
//
// Key properties (plan §6 T1.1):
// - MUST call next() in waterfall; skip when decision != allow
// - block → { kind: 'deny' }
// - warn → { kind: 'ask' } (not silently dropped as in bare hook mode)
// - mcp__scale__ prefix unpacking (shell_run → Bash semantic)
// - projectDir per-execution, not fixed at apply time

import {
  checkToolInput,
  checkWarnHits,
} from '@hongmaple0820/scale-engine'
import type { ShieldInput, ShieldDecision } from '@hongmaple0820/scale-engine'

// ---------------------------------------------------------------------------
// Tool name mapping (plan §6 — empirically verified against DSH's 107 tools)
// ---------------------------------------------------------------------------
const TOOL_NAME_MAP: Record<string, string> = {
  pwsh: 'Bash',
  write: 'Write',
  edit: 'Edit',
  read: 'Read',
}

const MCP_PREFIX = 'mcp__scale__'

// ---------------------------------------------------------------------------
// projectDir resolution — per-execution, not at apply time
// ---------------------------------------------------------------------------
export function resolveProjectDir(
  config: { projectDir?: string },
  exec: { agent?: { session?: { header?: { cwd?: string } } } },
): string {
  if (config.projectDir) return config.projectDir
  if (exec.agent?.session?.header?.cwd) return exec.agent.session.header.cwd
  return process.cwd()
}

// ---------------------------------------------------------------------------
// Shield input adapter
// ---------------------------------------------------------------------------
export function toShieldInput(
  exec: { name: string; arguments?: Record<string, unknown>; agent?: { id?: string } },
  projectDir: string,
): ShieldInput {
  let toolName = exec.name

  // Unpack mcp__scale__<tool> prefix (plan §6 T1.1)
  if (toolName.startsWith(MCP_PREFIX)) {
    const raw = toolName.slice(MCP_PREFIX.length)
    // shell_run has pwsh semantics for command blocklist matching
    toolName = raw === 'shell_run' ? 'Bash' : raw
  } else {
    toolName = TOOL_NAME_MAP[toolName] ?? toolName
  }

  return {
    session_id: exec.agent?.id ?? 'unknown',
    cwd: projectDir,
    tool_name: toolName,
    tool_input: exec.arguments ?? {},
  }
}

// ---------------------------------------------------------------------------
// Shield decision → DSH PreToolDecision
// ---------------------------------------------------------------------------
export interface PreToolDecision {
  kind: 'allow' | 'deny' | 'cancel' | 'ask'
  reason?: string
  displayReason?: { en: string; [loc: string]: string }
}

export function evaluateShield(
  input: ShieldInput,
): PreToolDecision {
  const result: ShieldDecision = checkToolInput(input)

  if (result.decision === 'block') {
    return { kind: 'deny', reason: result.reason }
  }

  // warn → ask (not silently dropped — plan §6 audit gap fix)
  if (input.tool_name === 'Bash') {
    const command = String(input.tool_input?.command ?? '')
    const warnHits = checkWarnHits(command)
    if (warnHits.length > 0) {
      return {
        kind: 'ask',
        displayReason: {
          en: `[SCALE SHIELD WARN] ${warnHits[0].reason} — ${warnHits[0].category}`,
          zh: `【SCALE 盾警告】${warnHits[0].reason} — ${warnHits[0].category}`,
        },
      }
    }
  }

  return { kind: 'allow' }
}
