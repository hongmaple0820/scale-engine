import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { createAiOsPlan, type AiOsRuntimePlan } from '../runtime/AiOsRuntime.js'
import { ExecutionLedger, type ExecutionEvent } from '../runtime/ExecutionLedger.js'
import type {
  AgentCollaborationPlan,
  AgentCollaborationReviewGate,
  AgentCollaborationRole,
} from '../workflow/AgentCollaborationPlanner.js'
import type { AgentOsTaskLevel } from './AgentOsTaskStore.js'

export type AgentOsDelegationStatus = 'planned' | 'delegated' | 'accepted' | 'rejected'
export type AgentOsReviewStatus = 'accepted' | 'rejected'

export interface AgentOsMultiAgentOrchestratorOptions {
  projectDir?: string
  scaleDir?: string
  now?: () => Date
  ledger?: ExecutionLedger
}

export interface PlanAgentOsDelegationInput {
  taskId?: string
  task: string
  level?: AgentOsTaskLevel | string
  files?: string[]
  services?: string[]
  budget?: number
}

export interface AgentOsAgentAssignment {
  assignmentId: string
  taskId?: string
  profileId: string
  role: AgentCollaborationRole
  status: AgentOsDelegationStatus
  delegatedAt?: string
  reviewedAt?: string
  reviewReason?: string
}

export interface AgentOsReviewAssignment {
  reviewId: string
  taskId?: string
  gate: AgentCollaborationReviewGate
  status: AgentOsDelegationStatus
  reviewedAt?: string
  reviewReason?: string
}

export interface AgentOsDelegationRecord {
  version: 1
  delegationId: string
  taskId?: string
  task: string
  status: AgentOsDelegationStatus
  createdAt: string
  updatedAt: string
  plan: AiOsRuntimePlan
  agentCollaboration: AgentCollaborationPlan
  assignments: AgentOsAgentAssignment[]
  reviews: AgentOsReviewAssignment[]
  eventIds: string[]
}

export interface AgentOsDelegationState {
  version: 1
  updatedAt: string
  delegations: AgentOsDelegationRecord[]
}

export interface ReviewAgentOsDelegationInput {
  delegationId: string
  profileId?: string
  reviewId?: string
  status: AgentOsReviewStatus
  reason?: string
  reviewer?: string
}

export class AgentOsMultiAgentOrchestrator {
  private projectDir: string
  private scaleDir: string
  private path: string
  private now: () => Date
  private ledger: ExecutionLedger

  constructor(options: AgentOsMultiAgentOrchestratorOptions = {}) {
    this.projectDir = resolve(options.projectDir ?? process.cwd())
    this.scaleDir = isAbsolute(options.scaleDir ?? '')
      ? options.scaleDir as string
      : join(this.projectDir, options.scaleDir ?? '.scale')
    this.path = join(this.scaleDir, 'agents', 'assignments.json')
    this.now = options.now ?? (() => new Date())
    this.ledger = options.ledger ?? new ExecutionLedger({
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
      now: this.now,
    })
  }

  async plan(input: PlanAgentOsDelegationInput): Promise<AgentOsDelegationRecord> {
    const plan = await createAiOsPlan({
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
      taskId: input.taskId,
      task: input.task,
      level: input.level,
      files: input.files,
      services: input.services,
      budget: input.budget,
    })
    return this.toDelegation(input, plan, 'planned', [])
  }

  async delegate(input: PlanAgentOsDelegationInput): Promise<{ delegation: AgentOsDelegationRecord; event: ExecutionEvent }> {
    const planned = await this.plan(input)
    const event = this.ledger.record({
      agentId: 'agent-os-orchestrator',
      sessionId: planned.delegationId,
      taskId: input.taskId,
      type: 'agent.delegated',
      summary: `Delegated Agent OS task to ${planned.assignments.length} role(s)`,
      metadata: {
        delegationId: planned.delegationId,
        mode: planned.agentCollaboration.mode,
        roles: planned.assignments.map(item => item.profileId),
        reviewGates: planned.reviews.map(item => item.reviewId),
      },
    })
    const delegated: AgentOsDelegationRecord = {
      ...planned,
      status: 'delegated',
      updatedAt: this.now().toISOString(),
      assignments: planned.assignments.map(item => ({
        ...item,
        status: 'delegated',
        delegatedAt: this.now().toISOString(),
      })),
      reviews: planned.reviews.map(item => ({
        ...item,
        status: 'delegated',
      })),
      eventIds: [event.id],
    }
    this.upsert(delegated)
    return { delegation: delegated, event }
  }

  review(input: ReviewAgentOsDelegationInput): { delegation: AgentOsDelegationRecord; event: ExecutionEvent } {
    const state = this.load()
    const delegation = state.delegations.find(item => item.delegationId === input.delegationId)
    if (!delegation) throw new Error(`Agent OS delegation not found: ${input.delegationId}`)
    const now = this.now().toISOString()
    const assignments = delegation.assignments.map(item => {
      if (input.profileId && item.profileId === input.profileId) {
        return { ...item, status: input.status, reviewedAt: now, reviewReason: input.reason }
      }
      return item
    })
    const reviews = delegation.reviews.map(item => {
      if (input.reviewId && item.reviewId === input.reviewId) {
        return { ...item, status: input.status, reviewedAt: now, reviewReason: input.reason }
      }
      return item
    })
    const event = this.ledger.record({
      agentId: input.reviewer ?? 'agent-os-orchestrator',
      sessionId: delegation.delegationId,
      taskId: delegation.taskId,
      type: 'agent.reviewed',
      summary: `Agent OS delegation review ${input.status}`,
      metadata: {
        delegationId: delegation.delegationId,
        profileId: input.profileId,
        reviewId: input.reviewId,
        reason: input.reason,
      },
    })
    const updated: AgentOsDelegationRecord = {
      ...delegation,
      status: input.status,
      updatedAt: now,
      assignments,
      reviews,
      eventIds: [...delegation.eventIds, event.id],
    }
    this.upsert(updated)
    return { delegation: updated, event }
  }

  list(limit = 50): AgentOsDelegationRecord[] {
    return this.load().delegations.slice(-limit).reverse()
  }

  load(): AgentOsDelegationState {
    if (!existsSync(this.path)) return { version: 1, updatedAt: this.now().toISOString(), delegations: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf-8')) as Partial<AgentOsDelegationState>
      return {
        version: 1,
        updatedAt: String(parsed.updatedAt ?? this.now().toISOString()),
        delegations: Array.isArray(parsed.delegations)
          ? parsed.delegations as AgentOsDelegationRecord[]
          : [],
      }
    } catch {
      return { version: 1, updatedAt: this.now().toISOString(), delegations: [] }
    }
  }

  private toDelegation(
    input: PlanAgentOsDelegationInput,
    plan: AiOsRuntimePlan,
    status: AgentOsDelegationStatus,
    eventIds: string[],
  ): AgentOsDelegationRecord {
    const now = this.now().toISOString()
    const delegationId = `DELEGATION-${randomUUID().slice(0, 8)}`
    return {
      version: 1,
      delegationId,
      taskId: input.taskId,
      task: input.task,
      status,
      createdAt: now,
      updatedAt: now,
      plan,
      agentCollaboration: plan.agentCollaboration,
      assignments: plan.agentCollaboration.roles.map(role => ({
        assignmentId: `${delegationId}:${role.profileId}`,
        taskId: input.taskId,
        profileId: role.profileId,
        role,
        status,
      })),
      reviews: plan.agentCollaboration.reviewGates.map(gate => ({
        reviewId: `${delegationId}:${gate.id}`,
        taskId: input.taskId,
        gate,
        status,
      })),
      eventIds,
    }
  }

  private upsert(record: AgentOsDelegationRecord): void {
    const state = this.load()
    const updated: AgentOsDelegationState = {
      version: 1,
      updatedAt: this.now().toISOString(),
      delegations: [
        ...state.delegations.filter(item => item.delegationId !== record.delegationId),
        record,
      ].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    }
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, `${JSON.stringify(updated, null, 2)}\n`, 'utf-8')
  }
}
