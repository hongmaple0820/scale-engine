// SCALE Engine — Workflow Types
// 核心工作流类型定义

export type GateStage = 'G0' | 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6' | 'G7' | 'G8' | 'G9' | 'G10' | 'G11' | 'G12' | 'G13' | 'G14' | 'G15' | 'G16' | 'G17' | 'G18' | 'G19' | 'G20' | 'G21' | 'G22' | 'G23'
export type GateStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'BLOCKED'
export type ModelTier = 'LOW' | 'MEDIUM' | 'HIGH'
export type Verdict = 'APPROVE' | 'ITERATE' | 'REJECT'

export interface GateEvidence {
  id: string
  kind: 'file' | 'command' | 'manual' | 'scan'
  label: string
  passed: boolean
  detail: string
  command?: string
  exitCode?: number
  path?: string
  durationMs?: number
  cwd?: string
  startedAt?: number
  endedAt?: number
  stdoutTail?: string
  stderrTail?: string
  outputHash?: string
  rawEstimatedTokens?: number
  compressedEstimatedTokens?: number
  savedEstimatedTokens?: number
  compressionRatio?: number
  commandRunEvidenceId?: string
  source?: string
}

export interface GateResult {
  gate: GateStage
  status: GateStatus
  passed: boolean
  evidence: string
  evidenceItems?: GateEvidence[]
  evidenceRecordId?: string
  blockers: string[]
  durationMs: number
}

export interface AmbiguityDimensions {
  goalClarity: number
  inputOutputBoundary: number
  techStackConstraints: number
  timeConstraints: number
  qualityStandards: number
  riskBoundaries: number
  acceptanceCriteria: number
}

export interface AmbiguityScoreResult {
  totalScore: number
  dimensions: AmbiguityDimensions
  threshold: number
  shouldProceed: boolean
  requiresQuestioning: boolean
  blocked: boolean
}

export interface RALPLANOutput {
  principles: string[]
  decisionDrivers: string[]
  viableOptions: ViableOption[]
  preMortem: PreMortemAnalysis
  verdict: Verdict
  iterationCount: number
}

export interface ViableOption {
  name: string
  description: string
  pros: string[]
  cons: string[]
  selected: boolean
}

export interface PreMortemAnalysis {
  assumedFailure: string
  rootCauses: string[]
  mitigations: string[]
}

export interface UserStory {
  id: string
  title: string
  description: string
  acceptanceCriteria: string[]
  passes: boolean
  verificationResults: VerificationResult[]
}

export interface VerificationResult {
  criterion: string
  passed: boolean
  evidence: string
}

export interface PRDDocument {
  id: string
  title: string
  userStories: UserStory[]
  allStoriesPassed: boolean
  deslopPassed: boolean
  iterations: number
}

export interface DeliveryReport {
  completed: string[]
  verified: VerificationResult[]
  unverified: string[]
  blockers: string[]
  recommendations: string[]
}

export interface KarpathyCheck {
  principle: 'K1' | 'K2' | 'K3' | 'K4'
  description: string
  passed: boolean
  violation?: string
}

export interface TaskDefinition {
  id: string
  description: string
  tier: ModelTier
  dependencies: string[]
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  assignedAgent?: string
}

export interface ConsensusRound {
  round: number
  plannerOutput: string
  architectReview: string
  criticReview: string
  verdict: Verdict
}

// Socratic Questioning Types
export type SocraticCategory = 'goal' | 'constraint' | 'acceptance' | 'context' | 'risk' | 'priority'

export interface SocraticQuestion {
  id: string
  category: SocraticCategory
  question: string
  followUps: string[]
  answered: boolean
  answer?: string
  clarityScore: number  // 0-1, 回答后重新评分
}

export interface SocraticSession {
  sessionId: string
  requirement: string
  initialAmbiguity: AmbiguityScoreResult
  questions: SocraticQuestion[]
  currentRound: number
  maxRounds: number
  status: 'in_progress' | 'refined' | 'blocked'
  finalAmbiguity?: AmbiguityScoreResult
  refinementHistory: RefinementRound[]
}

export interface RefinementRound {
  round: number
  questionsAsked: string[]
  answersReceived: string[]
  ambiguityBefore: number
  ambiguityAfter: number
}
