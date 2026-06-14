import { PROFESSIONAL_AGENTS } from '../agents/profiles.js'
import type { AgentProfile, ModelTier } from '../agents/types.js'
import type { ProgressiveGovernanceReport } from '../governance/ProgressiveGovernance.js'
import type { SkillPlan, SkillTaskLevel } from '../skills/routing/index.js'
import type { WorkflowProfile } from './AdaptiveWorkflowRouter.js'

export type AgentCollaborationMode = 'single-agent' | 'multi-agent' | 'review-escalated'
export type AgentCollaborationResponsibility = 'orchestrator' | 'planner' | 'implementer' | 'specialist' | 'verifier' | 'reviewer' | 'releaser'

export interface AgentCollaborationRole {
  profileId: string
  name: string
  domain: string
  responsibility: AgentCollaborationResponsibility
  required: boolean
  reason: string
  capabilities: string[]
  preferredModel: ModelTier
  budgetTokens: number
  evidence: string[]
}

export interface AgentCollaborationEdge {
  from: string
  to: string
  type: 'handoff' | 'review' | 'sync' | 'escalation'
  reason: string
}

export interface AgentCollaborationHandoff {
  from: string
  to: string
  artifact: string
  evidence: string[]
  exitCriteria: string[]
}

export interface AgentCollaborationReviewGate {
  id: string
  owner: string
  required: boolean
  reason: string
  evidence: string[]
}

export interface AgentCollaborationPlan {
  strategy: 'agent-collaboration-v1'
  mode: AgentCollaborationMode
  roles: AgentCollaborationRole[]
  edges: AgentCollaborationEdge[]
  handoffs: AgentCollaborationHandoff[]
  reviewGates: AgentCollaborationReviewGate[]
  budget: {
    totalTokens: number
    assignedTokens: number
    reserveTokens: number
    perRole: Array<{ profileId: string; tokens: number }>
  }
  summary: {
    totalRoles: number
    requiredRoles: number
    reviewerRoles: number
    handoffCount: number
    reviewGateCount: number
    estimatedCostUnits: number
    multiAgentRecommended: boolean
    reviewEscalated: boolean
  }
  recommendations: string[]
}

export interface AgentCollaborationPlannerInput {
  task: string
  level: SkillTaskLevel
  files: string[]
  services: string[]
  budget: number
  governance: ProgressiveGovernanceReport
  workflowProfile: WorkflowProfile
  evaluator: {
    required: boolean
    riskLevel: 'low' | 'medium' | 'high'
    uncertainty: { score: number; drivers: string[] }
    gates: Array<{ id: string; required: boolean; reason: string; evidence: string[] }>
  }
  skillPlan: SkillPlan
  toolStrategy: {
    nodes: Array<{
      id: string
      required: boolean
      cost: { units: number; timeRisk: 'low' | 'medium' | 'high'; sideEffectRisk: 'low' | 'medium' | 'high' }
      evidence: string[]
    }>
    summary: { estimatedCostUnits: number; highRiskSteps: number; totalSteps: number }
  }
}

interface RoleDraft {
  profileId: string
  responsibility: AgentCollaborationResponsibility
  required: boolean
  reason: string
  evidence: string[]
}

const PROFILE_BY_ID = new Map(PROFESSIONAL_AGENTS.map(profile => [profile.id, profile]))

const DOMAIN_TO_PROFILE: Record<string, string[]> = {
  ui: ['ui-design-agent', 'frontend-agent', 'test-agent'],
  browserAutomation: ['test-agent', 'frontend-agent'],
  e2e: ['test-agent', 'frontend-agent'],
  api: ['backend-agent', 'test-agent'],
  db: ['database-agent', 'backend-agent', 'security-agent'],
  security: ['security-agent', 'code-review-agent'],
  docs: ['docs-agent'],
  resourceGovernance: ['docs-agent', 'ops-agent'],
  engineeringStandards: ['architect-agent', 'code-review-agent', 'security-agent'],
  review: ['code-review-agent'],
  release: ['ops-agent', 'code-review-agent', 'test-agent'],
  webResearch: ['product-agent', 'docs-agent'],
  externalCli: ['ops-agent', 'code-review-agent'],
  desktopAutomation: ['test-agent', 'security-agent'],
  skillDiscovery: ['architect-agent', 'docs-agent'],
  fullstackPrototype: ['product-agent', 'architect-agent', 'frontend-agent', 'backend-agent', 'test-agent'],
}

export function createAgentCollaborationPlan(input: AgentCollaborationPlannerInput): AgentCollaborationPlan {
  const drafts = new Map<string, RoleDraft>()
  const haystack = [
    input.task,
    ...input.files,
    ...input.services,
    ...input.skillPlan.requiredSkills,
    ...input.skillPlan.recommendedSkills,
    ...input.skillPlan.requiredArtifacts,
    ...input.skillPlan.requiredVerification,
    ...input.skillPlan.intents.map(intent => intent.domain),
    ...input.evaluator.gates.map(gate => gate.id),
  ].join(' ').toLowerCase()

  const addRole = (
    profileId: string,
    responsibility: AgentCollaborationResponsibility,
    required: boolean,
    reason: string,
    evidence: string[] = [],
  ) => {
    if (!PROFILE_BY_ID.has(profileId)) return
    const existing = drafts.get(profileId)
    if (!existing) {
      drafts.set(profileId, { profileId, responsibility, required, reason, evidence: compact(evidence) })
      return
    }
    drafts.set(profileId, {
      profileId,
      responsibility: mergeResponsibility(existing.responsibility, responsibility),
      required: existing.required || required,
      reason: mergeReason(existing.reason, reason),
      evidence: compact([...existing.evidence, ...evidence]),
    })
  }

  addRole('architect-agent', 'orchestrator', true, 'Owns the machine-readable collaboration plan, role DAG, handoff contracts, and risk-based escalation.', ['agent-collaboration.strategy'])

  for (const intent of input.skillPlan.intents) {
    for (const profileId of DOMAIN_TO_PROFILE[intent.domain] ?? []) {
      addRole(
        profileId,
        responsibilityForProfile(profileId),
        intent.score >= 0.75 || input.level === 'L' || input.level === 'CRITICAL',
        `Detected ${intent.domain} intent (${intent.score}).`,
        intent.reasons,
      )
    }
  }

  if (/(product|requirement|prd|roadmap|user story|需求|产品|用户故事)/i.test(haystack)) {
    addRole('product-agent', 'planner', true, 'Product or requirement language needs explicit scope and success criteria.', matching(input.task, /product|requirement|prd|roadmap|user story|需求|产品|用户故事/i))
  }
  if (/(ui|ux|frontend|component|vue|react|css|prototype|figma|页面|界面|交互|视觉)/i.test(haystack)) {
    addRole('ui-design-agent', 'planner', true, 'UI work needs design direction and interaction review.', matching(haystack, /ui|ux|frontend|component|vue|react|css|prototype|figma|页面|界面|交互|视觉/i))
    addRole('frontend-agent', 'implementer', true, 'Frontend implementation surface detected.', matching(haystack, /frontend|component|vue|react|css|页面|前端/i))
  }
  if (/(api|backend|route|controller|server|service|node|handler|接口|后端)/i.test(haystack)) {
    addRole('backend-agent', 'implementer', true, 'Backend or API surface detected.', matching(haystack, /api|backend|route|controller|server|service|handler|接口|后端/i))
  }
  if (/(database|migration|schema|sql|db|数据|迁移)/i.test(haystack)) {
    addRole('database-agent', 'specialist', true, 'Database or migration surface detected.', matching(haystack, /database|migration|schema|sql|db|数据|迁移/i))
  }
  if (/(security|auth|permission|token|secret|rbac|tenant|安全|权限|鉴权|租户)/i.test(haystack)) {
    addRole('security-agent', 'reviewer', true, 'Security-sensitive terms or files require specialist review.', matching(haystack, /security|auth|permission|token|secret|rbac|tenant|安全|权限|鉴权|租户/i))
  }
  if (/(test|vitest|playwright|e2e|coverage|verify|验证|测试)/i.test(haystack)) {
    addRole('test-agent', 'verifier', true, 'Testing or verification evidence is part of the task.', matching(haystack, /test|vitest|playwright|e2e|coverage|verify|验证|测试/i))
  }
  if (/(release|publish|deploy|ci|workflow|npm|tag|ship|发版|发布|部署)/i.test(haystack)) {
    addRole('ops-agent', 'releaser', true, 'Release, deployment, CI, or workflow surface detected.', matching(haystack, /release|publish|deploy|ci|workflow|npm|tag|ship|发版|发布|部署/i))
  }
  if (/(docs|documentation|readme|guide|文档)/i.test(haystack)) {
    addRole('docs-agent', 'specialist', input.level !== 'S', 'Documentation or knowledge transfer surface detected.', matching(haystack, /docs|documentation|readme|guide|文档/i))
  }
  if (/(performance|benchmark|latency|cache|profil|性能|基准)/i.test(haystack)) {
    addRole('performance-agent', 'verifier', input.level !== 'S', 'Performance-sensitive language requires explicit benchmark review.', matching(haystack, /performance|benchmark|latency|cache|profil|性能|基准/i))
  }

  for (const gate of input.evaluator.gates) {
    if (gate.id === 'architecture-critique') addRole('architect-agent', 'planner', gate.required, gate.reason, gate.evidence)
    if (gate.id === 'root-cause-review') addRole('code-review-agent', 'reviewer', gate.required, gate.reason, gate.evidence)
    if (gate.id === 'security-threat-model') addRole('security-agent', 'reviewer', gate.required, gate.reason, gate.evidence)
    if (gate.id === 'release-readiness-review') addRole('ops-agent', 'releaser', gate.required, gate.reason, gate.evidence)
    if (gate.id === 'uncertainty-decision-log') addRole('code-review-agent', 'reviewer', gate.required, gate.reason, gate.evidence)
  }

  if (input.level === 'L' || input.level === 'CRITICAL' || input.workflowProfile === 'strict' || input.workflowProfile === 'critical') {
    addRole('code-review-agent', 'reviewer', true, `Governance profile ${input.workflowProfile} and level ${input.level} require independent review.`, input.governance.signals.flatMap(signal => signal.evidence))
    addRole('test-agent', 'verifier', true, `Governance profile ${input.workflowProfile} and level ${input.level} require verification ownership.`, input.skillPlan.requiredVerification)
  }
  if (input.level === 'CRITICAL' || input.workflowProfile === 'critical' || input.evaluator.riskLevel === 'high') {
    addRole('security-agent', 'reviewer', true, `High-risk evaluator/profile path requires security review (${input.evaluator.riskLevel}/${input.workflowProfile}).`, input.evaluator.uncertainty.drivers)
  }

  const weightedRoles = [...drafts.values()]
    .map(draft => toRole(draft, input.budget))
    .sort((a, b) => roleOrder(a.responsibility) - roleOrder(b.responsibility) || a.profileId.localeCompare(b.profileId))
  const roles = assignRoleBudgets(weightedRoles, input.budget)
  const edges = buildEdges(roles)
  const handoffs = buildHandoffs(edges)
  const reviewGates = buildReviewGates(roles, input)
  const reviewEscalated = reviewGates.some(gate => gate.required) || roles.some(role => role.responsibility === 'reviewer' && role.required)
  const multiAgentRecommended = roles.length > 2 || input.level === 'L' || input.level === 'CRITICAL' || input.evaluator.required || input.toolStrategy.summary.highRiskSteps > 0
  const mode: AgentCollaborationMode = reviewEscalated
    ? 'review-escalated'
    : multiAgentRecommended ? 'multi-agent' : 'single-agent'
  const assignedTokens = roles.reduce((sum, role) => sum + role.budgetTokens, 0)
  const reserveTokens = Math.max(0, input.budget - assignedTokens)

  return {
    strategy: 'agent-collaboration-v1',
    mode,
    roles,
    edges,
    handoffs,
    reviewGates,
    budget: {
      totalTokens: input.budget,
      assignedTokens,
      reserveTokens,
      perRole: roles.map(role => ({ profileId: role.profileId, tokens: role.budgetTokens })),
    },
    summary: {
      totalRoles: roles.length,
      requiredRoles: roles.filter(role => role.required).length,
      reviewerRoles: roles.filter(role => role.responsibility === 'reviewer' || role.responsibility === 'verifier').length,
      handoffCount: handoffs.length,
      reviewGateCount: reviewGates.length,
      estimatedCostUnits: input.toolStrategy.summary.estimatedCostUnits,
      multiAgentRecommended,
      reviewEscalated,
    },
    recommendations: collaborationRecommendations({ mode, roles, reviewGates, input }),
  }
}

function toRole(draft: RoleDraft, totalBudget: number): AgentCollaborationRole {
  const profile = PROFILE_BY_ID.get(draft.profileId) as AgentProfile
  return {
    profileId: profile.id,
    name: profile.name,
    domain: profile.domain,
    responsibility: draft.responsibility,
    required: draft.required,
    reason: draft.reason,
    capabilities: profile.capabilities,
    preferredModel: profile.preferredModel,
    budgetTokens: Math.max(250, Math.floor(totalBudget / 8)),
    evidence: draft.evidence.length > 0 ? draft.evidence.slice(0, 8) : [`agent-profile:${profile.id}`],
  }
}

function assignRoleBudgets(roles: AgentCollaborationRole[], totalBudget: number): AgentCollaborationRole[] {
  if (roles.length === 0) return []
  const reserve = Math.max(400, Math.floor(totalBudget * 0.15))
  const assignable = Math.max(roles.length * 250, totalBudget - reserve)
  const weights = roles.map(role => responsibilityWeight(role.responsibility, role.required))
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  let assigned = 0
  return roles.map((role, index) => {
    const isLast = index === roles.length - 1
    const budgetTokens = isLast
      ? Math.max(250, assignable - assigned)
      : Math.max(250, Math.floor(assignable * (weights[index] / totalWeight)))
    assigned += budgetTokens
    return { ...role, budgetTokens }
  })
}

function buildEdges(roles: AgentCollaborationRole[]): AgentCollaborationEdge[] {
  const edges: AgentCollaborationEdge[] = []
  const has = (profileId: string) => roles.some(role => role.profileId === profileId)
  const add = (from: string, to: string, type: AgentCollaborationEdge['type'], reason: string) => {
    if (from === to || !has(from) || !has(to)) return
    if (edges.some(edge => edge.from === from && edge.to === to && edge.type === type)) return
    edges.push({ from, to, type, reason })
  }
  const implementers = roles.filter(role => role.responsibility === 'implementer' || role.responsibility === 'specialist')
  for (const role of implementers) {
    add('product-agent', role.profileId, 'handoff', 'Product scope and success criteria feed implementation.')
    add('architect-agent', role.profileId, 'handoff', 'Architecture plan and boundaries feed implementation.')
    add(role.profileId, 'test-agent', 'handoff', 'Implementation output must hand off to verification.')
    add(role.profileId, 'code-review-agent', 'review', 'Implementation output requires independent code review.')
    add(role.profileId, 'security-agent', 'review', 'Security-sensitive implementation requires threat-model review.')
  }
  add('ui-design-agent', 'frontend-agent', 'handoff', 'Design direction feeds frontend implementation.')
  add('database-agent', 'backend-agent', 'sync', 'Database changes must stay synchronized with backend contracts.')
  add('security-agent', 'ops-agent', 'review', 'Release path must account for security findings.')
  add('test-agent', 'ops-agent', 'handoff', 'Release should only proceed with verification evidence.')
  add('code-review-agent', 'ops-agent', 'handoff', 'Release should only proceed after review evidence.')
  return edges
}

function buildHandoffs(edges: AgentCollaborationEdge[]): AgentCollaborationHandoff[] {
  return edges
    .filter(edge => edge.type === 'handoff' || edge.type === 'review')
    .map(edge => ({
      from: edge.from,
      to: edge.to,
      artifact: `${edge.from}-to-${edge.to}.handoff.md`,
      evidence: [`agentCollaboration.edges.${edge.from}->${edge.to}`, `agentCollaboration.roles.${edge.from}`, `agentCollaboration.roles.${edge.to}`],
      exitCriteria: [
        'Upstream output is linked to a concrete file, command, screenshot, or runtime evidence item.',
        'Downstream owner records accept/reject decision and unresolved gaps.',
      ],
    }))
}

function buildReviewGates(
  roles: AgentCollaborationRole[],
  input: AgentCollaborationPlannerInput,
): AgentCollaborationReviewGate[] {
  const gates: AgentCollaborationReviewGate[] = []
  const has = (profileId: string) => roles.some(role => role.profileId === profileId)
  const add = (id: string, owner: string, required: boolean, reason: string, evidence: string[]) => {
    if (!has(owner)) return
    if (gates.some(gate => gate.id === id)) return
    gates.push({ id, owner, required, reason, evidence: compact(evidence) })
  }
  add('implementation-review', 'code-review-agent', input.level !== 'S' || input.evaluator.required, 'Independent code review catches design drift, missing tests, and hallucinated claims.', ['review-ledger.md'])
  add('verification-review', 'test-agent', input.skillPlan.requiredVerification.length > 0 || input.level !== 'S', 'Verification owner must map outputs to commands, screenshots, or runtime evidence.', input.skillPlan.requiredVerification)
  add('security-review', 'security-agent', input.evaluator.gates.some(gate => gate.id === 'security-threat-model' && gate.required) || input.level === 'CRITICAL', 'Security-sensitive path needs threat-model evidence before release.', input.evaluator.gates.flatMap(gate => gate.evidence))
  add('release-review', 'ops-agent', input.evaluator.gates.some(gate => gate.id === 'release-readiness-review') || /release|deploy|publish|ship|npm|tag/i.test(input.task), 'Release or deployment path needs rollback and publish readiness evidence.', ['release-checklist.md', 'rollback-plan.md'])
  return gates
}

function collaborationRecommendations(options: {
  mode: AgentCollaborationMode
  roles: AgentCollaborationRole[]
  reviewGates: AgentCollaborationReviewGate[]
  input: AgentCollaborationPlannerInput
}): string[] {
  const recommendations: string[] = []
  if (options.mode === 'single-agent') {
    recommendations.push('Keep execution single-agent; record why extra agents would add coordination cost without reducing risk.')
  } else {
    recommendations.push('Execute agents by DAG stage, not open-ended chat; each agent must produce a bounded artifact and evidence reference.')
  }
  if (options.reviewGates.some(gate => gate.required)) {
    recommendations.push('Do not promote implementation output until required review gates have accept/reject evidence.')
  }
  if (options.input.toolStrategy.summary.totalSteps > 0) {
    recommendations.push('Use tool-strategy cost and fallback data to cap agent context and prevent duplicate tool calls.')
  }
  if (options.input.evaluator.uncertainty.score >= 0.45) {
    recommendations.push('Record uncertainty, rejected alternatives, and evidence gaps in the review ledger before final summary.')
  }
  return recommendations
}

function responsibilityForProfile(profileId: string): AgentCollaborationResponsibility {
  if (profileId === 'architect-agent') return 'planner'
  if (profileId === 'product-agent') return 'planner'
  if (profileId === 'frontend-agent' || profileId === 'backend-agent') return 'implementer'
  if (profileId === 'test-agent' || profileId === 'performance-agent') return 'verifier'
  if (profileId === 'code-review-agent' || profileId === 'security-agent') return 'reviewer'
  if (profileId === 'ops-agent') return 'releaser'
  return 'specialist'
}

function mergeResponsibility(
  current: AgentCollaborationResponsibility,
  next: AgentCollaborationResponsibility,
): AgentCollaborationResponsibility {
  return roleOrder(next) < roleOrder(current) ? next : current
}

function roleOrder(role: AgentCollaborationResponsibility): number {
  const order: Record<AgentCollaborationResponsibility, number> = {
    orchestrator: 0,
    planner: 1,
    implementer: 2,
    specialist: 3,
    verifier: 4,
    reviewer: 5,
    releaser: 6,
  }
  return order[role]
}

function responsibilityWeight(role: AgentCollaborationResponsibility, required: boolean): number {
  const base: Record<AgentCollaborationResponsibility, number> = {
    orchestrator: 1.1,
    planner: 0.95,
    implementer: 1.2,
    specialist: 1,
    verifier: 0.95,
    reviewer: 0.9,
    releaser: 0.8,
  }
  return base[role] + (required ? 0.15 : 0)
}

function mergeReason(current: string, next: string): string {
  if (current.includes(next)) return current
  if (next.includes(current)) return next
  return `${current} ${next}`
}

function matching(value: string, pattern: RegExp): string[] {
  return pattern.test(value) ? [value.slice(0, 160)] : []
}

function compact(items: string[]): string[] {
  return [...new Set(items.map(item => item.trim()).filter(Boolean))].slice(0, 12)
}
