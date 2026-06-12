/**
 * SCALE Engine — Core Types
 *
 * 这是整个系统的"灵魂"。
 * 所有 Artifact、Event、FSM 类型都在这里定义。
 * 修改这个文件需要 W4 末的"数据模型冻结评审"通过。
 *
 * 设计参考：docs/02-DATA-MODEL.md
 */

// ============================================================================
// 1. 通用类型
// ============================================================================

/** 行为者：可以是 AI、人类或系统 */
export type Actor =
  | { kind: 'ai'; role: string; model?: string }
  | { kind: 'human'; userId: string }
  | { kind: 'system'; component: string }

/** 时间戳（毫秒） */
export type Timestamp = number

/** 通用 ID 字符串。格式：{TYPE}-{YYYYMMDD}-{SEQ}，例如 SPEC-20260421-0007 */
export type ArtifactId = string
export type EventId = string
export type SessionId = string

// ============================================================================
// 2. Artifact 类型谱系
// ============================================================================

/** 11 种 Artifact 类型 */
export type ArtifactType =
  | 'Need'
  | 'Insight'
  | 'Spec'
  | 'Plan'
  | 'TestPlan'
  | 'Task'
  | 'Change'
  | 'Evidence'
  | 'Defect'
  | 'Lesson'
  | 'Release'

// ============================================================================
// 3. Artifact 通用结构
// ============================================================================

export interface Artifact<TPayload = unknown> {
  // 标识
  id: ArtifactId
  type: ArtifactType
  version: number

  // 状态
  status: string
  statusHistory: StatusChange[]

  // 关系
  parents: ArtifactId[]
  children: ArtifactId[]
  supersedes?: ArtifactId

  // 内容
  title: string
  contentRef: string                  // 内容文件路径
  payload: TPayload

  // 质量门
  gates: Gate[]

  // 元数据
  createdBy: Actor
  createdAt: Timestamp
  updatedAt: Timestamp
  closedAt?: Timestamp
  tags: string[]
  labels: Record<string, string>
}

export interface StatusChange {
  from: string
  to: string
  at: Timestamp
  by: Actor
  reason?: string
  eventId: EventId
}

export interface Gate {
  name: string
  required: boolean
  threshold?: string
  actual?: unknown
  passed: boolean
  checkedAt?: Timestamp
  checkedBy?: Actor
  // Harness Engineering: 程序化质量门禁
  // 文章启发："不可机器验证的约束是无效约束"
  automatedCheck?: string  // 条件表达式，如 "buildExitCode == 0 && testPassed == true && testCoverage >= 80"
  conditions?: GateCondition[]  // 分解的条件列表，便于单独检查
}

/** Harness Engineering: 可程序化验证的条件 */
export interface GateCondition {
  field: string        // 字段名：buildExitCode, testPassed, testCoverage, lintStatus
  operator: '==' | '!=' | '>=' | '<=' | '>' | '<' | 'includes' | 'matches'
  value: number | string | boolean | RegExp
  description?: string // 人类可读描述
}

/** Harness Engineering: TaskPayload 质量字段（防止 Premature Done） */
export interface TaskQualityMetrics {
  buildStatus?: 'pending' | 'success' | 'failed'
  buildExitCode?: number
  lintStatus?: 'pending' | 'success' | 'failed'
  testPassed?: boolean
  testCoverage?: number
  testTotal?: number
  testFailed?: number
  e2ePassed?: boolean
}

// ============================================================================
// 4. 各类型的 Payload
// ============================================================================

/** Need —— 用户原始诉求 */
export interface NeedPayload {
  rawText: string
  ambiguityScore?: number
  stakeholders: string[]
}

/** Insight —— 探索学习产出 */
export interface InsightPayload {
  category: 'fact' | 'constraint' | 'risk' | 'opportunity'
  evidence: Array<{ type: 'file' | 'doc' | 'test' | 'log'; ref: string }>
  confidence: number
  contradictsArtifact?: ArtifactId
}

/** Spec —— 需求契约 (WHAT) */
export interface SpecPayload {
  what: string
  successCriteria: string[]
  outOfScope: string[]
  edgeCases: string[]
  northStar: string
  ambiguityScore?: number // FSM guard requires this for FROZEN transition
  // P0 六要素契约（借鉴 Codex Goals 完成契约模型）。
  // 全部可选以保持向后兼容：`outcome` 复用 `what`，其余为新增的结构化补强字段。
  /** 具体证据来源：测试名 / 基准命令 / 产物路径。后续 evidence 须能映射回其中某一项。 */
  verificationSurface?: string[]
  /** 运行期间不能退化的指标（性能 / 安全 / 兼容性）。 */
  constraints?: string[]
  /** 执行边界：可改文件、可用工具、明确禁动范围。 */
  boundaries?: SpecBoundaries
  /** build 阶段每轮迭代后如何决定下一步。 */
  iterationStrategy?: string
  /** 无可行路径时报告什么、需要什么才能解锁。 */
  blockedStopCondition?: string
}

/** Spec 执行边界（六要素之一） */
export interface SpecBoundaries {
  files: string[]
  tools: string[]
  /** 明确不能动的范围（与需求层 outOfScope 互补：此处是执行层禁动）。 */
  forbidden: string[]
}

/** Plan —— 技术方案 (HOW) */
export interface PlanPayload {
  approach: string
  techChoices: Array<{
    decision: string
    rationale: string
    alternatives: string[]
  }>
  modules: Array<{
    path: string
    action: 'create' | 'modify' | 'delete'
    reason: string
  }>
  rollbackStrategy: string
  estimatedComplexity: number
}

/** TestPlan —— 验证方案 */
export interface TestPlanPayload {
  unitTests: TestSpec[]
  integrationTests: TestSpec[]
  manualChecks: string[]
  perfBudgets?: Array<{ metric: string; target: string }>
}

export interface TestSpec {
  name: string
  given: string
  when: string
  then: string
  command?: string
}

/** Task —— 原子可执行单元 */

/** Agent Brief — 借鉴 mattpocock/skills 的 AGENT-BRIEF.md 设计
 *  标准化的 Agent 可执行工单格式。
 *  禁止引用文件路径和行号（会过时），描述行为而非实现步骤。
 */
export interface AgentBrief {
  /** bug | enhancement */
  category: 'bug' | 'enhancement'
  /** 一句话描述 */
  summary: string
  /** 当前行为（bug 时为错误行为，enhancement 时为现状） */
  currentBehavior: string
  /** 期望行为（完成后系统应如何表现） */
  desiredBehavior: string
  /** 关键接口：需变更的类型/函数/配置 */
  keyInterfaces: string[]
  /** 可独立验证的验收标准 */
  acceptanceCriteria: string[]
  /** 明确排除的范围 */
  outOfScope: string[]
}

export interface TaskPayload {
  description: string
  workflowLevel?: 'S' | 'M' | 'L' | 'CRITICAL'
  servicesTouched?: string[]
  residualRisk?: string
  estimatedTokens?: number
  estimatedDurationMs?: number
  filesInvolved: string[]
  dependsOn: ArtifactId[]
  requiredRole: string
  requiredCapabilities: string[]

  // Harness Engineering: 代码质量验证字段（防止 Premature Done）
  // 文章启发："检查 CI 是否通过"不够具体，必须程序化验证
  buildStatus?: 'pending' | 'success' | 'failed'
  buildExitCode?: number
  lintStatus?: 'pending' | 'success' | 'failed'
  testPassed?: boolean
  testCoverage?: number
  testTotal?: number      // 新增：测试总数（检测 0/0 异常）
  testFailed?: number     // 新增：失败测试数
  e2ePassed?: boolean     // 新增：端到端测试通过
  reviewPassed?: boolean  // 新增：评审通过（强制评审阶段）
  verificationEvidenceIds?: string[]
  verifiedAt?: Timestamp
  artifactGateMode?: 'off' | 'warn' | 'block'
  artifactGatePassed?: boolean
  artifactComplete?: boolean
  skillIntents?: string[]
  skillRoutingMode?: 'off' | 'warn' | 'block'
  skillPlanRequired?: boolean
  requiredSkills?: string[]
  recommendedSkills?: string[]
  requiredSkillArtifacts?: string[]
  requiredSkillVerification?: string[]
  skillGatePassed?: boolean
  toolOrchestrationMode?: 'off' | 'advisory' | 'evidence-required' | 'block'
  requiredTools?: string[]
  toolEvidenceIds?: string[]
  toolEvidenceGatePassed?: boolean
  reviewEvidenceIds?: string[]
  reviewedAt?: Timestamp
  /** Agent Brief — 标准化的 Agent 可执行工单（借鉴 mattpocock/skills） */
  agentBrief?: AgentBrief
}

/** Change —— 实际代码变更 */
export interface ChangePayload {
  commitSha?: string
  prUrl?: string
  filesChanged: Array<{ path: string; additions: number; deletions: number }>
  diffSummary: string
  reverted?: boolean
}

/** P1.2 (G23): a single test-integrity heuristic finding. */
export interface TestIntegrityFinding {
  /** Test file (repo-relative path) the finding came from. */
  file: string
  /** Heuristic that produced the finding. */
  kind:
    | 'assertion-removed'
    | 'skip-added'
    | 'only-added'
    | 'weakened-assertion'
    | 'timeout-inflated'
  /** Intended enforcement once G23 leaves advisory mode (see P1 decision E1). */
  severity: 'warn' | 'block'
  /** Human-readable explanation of the flagged change. */
  detail: string
}

/**
 * P1.2 (G23 Test Integrity): evidence produced by analysing the test-file diff.
 * Fields marked PR-D2 are populated by the later verify→ship enforcement PR and
 * are optional so PR-D1 (advisory detection) can omit them.
 */
export interface TestIntegrityEvidence {
  /** Test files included in the analysis (repo-relative paths). */
  analyzedFiles: string[]
  /** Approx assertion count on the pre-change side of the analysed diff hunks. */
  preChangeAssertionCount: number
  /** Approx assertion count on the post-change side of the analysed diff hunks. */
  postChangeAssertionCount: number
  /** postChangeAssertionCount - preChangeAssertionCount (negative = net assertions removed). */
  assertionCountDelta: number
  /** Human-readable summary of every flagged heuristic. */
  flaggedPatterns: string[]
  /** Structured findings backing flaggedPatterns. */
  findings: TestIntegrityFinding[]
  /** Whether this run was advisory (warn-only) or enforced. */
  advisory: boolean
  /** PR-D2: coverage regression vs the last passing baseline. */
  coverageDelta?: number
  /** PR-D2: test-file hash recorded at verify time. */
  testFileHashAtVerify?: string
  /** PR-D2: test-file hash recomputed at ship time. */
  testFileHashAtShip?: string
}

/** Evidence —— 验证证据 */
export interface EvidencePayload {
  testPlanId: ArtifactId
  toolUsed: string
  passed: boolean
  output: string
  duration: number
  artifacts: string[]
  /** P0: 指向 Spec.verificationSurface 中声明的某一项；无映射的证据视为未对齐（P0 仅告警）。 */
  verificationSurfaceRef?: string
  /** P1.2 (G23): test-integrity analysis attached to verify-stage evidence. */
  testIntegrity?: TestIntegrityEvidence
}

/** Defect —— 缺陷 */
export interface DefectPayload {
  symptom: string
  rootCauseCategory:
    | 'requirement_ambiguity'
    | 'design_flaw'
    | 'implementation_bug'
    | 'test_gap'
    | 'environment_issue'
    | 'unknown'
  rootCauseDetail: string
  fixChangeIds: ArtifactId[]
  similarTo: ArtifactId[]
  lesson?: ArtifactId
}

/** Lesson —— 沉淀经验 */
export interface LessonPayload {
  type:
    | 'lesson'
    | 'pattern'
    | 'best_practice'
    | 'anti_pattern'
    | 'decision'
    | 'troubleshooting'
    | 'workflow'
    | 'reference'
    | 'preference'
    | 'do_not_repeat'
  problem: string
  solution: string
  prevention: string
  sourceDefects: ArtifactId[]
  applicableContexts: string[]
  verified: boolean
  promotedToRule?: string
}

/** Release —— 发布单 */
export interface ReleasePayload {
  version: string
  includesSpecs: ArtifactId[]
  includesChanges: ArtifactId[]
  rolloutStrategy: 'canary' | 'blue_green' | 'rolling' | 'all_at_once'
  rolledBack?: boolean
  rollbackReason?: string
}

/** 类型映射：根据 ArtifactType 推断 Payload 类型 */
export type PayloadOf<T extends ArtifactType> = T extends 'Need'
  ? NeedPayload
  : T extends 'Insight'
  ? InsightPayload
  : T extends 'Spec'
  ? SpecPayload
  : T extends 'Plan'
  ? PlanPayload
  : T extends 'TestPlan'
  ? TestPlanPayload
  : T extends 'Task'
  ? TaskPayload
  : T extends 'Change'
  ? ChangePayload
  : T extends 'Evidence'
  ? EvidencePayload
  : T extends 'Defect'
  ? DefectPayload
  : T extends 'Lesson'
  ? LessonPayload
  : T extends 'Release'
  ? ReleasePayload
  : never

// ============================================================================
// 5. Event 类型系统
// ============================================================================

export type EventType =
  // Artifact 生命周期
  | 'artifact.created'
  | 'artifact.updated'
  | 'artifact.transitioned'
  | 'artifact.gate_checked'
  | 'artifact.deleted'
  // 工具调用
  | 'tool.called'
  | 'tool.completed'
  | 'tool.failed'
  | 'tool.blocked'
  // 护栏
  | 'gate.checked'
  | 'gate.passed'
  | 'gate.failed'
  | 'gate.executed'
  | 'gate.blocked'
  // Workflow
  | 'consensus.round'
  | 'ralph.iteration'
  | 'ralph.story.start'
  | 'ralph.story.end'
  | 'ralph.deslop.start'
  | 'ralph.deslop.end'
  | 'ultrawork.task.start'
  | 'ultrawork.task.end'
  | 'socratic.session.started'
  | 'socratic.answer.recorded'
  | 'socratic.session.blocked'
  // 行为模式
  | 'behavior.brute_retry'
  | 'behavior.idle_tool'
  | 'behavior.busy_loop'
  | 'behavior.premature_done'
  | 'behavior.blame_shift'
  | 'behavior.ai_slop'
  | 'behavior.hallucination'
  | 'behavior.duplicate_edit'
  | 'behavior.passive_wait'
  | 'behavior.same_file_edit'
  // Autonomous workflow loop
  | 'autonomous.loop.start'
  | 'autonomous.worklog.read'
  | 'autonomous.loop.error'
  | 'autonomous.loop.end'
  | 'autonomous.defect.detected'
  | 'autonomous.defect.fix_requested'
  | 'autonomous.feature.start'
  | 'autonomous.feature.delegated'
  | 'autonomous.baton.written'
  // Role
  | 'role.activated'
  | 'role.denied'
  // Session
  | 'session.started'
  | 'session.ended'
  | 'session.compacted'
  | 'session.cleared'
  // Knowledge
  | 'lesson.proposed'
  | 'lesson.validated'
  | 'lesson.approved'
  | 'lesson.rejected'
  | 'lesson.recalled'
  | 'lesson.helpful'
  | 'lesson.useless'
  // Task
  | 'task.scheduled'
  | 'task.started'
  | 'task.checkpointed'
  | 'task.paused'
  | 'task.resumed'
  | 'task.restored'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled'
  | 'task.drift_detected'
  | 'task.step_started'
  | 'task.step_completed'
  | 'task.step_failed'
  | 'task.step_retrying'
  | 'task.decomposed'
  | `task.custom.${string}`
  // Evolution
  | 'defect.auto_created'
  | 'rule.proposed'
  | 'rule.enforced'
  | 'hook.generated'
  | 'hook.deployed'
  | 'hook.rollback'
  | 'evolution.cycle_completed'
  | 'evolution.evaluated'
  // Context
  | 'context.built'
  // Skills (v0.7.0)
  | 'skill.registered'
  | 'skill.unregistered'
  | 'skill.recommended'
  | 'skill.executed'
  | 'skill.installation_changed'
  | 'skills.cleared'
  | 'external-skills.registered'
  | 'skills.install-prompt'     // 技能安装提示
  | 'skill.install-started'     // 开始安装
  | 'skill.installed'           // 安装成功
  | 'skill.install-failed'      // 安装失败
  | 'skills.batch-installed'    // 批量安装完成
  // Workflows (v0.7.0)
  | 'workflow.started'
  | 'workflow.paused'
  | 'workflow.resumed'
  | 'workflow.completed'
  | 'workflow.failed'
  | 'workflow.step_started'
  | 'workflow.step_completed'
  | 'workflow.step_failed'
  // Triggers (v0.7.0)
  | 'tool.used'
  | 'detector.triggered'
  | 'phase.changed'
  | 'context.inject'
  // Agent System (v0.8.0)
  | 'agent.spawned'
  | 'agent.task_assigned'
  | 'agent.running'
  | 'agent.completed'
  | 'agent.failed'
  | 'agent.recycled'
  | 'agent.message_sent'
  | 'agent.message_received'
  | 'agent.dispatched'
  | 'agent.dispatch_blocked'
  | 'agent.blocked'
  | 'agent.unblocked'
  | 'agent.subscribed'
  | 'team.formed'
  | 'team.dissolved'
  | 'team.progress_updated'
  | 'team.completed'
  | 'team.failed'
  // Review System (v0.10.0)
  | 'review.required'
  | 'review.passed'
  | 'review.failed'
  | 'task.review_failed'
  // Pattern Extraction (v0.10.0)
  | 'pattern.extracted'
  | 'pattern.verified'
  // Skill Creation (v0.10.0)
  | 'skill.proposed'
  | 'skill.published'
  // Ubiquitous Language (v0.10.0 - mattpoclock/skills)
  | 'term.discovered'
  | 'term.updated'
  | 'term.ambiguity_detected'
  | 'adr.proposed'
  | 'adr.accepted'
  | 'adr.deprecated'
  | 'adr.superseded'
  // Issue Triage (v0.10.0 - mattpoclock/skills)
  | 'issue.triaged'
  | 'issue.state_changed'
  | 'issue.escalated'
  | 'issue.info_requested'
  // Grilling Session (v0.10.0 - mattpoclock/skills)
  | 'grilling.session_started'
  | 'grilling.session_ended'
  | 'grilling.concluded'
  | 'grilling.answer_received'
  // Anti-Pattern Detection (v0.10.0 - andrej-karpathy-skills)
  | 'antipattern.detected'
  | 'antipattern.registered'
  // Security Detection (v0.10.0)
  | 'security.owasp_critical'
  | 'security.owasp_high'
  | 'security.owasp_info'
  // Browser QA (v0.10.0)
  | 'qa.test.start'
  | 'qa.test.end'
  | 'qa.test.error'
  | 'qa.accessibility.start'
  | 'qa.accessibility.end'
  | 'qa.performance.start'
  | 'qa.performance.end'
  | 'qa.tests.summary'
  // E2E Testing (v0.10.0)
  | 'e2e.start'
  | 'e2e.end'
  | 'e2e.flow.attempt'
  | 'e2e.flow.retry'
  | 'e2e.accessibility.check'
  | 'e2e.performance.check'
  | 'e2e.quick.empty'
  // Lesson Extraction (v0.10.0)
  | 'lesson.extract.start'
  | 'lesson.extract.end'
  | 'lesson.extract.empty'
  // Defect Events (v0.10.0)
  | 'defect.opened'
  | 'defect.resolved'
  // Self-Improve Engine (v0.10.0)
  | 'self-improve.start'
  | 'self-improve.end'
  | 'self-improve.phase.extract'
  | 'self-improve.phase.verify'
  | 'self-improve.phase.activate'
  | 'self-improve.phase.hooks'
  | 'self-improve.lesson.promoted'
  | 'self-improve.rule.activated'
  | 'self-improve.hook.generated'
  | 'self-improve.reset'
  | 'rule.hit'
  // AutoFix Engine (v0.37.0)
  | 'autofix.attempt'
  | 'autofix.complete'

export interface Event<TPayload = unknown> {
  id: EventId
  type: EventType
  timestamp: Timestamp
  sessionId: SessionId
  actor: Actor
  artifactId?: ArtifactId
  payload: TPayload
  causedBy?: EventId
  correlationId?: string
}

// ============================================================================
// 6. FSM 类型
// ============================================================================

export interface FSMDefinition<S extends string = string, A extends string = string> {
  type: ArtifactType
  states: readonly S[]
  initial: S
  terminal: readonly S[]
  transitions: ReadonlyArray<TransitionDef<S, A>>
}

export interface TransitionDef<S extends string, A extends string> {
  from: S
  action: A
  to: S
  guards?: Guard[]
  effects?: Effect[]
}

export interface Guard {
  name: string
  check: (artifact: Artifact, context: TransitionContext) => boolean | Promise<boolean>
  errorMessage: string
}

export interface Effect {
  name: string
  run: (artifact: Artifact, context: TransitionContext) => void | Promise<void>
}

export interface TransitionContext {
  actor: Actor
  reason?: string
  payload?: Record<string, unknown>
}

export interface TransitionResult {
  success: boolean
  artifact?: Artifact
  blockedBy?: GuardFailure[]
  effectsExecuted: string[]
}

export interface GuardFailure {
  guard: string
  message: string
}

// ============================================================================
// 7. Session 类型
// ============================================================================

export interface Session {
  id: SessionId
  agent: AgentPlatform | 'unknown'
  startedAt: Timestamp
  endedAt?: Timestamp
  activeRole?: string
  scenarioMode?: ScenarioMode
  metadata: Record<string, unknown>
}

// ============================================================================
// 8. Hook / Gate 类型
// ============================================================================

export interface ToolUseInput {
  sessionId: SessionId
  tool: string
  args: Record<string, unknown>
  timestamp?: Timestamp
}

export interface ToolResultInput {
  sessionId: SessionId
  tool: string
  args: Record<string, unknown>
  exitCode?: number
  output?: string
  duration?: number
  timestamp?: Timestamp
}

export interface StopInput {
  sessionId: SessionId
  aiOutput?: string
  projectType?: string
}

export interface GateDecision {
  allow: boolean
  reason?: string
  suggestion?: string
  injectContext?: string[]
}

export interface DetectorResult {
  triggered: boolean
  severity?: 'warn' | 'block' | 'deny'
  reason?: string
  suggestion?: string
}

// ============================================================================
// 9. KnowledgeBase 类型
// ============================================================================

export interface KnowledgeEntry {
  id: string
  type: LessonPayload['type']
  title: string
  tags: string[]
  contentRef: string                  // 内容文件路径
  embeddingId?: string                // Qdrant point id
  relevance: number                   // 0-1
  accessCount: number
  lastAccessed?: Timestamp
  verified: boolean
  verifiedBy?: string
  verifiedAt?: Timestamp
  createdAt: Timestamp
  sourceArtifact?: ArtifactId
}

export interface KnowledgeQuery {
  type?: LessonPayload['type'] | LessonPayload['type'][]
  tags?: string[]
  minRelevance?: number
  verifiedOnly?: boolean
  limit?: number
}

// ============================================================================
// 10. Role 类型
// ============================================================================

export interface RoleDefinition {
  name: string
  canCreateArtifacts: ArtifactType[]
  canModifyArtifacts?: Array<{ type: ArtifactType; statuses: string[] }>
  canReadArtifacts?: ArtifactType[]
  allowedTools: string[]
  deniedTools?: string[]
  requiresUpstream?: Array<{ type: ArtifactType; status?: string; allMatch?: string }>
  mustRunAfterEdit?: string[]
}

// ============================================================================
// 11. 错误类型
// ============================================================================

export class ScaleError extends Error {
  constructor(message: string, public code: string, public details?: unknown) {
    super(message)
    this.name = 'ScaleError'
  }
}

export class InvalidTransitionError extends ScaleError {
  constructor(from: string, action: string) {
    super(`State '${from}' does not support action '${action}'`, 'INVALID_TRANSITION', {
      from,
      action,
    })
  }
}

export class GuardFailedError extends ScaleError {
  constructor(public failures: GuardFailure[]) {
    super(`Transition blocked by guards: ${failures.map((f) => f.guard).join(', ')}`, 'GUARD_FAILED', {
      failures,
    })
  }
}

export class RoleDeniedError extends ScaleError {
  constructor(role: string, reason: string) {
    super(`Role '${role}' denied: ${reason}`, 'ROLE_DENIED', { role, reason })
  }
}

export class ArtifactNotFoundError extends ScaleError {
  constructor(id: string) {
    super(`Artifact '${id}' not found`, 'ARTIFACT_NOT_FOUND', { id })
  }
}

// ============================================================================
// 12. Scenario Mode 类型
// ============================================================================

/** 场景模式：控制检测器敏感度、上下文规则、权限级别 */
export type ScenarioMode = 'sandbox' | 'standard' | 'critical'

/** 场景模式配置 */
export interface ScenarioModeConfig {
  mode: ScenarioMode
  detectorSensitivity: 'low' | 'medium' | 'high'
  verificationRequired: boolean
  humanConfirmationRequired: boolean
  auditTrail: boolean
  maxRetries: number
}

/** 场景模式预设配置 */
export const SCENARIO_MODE_CONFIGS: Record<ScenarioMode, ScenarioModeConfig> = {
  sandbox: {
    mode: 'sandbox',
    detectorSensitivity: 'low',
    verificationRequired: false,
    humanConfirmationRequired: false,
    auditTrail: false,
    maxRetries: 10,
  },
  standard: {
    mode: 'standard',
    detectorSensitivity: 'medium',
    verificationRequired: true,
    humanConfirmationRequired: false,
    auditTrail: true,
    maxRetries: 5,
  },
  critical: {
    mode: 'critical',
    detectorSensitivity: 'high',
    verificationRequired: true,
    humanConfirmationRequired: true,
    auditTrail: true,
    maxRetries: 3,
  },
}

// ============================================================================
// 13. Skill Ecosystem 类型
// ============================================================================

/** Development phase for phase-based skill organization */
export type DevelopmentPhase =
  | 'DEFINE'
  | 'PLAN'
  | 'BUILD'
  | 'VERIFY'
  | 'REVIEW'
  | 'SHIP'
  | 'ANTI-PATTERNS'

/** Agent 平台类型 */
export type AgentPlatform =
  | 'claude-code'
  | 'codex'
  | 'opencode'
  | 'cursor'
  | 'gemini'
  | 'openclaw'
  | 'hermes'
  | 'trae'
  | 'workbuddy'
  | 'vsc'
  | 'qcoder'
  | 'qoder'
  | 'deepseek-tui'
  | 'aider'
  | 'windsurf'
  | 'kimi'
  | 'doubao'
  | 'kiro'
  | 'jcode'
  | 'cline'
  | 'kilocode'
  | 'antigravity'

/** Skill 引用 */
export interface SkillRef {
  id: string
  name: string
  description: string
  platform: AgentPlatform
  path: string
  enabled: boolean
  phase?: DevelopmentPhase
}

/** Skill 目录扫描结果 */
export interface SkillScanResult {
  platform: AgentPlatform
  skillsDir: string
  skills: SkillRef[]
  exists: boolean
}

// ============================================================================
// 14. Workflow Preset 类型
// ============================================================================

/** 工作流步骤 */
export interface WorkflowStep {
  stepId: string
  skillId?: string
  action: string
  verificationGate?: string
  isMandatory: boolean
  description?: string
}

/** 工作流预设 */
export interface WorkflowPreset {
  id: string
  name: string
  nameZh: string
  description: string
  steps: WorkflowStep[]
  scenarioMode: ScenarioMode
  requiredArtifacts: Array<{ type: ArtifactType; status?: string }>
}

/** Agent 类型扩展（支持所有 11 种 Agent） */
export type AgentType = AgentPlatform

// ============================================================================
// 15. Ubiquitous Language 类型（mattpocock/skills 风格）
// ============================================================================

/** 术语定义来源 */
export type TermSource = 'user-defined' | 'inferred-from-code' | 'extracted-from-docs'

/** 术语定义（CONTEXT.md 条目） */
export interface TermDefinition {
  term: string
  definition: string
  examples: string[]
  aliases: string[]
  lastUpdated: Timestamp
  source: TermSource
}

/** ADR 状态 */
export type ADRStatus = 'proposed' | 'accepted' | 'deprecated' | 'superseded'

/** ADR 记录（架构决策记录） */
export interface ADRRecord {
  id: string                    // ADR-001-title
  title: string
  status: ADRStatus
  context: string
  decision: string
  consequences: string
  alternatives?: string[]
  supersededBy?: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

/** ADR 状态变更事件 Payload */
export interface ADRStatusChangePayload {
  adrId: string
  previousStatus: ADRStatus
  newStatus: ADRStatus
  reason?: string
  supersededBy?: string
}

/** 术语歧义报告 */
export interface AmbiguityReport {
  term: string
  definitions: string[]
  sources: TermSource[]
  suggestedResolution?: string
}

// ============================================================================
// 16. Issue Triage 类型（mattpocock/skills 风格）
// ============================================================================

/** Issue 角色：bug 修复或新功能 */
export type IssueRole = 'bug' | 'enhancement'

/** Issue Triage 状态 */
export type IssueState =
  | 'needs-triage'      // 初始：等待评估
  | 'needs-info'        // 信息不足：等待补充
  | 'ready-for-agent'   // 已就绪：可交给 Agent 执行
  | 'ready-for-human'   // 需人工：复杂或高风险
  | 'in-progress'       // 执行中
  | 'blocked'           // 阻塞：等待依赖
  | 'completed'         // 完成
  | 'wontfix'           // 拒绝：不处理

/** Issue Triage 状态流转 */
export interface IssueTriageTransition {
  from: IssueState
  to: IssueState
  condition: string                 // 流转条件描述
  auto?: boolean                    // 是否可自动流转
  agentAction?: string              // Agent 可执行的动作
}

/** Issue Triage 评估结果 */
export interface TriageResult {
  state: IssueState
  action?: string
  reason?: string
}

/** Issue 输入 */
export interface IssueInput {
  title: string
  description: string
  type?: IssueRole
  complexity?: number               // 0-1 复杂度估算
  riskLevel?: 'low' | 'medium' | 'high'
  filesInvolved?: string[]
  dependsOn?: ArtifactId[]
}

