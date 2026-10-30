// Deterministic in-process speech provider (M2). WAV output is a real,
// playable 8 kHz mono PCM silence; MP3 output is a synthetic placeholder so the
// pipeline can exercise the requested extension without claiming audio codecs.

import { MediaError } from '../../errors.js'
import type {
  MediaProvider,
  ProviderArtifact,
  ProviderCapabilities,
  ProviderConfigStatus,
  SpeechGenerationResult,
  SpeechProviderRequest,
} from '../types.js'

export const MOCK_SPEECH_ID = 'mock-speech'

/** 0.25s of silence, 8 kHz mono, 16-bit PCM — a valid RIFF/WAVE file. */
export function silentWav(durationMs = 250): Buffer {
  const sampleRate = 8000
  const samples = Math.max(1, Math.round((durationMs / 1000) * sampleRate))
  const dataBytes = samples * 2
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataBytes, 40)
  return Buffer.concat([header, Buffer.alloc(dataBytes)])
}

export const MockSpeechProvider: MediaProvider = {
  id: MOCK_SPEECH_ID,
  kind: 'speech',
  enabled: true,
  getCapabilities(): ProviderCapabilities {
    return {
      kind: 'speech',
      models: ['mock-speech'],
      async: false,
      canEstimate: true,
      canCancel: false,
      notes: 'in-process dev/test provider; WAV is real silence, MP3 is synthetic, no cost',
    }
  },
  validateConfig(): ProviderConfigStatus {
    return { ok: true, configured: true, message: 'always available (dev/test only)' }
  },
  async generateSpeech(request: SpeechProviderRequest): Promise<SpeechGenerationResult> {
    if (!request.text.trim()) throw new MediaError('MEDIA_SPEECH_REQUEST_INVALID', 'text must not be empty')
    const format = request.format === 'wav' ? 'wav' : 'mp3'
    const artifact: ProviderArtifact = format === 'wav'
      ? { filename: 'mock.wav', data: silentWav(Math.min(10_000, Math.max(250, request.text.length * 60))), contentType: 'audio/wav' }
      : { filename: 'mock.mp3', data: Buffer.from(`MOCK-MP3:${request.text.length}:${request.voice}`, 'utf-8'), contentType: 'audio/mpeg' }
    return { artifacts: [artifact], model: 'mock-speech', voice: request.voice, usage: { characters: [...request.text].length } }
  },
}
