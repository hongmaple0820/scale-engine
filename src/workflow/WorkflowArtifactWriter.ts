// SCALE Engine — Workflow Artifact Writer
// 将工作流各阶段结果写入标准化 JSON 文件，供 Gate 系统验证
// 设计参考：工作流优化方案 — "内容 + 执行 + 检查" 三者闭环

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../core/logger.js'

// ============================================================================
// Artifact Types
// ============================================================================

export interface ExploreArtifact {
  timestamp: string
  files: string[]
  fileCount: number
  mainContradiction: string
  ambiguityScore: number
  socraticCompleted: boolean
  graphNodes?: number
}

export interface PlanArtifact {
  timestamp: string
  planId: string
  specId: string
  hasBoundaryAnalysis: boolean
  hasExceptionHandling: boolean
  hasRollbackStrategy: boolean
  modules: string[]
  consensusRounds: number
  verdict: string
}

export interface TDDEvidence {
  timestamp: string
  taskId: string
  red: boolean
  green: boolean
  refactor: boolean
  testFirst: boolean
  testFile: string
  implFile: string
  coverage?: number
}

export interface CheckpointData {
  timestamp: string
  phase: string
  sessionId?: string
  data: Record<string, unknown>
}

export type WorkflowTaskLevel = 'S' | 'M' | 'L' | 'CRITICAL'
export type WorkflowPhase = 'define' | 'explore' | 'plan' | 'build' | 'verify' | 'review' | 'ship' | 'done'

export interface WorkflowState {
  schemaVersion: 1
  taskId: string
  level: WorkflowTaskLevel
  phase: WorkflowPhase
  artifactsDir?: string
  exploredFiles: string[]
  fileCount: number
  mainContradiction: string
  completedGates: string[]
  openTasks: string[]
  filesModified: string[]
  skillIntents?: string[]
  skillRoutingMode?: 'off' | 'warn' | 'block'
  skillPlanRequired?: boolean
  skillPlanPath?: string
  requiredSkills?: string[]
  recommendedSkills?: string[]
  requiredSkillArtifacts?: string[]
  requiredSkillVerification?: string[]
  lastSpecId?: string
  lastPlanId?: string
  lastTaskId?: string
  updatedAt: string
}

export type WorkflowStatePatch = Partial<Omit<WorkflowState, 'schemaVersion' | 'updatedAt'>> & {
  updatedAt?: string
}

// ============================================================================
// Artifact Writer
// ============================================================================

export class WorkflowArtifactWriter {
  private stateDir: string

  constructor(scaleDir: string = '.scale') {
    this.stateDir = join(scaleDir, 'state')
  }

  // ─────────────────────────────────────────────────────────────
  // Ensure directory
  // ─────────────────────────────────────────────────────────────

  private ensureDir(): void {
    if (!existsSync(this.stateDir)) {
      mkdirSync(this.stateDir, { recursive: true })
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Explore Artifact
  // ─────────────────────────────────────────────────────────────

  /** Write explore result to .scale/state/explore.json */
  writeExploreResult(result: ExploreArtifact): void {
    this.ensureDir()
    const filePath = join(this.stateDir, 'explore.json')
    writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf-8')
    this.updateCurrentState({
      phase: 'explore',
      exploredFiles: result.files,
      fileCount: result.fileCount,
      mainContradiction: result.mainContradiction,
    })
    logger.info({ files: result.fileCount, contradiction: result.mainContradiction }, 'Explore artifact written')
  }

  /** Read explore artifact from .scale/state/explore.json */
  readExploreResult(): ExploreArtifact | null {
    return this.readJson<ExploreArtifact>(join(this.stateDir, 'explore.json'))
  }

  /** Check if explore artifact exists and is valid */
  hasValidExploreResult(minFiles: number = 3): boolean {
    const artifact = this.readExploreResult()
    if (!artifact) return false
    return artifact.fileCount >= minFiles && artifact.mainContradiction.length > 0
  }

  // ─────────────────────────────────────────────────────────────
  // Plan Artifact
  // ─────────────────────────────────────────────────────────────

  /** Write plan result to .scale/state/plan-{planId}.json */
  writePlanResult(result: PlanArtifact): void {
    this.ensureDir()
    const filePath = this.planArtifactPath(result.planId)
    writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf-8')
    this.updateCurrentState({
      phase: 'plan',
      lastSpecId: result.specId || undefined,
      lastPlanId: result.planId,
    })
    logger.info({ planId: result.planId, verdict: result.verdict }, 'Plan artifact written')
  }

  /** Read plan artifact by ID */
  readPlanResult(planId: string): PlanArtifact | null {
    return this.readJson<PlanArtifact>(this.planArtifactPath(planId))
  }

  /** Read the most recent plan artifact */
  readLatestPlanResult(): PlanArtifact | null {
    const planFiles = this.listFiles('plan-')
    if (planFiles.length === 0) return null

    // Sort by timestamp in filename, take latest
    const sorted = planFiles.sort().reverse()
    return this.readJson<PlanArtifact>(join(this.stateDir, sorted[0]))
  }

  /** Check if a valid plan artifact exists */
  hasValidPlanResult(): boolean {
    const artifact = this.readLatestPlanResult()
    if (!artifact) return false
    return artifact.hasBoundaryAnalysis && artifact.hasRollbackStrategy
  }

  // ─────────────────────────────────────────────────────────────
  // TDD Evidence
  // ─────────────────────────────────────────────────────────────

  /** Write TDD evidence to .scale/state/tdd-{taskId}.json */
  writeTDDEvidence(evidence: TDDEvidence): void {
    this.ensureDir()
    const filePath = this.tddEvidencePath(evidence.taskId)
    writeFileSync(filePath, JSON.stringify(evidence, null, 2), 'utf-8')
    this.updateCurrentState({
      phase: 'verify',
      lastTaskId: evidence.taskId,
    })
    logger.info({ taskId: evidence.taskId }, 'TDD evidence written')
  }

  /** Read TDD evidence by task ID */
  readTDDEvidence(taskId: string): TDDEvidence | null {
    return this.readJson<TDDEvidence>(this.tddEvidencePath(taskId))
  }

  /** Read the most recent TDD evidence */
  readLatestTDDEvidence(): TDDEvidence | null {
    const tddFiles = this.listFiles('tdd-')
    if (tddFiles.length === 0) return null

    const sorted = tddFiles.sort().reverse()
    return this.readJson<TDDEvidence>(join(this.stateDir, sorted[0]))
  }

  /** Check if valid TDD evidence exists for a task */
  hasValidTDDEvidence(taskId?: string): boolean {
    const artifact = taskId
      ? this.readTDDEvidence(taskId)
      : this.readLatestTDDEvidence()
    if (!artifact) return false
    return artifact.red && artifact.green && artifact.refactor && artifact.testFirst
  }

  // ─────────────────────────────────────────────────────────────
  // Checkpoint
  // ─────────────────────────────────────────────────────────────

  /** Write checkpoint to .scale/state/checkpoint.json */
  writeCheckpoint(data: CheckpointData): void {
    this.ensureDir()
    const filePath = join(this.stateDir, 'checkpoint.json')
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
    if (this.isWorkflowPhase(data.phase)) {
      this.updateCurrentState({ phase: data.phase })
    }
    logger.info({ phase: data.phase }, 'Checkpoint written')
  }

  /** Read checkpoint */
  readCheckpoint(): CheckpointData | null {
    return this.readJson<CheckpointData>(join(this.stateDir, 'checkpoint.json'))
  }

  // ─────────────────────────────────────────────────────────────
  // Generic Helpers
  // ─────────────────────────────────────────────────────────────

  /** Clear all artifacts (for testing or reset) */
  clearAll(): void {
    if (!existsSync(this.stateDir)) return
    const files = readdirSync(this.stateDir)
    for (const file of files) {
      if (file.endsWith('.json')) {
        unlinkSync(join(this.stateDir, file))
      }
    }
    logger.info('All workflow artifacts cleared')
  }

  /** Get state directory path */
  getStateDir(): string { return this.stateDir }

  /** Get the on-disk path for a plan artifact ID */
  planArtifactPath(planId: string): string {
    return this.artifactPath('plan', planId, 'artifact')
  }

  /** Get the on-disk path for a TDD evidence task ID */
  tddEvidencePath(taskId: string): string {
    return this.artifactPath('tdd', taskId, 'evidence')
  }

  /** Write authoritative workflow state to .scale/state/current.json */
  writeCurrentState(state: WorkflowState): void {
    this.ensureDir()
    const normalized = this.normalizeState(state)
    writeFileSync(join(this.stateDir, 'current.json'), JSON.stringify(normalized, null, 2), 'utf-8')
  }

  /** Read authoritative workflow state from .scale/state/current.json */
  readCurrentState(): WorkflowState | null {
    const state = this.readJson<WorkflowState>(join(this.stateDir, 'current.json'))
    return state ? this.normalizeState(state) : null
  }

  /** Merge a patch into .scale/state/current.json. */
  updateCurrentState(patch: WorkflowStatePatch): WorkflowState {
    const current = this.readCurrentState()
    const next = this.normalizeState({
      ...(current ?? this.createDefaultState()),
      ...patch,
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    })
    this.writeCurrentState(next)
    return next
  }

  // ─────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────

  private readJson<T>(filePath: string): T | null {
    if (!existsSync(filePath)) return null
    try {
      const content = readFileSync(filePath, 'utf-8')
      return JSON.parse(content) as T
    } catch (e) {
      logger.warn({ path: filePath, error: (e as Error).message }, 'Failed to read artifact')
      return null
    }
  }

  private listFiles(prefix: string): string[] {
    if (!existsSync(this.stateDir)) return []
    return readdirSync(this.stateDir)
      .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
  }

  private createDefaultState(): WorkflowState {
    return {
      schemaVersion: 1,
      taskId: `task-${Date.now()}`,
      level: 'M',
      phase: 'define',
      exploredFiles: [],
      fileCount: 0,
      mainContradiction: '',
      completedGates: [],
      openTasks: [],
      filesModified: [],
      updatedAt: new Date().toISOString(),
    }
  }

  private normalizeState(state: WorkflowState): WorkflowState {
    return {
      schemaVersion: 1,
      taskId: state.taskId || `task-${Date.now()}`,
      level: state.level ?? 'M',
      phase: state.phase ?? 'define',
      artifactsDir: state.artifactsDir,
      exploredFiles: state.exploredFiles ?? [],
      fileCount: state.fileCount ?? state.exploredFiles?.length ?? 0,
      mainContradiction: state.mainContradiction ?? '',
      completedGates: state.completedGates ?? [],
      openTasks: state.openTasks ?? [],
      filesModified: state.filesModified ?? [],
      skillIntents: state.skillIntents ?? [],
      skillRoutingMode: state.skillRoutingMode,
      skillPlanRequired: state.skillPlanRequired,
      skillPlanPath: state.skillPlanPath,
      requiredSkills: state.requiredSkills ?? [],
      recommendedSkills: state.recommendedSkills ?? [],
      requiredSkillArtifacts: state.requiredSkillArtifacts ?? [],
      requiredSkillVerification: state.requiredSkillVerification ?? [],
      lastSpecId: state.lastSpecId,
      lastPlanId: state.lastPlanId,
      lastTaskId: state.lastTaskId,
      updatedAt: state.updatedAt ?? new Date().toISOString(),
    }
  }

  private isWorkflowPhase(phase: string): phase is WorkflowPhase {
    return ['define', 'explore', 'plan', 'build', 'verify', 'review', 'ship', 'done'].includes(phase)
  }

  private artifactPath(prefix: 'plan' | 'tdd', id: string, fallback: string): string {
    return join(this.stateDir, `${prefix}-${safePathSegment(id, fallback)}.json`)
  }
}

function safePathSegment(value: string, fallback: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || fallback
}
