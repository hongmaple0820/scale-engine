// SCALE Engine — Agent System Types (v0.8.0)
// 多 Agent 协作系统核心类型定义

import type { ArtifactId, Timestamp, Actor, AgentPlatform } from '../artifact/types.js'

// ============================================================================
// 1. Agent Domain & Profile Types
// ============================================================================

/** Agent 专业领域 */
export type AgentDomain =
  | 'frontend'      // UI/UX, React/Vue, CSS, Animation
  | 'backend'       // API, Database, Auth, Performance
  | 'testing'       // TDD, E2E, Coverage, Mocking
  | 'ui-design'     // Visual Design, Accessibility, UX
  | 'operations'    // Deploy, CI/CD, Monitoring, Infra
  | 'product'       // Requirements, User Story, Analytics
  | 'code-review'   // Quality, Security, Patterns, Best Practices
  | 'security'      // OWASP, Auth, Crypto, Compliance
  | 'documentation' // Docs, API Reference, Tutorials
  | 'planning'      // Architecture, Design, Estimation
  | 'exploration'   // Codebase Search, Knowledge Graph
  | 'database'      // Migrations, Schema Design, Query Optimization
  | 'performance'   // Profiling, Benchmarking, Optimization
  | 'architecture'  // System Design, Scalability, Patterns

/** 模型层级偏好 */
export type ModelTier = 'fast' | 'balanced' | 'powerful'

/** 输出规范 */
export interface OutputSpec {
  fileTypes: string[]           // ['.tsx', '.css']
  style: string                 // 'component-based' | 'layered-architecture'
}

/** 协作偏好 */
export interface CollaborationSpec {
  reportsTo?: string            // 上游 Agent ID
  sharesWith: string[]          // 共享输出的 Agent IDs
}

// ============================================================================
// Agent Persona Types (v0.10.0 — inspired by agency-agents-zh)
// ============================================================================

/** Agent 人设定义 */
export interface AgentIdentity {
  role: string                  // 角色定位：'前端开发专家'
  personality: string           // 性格特征：'注重细节、关注性能'
  memory: string                // 记住什么：'成功的 UI 模式、性能优化技术'
  experience: string            // 见过什么：'因出色 UX 成功的应用'
}

/** Agent 核心使命 */
export interface AgentMission {
  name: string                  // 使命名称
  description: string           // 详细描述
  priority: 'critical' | 'high' | 'normal'  // 优先级
}

/** Agent 关键规则 */
export interface AgentRule {
  name: string                  // 规则名称
  description: string           // 规则描述
  enforcement: 'block' | 'warn' | 'suggest'  // 强制级别
}

/** Agent 交付物模板 */
export interface AgentDeliverable {
  name: string                  // 交付物名称
  template: string              // 模板内容（可含 Markdown）
  format: 'markdown' | 'code' | 'json' | 'yaml'
}

/** Agent 工作流程步骤 */
export interface AgentWorkflowStep {
  stepId: string                // 步骤 ID
  name: string                  // 步骤名称
  description: string           // 步骤描述
  outputs?: string[]            // 该步骤的输出
}

/** Agent 成功指标 */
export interface AgentSuccessMetric {
  name: string                  // 指标名称
  target: string                // 目标值（可以是数字或描述）
  measurement: string           // 如何测量
}

/** Agent Profile：专业 Agent 定义 (v0.10.0 增强) */
export interface AgentProfile {
  // ========== 基础标识 ==========
  id: string                    // 'frontend-agent' | 'backend-agent'
  name: string                  // 'Frontend Developer'
  description: string           // 简短描述
  domain: AgentDomain           // 专业领域

  // ========== 视觉标识（新增）==========
  emoji?: string                // '💻' 视觉标识
  color?: string                // '#FF2442' 主题色

  // ========== 人设定义（新增）==========
  identity?: AgentIdentity      // 身份、性格、记忆、经验

  // ========== 核心使命（新增）==========
  missions?: AgentMission[]     // 具体职责列表

  // ========== 关键规则（新增）==========
  rules?: AgentRule[]           // 必须遵守的约束

  // ========== 技术能力 ==========
  inheritsRole: string          // 继承的现有 Role（权限）
  capabilities: string[]        // 专业能力标签
  preferredModel: ModelTier     // 模型偏好

  // ========== 输出规范 ==========
  outputFormat?: OutputSpec     // 输出文件类型和风格
  deliverables?: AgentDeliverable[]  // 交付物模板（新增）

  // ========== 工作流程（新增）==========
  workflow?: AgentWorkflowStep[]  // SOP 步骤化流程

  // ========== 成功指标（新增）==========
  successMetrics?: AgentSuccessMetric[]  // 量化目标

  // ========== 协作偏好 ==========
  collaboration?: CollaborationSpec  // 协作关系

  // ========== 证据纪律（P1.3）==========
  systemPromptAddendum?: string  // 附加到 system prompt 的证据对齐段（默认继承 EVIDENCE_DISCIPLINE_PROMPT）
}

// ============================================================================
// 2. Agent Runtime & Status Types
// ============================================================================

/** Agent 实例状态 */
export type AgentStatus =
  | 'idle'       // 空闲，可分配任务
  | 'running'    // 执行中
  | 'blocked'    // 等待依赖
  | 'completed'  // 已完成
  | 'failed'     // 失败
  | 'recycled'   // 已回收

/** 消息类型 */
export type MessageType =
  | 'task-request'      // 请求任务
  | 'task-complete'     // 任务完成
  | 'task-fail'         // 任务失败
  | 'dependency-block'  // 依赖阻塞
  | 'dependency-resolve'// 依赖解决
  | 'output-share'      // 输出共享
  | 'review-request'    // 审核请求
  | 'review-result'     // 审核结果
  | 'help-request'      // 求助
  | 'status-update'     // 状态更新

/** Agent 消息 */
export interface AgentMessage {
  id: string                    // 消息 ID
  from: string                  // 发送者 Agent ID
  to: string | 'broadcast'      // 接收者 Agent ID 或广播
  type: MessageType             // 消息类型
  payload: unknown              // 消息内容
  timestamp: Timestamp          // 发送时间
}

/** Agent 实例运行时 */
export interface AgentRuntime {
  id: string                    // 实例 ID: 'AGENT-{profile}-{seq}'
  profile: AgentProfile         // 关联的 Profile
  status: AgentStatus           // 运行状态
  assignedTask?: ArtifactId     // 当前任务
  model: ModelConfig            // 实际使用的模型
  startedAt: Timestamp          // 启动时间
  completedAt?: Timestamp       // 完成时间
  outputArtifacts: ArtifactId[] // 输出产物
  messages: AgentMessage[]      // 发送/接收的消息
  blockedBy?: string[]          // 阻塞依赖
  retryCount: number            // 重试次数
  error?: string                // 错误信息（失败时）
}

/** 模型配置 */
export interface ModelConfig {
  provider: AgentPlatform | 'anthropic' | 'openai' | 'google'
  modelId: string               // 'claude-sonnet-4' | 'gpt-4o'
  tier: ModelTier
}

// ============================================================================
// 3. Agent Team Types
// ============================================================================

/** Agent 团队 */
export interface AgentTeam {
  id: string                    // 'TEAM-{timestamp}'
  agents: AgentRuntime[]        // 团队成员
  leader: AgentRuntime          // 团队 Leader
  startedAt: Timestamp          // 创建时间
  completedAt?: Timestamp       // 完成时间
  dissolvedAt?: Timestamp       // 解散时间
  taskId?: ArtifactId           // 关联的任务 ID
  scenarioMode?: 'sandbox' | 'standard' | 'critical'
}

/** 团队执行结果 */
export interface TeamExecutionResult {
  teamId: string
  success: boolean
  outputArtifacts: ArtifactId[]
  duration: number              // 执行时长（ms）
  agentResults: Map<string, AgentResult>
}

/** 单个 Agent 执行结果 */
export interface AgentResult {
  agentId: string
  status: AgentStatus
  outputArtifacts: ArtifactId[]
  duration: number
  retryCount: number
}

/** Agent 执行结果（兼容旧版） */
export interface AgentExecutionResult {
  agentId: string
  success: boolean
  outputArtifacts: ArtifactId[]
  duration: number
  error?: string
}

/** 团队配置 */
export interface TeamConfig {
  profiles: string[]            // 需要的 Agent Profiles
  parallelism: number           // 并行度（最多同时运行的 Agent 数）
  timeout?: number              // 总超时（ms）
  onConflict: 'abort' | 'retry' | 'skip' // 冲突处理策略
  scenarioMode?: 'sandbox' | 'standard' | 'critical'
}

// ============================================================================
// 4. Agent Dispatcher Types
// ============================================================================

/** 任务依赖解析结果 */
export interface DependencyResolution {
  taskId: ArtifactId
  blockedBy: ArtifactId[]       // 阻塞的任务 IDs
  ready: boolean                // 是否可执行
}

/** 任务分组（按依赖关系） */
export interface TaskGroups {
  independent: ArtifactId[]     // 无依赖，可并行
  dependent: DependentTask[]    // 有依赖，需串行
}

/** 有依赖的任务 */
export interface DependentTask {
  taskId: ArtifactId
  dependencies: ArtifactId[]    // 依赖的任务 IDs
}

/** 任务 → Profile 映射 */
export type TaskProfileMap = Record<string, string[]>

// ============================================================================
// 5. Progress & Monitoring Types
// ============================================================================

/** 进度报告 */
export interface ProgressReport {
  teamId: string
  taskId?: ArtifactId           // 关联的任务 ID
  total: number                 // 总任务数
  completed: number             // 已完成
  running: number               // 运行中
  blocked: number               // 阻塞中
  failed: number                // 失败
  idle: number                  // 空闲
  agents: AgentStatusReport[]   // 各 Agent 状态
}

/** Agent 状态报告 */
export interface AgentStatusReport {
  agentId: string
  profileId: string
  status: AgentStatus
  task?: ArtifactId
  duration: number              // 已运行时长（ms）
}

// ============================================================================
// 6. YAML Workflow Types (v0.10.0 — DAG-based Orchestration)
// ============================================================================

/** LLM Provider 配置 */
export type WorkflowLLMProvider =
  | 'claude-code'    // Claude Code CLI（无需 API key）
  | 'gemini-cli'     // Gemini CLI（免费 1000 次/天）
  | 'copilot-cli'    // GitHub Copilot CLI
  | 'codex-cli'      // OpenAI Codex CLI
  | 'deepseek'       // DeepSeek API
  | 'anthropic'      // Anthropic API
  | 'openai'         // OpenAI API
  | 'ollama'         // 本地 Ollama

/** LLM 配置 */
export interface WorkflowLLMConfig {
  provider: WorkflowLLMProvider
  model?: string                // 'deepseek-chat' | 'claude-sonnet-4'
  apiKey?: string               // API key（provider 为 API 类型时需要）
  baseUrl?: string              // 自定义 endpoint
}

/** Workflow 输入参数 */
export interface WorkflowInput {
  name: string                  // 参数名
  required?: boolean            // 是否必须
  default?: string              // 默认值
  description?: string          // 参数描述
}

/** Workflow 步骤 */
export interface WorkflowStepDef {
  id: string                    // 步骤 ID（用于 depends_on）
  role: string                  // Agent Profile ID：'engineering/frontend-agent'
  task: string                  // 任务描述（可含 {{变量}}）
  output?: string               // 输出变量名（供后续步骤引用）
  depends_on?: string[]         // 依赖的步骤 IDs（空则可并行）
  retry?: number                // 重试次数
  timeout?: number              // 超时（秒）
}

/** YAML Workflow 定义 */
export interface WorkflowDefinition {
  name: string                  // 工作流名称
  description?: string          // 工作流描述
  version?: string              // 版本号
  agents_dir?: string           // Agent 角色库目录

  // LLM 配置
  llm: WorkflowLLMConfig

  // 并发配置
  concurrency?: number          // 最大并行步骤数（默认 3）

  // 输入参数
  inputs?: WorkflowInput[]

  // 步骤列表
  steps: WorkflowStepDef[]

  // 输出配置
  output_dir?: string           // 输出目录（默认 'ao-output'）
}

/** DAG 节点（用于执行图） */
export interface DAGNode {
  stepId: string
  step: WorkflowStepDef
  dependencies: string[]        // 前置步骤 IDs
  dependents: string[]          // 后续步骤 IDs
  level: number                 // DAG 层级（0 = 无依赖，可立即执行）
}

/** DAG 执行图 */
export interface DAGExecutionGraph {
  nodes: Map<string, DAGNode>
  levels: DAGNode[][]           // 按层级分组（同层可并行）
  maxLevel: number              // 最大层级数
}

/** 步骤执行结果 */
export interface WorkflowStepResult {
  stepId: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  output?: string               // 步骤输出内容
  duration?: number             // 执行时长（ms）
  retryCount?: number           // 重试次数
  error?: string                // 错误信息
  agentId?: string              // 执行的 Agent ID
}

/** Workflow 执行结果 */
export interface WorkflowExecutionResult {
  workflowName: string
  success: boolean
  totalSteps: number
  completedSteps: number
  failedSteps: number
  duration: number              // 总时长（ms）
  stepResults: Map<string, WorkflowStepResult>
  outputs: Record<string, string>  // 所有输出变量
  executionLog: string[]        // 执行日志
}
