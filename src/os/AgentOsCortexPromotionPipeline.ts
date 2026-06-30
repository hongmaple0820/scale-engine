import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { approveRuleMaturity } from '../evolution/RuleMaturity.js'
import { ExecutionLedger, type ExecutionEvent } from '../runtime/ExecutionLedger.js'
import {
  buildEvolutionShadowReport,
  evaluatePromotionReadiness,
  proposeShadowRule,
  recordProposalShadowHit,
  type EvolutionShadowReport,
  type ShadowProposalSource,
  type ShadowRuleProposal,
} from '../workflow/EvolutionShadowPromoter.js'

export interface AgentOsCortexPromotionPipelineOptions {
  projectDir?: string
  scaleDir?: string
  now?: () => Date
  ledger?: ExecutionLedger
}

export interface ProposeAgentOsCortexPromotionInput {
  title: string
  description: string
  source?: ShadowProposalSource
  sourceEvidenceIds?: string[]
  pattern: string
  enforcement?: 'prompt' | 'hook'
  rollback: string
  taskId?: string
}

export interface RecordAgentOsCortexShadowHitInput {
  proposalId: string
  evidenceId?: string
  falsePositive?: boolean
  taskId?: string
}

export interface ApproveAgentOsCortexPromotionInput {
  proposalId: string
  approvedBy: string
  taskId?: string
}

export interface AgentOsCortexPromotionState {
  version: 1
  updatedAt: string
  proposals: ShadowRuleProposal[]
}

export interface AgentOsCortexPromotionResult {
  proposal: ShadowRuleProposal
  report: EvolutionShadowReport
  event: ExecutionEvent
}

export class AgentOsCortexPromotionPipeline {
  private projectDir: string
  private scaleDir: string
  private path: string
  private now: () => Date
  private ledger: ExecutionLedger

  constructor(options: AgentOsCortexPromotionPipelineOptions = {}) {
    this.projectDir = resolve(options.projectDir ?? process.cwd())
    this.scaleDir = isAbsolute(options.scaleDir ?? '')
      ? options.scaleDir as string
      : join(this.projectDir, options.scaleDir ?? '.scale')
    this.path = join(this.scaleDir, 'cortex', 'promotions.json')
    this.now = options.now ?? (() => new Date())
    this.ledger = options.ledger ?? new ExecutionLedger({
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
      now: this.now,
    })
  }

  propose(input: ProposeAgentOsCortexPromotionInput): AgentOsCortexPromotionResult {
    const proposal = proposeShadowRule({
      title: input.title,
      description: input.description,
      source: input.source ?? 'manual',
      sourceEvidenceIds: input.sourceEvidenceIds ?? [],
      pattern: input.pattern,
      enforcement: input.enforcement ?? 'prompt',
      rollback: input.rollback,
    })
    this.upsert(proposal)
    const event = this.recordPromotionEvent('Proposed Cortex shadow rule', proposal, input.taskId)
    return { proposal, report: this.report(), event }
  }

  recordShadowHit(input: RecordAgentOsCortexShadowHitInput): AgentOsCortexPromotionResult {
    const proposal = this.requireProposal(input.proposalId)
    const updated = recordProposalShadowHit(proposal, input.evidenceId, input.falsePositive === true)
    this.upsert(updated)
    const event = this.recordPromotionEvent('Recorded Cortex shadow hit', updated, input.taskId)
    return { proposal: updated, report: this.report(), event }
  }

  evaluate(): EvolutionShadowReport {
    return this.report()
  }

  approve(input: ApproveAgentOsCortexPromotionInput): AgentOsCortexPromotionResult {
    const proposal = this.requireProposal(input.proposalId)
    const approved: ShadowRuleProposal = {
      ...proposal,
      maturity: approveRuleMaturity(proposal.maturity, input.approvedBy, this.now().getTime()),
    }
    this.upsert(approved)
    const event = this.recordPromotionEvent('Approved Cortex blocking rule', approved, input.taskId)
    return { proposal: approved, report: this.report(), event }
  }

  list(): ShadowRuleProposal[] {
    return this.load().proposals
  }

  load(): AgentOsCortexPromotionState {
    if (!existsSync(this.path)) return { version: 1, updatedAt: this.now().toISOString(), proposals: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf-8')) as Partial<AgentOsCortexPromotionState>
      return {
        version: 1,
        updatedAt: String(parsed.updatedAt ?? this.now().toISOString()),
        proposals: Array.isArray(parsed.proposals) ? parsed.proposals as ShadowRuleProposal[] : [],
      }
    } catch {
      return { version: 1, updatedAt: this.now().toISOString(), proposals: [] }
    }
  }

  private report(): EvolutionShadowReport {
    return buildEvolutionShadowReport(this.list())
  }

  private requireProposal(proposalId: string): ShadowRuleProposal {
    const proposal = this.list().find(item => item.id === proposalId)
    if (!proposal) throw new Error(`Cortex promotion proposal not found: ${proposalId}`)
    return proposal
  }

  private upsert(proposal: ShadowRuleProposal): void {
    const state = this.load()
    const updated: AgentOsCortexPromotionState = {
      version: 1,
      updatedAt: this.now().toISOString(),
      proposals: [
        ...state.proposals.filter(item => item.id !== proposal.id),
        proposal,
      ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, `${JSON.stringify(updated, null, 2)}\n`, 'utf-8')
  }

  private recordPromotionEvent(summary: string, proposal: ShadowRuleProposal, taskId?: string): ExecutionEvent {
    const validation = evaluatePromotionReadiness(proposal)
    return this.ledger.record({
      agentId: 'agent-os-cortex',
      sessionId: proposal.id,
      taskId,
      type: 'cortex.promotion',
      summary,
      metadata: {
        proposalId: proposal.id,
        stage: proposal.maturity.stage,
        shadowHits: proposal.maturity.shadowHits,
        falsePositiveCount: proposal.maturity.falsePositiveCount,
        eligible: validation.promotionDecision.eligible,
        blockers: validation.promotionDecision.blockers,
      },
    })
  }
}
