// Minimal structural types for the Cordis Context DSH hands to apply().
//
// The real types live in DSH's own cordis package (not published under the
// bare name `cordis` this plugin could resolve); we only consume three
// services, so structural types keep the plugin dependency-free while staying
// honest about what we touch. Swap for `@deepseek-ai/cordis` types once that
// package is consumable outside the DSH tree (plan R7: rc drift).

/** Event names this plugin subscribes to (plan §2.5 tool pipeline). */
export type ToolEventListener = (...args: unknown[]) => unknown

export interface SystemPromptService {
  /** Register a context block; signature per plan §6 T1.2 (U5: exact arity re-checked at live acceptance). */
  context?: (id: string, content: string, opts?: { order?: number }) => void
}

/** Materialized final result of a tools.execute() call (verified against dsh-tools 0.2.1-rc.2). */
export interface ToolExecutionOutcome {
  isError: boolean
  content?: Array<{ type: string; text?: string }>
  message?: string
}

export interface ToolsService {
  /** execute(exec) takes a typed call input object — NOT (name, args). Call it as tools.execute({...}) so `this` stays bound. */
  execute?: (exec: {
    name: string
    arguments?: Record<string, unknown>
    callId?: string
    /** callerCancelled() reads signal.aborted — required in 0.2.1-rc.2. */
    signal?: AbortSignal
  }) => Promise<ToolExecutionOutcome>
}

// ---------------------------------------------------------------------------
// T2: commands (dsh-commands 0.2.1-rc.2 verified contract)
// ---------------------------------------------------------------------------

/** dsh-commands CommandResult: success may omit text; error text must be non-empty. */
export type CommandResult = { kind: 'success'; text?: string } | { kind: 'error'; text: string }

export interface CommandInvocation {
  commandId: string
  rawInput: string
  signal: AbortSignal
  agent?: unknown
}

export interface CommandsService {
  /** name must match /^[a-z][a-z0-9_-]*$/; description non-empty; handler returns CommandResult. */
  register?: (definition: {
    name: string
    description: string
    input?: { hint: string; attachments?: boolean }
    handler: (invocation: CommandInvocation) => Promise<CommandResult> | CommandResult
  }) => unknown
}

// ---------------------------------------------------------------------------
// T2: skills (dsh-skill 0.2.1-rc.2 verified contract)
// ---------------------------------------------------------------------------

/** /^[a-z0-9]+(?:-[a-z0-9]+)*$/ — kebab-case, no uppercase. */
export type SkillInvocation = { modelInvocable: boolean; userInvocable: boolean }

export interface SkillCandidate {
  name: string
  description: string
  invocation: SkillInvocation
  /** where this skill came from (display) */
  source: string
  /** must equal the provider's own name */
  provider: string
  rank: number
  whenToUse?: string
  path?: string
  /** opaque value passed back to provider.get() */
  locator?: unknown
}

export interface SkillDefinition extends SkillCandidate {
  /** full skill body (markdown) */
  content: string
}

export interface SkillProvider {
  name: string
  list: () => Promise<SkillCandidate[] | { candidates: SkillCandidate[]; complete: boolean }>
  get: (candidate: SkillCandidate) => Promise<SkillDefinition | undefined>
}

export interface SkillsService {
  /** create() runs synchronously during apply; disk/remote work belongs in list()/get(). */
  registerProvider?: (create: (control: { signal: AbortSignal; invalidate: () => void }) => SkillProvider) => unknown
}

export interface CordisContext {
  on: (event: string, listener: ToolEventListener) => void
  effect: (setup: () => (() => void) | void) => void
  systemPrompt?: SystemPromptService
  tools?: ToolsService
  commands?: CommandsService
  skills?: SkillsService
}
