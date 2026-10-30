// media_* MCP tools (v3 plan §11): thin adapters over the same JobService the
// CLI and Dashboard use. No arbitrary-path tools, no raw FFmpeg access — task
// ids and validated payloads only. Large media is returned as metadata + task
// references, never as base64 blobs in the conversation.

import type { MCPTool } from '../api/mcp.js'
import {
  cancelJob,
  createJob,
  getJob,
  listProjectApprovals,
  listProjectJobs,
  listProviderFeatures,
  listProviders,
  recoverJobs,
  retryJob,
  runJob,
  validateStoryboard,
  MediaError,
  type ExportJobRequest,
  type ImageJobRequest,
  type SpeechJobRequest,
  type Storyboard,
  type VideoJobRequest,
} from './index.js'
import { estimateCost } from './actions/estimate.js'
import { availableCreateTypes, getActionForTool } from './actions/registry.js'
import type { MediaJobStatus } from './types.js'

/**
 * Job types the current JobService can actually build. Kept next to the
 * catalog-derived enum so bumping IMPLEMENTED_MILESTONE fails the drift test
 * until the new type is wired here (and into createJob), instead of silently
 * widening the enum into a type the handler cannot construct.
 */
export const IMPLEMENTED_CREATE_TYPES = ['render', 'generate_image', 'generate_video', 'generate_speech', 'export'] as const
export type ImplementedCreateType = typeof IMPLEMENTED_CREATE_TYPES[number]

/**
 * Derived from the action catalog so M2/M4 types cannot leak into M0. The
 * display order keeps the pre-M0 enum (`render`, then `generate_image`) stable
 * for clients that pick the first enum value.
 */
const CREATE_TYPE_DISPLAY_ORDER = ['render', 'generate_image', 'generate_video', 'generate_speech', 'export']
const availableTypes = availableCreateTypes().filter(
  (type): type is ImplementedCreateType => (IMPLEMENTED_CREATE_TYPES as readonly string[]).includes(type),
)
const CREATE_TASK_TYPES = [
  ...CREATE_TYPE_DISPLAY_ORDER.filter(type => availableTypes.includes(type as ImplementedCreateType)),
  ...availableTypes.filter(type => !CREATE_TYPE_DISPLAY_ORDER.includes(type)),
]

const WAIT_DEFAULT_SECONDS = 25
const WAIT_MAX_SECONDS = 50
const WAIT_POLL_MS = 500
const WAIT_TERMINAL: Record<MediaJobStatus, boolean> = {
  created: false,
  validated: false,
  // waiting stops here: nothing moves until a human decides
  awaiting_approval: true,
  running: false,
  packaging: false,
  succeeded: true,
  failed: true,
  failed_validation: true,
  cancelled: true,
  interrupted: true,
}

function projectOf(args: Record<string, unknown>): string | undefined {
  return typeof args.project === 'string' && args.project.trim() ? args.project.trim() : undefined
}

function errorPayload(error: unknown): { error: { code: string; message: string; retryable: boolean } } {
  if (error instanceof MediaError) return { error: error.toJSON() }
  return { error: { code: 'MEDIA_RENDER_FAILED', message: error instanceof Error ? error.message : String(error), retryable: false } }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function waitSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return WAIT_DEFAULT_SECONDS
  return Math.min(WAIT_MAX_SECONDS, Math.max(1, Math.floor(value)))
}

function jobSummary(job: ReturnType<typeof getJob>['job']): Record<string, unknown> {
  return {
    taskId: job.id,
    type: job.type,
    status: job.status,
    attempt: job.attempt,
    error: job.error,
    approval: job.approval,
    cost: job.cost,
    provider: job.provider
      ? { providerId: job.provider.providerId, jobId: job.provider.jobId, submittedAt: job.provider.submittedAt }
      : undefined,
    outputs: job.outputs.map(output => ({ path: output.path, bytes: output.bytes, sha256: output.sha256, kind: output.kind })),
  }
}

export const MEDIA_MCP_TOOLS: MCPTool[] = [
  {
    name: 'media_list_providers',
    description: 'List media providers and video/speech feature modes with config status (no secrets)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'media_list_approvals',
    description: 'List media approval requests for a project (pending decisions block task execution)',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } } },
  },
  {
    name: 'media_validate_storyboard',
    description: 'Validate a storyboard (Scene DSL v0.1–v0.3) without rendering',
    inputSchema: {
      type: 'object',
      properties: { storyboard: { type: 'object', description: 'Scene DSL storyboard' } },
      required: ['storyboard'],
    },
  },
  {
    name: 'media_create_task',
    description: `Create a media task (${CREATE_TASK_TYPES.join(' or ')}) without running it`,
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: CREATE_TASK_TYPES },
        storyboard: { type: 'object', description: 'Required for type=render' },
        imageRequest: { type: 'object', description: '{prompt,size,providerId} — required for type=generate_image' },
        videoRequest: {
          type: 'object',
          description: '{prompt,durationSeconds,providerId,aspectRatio?,resolution?,firstFrameAssetPath?} — required for type=generate_video',
        },
        speechRequest: {
          type: 'object',
          description: '{text,providerId,voice?,format?} — required for type=generate_speech',
        },
        exportRequest: {
          type: 'object',
          description: '{sourceTaskId,profiles?,coverAtSec?,subtitles?,publish?} — required for type=export; local packaging only (no platform upload)',
        },
        project: { type: 'string' },
        idempotencyKey: { type: 'string' },
      },
      required: ['type'],
    },
  },
  {
    name: 'media_run_task',
    description: 'Start a task created by media_create_task in the background; returns immediately with the current snapshot',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' }, project: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'media_wait_task',
    description: 'Wait up to maxSeconds (default 25, cap 50) for a task to reach a terminal status; never starts execution',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        maxSeconds: { type: 'number', minimum: 1, maximum: WAIT_MAX_SECONDS },
        project: { type: 'string' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'media_estimate_cost',
    description: 'Estimate the CNY cost of an action before running it; returns null when the provider price is not confirmed',
    inputSchema: {
      type: 'object',
      properties: {
        actionId: { type: 'string', description: 'Action id, for example media.generate_image' },
        params: { type: 'object', description: 'Same request params the action would receive' },
      },
      required: ['actionId'],
    },
  },
  {
    name: 'media_render_storyboard',
    description: 'Create AND run a storyboard render task synchronously (convenience; prefer media_create_task + media_run_task + media_wait_task for long jobs)',
    inputSchema: {
      type: 'object',
      properties: {
        storyboard: { type: 'object' },
        project: { type: 'string' },
        idempotencyKey: { type: 'string' },
      },
      required: ['storyboard'],
    },
  },
  {
    name: 'media_generate_image',
    description: 'Create AND run an image generation task synchronously (convenience; prefer the async create/run/wait chain for long jobs)',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        size: { type: 'string', description: 'WxH, default 1024x1024' },
        providerId: { type: 'string', description: 'default openai-compatible (requires MEDIA_OPENAI_API_KEY); mock needs no config' },
        project: { type: 'string' },
        idempotencyKey: { type: 'string' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'media_get_task',
    description: 'Get one media task (status, outputs, evidence)',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' }, project: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'media_list_tasks',
    description: 'List media tasks in a project',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } } },
  },
  {
    name: 'media_cancel_task',
    description: 'Cancel a media task (cooperative between stages)',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' }, project: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'media_retry_task',
    description: 'Retry a failed/interrupted media task',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' }, project: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'media_recover_tasks',
    description: 'Mark tasks left mid-flight by a dead process as interrupted',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } } },
  },
  {
    name: 'media_get_evidence',
    description: 'Get the evidence timeline of a media task',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' }, project: { type: 'string' } },
      required: ['taskId'],
    },
  },
]

export interface MediaToolCallOptions {
  /** workspace root — defaults to process.cwd() (the served project); tests inject a temp dir */
  root?: string
}

export async function handleMediaToolCall(
  name: string,
  args: Record<string, unknown>,
  options: MediaToolCallOptions = {},
): Promise<unknown> {
  const root = options.root ?? process.cwd()
  try {
    switch (name) {
      case 'media_list_providers':
        return { providers: listProviders(), features: listProviderFeatures() }
      case 'media_list_approvals':
        return { approvals: listProjectApprovals(root, projectOf(args)) }
      case 'media_validate_storyboard': {
        const result = validateStoryboard(args.storyboard)
        return result
      }
      case 'media_create_task': {
        const requested = typeof args.type === 'string' ? args.type : 'render'
        if (!CREATE_TASK_TYPES.includes(requested)) {
          const declared = getActionForTool('media_create_task', requested)
          if (declared) {
            throw new MediaError(
              'MEDIA_ACTION_UNAVAILABLE',
              `media action "${declared.id}" is declared for ${declared.availableIn} but is not implemented in this build`,
            )
          }
          throw new MediaError('MEDIA_ACTION_UNKNOWN', `unknown media task type "${requested}"`)
        }
        const type = requested as ImplementedCreateType
        const created = createJob({
          root,
          projectId: projectOf(args),
          type,
          storyboard: type === 'render' ? (args.storyboard as Storyboard) : undefined,
          imageRequest: type === 'generate_image' ? (args.imageRequest as Partial<ImageJobRequest>) : undefined,
          videoRequest: type === 'generate_video' ? (args.videoRequest as Partial<VideoJobRequest>) : undefined,
          speechRequest: type === 'generate_speech' ? (args.speechRequest as Partial<SpeechJobRequest>) : undefined,
          exportRequest: type === 'export' ? (args.exportRequest as Partial<ExportJobRequest>) : undefined,
          requestedBy: 'mcp',
          idempotencyKey: typeof args.idempotencyKey === 'string' ? args.idempotencyKey : undefined,
        })
        return { ...jobSummary(created.job), deduplicated: created.deduplicated }
      }
      case 'media_run_task': {
        const projectId = projectOf(args)
        const taskId = String(args.taskId)
        const { job } = getJob(root, projectId, taskId)
        if (job.status === 'awaiting_approval') {
          throw new MediaError(
            'MEDIA_APPROVAL_REQUIRED',
            `task "${job.id}" is awaiting approval "${job.approval?.id ?? 'unknown'}"; decide it in the dashboard before running`,
          )
        }
        if (job.status !== 'created') {
          throw new MediaError(
            'MEDIA_ACTION_INVALID_STATE',
            `task "${job.id}" in status "${job.status}" cannot be run; only created tasks can be started (use media_retry_task for failed/interrupted tasks)`,
          )
        }
        let startError: unknown
        const running = runJob({ root, projectId, taskId: job.id, expectedStatus: 'created' })
        void running.catch(error => { startError = error })
        // The status re-check happens under the run lock, so a start that lost
        // a cross-process race rejects here; give that rejection one turn to
        // surface, then return immediately (callers poll with media_wait_task).
        await new Promise<void>(resolve => setImmediate(resolve))
        if (startError) throw startError
        const current = getJob(root, projectId, job.id).job
        return { ...jobSummary(current), started: current.status !== 'created' }
      }
      case 'media_wait_task': {
        const projectId = projectOf(args)
        const taskId = String(args.taskId)
        const deadline = Date.now() + waitSeconds(args.maxSeconds) * 1000
        let current = getJob(root, projectId, taskId).job
        while (!WAIT_TERMINAL[current.status] && Date.now() < deadline) {
          await sleep(WAIT_POLL_MS)
          current = getJob(root, projectId, taskId).job
        }
        return { done: WAIT_TERMINAL[current.status], job: jobSummary(current) }
      }
      case 'media_estimate_cost': {
        const actionId = typeof args.actionId === 'string' ? args.actionId : ''
        return estimateCost(actionId, asRecord(args.params) ?? {})
      }
      case 'media_render_storyboard': {
        const created = createJob({
          root,
          projectId: projectOf(args),
          type: 'render',
          storyboard: args.storyboard as Storyboard,
          requestedBy: 'mcp',
          idempotencyKey: typeof args.idempotencyKey === 'string' ? args.idempotencyKey : undefined,
        })
        const job = await runJob({ root, projectId: projectOf(args), taskId: created.job.id })
        return jobSummary(job)
      }
      case 'media_generate_image': {
        const created = createJob({
          root,
          projectId: projectOf(args),
          type: 'generate_image',
          imageRequest: {
            prompt: String(args.prompt ?? ''),
            size: typeof args.size === 'string' ? args.size : '1024x1024',
            providerId: typeof args.providerId === 'string' ? args.providerId : 'openai-compatible',
          },
          requestedBy: 'mcp',
          idempotencyKey: typeof args.idempotencyKey === 'string' ? args.idempotencyKey : undefined,
        })
        const job = await runJob({ root, projectId: projectOf(args), taskId: created.job.id })
        return jobSummary(job)
      }
      case 'media_get_task': {
        const { job } = getJob(root, projectOf(args), String(args.taskId))
        return jobSummary(job)
      }
      case 'media_list_tasks':
        return { tasks: listProjectJobs(root, projectOf(args)).map(jobSummary) }
      case 'media_cancel_task':
        return jobSummary(cancelJob(root, projectOf(args), String(args.taskId)))
      case 'media_retry_task': {
        const job = await retryJob({ root, projectId: projectOf(args), taskId: String(args.taskId) })
        return jobSummary(job)
      }
      case 'media_recover_tasks':
        return { recovered: recoverJobs(root, projectOf(args)) }
      case 'media_get_evidence': {
        const { taskDir, job } = getJob(root, projectOf(args), String(args.taskId))
        const { EvidenceWriter } = await import('./evidence/EvidenceWriter.js')
        return { taskId: job.id, evidence: new EvidenceWriter(taskDir, job.id).readAll() }
      }
      default:
        throw new Error(`Unknown media tool: ${name}`)
    }
  } catch (error) {
    return errorPayload(error)
  }
}
