import type { SkillPlan } from '../skills/routing/index.js'
import { execa } from 'execa'
import { inspectToolCapabilities, TOOL_CAPABILITY_CATALOG, type ToolCapabilityEntry, type ToolCapabilityReport, type ToolCapabilityCategory } from './ToolCapabilityRegistry.js'
import { ToolEvidenceStore, type ToolEvidenceAdapter, type ToolEvidenceStatus, type ToolRunEvidence } from './ToolEvidenceStore.js'
import { requiredToolsForDomains, resolveToolPolicy, type ResolvedToolPolicy } from './ToolPolicy.js'
import { wrapCliCommandWithRtk } from './RtkRuntime.js'

export type ToolStepStatus = 'ready' | 'missing' | 'skipped'

export interface ToolExecutionStep {
  id: string
  toolId: string
  domain: string
  adapter: ToolEvidenceAdapter
  required: boolean
  status: ToolStepStatus
  reason: string
  capability?: ToolCapabilityEntry
}

export interface ToolExecutionPlan {
  taskId: string
  taskName: string
  mode: ResolvedToolPolicy['mode']
  steps: ToolExecutionStep[]
  blockers: string[]
  warnings: string[]
}

export interface ToolPlanInput {
  skillPlan: SkillPlan
}

export interface ToolRunOptions {
  dryRun?: boolean
  inputs?: Record<string, Record<string, unknown>>
}

export interface ToolStepExecutionResult {
  status: ToolEvidenceStatus
  outputSummary: string
  outputPaths: string[]
  exitCode?: number
  version?: string
}

export interface ToolRunReport {
  taskId: string
  ok: boolean
  dryRun: boolean
  evidence: ToolRunEvidence[]
  blockers: string[]
  warnings: string[]
}

export interface ToolOrchestratorOptions {
  projectDir?: string
  policy?: ResolvedToolPolicy
  capabilityReport?: ToolCapabilityReport
  evidenceStore?: ToolEvidenceStore
  executeStep?: (step: ToolExecutionStep, input: Record<string, unknown>) => Promise<ToolStepExecutionResult>
}

export class ToolOrchestrator {
  private projectDir: string
  private policy: ResolvedToolPolicy
  private capabilityReport?: ToolCapabilityReport
  private evidenceStore: ToolEvidenceStore
  private executeStepImpl?: (step: ToolExecutionStep, input: Record<string, unknown>) => Promise<ToolStepExecutionResult>

  constructor(options: ToolOrchestratorOptions = {}) {
    this.projectDir = options.projectDir ?? process.cwd()
    this.policy = options.policy ?? resolveToolPolicy(null)
    this.capabilityReport = options.capabilityReport
    this.evidenceStore = options.evidenceStore ?? new ToolEvidenceStore({ projectDir: this.projectDir })
    this.executeStepImpl = options.executeStep
  }

  plan(input: ToolPlanInput): ToolExecutionPlan {
    if (this.policy.mode === 'off') {
      return {
        taskId: input.skillPlan.taskId,
        taskName: input.skillPlan.taskName,
        mode: this.policy.mode,
        steps: [],
        blockers: [],
        warnings: ['Tool orchestration is disabled.'],
      }
    }

    const toolIds = this.resolveToolIds(input.skillPlan)
    const capabilityReport = this.capabilityReport ?? inspectToolCapabilities({
      projectDir: this.projectDir,
      toolIds,
    })
    const capabilityById = new Map(capabilityReport.tools.map(tool => [tool.id, tool]))
    const blockers: string[] = []
    const warnings: string[] = [...this.policy.warnings]
    const steps: ToolExecutionStep[] = []

    for (const toolId of toolIds) {
      const capability = capabilityById.get(toolId)
      const required = this.isRequired(toolId, input.skillPlan)
      const status: ToolStepStatus = capability?.installed ? 'ready' : 'missing'
      const step: ToolExecutionStep = {
        id: `tool-${steps.length + 1}-${toolId}`,
        toolId,
        domain: this.resolveDomain(toolId, input.skillPlan),
        adapter: adapterForCategory(capability?.category ?? catalogCategory(toolId)),
        required,
        status,
        capability,
        reason: status === 'ready'
          ? 'Tool is available.'
          : capability?.missingReason ?? 'Tool capability is missing or not configured.',
      }
      steps.push(step)

      if (status === 'missing' && required) {
        const message = `Required tool ${toolId} is missing for task ${input.skillPlan.taskId}.`
        if (this.policy.mode === 'block') blockers.push(message)
        else warnings.push(message)
      }
    }

    return {
      taskId: input.skillPlan.taskId,
      taskName: input.skillPlan.taskName,
      mode: this.policy.mode,
      steps,
      blockers,
      warnings,
    }
  }

  async run(plan: ToolExecutionPlan, options: ToolRunOptions = {}): Promise<ToolRunReport> {
    const blockers = [...plan.blockers]
    const warnings = [...plan.warnings]
    const evidence: ToolRunEvidence[] = []

    if (blockers.length > 0) {
      return {
        taskId: plan.taskId,
        ok: false,
        dryRun: Boolean(options.dryRun),
        evidence,
        blockers,
        warnings,
      }
    }

    for (const step of plan.steps) {
      if (step.status !== 'ready') continue

      const result = options.dryRun
        ? dryRunResult(step)
        : await this.executeStep(step, options.inputs?.[step.toolId] ?? {})

      const record = this.evidenceStore.save({
        taskId: plan.taskId,
        domain: step.domain,
        tool: step.toolId,
        adapter: step.adapter,
        version: result.version ?? step.capability?.version,
        command: step.capability?.command,
        mcpToolName: step.capability?.category === 'mcp' ? step.capability.id : undefined,
        status: result.status,
        exitCode: result.exitCode,
        sanitizedInput: options.inputs?.[step.toolId] ?? {},
        outputSummary: result.outputSummary,
        outputPaths: result.outputPaths,
        safetyPolicy: this.safetyPolicyForStep(step, Boolean(options.dryRun)),
      })
      evidence.push(record)

      if (record.status === 'failed') {
        const message = `Tool ${step.toolId} failed for task ${plan.taskId}.`
        if (step.required) blockers.push(message)
        else warnings.push(message)
      }
    }

    return {
      taskId: plan.taskId,
      ok: blockers.length === 0,
      dryRun: Boolean(options.dryRun),
      evidence,
      blockers,
      warnings,
    }
  }

  private resolveToolIds(skillPlan: SkillPlan): string[] {
    const requiredByDomain = requiredToolsForDomains(this.policy, skillPlan.intents.map(intent => intent.domain))
      .map(tool => tool.id)
    return unique([
      ...skillPlan.requiredSkills,
      ...requiredByDomain,
      ...skillPlan.recommendedSkills.filter(skill => this.policy.tools[skill]?.enabled),
    ])
  }

  private isRequired(toolId: string, skillPlan: SkillPlan): boolean {
    if (skillPlan.requiredSkills.includes(toolId)) return true
    const config = this.policy.tools[toolId]
    if (!config) return false
    const domains = new Set(skillPlan.intents.map(intent => intent.domain))
    return config.requiredFor.some(domain => domains.has(domain))
  }

  private resolveDomain(toolId: string, skillPlan: SkillPlan): string {
    const config = this.policy.tools[toolId]
    const intentDomains = skillPlan.intents.map(intent => intent.domain)
    const requiredDomain = config?.requiredFor.find(domain => intentDomains.includes(domain))
    if (requiredDomain) return requiredDomain
    const recommendedDomain = config?.recommendedFor?.find(domain => intentDomains.includes(domain))
    if (recommendedDomain) return recommendedDomain
    return intentDomains[0] ?? 'general'
  }

  private async executeStep(step: ToolExecutionStep, input: Record<string, unknown>): Promise<ToolStepExecutionResult> {
    if (this.executeStepImpl) return this.executeStepImpl(step, input)
    if (step.adapter === 'skill') return executeSkillCapabilityCheck(step)
    if (step.adapter === 'cli' || step.adapter === 'browser' || step.adapter === 'desktop') return executeCliCapabilityCheck(step)
    return {
      status: 'skipped',
      outputSummary: `No executor configured for ${step.toolId}; evidence recorded as skipped.`,
      outputPaths: [],
    }
  }

  private safetyPolicyForStep(step: ToolExecutionStep, dryRun: boolean): string[] {
    const policies = ['redact-secrets']
    if (dryRun) policies.push('dry-run')
    if (step.adapter === 'browser') policies.push('browser-side-effect-boundary')
    if (step.adapter === 'desktop') policies.push('desktop-side-effect-boundary')
    if (step.adapter === 'cli') policies.push('cli-version-and-exit-code')
    if (step.adapter === 'skill') policies.push('skill-file-readiness-check')
    if (step.adapter === 'mcp') policies.push('mcp-tool-policy')
    return policies
  }
}

function dryRunResult(step: ToolExecutionStep): ToolStepExecutionResult {
  return {
    status: 'skipped',
    outputSummary: `Dry-run: ${step.toolId} was planned but not executed.`,
    outputPaths: [],
    version: step.capability?.version,
  }
}

function executeSkillCapabilityCheck(step: ToolExecutionStep): ToolStepExecutionResult {
  const skillPath = step.capability?.detectedPath
  if (!skillPath) {
    return {
      status: 'failed',
      outputSummary: `Skill file was not detected for ${step.toolId}.`,
      outputPaths: [],
      exitCode: 1,
    }
  }

  return {
    status: 'passed',
    outputSummary: `Skill file is installed for ${step.toolId}. Skill usage evidence must still be captured in task artifacts.`,
    outputPaths: [skillPath],
    exitCode: 0,
  }
}

async function executeCliCapabilityCheck(step: ToolExecutionStep): Promise<ToolStepExecutionResult> {
  const command = step.capability?.command
  const args = step.capability?.versionArgs ?? ['--version']
  if (!command) {
    return {
      status: 'skipped',
      outputSummary: `No safe CLI command configured for ${step.toolId}; evidence recorded as skipped.`,
      outputPaths: [],
    }
  }

  try {
    const invocation = wrapCliCommandWithRtk(command, args)
    const result = await execa(invocation.command, invocation.args, {
      reject: false,
      timeout: 10_000,
      cwd: process.cwd(),
      env: process.env,
      stdin: 'ignore',
    })
    const stdout = result.stdout.trim()
    const stderr = result.stderr.trim()
    const exitCode = result.exitCode ?? 1
    const outputSummary = summarizeCliOutput(step.toolId, stdout, stderr, exitCode, invocation.wrapped)
    return {
      status: exitCode === 0 ? 'passed' : 'failed',
      outputSummary,
      outputPaths: [],
      exitCode,
      version: stdout.split(/\r?\n/).find(Boolean) ?? step.capability?.version,
    }
  } catch (error) {
    return {
      status: 'failed',
      outputSummary: `CLI check failed for ${step.toolId}: ${error instanceof Error ? error.message : String(error)}`,
      outputPaths: [],
      exitCode: 1,
    }
  }
}

function summarizeCliOutput(toolId: string, stdout: string, stderr: string, exitCode: number, wrappedByRtk = false): string {
  const lines = [`CLI version check for ${toolId} exited with ${exitCode}.${wrappedByRtk ? ' Wrapped with RTK.' : ''}`]
  if (stdout) lines.push(`stdout: ${tail(stdout)}`)
  if (stderr) lines.push(`stderr: ${tail(stderr)}`)
  return lines.join(' ')
}

function tail(value: string): string {
  return value.split(/\r?\n/).slice(-5).join('\n').slice(0, 1000)
}

function adapterForCategory(category: ToolCapabilityCategory | undefined): ToolEvidenceAdapter {
  if (category === 'browser') return 'browser'
  if (category === 'desktop') return 'desktop'
  if (category === 'cli') return 'cli'
  if (category === 'mcp') return 'mcp'
  return 'skill'
}

function catalogCategory(toolId: string): ToolCapabilityCategory {
  return TOOL_CAPABILITY_CATALOG.find(tool => tool.id === toolId)?.category ?? 'skill'
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}
