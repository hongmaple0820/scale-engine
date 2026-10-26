// Deterministic in-process image provider — queue/UI development and tests
// without any network or spend. Produces a solid-color PNG via zlib (no
// canvas dependency): a minimal valid PNG the pipeline can hash and store.

import { deflateSync } from 'node:zlib'
import type { ImageGenerationRequest, ImageGenerationResult, MediaProvider, ProviderCapabilities, ProviderConfigStatus } from '../types.js'

function crc32(buffer: Buffer): number {
  let crc = -1
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

/** A tiny valid PNG: 8x8 solid #2563eb. */
export function solidColorPng(): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(8, 0)
  ihdr.writeUInt32BE(8, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type RGB
  const raw = Buffer.concat(Array.from({ length: 8 }, () => Buffer.concat([Buffer.from([0]), Buffer.from([0x25, 0x63, 0xeb])])))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

export const MockImageProvider: MediaProvider = {
  id: 'mock',
  kind: 'image',
  enabled: true,
  getCapabilities(): ProviderCapabilities {
    return { kind: 'image', models: ['mock-solid'], async: false, canEstimate: false, canCancel: false, notes: 'in-process dev/test provider; no network, no cost' }
  },
  validateConfig(): ProviderConfigStatus {
    return { ok: true, configured: true, message: 'always available (dev/test only)' }
  },
  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    return {
      artifacts: [{ filename: 'mock.png', data: solidColorPng(), contentType: 'image/png' }],
      model: 'mock-solid',
      usage: { prompt: request.prompt.length },
    }
  },
}
