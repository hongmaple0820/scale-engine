// Provider layer (v3 plan §8): OpenAI-compatible adapter against a local mock
// HTTP server (real wire format, no external spend), SSRF guard, unconfigured
// behavior, registry gating (suno default-off).

import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createJob,
  runJob,
  listProviders,
  getProvider,
  validateImageRequest,
  isProviderUrlAllowed,
} from '../../src/media/index.js'

const nodeRequire = createRequire(import.meta.url)
let playwrightReady = false
try {
  nodeRequire.resolve('playwright')
  playwrightReady = true
} catch {
  // not needed for provider tests actually — images only; keep guard for symmetry
}

const root = mkdtempSync(join(tmpdir(), 'media-providers-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

// local OpenAI-compatible mock (wire-format fidelity without external spend)
let server: Server
let baseUrl = ''
const received: Array<{ path: string; auth?: string; body: Record<string, unknown> }> = []
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => (body += chunk))
    request.on('end', () => {
      received.push({ path: request.url ?? '', auth: request.headers.authorization, body: body ? JSON.parse(body) : {} })
      if (request.url?.includes('/images/generations')) {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ data: [{ b64_json: TINY_PNG_B64 }], usage: { input_tokens: 3 } }))
        return
      }
      response.statusCode = 404
      response.end('{}')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/v1`
})

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
})

describe('provider registry', () => {
  it('lists mock, openai-compatible and the default-disabled suno adapter', () => {
    const providers = listProviders()
    const ids = providers.map(provider => provider.id)
    expect(ids).toEqual(['mock', 'openai-compatible', 'suno-api'])
    expect(providers.find(provider => provider.id === 'suno-api')?.enabled).toBe(false)
    expect(providers.find(provider => provider.id === 'mock')?.enabled).toBe(true)
  })

  it('never hands out a disabled provider', () => {
    expect(getProvider('suno-api')).toBeUndefined()
    expect(getProvider('unknown-thing')).toBeUndefined()
  })
})

describe('SSRF guard (v3 §8.4)', () => {
  it('denies plain HTTP without the loopback opt-in', () => {
    expect(isProviderUrlAllowed('http://api.example.com/v1').ok).toBe(false)
  })

  it('denies cloud-metadata and .internal hosts outright', () => {
    expect(isProviderUrlAllowed('https://169.254.169.254/v1').ok).toBe(false)
    expect(isProviderUrlAllowed('https://metadata.google.internal/v1').ok).toBe(false)
    expect(isProviderUrlAllowed('https://bucket.internal/v1').ok).toBe(false)
  })

  it('allows HTTPS and (with opt-in) loopback HTTP', () => {
    expect(isProviderUrlAllowed('https://api.openai.com/v1').ok).toBe(true)
    process.env.MEDIA_PROVIDER_ALLOW_LOCAL = '1'
    expect(isProviderUrlAllowed('http://127.0.0.1:9/v1').ok).toBe(true)
    delete process.env.MEDIA_PROVIDER_ALLOW_LOCAL
    expect(isProviderUrlAllowed('http://127.0.0.1:9/v1').ok).toBe(false)
  })
})

describe('image request validation', () => {
  it('rejects bad size and empty prompt', () => {
    expect(() => validateImageRequest({ prompt: '', size: '1024x1024', providerId: 'mock' })).toThrow(MediaError)
    expect(() => validateImageRequest({ prompt: 'x', size: 'big', providerId: 'mock' })).toThrow(MediaError)
    expect(validateImageRequest({ prompt: ' ok ', size: '1024x1024', providerId: 'mock' }).prompt).toBe('ok')
  })
})

describe('generate_image job (mock provider, in-process)', () => {
  it('runs end to end and commits a hashed image asset', async () => {
    const created = createJob({
      root,
      type: 'generate_image',
      imageRequest: { prompt: 'solid test image', size: '1024x1024', providerId: 'mock' },
      idempotencyKey: 'img-mock',
    })
    const job = await runJob({ root, taskId: created.job.id })
    expect(job.status).toBe('succeeded')
    expect(job.outputs[0].kind).toBe('image')
    expect(job.outputs[0].sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(job.outputs[0].bytes).toBeGreaterThan(0)
  }, 60000)
})

describe('generate_image job (OpenAI-compatible wire format, local mock)', () => {
  it('runs end to end against the local mock and records provider usage', async () => {
    process.env.MEDIA_OPENAI_BASE_URL = baseUrl
    process.env.MEDIA_OPENAI_API_KEY = 'test-key-local'
    process.env.MEDIA_PROVIDER_ALLOW_LOCAL = '1'
    try {
      const created = createJob({
        root,
        type: 'generate_image',
        imageRequest: { prompt: 'wire format test', size: '1024x1024', providerId: 'openai-compatible' },
        idempotencyKey: 'img-openai-mock',
      })
      const job = await runJob({ root, taskId: created.job.id })
      expect(job.status).toBe('succeeded')
      expect(job.outputs[0].bytes).toBeGreaterThan(0)
      const call = received.find(entry => entry.path.includes('/images/generations'))
      expect(call?.auth).toBe('Bearer test-key-local')
      expect(call?.body.model).toBeDefined()
      expect(call?.body.prompt).toBe('wire format test')
      expect(call?.body.size).toBe('1024x1024')
      // evidence carries provider/model/usage without any key material
      const { EvidenceWriter } = await import('../../src/media/evidence/EvidenceWriter.js')
      const { openWorkspace, taskDirOf } = await import('../../src/media/jobs/JobStore.js')
      const workspace = openWorkspace(root)
      const events = new EvidenceWriter(taskDirOf(workspace, created.job.id), created.job.id).readAll()
      const usage = events.find(event => event.action === 'provider_usage')
      expect(usage?.data?.provider).toBe('openai-compatible')
      expect(JSON.stringify(usage)).not.toContain('test-key-local')
    } finally {
      delete process.env.MEDIA_OPENAI_BASE_URL
      delete process.env.MEDIA_OPENAI_API_KEY
      delete process.env.MEDIA_PROVIDER_ALLOW_LOCAL
    }
  }, 60000)

  it('fails cleanly when the key is absent', async () => {
    process.env.MEDIA_OPENAI_BASE_URL = baseUrl
    process.env.MEDIA_PROVIDER_ALLOW_LOCAL = '1'
    delete process.env.MEDIA_OPENAI_API_KEY
    try {
      const created = createJob({
        root,
        type: 'generate_image',
        imageRequest: { prompt: 'no key', size: '1024x1024', providerId: 'openai-compatible' },
      })
      await expect(runJob({ root, taskId: created.job.id })).rejects.toThrow(/MEDIA_OPENAI_API_KEY/)
      const { getJob } = await import('../../src/media/jobs/JobService.js')
      const job = getJob(root, undefined, created.job.id).job
      expect(job.status).toBe('failed')
      expect(job.error?.code).toBe('MEDIA_PROVIDER_UNAVAILABLE')
    } finally {
      delete process.env.MEDIA_OPENAI_BASE_URL
      delete process.env.MEDIA_PROVIDER_ALLOW_LOCAL
    }
  }, 60000)
})

import { MediaError } from '../../src/media/errors.js'
