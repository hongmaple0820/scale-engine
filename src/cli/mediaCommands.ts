// SCALE Engine — media workflow commands (v3 plan §9).
// Everything routes through src/media JobService — no business logic here.

import { defineCommand } from 'citty'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import {
  cancelJob,
  createJob,
  expandStoryboardTemplate,
  getJob,
  listProjectJobs,
  listProviders,
  recoverJobs,
  retryJob,
  resolveMediaBin,
  runJob,
  validateStoryboard,
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

export const mediaCommand = defineCommand({
  meta: { name: 'media', description: 'Media workflow: storyboard render pipeline (v3 plan)' },
  args: {},
  subCommands: {
    validate: validateCommand,
    render: renderCommand,
    batch: batchCommand,
    task: taskCommand,
    providers: providersCommand,
    image: imageCommand,
    doctor: doctorCommand,
  },
})
