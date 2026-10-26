// Image-generation orchestrator (v3 plan §8): resolve provider → generate →
// commit → inspect. The provider is an adapter; authorization/evidence stay
// here. Provider-reported usage is recorded verbatim (never fabricated); the
// API key never enters evidence because it is only ever read from env inside
// the provider.

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MediaError } from '../errors.js'
import type { AssetRecord, ImageJobRequest } from '../types.js'
import { EvidenceWriter } from '../evidence/EvidenceWriter.js'
import { appendJobEvent } from '../jobs/JobStore.js'
import { getProvider } from '../providers/ProviderRegistry.js'

export interface ImageOrchestratorOptions {
  taskDir: string
  taskId: string
  request: ImageJobRequest
  isCancelled?: () => boolean
  onStage?: (info: { stage: string; ms: number }) => void
}

const SIZE_RE = /^\d{3,4}x\d{3,4}$/

export function validateImageRequest(raw: unknown): ImageJobRequest {
  const request = (raw ?? {}) as Partial<ImageJobRequest>
  const errors: string[] = []
  const prompt = request.prompt
  if (typeof prompt !== 'string' || prompt.trim().length === 0) errors.push('prompt must be a non-empty string')
  else if (prompt.length > 4000) errors.push('prompt exceeds 4000 chars')
  if (typeof request.size !== 'string' || !SIZE_RE.test(request.size)) errors.push('size must match WxH (e.g. 1024x1024)')
  const providerId = request.providerId
  if (typeof providerId !== 'string' || !/^[\w-]{1,64}$/.test(providerId)) errors.push('providerId is required')
  if (errors.length > 0) throw new MediaError('MEDIA_IMAGE_REQUEST_INVALID', errors.join('; '))
  return {
    prompt: prompt!.trim(),
    size: request.size!,
    providerId: providerId!,
    model: typeof request.model === 'string' && request.model.trim() ? request.model.trim() : undefined,
  }
}

function stage<T>(name: string, fn: () => T | Promise<T>, hooks: Pick<ImageOrchestratorOptions, 'onStage' | 'isCancelled'>, evidence: EvidenceWriter, taskDir: string): Promise<T> {
  if (hooks.isCancelled?.()) return Promise.reject(new MediaError('MEDIA_JOB_CANCELLED', `cancelled before stage "${name}"`))
  const started = Date.now()
  return Promise.resolve()
    .then(fn)
    .then(result => {
      const info = { stage: name, ms: Date.now() - started }
      hooks.onStage?.(info)
      appendJobEvent(taskDir, { at: new Date().toISOString(), type: 'stage_done', data: info })
      evidence.append(`stage:${name}`, 'ok', { ms: info.ms })
      return result
    })
    .catch(error => {
      const ms = Date.now() - started
      evidence.append(`stage:${name}`, 'error', { ms, error: error instanceof Error ? error.message : String(error) })
      throw error
    })
}

export async function generateImageForJob(options: ImageOrchestratorOptions): Promise<{ output: AssetRecord; model: string }> {
  const { taskDir, taskId, request } = options
  const evidence = new EvidenceWriter(taskDir, taskId)

  const provider = await stage('resolve_provider', () => {
    const resolved = getProvider(request.providerId)
    if (!resolved || !resolved.generateImage) {
      throw new MediaError('MEDIA_PROVIDER_UNAVAILABLE', `provider "${request.providerId}" is unavailable (disabled or unknown)`)
    }
    const status = resolved.validateConfig()
    if (!status.ok) {
      throw new MediaError('MEDIA_PROVIDER_UNAVAILABLE', `provider "${request.providerId}" is not usable: ${status.message}`)
    }
    return resolved
  }, options, evidence, taskDir)

  const result = await stage('generate', () => provider.generateImage!({ prompt: request.prompt, size: request.size, model: request.model }), options, evidence, taskDir)
  evidence.append('provider_usage', 'ok', { provider: provider.id, model: result.model, usage: result.usage })

  const output = await stage('commit', () => {
    const artifact = result.artifacts[0]
    const ext = artifact.filename.includes('.') ? artifact.filename.split('.').pop()! : 'png'
    const relative = join('assets', 'generated', `${taskId}.${ext}`)
    const absolute = join(taskDir, relative)
    mkdirSync(join(taskDir, 'assets', 'generated'), { recursive: true })
    writeFileSync(absolute, artifact.data)
    const record: AssetRecord = {
      id: `asset-${taskId}-image`,
      path: relative.split('\\').join('/'),
      kind: 'image',
      bytes: statSync(absolute).size,
      sha256: createHash('sha256').update(readFileSync(absolute)).digest('hex'),
    }
    evidence.append('commit_asset', 'ok', { path: record.path, bytes: record.bytes, sha256: record.sha256, provider: provider.id, model: result.model })
    return record
  }, options, evidence, taskDir)

  return { output, model: result.model }
}
