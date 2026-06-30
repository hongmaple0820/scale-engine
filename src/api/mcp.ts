// SCALE Engine — MCP Server (W11)
// Model Context Protocol server over stdio
// Exposes SCALE artifacts, transitions, and context as MCP tools

import { EventBus } from '../core/eventBus.js'
import { InMemoryArtifactStore } from '../artifact/store.js'
import { FSM } from '../artifact/fsm.js'
import { registerAllFSMs, INITIAL_STATES } from '../artifact/fsmDefinitions.js'
import { GraphifyKnowledgeBase } from '../knowledge/GraphifyKnowledgeBase.js'
import { ContextBuilder } from '../context/ContextBuilder.js'
import { wireEffects } from '../orchestration/EffectsWiring.js'
import { SCALE_ENGINE_VERSION } from '../version.js'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  detectChangesCRG,
  reviewContextCRG,
  queryExternalCRG,
  inspectCodeIntelligence,
} from '../codegraph/CodeIntelligence.js'
import {
  AgentOsBridgeRegistry,
  AgentOsCortexPromotionPipeline,
  AgentOsMultiAgentOrchestrator,
  AgentOsSmartShell,
  AgentOsTaskStore,
  buildAgentOsCapabilityReport,
  type AgentOsBridgeKind,
  type AgentOsCompletionOutcome,
  type AgentOsTaskLevel,
} from '../os/index.js'
import { RuntimeEvidenceLedger, type RuntimeEvidenceStatus } from '../runtime/RuntimeEvidenceLedger.js'
import { evaluateSkillRadar } from '../skills/SkillRadar.js'

// ============================================================================
// MCP Tool Definitions
// ============================================================================

export interface MCPTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface MCPRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: Record<string, unknown>
}

export interface MCPResponse {
  jsonrpc: '2.0'
  id: number | string
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

// ============================================================================
// SCALE MCP Server
// ============================================================================

export class ScaleMCPServer {
  private bus: EventBus
  private store: InMemoryArtifactStore
  private fsm: FSM
  private kb: GraphifyKnowledgeBase
  private ctx: ContextBuilder
  private scaleDir: string

  constructor(scaleDir: string = '.scale') {
    this.scaleDir = scaleDir
    const eventsDir = join(scaleDir, 'events')
    const artifactsDir = join(scaleDir, 'artifacts')
    for (const d of [eventsDir, artifactsDir]) {
      if (!existsSync(d)) mkdirSync(d, { recursive: true })
    }

    this.bus = new EventBus({ eventsDir })
    this.store = new InMemoryArtifactStore(this.bus, { artifactsDir })
    this.fsm = new FSM(this.store, this.bus)
    registerAllFSMs(this.fsm)
    wireEffects(this.fsm, this.store, this.bus)
    this.kb = new GraphifyKnowledgeBase(this.bus, { projectDir: process.cwd(), scaleDir })
    this.ctx = new ContextBuilder(this.store, this.kb, this.bus)
  }

  private agentOsTaskStore(): AgentOsTaskStore {
    return new AgentOsTaskStore({
      projectDir: process.cwd(),
      scaleDir: this.scaleDir,
    })
  }

  private agentOsBridgeRegistry(): AgentOsBridgeRegistry {
    return new AgentOsBridgeRegistry({
      projectDir: process.cwd(),
      scaleDir: this.scaleDir,
    })
  }

  private agentOsSmartShell(): AgentOsSmartShell {
    return new AgentOsSmartShell({
      projectDir: process.cwd(),
      scaleDir: this.scaleDir,
    })
  }

  private agentOsMultiAgentOrchestrator(): AgentOsMultiAgentOrchestrator {
    return new AgentOsMultiAgentOrchestrator({
      projectDir: process.cwd(),
      scaleDir: this.scaleDir,
    })
  }

  private agentOsCortexPromotionPipeline(): AgentOsCortexPromotionPipeline {
    return new AgentOsCortexPromotionPipeline({
      projectDir: process.cwd(),
      scaleDir: this.scaleDir,
    })
  }

  getTools(): MCPTool[] {
    return [
      {
        name: 'scale_create',
        description: 'Create a new SCALE artifact (Spec, Plan, Task, Defect, etc.)',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: Object.keys(INITIAL_STATES), description: 'Artifact type' },
            title: { type: 'string', description: 'Artifact title' },
            payload: { type: 'object', description: 'Type-specific payload' },
          },
          required: ['type', 'title'],
        },
      },
      {
        name: 'scale_transition',
        description: 'Transition an artifact to a new state via FSM action',
        inputSchema: {
          type: 'object',
          properties: {
            artifactId: { type: 'string', description: 'Artifact ID' },
            action: { type: 'string', description: 'FSM action name' },
            reason: { type: 'string', description: 'Reason for transition' },
          },
          required: ['artifactId', 'action'],
        },
      },
      {
        name: 'scale_list',
        description: 'List artifacts with optional filters',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'Filter by type' },
            status: { type: 'string', description: 'Filter by status' },
            limit: { type: 'number', description: 'Max results', default: 20 },
          },
        },
      },
      {
        name: 'scale_show',
        description: 'Show artifact details',
        inputSchema: {
          type: 'object',
          properties: {
            artifactId: { type: 'string', description: 'Artifact ID' },
          },
          required: ['artifactId'],
        },
      },
      {
        name: 'scale_available_actions',
        description: 'Get available FSM actions for an artifact',
        inputSchema: {
          type: 'object',
          properties: {
            artifactId: { type: 'string', description: 'Artifact ID' },
          },
          required: ['artifactId'],
        },
      },
      {
        name: 'scale_context',
        description: 'Build context for current session',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID' },
            artifactId: { type: 'string', description: 'Current artifact ID' },
            roleId: { type: 'string', description: 'Current role' },
          },
          required: ['sessionId'],
        },
      },
      {
        name: 'scale_stats',
        description: 'Get engine statistics',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'scale_detect_changes',
        description: 'Detect changed files and their blast radius (affected symbols, tests, dependencies). Uses code-review-graph if available, falls back to git diff.',
        inputSchema: {
          type: 'object',
          properties: {
            baseRef: { type: 'string', description: 'Git base ref to diff against (default: HEAD~1)' },
          },
        },
      },
      {
        name: 'scale_review_context',
        description: 'Get review context for files — blast radius, affected dependencies, and token savings estimate. Uses code-review-graph for structural analysis.',
        inputSchema: {
          type: 'object',
          properties: {
            files: { type: 'array', items: { type: 'string' }, description: 'Files to review (default: all changed files)' },
          },
        },
      },
      {
        name: 'scale_code_intelligence_status',
        description: 'Show code intelligence provider status and recommendations',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'task_create',
        description: 'Create a durable Agent OS task manifest',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Optional stable task id' },
            name: { type: 'string', description: 'Task name' },
            objective: { type: 'string', description: 'Task objective' },
            description: { type: 'string', description: 'Longer task description' },
            level: { type: 'string', enum: ['S', 'M', 'L', 'CRITICAL'], description: 'Task level' },
            files: { type: 'array', items: { type: 'string' }, description: 'Relevant files' },
            services: { type: 'array', items: { type: 'string' }, description: 'Affected services' },
            surfaces: { type: 'array', items: { type: 'string' }, description: 'Affected surfaces' },
            metadata: { type: 'object', description: 'Additional metadata' },
          },
          required: ['name'],
        },
      },
      {
        name: 'task_start',
        description: 'Start a durable Agent OS task run',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Task id' },
            runId: { type: 'string', description: 'Optional stable run id' },
            agent: { type: 'string', description: 'Agent name' },
            provider: { type: 'string', description: 'Model provider' },
            model: { type: 'string', description: 'Model id' },
            contextPackId: { type: 'string', description: 'Linked context pack id' },
            metadata: { type: 'object', description: 'Additional metadata' },
          },
          required: ['taskId'],
        },
      },
      {
        name: 'task_status',
        description: 'Read Agent OS task, run, checkpoint, and completion state',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Task id' },
          },
          required: ['taskId'],
        },
      },
      {
        name: 'task_checkpoint',
        description: 'Create a resumable Agent OS checkpoint',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Task id' },
            runId: { type: 'string', description: 'Run id; defaults to current run' },
            summary: { type: 'string', description: 'Checkpoint summary' },
            completedSteps: { type: 'array', items: { type: 'string' }, description: 'Completed steps' },
            remainingSteps: { type: 'array', items: { type: 'string' }, description: 'Remaining steps' },
            openApprovals: { type: 'array', items: { type: 'string' }, description: 'Open approval ids' },
            evidenceIds: { type: 'array', items: { type: 'string' }, description: 'Linked evidence ids' },
            resumePrompt: { type: 'string', description: 'Explicit resume prompt' },
            metadata: { type: 'object', description: 'Additional metadata' },
          },
          required: ['taskId', 'summary'],
        },
      },
      {
        name: 'task_resume',
        description: 'Resume an Agent OS task from a checkpoint',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Task id' },
            checkpointId: { type: 'string', description: 'Checkpoint id; latest is used when omitted' },
          },
          required: ['taskId'],
        },
      },
      {
        name: 'complete_task',
        description: 'Record explicit Agent OS task completion and final-report evidence',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Task id' },
            runId: { type: 'string', description: 'Run id; defaults to current run' },
            outcome: { type: 'string', enum: ['complete', 'partial', 'blocked', 'cancelled'], description: 'Completion outcome' },
            summary: { type: 'string', description: 'Completion summary' },
            evidenceIds: { type: 'array', items: { type: 'string' }, description: 'Existing evidence ids to link' },
            changedFiles: { type: 'array', items: { type: 'string' }, description: 'Changed files' },
            validation: { type: 'array', items: { type: 'string' }, description: 'Validation commands or checks' },
            residualRisk: { type: 'string', description: 'Residual risk or unverified scope' },
            nextActions: { type: 'array', items: { type: 'string' }, description: 'Follow-up actions' },
            metadata: { type: 'object', description: 'Additional metadata' },
          },
          required: ['taskId', 'summary'],
        },
      },
      {
        name: 'capability_list',
        description: 'List Agent OS capability descriptors',
        inputSchema: {
          type: 'object',
          properties: {
            capabilityIds: { type: 'array', items: { type: 'string' }, description: 'Optional capability ids' },
          },
        },
      },
      {
        name: 'capability_map',
        description: 'Map Agent OS capabilities to a task intent using Skill Radar signals',
        inputSchema: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'Task description' },
            phase: { type: 'string', description: 'Workflow phase' },
            level: { type: 'string', description: 'Task level' },
            files: { type: 'array', items: { type: 'string' }, description: 'Relevant files' },
            services: { type: 'array', items: { type: 'string' }, description: 'Affected services' },
          },
          required: ['task'],
        },
      },
      {
        name: 'bridge_register',
        description: 'Register an external Agent OS bridge, connector, or remote agent surface',
        inputSchema: {
          type: 'object',
          properties: {
            bridgeId: { type: 'string', description: 'Optional stable bridge id' },
            name: { type: 'string', description: 'Bridge name' },
            kind: { type: 'string', enum: ['dashboard', 'tui', 'desktop', 'im', 'remote-agent', 'connector'], description: 'Bridge kind' },
            endpoint: { type: 'string', description: 'Bridge endpoint' },
            token: { type: 'string', description: 'Optional bridge token' },
            scopes: { type: 'array', items: { type: 'string' }, description: 'Granted scopes' },
            capabilityIds: { type: 'array', items: { type: 'string' }, description: 'Bridge capability ids' },
            metadata: { type: 'object', description: 'Additional metadata' },
          },
          required: ['name'],
        },
      },
      {
        name: 'bridge_heartbeat',
        description: 'Record a heartbeat for a registered Agent OS bridge',
        inputSchema: {
          type: 'object',
          properties: {
            bridgeId: { type: 'string', description: 'Bridge id' },
            token: { type: 'string', description: 'Bridge token' },
          },
          required: ['bridgeId'],
        },
      },
      {
        name: 'shell_plan',
        description: 'Classify an Agent OS shell command before execution',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command line to classify' },
            cwd: { type: 'string', description: 'Working directory' },
            taskId: { type: 'string', description: 'Agent OS task id' },
            sessionId: { type: 'string', description: 'Agent OS session id' },
            approved: { type: 'boolean', description: 'Explicit approval for high-risk commands' },
          },
          required: ['command'],
        },
      },
      {
        name: 'shell_run',
        description: 'Run an Agent OS governed shell command and record command evidence',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command line to run' },
            cwd: { type: 'string', description: 'Working directory' },
            taskId: { type: 'string', description: 'Agent OS task id' },
            sessionId: { type: 'string', description: 'Agent OS session id' },
            profile: { type: 'string', description: 'Verification profile or caller label' },
            timeoutMs: { type: 'number', description: 'Timeout in milliseconds' },
            approved: { type: 'boolean', description: 'Explicit approval for high-risk commands' },
            allowShell: { type: 'boolean', description: 'Allow shell execution for trusted local commands' },
          },
          required: ['command'],
        },
      },
      {
        name: 'delegation_delegate',
        description: 'Create a persistent Agent OS multi-agent delegation from an AI OS plan',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Agent OS task id' },
            task: { type: 'string', description: 'Task description' },
            level: { type: 'string', enum: ['S', 'M', 'L', 'CRITICAL'], description: 'Task level' },
            files: { type: 'array', items: { type: 'string' }, description: 'Relevant files' },
            services: { type: 'array', items: { type: 'string' }, description: 'Affected services' },
            budget: { type: 'number', description: 'Token budget' },
          },
          required: ['task'],
        },
      },
      {
        name: 'delegation_review',
        description: 'Record an Agent OS delegation role or review-gate decision',
        inputSchema: {
          type: 'object',
          properties: {
            delegationId: { type: 'string', description: 'Delegation id' },
            profileId: { type: 'string', description: 'Role profile id' },
            reviewId: { type: 'string', description: 'Review gate id' },
            status: { type: 'string', enum: ['accepted', 'rejected'], description: 'Review status' },
            reason: { type: 'string', description: 'Review reason' },
            reviewer: { type: 'string', description: 'Reviewer id' },
          },
          required: ['delegationId', 'status'],
        },
      },
      {
        name: 'cortex_promotion_propose',
        description: 'Propose a Cortex shadow rule promotion candidate',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Rule title' },
            description: { type: 'string', description: 'Rule description' },
            source: { type: 'string', enum: ['failure-learning', 'lesson-extraction', 'manual'], description: 'Proposal source' },
            sourceEvidenceIds: { type: 'array', items: { type: 'string' }, description: 'Source evidence ids' },
            pattern: { type: 'string', description: 'Shadow detection pattern' },
            enforcement: { type: 'string', enum: ['prompt', 'hook'], description: 'Enforcement mode' },
            rollback: { type: 'string', description: 'Rollback strategy' },
            taskId: { type: 'string', description: 'Agent OS task id' },
          },
          required: ['title', 'pattern', 'rollback'],
        },
      },
      {
        name: 'cortex_promotion_hit',
        description: 'Record a Cortex shadow rule hit',
        inputSchema: {
          type: 'object',
          properties: {
            proposalId: { type: 'string', description: 'Proposal id' },
            evidenceId: { type: 'string', description: 'Evidence id' },
            falsePositive: { type: 'boolean', description: 'Whether this hit was a false positive' },
            taskId: { type: 'string', description: 'Agent OS task id' },
          },
          required: ['proposalId'],
        },
      },
      {
        name: 'cortex_promotion_approve',
        description: 'Approve an eligible Cortex shadow rule for blocking enforcement',
        inputSchema: {
          type: 'object',
          properties: {
            proposalId: { type: 'string', description: 'Proposal id' },
            approvedBy: { type: 'string', description: 'Approver id' },
            taskId: { type: 'string', description: 'Agent OS task id' },
          },
          required: ['proposalId', 'approvedBy'],
        },
      },
    ]
  }

  async handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
    const actor = { kind: 'system' as const, component: 'mcp-client' }

    switch (name) {
      case 'scale_create': {
        const type = args.type as string
        const title = args.title as string
        const payload = (args.payload as Record<string, unknown>) ?? {}
        const artifact = await this.store.create({
          type: type as any,
          title,
          payload,
          initialStatus: INITIAL_STATES[type as keyof typeof INITIAL_STATES],
          createdBy: actor,
        })
        return { id: artifact.id, type: artifact.type, title: artifact.title, status: artifact.status }
      }

      case 'scale_transition': {
        const id = args.artifactId as string
        const action = args.action as string
        const reason = args.reason as string | undefined
        const result = await this.fsm.transition(id, action, { actor, reason })
        return {
          success: result.success,
          status: result.artifact?.status,
          blockedBy: result.blockedBy,
          effectsExecuted: result.effectsExecuted,
        }
      }

      case 'scale_list': {
        const artifacts = await this.store.query({
          type: args.type as any,
          status: args.status as string | undefined,
          limit: (args.limit as number) ?? 20,
        })
        return artifacts.map((a) => ({
          id: a.id, type: a.type, title: a.title, status: a.status,
        }))
      }

      case 'scale_show': {
        const artifact = await this.store.get(args.artifactId as string)
        if (!artifact) return { error: 'Artifact not found' }
        return artifact
      }

      case 'scale_available_actions': {
        const actions = await this.fsm.availableActions(args.artifactId as string)
        return { artifactId: args.artifactId, actions }
      }

      case 'scale_context': {
        const ctx = await this.ctx.build({
          sessionId: args.sessionId as string,
          currentArtifactId: args.artifactId as string | undefined,
          roleId: args.roleId as string | undefined,
        })
        return ctx
      }

      case 'scale_stats': {
        const all = await this.store.query({ limit: 10000 })
        const byType: Record<string, number> = {}
        for (const a of all) byType[a.type] = (byType[a.type] ?? 0) + 1
        const events = await this.bus.query({ limit: 1000 })
        return { artifactCount: all.length, byType, eventCount: events.length }
      }

      case 'scale_detect_changes': {
        const baseRef = (args.baseRef as string) ?? 'HEAD~1'
        const projectDir = process.cwd()
        const crgResult = detectChangesCRG({ projectDir, baseRef })
        if (crgResult) {
          return {
            provider: crgResult.provider,
            changedFiles: crgResult.changedFiles,
            affectedSymbols: crgResult.affectedSymbols,
            affectedTests: crgResult.affectedTests,
            blastRadiusFiles: crgResult.blastRadiusFiles,
            summary: `${crgResult.changedFiles.length} files changed, ${crgResult.blastRadiusFiles.length} files in blast radius, ${crgResult.affectedTests.length} tests affected`,
          }
        }
        // Fallback: git diff
        const { execSync } = await import('node:child_process')
        try {
          const diffOutput = execSync(`git diff --name-only ${baseRef}`, { encoding: 'utf8', cwd: projectDir })
          const changedFiles = diffOutput.split('\n').filter(Boolean)
          return {
            provider: 'git-fallback',
            changedFiles,
            affectedSymbols: [],
            affectedTests: changedFiles.filter(f => f.includes('.test.') || f.includes('.spec.')),
            blastRadiusFiles: changedFiles,
            summary: `${changedFiles.length} files changed (git fallback, no blast radius analysis)`,
          }
        } catch (e) {
          return { error: `git diff failed: ${(e as Error).message}` }
        }
      }

      case 'scale_review_context': {
        const projectDir = process.cwd()
        const files = args.files as string[] | undefined
        const crgResult = reviewContextCRG({ projectDir, files })
        if (crgResult) {
          return {
            provider: crgResult.provider,
            files: crgResult.files,
            blastRadius: crgResult.blastRadius,
            tokenSavings: {
              naiveCorpus: crgResult.tokenSavings.naiveCorpus ?? 0,
              graphQuery: crgResult.tokenSavings.graphQuery ?? 0,
              reduction: crgResult.tokenSavings.reduction ?? 1,
            },
            summary: `${crgResult.files.length} files in review context, ${crgResult.blastRadius.length} blast radius entries, ${crgResult.tokenSavings.reduction ?? 1}x token reduction`,
          }
        }
        return {
          provider: 'unavailable',
          files: files ?? [],
          blastRadius: [],
          tokenSavings: { naiveCorpus: 0, graphQuery: 0, reduction: 1 },
          summary: 'code-review-graph not available; install with: pip install code-review-graph',
        }
      }

      case 'scale_code_intelligence_status': {
        return inspectCodeIntelligence()
      }

      case 'task_create': {
        const name = String(args.name ?? '').trim()
        if (!name) throw new Error('Task name is required.')
        const result = this.agentOsTaskStore().create({
          taskId: optionalString(args.taskId),
          name,
          objective: optionalString(args.objective),
          description: optionalString(args.description),
          level: normalizeMcpAgentOsTaskLevel(args.level),
          files: mcpStringArray(args.files),
          services: mcpStringArray(args.services),
          surfaces: mcpStringArray(args.surfaces),
          metadata: mcpRecord(args.metadata),
        })
        return { task: result.task, event: result.event }
      }

      case 'task_start': {
        const taskId = requiredString(args.taskId, 'taskId')
        const result = this.agentOsTaskStore().start({
          taskId,
          runId: optionalString(args.runId),
          agent: optionalString(args.agent),
          provider: optionalString(args.provider),
          model: optionalString(args.model),
          contextPackId: optionalString(args.contextPackId),
          metadata: mcpRecord(args.metadata),
        })
        return { run: result.record, task: result.task, event: result.event }
      }

      case 'task_status': {
        return this.agentOsTaskStore().snapshot(requiredString(args.taskId, 'taskId'))
      }

      case 'task_checkpoint': {
        const result = this.agentOsTaskStore().checkpoint({
          taskId: requiredString(args.taskId, 'taskId'),
          runId: optionalString(args.runId),
          summary: requiredString(args.summary, 'summary'),
          completedSteps: mcpStringArray(args.completedSteps ?? args.completed),
          remainingSteps: mcpStringArray(args.remainingSteps ?? args.remaining),
          openApprovals: mcpStringArray(args.openApprovals ?? args.approvals),
          evidenceIds: mcpStringArray(args.evidenceIds ?? args.evidence),
          resumePrompt: optionalString(args.resumePrompt),
          metadata: mcpRecord(args.metadata),
        })
        return { checkpoint: result.record, task: result.task, event: result.event }
      }

      case 'task_resume': {
        const result = this.agentOsTaskStore().resume({
          taskId: requiredString(args.taskId, 'taskId'),
          checkpointId: optionalString(args.checkpointId),
        })
        return {
          checkpoint: result.record,
          task: result.task,
          resumePrompt: result.record.resumePrompt,
          event: result.event,
        }
      }

      case 'complete_task':
      case 'task_complete': {
        const taskId = requiredString(args.taskId, 'taskId')
        const runId = optionalString(args.runId)
        const outcome = normalizeMcpAgentOsCompletionOutcome(args.outcome)
        const summary = requiredString(args.summary, 'summary')
        const changedFiles = mcpStringArray(args.changedFiles ?? args.changed)
        const validation = mcpStringArray(args.validation)
        const residualRisk = optionalString(args.residualRisk)
        const evidenceRecord = new RuntimeEvidenceLedger({
          projectDir: process.cwd(),
          scaleDir: this.scaleDir,
        }).record({
          taskId,
          sessionId: runId,
          kind: 'final-report',
          title: 'Agent OS completion signal',
          status: mcpEvidenceStatusForOutcome(outcome),
          summary,
          artifacts: changedFiles,
          metadata: {
            outcome,
            residualRisk,
            validation,
            source: 'mcp-tool',
          },
        })
        const result = this.agentOsTaskStore().complete({
          taskId,
          runId,
          outcome,
          summary,
          evidenceIds: [...mcpStringArray(args.evidenceIds ?? args.evidence), evidenceRecord.id],
          changedFiles,
          validation,
          residualRisk,
          nextActions: mcpStringArray(args.nextActions),
          metadata: mcpRecord(args.metadata),
        })
        return {
          ok: outcome === 'complete' || outcome === 'partial',
          completion: result.record,
          task: result.task,
          evidence: evidenceRecord,
          event: result.event,
        }
      }

      case 'capability_list': {
        return buildAgentOsCapabilityReport({
          projectDir: process.cwd(),
          scaleDir: this.scaleDir,
          capabilityIds: mcpStringArray(args.capabilityIds ?? args.capabilities),
        })
      }

      case 'capability_map': {
        const task = requiredString(args.task, 'task')
        const radar = evaluateSkillRadar({
          projectDir: process.cwd(),
          scaleDir: this.scaleDir,
          task,
          phase: optionalString(args.phase),
          level: String(args.level ?? 'M'),
          files: mcpStringArray(args.files),
          services: mcpStringArray(args.services),
        })
        const ids = radar.recommendations.map(item => item.id)
        const capabilities = buildAgentOsCapabilityReport({
          projectDir: process.cwd(),
          scaleDir: this.scaleDir,
          capabilityIds: ids.length > 0 ? ids : undefined,
        })
        return {
          task,
          ok: radar.ok && capabilities.ok,
          detectedDomains: radar.detectedDomains,
          recommendations: radar.recommendations,
          capabilities,
          fallbacks: radar.fallbacks,
        }
      }

      case 'bridge_register': {
        const result = this.agentOsBridgeRegistry().register({
          bridgeId: optionalString(args.bridgeId),
          name: requiredString(args.name, 'name'),
          kind: normalizeMcpAgentOsBridgeKind(args.kind),
          endpoint: optionalString(args.endpoint),
          token: optionalString(args.token),
          scopes: mcpStringArray(args.scopes),
          capabilityIds: mcpStringArray(args.capabilityIds ?? args.capabilities),
          metadata: mcpRecord(args.metadata),
        })
        return result
      }

      case 'bridge_heartbeat': {
        return this.agentOsBridgeRegistry().heartbeat(
          requiredString(args.bridgeId, 'bridgeId'),
          optionalString(args.token),
        )
      }

      case 'shell_plan': {
        return this.agentOsSmartShell().plan({
          command: requiredString(args.command, 'command'),
          cwd: optionalString(args.cwd),
          taskId: optionalString(args.taskId),
          sessionId: optionalString(args.sessionId),
          approved: args.approved === true,
        })
      }

      case 'shell_run': {
        return this.agentOsSmartShell().run({
          command: requiredString(args.command, 'command'),
          cwd: optionalString(args.cwd),
          taskId: optionalString(args.taskId),
          sessionId: optionalString(args.sessionId),
          profile: optionalString(args.profile),
          timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined,
          approved: args.approved === true,
          allowShell: args.allowShell === true,
        })
      }

      case 'delegation_delegate': {
        return this.agentOsMultiAgentOrchestrator().delegate({
          taskId: optionalString(args.taskId),
          task: requiredString(args.task, 'task'),
          level: normalizeMcpAgentOsTaskLevel(args.level),
          files: mcpStringArray(args.files),
          services: mcpStringArray(args.services),
          budget: typeof args.budget === 'number' ? args.budget : undefined,
        })
      }

      case 'delegation_review': {
        const status = requiredString(args.status, 'status')
        if (status !== 'accepted' && status !== 'rejected') throw new Error('status must be accepted or rejected')
        return this.agentOsMultiAgentOrchestrator().review({
          delegationId: requiredString(args.delegationId, 'delegationId'),
          profileId: optionalString(args.profileId),
          reviewId: optionalString(args.reviewId),
          status,
          reason: optionalString(args.reason),
          reviewer: optionalString(args.reviewer),
        })
      }

      case 'cortex_promotion_propose': {
        const source = optionalString(args.source)
        return this.agentOsCortexPromotionPipeline().propose({
          title: requiredString(args.title, 'title'),
          description: optionalString(args.description) ?? '',
          source: source === 'failure-learning' || source === 'lesson-extraction' || source === 'manual' ? source : 'manual',
          sourceEvidenceIds: mcpStringArray(args.sourceEvidenceIds ?? args.evidence),
          pattern: requiredString(args.pattern, 'pattern'),
          enforcement: optionalString(args.enforcement) === 'hook' ? 'hook' : 'prompt',
          rollback: requiredString(args.rollback, 'rollback'),
          taskId: optionalString(args.taskId),
        })
      }

      case 'cortex_promotion_hit': {
        return this.agentOsCortexPromotionPipeline().recordShadowHit({
          proposalId: requiredString(args.proposalId, 'proposalId'),
          evidenceId: optionalString(args.evidenceId),
          falsePositive: args.falsePositive === true,
          taskId: optionalString(args.taskId),
        })
      }

      case 'cortex_promotion_approve': {
        return this.agentOsCortexPromotionPipeline().approve({
          proposalId: requiredString(args.proposalId, 'proposalId'),
          approvedBy: requiredString(args.approvedBy, 'approvedBy'),
          taskId: optionalString(args.taskId),
        })
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  }

  async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    try {
      switch (request.method) {
        case 'initialize':
          return {
            jsonrpc: '2.0', id: request.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'scale-engine', version: SCALE_ENGINE_VERSION },
            },
          }

        case 'tools/list':
          return {
            jsonrpc: '2.0', id: request.id,
            result: { tools: this.getTools() },
          }

        case 'tools/call': {
          const params = request.params as { name: string; arguments: Record<string, unknown> }
          const result = await this.handleToolCall(params.name, params.arguments ?? {})
          return {
            jsonrpc: '2.0', id: request.id,
            result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
          }
        }

        default:
          return {
            jsonrpc: '2.0', id: request.id,
            error: { code: -32601, message: `Method not found: ${request.method}` },
          }
      }
    } catch (e) {
      return {
        jsonrpc: '2.0', id: request.id,
        error: { code: -32000, message: (e as Error).message },
      }
    }
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  throw new Error(`${name} is required.`)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function mcpStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(',').map(item => item.trim()).filter(Boolean)
  return []
}

function mcpRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function normalizeMcpAgentOsTaskLevel(value: unknown): AgentOsTaskLevel {
  const normalized = String(value ?? 'M').trim().toUpperCase()
  if (normalized === 'S' || normalized === 'M' || normalized === 'L' || normalized === 'CRITICAL') return normalized
  return 'M'
}

function normalizeMcpAgentOsCompletionOutcome(value: unknown): AgentOsCompletionOutcome {
  const normalized = String(value ?? 'complete').trim()
  if (normalized === 'complete' || normalized === 'partial' || normalized === 'blocked' || normalized === 'cancelled') return normalized
  throw new Error(`Invalid completion outcome "${String(value)}"; expected complete, partial, blocked, or cancelled.`)
}

function normalizeMcpAgentOsBridgeKind(value: unknown): AgentOsBridgeKind {
  const normalized = String(value ?? 'connector').trim()
  const kinds: AgentOsBridgeKind[] = ['dashboard', 'tui', 'desktop', 'im', 'remote-agent', 'connector']
  return kinds.includes(normalized as AgentOsBridgeKind) ? normalized as AgentOsBridgeKind : 'connector'
}

function mcpEvidenceStatusForOutcome(outcome: AgentOsCompletionOutcome): RuntimeEvidenceStatus {
  if (outcome === 'complete' || outcome === 'partial') return 'passed'
  if (outcome === 'blocked') return 'failed'
  return 'skipped'
}
