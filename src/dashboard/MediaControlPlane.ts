// Media control plane (v3 plan §10): REST surface over the src/media
// JobService — same business layer as the CLI, no duplicated logic. Dashboard
// is an API consumer only; all writes are server-side validated (storyboard
// schema, task ids) and long renders run detached with 202 semantics.

import type { Context, Hono } from 'hono'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { timingSafeEqual } from 'node:crypto'
import {
  cancelJob,
  createJob,
  decideJobApproval,
  getJob,
  listProjectApprovals,
  listProjectJobs,
  openWorkspace,
  projectBudgetSummary,
  readJobEvents,
  readJobStoryboard,
  recoverJobs,
  resolveMediaBin,
  runJob,
  validateStoryboard,
  assertAssetRefsAvailable,
  assetRefTaskPath,
  parseAssetRef,
  listTaskDirs,
  listTemplates,
  planTemplate,
  assembleTemplate,
  EvidenceWriter,
  MediaError,
  type ExportJobRequest,
  type ImageJobRequest,
  type MediaJobType,
  type SpeechJobRequest,
  type Storyboard,
  type VideoJobRequest,
} from '../media/index.js'
import { listProviderFeatures, listProviders } from '../media/providers/ProviderRegistry.js'

export interface MediaApiOptions {
  projectDir: string
  /**
   * When set (or via MEDIA_APPROVAL_TOKEN / SCALE_MEDIA_APPROVAL_TOKEN),
   * approval decisions require the `x-media-approval-token` (or `x-scale-token`)
   * header. Without it, decisions are accepted only from loopback (ADR-7) —
   * never from a remote dashboard client.
   */
  approvalToken?: string
}

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt',
  '.json': 'application/json',
}

interface ApiFailure {
  ok: false
  code: string
  error: string
  retryable?: boolean
}

function toFailure(error: unknown): ApiFailure {
  if (error instanceof MediaError) {
    return { ok: false, code: error.code, error: error.message, retryable: error.retryable }
  }
  return { ok: false, code: 'MEDIA_RENDER_FAILED', error: error instanceof Error ? error.message : String(error) }
}

type FailureStatus = 400 | 402 | 403 | 404 | 409 | 500 | 503 | 507

function failureStatus(error: unknown): FailureStatus {
  if (error instanceof MediaError) {
    if (error.code === 'MEDIA_JOB_NOT_FOUND') return 404
    if (error.code === 'MEDIA_APPROVAL_FORBIDDEN') return 403
    if (
      error.code === 'MEDIA_JOB_STATE' ||
      error.code === 'MEDIA_LOCK_TIMEOUT' ||
      error.code === 'MEDIA_ACTION_INVALID_STATE' ||
      error.code === 'MEDIA_APPROVAL_REQUIRED' ||
      error.code === 'MEDIA_APPROVAL_EXPIRED'
    ) return 409
    if (error.code === 'MEDIA_APPROVAL_INVALID') return 400
    if (error.code === 'MEDIA_BUDGET_EXCEEDED') return 402
    if (error.code === 'MEDIA_QUOTA_EXCEEDED' || error.code === 'MEDIA_DISK_LOW') return 507
    if (error.code === 'MEDIA_PROVIDER_UNAVAILABLE') return 503
    if (
      error.code === 'MEDIA_STORYBOARD_INVALID' ||
      error.code === 'MEDIA_ASSET_REF_INVALID' ||
      error.code === 'MEDIA_ASSET_REF_MISSING' ||
      error.code === 'MEDIA_ASSET_REF_CORRUPT' ||
      error.code === 'MEDIA_IMAGE_REQUEST_INVALID' ||
      error.code === 'MEDIA_VIDEO_REQUEST_INVALID' ||
      error.code === 'MEDIA_EXPORT_REQUEST_INVALID' ||
      error.code === 'MEDIA_EXPORT_SOURCE_INVALID' ||
      error.code === 'MEDIA_SPEECH_REQUEST_INVALID'
    ) return 400
    if (error.code === 'MEDIA_ACTION_UNAVAILABLE' || error.code === 'MEDIA_ACTION_UNKNOWN') return 400
  }
  return 500
}

function failResponse(c: Context, error: unknown): Response {
  return c.newResponse(JSON.stringify(toFailure(error)), failureStatus(error), { 'content-type': 'application/json' })
}

function remoteAddress(c: Context): string | undefined {
  // @hono/node-server exposes the raw Node request as c.env.incoming
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
  return env?.incoming?.socket?.remoteAddress
}

function isLoopback(address: string | undefined): boolean {
  if (!address) return false
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * Approval decisions are privileged (they release spend). Accept them only
 * from a loopback caller or with the configured token — the dashboard binds
 * 0.0.0.0, so "same machine" is not implied by reaching the route.
 */
function assertApprovalAccess(c: Context, token: string | undefined): string {
  // MEDIA_* stays the canonical name; SCALE_MEDIA_APPROVAL_TOKEN is honored so
  // the plan's documented env keeps working (both, plus the plan's header).
  const expected =
    token?.trim() ||
    process.env.MEDIA_APPROVAL_TOKEN?.trim() ||
    process.env.SCALE_MEDIA_APPROVAL_TOKEN?.trim()
  if (expected) {
    const provided = c.req.header('x-media-approval-token') ?? c.req.header('x-scale-token') ?? ''
    const providedBuffer = Buffer.from(provided)
    const expectedBuffer = Buffer.from(expected)
    if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
      throw new MediaError('MEDIA_APPROVAL_FORBIDDEN', 'approval decisions require the configured token')
    }
    return 'token'
  }
  if (!isLoopback(remoteAddress(c))) {
    throw new MediaError(
      'MEDIA_APPROVAL_FORBIDDEN',
      'approval decisions are accepted only from loopback; set MEDIA_APPROVAL_TOKEN to allow remote decisions',
    )
  }
  return 'loopback'
}

function parseProject(value: string | undefined): string {
  const project = (value ?? 'default').trim()
  if (!/^[\w-]{1,64}$/.test(project)) throw new MediaError('MEDIA_WORKSPACE_ERROR', 'illegal project id')
  return project
}

async function readJsonBody(request: { json: () => Promise<unknown> }): Promise<Record<string, unknown>> {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  return body ?? {}
}

/** `slots` is the only untrusted part of template requests; reject non-objects. */
function readSlotValues(body: Record<string, unknown>): Record<string, unknown> {
  const raw = body.slots
  if (raw === undefined) return {}
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new MediaError('MEDIA_STORYBOARD_INVALID', 'slots must be an object keyed by slot name')
  }
  return raw as Record<string, unknown>
}

/** Gallery entries for a project: committed outputs plus input assets. */
function scanProjectAssets(projectDir: string, projectId: string): Array<Record<string, unknown>> {
  const workspace = openWorkspace(projectDir, projectId)
  const entries: Array<Record<string, unknown>> = []
  for (const taskId of listTaskDirs(workspace)) {
    const taskDir = join(workspace.tasksDir, taskId)
    for (const relDir of ['output', 'assets']) {
      const base = join(taskDir, relDir)
      if (!existsSync(base)) continue
      collectFiles(base, base, taskId, relDir, entries)
    }
  }
  return entries
}

function collectFiles(base: string, dir: string, taskId: string, scope: string, out: Array<Record<string, unknown>>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectFiles(base, path, taskId, scope, out)
      continue
    }
    const stats = statSync(path)
    out.push({
      taskId,
      scope,
      path: `${scope}/${path.slice(base.length + 1).split('\\').join('/')}`,
      bytes: stats.size,
      mtime: stats.mtime.toISOString(),
    })
  }
}

export function registerMediaApi(app: Hono, options: MediaApiOptions): void {
  const root = options.projectDir

  app.get('/api/media/health', (c) => {
    const ffmpeg = resolveMediaBin('ffmpeg')
    const ffprobe = resolveMediaBin('ffprobe')
    let playwright = 'installed'
    try {
      createRequire(import.meta.url).resolve('playwright')
    } catch {
      playwright = 'missing'
    }
    return c.json({
      ffmpeg: ffmpeg ?? 'missing',
      ffprobe: ffprobe ?? 'missing',
      playwright,
      workspace: join(root, 'media'),
    })
  })

  app.get('/api/media/providers', (c) => {
    return c.json({ providers: listProviders(), features: listProviderFeatures() })
  })

  // Template wizard (M3): metadata, pure preview, strict assembly. None of
  // these routes create a task or touch the filesystem — the wizard then calls
  // the normal task API for every generation and for the final render.
  app.get('/api/media/templates', (c) => {
    return c.json({ templates: listTemplates() })
  })

  app.post('/api/media/plan', async (c) => {
    try {
      const body = await readJsonBody(c.req)
      const templateId = typeof body.templateId === 'string' ? body.templateId : ''
      if (!templateId) throw new MediaError('MEDIA_ACTION_UNKNOWN', 'templateId is required')
      return c.json({ ok: true, plan: planTemplate(templateId, readSlotValues(body)) })
    } catch (error) {
      return failResponse(c, error)
    }
  })

  app.post('/api/media/templates/:id/assemble', async (c) => {
    try {
      const body = await readJsonBody(c.req)
      const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : undefined
      const storyboard = assembleTemplate(
        c.req.param('id'),
        readSlotValues(body),
        title ? { title } : {},
      )
      return c.json({ ok: true, storyboard })
    } catch (error) {
      return failResponse(c, error)
    }
  })

  app.get('/api/media/approvals', (c) => {
    try {
      const project = parseProject(c.req.query('project'))
      return c.json({ approvals: listProjectApprovals(root, project) })
    } catch (error) {
      return failResponse(c, error)
    }
  })

  app.post('/api/media/approvals/:approvalId/decide', async (c) => {
    try {
      const project = parseProject(c.req.query('project'))
      const decisionSource = assertApprovalAccess(c, options.approvalToken)
      const body = await readJsonBody(c.req)
      if (typeof body.approve !== 'boolean') {
        throw new MediaError('MEDIA_APPROVAL_INVALID', 'body.approve must be a boolean')
      }
      const actorHeader = c.req.header('x-media-approval-actor')?.trim() ?? ''
      const actor = actorHeader && /^[\w .@-]{1,80}$/.test(actorHeader) ? actorHeader : decisionSource
      const result = decideJobApproval({
        root,
        projectId: project,
        approvalId: c.req.param('approvalId'),
        approve: body.approve,
        decidedBy: actor,
        ...(typeof body.reason === 'string' ? { reason: body.reason.slice(0, 500) } : {}),
      })
      // Plan M2: an approval may start the work in the same round-trip. Only a
      // `created` task can start; anything else keeps the plain decide result.
      if (body.run === true && result.job?.status === 'created') {
        void runJob({ root, projectId: project, taskId: result.job.id, expectedStatus: 'created' }).catch(() => undefined)
        return c.json({ ok: true, ...result, started: true }, 202)
      }
      return c.json({ ok: true, ...result })
    } catch (error) {
      return failResponse(c, error)
    }
  })

  app.get('/api/media/budget', (c) => {
    try {
      const project = parseProject(c.req.query('project'))
      return c.json({ budget: projectBudgetSummary(root, project) })
    } catch (error) {
      return failResponse(c, error)
    }
  })

  app.get('/api/media/projects', (c) => {
    const projectsRoot = join(root, 'media', 'projects')
    const projects = existsSync(projectsRoot)
      ? readdirSync(projectsRoot, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
      : []
    return c.json({ projects })
  })

  app.get('/api/media/tasks', (c) => {
    const project = parseProject(c.req.query('project'))
    return c.json({ tasks: listProjectJobs(root, project) })
  })

  app.get('/api/media/tasks/:taskId', (c) => {
    try {
      const project = parseProject(c.req.query('project'))
      const { job, taskDir } = getJob(root, project, c.req.param('taskId'))
      let storyboard: unknown
      try {
        storyboard = readJobStoryboard(root, project, job.id)
      } catch {
        storyboard = null
      }
      const evidence = new EvidenceWriter(taskDir, job.id).readAll()
      return c.json({ job, storyboard, evidence, events: readJobEvents(taskDir) })
    } catch (error) {
      return failResponse(c, error)
    }
  })

  app.post('/api/media/tasks', async (c) => {
    try {
      const body = await readJsonBody(c.req)
      const project = parseProject(c.req.query('project') || (typeof body.project === 'string' ? body.project : undefined))
      const type = (typeof body.type === 'string' ? body.type : 'render') as MediaJobType
      if (type === 'render') {
        const validation = validateStoryboard(body.storyboard)
        if (!validation.ok) {
          throw new MediaError('MEDIA_STORYBOARD_INVALID', validation.errors.join('; '))
        }
      }
      const created = createJob({
        root,
        projectId: project,
        type,
        storyboard: type === 'render' ? (body.storyboard as Storyboard) : undefined,
        imageRequest: type === 'generate_image' ? (body.imageRequest as Partial<ImageJobRequest>) : undefined,
        videoRequest: type === 'generate_video' ? (body.videoRequest as Partial<VideoJobRequest>) : undefined,
        speechRequest: type === 'generate_speech' ? (body.speechRequest as Partial<SpeechJobRequest>) : undefined,
        exportRequest: type === 'export' ? (body.exportRequest as Partial<ExportJobRequest>) : undefined,
        requestedBy: 'dashboard',
        idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
      })
      // Awaiting approval: nothing runs until a human decides (ADR-7).
      if (created.job.status === 'awaiting_approval') {
        return c.json({ ok: true, taskId: created.job.id, status: created.job.status, approval: created.job.approval, deduplicated: created.deduplicated }, 202)
      }
      if (created.deduplicated && !['created', 'validated', 'failed', 'interrupted'].includes(created.job.status)) {
        return c.json({ ok: true, taskId: created.job.id, deduplicated: true, job: created.job }, 200)
      }
      // 202: run detached — the dashboard polls GET /tasks/:id (v3 §10.1)
      void runJob({ root, projectId: project, taskId: created.job.id }).catch(() => undefined)
      return c.json({ ok: true, taskId: created.job.id, deduplicated: created.deduplicated }, 202)
    } catch (error) {
      return failResponse(c, error)
    }
  })

  app.post('/api/media/tasks/:taskId/run', async (c) => {
    try {
      const project = parseProject(c.req.query('project'))
      const taskId = c.req.param('taskId')
      const { job } = getJob(root, project, taskId)
      // Same message as MCP: an awaiting task is blocked on a human, not on
      // its state machine — tell the client what to do (decide the approval).
      if (job.status === 'awaiting_approval') {
        throw new MediaError(
          'MEDIA_APPROVAL_REQUIRED',
          `task "${job.id}" is awaiting approval "${job.approval?.id ?? 'unknown'}"; decide it before running`,
        )
      }
      if (job.status !== 'created') {
        throw new MediaError(
          'MEDIA_ACTION_INVALID_STATE',
          `task "${job.id}" in status "${job.status}" cannot be run; only created tasks can be started (use retry for failed/interrupted tasks)`,
        )
      }
      // 202: detached run — clients poll GET /tasks/:id (v3 §10.1). The
      // expected-status check runs under the lock, so a concurrent start
      // rejects instead of double-running; surface that before returning 202.
      let startError: unknown
      const running = runJob({ root, projectId: project, taskId: job.id, expectedStatus: 'created' })
      void running.catch(error => { startError = error })
      await new Promise<void>(resolve => setImmediate(resolve))
      if (startError) throw startError
      return c.json({ ok: true, taskId: job.id, job: getJob(root, project, job.id).job }, 202)
    } catch (error) {
      return failResponse(c, error)
    }
  })

  app.post('/api/media/tasks/:taskId/cancel', (c) => {
    try {
      const project = parseProject(c.req.query('project'))
      return c.json({ ok: true, job: cancelJob(root, project, c.req.param('taskId')) })
    } catch (error) {
      return failResponse(c, error)
    }
  })

  app.post('/api/media/tasks/:taskId/retry', (c) => {
    try {
      const project = parseProject(c.req.query('project'))
      void runJob({ root, projectId: project, taskId: c.req.param('taskId') })
        .then(job => ({ status: job.status }))
        .catch(() => undefined)
      return c.json({ ok: true, taskId: c.req.param('taskId') }, 202)
    } catch (error) {
      return failResponse(c, error)
    }
  })

  app.get('/api/media/tasks/:taskId/evidence', (c) => {
    try {
      const project = parseProject(c.req.query('project'))
      const { taskDir, job } = getJob(root, project, c.req.param('taskId'))
      return c.json({ taskId: job.id, evidence: new EvidenceWriter(taskDir, job.id).readAll() })
    } catch (error) {
      return failResponse(c, error)
    }
  })

  app.get('/api/media/tasks/:taskId/storyboard', (c) => {
    try {
      const project = parseProject(c.req.query('project'))
      return c.json({ storyboard: readJobStoryboard(root, project, c.req.param('taskId')) })
    } catch (error) {
      return failResponse(c, error)
    }
  })

  app.put('/api/media/tasks/:taskId/storyboard', async (c) => {
    try {
      const project = parseProject(c.req.query('project'))
      const { taskDir, job } = getJob(root, project, c.req.param('taskId'))
      if (job.type !== 'render') {
        throw new MediaError('MEDIA_JOB_STATE', `task type "${job.type}" has no editable storyboard`)
      }
      // awaiting_approval is frozen too: the decision was made against a
      // specific estimate, and editing now would invalidate it.
      if (['running', 'packaging', 'succeeded', 'awaiting_approval'].includes(job.status)) {
        throw new MediaError('MEDIA_JOB_STATE', `storyboard is frozen while task is ${job.status}`)
      }
      const body = await readJsonBody(c.req)
      const validation = validateStoryboard(body.storyboard)
      if (!validation.ok) {
        throw new MediaError('MEDIA_STORYBOARD_INVALID', validation.errors.join('; '))
      }
      // same create-time rule for edits: an asset:// ref must already resolve
      assertAssetRefsAvailable(openWorkspace(root, project), body.storyboard as Storyboard)
      const { writeFileSync } = await import('node:fs')
      writeFileSync(join(taskDir, 'storyboard.json'), JSON.stringify(body.storyboard, null, 1), 'utf-8')
      return c.json({ ok: true, storyboard: body.storyboard })
    } catch (error) {
      return failResponse(c, error)
    }
  })

  app.get('/api/media/assets', (c) => {
    try {
      const project = parseProject(c.req.query('project'))
      return c.json({ assets: scanProjectAssets(root, project) })
    } catch (error) {
      return failResponse(c, error)
    }
  })

  // controlled binary serving for gallery previews — path must resolve inside
  // the task directory and carry a whitelisted media extension (v3 §10.1)
  app.get('/api/media/assets/content', (c) => {
    try {
      const project = parseProject(c.req.query('project'))
      const refParam = c.req.query('ref')
      const taskIdParam = c.req.query('taskId') ?? ''
      const pathParam = c.req.query('path') ?? ''
      let relativePath: string
      let taskDir: string
      if (refParam) {
        // M1: preview an asset:// source directly. The ref carries its own
        // task id, so mixing in taskId/path would be ambiguous.
        if (taskIdParam || pathParam) {
          throw new MediaError('MEDIA_ASSET_REF_INVALID', 'pass either ref or taskId/path, not both')
        }
        const ref = parseAssetRef(refParam)
        relativePath = assetRefTaskPath(ref)
        taskDir = getJob(root, project, ref.taskId).taskDir
      } else {
        relativePath = pathParam
        taskDir = getJob(root, project, taskIdParam).taskDir
      }
      if (!/^[\w./-]+$/.test(relativePath) || relativePath.includes('..')) {
        throw new MediaError('MEDIA_ASSET_REF_INVALID', 'illegal asset path')
      }
      const extension = relativePath.slice(relativePath.lastIndexOf('.')).toLowerCase()
      const contentType = CONTENT_TYPES[extension]
      if (!contentType) throw new MediaError('MEDIA_ASSET_REF_INVALID', `extension not previewable: ${extension}`)
      // path.relative containment (same helper pattern as materialize.ts):
      // sibling dirs sharing a prefix (job-1 / job-10) cannot slip through.
      const base = resolve(taskDir)
      const absolute = resolve(base, relativePath)
      const rel = relative(base, absolute)
      if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
        throw new MediaError('MEDIA_ASSET_REF_INVALID', 'asset escapes the task directory')
      }
      if (!existsSync(absolute) || !statSync(absolute).isFile()) {
        throw new MediaError('MEDIA_JOB_NOT_FOUND', `asset not found: ${relativePath}`)
      }
      return c.newResponse(readFileSync(absolute), 200, {
        'content-type': contentType,
        'x-content-type-options': 'nosniff',
      })
    } catch (error) {
      return failResponse(c, error)
    }
  })

  app.post('/api/media/recover', (c) => {
    try {
      const project = parseProject(c.req.query('project'))
      return c.json({ ok: true, recovered: recoverJobs(root, project) })
    } catch (error) {
      return failResponse(c, error)
    }
  })
}
