// media_* MCP tools (v3 plan §11): thin adapters over the same JobService the
// CLI and Dashboard use. No arbitrary-path tools, no raw FFmpeg access — task
// ids and validated payloads only. Large media is returned as metadata + task
// references, never as base64 blobs in the conversation.

import type { MCPTool } from '../api/mcp.js'
import {
  cancelJob,
  createJob,
  getJob,
  listProjectJobs,
  listProviders,
  recoverJobs,
  retryJob,
  runJob,
  validateStoryboard,
  MediaError,
  type ImageJobRequest,
  type Storyboard,
} from './index.js'

function projectOf(args: Record<string, unknown>): string | undefined {
  return typeof args.project === 'string' && args.project.trim() ? args.project.trim() : undefined
}

function errorPayload(error: unknown): { error: { code: string; message: string; retryable: boolean } } {
  if (error instanceof MediaError) return { error: error.toJSON() }
  return { error: { code: 'MEDIA_RENDER_FAILED', message: error instanceof Error ? error.message : String(error), retryable: false } }
}

function jobSummary(job: ReturnType<typeof getJob>['job']): Record<string, unknown> {
  return {
    taskId: job.id,
    type: job.type,
    status: job.status,
    attempt: job.attempt,
    error: job.error,
    outputs: job.outputs.map(output => ({ path: output.path, bytes: output.bytes, sha256: output.sha256, kind: output.kind })),
  }
}

export const MEDIA_MCP_TOOLS: MCPTool[] = [
  {
    name: 'media_list_providers',
    description: 'List media providers with config status (no secrets)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'media_validate_storyboard',
    description: 'Validate a storyboard (Scene DSL v0.1) without rendering',
    inputSchema: {
      type: 'object',
      properties: { storyboard: { type: 'object', description: 'Scene DSL storyboard' } },
      required: ['storyboard'],
    },
  },
  {
    name: 'media_create_task',
    description: 'Create a media task (render or generate_image) without running it',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['render', 'generate_image'] },
        storyboard: { type: 'object', description: 'Required for type=render' },
        imageRequest: { type: 'object', description: '{prompt,size,providerId} — required for type=generate_image' },
        project: { type: 'string' },
        idempotencyKey: { type: 'string' },
      },
      required: ['type'],
    },
  },
  {
    name: 'media_render_storyboard',
    description: 'Create AND run a storyboard render task (blocks until done, ~seconds to minutes)',
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
    description: 'Create AND run an image generation task (blocks until done)',
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
        return { providers: listProviders() }
      case 'media_validate_storyboard': {
        const result = validateStoryboard(args.storyboard)
        return result
      }
      case 'media_create_task': {
        const type = args.type === 'generate_image' ? 'generate_image' : 'render'
        const created = createJob({
          root,
          projectId: projectOf(args),
          type,
          storyboard: type === 'render' ? (args.storyboard as Storyboard) : undefined,
          imageRequest: type === 'generate_image' ? (args.imageRequest as Partial<ImageJobRequest>) : undefined,
          requestedBy: 'mcp',
          idempotencyKey: typeof args.idempotencyKey === 'string' ? args.idempotencyKey : undefined,
        })
        return { ...jobSummary(created.job), deduplicated: created.deduplicated }
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
