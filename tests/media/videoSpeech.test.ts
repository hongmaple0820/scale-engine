// M2 provider paths: feature flags (off/mock/live), request validation, the
// mock video submit → poll → commit chain with restart reattach, cooperative
// cancellation, orchestrator timeout/cancel semantics, and mock speech.
//
// The mock video artifact is synthetic MP4-shaped bytes: these tests assert the
// pipeline, never playback.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cancelJob,
  createJob,
  generateVideoForJob,
  getJob,
  listProviderFeatures,
  listProviders,
  readJobEvents,
  readSnapshot,
  recoverJobs,
  runJob,
  runLockTtlMsFor,
  validateSpeechRequest,
  validateVideoRequest,
  writeSnapshot,
  EvidenceWriter,
  MediaError,
  RUN_LOCK_TTL_MS,
  VIDEO_RUN_LOCK_TTL_MS,
  type MediaJob,
  type MediaProvider,
} from '../../src/media/index.js'
import { sha256Buffer } from '../../src/media/assets/hash.js'
import { resetMockVideoProvider, syntheticMp4 } from '../../src/media/providers/video/MockVideoProvider.js'
import { MAX_FIRST_FRAME_BYTES } from '../../src/media/render/VideoOrchestrator.js'

const root = mkdtempSync(join(tmpdir(), 'media-video-speech-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const ENV_KEYS = [
  'MEDIA_FEATURE_VIDEO',
  'MEDIA_FEATURE_SPEECH',
  'MEDIA_MOCK_VIDEO_LATENCY_MS',
  'MEDIA_APPROVAL_MODE',
  'MEDIA_DAILY_BUDGET_CNY',
] as const

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key]
}

beforeEach(() => {
  clearEnv()
  resetMockVideoProvider()
})
afterEach(() => {
  clearEnv()
  resetMockVideoProvider()
})

function featureOf(kind: 'video' | 'speech') {
  const feature = listProviderFeatures().find(candidate => candidate.kind === kind)
  if (!feature) throw new Error(`${kind} feature missing`)
  return feature
}

const VIDEO_REQUEST = { prompt: 'a mock clip', durationSeconds: 2, providerId: 'mock-video' }

describe('video/speech feature flags', () => {
  it('registers no video/speech provider by default and refuses their job types', () => {
    expect(featureOf('video').mode).toBe('off')
    expect(featureOf('speech').mode).toBe('off')
    expect(listProviders().map(provider => provider.id)).not.toContain('mock-video')

    expect(() => createJob({ root, projectId: 'flags', type: 'generate_video', videoRequest: VIDEO_REQUEST })).toThrow(
      /MEDIA_FEATURE_VIDEO/,
    )
    expect(() =>
      createJob({ root, projectId: 'flags', type: 'generate_speech', speechRequest: { text: 'hi', providerId: 'mock-speech' } }),
    ).toThrow(/MEDIA_FEATURE_SPEECH/)
  })

  it('mock registers the deterministic providers; live video stays unimplemented (S0)', () => {
    process.env.MEDIA_FEATURE_VIDEO = 'mock'
    process.env.MEDIA_FEATURE_SPEECH = 'mock'
    expect(featureOf('video').mode).toBe('mock')
    expect(listProviders().map(provider => provider.id)).toEqual(expect.arrayContaining(['mock-video', 'mock-speech']))

    process.env.MEDIA_FEATURE_VIDEO = 'live'
    expect(featureOf('video').mode).toBe('live')
    expect(featureOf('video').message).toContain('not implemented')
    expect(listProviders().map(provider => provider.id)).not.toContain('mock-video')
  })

  it('ignores invalid feature values and says so', () => {
    process.env.MEDIA_FEATURE_VIDEO = 'banana'
    expect(featureOf('video').mode).toBe('off')
    expect(featureOf('video').message).toContain('ignored invalid')
  })
})

describe('video/speech request validation', () => {
  it('fills safe defaults', () => {
    const video = validateVideoRequest({ prompt: '  clip  ', durationSeconds: 4, providerId: 'mock-video' })
    expect(video).toMatchObject({ prompt: 'clip', durationSeconds: 4, aspectRatio: '16:9', resolution: '720p', pollTimeoutSeconds: 1800 })
    const speech = validateSpeechRequest({ text: ' hello ', providerId: 'mock-speech' })
    expect(speech).toMatchObject({ text: 'hello', voice: 'alloy', format: 'mp3' })
  })

  it('rejects bad durations, ratios and traversal paths', () => {
    const codeOf = (fn: () => unknown): string => {
      try {
        fn()
        throw new Error('expected validation to throw')
      } catch (error) {
        expect(error).toBeInstanceOf(MediaError)
        return (error as MediaError).code
      }
    }
    expect(codeOf(() => validateVideoRequest({ prompt: 'x', durationSeconds: 0, providerId: 'mock-video' }))).toBe('MEDIA_VIDEO_REQUEST_INVALID')
    expect(codeOf(() => validateVideoRequest({ prompt: 'x', durationSeconds: 5, providerId: 'mock-video', aspectRatio: '4:3' }))).toBe('MEDIA_VIDEO_REQUEST_INVALID')
    expect(codeOf(() => validateVideoRequest({ prompt: 'x', durationSeconds: 5, providerId: 'mock-video', firstFrameAssetPath: '../x.png' }))).toBe('MEDIA_VIDEO_REQUEST_INVALID')
    expect(codeOf(() => validateVideoRequest({ prompt: 'x', durationSeconds: 5, providerId: 'mock-video', firstFrameAssetPath: 'assets/x.txt' }))).toBe('MEDIA_VIDEO_REQUEST_INVALID')
    expect(codeOf(() => validateSpeechRequest({ text: '', providerId: 'mock-speech' }))).toBe('MEDIA_SPEECH_REQUEST_INVALID')
    expect(codeOf(() => validateSpeechRequest({ text: 'x', providerId: 'mock-speech', format: 'ogg' }))).toBe('MEDIA_SPEECH_REQUEST_INVALID')
  })
})

describe('mock video pipeline', () => {
  it('submits, polls and commits a hashed video asset with persisted provider handle', async () => {
    process.env.MEDIA_FEATURE_VIDEO = 'mock'
    process.env.MEDIA_MOCK_VIDEO_LATENCY_MS = '0'
    const created = createJob({ root, projectId: 'video', type: 'generate_video', videoRequest: VIDEO_REQUEST })
    expect(created.job.status).toBe('created')
    expect(created.job.cost?.estimatedCny).toBe(0)

    const job = await runJob({ root, projectId: 'video', taskId: created.job.id })
    expect(job.status).toBe('succeeded')
    expect(job.outputs[0]).toMatchObject({ kind: 'video', path: 'assets/generated.mp4' })
    expect(job.outputs[0].sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(job.provider?.providerId).toBe('mock-video')
    expect(job.provider?.jobId).toBeTruthy()
    // committed bytes are exactly the provider artifact, hashed by the engine
    expect(job.outputs[0].sha256).toBe(sha256Buffer(syntheticMp4(job.provider?.jobId ?? '')))

    const evidence = new EvidenceWriter(created.taskDir, created.job.id).readAll()
    const actions = evidence.map(event => event.action)
    expect(actions).toContain('video_submitted')
    expect(actions).toContain('video_completed')
    expect(actions).not.toContain('video_reattached')
  }, 60000)

  it('reattaches a persisted handle after a restart instead of resubmitting', async () => {
    process.env.MEDIA_FEATURE_VIDEO = 'mock'
    process.env.MEDIA_MOCK_VIDEO_LATENCY_MS = '0'
    const created = createJob({ root, projectId: 'video', type: 'generate_video', videoRequest: VIDEO_REQUEST })

    const providerJobId = 'mock-restart-reattach'
    const snapshot = readSnapshot(created.taskDir)
    const interrupted: MediaJob = {
      ...snapshot,
      status: 'interrupted',
      attempt: 1,
      error: { code: 'MEDIA_JOB_INTERRUPTED', message: 'simulated crash', retryable: true },
      provider: {
        providerId: 'mock-video',
        jobId: providerJobId,
        submittedAt: new Date(Date.now() - 60_000).toISOString(),
        pollAfterMs: 250,
        deadlineAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        metadata: { submittedAt: Date.now() - 60_000, latencyMs: 0, durationSeconds: 2 },
      },
    }
    writeSnapshot(created.taskDir, interrupted)

    const job = await runJob({ root, projectId: 'video', taskId: created.job.id })
    expect(job.status).toBe('succeeded')
    expect(job.provider?.jobId).toBe(providerJobId)
    expect(job.outputs[0].sha256).toBe(sha256Buffer(syntheticMp4(providerJobId)))

    const actions = new EvidenceWriter(created.taskDir, created.job.id).readAll().map(event => event.action)
    expect(actions).toContain('video_reattached')
    // no second submission was paid for
    expect(actions).not.toContain('video_submitted')
  }, 60000)

  it('fails a reattached handle whose deadline already passed with provider_timeout', async () => {
    process.env.MEDIA_FEATURE_VIDEO = 'mock'
    process.env.MEDIA_MOCK_VIDEO_LATENCY_MS = '0'
    const created = createJob({ root, projectId: 'video', type: 'generate_video', videoRequest: { ...VIDEO_REQUEST, prompt: 'expired handle' } })
    const snapshot = readSnapshot(created.taskDir)
    const past = new Date(Date.now() - 60_000).toISOString()
    writeSnapshot(created.taskDir, {
      ...snapshot,
      status: 'interrupted',
      error: { code: 'MEDIA_JOB_INTERRUPTED', message: 'simulated crash', retryable: true },
      provider: {
        providerId: 'mock-video',
        jobId: 'mock-expired-handle',
        submittedAt: past,
        pollAfterMs: 250,
        deadlineAt: past,
      },
    } satisfies MediaJob)

    await expect(runJob({ root, projectId: 'video', taskId: created.job.id })).rejects.toMatchObject({
      code: 'MEDIA_PROVIDER_TIMEOUT',
    })
    const job = getJob(root, 'video', created.job.id).job
    expect(job.status).toBe('failed')
    expect(job.error?.code).toBe('MEDIA_PROVIDER_TIMEOUT')
    const actions = new EvidenceWriter(created.taskDir, created.job.id).readAll().map(event => event.action)
    expect(actions).toContain('video_reattached')
    expect(actions).toContain('video_cancel_requested')
    expect(actions).not.toContain('video_submitted')
  }, 60000)

  it('recovery marks an expired video handle as failed(provider_timeout) without resuming', () => {
    process.env.MEDIA_FEATURE_VIDEO = 'mock'
    const created = createJob({ root, projectId: 'video', type: 'generate_video', videoRequest: { ...VIDEO_REQUEST, prompt: 'recover expired' } })
    const snapshot = readSnapshot(created.taskDir)
    const past = new Date(Date.now() - 60_000).toISOString()
    writeSnapshot(created.taskDir, {
      ...snapshot,
      status: 'running',
      provider: {
        providerId: 'mock-video',
        jobId: 'mock-recover-expired',
        submittedAt: past,
        pollAfterMs: 250,
        deadlineAt: past,
      },
    } satisfies MediaJob)

    const recovered = recoverJobs(root, 'video')
    expect(recovered).toContain(created.job.id)
    const job = getJob(root, 'video', created.job.id).job
    expect(job.status).toBe('failed')
    expect(job.error?.code).toBe('MEDIA_PROVIDER_TIMEOUT')
    const events = readJobEvents(created.taskDir).map(event => event.type)
    expect(events).toContain('provider_handle_expired')
    expect(events).not.toContain('recovered_interrupted')
  })

  it('cancels a running poll cooperatively without blocking on the run lock', async () => {
    process.env.MEDIA_FEATURE_VIDEO = 'mock'
    process.env.MEDIA_MOCK_VIDEO_LATENCY_MS = '15000'
    const created = createJob({ root, projectId: 'video', type: 'generate_video', videoRequest: { ...VIDEO_REQUEST, prompt: 'cancel me' } })

    const running = runJob({ root, projectId: 'video', taskId: created.job.id })
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && getJob(root, 'video', created.job.id).job.status !== 'running') {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(getJob(root, 'video', created.job.id).job.status).toBe('running')

    // must return promptly: the runner still holds the exclusive run lock
    const snapshot = cancelJob(root, 'video', created.job.id)
    expect(['running', 'cancelled']).toContain(snapshot.status)

    const finished = await running
    expect(finished.status).toBe('cancelled')
    expect(finished.error?.code).toBe('MEDIA_JOB_CANCELLED')
  }, 60000)
})

describe('video orchestrator guards', () => {
  const request = {
    prompt: 'stub',
    durationSeconds: 2,
    aspectRatio: '16:9',
    resolution: '720p',
    providerId: 'stub-video',
    pollTimeoutSeconds: 10,
  }

  it('times out past the persisted deadline and asks the provider to cancel', async () => {
    const taskDir = join(root, 'scratch-timeout')
    mkdirSync(taskDir, { recursive: true })
    let cancelCalls = 0
    const stub: MediaProvider = {
      id: 'stub-video',
      kind: 'video',
      enabled: true,
      getCapabilities: () => ({ kind: 'video', models: ['stub'], async: true, canEstimate: false, canCancel: true, notes: 'stub' }),
      validateConfig: () => ({ ok: true, configured: true, message: 'stub' }),
      submitVideo: async () => ({ jobId: 'stub-job' }),
      pollVideo: async () => ({ status: 'running', progress: 0.5 }),
      cancelVideo: async () => { cancelCalls += 1 },
    }
    try {
      await generateVideoForJob({
        taskDir,
        taskId: 'job-stub-timeout',
        request,
        provider: stub,
        existingHandle: {
          providerId: 'stub-video',
          jobId: 'stub-job',
          submittedAt: new Date(Date.now() - 60_000).toISOString(),
          pollAfterMs: 250,
          deadlineAt: new Date(Date.now() - 1000).toISOString(),
        },
      })
      throw new Error('expected generateVideoForJob to time out')
    } catch (error) {
      expect(error).toBeInstanceOf(MediaError)
      expect((error as MediaError).code).toBe('MEDIA_PROVIDER_TIMEOUT')
    }
    expect(cancelCalls).toBe(1)
    const actions = new EvidenceWriter(taskDir, 'job-stub-timeout').readAll().map(event => event.action)
    expect(actions).toContain('video_cancel_requested')
  }, 30000)

  it('maps provider failed and expired statuses to stable codes', async () => {
    const taskDir = join(root, 'scratch-statuses')
    mkdirSync(taskDir, { recursive: true })
    const existingHandle = {
      providerId: 'stub-video',
      jobId: 'stub-status',
      submittedAt: new Date().toISOString(),
      deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    }
    const withPoll = (poll: Awaited<ReturnType<NonNullable<MediaProvider['pollVideo']>>>): MediaProvider => ({
      id: 'stub-video',
      kind: 'video',
      enabled: true,
      getCapabilities: () => ({ kind: 'video', models: ['stub'], async: true, canEstimate: false, canCancel: false, notes: 'stub' }),
      validateConfig: () => ({ ok: true, configured: true, message: 'stub' }),
      submitVideo: async () => ({ jobId: 'stub-status' }),
      pollVideo: async () => poll,
    })

    await expect(generateVideoForJob({
      taskDir,
      taskId: 'job-stub-failed',
      request,
      provider: withPoll({ status: 'failed', error: { message: 'provider exploded', retryable: false } }),
      existingHandle,
    })).rejects.toMatchObject({ code: 'MEDIA_PROVIDER_REQUEST_FAILED' })

    await expect(generateVideoForJob({
      taskDir,
      taskId: 'job-stub-expired',
      request,
      provider: withPoll({ status: 'expired' }),
      existingHandle,
    })).rejects.toMatchObject({ code: 'MEDIA_PROVIDER_TIMEOUT' })
  }, 30000)

  it('rejects private/http download URLs before any fetch', async () => {
    const taskDir = join(root, 'scratch-download')
    mkdirSync(taskDir, { recursive: true })
    const stub: MediaProvider = {
      id: 'stub-video',
      kind: 'video',
      enabled: true,
      getCapabilities: () => ({ kind: 'video', models: ['stub'], async: true, canEstimate: false, canCancel: false, notes: 'stub' }),
      validateConfig: () => ({ ok: true, configured: true, message: 'stub' }),
      submitVideo: async () => ({ jobId: 'stub-download' }),
      pollVideo: async () => ({ status: 'completed', downloadUrl: 'http://127.0.0.1:9/secret.mp4' }),
    }
    await expect(generateVideoForJob({
      taskDir,
      taskId: 'job-stub-download',
      request,
      provider: stub,
      existingHandle: {
        providerId: 'stub-video',
        jobId: 'stub-download',
        submittedAt: new Date().toISOString(),
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      },
    })).rejects.toMatchObject({ code: 'MEDIA_PROVIDER_DOWNLOAD_REJECTED' })
  }, 30000)

  it('never lets a provider job id choose the output filename', async () => {
    const taskDir = join(root, 'scratch-injection')
    mkdirSync(taskDir, { recursive: true })
    const stub: MediaProvider = {
      id: 'stub-video',
      kind: 'video',
      enabled: true,
      getCapabilities: () => ({ kind: 'video', models: ['stub'], async: true, canEstimate: false, canCancel: false, notes: 'stub' }),
      validateConfig: () => ({ ok: true, configured: true, message: 'stub' }),
      submitVideo: async () => ({ jobId: '../../evil.ps1' }),
      pollVideo: async () => ({ status: 'completed', artifacts: [{ data: Buffer.from('fake-mp4-bytes'), contentType: 'video/mp4' }] }),
    }
    const outcome = await generateVideoForJob({ taskDir, taskId: 'job-stub-injection', request, provider: stub })
    expect(outcome.handle.jobId).toBe('../../evil.ps1')
    expect(outcome.output.path).toBe('assets/generated.mp4')
  }, 30000)

  it('rejects a reference image above the inline 10 MB limit', async () => {
    const taskDir = join(root, 'scratch-first-frame')
    mkdirSync(join(taskDir, 'assets'), { recursive: true })
    writeFileSync(join(taskDir, 'assets', 'big.png'), Buffer.alloc(MAX_FIRST_FRAME_BYTES + 1))
    const stub: MediaProvider = {
      id: 'stub-video',
      kind: 'video',
      enabled: true,
      getCapabilities: () => ({ kind: 'video', models: ['stub'], async: true, canEstimate: false, canCancel: false, notes: 'stub' }),
      validateConfig: () => ({ ok: true, configured: true, message: 'stub' }),
      submitVideo: async () => { throw new Error('must not submit an oversized reference') },
      pollVideo: async () => ({ status: 'running' }),
    }
    await expect(generateVideoForJob({
      taskDir,
      taskId: 'job-stub-first-frame',
      request: { ...request, firstFrameAssetPath: 'assets/big.png' },
      provider: stub,
    })).rejects.toMatchObject({ code: 'MEDIA_VIDEO_REQUEST_INVALID' })
  }, 30000)

  it('keeps a run lock valid for the whole maximum poll window', () => {
    const maxPollWindowMs = 3600 * 1000
    expect(runLockTtlMsFor('generate_video')).toBe(VIDEO_RUN_LOCK_TTL_MS)
    expect(VIDEO_RUN_LOCK_TTL_MS).toBeGreaterThan(maxPollWindowMs)
    expect(runLockTtlMsFor('render')).toBe(RUN_LOCK_TTL_MS)
    expect(RUN_LOCK_TTL_MS).toBeGreaterThanOrEqual(30 * 60 * 1000)
  })

  it('propagates provider-reported cancellation as MEDIA_JOB_CANCELLED', async () => {
    const taskDir = join(root, 'scratch-cancelled')
    mkdirSync(taskDir, { recursive: true })
    const stub: MediaProvider = {
      id: 'stub-video',
      kind: 'video',
      enabled: true,
      getCapabilities: () => ({ kind: 'video', models: ['stub'], async: true, canEstimate: false, canCancel: false, notes: 'stub' }),
      validateConfig: () => ({ ok: true, configured: true, message: 'stub' }),
      submitVideo: async () => ({ jobId: 'stub-job' }),
      pollVideo: async () => ({ status: 'cancelled' }),
    }
    try {
      await generateVideoForJob({
        taskDir,
        taskId: 'job-stub-cancelled',
        request,
        provider: stub,
        existingHandle: {
          providerId: 'stub-video',
          jobId: 'stub-job',
          submittedAt: new Date().toISOString(),
          deadlineAt: new Date(Date.now() + 60_000).toISOString(),
        },
      })
      throw new Error('expected generateVideoForJob to cancel')
    } catch (error) {
      expect(error).toBeInstanceOf(MediaError)
      expect((error as MediaError).code).toBe('MEDIA_JOB_CANCELLED')
    }
  }, 30000)
})

describe('mock speech pipeline', () => {
  it('commits audio without writing the input text to evidence', async () => {
    process.env.MEDIA_FEATURE_SPEECH = 'mock'
    const text = 'private narration line 42'
    const created = createJob({
      root,
      projectId: 'speech',
      type: 'generate_speech',
      speechRequest: { text, providerId: 'mock-speech', voice: 'alloy', format: 'wav' },
    })
    const job = await runJob({ root, projectId: 'speech', taskId: created.job.id })
    expect(job.status).toBe('succeeded')
    expect(job.outputs[0]).toMatchObject({ kind: 'audio', path: 'assets/generated.wav' })
    expect(job.outputs[0].bytes).toBeGreaterThan(44)

    const evidence = new EvidenceWriter(created.taskDir, created.job.id).readAll()
    expect(evidence.some(event => event.action === 'speech_generated' && event.result === 'ok')).toBe(true)
    expect(JSON.stringify(evidence)).not.toContain(text)
  }, 60000)

  it('honours the requested mp3 extension', async () => {
    process.env.MEDIA_FEATURE_SPEECH = 'mock'
    const created = createJob({
      root,
      projectId: 'speech',
      type: 'generate_speech',
      speechRequest: { text: 'mp3 please', providerId: 'mock-speech', format: 'mp3' },
    })
    const job = await runJob({ root, projectId: 'speech', taskId: created.job.id })
    expect(job.status).toBe('succeeded')
    expect(job.outputs[0].path).toBe('assets/generated.mp3')
  }, 60000)
})
