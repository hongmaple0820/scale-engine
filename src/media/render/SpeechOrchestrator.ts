// Speech orchestrator (M2): one synchronous provider call, one committed asset.
// The output path is engine-owned (`assets/generated.<format>`); provider
// filenames never influence local paths. Text is never written to evidence —
// only sizes, hashes and provider/voice identifiers.

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { MediaError } from '../errors.js'
import type { AssetRecord, SpeechJobRequest } from '../types.js'
import type { MediaProvider } from '../providers/types.js'
import { EvidenceWriter } from '../evidence/EvidenceWriter.js'
import { appendJobEvent } from '../jobs/JobStore.js'
import { sha256Buffer } from '../assets/hash.js'

const DEFAULT_MAX_SPEECH_MB = 64

export interface SpeechOrchestratorOptions {
  taskDir: string
  taskId: string
  request: SpeechJobRequest
  provider: MediaProvider
  isCancelled?: () => boolean
  onStage?: (info: { stage: string; ms: number }) => void
  evidence?: EvidenceWriter
}

export interface SpeechOutcome {
  output: AssetRecord
  usage?: Record<string, unknown>
}

function maxSpeechBytes(): number {
  const raw = process.env.MEDIA_SPEECH_MAX_MB?.trim()
  const value = raw ? Number(raw) : Number.NaN
  const mb = Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_SPEECH_MB
  return mb * 1024 * 1024
}

export async function generateSpeechForJob(options: SpeechOrchestratorOptions): Promise<SpeechOutcome> {
  const { taskDir, taskId, request, provider } = options
  const evidence = options.evidence ?? new EvidenceWriter(taskDir, taskId)
  if (!provider.generateSpeech) {
    throw new MediaError('MEDIA_PROVIDER_UNAVAILABLE', `provider "${provider.id}" cannot generate speech`)
  }
  if (options.isCancelled?.()) throw new MediaError('MEDIA_JOB_CANCELLED', 'cancelled before speech generation')

  const format = request.format ?? 'mp3'
  const result = await provider.generateSpeech({
    text: request.text,
    voice: request.voice ?? 'alloy',
    format,
    ...(request.model ? { model: request.model } : {}),
  })
  const artifact = result.artifacts[0]
  if (!artifact || artifact.data.length === 0) {
    throw new MediaError('MEDIA_PROVIDER_RESPONSE_INVALID', 'speech provider returned no audio artifact')
  }
  if (!artifact.contentType.startsWith('audio/') && !artifact.contentType.startsWith('application/octet-stream')) {
    throw new MediaError('MEDIA_PROVIDER_RESPONSE_INVALID', `speech artifact is not audio: ${artifact.contentType || 'unknown content-type'}`)
  }
  const data = artifact.data
  if (data.length > maxSpeechBytes()) {
    throw new MediaError('MEDIA_QUOTA_EXCEEDED', `speech audio is ${data.length} bytes, over the configured MEDIA_SPEECH_MAX_MB limit`)
  }

  const assetsDir = join(taskDir, 'assets')
  mkdirSync(assetsDir, { recursive: true })
  const dest = join(assetsDir, `generated.${format}`)
  const part = `${dest}.part`
  try {
    writeFileSync(part, data)
    renameSync(part, dest)
  } catch (error) {
    try { rmSync(part, { force: true }) } catch { /* temp only */ }
    throw error
  }

  const relativePath = relative(taskDir, dest).split('\\').join('/')
  const sha256 = sha256Buffer(data)
  const output: AssetRecord = {
    id: `asset-${taskId}-speech`,
    path: relativePath,
    kind: 'audio',
    bytes: data.length,
    sha256,
  }
  evidence.append('speech_generated', 'ok', {
    provider: provider.id,
    model: result.model,
    voice: result.voice,
    path: relativePath,
    bytes: output.bytes,
    sha256,
  })
  appendJobEvent(taskDir, { at: new Date().toISOString(), type: 'provider_completed', data: { provider: provider.id, bytes: output.bytes } })
  return { output, ...(result.usage ? { usage: result.usage } : {}) }
}
