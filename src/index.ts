// SCALE Engine v0.7.0 — Public API
// S · C · A · L · E: Scaffold · Control · Artifact · Learn · Evolve

// Core types
export * from './artifact/types.js'

// FSM
export { FSM, SpecFSM } from './artifact/fsm.js'

// FSM Agent Bridge (v0.7.0)
export { FSMAgentBridge } from './fsm/FSMAgentBridge.js'
export type { IFSMAgentBridge, FSMContextSnapshot } from './fsm/FSMAgentBridge.js'

// Artifact Store
export { InMemoryArtifactStore } from './artifact/store.js'
export type { IArtifactStore } from './artifact/store.js'

// Core Infrastructure
export { EventBus } from './core/eventBus.js'
export type { IEventBus } from './core/eventBus.js'
export { Container, container, createToken } from './core/container.js'
export { logger } from './core/logger.js'

// Task Engine
export { TaskEngine } from './tasks/TaskEngine.js'

// Knowledge Base
export { KnowledgeBase } from './knowledge/KnowledgeBase.js'
export { SQLiteKnowledgeBase } from './knowledge/SQLiteKnowledgeBase.js'
export { GraphifyKnowledgeBase } from './knowledge/GraphifyKnowledgeBase.js'
export { CerebrumManager } from './knowledge/CerebrumManager.js'
export type { CerebrumEntry, CerebrumHit } from './knowledge/CerebrumManager.js'
export type { IKnowledgeBase } from './knowledge/KnowledgeBase.js'

// Ubiquitous Language (mattpocock/skills style)
export { UbiquitousLanguageManager, createUbiquitousLanguageManager } from './knowledge/UbiquitousLanguageManager.js'
export type { IUbiquitousLanguageManager } from './knowledge/UbiquitousLanguageManager.js'

// Evolution
export { BehaviorTracker } from './evolution/BehaviorTracker.js'
export type { IBehaviorTracker, SessionMetrics, AutoEvolveConfig } from './evolution/BehaviorTracker.js'
export { LessonExtractor, RuleProposer, HookGenerator, EvolutionEngine } from './evolution/EvolutionEngine.js'
export { LessonValidator } from './evolution/LessonValidator.js'
export type { ILessonValidator, ValidationResult, GateResult } from './evolution/LessonValidator.js'
export { EvolutionEvaluator } from './evolution/EvolutionEvaluator.js'
export type { IEvolutionEvaluator, EvolutionMetrics, EvolutionSnapshot } from './evolution/EvolutionEvaluator.js'
export { AutoDefectCreator } from './evolution/AutoDefectCreator.js'
export type { IAutoDefectCreator, DefectPayload } from './evolution/AutoDefectCreator.js'
export * from './evolution/RuleMaturity.js'

// Skills System (v0.7.0)
export { SkillRegistry } from './skills/SkillRegistry.js'
export type { ISkillRegistry, SkillDefinition, SkillRecommendation } from './skills/SkillRegistry.js'
export { TriggerEngine } from './skills/TriggerEngine.js'
export { SkillExecutor } from './skills/SkillExecutor.js'
export type { ISkillExecutor } from './skills/SkillExecutor.js'
export { SkillDiscovery } from './skills/SkillDiscovery.js'
export * from './skills/SkillRepository.js'
export * from './prompts/PromptOptimizer.js'
export * from './prompts/VibeTemplateGallery.js'
export * from './agents/LeadershipPresets.js'

// Hooks System (v0.7.0)
export { HookGeneratorEnhanced, HookDeployer } from './hooks/index.js'
export type { HookTemplate, EnhancedHook, IHookGeneratorEnhanced, DeploymentResult, DeploymentStatus, IHookDeployer } from './hooks/index.js'

// Workflows (v0.7.0)
export { WorkflowExecutor } from './workflows/WorkflowExecutor.js'
export type { IWorkflowExecutor, WorkflowSession } from './workflows/WorkflowExecutor.js'
export { GateParser } from './workflows/GateParser.js'
export type { IGateParser, GateExpression } from './workflows/GateParser.js'

// Guardrails
export { Gateway } from './guardrails/Gateway.js'
export { ROLES, getRole, listRoles } from './guardrails/roles.js'
export {
  BruteRetryDetector, IdleToolDetector, BusyLoopDetector,
  PrematureDoneDetector, BlameShiftDetector,
} from './guardrails/detectors.js'
export {
  DangerousCommandDetector, SecretLeakDetector, RoleGateDetector, ScopeCreepDetector,
  BUILT_IN_ROLES,
} from './guardrails/advancedDetectors.js'
export * from './guardrails/DependencyAuditor.js'
export * from './guardrails/ActiveRedTeam.js'
export {
  DetectorStatisticsTracker,
  DetectorRegistry,
  AISlopDetector,
  HallucinationDetector,
  DuplicateEditDetector,
  EnhancedGatewayContext,
  ALL_ENHANCED_DETECTORS,
} from './guardrails/DetectorEnhanced.js'
export type {
  IDetectorStatisticsTracker,
  DetectorTriggerRecord,
  DetectorStatistics,
  DetectorConfig,
  IDetectorRegistry,
  IEnhancedGateway,
} from './guardrails/DetectorEnhanced.js'

// Context
export { ContextBuilder } from './context/ContextBuilder.js'
export * from './context/ContextCompiler.js'
export { ProjectAnatomy } from './context/ProjectAnatomy.js'
export type { AnatomyEntry } from './context/ProjectAnatomy.js'

// Orchestration
export { wireEffects } from './orchestration/EffectsWiring.js'

// Tool Orchestration Governance
export * from './tools/index.js'
export * from './workflow/WorkflowGuidance.js'
export * from './workflow/WorkflowOpenTasks.js'

// Runtime Evidence Governance
export * from './runtime/index.js'

// Memory Fabric Context Packs
export * from './memory/index.js'

// Routing
export { ModelRouter, DEFAULT_MODELS } from './routing/ModelRouter.js'
export { PromptCachePolicy, resolvePromptCachePolicy, shouldCacheContextCategory } from './routing/PromptCachePolicy.js'
export type { PromptCachePolicyInput, PromptCachePolicyOptions, PromptCachePolicyResult, PromptCacheCandidate, PromptCacheProvider } from './routing/PromptCachePolicy.js'

// Adapters
export {
  ClaudeCodeAdapter,
  CodexAdapter,
  OpenCodeAdapter,
  CursorAdapter,
  GeminiAdapter,
  OpenClawAdapter,
  HermesAdapter,
  TraeAdapter,
  WorkBuddyAdapter,
  VSCAdapter,
  QCoderAdapter,
  DeepSeekTuiAdapter,
  AiderAdapter,
  WindsurfAdapter,
  KimiAdapter,
  DoubaoAdapter,
  KiroAdapter,
  QoderAdapter,
  JCodeAdapter,
  ClineAdapter,
  KiloCodeAdapter,
  AntigravityAdapter,
  createAdapter,
  SUPPORTED_AGENTS,
} from './adapters/index.js'
export type { IAgentAdapter, AdapterConfig, InitResult, SettingsJson, HookEntry } from './adapters/ClaudeCodeAdapter.js'

// Out-of-Scope Knowledge Base
export { OutOfScopeStore } from './workflow/OutOfScopeStore.js'
export type { OutOfScopeEntry } from './workflow/OutOfScopeStore.js'

// Workflow Presets
export {
  WORKFLOW_PRESETS,
  getWorkflowPreset,
  listWorkflowPresets,
  getPresetsByScenario,
  BASIC_DEV,
  TDD_DEV,
  BUG_FIX,
  SDD,
  CODE_REVIEW,
  SECURITY_AUDIT,
  RALPH_LOOP,
  RAPID_PROTO,
  MASSIVE_REFACTOR,
  PARALLEL_EXEC,
} from './workflows/presets.js'

// Agents (Phase 1)
export {
  AgentManager,
  initializeAgentManager,
  registerAllAgents,
  ALL_AGENTS,
  AGENT_MANAGER_TOKEN,
} from './agents/index.js'
export type {
  IAgentManager,
  IAgent,
  AgentDefinition,
  AgentTaskContext,
  AgentResult,
  AgentCapability,
} from './agents/index.js'

// Evolution Positive Learning (Phase 4)
export { PatternExtractor } from './evolution/PatternExtractor.js'
export type { Pattern, PatternStep, IPatternExtractor } from './evolution/PatternExtractor.js'
export { SkillCreator } from './evolution/SkillCreator.js'
export type { SkillProposal, SkillStep, ISkillCreator, SkillExample, SkillCriteria, SkillCandidate } from './evolution/SkillCreator.js'

// Grilling Session (Phase 11 - mattpoclock/skills style)
export { GrillingSessionManager } from './skills/GrillingSessionSkill.js'
export type { GrillingSession, GrillingQuestion, GrillingOption, GrillingConclusion } from './skills/GrillingSessionSkill.js'
export { REQUIREMENT_CLARITY_TREE, DESIGN_DEPTH_TREE, TECH_SELECTION_TREE } from './skills/GrillingTemplates.js'
export * from './workflow/ContextGovernance.js'
export * from './workflow/DiagnosticLoop.js'
export * from './workflow/TddLoop.js'
export * from './workflow/gates/VisualGate.js'

// Issue Triage FSM (Phase 12 - mattpoclock/skills style)
export { IssueTriageFSM, ISSUE_TRIAGE_MACHINE } from './tasks/IssueTriageFSM.js'
export type { IssueRole, IssueState, IssueTriageTransition, TriageResult } from './tasks/IssueTriageFSM.js'

// Caveman Compressor (Phase 13 - mattpoclock/skills style)
export { CavemanCompressor } from './context/CavemanCompressor.js'
export type { CavemanConfig } from './context/CavemanCompressor.js'
export { DEFAULT_SYMBOL_MAP, DEFAULT_PRESERVE_TERMS } from './context/CavemanCompressor.js'

// Anti-Pattern Registry (andrej-karpathy-skills style)
export { AntiPatternRegistry, createAntiPatternRegistry } from './context/AntiPatternRegistry.js'
export type { AntiPattern, AntiPatternMatch, IAntiPatternRegistry } from './context/AntiPatternRegistry.js'

// Dashboard 2.0
export { DashboardServer } from './dashboard/DashboardServer.js'
export type { DashboardOptions, DashboardState, ArtifactTreeNode, GateSummary, DetectorStatSummary, RecentEvent, AutoDefectSummary, RecentDefect } from './dashboard/DashboardServer.js'

// API
export { Doctor } from './api/doctor.js'
export { ScaleMCPServer } from './api/mcp.js'

// Output (HTML Document Rendering)
export { HTMLDocumentRenderer } from './output/HTMLDocumentRenderer.js'
export type { HTMLRenderOptions, OutputFormat, ThemeMode, DocLang, SpecData, PlanData, ReviewData, ReportData } from './output/HTMLDocumentRenderer.js'
export { BrandThemeLoader } from './output/BrandThemeLoader.js'
export type { BrandTheme, BrandColors, BrandTypography, BrandSpacing, BrandShadows } from './output/BrandThemeLoader.js'
export { UIPrototypeRenderer } from './output/UIPrototypeRenderer.js'
export type { PageSpec, ComponentSpec, NavItem, DashboardLayout, DashboardWidget, UIPrototypeOptions } from './output/UIPrototypeRenderer.js'
