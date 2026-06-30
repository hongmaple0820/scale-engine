import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { ExecutionLedger, type ExecutionEvent } from '../runtime/ExecutionLedger.js'
import { CommandRunLedger, type CommandRunEvidence } from '../tools/CommandRunLedger.js'
import { parseCommandLine, runSafeCommand, type SafeCommandResult } from '../tools/SafeCommandRunner.js'

export type AgentOsShellRisk = 'read' | 'write' | 'network' | 'credential' | 'destructive'
export type AgentOsShellStatus = 'planned' | 'blocked' | 'passed' | 'failed'

export interface AgentOsSmartShellOptions {
  projectDir?: string
  scaleDir?: string
  now?: () => Date
  ledger?: ExecutionLedger
}

export interface PlanAgentOsShellCommandInput {
  command: string
  cwd?: string
  taskId?: string
  sessionId?: string
  approved?: boolean
  allowShell?: boolean
  timeoutMs?: number
}

export interface RunAgentOsShellCommandInput extends PlanAgentOsShellCommandInput {
  profile?: string
}

export interface AgentOsShellPlan {
  version: 1
  planId: string
  command: string
  cwd: string
  taskId?: string
  sessionId?: string
  createdAt: string
  risk: AgentOsShellRisk
  blocked: boolean
  requiresApproval: boolean
  approved: boolean
  reasons: string[]
  saferAlternatives: string[]
  parsed?: { file: string; args: string[] }
}

export interface AgentOsShellExecution {
  version: 1
  executionId: string
  plan: AgentOsShellPlan
  status: AgentOsShellStatus
  startedAt: string
  endedAt: string
  durationMs: number
  result?: SafeCommandResult
  evidence?: CommandRunEvidence
  events: {
    planned: ExecutionEvent
    executed: ExecutionEvent
  }
}

export interface AgentOsShellHistory {
  version: 1
  updatedAt: string
  executions: AgentOsShellExecution[]
}

const DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; reason: string; alternative?: string }> = [
  { pattern: /\brm\s+(-[^\s]*r[^\s]*f|-rf|-fr)\b/i, reason: 'recursive force removal', alternative: 'List target paths first, then remove explicit files after review.' },
  { pattern: /\bremove-item\b.*\b-recurse\b/i, reason: 'recursive PowerShell removal', alternative: 'Use Get-ChildItem to inspect targets before a scoped Remove-Item.' },
  { pattern: /\bdel\b.*\s\/s\b/i, reason: 'recursive Windows deletion', alternative: 'Use a non-recursive delete against explicit files.' },
  { pattern: /\brmdir\b.*\s\/s\b/i, reason: 'recursive directory deletion', alternative: 'Archive or move the directory after path verification.' },
  { pattern: /\bgit\s+reset\s+--hard\b/i, reason: 'hard git reset can discard work', alternative: 'Use git status and git diff to inspect changes first.' },
  { pattern: /\bgit\s+clean\b.*\s-[^\s]*f/i, reason: 'git clean can delete untracked files', alternative: 'Run git clean -nd first and review the dry-run list.' },
  { pattern: /\bgit\s+push\b.*\s--force\b/i, reason: 'force push can rewrite shared history', alternative: 'Use --force-with-lease after explicit review if force is required.' },
  { pattern: /\bkubectl\s+delete\b/i, reason: 'cluster delete operation', alternative: 'Run kubectl get/describe and capture target evidence before deletion.' },
  { pattern: /\bdrop\s+table\b/i, reason: 'database destructive operation', alternative: 'Create a migration with rollback and backup evidence.' },
  { pattern: /\bformat\b\s+[a-z]:/i, reason: 'disk format operation', alternative: 'Do not run format commands from Agent OS shell.' },
  { pattern: /\bchmod\s+777\b/i, reason: 'broad permission change', alternative: 'Use the narrowest permission required for the target file.' },
]

const CREDENTIAL_PATTERNS: Array<{ pattern: RegExp; reason: string; alternative?: string }> = [
  { pattern: /\bcat\s+\.env\b/i, reason: 'credential file read', alternative: 'Use a redacted secret inspector or environment doctor.' },
  { pattern: /\btype\s+\.env\b/i, reason: 'credential file read', alternative: 'Use a redacted secret inspector or environment doctor.' },
  { pattern: /\becho\s+%?[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)%?/i, reason: 'secret echo risk', alternative: 'Check whether a variable is present without printing its value.' },
]

const NETWORK_PATTERNS = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bnpm\s+(install|add|publish)\b/i,
  /\bpnpm\s+(install|add|publish)\b/i,
  /\byarn\s+(add|publish)\b/i,
  /\bgit\s+(fetch|pull|push|clone)\b/i,
  /\bgh\s+/i,
]

const WRITE_PATTERNS = [
  /\bgit\s+(add|commit|merge|rebase|stash)\b/i,
  /\bnpm\s+run\s+(build|lint|format)\b/i,
  /\bmkdir\b/i,
  /\btouch\b/i,
  /\bcopy\b/i,
  /\bmove\b/i,
  /\bmv\b/i,
]

export class AgentOsSmartShell {
  private projectDir: string
  private scaleDir: string
  private historyPath: string
  private now: () => Date
  private ledger: ExecutionLedger
  private commandLedger: CommandRunLedger

  constructor(options: AgentOsSmartShellOptions = {}) {
    this.projectDir = resolve(options.projectDir ?? process.cwd())
    this.scaleDir = isAbsolute(options.scaleDir ?? '')
      ? options.scaleDir as string
      : join(this.projectDir, options.scaleDir ?? '.scale')
    this.historyPath = join(this.scaleDir, 'shell', 'runs.json')
    this.now = options.now ?? (() => new Date())
    this.ledger = options.ledger ?? new ExecutionLedger({
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
      now: this.now,
    })
    this.commandLedger = new CommandRunLedger({
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
      now: this.now,
    })
  }

  plan(input: PlanAgentOsShellCommandInput): AgentOsShellPlan {
    const command = input.command.trim()
    if (!command) throw new Error('Agent OS shell command is required.')
    const cwd = resolve(input.cwd ?? this.projectDir)
    const classification = classifyShellCommand(command)
    const approved = input.approved === true
    const requiresApproval = classification.risk === 'destructive' || classification.risk === 'credential'
    const blocked = classification.blocked || requiresApproval && !approved
    const plan: AgentOsShellPlan = {
      version: 1,
      planId: `SHELL-PLAN-${randomUUID().slice(0, 8)}`,
      command,
      cwd,
      taskId: input.taskId,
      sessionId: input.sessionId,
      createdAt: this.now().toISOString(),
      risk: classification.risk,
      blocked,
      requiresApproval,
      approved,
      reasons: classification.reasons,
      saferAlternatives: classification.saferAlternatives,
      parsed: classification.parsed,
    }
    return plan
  }

  async run(input: RunAgentOsShellCommandInput): Promise<AgentOsShellExecution> {
    const plan = this.plan(input)
    const plannedEvent = this.ledger.record({
      agentId: 'agent-os-shell',
      sessionId: plan.sessionId ?? plan.planId,
      taskId: plan.taskId,
      type: 'shell.planned',
      summary: `Planned shell command (${plan.risk})`,
      metadata: {
        planId: plan.planId,
        command: plan.command,
        cwd: plan.cwd,
        blocked: plan.blocked,
        reasons: plan.reasons,
      },
    })

    const started = Date.now()
    if (plan.blocked) {
      const endedAt = this.now().toISOString()
      const executedEvent = this.ledger.record({
        agentId: 'agent-os-shell',
        sessionId: plan.sessionId ?? plan.planId,
        taskId: plan.taskId,
        type: 'shell.executed',
        summary: `Blocked shell command (${plan.risk})`,
        metadata: {
          planId: plan.planId,
          command: plan.command,
          status: 'blocked',
          reasons: plan.reasons,
          saferAlternatives: plan.saferAlternatives,
        },
      })
      const execution: AgentOsShellExecution = {
        version: 1,
        executionId: `SHELL-RUN-${randomUUID().slice(0, 8)}`,
        plan,
        status: 'blocked',
        startedAt: new Date(started).toISOString(),
        endedAt,
        durationMs: Date.now() - started,
        events: { planned: plannedEvent, executed: executedEvent },
      }
      this.appendExecution(execution)
      return execution
    }

    const result = await runSafeCommand(plan.command, {
      cwd: plan.cwd,
      timeout: input.timeoutMs,
      allowShell: input.allowShell,
    })
    const ended = Date.now()
    const evidence = this.commandLedger.record({
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
      taskId: plan.taskId,
      sessionId: plan.sessionId,
      profile: input.profile,
      gate: `agent-os-shell:${plan.risk}`,
      source: 'agent-os-smart-shell',
      command: plan.command,
      cwd: plan.cwd,
      exitCode: result.exitCode,
      durationMs: ended - started,
      startedAt: started,
      endedAt: ended,
      stdout: result.stdout,
      stderr: result.stderr,
    })
    const status: AgentOsShellStatus = result.exitCode === 0 ? 'passed' : 'failed'
    const executedEvent = this.ledger.record({
      agentId: 'agent-os-shell',
      sessionId: plan.sessionId ?? plan.planId,
      taskId: plan.taskId,
      type: 'shell.executed',
      summary: `Shell command ${status}: ${plan.command}`,
      metadata: {
        planId: plan.planId,
        command: plan.command,
        status,
        exitCode: result.exitCode,
        evidenceId: evidence.id,
      },
    })
    const execution: AgentOsShellExecution = {
      version: 1,
      executionId: `SHELL-RUN-${randomUUID().slice(0, 8)}`,
      plan,
      status,
      startedAt: new Date(started).toISOString(),
      endedAt: new Date(ended).toISOString(),
      durationMs: ended - started,
      result,
      evidence,
      events: { planned: plannedEvent, executed: executedEvent },
    }
    this.appendExecution(execution)
    return execution
  }

  list(limit = 50): AgentOsShellExecution[] {
    return this.load().executions.slice(-limit).reverse()
  }

  private appendExecution(execution: AgentOsShellExecution): void {
    const state = this.load()
    const updated: AgentOsShellHistory = {
      version: 1,
      updatedAt: this.now().toISOString(),
      executions: [...state.executions, execution].slice(-200),
    }
    mkdirSync(dirname(this.historyPath), { recursive: true })
    writeFileSync(this.historyPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf-8')
  }

  private load(): AgentOsShellHistory {
    if (!existsSync(this.historyPath)) {
      return { version: 1, updatedAt: this.now().toISOString(), executions: [] }
    }
    try {
      const parsed = JSON.parse(readFileSync(this.historyPath, 'utf-8')) as Partial<AgentOsShellHistory>
      return {
        version: 1,
        updatedAt: String(parsed.updatedAt ?? this.now().toISOString()),
        executions: Array.isArray(parsed.executions) ? parsed.executions as AgentOsShellExecution[] : [],
      }
    } catch {
      return { version: 1, updatedAt: this.now().toISOString(), executions: [] }
    }
  }
}

function classifyShellCommand(command: string): {
  risk: AgentOsShellRisk
  blocked: boolean
  reasons: string[]
  saferAlternatives: string[]
  parsed?: { file: string; args: string[] }
} {
  const reasons: string[] = []
  const saferAlternatives: string[] = []
  let parsed: { file: string; args: string[] } | undefined

  try {
    parsed = parseCommandLine(command)
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : String(error))
    saferAlternatives.push('Use a package script or a single executable with explicit arguments.')
    return { risk: 'destructive', blocked: true, reasons, saferAlternatives }
  }

  for (const item of DESTRUCTIVE_PATTERNS) {
    if (!item.pattern.test(command)) continue
    reasons.push(item.reason)
    if (item.alternative) saferAlternatives.push(item.alternative)
    return { risk: 'destructive', blocked: false, reasons, saferAlternatives, parsed }
  }

  for (const item of CREDENTIAL_PATTERNS) {
    if (!item.pattern.test(command)) continue
    reasons.push(item.reason)
    if (item.alternative) saferAlternatives.push(item.alternative)
    return { risk: 'credential', blocked: false, reasons, saferAlternatives, parsed }
  }

  if (NETWORK_PATTERNS.some(pattern => pattern.test(command))) {
    return {
      risk: 'network',
      blocked: false,
      reasons: ['network operation'],
      saferAlternatives: ['Prefer a dry-run, lockfile-only, or status command before network writes.'],
      parsed,
    }
  }

  if (WRITE_PATTERNS.some(pattern => pattern.test(command))) {
    return {
      risk: 'write',
      blocked: false,
      reasons: ['workspace write operation'],
      saferAlternatives: [],
      parsed,
    }
  }

  return {
    risk: 'read',
    blocked: false,
    reasons: ['read-only or verification command'],
    saferAlternatives: [],
    parsed,
  }
}
