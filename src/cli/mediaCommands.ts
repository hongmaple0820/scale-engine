// SCALE Engine — media workflow commands (v3 plan §9).
// Everything routes through src/media JobService — no business logic here.

import { defineCommand } from 'citty'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import {
  cancelJob,
  createJob,
  decideJobApproval,
  expandStoryboardTemplate,
  getJob,
  listProjectApprovals,
  listProjectJobs,
  listProviders,
  openWorkspace,
  recoverJobs,
  retryJob,
  resolveMediaBin,
  runJob,
  runGc,
  validateStoryboard,
  isExportProfileId,
  EvidenceWriter,
  MediaError,
} from '../media/index.js'

function fail(error: unknown): void {
  if (error instanceof MediaError) {
    console.error(JSON.stringify(error.toJSON(), null, 1))
  } else {
    console.error(error instanceof Error ? error.message : String(error))
  }
  process.exitCode = 1
}

function printJob(job: ReturnType<typeof getJob>['job'], json: boolean): void {
  if (json) {
    console.log(JSON.stringify(job, null, 1))
    return
  }
  const errorLine = job.error ? `\n  error      : ${job.error.code} — ${job.error.message}` : ''
  const outputs = job.outputs.map(output => `\n  output     : ${output.path} (${output.bytes} bytes, sha256 ${output.sha256.slice(0, 12)}…)`).join('')
  console.log(
    `  task       : ${job.id}\n` +
      `  status     : ${job.status}${job.stage ? ` (${job.stage})` : ''}\n` +
      `  project    : ${job.projectId}\n` +
      `  attempt    : ${job.attempt}\n` +
      `  created    : ${job.createdAt}` +
      errorLine +
      outputs,
  )
}

const validateCommand = defineCommand({
  meta: { name: 'validate', description: 'Validate a storyboard (Scene DSL v0.1) without rendering' },
  args: {
    storyboard: { type: 'positional', required: true, description: 'Path to storyboard JSON' },
    json: { type: 'boolean', default: false, description: 'Machine-readable output' },
  },
  run({ args }) {
    const raw = JSON.parse(readFileSync(resolve(String(args.storyboard)), 'utf-8'))
    const result = validateStoryboard(raw)
    if (args.json) {
      console.log(JSON.stringify(result, null, 1))
    } else if (result.ok) {
      console.log('✅ storyboard valid')
    } else {
      console.error(`❌ storyboard rejected:\n- ${result.errors.join('\n- ')}`)
      process.exitCode = 1
    }
  },
})

const renderCommand = defineCommand({
  meta: { name: 'render', description: 'Create and run a render job from a storyboard' },
  args: {
    storyboard: { type: 'positional', required: true, description: 'Path to storyboard JSON' },
    root: { type: 'string', default: '.', description: 'Workspace root (media/ lives here)' },
    project: { type: 'string', default: 'default', description: 'Project id' },
    'idempotency-key': { type: 'string', required: false, description: 'Dedupe repeated submissions' },
    ffmpeg: { type: 'string', required: false, description: 'Explicit ffmpeg path' },
    ffprobe: { type: 'string', required: false, description: 'Explicit ffprobe path' },
    json: { type: 'boolean', default: false, description: 'Machine-readable output' },
  },
  async run({ args }) {
    try {
      const raw = JSON.parse(readFileSync(resolve(String(args.storyboard)), 'utf-8'))
      const created = createJob({
        root: String(args.root),
        projectId: String(args.project),
        storyboard: raw,
        requestedBy: 'cli',
        idempotencyKey: args['idempotency-key'] ? String(args['idempotency-key']) : undefined,
      })
      if (!args.json) {
        console.log(created.deduplicated ? `↩︎ idempotent hit — returning existing task ${created.job.id}` : `task created: ${created.job.id}`)
      }
      const job = await runJob({
        root: String(args.root),
        projectId: String(args.project),
        taskId: created.job.id,
        ffmpegBin: args.ffmpeg ? String(args.ffmpeg) : undefined,
        ffprobeBin: args.ffprobe ? String(args.ffprobe) : undefined,
      })
      printJob(job, Boolean(args.json))
      if (job.status !== 'succeeded') process.exitCode = 1
    } catch (error) {
      fail(error)
    }
  },
})

const taskCommand = defineCommand({
  meta: { name: 'task', description: 'Inspect and manage media tasks' },
  args: {},
  subCommands: {
    list: defineCommand({
      meta: { name: 'list', description: 'List tasks in a project' },
      args: {
        root: { type: 'string', default: '.' },
        project: { type: 'string', default: 'default' },
        json: { type: 'boolean', default: false },
      },
      run({ args }) {
        const jobs = listProjectJobs(String(args.root), String(args.project))
        if (args.json) {
          console.log(JSON.stringify(jobs, null, 1))
          return
        }
        if (jobs.length === 0) {
          console.log('(no tasks)')
          return
        }
        for (const job of jobs) {
          console.log(`${job.id}  ${job.status.padEnd(10)}  attempt ${job.attempt}${job.error ? `  ${job.error.code}` : ''}`)
        }
      },
    }),
    show: defineCommand({
      meta: { name: 'show', description: 'Show one task' },
      args: {
        id: { type: 'positional', required: true },
        root: { type: 'string', default: '.' },
        project: { type: 'string', default: 'default' },
        json: { type: 'boolean', default: false },
      },
      run({ args }) {
        printJob(getJob(String(args.root), String(args.project), String(args.id)).job, Boolean(args.json))
      },
    }),
    cancel: defineCommand({
      meta: { name: 'cancel', description: 'Cancel a task (cooperative for running renders)' },
      args: {
        id: { type: 'positional', required: true },
        root: { type: 'string', default: '.' },
        project: { type: 'string', default: 'default' },
        json: { type: 'boolean', default: false },
      },
      run({ args }) {
        printJob(cancelJob(String(args.root), String(args.project), String(args.id)), Boolean(args.json))
      },
    }),
    retry: defineCommand({
      meta: { name: 'retry', description: 'Retry a failed/interrupted task' },
      args: {
        id: { type: 'positional', required: true },
        root: { type: 'string', default: '.' },
        project: { type: 'string', default: 'default' },
        json: { type: 'boolean', default: false },
      },
      async run({ args }) {
        try {
          const job = await retryJob({
            root: String(args.root),
            projectId: String(args.project),
            taskId: String(args.id),
          })
          printJob(job, Boolean(args.json))
          if (job.status !== 'succeeded') process.exitCode = 1
        } catch (error) {
          fail(error)
        }
      },
    }),
    evidence: defineCommand({
      meta: { name: 'evidence', description: 'Show the evidence timeline of a task' },
      args: {
        id: { type: 'positional', required: true },
        root: { type: 'string', default: '.' },
        project: { type: 'string', default: 'default' },
        json: { type: 'boolean', default: false },
      },
      run({ args }) {
        const { taskDir } = getJob(String(args.root), String(args.project), String(args.id))
        const events = new EvidenceWriter(taskDir, String(args.id)).readAll()
        if (args.json) {
          console.log(JSON.stringify(events, null, 1))
          return
        }
        for (const event of events) {
          console.log(`${event.at}  ${event.result.toUpperCase().padEnd(5)}  ${event.action}`)
        }
      },
    }),
    recover: defineCommand({
      meta: { name: 'recover', description: 'Mark tasks left mid-flight by a dead process as interrupted' },
      args: {
        root: { type: 'string', default: '.' },
        project: { type: 'string', default: 'default' },
        json: { type: 'boolean', default: false },
      },
      run({ args }) {
        const recovered = recoverJobs(String(args.root), String(args.project))
        if (args.json) console.log(JSON.stringify({ recovered }, null, 1))
        else console.log(recovered.length === 0 ? '(nothing to recover)' : `interrupted: ${recovered.join(', ')}`)
      },
    }),
  },
})

const doctorCommand = defineCommand({
  meta: { name: 'doctor', description: 'Check media pipeline prerequisites' },
  args: {
    root: { type: 'string', default: '.' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const ffmpeg = resolveMediaBin('ffmpeg')
    const ffprobe = resolveMediaBin('ffprobe')
    let playwright: string
    try {
      createRequire(import.meta.url).resolve('playwright')
      playwright = 'installed'
    } catch {
      playwright = 'missing (npm i playwright && npx playwright install chromium)'
    }
    const report = {
      ffmpeg: ffmpeg ?? 'missing (set MEDIA_FFMPEG_BIN)',
      ffprobe: ffprobe ?? 'missing (set MEDIA_FFPROBE_BIN)',
      playwright,
      workspace: join(resolve(String(args.root)), 'media'),
    }
    if (args.json) {
      console.log(JSON.stringify(report, null, 1))
      return
    }
    console.log('\nSCALE Media Doctor\n')
    for (const [key, value] of Object.entries(report)) console.log(`  ${key.padEnd(10)}: ${value}`)
    if (!ffmpeg || !ffprobe || playwright !== 'installed') process.exitCode = 1
  },
})

const providersCommand = defineCommand({
  meta: { name: 'providers', description: 'List or test media providers (v3 plan §8)' },
  args: {},
  subCommands: {
    list: defineCommand({
      meta: { name: 'list', description: 'List providers with config status (no secrets)' },
      args: { json: { type: 'boolean', default: false } },
      run({ args }) {
        const providers = listProviders()
        if (args.json) {
          console.log(JSON.stringify(providers, null, 1))
          return
        }
        for (const provider of providers) {
          const flag = provider.enabled ? (provider.configured ? 'ready' : 'unconfigured') : 'disabled'
          console.log(`${provider.id.padEnd(20)} ${provider.kind.padEnd(6)} ${flag.padEnd(12)} ${provider.message}`)
        }
      },
    }),
    test: defineCommand({
      meta: { name: 'test', description: 'Validate a provider config (no spend, no network)' },
      args: { id: { type: 'positional', required: true }, json: { type: 'boolean', default: false } },
      run({ args }) {
        const provider = listProviders().find(entry => entry.id === String(args.id))
        if (!provider) {
          console.error(`unknown provider "${String(args.id)}"`)
          process.exitCode = 1
          return
        }
        if (args.json) {
          console.log(JSON.stringify(provider, null, 1))
          return
        }
        console.log(`${provider.id}: ${provider.enabled ? (provider.configured ? 'ready' : 'unconfigured') : 'disabled'} — ${provider.message}`)
        if (!provider.enabled || !provider.configured) process.exitCode = 1
      },
    }),
  },
})

const imageCommand = defineCommand({
  meta: { name: 'image', description: 'Generate an image via a configured provider' },
  args: {},
  subCommands: {
    generate: defineCommand({
      meta: { name: 'generate', description: 'Create and run a generate_image job' },
      args: {
        prompt: { type: 'string', required: true, description: 'Image prompt (or --prompt-file)' },
        'prompt-file': { type: 'string', required: false, description: 'Read the prompt from a UTF-8 file' },
        size: { type: 'string', default: '1024x1024', description: 'WxH' },
        provider: { type: 'string', default: 'openai-compatible', description: 'Provider id (mock for dev)' },
        root: { type: 'string', default: '.' },
        project: { type: 'string', default: 'default' },
        'idempotency-key': { type: 'string', required: false },
        json: { type: 'boolean', default: false },
      },
      async run({ args }) {
        try {
          const prompt = args['prompt-file'] ? readFileSync(resolve(String(args['prompt-file'])), 'utf-8') : String(args.prompt)
          const created = createJob({
            root: String(args.root),
            projectId: String(args.project),
            type: 'generate_image',
            imageRequest: { prompt, size: String(args.size), providerId: String(args.provider) },
            requestedBy: 'cli',
            idempotencyKey: args['idempotency-key'] ? String(args['idempotency-key']) : undefined,
          })
          if (!args.json) console.log(created.deduplicated ? `↩︎ idempotent hit — ${created.job.id}` : `task created: ${created.job.id}`)
          const job = await runJob({ root: String(args.root), projectId: String(args.project), taskId: created.job.id })
          printJob(job, Boolean(args.json))
          if (job.status !== 'succeeded') process.exitCode = 1
        } catch (error) {
          fail(error)
        }
      },
    }),
  },
})

const batchCommand = defineCommand({
  meta: { name: 'batch', description: 'Expand a storyboard template into N scene copies (批量分镜, {{n}}/{{nn}} substitution)' },
  args: {
    template: { type: 'positional', required: true, description: 'Template storyboard JSON' },
    count: { type: 'positional', required: true, description: 'Copies to generate (1..200)' },
    out: { type: 'positional', required: true, description: 'Output storyboard path' },
    start: { type: 'string', default: '1', description: '1-based starting index' },
  },
  run({ args }) {
    try {
      const template = JSON.parse(readFileSync(resolve(String(args.template)), 'utf-8'))
      const count = Number.parseInt(String(args.count), 10)
      const expanded = expandStoryboardTemplate(template, count, { start: Number.parseInt(String(args.start), 10) || 1 })
      const validation = validateStoryboard(expanded)
      if (!validation.ok) {
        console.error(`❌ expanded storyboard rejected:\n- ${validation.errors.join('\n- ')}`)
        process.exitCode = 1
        return
      }
      writeFileSync(resolve(String(args.out)), JSON.stringify(expanded, null, 1), 'utf-8')
      const totalMs = expanded.scenes.reduce((sum, scene) => sum + scene.durationMs, 0)
      console.log(`✅ wrote ${expanded.scenes.length} scenes (${(totalMs / 1000).toFixed(1)}s) → ${String(args.out)}`)
    } catch (error) {
      fail(error)
    }
  },
})

const exportCommand = defineCommand({
  meta: { name: 'export', description: 'Create and run an export job: multi-profile re-encode + cover (+ publish manifest)' },
  args: {
    source: { type: 'positional', required: true, description: 'Source render task id (must be succeeded)' },
    profiles: { type: 'string', default: '16x9-1080p,9x16-1080p,1x1-1080p', description: 'Comma-separated profile ids' },
    'cover-at': { type: 'string', default: '0', description: 'Seconds into the film for the cover still' },
    subtitles: { type: 'string', default: 'srt', description: 'none | srt (side-car) | burn' },
    title: { type: 'string', required: false, description: 'Publish title (user input, never generated) — enables the publish manifest' },
    description: { type: 'string', required: false, description: 'Publish description' },
    tags: { type: 'string', required: false, description: 'Comma-separated publish tags' },
    'platform-hints': { type: 'string', required: false, description: 'Comma-separated platform hints (no upload happens)' },
    root: { type: 'string', default: '.' },
    project: { type: 'string', default: 'default' },
    'idempotency-key': { type: 'string', required: false },
    ffmpeg: { type: 'string', required: false },
    ffprobe: { type: 'string', required: false },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    try {
      const profiles = String(args.profiles)
        .split(',')
        .map(profile => profile.trim())
        .filter(isExportProfileId)
      const publish = args.title
        ? {
            title: String(args.title),
            ...(args.description ? { description: String(args.description) } : {}),
            ...(args.tags
              ? { tags: String(args.tags).split(',').map(tag => tag.trim()).filter(Boolean) }
              : {}),
            ...(args['platform-hints']
              ? { platformHints: String(args['platform-hints']).split(',').map(hint => hint.trim()).filter(Boolean) }
              : {}),
          }
        : undefined
      const created = createJob({
        root: String(args.root),
        projectId: String(args.project),
        type: 'export',
        exportRequest: {
          sourceTaskId: String(args.source),
          ...(profiles.length ? { profiles } : {}),
          coverAtSec: Number(args['cover-at']) || 0,
          subtitles: (['none', 'srt', 'burn'].includes(String(args.subtitles)) ? String(args.subtitles) : 'srt') as
            | 'none'
            | 'srt'
            | 'burn',
          ...(publish ? { publish } : {}),
        },
        requestedBy: 'cli',
        idempotencyKey: args['idempotency-key'] ? String(args['idempotency-key']) : undefined,
      })
      if (!args.json) {
        console.log(created.deduplicated ? `↩︎ idempotent hit — returning existing task ${created.job.id}` : `task created: ${created.job.id}`)
      }
      const job = await runJob({
        root: String(args.root),
        projectId: String(args.project),
        taskId: created.job.id,
        ffmpegBin: args.ffmpeg ? String(args.ffmpeg) : undefined,
        ffprobeBin: args.ffprobe ? String(args.ffprobe) : undefined,
      })
      printJob(job, Boolean(args.json))
      if (job.status !== 'succeeded') process.exitCode = 1
    } catch (error) {
      fail(error)
    }
  },
})

const approvalsCommand = defineCommand({
  meta: { name: 'approvals', description: 'Approval inbox: list pending requests, decide approve/reject' },
  args: {},
  subCommands: {
    list: defineCommand({
      meta: { name: 'list', description: 'List approval requests (pending first)' },
      args: {
        root: { type: 'string', default: '.' },
        project: { type: 'string', default: 'default' },
        json: { type: 'boolean', default: false },
      },
      run({ args }) {
        const approvals = listProjectApprovals(String(args.root), String(args.project))
        if (args.json) {
          console.log(JSON.stringify(approvals, null, 1))
          return
        }
        if (approvals.length === 0) {
          console.log('(no approvals)')
          return
        }
        for (const approval of approvals) {
          console.log(
            `${approval.id}  ${approval.status.padEnd(8)}  task ${approval.taskId}  ${approval.actionId ?? approval.jobType}  ` +
              `cost ${approval.estimatedCny ?? 'unknown'} CNY  requested ${approval.requestedAt}  expires ${approval.expiresAt}`,
          )
        }
      },
    }),
    decide: defineCommand({
      meta: { name: 'decide', description: 'Approve or reject a pending request' },
      args: {
        id: { type: 'positional', required: true },
        decision: { type: 'positional', required: true, description: 'approve | reject' },
        reason: { type: 'string', required: false, description: 'Decision note (recorded in evidence)' },
        root: { type: 'string', default: '.' },
        project: { type: 'string', default: 'default' },
        json: { type: 'boolean', default: false },
      },
      run({ args }) {
        try {
          const decision = String(args.decision)
          if (decision !== 'approve' && decision !== 'reject') {
            console.error(`decision must be "approve" or "reject", got "${decision}"`)
            process.exitCode = 1
            return
          }
          const result = decideJobApproval({
            root: String(args.root),
            projectId: String(args.project),
            approvalId: String(args.id),
            approve: decision === 'approve',
            decidedBy: 'cli',
            ...(args.reason ? { reason: String(args.reason) } : {}),
          })
          if (args.json) {
            console.log(JSON.stringify(result, null, 1))
            return
          }
          console.log(`${decision}d ${result.approval.id} → task ${result.approval.taskId} (${result.approval.status})`)
        } catch (error) {
          fail(error)
        }
      },
    }),
  },
})

const gcCommand = defineCommand({
  meta: { name: 'gc', description: 'List GC candidates (dry-run default; --apply only removes render/ intermediates and orphan external copies)' },
  args: {
    apply: { type: 'boolean', default: false, description: 'Actually delete (never touches task.json/events/evidence/output/assets)' },
    'min-age-days': { type: 'string', required: false, description: 'Override MEDIA_GC_MIN_AGE_DAYS (default 14)' },
    root: { type: 'string', default: '.' },
    project: { type: 'string', default: 'default' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    try {
      const workspace = openWorkspace(String(args.root), String(args.project))
      const plan = runGc(workspace, {
        apply: Boolean(args.apply),
        ...(args['min-age-days'] !== undefined && args['min-age-days'] !== null && String(args['min-age-days']) !== ''
          ? { minAgeDays: Math.max(0, Number(args['min-age-days']) || 0) }
          : {}),
      })
      if (args.json) {
        console.log(JSON.stringify(plan, null, 1))
        return
      }
      console.log(`GC plan (${plan.dryRun ? 'DRY-RUN — nothing deleted' : 'APPLIED'})  min age ${plan.minAgeDays}d`)
      console.log(`  ${plan.scopeNote}`)
      if (plan.candidates.length === 0) {
        console.log('  (no candidates)')
        return
      }
      for (const candidate of plan.candidates) {
        console.log(
          `  ${candidate.taskId}  ${candidate.category.padEnd(16)}  ${(candidate.bytes / 1024 / 1024).toFixed(1)} MB  ` +
            `age ${candidate.ageDays}d  ${candidate.path}`,
        )
      }
      console.log(
        plan.dryRun
          ? `  → ${plan.candidates.length} candidates, rerun with --apply to remove`
          : `  → removed ${plan.removed}/${plan.candidates.length}, freed ${(plan.freedBytes / 1024 / 1024).toFixed(1)} MB`,
      )
    } catch (error) {
      fail(error)
    }
  },
})

export const mediaCommand = defineCommand({
  meta: { name: 'media', description: 'Media workflow: storyboard render pipeline (v3 plan)' },
  args: {},
  subCommands: {
    validate: validateCommand,
    render: renderCommand,
    batch: batchCommand,
    task: taskCommand,
    export: exportCommand,
    approvals: approvalsCommand,
    gc: gcCommand,
    providers: providersCommand,
    image: imageCommand,
    doctor: doctorCommand,
  },
})
