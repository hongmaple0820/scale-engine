// SCALE Engine - Gate System
// Quality gate system G0-G7.

import type { IEventBus } from '../../core/eventBus.js'
import type { GateStage, GateResult, GateStatus, GateEvidence } from '../types.js'
import { EvidenceStore } from '../EvidenceStore.js'
import { WorkflowArtifactWriter } from '../WorkflowArtifactWriter.js'
import { detectVerificationCommands, type ResolvedVerificationCommand, type VerificationCommandConfig, type VerificationRuntimeEvidenceConfig } from '../VerificationCommands.js'
import { registerMetaGovernanceGates } from './MetaGovernanceGates.js'
import { registerEnhancedGates } from './EnhancedGates.js'
import { META_GOVERNANCE_GATE_STAGES, ENHANCED_GATE_STAGES } from '../GateCatalog.js'
import { createHash } from 'node:crypto'
import { RuntimeEvidenceLedger } from '../../runtime/RuntimeEvidenceLedger.js'
import { compressCommandOutput, type CommandOutputCompressionResult } from '../../tools/CommandOutputCompressor.js'
import { CommandRunLedger, type CommandRunEvidenceOptions } from '../../tools/CommandRunLedger.js'
import { auditDependencies, type DependencyAuditMode, type DependencyAuditReport } from '../../guardrails/DependencyAuditor.js'
import { runSafeCommand } from '../../tools/SafeCommandRunner.js'
import { logger } from '../../core/logger.js'

export interface IGate {
  stage: GateStage
  name: string
  description: string
  requiredLevel: 'S' | 'M' | 'L' | 'ALWAYS' | 'CRITICAL'
  execute(): Promise<GateResult>
}

type RequiredLevel = 'S' | 'M' | 'L' | 'ALWAYS' | 'CRITICAL'

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
  durationMs: number
  startedAt: number
  endedAt: number
  cwd: string
  outputCompression?: CommandOutputCompressionResult
  commandRunEvidenceId?: string
  commandRunEvidenceError?: string
}

export interface RunShellCommandOptions {
  compressOutput?: boolean
  compressionMaxChars?: number
  compressionMaxLines?: number
  commandRunEvidence?: CommandRunEvidenceOptions
}

interface ProductSmokeReport {
  status?: unknown
  message?: unknown
  results?: unknown
}

type SecuritySeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

interface SecurityScanFinding {
  ruleId: string
  severity: SecuritySeverity
  description: string
  file: string
  line: number
  evidence: string
}

interface SecurityRule {
  id: string
  severity: SecuritySeverity
  description: string
  pattern: RegExp
}

export interface SecurityGateOptions {
  rootDir?: string
  scanDirs?: string[]
  maxFileBytes?: number
  maxFindings?: number
  strict?: boolean
  scaleDir?: string
  dependencyAudit?: boolean
  dependencyAuditMode?: DependencyAuditMode
  dependencyAuditChangedPackages?: string[]
}

function tail(value: string, maxLength = 1000): string {
  return value.length > maxLength ? value.slice(-maxLength) : value
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export async function runShellCommand(
  command: string,
  timeout: number,
  cwd = process.cwd(),
  options: RunShellCommandOptions = {},
): Promise<CommandResult> {
  const start = Date.now()
  try {
    const result = await runSafeCommand(command, { timeout, cwd })
    const end = Date.now()
    return finalizeCommandResult(command, {
      code: result.exitCode,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      durationMs: end - start,
      startedAt: start,
      endedAt: end,
      cwd,
    }, options)
  } catch (error) {
    const end = Date.now()
    return finalizeCommandResult(command, {
      code: 1,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: end - start,
      startedAt: start,
      endedAt: end,
      cwd,
    }, options)
  }
}

function finalizeCommandResult(
  command: string,
  result: CommandResult,
  options: RunShellCommandOptions,
): CommandResult {
  if (options.compressOutput !== false) {
    result.outputCompression = compressCommandOutput({
      command,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code,
      maxChars: options.compressionMaxChars,
      maxLines: options.compressionMaxLines,
    })
  }

  if (options.commandRunEvidence) {
    try {
      const ledger = new CommandRunLedger({
        projectDir: options.commandRunEvidence.projectDir ?? result.cwd,
        scaleDir: options.commandRunEvidence.scaleDir,
      })
      const record = ledger.record({
        ...options.commandRunEvidence,
        command,
        cwd: result.cwd,
        exitCode: result.code,
        durationMs: result.durationMs,
        startedAt: result.startedAt,
        endedAt: result.endedAt,
        stdout: result.stdout,
        stderr: result.stderr,
        compression: result.outputCompression,
      })
      result.commandRunEvidenceId = record.id
    } catch (error) {
      result.commandRunEvidenceError = error instanceof Error ? error.message : String(error)
    }
  }

  return result
}

function createEvidence(input: Omit<GateEvidence, 'id'>): GateEvidence {
  return {
    id: `EVID-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...input,
  }
}

function textEvidence(items: GateEvidence[]): string {
  return items.map(item => `${item.label}: ${item.detail}`).join('\n')
}

export class GateSystem {
  private eventBus: IEventBus
  private gates: Map<GateStage, IGate> = new Map()
  private results: Map<GateStage, GateResult> = new Map()
  private evidenceStore: EvidenceStore
  private commands: ReturnType<typeof detectVerificationCommands>
  private artifactWriter: WorkflowArtifactWriter
  private rootDir: string
  private scaleDir: string

  constructor(eventBus: IEventBus, commandConfig: VerificationCommandConfig = {}, artifactWriter?: WorkflowArtifactWriter) {
    this.eventBus = eventBus
    this.evidenceStore = new EvidenceStore()
    this.rootDir = commandConfig.cwd ?? process.cwd()
    this.scaleDir = commandConfig.runtimeEvidence?.scaleDir ?? '.scale'
    this.commands = detectVerificationCommands(this.rootDir, commandConfig)
    this.artifactWriter = artifactWriter ?? new WorkflowArtifactWriter()
    this.registerDefaultGates()
  }

  registerGate(gate: IGate): void {
    this.gates.set(gate.stage, gate)
  }

  async executeGate(stage: GateStage): Promise<GateResult> {
    const gate = this.gates.get(stage)
    if (!gate) {
      const evidenceItems = [
        createEvidence({
          kind: 'manual',
          label: 'Gate registry',
          passed: false,
          detail: `Gate ${stage} is not registered`,
        }),
      ]
      return {
        gate: stage,
        status: 'FAILED',
        passed: false,
        evidence: textEvidence(evidenceItems),
        evidenceItems,
        blockers: [],
        durationMs: 0,
      }
    }
    // Check cache for expensive gates before executing
    const cacheableGates: GateStage[] = ['G4', 'G5', 'G6', 'G7']
    if (cacheableGates.includes(stage)) {
      try {
        const { ScanCache } = await import('../../cache/ScanCache.js')
        const scanCache = new ScanCache(this.rootDir)
        const changedFiles = await this.getChangedFiles()
        const fileHashes = scanCache.hashFiles(changedFiles)
        fileHashes['__gate_context__'] = this.cacheContextForGate(stage)
        const cacheKey = scanCache.computeKey(fileHashes)
        const cached = scanCache.get(stage, cacheKey)
        if (cached) {
          logger.info({ stage, cacheHit: true }, 'Gate result from cache')
          return cached.result as GateResult
        }

        // Not cached — execute, then store
        const start = Date.now()
        try {
          const result = await gate.execute()
          result.durationMs = Date.now() - start
          scanCache.set(stage, cacheKey, result, result.passed, result.durationMs ?? 0, fileHashes, 300)
          this.results.set(stage, result)
          this.persistEvidence(result)
          this.recordCompletedGate(stage, result)
          this.eventBus.emit('gate.executed', { stage, passed: result.passed })
          if (!result.passed) {
            this.eventBus.emit('gate.failed', {
              stage,
              status: result.status,
              blockers: result.blockers,
              evidence: result.evidence,
              evidenceRecordId: result.evidenceRecordId,
            })
          }
          return result
        } catch (e) {
          const result: GateResult = {
            gate: stage,
            status: 'FAILED',
            passed: false,
            evidence: `Gate execution failed: ${e}`,
            evidenceItems: [
              createEvidence({
                kind: 'manual',
                label: 'Gate execution',
                passed: false,
                detail: String(e),
              }),
            ],
            blockers: [String(e)],
            durationMs: Date.now() - start
          }
          this.results.set(stage, result)
          this.persistEvidence(result)
          this.eventBus.emit('gate.executed', { stage, passed: false })
          this.eventBus.emit('gate.failed', {
            stage,
            status: result.status,
            blockers: result.blockers,
            evidence: result.evidence,
            evidenceRecordId: result.evidenceRecordId,
          })
          return result
        }
      } catch {
        // Cache infrastructure failed — fall through to direct execution
      }
    }

    const start = Date.now()
    try {
      const result = await gate.execute()
      result.durationMs = Date.now() - start
      this.results.set(stage, result)
      this.persistEvidence(result)
      this.recordCompletedGate(stage, result)
      this.eventBus.emit('gate.executed', { stage, passed: result.passed })
      if (!result.passed) {
        this.eventBus.emit('gate.failed', {
          stage,
          status: result.status,
          blockers: result.blockers,
          evidence: result.evidence,
          evidenceRecordId: result.evidenceRecordId,
        })
      }
      return result
    } catch (e) {
      const result: GateResult = {
        gate: stage,
        status: 'FAILED',
        passed: false,
        evidence: `Gate execution failed: ${e}`,
        evidenceItems: [
          createEvidence({
            kind: 'manual',
            label: 'Gate execution',
            passed: false,
            detail: String(e),
          }),
        ],
        blockers: [String(e)],
        durationMs: Date.now() - start
      }
      this.results.set(stage, result)
      this.persistEvidence(result)
      this.eventBus.emit('gate.executed', { stage, passed: false })
      this.eventBus.emit('gate.failed', {
        stage,
        status: result.status,
        blockers: result.blockers,
        evidence: result.evidence,
        evidenceRecordId: result.evidenceRecordId,
      })
      return result
    }
  }

  private persistEvidence(result: GateResult): void {
    try {
      const record = this.evidenceStore.saveGateResult(result)
      result.evidenceRecordId = record.id
    } catch {
      // Evidence persistence must not mask the gate decision itself.
    }
  }

  private recordCompletedGate(stage: GateStage, result: GateResult): void {
    if (!result.passed) return
    const state = this.artifactWriter.readCurrentState()
    const completedGates = state?.completedGates ?? []
    if (completedGates.includes(stage)) return
    this.artifactWriter.updateCurrentState({
      completedGates: [...completedGates, stage],
    })
  }

  async executeAll(order: GateStage[] = ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7']): Promise<GateResult[]> {
    const results: GateResult[] = []
    for (const stage of order) {
      const result = await this.executeGate(stage)
      results.push(result)
      if (!result.passed && stage !== 'G1' && stage !== 'G2') {
        this.eventBus.emit('gate.blocked', { stage, blockers: result.blockers })
        break
      }
    }
    return results
  }

  registerMetaGates(scaleDir: string = '.scale'): void {
    registerMetaGovernanceGates(this, scaleDir)
  }

  registerEnhancedGates(scaleDir: string = '.scale'): void {
    registerEnhancedGates(this, scaleDir)
  }

  async executeEnhancedGates(scaleDir: string = '.scale'): Promise<GateResult[]> {
    this.registerEnhancedGates(scaleDir)
    const results: GateResult[] = []
    for (const stage of ENHANCED_GATE_STAGES) {
      const result = await this.executeGate(stage)
      results.push(result)
    }
    return results
  }

  async executeMetaGovernance(scaleDir: string = '.scale'): Promise<GateResult[]> {
    this.registerMetaGates(scaleDir)
    const results: GateResult[] = []
    for (const stage of META_GOVERNANCE_GATE_STAGES) {
      const result = await this.executeGate(stage)
      results.push(result)
    }
    return results
  }

  getResult(stage: GateStage): GateResult | undefined {
    return this.results.get(stage)
  }

  getAllResults(): Map<GateStage, GateResult> {
    return this.results
  }

  private async getChangedFiles(): Promise<string[]> {
    const { execSync } = await import('node:child_process')
    const { resolve } = await import('node:path')
    try {
      const output = execSync('git diff --name-only HEAD', { cwd: this.rootDir, encoding: 'utf-8', stdio: 'pipe' })
      return output.trim().split('\n').filter(Boolean).map(file => resolve(this.rootDir, file))
    } catch {
      return []
    }
  }

  private cacheContextForGate(stage: GateStage): string {
    const commandByStage: Partial<Record<GateStage, ResolvedVerificationCommand>> = {
      G0: this.commands.build,
      G4: this.commands.lint,
      G5: this.commands.test,
      G6: this.commands.coverage,
    }
    const command = commandByStage[stage]
    return JSON.stringify({
      gateCacheSchema: 2,
      rootDir: this.rootDir,
      scaleDir: this.scaleDir,
      stage,
      command: command?.command,
      source: command?.source,
      reason: command?.reason,
      cwd: command?.cwd,
      tddStrict: this.commands.tddStrict,
      tddEvidence: this.commands.tddEvidence,
    })
  }

  private registerDefaultGates(): void {
    this.registerGate(new ExplorationGate(this.artifactWriter))
    this.registerGate(new PlanningGate(this.artifactWriter))
    this.registerGate(new TDDGate(this.commands.tddEvidence, this.commands.tddStrict, this.artifactWriter))
    this.registerGate(new BuildGate(this.commands.build, this.commands.runtimeEvidence))
    this.registerGate(new LintGate(this.commands.lint, this.commands.runtimeEvidence))
    this.registerGate(new TestGate(this.commands.test, this.commands.runtimeEvidence))
    this.registerGate(new CoverageGate(this.commands.coverage, this.commands.runtimeEvidence))
    this.registerGate(new SecurityGate({
      rootDir: this.rootDir,
      scaleDir: this.scaleDir,
    }))
    this.registerGate(new ProductSmokeGate(this.commands.smoke, this.commands.runtimeEvidence))
  }
}

function missingCommandResult(stage: GateStage, label: string, command: ResolvedVerificationCommand): GateResult {
  const evidenceItems = [
    createEvidence({
      kind: 'command',
      label,
      passed: false,
      detail: command.reason,
    }),
  ]
  return {
    gate: stage,
    status: 'BLOCKED',
    passed: false,
    evidence: textEvidence(evidenceItems),
    evidenceItems,
    blockers: [command.reason],
    durationMs: 0,
  }
}

function commandEvidence(
  label: string,
  command: ResolvedVerificationCommand,
  passed: boolean,
  commandResult: CommandResult | null,
  fallbackDetail = 'command did not complete',
): GateEvidence {
  const output = commandResult ? `${commandResult.stdout}\n${commandResult.stderr}` : ''
  const compression = commandResult?.outputCompression
  const outputDetail = compression
    ? `${compression.summary}\n${tail(compression.compressedOutput, 1500)}`
    : tail(commandResult?.stdout || commandResult?.stderr || `exit code ${commandResult?.code}`, 500)
  const compressionSuffix = compression
    ? `\nEstimated tokens: ${compression.rawEstimatedTokens} -> ${compression.compressedEstimatedTokens} (saved ${compression.savedEstimatedTokens})`
    : ''
  const ledgerSuffix = commandResult?.commandRunEvidenceId
    ? `\nCommand run evidence: ${commandResult.commandRunEvidenceId}`
    : ''
  return createEvidence({
    kind: 'command',
    label,
    passed,
    command: command.command,
    exitCode: commandResult?.code,
    durationMs: commandResult?.durationMs,
    cwd: commandResult?.cwd,
    startedAt: commandResult?.startedAt,
    endedAt: commandResult?.endedAt,
    stdoutTail: commandResult ? tail(commandResult.stdout, compression ? 500 : 1000) : undefined,
    stderrTail: commandResult ? tail(commandResult.stderr, compression ? 500 : 1000) : undefined,
    outputHash: output ? sha256(output) : undefined,
    rawEstimatedTokens: compression?.rawEstimatedTokens,
    compressedEstimatedTokens: compression?.compressedEstimatedTokens,
    savedEstimatedTokens: compression?.savedEstimatedTokens,
    compressionRatio: compression?.compressionRatio,
    commandRunEvidenceId: commandResult?.commandRunEvidenceId,
    source: command.source,
    detail: commandResult
      ? `${command.reason}\n${outputDetail}${compressionSuffix}${ledgerSuffix}`
      : fallbackDetail,
  })
}

function gateCommandOptions(
  stage: GateStage,
  command: ResolvedVerificationCommand,
  runtimeEvidence?: VerificationRuntimeEvidenceConfig,
): RunShellCommandOptions {
  if (!runtimeEvidence) return {}
  return {
    commandRunEvidence: {
      projectDir: runtimeEvidence.projectDir ?? command.cwd ?? process.cwd(),
      scaleDir: runtimeEvidence.scaleDir,
      taskId: runtimeEvidence.taskId,
      sessionId: runtimeEvidence.sessionId,
      profile: runtimeEvidence.profile,
      gate: stage,
      source: command.source,
    },
  }
}

export class ExplorationGate implements IGate {
  stage = 'G1' as GateStage
  name = 'Exploration'
  description = 'Project knowledge file, knowledge graph, and contradiction analysis checks'
  requiredLevel: RequiredLevel = 'M'

  private artifactWriter?: WorkflowArtifactWriter

  constructor(artifactWriter?: WorkflowArtifactWriter) {
    this.artifactWriter = artifactWriter
  }

  async execute(): Promise<GateResult> {
    const blockers: string[] = []
    const evidenceItems: GateEvidence[] = []

    // ── Primary: Check structured explore artifact ──
    const currentState = this.artifactWriter?.readCurrentState()
    const exploreArtifact = this.artifactWriter?.readExploreResult()
    if (currentState) {
      const fileCheck = currentState.fileCount >= 3
      const contradictionCheck = currentState.mainContradiction.length > 0

      if (!fileCheck) blockers.push(`Explored only ${currentState.fileCount} files (minimum 3 required)`)
      if (!contradictionCheck) blockers.push('No main contradiction identified in exploration')

      evidenceItems.push(
        createEvidence({
          kind: 'file',
          label: 'Workflow state (current)',
          passed: fileCheck && contradictionCheck,
          path: '.scale/state/current.json',
          detail: fileCheck && contradictionCheck
            ? `explored ${currentState.fileCount} files, contradiction: "${currentState.mainContradiction}"`
            : `files=${currentState.fileCount} (need >=3), contradiction="${currentState.mainContradiction}" (need non-empty)`,
        })
      )

      if (exploreArtifact) {
        evidenceItems.push(
          createEvidence({
            kind: 'file',
            label: 'Explore artifact (detail)',
            passed: exploreArtifact.fileCount === currentState.fileCount &&
              exploreArtifact.mainContradiction === currentState.mainContradiction,
            path: '.scale/state/explore.json',
            detail: `files=${exploreArtifact.fileCount}, contradiction="${exploreArtifact.mainContradiction}"`,
          })
        )
      }

      // Additional quality indicators
      if (exploreArtifact?.ambiguityScore !== undefined) {
        evidenceItems.push(
          createEvidence({
            kind: 'file',
            label: 'Ambiguity score',
            passed: exploreArtifact.ambiguityScore < 0.4,
            detail: `ambiguity=${(exploreArtifact.ambiguityScore * 100).toFixed(0)}% (threshold < 40%)`,
          })
        )
      }
    }

    // ── Fallback: Check knowledge files (legacy behavior) ──
    if (!currentState && exploreArtifact) {
      const fileCheck = exploreArtifact.fileCount >= 3
      const contradictionCheck = exploreArtifact.mainContradiction.length > 0

      if (!fileCheck) blockers.push(`Explored only ${exploreArtifact.fileCount} files (minimum 3 required)`)
      if (!contradictionCheck) blockers.push('No main contradiction identified in exploration')

      evidenceItems.push(
        createEvidence({
          kind: 'file',
          label: 'Explore artifact (legacy)',
          passed: fileCheck && contradictionCheck,
          path: '.scale/state/explore.json',
          detail: fileCheck && contradictionCheck
            ? `explored ${exploreArtifact.fileCount} files, contradiction: "${exploreArtifact.mainContradiction}"`
            : `files=${exploreArtifact.fileCount} (need >=3), contradiction="${exploreArtifact.mainContradiction}" (need non-empty)`,
        })
      )
    }

    if (!currentState && !exploreArtifact) {
      const knowledgeFile = await this.findKnowledgeFile()
      if (!knowledgeFile) {
        blockers.push('No explore artifact or project knowledge file found')
      }
      evidenceItems.push(
        createEvidence({
          kind: 'file',
          label: 'Project knowledge file (fallback)',
          passed: Boolean(knowledgeFile),
          path: knowledgeFile ?? undefined,
          detail: knowledgeFile
            ? `found ${knowledgeFile} (no structured explore.json)`
            : 'missing explore.json AND AGENTS.md, CLAUDE.md, .cursorrules, GEMINI.md',
        })
      )
    }

    // ── Knowledge graph (supplementary) ──
    const hasKnowledgeGraph = await this.checkKnowledgeGraph()
    evidenceItems.push(
      createEvidence({
        kind: 'file',
        label: 'Knowledge graph',
        passed: hasKnowledgeGraph,
        path: hasKnowledgeGraph ? 'graphify-out/graph.json' : 'graphify-out/graph.json',
        detail: hasKnowledgeGraph ? 'graphify graph artifact is available' : 'graphify graph artifact is not available',
      })
    )

    const passed = blockers.length === 0
    return {
      gate: this.stage,
      status: passed ? 'PASSED' : 'BLOCKED',
      passed,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers
    } as GateResult
  }

  private async findKnowledgeFile(): Promise<string | null> {
    const fs = await import('fs/promises')
    const candidates = ['AGENTS.md', 'CLAUDE.md', '.cursorrules', 'GEMINI.md']
    for (const candidate of candidates) {
      try {
        await fs.access(candidate)
        return candidate
      } catch {
        // Try the next platform-specific knowledge file.
      }
    }
    return null
  }

  private async checkKnowledgeGraph(): Promise<boolean> {
    const fs = await import('fs/promises')
    for (const candidate of ['graphify-out/graph.json', 'graphify-out/GRAPH_REPORT.md']) {
      try {
        await fs.access(candidate)
        return true
      } catch {
        // Try the next graphify artifact candidate.
      }
    }
    return false
  }
}

export class PlanningGate implements IGate {
  stage = 'G2' as GateStage
  name = 'Planning'
  description = 'Mini-Spec or SDD planning artifact checks'
  requiredLevel: RequiredLevel = 'L'

  private artifactWriter?: WorkflowArtifactWriter

  constructor(artifactWriter?: WorkflowArtifactWriter) {
    this.artifactWriter = artifactWriter
  }

  async execute(): Promise<GateResult> {
    const blockers: string[] = []
    const evidenceItems: GateEvidence[] = []

    // ── Primary: Check structured plan artifact ──
    const currentState = this.artifactWriter?.readCurrentState()
    const planArtifact = currentState?.lastPlanId
      ? this.artifactWriter?.readPlanResult(currentState.lastPlanId)
      : this.artifactWriter?.readLatestPlanResult()
    if (planArtifact) {
      if (!planArtifact.hasBoundaryAnalysis) blockers.push('Plan missing boundary analysis')
      if (!planArtifact.hasExceptionHandling) blockers.push('Plan missing exception handling')
      if (!planArtifact.hasRollbackStrategy) blockers.push('Plan missing rollback strategy')

      evidenceItems.push(
        createEvidence({
          kind: 'file',
          label: 'Plan artifact (structured)',
          passed: blockers.length === 0,
          path: `.scale/state/plan-${planArtifact.planId}.json`,
          detail: blockers.length === 0
            ? `plan ${planArtifact.planId}: boundary ✓, exceptions ✓, rollback ✓, verdict=${planArtifact.verdict}`
            : blockers.join('; '),
        })
      )
    }

    // ── Fallback: Check spec directory (legacy behavior) ──
    if (!planArtifact) {
      const hasSpec = await this.checkSpecDocument()
      if (!hasSpec) {
        blockers.push('No plan artifact or spec document found')
      }
      evidenceItems.push(
        createEvidence({
          kind: 'file',
          label: 'Spec document (fallback)',
          passed: hasSpec,
          path: '.scale/specs',
          detail: hasSpec
            ? 'spec directory contains at least one markdown spec (no structured plan artifact)'
            : 'missing plan-*.json AND spec directory or markdown spec',
        })
      )
    }

    const passed = blockers.length === 0
    return {
      gate: this.stage,
      status: passed ? 'PASSED' : 'BLOCKED',
      passed,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers
    } as GateResult
  }

  private async checkSpecDocument(): Promise<boolean> {
    try {
      const fs = await import('fs/promises')
      const specDir = '.scale/specs'
      const entries = await fs.readdir(specDir)
      return entries.some(entry => entry.endsWith('.md'))
    } catch {
      return false
    }
  }
}

export class TDDGate implements IGate {
  stage = 'G3' as GateStage
  name = 'TDD'
  description = 'RED -> GREEN -> REFACTOR evidence check'
  requiredLevel: RequiredLevel = 'CRITICAL'

  private artifactWriter?: WorkflowArtifactWriter

  constructor(private evidencePath?: string, private strict = false, artifactWriter?: WorkflowArtifactWriter) {
    this.artifactWriter = artifactWriter
  }

  async execute(): Promise<GateResult> {
    // ── Primary: Check structured TDD artifact ──
    const tddArtifact = this.artifactWriter?.readLatestTDDEvidence()
    if (tddArtifact) {
      return this.verifyStructuredEvidence(tddArtifact)
    }

    // ── Secondary: Check evidence file path ──
    if (this.evidencePath) {
      return this.verifyEvidenceFile(this.evidencePath)
    }

    // ── Fallback: Legacy behavior ──
    const detail = this.strict
      ? 'TDD evidence file is required in strict mode'
      : 'TDD cycle not strictly verified; provide --tdd-evidence or use --tdd-strict to enforce'
    const evidenceItems = [
      createEvidence({
        kind: 'manual',
        label: 'TDD cycle',
        passed: !this.strict,
        detail,
        source: 'tdd-gate',
      }),
    ]
    return {
      gate: this.stage,
      status: this.strict ? 'BLOCKED' : 'PASSED',
      passed: !this.strict,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers: this.strict ? [detail] : [],
      durationMs: 0
    }
  }

  private verifyStructuredEvidence(artifact: import('../WorkflowArtifactWriter.js').TDDEvidence): GateResult {
    const blockers: string[] = []
    if (!artifact.red) blockers.push('TDD evidence missing red=true')
    if (!artifact.green) blockers.push('TDD evidence missing green=true')
    if (!artifact.refactor) blockers.push('TDD evidence missing refactor=true')
    if (!artifact.testFirst) blockers.push('TDD evidence missing testFirst=true')

    const passed = blockers.length === 0
    const evidenceItems = [
      createEvidence({
        kind: 'file',
        label: 'TDD evidence (structured)',
        passed,
        path: `.scale/state/tdd-${artifact.taskId}.json`,
        detail: passed
          ? `TDD cycle complete: red ✓, green ✓, refactor ✓, testFirst ✓ (task ${artifact.taskId})`
          : blockers.join('; '),
        source: 'tdd-artifact',
      }),
    ]

    return {
      gate: this.stage,
      status: passed ? 'PASSED' : 'BLOCKED',
      passed,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers,
      durationMs: 0,
    }
  }

  private async verifyEvidenceFile(path: string): Promise<GateResult> {
    const fs = await import('fs/promises')
    const blockers: string[] = []
    let parsed: unknown
    let content = ''

    try {
      content = await fs.readFile(path, 'utf-8')
      parsed = JSON.parse(content)
    } catch (error) {
      blockers.push(`TDD evidence could not be read: ${error instanceof Error ? error.message : String(error)}`)
    }

    const evidence = parsed as Partial<{
      red: unknown
      green: unknown
      refactor: unknown
      testFirst: unknown
      verifiedAt: unknown
    }>

    if (!blockers.length) {
      if (evidence.red !== true) blockers.push('TDD evidence missing red=true')
      if (evidence.green !== true) blockers.push('TDD evidence missing green=true')
      if (evidence.refactor !== true) blockers.push('TDD evidence missing refactor=true')
      if (evidence.testFirst !== true) blockers.push('TDD evidence missing testFirst=true')
    }

    const passed = blockers.length === 0
    const evidenceItems = [
      createEvidence({
        kind: 'file',
        label: 'TDD evidence',
        passed,
        path,
        detail: passed ? 'TDD evidence contains red/green/refactor/testFirst=true' : blockers.join('; '),
        outputHash: content ? sha256(content) : undefined,
        source: 'tdd-evidence',
      }),
    ]

    return {
      gate: this.stage,
      status: passed ? 'PASSED' : 'BLOCKED',
      passed,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers,
      durationMs: 0,
    }
  }
}

export class BuildGate implements IGate {
  stage = 'G0' as GateStage
  name = 'Build'
  description = 'Run configured build or typecheck command'
  requiredLevel: RequiredLevel = 'ALWAYS'

  constructor(
    private command: ResolvedVerificationCommand,
    private runtimeEvidence?: VerificationRuntimeEvidenceConfig,
  ) {}

  async execute(): Promise<GateResult> {
    if (!this.command.command) {
      return missingCommandResult(this.stage, 'Build command', this.command)
    }

    const blockers: string[] = []
    let commandResult: CommandResult | null = null
    try {
      commandResult = await runShellCommand(this.command.command, 120000, this.command.cwd, gateCommandOptions(this.stage, this.command, this.runtimeEvidence))
      if (commandResult.code !== 0) {
        blockers.push(`Build failed: ${commandResult.stderr}`)
      }
    } catch (e) {
      blockers.push(`Build execution failed: ${e}`)
    }
    const passed = blockers.length === 0
    const evidenceItems = [
      commandEvidence('Build command', this.command, passed, commandResult),
    ]
    return {
      gate: this.stage,
      status: passed ? 'PASSED' : 'FAILED',
      passed,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers
    } as GateResult
  }

}

export class LintGate implements IGate {
  stage = 'G4' as GateStage
  name = 'Lint'
  description = 'Run configured lint command'
  requiredLevel: RequiredLevel = 'ALWAYS'

  constructor(
    private command: ResolvedVerificationCommand,
    private runtimeEvidence?: VerificationRuntimeEvidenceConfig,
  ) {}

  async execute(): Promise<GateResult> {
    if (!this.command.command) {
      return missingCommandResult(this.stage, 'Lint command', this.command)
    }

    const blockers: string[] = []
    let commandResult: CommandResult | null = null
    try {
      commandResult = await runShellCommand(this.command.command, 60000, this.command.cwd, gateCommandOptions(this.stage, this.command, this.runtimeEvidence))
      if (commandResult.code !== 0) {
        blockers.push(`Lint failed: ${commandResult.stderr}`)
      }
    } catch (e) {
      blockers.push(`Lint execution failed: ${e}`)
    }
    const passed = blockers.length === 0
    const evidenceItems = [
      commandEvidence('Lint command', this.command, passed, commandResult),
    ]
    return {
      gate: this.stage,
      status: passed ? 'PASSED' : 'FAILED',
      passed,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers
    } as GateResult
  }

}

export class TestGate implements IGate {
  stage = 'G5' as GateStage
  name = 'Test'
  description = 'Run configured test command'
  requiredLevel: RequiredLevel = 'ALWAYS'

  constructor(
    private command: ResolvedVerificationCommand,
    private runtimeEvidence?: VerificationRuntimeEvidenceConfig,
  ) {}

  async execute(): Promise<GateResult> {
    if (!this.command.command) {
      return missingCommandResult(this.stage, 'Test command', this.command)
    }

    const blockers: string[] = []
    let commandResult: CommandResult | null = null
    try {
      commandResult = await runShellCommand(this.command.command, 120000, this.command.cwd, gateCommandOptions(this.stage, this.command, this.runtimeEvidence))
      if (commandResult.code !== 0) {
        blockers.push(`Tests failed: ${commandResult.stderr}`)
      }
    } catch (e) {
      blockers.push(`Test execution failed: ${e}`)
    }
    const passed = blockers.length === 0
    const evidenceItems = [
      commandEvidence('Test command', this.command, passed, commandResult),
    ]
    return {
      gate: this.stage,
      status: passed ? 'PASSED' : 'FAILED',
      passed,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers
    } as GateResult
  }

}

export class CoverageGate implements IGate {
  stage = 'G6' as GateStage
  name = 'Coverage'
  description = 'Run configured coverage command'
  requiredLevel: RequiredLevel = 'ALWAYS'

  constructor(
    private command: ResolvedVerificationCommand,
    private runtimeEvidence?: VerificationRuntimeEvidenceConfig,
  ) {}

  async execute(): Promise<GateResult> {
    if (!this.command.command) {
      return missingCommandResult(this.stage, 'Coverage command', this.command)
    }

    const blockers: string[] = []
    let detail = ''
    let commandResult: CommandResult | null = null
    try {
      commandResult = await runShellCommand(this.command.command, 120000, this.command.cwd, gateCommandOptions(this.stage, this.command, this.runtimeEvidence))
      if (commandResult.code !== 0) {
        blockers.push(`Coverage command failed: ${commandResult.stderr}`)
      }
      const coverage = parseCoveragePercentage(commandResult.stdout)
      if (coverage !== null) {
        detail = `Coverage: ${coverage}%`
        if (coverage < 80) {
          blockers.push(`Coverage ${coverage}% below 80% threshold`)
        }
      } else {
        detail = (commandResult.stdout || commandResult.stderr || `exit code ${commandResult.code}`).slice(-500)
        blockers.push('Coverage percentage could not be parsed')
      }
    } catch (e) {
      blockers.push(`Coverage check failed: ${e}`)
    }
    const passed = blockers.length === 0
    const evidenceItems = [
      {
        ...commandEvidence('Coverage command', this.command, passed, commandResult),
        detail: detail ? `${this.command.reason}\n${detail}` : 'command did not complete',
      },
    ]
    return {
      gate: this.stage,
      status: passed ? 'PASSED' : 'FAILED',
      passed,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers
    } as GateResult
  }

}

function parseCoveragePercentage(output: string): number | null {
  const allFilesLine = output
    .split(/\r?\n/)
    .find(line => /^\s*All files\s*\|/.test(line))
  if (!allFilesLine) return null

  const values = allFilesLine
    .split('|')
    .slice(1)
    .map(part => part.trim().match(/^(\d+(?:\.\d+)?)/)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number)

  if (values.length >= 5) return values[values.length - 1]
  if (values.length >= 4) return values[3]
  if (values.length > 0) return values[values.length - 1]
  return null
}

export class SecurityGate implements IGate {
  stage = 'G7' as GateStage
  name = 'Security'
  description = 'Built-in OWASP-oriented security scan'
  requiredLevel: RequiredLevel = 'ALWAYS'

  private rootDir: string
  private scanDirs: string[]
  private maxFileBytes: number
  private maxFindings: number
  private strict: boolean
  private scaleDir: string
  private dependencyAudit: boolean
  private dependencyAuditMode?: DependencyAuditMode
  private dependencyAuditChangedPackages?: string[]

  constructor(options: SecurityGateOptions = {}) {
    this.rootDir = options.rootDir ?? process.cwd()
    this.scanDirs = options.scanDirs ?? ['src']
    this.maxFileBytes = options.maxFileBytes ?? 300_000
    this.maxFindings = options.maxFindings ?? 50
    this.strict = options.strict ?? false
    this.scaleDir = options.scaleDir ?? '.scale'
    this.dependencyAudit = options.dependencyAudit ?? true
    this.dependencyAuditMode = options.dependencyAuditMode
    this.dependencyAuditChangedPackages = options.dependencyAuditChangedPackages
  }

  async execute(): Promise<GateResult> {
    const findings = await this.scan()
    const dependencyReport = this.dependencyAudit ? auditDependencies({
      projectDir: this.rootDir,
      scaleDir: this.scaleDir,
      mode: this.dependencyAuditMode ?? (this.strict ? 'strict' : undefined),
      changedPackages: this.dependencyAuditChangedPackages,
    }) : null
    const blockers = findings
      .filter(finding => finding.severity === 'CRITICAL' || (this.strict && finding.severity === 'HIGH'))
      .map(finding => `${finding.severity} ${finding.ruleId} in ${finding.file}:${finding.line} - ${finding.description}`)
    blockers.push(...(dependencyReport?.blockers ?? []))
    const passed = blockers.length === 0
    const summary = this.summarize(findings)
    const evidenceItems = [
      createEvidence({
        kind: 'scan',
        label: 'Security scan',
        passed,
        path: this.scanDirs.join(','),
        detail: findings.length > 0
          ? `${findings.length} finding(s): critical=${summary.CRITICAL}, high=${summary.HIGH}, medium=${summary.MEDIUM}, low=${summary.LOW}, strict=${this.strict}`
          : 'no built-in security findings detected',
        source: 'built-in-security-scan',
      }),
      ...findings.slice(0, this.maxFindings).map(finding => createEvidence({
        kind: 'scan' as const,
        label: `Security finding ${finding.ruleId}`,
        passed: finding.severity !== 'CRITICAL' && finding.severity !== 'HIGH',
        path: finding.file,
        detail: `${finding.severity} line ${finding.line}: ${finding.description}; ${finding.evidence}`,
        source: 'built-in-security-scan',
      })),
      ...this.dependencyEvidence(dependencyReport),
    ]
    return {
      gate: this.stage,
      status: passed ? 'PASSED' : 'FAILED',
      passed,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers
    } as GateResult
  }

  private async scan(): Promise<SecurityScanFinding[]> {
    const findings: SecurityScanFinding[] = []
    try {
      const fs = await import('fs/promises')
      const { join, relative } = await import('path')
      const files: string[] = []
      for (const dir of this.scanDirs) {
        files.push(...await this.walkDir(join(this.rootDir, dir)))
      }

      for (const file of files) {
        if (findings.length >= this.maxFindings) break
        const stat = await fs.stat(file)
        if (!stat.isFile() || stat.size > this.maxFileBytes) continue
        const content = await fs.readFile(file, 'utf-8')
        if (content.includes('\u0000')) continue
        const displayPath = relative(this.rootDir, file).replace(/\\/g, '/')
        findings.push(...this.scanFile(displayPath, content).slice(0, this.maxFindings - findings.length))
      }
    } catch {
      // A missing scan directory should not mask the rest of the verification run.
    }
    return findings
  }

  private scanFile(file: string, content: string): SecurityScanFinding[] {
    const findings: SecurityScanFinding[] = []
    const lines = content.split('\n')
    for (const rule of this.rulesForFile(file)) {
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        if (this.isRuleDefinition(file, line) || this.isSecurityTestFixture(file, line)) continue
        rule.pattern.lastIndex = 0
        if (rule.pattern.test(line)) {
          findings.push({
            ruleId: rule.id,
            severity: rule.severity,
            description: rule.description,
            file,
            line: index + 1,
            evidence: line.trim().slice(0, 180),
          })
        }
      }
    }
    findings.push(...this.findEmptyCatchBlocks(file, lines))
    return findings
  }

  private async walkDir(dir: string): Promise<string[]> {
    const fs = await import('fs/promises')
    const { join } = await import('path')
    const results: string[] = []
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (['node_modules', 'dist', '.git', '.scale', 'coverage'].includes(entry.name)) continue
          results.push(...await this.walkDir(fullPath))
        } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
          results.push(fullPath)
        }
      }
    } catch {
      // Ignore unreadable directories.
    }
    return results
  }

  private rulesForFile(file: string): SecurityRule[] {
    const rules: SecurityRule[] = [
      {
        id: 'secret.assignment',
        severity: 'CRITICAL',
        description: 'Hardcoded credential or token assignment',
        pattern: /\b(password|passwd|api[_-]?key|secret|token|auth[_-]?token|access[_-]?token|refresh[_-]?token|private[_-]?key)\b\s*[:=]\s*['"`][^'"`]{6,}['"`]/i,
      },
      {
        id: 'secret.private-key',
        severity: 'CRITICAL',
        description: 'Private key material appears in source',
        pattern: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
      },
      {
        id: 'security.tls-disabled',
        severity: 'HIGH',
        description: 'TLS certificate verification is disabled',
        pattern: /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"`]0['"`]|rejectUnauthorized\s*:\s*false|strictSSL\s*:\s*false/i,
      },
      {
        id: 'injection.eval',
        severity: 'HIGH',
        description: 'Dynamic code execution can enable injection',
        pattern: /\beval\s*\(|new\s+Function\s*\(/,
      },
      {
        id: 'xss.raw-html',
        severity: 'HIGH',
        description: 'Raw HTML rendering can enable XSS',
        pattern: /dangerouslySetInnerHTML|\.innerHTML\s*=/,
      },
      {
        id: 'command.dangerous',
        severity: 'HIGH',
        description: 'Dangerous shell or Git command pattern',
        pattern: /\bgit\s+add\s+\.(?=$|[\s'"`),;])|rm\s+-rf\s+(?:\/|~|\*|\.)|curl\b.*\|.*\b(?:bash|sh|pwsh|powershell|cmd)\b|Invoke-WebRequest\b.*\|\s*iex\b/i,
      },
      {
        id: 'command.shell-exec',
        severity: 'MEDIUM',
        description: 'Shell execution requires argument control review',
        pattern: /\bshell\s*:\s*true\b|\bexecSync\s*\(|\bchild_process\.exec\s*\(/,
      },
      {
        id: 'types.ts-ignore',
        severity: 'MEDIUM',
        description: 'TypeScript error suppression can hide unsafe code',
        pattern: /^\s*(?:\/\/|\/\*)\s*@ts-ignore\b/,
      },
    ]
    return this.isTestPath(file)
      ? rules.filter(rule => rule.severity === 'CRITICAL' || rule.id === 'command.dangerous')
      : rules
  }

  private findEmptyCatchBlocks(file: string, lines: string[]): SecurityScanFinding[] {
    if (this.isTestPath(file)) return []
    const findings: SecurityScanFinding[] = []
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (/catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\*.*?\*\/|\/\/.*)?\s*\}/.test(line)) {
        findings.push({
          ruleId: 'logic.empty-catch',
          severity: 'HIGH',
          description: 'Empty or comment-only catch block suppresses failures',
          file,
          line: index + 1,
          evidence: line.trim().slice(0, 180),
        })
        continue
      }
      if (!/catch\s*(?:\([^)]*\))?\s*\{\s*$/.test(line)) continue
      for (let probe = index + 1; probe < Math.min(lines.length, index + 8); probe += 1) {
        const trimmed = lines[probe].trim()
        if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('*/')) {
          continue
        }
        if (/^}\s*[),;]?$/.test(trimmed)) {
          findings.push({
            ruleId: 'logic.empty-catch',
            severity: 'HIGH',
            description: 'Empty or comment-only catch block suppresses failures',
            file,
            line: index + 1,
            evidence: line.trim().slice(0, 180),
          })
        }
        break
      }
    }
    return findings
  }

  private summarize(findings: SecurityScanFinding[]): Record<SecuritySeverity, number> {
    return {
      CRITICAL: findings.filter(f => f.severity === 'CRITICAL').length,
      HIGH: findings.filter(f => f.severity === 'HIGH').length,
      MEDIUM: findings.filter(f => f.severity === 'MEDIUM').length,
      LOW: findings.filter(f => f.severity === 'LOW').length,
    }
  }

  private dependencyEvidence(report: DependencyAuditReport | null): GateEvidence[] {
    if (!report) {
      return [
        createEvidence({
          kind: 'scan',
          label: 'G7 dependency audit',
          passed: true,
          detail: 'dependency audit disabled',
          source: 'dependency-audit',
        }),
      ]
    }
    const summary = report.summary
    return [
      createEvidence({
        kind: 'scan',
        label: 'G7 dependency audit',
        passed: report.ok,
        path: report.lockfilePath,
        detail: `${summary.packagesAudited} package(s) audited, findings=${summary.totalFindings}, critical=${summary.bySeverity.CRITICAL}, high=${summary.bySeverity.HIGH}, medium=${summary.bySeverity.MEDIUM}, low=${summary.bySeverity.LOW}, mode=${report.mode}`,
        source: 'dependency-audit',
      }),
      ...report.findings.slice(0, this.maxFindings).map(finding => createEvidence({
        kind: 'scan' as const,
        label: `Dependency finding ${finding.ruleId}`,
        passed: !report.blockers.some(blocker => blocker.includes(finding.ruleId) && blocker.includes(finding.packageName)),
        path: finding.path,
        detail: `${finding.severity} ${finding.packageName}${finding.version ? `@${finding.version}` : ''}: ${finding.message}; ${finding.evidence ?? 'no detail'}`,
        source: 'dependency-audit',
      })),
    ]
  }

  private isTestPath(file: string): boolean {
    return /(^|\/)(tests?|__tests__)\//i.test(file) || /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file)
  }

  private isRuleDefinition(file: string, line: string): boolean {
    const trimmed = line.trim()
    return file.endsWith('GateSystem.ts') && (/^pattern:\s*\/.*\/[dgimsuy]*,?$/.test(trimmed) || /^id:\s*['"`][^'"`]+['"`],?$/.test(trimmed))
  }

  private isSecurityTestFixture(file: string, line: string): boolean {
    if (!this.isTestPath(file)) return false
    return /\b(?:text|content|diff|source)\b\s*[:=]/.test(line) &&
      /['"`].*(?:password|api[_-]?key|secret|token|auth|credential|private[_-]?key|git add|shell: true|@ts-ignore|catch)/i.test(line)
  }
}

function parseProductSmokeReport(commandResult: CommandResult | null): ProductSmokeReport | null {
  const raw = commandResult?.stdout.trim()
  if (!raw || !raw.startsWith('{')) return null
  try {
    const parsed = JSON.parse(raw) as ProductSmokeReport
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

function productSmokeReportBlocker(report: ProductSmokeReport | null): string | null {
  if (!report || typeof report.status !== 'string') return null
  if (report.status === 'passed') return null
  const message = typeof report.message === 'string' && report.message.trim()
    ? report.message.trim()
    : `reported status ${report.status}`
  if (report.status === 'skipped') {
    return `Product smoke did not run real probes: ${message}`
  }
  return `Product smoke report failed: ${message}`
}

export class ProductSmokeGate implements IGate {
  stage = 'G8' as GateStage
  name = 'Product Smoke'
  description = 'Run configured real product-path smoke command'
  requiredLevel: RequiredLevel = 'M'

  constructor(
    private command: ResolvedVerificationCommand,
    private runtimeEvidence?: VerificationRuntimeEvidenceConfig,
  ) {}

  async execute(): Promise<GateResult> {
    if (!this.command.command) {
      return missingCommandResult(this.stage, 'Product smoke command', this.command)
    }

    const blockers: string[] = []
    let commandResult: CommandResult | null = null
    try {
      commandResult = await runShellCommand(this.command.command, 180000, this.command.cwd, gateCommandOptions(this.stage, this.command, this.runtimeEvidence))
      if (commandResult.code !== 0) {
        blockers.push(`Product smoke failed: ${commandResult.stderr || commandResult.stdout || `exit code ${commandResult.code}`}`)
      }
      const reportBlocker = productSmokeReportBlocker(parseProductSmokeReport(commandResult))
      if (reportBlocker) blockers.push(reportBlocker)
    } catch (e) {
      blockers.push(`Product smoke execution failed: ${e}`)
    }
    const passed = blockers.length === 0
    if (passed) {
      const evidenceError = this.recordRuntimeEvidence(commandResult)
      if (evidenceError) blockers.push(evidenceError)
    }
    const evidenceItems = [
      commandEvidence('Product smoke command', this.command, passed, commandResult),
    ]
    return {
      gate: this.stage,
      status: blockers.length === 0 ? 'PASSED' : 'FAILED',
      passed: blockers.length === 0,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers,
    } as GateResult
  }

  private recordRuntimeEvidence(commandResult: CommandResult | null): string | null {
    if (!this.runtimeEvidence) return null
    try {
      const projectDir = this.runtimeEvidence.projectDir ?? this.command.cwd ?? process.cwd()
      const ledger = new RuntimeEvidenceLedger({
        projectDir,
        scaleDir: this.runtimeEvidence.scaleDir,
      })
      ledger.record({
        taskId: this.runtimeEvidence.taskId,
        sessionId: this.runtimeEvidence.sessionId,
        kind: 'command',
        title: 'Product smoke: G8',
        status: 'passed',
        command: this.command.command,
        exitCode: commandResult?.code,
        summary: tail(commandResult?.stdout || commandResult?.stderr || 'Product smoke gate passed', 1000),
        artifacts: ['.agent/logs/product-smoke.json'],
        metadata: {
          productSmoke: true,
          realProductPath: true,
          gate: 'G8',
          profile: this.runtimeEvidence.profile ?? 'productSmoke',
          source: this.command.source,
        },
      })
      return null
    } catch (error) {
      return `Product smoke runtime evidence could not be recorded: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}
