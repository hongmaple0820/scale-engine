// Media control plane (v3 plan §10): REST surface over the src/media
// JobService — same business layer as the CLI, no duplicated logic. Dashboard
// is an API consumer only; all writes are server-side validated (storyboard
// schema, task ids) and long renders run detached with 202 semantics.

import type { Context, Hono } from 'hono'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import {
  cancelJob,
  createJob,
  getJob,
  listProjectJobs,
  openWorkspace,
  readJobEvents,
  readJobStoryboard,
  recoverJobs,
  resolveMediaBin,
  runJob,
  validateStoryboard,
  listTaskDirs,
  EvidenceWriter,
  MediaError,
  type Storyboard,
} from '../media/index.js'
import { listProviders } from '../media/providers/ProviderRegistry.js'

export interface MediaApiOptions {
  projectDir: string
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
  '.srt': 'text/plain; charset=utf-8',
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

function failureStatus(error: unknown): 400 | 404 | 409 | 500 {
  if (error instanceof MediaError) {
    if (error.code === 'MEDIA_JOB_NOT_FOUND') return 404
    if (error.code === 'MEDIA_JOB_STATE' || error.code === 'MEDIA_LOCK_TIMEOUT') return 409
    if (error.code === 'MEDIA_STORYBOARD_INVALID' || error.code === 'MEDIA_ASSET_REF_INVALID') return 400
  }
  return 500
}

function failResponse(c: Context, error: unknown): Response {
  return c.newResponse(JSON.stringify(toFailure(error)), failureStatus(error), { 'content-type': 'application/json' })
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
    return c.json({ providers: listProviders() })
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
      const validation = validateStoryboard(body.storyboard)
      if (!validation.ok) {
        throw new MediaError('MEDIA_STORYBOARD_INVALID', validation.errors.join('; '))
      }
      const created = createJob({
        root,
        projectId: project,
        storyboard: body.storyboard as Storyboard,
        requestedBy: 'dashboard',
        idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
      })
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
      if (['running', 'packaging', 'succeeded'].includes(job.status)) {
        throw new MediaError('MEDIA_JOB_STATE', `storyboard is frozen while task is ${job.status}`)
      }
      const body = await readJsonBody(c.req)
      const validation = validateStoryboard(body.storyboard)
      if (!validation.ok) {
        throw new MediaError('MEDIA_STORYBOARD_INVALID', validation.errors.join('; '))
      }
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
      const taskId = c.req.query('taskId') ?? ''
      const relative = c.req.query('path') ?? ''
      const { taskDir } = getJob(root, project, taskId)
      if (!/^[\w./-]+$/.test(relative) || relative.includes('..')) {
        throw new MediaError('MEDIA_ASSET_REF_INVALID', 'illegal asset path')
      }
      const extension = relative.slice(relative.lastIndexOf('.')).toLowerCase()
      const contentType = CONTENT_TYPES[extension]
      if (!contentType) throw new MediaError('MEDIA_ASSET_REF_INVALID', `extension not previewable: ${extension}`)
      const absolute = join(taskDir, relative)
      const base = join(taskDir).toLowerCase()
      if (!absolute.toLowerCase().startsWith(base)) {
        throw new MediaError('MEDIA_ASSET_REF_INVALID', 'asset escapes the task directory')
      }
      if (!existsSync(absolute) || !statSync(absolute).isFile()) {
        throw new MediaError('MEDIA_JOB_NOT_FOUND', `asset not found: ${relative}`)
      }
      return c.newResponse(readFileSync(absolute), 200, { 'content-type': contentType })
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
